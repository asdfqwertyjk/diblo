// client/src/audio/synth.js — WebAudio synth engine (the FakeDMZ osc/nz approach, rewritten).
// createSynth() → { ctx, buses:{sfx, ui, ambience, music}, master, resume(), setGain(bus, v),
//   getGain(bus), setMuted(bool), muted, osc(opts), nz(opts), noiseBuffer(), now(), onReady(cb),
//   voiceCount(), dispose() }.
// The AudioContext is created lazily on the first pointerdown / keydown / touchstart anywhere
// (window listeners, capture phase) and resumed on every later gesture (mobile autoplay policy).
// `buses` and `master` are null until then; levels set before creation are applied at creation.
// Voices: osc({type, freq, freqEnd, attack, decay, gain, bus, pan, at, slide}) and
// nz({dur, gain, filterHz, filterEnd, filterType, q, attack, bus, pan, at, rate, slide}) schedule
// one-shot voices with setTargetAtTime envelopes; polyphony is capped at MAX_VOICES (the oldest
// voice is faded out in 4 ms and stopped). Noise comes from one cached 1 s buffer. Nothing here
// allocates per voice except the WebAudio nodes themselves (voice slots are a fixed pool).
import sounds from 'shared/data/sounds.js';

export const MAX_VOICES = 24;
const MIN_GAIN = 0.0001;        // exponential envelopes cannot reach 0; this is −80 dB
const NOISE_SECONDS = 1;
const MIN_HZ = 20, MAX_HZ = 18000;
const RESUME_GRACE_MS = 500;    // voices scheduled this soon after a resume() play once it lands
const GESTURES = ['pointerdown', 'keydown', 'touchstart', 'touchend', 'mousedown', 'click'];
const LISTEN = { capture: true, passive: true };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const hz = (f) => clamp(+f || 0, MIN_HZ, MAX_HZ);

