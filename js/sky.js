// The night sky around the globe: constellations (bright stars as RA hours,
// Dec degrees, J2000) and where the naked-eye planets are today.

export const CONSTELLATIONS = {
  dipper: {
    stars: [[11.062, 61.75], [11.031, 56.38], [11.897, 53.69], [12.257, 57.03], [12.900, 55.96], [13.399, 54.93], [13.792, 49.31]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]],
  },
  orion: {
    // Betelgeuse, Bellatrix, Mintaka, Alnilam, Alnitak, Saiph, Rigel, Meissa
    stars: [[5.919, 7.41], [5.419, 6.35], [5.533, -0.30], [5.604, -1.20], [5.679, -1.94], [5.796, -9.67], [5.242, -8.20], [5.585, 9.93]],
    lines: [[7, 0], [7, 1], [0, 4], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6]],
  },
  littleDipper: {
    // Polaris, Yildun, ε, ζ, Kochab, Pherkad, η
    stars: [[2.530, 89.26], [17.537, 86.59], [16.766, 82.04], [15.734, 77.79], [14.845, 74.16], [15.345, 71.83], [16.292, 75.76]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]],
  },
  cassiopeia: {
    // Caph, Schedar, γ, Ruchbah, Segin: the W
    stars: [[0.153, 59.15], [0.675, 56.54], [0.945, 60.72], [1.430, 60.24], [1.907, 63.67]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  cygnus: {
    // Deneb, Sadr, Albireo, Gienah, δ: the Northern Cross
    stars: [[20.690, 45.28], [20.370, 40.26], [19.512, 27.96], [20.770, 33.97], [19.750, 45.13]],
    lines: [[0, 1], [1, 2], [1, 3], [1, 4]],
  },
  lyra: {
    // Vega, ε, ζ, δ, Sulafat, Sheliak
    stars: [[18.616, 38.78], [18.739, 39.67], [18.746, 37.61], [18.908, 36.90], [18.982, 32.69], [18.835, 33.36]],
    lines: [[0, 1], [0, 2], [2, 3], [3, 4], [4, 5], [5, 2]],
  },
  leo: {
    // Regulus, η, Algieba, Adhafera, μ, ε, Zosma, Chertan, Denebola
    stars: [[10.139, 11.97], [10.122, 16.76], [10.333, 19.84], [10.278, 23.42], [9.880, 26.01], [9.764, 23.77], [11.235, 20.52], [11.237, 15.43], [11.818, 14.57]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 8], [8, 7], [7, 0]],
  },
  gemini: {
    // Castor, Pollux, τ, Mebsuta, μ, υ, Wasat, ζ, Alhena
    stars: [[7.577, 31.89], [7.755, 28.03], [7.186, 30.25], [6.732, 25.13], [6.383, 22.51], [7.598, 26.90], [7.335, 21.98], [7.068, 20.57], [6.629, 16.40]],
    lines: [[0, 1], [0, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [7, 8]],
  },
  taurus: {
    // Aldebaran, θ, γ, δ, ε (the Hyades V), Elnath, ζ (the horns)
    stars: [[4.599, 16.51], [4.477, 15.87], [4.330, 15.63], [4.382, 17.54], [4.477, 19.18], [5.438, 28.61], [5.627, 21.14]],
    lines: [[6, 0], [0, 1], [1, 2], [2, 3], [3, 4], [4, 5]],
  },
  pleiades: {
    // Alcyone, Atlas, Electra, Maia, Merope, Taygeta: a cluster, no lines
    stars: [[3.791, 24.11], [3.819, 24.05], [3.747, 24.11], [3.763, 24.37], [3.773, 23.95], [3.754, 24.47]],
    lines: [],
  },
  canisMajor: {
    // Sirius, Mirzam, Adhara, Wezen, Aludra, Furud
    stars: [[6.752, -16.72], [6.378, -17.96], [6.977, -28.97], [7.140, -26.39], [7.402, -29.30], [6.338, -30.06]],
    lines: [[1, 0], [0, 3], [3, 2], [2, 5], [3, 4]],
  },
  scorpius: {
    // Antares, σ, Dschubba, Graffias, π, τ, ε, μ, ζ, η, Sargas, ι, κ, Shaula, Lesath
    stars: [[16.490, -26.43], [16.353, -25.59], [16.006, -22.62], [16.091, -19.81], [15.981, -26.11], [16.598, -28.22], [16.836, -34.29], [16.864, -38.05],
      [16.910, -42.36], [17.203, -43.24], [17.622, -43.00], [17.793, -40.13], [17.708, -39.03], [17.560, -37.10], [17.513, -37.30]],
    lines: [[3, 2], [2, 4], [2, 1], [1, 0], [0, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14]],
  },
  crux: {
    // Acrux, Mimosa, Gacrux, δ: the Southern Cross
    stars: [[12.443, -63.10], [12.795, -59.69], [12.519, -57.11], [12.252, -58.75]],
    lines: [[0, 2], [1, 3]],
  },
};

// Keplerian elements and their rates per century (JPL, E. M. Standish; good
// to a fraction of a degree from 1800 to 2050): a (au), e, I, L, long. of
// perihelion, long. of ascending node (degrees).
const ELEMENTS = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
};

