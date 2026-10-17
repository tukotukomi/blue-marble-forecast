import { CITIES } from './cities.js';
import { iconFor, iconSVG, describe, severity, setTranslator } from './icons.js';
import { fetchForecast, fetchCities, fetchNWS, searchPlaces, isNWS, hoursFor, dayRow, localNow, fetchSatFrames, fetchHiResRadar, fetchGermanRadar, fetchPlaces } from './data.js';
import { fetchForecastRain } from './forecast-rain.js';
import { initGamepad } from './gamepad.js';
import { fetchOperaRadar, OPERA_RELAY } from './opera.js';
import { createCalmSky } from './calm.js';
import { moonPhase } from './sky.js';
import { isApp, geoAvailable, geoPermission, getPosition } from './native.js';
import { VERSION, BUILD } from './version.js';
import { initFeedback } from './feedback.js';
import { createGlobe } from './globe.js';
import { setMusic, blip, unlock } from './audio.js';
import { LANGUAGES, detectLang, setLang, getLang, locale, searchLang, t, applyStatic } from './i18n.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

setTranslator(t);

// ---------- persisted settings ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('fc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('fc.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// Locations keep language-neutral references where possible so their names
// re-translate when the language changes:
//   { city: 'Paris' }       one of our reference cities (by English name)
//   { near: 'Paris' }       a spot picked near one of them
//   { mine: true }          the device's location, away from any known city
//   { name: 'Springfield' } anything else (search results, NWS place names)
const cityByName = n => CITIES.find(c => c.name === n);

function guessHome() {
  // Match the browser's time zone city (e.g. America/Chicago) to a known city.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const city = tz.split('/').pop().replace(/_/g, ' ');
  const c = cityByName(city) || CITIES[0];
  return { city: c.name, region: '', cc: c.cc, lat: c.lat, lon: c.lon };
}

// Layer switches the visitor has set. Until radar became on by default, every
// visit saved radar: false even if the switch was never touched, so that saved
// value is dropped once.
function savedLayers() {
  const saved = store.get('layers', {});
  if (!store.get('radarDefaultOn', false)) {
    delete saved.radar;
    store.set('layers', saved);
    store.set('radarDefaultOn', true);
  }
  return saved;
}

const state = {
  home: store.get('home', null) || guessHome(),
  viewing: null,
  units: store.get('units', /^en-US|^en-LR|^my/.test(navigator.language) ? 'F' : 'C'),
  music: store.get('music', true),
  layers: { night: true, sat: true, radar: true, borders: true, labels: true, fcst: false, ...savedLayers() },
  places: [], // Natural Earth cities, loaded after start (see loadPlaces)
  regionDay: 0,
  view: 'now',
  fc: null, nws: null, cities: [],
  saved: store.get('saved', []), // My Places, in the order they were starred
  animOpen: store.get('animOpen', false), // Globe screen: timers expanded
  started: false,
};
// Every visit starts at the current location when this device shares it
// (the last fix shows at once and is refreshed after start; see
// startAtCurrentLocation), otherwise at home. Earlier versions saved the
// last place viewed; that copy is cleared.
state.current = store.get('current', null);
state.viewing = state.current ? { ...state.current } : state.home;
try { localStorage.removeItem('fc.viewing'); } catch { /* storage unavailable */ }

// Dock order; the app still opens on 'now' (see start()).
const VIEWS = ['places', 'globe', 'now', 'today', 'tomorrow', 'week', 'region', 'uv', 'laundry'];

const ico = d => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const DOCK_ICONS = {
  now: ico('<path d="M10 14.5V4a2 2 0 1 1 4 0v10.5a4 4 0 1 1-4 0Z"/><path d="M12 9v7"/>'),
  today: ico('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  tomorrow: ico('<path d="M4 18h16M7 18a5 5 0 0 1 10 0"/><path d="M12 3v5M9.5 5.5 12 3l2.5 2.5"/>'),
  week: ico('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  region: ico('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>'),
  uv: ico('<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/><path d="M12 9a3 3 0 0 0 0 6" fill="currentColor"/>'),
  laundry: ico('<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a3 3 0 0 1-8 0Z"/>'),
  places: ico('<path d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6L12 17l-5.38 2.83 1.03-6L3.3 9.6l6-.9Z"/>'),
  globe: ico('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
};

// ---------- formatting (all locale-aware) ----------
const toF = c => c * 9 / 5 + 32;
const T = c => c == null || Number.isNaN(c) ? '--' : `${Math.round(state.units === 'F' ? toF(c) : c)}°`;
const W = kmh => state.units === 'F' ? t('units.mph', { n: Math.round(kmh * 0.621) }) : t('units.kmh', { n: Math.round(kmh) });
const num1 = n => new Intl.NumberFormat(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
// 12-hour clocks only for U.S. English with Fahrenheit; everything else uses 24-hour time.
const use12h = () => getLang() === 'en' && state.units === 'F';
// `full` keeps ":00" on the hour (clocks, sunrise); hour labels drop it in 12-hour time.
function clock(h, m = 0, full = false) {
  const h12 = use12h();
  return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: m || full || !h12 ? '2-digit' : undefined, hour12: h12, timeZone: 'UTC' })
    .format(new Date(Date.UTC(2000, 0, 1, h, m)));
}
const hourTick = h => use12h() ? clock(h) : String(h);
const isoClock = iso => clock(+iso.slice(11, 13), +iso.slice(14, 16), true);
const asDate = date => new Date(date + 'T12:00:00Z');
const dayName = (date, style = 'long') => asDate(date).toLocaleDateString(locale(), { weekday: style, timeZone: 'UTC' });
const dateLong = date => asDate(date).toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const dateShort = date => asDate(date).toLocaleDateString(locale(), { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const compass = deg => t('compass.' + ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]);
const fmtCoord = (lat, lon) => t('coord.format', {
  lat: num1(Math.abs(lat)), lon: num1(Math.abs(lon)),
  ns: t(lat >= 0 ? 'coord.n' : 'coord.s'), ew: t(lon >= 0 ? 'coord.e' : 'coord.w'),
});
function countryName(cc) {
  if (!cc) return '';
  try { return new Intl.DisplayNames(locale(), { type: 'region' }).of(cc.toUpperCase()) || ''; } catch { return ''; }
}
const cityName = c => (c && (getLang() === 'zh-cn' ? c.zh : getLang() === 'es' ? c.es : null)) || c?.name || '';
function placeName(l) {
  if (l.city) return cityName(cityByName(l.city));
  if (l.names) return cityName(l.names);
  if (l.nearNames) return t('place.near', { city: cityName(l.nearNames) });
  if (l.near) return t('place.near', { city: cityName(cityByName(l.near)) });
  if (l.mine) return t('place.mine');
  return l.name || fmtCoord(l.lat, l.lon);
}
const placeLine = l => [l.region, countryName(l.cc) || l.country].filter(Boolean).join(', ') || fmtCoord(l.lat, l.lon);

// ---------- globe ----------
const globeHost = $('#globe');
let pickCard = null;

// Keep surface labels out from under the top bar and the dock.
let safe = { top: 0, bottom: 0 };
function measureSafe() {
  if (document.body.classList.contains('explore')) { safe = { top: 0, bottom: 0 }; return; }
  const dock = $('#dock').getBoundingClientRect(), root = document.documentElement.style;
  const dockTop = innerHeight - dock.top;
  // The timeline lines up with the dock's edges (styles.css).
  root.setProperty('--dock-top', `${dockTop}px`);
  root.setProperty('--dock-left', `${dock.left}px`);
  root.setProperty('--dock-width', `${dock.width}px`);
  const timeline = $('#timeline').hidden ? 0 : 24;
  safe = { top: $('.topbar').getBoundingClientRect().bottom, bottom: dockTop + timeline };
}
// Again once the dock has finished moving (its position animates between the
// phone and desktop layouts, e.g. when a phone rotates).
let resizeTimer;
addEventListener('resize', () => { measureSafe(); clearTimeout(resizeTimer); resizeTimer = setTimeout(measureSafe, 400); });

function closePick() { pickCard?.remove(); pickCard = null; }

const globe = createGlobe(globeHost, {
  labelLayer: $('#labels'),
  renderLabel,
  skyName: key => t(`sky.${key}`),
  safeArea: () => safe,
  onDrag: closePick,
  onLayerFrame,
  onLabelClick: openCity,
  onNeedWeather,
  onViewSettled,
  // On phones the first tap on the Earth folds the forecast window down to
  // its title, uncovering the globe; later taps pick places as usual.
  onTap() {
    if (!canCollapse() || isCollapsed()) return false;
    setCollapsed(true);
    return true;
  },
  onPick(lat, lon, x, y) {
    closePick();
    pickCard = document.createElement('div');
    pickCard.className = 'pick-card glass';
    pickCard.style.left = `${x}px`; pickCard.style.top = `${y}px`;
    const near = nearestCity(lat, lon, 2.5);
    pickCard.innerHTML = `<div class="pick-where">${esc(near ? t('place.near', { city: cityName(near) }) : t('place.somewhere'))}</div>
      <div class="pick-coord">${fmtCoord(lat, lon)}</div>
      <button class="pill small" type="button">${esc(t('pick.view'))}</button>`;
    pickCard.querySelector('button').addEventListener('click', () => {
      closePick();
      openLocation({ nearNames: near && namesOf(near), region: '', cc: near?.cc || '', lat, lon, picked: true });
    });
    document.body.appendChild(pickCard);
  },
});
if (!globe) document.body.classList.add('no-webgl');

const namesOf = c => ({ name: c.name, es: c.es, zh: c.zh });

function nearestCity(lat, lon, maxDeg) {
  let best = null, bd = Infinity;
  for (const c of [...CITIES, ...state.places]) {
    const d = Math.hypot(c.lat - lat, (c.lon - lon) * Math.cos(lat * Math.PI / 180));
    if (d < bd) { bd = d; best = c; }
  }
  return bd <= maxDeg ? best : null;
}

function renderLabel(item, mode) {
  if (item.home) {
    const temp = state.fc ? ` <b>${T(state.fc.current.temperature_2m)}</b>` : '';
    return `<span class="pin"></span><span class="g-name">${esc(placeName(item))}${temp}</span>`;
  }
  const wx = item.wx, name = esc(cityName(item));
  if (!wx) return `<span class="g-name">${name}</span>`;
  if (mode === 'region') {
    const i = state.regionDay;
    return `${iconFor(wx.daily.weather_code[i], true, { size: 38 })}
      <span class="g-name">${name}</span>
      <span class="g-hilo"><b class="hi">${T(wx.daily.temperature_2m_max[i])}</b><b class="lo">${T(wx.daily.temperature_2m_min[i])}</b></span>`;
  }
  return `${iconFor(wx.current.weather_code, !!wx.current.is_day, { size: 30 })}
    <span class="g-name">${name}</span><b class="g-temp">${T(wx.current.temperature_2m)}</b>`;
}

// Hand-picked cities show from the whole-globe view (tier 1) or a little
// closer (tier 2); the Natural Earth places carry their own map zoom level.
const curatedZoom = c => (c.tier === 1 ? 0 : 3.5);

function updateMarkers() {
  if (!globe) return;
  const v = state.viewing;
  const curated = state.cities.length ? state.cities : CITIES.map(c => ({ ...c }));
  // The same objects are passed every time so weather fetched for a city stays with it.
  const items = [{ ...v, home: true, name: placeName(v) }];
  for (const c of [...curated, ...state.places]) {
    c.minZoom ??= curatedZoom(c);
    if (Math.abs(c.lat - v.lat) < 0.3 && Math.abs(c.lon - v.lon) < 0.3) continue; // don't double up on the viewed city
    items.push(c);
  }
  globe.setMarkers(items);
}

function openCity(c) {
  blip('select');
  if (cityByName(c.name)?.lat === c.lat) openLocation({ city: c.name, region: '', cc: c.cc, lat: c.lat, lon: c.lon });
  else openLocation({ names: namesOf(c), region: c.region || '', cc: c.cc, lat: c.lat, lon: c.lon });
}

// Weather for cities is fetched as their labels first come into view, in
// batches, so thousands of places don't mean thousands of requests up front.
const wxQueue = new Set();
let wxTimer;
function onNeedWeather(items) {
  for (const it of items) wxQueue.add(it);
  clearTimeout(wxTimer);
  wxTimer = setTimeout(flushWeather, 400);
}
async function flushWeather() {
  const batch = [...wxQueue].slice(0, 80);
  batch.forEach(it => wxQueue.delete(it));
  if (!batch.length) return;
  try {
    const got = await fetchCities(batch);
    got.forEach((r, i) => { batch[i].wx = r.wx; });
    globe?.refreshLabels(new Set(batch));
  } catch { /* labels just stay without weather */ }
  if (wxQueue.size) wxTimer = setTimeout(flushWeather, 400);
}

async function loadPlaces() {
  try {
    state.places = await fetchPlaces();
    updateMarkers();
  } catch { /* the hand-picked cities still show */ }
}

// ---------- data loading ----------
let loadToken = 0;
async function loadLocation() {
  const token = ++loadToken;
  const v = state.viewing;
  state.nws = null;
  setStatus('loading');
  renderTop();
  try {
    const fc = await fetchForecast(v.lat, v.lon);
    if (token !== loadToken) return;
    state.fc = fc;
    setStatus('ok');
  } catch (err) {
    if (token !== loadToken) return;
    setStatus('error', err);
    return;
  }
  renderTop();
  updateMarkers();
  render(false);
  if (isNWS(v)) {
    fetchNWS(v.lat, v.lon).then(nws => {
      if (token !== loadToken) return;
      state.nws = nws;
      // A spot picked on the globe or by GPS gets a proper town name from the NWS.
      if (nws.place && v.picked) {
        Object.assign(v, { name: nws.place.name, region: nws.place.region, cc: 'US', near: undefined, mine: undefined });
        renderTop(); updateMarkers();
      }
      if (['now', 'today', 'tomorrow'].includes(state.view)) render(false);
    }).catch(() => {});
  }
}

async function loadCities() {
  try {
    state.cities = (await fetchCities(CITIES)).map(c => ({ ...c, minZoom: curatedZoom(c) }));
    updateMarkers();
    renderTicker();
  } catch { /* globe still works without labels */ }
}

let lastError = null;
function setStatus(s, err) {
  document.body.dataset.status = s;
  lastError = s === 'error' ? err : null;
  if (s === 'error') renderError();
}
function renderError() {
  $('#panel-body').innerHTML = `<div class="empty">
    ${iconSVG('cloud', { size: 96 })}
    <h3>${esc(t('error.title'))}</h3>
    <p>${esc(t('error.body'))}</p>
    <button class="pill" type="button" id="retry">${esc(t('error.retry'))}</button></div>`;
  $('#retry').addEventListener('click', loadLocation);
}

// ---------- top bar, banner, ticker, dock ----------
function renderTop() {
  const v = state.viewing;
  $('#loc-name').textContent = placeName(v);
  $('#loc-sub').textContent = placeLine(v);
  $('#units').textContent = `°${state.units}`;
  $('#units').setAttribute('aria-label', t('top.units', { unit: t(state.units === 'F' ? 'units.fahrenheit' : 'units.celsius') }));
  for (const b of [$('#music'), $('#calm-music')]) {
    b.classList.toggle('off', !state.music);
    b.setAttribute('aria-pressed', String(state.music));
  }
  // The pin in the location chip marks home; elsewhere the chip is just the name.
  $('#loc-btn').classList.toggle('current', !!v.current);
  $('#loc-btn').classList.toggle('home', !v.current && sameLoc(v, state.home));
  syncStar();
  tick();
}

function tick() {
  if (!state.fc) { $('#clock').textContent = ''; return; }
  const n = localNow(state.fc);
  $('#clock').textContent = clock(n.getUTCHours(), n.getUTCMinutes(), true);
}
setInterval(tick, 15e3);

const sameLoc = (a, b) => Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;

function renderTicker() {
  const items = state.cities.filter(c => c.tier === 1 && c.wx).map(c =>
    `<button class="tick-item" type="button" data-name="${esc(c.name)}">${iconFor(c.wx.current.weather_code, !!c.wx.current.is_day, { size: 26 })}
      <span>${esc(cityName(c))}</span><b>${T(c.wx.current.temperature_2m)}</b></button>`).join('');
  const track = $('#ticker');
  track.innerHTML = `<div class="tick-run">${items}</div><div class="tick-run" aria-hidden="true">${items}</div>`;
  track.querySelectorAll('.tick-item').forEach(b => b.addEventListener('click', () => {
    const c = cityByName(b.dataset.name);
    if (c) openCity(c);
  }));
  measureTicker();
}

// The ticker scrolls from JS rather than a CSS animation. The strip is
// ~20,000px wide, and Firefox won't run CSS animations that large off the
// main thread, so the CSS version stuttered whenever anything else was busy.
// Time-based steps keep the speed steady even when frames are dropped.
const ticker = { x: 0, runW: 0, last: 0, paused: false, speed: 40 };
function measureTicker() {
  ticker.runW = $('#ticker .tick-run')?.offsetWidth || 0;
  if (ticker.runW) ticker.x %= ticker.runW;
}
function tickerFrame(now) {
  requestAnimationFrame(tickerFrame);
  const dt = Math.min(now - ticker.last, 100);
  ticker.last = now;
  if (ticker.paused || !ticker.runW || calm.open) return;
  ticker.x = (ticker.x + ticker.speed * dt / 1000) % ticker.runW;
  $('#ticker').style.transform = `translate3d(${-ticker.x.toFixed(2)}px, 0, 0)`;
}
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const strip = $('.ticker');
  strip.addEventListener('pointerenter', () => { ticker.paused = true; });
  strip.addEventListener('pointerleave', () => { ticker.paused = false; });
  strip.addEventListener('focusin', () => { ticker.paused = true; });
  strip.addEventListener('focusout', () => { ticker.paused = false; });
  addEventListener('resize', measureTicker);
  document.fonts?.ready.then(measureTicker);
  requestAnimationFrame(tickerFrame);
}

const dock = $('#dock');
// The buttons scroll sideways inside a track. On phones they're sized so the
// last one shows only half (styles.css), and the track fades out on whichever
// side has more buttons, so it's clear the menu scrolls.
function renderDock() {
  dock.innerHTML = `<div class="dock-track">${VIEWS.map(id => `<button type="button" data-view="${id}" aria-current="${id === state.view ? 'page' : 'false'}">${DOCK_ICONS[id]}<span>${esc(t(`view.${id}.label`))}</span></button>`).join('')}</div>`;
  dock.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => go(b.dataset.view));
    b.addEventListener('pointerenter', () => blip('hover'));
  });
  const track = dock.firstElementChild;
  track.addEventListener('scroll', dockFades, { passive: true });
  requestAnimationFrame(() => { revealDockButton(state.view, false); dockFades(); });
}

