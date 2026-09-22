// client/src/audio/sfx.js — one synth recipe per key in shared/data/sounds.js.
// createSfx(synth) → { play(key, {x, z, variant, pan, sx, sw, ndcX}), startAmbience(key),
//   stopAmbience(), mute(bool), muted, setProjector(fn), event(ev, playerId), hasRecipe(key), keys }.
// Every key must have a recipe: the table is checked once at module load (console.warn lists any
// missing key); a missing key plays uiClick and warns once. `variant` picks a recipe variant by
// index (random when omitted). Identical keys are rate-limited to RATE_N per RATE_MS. Pan comes
// from `pan` (−1..1), `sx` (screen x in CSS px, `sw` = viewport width), `ndcX`, or from `x, z`
// through the projector set with setProjector((x, z) → ndcX). No allocation per play beyond the
// WebAudio nodes: recipes write into two scratch option objects and call synth.osc / synth.nz.
import sounds from 'shared/data/sounds.js';
import classes from 'shared/data/classes.js';
import monsters from 'shared/data/monsters.js';

const RATE_N = 8, RATE_MS = 100;
const PAN_WIDTH = 0.75;            // full screen edge → ±0.75, keeps a little of the other channel
const CAW_MIN_MS = 8000, CAW_MAX_MS = 20000;
const DISTANT_GAIN = 0.28;

// --- scratch state the recipes read (set by play() before a recipe runs) ---------------------
const cur = { synth: null, bus: 'sfx', pan: 0, mul: 1 };
const O = { type: 'sine', freq: 440, freqEnd: 0, attack: 0.005, decay: 0.1, gain: 0.2, bus: 'sfx', pan: 0, at: 0, slide: 0 };
const N = { dur: 0.1, gain: 0.2, filterHz: 1000, filterEnd: 0, filterType: 'bandpass', q: 0.8, attack: 0.004, bus: 'sfx', pan: 0, at: 0, rate: 1, slide: 0 };

/** An oscillator voice: type, start Hz, end Hz (0 = none), attack s, decay s, gain, at s, slide s. */
function tone(type, freq, freqEnd, attack, decay, gain, at = 0, slide = 0) {
  O.type = type; O.freq = freq; O.freqEnd = freqEnd; O.attack = attack; O.decay = decay;
  O.gain = gain * cur.mul; O.bus = cur.bus; O.pan = cur.pan; O.at = at; O.slide = slide;
  cur.synth.osc(O);
}
/** A filtered-noise voice: filter type, Hz, end Hz (0 = none), attack s, dur s, gain, at s, Q, rate. */
function noise(filterType, filterHz, filterEnd, attack, dur, gain, at = 0, q = 0.8, rate = 1) {
  N.filterType = filterType; N.filterHz = filterHz; N.filterEnd = filterEnd; N.attack = attack; N.dur = dur;
  N.gain = gain * cur.mul; N.bus = cur.bus; N.pan = cur.pan; N.at = at; N.q = q; N.rate = rate; N.slide = 0;
  cur.synth.nz(N);
}
/** Three ascending notes with a shimmer an octave up; `tail` is the last note's decay. */
function chime(f1, f2, f3, step, tail, gain) {
  tone('sine', f1, 0, 0.004, tail * 0.6, gain, 0);
  tone('sine', f2, 0, 0.004, tail * 0.8, gain, step);
  tone('sine', f3, 0, 0.004, tail, gain, step * 2);
  tone('triangle', f3 * 2, 0, 0.004, tail * 0.5, gain * 0.22, step * 2);
}

const LEVELUP_NOTES = [523.25, 659.25, 783.99, 1046.5, 1318.5];

