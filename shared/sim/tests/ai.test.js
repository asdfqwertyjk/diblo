// Monster brains against the timings in monsters.curve: sight, windup, attack cadence, leash,
// flee, pack aggro, ranged kiting, stun and knockback. Worlds are the real moor (monsters
// decorated with combat.monsterStats the way world.js will); the player is a stationary
// target moved by writing x/z. Ticks call stepProjectiles then stepMonsters (world.step order).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import recipes from '../../data/zones/index.js';
import classes from '../../data/classes.js';
import monsters from '../../data/monsters.js';
import { createWorld, addPlayer, TICK_HZ, DT } from '../world.js';
import { makeStreams } from '../rng.js';
import { buildColliderGrid, canStand } from '../movement.js';
import { walkableCell } from '../zonegen.js';
import { monsterStats } from '../combat.js';
import { stepMonsters, initMonsterAI } from '../ai.js';
import { stepProjectiles } from '../projectiles.js';

const cv = monsters.curve;
const hero = { name: 'T', cls: 'warrior', level: 1 };
const hyp = (x, z) => Math.sqrt(x * x + z * z);
const dist = (a, b) => hyp(a.x - b.x, a.z - b.z);
const WINDUP = Math.round(cv.windup * TICK_HZ);        // 10
const EVERY = Math.round(cv.attackEvery * TICK_HZ);    // 24
const FLEE = Math.round(cv.fleeSec * TICK_HZ);         // 60
const SEEDS = [42, 1, 7, 1234, 77, 3, 11, 99];

function decorate(w, zone, m) {
  const s = monsterStats(m.type, m.level, m.champion, w.players.length, { dropTable: zone.recipe.dropTable });
  Object.assign(m, { hpMax: s.hpMax, hp: s.hpMax, dmg: s.dmg, armour: s.armour, xpValue: s.xpValue, speed: s.speed, dropTable: s.dropTable });
  initMonsterAI(m);
}

function setup(seed = 42) {
  const w = createWorld({ recipes, seed });
  const pid = addPlayer(w, hero);
  const p = w.ents[pid];
  const zone = w.zones[p.zone];
  for (const id of zone.ents) { const m = w.ents[id]; if (m.kind === 'monster') decorate(w, zone, m); }
  w.events = [];
  return { w, p, zone };
}
const mons = (w, zone) => [...zone.ents].map((id) => w.ents[id]).filter((e) => e.kind === 'monster');
function only(w, zone, keep) { for (const m of mons(w, zone)) if (!keep.includes(m)) m.dead = true; }
function tick(w, zone, n = 1) { for (let i = 0; i < n; i++) { w.tick++; stepProjectiles(w, zone); stepMonsters(w, zone); } }
function ticksUntil(w, zone, pred, max = 600) { for (let i = 0; i < max; i++) { tick(w, zone); if (pred()) return i + 1; } return -1; }
const hits = (w) => w.events.filter((e) => e.k === 'hit');
function place(p, m, dir, d) { p.x = m.x + dir[0] * d; p.z = m.z + dir[1] * d; }

/** True when a circle of radius r can stand everywhere along the segment, clear of prop colliders. */
function clearRay(zone, x, z, ux, uz, len, r) {
  const L = zone.layout;
  for (let s = 0; s <= len; s += 0.25) {
    const px = x + ux * s, pz = z + uz * s;
    if (!canStand(L, px, pz, r)) return false;
    for (const c of L.colliders) if (hyp(px - c.x, pz - c.z) < r + c.r + 0.3) return false;
  }
  return true;
}
const DIRS = [];
for (let i = 0; i < 72; i++) DIRS.push([Math.cos(i * Math.PI / 36), Math.sin(i * Math.PI / 36)]);
function clearDir(zone, m, ahead, behind) {
  const r = Math.max(m.r, classes.classes.warrior.radius);
  for (const [ux, uz] of DIRS) {
    if (clearRay(zone, m.x, m.z, ux, uz, ahead, r) && (behind <= 0 || clearRay(zone, m.x, m.z, -ux, -uz, behind, r))) return [ux, uz];
  }
  return null;
}
/** A plain monster of `type` with `ahead` metres clear in some direction (and `behind` the other way), any seed. */
function find(type, ahead, behind = 0) {
  for (const seed of SEEDS) {
    const s = setup(seed);
    for (const m of mons(s.w, s.zone)) {
      if (m.type !== type || m.champion) continue;
      const dir = clearDir(s.zone, m, ahead, behind);
      if (dir) return { ...s, m, dir, seed };
    }
  }
  assert.fail(`no ${type} with ${ahead} m clear (${behind} behind) in seeds ${SEEDS}`);
}

