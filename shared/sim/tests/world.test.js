import { test } from 'node:test';
import assert from 'node:assert/strict';
import recipes from '../../data/zones/index.js';
import monsters from '../../data/monsters.js';
import { createWorld, addPlayer, applyIntent, step, removeEnt, canStand, DT, TICK_HZ, TRACKED, FIRST_SIGHT } from '../world.js';
import { applyToMonster, monsterStats } from '../combat.js';
import { dropAt } from '../ground.js';
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
  // and the sealed border holds: walking south never leaves the zone. (P1: the walk above
  // includes deaths and respawns at playerSpawn, and the south exit gap sits right below
  // spawn, so z may reach the exit row; it never passes the border.)
  applyIntent(w, pid, { seq: 999, mv: [0, 1] });
  for (let i = 0; i < 200; i++) { step(w); assert.ok(canStand(L, p.x, p.z, p.r)); }
  assert.ok(p.z < L.size - p.r + 1e-9 && p.z > 0, 'z ' + p.z);
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

test('a killed monster: die delta and kill event at once, gone exactly dieTicks later', () => {
  const w = createWorld({ recipes, seed: 42 });
  const pid = addPlayer(w, hero);
  step(w);
  const mid = Object.keys(w.ents).find((id) => w.ents[id].kind === 'monster');
  const m = w.ents[mid];
  const p = w.ents[pid];
  m.x = p.x + 2; m.z = p.z; // inside xpShareRange, so the kill also pays xp
  applyToMonster(w, w.zones[m.zone], m, { phys: 1e6 }, pid); // armour DR caps at 60%: this always kills
  const r = step(w);
  assert.equal(r.delta[mid].dead, true);
  assert.equal(r.delta[mid].anim, 'die');
  assert.equal(r.delta[mid].hp, 0);
  assert.ok(r.events.some((e) => e.k === 'kill' && e.id === mid && e.by === pid), 'kill event');
  assert.ok(r.events.some((e) => e.k === 'xp' && e.pid === pid), 'xp event');
  const deadAt = w.tick;
  assert.equal(m.deadAt, deadAt);
  const dieTicks = monsters.curve.dieTicks;
  for (let t = deadAt + 1; t < deadAt + dieTicks; t++) {
    const s = step(w);
    assert.ok(!s.gone.includes(mid), 'still a corpse at tick ' + t);
    assert.ok(w.ents[mid]);
  }
  const s = step(w);
  assert.equal(w.tick, deadAt + dieTicks);
  assert.deepEqual(s.gone, [mid]);
  assert.equal(w.ents[mid], undefined);
  assert.ok(!w.zones.gallowsmoor.ents.has(mid));
  assert.ok(!(mid in step(w).delta));
});

