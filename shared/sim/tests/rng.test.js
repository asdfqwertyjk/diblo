import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash32, hashString, hashFloat, makeRng, makeStreams } from '../rng.js';
import golden from '../golden.js';

test('hash32 matches pinned values', () => {
  for (const [key, want] of Object.entries(golden.hash32)) {
    const args = key.split(',').map(Number);
    assert.equal(hash32(...args), want, key);
  }
});

test('hashString matches pinned values', () => {
  for (const [key, want] of Object.entries(golden.hashString)) assert.equal(hashString(key), want, JSON.stringify(key));
});

test('mulberry32 sequence for seed 1234 matches pinned values', () => {
  const rng = makeRng(1234);
  for (const want of golden.mulberry_1234) assert.equal(rng.next(), want);
});

test('helpers stay in range and are reproducible', () => {
  const a = makeRng(99), b = makeRng(99);
  for (let i = 0; i < 2000; i++) {
    const f = a.float();
    assert.ok(f >= 0 && f < 1);
    assert.equal(f, b.float());
    const n = a.int(7); b.int(7);
    assert.ok(n >= 0 && n < 7 && Number.isInteger(n));
    const r = a.range(3, 5); b.range(3, 5);
    assert.ok(r >= 3 && r <= 5);
  }
  assert.equal(a.state, b.state);
  const hf = hashFloat(5, 6, 7);
  assert.ok(hf >= 0 && hf < 1);
});

test('state round-trips and forks are independent', () => {
  const a = makeRng(7);
  a.next(); a.next();
  const saved = a.state;
  const x = a.next();
  a.state = saved;
  assert.equal(a.next(), x);
  const f1 = makeRng(7).fork('loot'), f2 = makeRng(7).fork('loot'), f3 = makeRng(7).fork('combat');
  assert.equal(f1.next(), f2.next());
  assert.notEqual(makeRng(7).fork('loot').next(), f3.next());
});

test('zone streams are distinct and stable', () => {
  const s = makeStreams(42, 'gallowsmoor');
  const t = makeStreams(42, 'gallowsmoor');
  assert.equal(s.layout.next(), t.layout.next());
  assert.notEqual(s.loot.next(), s.combat.next());
  assert.notEqual(makeStreams(42, 'gallowsmoor').loot.next(), makeStreams(43, 'gallowsmoor').loot.next());
});
