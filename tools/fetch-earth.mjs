// Downloads the globe's base imagery into img/: NASA Blue Marble (day) and
// Black Marble (city lights at night), public domain, from NASA GIBS.
// Served from the site itself because GIBS renders these sizes on request,
// which took 4-5 seconds before the first byte; the static copies load at once.
// Usage: node tools/fetch-earth.mjs   (run from the repo root)

import fs from 'node:fs';
const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&STYLES=&BBOX=-90,-180,90,180&FORMAT=image/jpeg';
const LAYERS = { day: 'BlueMarble_NextGeneration', night: 'VIIRS_Black_Marble' };
fs.mkdirSync('img', { recursive: true });
for (const [name, layer] of Object.entries(LAYERS)) {
  for (const w of [1024, 4096]) {
    const res = await fetch(`${GIBS}&LAYERS=${layer}&WIDTH=${w}&HEIGHT=${w / 2}`);
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/jpeg')) throw new Error(`${name} ${w}: ${res.status}`);
    const file = `img/earth-${name}-${w}.jpg`;
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log(file, fs.statSync(file).size);
  }
}
