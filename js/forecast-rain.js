import { recolourDwdRain } from './recolour.js';

// The "next 12 hours" rain animation, from two sources:
//
// - Lower 48 states: NOAA's HRRR model, the 3 km "forecast radar"
//   (simulated reflectivity) in 15-minute steps, as map images rendered by
//   the Iowa Environmental Mesonet (Iowa State University) from NOAA's data.
// - Europe: Germany's national weather service (DWD) ICON-EU model, hourly
//   rain totals at ~7 km, as map images from DWD's GeoServer (recoloured in
//   the page to match the radar palette; DWD doesn't allow custom styles).
// - Everywhere else: no free service publishes forecast-rain map images, so
//   NOAA GFS hourly precipitation is sampled on a grid around the place
//   being viewed (through the same Open-Meteo feed as the rest of the
//   forecast) and painted into images in the page.

const HOURS = 12;

// ---- HRRR (lower 48) ----
const IEM = 'https://mesonet.agron.iastate.edu';
export const HRRR_BOX = { w: -126, s: 24, e: -66, n: 50 };
const inHrrr = (lat, lon) => lat > HRRR_BOX.s + 1 && lat < HRRR_BOX.n - 1 && lon > HRRR_BOX.w + 1 && lon < HRRR_BOX.e - 1;

async function fetchHrrr() {
  // Which model run the IEM's images currently come from.
  const meta = await fetch(`${IEM}/data/gis/images/4326/hrrr/refd_0000.json`, { cache: 'no-store' });
  if (!meta.ok) throw new Error(`IEM ${meta.status}`);
  const init = Date.parse((await meta.json()).model_init_utc);
  if (Number.isNaN(init)) throw new Error('No HRRR run time');
  const runHour = new Date(init).getUTCHours();
  const maxMin = runHour % 6 === 0 ? 2160 : 1080; // 36 h runs every 6 h, 18 h otherwise
  const start = Math.max(0, Math.floor((Date.now() - init) / 60e3 / 30) * 30);
  const frames = [];
  for (let m = start; m <= Math.min(start + HOURS * 60, maxMin); m += 30) {
    // Layer names are reused by every run, so the run time keeps caches apart.
    const urlFor = ({ w, s, e, n }, W, H) => `${IEM}/cgi-bin/wms/hrrr/refd.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=refd_${String(m).padStart(4, '0')}`
      + `&STYLES=&SRS=EPSG:4326&BBOX=${w},${s},${e},${n}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/png&TRANSPARENT=TRUE&run=${init}`;
    frames.push({ time: new Date(init + m * 60e3), urlFor, url: urlFor(HRRR_BOX, 2048, 888) });
  }
  if (frames.length < 2) throw new Error('HRRR run too old');
  return { frames, box: HRRR_BOX, source: 'hrrr', native: 0.027 }; // HRRR: 3 km
}

export async function fetchForecastRain(lat, lon) {
  if (inHrrr(lat, lon)) {
    try { return await fetchHrrr(); } catch { /* fall back to the GFS grid */ }
  }
  if (inIconEu(lat, lon)) {
    try { return await fetchIconEu(); } catch { /* fall back to the GFS grid */ }
  }
  return fetchGfsGrid(lat, lon);
}

// ---- DWD ICON-EU (Europe) ----
const DWD = 'https://maps.dwd.de/geoserver/dwd/wms';
export const ICON_EU_BOX = { w: -23.5, s: 29.5, e: 62.5, n: 70.5 };
const inIconEu = (lat, lon) => lat > ICON_EU_BOX.s + 2 && lat < ICON_EU_BOX.n - 2 && lon > ICON_EU_BOX.w + 2 && lon < ICON_EU_BOX.e - 2;

async function fetchIconEu() {
  // Hourly totals valid at each hour: from the next full hour, 13 frames.
  const first = Math.ceil(Date.now() / 36e5) * 36e5;
  const frames = Array.from({ length: HOURS + 1 }, (_, h) => {
    const time = new Date(first + h * 36e5);
    const urlFor = ({ w, s, e, n }, W, H) => `${DWD}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=Icon-eu_reg00625_fd_sl_TOTPREC01H`
      + `&STYLES=&CRS=EPSG:4326&BBOX=${s},${w},${n},${e}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/png&TRANSPARENT=TRUE&TIME=${time.toISOString()}`;
    return { time, urlFor, url: urlFor(ICON_EU_BOX, 2048, 976), transform: recolourDwdRain };
  });
  // Make sure the model run actually has these hours before committing to it.
  const probe = await fetch(frames[0].url);
  if (!probe.ok || !(probe.headers.get('content-type') || '').startsWith('image/')) throw new Error('ICON-EU unavailable');
  return { frames, box: ICON_EU_BOX, source: 'icon-eu', native: 0.0625 }; // ~7 km
}

