// High resolution radar for Europe: EUMETNET OPERA's 1 km composite of
// ~25 national radar networks (CC BY 4.0), every 5 minutes.
//
// OPERA's open bucket doesn't allow browser (CORS) access, so files come
// through a tiny read-only relay (weather/tools/opera-relay/worker.js on
// Cloudflare). Decoding, reprojection and colouring happen in
// opera-worker.js, which returns PNGs that the frame player uses like any
// other radar image.

// The deployed Cloudflare Worker's URL, ending in "/". The local dev server
// has a stand-in at /opera-relay/ (see .claude/static-server.ps1).
const RELAY_URL = '';
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
export const OPERA_RELAY = LOCAL ? '/opera-relay/' : RELAY_URL;

// Geographic box around OPERA's grid (its corners and bulging top edge).
export const EU_RADAR_BOX = { w: -40, s: 31, e: 58, n: 74 };

const pad = n => String(n).padStart(2, '0');
const fileUrl = time => {
  const d = new Date(time), Y = d.getUTCFullYear(), M = pad(d.getUTCMonth() + 1), D = pad(d.getUTCDate());
  return `${OPERA_RELAY}${Y}/${M}/${D}/OPERA/COMP/OPERA@${Y}${M}${D}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}@0@DBZH.tiff`;
};

// One shared worker; jobs are matched to replies by id.
let worker = null, nextId = 0;
const pending = new Map();
function decode(job) {
  if (!worker) {
    worker = new Worker(new URL('./opera-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      pending.delete(data.id);
      if (p) data.error ? p.reject(new Error(data.error)) : p.resolve(data.blob);
    };
  }
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, ...job });
  });
}

// The newest composite appears ~5-10 minutes after its time; probe back
// from "now" in 5-minute steps until one exists.
async function latestTime() {
  const step = 5 * 60e3;
  let t = Math.floor(Date.now() / step) * step;
  for (let i = 0; i < 8; i++, t -= step) {
    const res = await fetch(fileUrl(t), { method: 'HEAD' }).catch(() => null);
    if (res?.ok) return t;
  }
  throw new Error('No recent OPERA composite');
}

export async function fetchOperaRadar(minutes = 120, stepMin = 10) {
  if (!OPERA_RELAY) throw new Error('OPERA relay not configured');
  const end = await latestTime();
  const count = Math.floor(minutes / stepMin) + 1;
  const frames = Array.from({ length: count }, (_, k) => {
    const time = new Date(end - (count - 1 - k) * stepMin * 60e3);
    const url = fileUrl(time);
    // makeFor(box, W, H): a frame for any area/size, decoded in the worker.
    // The "opera:" key names the result for the frame player's cache.
    const makeFor = (box, W, H) => ({
      url: `opera:${time.toISOString()}:${box.w},${box.s},${box.e},${box.n}:${W}x${H}`,
      make: () => decode({ url: new URL(url, location.href).href, box, W, H }),
    });
    return { time, makeFor, ...makeFor(EU_RADAR_BOX, 1600, 700) };
  });
  return { frames, box: EU_RADAR_BOX, native: 0.012 }; // ~1 km
}
