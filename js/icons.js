// Glossy, chunky weather icons in the spirit of the original channel.
// Every icon is drawn in a 100x100 viewBox. Gradient ids are made unique per
// instance so many icons can live on one page without clashing.

let uid = 0;

// WMO weather interpretation codes (used by NOAA GFS output) -> icon + label.
const WMO = {
  0: ['clear', 'Clear'],
  1: ['mostly-clear', 'Mostly Clear'],
  2: ['partly', 'Partly Cloudy'],
  3: ['cloud', 'Cloudy'],
  45: ['fog', 'Fog'],
  48: ['fog', 'Freezing Fog'],
  51: ['drizzle', 'Light Drizzle'],
  53: ['drizzle', 'Drizzle'],
  55: ['drizzle', 'Heavy Drizzle'],
  56: ['sleet', 'Freezing Drizzle'],
  57: ['sleet', 'Freezing Drizzle'],
  61: ['rain', 'Light Rain'],
  63: ['rain', 'Rain'],
  65: ['heavy-rain', 'Heavy Rain'],
  66: ['sleet', 'Freezing Rain'],
  67: ['sleet', 'Freezing Rain'],
  71: ['snow', 'Light Snow'],
  73: ['snow', 'Snow'],
  75: ['snow', 'Heavy Snow'],
  77: ['snow', 'Snow Grains'],
  80: ['showers', 'Showers'],
  81: ['rain', 'Rain Showers'],
  82: ['heavy-rain', 'Heavy Showers'],
  85: ['snow', 'Snow Showers'],
  86: ['snow', 'Heavy Snow Showers'],
  95: ['thunder', 'Thunderstorms'],
  96: ['thunder', 'Storms with Hail'],
  99: ['thunder', 'Severe Storms'],
};

export function describe(code, isDay = true) {
  const [kind, label] = WMO[code] ?? ['cloud', 'Unknown'];
  let key = kind;
  if (kind === 'clear') key = isDay ? 'sun' : 'moon';
  if (kind === 'mostly-clear') key = isDay ? 'sun-cloud' : 'moon-cloud';
  if (kind === 'partly') key = isDay ? 'partly-day' : 'partly-night';
  if (kind === 'showers') key = isDay ? 'showers-day' : 'rain';
  return { key, label, kind };
}

// Rough "how bad is it" ordering, used to pick the representative code for a
// block of hours (the worst weather in the block wins, like a TV forecast).
export function severity(code) {
  if (code >= 95) return 9;
  if ([65, 82, 75, 86].includes(code)) return 8;
  if ([66, 67, 56, 57].includes(code)) return 7;
  if ([71, 73, 77, 85].includes(code)) return 6;
  if ([61, 63, 80, 81].includes(code)) return 5;
  if (code >= 51 && code <= 55) return 4;
  if (code === 45 || code === 48) return 3;
  return code; // 0..3
}

function defs(id) {
  return `<defs>
    <radialGradient id="sun${id}" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#fffbd0"/><stop offset=".45" stop-color="#ffd84a"/><stop offset="1" stop-color="#ff9a1f"/>
    </radialGradient>
    <linearGradient id="ray${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe066"/><stop offset="1" stop-color="#ffab2e"/>
    </linearGradient>
    <radialGradient id="moon${id}" cx="35%" cy="30%" r="80%">
      <stop offset="0" stop-color="#fffbe0"/><stop offset=".6" stop-color="#ffe9a0"/><stop offset="1" stop-color="#e9be4f"/>
    </radialGradient>
    <linearGradient id="cl${id}" gradientUnits="userSpaceOnUse" x1="0" y1="26" x2="0" y2="78">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#eef3fa"/><stop offset="1" stop-color="#c9d5e6"/>
    </linearGradient>
    <linearGradient id="cd${id}" gradientUnits="userSpaceOnUse" x1="0" y1="26" x2="0" y2="78">
      <stop offset="0" stop-color="#b9c4d4"/><stop offset=".7" stop-color="#8d9ab0"/><stop offset="1" stop-color="#6e7b92"/>
    </linearGradient>
    <linearGradient id="dr${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9fe0ff"/><stop offset="1" stop-color="#1f8be8"/>
    </linearGradient>
    <linearGradient id="bo${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff59a"/><stop offset="1" stop-color="#ffb800"/>
    </linearGradient>
  </defs>`;
}

function sun(id, cx = 50, cy = 50, s = 1) {
  const rays = Array.from({ length: 8 }, (_, i) =>
    `<rect x="-4.5" y="-41" width="9" height="15" rx="4.5" fill="url(#ray${id})" stroke="#f08a12" stroke-width="1.6" transform="rotate(${i * 45})"/>`
  ).join('');
  return `<g transform="translate(${cx} ${cy}) scale(${s})">
    <g class="wx-spin">${rays}</g>
    <circle r="23" fill="url(#sun${id})" stroke="#f08a12" stroke-width="2.4"/>
    <ellipse cx="-8" cy="-10" rx="8" ry="4.5" fill="#fff" opacity=".75" transform="rotate(-30 -8 -10)"/>
  </g>`;
}

function moon(id, cx = 50, cy = 50, s = 1) {
  return `<g transform="translate(${cx} ${cy}) scale(${s})">
    <mask id="mm${id}"><rect x="-40" y="-40" width="80" height="80" fill="#fff"/><circle cx="13" cy="-9" r="20" fill="#000"/></mask>
    <circle r="25" fill="url(#moon${id})" stroke="#d29b26" stroke-width="2.4" mask="url(#mm${id})"/>
    <ellipse cx="-12" cy="-4" rx="4" ry="8" fill="#fff" opacity=".6" transform="rotate(20 -12 -4)"/>
  </g>`;
}

