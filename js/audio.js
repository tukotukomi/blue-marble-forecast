// An original, synthesized smooth-jazz loop plus soft UI blips, made with the
// Web Audio API (no audio files). It nods to the laid-back mood of TV weather
// music without copying any existing composition.

let ctx, master, timer, step = 0, nextTime = 0, playing = false;
const BPM = 88, SPB = 60 / BPM / 4; // seconds per 16th note

const midi = n => 440 * 2 ** ((n - 69) / 12);

// Two-bar phrases; each chord lasts one bar. Voicings are MIDI notes.
const CHORDS = [
  { root: 41, notes: [57, 60, 64, 67] },     // Fmaj9
  { root: 40, notes: [55, 59, 62, 64] },     // Em7
  { root: 38, notes: [53, 57, 60, 64] },     // Dm9
  { root: 43, notes: [53, 57, 59, 64] },     // G13
  { root: 46, notes: [57, 60, 62, 65] },     // Bbmaj7(#11-ish)
  { root: 45, notes: [55, 60, 64, 67] },     // Am7
  { root: 43, notes: [58, 62, 65, 69] },     // Gm9
  { root: 36, notes: [58, 62, 65, 67] },     // C9sus
];
const SCALE = [65, 67, 69, 72, 74, 76, 77, 79]; // F major pentatonic-ish for the lead

// Deterministic "random" so the melody repeats like a real loop.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const MELODY = Array.from({ length: 128 }, (_, i) => {
  if (i % 16 === 0 || rand() > (i % 4 === 0 ? 0.55 : 0.82)) return null;
  return SCALE[Math.floor(rand() * SCALE.length)];
});

function ensure() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
}

function epiano(freq, t, dur, vel = 0.12) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.01);
  g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = freq;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.003;
  const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.3, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  o1.connect(g); o2.connect(g2).connect(g); g.connect(master);
  o1.start(t); o2.start(t); o1.stop(t + dur); o2.stop(t + dur);
}

function bass(freq, t, dur) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
  o.connect(f).connect(g).connect(master);
  o.start(t); o.stop(t + dur);
}

let noiseBuf;
function hat(t, vel) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  s.connect(f).connect(g).connect(master);
  s.start(t); s.stop(t + 0.08);
}

function schedule() {
  while (nextTime < ctx.currentTime + 0.15) {
    const s = step % 128, bar = Math.floor(s / 16), pos = s % 16;
    const chord = CHORDS[bar % CHORDS.length];
    const swing = pos % 2 === 1 ? SPB * 0.28 : 0;
    const t = nextTime + swing;
    if (pos === 0 || pos === 10) chord.notes.forEach((n, i) => epiano(midi(n), t + i * 0.012, pos === 0 ? 1.6 : 0.9, pos === 0 ? 0.07 : 0.045));
    if (pos === 0) bass(midi(chord.root), t, 0.7);
    if (pos === 8) bass(midi(chord.root + 7), t, 0.5);
    if (pos === 14) bass(midi(chord.root + (bar % 2 ? 5 : 10)), t, 0.25);
    if (pos % 2 === 0) hat(t, pos % 4 === 2 ? 0.05 : 0.025);
    const m = MELODY[s];
    if (m) epiano(midi(m + 12), t, 0.7, 0.05);
    nextTime += SPB;
    step++;
  }
}

export function setMusic(on) {
  ensure();
  if (ctx.state === 'suspended') ctx.resume();
  if (on && !playing) {
    playing = true;
    nextTime = ctx.currentTime + 0.05;
    timer = setInterval(schedule, 40);
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.2);
  } else if (!on && playing) {
    playing = false;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    setTimeout(() => !playing && clearInterval(timer), 450);
  }
}

// Short bubbly blips for hover/select, like the console's menu sounds.
export function blip(kind = 'hover') {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  const [a, b] = kind === 'select' ? [880, 1320] : [1200, 1500];
  o.frequency.setValueAtTime(a, t);
  o.frequency.exponentialRampToValueAtTime(b, t + 0.05);
  g.gain.setValueAtTime(kind === 'select' ? 0.08 : 0.03, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'select' ? 0.18 : 0.08));
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + 0.2);
}

export function unlock() { ensure(); if (ctx.state === 'suspended') ctx.resume(); }
