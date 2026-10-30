// The Fire tab's data, both worldwide and free:
//
// - Fire danger: the Fire Weather Index from Copernicus GWIS (the Global
//   Wildfire Information System, ECMWF's weather forecast), a map per day for
//   today and about 9 days ahead. It rates how easily a fire could start and
//   spread; it isn't an official warning and doesn't mean anything is burning.
// - Hot spots: NASA's VIIRS satellite heat detections (GIBS) for today and
//   yesterday, around the viewed place. Often fires, but also factories and
//   gas flares, so the app calls them hot spots.
//
// Both are map images. Each is read pixel by pixel in the page, which gives
// the rating at any place, and redrawn in the app's colours for the globe.
import { px } from './quality.js';

const GWIS = 'https://maps.effis.emergency.copernicus.eu/gwis';
const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const WORLD = 'CRS=EPSG:4326&BBOX=-90,-180,90,180&FORMAT=image/png&TRANSPARENT=TRUE&STYLES=';

// GWIS's class colours in order (index + 1 is the level), and how each is
// drawn on the globe. Low is left clear, so only real danger shows.
const CLASSES = [
  [0x9c, 0xff, 0xc0], [0xcd, 0xe2, 0x4e], [0xe6, 0xac, 0x00], [0xd9, 0x70, 0x10], [0xad, 0x06, 0x0e], [0x3a, 0x00, 0x15],
];
const DRAWN = [null, [250, 220, 60, 0.5], [250, 170, 30, 0.65], [240, 110, 20, 0.75], [220, 30, 30, 0.82], [125, 0, 70, 0.9]];
// For the panel: level 1-6.
export const FIRE_COLOURS = ['#7fd6a0', '#e8d23c', '#f5a81e', '#ee6e14', '#d81e1e', '#78003c'];

async function pixels(url, W, H) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fire map ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close?.();
  return { canvas, ctx, img: ctx.getImageData(0, 0, W, H) };
}

function nearestClass(r, g, b) {
  let best = 0, bd = Infinity;
  CLASSES.forEach((c, i) => {
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best + 1;
}

// One day's map: { canvas, levels, W, H, empty } (levels: 0 no rating, 1-6).
// empty: GWIS has nothing for that date yet. Kept for the session.
const days = new Map();
export function fireDay(date) {
  if (!days.has(date)) days.set(date, loadDay(date).catch(e => { days.delete(date); throw e; }));
  return days.get(date);
}
async function loadDay(date) {
  const W = px(1600), H = px(800);
  const { canvas, ctx, img } = await pixels(`${GWIS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&${WORLD}&LAYERS=ecmwf.fwi&WIDTH=${W}&HEIGHT=${H}&TIME=${date}`, W, H);
  const d = img.data, levels = new Uint8Array(W * H), memo = new Map();
  let any = false;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) { d[i + 3] = 0; continue; }
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let level = memo.get(key);
    if (level === undefined) { level = nearestClass(d[i], d[i + 1], d[i + 2]); memo.set(key, level); }
    levels[i >> 2] = level;
    any = true;
    const to = DRAWN[level - 1];
    if (!to) { d[i + 3] = 0; continue; }
    d[i] = to[0]; d[i + 1] = to[1]; d[i + 2] = to[2]; d[i + 3] = Math.round(to[3] * 255);
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, levels, W, H, empty: !any };
}

// The rating at a place (0 where there's none: sea, ice, bare desert), taking
// the highest just around it so coastal towns still get one.
export function fireAt(day, lat, lon) {
  const { levels, W, H } = day;
  const cx = Math.floor(((lon + 180) / 360) * W), cy = Math.floor(((90 - lat) / 180) * H);
  let best = 0;
  for (let y = cy - 2; y <= cy + 2; y++) {
    if (y < 0 || y >= H) continue;
    for (let x = cx - 2; x <= cx + 2; x++) best = Math.max(best, levels[y * W + ((x + W) % W)]);
  }
  return best;
}

// Hot spots of today and yesterday around a place: { mask, box, W, H },
// refreshed hourly. Only a patch (40 by 20 degrees), because NASA's whole-world
// image draws every detection as a big block; at this scale they're sharp.
const patches = new Map();
export async function fireHotspots(lat, lon) {
  const n = Math.min(90, Math.max(-70, lat + 10)), s = n - 20;
  const w = Math.min(140, Math.max(-180, lon - 20)), e = w + 40;
  const key = `${Math.round(lat / 5)},${Math.round(lon / 5)}`;
  const had = patches.get(key);
  if (had && Date.now() - had.at < 36e5) return had;
  const W = px(2048), H = px(1024);
  const dates = [0, 1].map(k => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10));
  const maps = await Promise.all(dates.map(date => pixels(`${GIBS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&BBOX=${s},${w},${n},${e}&FORMAT=image/png&TRANSPARENT=TRUE&STYLES=&LAYERS=VIIRS_SNPP_Thermal_Anomalies_375m_All&WIDTH=${W}&HEIGHT=${H}&TIME=${date}`, W, H).catch(() => null)));
  const found = maps.filter(Boolean);
  if (!found.length) throw new Error('No fire detections');
  const mask = new Uint8Array(W * H);
  for (const { img } of found) for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 100) mask[i >> 2] = 1;
  const patch = { mask, box: { w, s, e, n }, W, H, at: Date.now() };
  patches.set(key, patch);
  return patch;
}

// Whether any hot spot lies within km of a place inside the patch.
export function firesNear({ mask, box, W, H }, lat, lon, km = 100) {
  const degX = (box.e - box.w) / W, degY = (box.n - box.s) / H;
  const cx = (lon - box.w) / degX, cy = (box.n - lat) / degY;
  const kx = 111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)) * degX, ky = 111 * degY;
  const rx = Math.ceil(km / kx), ry = Math.ceil(km / ky);
  for (let dy = -ry; dy <= ry; dy++) {
    const y = Math.round(cy + dy);
    if (y < 0 || y >= H) continue;
    for (let dx = -rx; dx <= rx; dx++) {
      const x = Math.round(cx + dx);
      if (x < 0 || x >= W || (dx * kx) ** 2 + (dy * ky) ** 2 > km ** 2) continue;
      if (mask[y * W + x]) return true;
    }
  }
  return false;
}

// The hot spots as a picture of just their patch: small bright dots with a
// red edge, a few km across, so they stay true when zoomed in.
export function hotspotCanvas({ mask, W, H }) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  for (const [fill, r] of [['#d81e1e', 2], ['#fff4aa', 1]]) {
    ctx.fillStyle = fill;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) ctx.fillRect(x - r, y - r, r * 2 + 1, r * 2 + 1);
  }
  return canvas;
}