function dockFades() {
  const track = dock.firstElementChild;
  if (!track) return;
  const more = track.scrollWidth - track.clientWidth;
  track.style.setProperty('--fade-l', track.scrollLeft > 2 ? '28px' : '0px');
  track.style.setProperty('--fade-r', track.scrollLeft < more - 2 ? '28px' : '0px');
}
addEventListener('resize', dockFades);

// Keep the current screen's button in view (arrows, keys or controller can
// move to one that's scrolled off). Steps can come quicker than the smooth
// scroll (a held key, a controller), so each works from where the track is
// heading rather than where it is right now.
let dockAim = null, dockAimTimer;
function revealDockButton(id, smooth = true) {
  const track = dock.firstElementChild, b = track?.querySelector(`[data-view="${id}"]`);
  if (!b) return;
  const l = b.offsetLeft, r = l + b.offsetWidth, from = dockAim ?? track.scrollLeft;
  const to = l < from ? l - 8 : r > from + track.clientWidth ? r - track.clientWidth + 8 : null;
  if (to == null) return;
  dockAim = Math.max(0, Math.min(track.scrollWidth - track.clientWidth, to));
  clearTimeout(dockAimTimer);
  dockAimTimer = setTimeout(() => { dockAim = null; }, 600);
  track.scrollTo({ left: dockAim, behavior: smooth ? 'smooth' : 'auto' });
}

// ---------- view switching ----------
// On phones, Now opens close in (about 500 km across the screen) so the
// place and its weather fill the small view; the other screens keep the
// wider look. Read at call time: `phone` is defined further down.
const closeNow = () => state.view === 'now' && phone.matches;
const parkView = () => (closeNow() ? { widthKm: 500 } : {});
function go(id, { sound = true } = {}) {
  if (sound) blip('select');
  closePick();
  if (id !== 'globe' && id !== 'region') setExplore(false);
  setCollapsed(false);
  state.view = id;
  dock.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', b.dataset.view === id ? 'page' : 'false'));
  revealDockButton(id);
  document.body.dataset.view = id;
  const v = state.viewing;
  if (globe) {
    if (id === 'globe') globe.setMode('globe');
    else if (id === 'region') globe.setMode('region', { lat: v.lat, lon: v.lon });
    else if (globe.mode !== 'park' || closeNow()) globe.setMode('park', { lat: v.lat, lon: v.lon, ...parkView() });
    else globe.refreshLabels();
  }
  render(true);
  applyPlaying();
  history.replaceState(null, '', location.search + '#' + id);
}

function step(dir) {
  const i = VIEWS.indexOf(state.view);
  go(VIEWS[(i + dir + VIEWS.length) % VIEWS.length]);
}

let swapTimer;
function render(animate) {
  renderCalm();
  $('#panel-title').textContent = t(`view.${state.view}.title`);
  const panel = $('#panel');
  const draw = () => {
    if (lastError) { $('#panel-date').textContent = ''; renderError(); return; }
    if (!state.fc) {
      $('#panel-body').innerHTML = `<div class="empty">${iconSVG('sun', { size: 96 })}<p>${esc(t('loading'))}</p></div>`;
      $('#panel-date').textContent = '';
      return;
    }
    $('#panel-date').textContent = dateLong(state.fc.daily.time[state.view === 'tomorrow' ? 1 : 0]);
    $('#panel-body').innerHTML = (RENDER[state.view] || (() => ''))();
    AFTER[state.view]?.();
  };
  clearTimeout(swapTimer);
  if (animate) {
    panel.classList.add('swap');
    swapTimer = setTimeout(() => { draw(); panel.classList.remove('swap'); }, 160);
  } else draw();
}

// ---------- screens ----------
// NWS text is only published in English, so other languages get a short note.
const englishOnly = () => t('nws.englishOnly') ? `<span class="en-only" lang="en">${esc(t('nws.englishOnly'))}</span>` : '';

const alertsHTML = () => {
  const a = state.nws?.alerts || [];
  if (!a.length) return '';
  return `<div class="alerts">${a.slice(0, 3).map(x => `<details class="alert sev-${esc((x.severity || '').toLowerCase())}">
    <summary><span class="alert-dot"></span><span lang="en">${esc(x.event)}</span><small>${esc(t('alert.sender'))}</small></summary>
    ${englishOnly() ? `<p class="fine">${englishOnly()}</p>` : ''}
    <p lang="en">${esc(x.headline || '')}</p><p class="alert-desc" lang="en">${esc(x.description || '').replace(/\n/g, '<br>')}</p></details>`).join('')}</div>`;
};

function blocksFor(dayIndex) {
  const fc = state.fc, date = fc.daily.time[dayIndex], next = fc.daily.time[dayIndex + 1];
  const nowH = localNow(fc).getUTCHours();
  const defs = [['morning', 6, 12, date], ['afternoon', 12, 18, date], ['evening', 18, 24, date], ['overnight', 0, 6, next]];
  return defs.map(([key, a, b, d]) => {
    const hrs = d ? hoursFor(fc, d).filter(h => h.hour >= a && h.hour < b) : [];
    if (!hrs.length) return null;
    const worst = hrs.reduce((w, h) => severity(h.code) > severity(w.code) ? h : w, hrs[0]);
    const mid = hrs[Math.floor(hrs.length / 2)];
    const past = dayIndex === 0 && d === date && b <= nowH;
    return { label: t(`block.${key}`), range: `${clock(a)} – ${clock(b % 24)}`, code: worst.code, isDay: mid.isDay, temp: mid.temp, pop: Math.max(...hrs.map(h => h.pop ?? 0)), past };
  }).filter(Boolean);
}

