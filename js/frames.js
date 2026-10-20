// Plays a time series of map images (satellite rain, radar) on the globe.
//
// Two textures are cross-faded: A shows the current frame and B the next one,
// and the shader mixes them by `mix`. Frames are downloaded once as compressed
// blobs (a few hundred KB each) and only decoded when they're about to show,
// so a 16-frame loop doesn't pin hundreds of MB of bitmaps on a phone.

import * as THREE from 'three';

const FADE = 450;      // ms spent blending into the next frame
const HOLD = 250;      // ms each frame rests before blending onward
const HOLD_END = 1600; // pause on the newest frame before looping

// Frames become ImageBitmaps where the browser can: createImageBitmap decodes
// off the main thread and can flip and premultiply the pixels while it's at
// it, so sending them to the GPU is a plain copy. An <img> or canvas makes the
// browser do that conversion on the main thread during the upload, which took
// 20-35 ms per large radar frame: a visible stutter in the animation.
const BITMAP = { imageOrientation: 'flipY', premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' };
const canBitmap = typeof createImageBitmap === 'function';
const isBitmap = img => typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap;
async function toBitmap(src, opts = BITMAP) {
  if (!canBitmap) return null;
  try { return await createImageBitmap(src, opts); } catch { return null; }
}

// Premultiplied alpha gives clean filtering at rain edges (the shader
// un-premultiplies). Bitmaps arrive flipped and premultiplied already; WebGL
// ignores these two flags for them anyway.
function setImage(t, image) {
  t.image = image;
  t.flipY = t.premultiplyAlpha = !isBitmap(image);
  t.userData.size = [image.width, image.height]; // a closed bitmap reports 0
  t.needsUpdate = true;
}

function makeTexture(image) {
  const t = new THREE.Texture();
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  setImage(t, image);
  return t;
}

function emptyTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1; // transparent pixel until real imagery arrives
  return makeTexture(c);
}

// three.js allocates GPU storage at a texture's first size and can't resize
// it in place, so an image of a different size needs a new texture. The
// bitmap being replaced is already on the GPU, so its memory is freed now.
function withImage(tex, img) {
  const old = tex.image;
  const [w, h] = tex.userData.size;
  if (w === img.width && h === img.height) setImage(tex, img);
  else {
    tex.userData.disposed = true;
    tex.dispose();
    tex = makeTexture(img);
  }
  if (old !== img && isBitmap(old)) old.close();
  return tex;
}

const urlsOf = f => (f.image ? [] : [].concat(f.url ?? []).filter(Boolean));

export class FrameLayer {
  // forward: a forecast, which starts at "now" (its first frame) rather than
  // at the newest frame like the observed layers.
  // upload(texture): queue it for the GPU; resolves once it's there (globe.js
  // paces uploads to one per drawn frame).
  constructor({ onChange, onFrame, upload = async () => {}, forward = false }) {
    this.upload = upload;
    this.forward = forward;
    this.texA = emptyTexture();
    this.texB = emptyTexture();
    this.mix = 0;
    this.frames = [];        // [{ time: Date, url }]
    this.idx = -1;           // frame shown in texA
    this.bIdx = -1;          // frame loaded (or loading) into texB
    this.bReady = false;
    this.wait = 0;
    this.elapsed = 0;        // ms since this frame came on screen (see position)
    this.playing = true;
    this.blobs = new Map();  // remote url -> Promise<object URL>
    this.token = 0;
    this.onChange = onChange; // something visible changed: redraw
    this.onFrame = onFrame;   // (idx, count, time) for the timeline UI
  }

