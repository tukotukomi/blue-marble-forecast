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

function makeTexture(image) {
  const t = new THREE.Texture(image);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function emptyTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1; // transparent pixel until real imagery arrives
  return makeTexture(c);
}

// three.js allocates GPU storage at a texture's first size and can't resize
// it in place, so an image of a different size needs a new texture.
function withImage(tex, img) {
  if (tex.image.width === img.width && tex.image.height === img.height) {
    tex.image = img;
    tex.needsUpdate = true;
    return tex;
  }
  tex.dispose();
  return makeTexture(img);
}

export class FrameLayer {
  constructor({ onChange, onFrame }) {
    this.texA = emptyTexture();
    this.texB = emptyTexture();
    this.mix = 0;
    this.frames = [];        // [{ time: Date, url }]
    this.idx = -1;           // frame shown in texA
    this.bIdx = -1;          // frame loaded (or loading) into texB
    this.bReady = false;
    this.wait = 0;
    this.playing = true;
    this.blobs = new Map();  // remote url -> Promise<object URL>
    this.token = 0;
    this.onChange = onChange; // something visible changed: redraw
    this.onFrame = onFrame;   // (idx, count, time) for the timeline UI
  }

  // Swap in a fresh list of frames, keeping already-downloaded ones.
  async setFrames(frames) {
    const keep = new Set(frames.map(f => f.url));
    for (const [url, p] of this.blobs) {
      if (!keep.has(url)) { p.then(u => u && URL.revokeObjectURL(u)); this.blobs.delete(url); }
    }
    this.frames = frames;
    if (!frames.length) return;
    // Show the newest frame straight away, then fetch the rest in the background.
    await this.seek(frames.length - 1);
    this.prefetch();
  }

  blob(url) {
    if (!this.blobs.has(url)) {
      this.blobs.set(url, fetch(url).then(r => (r.ok ? r.blob() : null)).then(b => (b ? URL.createObjectURL(b) : null)).catch(() => null));
    }
    return this.blobs.get(url);
  }

  async prefetch() {
    // Newest first, two at a time, so the loop fills in from "now" backwards.
    const queue = this.frames.map(f => f.url).reverse();
    const worker = async () => { while (queue.length) await this.blob(queue.shift()); };
    await Promise.all([worker(), worker()]);
  }

  async decode(i) {
    const src = await this.blob(this.frames[i].url);
    if (!src) return null;
    const img = new Image();
    img.src = src;
    try { await img.decode(); } catch { return null; }
    return img;
  }

  async seek(i) {
    const token = ++this.token;
    const img = await this.decode(i);
    if (token !== this.token || !img) return;
    this.texA = withImage(this.texA, img);
    this.idx = i;
    this.mix = 0;
    this.bIdx = -1;
    this.bReady = false;
    this.wait = i === this.frames.length - 1 ? HOLD_END : HOLD;
    this.onFrame?.(i, this.frames.length, this.frames[i].time);
    this.onChange?.();
  }

  async loadNext() {
    const n = this.frames.length;
    const next = (this.idx + 1) % n;
    if (this.bIdx === next) return;
    this.bIdx = next;
    this.bReady = false;
    const token = this.token;
    const img = await this.decode(next);
    if (token !== this.token || this.bIdx !== next) return;
    if (!img) { this.bIdx = -1; return; } // missing frame: retried next tick
    this.texB = withImage(this.texB, img);
    this.bReady = true;
  }

  // Advance by dt ms. Returns true when the picture changed (needs a redraw).
  tick(dt) {
    if (!this.playing || this.frames.length < 2 || this.idx < 0) return false;
    if (!this.bReady) this.loadNext(); // decode the next frame while this one rests
    if (this.wait > 0) { this.wait -= dt; return false; }
    if (!this.bReady) return false;
    this.mix = Math.min(1, this.mix + dt / FADE);
    if (this.mix >= 1) {
      [this.texA, this.texB] = [this.texB, this.texA];
      this.idx = this.bIdx;
      this.mix = 0;
      this.bIdx = -1;
      this.bReady = false;
      this.wait = this.idx === this.frames.length - 1 ? HOLD_END : HOLD;
      this.onFrame?.(this.idx, this.frames.length, this.frames[this.idx].time);
    }
    return true;
  }
}