function dayScreen(i) {
  const d = dayRow(state.fc, i);
  const desc = describe(d.code, true);
  const blocks = blocksFor(i).map(b => `<div class="block${b.past ? ' past' : ''}">
      <div class="block-label">${esc(b.label)}</div><div class="block-range">${b.range}</div>
      ${iconFor(b.code, b.isDay, { size: 72 })}
      <div class="block-temp">${T(b.temp)}</div>
      <div class="pop" title="${esc(t('pop.title'))}">${dropGlyph()}${b.pop}%</div>
    </div>`).join('');
  const date = state.fc.daily.time[i];
  const periods = (state.nws?.periods || []).filter(p => p.startTime.slice(0, 10) === date).slice(0, 2);
  const nws = periods.length ? `<div class="nws"><div class="nws-head">${esc(t('nws.head', { office: state.nws.office || '' }))}</div>
    ${englishOnly()}
    ${periods.map(p => `<p lang="en"><b>${esc(p.name)}:</b> ${esc(p.detailedForecast)}</p>`).join('')}</div>` : '';
  return `${i === 0 ? alertsHTML() : ''}
    <div class="day-hero">
      ${iconFor(d.code, true, { size: 150, label: desc.label })}
      <div>
        <div class="cond">${esc(desc.label)}</div>
        <div class="hilo-big"><span class="hi">${T(d.hi)}</span><span class="lo">${T(d.lo)}</span></div>
        <div class="pop big">${dropGlyph()}${esc(t('day.pop', { p: d.pop ?? 0 }))}</div>
      </div>
    </div>
    <div class="blocks">${blocks}</div>${nws}`;
}

const dropGlyph = () => `<svg viewBox="0 0 10 12" width="10" height="12" aria-hidden="true"><path d="M5 0C7 3 9 5.5 9 7.6A4 4 0 0 1 1 7.6C1 5.5 3 3 5 0Z" fill="currentColor"/></svg>`;

function uvInfo(uv) {
  const [key, cls] = uv < 3 ? ['low', 'uv-low'] : uv < 6 ? ['moderate', 'uv-mod'] : uv < 8 ? ['high', 'uv-high'] : uv < 11 ? ['veryHigh', 'uv-vhigh'] : ['extreme', 'uv-ext'];
  return { cat: t(`uv.${key}`), cls, tip: t(`uv.tip.${key}`) };
}

function laundryScore(i) {
  const fc = state.fc, date = fc.daily.time[i];
  const hrs = hoursFor(fc, date).filter(h => h.hour >= 9 && h.hour <= 16);
  if (!hrs.length) return null;
  const avg = k => hrs.reduce((s, h) => s + (h[k] ?? 0), 0) / hrs.length;
  const d = dayRow(fc, i);
  const popMax = Math.max(...hrs.map(h => h.pop ?? 0));
  const wet = hrs.some(h => h.code >= 51);
  let s = 50 + (avg('temp') - 15) * 1.3 + (60 - avg('rh')) * 0.6 + Math.min(avg('wind'), 25) * 0.7 + (d.sun / 3600) * 2.2 - popMax * 0.6 - avg('cloud') * 0.15;
  if (wet) s = Math.min(s, 22);
  s = Math.max(0, Math.min(100, Math.round(s)));
  const lv = s >= 80 ? 5 : s >= 60 ? 4 : s >= 40 ? 3 : s >= 20 ? 2 : 1;
  return { s, lv, text: t(`laundry.${lv}`), rh: avg('rh'), wind: avg('wind'), popMax, sunH: d.sun / 3600 };
}

function clothesline(level, size = 220) {
  const colors = ['#ff7a8a', '#ffc94d', '#5fd38a', '#5ab8ff', '#b993ff'];
  const shirts = colors.map((c, i) => {
    const on = i < level;
    const x = 22 + i * 40;
    return `<g transform="translate(${x} 26)" class="${on ? 'shirt on' : 'shirt'}" style="animation-delay:${i * 0.15}s">
      <path d="M-14 4l8-6h12l8 6-5 7-4-3v20h-14v-20l-4 3z" fill="${on ? c : 'none'}" stroke="${on ? 'rgba(0,0,0,.25)' : 'currentColor'}" stroke-width="1.6" stroke-linejoin="round" ${on ? '' : 'stroke-dasharray="3 2" opacity=".45"'}/>
      <rect x="-2" y="-5" width="4" height="7" rx="1" fill="#c98c4d"/></g>`;
  }).join('');
  return `<svg class="clothesline" viewBox="0 0 210 64" width="${size}" aria-hidden="true">
    <path d="M2 22 Q105 32 208 22" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".5"/>${shirts}</svg>`;
}

const RENDER = {
  now() {
    const fc = state.fc, c = fc.current, d = dayRow(fc, 0);
    const desc = describe(c.weather_code, !!c.is_day);
    const nowH = localNow(fc).getUTCHours();
    const upcoming = [...hoursFor(fc, fc.daily.time[0]), ...hoursFor(fc, fc.daily.time[1])];
    const at = upcoming.findIndex(h => h.hour === nowH);
    const hrs = upcoming.slice(at + 1, at + 13);
    const uvNow = hoursFor(fc, fc.daily.time[0]).find(h => h.hour === nowH)?.uv ?? 0;
    return `${alertsHTML()}
      <div class="now">
        <div class="now-icon">${iconFor(c.weather_code, !!c.is_day, { size: 190, label: desc.label })}</div>
        <div class="now-read">
          <div class="now-temp">${T(c.temperature_2m)}</div>
          <div class="cond">${esc(desc.label)}</div>
          <div class="feels">${esc(t('now.feels', { t: T(c.apparent_temperature) }))}</div>
          <div class="hilo-row"><span>${esc(t('now.high'))} <b class="hi">${T(d.hi)}</b></span><span>${esc(t('now.low'))} <b class="lo">${T(d.lo)}</b></span><span class="pop" title="${esc(t('pop.title'))}">${dropGlyph()}${d.pop ?? 0}%</span></div>
        </div>
      </div>
      <div class="hours" role="list" aria-label="${esc(t('now.next12'))}">${hrs.map(h => `<div class="hour" role="listitem">
        <span class="h-time">${clock(h.hour)}</span>${iconFor(h.code, h.isDay, { size: 40 })}<b>${T(h.temp)}</b>
        <span class="pop">${h.pop ?? 0}%</span></div>`).join('')}</div>
      <div class="stats">
        <div class="stat"><span>${esc(t('stat.humidity'))}</span><b>${c.relative_humidity_2m}%</b></div>
        <div class="stat"><span>${esc(t('stat.wind'))}</span><b><i class="wind-arrow" style="transform:rotate(${c.wind_direction_10m + 180}deg)">↑</i> ${esc(compass(c.wind_direction_10m))} ${esc(W(c.wind_speed_10m))}</b></div>
        <div class="stat"><span>${esc(t('stat.uv'))}</span><b>${Math.round(uvNow)} · ${esc(uvInfo(uvNow).cat)}</b></div>
        <div class="stat"><span>${esc(t('stat.sunrise'))}</span><b>${isoClock(d.sunrise)}</b></div>
        <div class="stat"><span>${esc(t('stat.sunset'))}</span><b>${isoClock(d.sunset)}</b></div>
      </div>`;
  },
  today: () => dayScreen(0),
  tomorrow: () => dayScreen(1),
  week() {
    const days = [1, 2, 3, 4, 5].map(i => dayRow(state.fc, i));
    return `<div class="week">
      ${days.map(d => `<div class="day-card">
        <div class="day-name">${esc(dayName(d.date, 'short'))}</div>
        <div class="day-date">${esc(dateShort(d.date))}</div>
        ${iconFor(d.code, true, { size: 76, label: describe(d.code).label })}
        <div class="day-cond">${esc(describe(d.code).label)}</div>
        <div class="day-hilo"><b class="hi">${T(d.hi)}</b><b class="lo">${T(d.lo)}</b></div>
        <div class="pop" title="${esc(t('pop.title'))}">${dropGlyph()}${d.pop ?? 0}%</div>
      </div>`).join('')}</div>`;
  },
  region() {
    const d0 = state.fc.daily.time[0], d1 = state.fc.daily.time[1];
    return `<p class="hint">${esc(t('region.hint'))}</p>
      <div class="seg" role="group" aria-label="${esc(t('region.day'))}">
        <button type="button" data-day="0" aria-pressed="${state.regionDay === 0}">${esc(t('region.today', { day: dayName(d0, 'short') }))}</button>
        <button type="button" data-day="1" aria-pressed="${state.regionDay === 1}">${esc(t('region.tomorrow', { day: dayName(d1, 'short') }))}</button>
      </div>
      ${layersHTML()}`;
  },
  uv() {
    const d = dayRow(state.fc, 0), d1 = dayRow(state.fc, 1);
    const info = uvInfo(d.uv);
    const hrs = hoursFor(state.fc, d.date).filter(h => h.hour >= 6 && h.hour <= 20);
    const ang = Math.min(d.uv, 12) / 12 * 180 - 90;
    const arc = (a0, a1, cls) => {
      const p = a => [100 + 80 * Math.cos((a - 180) * Math.PI / 180), 100 + 80 * Math.sin((a - 180) * Math.PI / 180)];
      const [x0, y0] = p(a0), [x1, y1] = p(a1);
      return `<path d="M${x0} ${y0} A80 80 0 0 1 ${x1} ${y1}" class="${cls}"/>`;
    };
    const seg = v => v / 12 * 180;
    return `<div class="uv">
      <div class="gauge">
        <svg viewBox="0 0 200 118" aria-hidden="true">
          <g class="gauge-arcs">${arc(0, seg(3) - 1, 'uv-low')}${arc(seg(3) + 1, seg(6) - 1, 'uv-mod')}${arc(seg(6) + 1, seg(8) - 1, 'uv-high')}${arc(seg(8) + 1, seg(11) - 1, 'uv-vhigh')}${arc(seg(11) + 1, 180, 'uv-ext')}</g>
          <g class="needle" style="transform:rotate(${ang}deg)"><path d="M100 30 L105 100 L95 100Z"/><circle cx="100" cy="100" r="9"/></g>
        </svg>
        <div class="uv-num ${info.cls}">${Math.round(d.uv)}</div>
        <div class="uv-cat">${esc(info.cat)}</div>
        <div class="uv-sub">${esc(t('uv.sub', { n: Math.round(d1.uv), cat: uvInfo(d1.uv).cat }))}</div>
      </div>
      <div class="uv-side">
        <p class="uv-tip">${esc(info.tip)}</p>
        <div class="uv-bars" role="list" aria-label="${esc(t('uv.hourly'))}">${hrs.map(h => `<div class="uv-bar" role="listitem" title="${clock(h.hour)}: ${num1(h.uv)}">
          <i class="${uvInfo(h.uv).cls}" style="height:${Math.max(3, Math.min(h.uv, 12) / 12 * 100)}%"></i><span>${h.hour % 3 === 0 ? hourTick(h.hour) : ''}</span></div>`).join('')}</div>
        <p class="fine">${esc(t('uv.scale'))}</p>
      </div></div>`;
  },
  laundry() {
    const today = laundryScore(0);
    const rest = [1, 2, 3, 4].map(i => ({ i, l: laundryScore(i) })).filter(x => x.l);
    if (!today) return `<div class="empty"><p>${esc(t('laundry.none'))}</p></div>`;
    return `<div class="laundry">
      <div class="laundry-hero">
        ${clothesline(today.lv, 300)}
        <div class="laundry-text">${esc(today.text)}</div>
        <div class="laundry-score"><span>${esc(t('laundry.index'))}</span><b>${today.s}</b><small>/100</small></div>
        <div class="laundry-why">
          <span>${dropGlyph()} ${esc(t('laundry.rain', { p: today.popMax }))}</span>
          <span>💧 ${esc(t('laundry.humidity', { p: Math.round(today.rh) }))}</span>
          <span>🌬️ ${esc(W(today.wind))}</span>
          <span>☀️ ${esc(t('laundry.sun', { h: num1(today.sunH) }))}</span>
        </div>
      </div>
      <div class="laundry-days">${rest.map(({ i, l }) => `<div class="mini-day">
        <div class="day-name">${esc(dayName(state.fc.daily.time[i], 'short'))}</div>${clothesline(l.lv, 110)}<small>${esc(l.text)}</small></div>`).join('')}</div>
      <p class="fine">${esc(t('laundry.note'))}</p>
    </div>`;
  },
  // A phone-style list of the starred places: weather icon, name, local
  // time and region, the temperature now and today's high and low.
  places() {
    if (!state.saved.length) {
      return `<div class="empty places-empty">${starIcon(true, 56)}<h3>${esc(t('places.emptyTitle'))}</h3><p>${esc(t('places.emptyBody'))}</p></div>${calmButton()}`;
    }
    // One row: kind is 'current' (the device's location), 'home' or 'saved'.
    const row = (p, i, kind) => {
      const wx = savedWx.get(placeKey(p)), cur = wx?.current, day = wx?.daily;
      const now = wx && localNow(wx);
      const sub = [now && clock(now.getUTCHours(), now.getUTCMinutes(), true), kind === 'current' ? placeName(p) : placeLine(p)].filter(Boolean).join(' · ');
      const title = kind === 'current' ? esc(t('places.current')) : esc(placeName(p)) + (kind === 'home' ? ` <i class="place-tag">${esc(t('places.home'))}</i>` : '');
      const here = kind === 'current' ? !!state.viewing.current : !state.viewing.current && sameLoc(p, state.viewing);
      const end = kind === 'current' ? `<span class="place-star is-home" title="${esc(t('places.current'))}">${HERE_ICON}</span>`
        : kind === 'home' ? `<span class="place-star is-home" title="${esc(t('places.homeKept'))}">${HOME_PIN_ICON}</span>`
        : `<button class="place-star" type="button" data-i="${i}" aria-label="${esc(t('places.remove', { place: placeName(p) }))}">${starIcon(true)}</button>`;
      return `<li class="place${here ? ' here' : ''}">
        <button class="place-open" type="button" data-i="${i}">
          <span class="place-icon">${cur ? iconFor(cur.weather_code, !!cur.is_day, { size: 44 }) : ''}</span>
          <span class="place-text"><b>${title}</b><small>${esc(sub)}</small></span>
          <span class="place-temps">${cur ? `<b>${T(cur.temperature_2m)}</b><small><span class="hi">${T(day.temperature_2m_max[0])}</span> <span class="lo">${T(day.temperature_2m_min[0])}</span></small>` : '<b>–</b>'}</span>
        </button>
        ${end}
      </li>`;
    };
    // Current Location before it's known: a row that asks for it.
    const currentRow = state.current ? row(state.current, 'current', 'current') : `<li class="place">
        <button class="place-open" type="button" data-i="current">
          <span class="place-icon">${HERE_ICON.replace(/width="20" height="20"/, 'width="30" height="30"')}</span>
          <span class="place-text"><b>${esc(t('places.current'))}</b><small>${esc(t(geoDenied ? 'places.currentDenied' : 'places.currentOff'))}</small></span>
        </button>
      </li>`;
    return `<ul class="places">${currentRow}${state.saved.map((p, i) => row(p, i, sameLoc(p, state.home) ? 'home' : 'saved')).join('')}</ul>${calmButton()}`;
  },
  globe() {
    const s = globe?.sunInfo();
    return `<p class="hint">${esc(t('globe.hint'))}</p>
      ${layersHTML()}
      ${s ? `<p class="fine">${esc(t('globe.sun', { coord: fmtCoord(s.sunLat, ((s.sunLon + 540) % 360) - 180) }))}</p>` : ''}
      ${globe ? '' : `<p class="fine">${esc(t('globe.noWebgl'))}</p>`}`;
  },
};