  // Swap in a fresh list of frames, keeping already-downloaded ones.
  // keepIndex: stay on the same frame (used when sharper frames for the same
  // times replace the current ones). box: the area these frames cover; it
  // takes effect when the first of them is actually on screen.
  async setFrames(frames, { keepIndex = false, box = null } = {}) {
    this.pendingBox = box;
    // A plain setFrames is a new "base" set (the whole area). keepIndex swaps
    // (sharper frames for the view) keep the base downloads, so zooming back
    // out is instant, and only drop the previous sharper set.
    const urls = frames.flatMap(urlsOf);
    if (!keepIndex) this.baseUrls = new Set(urls);
    const keep = new Set([...urls, ...(this.baseUrls ?? [])]);
    // Frames made in the page (OPERA) carry a make() that produces their blob.
    this.makers ??= new Map();
    for (const f of frames) if (f.make) this.makers.set(f.url, f.make);
    for (const url of this.makers.keys()) if (!keep.has(url)) this.makers.delete(url);
    for (const [url, p] of this.blobs) {
      if (!keep.has(url)) { p.then(u => u && URL.revokeObjectURL(u)); this.blobs.delete(url); }
    }
    this.frames = frames;
    if (!frames.length) { this.idx = -1; this.sync?.refresh(); this.onChange?.(); return; }
    // Show the newest observation (or, for a forecast, "now") straight away,
    // then fetch the rest in the background.
    const start = keepIndex && this.idx >= 0 ? Math.min(this.idx, frames.length - 1) : this.forward ? 0 : frames.length - 1;
    await this.seek(start);
    this.prefetch();
    this.sync?.refresh();
  }

  blob(url) {
    if (!this.blobs.has(url)) {
      const make = this.makers?.get(url);
      const blob = make ? make() : fetch(url).then(r => (r.ok ? r.blob() : null));
      this.blobs.set(url, blob.then(b => (b ? URL.createObjectURL(b) : null)).catch(() => null));
    }
    return this.blobs.get(url);
  }

  async prefetch() {
    // Two at a time, starting from the frame on screen and going the way the
    // loop plays, so the next frames are ready first.
    const from = Math.max(0, this.idx);
    const queue = [...this.frames.slice(from), ...this.frames.slice(0, from)].flatMap(urlsOf);
    const worker = async () => { while (queue.length) await this.blob(queue.shift()); };
    await Promise.all([worker(), worker()]);
  }

  // Decode one downloaded frame: as a texture-ready bitmap by default, or
  // unflipped (opts = {}) for drawing into a canvas.
  async load(url, opts = BITMAP) {
    const src = await this.blob(url);
    if (!src) return null;
    const bmp = await toBitmap(await (await fetch(src)).blob(), opts);
    if (bmp) return bmp;
    const img = new Image(); // browsers without createImageBitmap
    img.src = src;
    try { await img.decode(); } catch { return null; }
    return img;
  }

