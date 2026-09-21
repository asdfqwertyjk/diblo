// Projectiles: spawn shape and table defaults, straight flight at speed·DT, hits through
// combat.monsterAttack (block, armour DR by the arrow's level, resists), removal on hit /
// ttl / non-walkable cells, and step() bookkeeping. Worlds are the real moor; arrows fly
// across the flattened spawn pad, which zonegen keeps walkable and prop-free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import recipes from '../../data/zones/index.js';
import monsters from '../../data/monsters.js';
import { createWorld, addPlayer, step, DT } from '../world.js';
import { walkableAt } from '../zonegen.js';
import classes from '../../data/classes.js';
import { armourDR } from '../combat.js';
import { spawnProjectile, stepProjectiles } from '../projectiles.js';

const RULES = classes.combat;

const rg = monsters.curve.ranged;
const hero = { name: 'T', cls: 'warrior', level: 1 };
const hyp = (x, z) => Math.sqrt(x * x + z * z);

function setup(seed = 42) {
  const w = createWorld({ recipes, seed });
  const pid = addPlayer(w, hero);
  const p = w.ents[pid];
  const zone = w.zones[p.zone];
  const sp = zone.layout.playerSpawn;
  for (let x = -6; x <= 6; x += 0.5) assert.ok(walkableAt(zone.layout, sp.x + x, sp.z), 'pad walkable at ' + x);
  w.events = [];
  return { w, p, zone, sp };
}
function tick(w, zone, n = 1) { for (let i = 0; i < n; i++) { w.tick++; stepProjectiles(w, zone); } }
const hits = (w) => w.events.filter((e) => e.k === 'hit');
const arrows = (zone) => [...zone.ents].filter((id) => id[0] === 'q');

test('spawnProjectile: q<n> ids, API.md shape, table defaults, normalised direction, proj event', () => {
  const { w, zone, sp } = setup();
  const n0 = w.nextId;
  const id = spawnProjectile(w, zone, { x: sp.x, z: sp.z, dx: 3, dz: 4, dmg: [4, 6], src: 'm7', level: 3 });
  assert.equal(id, 'q' + n0);
  assert.equal(w.nextId, n0 + 1);
  const q = w.ents[id];
  assert.deepEqual(q, {
    id, kind: 'proj', zone: zone.id, x: sp.x, z: sp.z, dx: 0.6, dz: 0.8,
    speed: rg.arrowSpeed, dmg: [4, 6], el: 'phys', src: 'm7', ttl: rg.arrowTtlTicks, r: rg.arrowR, level: 3,
  });
  assert.equal(q.speed, 16); assert.equal(q.ttl, 40); assert.equal(q.r, 0.2);
  assert.ok(zone.ents.has(id));
  assert.deepEqual(w.events, [{ k: 'proj', id }]);
  // overrides, scalar dmg, level floor, dmg copied not shared
  const dmg = [9, 9];
  const q2 = w.ents[spawnProjectile(w, zone, { x: 1, z: 2, dx: 0, dz: -1, dmg, speed: 5, ttl: 7.9, r: 0.5, el: 'fire', level: 0 })];
  assert.equal(q2.speed, 5); assert.equal(q2.ttl, 7); assert.equal(q2.r, 0.5); assert.equal(q2.el, 'fire');
  assert.equal(q2.level, 1); assert.equal(q2.src, null);
  assert.notEqual(q2.dmg, dmg); assert.deepEqual(q2.dmg, [9, 9]);
  const q3 = w.ents[spawnProjectile(w, zone, { x: 1, z: 2, dx: 0, dz: 0, dmg: 12 })];
  assert.deepEqual(q3.dmg, [12, 12]);
  assert.deepEqual([q3.dx, q3.dz], [0, 0]);
});

test('an arrow moves speed·DT per tick along its direction and expires when ttl runs out', () => {
  const { w, p, zone, sp } = setup();
  p.x = -50; p.z = -50; // off the pad: nothing to hit
  const speed = 2, ttl = 12;
  const id = spawnProjectile(w, zone, { x: sp.x, z: sp.z, dx: 1, dz: 0, dmg: [1, 1], speed, ttl });
  const q = w.ents[id];
  for (let i = 1; i < ttl; i++) {
    tick(w, zone);
    assert.ok(w.ents[id], 'alive at tick ' + i);
    assert.ok(Math.abs(q.x - (sp.x + speed * DT * i)) < 1e-9 && q.z === sp.z, 'position at tick ' + i);
    assert.equal(q.ttl, ttl - i);
  }
  tick(w, zone);
  assert.equal(w.ents[id], undefined, 'gone on the ttl-th tick');
  assert.ok(!zone.ents.has(id));
  assert.deepEqual(w._gone, [id]);
  assert.equal(hits(w).length, 0);
  // the default ttl from the table
  const slow = spawnProjectile(w, zone, { x: sp.x, z: sp.z, dx: 0, dz: 0, dmg: [1, 1] });
  tick(w, zone, rg.arrowTtlTicks - 1);
  assert.ok(w.ents[slow]);
  tick(w, zone);
  assert.equal(w.ents[slow], undefined);
});

