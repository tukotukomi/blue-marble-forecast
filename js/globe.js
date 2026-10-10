// The 3D Earth that sits behind every screen, like the original channel's globe.
//
// Imagery (all public-domain NASA products, streamed from NASA GIBS):
//   - Blue Marble: Next Generation  -> daytime surface
//   - VIIRS Black Marble            -> night-side city lights
//   - GPM IMERG precipitation rate  -> optional rain/snow overlay (latest day)
//
// The day/night terminator, stars and constellations are placed from the real
// sun position and sidereal time, so the globe matches the actual sky "now".

import * as THREE from 'three';

const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&BBOX=-90,-180,90,180&STYLES=';
const gibs = (layer, w, fmt = 'image/jpeg', extra = '') => `${GIBS}&LAYERS=${layer}&WIDTH=${w}&HEIGHT=${w / 2}&FORMAT=${encodeURIComponent(fmt)}${extra}`;

export const IMAGERY = {
  day: gibs('BlueMarble_NextGeneration', 4096),
  night: gibs('VIIRS_Black_Marble', 4096),
  precip: gibs('IMERG_Precipitation_Rate', 2048, 'image/png', '&TRANSPARENT=TRUE'),
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

// Bright stars of the Big Dipper and Orion (RA hours, Dec degrees) -
// the original channel showed both when you zoomed all the way out.
const CONSTELLATIONS = {
  dipper: {
    stars: [[11.062, 61.75], [11.031, 56.38], [11.897, 53.69], [12.257, 57.03], [12.900, 55.96], [13.399, 54.93], [13.792, 49.31]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]],
  },
  orion: {
    // Betelgeuse, Bellatrix, Mintaka, Alnilam, Alnitak, Saiph, Rigel, Meissa
    stars: [[5.919, 7.41], [5.419, 6.35], [5.533, -0.30], [5.604, -1.20], [5.679, -1.94], [5.796, -9.67], [5.242, -8.20], [5.585, 9.93]],
    lines: [[7, 0], [7, 1], [0, 4], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6]],
  },
};

const VERT = `
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vUv = uv; vN = normalize(normal);
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = `
uniform sampler2D dayTex, nightTex, precipTex;
uniform vec3 sunDir; uniform float uNight, uPrecip;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  float d = dot(n, sunDir);
  vec3 day = texture2D(dayTex, vUv).rgb;
  vec3 night = texture2D(nightTex, vUv).rgb;
  // City lights read best slightly boosted and warmed up.
  night = pow(night, vec3(1.15)) * vec3(1.5, 1.35, 1.1) + vec3(0.004, 0.008, 0.02);
  float lit = smoothstep(-0.10, 0.14, d);
  vec3 dayLit = day * (0.62 + 0.38 * clamp(d * 1.6, 0.0, 1.0));
  vec3 col = mix(day * 0.95, mix(night, dayLit, lit), uNight);
  // Warm glow along the terminator.
  col += uNight * vec3(0.22, 0.09, 0.03) * exp(-pow((d - 0.02) * 9.0, 2.0)) * 0.5;
  vec4 p = texture2D(precipTex, vUv);
  col = mix(col, p.rgb, p.a * uPrecip * 0.85);
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

