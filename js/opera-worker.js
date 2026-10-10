// Web Worker: turns EUMETNET OPERA's European radar composite (a 1 km GeoTIFF
// in a Lambert azimuthal equal-area projection) into a coloured PNG on the
// app's latitude/longitude grid. Runs off the main thread so decoding never
// stutters the globe.
//
// Only the needed parts of each file are downloaded: geotiff.js uses HTTP
// range requests, and the file's built-in overviews (2, 4, 8, 16 km) serve
// the zoomed-out views.

import { fromUrl } from 'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/+esm';

// ---- Projection: OPERA's grid ----
// +proj=laea +lat_0=55 +lon_0=10 +x_0=1950000 +y_0=-2100000 +ellps=WGS84, 1 km
// pixels; the top-left pixel corner is at (-500, 500) metres.
const A = 6378137, E2 = 0.00669437999014, E = Math.sqrt(E2);
const D2R = Math.PI / 180, LAT0 = 55 * D2R, LON0 = 10 * D2R, X0 = 1950000, Y0 = -2100000;
const GRID_X = -500, GRID_Y = 500, FULL_RES = 1000;
const q = phi => {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
};
const QP = q(Math.PI / 2), RQ = A * Math.sqrt(QP / 2);
const B1 = Math.asin(q(LAT0) / QP);
const M1 = Math.cos(LAT0) / Math.sqrt(1 - E2 * Math.sin(LAT0) ** 2);
const DD = (A * M1) / (RQ * Math.cos(B1));
// Ellipsoidal oblique LAEA forward projection (Snyder, Map Projections, 1987).
function project(lon, lat) {
  const beta = Math.asin(q(lat * D2R) / QP), dl = lon * D2R - LON0;
  const b = RQ * Math.sqrt(2 / (1 + Math.sin(B1) * Math.sin(beta) + Math.cos(B1) * Math.cos(beta) * Math.cos(dl)));
  return [
    X0 + b * DD * Math.cos(beta) * Math.sin(dl),
    Y0 + (b / DD) * (Math.cos(B1) * Math.sin(beta) - Math.sin(B1) * Math.cos(beta) * Math.cos(dl)),
  ];
}

// ---- Colour: reflectivity (dBZ) on the app's radar palette ----
const STOPS = [
  [7, [120, 200, 255, 0]], [10, [110, 195, 255, 0.6]], [15, [80, 170, 255, 0.78]], [20, [40, 190, 90, 0.85]],
  [27, [150, 215, 60, 0.86]], [32, [250, 220, 40, 0.88]], [38, [250, 150, 20, 0.9]], [44, [250, 100, 20, 0.92]],
  [50, [230, 30, 40, 0.95]], [55, [200, 30, 110, 0.97]], [60, [200, 40, 200, 1]], [65, [235, 140, 255, 1]],
];
const LUT = new Uint8ClampedArray(256 * 4); // dBZ -32..95.5 in 0.5 steps
for (let i = 0; i < 256; i++) {
  const dbz = -32 + i * 0.5;
  if (dbz < STOPS[0][0]) continue;
  let c = STOPS.at(-1)[1];
  for (let k = 1; k < STOPS.length; k++) {
    if (dbz <= STOPS[k][0]) {
      const [v0, c0] = STOPS[k - 1], [v1, c1] = STOPS[k], t = (dbz - v0) / (v1 - v0);
      c = c0.map((x, j) => x + (c1[j] - x) * t);
      break;
    }
  }
  LUT.set([c[0], c[1], c[2], c[3] * 255], i * 4);
}

// ---- Files ----
const files = new Map(); // url -> Promise<GeoTIFF>, a few recent ones
function open(url) {
  if (!files.has(url)) {
    files.set(url, fromUrl(url, { allowFullFile: false, blockSize: 65536 }));
    if (files.size > 6) files.delete(files.keys().next().value);
  }
  return files.get(url);
}

async function render({ url, box, W, H }) {
  const tiff = await open(url);
  // Pick the coarsest built-in level that's still finer than the output pixels.
  const ground = ((box.e - box.w) * 111320 * Math.cos(((box.s + box.n) / 2) * D2R)) / W;
  const count = await tiff.getImageCount();
  let image = await tiff.getImage(0), res = FULL_RES;
  for (let i = 1; i < count; i++) {
    const img = await tiff.getImage(i);
    const r = FULL_RES * (3800 / img.getWidth());
    if (r > ground * 1.25) break;
    image = img; res = r;
  }
  const iw = image.getWidth(), ih = image.getHeight();

  // Grid coordinates for every output pixel: exact on a coarse lattice,
  // bilinear in between (the projection is smooth at this scale).
  const STEP = 8, gw = Math.ceil(W / STEP) + 1, gh = Math.ceil(H / STEP) + 1;
  const gx = new Float64Array(gw * gh), gy = new Float64Array(gw * gh);
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const lon = box.w + (Math.min(i * STEP, W) / W) * (box.e - box.w);
    const lat = box.n - (Math.min(j * STEP, H) / H) * (box.n - box.s);
    const [x, y] = project(lon, lat);
    const c = (x - GRID_X) / res, r = (GRID_Y - y) / res;
    gx[j * gw + i] = c; gy[j * gw + i] = r;
    minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  const win = [
    Math.max(0, Math.floor(minC) - 1), Math.max(0, Math.floor(minR) - 1),
    Math.min(iw, Math.ceil(maxC) + 2), Math.min(ih, Math.ceil(maxR) + 2),
  ];
  const out = new ImageData(W, H);
  if (win[2] > win[0] && win[3] > win[1]) {
    const ww = win[2] - win[0], wh = win[3] - win[1];
    const data = await image.readRasters({ window: win, samples: [0], interleave: true });
    for (let y = 0; y < H; y++) {
      const j = Math.floor(y / STEP), fy = (y % STEP) / STEP;
      for (let x = 0; x < W; x++) {
        const i = Math.floor(x / STEP), fx = (x % STEP) / STEP;
        const k = j * gw + i;
        const c = (gx[k] * (1 - fx) + gx[k + 1] * fx) * (1 - fy) + (gx[k + gw] * (1 - fx) + gx[k + gw + 1] * fx) * fy;
        const r = (gy[k] * (1 - fx) + gy[k + 1] * fx) * (1 - fy) + (gy[k + gw] * (1 - fx) + gy[k + gw + 1] * fx) * fy;
        const cc = Math.floor(c) - win[0], rr = Math.floor(r) - win[1];
        if (cc < 0 || rr < 0 || cc >= ww || rr >= wh) continue;
        const v = data[rr * ww + cc];
        if (!(v > 7) || v > 95) continue; // NaN, no echo, or fill values
        const li = Math.min(255, Math.round((v + 32) * 2)) * 4;
        const o = (y * W + x) * 4;
        out.data[o] = LUT[li]; out.data[o + 1] = LUT[li + 1]; out.data[o + 2] = LUT[li + 2]; out.data[o + 3] = LUT[li + 3];
      }
    }
  }
  const canvas = new OffscreenCanvas(W, H);
  canvas.getContext('2d').putImageData(out, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

self.onmessage = async ({ data: job }) => {
  try {
    self.postMessage({ id: job.id, blob: await render(job) });
  } catch (err) {
    self.postMessage({ id: job.id, error: String(err?.message || err) });
  }
};