const AFTER = {
  region() {
    document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
      state.regionDay = +b.dataset.day;
      blip('select');
      render(false);
      globe?.refreshLabels();
    }));
    bindLayers();
  },
  places() {
    loadSavedWeather();
    document.querySelectorAll('.place-open').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.i === 'current') return useCurrentLocation();
      const p = state.saved[+b.dataset.i];
      blip('select');
      if (!sameLoc(p, state.viewing)) openLocation(p);
      go('now', { sound: false });
    }));
    document.querySelectorAll('button.place-star').forEach(b => b.addEventListener('click', () => toggleSaved(state.saved[+b.dataset.i])));
    $('#calm-open')?.addEventListener('click', openCalm);
  },
  globe: () => bindLayers(),
};

// ---------- animated precipitation ----------
// Three looping layers: NASA IMERG satellite rain & snow (global, 30-minute
// steps, a few hours behind), high resolution radar (ECCC's North American
// mosaic, minutes behind) and a 12-hour forecast (HRRR in the U.S., DWD
// ICON-EU in Europe, GFS elsewhere) around the place being viewed. Once
// playing they keep playing on every screen until paused.
const anim = {
  playing: true,
  sat: { frames: [], idx: -1, status: 'off' },   // status: off | loading | ready | error
  radar: { frames: [], idx: -1, status: 'off' },
  radar2: { frames: [], idx: -1, status: 'off' },
  radar3: { frames: [], idx: -1, status: 'off' },
  fcst: { frames: [], idx: -1, status: 'off' },
};
const ANIM_KEYS = ['sat', 'radar', 'radar3', 'radar2', 'fcst'];
// Layers that share another layer's switch: "High resolution radar" drives
// both North America (radar) and Germany (radar2).
const SWITCH_OF = { radar2: 'radar', radar3: 'radar' };
// Individual services (Settings > Data sources). Radar areas are separate
// animated layers; forecast sources are choices inside the one forecast layer.
const SOURCE_OF_LAYER = { radar: 'radarNA', radar2: 'radarDE', radar3: 'radarEU' };
const DATA_SOURCES = [
  // Europe (OPERA) needs its relay; it's left out until one is configured.
  { group: 'globe.radar', items: ['radarNA', ...(OPERA_RELAY ? ['radarEU'] : []), 'radarDE'] },
  { group: 'globe.fcst', items: ['hrrr', 'iconEu', 'gfs'] },
];
state.sources = { radarNA: true, radarEU: true, radarDE: true, hrrr: true, iconEu: true, gfs: true, ...store.get('sources', {}) };
if (!OPERA_RELAY) state.sources.radarEU = false;
const isOn = k => !!state.layers[SWITCH_OF[k] ?? k] && (!SOURCE_OF_LAYER[k] || !!state.sources[SOURCE_OF_LAYER[k]]);
const ANIM_SOURCES = {
  sat: { fetch: fetchSatFrames, everyMin: 15 },
  radar: { fetch: fetchHiResRadar, everyMin: 6 },
  radar2: { fetch: fetchGermanRadar, everyMin: 5 },
  radar3: { fetch: fetchOperaRadar, everyMin: 10 },
  fcst: { fetch: () => fetchForecastRain(state.viewing.lat, state.viewing.lon, state.sources), everyMin: 30 },
};
const animTimers = {};

async function refreshFrames(name) {
  const a = anim[name];
  if (!a.frames.length) { a.status = 'loading'; updateLayersUI(); }
  try {
    const out = await ANIM_SOURCES[name].fetch(); // { frames, box, native? }
    if (!isOn(name)) return;
    a.frames = out.frames;
    a.box = out.box;
    a.native = out.native; // degrees per data pixel; absent for frames drawn in the page
    a.status = 'ready';
    hiRes[name] = null;
    updateLayersUI();
    await globe?.setFrames(name, out.frames, out.box);
    updateHiRes(name); // re-apply sharper frames if zoomed in
  } catch {
    if (!a.frames.length) { a.status = 'error'; updateLayersUI(); }
  }
}

function setLayer(name, on, save = true) {
  state.layers[name] = on;
  if (save) store.set('layers', state.layers);
  for (const k of [name, ...ANIM_KEYS.filter(k => SWITCH_OF[k] === name)]) syncLayer(k);
}

// Start or stop one animated layer to match its switch and data source.
function syncLayer(k) {
  const on = k in ANIM_SOURCES ? isOn(k) : !!state.layers[k];
  globe?.setLayer(k, on);
  if (!(k in ANIM_SOURCES)) return;
  clearInterval(animTimers[k]);
  if (on) {
    refreshFrames(k);
    animTimers[k] = setInterval(() => refreshFrames(k), ANIM_SOURCES[k].everyMin * 60e3);
  } else {
    anim[k] = { frames: [], idx: -1, status: 'off' };
    hiRes[k] = null;
  }
}

function setSource(id, on) {
  state.sources[id] = on;
  store.set('sources', state.sources);
  const layer = Object.keys(SOURCE_OF_LAYER).find(k => SOURCE_OF_LAYER[k] === id);
  if (layer) syncLayer(layer);
  else if (isOn('fcst')) { anim.fcst.frames = []; refreshFrames('fcst'); } // forecast sources
  updateLayersUI();
}

function renderSources() {
  $('#sources-list').innerHTML = DATA_SOURCES.map(({ group, items }) => `<h4>${esc(t(group))}</h4>
    ${items.map(id => `<label class="switch source-row"><input type="checkbox" data-source="${id}" ${state.sources[id] ? 'checked' : ''}><span></span>
      <div><b>${esc(t(`src.${id}.name`))}</b><small>${esc(t(`src.${id}.desc`))}</small></div></label>`).join('')}`).join('');
  document.querySelectorAll('#sources-list [data-source]').forEach(inp => inp.addEventListener('change', () => {
    blip('select');
    setSource(inp.dataset.source, inp.checked);
  }));
}

function applyPlaying() {
  globe?.setPlaying(anim.playing);
  const btn = $('#anim-play');
  if (btn) {
    btn.innerHTML = anim.playing ? PAUSE_ICON : PLAY_ICON;
    btn.setAttribute('aria-label', t(anim.playing ? 'anim.pause' : 'anim.play'));
  }
}
const PLAY_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>';

// Times are shown in the viewer's own clock (these are world-wide maps).
function frameLabel(name) {
  const a = anim[name];
  if (a.status === 'error') return t('anim.unavailable');
  const f = a.frames[a.idx];
  if (!f) return t('anim.loading');
  const time = new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit', hour12: use12h() }).format(f.time);
  // Negative = in the past ("6 minutes ago"), positive = forecast ("in 3 hours").
  const mins = Math.round((f.time - Date.now()) / 60e3);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  return `${time} · ${Math.abs(mins) < 90 ? rtf.format(mins, 'minute') : rtf.format(Math.round(mins / 60), 'hour')}`;
}

function onLayerFrame(name, idx) {
  anim[name].idx = idx;
  const label = $(`#anim-${name}-time`), range = $(`#anim-${name}-range`);
  if (label) label.textContent = frameLabel(name);
  if (range && document.activeElement !== range) range.value = idx;
  if (name === summaryKey()) $('#anim-summary-time')?.replaceChildren(frameLabel(name));
  renderTimeline();
}

