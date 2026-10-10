import { CITIES } from './cities.js';
import { iconFor, iconSVG, describe, severity, setTranslator } from './icons.js';
import { fetchForecast, fetchCities, fetchPollen, fetchNWS, searchPlaces, isNWS, hoursFor, dayRow, localNow, fetchSatFrames, fetchRadarFrames, fetchPlaces } from './data.js';
import { fetchForecastRain } from './forecast-rain.js';
import { initGamepad } from './gamepad.js';
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

const state = {
  home: store.get('home', null) || guessHome(),
  viewing: null,
  units: store.get('units', /^en-US|^en-LR|^my/.test(navigator.language) ? 'F' : 'C'),
  music: store.get('music', true),
  layers: { night: true, sat: false, radar: false, fcst: false, ...store.get('layers', {}) },
  places: [], // Natural Earth cities, loaded after start (see loadPlaces)
  regionDay: 0,
  view: 'now',
  fc: null, nws: null, pollen: null, cities: [],
  started: false,
};
state.viewing = state.home;

const VIEWS = ['now', 'today', 'tomorrow', 'week', 'region', 'uv', 'laundry', 'pollen', 'globe'];

const ico = d => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const DOCK_ICONS = {
  now: ico('<path d="M10 14.5V4a2 2 0 1 1 4 0v10.5a4 4 0 1 1-4 0Z"/><path d="M12 9v7"/>'),
  today: ico('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  tomorrow: ico('<path d="M4 18h16M7 18a5 5 0 0 1 10 0"/><path d="M12 3v5M9.5 5.5 12 3l2.5 2.5"/>'),
  week: ico('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  region: ico('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>'),
  uv: ico('<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/><path d="M12 9a3 3 0 0 0 0 6" fill="currentColor"/>'),
  laundry: ico('<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a3 3 0 0 1-8 0Z"/>'),
  pollen: ico('<circle cx="12" cy="9" r="2"/><path d="M12 7a3 3 0 1 1 3 3 3 3 0 1 1-3 3 3 3 0 1 1-3-3 3 3 0 1 1 3-3Z"/><path d="M12 14v7M12 18c-2-2-4-2-5-1M12 17c2-2 4-2 5-1"/>'),
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
  safe = { top: $('.topbar').getBoundingClientRect().bottom, bottom: innerHeight - $('#dock').getBoundingClientRect().top };
}
addEventListener('resize', measureSafe);

function closePick() { pickCard?.remove(); pickCard = null; }

const globe = createGlobe(globeHost, {
  labelLayer: $('#labels'),
  renderLabel,
  safeArea: () => safe,
  onDrag: closePick,
  onLayerFrame,
  onLabelClick: openCity,
  onNeedWeather,
  onViewSettled,
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
  state.nws = null; state.pollen = null;
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
  $('#music').classList.toggle('off', !state.music);
  $('#music').setAttribute('aria-pressed', String(state.music));
  const away = !sameLoc(v, state.home);
  $('#away').hidden = !away;
  if (away) $('#away-text').innerHTML = esc(t('away.text', { home: '\u0000' })).replace('\u0000', `<b>${esc(placeName(state.home))}</b>`);
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
  if (ticker.paused || !ticker.runW) return;
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
function renderDock() {
  dock.innerHTML = VIEWS.map(id => `<button type="button" data-view="${id}" aria-current="${id === state.view ? 'page' : 'false'}">${DOCK_ICONS[id]}<span>${esc(t(`view.${id}.label`))}</span></button>`).join('');
  dock.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => go(b.dataset.view));
    b.addEventListener('pointerenter', () => blip('hover'));
  });
}

// ---------- view switching ----------
function go(id, { sound = true } = {}) {
  if (sound) blip('select');
  closePick();
  if (id !== 'globe' && id !== 'region') setExplore(false);
  state.view = id;
  dock.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', b.dataset.view === id ? 'page' : 'false'));
  document.body.dataset.view = id;
  const v = state.viewing;
  if (globe) {
    if (id === 'globe') globe.setMode('globe');
    else if (id === 'region') globe.setMode('region', { lat: v.lat, lon: v.lon });
    else if (globe.mode !== 'park') globe.setMode('park', { lat: v.lat, lon: v.lon });
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

const POLLEN = [
  { k: 'grass_pollen', id: 'grass', lv: [5, 30, 100] },
  { k: 'birch_pollen', id: 'birch', lv: [10, 100, 300] },
  { k: 'alder_pollen', id: 'alder', lv: [10, 100, 300] },
  { k: 'olive_pollen', id: 'olive', lv: [10, 100, 300] },
  { k: 'mugwort_pollen', id: 'mugwort', lv: [5, 20, 50] },
  { k: 'ragweed_pollen', id: 'ragweed', lv: [5, 20, 50] },
];
const pollenLevel = (v, lv) => v == null ? -1 : v < 1 ? 0 : v <= lv[0] ? 1 : v <= lv[1] ? 2 : v <= lv[2] ? 3 : 4;

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
      <div class="stats">
        <div class="stat"><span>${esc(t('stat.humidity'))}</span><b>${c.relative_humidity_2m}%</b></div>
        <div class="stat"><span>${esc(t('stat.wind'))}</span><b><i class="wind-arrow" style="transform:rotate(${c.wind_direction_10m + 180}deg)">↑</i> ${esc(compass(c.wind_direction_10m))} ${esc(W(c.wind_speed_10m))}</b></div>
        <div class="stat"><span>${esc(t('stat.uv'))}</span><b>${Math.round(uvNow)} · ${esc(uvInfo(uvNow).cat)}</b></div>
        <div class="stat"><span>${esc(t('stat.sunrise'))}</span><b>${isoClock(d.sunrise)}</b></div>
        <div class="stat"><span>${esc(t('stat.sunset'))}</span><b>${isoClock(d.sunset)}</b></div>
      </div>
      <div class="hours" role="list" aria-label="${esc(t('now.next12'))}">${hrs.map(h => `<div class="hour" role="listitem">
        <span class="h-time">${clock(h.hour)}</span>${iconFor(h.code, h.isDay, { size: 40 })}<b>${T(h.temp)}</b>
        <span class="pop">${h.pop ?? 0}%</span></div>`).join('')}</div>`;
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
  pollen() {
    const p = state.pollen;
    if (p === null) return `<div class="empty">${iconSVG('partly-day', { size: 90 })}<p>${esc(t('pollen.loading'))}</p></div>`;
    if (p === 'error') return `<div class="empty"><p>${esc(t('pollen.error'))}</p></div>`;
    const days = p.days;
    const rows = POLLEN.map(r => ({ ...r, vals: days.map(d => d[r.k]) })).filter(r => r.vals.some(v => v != null));
    if (!rows.length) {
      return `<div class="empty">
        ${iconSVG('partly-day', { size: 96 })}
        <h3>${esc(t('pollen.unavailableTitle'))}</h3>
        <p>${esc(t('pollen.unavailableBody'))}</p>
        <button class="pill small" type="button" id="try-europe">${esc(t('pollen.try', { city: cityName(cityByName('Paris')) }))}</button></div>`;
    }
    const top = Math.max(...rows.map(r => pollenLevel(r.vals[0], r.lv)));
    return `<div class="pollen">
      <div class="pollen-hero lvl-${top}"><span>${esc(t('pollen.today'))}</span><b>${esc(t(`pollen.cat.${Math.max(0, top)}`))}</b></div>
      <table class="pollen-table"><thead><tr><th scope="col">${esc(t('pollen.type'))}</th>${days.map(d => `<th scope="col">${esc(dayName(d.date, 'short'))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr><th scope="row">${esc(t(`pollen.${r.id}`))}</th>${r.vals.map(v => {
        const l = pollenLevel(v, r.lv);
        return `<td><span class="chip lvl-${l}" title="${esc(v == null ? t('pollen.na') : t('pollen.grains', { n: Math.round(v) }))}">${l < 0 ? '–' : esc(t(`pollen.cat.${l}`))}</span></td>`;
      }).join('')}</tr>`).join('')}</tbody></table>
      <p class="fine">${esc(t('pollen.note'))}</p></div>`;
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
  pollen() {
    if (state.pollen === null) {
      const v = state.viewing, token = loadToken;
      fetchPollen(v.lat, v.lon).then(raw => {
        if (token !== loadToken) return;
        const byDay = {};
        raw.hourly.time.forEach((time, i) => {
          const d = time.slice(0, 10);
          byDay[d] ??= { date: d };
          for (const { k } of POLLEN) {
            const val = raw.hourly[k]?.[i];
            if (val != null) byDay[d][k] = Math.max(byDay[d][k] ?? 0, val);
          }
        });
        state.pollen = { days: Object.values(byDay).slice(0, 4) };
      }).catch(() => { state.pollen = 'error'; }).finally(() => state.view === 'pollen' && render(false));
    }
    $('#try-europe')?.addEventListener('click', () => openCity(cityByName('Paris')));
  },
  globe: () => bindLayers(),
};

// ---------- animated precipitation ----------
// Three looping layers: NASA IMERG satellite rain & snow (global, 30-minute
// steps, a few hours behind), NOAA radar (lower 48, minutes behind) and a
// 12-hour GFS forecast around the place being viewed (hourly steps). Once
// playing they keep playing on every screen until paused.
const anim = {
  playing: true,
  sat: { frames: [], idx: -1, status: 'off' },   // status: off | loading | ready | error
  radar: { frames: [], idx: -1, status: 'off' },
  fcst: { frames: [], idx: -1, status: 'off' },
};
const ANIM_KEYS = ['sat', 'radar', 'fcst'];
const ANIM_SOURCES = {
  sat: { fetch: fetchSatFrames, everyMin: 15 },
  radar: { fetch: fetchRadarFrames, everyMin: 5 },
  fcst: { fetch: () => fetchForecastRain(state.viewing.lat, state.viewing.lon), everyMin: 30 },
};
const animTimers = {};

async function refreshFrames(name) {
  const a = anim[name];
  if (!a.frames.length) { a.status = 'loading'; updateLayersUI(); }
  try {
    const out = await ANIM_SOURCES[name].fetch(); // { frames, box, native? }
    if (!state.layers[name]) return;
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

function setLayer(name, on) {
  state.layers[name] = on;
  store.set('layers', state.layers);
  globe?.setLayer(name, on);
  if (!(name in ANIM_SOURCES)) return;
  clearInterval(animTimers[name]);
  if (on) {
    refreshFrames(name);
    animTimers[name] = setInterval(() => refreshFrames(name), ANIM_SOURCES[name].everyMin * 60e3);
  } else {
    anim[name].status = 'off';
  }
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
}

function layersHTML() {
  const sw = (key, label) => `<label class="switch"><input type="checkbox" data-layer="${key}" ${state.layers[key] ? 'checked' : ''}><span></span>${esc(label)}</label>`;
  const rows = ANIM_KEYS.filter(k => state.layers[k]).map(k => {
    const a = anim[k];
    return `<div class="anim-row">
      <div class="anim-head"><b>${esc(t(`anim.${k}`))}</b><span id="anim-${k}-time">${esc(frameLabel(k))}</span></div>
      <input type="range" id="anim-${k}-range" min="0" max="${Math.max(0, a.frames.length - 1)}" value="${Math.max(0, a.idx)}"
        ${a.status === 'ready' ? '' : 'disabled'} aria-label="${esc(t(`anim.slider.${k}`))}">
    </div>`;
  }).join('');
  return `<div id="layers">
    <div class="toggles">${sw('night', t('globe.night'))}${sw('sat', t('globe.precip'))}${sw('radar', t('globe.radar'))}${sw('fcst', t('globe.fcst'))}</div>
    ${rows ? `<div class="anim"><button type="button" class="anim-play" id="anim-play"></button><div class="anim-rows">${rows}</div></div>
      <p class="fine anim-note">${esc(t('anim.note'))}</p>` : ''}
  </div>`;
}

function bindLayers() {
  document.querySelectorAll('#layers [data-layer]').forEach(inp => inp.addEventListener('change', () => {
    blip('select');
    setLayer(inp.dataset.layer, inp.checked);
    updateLayersUI();
  }));
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
  if (!globe || !state.layers[name] || a.status !== 'ready' || !a.native || !a.frames[0]?.urlFor) return;
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
  globe.setFrames(name, a.frames.map(f => ({ time: f.time, url: f.urlFor(box, W, H) })), box, { keepIndex: true });
}

// ---------- locations ----------
function openLocation(loc, { asHome = false } = {}) {
  state.viewing = { ...loc };
  if (asHome) { state.home = { ...loc }; store.set('home', state.home); }
  state.fc = null;
  render(false);
  loadLocation();
  if (state.layers.fcst) refreshFrames('fcst'); // the forecast follows the viewed place
  if (globe) {
    const m = state.view === 'globe' || state.view === 'region' ? 'region' : 'park';
    if (state.view === 'globe') go('now', { sound: false });
    else globe.setMode(m, { lat: loc.lat, lon: loc.lon });
  }
}

const dlg = $('#loc-dialog');
let searchTimer;
const searchHint = msg => `<li class="muted">${esc(msg)}</li>`;
function openSearch() {
  blip('select');
  $('#loc-q').value = '';
  $('#loc-results').innerHTML = searchHint(t('search.prompt'));
  dlg.showModal();
  $('#loc-q').focus();
}
$('#loc-btn').addEventListener('click', openSearch);
$('#loc-q').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) return;
  searchTimer = setTimeout(async () => {
    try {
      const res = await searchPlaces(q, searchLang());
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
  }, 280);
});
$('#loc-geo').addEventListener('click', () => {
  if (!navigator.geolocation) return toast(t('geo.unsupported'));
  $('#loc-geo').disabled = true;
  navigator.geolocation.getCurrentPosition(pos => {
    $('#loc-geo').disabled = false;
    dlg.close();
    const { latitude: lat, longitude: lon } = pos.coords;
    const near = nearestCity(lat, lon, 1);
    openLocation(near ? { near: near.name, region: '', cc: near.cc, lat, lon, picked: true } : { mine: true, region: '', cc: '', lat, lon, picked: true },
      { asHome: $('#loc-home').checked });
  }, () => {
    $('#loc-geo').disabled = false;
    toast(t('geo.failed'));
  }, { timeout: 10000, maximumAge: 600000 });
});

$('#away-back').addEventListener('click', () => { blip('select'); openLocation(state.home); });
$('#away-home').addEventListener('click', () => {
  blip('select');
  state.home = { ...state.viewing }; store.set('home', state.home);
  renderTop(); toast(t('toast.home', { place: placeName(state.home) }));
});

// ---------- controls ----------
$('#units').addEventListener('click', () => {
  state.units = state.units === 'F' ? 'C' : 'F';
  store.set('units', state.units);
  blip('select');
  renderTop(); render(false); renderTicker(); globe?.refreshLabels();
});
$('#music').addEventListener('click', () => {
  state.music = !state.music;
  store.set('music', state.music);
  setMusic(state.music);
  renderTop();
});
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
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* the site works without it */ });
}
const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installPrompt = null; // Chrome/Edge/Android hand us a real install dialog
function renderInstall() {
  $('#install').hidden = standalone;
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

// ---------- explore mode (Globe & Region) ----------
// Hides the bars, panel, dock and ticker so the Earth gets the whole screen,
// which matters most on phones. A small pill brings everything back.
function setExplore(on) {
  if (document.body.classList.contains('explore') === on) return;
  document.body.classList.toggle('explore', on);
  $('#explore-exit').hidden = !on;
  closePick();
  closeLangMenu();
  if (on) $('#explore-exit').focus(); else if (['globe', 'region'].includes(state.view)) $('#explore').focus();
  measureSafe();
  globe?.refreshLabels();
}
$('#explore').addEventListener('click', () => { blip('select'); setExplore(true); });
$('#explore-exit').addEventListener('click', () => { blip('select'); setExplore(false); });

// Re-render every piece of text after a language change.
function applyLanguage() {
  renderLangButton();
  renderInstall();
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
  globe?.refreshLabels();
  if (state.started) requestAnimationFrame(measureSafe);
}

document.addEventListener('keydown', e => {
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
  pan: (dx, dy) => { closePick(); globe?.pan(dx, dy); },
  zoom: f => globe?.zoom(f),
  // A with nothing selected: open the spot under the centre reticle (Globe and
  // Region), or the middle of the visible globe on the forecast screens.
  pickCenter() {
    if (pickCard) return pickCard.querySelector('button')?.click();
    const free = ['globe', 'region'].includes(state.view) || document.body.classList.contains('explore');
    const x = free || innerWidth <= 860 ? innerWidth / 2 : innerWidth * 0.7;
    const y = free || innerWidth > 860 ? innerHeight / 2 : innerHeight * 0.28;
    globe?.pickAt(x, y);
  },
  back() {
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
  screen(dir) { if (!document.querySelector('dialog[open]')) step(dir); },
  connected(on) {
    document.body.classList.toggle('has-pad', on);
    toast(t(on ? 'pad.connected' : 'pad.disconnected'));
  },
});

await setLang(detectLang());
applyLanguage();
loadLocation();
loadCities();
loadPlaces();
globe?.setMode('intro');
globe?.ready.then(() => document.body.classList.add('globe-ready'));
// Restore the layers the visitor left switched on.
for (const [name, on] of Object.entries(state.layers)) if (on || name === 'night') setLayer(name, on);