// --- synthetic zone for wall cases -------------------------------------------------------
function boxZone(N, blocked = () => false) {
  const walk = new Uint8Array(N * N);
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) if (!blocked(x, z)) walk[z * N + x] = 1;
  const zone = { id: 'box', layout: { size: N, walk, colliders: [] }, streams: makeStreams(5, 'box'), ents: new Set(), grid: null, gridW: 0 };
  buildColliderGrid(zone);
  return zone;
}
function fakeWorld(zone) { return { tick: 0, events: [], ents: {}, players: [], zones: { box: zone }, intents: {}, nextId: 1, _gone: [], _last: {} }; }
function addFake(w, zone, e) { w.ents[e.id] = e; zone.ents.add(e.id); if (e.kind === 'player') w.players.push(e.id); return e; }
function fakeMonster(w, zone, type, x, z) {
  const t = monsters.types[type], s = monsterStats(type, 1, false, 1);
  const m = { id: 'm' + w.nextId++, kind: 'monster', type, arch: t.arch, r: t.r, level: 1, zone: 'box', x, z, dx: 0, dz: 1, anim: 'idle',
    pack: 0, hp: s.hpMax, hpMax: s.hpMax, dmg: s.dmg, armour: s.armour, speed: s.speed, dead: false };
  initMonsterAI(m);
  return addFake(w, zone, m);
}
function fakePlayer(w, zone, x, z) {
  return addFake(w, zone, { id: 'p1', kind: 'player', zone: 'box', x, z, dx: 0, dz: 1, r: classes.classes.warrior.radius, hp: 120, hpMax: 120, level: 1, anim: 'idle' });
}

test('initMonsterAI stores the anchor at the current position with the API.md field set', () => {
  const m = { id: 'm1', kind: 'monster', x: 12.5, z: 40.25 };
  const ai = initMonsterAI(m);
  assert.equal(ai, m.ai);
  assert.deepEqual(Object.keys(ai).sort(), ['anchorX', 'anchorZ', 'fleeUntil', 'nextThink', 'recoverUntil', 'state', 'targetId', 'windupUntil']);
  assert.deepEqual(ai, { state: 'idle', targetId: null, anchorX: 12.5, anchorZ: 40.25, nextThink: 0, windupUntil: 0, recoverUntil: 0, fleeUntil: 0 });
  assert.equal(m.stunUntil, 0);
  assert.equal(m.kb, null);
  const kept = { id: 'm2', x: 1, z: 2, stunUntil: 30, kb: { dx: 1, dz: 0, left: 2, step: 0.5 } };
  initMonsterAI(kept);
  assert.equal(kept.stunUntil, 30, 'an existing stun is kept');
  assert.equal(kept.kb.left, 2);
  assert.equal(WINDUP, 10); assert.equal(EVERY, 24); assert.equal(FLEE, 60);
});

