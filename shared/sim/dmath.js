// shared/sim/dmath.js — deterministic math for gameplay code.
// Only + − × ÷ floor min max, so results are bit-identical across engines. Never call
// Math.sqrt/sin/cos/pow/exp/atan2/hypot in shared/; use these instead.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
/** smoothstep on t∈[0,1] */
export const smooth = (t) => t * t * (3 - 2 * t);
export const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

/**
 * Deterministic square root: range-reduce by exact powers of four, then four Newton
 * steps. Accurate to ~1 ulp and identical on every engine.
 */
export function dsqrt(x) {
  if (!(x > 0)) return 0;
  if (x === Infinity) return Infinity;
  let f = 1, y = x;
  while (y >= 1) { y *= 0.25; f *= 2; }
  while (y < 0.25) { y *= 4; f *= 0.5; }
  let g = 0.41731 + 0.59016 * y;
  g = 0.5 * (g + y / g);
  g = 0.5 * (g + y / g);
  g = 0.5 * (g + y / g);
  g = 0.5 * (g + y / g);
  return g * f;
}

export const dlen = (x, z) => dsqrt(x * x + z * z);

/** Normalise (x,z) into out[0..1]; zero vector stays zero. Returns the original length. */
export function dnormInto(out, x, z) {
  const l = dlen(x, z);
  if (l > 0) { out[0] = x / l; out[1] = z / l; } else { out[0] = 0; out[1] = 0; }
  return l;
}

/** Sixteen unit directions, [x0,z0, x1,z1, ...], k·22.5° counter-clockwise from +x. */
export const DIR16 = [
  1, 0, 0.9238795325112867, 0.3826834323650898, 0.7071067811865476, 0.7071067811865476,
  0.3826834323650898, 0.9238795325112867, 0, 1, -0.3826834323650898, 0.9238795325112867,
  -0.7071067811865476, 0.7071067811865476, -0.9238795325112867, 0.3826834323650898, -1, 0,
  -0.9238795325112867, -0.3826834323650898, -0.7071067811865476, -0.7071067811865476,
  -0.3826834323650898, -0.9238795325112867, 0, -1, 0.3826834323650898, -0.9238795325112867,
  0.7071067811865476, -0.7071067811865476, 0.9238795325112867, -0.3826834323650898,
];
