import { CITIES } from './cities.js';
import { iconFor, iconSVG, describe, severity, setTranslator } from './icons.js';
import { fetchForecast, fetchCities, fetchPollen, fetchNWS, searchPlaces, isNWS, hoursFor, dayRow, localNow } from './data.js';
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
  layers: { night: true, precip: false },
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
      openLocation({ near: near?.name, region: '', cc: near?.cc || '', lat, lon, picked: true });
    });
    document.body.appendChild(pickCard);
  },
});
if (!globe) document.body.classList.add('no-webgl');

function nearestCity(lat, lon, maxDeg) {
  let best = null, bd = Infinity;
  for (const c of CITIES) {
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

function updateMarkers() {
  if (!globe) return;
  const v = state.viewing;
  const items = [{ ...v, home: true }];
  for (const c of state.cities) {
    if (Math.abs(c.lat - v.lat) < 0.3 && Math.abs(c.lon - v.lon) < 0.3) continue; // don't double up on the viewed city
    items.push({ ...c, onClick: openCity });
  }
  globe.setMarkers(items);
}

function openCity(c) {
  blip('select');
  openLocation({ city: c.name, region: '', cc: c.cc, lat: c.lat, lon: c.lon });
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
    state.cities = await fetchCities(CITIES);
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
      </div>`;
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
      <div class="toggles">
        <label class="switch"><input type="checkbox" data-layer="night" ${state.layers.night ? 'checked' : ''}><span></span>${esc(t('globe.night'))}</label>
        <label class="switch"><input type="checkbox" data-layer="precip" ${state.layers.precip ? 'checked' : ''}><span></span>${esc(t('globe.precip'))}</label>
      </div>
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
  globe() {
    document.querySelectorAll('[data-layer]').forEach(inp => inp.addEventListener('change', () => {
      state.layers[inp.dataset.layer] = inp.checked;
      globe?.setLayer(inp.dataset.layer, inp.checked).then(ok => { if (!ok) toast(t('toast.imagery')); });
    }));
  },
};

// ---------- locations ----------
function openLocation(loc, { asHome = false } = {}) {
  state.viewing = { ...loc };
  if (asHome) { state.home = { ...loc }; store.set('home', state.home); }
  state.fc = null;
  render(false);
  loadLocation();
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

await setLang(detectLang());
applyLanguage();
loadLocation();
loadCities();
globe?.setMode('intro');
globe?.ready.then(() => document.body.classList.add('globe-ready'));
