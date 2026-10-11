// Cloudflare Worker: turns the app's "Send feedback" form into GitHub issues.
//
// The app posts a bug report or idea (a message, optional email, optional
// screenshot and some app details such as the build and device). This Worker
// checks it, saves the screenshot as a file in the private feedback repo,
// and opens an issue there labelled "bug" or "idea", with the screenshot
// shown inline. Nobody needs an account to send feedback.
//
// Setup (once): a fine-grained GitHub token limited to the feedback repo with
// Issues and Contents read/write, stored as a secret, then deploy:
//   npx wrangler secret put GITHUB_TOKEN
//   npx wrangler deploy
// The repo is set in wrangler.toml (REPO). The app's address for this Worker
// is FEEDBACK_URL in js/feedback.js.

const ORIGINS = /^(https:\/\/(www\.)?bluemarbleforecast\.com|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
const TYPES = { bug: 'Bug', idea: 'Idea' };
const MAX_MESSAGE = 5000;
const MAX_SHOT = 3 * 1024 * 1024; // the app shrinks screenshots well below this
const SHOT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Best-effort rate limit per visitor (per Worker instance): a few reports in
// ten minutes is plenty for a person and stops a script hammering it.
const recent = new Map(); // ip -> [timestamps]
const LIMIT = 5, WINDOW = 10 * 60e3;
function tooMany(ip) {
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter(t => now - t < WINDOW);
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > LIMIT;
}

const json = (body, status, origin) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...(origin ? cors(origin) : {}) },
});
const cors = origin => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});

async function github(env, method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${env.REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'blue-marble-feedback-worker',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// The message goes in a fenced block, so @mentions, #links and markdown in it
// can't ping anyone or reformat the issue.
const fenced = text => `~~~text\n${text.replace(/~{3,}/g, '~~')}\n~~~`;
const cell = text => String(text).replace(/[|\r\n]+/g, ' ').slice(0, 300);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ORIGINS.test(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: allowed ? cors(origin) : {} });
    if (request.method !== 'POST') return json({ error: 'method' }, 405, allowed && origin);
    if (!allowed) return json({ error: 'origin' }, 403);
    if (+request.headers.get('Content-Length') > MAX_SHOT + 64 * 1024) return json({ error: 'too-large' }, 413, origin);
    if (tooMany(request.headers.get('CF-Connecting-IP') || 'unknown')) return json({ error: 'rate' }, 429, origin);

    let form;
    try { form = await request.formData(); } catch { return json({ error: 'form' }, 400, origin); }
    // A field people never see: bots that fill in everything give themselves away.
    if (form.get('website')) return json({ ok: true }, 200, origin);
    const type = TYPES[form.get('type')] ? form.get('type') : null;
    const message = String(form.get('message') || '').trim();
    const email = String(form.get('email') || '').trim().slice(0, 200);
    if (!type || message.length < 3 || message.length > MAX_MESSAGE) return json({ error: 'invalid' }, 400, origin);
    let details = {};
    try { details = JSON.parse(String(form.get('details') || '{}')); } catch { /* optional */ }

    try {
      // Screenshot: saved in the repo, shown inline in the issue (the link
      // works for anyone who can see the private repo).
      let shotMarkdown = '';
      const shot = form.get('screenshot');
      if (shot && typeof shot !== 'string' && shot.size) {
        const ext = SHOT_TYPES[shot.type];
        if (!ext || shot.size > MAX_SHOT) return json({ error: 'screenshot' }, 400, origin);
        const now = new Date();
        const path = `screenshots/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${now.getTime()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
        await github(env, 'PUT', `/contents/${path}`, {
          message: `Screenshot for a ${type} report`,
          content: base64(new Uint8Array(await shot.arrayBuffer())),
        });
        shotMarkdown = `\n### Screenshot\n![Screenshot](https://github.com/${env.REPO}/blob/main/${path}?raw=true)\n`;
      }

      const rows = Object.entries(details).slice(0, 20).map(([k, v]) => `| ${cell(k)} | ${cell(v)} |`).join('\n');
      const firstLine = message.split('\n')[0].replace(/\s+/g, ' ').trim();
      const issue = await github(env, 'POST', '/issues', {
        title: `${TYPES[type]}: ${firstLine.length > 70 ? `${firstLine.slice(0, 67)}...` : firstLine}`,
        labels: [type],
        body: [
          `### ${type === 'bug' ? 'What happened' : 'Idea'}`,
          fenced(message),
          shotMarkdown,
          '### App details',
          '| | |\n|---|---|',
          rows || '| (none) | |',
          email ? `\n**Reply to:** ${cell(email)}` : '',
          '\n<sub>Sent from the in-app feedback form.</sub>',
        ].join('\n'),
      });
      return json({ ok: true, issue: issue.number }, 200, origin);
    } catch (err) {
      console.error(err);
      return json({ error: 'github' }, 502, origin);
    }
  },
};
