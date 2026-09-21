import { test } from 'node:test';
import assert from 'node:assert/strict';
import recipes from '../../data/zones/index.js';
import classes from '../../data/classes.js';
import { generateZone } from '../zonegen.js';
import { BUCKET, buildColliderGrid, canStand, tryMove, pushOutOfColliders, moveToward, applyKnockback } from '../movement.js';

const R = classes.classes.warrior.radius;
const hypot = (x, z) => Math.sqrt(x * x + z * z);

function moorZone(seed) {
  const zone = { layout: generateZone(recipes.gallowsmoor, seed), grid: null, gridW: 0 };
  buildColliderGrid(zone);
  return zone;
}

/** N×N box: sealed border, open floor for z < wallZ, solid wall from wallZ down. */
function boxZone(N, wallZ, colliders = []) {
  const walk = new Uint8Array(N * N);
  for (let z = 1; z < wallZ; z++) for (let x = 1; x < N - 1; x++) walk[z * N + x] = 1;
  const zone = { layout: { size: N, walk, colliders }, grid: null, gridW: 0 };
  buildColliderGrid(zone);
  return zone;
}

const ent = (x, z) => ({ x, z, dx: 0, dz: 1, r: R, kb: null });

test('the collider grid buckets every prop once at BUCKET metres', () => {
  const zone = moorZone(42);
  const N = zone.layout.size;
  assert.equal(zone.gridW, Math.ceil(N / BUCKET));
  let n = 0;
  for (const list of zone.grid) if (list) n += list.length;
  assert.equal(n, zone.layout.colliders.length);
});

test('a player pushed into a collider ends outside it', () => {
  const zone = boxZone(16, 15, [{ x: 8, z: 8, r: 0.5 }]);
  const e = ent(8.2, 8.1);
  pushOutOfColliders(zone, e);
  assert.ok(hypot(e.x - 8, e.z - 8) >= R + 0.5 - 1e-9, 'still inside');
  assert.ok(canStand(zone.layout, e.x, e.z, e.r));
  // on the moor: dropped just off an isolated prop's centre, the push lands outside on
  // standable ground (props can overlap each other; the single pass is P0 behaviour)
  const moor = moorZone(42);
  const cols = moor.layout.colliders;
  let isolated = 0, pushed = 0;
  for (const c of cols) {
    if (cols.some((d) => d !== c && hypot(c.x - d.x, c.z - d.z) < c.r + d.r + 2 * R + 0.1)) continue;
    isolated++;
    const p = ent(c.x + 0.05, c.z + 0.03);
    pushOutOfColliders(moor, p);
    assert.ok(canStand(moor.layout, p.x, p.z, p.r) || !canStand(moor.layout, c.x + 0.05, c.z + 0.03, R));
    if (p.x !== c.x + 0.05 || p.z !== c.z + 0.03) {
      pushed++;
      assert.ok(hypot(p.x - c.x, p.z - c.z) >= R + c.r - 1e-9, 'pushed but still inside');
    }
  }
  assert.ok(isolated > 20 && pushed > isolated * 0.8, `isolated ${isolated}, pushed ${pushed}`);
});

test('tryMove slides along a wall', () => {
  const zone = boxZone(16, 8);
  const e = ent(5.5, 7.0);
  for (let i = 0; i < 6; i++) tryMove(zone, e, 0.5, 0.5);
  assert.ok(Math.abs(e.x - 8.5) < 1e-9, 'x kept sliding: ' + e.x);
  assert.ok(e.z <= 8 - R + 1e-9 && e.z > 7.0, 'z stopped at the wall: ' + e.z);
  assert.ok(canStand(zone.layout, e.x, e.z, e.r));
  // straight into the wall: nothing moves
  const x0 = e.x, z0 = e.z;
  tryMove(zone, e, 0, 1);
  assert.deepEqual([e.x, e.z], [x0, z0]);
  // the sealed border holds on the other axes too
  const w = ent(1.5, 3.5);
  tryMove(zone, w, -2, 0);
  assert.equal(w.x, 1.5);
});

