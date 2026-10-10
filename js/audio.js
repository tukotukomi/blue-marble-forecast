// An original, synthesized vaporwave loop plus soft UI blips, made with the
// Web Audio API (no audio files). Slow, floating major-9th chords, washy pads,
// a mellow electric piano, a sparse bell melody, a big reverb and a gentle
// "worn cassette" pitch wobble. It's an original piece: no samples, and no
// existing composition is copied.

let ctx, master, dry, reverbSend, delaySend, wow, timer, step = 0, nextTime = 0, playing = false;
const BPM = 70, SPB = 60 / BPM / 4; // seconds per 16th note
const STEPS_PER_CHORD = 32;         // two bars per chord

const midi = n => 440 * 2 ** ((n - 69) / 12);

// Planing major-9th chords (a vaporwave staple) resolving to a minor 9th.
const CHORDS = [
  { root: 41, notes: [57, 60, 64, 67], bell: [72, 76, 79, 81, 84] }, // Fmaj9
  { root: 39, notes: [55, 58, 62, 65], bell: [70, 74, 77, 79, 82] }, // Ebmaj9
  { root: 37, notes: [53, 56, 60, 63], bell: [68, 72, 75, 77, 80] }, // Dbmaj9
  { root: 36, notes: [51, 55, 58, 62], bell: [70, 72, 75, 79, 82] }, // Cm9
];

// Deterministic "random" so the melody repeats like a real loop.
let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const LOOP = CHORDS.length * STEPS_PER_CHORD;
const MELODY = Array.from({ length: LOOP }, (_, i) => {
  const pos = i % STEPS_PER_CHORD;
  // Sparse: a few notes per two bars, mostly on gentle off-beats.
  const chance = [0, 6, 10, 20, 26].includes(pos) ? 0.6 : pos % 4 === 2 ? 0.08 : 0;
  if (rand() >= chance) return null;
  const pool = CHORDS[Math.floor(i / STEPS_PER_CHORD)].bell;
  return pool[Math.floor(rand() * pool.length)];
});

// A synthetic room: stereo noise with an exponential tail.
function impulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}

function ensure() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  // A soft low-pass on everything gives the muffled, taped-off-TV tone.
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass'; tone.frequency.value = 5200; tone.Q.value = 0.4;
  const comp = ctx.createDynamicsCompressor();
  master.connect(tone).connect(comp).connect(ctx.destination);

  dry = ctx.createGain(); dry.gain.value = 0.7; dry.connect(master);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(4.5, 2.6);
  reverbSend = ctx.createGain(); reverbSend.gain.value = 0.9;
  const wet = ctx.createGain(); wet.gain.value = 0.55;
  reverbSend.connect(reverb).connect(wet).connect(master);

  // Dotted-eighth echo with darkening repeats.
  const delay = ctx.createDelay(2);
  delay.delayTime.value = SPB * 3;
  const fb = ctx.createGain(); fb.gain.value = 0.42;
  const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2200;
  delaySend = ctx.createGain(); delaySend.gain.value = 1;
  delaySend.connect(delay).connect(damp).connect(fb).connect(delay);
  damp.connect(reverbSend);
  damp.connect(master);

  // Tape wow: one slow LFO bends the pitch of every voice by a few cents.
  wow = ctx.createGain(); wow.gain.value = 9; // cents
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.31;
  lfo.connect(wow); lfo.start();

  crackle();
}

// Route a voice: dry plus reverb (and optionally echo) sends.
function out(node, { rev = 0.5, echo = 0 } = {}) {
  node.connect(dry);
  const r = ctx.createGain(); r.gain.value = rev; node.connect(r).connect(reverbSend);
  if (echo) { const e = ctx.createGain(); e.gain.value = echo; node.connect(e).connect(delaySend); }
}

function osc(type, freq, t, end, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.value = freq; o.detune.value = detune;
  wow.connect(o.detune);
  o.start(t); o.stop(end);
  o.onended = () => wow.disconnect(o.detune);
  return o;
}