function stars() {
  return `<g fill="#fff6c4" class="wx-twinkle">
    <path d="M80 18l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
    <path d="M88 40l1.3 3.2 3.2 1.3-3.2 1.3-1.3 3.2-1.3-3.2-3.2-1.3 3.2-1.3z"/>
  </g>`;
}

// A cloud is built from overlapping circles: first an enlarged copy in the
// outline colour, then the fill on top, so the union gets one clean outline.
function cloud(id, tx = 0, ty = 0, s = 1, dark = false) {
  const parts = [
    ['c', 32, 60, 15], ['c', 53, 47, 21], ['c', 73, 60, 14], ['r', 30, 56, 46, 20, 10],
  ];
  const shape = (grow, fill) => parts.map(p => p[0] === 'c'
    ? `<circle cx="${p[1]}" cy="${p[2]}" r="${p[3] + grow}" fill="${fill}"/>`
    : `<rect x="${p[1] - grow}" y="${p[2] - grow}" width="${p[3] + grow * 2}" height="${p[4] + grow * 2}" rx="${p[5] + grow}" fill="${fill}"/>`
  ).join('');
  const stroke = dark ? '#56627a' : '#8fa3c0';
  return `<g transform="translate(${tx} ${ty}) translate(50 50) scale(${s}) translate(-50 -50)">
    ${shape(2.6, stroke)}${shape(0, `url(#${dark ? 'cd' : 'cl'}${id})`)}
    <ellipse cx="46" cy="36" rx="11" ry="5" fill="#fff" opacity="${dark ? .35 : .9}" transform="rotate(-18 46 36)"/>
  </g>`;
}

function drops(id, n, small = false) {
  const xs = n === 2 ? [40, 62] : n === 3 ? [34, 52, 70] : [28, 42, 56, 70];
  return xs.map((x, i) => {
    const s = small ? 0.6 : 1;
    return `<g class="wx-drop" style="animation-delay:${i * 0.27}s"><path transform="translate(${x} ${84 + (i % 2) * 5}) scale(${s})"
      d="M0-8C3.8-2.5 5.5.8 5.5 3.2A5.5 5.5 0 0 1-5.5 3.2C-5.5.8-3.8-2.5 0-8Z" fill="url(#dr${id})" stroke="#1769c2" stroke-width="1.4"/></g>`;
  }).join('');
}

function flakes(xs) {
  return xs.map(([x, y], i) => `<g class="wx-flake" style="animation-delay:${i * 0.4}s"><g transform="translate(${x} ${y})">
    <circle r="5.2" fill="#fff" stroke="#7fa6d6" stroke-width="1.6"/>
    <circle r="1.6" cx="-1.4" cy="-1.4" fill="#dbe9ff"/></g></g>`).join('');
}

function bolt(id) {
  return `<path class="wx-flash" d="M54 62 42 82h9l-5 16 16-22h-9l6-14z" fill="url(#bo${id})" stroke="#e08a00" stroke-width="2" stroke-linejoin="round"/>`;
}

function fogLines() {
  return [74, 83, 92].map((y, i) => `<rect x="${18 + i * 6}" y="${y}" width="${64 - i * 8}" height="5" rx="2.5" fill="#d7dfea" stroke="#97a6bd" stroke-width="1.2"/>`).join('');
}

const DRAW = {
  'sun': id => sun(id),
  'moon': id => moon(id) + stars(),
  'sun-cloud': id => sun(id, 42, 42, 0.95) + cloud(id, 18, 22, 0.55),
  'moon-cloud': id => moon(id, 42, 40, 0.95) + cloud(id, 18, 22, 0.55),
  'partly-day': id => sun(id, 36, 34, 0.8) + cloud(id, 6, 10, 0.85),
  'partly-night': id => moon(id, 34, 32, 0.8) + cloud(id, 6, 10, 0.85),
  'cloud': id => cloud(id, 0, 6, 1.05),
  'fog': id => cloud(id, 0, -8, 0.95) + fogLines(),
  'drizzle': id => cloud(id, 0, -8, 0.95) + drops(id, 3, true),
  'showers-day': id => sun(id, 30, 30, 0.7) + cloud(id, 4, -2, 0.9) + drops(id, 3),
  'rain': id => cloud(id, 0, -8, 0.95, false) + drops(id, 3),
  'heavy-rain': id => cloud(id, 0, -8, 0.95, true) + drops(id, 4),
  'sleet': id => cloud(id, 0, -8, 0.95) + drops(id, 2, true) + flakes([[51, 88]]),
  'snow': id => cloud(id, 0, -8, 0.95) + flakes([[32, 84], [51, 92], [70, 84]]),
  'thunder': id => cloud(id, 0, -10, 0.95, true) + bolt(id),
};

export function iconSVG(key, { size = 64, label = '' } = {}) {
  const id = `w${++uid}`;
  const body = (DRAW[key] ?? DRAW.cloud)(id);
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="wx-icon" viewBox="0 0 100 100" width="${size}" height="${size}" ${a11y}>${defs(id)}${body}</svg>`;
}

export function iconFor(code, isDay, opts = {}) {
  const d = describe(code, isDay);
  return iconSVG(d.key, { label: d.label, ...opts });
}
