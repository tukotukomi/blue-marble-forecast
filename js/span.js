// "Span all screens": one picture of the globe across several monitors.
//
// Browsers only put a page in full screen on one monitor, so this opens one
// more window per extra screen (Chrome and Edge's Window Management API
// says where the screens are). Every window draws its own slice of one big
// view (globe.setSpan), and they stay in step over a BroadcastChannel:
// whichever window you're using steers the camera, and the window you
// started from keeps the radar clock and sends the place and map layers.
// The extra windows open this page with ?span, which skips the start screen
// and hides the interface.
import { keepAwake } from './wakelock.js';

// An extra window opens with ?span=left,top,width,height: the whole picture,
// in screen coordinates, so it needs no permission of its own.
const spanParam = new URLSearchParams(location.search).get('span');
export const isSpanScreen = spanParam != null;
export const spanSupported = () => 'getScreenDetails' in window && 'BroadcastChannel' in window;
// Whether there's more than one screen to span (unknown until supported).
export const hasManyScreens = () => spanSupported() && screen.isExtended === true;

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('blue-marble-span') : null;
const post = msg => channel?.postMessage(msg);
const STEER_MS = 6000; // input this recent means this window is steering

let app = null;      // set by initSpan
let active = false;  // this window is part of a span
let details = null;  // ScreenDetails
let box = null;      // the whole picture: { left, top, W, H } in screen space
let windows = [];    // the extra windows (the main window only)
let lastInput = 0, remoteInput = 0, lastSent = '', lastClock = null;

export const spanning = () => active;

// The main window passes on map layer switches.
export function shareLayer(name, on) { if (active && !isSpanScreen) post({ type: 'layer', name, on }); }

// Recent input in this window (pointer, wheel, keys, controller) makes it
// the one that steers.
export function noteInput() { lastInput = performance.now(); }

function bounds(screens) {
  const left = Math.min(...screens.map(s => s.left)), top = Math.min(...screens.map(s => s.top));
  return { left, top, W: Math.max(...screens.map(s => s.left + s.width)) - left, H: Math.max(...screens.map(s => s.top + s.height)) - top };
}

// This window's slice: its screen when full screen, else where it sits
// (allowing for the window frame), so it lines up even before that.
function place() {
  if (!active || !box) return;
  const cur = details?.currentScreen;
  let x, y;
  if (document.fullscreenElement && cur) { x = cur.left; y = cur.top; }
  else {
    const side = Math.max(0, (outerWidth - innerWidth) / 2);
    x = screenX + side;
    y = screenY + Math.max(0, outerHeight - innerHeight - side);
  }
  app.globe.setSpan({ W: box.W, H: box.H, x: x - box.left, y: y - box.top });
}

function loop(now) {
  if (!active) return;
  requestAnimationFrame(loop);
  const mine = now - lastInput < STEER_MS;
  // The main window steers when no one is using any window (its idle spin).
  if (mine || (!isSpanScreen && now - remoteInput > STEER_MS)) {
    const c = app.globe.camState();
    const key = `${c.lat.toFixed(4)},${c.lon.toFixed(4)},${c.dist.toFixed(4)}`;
    if (key !== lastSent) { lastSent = key; post({ type: 'cam', c, input: mine }); }
  }
  if (!isSpanScreen) {
    const t = app.globe.clockStep();
    if (t !== lastClock) { lastClock = t; post({ type: 'clock', t }); }
  }
}

function begin() {
  active = true;
  document.body.classList.add('spanning');
  keepAwake('span', true);
  place();
  requestAnimationFrame(loop);
}

function onMessage({ data: m }) {
  if (!m || !app) return;
  if (m.type === 'cam' && active) {
    if (m.input) remoteInput = performance.now();
    if (performance.now() - lastInput > STEER_MS) {
      app.globe.follow(m.c);
      lastSent = `${m.c.lat.toFixed(4)},${m.c.lon.toFixed(4)},${m.c.dist.toFixed(4)}`;
    }
  } else if (m.type === 'clock' && isSpanScreen) app.globe.syncClock(m.t);
  else if (m.type === 'hello' && active && !isSpanScreen) {
    post({ type: 'state', ...app.share(), c: app.globe.camState(), t: app.globe.clockStep() });
  } else if (m.type === 'state' && isSpanScreen) {
    app.receive(m);
    app.globe.follow(m.c);
    app.globe.syncClock(m.t);
  } else if (m.type === 'layer' && isSpanScreen) app.receive({ layers: { [m.name]: m.on } });
  else if (m.type === 'stop' && isSpanScreen) window.close();
}

// The main window: ask where the screens are, go full screen on this one
// and open a window on each of the others. Call from a click.
export async function startSpan() {
  if (!spanSupported()) return 'unsupported';
  let perm = 'unknown';
  try { perm = (await navigator.permissions.query({ name: 'window-management' })).state; } catch { /* older name */ }
  try { details = await window.getScreenDetails(); } catch { return 'denied'; }
  // The permission prompt used up the click: the person has to choose again.
  if (perm === 'prompt') return 'again';
  const screens = details.screens;
  if (screens.length < 2) return 'one';
  box = bounds(screens);
  const cur = details.currentScreen;
  try { await document.documentElement.requestFullscreen({ screen: cur }); } catch { /* still spans, framed */ }
  let blocked = 0;
  screens.filter(s => s.left !== cur.left || s.top !== cur.top).forEach((s, i) => {
    const w = window.open(`${location.pathname}?span=${box.left},${box.top},${box.W},${box.H}#globe`, `blue-marble-span-${i}`,
      `popup,left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`);
    if (w) windows.push(w); else blocked++;
  });
  begin();
  return blocked ? 'popups' : 'ok';
}

export function stopSpan() {
  if (!active) return;
  active = false;
  post({ type: 'stop' });
  for (const w of windows) try { w.close(); } catch { /* already gone */ }
  windows = [];
  document.body.classList.remove('spanning');
  keepAwake('span', false);
  app.globe.setSpan(null);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// globe; share(): { place, layers } to send; receive({ place?, layers? });
// fillLabel: the button text that asks for full screen in an extra window.
export function initSpan({ globe, share, receive, fillLabel }) {
  app = { globe, share, receive };
  channel?.addEventListener('message', onMessage);
  for (const type of ['pointerdown', 'wheel', 'keydown', 'touchstart']) addEventListener(type, noteInput, { capture: true, passive: true });
  addEventListener('pointermove', e => { if (e.buttons) noteInput(); }, { capture: true, passive: true });
  addEventListener('resize', place);
  document.addEventListener('fullscreenchange', place);
  setInterval(place, 1000); // windows can be moved without any event
  addEventListener('pagehide', () => { if (!isSpanScreen) stopSpan(); });
  if (!isSpanScreen) return;

  // An extra window: full screen needs a click in this window itself.
  const fill = document.createElement('button');
  fill.type = 'button';
  fill.className = 'span-fill pill';
  fill.textContent = fillLabel();
  fill.dataset.i18n = 'span.fill'; // re-translated once the strings have loaded
  fill.addEventListener('click', () => document.documentElement.requestFullscreen().catch(() => {}));
  document.body.appendChild(fill);
  const showFill = () => { fill.hidden = !!document.fullscreenElement; };
  document.addEventListener('fullscreenchange', showFill);
  showFill();
  const [left, top, W, H] = spanParam.split(',').map(Number);
  if ([left, top, W, H].every(Number.isFinite) && W > 0 && H > 0) box = { left, top, W, H };
  begin();
  post({ type: 'hello' });
}