test('a wolf idles at 20 m, chases at 10 m, winds up 10 ticks, hits, then attacks every 24 ticks', () => {
  const { w, p, zone, m, dir } = find('gallowswolf', 21);
  only(w, zone, [m]);
  place(p, m, dir, 20);
  const x0 = m.x, z0 = m.z;
  tick(w, zone, 5);
  assert.equal(m.ai.state, 'idle');
  assert.deepEqual([m.x, m.z], [x0, z0]);
  assert.equal(m.anim, 'idle');
  assert.deepEqual(w.events, []);
  // inside sight: chase, aggro event, one step this very tick
  place(p, m, dir, 10);
  tick(w, zone);
  assert.equal(m.ai.state, 'chase');
  assert.equal(m.ai.targetId, p.id);
  assert.deepEqual(w.events, [{ k: 'aggro', id: m.id, type: m.type }]);
  const stepLen = m.speed * DT;
  assert.ok(Math.abs(dist(m, p) - (10 - stepLen)) < 1e-6, 'moved speed·DT toward the player: ' + dist(m, p));
  assert.equal(m.anim, 'run');
  assert.ok(Math.abs(m.dx - dir[0]) < 1e-9 && Math.abs(m.dz - dir[1]) < 1e-9, 'faces the player');
  // reaches melee reach and stops
  const reach = m.r + p.r + cv.meleeReach;
  const n = ticksUntil(w, zone, () => m.ai.state === 'windup', 100);
  assert.ok(n > 0, 'never reached windup');
  const T = w.tick;
  assert.ok(dist(m, p) <= reach && dist(m, p) > reach - stepLen - 1e-9, 'stopped inside reach: ' + dist(m, p));
  assert.equal(m.anim, 'attack');
  assert.equal(m.ai.windupUntil, T + WINDUP);
  assert.equal(m.ai.recoverUntil, T + EVERY);
  // nine quiet ticks of windup, the hit on the tenth
  const hp0 = p.hp, mx = m.x, mz = m.z;
  w.events.length = 0;
  tick(w, zone, WINDUP - 1);
  assert.equal(hits(w).length, 0);
  assert.equal(p.hp, hp0);
  assert.equal(m.ai.state, 'windup');
  assert.deepEqual([m.x, m.z], [mx, mz], 'stands still while winding up');
  tick(w, zone);
  assert.equal(w.tick, T + WINDUP);
  const h = hits(w);
  assert.equal(h.length, 1);
  assert.deepEqual(h[0], { k: 'hit', src: m.id, tgt: p.id, dmg: h[0].dmg, crit: false, el: 'phys', x: p.x, z: p.z });
  assert.ok(h[0].dmg >= m.dmg[0] && h[0].dmg <= m.dmg[1], `dmg ${h[0].dmg} within ${m.dmg}`);
  assert.equal(p.hp, hp0 - h[0].dmg);
  assert.equal(p.lastCombatTick, w.tick);
  assert.equal(m.ai.state, 'recover');
  // cadence: hits exactly attackEvery ticks apart, standing still between them
  const hitTicks = [w.tick];
  for (let i = 0; i < 3; i++) {
    w.events.length = 0;
    const k = ticksUntil(w, zone, () => hits(w).length > 0, EVERY + 5);
    assert.ok(k > 0, 'no follow-up hit');
    hitTicks.push(w.tick);
  }
  assert.deepEqual(hitTicks.slice(1).map((t, i) => t - hitTicks[i]), [EVERY, EVERY, EVERY]);
  assert.deepEqual([m.x, m.z], [mx, mz]);
  assert.equal(p.hp, hp0 - hitTicks.length * 0 - (hp0 - p.hp));
  assert.ok(p.hp < hp0 - 3 * m.dmg[0], 'four hits landed');
  // recover shows idle, windup shows attack
  tick(w, zone);
  assert.equal(m.ai.state, 'recover');
  assert.equal(m.anim, 'idle');
  tick(w, zone, EVERY - WINDUP - 1);
  assert.equal(m.ai.state, 'windup');
  assert.equal(m.anim, 'attack');
});

test('a hit only lands while the target is still within reach + meleeReach', () => {
  const { w, p, zone, m, dir } = find('gallowswolf', 12);
  only(w, zone, [m]);
  place(p, m, dir, 6);
  ticksUntil(w, zone, () => m.ai.state === 'windup', 100);
  const reach = m.r + p.r + cv.meleeReach;
  place(p, m, dir, reach + cv.meleeReach + 0.2);
  w.events.length = 0;
  tick(w, zone, WINDUP);
  assert.equal(hits(w).length, 0, 'stepped out of reach: whiff');
  assert.equal(m.ai.state, 'recover', 'a whiff still costs the recover');
  // within the slack: lands
  ticksUntil(w, zone, () => m.ai.state === 'windup', 100);
  place(p, m, dir, reach + cv.meleeReach - 0.05);
  tick(w, zone, WINDUP);
  assert.equal(hits(w).length, 1);
});

