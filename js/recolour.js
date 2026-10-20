// Recolouring of map images that use a fixed set of class colours (DWD's
// radar and forecast products) onto the app's radar palette. DWD doesn't
// allow custom styles on its server, so this runs in the page.
//
// Radar images also mark where their radars can see: covered but dry pixels
// get this faint alpha instead of 0. globe.js reads it to hide the layers
// beneath only where a radar really covers (not across its whole rectangle,
// which cut rain off along straight lines), and never draws it.
export const COVERAGE = 4 / 255;

// For radar with no coverage map (NOAA nowCOAST, the U.S. fallback): treat
// its whole image as covered, as before.
export function coverAll(ctx, W, H) {
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = `rgba(0, 0, 0, ${COVERAGE})`;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
}

// classes: [[hex, [r, g, b, alpha] | 'dry' | null], ...]. null makes a class
// transparent (e.g. "no data" shading or a coverage outline); 'dry' marks a
// covered pixel with no rain.
// coverage: the area of the radar network's grid ({ w, s, e, n }). Transparent
// pixels are then marked covered when they're enclosed by the "no data"
// classes (inside the radars' range) rather than reachable from the grid's
// outer edge (outside the grid). For a zoomed-in frame (box) only the image
// sides that lie on that outer edge count.
export function recolourer(classes, { coverage = null } = {}) {
  const table = classes.map(([hex, to]) => [
    parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4), 16), to,
  ]);
  const COV = Math.round(COVERAGE * 255);
  return function recolour(ctx, W, H, box = coverage) {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const memo = new Map();
    // Per pixel: 0 transparent, 1 no coverage, 2 rain or dry (covered).
    const kind = coverage ? new Uint8Array(W * H) : null;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      let to = memo.get(key);
      if (to === undefined) {
        // Nearest class colour (images are crisp, but this tolerates edges).
        let best = table[0], bd = Infinity;
        for (const c of table) {
          const dd = (c[0] - d[i]) ** 2 + (c[1] - d[i + 1]) ** 2 + (c[2] - d[i + 2]) ** 2;
          if (dd < bd) { bd = dd; best = c; }
        }
        to = best[3];
        memo.set(key, to);
      }
      if (kind) kind[i >> 2] = to ? 2 : 1;
      if (!to) { d[i + 3] = 0; continue; }
      if (to === 'dry') { d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = COV; continue; }
      d[i] = to[0]; d[i + 1] = to[1]; d[i + 2] = to[2];
      d[i + 3] = Math.max(COV, Math.round(to[3] * 255));
    }
    if (kind) markEnclosed(kind, d, W, H, COV, edgesOn(box ?? coverage, coverage));
    ctx.putImageData(img, 0, 0);
  };
}

// Which sides of an image of `box` lie on the outer edge of `bounds`.
function edgesOn(box, bounds) {
  const on = (a, b) => Math.abs(a - b) < 0.05;
  return { w: on(box.w, bounds.w), e: on(box.e, bounds.e), s: on(box.s, bounds.s), n: on(box.n, bounds.n) };
}

