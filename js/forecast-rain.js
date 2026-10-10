// The "next 12 hours" rain animation. No free government service publishes
// hourly forecast-rain map images worldwide, so this samples NOAA GFS (with
// HRRR blended in over the U.S.) on a grid of points around the place being
// viewed, through the same Open-Meteo feed as the rest of the forecast, and
// paints each hour into an image in the page.

const STEP = 2;          // grid spacing, degrees
const HALF_LAT = 12;     // box half-height, degrees  -> 13 rows
const HALF_LON = 18;     // box half-width, degrees   -> 19 columns
const SCALE = 24;        // output pixels per grid cell
const HOURS = 12;

// Radar-style colours by rain rate (mm per hour), interpolated in log space.
const STOPS = [
  [0.1, [120, 200, 255, 0.0]],
  [0.3, [90, 180, 255, 0.55]],
  [1, [40, 200, 90, 0.75]],
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

export async function fetchForecastRain(lat, lon) {
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
  };
}

// Bilinear upsampling of the coarse grid, then colouring per pixel.
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
      const v = (at(r0, c0) * (1 - fx) + at(r0, c0 + 1) * fx) * (1 - fy)
        + (at(r0 + 1, c0) * (1 - fx) + at(r0 + 1, c0 + 1) * fx) * fy;
      const col = colour(v);
      if (!col) continue;
      const i = (y * W + x) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = col[3] * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