// Wide, slow-blooming pad: two detuned saws per note through a soft filter.
function pad(notes, t, dur) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.045, t + 1.8);
  g.gain.setValueAtTime(0.045, t + dur - 0.2);
  g.gain.linearRampToValueAtTime(0, t + dur + 2.2);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.Q.value = 0.7;
  f.frequency.setValueAtTime(500, t);
  f.frequency.linearRampToValueAtTime(1400, t + dur * 0.6);
  f.frequency.linearRampToValueAtTime(700, t + dur + 2);
  const end = t + dur + 2.4;
  for (const n of notes) for (const d of [-8, 8]) osc('sawtooth', midi(n), t, end, d).connect(f);
  f.connect(g);
  out(g, { rev: 0.9 });
}

// Mellow electric piano: sine body plus a quick bell-like overtone.
function epiano(freq, t, dur, vel) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.015);
  g.gain.exponentialRampToValueAtTime(vel * 0.3, t + 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const end = t + dur + 0.05;
  osc('sine', freq, t, end).connect(g);
  const tine = ctx.createGain();
  tine.gain.setValueAtTime(0.25, t); tine.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc('sine', freq * 3.01, t, end).connect(tine).connect(g);
  out(g, { rev: 0.6, echo: 0.25 });
}

// Glassy bell for the melody, drenched in echo.
function bell(freq, t) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.05, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
  osc('sine', freq, t, t + 2.5).connect(g);
  const h = ctx.createGain(); h.gain.value = 0.3;
  osc('triangle', freq * 2, t, t + 2.5).connect(h).connect(g);
  out(g, { rev: 0.8, echo: 0.6 });
}

function bass(freq, t, dur) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.2, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc('sine', freq, t, t + dur + 0.05).connect(g);
  out(g, { rev: 0.05 });
}

let noiseBuf;
function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  return s;
}

// Soft 80s drum machine.
function kick(t) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
  o.connect(g); o.start(t); o.stop(t + 0.4);
  g.connect(dry);
}
function snare(t) {
  const s = noise();
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  s.connect(f).connect(g); s.start(t); s.stop(t + 0.3);
  out(g, { rev: 1.4 }); // the big, washy snare
}
function hat(t, vel) {
  const s = noise();
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  s.connect(f).connect(g); s.start(t); s.stop(t + 0.08);
  out(g, { rev: 0.2 });
}

// Faint vinyl crackle under everything: sparse random clicks, looped.
function crackle() {
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) if (Math.random() < 0.0004) d[i] = (Math.random() * 2 - 1) * (0.3 + Math.random() * 0.7);
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500; f.Q.value = 0.5;
  const g = ctx.createGain(); g.gain.value = 0.05;
  s.connect(f).connect(g).connect(master);
  s.start();
}

function schedule() {
  while (nextTime < ctx.currentTime + 0.2) {
    const s = step % LOOP;
    const ci = Math.floor(s / STEPS_PER_CHORD), pos = s % STEPS_PER_CHORD, beat = pos % 16;
    const chord = CHORDS[ci];
    const swing = pos % 2 === 1 ? SPB * 0.22 : 0;
    const t = nextTime + swing;

    if (pos === 0) pad(chord.notes, t, SPB * STEPS_PER_CHORD);
    // Lazy, syncopated piano stabs: on the one, then pushed ahead of beat 3.
    if (pos === 0 || pos === 7 || pos === 22) {
      chord.notes.forEach((n, i) => epiano(midi(n), t + i * 0.018, pos === 0 ? 2.2 : 1.2, pos === 0 ? 0.04 : 0.028));
    }
    if (pos === 0) bass(midi(chord.root), t, SPB * 12);
    if (pos === 14) bass(midi(chord.root + 7), t, SPB * 2);
    if (pos === 16) bass(midi(chord.root), t, SPB * 10);
    if (beat === 0 || beat === 10) kick(t);
    if (beat === 4 || beat === 12) snare(t);
    if (beat % 4 === 2) hat(t, 0.018);

    const m = MELODY[s];
    if (m) bell(midi(m), t);
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
    timer = setInterval(schedule, 50);
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.85, ctx.currentTime + 2.5);
  } else if (!on && playing) {
    playing = false;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
    setTimeout(() => !playing && clearInterval(timer), 650);
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
