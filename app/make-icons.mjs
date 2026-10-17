// Draws the iOS app icon and launch screen from the site's icon art
// (icons/icon.svg) into the Xcode asset catalog. Run with `npm run icons`
// after changing the art.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const svg = path.resolve(here, '../icons/icon.svg');
const assets = path.join(here, 'ios/App/App/Assets.xcassets');
const SPACE = '#050b18'; // the app's background (capacitor.config.json)

// App icon: 1024 px, square and opaque (iOS rounds the corners itself).
await sharp(svg, { density: 1024 / 512 * 72 }).resize(1024, 1024).flatten({ background: SPACE }).png()
  .toFile(path.join(assets, 'AppIcon.appiconset/AppIcon-512@2x.png'));

// Launch screen: the icon, rounded like on the home screen, in the middle of
// dark space. The picture fills the screen and is cropped to its shape, so
// the icon stays well inside the centre.
const S = 2732, I = 560, R = I * 0.225;
const mask = Buffer.from(`<svg width="${I}" height="${I}"><rect width="${I}" height="${I}" rx="${R}" ry="${R}"/></svg>`);
const icon = await sharp(svg, { density: I / 512 * 72 }).resize(I, I).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
const splash = await sharp({ create: { width: S, height: S, channels: 3, background: SPACE } })
  .composite([{ input: icon, left: (S - I) / 2, top: (S - I) / 2 }]).png().toBuffer();
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await sharp(splash).toFile(path.join(assets, 'Splash.imageset', name));
}
console.log('icon and launch screen written');