// --- recipes: one per sounds.keys entry; `v` is the variant index ---------------------------
const RECIPES = {
  hit(v) {                                   // thuddy: short noise burst + low sine
    const f = v === 0 ? 1100 : v === 1 ? 850 : 1400;
    noise('bandpass', f, f * 0.5, 0.002, 0.06, 0.35, 0, 0.7);
    noise('lowpass', 500, 0, 0.001, 0.03, 0.3, 0, 0.5);
    tone('sine', 150 - v * 15, 60, 0.002, 0.09, 0.45);
  },
  crit() {                                   // brighter, with a pitch drop
    noise('bandpass', 2600, 900, 0.002, 0.12, 0.35, 0, 0.9);
    tone('triangle', 900, 260, 0.003, 0.18, 0.35);
    tone('sine', 420, 90, 0.002, 0.2, 0.5);
    tone('sine', 1800, 1200, 0.002, 0.08, 0.12);
  },
  kill(v) {                                  // low thump + short descending tone
    tone('sine', 95 - v * 15, 38, 0.004, 0.28, 0.6);
    noise('lowpass', 300, 120, 0.002, 0.12, 0.4);
    tone(v === 0 ? 'triangle' : 'square', 520, 130, 0.004, 0.2, 0.16, 0.03);
  },
  hurt(v) {
    noise('lowpass', 700, 250, 0.002, 0.08, 0.35);
    tone('triangle', v === 0 ? 230 : 300, 140, 0.005, 0.13, 0.3);
    tone('sine', 120, 70, 0.002, 0.1, 0.3);
  },
  block() {                                  // a metallic clank
    tone('square', 1900, 1500, 0.001, 0.05, 0.12);
    tone('triangle', 2600, 2300, 0.001, 0.09, 0.15);
    noise('highpass', 3500, 0, 0.001, 0.05, 0.25, 0, 0.5);
    tone('sine', 400, 200, 0.002, 0.08, 0.25);
  },
  death() {
    tone('sawtooth', 320, 55, 0.01, 0.9, 0.22);
    tone('sine', 110, 30, 0.01, 0.8, 0.5, 0.05);
    noise('lowpass', 600, 120, 0.01, 0.6, 0.3);
  },
  respawn() {
    tone('sine', 440, 0, 0.01, 0.25, 0.22);
    tone('sine', 660, 0, 0.01, 0.3, 0.22, 0.12);
    tone('triangle', 880, 0, 0.01, 0.5, 0.15, 0.24);
  },
  lootNormal() {                             // a soft tick
    tone('sine', 1300, 900, 0.001, 0.04, 0.12);
    noise('highpass', 4000, 0, 0.001, 0.02, 0.08);
  },
  lootMagic() {                              // two-note blip
    tone('sine', 880, 0, 0.003, 0.12, 0.2);
    tone('sine', 1320, 0, 0.003, 0.18, 0.2, 0.08);
  },
  lootRare() {                               // bright three-note ascending chime with a tail
    chime(1046.5, 1318.5, 1568, 0.09, 0.7, 0.28);
  },
  lootUnique() {                             // the same, lower and longer, plus a fourth note
    chime(698.5, 880, 1046.5, 0.12, 1.3, 0.3);
    tone('sine', 1318.5, 0, 0.004, 1.6, 0.26, 0.36);
    tone('triangle', 2637, 0, 0.004, 0.8, 0.06, 0.36);
  },
  gold(v) {                                  // coin jingle
    const b = v === 0 ? 2500 : 3100;
    tone('triangle', b, 0, 0.001, 0.05, 0.14);
    tone('triangle', b * 1.26, 0, 0.001, 0.07, 0.12, 0.04);
    tone('sine', b * 1.5, 0, 0.001, 0.09, 0.1, 0.08);
    noise('highpass', 5000, 0, 0.001, 0.03, 0.1);
  },
  pickup() {                                 // into the bag
    noise('lowpass', 900, 300, 0.002, 0.07, 0.3);
    tone('sine', 320, 200, 0.003, 0.08, 0.2);
  },
  potion() {                                 // a gulp: two filtered noise bursts + glug
    noise('lowpass', 700, 250, 0.006, 0.07, 0.4);
    tone('sine', 200, 120, 0.005, 0.07, 0.2);
    noise('lowpass', 550, 200, 0.006, 0.08, 0.4, 0.14);
    tone('sine', 170, 100, 0.005, 0.08, 0.2, 0.14);
  },
  levelup() {                                // rising arpeggio over a bass swell
    for (let i = 0; i < LEVELUP_NOTES.length; i++) {
      tone('sine', LEVELUP_NOTES[i], 0, 0.005, 0.35 + i * 0.15, 0.22, i * 0.09);
      tone('triangle', LEVELUP_NOTES[i], 0, 0.005, 0.2 + i * 0.1, 0.07, i * 0.09);
    }
    tone('sine', 130.8, 0, 0.05, 1.2, 0.25, 0.1);
  },
  full() {                                   // a denied buzz, two pulses
    tone('square', 160, 150, 0.003, 0.08, 0.1);
    tone('square', 150, 140, 0.003, 0.1, 0.1, 0.12);
  },
  uiClick() {                                // a tick
    tone('triangle', 1800, 1400, 0.001, 0.02, 0.12);
    noise('highpass', 3000, 0, 0.001, 0.015, 0.08);
  },
  equip() {                                  // a metallic snap
    noise('bandpass', 3000, 1500, 0.001, 0.05, 0.25, 0, 1);
    tone('triangle', 700, 480, 0.002, 0.07, 0.18);
    tone('sine', 240, 180, 0.002, 0.06, 0.15, 0.03);
  },
  swipe(v) {                                 // whoosh: a rising bandpass sweep
    noise('bandpass', v ? 700 : 400, v ? 2600 : 2200, 0.01, 0.13, 0.3, 0, 1.2);
    noise('bandpass', 250, 900, 0.02, 0.1, 0.12, 0.02, 0.8);
  },
  dash() {                                   // a longer whoosh with a low push
    noise('bandpass', 300, 3200, 0.02, 0.22, 0.35, 0, 1);
    tone('sine', 140, 90, 0.01, 0.15, 0.2);
  },
  shout() {                                  // warcry: two detuned saws rising then falling
    tone('sawtooth', 150, 240, 0.03, 0.28, 0.2, 0, 0.18);
    tone('sawtooth', 152, 243, 0.03, 0.28, 0.12, 0, 0.18);
    tone('sawtooth', 240, 170, 0.02, 0.32, 0.22, 0.22, 0.25);
    noise('bandpass', 900, 600, 0.03, 0.4, 0.15, 0, 1.5);
  },
  smash() {                                  // skullbreak: click + heavy thud
    tone('square', 2000, 800, 0.001, 0.02, 0.15);
    noise('lowpass', 420, 120, 0.002, 0.14, 0.5);
    tone('sine', 110, 35, 0.003, 0.32, 0.6);
  },
  whirl() {                                  // one loop tick of the spin
    noise('bandpass', 600, 1900, 0.01, 0.12, 0.18, 0, 1.5);
    tone('sine', 220, 160, 0.01, 0.1, 0.06);
  },
  quake() {                                  // deep boom with a crack on top
    tone('sine', 62, 24, 0.01, 0.75, 0.8);
    noise('lowpass', 220, 60, 0.01, 0.55, 0.5);
    tone('triangle', 90, 30, 0.01, 0.4, 0.25);
    noise('bandpass', 1500, 400, 0.002, 0.08, 0.2);
  },
  arrow() {                                  // a whip
    noise('bandpass', 3200, 700, 0.002, 0.1, 0.3, 0, 1.5);
    tone('sine', 1500, 320, 0.001, 0.05, 0.15);
  },
  growl(v) {
    const b = v === 0 ? 85 : 110;
    tone('sawtooth', b, b * 0.75, 0.03, 0.38, 0.22, 0, 0.35);
    tone('sawtooth', b * 1.5 + 2, b * 1.1, 0.03, 0.35, 0.12, 0, 0.35);
    noise('bandpass', 350, 200, 0.03, 0.35, 0.2, 0, 1);
  },
  caw(v) {
    const b = v === 0 ? 1150 : 950;
    tone('square', b, b * 0.6, 0.005, 0.11, 0.09);
    noise('bandpass', 2600, 1500, 0.004, 0.1, 0.22, 0, 2);
    tone('square', b * 1.05, b * 0.62, 0.005, 0.12, 0.09, 0.15);
    noise('bandpass', 2700, 1500, 0.004, 0.11, 0.22, 0.15, 2);
    if (v === 1) {
      tone('square', b * 0.95, b * 0.6, 0.005, 0.13, 0.08, 0.3);
      noise('bandpass', 2400, 1400, 0.004, 0.12, 0.2, 0.3, 2);
    }
  },
  banditCall(v) {
    if (v === 0) {                           // "hey!"
      tone('sawtooth', 260, 420, 0.02, 0.12, 0.18, 0, 0.1);
      tone('sawtooth', 420, 280, 0.01, 0.2, 0.18, 0.12, 0.18);
      noise('bandpass', 1200, 900, 0.02, 0.25, 0.12, 0, 1.5);
    } else {                                 // a whistle
      tone('sine', 1800, 2500, 0.02, 0.16, 0.16, 0, 0.14);
      tone('sine', 2500, 1900, 0.01, 0.22, 0.16, 0.16, 0.2);
    }
  },
  stun() {                                   // dizzy stars: alternating high triangles
    tone('triangle', 1400, 0, 0.003, 0.09, 0.14);
    tone('triangle', 1100, 0, 0.003, 0.09, 0.14, 0.1);
    tone('triangle', 1400, 0, 0.003, 0.09, 0.12, 0.2);
    tone('triangle', 1100, 0, 0.003, 0.2, 0.1, 0.3);
  },
  ambienceMoor() {                           // one-shot form: a single wind gust (the loop is below)
    noise('lowpass', 260, 420, 0.4, 1.2, 0.12, 0, 0.7);
  },
};