test('leash: dragged 31 m from its anchor a wolf returns, ignores the player, and heals on arrival', () => {
  const { w, p, zone, m, dir } = find('gallowswolf', 32.5);
  only(w, zone, [m]);
  const ax = m.x, az = m.z;
  m.ai.state = 'chase'; m.ai.targetId = p.id;
  m.hp = Math.floor(m.hpMax / 2);
  m.x = ax + dir[0] * 31; m.z = az + dir[1] * 31;
  place(p, m, dir, 1);
  tick(w, zone);
  assert.equal(m.ai.state, 'return');
  assert.equal(m.ai.targetId, null);
  assert.equal(m.anim, 'run');
  assert.ok(hyp(m.x - ax, m.z - az) < 31 - m.speed * DT + 1e-6, 'walking home');
  assert.ok(Math.abs(m.dx + dir[0]) < 1e-9 && Math.abs(m.dz + dir[1]) < 1e-9, 'faces the anchor');
  assert.equal(m.hp, Math.floor(m.hpMax / 2), 'no healing on the way');
  const n = ticksUntil(w, zone, () => m.ai.state === 'idle', 400);
  assert.ok(n > 0 && n <= Math.ceil(31 / (m.speed * DT)) + 1, 'arrived in ' + n);
  assert.ok(hyp(m.x - ax, m.z - az) <= m.r + 1e-9, 'stands on the anchor');
  assert.equal(m.hp, m.hpMax);
  assert.equal(m.anim, 'idle');
  assert.equal(m.ai.fleeUntil, 0);
  assert.equal(hits(w).length, 0, 'never swung at the player on the way');
  tick(w, zone, 5);
  assert.equal(m.ai.state, 'idle', 'the player is 32 m away: stays idle');
  // right at 30 m it keeps chasing
  m.ai.state = 'chase';
  m.x = ax + dir[0] * 29.9; m.z = az + dir[1] * 29.9;
  place(p, m, dir, 1);
  tick(w, zone);
  assert.equal(m.ai.state, 'windup');
});

test('an unreachable anchor: the wolf gives up after the deadline, settles and heals there', () => {
  for (const seed of SEEDS) {
    const { w, p, zone } = setup(seed);
    const L = zone.layout;
    for (const m of mons(w, zone)) {
      let cell = null;
      for (let dz = -4; dz <= 4 && !cell; dz++) for (let dx = -4; dx <= 4 && !cell; dx++) {
        const cx = Math.floor(m.x) + dx, cz = Math.floor(m.z) + dz;
        if (!walkableCell(L, cx, cz) && hyp(cx + 0.5 - m.x, cz + 0.5 - m.z) >= 2) cell = [cx + 0.5, cz + 0.5];
      }
      if (!cell) continue;
      only(w, zone, [m]);
      p.dead = true; // nobody to chase: it walks home
      m.hp = 1;
      m.ai.anchorX = cell[0]; m.ai.anchorZ = cell[1];
      m.ai.state = 'chase';
      tick(w, zone);
      assert.equal(m.ai.state, 'return');
      const deadline = m.ai.nextThink;
      const n = ticksUntil(w, zone, () => m.ai.state === 'idle', 400);
      assert.ok(n > 0, 'never settled');
      assert.ok(w.tick <= deadline, `settled at ${w.tick}, deadline ${deadline}`);
      assert.equal(m.hp, m.hpMax);
      assert.ok(canStand(L, m.x, m.z, m.r), 'settled on walkable ground');
      assert.ok(Math.abs(m.ai.anchorX - m.x) < 1e-9 || hyp(m.ai.anchorX - m.x, m.ai.anchorZ - m.z) <= m.r + 1e-9, 're-anchored where it stands');
      return;
    }
  }
  assert.fail('no monster with a cliff or water cell nearby');
});