export function createSynth() {
  let ctx = null, master = null, noiseBuf = null;
  let muted = false, ready = false, disposed = false, resumeAt = -1e9;
  const levels = { master: 1 };
  const buses = {};
  for (const b of sounds.buses) { levels[b] = 1; buses[b] = null; }
  const readyCbs = [];

  // --- voice pool ------------------------------------------------------------------------
  const voices = new Array(MAX_VOICES);
  for (let i = 0; i < MAX_VOICES; i++) {
    const slot = { src: null, g: null, t0: 0, end: 0, onEnded: null };
    slot.onEnded = (e) => { if (slot.src === e.target) { slot.src = null; slot.g = null; } };
    voices[i] = slot;
  }

  function cutVoice(v, now) {
    try {
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setTargetAtTime(MIN_GAIN, now, 0.004);
      v.src.stop(now + 0.03);
    } catch (_) { /* already stopped */ }
    v.src = null; v.g = null;
  }

  /** A free slot, else the oldest playing voice (cut). */
  function allocVoice(t0, end) {
    const now = ctx.currentTime;
    let free = null, oldest = null;
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = voices[i];
      if (v.src === null || v.end <= now) { free = v; break; }
      if (oldest === null || v.t0 < oldest.t0) oldest = v;
    }
    if (free === null) { free = oldest; cutVoice(free, now); }
    free.t0 = t0; free.end = end;
    return free;
  }

  function voiceCount() {
    if (!ctx) return 0;
    const now = ctx.currentTime;
    let n = 0;
    for (let i = 0; i < MAX_VOICES; i++) if (voices[i].src !== null && voices[i].end > now) n++;
    return n;
  }

  // --- context lifecycle -----------------------------------------------------------------
  function fireReady() {
    if (ready || !ctx || ctx.state !== 'running') return;
    ready = true;
    for (let i = 0; i < readyCbs.length; i++) { try { readyCbs[i](ctx); } catch (err) { console.error(err); } }
    readyCbs.length = 0;
  }

  function resume() {
    if (!ctx) return;
    if (ctx.state === 'running') { fireReady(); return; }
    resumeAt = performance.now();
    const p = ctx.resume();
    if (p && p.then) p.then(fireReady, () => {});
  }

  function create() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { console.warn('[synth] WebAudio is not available'); return; }
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (_) { ctx = new AC(); }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : levels.master;
    master.connect(ctx.destination);
    for (const b of sounds.buses) {
      const g = ctx.createGain();
      g.gain.value = levels[b];
      g.connect(master);
      buses[b] = g;
    }
    ctx.onstatechange = () => { if (ctx.state === 'running') fireReady(); };
    resumeAt = performance.now();
    resume();
  }

  function onGesture() {
    if (disposed) return;
    if (!ctx) create(); else resume();
  }
  for (let i = 0; i < GESTURES.length; i++) window.addEventListener(GESTURES[i], onGesture, LISTEN);

  /** True when a voice scheduled now will be heard (running, or a resume is landing). */
  function canPlay() {
    if (!ctx) return false;
    if (ctx.state === 'running') return true;
    return performance.now() - resumeAt < RESUME_GRACE_MS;
  }

  function noiseBuffer() {
    if (!ctx) return null;
    if (!noiseBuf) {
      const n = Math.floor(ctx.sampleRate * NOISE_SECONDS);
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  // --- gains -----------------------------------------------------------------------------
  function busNode(name) { return (name && buses[name]) || buses[sounds.buses[0]]; }

  function setGain(bus, v) {
    v = clamp(+v || 0, 0, 1);
    if (bus === 'master') {
      levels.master = v;
      if (master && !muted) master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
      return;
    }
    if (!(bus in levels)) return;
    levels[bus] = v;
    if (buses[bus]) buses[bus].gain.setTargetAtTime(v, ctx.currentTime, 0.02);
  }
  function getGain(bus) { return bus in levels ? levels[bus] : 0; }

  function setMuted(on) {
    muted = !!on;
    if (master) master.gain.setTargetAtTime(muted ? 0 : levels.master, ctx.currentTime, 0.02);
  }

  // --- voices ----------------------------------------------------------------------------
  function envelope(p, t0, attack, decay, gain) {
    const v = gain > 0 ? gain : MIN_GAIN;
    p.setValueAtTime(MIN_GAIN, t0);
    p.setTargetAtTime(v, t0, attack / 3);              // ≈95 % of v at t0 + attack
    p.setTargetAtTime(MIN_GAIN, t0 + attack, decay / 4); // ≈−35 dB at t0 + attack + decay
  }

  function connectOut(node, bus, pan) {
    const out = busNode(bus);
    if (typeof pan === 'number' && pan === pan && pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      node.connect(p); p.connect(out);
    } else node.connect(out);
  }

  /** One oscillator voice. Returns true when scheduled. */
  function osc(o) {
    if (!canPlay()) return false;
    const attack = o.attack > 0 ? o.attack : 0.005;
    const decay = o.decay > 0 ? o.decay : 0.1;
    const t0 = ctx.currentTime + (o.at > 0 ? o.at : 0);
    const end = t0 + attack + decay * 1.5 + 0.05;
    const slot = allocVoice(t0, end);
    const src = ctx.createOscillator();
    src.type = o.type || 'sine';
    const f0 = hz(o.freq);
    src.frequency.setValueAtTime(f0, t0);
    if (o.freqEnd > 0 && o.freqEnd !== f0) {
      src.frequency.exponentialRampToValueAtTime(hz(o.freqEnd), t0 + (o.slide > 0 ? o.slide : attack + decay));
    }
    const g = ctx.createGain();
    envelope(g.gain, t0, attack, decay, o.gain);
    src.connect(g);
    connectOut(g, o.bus, o.pan);
    src.onended = slot.onEnded;
    src.start(t0);
    src.stop(end);
    slot.src = src; slot.g = g;
    return true;
  }

  /** One filtered-noise voice from the cached buffer. Returns true when scheduled. */
  function nz(o) {
    if (!canPlay()) return false;
    const attack = o.attack > 0 ? o.attack : 0.004;
    const dur = o.dur > 0 ? o.dur : 0.1;
    const t0 = ctx.currentTime + (o.at > 0 ? o.at : 0);
    const end = t0 + attack + dur * 1.5 + 0.05;
    const slot = allocVoice(t0, end);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    if (o.rate > 0) src.playbackRate.value = o.rate;
    const f = ctx.createBiquadFilter();
    f.type = o.filterType || 'bandpass';
    f.frequency.setValueAtTime(hz(o.filterHz || 1000), t0);
    f.Q.value = o.q > 0 ? o.q : 0.8;
    if (o.filterEnd > 0) {
      f.frequency.exponentialRampToValueAtTime(hz(o.filterEnd), t0 + (o.slide > 0 ? o.slide : attack + dur));
    }
    const g = ctx.createGain();
    envelope(g.gain, t0, attack, dur, o.gain);
    src.connect(f); f.connect(g);
    connectOut(g, o.bus, o.pan);
    src.onended = slot.onEnded;
    src.start(t0, Math.random() * (NOISE_SECONDS - 0.1));
    src.stop(end);
    slot.src = src; slot.g = g;
    return true;
  }

  /** cb(ctx) once the context exists and is running (immediately when it already is). */
  function onReady(cb) {
    if (ready && ctx && ctx.state === 'running') cb(ctx);
    else readyCbs.push(cb);
  }

  function dispose() {
    disposed = true;
    for (let i = 0; i < GESTURES.length; i++) window.removeEventListener(GESTURES[i], onGesture, LISTEN);
    readyCbs.length = 0;
    if (ctx) {
      const now = ctx.currentTime;
      for (let i = 0; i < MAX_VOICES; i++) if (voices[i].src) cutVoice(voices[i], now);
      const c = ctx;
      ctx = null; master = null; noiseBuf = null; ready = false;
      for (const b of sounds.buses) buses[b] = null;
      if (c.close) c.close().catch(() => {});
    }
  }

  return {
    get ctx() { return ctx; },
    get master() { return master; },
    get muted() { return muted; },
    get ready() { return ready; },
    buses, levels,
    resume, setGain, getGain, setMuted, osc, nz, noiseBuffer, busNode, onReady, voiceCount, dispose,
    now: () => (ctx ? ctx.currentTime : 0),
  };
}
