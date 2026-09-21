import { test } from 'node:test';
import assert from 'node:assert/strict';
import recipes from '../../data/zones/index.js';
import { createWorld, addPlayer, applyIntent, step, removeEnt, canStand, DT, TICK_HZ } from '../world.js';
import { CELL } from '../zonegen.js';

const hero = { name: 'Test', cls: 'warrior', level: 1 };

function serialise(world) {
  const rows = Object.values(world.ents).map((e) => JSON.stringify(e));
  return world.tick + '|' + rows.join('\n');
}

test('two worlds with the same seed and intents stay identical for 300 ticks', () => {
  const a = createWorld({ recipes, seed: 42 }), b = createWorld({ recipes, seed: 42 });
  const pa = addPlayer(a, hero), pb = addPlayer(b, hero);
  const script = [[0, -1], [1, -1], [1, 0], [0.5, 0.5], [0, 0], [-1, 0], [-1, 1], [0.2, 0]];
  for (let t = 0; t < 300; t++) {
    const mv = script[Math.floor(t / 20) % script.length];
    const intent = { seq: t, mv, aim: [70, 60] };
    applyIntent(a, pa, intent); applyIntent(b, pb, intent);
    const ra = step(a), rb = step(b);
    assert.equal(JSON.stringify(ra), JSON.stringify(rb), 'tick ' + t);
  }
  assert.equal(serialise(a), serialise(b));
});

test('a different seed gives a different zone', () => {
  const a = createWorld({ recipes, seed: 1 }), b = createWorld({ recipes, seed: 2 });
  addPlayer(a, hero); addPlayer(b, hero);
  assert.notEqual(a.zones.gallowsmoor.layout.spawns[0].x, b.zones.gallowsmoor.layout.spawns[0].x);
});

test('20 Hz: full speed for one second covers runSpeed metres', () => {
  assert.equal(TICK_HZ, 20);
  const w = createWorld({ recipes, seed: 42 });
  const pid = addPlayer(w, hero);
  const p = w.ents[pid];
  const z0 = p.z;
  applyIntent(w, pid, { seq: 1, mv: [0, -1] });
  for (let i = 0; i < 20; i++) step(w);
  assert.ok(Math.abs((z0 - p.z) - p.speed) < 1e-9, 'moved ' + (z0 - p.z));
  assert.equal(p.anim, 'run');
  assert.deepEqual([p.dx, p.dz], [0, -1]);
  // diagonal input is normalised, never faster
  const x0 = p.x, z1 = p.z;
  applyIntent(w, pid, { seq: 2, mv: [1, -1] });
  for (let i = 0; i < 20; i++) step(w);
  const d = Math.hypot(p.x - x0, p.z - z1);
  assert.ok(Math.abs(d - p.speed) < 1e-6, 'diagonal ' + d);
  // analog input below 1 scales speed
  const z2 = p.z;
  applyIntent(w, pid, { seq: 3, mv: [0, -0.5] });
  for (let i = 0; i < 20; i++) step(w);
  assert.ok(Math.abs((z2 - p.z) - p.speed * 0.5) < 1e-6);
});

test('idle player faces the aim point; no intent means idle', () => {
  const w = createWorld({ recipes, seed: 42 });
  const pid = addPlayer(w, hero);
  const p = w.ents[pid];
  applyIntent(w, pid, { seq: 1, mv: [0, 0], aim: [p.x + 10, p.z] });
  step(w);
  assert.equal(p.anim, 'idle');
  assert.deepEqual([p.dx, p.dz], [1, 0]);
});

test('water, cliffs and props block; the player never leaves walkable ground', () => {
  const w = createWorld({ recipes, seed: 42 });
  const pid = addPlayer(w, hero);
  const p = w.ents[pid];
  const L = w.zones.gallowsmoor.layout;
  const dirs = [[0, -1], [1, 0], [-1, 0], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]];
  let tick = 0;
  for (let leg = 0; leg < 40; leg++) {
    applyIntent(w, pid, { seq: leg, mv: dirs[leg % dirs.length] });
    for (let i = 0; i < 60; i++) {
      step(w); tick++;
      assert.ok(canStand(L, p.x, p.z, p.r), `off walkable ground at tick ${tick}: ${p.x},${p.z}`);
      for (const c of L.colliders) {
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        assert.ok(d >= p.r + c.r - 1e-6, `inside a collider at tick ${tick}`);
      }
    }
  }
  // and the sealed border holds: walking south from spawn never leaves the zone
  applyIntent(w, pid, { seq: 999, mv: [0, 1] });
  for (let i = 0; i < 200; i++) step(w);
  assert.ok(p.z < L.size - 2 + p.r + 1e-9 && p.z > 0);
});

test('delta carries only what changed; gone lists removals; events flush', () => {
  const w = createWorld({ recipes, seed: 42 });
  const pid = addPlayer(w, hero);
  const first = step(w);
  const n = Object.keys(w.ents).length;
  assert.equal(Object.keys(first.delta).length, n, 'first tick sends every entity in full');
  assert.equal(first.events.filter((e) => e.k === 'spawn').length, n);
  assert.ok(first.delta[pid].hpMax > 0 && first.delta[pid].kind === 'player');
  const quiet = step(w);
  assert.deepEqual(quiet.delta, {}, 'nothing moved, nothing sent');
  assert.deepEqual(quiet.events, []);
  applyIntent(w, pid, { seq: 1, mv: [0, -1] });
  const moved = step(w);
  assert.deepEqual(Object.keys(moved.delta), [pid]);
  assert.deepEqual(Object.keys(moved.delta[pid]).sort(), ['anim', 'z']);
  const mid = Object.keys(w.ents).find((id) => id !== pid);
  removeEnt(w, mid);
  const after = step(w);
  assert.deepEqual(after.gone, [mid]);
  assert.equal(w.ents[mid], undefined);
  assert.equal(Object.keys(w.ents).length, n - 1);
  assert.ok(step(w).gone.length === 0);
});

test('monsters spawn idle with levels inside the difficulty band and hp from the curve', () => {
  const w = createWorld({ recipes, seed: 42, difficulty: 'blight' });
  addPlayer(w, hero);
  const [lo, hi] = recipes.gallowsmoor.level.blight;
  const ms = Object.values(w.ents).filter((e) => e.kind === 'monster');
  assert.ok(ms.length >= 40, 'monsters ' + ms.length);
  for (const m of ms) {
    assert.ok(m.level >= lo && m.level <= hi, 'level ' + m.level);
    assert.equal(m.anim, 'idle');
    assert.equal(m.hp, m.hpMax);
    assert.ok(m.hp > 0);
    assert.ok(Math.abs(m.dx * m.dx + m.dz * m.dz - 1) < 1e-9, 'facing is a unit vector');
    assert.ok(['biped', 'quad', 'bird'].includes(m.rig));
  }
  const wolf = ms.find((m) => m.type === 'gallowswolf' && !m.champion);
  if (wolf) assert.equal(wolf.hpMax, Math.floor(15 + 10 * wolf.level));
  assert.ok(ms.some((m) => m.champion) || ms.length < 60, 'a champion usually appears');
});

test('DT and the walk mask agree with cell types', () => {
  assert.equal(DT, 0.05);
  const w = createWorld({ recipes, seed: 7 });
  addPlayer(w, hero);
  const L = w.zones.gallowsmoor.layout;
  for (let i = 0; i < L.cell.length; i++) {
    const c = L.cell[i];
    assert.equal(L.walk[i], c === CELL.GRASS || c === CELL.PATH ? 1 : 0);
  }
});
