// Builds app/www, the web files bundled inside the iOS app, from the site in
// the repo root. The site itself is unchanged; this copy differs only in:
// - three.js comes from the app instead of a CDN, so the globe starts offline;
// - the Capacitor plugins the app uses (location) are bundled into
//   vendor/native.js, which js/native.js finds as window.BMFNative.
// Run with `npm run build` (or `npm run sync` to also copy it into Xcode).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..');
const out = path.join(here, 'www');
const mod = (...p) => path.join(here, 'node_modules', ...p);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// The site's files (not the service worker: the app doesn't need one).
for (const name of ['index.html', 'styles.css', 'favicon.svg', 'manifest.webmanifest', 'icons', 'img', 'js', 'strings', 'data']) {
  fs.cpSync(path.join(site, name), path.join(out, name), { recursive: true });
}

// three.js, the same version the site loads from jsDelivr.
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
fs.mkdirSync(path.join(out, 'vendor/three/addons'), { recursive: true });
fs.copyFileSync(mod('three/build/three.module.min.js'), path.join(out, 'vendor/three/three.module.min.js'));
fs.cpSync(mod('three/examples/jsm/lines'), path.join(out, 'vendor/three/addons/lines'), { recursive: true });

// Capacitor's location plugin, as one plain script.
await build({
  stdin: { contents: "import { Geolocation } from '@capacitor/geolocation'; window.BMFNative = { Geolocation };", resolveDir: here },
  bundle: true, format: 'iife', minify: true, target: 'safari15',
  outfile: path.join(out, 'vendor/native.js'),
  logLevel: 'warning',
});

// index.html: local three.js, and the plugin script before the app starts.
const htmlFile = path.join(out, 'index.html');
let html = fs.readFileSync(htmlFile, 'utf8');
const before = html;
html = html.replaceAll(`${THREE_CDN}build/three.module.min.js`, './vendor/three/three.module.min.js')
  .replaceAll(`${THREE_CDN}examples/jsm/`, './vendor/three/addons/')
  .replace('<script type="importmap">', '<script src="vendor/native.js"></script>\n  <script type="importmap">');
if (html === before || html.includes(THREE_CDN)) throw new Error('index.html: three.js links not found; update build-www.mjs');
fs.writeFileSync(htmlFile, html);

const size = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`app/www built: ${(size(out) / 1e6).toFixed(1)} MB`);