// ---- GFS grid (everywhere else) ----
const STEP = 1;          // grid spacing, degrees (~110 km)
const HALF_LAT = 8;      // box half-height, degrees  -> 17 rows
const HALF_LON = 12;     // box half-width, degrees   -> 25 columns (425 points)
const SCALE = 20;        // output pixels per grid cell

// Radar-style colours by rain rate (mm per hour), interpolated in log space.
const STOPS = [
  [0.08, [120, 200, 255, 0.0]],
  [0.25, [80, 170, 255, 0.75]],
  [1, [40, 200, 90, 0.85]],
  [3, [250, 220, 40, 0.85]],
  [8, [250, 130, 20, 0.9]],
  [20, [230, 30, 40, 0.95]],
  [50, [200, 40, 200, 1]],
];
function colour(mm) {
  if (!(mm >= STOPS[0][0])) return null;
  const x = Math.log(mm);
  for (let i = 1; i < STOPS.length; i++) {
    const [v1, c1] = STOPS[i];
    if (mm <= v1) {
      const [v0, c0] = STOPS[i - 1];
      const t = (x - Math.log(v0)) / (Math.log(v1) - Math.log(v0));
      return c0.map((c, k) => c + (c1[k] - c) * t);
    }
  }
  return STOPS.at(-1)[1];
}

const r2 = n => Math.round(n * 100) / 100;

async function fetchGfsGrid(lat, lon) {
  // Snap the box to the grid so small moves reuse the cached request.
  const cLat = Math.max(-90 + HALF_LAT, Math.min(90 - HALF_LAT, Math.round(lat / STEP) * STEP));
  const cLon = Math.round(lon / STEP) * STEP;
  const lats = [], lons = [];
  for (let la = cLat - HALF_LAT; la <= cLat + HALF_LAT; la += STEP) lats.push(la);
  for (let lo = cLon - HALF_LON; lo <= cLon + HALF_LON; lo += STEP) lons.push(lo);
  const rows = lats.length, cols = lons.length;
  const wrap = x => ((((x % 360) + 540) % 360) - 180);
  const pts = lats.flatMap(la => lons.map(lo => [la, wrap(lo)]));
  const p = new URLSearchParams({
    latitude: pts.map(q => r2(q[0])).join(','), longitude: pts.map(q => r2(q[1])).join(','),
    hourly: 'precipitation', models: 'gfs_seamless', timezone: 'GMT', forecast_hours: HOURS + 1,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : [data];
  const times = list[0].hourly.time.map(t => new Date(t + 'Z'));

  // values[h][row][col], row 0 = south.
  const frames = times.map((time, h) => {
    const grid = lats.map((_, r) => lons.map((_, c) => list[r * cols + c]?.hourly.precipitation[h] ?? 0));
    return { time, image: paint(grid, rows, cols) };
  });
  return {
    frames,
    box: { w: lons[0] - STEP / 2, e: lons.at(-1) + STEP / 2, s: lats[0] - STEP / 2, n: lats.at(-1) + STEP / 2 },
    source: 'gfs',
  };
}

// Catmull-Rom (bicubic) upsampling keeps rain bands rounded instead of the
// diamond-shaped blobs plain bilinear blending gives, then colours per pixel.
const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
function paint(grid, rows, cols) {
  const W = cols * SCALE, H = rows * SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const at = (r, c) => grid[Math.max(0, Math.min(rows - 1, r))][Math.max(0, Math.min(cols - 1, c))];
  for (let y = 0; y < H; y++) {
    // Canvas row 0 is the north edge; grid row 0 is the south edge.
    const gy = (H - 1 - y) / SCALE - 0.5, r0 = Math.floor(gy), fy = gy - r0;
    for (let x = 0; x < W; x++) {
      const gx = x / SCALE - 0.5, c0 = Math.floor(gx), fx = gx - c0;
      const row = r => cr(at(r, c0 - 1), at(r, c0), at(r, c0 + 1), at(r, c0 + 2), fx);
      const v = cr(row(r0 - 1), row(r0), row(r0 + 1), row(r0 + 2), fy);
      const col = colour(v);
      if (!col) continue;
      const i = (y * W + x) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = col[3] * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
