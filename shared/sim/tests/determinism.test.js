// Determinism of the whole P1 loop: two worlds with the same seed, driven by the same seeded
// intent script (makeRng, never Math.random) that walks, fights, drinks, picks up and equips,
// produce byte-identical step() results every tick and identical entities at the end. The
// script reads each world's own state with its own rng stream, so any divergence would show
// up in the very next step() result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import recipes from '../../data/zones/index.js';
import { createWorld, addPlayer, applyIntent, step } from '../world.js';
import { toDoc } from '../player.js';
import { makeRng } from '../rng.js';
import { generateItem } from '../itemgen.js';
import { dist2 } from '../dmath.js';

const SEED = 99;
const TICKS = 3000;
const STATS = ['str', 'dex', 'vit', 'ene'];

function makeWorld(seed) {
  const w = createWorld({ recipes, seed });
  const sword = generateItem(makeRng(seed), { ilvl: 1, rarity: 'normal', baseId: 'sword' });
  const pid = addPlayer(w, {
    name: 'Det', cls: 'warrior', level: 1,
    equipment: { weapon: sword },
    belt: [{ potionId: 'lifeMinor', count: 10 }, { potionId: 'manaMinor', count: 10 }, null, null],
  });
  return { w, pid, p: w.ents[pid] };
}

/** One intent from the world's state and the script's rng. Same state + same rng → same intent. */
function scriptIntent(rng, w, p, t, st) {
  const zone = w.zones[p.zone];
  let m = null, bd = 30 * 30;
  for (const id of zone.ents) {
    const e = w.ents[id];
    if (!e || e.kind !== 'monster' || e.dead || !(e.hp > 0)) continue;
    const d2 = dist2(p.x, p.z, e.x, e.z);
    if (d2 < bd) { bd = d2; m = e; }
  }
  if (t % 20 === 0) st.mv = [rng.between(-1, 1), rng.between(-1, 1)];
  const it = { seq: t, mv: st.mv, aim: [p.x + rng.between(-6, 6), p.z + rng.between(-6, 6)], target: null, skill: null, use: null, pick: null, act: null };
  if (m) {
    it.target = m.id;
    it.aim = [m.x, m.z];
    const close = bd <= (2 + m.r) * (2 + m.r);
    if (close) { it.mv = rng.chance(0.7) ? [0, 0] : st.mv; it.skill = 0; }
    else if (rng.chance(0.8)) { const d = Math.max(1e-6, bd); it.mv = [(m.x - p.x) / d * 30, (m.z - p.z) / d * 30]; }
    else if (rng.chance(0.3)) it.skill = 0;
  }
  if (rng.chance(0.03)) it.use = rng.int(4);
  const ground = [];
  for (const id of zone.ents) {
    const g = w.ents[id];
    if (g && g.kind === 'item' && dist2(p.x, p.z, g.x, g.z) <= 9) ground.push(id);
  }
  if (ground.length && rng.chance(0.5)) it.pick = ground[rng.int(ground.length)];
  const r = rng.float();
  if (p.dead) { if (r < 0.1) it.act = { op: 'respawn' }; }
  else if (r < 0.03 && p.inventory.items.length) it.act = { op: 'equip', iid: p.inventory.items[rng.int(p.inventory.items.length)].iid };
  else if (r < 0.06) it.act = { op: 'stat', stat: STATS[rng.int(4)] };
  else if (r < 0.08) it.act = { op: 'skill', id: 'cleave' };
  else if (r < 0.09 && p.inventory.items.length) it.act = { op: 'drop', iid: p.inventory.items[rng.int(p.inventory.items.length)].iid };
  return it;
}

function run(seed, ticks, other = null) {
  const A = makeWorld(seed), B = other;
  const ra = makeRng(seed * 7 + 1), rb = makeRng(seed * 7 + 1);
  const sa = { mv: [0, 0] }, sb = { mv: [0, 0] };
  const seen = {};
  for (let t = 1; t <= ticks; t++) {
    const ia = scriptIntent(ra, A.w, A.p, t, sa);
    applyIntent(A.w, A.pid, ia);
    const outA = step(A.w);
    if (B) {
      const ib = scriptIntent(rb, B.w, B.p, t, sb);
      assert.equal(JSON.stringify(ib), JSON.stringify(ia), 'intent differs at tick ' + t);
      applyIntent(B.w, B.pid, ib);
      const outB = step(B.w);
      assert.equal(JSON.stringify(outB), JSON.stringify(outA), 'step() result differs at tick ' + t);
    }
    for (const ev of outA.events) seen[ev.k] = (seen[ev.k] || 0) + 1;
  }
  return { A, B, seen };
}

test('two worlds, seed 99, the same seeded intent script for 3000 ticks: identical step() results and entities', () => {
  const { A, B, seen } = run(SEED, TICKS, makeWorld(SEED));
  assert.equal(JSON.stringify(A.w.ents), JSON.stringify(B.w.ents), 'final ents differ');
  assert.equal(JSON.stringify(toDoc(A.p)), JSON.stringify(toDoc(B.p)));
  assert.equal(A.w.tick, B.w.tick);
  assert.equal(A.w.zones.gallowsmoor.streams.combat.state, B.w.zones.gallowsmoor.streams.combat.state);
  assert.equal(A.w.zones.gallowsmoor.streams.loot.state, B.w.zones.gallowsmoor.streams.loot.state);
  // the script exercised the loop: swings, kills, potions, pickups, equipment
  for (const k of ['skill', 'hit', 'kill', 'potion', 'drop', 'xp']) assert.ok(seen[k] > 0, 'no ' + k + ' event: ' + JSON.stringify(seen));
  assert.ok((seen.pickup || 0) + (seen.gold || 0) > 0, 'nothing picked up: ' + JSON.stringify(seen));
  assert.ok(seen.equip > 0 || seen.invalid > 0, 'no inventory act ran');
});

test('a different seed diverges (the check above is not vacuous)', () => {
  const a = run(SEED, 300).A, b = run(SEED + 1, 300).A;
  assert.notEqual(JSON.stringify(a.w.ents), JSON.stringify(b.w.ents));
});