test('an arrow hits the nearest live player within r + p.r with monster damage and is consumed', () => {
  const { w, p, zone, sp } = setup();
  p.x = sp.x; p.z = sp.z;
  const start = sp.x - 4;
  const id = spawnProjectile(w, zone, { x: start, z: sp.z, dx: 1, dz: 0, dmg: [7, 9], src: 'm3', level: 1 });
  const q = w.ents[id];
  const hp0 = p.hp;
  let n = 0;
  while (w.ents[id] && n < 20) { tick(w, zone); n++; }
  assert.ok(n < 20, 'never hit');
  // the first tick whose end position lies within r + p.r
  const reach = q.r + p.r;
  const stepLen = rg.arrowSpeed * DT;
  let expect = 0;
  while (hyp(start + stepLen * (expect + 1) - p.x, 0) > reach) expect++;
  assert.equal(n, expect + 1);
  const h = hits(w);
  assert.equal(h.length, 1);
  assert.deepEqual(h[0], { k: 'hit', src: 'm3', tgt: p.id, dmg: h[0].dmg, crit: false, el: 'phys', x: p.x, z: p.z });
  assert.ok(h[0].dmg >= 7 && h[0].dmg <= 9);
  assert.equal(p.hp, hp0 - h[0].dmg);
  assert.equal(p.lastCombatTick, w.tick);
  assert.ok(!zone.ents.has(id) && w._gone.includes(id));
  // without a src the arrow's own id is the source
  w.events.length = 0;
  const bare = spawnProjectile(w, zone, { x: p.x - 0.5, z: p.z, dx: 1, dz: 0, dmg: [1, 1] });
  tick(w, zone);
  assert.equal(hits(w)[0].src, bare);
  // a dead player and a player in another zone are passed through; the live one behind is hit
  w.events.length = 0;
  const ghost = w.ents[addPlayer(w, hero)];
  ghost.x = sp.x - 2; ghost.z = sp.z; ghost.dead = true;
  const away = w.ents[addPlayer(w, hero)];
  away.x = sp.x - 1; away.z = sp.z; away.zone = 'elsewhere';
  const id2 = spawnProjectile(w, zone, { x: sp.x - 4, z: sp.z, dx: 1, dz: 0, dmg: [1, 1] });
  tick(w, zone, 8);
  assert.equal(ghost.hp, ghost.hpMax); assert.equal(away.hp, away.hpMax);
  assert.equal(hits(w).length, 1);
  assert.equal(hits(w)[0].tgt, p.id);
  assert.equal(w.ents[id2], undefined);
  // nearest of two live players in range wins
  w.events.length = 0;
  ghost.dead = false; ghost.x = sp.x + 0.3; ghost.z = sp.z + 0.3;
  spawnProjectile(w, zone, { x: sp.x - 0.5, z: sp.z, dx: 1, dz: 0, dmg: [1, 1] });
  tick(w, zone);
  assert.equal(hits(w).length, 1);
  assert.equal(hits(w)[0].tgt, p.id);
  // a player at 0 hp is not a target
  w.events.length = 0;
  ghost.x = sp.x - 3; ghost.z = sp.z; ghost.hp = 0;
  const id3 = spawnProjectile(w, zone, { x: sp.x - 4.5, z: sp.z, dx: 1, dz: 0, dmg: [1, 1] });
  tick(w, zone, 3);
  assert.ok(w.ents[id3], 'flew past the 0-hp player');
  assert.equal(hits(w).length, 0);
});

test('the arrow carries its own level, element and dmg into monsterAttack: armour DR, resists, block', () => {
  const { w, p, zone, sp } = setup();
  p.x = sp.x; p.z = sp.z;
  p.derived = { armour: 100, block: 0, fireRes: 50 };
  const shoot = (spec) => { spawnProjectile(w, zone, { x: sp.x - 0.5, z: sp.z, dx: 1, dz: 0, ...spec }); tick(w, zone); return hits(w).at(-1); };
  let h = shoot({ dmg: [20, 20], level: 4 });
  assert.equal(h.dmg, Math.floor(20 * (1 - armourDR(100, 4)) + 0.5));
  assert.equal(h.dmg, 10, '20·(1 − 100/(100 + 25·4))');
  h = shoot({ dmg: [20, 20], level: 1 });
  assert.equal(h.dmg, Math.floor(20 * (1 - armourDR(100, 1)) + 0.5));
  h = shoot({ dmg: [20, 20], el: 'fire' });
  assert.equal(h.el, 'fire');
  assert.equal(h.dmg, 10, 'fire ignores armour, halves on 50 fire res');
  // block: physical arrows can be blocked (event block, no hit), elemental never
  p.derived = { armour: 0, block: 100 };
  const s0 = zone.streams.combat.state;
  w.events.length = 0;
  let blocked = 0, landed = 0;
  for (let i = 0; i < 2000; i++) {
    p.hp = p.hpMax;
    spawnProjectile(w, zone, { x: sp.x - 0.5, z: sp.z, dx: 1, dz: 0, dmg: [3, 3] });
    tick(w, zone);
    if (p.hp === p.hpMax) blocked++; else landed++;
  }
  assert.notEqual(zone.streams.combat.state, s0, 'rolls come from the combat stream');
  assert.ok(Math.abs(blocked / 2000 * 100 - RULES.blockCap) < 4, 'block rate ' + blocked / 2000);
  assert.equal(w.events.filter((e) => e.k === 'block').length, blocked);
  assert.equal(hits(w).length, landed);
  assert.equal(arrows(zone).length, 0, 'a blocked arrow is consumed too');
  w.events.length = 0;
  for (let i = 0; i < 300; i++) {
    p.hp = p.hpMax;
    spawnProjectile(w, zone, { x: sp.x - 0.5, z: sp.z, dx: 1, dz: 0, dmg: [3, 3], el: 'cold' });
    tick(w, zone);
  }
  assert.equal(hits(w).length, 300);
  assert.equal(w.events.filter((e) => e.k === 'block').length, 0);
});

