import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dsqrt, dlen, dnormInto, clamp, lerp, smooth, DIR16 } from '../dmath.js';

// Math.sqrt is allowed in a TEST as the reference; never in shared/ gameplay code.
test('dsqrt is within 4 ulp of the reference across ten decades', () => {
  const samples = [0, 1e-8, 1e-4, 0.01, 0.25, 0.5, 0.999, 1, 1.0001, 2, 3, 10, 99.5, 1e3, 12345.678, 1e6, 1e9];
  for (let i = 0; i < 5000; i++) samples.push(i * 0.37 + 0.001);
  for (const x of samples) {
    const got = dsqrt(x), want = Math.sqrt(x);
    const tol = want * 1e-15 * 4;
    assert.ok(Math.abs(got - want) <= tol, `dsqrt(${x}) = ${got}, want ${want}`);
  }
  assert.equal(dsqrt(-1), 0);
  assert.equal(dsqrt(NaN), 0);
});

test('normalise gives unit vectors and leaves zero alone', () => {
  const out = [0, 0];
  const l = dnormInto(out, 3, 4);
  assert.equal(l, 5);
  assert.ok(Math.abs(out[0] - 0.6) < 1e-12 && Math.abs(out[1] - 0.8) < 1e-12);
  dnormInto(out, 0, 0);
  assert.deepEqual(out, [0, 0]);
  assert.ok(Math.abs(dlen(1, 1) - 1.4142135623730951) < 1e-15);
});

test('clamp, lerp, smooth', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(lerp(10, 20, 0.25), 12.5);
  assert.equal(smooth(0), 0);
  assert.equal(smooth(1), 1);
  assert.equal(smooth(0.5), 0.5);
});

test('DIR16 holds sixteen unit vectors in order', () => {
  assert.equal(DIR16.length, 32);
  for (let k = 0; k < 16; k++) {
    const x = DIR16[k * 2], z = DIR16[k * 2 + 1];
    assert.ok(Math.abs(x * x + z * z - 1) < 1e-12, 'unit ' + k);
  }
  assert.deepEqual([DIR16[0], DIR16[1]], [1, 0]);
  assert.deepEqual([DIR16[8], DIR16[9]], [0, 1]);
  assert.deepEqual([DIR16[16], DIR16[17]], [-1, 0]);
  assert.deepEqual([DIR16[24], DIR16[25]], [0, -1]);
});
