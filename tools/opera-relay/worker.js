// Cloudflare Worker: a read-only relay for EUMETNET OPERA's open radar data.
//
// OPERA publishes its 1 km European radar composite (CC BY 4.0) in a public
// bucket that doesn't send CORS headers, so browsers can't read it directly.
// This Worker forwards requests for those files only, adds CORS, passes
// Range requests through (the site reads just the parts of each GeoTIFF it
// needs) and lets Cloudflare cache each file. No processing happens here.
//
// Deploy: Cloudflare dashboard > Workers & Pages > Create > Worker > paste
// this file > Deploy. Then put its URL in weather/js/opera.js (OPERA_RELAY).

const BUCKET = 'https://s3.waw3-1.cloudferro.com/openradar-24h/';
// Only the reflectivity composite, e.g. 2026/10/10/OPERA/COMP/OPERA@20261010T1710@0@DBZH.tiff
const ALLOWED = /^\d{4}\/\d{2}\/\d{2}\/OPERA\/COMP\/OPERA@\d{8}T\d{4}@0@DBZH\.tiff$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Max-Age': '86400' } });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: CORS });
    }
    const path = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (!ALLOWED.test(path)) return new Response('Not found', { status: 404, headers: CORS });

    const range = request.headers.get('Range');
    const upstream = await fetch(BUCKET + path, {
      method: request.method,
      headers: range ? { Range: range } : {},
      // Files never change once published: cache them at Cloudflare's edge.
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
    const response = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(CORS)) response.headers.set(k, v);
    if (upstream.ok) response.headers.set('Cache-Control', 'public, max-age=86400, immutable');
    return response;
  },
};
