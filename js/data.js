// All network access lives here. Every source is free and needs no API key:
//
//  - NOAA GFS / HRRR model output (U.S. National Weather Service models),
//    served as JSON by Open-Meteo with `models=gfs_seamless` so every number on
//    the site comes from the same NOAA model run, worldwide.
//  - api.weather.gov  - official NWS forecast text + active alerts (U.S. only).
//  - Copernicus CAMS  - European pollen forecast (EU Earth-observation service).
//  - NASA GIBS        - Blue Marble, Black Marble and IMERG imagery (see globe.js).
//  - NOAA nowCOAST    - live U.S. weather-radar mosaic.
//  - GeoNames         - place-name search (via Open-Meteo's geocoder).

import { NWS_COUNTRIES } from './cities.js';

const OM = 'https://api.open-meteo.com/v1/forecast';
const CACHE_MIN = 20;

async function getJSON(url, { cacheKey = url, ttlMin = CACHE_MIN, headers } = {}) {
  try {
    const hit = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (hit && Date.now() - hit.t < ttlMin * 60e3) return hit.v;
  } catch { /* storage unavailable - just fetch */ }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${new URL(url).host}`);
  const v = await res.json();
  try { sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), v })); } catch { /* full or blocked */ }
  return v;
}

const r2 = n => Math.round(n * 100) / 100;

export async function fetchForecast(lat, lon) {
  const p = new URLSearchParams({
    latitude: r2(lat), longitude: r2(lon), models: 'gfs_seamless', timezone: 'auto', forecast_days: 7,
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation',
    hourly: 'temperature_2m,weather_code,precipitation_probability,uv_index,relative_humidity_2m,wind_speed_10m,is_day,cloud_cover',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunshine_duration,daylight_duration,sunrise,sunset,wind_speed_10m_max',
  });
  return getJSON(`${OM}?${p}`);
}

// One request for many points (Open-Meteo accepts comma-separated lists).
export async function fetchCities(cities) {
  if (!cities.length) return [];
  const p = new URLSearchParams({
    latitude: cities.map(c => c.lat).join(','), longitude: cities.map(c => c.lon).join(','),
    models: 'gfs_seamless', timezone: 'auto', forecast_days: 2,
    current: 'temperature_2m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
  });
  const key = 'cities:' + cities.map(c => `${c.lat},${c.lon}`).join('|');
  const data = await getJSON(`${OM}?${p}`, { cacheKey: key, ttlMin: 30 });
  const list = Array.isArray(data) ? data : [data];
  return cities.map((c, i) => ({ ...c, wx: list[i] }));
}

export async function fetchPollen(lat, lon) {
  const p = new URLSearchParams({
    latitude: r2(lat), longitude: r2(lon), timezone: 'auto', forecast_days: 4,
    hourly: 'alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen',
  });
  return getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?${p}`);
}

export async function searchPlaces(q, language = 'en') {
  const p = new URLSearchParams({ name: q, count: 8, language, format: 'json' });
  const data = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?${p}`, { ttlMin: 600 });
  return (data.results || []).map(r => ({
    name: r.name, region: r.admin1 || '', country: r.country || '', cc: r.country_code || '',
    lat: r.latitude, lon: r.longitude,
  }));
}

// ---- National Weather Service (official U.S. forecasts & alerts) ----

export function isNWS(loc) {
  if (loc.cc) return NWS_COUNTRIES.has(loc.cc.toUpperCase());
  // Unknown country (e.g. a spot clicked on the globe): rough U.S. bounding boxes.
  const { lat, lon } = loc;
  return (lat > 24 && lat < 50 && lon > -125 && lon < -66) || (lat > 51 && lat < 72 && lon > -170 && lon < -129)
    || (lat > 18.5 && lat < 22.5 && lon > -161 && lon < -154);
}

const NWS_HEADERS = { Accept: 'application/geo+json' };

export async function fetchNWS(lat, lon) {
  const point = await getJSON(`https://api.weather.gov/points/${r2(lat)},${r2(lon)}`, { ttlMin: 1440, headers: NWS_HEADERS });
  const props = point.properties;
  const [forecast, alerts] = await Promise.all([
    getJSON(props.forecast, { headers: NWS_HEADERS }).catch(() => null),
    getJSON(`https://api.weather.gov/alerts/active?point=${r2(lat)},${r2(lon)}`, { ttlMin: 5, headers: NWS_HEADERS }).catch(() => null),
  ]);
  const rel = props.relativeLocation?.properties;
  return {
    office: props.cwa,
    place: rel ? { name: rel.city, region: rel.state } : null,
    periods: forecast?.properties?.periods || [],
    alerts: (alerts?.features || []).map(f => f.properties),
  };
}

