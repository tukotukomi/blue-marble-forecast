// The iOS app (app/, a Capacitor shell) runs this same code, served from
// capacitor://localhost. These are the few places where it differs.
export const isApp = location.protocol === 'capacitor:';

// Location. In the app it goes through Capacitor's native plugin (bundled as
// window.BMFNative by app/build-www.mjs): one iOS prompt, with the app's own
// message. In browsers it's the web API.
const plugin = () => (isApp ? window.BMFNative?.Geolocation : null);

export const geoAvailable = () => !!plugin() || !!navigator.geolocation;

// 'granted', 'denied', 'prompt' or 'unknown'.
export async function geoPermission() {
  try {
    if (plugin()) {
      const p = (await plugin().checkPermissions()).location;
      return p === 'granted' || p === 'denied' ? p : 'prompt';
    }
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch { return 'unknown'; }
}

// Resolves { lat, lon }; rejects with { denied } (true if the person said no).
export async function getPosition({ timeout = 10000, maximumAge = 10 * 60e3 } = {}) {
  if (plugin()) {
    try {
      const p = await plugin().getCurrentPosition({ timeout, maximumAge, enableHighAccuracy: false });
      return { lat: p.coords.latitude, lon: p.coords.longitude };
    } catch {
      throw { denied: (await geoPermission()) === 'denied' };
    }
  }
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
    e => reject({ denied: e.code === 1 }),
    { timeout, maximumAge }));
}