test('a swarm monster under 20% hp flees for 60 ticks, then re-engages and does not flee again', () => {
  const { w, p, zone, m, dir } = find('carrioncrow', 6, 18);
  assert.equal(m.arch, 'swarm');
  only(w, zone, [m]);
  place(p, m, dir, 5);
  tick(w, zone);
  assert.equal(m.ai.state, 'chase');
  m.hp = Math.max(1, Math.floor(m.hpMax * cv.fleeBelow) - 1);
  assert.ok(m.hp < cv.fleeBelow * m.hpMax);
  let d = dist(m, p);
  tick(w, zone);
  assert.equal(m.ai.state, 'flee');
  assert.equal(m.ai.fleeUntil, w.tick + FLEE);
  assert.equal(m.anim, 'run');
  assert.ok(dist(m, p) > d, 'runs away');
  const stepLen = m.speed * DT;
  const until = m.ai.fleeUntil;
  for (let t = w.tick + 1; t < until; t++) {
    d = dist(m, p);
    tick(w, zone);
    assert.equal(m.ai.state, 'flee', 'tick ' + t);
    assert.ok(Math.abs(dist(m, p) - d - stepLen) < 1e-6, `flees a full step at tick ${t}: ${dist(m, p) - d}`);
  }
  tick(w, zone);
  assert.equal(w.tick, until);
  assert.equal(m.ai.state, 'chase', 're-engages when the timer runs out');
  assert.equal(m.ai.fleeUntil, until);
  d = dist(m, p);
  tick(w, zone);
  assert.ok(dist(m, p) < d, 'closing again');
  assert.equal(m.ai.state, 'chase');
  // still under 20%, but it fled already: it fights to the death
  const n = ticksUntil(w, zone, () => hits(w).length > 0, 200);
  assert.ok(n > 0, 'never landed a hit after re-engaging');
  assert.equal(m.ai.fleeUntil, until);
  assert.ok(m.ai.state !== 'flee');
  // a rusher never flees
  const { w: w2, p: p2, zone: z2, m: wolf, dir: dir2 } = find('gallowswolf', 4);
  only(w2, z2, [wolf]);
  place(p2, wolf, dir2, 3);
  tick(w2, z2);
  wolf.hp = 1;
  tick(w2, z2, 5);
  assert.ok(wolf.ai.state !== 'flee');
  assert.equal(wolf.ai.fleeUntil, 0);
});

test('pack aggro: alerting one monster alerts every live pack mate (even out of sight), never another pack, one event', () => {
  let cfg = null;
  for (const seed of SEEDS) {
    const s = setup(seed);
    const ms = mons(s.w, s.zone);
    const packs = new Map();
    for (const m of ms) { if (!packs.has(m.pack)) packs.set(m.pack, []); packs.get(m.pack).push(m); }
    for (const [pi, members] of packs) {
      if (members.length < 3) continue;
      for (const a of members) {
        for (const [ux, uz] of DIRS) {
          if (!clearRay(s.zone, a.x, a.z, ux, uz, 11.5, 0.45)) continue;
          const px = a.x + ux * 11, pz = a.z + uz * 11;
          const far = members.filter((o) => o !== a && hyp(o.x - px, o.z - pz) > cv.sight + 0.5);
          if (!far.length) continue;
          const others = ms.filter((o) => o.pack !== pi);
          if (others.some((o) => hyp(o.x - px, o.z - pz) <= cv.sight + 0.5)) continue;
          cfg = { ...s, members, a, px, pz, far, others, pi };
          break;
        }
        if (cfg) break;
      }
      if (cfg) break;
    }
    if (cfg) break;
  }
  assert.ok(cfg, 'no pack layout found');
  const { w, p, zone, members, px, pz, far, others } = cfg;
  const dead = members[members.length - 1];
  dead.dead = true;
  p.x = px; p.z = pz;
  tick(w, zone);
  for (const m of members) {
    if (m === dead) { assert.equal(m.ai.state, 'idle', 'a dead mate is not alerted'); continue; }
    assert.equal(m.ai.state, 'chase', `mate ${m.id} at ${dist(m, p).toFixed(1)} m`);
    assert.equal(m.ai.targetId, p.id);
  }
  assert.ok(far.some((m) => m !== dead && m.ai.state === 'chase'), 'a mate beyond sight joined');
  for (const o of others) assert.equal(o.ai.state, 'idle', `other pack ${o.pack} stayed idle`);
  const aggro = w.events.filter((e) => e.k === 'aggro');
  assert.equal(aggro.length, 1, 'one aggro event per pack');
  assert.ok(members.includes(w.ents[aggro[0].id]));
  assert.equal(aggro[0].type, w.ents[aggro[0].id].type);
  w.events.length = 0;
  tick(w, zone, 10);
  assert.equal(w.events.filter((e) => e.k === 'aggro').length, 0, 'no repeat while chasing');
  for (const o of others) if (hyp(o.x - px, o.z - pz) > cv.sight + 1) assert.equal(o.ai.state, 'idle');
});

