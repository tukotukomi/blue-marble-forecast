// Regenerates data/borders.json from Natural Earth's public-domain 1:10m
// ne_10m_admin_0_boundary_lines_land.geojson and
// ne_10m_admin_1_states_provinces_lines.geojson
// (github.com/nvkelso/natural-earth-vector).
// Usage: node tools/build-borders.mjs <admin0.geojson> <admin1.geojson> data/borders.json
//
// Output: { country: [...], disputed: [...], state: [...] }, each a list of
// lines. A line is a flat list of integers in hundredths of a degree: the
// first lon, lat pair absolute, then each point as a difference from the last
// (small numbers keep the file small). js/borders.js decodes it.

import fs from 'node:fs';
const [admin0, admin1, out] = process.argv.slice(2);
const TOL = 0.012; // degrees (~1.3 km): about a pixel at the closest zoom

const COUNTRY = ['International boundary (verify)'];
const DISPUTED = ['Disputed (please verify)', 'Line of control (please verify)', 'Indefinite (please verify)', 'Indeterminant frontier'];
const STATE = ['Admin-1 boundary', 'Unrecognized Admin-1 boundary'];

// Douglas-Peucker, with longitude scaled by cos(latitude) so tolerance is even.
function simplify(pts) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const k = Math.cos(((pts[a][1] + pts[b][1]) / 2) * Math.PI / 180);
    const ax = pts[a][0] * k, ay = pts[a][1], bx = pts[b][0] * k, by = pts[b][1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    let best = -1, bd = TOL;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] * k - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function encode(pts) {
  const q = pts.map(([x, y]) => [Math.round(x * 100), Math.round(y * 100)]);
  const flat = [q[0][0], q[0][1]];
  for (let i = 1; i < q.length; i++) {
    const dx = q[i][0] - q[i - 1][0], dy = q[i][1] - q[i - 1][1];
    if (dx || dy) flat.push(dx, dy);
  }
  return flat.length >= 4 ? flat : null;
}

const result = { country: [], disputed: [], state: [] };
function add(file, classes) {
  for (const f of JSON.parse(fs.readFileSync(file, 'utf8')).features) {
    const g = f.geometry, cls = f.properties.FEATURECLA;
    const bucket = Object.entries(classes).find(([, list]) => list.includes(cls))?.[0];
    if (!g || !bucket) continue;
    for (const line of g.type === 'LineString' ? [g.coordinates] : g.coordinates) {
      const enc = encode(simplify(line));
      if (enc) result[bucket].push(enc);
    }
  }
}
add(admin0, { country: COUNTRY, disputed: DISPUTED });
add(admin1, { state: STATE });

fs.writeFileSync(out, JSON.stringify(result));
for (const [k, v] of Object.entries(result)) console.log(k, 'lines', v.length, 'points', v.reduce((s, l) => s + l.length / 2, 0));
console.log('bytes', fs.statSync(out).size);