// ---- Helpers that shape raw model output into what the screens need ----

// Returns the hourly rows for a given local date (YYYY-MM-DD).
export function hoursFor(fc, date) {
  const h = fc.hourly;
  const rows = [];
  h.time.forEach((t, i) => {
    if (t.startsWith(date)) rows.push({
      hour: +t.slice(11, 13), time: t, temp: h.temperature_2m[i], code: h.weather_code[i],
      pop: h.precipitation_probability[i], uv: h.uv_index[i], rh: h.relative_humidity_2m[i],
      wind: h.wind_speed_10m[i], isDay: !!h.is_day[i], cloud: h.cloud_cover[i],
    });
  });
  return rows;
}

export function dayRow(fc, i) {
  const d = fc.daily;
  return {
    date: d.time[i], code: d.weather_code[i], hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i],
    pop: d.precipitation_probability_max[i], uv: d.uv_index_max[i], sun: d.sunshine_duration[i],
    daylight: d.daylight_duration[i], sunrise: d.sunrise[i], sunset: d.sunset[i], windMax: d.wind_speed_10m_max[i],
  };
}

// "Now" in the forecast location's own clock, as a Date whose UTC fields hold local wall time.
export function localNow(fc) {
  return new Date(Date.now() + fc.utc_offset_seconds * 1000);
}

// ---- Animated precipitation frames ----

// Whole-second ISO times: GIBS rejects fractional seconds.
const iso = t => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

// NASA GPM IMERG "early run" precipitation, a global satellite estimate every
// 30 minutes. It reaches GIBS a few hours after the fact, so ask GIBS for the
// newest time it has (DescribeDomains is a tiny reply, unlike GetCapabilities)
// and step back from there.
export async function fetchSatFrames(count = 16) {
  const now = Date.now();
  const domains = `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi?SERVICE=WMTS&REQUEST=DescribeDomains&VERSION=1.0.0`
    + `&LAYER=IMERG_Precipitation_Rate_30min&TILEMATRIXSET=2km&TIME=${iso(now - 2 * 864e5)}/${iso(now + 36e5)}`;
  const res = await fetch(domains);
  if (!res.ok) throw new Error(`GIBS ${res.status}`);
  const domain = (await res.text()).match(/<Domain>([^<]+)<\/Domain>/)?.[1];
  if (!domain) throw new Error('No IMERG times');
  // Either "start/end/PT30M" intervals or plain times, comma-separated: the
  // newest time is the end of the last entry.
  const last = domain.split(',').pop().split('/');
  const latest = new Date(last.length > 1 ? last[1] : last[0]).getTime();
  // urlFor(box, w, h) renders the same frame for any area; the app uses it
  // for sharper frames of just the area on screen when zoomed in.
  const frames = Array.from({ length: count }, (_, k) => {
    const time = new Date(latest - (count - 1 - k) * 30 * 60e3);
    const urlFor = ({ w, s, e, n }, W, H) => 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326'
      + `&LAYERS=IMERG_Precipitation_Rate_30min&STYLES=&BBOX=${s},${w},${n},${e}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/png&TRANSPARENT=TRUE&TIME=${iso(time)}`;
    return { time, urlFor, url: urlFor(GLOBAL_BOX, 2048, 1024) };
  });
  return { frames, box: GLOBAL_BOX, native: 0.1 }; // IMERG grid: 0.1 degrees
}
export const GLOBAL_BOX = { w: -180, s: -90, e: 180, n: 90 };

// NOAA's weather-radar mosaic for the lower 48 states (nowCOAST), refreshed
// every few minutes. Its own capabilities document lists the available scan
// times; keep the last two hours, thinned to roughly one frame per 10 minutes.
const NOWCOAST = 'https://nowcoast.noaa.gov/geoserver/weather_radar/wms';
export const RADAR_BOX = { w: -130, s: 20, e: -60, n: 55 }; // degrees, matches the 2:1 image below