// ---------- timeline (above the dock) ----------
// A slim bar for the span the animation covers: the earliest time on the
// left, the latest on the right, and a dot gliding along at the moment on
// screen, with that time in the middle. It follows the shared observation
// clock (radar and satellite rain), or the forecast when that's the only
// loop switched on. Redrawn every frame while shown, so the dot moves
// smoothly between radar steps.
function timelineSpan() {
  return globe?.clock() ?? (isOn('fcst') ? globe?.forecastClock() : null) ?? null;
}
const timelineText = { start: '', end: '', now: '', p: -1 };
let timelineRaf = 0;
function renderTimeline() {
  const el = $('#timeline'), span = timelineSpan();
  const show = !!span && span.end > span.start && span.now != null;
  if (el.hidden === show) {
    el.hidden = !show;
    document.body.classList.toggle('has-timeline', show);
    measureSafe();
  }
  if (!show) return;
  const fmt = new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit', hour12: use12h() });
  const set = (key, value, write) => { if (timelineText[key] !== value) { timelineText[key] = value; write(value); } };
  set('start', fmt.format(span.start), v => { $('#tl-start').textContent = v; });
  set('end', fmt.format(span.end), v => { $('#tl-end').textContent = v; });
  set('now', fmt.format(span.now), v => { $('#tl-now').textContent = v; });
  const p = Math.round(Math.max(0, Math.min(1, (span.now - span.start) / (span.end - span.start))) * 2000) / 2000;
  set('p', p, v => el.style.setProperty('--p', v));
  if (!timelineRaf) timelineRaf = requestAnimationFrame(() => { timelineRaf = 0; renderTimeline(); });
}

function layersHTML() {
  const sw = (key, label) => `<label class="switch"><input type="checkbox" data-layer="${key}" ${state.layers[key] ? 'checked' : ''}><span></span>${esc(label)}</label>`;
  const rows = ANIM_KEYS.filter(isOn).map(k => {
    const a = anim[k];
    return `<div class="anim-row">
      <div class="anim-head"><b>${esc(t(`anim.${k}`))}</b><span id="anim-${k}-time">${esc(frameLabel(k))}</span></div>
      <input type="range" id="anim-${k}-range" min="0" max="${Math.max(0, a.frames.length - 1)}" value="${Math.max(0, a.idx)}"
        ${a.status === 'ready' ? '' : 'disabled'} aria-label="${esc(t(`anim.slider.${k}`))}">
    </div>`;
  }).join('');
  // Collapsed (the default), the timers fold into one line: how many are
  // playing and the time on screen, which keeps updating (onLayerFrame).
  const on = ANIM_KEYS.filter(isOn), open = state.animOpen;
  const key = summaryKey();
  const summary = `<div class="anim-summary"><b>${esc(t('anim.summary', { n: on.length }))}</b><span id="anim-summary-time">${esc(key ? frameLabel(key) : '')}</span></div>`;
  return `<div id="layers">
    <div class="toggles">${sw('night', t('globe.night'))}${sw('sat', t('globe.precip'))}${sw('radar', t('globe.radar'))}${sw('borders', t('globe.borders'))}${sw('labels', t('globe.labels'))}${sw('fcst', t('globe.fcst'))}</div>
    ${rows ? `<div class="anim${open ? '' : ' collapsed'}"><button type="button" class="anim-play" id="anim-play"></button>
      <div class="anim-rows">${open ? rows : summary}</div>
      <button type="button" class="anim-toggle" id="anim-toggle" aria-expanded="${open}" aria-label="${esc(t(open ? 'anim.collapse' : 'anim.expand'))}" title="${esc(t(open ? 'anim.collapse' : 'anim.expand'))}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
      ${open ? `<p class="fine anim-note">${esc(t('anim.note'))}</p>` : ''}` : ''}
  </div>`;
}

// Whose time the collapsed line shows: the first radar that's on (they share
// one clock), else satellite rain, else the forecast.
const summaryKey = () => ['radar', 'radar3', 'radar2', 'sat', 'fcst'].find(isOn);

function bindLayers() {
  document.querySelectorAll('#layers [data-layer]').forEach(inp => inp.addEventListener('change', () => {
    blip('select');
    setLayer(inp.dataset.layer, inp.checked);
    updateLayersUI();
  }));
  $('#anim-toggle')?.addEventListener('click', () => {
    blip('select');
    state.animOpen = !state.animOpen;
    store.set('animOpen', state.animOpen);
    updateLayersUI();
  });
  $('#anim-play')?.addEventListener('click', () => {
    blip('select');
    anim.playing = !anim.playing;
    applyPlaying();
  });
  for (const k of ANIM_KEYS) {
    $(`#anim-${k}-range`)?.addEventListener('input', e => {
      anim.playing = false;
      applyPlaying();
      globe?.seek(k, +e.target.value);
    });
  }
  applyPlaying();
}

// Redraw just the layer controls (keeps the rest of the panel and its focus).
function updateLayersUI() {
  renderTimeline();
  const box = $('#layers');
  if (!box) return;
  const focusedId = document.activeElement?.closest('#layers') ? document.activeElement.id || document.activeElement.dataset.layer : null;
  box.outerHTML = layersHTML();
  bindLayers();
  if (focusedId) (document.getElementById(focusedId) || $(`#layers [data-layer="${focusedId}"]`))?.focus();
}

// ---------- sharper precipitation when zoomed in ----------
// The whole-area satellite frames are ~20 km per pixel against ~11 km data.
// When the camera settles while zoomed in, each layer re-requests the same
// frames for just the area in view, up to the data's own resolution, and
// swaps them in without restarting the loop. (Radar and HRRR whole-area frames
// are already close to their ~3-4 km data, so they rarely need this.)
const hiRes = {};  // name -> box of the sharper frames now in use, or null
let settledView = null;
function onViewSettled(view) {
  settledView = view;
  for (const k of ANIM_KEYS) updateHiRes(k);
}
const wrapLon = x => ((((x % 360) + 540) % 360) - 180);
function updateHiRes(name) {
  const a = anim[name];
  if (!globe || !isOn(name) || a.status !== 'ready' || !a.native || !(a.frames[0]?.urlFor || a.frames[0]?.makeFor)) return;
  const full = a.box, view = settledView;
  const revert = () => {
    if (!hiRes[name]) return;
    hiRes[name] = null;
    globe.setFrames(name, a.frames, full, { keepIndex: true });
  };
  if (!view) return revert();
  // The view in the layer's longitude range (it may sit across the date line).
  const shift = wrapLon((view.w + view.e) / 2) - (view.w + view.e) / 2;
  const mx = (view.e - view.w) * 0.2, my = (view.n - view.s) * 0.2;
  const box = {
    w: Math.max(full.w, view.w + shift - mx), e: Math.min(full.e, view.e + shift + mx),
    s: Math.max(full.s, view.s - my), n: Math.min(full.n, view.n + my),
  };
  if (box.e - box.w < 0.05 || box.n - box.s < 0.05) return revert(); // nothing of this layer in view
  const cur = hiRes[name];
  if (cur && view.w + shift >= cur.w && view.e + shift <= cur.e && view.s >= cur.s && view.n <= cur.n
    && cur.e - cur.w < (view.e - view.w) * 3) return; // already sharp enough here
  // Pixels per degree: screen density, but never finer than the data itself.
  // Asking for more makes the server repeat each data cell as a solid block;
  // at one pixel per cell the shader's smoothing turns cells into soft shapes.
  const pxPerDeg = Math.min((innerWidth * Math.min(devicePixelRatio, 2) * 1.2) / (view.e - view.w), 1 / a.native);
  const cos = Math.max(0.2, Math.cos(((box.s + box.n) / 2) * Math.PI / 180));
  let W = (box.e - box.w) * pxPerDeg, H = ((box.n - box.s) * pxPerDeg) / cos;
  const k = Math.min(1, 2048 / Math.max(W, H));
  W = Math.max(64, Math.round(W * k)); H = Math.max(64, Math.round(H * k));
  // Not worth it if it isn't clearly sharper than the whole-area frames.
  const fullPxPerDeg = 2048 / (full.e - full.w);
  if (W / (box.e - box.w) < fullPxPerDeg * 1.5) return revert();
  hiRes[name] = box;
  globe.setFrames(name, a.frames.map(f => (f.makeFor ? { time: f.time, ...f.makeFor(box, W, H) }
    : { time: f.time, url: f.urlFor(box, W, H), transform: f.transform, coverage: f.coverage, box })), box, { keepIndex: true });
}

// ---------- locations ----------
// auto: the app's own move (to the current location at start), which
// mustn't count as the visitor choosing a place.
function openLocation(loc, { asHome = false, auto = false } = {}) {
  if (!auto) movedByUser = true;
  state.viewing = { ...loc };
  setCollapsed(false);
  if (asHome) { state.home = fixedPlace(loc); store.set('home', state.home); keepHomeSaved(); }
  state.fc = null;
  render(false);
  loadLocation();
  if (state.layers.fcst) refreshFrames('fcst'); // the forecast follows the viewed place
  if (globe && calm.open) {
    if (calm.look === 'planet') globe.setMode('horizon', { lat: loc.lat, lon: loc.lon });
  } else if (globe) {
    const m = state.view === 'globe' || state.view === 'region' ? 'region' : 'park';
    if (state.view === 'globe') go('now', { sound: false });
    else globe.setMode(m, { lat: loc.lat, lon: loc.lon, ...(m === 'park' ? parkView() : {}) });
  }
}

const dlg = $('#loc-dialog');
let searchTimer;
const searchHint = msg => `<li class="muted">${esc(msg)}</li>`;
function openSearch() {
  blip('select');
  $('#loc-q').value = '';
  $('#loc-home').checked = false; // a search only changes home when asked to
  $('#loc-results').innerHTML = searchHint(t('search.prompt'));
  renderLocCurrent();
  dlg.showModal();
  fitToKeyboard();
  $('#loc-q').focus();
}

// The place on screen, at the top of the dialog, with "Set as home" (or a
// "Your home" tag when it already is).
function renderLocCurrent() {
  const v = state.viewing, home = sameLoc(v, state.home);
  $('#loc-cur-name').textContent = placeName(v);
  $('#loc-cur-sub').textContent = placeLine(v);
  dlg.querySelector('.loc-current').classList.toggle('home', home);
}
$('#loc-make-home').addEventListener('click', () => {
  blip('select');
  state.home = { ...state.viewing };
  store.set('home', state.home);
  keepHomeSaved();
  renderTop();
  renderLocCurrent();
  toast(t('toast.home', { place: placeName(state.home) }));
});

// On-screen keyboards: keep the dialog in the part of the screen that's still
// visible. visualViewport reports that area (Android Chrome also shrinks the
// page itself, via interactive-widget in index.html). The keyboard is spotted
// by the visible height dropping below what it was when the dialog opened,
// and the dialog is then placed by measuring where it actually shows, since
// iOS versions differ in whether fixed elements follow the visible area or
// stay put while it scrolls.
let kbFullHeight = 0;
function fitToKeyboard() {
  const vv = window.visualViewport;
  if (!vv || !dlg.open) return;
  kbFullHeight = Math.max(kbFullHeight, vv.height);
  const keyboard = kbFullHeight - vv.height > 120;
  dlg.classList.toggle('keyboard', keyboard);
  dlg.style.setProperty('--vv-height', `${vv.height}px`);
  dlg.style.setProperty('--kb-shift', '0px');
  if (!keyboard) return;
  // Where the dialog's top shows within the visible area now; move it to 10px
  // below the status bar (the home-screen app draws underneath it).
  const shown = dlg.getBoundingClientRect().top - vv.offsetTop;
  dlg.style.setProperty('--kb-shift', `${Math.round(statusBarHeight() + 10 - shown)}px`);
}