// --- ambience loops: key → builder(synth) returning { stop(now) } -----------------------------
const LOOPS = {
  ambienceMoor(synth) {
    const ctx = synth.ctx, out = synth.busNode('ambience'), now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = synth.noiseBuffer(); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;          // slow gain swells
    const lg = ctx.createGain(); lg.gain.value = 0.045;
    lfo.connect(lg); lg.connect(g.gain);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.031;       // slower filter drift
    const lg2 = ctx.createGain(); lg2.gain.value = 160;
    lfo2.connect(lg2); lg2.connect(f.frequency);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(now, Math.random() * 0.9); lfo.start(now); lfo2.start(now);
    g.gain.setTargetAtTime(0.09, now + 0.2, 1.5);
    return {
      stop(t) {
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0, t, 0.4);
        src.stop(t + 2); lfo.stop(t + 2); lfo2.stop(t + 2);
      },
    };
  },
};

// --- table check at module load -------------------------------------------------------------
export const KEYS = Object.keys(sounds.keys);
const MISSING = KEYS.filter((k) => !RECIPES[k] && !LOOPS[k]);
if (MISSING.length) console.warn('[sfx] no recipe for sound keys: ' + MISSING.join(', ') + ' (they play uiClick)');

const LOOT_KEY = { normal: 'lootNormal', magic: 'lootMagic', rare: 'lootRare', unique: 'lootUnique', set: 'lootUnique', gold: 'lootNormal' };