test('a poacher closes to 9 m, fires arrows that hit a stationary player, and backs off to 6 m when crowded', () => {
  const { w, p, zone, m, dir } = find('moorpoacher', 11.5, 8);
  assert.equal(m.arch, 'ranged');
  only(w, zone, [m]);
  const rg = cv.ranged, stepLen = m.speed * DT;
  place(p, m, dir, 10.5);
  tick(w, zone);
  assert.equal(m.ai.state, 'chase');
  const n = ticksUntil(w, zone, () => m.ai.state === 'windup', 40);
  assert.ok(n > 0);
  const d = dist(m, p);
  assert.ok(d <= rg.keepMax && d > rg.keepMax - stepLen - 1e-9, 'stopped inside the band: ' + d);
  assert.ok(Math.abs(m.dx - dir[0]) < 1e-9, 'faces the player');
  const T = w.tick;
  w.events.length = 0;
  tick(w, zone, WINDUP - 1);
  assert.equal(w.events.filter((e) => e.k === 'proj').length, 0);
  tick(w, zone);
  const pe = w.events.filter((e) => e.k === 'proj');
  assert.equal(pe.length, 1);
  const q = w.ents[pe[0].id];
  assert.equal(q.kind, 'proj');
  assert.equal(q.zone, zone.id);
  assert.equal(q.src, m.id);
  assert.equal(q.speed, rg.arrowSpeed);
  assert.equal(q.ttl, rg.arrowTtlTicks);
  assert.deepEqual(q.dmg, m.dmg);
  assert.equal(q.level, m.level);
  assert.equal(q.el, 'phys');
  assert.ok(Math.abs(hyp(q.x - m.x, q.z - m.z) - m.r) < 1e-9, 'loosed from the bow, not the chest');
  assert.ok(Math.abs(q.dx - dir[0]) < 1e-9 && Math.abs(q.dz - dir[1]) < 1e-9);
  assert.equal(m.ai.state, 'recover');
  const hp0 = p.hp, mx = m.x, mz = m.z;
  const flight = ticksUntil(w, zone, () => hits(w).length > 0, 20);
  assert.ok(flight > 0, 'the arrow never arrived');
  assert.ok(flight <= Math.ceil((d - m.r - p.r - q.r) / (rg.arrowSpeed * DT)) + 1, 'flew at arrowSpeed: ' + flight);
  const h = hits(w)[0];
  assert.equal(h.src, m.id, 'the hit names the shooter');
  assert.equal(h.tgt, p.id);
  assert.ok(h.dmg >= m.dmg[0] && h.dmg <= m.dmg[1]);
  assert.equal(p.hp, hp0 - h.dmg);
  assert.equal(w.ents[q.id], undefined, 'arrow consumed');
  assert.ok(!zone.ents.has(q.id));
  assert.ok(w._gone.includes(q.id));
  assert.deepEqual([m.x, m.z], [mx, mz], 'holds position inside the band');
  // keeps shooting every attackEvery ticks from the same spot
  w.events.length = 0;
  const fireTicks = [];
  for (let i = 0; i < 2; i++) {
    const k = ticksUntil(w, zone, () => w.events.some((e) => e.k === 'proj'), EVERY + 2);
    assert.ok(k > 0);
    fireTicks.push(w.tick);
    w.events.length = 0;
  }
  assert.equal(fireTicks[1] - fireTicks[0], EVERY);
  assert.equal(fireTicks[0] - T, EVERY + WINDUP);
  assert.deepEqual([m.x, m.z], [mx, mz]);
  // the player walks up: it backs off along the clear ray until keepMin, then draws again
  place(p, m, dir, 3);
  const bx = m.x, bz = m.z;
  const k = ticksUntil(w, zone, () => m.ai.state === 'windup', 60);
  assert.ok(k > 0, 'never re-drew after backing off');
  const d2 = dist(m, p);
  assert.ok(d2 >= rg.keepMin && d2 < rg.keepMin + stepLen + 1e-9, 'backed off to keepMin: ' + d2);
  const back = [m.x - bx, m.z - bz];
  assert.ok(back[0] * dir[0] + back[1] * dir[1] < 0, 'moved away from the player');
  w.events.length = 0;
  tick(w, zone, WINDUP);
  assert.equal(w.events.filter((e) => e.k === 'proj').length, 1);
  // out of fireRange at the moment of release: no arrow
  ticksUntil(w, zone, () => m.ai.state === 'windup', 60);
  place(p, m, dir, rg.fireRange + 0.5);
  w.events.length = 0;
  tick(w, zone, WINDUP);
  assert.equal(w.events.filter((e) => e.k === 'proj').length, 0);
  assert.equal(m.ai.state, 'recover');
});