// The status bar's height (safe-area-inset-top), measured with a hidden
// element since script can't read env() directly. 0 in a normal browser tab.
let safeTopProbe;
function statusBarHeight() {
  if (!safeTopProbe) {
    safeTopProbe = document.createElement('div');
    safeTopProbe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none';
    document.body.appendChild(safeTopProbe);
  }
  return safeTopProbe.offsetHeight;
}
window.visualViewport?.addEventListener('resize', fitToKeyboard);
window.visualViewport?.addEventListener('scroll', fitToKeyboard);
dlg.addEventListener('close', () => { kbFullHeight = 0; dlg.classList.remove('keyboard'); });
$('#loc-btn').addEventListener('click', openSearch);
// Back to the home location: its forecast if another place is showing,
// otherwise just the globe flown back over it (e.g. after exploring).
$('#home-btn').addEventListener('click', () => {
  blip('select');
  const h = state.home;
  if (!sameLoc(state.viewing, h)) return openLocation(h);
  if (state.view === 'globe') globe?.setMode('globe', { lat: h.lat, lon: h.lon });
  else if (state.view === 'region') globe?.setMode('region', { lat: h.lat, lon: h.lon });
  else globe?.setMode('park', { lat: h.lat, lon: h.lon, ...parkView() });
});
$('#loc-q').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length >= 2) searchTimer = setTimeout(() => runSearch(q), 280);
});
// The keyboard's Search/Enter key: search now and put the keyboard away, so
// the whole list of results is in view.
$('#loc-q').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length >= 2) runSearch(q);
  e.target.blur();
});
async function runSearch(q) {
  try {
    const res = await searchPlaces(q, searchLang());
    if ($('#loc-q').value.trim() !== q) return; // typed on since; a newer search follows
    $('#loc-results').innerHTML = res.length ? res.map((r, i) => `<li><button type="button" data-i="${i}">
      <b>${esc(r.name)}</b><span>${esc([r.region, countryName(r.cc) || r.country].filter(Boolean).join(', '))}</span></button></li>`).join('')
      : searchHint(t('search.none', { q }));
    $('#loc-results').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const r = res[+b.dataset.i];
      dlg.close();
      openLocation(r, { asHome: $('#loc-home').checked });
    }));
  } catch {
    $('#loc-results').innerHTML = searchHint(t('search.unavailable'));
  }
}
$('#loc-geo').addEventListener('click', async () => {
  if (!geoAvailable()) return toast(t('geo.unsupported'));
  $('#loc-geo').disabled = true;
  const loc = await locate({ ask: true });
  $('#loc-geo').disabled = false;
  if (!loc) return toast(t(geoDenied ? 'places.currentDenied' : 'geo.failed'));
  dlg.close();
  openLocation(loc, { asHome: $('#loc-home').checked });
});

