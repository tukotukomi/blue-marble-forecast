import { CITIES } from './cities.js';
import { iconFor, iconSVG, describe, severity } from './icons.js';
import { fetchForecast, fetchCities, fetchPollen, fetchNWS, searchPlaces, isNWS, hoursFor, dayRow, localNow } from './data.js';
import { createGlobe } from './globe.js';
import { setMusic, blip, unlock } from './audio.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- persisted settings ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('fc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('fc.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

function guessHome() {
  // Match the browser's time zone city (e.g. America/Chicago) to a known city.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const city = tz.split('/').pop().replace(/_/g, ' ');
  const hit = CITIES.find(c => c.name === city);
  const c = hit || CITIES[0];
  let country = '';
  try { country = new Intl.DisplayNames(undefined, { type: 'region' }).of(c.cc); } catch { /* older browser */ }
  return { name: c.name, region: '', country, cc: c.cc, lat: c.lat, lon: c.lon, picked: true };
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

const VIEWS = [
  { id: 'now', label: 'Now', title: 'Current Conditions' },
  { id: 'today', label: 'Today', title: "Today's Forecast" },
  { id: 'tomorrow', label: 'Tomorrow', title: "Tomorrow's Forecast" },
  { id: 'week', label: '5-Day', title: '5-Day Forecast' },
  { id: 'region', label: 'Region', title: 'Regional Map' },
  { id: 'uv', label: 'UV Index', title: 'UV Index' },
  { id: 'laundry', label: 'Laundry', title: 'Laundry Check' },
  { id: 'pollen', label: 'Pollen', title: 'Pollen Count' },
  { id: 'globe', label: 'Globe', title: 'Globe' },
];

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

// ---------- formatting ----------
const toF = c => c * 9 / 5 + 32;
const T = c => c == null || Number.isNaN(c) ? '--' : `${Math.round(state.units === 'F' ? toF(c) : c)}°`;
const W = kmh => state.units === 'F' ? `${Math.round(kmh * 0.621)} mph` : `${Math.round(kmh)} km/h`;
const use12h = () => state.units === 'F';
function clock(h, m = 0) {
  const mm = String(m).padStart(2, '0');
  if (!use12h()) return `${String(h).padStart(2, '0')}:${mm}`;
  return `${h % 12 || 12}${m ? ':' + mm : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
const isoClock = iso => clock(+iso.slice(11, 13), +iso.slice(14, 16));
const dayName = (date, style = 'long') => new Date(date + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: style, timeZone: 'UTC' });
const dateLong = date => new Date(date + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const compass = deg => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
const fmtCoord = (lat, lon) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
const placeLine = l => [l.region, l.country].filter(Boolean).join(', ') || fmtCoord(l.lat, l.lon);
const countryName = cc => { try { return new Intl.DisplayNames(undefined, { type: 'region' }).of(cc) || ''; } catch { return ''; } };

// ---------- globe ----------
const globeHost = $('#globe');
let pickCard = null;

// Keep surface labels out from under the top bar and the dock.
let safe = { top: 0, bottom: 0 };
function measureSafe() {
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
    pickCard.innerHTML = `<div class="pick-where">${near ? 'Near ' + esc(near.name) : 'Somewhere on Earth'}</div>
      <div class="pick-coord">${fmtCoord(lat, lon)}</div>
      <button class="pill small" type="button">View forecast</button>`;
    pickCard.querySelector('button').addEventListener('click', () => {
      closePick();
      openLocation({ name: near ? 'Near ' + near.name : fmtCoord(lat, lon), region: '', country: near ? countryName(near.cc) : '', cc: near?.cc || '', lat, lon, picked: true });
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
    const t = state.fc ? ` <b>${T(state.fc.current.temperature_2m)}</b>` : '';
    return `<span class="pin"></span><span class="g-name">${esc(item.name)}${t}</span>`;
  }
  const wx = item.wx;
  if (!wx) return `<span class="g-name">${esc(item.name)}</span>`;
  if (mode === 'region') {
    const i = state.regionDay;
    return `${iconFor(wx.daily.weather_code[i], true, { size: 38 })}
      <span class="g-name">${esc(item.name)}</span>
      <span class="g-hilo"><b class="hi">${T(wx.daily.temperature_2m_max[i])}</b><b class="lo">${T(wx.daily.temperature_2m_min[i])}</b></span>`;
  }
  return `${iconFor(wx.current.weather_code, !!wx.current.is_day, { size: 30 })}
    <span class="g-name">${esc(item.name)}</span><b class="g-temp">${T(wx.current.temperature_2m)}</b>`;
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
  openLocation({ name: c.name, region: '', country: countryName(c.cc), cc: c.cc, lat: c.lat, lon: c.lon });
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
      // A spot picked on the globe gets a proper name from the NWS.
      if (nws.place && v.picked) {
        v.name = nws.place.name; v.region = nws.place.region; v.cc = 'US';
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

function setStatus(s, err) {
  document.body.dataset.status = s;
  if (s === 'error') {
    $('#panel-body').innerHTML = `<div class="empty">
      ${iconSVG('cloud', { size: 96 })}
      <h3>Couldn't reach the weather service</h3>
      <p>${esc(err?.message || 'Network error')}. Check your connection and try again.</p>
      <button class="pill" type="button" id="retry">Try again</button></div>`;
    $('#retry').addEventListener('click', loadLocation);
  }
}

// ---------- top bar, banner, ticker ----------
function renderTop() {
  const v = state.viewing;
  $('#loc-name').textContent = v.name;
  $('#loc-sub').textContent = placeLine(v);
  $('#units').textContent = `°${state.units}`;
  $('#units').setAttribute('aria-label', `Units: degrees ${state.units === 'F' ? 'Fahrenheit' : 'Celsius'}. Click to switch.`);
  $('#music').classList.toggle('off', !state.music);
  $('#music').setAttribute('aria-pressed', String(state.music));
  const away = !sameLoc(v, state.home);
  $('#away').hidden = !away;
  if (away) $('#away-name').textContent = state.home.name;
  tick();
}

function tick() {
  if (!state.fc) { $('#clock').textContent = ''; return; }
  const n = localNow(state.fc);
  $('#clock').textContent = `${clock(n.getUTCHours(), n.getUTCMinutes())}`;
}
setInterval(tick, 15e3);

const sameLoc = (a, b) => Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;

function renderTicker() {
  const items = state.cities.filter(c => c.tier === 1 && c.wx).map(c =>
    `<button class="tick-item" type="button" data-name="${esc(c.name)}">${iconFor(c.wx.current.weather_code, !!c.wx.current.is_day, { size: 26 })}
      <span>${esc(c.name)}</span><b>${T(c.wx.current.temperature_2m)}</b></button>`).join('');
  const track = $('#ticker');
  track.innerHTML = `<div class="tick-run">${items}</div><div class="tick-run" aria-hidden="true">${items}</div>`;
  track.querySelectorAll('.tick-item').forEach(b => b.addEventListener('click', () => {
    const c = CITIES.find(x => x.name === b.dataset.name);
    if (c) openCity(c);
  }));
}

// ---------- view switching ----------
function go(id, { sound = true } = {}) {
  if (sound) blip('select');
  closePick();
  state.view = id;
  document.querySelectorAll('.dock button').forEach(b => b.setAttribute('aria-current', b.dataset.view === id ? 'page' : 'false'));
  document.body.dataset.view = id;
  const v = state.viewing;
  if (globe) {
    if (id === 'globe') globe.setMode('globe');
    else if (id === 'region') globe.setMode('region', { lat: v.lat, lon: v.lon });
    else if (globe.mode !== 'park') globe.setMode('park', { lat: v.lat, lon: v.lon });
    else globe.refreshLabels();
  }
  render(true);
  history.replaceState(null, '', '#' + id);
}

function step(dir) {
  const i = VIEWS.findIndex(v => v.id === state.view);
  go(VIEWS[(i + dir + VIEWS.length) % VIEWS.length].id);
}

let swapTimer;
function render(animate) {
  const view = VIEWS.find(v => v.id === state.view);
  $('#panel-title').textContent = view.title;
  const panel = $('#panel');
  const draw = () => {
    if (!state.fc) {
      $('#panel-body').innerHTML = `<div class="empty">${iconSVG('sun', { size: 96 })}<p>Gathering the forecast…</p></div>`;
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
const alertsHTML = () => {
  const a = state.nws?.alerts || [];
  if (!a.length) return '';
  return `<div class="alerts">${a.slice(0, 3).map(x => `<details class="alert sev-${esc((x.severity || '').toLowerCase())}">
    <summary><span class="alert-dot"></span>${esc(x.event)}<small>${esc(x.senderName || 'NWS')}</small></summary>
    <p>${esc(x.headline || '')}</p><p class="alert-desc">${esc(x.description || '').replace(/\n/g, '<br>')}</p></details>`).join('')}</div>`;
};

function blocksFor(dayIndex) {
  const fc = state.fc, date = fc.daily.time[dayIndex], next = fc.daily.time[dayIndex + 1];
  const nowH = localNow(fc).getUTCHours();
  const defs = [['Morning', 6, 12, date], ['Afternoon', 12, 18, date], ['Evening', 18, 24, date], ['Overnight', 0, 6, next]];
  return defs.map(([label, a, b, d]) => {
    const hrs = d ? hoursFor(fc, d).filter(h => h.hour >= a && h.hour < b) : [];
    if (!hrs.length) return null;
    const worst = hrs.reduce((w, h) => severity(h.code) > severity(w.code) ? h : w, hrs[0]);
    const mid = hrs[Math.floor(hrs.length / 2)];
    const past = dayIndex === 0 && d === date && b <= nowH;
    return { label, range: `${clock(a)} – ${clock(b % 24)}`, code: worst.code, isDay: mid.isDay, temp: mid.temp, pop: Math.max(...hrs.map(h => h.pop ?? 0)), past };
  }).filter(Boolean);
}

function dayScreen(i) {
  const d = dayRow(state.fc, i);
  const desc = describe(d.code, true);
  const blocks = blocksFor(i).map(b => `<div class="block${b.past ? ' past' : ''}">
      <div class="block-label">${b.label}</div><div class="block-range">${b.range}</div>
      ${iconFor(b.code, b.isDay, { size: 72 })}
      <div class="block-temp">${T(b.temp)}</div>
      <div class="pop" title="Chance of precipitation">${dropGlyph()}${b.pop}%</div>
    </div>`).join('');
  const date = state.fc.daily.time[i];
  const periods = (state.nws?.periods || []).filter(p => p.startTime.slice(0, 10) === date).slice(0, 2);
  const nws = periods.length ? `<div class="nws"><div class="nws-head">Official forecast · National Weather Service${state.nws.office ? ' ' + esc(state.nws.office) : ''}</div>
    ${periods.map(p => `<p><b>${esc(p.name)}:</b> ${esc(p.detailedForecast)}</p>`).join('')}</div>` : '';
  return `${i === 0 ? alertsHTML() : ''}
    <div class="day-hero">
      ${iconFor(d.code, true, { size: 150, label: desc.label })}
      <div>
        <div class="cond">${desc.label}</div>
        <div class="hilo-big"><span class="hi">${T(d.hi)}</span><span class="lo">${T(d.lo)}</span></div>
        <div class="pop big">${dropGlyph()}${d.pop ?? 0}% chance of precipitation</div>
      </div>
    </div>
    <div class="blocks">${blocks}</div>${nws}`;
}

const dropGlyph = () => `<svg viewBox="0 0 10 12" width="10" height="12" aria-hidden="true"><path d="M5 0C7 3 9 5.5 9 7.6A4 4 0 0 1 1 7.6C1 5.5 3 3 5 0Z" fill="currentColor"/></svg>`;

function uvInfo(uv) {
  if (uv < 3) return { cat: 'Low', cls: 'uv-low', tip: 'No protection needed for most people. Wear sunglasses on bright days.' };
  if (uv < 6) return { cat: 'Moderate', cls: 'uv-mod', tip: 'Seek shade during midday hours. Wear sunscreen (SPF 30+), a hat and sunglasses.' };
  if (uv < 8) return { cat: 'High', cls: 'uv-high', tip: 'Reduce time in the sun between 10 AM and 4 PM. Cover up, wear a hat and SPF 30+.' };
  if (uv < 11) return { cat: 'Very High', cls: 'uv-vhigh', tip: 'Minimize sun exposure between 10 AM and 4 PM. Unprotected skin can burn in minutes.' };
  return { cat: 'Extreme', cls: 'uv-ext', tip: 'Avoid the sun between 10 AM and 4 PM. Unprotected skin can burn in minutes. Seek shade.' };
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
  const text = ['', 'Hang it indoors', 'Slow to dry outside', 'Will dry by evening', 'Dries well', 'Dries in no time!'][lv];
  return { s, lv, text, rh: avg('rh'), wind: avg('wind'), popMax, sunH: d.sun / 3600 };
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
  { k: 'grass_pollen', name: 'Grass', lv: [5, 30, 100] },
  { k: 'birch_pollen', name: 'Birch', lv: [10, 100, 300] },
  { k: 'alder_pollen', name: 'Alder', lv: [10, 100, 300] },
  { k: 'olive_pollen', name: 'Olive', lv: [10, 100, 300] },
  { k: 'mugwort_pollen', name: 'Mugwort', lv: [5, 20, 50] },
  { k: 'ragweed_pollen', name: 'Ragweed', lv: [5, 20, 50] },
];
const POLLEN_CAT = ['None', 'Low', 'Moderate', 'High', 'Very High'];
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
          <div class="cond">${desc.label}</div>
          <div class="feels">Feels like ${T(c.apparent_temperature)}</div>
          <div class="hilo-row"><span>High <b class="hi">${T(d.hi)}</b></span><span>Low <b class="lo">${T(d.lo)}</b></span><span class="pop">${dropGlyph()}${d.pop ?? 0}%</span></div>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><span>Humidity</span><b>${c.relative_humidity_2m}%</b></div>
        <div class="stat"><span>Wind</span><b><i class="wind-arrow" style="transform:rotate(${c.wind_direction_10m + 180}deg)">↑</i> ${compass(c.wind_direction_10m)} ${W(c.wind_speed_10m)}</b></div>
        <div class="stat"><span>UV Index</span><b>${Math.round(uvNow)} · ${uvInfo(uvNow).cat}</b></div>
        <div class="stat"><span>Sunrise</span><b>${isoClock(d.sunrise)}</b></div>
        <div class="stat"><span>Sunset</span><b>${isoClock(d.sunset)}</b></div>
      </div>
      <div class="hours" role="list" aria-label="Next 12 hours">${hrs.map(h => `<div class="hour" role="listitem">
        <span class="h-time">${clock(h.hour)}</span>${iconFor(h.code, h.isDay, { size: 40 })}<b>${T(h.temp)}</b>
        <span class="pop">${h.pop ?? 0}%</span></div>`).join('')}</div>`;
  },
  today: () => dayScreen(0),
  tomorrow: () => dayScreen(1),
  week() {
    const days = [1, 2, 3, 4, 5].map(i => dayRow(state.fc, i));
    return `<div class="week">
      ${days.map(d => `<div class="day-card">
        <div class="day-name">${dayName(d.date, 'short')}</div>
        <div class="day-date">${new Date(d.date + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', timeZone: 'UTC' })}</div>
        ${iconFor(d.code, true, { size: 76, label: describe(d.code).label })}
        <div class="day-cond">${describe(d.code).label}</div>
        <div class="day-hilo"><b class="hi">${T(d.hi)}</b><b class="lo">${T(d.lo)}</b></div>
        <div class="pop">${dropGlyph()}${d.pop ?? 0}%</div>
      </div>`).join('')}</div>`;
  },
  region() {
    const d0 = state.fc.daily.time[0], d1 = state.fc.daily.time[1];
    return `<p class="hint">Highs and lows across the region. Drag to look around, scroll or pinch to zoom, and tap a city for its forecast.</p>
      <div class="seg" role="group" aria-label="Day">
        <button type="button" data-day="0" aria-pressed="${state.regionDay === 0}">Today · ${dayName(d0, 'short')}</button>
        <button type="button" data-day="1" aria-pressed="${state.regionDay === 1}">Tomorrow · ${dayName(d1, 'short')}</button>
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
        <div class="uv-cat">${info.cat}</div>
        <div class="uv-sub">Today's peak · Tomorrow ${Math.round(d1.uv)} (${uvInfo(d1.uv).cat})</div>
      </div>
      <div class="uv-side">
        <p class="uv-tip">${info.tip}</p>
        <div class="uv-bars" role="list" aria-label="Hourly UV index">${hrs.map(h => `<div class="uv-bar" role="listitem" title="${clock(h.hour)}: ${h.uv.toFixed(1)}">
          <i class="${uvInfo(h.uv).cls}" style="height:${Math.max(3, Math.min(h.uv, 12) / 12 * 100)}%"></i><span>${h.hour % 3 === 0 ? clock(h.hour).replace(':00', '') : ''}</span></div>`).join('')}</div>
        <p class="fine">Scale: World Health Organization / U.S. EPA UV Index.</p>
      </div></div>`;
  },
  laundry() {
    const today = laundryScore(0);
    const rest = [1, 2, 3, 4].map(i => ({ i, l: laundryScore(i) })).filter(x => x.l);
    if (!today) return '<div class="empty"><p>No laundry data for this location.</p></div>';
    return `<div class="laundry">
      <div class="laundry-hero">
        ${clothesline(today.lv, 300)}
        <div class="laundry-text">${today.text}</div>
        <div class="laundry-score"><span>Drying index</span><b>${today.s}</b><small>/100</small></div>
        <div class="laundry-why">
          <span>${dropGlyph()} ${today.popMax}% rain chance</span>
          <span>💧 ${Math.round(today.rh)}% humidity</span>
          <span>🌬️ ${W(today.wind)}</span>
          <span>☀️ ${today.sunH.toFixed(1)} h sunshine</span>
        </div>
      </div>
      <div class="laundry-days">${rest.map(({ i, l }) => `<div class="mini-day">
        <div class="day-name">${dayName(state.fc.daily.time[i], 'short')}</div>${clothesline(l.lv, 110)}<small>${l.text}</small></div>`).join('')}</div>
      <p class="fine">Calculated here from NOAA GFS humidity, wind, sunshine and rain chance between 9 AM and 4 PM. The original channel offered this in Japan only.</p>
    </div>`;
  },
  pollen() {
    const p = state.pollen;
    if (p === null) return `<div class="empty">${iconSVG('partly-day', { size: 90 })}<p>Checking pollen levels…</p></div>`;
    if (p === 'error') return `<div class="empty"><p>The pollen service didn't respond. Try again in a moment.</p></div>`;
    const days = p.days;
    const rows = POLLEN.map(t => ({ ...t, vals: days.map(d => d[t.k]) })).filter(t => t.vals.some(v => v != null));
    if (!rows.length) {
      return `<div class="empty">
        ${iconSVG('partly-day', { size: 96 })}
        <h3>Pollen forecasts aren't available here</h3>
        <p>Pollen data comes from the EU's Copernicus Atmosphere Monitoring Service, which only covers Europe. The original channel only offered pollen in Japan.</p>
        <button class="pill small" type="button" id="try-europe">Try Paris</button></div>`;
    }
    const top = Math.max(...rows.map(r => pollenLevel(r.vals[0], r.lv)));
    return `<div class="pollen">
      <div class="pollen-hero lvl-${top}"><span>Today overall</span><b>${POLLEN_CAT[Math.max(0, top)]}</b></div>
      <table class="pollen-table"><thead><tr><th scope="col">Type</th>${days.map(d => `<th scope="col">${dayName(d.date, 'short')}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr><th scope="row">${r.name}</th>${r.vals.map(v => {
        const l = pollenLevel(v, r.lv);
        return `<td><span class="chip lvl-${l}" title="${v == null ? 'n/a' : Math.round(v) + ' grains/m³'}">${l < 0 ? '–' : POLLEN_CAT[l]}</span></td>`;
      }).join('')}</tr>`).join('')}</tbody></table>
      <p class="fine">Daily peak concentration from Copernicus CAMS (European Union). Thresholds are approximate.</p></div>`;
  },
  globe() {
    const s = globe?.sunInfo();
    return `<p class="hint">Drag to spin the Earth, scroll or pinch to zoom, and tap anywhere for its forecast. Zoom all the way out to find the Big Dipper and Orion.</p>
      <div class="toggles">
        <label class="switch"><input type="checkbox" data-layer="night" ${state.layers.night ? 'checked' : ''}><span></span>Live day &amp; night</label>
        <label class="switch"><input type="checkbox" data-layer="precip" ${state.layers.precip ? 'checked' : ''}><span></span>NASA precipitation (latest day)</label>
      </div>
      ${s ? `<p class="fine">The sun is directly over ${fmtCoord(s.sunLat, ((s.sunLon + 540) % 360) - 180)} right now.</p>` : ''}
      ${globe ? '' : '<p class="fine">Your browser has WebGL turned off, so the 3D globe can\'t be shown.</p>'}`;
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
        raw.hourly.time.forEach((t, i) => {
          const d = t.slice(0, 10);
          byDay[d] ??= { date: d };
          for (const { k } of POLLEN) {
            const val = raw.hourly[k]?.[i];
            if (val != null) byDay[d][k] = Math.max(byDay[d][k] ?? 0, val);
          }
        });
        state.pollen = { days: Object.values(byDay).slice(0, 4) };
      }).catch(() => { state.pollen = 'error'; }).finally(() => state.view === 'pollen' && render(false));
    }
    $('#try-europe')?.addEventListener('click', () => openCity(CITIES.find(c => c.name === 'Paris')));
  },
  globe() {
    document.querySelectorAll('[data-layer]').forEach(inp => inp.addEventListener('change', () => {
      state.layers[inp.dataset.layer] = inp.checked;
      globe?.setLayer(inp.dataset.layer, inp.checked).then(ok => { if (!ok) toast('NASA imagery could not be loaded right now.'); });
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
function openSearch() {
  blip('select');
  $('#loc-q').value = '';
  $('#loc-results').innerHTML = `<li class="muted">Type a city, town or postal code.</li>`;
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
      const res = await searchPlaces(q);
      $('#loc-results').innerHTML = res.length ? res.map((r, i) => `<li><button type="button" data-i="${i}">
        <b>${esc(r.name)}</b><span>${esc([r.region, r.country].filter(Boolean).join(', '))}</span></button></li>`).join('')
        : `<li class="muted">No places found for “${esc(q)}”.</li>`;
      $('#loc-results').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const r = res[+b.dataset.i];
        dlg.close();
        openLocation(r, { asHome: $('#loc-home').checked });
      }));
    } catch {
      $('#loc-results').innerHTML = `<li class="muted">Search is unavailable right now.</li>`;
    }
  }, 280);
});
$('#loc-geo').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Location isn\'t available in this browser.');
  $('#loc-geo').disabled = true;
  navigator.geolocation.getCurrentPosition(pos => {
    $('#loc-geo').disabled = false;
    dlg.close();
    const { latitude: lat, longitude: lon } = pos.coords;
    const near = nearestCity(lat, lon, 1);
    openLocation({ name: near ? 'Near ' + near.name : 'My Location', region: '', country: near ? countryName(near.cc) : '', cc: near?.cc || '', lat, lon, picked: true }, { asHome: $('#loc-home').checked });
  }, () => {
    $('#loc-geo').disabled = false;
    toast('Couldn\'t get your location. You can search instead.');
  }, { timeout: 10000, maximumAge: 600000 });
});
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

