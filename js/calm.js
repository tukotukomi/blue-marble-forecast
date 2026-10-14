// The animated sky behind Calm View: a gradient for the time of day and the
// weather, then sun or moon and stars, drifting clouds, and rain, snow, fog
// or lightning to match the current conditions (WMO weather codes, as
// Open-Meteo reports them).
//
// Plain 2D canvas. Particle counts scale with the screen and are capped, the
// pixel ratio is limited, it only runs while Calm View is open, and with
// "reduce motion" it draws a single still frame.

const SKIES = {
  // Top, middle, bottom. Kept mid-toned so white text stays readable.
  clear: { day: ['#2a72cf', '#4f9be3', '#86c4f0'], night: ['#040a1d', '#0b1838', '#1b305c'] },
  partly: { day: ['#356fae', '#5a92c8', '#8db6dc'], night: ['#070d22', '#111d3b', '#22345a'] },
  cloudy: { day: ['#4a6380', '#66809c', '#8ea3b8'], night: ['#0c1322', '#182235', '#2a374d'] },
  fog: { day: ['#5b6875', '#76838e', '#97a2ab'], night: ['#121822', '#202834', '#333d4a'] },
  rain: { day: ['#2f4258', '#465b72', '#667b90'], night: ['#090e19', '#131c2b', '#222f42'] },
  snow: { day: ['#56708c', '#7590ac', '#9db3c8'], night: ['#172133', '#26344b', '#3e5170'] },
  storm: { day: ['#1a2231', '#29354a', '#405066'], night: ['#04070d', '#0d121d', '#1a2130'] },
};

// What to draw for a weather code: cloud cover 0..1 (and how dark), rain or
// snow intensity 0..1, fog 0..1, lightning, and whether the sun/moon and
// stars show through.
export function sceneFor(code, isDay) {
  const c = +code;
  let s;
  if (c >= 95) s = { kind: 'storm', clouds: 1, dark: 0.85, rain: c >= 96 ? 1 : 0.8, lightning: true };
  else if ((c >= 71 && c <= 77) || c === 85 || c === 86) s = { kind: 'snow', clouds: 0.85, dark: 0.25, snow: c === 75 || c === 86 ? 1 : c === 71 || c === 77 ? 0.45 : 0.7 };
  else if (c >= 51 && c <= 57) s = { kind: 'rain', clouds: 0.85, dark: 0.45, rain: 0.25, drizzle: true };
  else if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) s = { kind: 'rain', clouds: 1, dark: 0.6, rain: c === 65 || c === 82 ? 1 : c === 61 || c === 80 ? 0.45 : 0.7 };
  else if (c === 45 || c === 48) s = { kind: 'fog', clouds: 0.3, dark: 0.2, fog: 1 };
  else if (c === 3) s = { kind: 'cloudy', clouds: 1, dark: 0.4 };
  else if (c === 2) s = { kind: 'partly', clouds: 0.5, dark: 0.1, sky: true };
  else if (c === 1) s = { kind: 'partly', clouds: 0.22, dark: 0, sky: true };
  else s = { kind: 'clear', clouds: 0, dark: 0, sky: true };
  return { rain: 0, snow: 0, fog: 0, lightning: false, drizzle: false, sky: false, ...s, isDay: !!isDay };
}

const rand = (a, b) => a + Math.random() * (b - a);