// ---------- My Places ----------
// Places starred with the button beside the location chip, kept on this
// device. Their weather comes in one request (like the ticker's cities).
const placeKey = l => `${l.lat.toFixed(2)},${l.lon.toFixed(2)}`;
const isSaved = l => state.saved.some(p => sameLoc(p, l));
const starIcon = (filled, size = 20) => `<svg class="star" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6L12 17l-5.38 2.83 1.03-6L3.3 9.6l6-.9Z" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

function syncStar() {
  const on = isSaved(state.viewing), b = $('#star-btn');
  const label = t(sameLoc(state.viewing, state.home) ? 'places.homeKept' : on ? 'places.unsave' : 'places.save');
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', label);
  b.title = label;
}

// Home is saved automatically and always first (see keepHomeSaved), so the
// star can't remove it.
function toggleSaved(loc) {
  if (sameLoc(loc, state.home)) { blip('select'); toast(t('places.homeKept')); return; }
  const was = isSaved(loc);
  state.saved = was ? state.saved.filter(p => !sameLoc(p, loc)) : [...state.saved, fixedPlace(loc)];
  store.set('saved', state.saved);
  blip('select');
  toast(t(was ? 'places.removed' : 'places.added', { place: placeName(loc) }));
  syncStar();
  if (state.view === 'places') render(false);
}
$('#star-btn').addEventListener('click', () => toggleSaved(state.viewing));

// ---------- Current Location ----------
// The device's position heads My Places and is where the app opens (see the
// state set-up near the top). The last fix is kept on this device only.
let movedByUser = false; // the visitor picked a place: don't pull them away
let geoDenied = false;   // the browser refused (or the visitor said no)
const HERE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20.6 3.4 3.6 10.5l7.2 2.7 2.7 7.2Z" fill="#2a8ee8" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
// A copy of a place without the "current location" mark (for home or saving).
const fixedPlace = ({ current, at, ...place }) => place;

// Find the device. ask: false only uses permission already given (no prompt).
async function locate({ ask = true } = {}) {
  if (!geoAvailable()) return null;
  if (!ask && (await geoPermission()) !== 'granted') return null;
  return getPosition().then(({ lat, lon }) => {
    const near = nearestCity(lat, lon, 1);
    const loc = { current: true, region: '', lat, lon, picked: true, ...(near ? { near: near.name, cc: near.cc } : { mine: true, cc: '' }) };
    geoDenied = false;
    state.current = loc;
    store.set('current', { ...loc, at: Date.now() });
    if (state.view === 'places') render(false);
    return loc;
  }, err => {
    geoDenied = !!err?.denied;
    return null;
  });
}

// At start: move to the current location unless the visitor has already
// gone elsewhere. Permission given before: quietly. Not decided yet: ask
// when Start is tapped. Refused: home.
async function startAtCurrentLocation() {
  const permission = await geoPermission();
  if (permission === 'denied' || !geoAvailable()) {
    geoDenied = permission === 'denied';
    if (state.viewing.current && !movedByUser) {
      state.current = null;
      store.set('current', null);
      openLocation(state.home, { auto: true });
    }
    return;
  }
  const moveThere = async ask => {
    const loc = await locate({ ask });
    if (loc && !movedByUser && !(state.viewing.current && sameLoc(state.viewing, loc))) openLocation(loc, { auto: true });
  };
  if (permission === 'granted') moveThere(false);
  else if (state.started) moveThere(true);
  else $('#start').addEventListener('click', () => moveThere(true), { once: true });
}

// The Current Location row: open it (and refresh the fix), or ask for it.
async function useCurrentLocation() {
  blip('select');
  if (state.current) {
    openLocation(state.current);
    go('now', { sound: false });
    locate({ ask: false });
    return;
  }
  toast(t('places.locating'));
  const loc = await locate({ ask: true });
  if (!loc) {
    toast(t(geoDenied ? 'places.currentDenied' : 'geo.failed'));
    if (state.view === 'places') render(false);
    return;
  }
  openLocation(loc);
  go('now', { sound: false });
}

// Home goes into My Places on its own, at the top. The previous home (after
// a change) stays as an ordinary saved place.
function keepHomeSaved() {
  const saved = [{ ...state.home }, ...state.saved.filter(p => !sameLoc(p, state.home))];
  if (JSON.stringify(saved) === JSON.stringify(state.saved)) return;
  state.saved = saved;
  store.set('saved', saved);
}
const HOME_PIN_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" fill="#ff5d6c" stroke="#fff" stroke-width="1.5"/><path d="M12 6.6 8 10.1h1.3v3.3h2v-2h1.4v2h2v-3.3H16Z" fill="#fff"/></svg>';

const savedWx = new Map(); // placeKey -> Open-Meteo current + daily
let savedWxFor = '', savedWxAt = 0;
async function loadSavedWeather() {
  const places = [...(state.current ? [state.current] : []), ...state.saved];
  const list = places.map(placeKey).join('|');
  if (!list || (list === savedWxFor && Date.now() - savedWxAt < 10 * 60e3)) return;
  savedWxFor = list; savedWxAt = Date.now();
  try {
    for (const c of await fetchCities(places)) savedWx.set(placeKey(c), c.wx);
    if (state.view === 'places') render(false);
  } catch { savedWxFor = ''; }
}

// ---------- Calm View ----------
// A flat, quiet forecast for the place on screen over an animated sky that
// matches its weather (calm.js), in place of the globe. Opened from My
// Places; "Back to Globe", Escape or the phone's back gesture return.
// list/idx: the places the arrows and swipes step through (see openCalm).
const calm = { el: $('#calm'), sky: null, open: false, weather: '', list: [], idx: 0, look: store.get('calmLook', 'planet') };
const calmButton = () => `<button class="pill calm-open-btn" type="button" id="calm-open">${esc(t('calm.open'))}</button>`;

function openCalm() {
  if (calm.open) return;
  blip('select');
  calm.open = true;
  // Step through My Places, starting from the place on screen (first in the
  // list if it isn't saved, so you can swipe back to it).
  const places = [...(state.current ? [state.current] : []), ...state.saved].map(p => ({ ...p }));
  calm.list = places.some(p => sameLoc(p, state.viewing)) ? places : [{ ...state.viewing }, ...places];
  calm.idx = Math.max(0, calm.list.findIndex(p => sameLoc(p, state.viewing)));
  prefetchCalm();
  calm.sky ??= createCalmSky($('#calm-sky'));
  calm.el.hidden = false;
  document.body.classList.add('calm-open');
  calm.sky.start();
  applyLook();
  renderCalm();
  requestAnimationFrame(() => calm.el.classList.add('open'));
  // An entry in the history, so the phone's back gesture closes Calm View
  // instead of leaving the site.
  history.pushState({ calm: true }, '', location.search + '#calm');
  $('#calm-back').focus();
}

function closeCalm(fromHistory = false) {
  if (!calm.open) return;
  if (!fromHistory && history.state?.calm) { history.back(); return; } // popstate below finishes
  calm.open = false;
  globe?.suspend(false);
  restoreGlobeView();
  calm.el.classList.remove('open');
  document.body.classList.remove('calm-open');
  setTimeout(() => { if (!calm.open) { calm.el.hidden = true; calm.sky.stop(); } }, 450);
  history.replaceState(null, '', location.search + '#' + state.view);
}
$('#calm-back').addEventListener('click', () => { blip('select'); closeCalm(); });

// ---------- Calm View looks ----------
// "planet": the real globe seen from low orbit, the Earth's edge curving
// across the screen with the place just below it and the weather in the sky
// above (globe.js horizon mode + calm.js with a horizon). "photo": today's
// NASA satellite picture around the place. The switch is remembered.
const CALM_HORIZON = 0.56; // = HORIZON in globe.js
function applyLook() {
  const planet = calm.look === 'planet', v = state.viewing;
  calm.el.dataset.look = calm.look;
  const label = t(planet ? 'calm.lookPhoto' : 'calm.lookPlanet');
  $('#calm-look').setAttribute('aria-label', label);
  $('#calm-look').title = label;
  calm.sky.setHorizon(planet ? CALM_HORIZON : null);
  clearTimeout(calm.suspendTimer);
  if (planet) {
    globe?.suspend(false);
    globe?.setMode('horizon', { lat: v.lat, lon: v.lon });
    calm.sky.start();
  } else {
    calm.sky.stop();
    showCalmPhoto();
    // The photo covers the globe: stop drawing it (and save the battery).
    calm.suspendTimer = setTimeout(() => { if (calm.open && calm.look === 'photo') globe?.suspend(true); }, 450);
  }
}
$('#calm-look').addEventListener('click', () => {
  blip('select');
  calm.look = calm.look === 'planet' ? 'photo' : 'planet';
  store.set('calmLook', calm.look);
  applyLook();
});
// A new screen shape (say, a phone turned sideways) re-frames either look.
let lookResize = 0;
addEventListener('resize', () => {
  clearTimeout(lookResize);
  lookResize = setTimeout(() => {
    if (!calm.open) return;
    if (calm.look === 'planet') globe?.setMode('horizon', { lat: state.viewing.lat, lon: state.viewing.lon });
    else showCalmPhoto();
  }, 300);
});

// The globe back to what the screen underneath shows.
function restoreGlobeView() {
  const v = state.viewing;
  if (state.view === 'globe') globe?.setMode('globe');
  else if (state.view === 'region') globe?.setMode('region', { lat: v.lat, lon: v.lon });
  else globe?.setMode('park', { lat: v.lat, lon: v.lon, ...parkView() });
}

// Today from space: NASA's daily true-colour satellite photo (VIIRS) of
// about 250 km around the place, or its city-lights picture at night.
// Today's pass may not be in yet, and polar orbits leave gaps, so a mostly
// empty picture steps back a day (up to three), then falls back to Blue
// Marble's cloud-free Earth.
const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&STYLES=&FORMAT=image/jpeg';
let photoKey = '';
// Where the place sits in the photo look, as a fraction of the height: in the
// middle of the open gap between the hourly strip and the 7-day list (at rest).
function calmPin() {
  const body = $('#calm-body'), secs = body.querySelectorAll('.calm-sec');
  const hourly = secs[0], daily = body.querySelector('.calm-daily');
  if (!hourly || !daily) return 0.62;
  const gapTop = hourly.getBoundingClientRect().bottom + body.scrollTop;
  const gapEnd = daily.getBoundingClientRect().top + body.scrollTop;
  return Math.min(0.85, Math.max(0.45, (gapTop + gapEnd) / 2 / innerHeight));
}
async function showCalmPhoto() {
  await new Promise(requestAnimationFrame); // the forecast is laid out by then
  const v = state.viewing, day = state.fc ? !!state.fc.current.is_day : true;
  const pin = Math.round(calmPin() * 100) / 100;
  calm.el.style.setProperty('--calm-pin', pin);
  const key = `${placeKey(v)}|${day}|${innerWidth}x${innerHeight}|${pin}`;
  if (key === photoKey) return;
  photoKey = key;
  const scale = Math.min(devicePixelRatio || 1, 2);
  const W = Math.min(2048, Math.round(innerWidth * scale)), H = Math.min(2048, Math.round(innerHeight * scale));
  const latSpan = 2.4, lonSpan = Math.min(60, (latSpan * (W / H)) / Math.max(0.15, Math.cos((v.lat * Math.PI) / 180)));
  const bbox = [v.lat - latSpan * (1 - pin), v.lon - lonSpan / 2, v.lat + latSpan * pin, v.lon + lonSpan / 2].map(n => n.toFixed(4)).join(',');
  const base = `${GIBS_WMS}&BBOX=${bbox}&WIDTH=${W}&HEIGHT=${H}`;
  calm.el.classList.add('photo-loading');
  if (!day) return setPhoto(`${base}&LAYERS=VIIRS_Black_Marble`, t('calm.photoNight'));
  for (let back = 0; back < 4; back++) {
    const date = new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);
    const url = `${base}&LAYERS=VIIRS_SNPP_CorrectedReflectance_TrueColor&TIME=${date}`;
    const ok = await mostlyFilled(url);
    if (photoKey !== key) return; // moved on meanwhile
    if (ok) {
      const when = new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(date));
      return setPhoto(url, t('calm.photoDay', { date: when }));
    }
  }
  setPhoto(`${base}&LAYERS=BlueMarble_NextGeneration`, t('calm.photoFallback'));
}
// Whether a picture is mostly real imagery (not the black of missing data).
async function mostlyFilled(url) {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data;
    let empty = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 24) empty++;
    return empty < 24 * 24 * 0.2;
  } catch { return false; }
}
function setPhoto(url, caption) {
  const img = $('#calm-photo-img');
  img.onload = () => calm.el.classList.remove('photo-loading');
  img.onerror = () => calm.el.classList.remove('photo-loading');
  img.src = url;
  $('#calm-photo-credit').textContent = caption;
}

// The veil over the backdrop deepens as the forecast scrolls up over it.
$('#calm-body').addEventListener('scroll', e => {
  calm.el.style.setProperty('--calm-dim', Math.min(1, e.target.scrollTop / 220).toFixed(3));
}, { passive: true });

// Next or previous place (dir = 1 or -1): the text slides in from that side
// and the sky changes to its weather.
function calmStep(dir) {
  const n = calm.list.length;
  if (!calm.open || n < 2) return;
  blip('select');
  calm.idx = (calm.idx + dir + n) % n;
  const body = $('#calm-body');
  body.classList.remove('slide-next', 'slide-prev');
  void body.offsetWidth; // restart the animation
  body.classList.add(dir > 0 ? 'slide-next' : 'slide-prev');
  clearTimeout(calm.slideTimer);
  calm.slideTimer = setTimeout(() => body.classList.remove('slide-next', 'slide-prev'), 700);
  body.scrollTop = 0;
  openLocation(calm.list[calm.idx]);
  prefetchCalm();
}
// Fetch the neighbours' forecasts ahead (they're cached), so the next step is instant.
function prefetchCalm() {
  const n = calm.list.length;
  if (n < 2) return;
  for (const d of [1, -1]) {
    const p = calm.list[(calm.idx + d + n) % n];
    fetchForecast(p.lat, p.lon).catch(() => {});
  }
}
$('#calm-prev').addEventListener('click', () => calmStep(-1));
$('#calm-next').addEventListener('click', () => calmStep(1));

// Swipes on touch screens. Horizontal only (the page still scrolls up and
// down), and not on the hourly strip, which scrolls sideways itself.
{
  const body = $('#calm-body');
  let swipe = null;
  body.addEventListener('pointerdown', e => {
    swipe = e.pointerType === 'mouse' || e.target.closest('.calm-hours') ? null : { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  body.addEventListener('pointerup', e => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y, quick = performance.now() - swipe.t < 700;
    swipe = null;
    if (quick && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) calmStep(dx < 0 ? 1 : -1);
  });
  body.addEventListener('pointercancel', () => { swipe = null; });
}
addEventListener('popstate', () => { if (calm.open) closeCalm(true); });

// The arrows: hidden with a single place; each names where it goes.
function renderCalmNav() {
  const n = calm.list.length;
  calm.el.classList.toggle('has-arrows', n > 1);
  for (const [id, d, key] of [['#calm-prev', -1, 'calm.prev'], ['#calm-next', 1, 'calm.next']]) {
    const b = $(id);
    b.hidden = n < 2;
    if (n < 2) continue;
    const label = `${t(key)}: ${placeName(calm.list[(calm.idx + d + n) % n])}`;
    b.setAttribute('aria-label', label);
    b.title = label;
  }
}

function renderCalm() {
  if (!calm.open) return;
  const v = state.viewing, fc = state.fc;
  renderCalmNav();
  const body = $('#calm-body');
  if (!fc) {
    if (body.querySelector('.calm-temp')) {
      body.classList.add('is-loading');
      $('#calm-place').textContent = placeName(v);
    } else {
      body.innerHTML = `<header class="calm-hero"><h2 id="calm-place">${esc(placeName(v))}</h2><p class="calm-cond">${esc(t('loading'))}</p></header>`;
    }
    return;
  }
  body.classList.remove('is-loading');
  const c = fc.current, today = dayRow(fc, 0), desc = describe(c.weather_code, !!c.is_day);
  // Rebuild the sky only when the weather changes (not on every re-render).
  const weather = `${c.weather_code}|${c.is_day}`;
  if (weather !== calm.weather) { calm.weather = weather; calm.sky.setWeather(c.weather_code, c.is_day, c.wind_speed_10m); }
  calm.sky.setMoon(moonPhase(), state.viewing.lat < 0);
  if (calm.look === 'photo') showCalmPhoto();

  const nowH = localNow(fc).getUTCHours();
  const hours = fc.daily.time.slice(0, 3).flatMap(date => hoursFor(fc, date));
  const at = Math.max(0, hours.findIndex(h => h.hour === nowH));
  const next = hours.slice(at, at + 25);
  const uvNow = next[0]?.uv ?? 0;

  const days = fc.daily.time.map((_, i) => dayRow(fc, i));
  const lo = Math.min(...days.map(d => d.lo)), hi = Math.max(...days.map(d => d.hi)), span = Math.max(1, hi - lo);
  const pop = p => (p >= 20 ? `<small class="calm-pop">${p}%</small>` : '');

  $('#calm-body').innerHTML = `
    <header class="calm-hero">
      <h2 id="calm-place">${esc(placeName(v))}</h2>
      ${calm.list.length > 1 ? `<div class="calm-dots" aria-hidden="true">${calm.list.map((_, i) => `<i${i === calm.idx ? ' class="on"' : ''}></i>`).join('')}</div>` : ''}
      <div class="calm-temp">${T(c.temperature_2m)}</div>
      <p class="calm-cond">${esc(desc.label)}</p>
      <p class="calm-hilo">${esc(t('calm.hilo', { hi: T(today.hi), lo: T(today.lo) }))} · ${esc(t('now.feels', { t: T(c.apparent_temperature) }))}</p>
    </header>
    <section class="calm-sec">
      <h3>${esc(t('calm.hourly'))}</h3>
      <div class="calm-hours">${next.map((h, i) => `<div class="calm-hour">
        <span>${esc(i ? clock(h.hour) : t('calm.now'))}</span>${iconFor(h.code, h.isDay, { size: 30 })}<b>${T(h.temp)}</b>${pop(h.pop ?? 0)}</div>`).join('')}</div>
    </section>
    <section class="calm-sec calm-daily">
      <h3>${esc(t('calm.daily', { n: days.length }))}</h3>
      <ul class="calm-days">${days.map((d, i) => `<li>
        <span class="calm-day">${esc(i ? dayName(d.date, 'short') : t('calm.today'))}</span>
        <span class="calm-day-icon">${iconFor(d.code, true, { size: 28 })}${pop(d.pop ?? 0)}</span>
        <span class="calm-lo">${T(d.lo)}</span>
        <span class="calm-range"><i style="left:${((d.lo - lo) / span) * 100}%;right:${((hi - d.hi) / span) * 100}%"></i></span>
        <span class="calm-hi">${T(d.hi)}</span></li>`).join('')}</ul>
    </section>
    <section class="calm-sec calm-details">
      <div><span>${esc(t('stat.humidity'))}</span><b>${c.relative_humidity_2m}%</b></div>
      <div><span>${esc(t('stat.wind'))}</span><b>${esc(compass(c.wind_direction_10m))} ${esc(W(c.wind_speed_10m))}</b></div>
      <div><span>${esc(t('stat.uv'))}</span><b>${Math.round(uvNow)} · ${esc(uvInfo(uvNow).cat)}</b></div>
      <div><span>${esc(t('stat.sunrise'))}</span><b>${isoClock(today.sunrise)}</b></div>
      <div><span>${esc(t('stat.sunset'))}</span><b>${isoClock(today.sunset)}</b></div>
      <div><span>${esc(t('calm.rain'))}</span><b>${today.pop ?? 0}%</b></div>
    </section>`;
}

// ---------- feedback ----------
// "Send feedback" in Settings (js/feedback.js). Each report also carries
// these details, so a bug says which build, device and screen it came from.
const feedback = initFeedback({
  t, toast, blip,
  details: () => ({
    Build: `${VERSION} · ${BUILD}`,
    Device: navigator.userAgent,
    'App mode': isApp ? 'iOS app' : matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'Home-screen app' : 'Browser',
    'Screen size': `${screen.width}×${screen.height} @${+devicePixelRatio.toFixed(2)}x, window ${innerWidth}×${innerHeight}`,
    Language: getLang(),
    Screen: state.view + (calm.open ? ' (Calm View)' : ''),
    Place: placeName(state.viewing),
    Layers: Object.keys(state.layers).filter(k => state.layers[k]).join(', '),
    'Reduce motion': matchMedia('(prefers-reduced-motion: reduce)').matches ? 'on' : 'off',
    Time: new Date().toString(),
  }),
});
$('#feedback-open').addEventListener('click', () => { $('#info-dialog').close(); feedback.open(); });

// ---------- controls ----------
$('#units').addEventListener('click', () => {
  state.units = state.units === 'F' ? 'C' : 'F';
  store.set('units', state.units);
  blip('select');
  renderTop(); render(false); renderTicker(); globe?.refreshLabels();
});
// The top bar's music switch, and the same one in Calm View.
function toggleMusic() {
  state.music = !state.music;
  store.set('music', state.music);
  setMusic(state.music);
  renderTop();
}
$('#music').addEventListener('click', toggleMusic);
$('#calm-music').addEventListener('click', toggleMusic);
$('#info').addEventListener('click', () => { blip('select'); $('#info-dialog').showModal(); });
$('#prev').addEventListener('click', () => step(-1));
$('#next').addEventListener('click', () => step(1));

// ---------- language menu ----------
// A small popover in the app's own style (a native <select> can't be styled
// to match). Follows the WAI-ARIA menu-button pattern: one click/tap opens it,
// arrows move, Enter/Space picks, Escape or a click outside closes.
const langBtn = $('#lang-btn'), langMenu = $('#lang-menu');
const check = '<svg class="lang-check" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
langMenu.innerHTML = Object.entries(LANGUAGES).map(([code, l]) =>
  `<li role="none"><button type="button" role="menuitemradio" data-lang="${code}" lang="${l.locale}" tabindex="-1">${check}<span>${l.label}</span></button></li>`).join('');
const langItems = [...langMenu.querySelectorAll('[role="menuitemradio"]')];

function openLangMenu(focusLast = false) {
  langMenu.hidden = false;
  langBtn.setAttribute('aria-expanded', 'true');
  const current = langItems.find(b => b.dataset.lang === getLang());
  (focusLast ? langItems.at(-1) : current || langItems[0]).focus();
}
function closeLangMenu(refocus = false) {
  if (langMenu.hidden) return;
  langMenu.hidden = true;
  langBtn.setAttribute('aria-expanded', 'false');
  if (refocus) langBtn.focus();
}
langBtn.addEventListener('click', () => {
  blip('select');
  if (langMenu.hidden) openLangMenu(); else closeLangMenu();
});
langBtn.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openLangMenu(e.key === 'ArrowUp'); }
});
langMenu.addEventListener('keydown', e => {
  const i = langItems.indexOf(document.activeElement);
  const moveTo = n => { e.preventDefault(); langItems[(n + langItems.length) % langItems.length].focus(); };
  if (e.key === 'ArrowDown') moveTo(i + 1);
  else if (e.key === 'ArrowUp') moveTo(i - 1);
  else if (e.key === 'Home') moveTo(0);
  else if (e.key === 'End') moveTo(langItems.length - 1);
  else if (e.key === 'Escape') { e.preventDefault(); closeLangMenu(true); }
  else if (e.key === 'Tab') closeLangMenu();
});
langItems.forEach(b => b.addEventListener('click', async () => {
  closeLangMenu(true);
  if (b.dataset.lang === getLang()) return;
  blip('select');
  await setLang(b.dataset.lang, { persist: true });
  // A ?lang= link would otherwise override this choice on the next reload.
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) { url.searchParams.delete('lang'); history.replaceState(null, '', url); }
  applyLanguage();
}));
document.addEventListener('pointerdown', e => {
  if (!langMenu.hidden && !e.target.closest('.lang-wrap')) closeLangMenu();
});

function renderLangButton() {
  const l = LANGUAGES[getLang()];
  $('#lang-label').textContent = l.label;
  $('#lang-short').textContent = l.short;
  langBtn.setAttribute('aria-label', t('top.languageCurrent', { lang: l.label }));
  langItems.forEach(b => b.setAttribute('aria-checked', String(b.dataset.lang === getLang())));
}

// ---------- interface size (Settings) ----------
// "2x" is the standard size; "1x" scales the windows down (styles.css) while
// the globe and its labels stay full size, so more of the Earth shows.
state.scale = store.get('scale', '2x');
const scaleRadios = [...document.querySelectorAll('.scale-seg [data-scale]')];
function applyScale() {
  document.body.dataset.scale = state.scale;
  scaleRadios.forEach(b => {
    const on = b.dataset.scale === state.scale;
    b.setAttribute('aria-checked', String(on));
    b.setAttribute('aria-pressed', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  if (state.started) requestAnimationFrame(() => { measureSafe(); globe?.refreshLabels(); });
}
function setScale(s) {
  if (s === state.scale) return;
  blip('select');
  state.scale = s;
  store.set('scale', s);
  applyScale();
}
scaleRadios.forEach((b, i) => {
  b.addEventListener('click', () => setScale(b.dataset.scale));
  b.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next = scaleRadios[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + scaleRadios.length) % scaleRadios.length];
    setScale(next.dataset.scale);
    next.focus();
  });
});
applyScale();

// ---------- full screen ----------
// Hides the browser's own toolbars. iPhone Safari doesn't allow this for
// web pages, so the button only appears where the Fullscreen API exists.
const fsBtn = $('#fullscreen');
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
if (document.fullscreenEnabled || document.webkitFullscreenEnabled) {
  fsBtn.hidden = false;
  fsBtn.addEventListener('click', async () => {
    blip('select');
    try {
      if (fsElement()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else await (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen).call(document.documentElement, { navigationUI: 'hide' });
    } catch { /* the browser refused (e.g. not from a user gesture) */ }
  });
  document.addEventListener('fullscreenchange', syncFullscreen);
  document.addEventListener('webkitfullscreenchange', syncFullscreen);
}
function syncFullscreen() {
  if (fsBtn.hidden) return;
  const on = !!fsElement();
  document.body.classList.toggle('is-fullscreen', on);
  const label = t(on ? 'fullscreen.exit' : 'fullscreen.enter');
  fsBtn.setAttribute('aria-label', label);
  fsBtn.title = label;
  fsBtn.setAttribute('aria-pressed', String(on));
}

// ---------- home-screen app ----------
// The service worker lets the installed app open offline and caches the big
// globe textures (see sw.js). Service workers need https (or localhost).
// (Not in the iOS app, which has its files built in.)
if ('serviceWorker' in navigator && !isApp && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* the site works without it */ });
}
const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installPrompt = null; // Chrome/Edge/Android hand us a real install dialog
function renderInstall() {
  $('#install').hidden = standalone || isApp; // the app is already installed
  $('#install-btn').hidden = !installPrompt;
  $('#install-text').textContent = t(installPrompt ? 'install.ready' : isIOS ? 'install.ios' : 'install.other');
}
addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  renderInstall();
});
addEventListener('appinstalled', () => { installPrompt = null; $('#install').hidden = true; });
$('#install-btn').addEventListener('click', async () => {
  if (!installPrompt) return;
  blip('select');
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  renderInstall();
});

// ---------- collapsed window (phones) ----------
// The forecast screens and the Globe menu (Region keeps its small card, where
// taps pick the area to show). Picking another screen or place opens it again.
const phone = matchMedia('(max-width: 860px)');
const canCollapse = () => phone.matches && state.view !== 'region';
const isCollapsed = () => document.body.classList.contains('collapsed');
function setCollapsed(on) {
  if (isCollapsed() === on) return;
  document.body.classList.toggle('collapsed', on);
  $('#expand').setAttribute('aria-expanded', String(!on));
  closePick();
  measureSafe();
}
// The whole folded title bar opens it, not just the button.
$('#panel').addEventListener('click', () => { if (isCollapsed()) { blip('select'); setCollapsed(false); } });
phone.addEventListener('change', () => { if (!phone.matches) setCollapsed(false); });

// ---------- explore mode (Globe & Region) ----------
// Hides the bars, panel, dock and ticker so the Earth gets the whole screen,
// which matters most on phones. A small pill brings everything back.
function setExplore(on) {
  if (document.body.classList.contains('explore') === on) return;
  document.body.classList.toggle('explore', on);
  $('#explore-exit').hidden = !on;
  if (on) exploreWake();
  else { clearTimeout(exploreIdle); document.body.classList.remove('explore-idle'); }
  closePick();
  closeLangMenu();
  if (on) $('#explore-exit').focus(); else if (['globe', 'region'].includes(state.view)) $('#explore').focus();
  measureSafe();
  setTimeout(measureSafe, 400); // after the dock has slid back
  globe?.refreshLabels();
}
// In Explore the "Show controls" pill (and the mouse pointer) fade away after
// 3 s without input; any mouse move, tap, key or controller input brings it back.
let exploreIdle = 0;
function exploreWake() {
  if (!document.body.classList.contains('explore')) return;
  document.body.classList.remove('explore-idle');
  clearTimeout(exploreIdle);
  exploreIdle = setTimeout(() => document.body.classList.add('explore-idle'), 3000);
}
for (const type of ['pointermove', 'pointerdown', 'wheel', 'keydown']) addEventListener(type, exploreWake, { capture: true, passive: true });
$('#explore').addEventListener('click', () => { blip('select'); setExplore(true); });
$('#explore-exit').addEventListener('click', () => { blip('select'); setExplore(false); });

// Re-render every piece of text after a language change.
function applyLanguage() {
  feedback.retranslate();
  $('#version').textContent = t('app.version', { v: VERSION, b: BUILD });
  renderLangButton();
  renderInstall();
  renderSources();
  syncFullscreen();
  if (getLang() === 'zh-cn' && !$('#font-zh')) {
    const link = Object.assign(document.createElement('link'), {
      id: 'font-zh', rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;800&display=swap',
    });
    document.head.appendChild(link);
  }
  applyStatic();
  renderDock();
  renderTop();
  render(false);
  renderTicker();
  Object.assign(timelineText, { start: '', end: '', now: '' });
  renderTimeline();
  globe?.refreshLabels();
  globe?.renameSky();
  if (state.started) requestAnimationFrame(measureSafe);
}

document.addEventListener('keydown', e => {
  if (calm.open) {
    if (e.key === 'Escape') closeCalm();
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') calmStep(e.key === 'ArrowRight' ? 1 : -1);
    return;
  }
  if (!state.started || document.querySelector('dialog[open]') || !langMenu.hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  if (e.key === 'Escape') {
    if (pickCard) closePick(); else setExplore(false);
    return;
  }
  if (document.body.classList.contains('explore')) return;
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
});

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---------- start ----------
function start() {
  if (state.started) return;
  state.started = true;
  unlock();
  if (state.music) setMusic(true);
  document.body.classList.add('started');
  measureSafe();
  const initial = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'now';
  go(initial, { sound: false });
}
$('#start').addEventListener('click', start);

// ---------- game controller ----------
initGamepad({
  started: () => state.started,
  start,
  pan: (dx, dy) => { closePick(); exploreWake(); globe?.pan(dx, dy); },
  zoom: f => { exploreWake(); globe?.zoom(f); },
  // A with nothing selected: open the spot under the centre reticle (Globe and
  // Region), or the middle of the visible globe on the forecast screens.
  pickCenter() {
    exploreWake();
    if (pickCard) return pickCard.querySelector('button')?.click();
    const free = ['globe', 'region'].includes(state.view) || document.body.classList.contains('explore');
    const x = free || innerWidth <= 860 ? innerWidth / 2 : innerWidth * 0.7;
    const y = free || innerWidth > 860 ? innerHeight / 2 : innerHeight * 0.28;
    globe?.pickAt(x, y);
  },
  back() {
    if (calm.open) return closeCalm();
    const dlg = document.querySelector('dialog[open]');
    if (!langMenu.hidden) closeLangMenu(true);
    else if (dlg) dlg.close();
    else if (pickCard) closePick();
    else if (document.body.classList.contains('explore')) setExplore(false);
    else document.activeElement?.blur?.();
  },
  explore() {
    if (!['globe', 'region'].includes(state.view)) go('globe');
    setExplore(!document.body.classList.contains('explore'));
  },
  globeView: () => go('globe'),
  settings() {
    const d = $('#info-dialog');
    if (d.open) d.close(); else { blip('select'); d.showModal(); }
  },
  playPause() {
    if (!ANIM_KEYS.some(k => state.layers[k])) return;
    anim.playing = !anim.playing;
    applyPlaying();
    toast(t(anim.playing ? 'anim.play' : 'anim.pause'));
  },
  screen(dir) {
    if (calm.open) calmStep(dir);
    else if (!document.querySelector('dialog[open]')) step(dir);
  },
  connected(on) {
    document.body.classList.toggle('has-pad', on);
    toast(t(on ? 'pad.connected' : 'pad.disconnected'));
  },
});

keepHomeSaved();
startAtCurrentLocation();
await setLang(detectLang());
applyLanguage();
// Loading order: the globe's first picture comes first (index.html preloads
// it). Your forecast and the ticker are small and start straight away; the
// heavier extras (map places, borders, rain and radar frames) wait until the
// globe is showing so they don't compete with it for the connection.
loadLocation();
loadCities();
globe?.setMode('intro');
const globeShown = (globe?.ready ?? Promise.resolve()).then(() => document.body.classList.add('globe-ready'));
globeShown.then(() => {
  loadPlaces();
  // Restore the layers the visitor left switched on.
  for (const [name, on] of Object.entries(state.layers)) if (on || name === 'night' || name === 'labels') setLayer(name, on, false);
});
