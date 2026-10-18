// The 3D Earth that sits behind every screen, like the original channel's globe.
//
// Imagery (all public-domain NASA products):
//   - Blue Marble: Next Generation  -> daytime surface (img/, see below)
//   - VIIRS Black Marble            -> night-side city lights (img/)
//   - GPM IMERG precipitation rate  -> animated rain/snow overlay (30-minute steps)
// plus NOAA's live U.S. radar mosaic (nowCOAST). Both animate via frames.js;
// the frame lists come from data.js.
//
// The day/night terminator, stars and constellations are placed from the real
// sun position and sidereal time, so the globe matches the actual sky "now".

import * as THREE from 'three';
import { FrameLayer, FrameSync } from './frames.js';
import { RADAR_BOX } from './data.js';
import { CONSTELLATIONS, PLANETS, planetPositions, moonPosition } from './sky.js';

// The base imagery ships with the site (tools/fetch-earth.mjs). NASA GIBS
// renders whole-Earth images on request, which took 4-5 seconds at this size;
// static copies arrive at once. A small copy draws the globe first and the
// sharp one replaces it (index.html preloads the small ones).
const img = file => new URL(`../img/${file}`, import.meta.url).href;
export const IMAGERY = {
  day: [img('earth-day-1024.jpg'), img('earth-day-4096.jpg')],
  night: [img('earth-night-1024.jpg'), img('earth-night-4096.jpg')],
};

const D2R = Math.PI / 180;

// Earth-fixed unit vector for a lat/lon, matching three.js sphere UVs.
export function toVec(lat, lon, r = 1) {
  const la = lat * D2R, lo = lon * D2R;
  return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

// Low-precision solar ephemeris (good to ~0.01 deg) + Greenwich sidereal time.
function astro(date = new Date()) {
  const n = date.getTime() / 864e5 + 2440587.5 - 2451545.0;
  const L = 280.46 + 0.9856474 * n, g = (357.528 + 0.9856003 * n) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 4e-7 * n) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / D2R;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam)) / D2R;
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;
  return { sunLat: dec, sunLon: ra - gmst, gmst };
}


const VERT = `
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vUv = uv; vN = normalize(normal);
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = `
uniform sampler2D dayTex, nightTex, satA, satB, radA, radB, rad2A, rad2B, rad3A, rad3B, fcstA, fcstB, detailDay, detailNight;
uniform vec3 sunDir; uniform float uNight, uSat, satMix, uRad, radMix, uRad2, rad2Mix, uRad3, rad3Mix, uFcst, fcstMix, uDetail, uGrain;
// Image patches as (west, south, width, height) in degrees. West may be any
// longitude, so a patch can straddle the date line.
uniform vec4 satBox, radBox, rad2Box, rad3Box, fcstBox, detailBox;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
vec2 boxUv(vec2 ll, vec4 box) {
  return vec2(mod(ll.x - box.x + 360.0, 360.0) / box.z, (ll.y - box.y) / box.w);
}
float inside(vec2 uv) { return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }

// Smooth (cubic B-spline) texture filtering in 4 bilinear taps, so rain and
// radar images upscale into soft shapes instead of visible pixel blocks.
vec4 cubicW(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 c = n * n * n;
  float x = c.x, y = c.y - 4.0 * c.x, z = c.z - 4.0 * c.y + 6.0 * c.x;
  return vec4(x, y, z, 6.0 - x - y - z) / 6.0;
}
vec4 smoothTex(sampler2D tex, vec2 uv) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 p = uv * size - 0.5;
  vec2 fr = fract(p);
  p -= fr;
  vec4 xc = cubicW(fr.x), yc = cubicW(fr.y);
  vec4 c = p.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 w = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (c + vec4(xc.yw, yc.yw) / w) / size.xxyy;
  float sx = w.x / (w.x + w.y), sy = w.z / (w.z + w.w);
  return mix(mix(texture2D(tex, o.yw), texture2D(tex, o.xw), sx), mix(texture2D(tex, o.yz), texture2D(tex, o.xz), sx), sy);
}
// One animated overlay: cross-fade two frames, smooth them, then turn the
// blurred coverage into a clean contour. Frames are uploaded with
// premultiplied alpha so edges don't pick up dark fringes.
// Value noise for ragged rain edges up close (purely cosmetic: the data is
// ~3-11 km per cell, so smooth edges would look like plastic blobs).
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Radar images carry a faint alpha floor (COVERAGE in recolour.js) wherever
// their radars can see, even where it's dry. It's taken off before drawing,
// and covered() reads it so a radar hides the layers beneath only where it
// really covers rather than across its whole rectangle.
const float COV = 4.0 / 255.0;
vec4 overlay(sampler2D a, sampler2D b, vec2 uv, float m, float grain) {
  vec4 c = mix(smoothTex(a, uv), smoothTex(b, uv), m);
  float rain = max(c.a - COV, 0.0) / (1.0 - COV);
  return vec4(c.rgb / max(c.a, 0.001), smoothstep(0.12 + grain, 0.6 + grain, rain));
}
float covered(sampler2D a, sampler2D b, vec2 uv, float m, float inBox) {
  if (inBox <= 0.0) return 0.0;
  return smoothstep(COV * 0.3, COV * 0.85, mix(texture2D(a, uv).a, texture2D(b, uv).a, m)) * inBox;
}
void main() {
  vec3 n = normalize(vN);
  float d = dot(n, sunDir);
  vec2 ll = vec2(vUv.x * 360.0 - 180.0, vUv.y * 180.0 - 90.0);
  vec3 day = texture2D(dayTex, vUv).rgb;
  vec3 night = texture2D(nightTex, vUv).rgb;
  // Sharper imagery for the area in view when zoomed in close.
  vec2 duv = boxUv(ll, detailBox);
  float dIn = inside(duv) * uDetail;
  day = mix(day, texture2D(detailDay, duv).rgb, dIn);
  night = mix(night, texture2D(detailNight, duv).rgb, dIn);
  // City lights read best slightly boosted and warmed up.
  night = pow(night, vec3(1.15)) * vec3(1.5, 1.35, 1.1) + vec3(0.004, 0.008, 0.02);
  float lit = smoothstep(-0.10, 0.14, d);
  vec3 dayLit = day * (0.62 + 0.38 * clamp(d * 1.6, 0.0, 1.0));
  vec3 col = mix(day * 0.95, mix(night, dayLit, lit), uNight);
  // Warm glow along the terminator.
  col += uNight * vec3(0.22, 0.09, 0.03) * exp(-pow((d - 0.02) * 9.0, 2.0)) * 0.5;
  // Precipitation, back to front: satellite rain (global), live radar (its
  // own box), then the 12-hour forecast (a box around the viewed place).
  // Each radar replaces the layers beneath it where its radars can see.
  // Radar areas on the same switch: North America, Germany, Europe (OPERA).
  vec2 ruv = boxUv(ll, radBox);
  float rIn = inside(ruv) * uRad;
  vec2 r2uv = boxUv(ll, rad2Box);
  float r2In = inside(r2uv) * uRad2;
  vec2 r3uv = boxUv(ll, rad3Box);
  float r3In = inside(r3uv) * uRad3;
  vec2 fuv = boxUv(ll, fcstBox);
  float fIn = inside(fuv) * uFcst;
  // Edge roughness in degrees-space (~3 km and ~1 km features), faded in with zoom.
  float grain = uGrain > 0.0 ? (vnoise(ll * 36.0) * 0.65 + vnoise(ll * 110.0) * 0.35 - 0.5) * 0.3 * uGrain : 0.0;
  // Where each radar actually sees (0 outside its range, even inside its box).
  float rCov = covered(radA, radB, ruv, radMix, rIn);
  float r2Cov = covered(rad2A, rad2B, r2uv, rad2Mix, r2In);
  float r3Cov = covered(rad3A, rad3B, r3uv, rad3Mix, r3In);
  vec2 suv = boxUv(ll, satBox);
  float sIn = inside(suv) * uSat;
  if (sIn > 0.0) {
    vec4 o = overlay(satA, satB, suv, satMix, grain);
    col = mix(col, o.rgb, o.a * sIn * (1.0 - rCov) * (1.0 - r2Cov) * (1.0 - r3Cov) * (1.0 - fIn) * 0.85);
  }
  if (rIn > 0.0) {
    vec4 o = overlay(radA, radB, ruv, radMix, grain);
    col = mix(col, o.rgb, o.a * rIn * (1.0 - fIn) * 0.9);
  }
  // Europe-wide OPERA under Germany's own radar (which wins where it's on).
  if (r3In > 0.0) {
    vec4 o = overlay(rad3A, rad3B, r3uv, rad3Mix, grain);
    col = mix(col, o.rgb, o.a * r3In * (1.0 - r2Cov) * (1.0 - fIn) * 0.9);
  }
  if (r2In > 0.0) {
    vec4 o = overlay(rad2A, rad2B, r2uv, rad2Mix, grain);
    col = mix(col, o.rgb, o.a * r2In * (1.0 - fIn) * 0.9);
  }
  if (fIn > 0.0) {
    vec4 o = overlay(fcstA, fcstB, fuv, fcstMix, grain);
    col = mix(col, o.rgb, o.a * fIn * 0.9);
  }
  // Atmospheric rim.
  vec3 v = normalize(cameraPosition - vW);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += vec3(0.30, 0.55, 1.0) * rim * (0.35 + 0.65 * mix(1.0, lit, uNight));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const ATMO_FRAG = `
varying vec3 vN; varying vec3 vW;
void main() {
  vec3 v = normalize(cameraPosition - vW);
  float i = pow(clamp(0.72 + dot(normalize(vN), v), 0.0, 1.0), 5.0);
  gl_FragColor = vec4(0.35, 0.62, 1.0, 1.0) * i * 1.2;
}`;
const ATMO_VERT = `
varying vec3 vN; varying vec3 vW;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

function blankTex(rgba) {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
  t.needsUpdate = true;
  return t;
}

export function createGlobe(host, { labelLayer, onPick, onTap, onDrag, onLayerFrame, onLabelClick, onNeedWeather, onViewSettled, renderLabel, skyName = key => key, safeArea = () => ({ top: 0, bottom: 0 }) }) {
  // Set whenever the scene needs a redraw; see the main loop below.
  let dirty = true;
  const invalidate = () => { dirty = true; };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    host.classList.add('no-webgl');
    return null;
  }
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 200);

  // --- Earth ---
  const loader = new THREE.TextureLoader().setCrossOrigin('anonymous');
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const uniforms = {
    dayTex: { value: blankTex([24, 52, 96, 255]) },
    nightTex: { value: blankTex([4, 8, 20, 255]) },
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
    uNight: { value: 1 },
    uSat: { value: 0 }, satMix: { value: 0 }, satA: { value: null }, satB: { value: null },
    satBox: { value: new THREE.Vector4(-180, -90, 360, 180) },
    uRad: { value: 0 }, radMix: { value: 0 }, radA: { value: null }, radB: { value: null },
    radBox: { value: new THREE.Vector4(RADAR_BOX.w, RADAR_BOX.s, RADAR_BOX.e - RADAR_BOX.w, RADAR_BOX.n - RADAR_BOX.s) },
    uRad2: { value: 0 }, rad2Mix: { value: 0 }, rad2A: { value: null }, rad2B: { value: null },
    rad2Box: { value: new THREE.Vector4(0, 0, 1, 1) },
    uRad3: { value: 0 }, rad3Mix: { value: 0 }, rad3A: { value: null }, rad3B: { value: null },
    rad3Box: { value: new THREE.Vector4(0, 0, 1, 1) },
    uFcst: { value: 0 }, fcstMix: { value: 0 }, fcstA: { value: null }, fcstB: { value: null },
    fcstBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    uDetail: { value: 0 }, detailDay: { value: null }, detailNight: { value: null },
    uGrain: { value: 0 },
    detailBox: { value: new THREE.Vector4(0, 0, 1, 1) },
  };
  function load(url, uniform) {
    return new Promise(resolve => loader.load(url, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = aniso;
      uniforms[uniform].value.dispose();
      uniforms[uniform].value = tex;
      invalidate();
      resolve(true);
    }, undefined, () => resolve(false)));
  }
  // The globe is shown as soon as the small day image is in. The sharp
  // copies start only after both small ones, so they never delay that.
  const smallDay = load(IMAGERY.day[0], 'dayTex');
  const smallNight = load(IMAGERY.night[0], 'nightTex');
  const ready = smallDay;
  Promise.all([smallDay, smallNight]).then(() => {
    load(IMAGERY.day[1], 'dayTex');
    load(IMAGERY.night[1], 'nightTex');
  });

  // Animated precipitation layers (frames.js). The app supplies the frame lists.
  // Animation frames waiting to go to the GPU, sent at most one per drawn
  // frame so several layers never upload together (each is a large image).
  // upload() resolves once that texture is on the GPU.
  const uploads = new Map();
  const upload = tex => new Promise(resolve => {
    uploads.get(tex)?.();
    uploads.set(tex, resolve);
    invalidate();
  });
  function uploadOne() {
    const [tex, resolve] = uploads.entries().next().value ?? [];
    if (!tex) return;
    uploads.delete(tex);
    if (!tex.userData.disposed) renderer.initTexture(tex);
    resolve();
  }
  const anims = {
    sat: new FrameLayer({ onChange: invalidate, upload, onFrame: (i, n, time) => onLayerFrame?.('sat', i, n, time) }),
    radar: new FrameLayer({ onChange: invalidate, upload, onFrame: (i, n, time) => onLayerFrame?.('radar', i, n, time) }),
    radar2: new FrameLayer({ onChange: invalidate, upload, onFrame: (i, n, time) => onLayerFrame?.('radar2', i, n, time) }),
    radar3: new FrameLayer({ onChange: invalidate, upload, onFrame: (i, n, time) => onLayerFrame?.('radar3', i, n, time) }),
    fcst: new FrameLayer({ forward: true, onChange: invalidate, upload, onFrame: (i, n, time) => onLayerFrame?.('fcst', i, n, time) }),
  };
  // Observations share one clock (see FrameSync); the forecast keeps its own.
  const sync = new FrameSync({ sat: anims.sat, radar: anims.radar, radar2: anims.radar2, radar3: anims.radar3 },
    name => !!uniforms[ANIM_UNIFORMS[name][0]].value);
  const ANIM_UNIFORMS = {
    sat: ['uSat', 'satA', 'satB', 'satMix'],
    radar: ['uRad', 'radA', 'radB', 'radMix'],
    radar2: ['uRad2', 'rad2A', 'rad2B', 'rad2Mix'],
    radar3: ['uRad3', 'rad3A', 'rad3B', 'rad3Mix'],
    fcst: ['uFcst', 'fcstA', 'fcstB', 'fcstMix'],
  };
  function bindAnims() {
    for (const [k, layer] of Object.entries(anims)) {
      const [, a, b, m] = ANIM_UNIFORMS[k];
      uniforms[a].value = layer.texA; uniforms[b].value = layer.texB; uniforms[m].value = layer.mix;
      const box = layer.box, u = uniforms[{ sat: 'satBox', radar: 'radBox', radar2: 'rad2Box', radar3: 'rad3Box', fcst: 'fcstBox' }[k]];
      if (box) u.value.set(box.w, box.s, box.e - box.w, box.n - box.s);
    }
  }
  bindAnims();

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 160, 80),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG })
  );
  scene.add(earth);

  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1.12, 64, 32),
    new THREE.ShaderMaterial({ vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })
  );
  scene.add(atmo);

  // --- Sky: random field, constellations and the planets (sky.js) ---
  const sky = new THREE.Group();
  scene.add(sky);
  {
    const N = 2600, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(80);
      pos.set([v.x, v.y, v.z], i * 3);
      const b = 0.35 + Math.random() ** 3 * 0.65, warm = Math.random();
      col.set([b * (0.85 + warm * 0.15), b * 0.9, b * (1.05 - warm * 0.2)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    sky.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, sizeAttenuation: true, transparent: true, depthWrite: false })));
  }
  const constMat = new THREE.LineBasicMaterial({ color: 0x9cc8ff, transparent: true, opacity: 0, depthWrite: false });
  const constStarMat = new THREE.PointsMaterial({ size: 0.75, color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
  const constGroup = new THREE.Group();
  sky.add(constGroup);
  // A soft round dot for the planets.
  const glow = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, '#fff'); g.addColorStop(0.28, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const planetMats = Object.fromEntries(Object.entries(PLANETS).map(([k, p]) =>
    [k, new THREE.PointsMaterial({ size: p.size, map: glow, color: p.color, transparent: true, depthWrite: false })]));
  // Names of the constellations and planets, which fade in as you zoom out
  // (and hide with the City labels switch). Text sprites are cached by name.
  const nameMats = new Map();
  let skyNames = true, skyNameOpacity = 0;
  function nameSprite(text, planet) {
    const id = `${text}|${planet}`;
    if (!nameMats.has(id)) {
      const c = document.createElement('canvas'), x = c.getContext('2d');
      const font = `${planet ? 700 : 600} 34px system-ui, sans-serif`;
      x.font = font;
      c.width = Math.ceil(x.measureText(text).width) + 16; c.height = 48;
      x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = planet ? '#ffe9c8' : '#a9cfff';
      x.shadowColor = 'rgba(0,0,0,0.8)'; x.shadowBlur = 6;
      x.fillText(text, c.width / 2, 25);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      nameMats.set(id, { mat: new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }), aspect: c.width / c.height });
    }
    const { mat, aspect } = nameMats.get(id);
    const sp = new THREE.Sprite(mat);
    const h = planet ? 1.5 : 1.3;
    sp.scale.set(h * aspect, h, 1);
    return sp;
  }
  let lastGmst = 0;
  function placeSky(gmst = lastGmst) {
    lastGmst = gmst;
    for (const o of constGroup.children) o.geometry?.dispose?.(); // sprites share theirs
    constGroup.clear();
    for (const [key, c] of Object.entries(CONSTELLATIONS)) {
      const pts = c.stars.map(([ra, dec]) => toVec(dec, ra * 15 - gmst, 78));
      constGroup.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), constStarMat));
      const seg = c.lines.flatMap(([a, b]) => [pts[a], pts[b]]);
      if (seg.length) constGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), constMat));
      // The name sits just below the constellation's lowest star.
      const mid = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).normalize();
      const low = Math.min(...c.stars.map(([, dec]) => dec));
      const ra = Math.atan2(-mid.z, mid.x) / D2R;
      const name = nameSprite(skyName(key), false);
      name.position.copy(toVec(low - 3.2, ra, 77));
      constGroup.add(name);
    }
    for (const [key, { ra, dec }] of Object.entries(planetPositions())) {
      const p = toVec(dec, ra * 15 - gmst, 77.5);
      constGroup.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints([p]), planetMats[key]));
      const name = nameSprite(skyName(key), true);
      name.position.copy(toVec(dec - 2.4, ra * 15 - gmst, 77));
      constGroup.add(name);
    }
  }
  // New language: rebuild the names.
  function renameSky() {
    for (const { mat } of nameMats.values()) { mat.map.dispose(); mat.dispose(); }
    nameMats.clear();
    placeSky();
    scene.remove(moonName);
    moonName = nameSprite(skyName('moon'), true);
    scene.add(moonName);
    placeMoon(lastGmst);
    skyNameOpacity = -1; // the new names start hidden: fade them back in
    invalidate();
  }

  // The Moon: a sphere lit by the same Sun as the Earth, so its phase is
  // right from wherever you look and its bright side points at the Sun. It
  // sits at its real distance (60 Earth radii) but is drawn 4 times its
  // size, so the phase reads when zoomed out. The near side faces the Earth.
  const MOON_DIST = 60, MOON_R = 0.273 * 4;
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_R, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: { sunDir: uniforms.sunDir },
      vertexShader: `
        varying vec3 vN, vObj;
        void main() {
          vObj = normalize(position);
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 sunDir;
        varying vec3 vN, vObj;
        // A dark sea (mare) centred at selenographic lat/lon, radius in degrees.
        float mare(float lat, float lon, float rad, vec2 p) {
          vec2 d = vec2((p.y - lon) * cos(radians(lat)), p.x - lat);
          return 1.0 - smoothstep(rad * 0.55, rad, length(d));
        }
        void main() {
          // Selenographic coordinates: +z faces the Earth, east to the right.
          vec2 p = vec2(degrees(asin(vObj.y)), degrees(atan(vObj.x, vObj.z)));
          float sea = 0.0;
          sea = max(sea, mare(33.0, -16.0, 18.0, p));  // Imbrium
          sea = max(sea, mare(28.0, 17.0, 11.0, p));   // Serenitatis
          sea = max(sea, mare(8.0, 31.0, 12.0, p));    // Tranquillitatis
          sea = max(sea, mare(17.0, 59.0, 8.0, p));    // Crisium
          sea = max(sea, mare(-8.0, 51.0, 9.0, p));    // Fecunditatis
          sea = max(sea, mare(-15.0, 35.0, 6.0, p));   // Nectaris
          sea = max(sea, mare(-21.0, -17.0, 9.0, p));  // Nubium
          sea = max(sea, mare(15.0, -57.0, 22.0, p));  // Procellarum
          sea = max(sea, mare(-24.0, -39.0, 7.0, p));  // Humorum
          sea = max(sea, mare(56.0, 5.0, 7.0, p));     // Frigoris
          float tycho = mare(-43.0, -11.0, 3.0, p);
          vec3 albedo = mix(vec3(0.78, 0.77, 0.74), vec3(0.42, 0.42, 0.44), sea * 0.85) + tycho * 0.12;
          float lit = smoothstep(-0.03, 0.12, dot(normalize(vN), sunDir));
          // A faint earthshine keeps the dark side just visible.
          gl_FragColor = vec4(albedo * (0.035 + lit * 1.05), 1.0);
        }`,
    })
  );
  scene.add(moon);
  // The Sun: a glow far out in its real direction (the Earth hides it when
  // it's behind), so you can always tell where the light comes from.
  const sunGlow = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,250,1)'); g.addColorStop(0.09, 'rgba(255,250,225,1)'); g.addColorStop(0.16, 'rgba(255,225,160,0.55)');
    g.addColorStop(0.45, 'rgba(255,200,120,0.12)'); g.addColorStop(1, 'rgba(255,190,110,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sp.scale.set(16, 16, 1);
    return sp;
  })();
  scene.add(sunGlow);
  function placeMoon(gmst) {
    const m = moonPosition();
    moon.position.copy(toVec(m.dec, m.ra * 15 - gmst, MOON_DIST));
    moon.lookAt(0, 0, 0);
    moonName.position.copy(toVec(m.dec - 2.2, m.ra * 15 - gmst, MOON_DIST));
  }
  let moonName = nameSprite(skyName('moon'), true);
  scene.add(moonName);

  function updateSun() {
    const a = astro();
    uniforms.sunDir.value.copy(toVec(a.sunLat, a.sunLon));
    sunGlow.position.copy(uniforms.sunDir.value).multiplyScalar(74);
    placeSky(a.gmst);
    placeMoon(a.gmst);
    invalidate();
    return a;
  }
  updateSun();
  setInterval(updateSun, 60e3);

  // --- Camera rig: spherical coordinates around the Earth ---
  const cam = { lat: 20, lon: -40, dist: 3.4 };
  const vel = { lat: 0, lon: 0 };
  let anim = null;           // camera fly-to animation
  let mode = 'intro';
  let lastInteract = 0;
  let offset = { x: 0, y: 0 }, offsetTarget = { x: 0, y: 0 };
  // min ~220 km above the surface: as close as the 500 m imagery stays sharp.
  const LIMITS = { min: 1.035, max: 6 };
  // Zoom works on altitude (dist - 1), so each step feels the same up close
  // and far away.
  const zoomBy = factor => { cam.dist = THREE.MathUtils.clamp(1 + (cam.dist - 1) * factor, LIMITS.min, LIMITS.max); };

  // On portrait phones the narrow horizontal field of view is what clips the
  // Earth, so the overview distances are pushed back until it fits the width.
  function portraitFit() {
    const aspect = host.clientWidth / Math.max(1, host.clientHeight);
    if (aspect >= 1) return 0;
    const halfH = Math.atan(Math.tan(camera.fov * D2R / 2) * aspect);
    const fit = 1.06 / Math.sin(halfH);
    LIMITS.max = Math.max(6, fit * 1.25);
    return fit;
  }

  // Camera distance that shows about `km` of ground across the screen width
  // (flat-ground approximation, fine at city-to-region scales).
  function distForWidth(km) {
    const halfW = Math.atan(Math.tan(camera.fov * D2R / 2) * (host.clientWidth / Math.max(1, host.clientHeight)));
    return THREE.MathUtils.clamp(1 + (km / 6371) / (2 * Math.tan(halfW)), LIMITS.min, LIMITS.max);
  }

  // Country and state lines (borders.js), loaded the first time they're shown.
  const borders = { on: false, lines: null, loading: null };
  function showBorders(on) {
    borders.on = on;
    if (borders.lines) borders.lines.group.visible = on;
    else if (on && !borders.loading) {
      borders.loading = import('./borders.js')
        .then(m => m.createBorders(new URL('../data/borders.json', import.meta.url)))
        .then(lines => {
          borders.lines = lines;
          lines.group.visible = borders.on;
          scene.add(lines.group);
          invalidate();
        })
        .catch(() => { borders.loading = null; });
    }
    invalidate();
  }

  // Calm View's planet horizon: a wider lens from low orbit, south of the
  // place and looking across it, so the Earth's edge curves across the screen
  // at HORIZON of its height with the place just below it. The planet is made
  // a little wider than the screen, whatever its shape.
  const FOV = 35, HORIZON_FOV = 55;
  const HORIZON = 0.56; // Calm View's sky (calm.js) fades out at the same height
  function setLens(fov) {
    if (camera.fov === fov) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    invalidate();
  }
  function horizonView(lat, lon, ms = 1800) {
    const w = host.clientWidth, h = host.clientHeight;
    setLens(HORIZON_FOV);
    const halfV = (HORIZON_FOV * D2R) / 2, halfW = Math.atan(Math.tan(halfV) * (w / Math.max(1, h)));
    const limb = THREE.MathUtils.clamp(halfW * 1.35, 18 * D2R, 50 * D2R); // the planet's edge, seen from the camera
    const dist = 1 / Math.sin(limb);
    const back = (Math.acos(1 / dist) * 0.45) / D2R; // degrees south of the place to sit
    // The edge is `limb` above the view's centre; shift the picture so it
    // lands at HORIZON of the height.
    const edgeAboveCentre = (Math.tan(limb) / Math.tan(halfV)) * (h / 2);
    offsetTarget = { x: 0, y: h / 2 - (HORIZON * h + edgeAboveCentre) };
    flyTo(THREE.MathUtils.clamp(lat - back, -85, 85), lon, dist, ms);
  }

  function flyTo(lat, lon, dist, ms = 1600) {
    let dLon = ((lon - cam.lon + 540) % 360) - 180;
    anim = { from: { ...cam }, to: { lat, lon: cam.lon + dLon, dist }, t0: performance.now(), ms };
    vel.lat = vel.lon = 0;
  }

  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

  // --- Pointer input (drag rotate, wheel / pinch zoom, tap to pick) ---
  const el = renderer.domElement;
  const pointers = new Map();
  let down = null, pinch0 = 0;
  // The Earth can be dragged and zoomed on every screen (anywhere outside the
  // windows); only the opening screen keeps it to itself.
  const interactive = () => mode !== 'intro';

  el.addEventListener('pointerdown', e => {
    if (!interactive()) return;
    onDrag?.();
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    down = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
    }
    anim = null; lastInteract = performance.now();
  });
  el.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInteract = performance.now();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0) zoomBy(pinch0 / d);
      pinch0 = d;
      if (down) down.moved = 99;
      return;
    }
    if (down) down.moved += Math.abs(dx) + Math.abs(dy);
    // Degrees per pixel shrink with altitude so the ground tracks the finger.
    const k = (cam.dist - 1) * 0.1 + 0.0008;
    vel.lon = -dx * k; vel.lat = dy * k;
    cam.lon += vel.lon; cam.lat = THREE.MathUtils.clamp(cam.lat + vel.lat, -85, 85);
  });
  const up = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    pinch0 = 0;
    if (down && down.moved < 6 && pointers.size === 0 && performance.now() - down.t < 500) {
      vel.lat = vel.lon = 0;
      // onTap returning true means the app used the tap for something else.
      const hit = !onTap?.() && pick(e.clientX, e.clientY);
      if (hit) onPick?.(hit.lat, hit.lon, e.clientX, e.clientY);
    }
    if (pointers.size === 0) down = null;
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', e => {
    if (!interactive()) return;
    e.preventDefault();
    anim = null; lastInteract = performance.now();
    zoomBy(Math.exp(e.deltaY * 0.0016));
  }, { passive: false });

  const raycaster = new THREE.Raycaster();
  function pick(x, y) {
    const r = el.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
    const hit = raycaster.intersectObject(earth)[0];
    if (!hit) return null;
    const p = hit.point.normalize();
    return { lat: Math.asin(p.y) / D2R, lon: Math.atan2(-p.z, p.x) / D2R };
  }

  // --- HTML labels pinned to the surface ---
  // Items: { lat, lon, name, minZoom, home?, wx? }. The DOM button for a
  // label is only created the first time it is placed on screen, so thousands
  // of cities cost nothing until you zoom in on them.
  let markers = [];
  // City labels switched off (the "City labels" layer), and over Calm View's
  // planet, the place's own label shrinks to just its red dot.
  let cityLabels = true;
  const dotOnly = () => mode === 'horizon' || !cityLabels;
  function setMarkers(items) {
    labelLayer.replaceChildren();
    markers = items.map(item => ({
      item, el: null, vec: toVec(item.lat, item.lon, 1.0004),
      w: 0, h: 0, dirty: true, shown: false, tf: '', op: '', asked: false,
      // Collision size before the label exists: a pill around the name.
      ew: 54 + (item.name?.length || 8) * 6.5, eh: 30,
    }));
    invalidate();
  }
  function element(m) {
    if (!m.el) {
      const b = document.createElement('button');
      b.className = 'g-label' + (m.item.home ? ' is-home' : '') + (m.item.home && dotOnly() ? ' dot-only' : '');
      b.type = 'button';
      b.style.visibility = 'hidden';
      b.style.zIndex = m.item.home ? 5 : 1;
      b.innerHTML = renderLabel(m.item, mode);
      b.addEventListener('click', () => onLabelClick?.(m.item));
      labelLayer.appendChild(b);
      m.el = b;
      m.dirty = true;
    }
    return m.el;
  }
  // Re-render label contents (new weather, units, language or mode). Pass a
  // Set of items to refresh just those.
  function refreshLabels(only) {
    for (const m of markers) {
      if (!m.el || (only && !only.has(m.item))) continue;
      m.el.innerHTML = renderLabel(m.item, mode);
      if (m.item.home) m.el.classList.toggle('dot-only', dotOnly());
      m.dirty = true;
    }
    invalidate();
  }

  // Map-style zoom level for the current altitude: about 3 for the whole
  // globe, ~5 for the regional view and ~8 at the closest zoom. Cities carry
  // the smallest zoom at which they should appear (Natural Earth's MIN_ZOOM).
  const zoomLevel = () => Math.log2(31.1 / Math.max(cam.dist - 1, 0.01)) - 1;

  // Labels are only touched when their position, fade or visibility actually
  // changes: writing hundreds of inline styles every frame was the main cost
  // on the main thread (and made Firefox's compositor animations stutter).
  const tmp = new THREE.Vector3(), camDir = new THREE.Vector3();
  const snap = v => Math.round(v * devicePixelRatio) / devicePixelRatio;
  function show(m, on) {
    if (m.shown === on) return;
    m.shown = on;
    if (m.el) m.el.style.visibility = on ? 'visible' : 'hidden';
  }
  // The Moon on screen, { x, y, r } in pixels, or null when it's off screen or
  // hidden behind the Earth. City labels it would cover are left out.
  const moonRay = new THREE.Ray(), moonHit = new THREE.Vector3(), earthBall = new THREE.Sphere(new THREE.Vector3(), 1);
  function moonOnScreen(w, h) {
    const far = camera.position.distanceTo(moon.position);
    moonRay.set(camera.position, tmp.copy(moon.position).sub(camera.position).normalize());
    if (moonRay.intersectSphere(earthBall, moonHit) && camera.position.distanceTo(moonHit) < far) return null;
    tmp.copy(moon.position).project(camera);
    if (tmp.z > 1 || Math.abs(tmp.x) > 1.3 || Math.abs(tmp.y) > 1.3) return null;
    const r = (Math.tan(Math.asin(MOON_R / far)) / Math.tan((camera.fov * D2R) / 2)) * ((span ? span.H : h) / 2);
    return { x: (tmp.x * 0.5 + 0.5) * w, y: (-tmp.y * 0.5 + 0.5) * h, r: r + 6 };
  }
  const coversBox = (c, b) => Math.hypot(c.x - Math.max(b.l, Math.min(c.x, b.r)), c.y - Math.max(b.t, Math.min(c.y, b.b))) < c.r;

  function layoutLabels(w, h) {
    const moonDisc = moonOnScreen(w, h);
    camDir.copy(camera.position).normalize();
    const placed = [];
    const safe = safeArea();
    const z = zoomLevel();
    const horizon = 1 - 1 / cam.dist;
    const want = [];
    for (const m of markers) {
      const it = m.item;
      // Over Calm View's planet, or with city labels off, only the place's own marker shows.
      let visible = mode !== 'intro' && (it.home || (!dotOnly() && (it.minZoom ?? 0) <= z));
      // 0 at the horizon, 1 directly below the camera.
      const facing = (m.vec.dot(camDir) / m.vec.length() - 1 / cam.dist) / horizon;
      if (facing < 0.03) visible = false;
      if (visible) {
        tmp.copy(m.vec).project(camera);
        const x = (tmp.x * 0.5 + 0.5) * w, y = (-tmp.y * 0.5 + 0.5) * h;
        if (m.el && m.dirty) { m.w = m.el.offsetWidth || m.ew; m.h = m.el.offsetHeight || m.eh; m.dirty = false; }
        const bw = m.el ? m.w : m.ew, bh = m.el ? m.h : m.eh;
        // Pills sit above their spot (the tail points at it); a lone dot sits on it.
        const dot = it.home && dotOnly();
        const box = { l: x - bw / 2, r: x + bw / 2, t: dot ? y - bh / 2 : y - bh, b: dot ? y + bh / 2 : y };
        const off = x < -60 || x > w + 60 || (!it.home && (y - bh < safe.top || y > h - safe.bottom));
        const clash = !off && !it.home && ((moonDisc && coversBox(moonDisc, box)) || placed.some(p => box.l < p.r + 4 && box.r > p.l - 4 && box.t < p.b + 4 && box.b > p.t - 4));
        if (!clash && !off) {
          placed.push(box);
          const el = element(m);
          const tf = `translate(${snap(box.l)}px, ${snap(box.t)}px)`;
          if (tf !== m.tf) { m.tf = tf; el.style.transform = tf; }
          const op = (Math.round(Math.min(1, facing * 4) * 20) / 20).toString();
          if (op !== m.op) { m.op = op; el.style.opacity = op; }
          show(m, true);
          if (!it.home && !it.wx && !m.asked) { m.asked = true; want.push(it); }
          continue;
        }
      }
      show(m, false);
    }
    if (want.length) onNeedWeather?.(want);
  }

  // --- Sharper imagery when zoomed in ---
  // The whole-globe textures are ~10 km per pixel. Closer than DETAIL_DIST the
  // globe asks NASA GIBS for just the area in view, at about screen resolution
  // (Blue Marble and Black Marble are 500 m data), and blends it over the base.
  const DETAIL_DIST = 1.8;
  const PATCH = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&STYLES=&FORMAT=image/jpeg';
  const detail = { box: null, loading: null, movedAt: 0, failedAt: 0 };
  const sphere = new THREE.Sphere(new THREE.Vector3(), 1), hitPt = new THREE.Vector3(), ndc = new THREE.Vector2();
  const wrapLon = x => ((((x % 360) + 540) % 360) - 180);

  // Lat/lon bounds of the visible surface, sampled with a 5x5 grid of rays.
  function viewBox() {
    const lats = [], lons = [], ref = wrapLon(cam.lon);
    for (const x of [-1, -0.5, 0, 0.5, 1]) for (const y of [-1, -0.5, 0, 0.5, 1]) {
      raycaster.setFromCamera(ndc.set(x, y), camera);
      if (!raycaster.ray.intersectSphere(sphere, hitPt)) continue;
      lats.push(Math.asin(THREE.MathUtils.clamp(hitPt.y, -1, 1)) / D2R);
      lons.push(ref + wrapLon(Math.atan2(-hitPt.z, hitPt.x) / D2R - ref));
    }
    if (lats.length < 12) return null; // mostly space in view
    const box = { w: Math.min(...lons), e: Math.max(...lons), s: Math.min(...lats), n: Math.max(...lats) };
    return box.e - box.w > 120 ? null : box; // looking across a pole
  }

  // Is the view inside the patch we have, and is that patch fine enough?
  function covers(box, view) {
    const half = (view.e - view.w) / 2, bc = (box.w + box.e) / 2;
    const c = bc + wrapLon((view.w + view.e) / 2 - bc);
    return c - half >= box.w && c + half <= box.e && view.s >= box.s && view.n <= box.n
      && box.e - box.w < (view.e - view.w) * 3;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function detailTexture(img) {
    const t = new THREE.Texture(img);
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  function requestDetail(view) {
    const mx = (view.e - view.w) * 0.2, my = (view.n - view.s) * 0.2;
    let w = view.w - mx, e = view.e + mx;
    const s = Math.max(-90, view.s - my), n = Math.min(90, view.n + my);
    // WMS can't wrap the date line, so keep the patch on the view's side of it.
    const shift = wrapLon((w + e) / 2) - (w + e) / 2;
    w = Math.max(-180, w + shift); e = Math.min(180, e + shift);
    let W = Math.min(2048, Math.ceil(host.clientWidth * pixelRatio * 1.2));
    let H = Math.round(W * (n - s) / Math.max(1e-6, (e - w) * Math.cos(((s + n) / 2) * D2R)));
    if (H > 2048) { W = Math.round(W * 2048 / H); H = 2048; }
    W = Math.max(64, W); H = Math.max(64, H);
    const url = layer => `${PATCH}&LAYERS=${layer}&BBOX=${s},${w},${n},${e}&WIDTH=${W}&HEIGHT=${H}`;
    const token = detail.loading = {};
    Promise.all([loadImage(url('BlueMarble_NextGeneration')), loadImage(url('VIIRS_Black_Marble'))]).then(([day, night]) => {
      if (detail.loading !== token) return;
      detail.loading = null;
      uniforms.detailDay.value?.dispose();
      uniforms.detailNight.value?.dispose();
      uniforms.detailDay.value = detailTexture(day);
      uniforms.detailNight.value = detailTexture(night);
      uniforms.detailBox.value.set(w, s, e - w, n - s);
      detail.box = { w, e, s, n };
      invalidate();
    }).catch(() => {
      if (detail.loading === token) detail.loading = null;
      detail.failedAt = performance.now();
    });
  }

  // Runs every frame: fades the patch with altitude and, once the camera has
  // rested for a moment, fetches a new patch if the view has moved off it.
  function detailTick(now, dt, moved) {
    if (moved) { detail.movedAt = now; detail.reported = false; }
    // Tell the app once per stop where the camera came to rest, so the
    // precipitation layers can fetch sharper frames for that area.
    if (!detail.reported && !anim && !pointers.size && now - detail.movedAt > 400) {
      detail.reported = true;
      onViewSettled?.(cam.dist < DETAIL_DIST ? viewBox() : null);
    }
    const target = detail.box && cam.dist < DETAIL_DIST + 0.1 ? 1 : 0;
    const u = uniforms.uDetail;
    if (u.value !== target) {
      u.value = target > u.value ? Math.min(target, u.value + dt / 400) : Math.max(target, u.value - dt / 400);
      dirty = true;
    }
    if (cam.dist >= DETAIL_DIST || anim || pointers.size || detail.loading) return;
    if (now - detail.movedAt < 350 || now - detail.failedAt < 5000) return;
    const view = viewBox();
    if (view && !(detail.box && covers(detail.box, view))) requestDetail(view);
  }

  // --- Main loop ---
  // The globe only re-renders when something on screen changes (camera move,
  // fly-to, auto-spin, new texture, resize...). On the forecast screens the
  // camera sits still, so most frames cost nothing at all.
  let lastKey = '';

  // Drop the render resolution on slow GPUs: if frames keep taking longer
  // than ~22 ms, step the pixel ratio down (never below 1).
  let pixelRatio = Math.min(devicePixelRatio, 2);
  let slowFrames = 0;
  renderer.setPixelRatio(pixelRatio);

  // Span all screens (span.js): this window shows one slice of a picture
  // spread over several monitors. { W, H }: the whole picture; { x, y }: this
  // window's top-left corner in it (CSS px). null: the normal single view.
  let span = null;

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = span ? span.W / span.H : w / h;
    camera.updateProjectionMatrix();
    invalidate();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  let lastNow = performance.now();
  let suspended = false; // Calm View covers the globe: skip all drawing
  function frame(now) {
    requestAnimationFrame(frame);
    if (suspended) { lastNow = now; return; }
    // Motion is time-based so speed is the same at 60, 120 or a choppy 40 fps.
    const dt = Math.min(now - lastNow, 100);
    const f = dt / (1000 / 60);
    lastNow = now;
    // Visible precipitation layers advance their loops (and force a redraw while blending).
    for (const [k, layer] of Object.entries(anims)) {
      if (uniforms[ANIM_UNIFORMS[k][0]].value && layer.tick(dt)) dirty = true;
    }
    if (sync.tick(dt)) dirty = true;
    uploadOne();
    bindAnims();
    if (anim) {
      const t = Math.min(1, (now - anim.t0) / anim.ms), e = ease(t);
      // Pull out a little mid-flight so long hops arc over the globe.
      const hop = Math.sin(Math.PI * t) * Math.min(1.2, Math.abs(anim.to.lon - anim.from.lon) / 120);
      cam.lat = anim.from.lat + (anim.to.lat - anim.from.lat) * e;
      cam.lon = anim.from.lon + (anim.to.lon - anim.from.lon) * e;
      cam.dist = anim.from.dist + (anim.to.dist - anim.from.dist) * e + hop;
      if (t >= 1) anim = null;
    } else if (!pointers.size) {
      if (Math.abs(vel.lon) + Math.abs(vel.lat) > 1e-4) {
        cam.lon += vel.lon * f; cam.lat = THREE.MathUtils.clamp(cam.lat + vel.lat * f, -85, 85);
        const decay = 0.93 ** f;
        vel.lon *= decay; vel.lat *= decay;
      }
      const idle = now - lastInteract > 5000;
      // Idle spin, slowed down near the surface so it stays a gentle drift.
      if (mode === 'intro' || (mode === 'globe' && idle)) cam.lon -= 0.035 * Math.min(1, (cam.dist - 1) / 1.9) * f;
    }
    const ease8 = 1 - 0.92 ** f;
    offset.x += (offsetTarget.x - offset.x) * ease8;
    offset.y += (offsetTarget.y - offset.y) * ease8;
    if (Math.abs(offsetTarget.x - offset.x) < 0.2) offset.x = offsetTarget.x;
    if (Math.abs(offsetTarget.y - offset.y) < 0.2) offset.y = offsetTarget.y;

    const w = host.clientWidth, h = host.clientHeight;
    const key = `${cam.lat.toFixed(5)},${cam.lon.toFixed(5)},${cam.dist.toFixed(5)},${offset.x.toFixed(1)},${offset.y.toFixed(1)},${w},${h}`;
    detailTick(now, dt, key !== lastKey);
    if (!dirty && key === lastKey) return;
    dirty = false;
    lastKey = key;

    camera.position.copy(toVec(cam.lat, cam.lon, cam.dist));
    camera.lookAt(0, 0, 0);
    if (span) camera.setViewOffset(span.W, span.H, span.x, span.y, w, h);
    else if (Math.abs(offset.x) > 0.5 || Math.abs(offset.y) > 0.5) camera.setViewOffset(w, h, -offset.x, offset.y, w, h);
    else camera.clearViewOffset();
    constMat.opacity = THREE.MathUtils.clamp((cam.dist - 3) / 2, 0, 0.55);
    const names = skyNames ? THREE.MathUtils.clamp((cam.dist - 3.4) / 1.6, 0, 0.9) : 0;
    if (names !== skyNameOpacity) { skyNameOpacity = names; for (const { mat } of nameMats.values()) mat.opacity = names; }
    // Rain-edge roughness only up close, where it's finer than the data; far
    // out it would be smaller than a pixel and just shimmer.
    uniforms.uGrain.value = THREE.MathUtils.clamp((1.6 - cam.dist) / 0.4, 0, 1);
    borders.lines?.update(w, h, cam.dist);
    renderer.render(scene, camera);
    layoutLabels(w, h);
    adapt(now);
  }

  // CPU time of render() is a poor proxy for GPU load, so judge by the gap
  // between consecutive animated frames instead.
  let prevRender = 0;
  function adapt(now) {
    const gap = now - prevRender;
    prevRender = now;
    if (gap > 100) return; // first frame after an idle spell
    slowFrames = gap > 22 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 45 && pixelRatio > 1) {
      pixelRatio = Math.max(1, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      resize();
      slowFrames = 0;
    }
  }
  requestAnimationFrame(frame);

  return {
    ready,
    flyTo,
    setMarkers,
    refreshLabels,
    renameSky,
    get mode() { return mode; },
    // widthKm (park only): fly in close enough to show about that much ground
    // across the screen, centred on the place instead of nudged north of it.
    setMode(m, { lat, lon, ms, widthKm } = {}) {
      mode = m;
      host.dataset.mode = m;
      if (m === 'horizon') { horizonView(lat ?? cam.lat, lon ?? cam.lon, ms); lastInteract = performance.now(); refreshLabels(); return; }
      setLens(FOV);
      const wide = host.clientWidth > 860;
      // Push the focus point out from under the forecast panel.
      offsetTarget = m === 'park' ? (wide ? { x: host.clientWidth * 0.2, y: 0 } : { x: 0, y: host.clientHeight * 0.22 }) : { x: 0, y: 0 };
      const fit = portraitFit();
      const close = m === 'park' && widthKm;
      const dist = close ? distForWidth(widthKm) : { intro: Math.max(3.4, fit), park: wide ? 2.05 : 2.6, region: 1.32, globe: Math.max(2.9, fit) }[m];
      if (lat != null) flyTo(m === 'park' && !close ? lat - 4 : lat, lon, dist, ms);
      else if (m === 'globe') flyTo(cam.lat, cam.lon, dist, ms ?? 1200);
      lastInteract = performance.now();
      refreshLabels();
    },
    setLayer(name, on) {
      invalidate();
      if (name === 'night') uniforms.uNight.value = on ? 1 : 0;
      if (name === 'borders') showBorders(on);
      if (name === 'labels') { cityLabels = skyNames = on; skyNameOpacity = -1; refreshLabels(); }
      if (name in ANIM_UNIFORMS) uniforms[ANIM_UNIFORMS[name][0]].value = on ? 1 : 0;
      if (name in ANIM_UNIFORMS && name !== 'fcst') sync.refresh();
    },
    // frames: [{ time: Date, url } | { time: Date, image }], oldest first.
    // box: { w, s, e, n } for layers that cover only part of the globe.
    // keepIndex: swap in sharper frames for the same times without restarting the loop.
    setFrames(name, frames, box, { keepIndex = false } = {}) {
      // The box is applied when the first new frame is on screen (see bindAnims).
      return anims[name].setFrames(frames, { keepIndex, box });
    },
    setPlaying(on) { for (const layer of Object.values(anims)) layer.playing = on; sync.playing = on; },
    seek(name, i) {
      const layer = anims[name];
      if (!layer.sync || !layer.frames[i]) return layer.seek(i);
      sync.seekTime(+layer.frames[i].time);
    },
    sunInfo: () => astro(),
    suspend(on) { suspended = on; if (!on) invalidate(); },
    // The shared observation clock: its window and the time on screen (ms).
    clock: () => (sync.step >= 0 && sync.steps.length > 1
      ? { start: sync.steps[0], end: sync.steps.at(-1), now: sync.position() } : null),
    // The same for the forecast's own loop.
    forecastClock() {
      const f = anims.fcst.frames;
      return f.length > 1 && anims.fcst.idx >= 0 ? { start: +f[0].time, end: +f.at(-1).time, now: anims.fcst.position() } : null;
    },
    // Controller input (gamepad.js): spin by screen pixels like a drag, zoom
    // by a factor, and "tap" a screen point.
    pan(dx, dy) {
      if (!interactive()) return;
      const k = (cam.dist - 1) * 0.1 + 0.0008;
      anim = null; vel.lat = vel.lon = 0; lastInteract = performance.now();
      cam.lon -= dx * k; cam.lat = THREE.MathUtils.clamp(cam.lat + dy * k, -85, 85);
    },
    zoom(factor) {
      if (!interactive()) return;
      anim = null; lastInteract = performance.now();
      zoomBy(factor);
    },
    // Span all screens (span.js).
    setSpan(s) {
      const key = s && `${s.W},${s.H},${Math.round(s.x)},${Math.round(s.y)}`;
      if (key === (span && `${span.W},${span.H},${Math.round(span.x)},${Math.round(span.y)}`)) return;
      span = s;
      resize();
    },
    camState: () => ({ lat: cam.lat, lon: cam.lon, dist: cam.dist }),
    // Show what another window's camera shows (and hold off the idle spin).
    follow(c) {
      anim = null; vel.lat = vel.lon = 0;
      cam.lat = c.lat; cam.lon = c.lon; cam.dist = c.dist;
      lastInteract = performance.now();
      invalidate();
    },
    // The radar clock's current step (ms), and jumping to another window's.
    clockStep: () => sync.steps[sync.step] ?? null,
    syncClock(t) {
      if (t != null && sync.steps[sync.step] !== t) { sync.seekTime(t); invalidate(); }
    },
    pickAt(x, y) {
      if (!interactive()) return false;
      const hit = pick(x, y);
      if (hit) onPick?.(hit.lat, hit.lon, x, y);
      return !!hit;
    },
  };
}