test('a cornered poacher shoots point-blank instead of shuffling forever', () => {
  const zone = boxZone(24);
  const w = fakeWorld(zone);
  const m = fakeMonster(w, zone, 'moorpoacher', 12, 1.5);
  const p = fakePlayer(w, zone, 12, 4.5);
  tick(w, zone);
  assert.equal(m.ai.state, 'windup', 'cannot back off through the wall: draws');
  assert.deepEqual([m.x, m.z], [12, 1.5]);
  tick(w, zone, WINDUP);
  assert.equal(w.events.filter((e) => e.k === 'proj').length, 1);
  const n = ticksUntil(w, zone, () => hits(w).length > 0, 10);
  assert.ok(n > 0);
  assert.ok(p.hp < 120);
});

test('arrows die on non-walkable cells: a poacher behind a wall never hurts the player', () => {
  const zone = boxZone(24, (x, z) => z === 8);
  const w = fakeWorld(zone);
  const m = fakeMonster(w, zone, 'moorpoacher', 12, 3.5);
  const p = fakePlayer(w, zone, 12, 11.5);
  tick(w, zone, 120);
  const shots = w.events.filter((e) => e.k === 'proj');
  assert.ok(shots.length >= 3, 'kept shooting: ' + shots.length);
  assert.equal(hits(w).length, 0);
  assert.equal(p.hp, 120);
  assert.equal([...zone.ents].filter((id) => id[0] === 'q').length, 0, 'no arrow lingers');
  for (const s of shots) assert.ok(w._gone.includes(s.id));
});

test('a stunned monster does nothing until stunUntil, and a stun cancels a windup', () => {
  const { w, p, zone, m, dir } = find('gallowswolf', 4);
  only(w, zone, [m]);
  const reach = m.r + p.r + cv.meleeReach;
  place(p, m, dir, reach - 0.2);
  const t0 = w.tick;
  m.stunUntil = t0 + 20;
  const x0 = m.x, z0 = m.z, dx0 = m.dx, dz0 = m.dz;
  tick(w, zone, 19);
  assert.equal(m.ai.state, 'idle');
  assert.deepEqual([m.x, m.z, m.dx, m.dz], [x0, z0, dx0, dz0]);
  assert.equal(m.anim, 'hit');
  assert.deepEqual(w.events, []);
  tick(w, zone);
  assert.equal(w.tick, m.stunUntil, 'acts on the tick stunUntil is reached');
  assert.equal(m.ai.state, 'windup');
  assert.equal(w.events.filter((e) => e.k === 'aggro').length, 1);
  // a stun in the middle of a windup: no hit at the old windupUntil, a fresh windup after
  const old = m.ai.windupUntil;
  tick(w, zone, 4);
  m.stunUntil = w.tick + 8;
  w.events.length = 0;
  tick(w, zone, 7);
  assert.ok(w.tick > old);
  assert.equal(hits(w).length, 0, 'the interrupted swing never lands');
  assert.equal(m.ai.state, 'chase');
  tick(w, zone);
  assert.equal(m.ai.state, 'windup');
  assert.equal(m.ai.windupUntil, w.tick + WINDUP);
  tick(w, zone, WINDUP);
  assert.equal(hits(w).length, 1);
});