// Soft cloud sprites: overlapping round puffs, drawn once (light and dark).
function cloudSprite(tone) {
  const c = document.createElement('canvas');
  c.width = 500; c.height = 290; // room for every puff's soft edge
  const g = c.getContext('2d');
  // A cumulus shape: big overlapping puffs in the middle, smaller toward the
  // ends, over a soft flat base.
  const N = 13;
  const puffs = Array.from({ length: N }, (_, i) => {
    const m = Math.sin(Math.PI * (i + 0.5) / N);
    return [90 + (i * 320) / (N - 1) + rand(-8, 8), 150 - m * rand(20, 45), 30 + m * rand(35, 50)];
  });
  puffs.push([250, 178, 95], [175, 180, 70], [325, 180, 70]);
  for (const [x, y, r] of puffs) {
    const grad = g.createRadialGradient(x, y, r * 0.2, x, y, r);
    grad.addColorStop(0, tone);
    grad.addColorStop(1, tone.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return c;
}

export function createCalmSky(canvas) {
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sprites = { light: [0, 1, 2].map(() => cloudSprite('rgba(255,255,255,0.55)')), dark: [0, 1, 2].map(() => cloudSprite('rgba(150,162,180,0.5)')) };
  let W = 0, H = 0, dpr = 1, sky = null, scene = sceneFor(0, true), wind = 8;
  // With a horizon (a fraction of the height), the sky, sun or moon, stars,
  // clouds and fog fade out toward it so the planet below shows; rain and snow
  // keep falling over it. null: the sky fills the whole screen.
  let horizon = null, fade = null;
  let clouds = [], drops = [], flakes = [], stars = [], fogs = [];
  let raf = 0, last = 0, t = 0, flash = 0, nextFlash = 3000, bolt = null;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  // (Re)populate everything for the current scene and screen size.
  function build() {
    const cols = SKIES[scene.kind][scene.isDay ? 'day' : 'night'];
    const top = horizon ? H * horizon : H; // where the sky ends
    sky = ctx.createLinearGradient(0, 0, 0, top);
    sky.addColorStop(0, cols[0]); sky.addColorStop(0.55, cols[1]); sky.addColorStop(1, cols[2]);
    const area = (W * H) / (390 * 844); // ~1 on a phone
    const n = (k, cap) => Math.min(cap, Math.round(k * Math.max(0.6, area)));
    clouds = Array.from({ length: Math.ceil(n(10, 18) * scene.clouds) }, () => ({
      x: rand(-0.3, 1.1) * W, y: rand(-0.08, 0.55) * top, s: rand(0.7, 1.7) * Math.max(0.8, W / 700),
      v: rand(0.5, 1.2), sprite: Math.floor(rand(0, 3)), a: rand(0.55, 1),
    }));
    drops = Array.from({ length: n((scene.drizzle ? 170 : 360) * scene.rain, 520) }, () => ({ x: rand(0, W), y: rand(0, H), l: rand(10, 22) * (scene.drizzle ? 0.5 : 1), v: rand(0.9, 1.3) }));
    flakes = Array.from({ length: n(170 * scene.snow, 260) }, () => ({ x: rand(0, W), y: rand(0, H), r: rand(1.2, 3.4), v: rand(0.5, 1), p: rand(0, Math.PI * 2) }));
    const starry = !scene.isDay && scene.sky;
    stars = starry ? Array.from({ length: n(160, 260) }, () => ({ x: rand(0, W), y: rand(0, top * 0.75), r: rand(0.4, 1.4), w: rand(0.5, 2), p: rand(0, 6) })) : [];
    fogs = Array.from({ length: scene.fog ? 6 : 0 }, (_, i) => ({ x: rand(0, W), y: top * (0.25 + i * 0.13), rx: rand(0.5, 0.9) * W, ry: rand(40, 90), v: rand(0.3, 0.7) }));
    // Keeps the sky layer opaque high up and fades it out toward the horizon.
    fade = horizon ? ctx.createLinearGradient(0, 0, 0, H) : null;
    if (fade) {
      fade.addColorStop(0, '#000');
      fade.addColorStop(Math.max(0, horizon - 0.14), '#000');
      fade.addColorStop(Math.min(1, horizon + 0.01), 'rgba(0,0,0,0)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
    }
  }

  function lightning(dt) {
    nextFlash -= dt;
    if (nextFlash <= 0) {
      flash = 1;
      nextFlash = rand(3500, 9000);
      // A forked bolt from the cloud base, some of the time.
      if (Math.random() < 0.7) {
        const pts = [[rand(0.15, 0.85) * W, H * 0.12]];
        while (pts.at(-1)[1] < H * rand(0.45, 0.7)) pts.push([pts.at(-1)[0] + rand(-40, 40), pts.at(-1)[1] + rand(20, 50)]);
        bolt = { pts, life: 1 };
      }
    }
    flash = Math.max(0, flash - dt / 380);
    if (bolt) bolt.life -= dt / 260;
  }

  function draw(dt) {
    t += dt;
    const k = dt / 16.7; // motion per 60 fps frame
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Stars (clear or partly cloudy nights), twinkling.
    for (const s of stars) {
      ctx.globalAlpha = 0.45 + 0.45 * Math.sin(t / 1000 * s.w + s.p);
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // Sun or moon, when the sky shows.
    if (scene.sky) {
      const cx = W * 0.8, cy = H * 0.16, R = Math.min(W, H);
      if (scene.isDay) {
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.55);
        glow.addColorStop(0, 'rgba(255,248,220,0.95)'); glow.addColorStop(0.08, 'rgba(255,240,190,0.55)'); glow.addColorStop(1, 'rgba(255,240,190,0)');
        ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(t / 60000);
        ctx.fillStyle = 'rgba(255,250,230,0.05)';
        for (let i = 0; i < 12; i++) { ctx.rotate(Math.PI / 6); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R * 0.9, -R * 0.06); ctx.lineTo(R * 0.9, R * 0.06); ctx.fill(); }
        ctx.restore();
      } else {
        const r = Math.max(22, R * 0.045);
        const glow = ctx.createRadialGradient(cx, cy, r, cx, cy, r * 6);
        glow.addColorStop(0, 'rgba(220,230,255,0.25)'); glow.addColorStop(1, 'rgba(220,230,255,0)');
        ctx.fillStyle = glow; ctx.fillRect(cx - r * 6, cy - r * 6, r * 12, r * 12);
        ctx.fillStyle = '#f3f1e8'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(190,190,180,0.35)';
        for (const [dx, dy, rr] of [[-0.3, -0.2, 0.22], [0.25, 0.15, 0.16], [-0.05, 0.35, 0.12]]) { ctx.beginPath(); ctx.arc(cx + dx * r, cy + dy * r, rr * r, 0, Math.PI * 2); ctx.fill(); }
      }
    }

    // Clouds drift with the wind; dark ones under rain and storms.
    for (const c of clouds) {
      c.x += (0.12 + wind * 0.02) * c.v * k;
      const img = (scene.dark > 0.35 ? sprites.dark : sprites.light)[c.sprite];
      const w = img.width * c.s, h = img.height * c.s;
      if (c.x > W + 20) c.x = -w - rand(0, W * 0.3);
      ctx.globalAlpha = c.a * (scene.dark > 0.35 ? (scene.isDay ? 0.85 : 0.5) : 0.85);
      ctx.drawImage(img, c.x, c.y, w, h);
    }
    ctx.globalAlpha = 1;

    // Fog banks.
    for (const f of fogs) {
      f.x += f.v * k;
      if (f.x - f.rx > W) f.x = -f.rx;
      // A circle squashed into a wide, flat bank.
      const cy = f.y * f.rx / f.ry;
      ctx.save(); ctx.scale(1, f.ry / f.rx);
      const g = ctx.createRadialGradient(f.x, cy, 0, f.x, cy, f.rx);
      g.addColorStop(0, 'rgba(235,240,245,0.22)'); g.addColorStop(1, 'rgba(235,240,245,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.x, cy, f.rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }

    // Lightning: a bolt and a flash across the sky.
    if (scene.lightning) {
      lightning(dt);
      if (bolt && bolt.life > 0) {
        ctx.save();
        ctx.strokeStyle = `rgba(235,240,255,${bolt.life})`; ctx.lineWidth = 2.2;
        ctx.shadowColor = 'rgba(190,210,255,0.9)'; ctx.shadowBlur = 16;
        ctx.beginPath(); bolt.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
        ctx.restore();
      }
      if (flash > 0) { ctx.fillStyle = `rgba(225,232,255,${flash * 0.35})`; ctx.fillRect(0, 0, W, H); }
    }

    // With a horizon, everything so far fades out toward it.
    if (fade) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }

    // Rain: slanted streaks, all in one stroke.
    if (drops.length) {
      const slant = Math.min(0.45, wind * 0.012);
      ctx.strokeStyle = scene.isDay ? 'rgba(220,232,250,0.5)' : 'rgba(170,190,220,0.45)';
      ctx.lineWidth = scene.drizzle ? 1 : 1.3;
      ctx.beginPath();
      for (const d of drops) {
        const v = (scene.drizzle ? 7 : 15) * d.v * k;
        d.y += v; d.x += v * slant;
        if (d.y > H) { d.y = -d.l; d.x = rand(-W * 0.2, W); }
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * slant, d.y + d.l);
      }
      ctx.stroke();
    }

    // Snow: soft flakes swaying as they fall.
    if (flakes.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      for (const f of flakes) {
        f.y += 1.1 * f.v * k; f.p += 0.02 * k;
        f.x += (Math.sin(f.p) * 0.6 + wind * 0.01) * k;
        if (f.y > H + 5) { f.y = -5; f.x = rand(0, W); }
        ctx.moveTo(f.x + f.r, f.y); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(now - (last || now), 50);
    last = now;
    draw(dt);
  }

  new ResizeObserver(() => { if (raf || still) { resize(); if (still) draw(0); } }).observe(canvas);

  return {
    // code/isDay: Open-Meteo's current weather_code and is_day; wind in km/h.
    setWeather(code, isDay, windKmh = 8) {
      scene = sceneFor(code, isDay);
      wind = windKmh;
      if (W) build();
      if (still && W) draw(0);
    },
    start() {
      resize();
      if (still) { draw(0); return; }
      if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
    },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    // A fraction of the height where the sky ends (the planet look), or null.
    setHorizon(fraction) {
      if (horizon === fraction) return;
      horizon = fraction;
      if (W) build();
      if (still && W) draw(0);
    },
  };
}
