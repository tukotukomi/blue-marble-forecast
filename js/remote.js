// TV remote navigation (also any keyboard's arrow keys). A remote has arrows,
// OK and Back, and often + / - or Channel up/down and play/pause.
//
//   Arrows ......... move to the nearest button that way (spatial navigation)
//   OK / Enter ..... press it
//   Back ........... close menus, popups, the opened day, Explore, Calm View
//   In Explore ..... arrows spin the globe (held: smoothly), OK opens the
//                    spot under the centre marker, + / - or Channel zoom
//   Calm View ...... left/right change place, up/down scroll
//   Play/Pause ..... the rain animation
//
// Remote mode is on from the start on TVs (quality.js) and turns on anywhere
// at the first up/down arrow or TV-only key; on desktops left/right alone
// keep switching screens as before. Mouse or touch hide the focus ring.
import { isTV } from './quality.js';

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
const visible = el => !el.disabled && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden'
  && !el.closest('[hidden], [inert]') && el.getBoundingClientRect().width > 0;

// e.key names, then the keyCodes TVs use (LG webOS, Samsung Tizen, Android TV).
function keyOf(e) {
  const k = e.key, c = e.keyCode;
  if (k === 'ArrowUp' || k === 'Up' || c === 38) return 'up';
  if (k === 'ArrowDown' || k === 'Down' || c === 40) return 'down';
  if (k === 'ArrowLeft' || k === 'Left' || c === 37) return 'left';
  if (k === 'ArrowRight' || k === 'Right' || c === 39) return 'right';
  if (k === 'Enter' || k === 'Select' || c === 13) return 'ok';
  if (['Escape', 'GoBack', 'BrowserBack', 'Back', 'XF86Back'].includes(k) || c === 461 || c === 10009) return 'back';
  if (k === 'Backspace') return 'backspace';
  if (['+', '=', 'PageUp', 'ChannelUp', 'ZoomIn'].includes(k) || c === 427) return 'zoomIn';
  if (['-', '_', 'PageDown', 'ChannelDown', 'ZoomOut'].includes(k) || c === 428) return 'zoomOut';
  if (['MediaPlayPause', 'MediaPlay', 'MediaPause', 'Pause', 'Play'].includes(k) || [415, 19, 179, 10252].includes(c)) return 'play';
  return null;
}
const TV_ONLY = new Set([461, 10009, 427, 428, 415, 10252]);
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// act: the controller's actions (app.js), plus exploring(), calmBody(),
// started() and start().
export function initRemote(act) {
  let on = false;
  const enable = () => {
    if (!on) { on = true; document.body.classList.add('remote'); }
    document.body.classList.add('using-pad');
  };
  if (isTV) { on = true; document.body.classList.add('remote'); }

  function scope() {
    return document.querySelector('dialog[open]') || document.querySelector('#lang-menu:not([hidden])')
      || document.querySelector('.pick-card') || act.calmBody()?.closest('#calm') || document;
  }
  const focusables = () => [...scope().querySelectorAll(FOCUSABLE)].filter(el => visible(el) && !el.closest('#labels'));

  // Somewhere sensible to start: the start button, the current screen's dock
  // button, or the first thing in a dialog or menu.
  function home(list) {
    let pick = list[0];
    if (scope() === document) pick = document.querySelector(act.started() ? '#dock [aria-current="page"]' : '#start') || pick;
    focus(pick);
  }
  function focus(el) {
    if (!el) return;
    el.focus({ focusVisible: true });
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  // The nearest element in that direction: distance along it, plus a heavy
  // penalty for being off to the side (none while the two overlap sideways).
  function move(dir) {
    const list = focusables(), cur = document.activeElement;
    if (!list.includes(cur)) return home(list);
    const [dx, dy] = DIRS[dir], a = cur.getBoundingClientRect();
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const ahead = dx ? (dx > 0 ? b.left - a.right : a.left - b.right) : (dy > 0 ? b.top - a.bottom : a.top - b.bottom);
      const centre = dx ? (b.left + b.right - a.left - a.right) * dx : (b.top + b.bottom - a.top - a.bottom) * dy;
      if (centre <= 0 || ahead < -Math.min(a.width, a.height, b.width, b.height) / 2) continue;
      const side = dx ? Math.max(0, a.top - b.bottom, b.top - a.bottom) : Math.max(0, a.left - b.right, b.left - a.right);
      const offset = dx ? Math.abs((b.top + b.bottom - a.top - a.bottom) / 2) : Math.abs((b.left + b.right - a.left - a.right) / 2);
      const score = Math.max(0, ahead) + side * 3 + offset * 0.1;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    focus(best);
  }

  // Held arrows in Explore spin the globe smoothly, speeding up a little.
  const held = new Set();
  let raf = 0, last = 0, since = 0;
  function spin(now) {
    if (!held.size || !act.exploring()) { held.clear(); raf = 0; return; }
    const dt = Math.min(now - last, 100) / 1000;
    last = now;
    const speed = 420 + Math.min(now - since, 1500) * 0.35; // px per second
    let x = 0, y = 0;
    for (const d of held) { x += DIRS[d][0]; y += DIRS[d][1]; }
    // Right looks east, up looks north (the opposite of dragging that way).
    if (x || y) act.pan(-x * speed * dt, -y * speed * dt);
    raf = requestAnimationFrame(spin);
  }

  const typing = () => document.activeElement?.matches?.('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]');

  addEventListener('keydown', e => {
    const key = keyOf(e);
    if (!key) return;
    if (!on) {
      // Desktop: turn on at up/down or a TV-only key; left/right keep switching screens.
      if (!(key === 'up' || key === 'down' || TV_ONLY.has(e.keyCode)) || typing()) return;
    }
    if (typing()) {
      // In a text box only up/down (leave it) and Back count.
      if (key === 'back') { e.preventDefault(); e.stopPropagation(); document.activeElement.blur(); }
      else if (key === 'up' || key === 'down') { e.preventDefault(); e.stopPropagation(); enable(); move(key); }
      return;
    }
    enable();
    const handled = () => { e.preventDefault(); e.stopPropagation(); };

    if (key === 'back' || key === 'backspace') {
      // At the top level, Back is left to the TV (exit or go back a page).
      if (act.back()) handled();
      return;
    }
    if (key === 'play') { handled(); act.playPause(); return; }
    if (!act.started()) {
      if (key === 'ok') { handled(); act.start(); }
      else if (DIRS[key]) { handled(); move(key); }
      return;
    }
    if (key === 'zoomIn' || key === 'zoomOut') { handled(); act.zoom(key === 'zoomIn' ? 0.8 : 1.25); return; }

    // Explore (nothing open over it): arrows spin, OK opens the centre spot.
    if (act.exploring() && scope() === document) {
      if (DIRS[key]) {
        handled();
        if (!held.has(key)) { held.add(key); if (!raf) { last = since = performance.now(); raf = requestAnimationFrame(spin); } }
      } else if (key === 'ok') { handled(); act.pickCenter(); setTimeout(() => focus(document.querySelector('.pick-card button')), 50); }
      return;
    }
    // Calm View: left/right change place, up/down scroll; OK presses a focused button.
    const calm = act.calmBody();
    if (calm && scope() === calm.closest('#calm')) {
      if (key === 'left' || key === 'right') { handled(); act.screen(key === 'right' ? 1 : -1); }
      else if (key === 'up' || key === 'down') { handled(); calm.scrollBy({ top: key === 'down' ? 160 : -160, behavior: 'smooth' }); }
      return;
    }
    const el = document.activeElement;
    if (key === 'ok') {
      // Enter doesn't toggle switches by itself.
      if (el?.matches?.('input[type="checkbox"], input[type="radio"]')) { handled(); el.click(); }
      else if (!el || el === document.body || !focusables().includes(el)) { handled(); home(focusables()); }
      return; // buttons and links press themselves on Enter
    }
    // A slider takes left/right; up/down leave it.
    if (el?.matches?.('input[type="range"]') && (key === 'left' || key === 'right')) {
      handled();
      el.value = Math.max(+el.min, Math.min(+el.max, +el.value + (key === 'right' ? 1 : -1)));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    handled();
    move(key);
  }, { capture: true });

  addEventListener('keyup', e => {
    const key = keyOf(e);
    if (key && DIRS[key]) held.delete(key);
  }, { capture: true });
  addEventListener('blur', () => held.clear());
}
