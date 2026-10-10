// Regenerates data/places.json from Natural Earth's public-domain
// ne_10m_populated_places.geojson (github.com/nvkelso/natural-earth-vector).
// Usage: node tools/build-places.mjs <places.geojson> js/cities.js data/places.json

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const [src, citiesPath, out] = process.argv.slice(2);
const { CITIES } = await import(pathToFileURL(citiesPath).href);
const near = (a, b) => Math.abs(a.lat - b.lat) < 0.25 && Math.abs(a.lon - b.lon) < 0.25;
const feats = JSON.parse(fs.readFileSync(src, 'utf8')).features;
const r2 = n => Math.round(n * 100) / 100;
const rows = [];
for (const { properties: p } of feats) {
  const name = (p.NAME_EN || p.NAME || '').trim();
  const lat = r2(p.LATITUDE), lon = r2(p.LONGITUDE);
  if (!name || CITIES.some(c => near(c, { lat, lon }))) continue;
  const es = (p.NAME_ES || '').trim(), zh = (p.NAME_ZH || '').trim();
  const cc = /^[A-Z]{2}$/.test(p.ISO_A2) ? p.ISO_A2 : '';
  rows.push([name, es && es !== name ? es : 0, zh && zh !== name ? zh : 0, cc, lat, lon, Math.round((p.MIN_ZOOM ?? 8) * 10) / 10, (p.ADM1NAME || '').trim()]);
}
rows.sort((a, b) => a[6] - b[6]); // most prominent first: label priority
fs.writeFileSync(out, JSON.stringify(rows));
console.log('rows', rows.length, 'bytes', fs.statSync(out).size);
const z = {}; for (const r of rows) { const k = Math.floor(r[6]); z[k] = (z[k] || 0) + 1; } console.log('by minZoom', JSON.stringify(z));
