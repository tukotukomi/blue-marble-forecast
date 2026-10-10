// Recolouring of map images that use a fixed set of class colours (DWD's
// radar and forecast products) onto the app's radar palette. DWD doesn't
// allow custom styles on its server, so this runs in the page.
//
// classes: [[hex, [r, g, b, alpha] | null], ...]; null makes a class
// transparent (e.g. "no data" shading or a coverage outline).
export function recolourer(classes) {
  const table = classes.map(([hex, to]) => [
    parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4), 16), to,
  ]);
  return function recolour(ctx, W, H) {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const memo = new Map();
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
      if (!to) { d[i + 3] = 0; continue; }
      d[i] = to[0]; d[i + 1] = to[1]; d[i + 2] = to[2];
      d[i + 3] = Math.round(to[3] * 255);
    }
    ctx.putImageData(img, 0, 0);
  };
}

// DWD radar reflectivity classes (dBZ). The grey is "outside radar range";
// the bright magenta class doubles as the coverage outline, so both go.
export const recolourDwdRadar = recolourer([
  ['7D7D7D', null],                    // no data
  ['FFFFFF', null],                    // < 7 dBZ
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
]);

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