  // A frame is a ready image (drawn in the page), one URL, or several URLs
  // stacked into one picture (e.g. radar rain + snow). An optional
  // transform(canvas) recolours it (e.g. DWD's palette to ours). With
  // `coverage` (an opacity), the first URL is a map of where the radars see,
  // drawn beneath the rest at that opacity (see COVERAGE in recolour.js).
  async decode(i) {
    const f = this.frames[i];
    if (f.image) return (await toBitmap(f.image)) ?? f.image;
    const urls = urlsOf(f);
    if (urls.length === 1 && !f.transform) return this.load(urls[0]);
    const imgs = await Promise.all(urls.map(u => this.load(u, {})));
    const first = imgs.find(Boolean);
    if (!first) return null;
    const canvas = document.createElement('canvas');
    canvas.width = first.width; canvas.height = first.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: !!f.transform });
    const [under, layers] = f.coverage ? [imgs[0], imgs.slice(1)] : [null, imgs];
    for (const img of layers) if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (under) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.globalAlpha = f.coverage;
      ctx.drawImage(under, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    for (const img of imgs) if (isBitmap(img)) img.close();
    f.transform?.(ctx, canvas.width, canvas.height, f.box);
    return (await toBitmap(canvas)) ?? canvas;
  }

  // The time on screen (ms), gliding toward the next frame instead of jumping:
  // the share of this frame's rest and crossfade already done. It holds on the
  // newest frame, and short of the next one until that has arrived.
  position() {
    const f = this.frames[this.idx];
    if (!f) return null;
    const next = this.frames[this.idx + 1];
    if (!next) return +f.time;
    return +f.time + (next.time - f.time) * Math.min(0.97, this.elapsed / (HOLD + FADE));
  }

  async seek(i) {
    const token = ++this.token;
    const img = await this.decode(i);
    if (token !== this.token || !img) return;
    this.texA = withImage(this.texA, img);
    this.upload(this.texA);
    if (this.pendingBox) { this.box = this.pendingBox; this.pendingBox = null; }
    this.idx = i;
    this.mix = 0;
    this.elapsed = 0;
    this.bIdx = -1;
    this.bReady = false;
    this.wait = i === this.frames.length - 1 ? HOLD_END : HOLD;
    this.onFrame?.(i, this.frames.length, this.frames[i].time);
    this.onChange?.();
  }

  async loadNext(next = (this.idx + 1) % this.frames.length) {
    if (this.bIdx === next) return;
    this.bIdx = next;
    this.bReady = false;
    const token = this.token;
    const img = await this.decode(next);
    if (token !== this.token || this.bIdx !== next) return;
    if (!img) { this.bIdx = -1; return; } // missing frame: retried next tick
    this.texB = withImage(this.texB, img);
    // Ready once it's on the GPU, so the crossfade never waits on an upload.
    await this.upload(this.texB);
    if (token !== this.token || this.bIdx !== next) return;
    this.bReady = true;
  }

  // Newest frame at or before time t (ms); the first frame if t is earlier.
  frameAt(t) {
    let i = 0;
    while (i + 1 < this.frames.length && +this.frames[i + 1].time <= t + 60e3) i++;
    return i;
  }

  // Typical time between frames, in ms.
  stepMs() {
    const n = this.frames.length;
    return n > 1 ? (this.frames[n - 1].time - this.frames[0].time) / (n - 1) : 30 * 60e3;
  }

  // Finish the crossfade: the frame in B becomes the one shown.
  advance() {
    [this.texA, this.texB] = [this.texB, this.texA];
    this.idx = this.bIdx;
    this.mix = 0;
    this.elapsed = 0;
    this.bIdx = -1;
    this.bReady = false;
    this.onFrame?.(this.idx, this.frames.length, this.frames[this.idx].time);
  }

  // Advance by dt ms. Returns true when the picture changed (needs a redraw).
  // Layers in a FrameSync are driven by it instead.
  tick(dt) {
    if (this.sync || !this.playing || this.frames.length < 2 || this.idx < 0) return false;
    this.elapsed += dt;
    if (!this.bReady) this.loadNext(); // decode the next frame while this one rests
    if (this.wait > 0) { this.wait -= dt; return false; }
    if (!this.bReady) return false;
    this.mix = Math.min(1, this.mix + dt / FADE);
    if (this.mix >= 1) {
      this.advance();
      this.wait = this.idx === this.frames.length - 1 ? HOLD_END : HOLD;
    }
    return true;
  }
}

// Plays several observation layers (satellite rain and each radar) on one
// clock, so every region shows the same moment. Each source has its own scan
// interval and delay, and looping them separately let them drift apart: a
// storm crossing from France into Germany could appear at two different
// times on either side of the border.
//
// The clock steps through one window of real time: as long as the shortest
// layer's loop (two hours of radar), ending at the newest scan, in steps of
// the finest scan interval. At each step every layer shows its newest frame
// at or before that moment, holding a frame when its scans are further apart
// (or when, like the satellite, its data is older than the window).
export class FrameSync {
  // layers: { name: FrameLayer }; isOn(name): whether that layer is visible.
  // lead: a layer whose own frame times make the clock (the global forecast);
  // the others then show their frame for each of those times and are marked
  // hidden while the clock is outside their own range. forward: start at the
  // first step ("now", for a forecast) rather than the newest.
  constructor(layers, isOn, { lead = null, forward = false } = {}) {
    this.layers = Object.entries(layers);
    this.isOn = isOn;
    this.lead = lead;
    this.forward = forward;
    this.steps = [];  // clock times (ms), oldest first
    this.step = -1;   // index of the time on screen
    this.wait = 0;
    this.mix = 0;
    this.stall = 0;
    this.elapsed = 0; // ms since this step came on screen (see position)
    this.playing = true;
    for (const [, l] of this.layers) l.sync = this;
  }