// Transparent pixels that can't be reached from the grid's outer edge without
// crossing a coloured one are inside the radar range: mark them covered.
function markEnclosed(kind, d, W, H, COV, sides) {
  const outside = new Uint8Array(W * H), queue = new Int32Array(W * H);
  let head = 0, tail = 0;
  const visit = p => { if (kind[p] === 0 && !outside[p]) { outside[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < W; x++) { if (sides.n) visit(x); if (sides.s) visit((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { if (sides.w) visit(y * W); if (sides.e) visit(y * W + W - 1); }
  while (head < tail) {
    const p = queue[head++], x = p % W;
    if (x > 0) visit(p - 1);
    if (x < W - 1) visit(p + 1);
    if (p >= W) visit(p - W);
    if (p < W * (H - 1)) visit(p + W);
  }
  for (let p = 0; p < W * H; p++) if (kind[p] === 0 && !outside[p]) d[p * 4 + 3] = COV;
}

// DWD radar reflectivity classes (dBZ). The grey is "outside radar range";
// the bright magenta class doubles as the coverage outline, so both go.
export const recolourDwdRadar = recolourer([
  ['7D7D7D', null],                    // no data (outside radar range)
  ['FFFFFF', 'dry'],                   // < 7 dBZ
  ['99FFFF', [120, 200, 255, 0.55]],   // 7-9.5
  ['33FFFF', [90, 180, 255, 0.7]],     // 9.5-12
  ['00CACA', [80, 170, 255, 0.8]],     // 12-14.5
  ['009934', [40, 190, 90, 0.85]],     // 14.5-19
  ['4DBF1A', [40, 200, 90, 0.85]],     // 19-23.5
  ['99CC00', [150, 215, 60, 0.86]],    // 23.5-28
  ['CCE600', [250, 220, 40, 0.88]],    // 28-32.5
  ['FFFF00', [250, 190, 30, 0.9]],     // 32.5-37
  ['FFC400', [250, 150, 20, 0.9]],     // 37-41.5
  ['FF8900', [250, 100, 20, 0.92]],    // 41.5-46
  ['FF0000', [230, 30, 40, 0.95]],     // 46-50.5
  ['B40000', [200, 30, 110, 0.97]],    // 50.5-55
  ['4848FF', [200, 40, 200, 1]],       // 55-60
  ['0000CA', [220, 90, 240, 1]],       // 60-65
  ['990099', [235, 140, 255, 1]],      // 65-75
  ['FF33FF', null],                    // 75-85, used for the coverage outline
  ['000000', null],
], { coverage: { w: 1.46, s: 45.68, e: 18.73, n: 56.22 } }); // DE_RADAR_BOX in data.js

// DWD ICON-EU hourly rain classes (mm in the past hour).
export const recolourDwdRain = recolourer([
  ['C0C0C0', [80, 170, 255, 0.78]],    // 0.1-2
  ['FEFEC0', [40, 200, 90, 0.85]],     // 2-5
  ['FEFE5B', [250, 220, 40, 0.88]],    // 5-10
  ['CFF200', [250, 150, 20, 0.9]],     // 10-15
  ['A0D625', [250, 100, 20, 0.92]],    // 15-20
  ['36C969', [230, 30, 40, 0.95]],     // 20-25
  ['00D7D7', [215, 25, 60, 0.95]],     // 25-30
  ['00A6DD', [200, 30, 110, 0.97]],    // 30-40
  ['0000FE', [200, 40, 200, 1]],       // 40-60
  ['9730C2', [220, 90, 240, 1]],       // 60-80
  ['D926C7', [235, 140, 255, 1]],      // 80-100
  ['FE0000', [245, 190, 255, 1]],      // 100-130
  ['A00000', [250, 220, 255, 1]],      // 130-160
  ['606060', [255, 240, 255, 1]],      // 160+
]);

// Environment Canada GDPS precipitation rate (mm/h, its PRECIPPRTMMH style).
// The two faintest classes (under 0.1 mm/h) are left out: drawn, they cover
// half the world in a thin haze.
export const recolourGdpsRain = recolourer([
  ['00007F', null],                    // 0.01-0.05
  ['0000E7', null],                    // 0.05-0.1
  ['007EFD', [120, 200, 255, 0.6]],    // 0.1-0.5
  ['19FCE4', [80, 170, 255, 0.78]],    // 0.5-1
  ['98FD65', [40, 200, 90, 0.85]],     // 1-5
  ['FDE400', [250, 220, 40, 0.88]],    // 5-10
  ['FD6500', [250, 150, 20, 0.9]],     // 10-20
  ['E70000', [230, 30, 40, 0.95]],     // 20-50
  ['7F0000', [200, 40, 200, 1]],       // 50+
]);
