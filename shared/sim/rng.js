// shared/sim/rng.js — integer hashing and seeded streams.
// Only integer ops (Math.imul, shifts, xor, add) so every value is bit-identical in
// Node and in every browser. Never use Math.random anywhere in shared/.

/** Mix up to four int32 values into one uint32. */
export function hash32(a = 0, b = 0, c = 0, d = 0) {
  let h = (a | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = (h ^ (b | 0)) | 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (c | 0)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x27d4eb2f);
  h = (h ^ (d | 0)) | 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** FNV-1a over UTF-16 code units → uint32. */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stateless float in [0,1) from integers. */
export function hashFloat(seed, a = 0, b = 0, c = 0) {
  return hash32(seed, a, b, c) / 4294967296;
}

/** mulberry32 stream. `state` is exposed so a stream can be saved and restored. */
export function makeRng(seed) {
  let s = seed >>> 0;
  const rng = {
    get state() { return s; },
    set state(v) { s = v >>> 0; },
    /** uint32 */
    next() {
      s = (s + 0x6d2b79f5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    },
    /** [0,1) */
    float() { return rng.next() / 4294967296; },
    /** integer in [0,n) */
    int(n) { return Math.floor(rng.float() * n); },
    /** integer in [lo,hi] inclusive */
    range(lo, hi) { return lo + rng.int(hi - lo + 1); },
    /** float in [lo,hi) */
    between(lo, hi) { return lo + rng.float() * (hi - lo); },
    chance(p) { return rng.float() < p; },
    pick(arr) { return arr[rng.int(arr.length)]; },
    /** A new independent stream derived from this one. */
    fork(tag = 0) {
      const t = typeof tag === 'string' ? hashString(tag) : (tag | 0);
      return makeRng(hash32(rng.next(), t));
    },
  };
  return rng;
}

/**
 * The three rng streams a zone instance owns. `layout` seeds generation (both sides),
 * `loot` is advanced only by the server, `combat` resolves rolls in step().
 */
export function makeStreams(gameSeed, zoneId, instanceIndex = 0) {
  const base = hash32(gameSeed | 0, hashString(zoneId), instanceIndex | 0);
  return {
    layout: makeRng(hash32(base, 1)),
    loot: makeRng(hash32(base, 2)),
    combat: makeRng(hash32(base, 3)),
  };
}