test('moveToward steps up to maxStep, faces the point and never overshoots', () => {
  const zone = boxZone(16, 15);
  const e = ent(3.5, 3.5);
  const left = moveToward(zone, e, 6.5, 3.5, 1.0);
  assert.ok(Math.abs(left - 2.0) < 1e-9, 'left ' + left);
  assert.ok(Math.abs(e.x - 4.5) < 1e-9 && e.z === 3.5);
  assert.deepEqual([e.dx, e.dz], [1, 0]);
  let n = 0, last = left;
  while (last > 0 && n++ < 10) {
    const now = moveToward(zone, e, 6.5, 3.5, 1.0);
    assert.ok(now < last, 'converges');
    last = now;
  }
  assert.equal(last, 0);
  assert.ok(Math.abs(e.x - 6.5) < 1e-9 && Math.abs(e.z - 3.5) < 1e-9, 'landed exactly');
  assert.equal(moveToward(zone, e, 6.5, 3.5, 1.0), 0, 'at the point: no move, no NaN');
  assert.deepEqual([e.dx, e.dz], [1, 0], 'facing kept when already there');
  // a diagonal target gives a unit facing and a step of exactly maxStep
  const d = ent(2.5, 2.5);
  const before = hypot(9.5 - d.x, 9.5 - d.z);
  const after = moveToward(zone, d, 9.5, 9.5, 0.3);
  assert.ok(Math.abs(before - after - 0.3) < 1e-9);
  assert.ok(Math.abs(d.dx * d.dx + d.dz * d.dz - 1) < 1e-9);
  // walls: steering into one slides and reports honest remaining distance
  const wz = boxZone(16, 8);
  const s = ent(4.5, 7.4);
  const rem = moveToward(wz, s, 4.5, 12, 1.0);
  assert.ok(s.z <= 8 - R + 1e-9, 'stopped at the wall');
  assert.ok(Math.abs(rem - (12 - s.z)) < 1e-9);
});

test('knockback moves the given distance and stops at walls', () => {
  const zone = boxZone(16, 8);
  const e = ent(5.5, 3.5);
  e.kb = { dx: 1, dz: 0, left: 4, step: 0.5 };
  for (let i = 0; i < 4; i++) {
    assert.equal(applyKnockback(zone, e), true);
    assert.equal(e.kb ? e.kb.left : 0, 3 - i);
  }
  assert.equal(e.kb, null, 'cleared when left hits 0');
  assert.ok(Math.abs(e.x - 7.5) < 1e-9 && e.z === 3.5, 'moved 4 × 0.5 m');
  assert.equal(applyKnockback(zone, e), false, 'nothing to consume');
  assert.deepEqual([e.dx, e.dz], [0, 1], 'knockback does not turn the entity');
  // into the wall: stops short, keeps counting down, still clears
  const w = ent(5.5, 6.5);
  w.kb = { dx: 0, dz: 1, left: 6, step: 0.5 };
  for (let i = 0; i < 6; i++) applyKnockback(zone, w);
  assert.equal(w.kb, null);
  assert.ok(w.z <= 8 - R + 1e-9 && w.z > 6.5, 'stopped at the wall: ' + w.z);
  assert.ok(canStand(zone.layout, w.x, w.z, w.r));
  // diagonal into the wall slides along it
  const d = ent(5.5, 7.0);
  d.kb = { dx: 0.7071067811865476, dz: 0.7071067811865476, left: 4, step: 0.5 };
  for (let i = 0; i < 4; i++) applyKnockback(zone, d);
  assert.ok(d.x > 6.9 && d.z <= 8 - R + 1e-9, `slid to ${d.x},${d.z}`);
  // a knockback without a step only counts down
  const s = ent(3.5, 3.5);
  s.kb = { dx: 1, dz: 0, left: 2 };
  applyKnockback(zone, s); applyKnockback(zone, s);
  assert.equal(s.kb, null);
  assert.deepEqual([s.x, s.z], [3.5, 3.5]);
});

test('steering across the moor is deterministic and never leaves walkable ground', () => {
  const run = () => {
    const zone = moorZone(7);
    const L = zone.layout, sp = L.playerSpawn, ex = L.exits[1];
    const e = ent(sp.x, sp.z);
    const trail = [];
    for (let t = 0; t < 400; t++) {
      moveToward(zone, e, ex.x, ex.z, classes.classes.warrior.runSpeed / 20);
      assert.ok(canStand(L, e.x, e.z, e.r), `off walkable ground at tick ${t}`);
      for (const c of L.colliders) assert.ok(hypot(e.x - c.x, e.z - c.z) >= e.r + c.r - 1e-6, `inside a collider at tick ${t}`);
      if (t % 25 === 0) trail.push(e.x, e.z);
    }
    return JSON.stringify(trail);
  };
  assert.equal(run(), run());
});
