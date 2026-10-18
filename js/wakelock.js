// "Keep screen on": the Screen Wake Lock API stops the screen dimming or
// sleeping while the page is showing, with no change to the device's own
// settings. Browsers drop the lock whenever the page is hidden (another tab,
// minimized, screen locked), so it's taken again each time it comes back.
export const wakeSupported = 'wakeLock' in navigator;

const wanted = new Set(); // who wants it: the setting, Span all screens...
let lock = null, asking = null;

// Resolves true when the screen is being kept on. One request at a time, so
// two callers can't each end up holding a lock.
function take() {
  if (!wanted.size || document.visibilityState !== 'visible') return Promise.resolve(false);
  if (lock) return Promise.resolve(true);
  asking ??= navigator.wakeLock.request('screen').then(l => {
    lock = l;
    l.addEventListener('release', () => { if (lock === l) lock = null; });
    if (!wanted.size) { l.release(); lock = null; } // switched off while asking
    return !!lock;
  }, () => false) // refused (battery saver, browser policy...): tried again on return
    .finally(() => { asking = null; });
  return asking;
}

// on: keep the screen on for `who`, or stop when no one wants it any more.
// Resolves whether the screen is now being kept on.
export async function keepAwake(who, on) {
  if (!wakeSupported) return false;
  if (on) wanted.add(who); else wanted.delete(who);
  if (wanted.size) return take();
  lock?.release(); lock = null;
  return false;
}

if (wakeSupported) document.addEventListener('visibilitychange', take);
