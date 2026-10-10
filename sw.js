// Service worker for the home-screen app.
//
// - App files (this folder): network first, so a new deploy shows up right
//   away; the cached copy is only used when offline.
// - Files that never change: NASA's two whole-globe textures (several MB),
//   the version-pinned three.js library and the web fonts. Cache first, so
//   the globe appears instantly on launch and the app can start offline.
// - Everything else (forecasts, radar, satellite frames): straight to the
//   network and never cached, so weather is never stale.

const CACHE = 'global-forecast-v1';
const IMMUTABLE = /BlueMarble_NextGeneration&WIDTH=4096|VIIRS_Black_Marble&WIDTH=4096|cdn\.jsdelivr\.net\/npm\/three@|fonts\.(googleapis|gstatic)\.com/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const appFile = url.origin === location.origin && url.pathname.startsWith(new URL('./', location).pathname);
  if (appFile) e.respondWith(networkFirst(req));
  else if (IMMUTABLE.test(req.url)) e.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
