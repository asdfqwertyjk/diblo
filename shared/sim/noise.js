// shared/sim/noise.js — value noise on integer hashing. Deterministic everywhere.
import { hash32 } from './rng.js';
import { lerp, smooth } from './dmath.js';

const lattice = (seed, i, k) => hash32(seed, i, k) / 4294967296 * 2 - 1;

/** 2D value noise in [-1,1]. */
export function vnoise2(seed, x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const tx = smooth(x - xi), tz = smooth(z - zi);
  const a = lattice(seed, xi, zi), b = lattice(seed, xi + 1, zi);
  const c = lattice(seed, xi, zi + 1), d = lattice(seed, xi + 1, zi + 1);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

/** Fractal sum of vnoise2, normalised to [-1,1]. */
export function fbm2(seed, x, z, octaves = 4, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, fx = x, fz = z;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise2(hash32(seed, o), fx, fz) * amp;
    norm += amp;
    amp *= gain;
    fx *= lacunarity; fz *= lacunarity;
  }
  return sum / norm;
}