test('delta carries the tracked fields the HUD keys off: hp, gold, invVer, target, statPoints; untouched fields stay out', () => {
  const w = createWorld({ recipes, seed: 42 });
  const pid = addPlayer(w, hero);
  const p = w.ents[pid];
  const zone = w.zones[p.zone];
  const first = step(w);
  // first sight is a projection: identity + TRACKED, never bags, brains or timers
  for (const f of ['inventory', 'equipment', 'belt', 'cooldowns', 'lockUntil', 'channel', 'dash', 'derived', 'lastSeq']) assert.ok(!(f in first.delta[pid]), f + ' leaked');
  const mid = Object.keys(w.ents).find((id) => w.ents[id].kind === 'monster');
  for (const f of ['ai', 'armour', 'xpValue', 'dropTable']) assert.ok(!(f in first.delta[mid]), f + ' leaked');
  for (const f of Object.keys(first.delta[pid])) assert.ok(TRACKED.includes(f) || FIRST_SIGHT.includes(f), f);
  assert.equal(first.delta[pid].statPoints, 0);
  // a hit on the monster and on the player
  const m = w.ents[mid];
  applyToMonster(w, zone, m, { phys: 1 }, pid);
  p.hp -= 3;
  let d = step(w).delta;
  assert.equal(d[mid].hp, m.hp);
  assert.equal(d[pid].hp, p.hp);
  assert.ok(!('gold' in d[pid]) && !('invVer' in d[pid]) && !('x' in d[pid]), 'unchanged fields are absent');
  // gold and a potion land on the player: gold and invVer change (auto-pickup in the same step)
  dropAt(w, zone, p.x, p.z, [{ gold: 9 }]);
  for (const id of zone.ents) if (w.ents[id].kind === 'item') { w.ents[id].x = p.x; w.ents[id].z = p.z; }
  d = step(w).delta;
  assert.equal(d[pid].gold, 9);
  // target follows the intent; stat points spent show up as statPoints + invVer
  p.statPoints = 2;
  applyIntent(w, pid, { seq: 1, target: mid, act: { op: 'stat', stat: 'vit' } });
  d = step(w).delta;
  assert.equal(d[pid].target, mid);
  assert.equal(d[pid].statPoints, 1);
  assert.equal(d[pid].invVer, p.invVer);
  assert.equal(d[pid].hpMax, p.hpMax, 'vit raised hpMax');
  applyIntent(w, pid, { seq: 2, target: null });
  d = step(w).delta;
  assert.equal(d[pid].target, null);
  assert.ok(!('statPoints' in d[pid]));
});

test('a zone without players does not tick: monsters freeze mid-chase', () => {
  const w = createWorld({ recipes, seed: 42 });
  const pid = addPlayer(w, hero);
  const p = w.ents[pid];
  const zone = w.zones[p.zone];
  const mid = Object.keys(w.ents).find((id) => w.ents[id].kind === 'monster');
  const m = w.ents[mid];
  m.x = p.x + 3; m.z = p.z; m.ai.anchorX = m.x; m.ai.anchorZ = m.z; // in sight: it aggroes and chases
  step(w); step(w);
  assert.equal(m.ai.state === 'chase' || m.ai.state === 'windup', true, m.ai.state);
  removeEnt(w, pid);
  step(w); // flushes gone
  const snap = () => JSON.stringify([...zone.ents].map((id) => w.ents[id]));
  const before = snap();
  for (let i = 0; i < 50; i++) {
    const r = step(w);
    assert.deepEqual(r.delta, {});
    assert.deepEqual(r.events, []);
  }
  assert.equal(snap(), before);
  assert.equal(w.tick, 53, 'the clock still runs');
});

test('monster player-scaling is frozen at spawn: a zone ensured with two players scales, an existing zone does not', () => {
  const one = createWorld({ recipes, seed: 42 });
  addPlayer(one, hero);
  const ms1 = Object.values(one.ents).filter((e) => e.kind === 'monster');
  const hp1 = ms1.map((m) => m.hpMax);
  addPlayer(one, hero);
  assert.deepEqual(ms1.map((m) => m.hpMax), hp1, 'a second join changes nothing already spawned');
  const two = createWorld({ recipes, seed: 42 });
  two.players.push('ghost1', 'ghost2'); // two players already in the game when the zone is first ensured
  addPlayer(two, hero);
  const ms2 = Object.values(two.ents).filter((e) => e.kind === 'monster');
  assert.equal(ms2.length, ms1.length);
  for (let i = 0; i < ms1.length; i++) {
    const s2 = monsterStats(ms2[i].type, ms2[i].level, ms2[i].champion, 2, { dropTable: recipes.gallowsmoor.dropTable });
    assert.equal(ms2[i].hpMax, s2.hpMax, 'two-player hp from monsterStats');
    assert.deepEqual(ms2[i].dmg, s2.dmg);
    assert.ok(ms2[i].hpMax > hp1[i], 'more hp with two players');
    assert.equal(ms1[i].hpMax, monsterStats(ms1[i].type, ms1[i].level, ms1[i].champion, 1, { dropTable: recipes.gallowsmoor.dropTable }).hpMax);
  }
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