export function createGlobe(host, { labelLayer, onPick, onDrag, renderLabel, safeArea = () => ({ top: 0, bottom: 0 }) }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    host.classList.add('no-webgl');
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 200);

  // --- Earth ---
  const loader = new THREE.TextureLoader().setCrossOrigin('anonymous');
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const uniforms = {
    dayTex: { value: blankTex([24, 52, 96, 255]) },
    nightTex: { value: blankTex([4, 8, 20, 255]) },
    precipTex: { value: blankTex([0, 0, 0, 0]) },
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
    uNight: { value: 1 },
    uPrecip: { value: 0 },
  };
  const loaded = {};
  function load(name, uniform) {
    if (loaded[name]) return loaded[name];
    loaded[name] = new Promise(resolve => {
      loader.load(IMAGERY[name], tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = aniso;
        uniforms[uniform].value = tex;
        resolve(true);
      }, undefined, () => resolve(false));
    });
    return loaded[name];
  }
  const ready = Promise.all([load('day', 'dayTex'), load('night', 'nightTex')]);

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

  // --- Sky: random field + the two constellations ---
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

  function placeSky(gmst) {
    constGroup.clear();
    for (const c of Object.values(CONSTELLATIONS)) {
      const pts = c.stars.map(([ra, dec]) => toVec(dec, ra * 15 - gmst, 78));
      constGroup.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), constStarMat));
      const seg = c.lines.flatMap(([a, b]) => [pts[a], pts[b]]);
      constGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), constMat));
    }
  }

  function updateSun() {
    const a = astro();
    uniforms.sunDir.value.copy(toVec(a.sunLat, a.sunLon));
    placeSky(a.gmst);
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
  const LIMITS = { min: 1.12, max: 6 };

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
  const interactive = () => mode === 'globe' || mode === 'region';

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
      if (pinch0) cam.dist = THREE.MathUtils.clamp(cam.dist * pinch0 / d, LIMITS.min, LIMITS.max);
      pinch0 = d;
      if (down) down.moved = 99;
      return;
    }
    if (down) down.moved += Math.abs(dx) + Math.abs(dy);
    const k = (cam.dist - 0.92) * 0.11;
    vel.lon = -dx * k; vel.lat = dy * k;
    cam.lon += vel.lon; cam.lat = THREE.MathUtils.clamp(cam.lat + vel.lat, -85, 85);
  });
  const up = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    pinch0 = 0;
    if (down && down.moved < 6 && pointers.size === 0 && performance.now() - down.t < 500) {
      vel.lat = vel.lon = 0;
      const hit = pick(e.clientX, e.clientY);
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
    cam.dist = THREE.MathUtils.clamp(cam.dist * Math.exp(e.deltaY * 0.0012), LIMITS.min, LIMITS.max);
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
  let markers = [];          // { item, el, vec }
  function setMarkers(items) {
    labelLayer.replaceChildren();
    markers = items.map(item => {
      const m = document.createElement('button');
      m.className = 'g-label' + (item.home ? ' is-home' : '');
      m.type = 'button';
      m.innerHTML = renderLabel(item, mode);
      m.addEventListener('click', () => item.onClick?.(item));
      labelLayer.appendChild(m);
      return { item, el: m, vec: toVec(item.lat, item.lon, 1.003), w: 0, h: 0, dirty: true };
    });
  }
  function refreshLabels() {
    for (const m of markers) { m.el.innerHTML = renderLabel(m.item, mode); m.dirty = true; }
  }

  const tmp = new THREE.Vector3(), camDir = new THREE.Vector3();
  function layoutLabels(w, h) {
    camDir.copy(camera.position).normalize();
    const placed = [];
    const safe = safeArea();
    const showTier2 = mode === 'region' || cam.dist < 1.9;
    for (const m of markers) {
      const it = m.item;
      let visible = it.home || mode === 'globe' || mode === 'region';
      if (!it.home && it.tier === 2 && !showTier2) visible = false;
      const facing = m.vec.dot(camDir) / m.vec.length() - 1 / cam.dist;
      if (facing < 0.02) visible = false;
      if (visible) {
        tmp.copy(m.vec).project(camera);
        const x = (tmp.x * 0.5 + 0.5) * w, y = (-tmp.y * 0.5 + 0.5) * h;
        if (m.dirty) { m.w = m.el.offsetWidth || 80; m.h = m.el.offsetHeight || 40; m.dirty = false; }
        const box = { l: x - m.w / 2, r: x + m.w / 2, t: y - m.h, b: y };
        const clash = !it.home && placed.some(p => box.l < p.r + 4 && box.r > p.l - 4 && box.t < p.b + 4 && box.b > p.t - 4);
        const off = x < -60 || x > w + 60 || (!it.home && (y - m.h < safe.top || y > h - safe.bottom));
        if (!clash && !off) {
          placed.push(box);
          m.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
          m.el.style.opacity = Math.min(1, facing * 6).toFixed(2);
          m.el.style.visibility = 'visible';
          m.el.style.zIndex = it.home ? 5 : 1;
          continue;
        }
      }
      m.el.style.visibility = 'hidden';
    }
  }

  // --- Main loop ---
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  function frame(now) {
    requestAnimationFrame(frame);
    if (anim) {
      const t = Math.min(1, (now - anim.t0) / anim.ms), e = ease(t);
      // Pull out a little mid-flight so long hops arc over the globe.
      const hop = Math.sin(Math.PI * t) * Math.min(1.2, Math.abs(anim.to.lon - anim.from.lon) / 120);
      cam.lat = anim.from.lat + (anim.to.lat - anim.from.lat) * e;
      cam.lon = anim.from.lon + (anim.to.lon - anim.from.lon) * e;
      cam.dist = anim.from.dist + (anim.to.dist - anim.from.dist) * e + hop;
      if (t >= 1) anim = null;
    } else if (!pointers.size) {
      cam.lon += vel.lon; cam.lat = THREE.MathUtils.clamp(cam.lat + vel.lat, -85, 85);
      vel.lon *= 0.93; vel.lat *= 0.93;
      const idle = now - lastInteract > 5000;
      if (mode === 'intro' || (mode === 'globe' && idle)) cam.lon -= 0.035;
    }
    offset.x += (offsetTarget.x - offset.x) * 0.08;
    offset.y += (offsetTarget.y - offset.y) * 0.08;

    const w = host.clientWidth, h = host.clientHeight;
    camera.position.copy(toVec(cam.lat, cam.lon, cam.dist));
    camera.lookAt(0, 0, 0);
    if (Math.abs(offset.x) > 0.5 || Math.abs(offset.y) > 0.5) camera.setViewOffset(w, h, -offset.x, offset.y, w, h);
    else camera.clearViewOffset();
    constMat.opacity = THREE.MathUtils.clamp((cam.dist - 3) / 2, 0, 0.55);
    renderer.render(scene, camera);
    layoutLabels(w, h);
  }
  requestAnimationFrame(frame);

  return {
    ready,
    flyTo,
    setMarkers,
    refreshLabels,
    get mode() { return mode; },
    setMode(m, { lat, lon, ms } = {}) {
      mode = m;
      host.dataset.mode = m;
      const wide = host.clientWidth > 860;
      // Push the focus point out from under the forecast panel.
      offsetTarget = m === 'park' ? (wide ? { x: host.clientWidth * 0.2, y: 0 } : { x: 0, y: host.clientHeight * 0.22 }) : { x: 0, y: 0 };
      const dist = { intro: 3.4, park: wide ? 2.05 : 2.6, region: 1.32, globe: 2.9 }[m];
      if (lat != null) flyTo(m === 'park' ? lat - 4 : lat, lon, dist, ms);
      else if (m === 'globe') flyTo(cam.lat, cam.lon, dist, ms ?? 1200);
      lastInteract = performance.now();
      refreshLabels();
    },
    setLayer(name, on) {
      if (name === 'night') uniforms.uNight.value = on ? 1 : 0;
      if (name === 'precip') {
        uniforms.uPrecip.value = on ? 1 : 0;
        return on ? load('precip', 'precipTex') : Promise.resolve(true);
      }
      return Promise.resolve(true);
    },
    sunInfo: () => astro(),
  };
}