// How each planet looks: colour and size (Venus brightest; Uranus and Neptune,
// too faint to see by eye, are small markers).
export const PLANETS = {
  venus: { color: 0xfff6dc, size: 3.2 },
  jupiter: { color: 0xffe9c4, size: 2.8 },
  mars: { color: 0xff8a5c, size: 2.2 },
  saturn: { color: 0xf3d9a0, size: 2.2 },
  mercury: { color: 0xd9d4cc, size: 1.7 },
  uranus: { color: 0xa9e6ef, size: 1.4 },
  neptune: { color: 0x7fa2ff, size: 1.4 },
};

const D2R = Math.PI / 180;

// Heliocentric ecliptic position (au) of a planet, T in Julian centuries since J2000.
function helio(name, T) {
  const [el, rate] = ELEMENTS[name];
  const [a, e, I, L, peri, node] = el.map((v, i) => v + rate[i] * T);
  const M = (((L - peri) % 360) + 360) % 360 * D2R;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 6; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const w = (peri - node) * D2R, O = node * D2R, inc = I * D2R;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(inc), si = Math.sin(inc);
  return [
    (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
    (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

// Where each planet appears from Earth: { name: { ra (hours), dec (degrees) } }.
export function planetPositions(date = new Date()) {
  const T = (date.getTime() / 864e5 + 2440587.5 - 2451545) / 36525;
  const eps = 23.43928 * D2R;
  const [ex, ey, ez] = helio('earth', T);
  const out = {};
  for (const name of Object.keys(PLANETS)) {
    const [px, py, pz] = helio(name, T);
    const x = px - ex, y = py - ey, z = pz - ez;
    const ye = y * Math.cos(eps) - z * Math.sin(eps), ze = y * Math.sin(eps) + z * Math.cos(eps);
    out[name] = { ra: ((Math.atan2(ye, x) / D2R + 360) % 360) / 15, dec: Math.atan2(ze, Math.hypot(x, ye)) / D2R };
  }
  return out;
}

// Where the Moon appears from Earth's centre (good to well under a degree):
// { ra (hours), dec (degrees), km }. The main terms of the lunar theory.
export function moonPosition(date = new Date()) {
  const d = date.getTime() / 864e5 + 2440587.5 - 2451545;
  const r = x => (((x % 360) + 360) % 360) * D2R;
  const L = r(218.316 + 13.176396 * d), M = r(134.963 + 13.064993 * d), F = r(93.272 + 13.22935 * d);
  const D = r(297.850 + 12.190749 * d), Ms = r(357.529 + 0.98560028 * d);
  const lon = L + D2R * (6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D) + 0.214 * Math.sin(2 * M) - 0.186 * Math.sin(Ms) - 0.114 * Math.sin(2 * F));
  const lat = D2R * (5.128 * Math.sin(F) + 0.281 * Math.sin(M + F) + 0.278 * Math.sin(M - F) + 0.173 * Math.sin(2 * D - F));
  const km = 385001 - 20905 * Math.cos(M) - 3699 * Math.cos(2 * D - M) - 2956 * Math.cos(2 * D);
  const eps = 23.43928 * D2R;
  const x = Math.cos(lat) * Math.cos(lon), y = Math.cos(lat) * Math.sin(lon), z = Math.sin(lat);
  const ye = y * Math.cos(eps) - z * Math.sin(eps), ze = y * Math.sin(eps) + z * Math.cos(eps);
  return { ra: ((Math.atan2(ye, x) / D2R + 360) % 360) / 15, dec: Math.asin(ze) / D2R, km };
}