  members() {
    return this.layers.filter(([name, l]) => l.frames.length && l.idx >= 0 && this.isOn(name)).map(([, l]) => l);
  }

  // Rebuild the timeline (layers loaded, switched or reloaded) and put every
  // layer on the frame for the current time.
  refresh() {
    const m = this.members();
    const was = this.steps[this.step];
    if (!m.length) { this.steps = []; this.step = -1; return; }
    const lead = this.layers.find(([name, l]) => name === this.lead && m.includes(l))?.[1];
    if (lead) this.steps = lead.frames.map(f => +f.time);
    else {
      const end = Math.max(...m.map(l => +l.frames.at(-1).time));
      const span = Math.min(...m.map(l => l.frames.at(-1).time - l.frames[0].time));
      const step = Math.max(60e3, Math.min(...m.map(l => l.stepMs())));
      const n = Math.max(1, Math.round(span / step));
      this.steps = Array.from({ length: n + 1 }, (_, k) => end - (n - k) * step);
    }
    this.step = was == null ? (this.forward ? 0 : this.steps.length - 1) : this.indexAt(was);
    this.place(m);
  }

  indexAt(t) {
    let i = 0;
    while (i + 1 < this.steps.length && this.steps[i + 1] <= t) i++;
    return i;
  }

  // With a lead layer, the others are hidden outside their own time range
  // (a regional forecast that ends sooner than the global one).
  mark(t) {
    if (!this.lead) return;
    for (const [, l] of this.layers) {
      l.hidden = !l.frames.length || t < +l.frames[0].time - l.stepMs() || t > +l.frames.at(-1).time + l.stepMs();
    }
  }

  place(m = this.members()) {
    const t = this.steps[this.step];
    this.mark(t);
    for (const l of m) l.mix = 0;
    for (const l of m) if (l.frameAt(t) !== l.idx) l.seek(l.frameAt(t));
    this.mix = 0;
    this.stall = 0;
    this.elapsed = 0;
    this.wait = this.step === this.steps.length - 1 ? HOLD_END : HOLD;
  }

  // The clock's time (ms), gliding toward the next step like
  // FrameLayer.position, so the timeline moves smoothly.
  position() {
    const t = this.steps[this.step];
    if (t == null) return null;
    const next = this.steps[this.step + 1];
    if (next == null) return t;
    return t + (next - t) * Math.min(0.97, this.elapsed / (HOLD + FADE));
  }

  // A timeline slider moved: jump every layer to that frame's time.
  seekTime(t) {
    if (!this.steps.length) return;
    this.step = this.indexAt(t);
    this.place();
  }

  // Advance by dt ms. Returns true when the picture changed.
  tick(dt) {
    if (!this.playing || this.steps.length < 2) return false;
    const m = this.members();
    if (!m.length) return false;
    this.elapsed += dt;
    const next = (this.step + 1) % this.steps.length;
    const t = this.steps[next];
    const moving = m.filter(l => l.frameAt(t) !== l.idx);
    for (const l of moving) l.loadNext(l.frameAt(t)); // decode while this step rests
    if (this.wait > 0) { this.wait -= dt; return false; }
    const ready = l => l.bReady && l.bIdx === l.frameAt(t);
    // Every layer moves together; a frame that won't load (a gap in a
    // source's archive) is left behind after a few seconds, not waited on.
    if (!moving.every(ready) && (this.stall += dt) < 3000) return false;
    const go = moving.filter(ready);
    this.mix = Math.min(1, this.mix + dt / FADE);
    for (const l of go) l.mix = this.mix;
    if (this.mix >= 1) {
      for (const l of go) l.advance();
      for (const l of moving) if (!ready(l)) l.mix = 0;
      this.step = next;
      this.mark(t);
      this.mix = 0;
      this.stall = 0;
      this.elapsed = 0;
      this.wait = next === this.steps.length - 1 ? HOLD_END : HOLD;
    }
    return go.length > 0;
  }
}
