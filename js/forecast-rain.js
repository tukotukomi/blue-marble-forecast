import { recolourDwdRain, recolourGdpsRain } from './recolour.js';

// The forecast rain animation: 48 hours ahead (10 days with Settings >
// Extended radar forecast), from three models:
//
// - Everywhere: Environment and Climate Change Canada's global model (GDPS,
//   15 km), as whole-world map images from its GeoMet service (recoloured in
//   the page to match the radar palette). Its hours set the animation's
//   clock (see FrameSync's lead in frames.js).
// - Lower 48 states, drawn over it: NOAA's HRRR model, the 3 km "forecast
//   radar" (simulated reflectivity), as map images rendered by the Iowa
//   Environmental Mesonet (Iowa State University) from NOAA's data.
// - Europe, drawn over it: Germany's national weather service (DWD) ICON-EU
//   model, hourly rain totals at ~7 km, as map images from DWD's GeoServer
//   (recoloured; DWD doesn't allow custom styles).
//
// The regional models run out sooner than the global one; past their last
// hour the global model shows there too.

// How far ahead, and how often: hourly for 48 hours, or every 3 hours for
// the extended 10 days.
export const forecastSpan = extended => (extended ? { hours: 240, stepH: 3 } : { hours: 48, stepH: 1 });

// ---- GDPS (the whole world) ----
const GEOMET = 'https://geo.weather.gc.ca/geomet';
const GDPS_LAYER = 'GDPS_15km_PrecipRate';
export const WORLD_BOX = { w: -180, s: -90, e: 180, n: 90 };

// A WMS time dimension: "t1,t2,..." and/or "start/end/PT1H" intervals.
function parseTimes(text) {
  const out = [];
  for (const part of text.split(',')) {
    const [a, b, p] = part.trim().split('/');
    if (!b) { out.push(Date.parse(a)); continue; }
    const m = /PT(\d+)H/.exec(p || '');
    const step = (m ? +m[1] : 1) * 36e5;
    for (let t = Date.parse(a); t <= Date.parse(b); t += step) out.push(t);
  }
  return out.filter(Number.isFinite);
}

export async function fetchGlobalForecast({ hours, stepH }) {
  const res = await fetch(`${GEOMET}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0&LAYERS=${GDPS_LAYER}`);
  if (!res.ok) throw new Error(`GeoMet ${res.status}`);
  const xml = await res.text();
  const times = parseTimes(/<Dimension name="time"[^>]*>([^<]*)</.exec(xml)?.[1] ?? '');
  // Keep to one model run, so a new one arriving mid-loop can't mix in.
  const run = /<Dimension name="reference_time"[^>]*default="([^"]+)"/.exec(xml)?.[1];
  const now = Date.now();
  const first = Math.floor(now / (stepH * 36e5)) * stepH * 36e5; // this hour (or 3-hour slot)
  const picked = times.filter(t => t >= first && t <= now + hours * 36e5 && new Date(t).getUTCHours() % stepH === 0);
  if (picked.length < 2) throw new Error('GDPS has no forecast hours');
  const frames = picked.map(t => ({
    time: new Date(t),
    url: `${GEOMET}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${GDPS_LAYER}&STYLES=PRECIPPRTMMH&CRS=EPSG:4326`
      + `&BBOX=-90,-180,90,180&WIDTH=1600&HEIGHT=800&FORMAT=image/png&TRANSPARENT=TRUE&TIME=${new Date(t).toISOString().replace('.000', '')}`
      + (run ? `&DIM_REFERENCE_TIME=${run}` : ''),
    transform: recolourGdpsRain,
  }));
  return { frames, box: WORLD_BOX, source: 'gdps' };
}

// ---- HRRR (lower 48) ----
const IEM = 'https://mesonet.agron.iastate.edu';
export const HRRR_BOX = { w: -126, s: 24, e: -66, n: 50 };
const inHrrr = (lat, lon) => lat > HRRR_BOX.s + 1 && lat < HRRR_BOX.n - 1 && lon > HRRR_BOX.w + 1 && lon < HRRR_BOX.e - 1;