export function hasRecipe(key) { return !!RECIPES[key]; }

export function createSfx(synth) {
  let muted = false;
  let projector = null;
  let loop = null, loopKey = null, pendingKey = null, cawTimer = 0;
  const warned = new Set();
  const stamps = {};
  for (let i = 0; i < KEYS.length; i++) stamps[KEYS[i]] = { t: new Float64Array(RATE_N), i: 0 };
  const POS = { x: 0, z: 0 };           // reused opts for event() → play()

  /** Allow at most RATE_N plays of one key per RATE_MS (ring of timestamps, oldest at .i). */
  function allowed(key, now) {
    const s = stamps[key];
    if (!s) return true;
    if (now - s.t[s.i] < RATE_MS) return false;
    s.t[s.i] = now; s.i = (s.i + 1) % RATE_N;
    return true;
  }

  function panOf(opts) {
    if (!opts) return 0;
    let p = 0;
    if (typeof opts.pan === 'number') p = opts.pan;
    else if (typeof opts.sx === 'number') p = ((opts.sx / (opts.sw > 0 ? opts.sw : window.innerWidth || 1)) * 2 - 1) * PAN_WIDTH;
    else if (typeof opts.ndcX === 'number') p = opts.ndcX * PAN_WIDTH;
    else if (projector && typeof opts.x === 'number') p = projector(opts.x, opts.z) * PAN_WIDTH;
    if (p !== p) return 0;                                   // NaN from an off-screen projection
    return p < -1 ? -1 : p > 1 ? 1 : p;
  }

  function run(key, v, pan, mul, bus) {
    let recipe = RECIPES[key];
    if (!recipe) {
      if (!warned.has(key)) { warned.add(key); console.warn('[sfx] unknown sound key "' + key + '", playing uiClick'); }
      recipe = RECIPES.uiClick;
    }
    cur.synth = synth; cur.bus = bus; cur.pan = pan; cur.mul = mul;
    recipe(v);
  }

  /** Play a key. opts: {variant, pan | sx (+sw) | ndcX | x, z}. Returns true when it played. */
  function play(key, opts) {
    if (muted) return false;
    const def = sounds.keys[key];
    const now = performance.now();
    if (!allowed(key, now)) return false;
    const nVar = def && def.variants > 0 ? def.variants : 1;
    let v = opts && opts.variant != null ? opts.variant | 0 : (Math.random() * nVar) | 0;
    v = ((v % nVar) + nVar) % nVar;
    run(key, v, panOf(opts), 1, def ? def.bus : 'sfx');
    return true;
  }

  // --- ambience --------------------------------------------------------------------------
  function scheduleCaw() {
    clearTimeout(cawTimer);
    cawTimer = setTimeout(cawTick, CAW_MIN_MS + Math.random() * (CAW_MAX_MS - CAW_MIN_MS));
  }
  function cawTick() {
    if (!loop) return;
    if (!muted && synth.ctx && synth.ctx.state === 'running') {
      const key = Math.random() < 0.8 ? 'caw' : 'growl';
      const def = sounds.keys[key];
      run(key, (Math.random() * def.variants) | 0, (Math.random() * 2 - 1) * PAN_WIDTH, DISTANT_GAIN, 'ambience');
    }
    scheduleCaw();
  }
  function startLoop(key) {
    if (loop && loopKey === key) return;
    if (loop) stopLoop();
    const build = LOOPS[key];
    if (!build) { if (!warned.has(key)) { warned.add(key); console.warn('[sfx] no ambience loop for "' + key + '"'); } return; }
    loop = build(synth); loopKey = key;
    scheduleCaw();
  }
  function stopLoop() {
    clearTimeout(cawTimer); cawTimer = 0;
    if (loop) { try { loop.stop(synth.now()); } catch (_) { /* context closed */ } }
    loop = null; loopKey = null;
  }
  /** Start a looped ambience; before the first gesture it starts once the context is running. */
  function startAmbience(key) {
    pendingKey = key;
    if (synth.ready) startLoop(key);
    else synth.onReady(() => { if (pendingKey === key && !loop) startLoop(key); });
  }
  function stopAmbience() { pendingKey = null; stopLoop(); }

  function mute(on) { muted = !!on; synth.setMuted(muted); }
  /** fn(x, z) → screen x in NDC (−1..1); lets play(key, {x, z}) pan by world position. */
  function setProjector(fn) { projector = typeof fn === 'function' ? fn : null; }

  /** Convenience: map a sim event (shared/sim/API.md "Events") to a play() call. */
  function event(ev, playerId) {
    POS.x = ev.x; POS.z = ev.z;
    switch (ev.k) {
      case 'hit': return play(ev.tgt === playerId ? 'hurt' : ev.crit ? 'crit' : 'hit', POS);
      case 'kill': return play('kill', POS);
      case 'death': return play('death', POS);
      case 'drop': return play(LOOT_KEY[ev.rarity] || 'lootNormal', POS);
      case 'skill': {
        const row = classes.skills[ev.id];
        return play(row && row.fx && RECIPES[row.fx] ? row.fx : 'swipe', POS);
      }
      case 'aggro': {
        const t = monsters.types[ev.type];
        return play(!t ? 'growl' : t.rig === 'bird' ? 'caw' : t.family === 'bandit' ? 'banditCall' : 'growl');
      }
      case 'block': return play('block');
      case 'respawn': return play('respawn');
      case 'pickup': return play('pickup');
      case 'gold': return play('gold');
      case 'full': return play('full');
      case 'potion': return play('potion');
      case 'levelup': return play('levelup');
      case 'equip': return play('equip');
      case 'stun': return play('stun');
      case 'proj': return play('arrow');
      default: return false;   // spawn, xp, invalid: silent
    }
  }

  return {
    play, startAmbience, stopAmbience, mute, setProjector, event, hasRecipe,
    get muted() { return muted; },
    get ambience() { return loopKey; },
    keys: KEYS,
  };
}
