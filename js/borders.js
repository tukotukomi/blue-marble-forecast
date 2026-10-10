// Country and state/province lines on the globe (Natural Earth, public
// domain; built into data/borders.json by tools/build-borders.mjs).
//
// Drawn as real 3D lines a few kilometres above the surface rather than
// painted into a texture, so they stay sharp at every zoom. three.js's "fat"
// lines are used because plain WebGL lines are one device pixel wide, which
// is all but invisible on a phone. Loaded only once the layer is switched on.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { toVec } from './globe.js';

const LIFT = 1.0008;  // clears the facets of the 160x80 Earth mesh
const STEP = 0.5;     // degrees: long straight runs (e.g. the 49th parallel)
                      // are split so they follow the surface, not a chord

// Decode one data/borders.json line list into segment endpoint positions.
function positions(lines) {
  const out = [];
  const push = (lon, lat) => { const v = toVec(lat, lon, LIFT); out.push(v.x, v.y, v.z); };
  for (const l of lines) {
    let lon = l[0] / 100, lat = l[1] / 100;
    for (let i = 2; i < l.length; i += 2) {
      const lon2 = lon + l[i] / 100, lat2 = lat + l[i + 1] / 100;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(lon2 - lon), Math.abs(lat2 - lat)) / STEP));
      for (let k = 0; k < n; k++) {
        push(lon + (lon2 - lon) * k / n, lat + (lat2 - lat) * k / n);
        push(lon + (lon2 - lon) * (k + 1) / n, lat + (lat2 - lat) * (k + 1) / n);
      }
      lon = lon2; lat = lat2;
    }
  }
  return new Float32Array(out);
}

function lineSet(lines, { width, color, dashed = false }) {
  const geo = new LineSegmentsGeometry().setPositions(positions(lines));
  const mat = new LineMaterial({
    color, linewidth: width, transparent: true, depthWrite: false,
    dashed, dashSize: 0.004, gapSize: 0.003,
  });
  const mesh = new LineSegments2(geo, mat);
  if (dashed) mesh.computeLineDistances();
  mesh.renderOrder = 1; // after the Earth, before the labels' DOM layer
  return mesh;
}

export async function createBorders(url) {
  const data = await (await fetch(url)).json();
  const group = new THREE.Group();
  const sets = {
    state: lineSet(data.state, { width: 1, color: 0xffffff }),
    disputed: lineSet(data.disputed, { width: 1.5, color: 0xffffff, dashed: true }),
    country: lineSet(data.country, { width: 1.5, color: 0xffffff }),
  };
  for (const m of Object.values(sets)) group.add(m);
  return {
    group,
    // Called each redraw: canvas size in CSS pixels and camera distance in
    // Earth radii. Country lines soften when the whole globe is in view;
    // state lines appear only once zoomed in to a continent or closer.
    update(w, h, dist) {
      const near = THREE.MathUtils.clamp((2.6 - dist) / 1.2, 0, 1);
      sets.country.material.opacity = 0.45 + 0.3 * near;
      sets.disputed.material.opacity = 0.35 + 0.25 * near;
      sets.state.material.opacity = 0.4 * THREE.MathUtils.clamp((2.2 - dist) / 0.6, 0, 1);
      sets.state.visible = sets.state.material.opacity > 0.01;
      for (const m of Object.values(sets)) m.material.resolution.set(w, h);
    },
  };
}