async function fetchHrrr({ hours, stepH }) {
  // Which model run the IEM's images currently come from.
  const meta = await fetch(`${IEM}/data/gis/images/4326/hrrr/refd_0000.json`, { cache: 'no-store' });
  if (!meta.ok) throw new Error(`IEM ${meta.status}`);
  const init = Date.parse((await meta.json()).model_init_utc);
  if (Number.isNaN(init)) throw new Error('No HRRR run time');
  const runHour = new Date(init).getUTCHours();
  const maxMin = runHour % 6 === 0 ? 2160 : 1080; // 36 h runs every 6 h, 18 h otherwise
  // On the global model's hours (runs start on the hour), from this one.
  const every = stepH * 60;
  const slot = Math.floor(Date.now() / (stepH * 36e5)) * stepH * 36e5;
  const start = Math.max(0, Math.ceil((slot - init) / 60e3 / every) * every);
  const frames = [];
  for (let m = start; m <= Math.min(start + hours * 60, maxMin); m += every) {
    // Layer names are reused by every run, so the run time keeps caches apart.
    const urlFor = ({ w, s, e, n }, W, H) => `${IEM}/cgi-bin/wms/hrrr/refd.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=refd_${String(m).padStart(4, '0')}`
      + `&STYLES=&SRS=EPSG:4326&BBOX=${w},${s},${e},${n}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/png&TRANSPARENT=TRUE&run=${init}`;
    frames.push({ time: new Date(init + m * 60e3), urlFor, url: urlFor(HRRR_BOX, 2048, 888) });
  }
  if (frames.length < 2) throw new Error('HRRR run too old');
  return { frames, box: HRRR_BOX, source: 'hrrr', native: 0.027 }; // HRRR: 3 km
}

// ---- DWD ICON-EU (Europe) ----
const DWD = 'https://maps.dwd.de/geoserver/dwd/wms';
export const ICON_EU_BOX = { w: -23.5, s: 29.5, e: 62.5, n: 70.5 };
const inIconEu = (lat, lon) => lat > ICON_EU_BOX.s + 2 && lat < ICON_EU_BOX.n - 2 && lon > ICON_EU_BOX.w + 2 && lon < ICON_EU_BOX.e - 2;

async function fetchIconEu({ hours, stepH }) {
  // Hourly totals valid at each hour, from the next one, for up to 48 hours.
  const step = stepH * 36e5;
  const first = Math.ceil(Date.now() / step) * step;
  const frames = Array.from({ length: Math.floor(Math.min(hours, 48) / stepH) + 1 }, (_, k) => {
    const time = new Date(first + k * step);
    const urlFor = ({ w, s, e, n }, W, H) => `${DWD}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=Icon-eu_reg00625_fd_sl_TOTPREC01H`
      + `&STYLES=&CRS=EPSG:4326&BBOX=${s},${w},${n},${e}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/png&TRANSPARENT=TRUE&TIME=${time.toISOString()}`;
    return { time, urlFor, url: urlFor(ICON_EU_BOX, 2048, 976), transform: recolourDwdRain };
  });
  // Make sure the model run actually has these hours before committing to it.
  const probe = await fetch(frames[0].url);
  if (!probe.ok || !(probe.headers.get('content-type') || '').startsWith('image/')) throw new Error('ICON-EU unavailable');
  return { frames, box: ICON_EU_BOX, source: 'icon-eu', native: 0.0625 }; // ~7 km
}

// The sharper regional forecast for the place being viewed, or null where
// there's none (the global model covers it alone).
// use: which sources the visitor allows (Settings > Data sources).
export async function fetchRegionalForecast(lat, lon, use, span) {
  if (use.hrrr && inHrrr(lat, lon)) return fetchHrrr(span);
  if (use.iconEu && inIconEu(lat, lon)) return fetchIconEu(span);
  return null;
}