test('arrows stop at non-walkable cells even with a player right behind the wall', () => {
  const { w, p, zone } = setup();
  const L = zone.layout, N = L.size;
  let cell = null;
  for (let cz = 3; cz < N - 3 && !cell; cz++) for (let cx = 3; cx < N - 3 && !cell; cx++) {
    if (L.walk[cz * N + cx] === 1 && L.walk[cz * N + cx + 1] === 0) cell = [cx, cz];
  }
  assert.ok(cell, 'a wall east of a walkable cell');
  const [cx, cz] = cell;
  p.x = cx + 1.8; p.z = cz + 0.5;
  const id = spawnProjectile(w, zone, { x: cx + 0.5, z: cz + 0.5, dx: 1, dz: 0, dmg: [50, 50], src: 'm1' });
  const q = w.ents[id];
  assert.ok(hyp(q.x - p.x, q.z - p.z) > q.r + p.r, 'not touching yet');
  assert.ok(hyp(q.x + rg.arrowSpeed * DT - p.x, 0) <= q.r + p.r, 'the next step would touch the player');
  const hp0 = p.hp;
  tick(w, zone);
  assert.equal(w.ents[id], undefined, 'stopped by the wall cell');
  assert.ok(w._gone.includes(id));
  assert.equal(p.hp, hp0);
  assert.equal(hits(w).length, 0);
  // an arrow that starts in a wall dies on its first step too
  const id2 = spawnProjectile(w, zone, { x: cx + 1.5, z: cz + 0.5, dx: 0, dz: 0, dmg: [1, 1] });
  tick(w, zone);
  assert.equal(w.ents[id2], undefined);
  // and one flying off the map
  const id3 = spawnProjectile(w, zone, { x: 0.5, z: 0.5, dx: -1, dz: 0, dmg: [1, 1] });
  tick(w, zone);
  assert.equal(w.ents[id3], undefined);
});

test('step() sends a new arrow in full on its first tick and lists it in gone after removal', () => {
  const { w, p, zone, sp } = setup();
  p.x = sp.x; p.z = sp.z;
  step(w);
  // 6 m out: step() itself now flies the arrow (P1 tick order), so leave room for three moves
  const id = spawnProjectile(w, zone, { x: sp.x - 6, z: sp.z, dx: 1, dz: 0, dmg: [2, 2], src: 'm1' });
  let r = step(w);
  assert.equal(r.delta[id].kind, 'proj');
  assert.equal(r.delta[id].src, 'm1');
  assert.ok(r.events.some((e) => e.k === 'proj' && e.id === id));
  tick(w, zone);
  r = step(w);
  assert.deepEqual(Object.keys(r.delta[id]).sort(), ['x'], 'only the moved axis is sent');
  let n = 0;
  while (w.ents[id] && n++ < 10) tick(w, zone);
  r = step(w);
  assert.deepEqual(r.gone, [id]);
  assert.ok(r.events.some((e) => e.k === 'hit' && e.src === 'm1'));
  assert.equal(r.delta[id], undefined);
});

test('two worlds with the same seed produce the same arrows, hits and blocks', () => {
  const run = () => {
    const { w, p, zone, sp } = setup(9);
    p.x = sp.x; p.z = sp.z;
    p.derived = { armour: 10, block: 30 };
    const log = [];
    for (let t = 0; t < 200; t++) {
      if (t % 5 === 0) spawnProjectile(w, zone, { x: sp.x - 3, z: sp.z + (t % 3) * 0.2, dx: 1, dz: 0, dmg: [2, 5], src: 'm1' });
      tick(w, zone);
      log.push(JSON.stringify(w.events));
      w.events = [];
    }
    return log.join('\n') + zone.streams.combat.state;
  };
  const a = run();
  assert.equal(a, run());
  assert.ok(a.includes('"k":"hit"') && a.includes('"k":"block"'));
});