$('#away-back').addEventListener('click', () => { blip('select'); openLocation(state.home); });
$('#away-home').addEventListener('click', () => {
  blip('select');
  state.home = { ...state.viewing }; store.set('home', state.home);
  renderTop(); toast(`${state.home.name} is now your home location.`);
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

const dock = $('#dock');
dock.innerHTML = VIEWS.map(v => `<button type="button" data-view="${v.id}">${DOCK_ICONS[v.id]}<span>${v.label}</span></button>`).join('');
dock.querySelectorAll('button').forEach(b => {
  b.addEventListener('click', () => go(b.dataset.view));
  b.addEventListener('pointerenter', () => blip('hover'));
});

document.addEventListener('keydown', e => {
  if (!state.started || document.querySelector('dialog[open]') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'Escape') closePick();
});

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- start ----------
function start() {
  if (state.started) return;
  state.started = true;
  unlock();
  if (state.music) setMusic(true);
  document.body.classList.add('started');
  measureSafe();
  const initial = VIEWS.some(v => v.id === location.hash.slice(1)) ? location.hash.slice(1) : 'now';
  go(initial, { sound: false });
}
$('#start').addEventListener('click', start);

renderTop();
render(false);
loadLocation();
loadCities();
globe?.setMode('intro');
globe?.ready.then(() => document.body.classList.add('globe-ready'));
