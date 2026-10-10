// All network access lives here. Every source is free and needs no API key:
//
//  - NOAA GFS / HRRR model output (U.S. National Weather Service models),
//    served as JSON by Open-Meteo with `models=gfs_seamless` so every number on
//    the site comes from the same NOAA model run, worldwide.
//  - api.weather.gov  - official NWS forecast text + active alerts (U.S. only).
//  - Copernicus CAMS  - European pollen forecast (EU Earth-observation service).
//  - NASA GIBS        - Blue Marble, Black Marble and IMERG imagery (see globe.js).
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
  const key = 'cities:' + cities.map(c => c.name).join('|');
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