test('knockback is consumed first: the monster is hurled, cannot act, then resumes the chase', () => {
  const { w, p, zone, m, dir } = find('gallowswolf', 4, 4);
  only(w, zone, [m]);
  const reach = m.r + p.r + cv.meleeReach;
  place(p, m, dir, reach - 0.2);
  tick(w, zone);
  assert.equal(m.ai.state, 'windup');
  const x0 = m.x, z0 = m.z;
  m.kb = { dx: -dir[0], dz: -dir[1], left: 4, step: 0.5 };
  w.events.length = 0;
  for (let i = 1; i <= 4; i++) {
    tick(w, zone);
    assert.ok(Math.abs(hyp(m.x - x0, m.z - z0) - 0.5 * i) < 1e-6, `hurled 0.5 m on tick ${i}`);
    assert.equal(m.anim, 'hit');
    assert.equal(m.ai.state, 'chase', 'the windup was cancelled');
  }
  assert.equal(m.kb, null);
  assert.equal(hits(w).length, 0);
  const n = ticksUntil(w, zone, () => hits(w).length > 0, 40);
  assert.ok(n > 0, 'came back and hit');
});

test('dead or dying monsters skip their brain; a monster without ai gets one lazily', () => {
  const { w, p, zone, m, dir } = find('gallowswolf', 4);
  only(w, zone, [m]);
  place(p, m, dir, 3);
  m.dead = true;
  tick(w, zone, 3);
  assert.equal(m.ai.state, 'idle');
  assert.deepEqual(w.events, []);
  m.dead = false; m.hp = 0;
  tick(w, zone, 3);
  assert.equal(m.ai.state, 'idle', 'hp ≤ 0 but not yet flagged: still nothing');
  m.hp = m.hpMax;
  delete m.ai;
  const bx = m.x, bz = m.z;
  tick(w, zone);
  assert.ok(m.ai, 'ai created');
  assert.deepEqual([m.ai.anchorX, m.ai.anchorZ], [bx, bz], 'anchored where it stood before moving');
  assert.equal(m.ai.state, 'chase');
  assert.ok(dist(m, p) < 3, 'and it acted in the same tick');
});

test('monsters ignore dead players and go home when nobody is left', () => {
  const { w, p, zone, m, dir } = find('gallowswolf', 4);
  only(w, zone, [m]);
  place(p, m, dir, m.r + p.r + cv.meleeReach - 0.2);
  tick(w, zone);
  assert.equal(m.ai.state, 'windup');
  p.dead = true;
  tick(w, zone, WINDUP);
  assert.equal(hits(w).length, 0, 'no swing at a corpse');
  tick(w, zone, EVERY);
  assert.equal(m.ai.state, 'idle', 'returned and settled');
  assert.equal(m.hp, m.hpMax);
  p.dead = false; p.hp = 0;
  tick(w, zone, 3);
  assert.equal(m.ai.state, 'idle', 'a player at 0 hp is not a target');
});

test('two worlds with the same seed and scripted player positions stay identical (500 ticks, hits and arrows)', () => {
  const run = (seed) => {
    const { w, p, zone } = setup(seed);
    const ms = mons(w, zone);
    const log = [];
    let acted = 0;
    for (let t = 0; t < 500; t++) {
      if (t % 50 === 0) {
        const m = ms[(t / 50) % ms.length];
        p.x = m.x + 3; p.z = m.z; p.hp = p.hpMax;
      }
      tick(w, zone);
      acted += w.events.length;
      log.push(JSON.stringify(w.events));
      w.events = [];
    }
    assert.ok(acted > 20, 'something happened: ' + acted);
    const rows = Object.values(w.ents).map((e) => JSON.stringify(e));
    return log.join('\n') + '\n' + rows.join('\n') + '\n' + zone.streams.combat.state;
  };
  assert.equal(run(42), run(42));
  assert.notEqual(run(42), run(7));
});
