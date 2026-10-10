// Game controller support (Xbox, PlayStation, Switch Pro and other pads the
// browser reports in the "standard" layout). Polled every frame, but only
// while a controller is connected.
//
//   Left stick ........ spin the globe        Right stick / triggers ... zoom
//   LB / RB, D-pad ←→ . previous/next screen  D-pad ↑↓ ... move between buttons
//   A .... press the selected button, or pick the spot in the screen's centre
//   B .... back (close menus, popups, Explore)   X .... Explore (hide the UI)
//   Y .... Globe screen   Start .... Settings   Select/View .... play/pause rain

const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DEAD = 0.15;
const REPEAT_DELAY = 420, REPEAT_RATE = 140; // held D-pad repeats like a key

const FOCUSABLE = 'button, input, select, a[href], [tabindex]:not([tabindex="-1"])';
const visible = el => !el.disabled && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden'
  && !el.closest('[hidden], [inert]') && el.getBoundingClientRect().width > 0;

export function initGamepad(act) {
  let running = false, last = 0;
  const prev = [];          // previous pressed state per button
  const held = {};          // button -> next repeat time

  function focusables() {
    // Inside an open dialog or menu, stay within it; otherwise the whole page
    // minus the globe's city labels (those are reached with the stick + A).
    const scope = document.querySelector('dialog[open]') || document.querySelector('#lang-menu:not([hidden])') || document;
    return [...scope.querySelectorAll(FOCUSABLE)].filter(el => visible(el) && !el.closest('#labels'));
  }
  function moveFocus(dir) {
    const list = focusables();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const next = list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length];
    document.body.classList.add('using-pad');
    next.focus({ focusVisible: true });
    next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  const focusedRange = () => document.activeElement?.matches?.('input[type="range"]') ? document.activeElement : null;
  function stepRange(r, dir) {
    r.value = Math.max(+r.min, Math.min(+r.max, +r.value + dir));
    r.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function rumble(pad) {
    pad.vibrationActuator?.playEffect?.('dual-rumble', { duration: 35, strongMagnitude: 0.15, weakMagnitude: 0.3 }).catch?.(() => {});
  }

  function press(b, pad) {
    if (!act.started()) { if (b === B.A || b === B.START) { act.start(); rumble(pad); } return; }
    const range = focusedRange();
    switch (b) {
      case B.A: {
        const el = document.activeElement;
        if (el && el !== document.body && el.matches(FOCUSABLE) && visible(el)) el.click();
        else act.pickCenter();
        rumble(pad);
        break;
      }
      case B.B: act.back(); break;
      case B.X: act.explore(); break;
      case B.Y: act.globeView(); break;
      case B.START: act.settings(); break;
      case B.SELECT: act.playPause(); break;
      case B.LB: act.screen(-1); break;
      case B.RB: act.screen(1); break;
      case B.UP: moveFocus(-1); break;
      case B.DOWN: moveFocus(1); break;
      case B.LEFT: if (range) stepRange(range, -1); else act.screen(-1); break;
      case B.RIGHT: if (range) stepRange(range, 1); else act.screen(1); break;
    }
  }

  function poll(now) {
    if (!running) return;
    requestAnimationFrame(poll);
    const dt = Math.min(now - last, 100) / 1000;
    last = now;
    const pad = [...(navigator.getGamepads?.() || [])].find(p => p && p.connected);
    if (!pad) return;
    const axis = i => { const v = pad.axes[i] || 0; return Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD); };

    // Sticks: squared response for fine control near the centre.
    const lx = axis(0), ly = axis(1);
    // Stick right/up looks east/north, the opposite of dragging that way.
    if (lx || ly) act.pan(-Math.sign(lx) * lx * lx * 900 * dt, -Math.sign(ly) * ly * ly * 900 * dt);
    const val = i => pad.buttons[i]?.value || 0;
    const zoom = axis(3) + val(B.LT) - val(B.RT); // right stick down / LT = out, RT = in
    if (Math.abs(zoom) > 0.02) act.zoom(Math.exp(zoom * 1.6 * dt));

    // Buttons: act on press, and repeat while the D-pad is held.
    pad.buttons.forEach((btn, i) => {
      const down = btn.pressed;
      if (down && !prev[i]) { press(i, pad); held[i] = now + REPEAT_DELAY; }
      else if (down && i >= B.UP && i <= B.RIGHT && now >= held[i]) { press(i, pad); held[i] = now + REPEAT_RATE; }
      prev[i] = down;
    });
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(poll);
  }
  addEventListener('gamepadconnected', () => { start(); act.connected(true); });
  addEventListener('gamepaddisconnected', () => {
    if (![...(navigator.getGamepads?.() || [])].some(p => p && p.connected)) { running = false; act.connected(false); }
  });
  // A pad that was already connected before the page loaded.
  if ([...(navigator.getGamepads?.() || [])].some(p => p && p.connected)) start();
  // Mouse or touch use hides the controller focus ring again.
  addEventListener('pointerdown', () => document.body.classList.remove('using-pad'));
}
