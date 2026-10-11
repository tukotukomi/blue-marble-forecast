// "Send feedback": a bug report or idea, with an optional screenshot, posted
// to a small Cloudflare Worker (tools/feedback-worker) that files it as an
// issue in the private feedback repo. No account needed. Each report also
// carries app details (build, device, screen...) supplied by app.js, so bug
// reports say which version they came from.

// The deployed Worker (see tools/feedback-worker/wrangler.toml).
const FEEDBACK_URL = 'https://blue-marble-feedback.fractalize-studio.workers.dev/';
const MAX_SIDE = 1600;       // screenshots are shrunk to this many pixels on the long side
const MAX_BYTES = 2.5e6;     // and to under this size (the Worker accepts up to 3 MB)

const $ = s => document.querySelector(s);

// Shrink a picked image to a JPEG of reasonable size (photos from phones are
// often 3-10 MB). Falls back to the original if the browser can't decode it.
async function shrink(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    return /^image\/(jpeg|png|webp)$/.test(file.type) && file.size <= MAX_BYTES ? file : null;
  }
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k); canvas.height = Math.round(bmp.height * k);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  for (const q of [0.82, 0.65, 0.5]) {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= MAX_BYTES) return new File([blob], 'screenshot.jpg', { type: 'image/jpeg' });
  }
  return null;
}

// t: translator; toast/blip: app feedback; details(): the app details to send.
export function initFeedback({ t, toast, blip, details }) {
  const dlg = $('#feedback-dialog'), msg = $('#fb-message'), status = $('#fb-status');
  let type = 'bug', shot = null, sending = false;

  function setType(next) {
    type = next;
    dlg.querySelectorAll('[data-fb-type]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fbType === type)));
    msg.placeholder = t(type === 'bug' ? 'feedback.placeholderBug' : 'feedback.placeholderIdea');
  }
  function setShot(file) {
    shot = file;
    const prev = $('#fb-shot-preview');
    if (prev.src) URL.revokeObjectURL(prev.src);
    prev.src = file ? URL.createObjectURL(file) : '';
    dlg.classList.toggle('has-shot', !!file);
  }
  const say = (key, error = false) => { status.textContent = key ? t(key) : ''; status.classList.toggle('error', error); };

  function open() {
    blip('select');
    msg.value = ''; $('#fb-email').value = ''; $('#fb-website').value = '';
    setType('bug'); setShot(null); say('');
    dlg.showModal();
  }

  dlg.querySelectorAll('[data-fb-type]').forEach(b => b.addEventListener('click', () => setType(b.dataset.fbType)));
  $('#fb-shot-input').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be picked again
    if (!file) return;
    const small = await shrink(file);
    if (small) { setShot(small); say(''); } else say('feedback.shotError', true);
  });
  $('#fb-shot-remove').addEventListener('click', () => setShot(null));

  $('#fb-send').addEventListener('click', async () => {
    if (sending) return;
    const message = msg.value.trim();
    if (message.length < 3) { say('feedback.short', true); msg.focus(); return; }
    const form = new FormData();
    form.append('type', type);
    form.append('message', message.slice(0, 5000));
    form.append('email', $('#fb-email').value.trim());
    form.append('website', $('#fb-website').value); // the bot trap (left empty by people)
    form.append('details', JSON.stringify(details()));
    if (shot) form.append('screenshot', shot, shot.name);
    sending = true; $('#fb-send').disabled = true; say('feedback.sending');
    try {
      const res = await fetch(FEEDBACK_URL, { method: 'POST', body: form });
      if (res.status === 429) { say('feedback.rate', true); return; }
      if (!res.ok) throw new Error(res.status);
      dlg.close();
      toast(t('feedback.thanks'));
    } catch {
      say('feedback.error', true);
    } finally {
      sending = false; $('#fb-send').disabled = false;
    }
  });

  return { open, retranslate: () => setType(type) };
}