export async function fetchRadarFrames(minutes = 120, stepMin = 10) {
  const res = await fetch(`${NOWCOAST}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`);
  if (!res.ok) throw new Error(`nowCOAST ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
  const layer = [...doc.getElementsByTagName('Layer')]
    .find(l => l.getElementsByTagName('Name')[0]?.textContent === 'base_reflectivity_mosaic');
  const dim = layer && [...layer.getElementsByTagName('Dimension')].find(d => d.getAttribute('name') === 'time');
  if (!dim) throw new Error('No radar times');
  const times = dim.textContent.split(',').map(s => s.trim()).filter(Boolean)
    .map(raw => ({ raw, t: Date.parse(raw) })).filter(x => !Number.isNaN(x.t)).sort((a, b) => a.t - b.t);
  if (!times.length) throw new Error('No radar times');
  const newest = times.at(-1).t;
  const picked = [];
  for (let i = times.length - 1; i >= 0 && times[i].t >= newest - minutes * 60e3; i--) {
    if (!picked.length || picked.at(-1).t - times[i].t >= stepMin * 60e3 * 0.9) picked.push(times[i]);
  }
  const frames = picked.reverse().map(({ raw, t }) => {
    // Use the scan time exactly as published: the server only matches exact values.
    const urlFor = ({ w, s, e, n }, W, H) => `${NOWCOAST}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=base_reflectivity_mosaic&STYLES=&CRS=EPSG:4326`
      + `&BBOX=${s},${w},${n},${e}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/png&TRANSPARENT=TRUE&TIME=${encodeURIComponent(raw)}`;
    return { time: new Date(t), urlFor, url: urlFor(RADAR_BOX, 2048, 1024) };
  });
  return { frames, box: RADAR_BOX, native: 0.035 }; // mosaic cells: ~4 km
}

// ---- More cities to explore ----

// ~7,000 extra places from Natural Earth (public domain), generated into
// data/places.json. Rows: [name, es|0, zh|0, cc, lat, lon, minZoom, region].
export async function fetchPlaces() {
  const res = await fetch(new URL('../data/places.json', import.meta.url));
  if (!res.ok) throw new Error(`places ${res.status}`);
  return (await res.json()).map(([name, es, zh, cc, lat, lon, minZoom, region]) => ({
    name, es: es || undefined, zh: zh || undefined, cc, lat, lon, minZoom, region,
  }));
}

// ---- High resolution radar: North America ----

// Environment and Climate Change Canada's 1 km radar mosaic covers Canada
// and the U.S. (it includes NOAA's NEXRAD radars) every 6 minutes. Rain and
// snow are separate layers, and the server draws one per request, so each
// frame stacks two images. NOAA nowCOAST (U.S. only) is the fallback.
const GEOMET = 'https://geo.weather.gc.ca/geomet';
export const NA_RADAR_BOX = { w: -170.32, s: 16.93, e: -50, n: 67.19 };

async function fetchEcccRadar(minutes = 120, stepMin = 12) {
  const res = await fetch(`${GEOMET}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0&LAYERS=RADAR_1KM_RRAI`);
  if (!res.ok) throw new Error(`GeoMet ${res.status}`);
  const dim = (await res.text()).match(/<Dimension name="time"[^>]*>([^<]+)</)?.[1];
  if (!dim) throw new Error('No radar times');
  // "start/end/PT6M": step back from the newest scan.
  const end = Date.parse(dim.split(',').pop().split('/')[1] ?? dim.split(',').pop());
  if (Number.isNaN(end)) throw new Error('Bad radar times');
  const count = Math.floor(minutes / stepMin) + 1;
  const frames = Array.from({ length: count }, (_, k) => {
    const time = new Date(end - (count - 1 - k) * stepMin * 60e3);
    const urlFor = ({ w, s, e, n }, W, H) => ['RADAR_1KM_RRAI', 'RADAR_1KM_RSNO'].map(layer =>
      `${GEOMET}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layer}&STYLES=&CRS=EPSG:4326`
      + `&BBOX=${s},${w},${n},${e}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/png&TRANSPARENT=TRUE&TIME=${iso(time)}`);
    return { time, urlFor, url: urlFor(NA_RADAR_BOX, 3072, 1284) };
  });
  return { frames, box: NA_RADAR_BOX, native: 0.01 }; // 1 km mosaic
}

export async function fetchHiResRadar() {
  try { return await fetchEcccRadar(); } catch { return fetchRadarFrames(); }
}
