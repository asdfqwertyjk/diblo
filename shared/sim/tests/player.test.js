// player.js — creation, persistence, one-shots, potions, death/respawn, movement rules,
// regen, acts, auto-pickup and determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import recipes from '../../data/zones/index.js';
import classes from '../../data/classes.js';
import items from '../../data/items.js';
import { createWorld, ensureZone, TICK_HZ, DT } from '../world.js';
import { createPlayerEnt, toDoc, stepPlayer, respawn, killPlayer, predictPlayer, newCharacterDoc } from '../player.js';
import { generateItem, makePotion } from '../itemgen.js';
import { addItem } from '../inventory.js';
import { dropAt } from '../ground.js';
import { secTicks } from '../skills.js';

const SEED = 77; // spawn (64,120) facing north, 12 m clear runway
const SK = classes.skills;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const hero = { name: 'Hero', cls: 'warrior', level: 1 };

function setup(doc = hero, seed = SEED) {
  const world = createWorld({ recipes, seed });
  const zone = ensureZone(world, 'gallowsmoor');
  const e = createPlayerEnt(world, zone, doc);
  for (const id of zone.ents) { const m = world.ents[id]; if (m.kind === 'monster') { m.x = -50; m.z = -50; } }
  world.events = [];
  return { world, zone, e };
}

function tick(world, zone, e, intent) {
  world.tick++;
  stepPlayer(world, zone, e, intent);
  const ev = world.events; world.events = [];
  return ev;
}

function sword(zone) { return generateItem(zone.streams.loot, { ilvl: 1, rarity: 'normal', baseId: 'sword' }); }

test('createPlayerEnt: start skill, slots, vitals, empty bags, registered at playerSpawn', () => {
  const world = createWorld({ recipes, seed: SEED });
  const zone = ensureZone(world, 'gallowsmoor');
  const n0 = world.players.length;
  const e = createPlayerEnt(world, zone, hero);
  const c = classes.classes.warrior;
  assert.equal(e.kind, 'player');
  assert.deepEqual(e.skills, { [c.startSkill]: 1 });
  assert.deepEqual(e.slots, [c.startSkill, null, null, null, null, null]);
  assert.deepEqual(e.stats, c.stats);
  assert.equal(e.hpMax, c.life.base + c.life.perVit * c.stats.vit);
  assert.equal(e.mpMax, c.mana.base + c.mana.perEne * c.stats.ene);
  assert.equal(e.hp, e.hpMax); assert.equal(e.mp, e.mpMax);
  assert.equal(e.speed, c.runSpeed); assert.equal(e.r, c.radius);
  assert.deepEqual([e.x, e.z, e.dx, e.dz], [zone.layout.playerSpawn.x, zone.layout.playerSpawn.z, zone.layout.playerSpawn.dx, zone.layout.playerSpawn.dz]);
  assert.deepEqual(e.inventory, { w: classes.inventory.w, h: classes.inventory.h, items: [] });
  for (const s of items.slots) assert.equal(e.equipment[s], null);
  assert.deepEqual(e.belt, new Array(classes.belt.slots).fill(null));
  assert.equal(e.derived.weapon.kind, 'unarmed');
  assert.equal(world.ents[e.id], e);
  assert.ok(zone.ents.has(e.id));
  assert.equal(world.players.length, n0 + 1);
  assert.deepEqual(world.events.at(-1), { k: 'spawn', id: e.id });
  assert.equal(e.gold, 0); assert.equal(e.xp, 0); assert.equal(e.dead, false);
  assert.throws(() => createPlayerEnt(world, zone, { cls: 'nope' }), /unknown class/);
});

test('toDoc → createPlayerEnt round-trips inventory, equipment, skills, slots, gold and xp', () => {
  const world = createWorld({ recipes, seed: SEED });
  const zone = ensureZone(world, 'gallowsmoor');
  const rng = zone.streams.loot;
  const cap = generateItem(rng, { ilvl: 5, rarity: 'rare', baseId: 'cap' });
  const axe = generateItem(rng, { ilvl: 3, rarity: 'magic', baseId: 'axe' });
  const doc = {
    v: 1, name: 'Vera', cls: 'warrior', level: 4, xp: 1234, gold: 777, statPoints: 3, skillPoints: 1, deaths: 2, playtime: 90,
    stats: { str: 30, dex: 17, vit: 25, ene: 10 },
    skills: { cleave: 3, lunge: 1, warcry: 1 },
    slots: ['cleave', 'lunge', 'warcry', null, null, null],
    inventory: { w: 10, h: 6, items: [{ iid: cap.iid, x: 2, y: 1, item: cap }, { iid: 'pot.lifeMinor', x: 0, y: 0, item: makePotion('lifeMinor', 4) }] },
    equipment: { weapon: axe, boots: generateItem(rng, { ilvl: 1, rarity: 'normal', baseId: 'boots' }) },
    belt: [{ potionId: 'lifeMinor', count: 3 }, null, { potionId: 'manaMinor', count: 10 }, null],
    zone: 'gallowsmoor',
  };
  const e = createPlayerEnt(world, zone, doc);
  assert.equal(e.level, 4); assert.equal(e.xp, 1234); assert.equal(e.gold, 777);
  assert.equal(e.equipment.weapon.iid, axe.iid);
  assert.equal(e.derived.weapon.kind, 'axe');
  assert.equal(e.inventory.items.length, 2);
  assert.equal(e.hp, e.hpMax, 'loads at full life');
  assert.equal(e.hpMax, 60 + 10 * 3 + 3 * 25 + (e.derived.hpMax - (60 + 30 + 75)), 'derived from level and stats');
  const d1 = toDoc(e);
  assert.equal(d1.v, 1);
  assert.deepEqual(Object.keys(d1), ['v', 'name', 'cls', 'level', 'xp', 'gold', 'statPoints', 'skillPoints', 'deaths', 'playtime', 'stats', 'skills', 'slots', 'inventory', 'equipment', 'belt', 'zone']);
  for (const k of ['name', 'cls', 'level', 'xp', 'gold', 'statPoints', 'skillPoints', 'deaths', 'playtime', 'zone']) assert.equal(d1[k], doc[k], k);
  assert.deepEqual(d1.stats, doc.stats);
  assert.deepEqual(d1.skills, doc.skills);
  assert.deepEqual(d1.slots, doc.slots);
  assert.deepEqual(d1.belt, doc.belt);
  assert.deepEqual(d1.inventory, doc.inventory);
  assert.deepEqual(d1.equipment.weapon, axe);
  assert.equal(d1.equipment.shield, null);
  assert.equal(Object.keys(d1.equipment).length, items.slots.length);
  // a second world built from the document serialises the same document
  const w2 = createWorld({ recipes, seed: 5 });
  const z2 = ensureZone(w2, 'gallowsmoor');
  const e2 = createPlayerEnt(w2, z2, JSON.parse(JSON.stringify(d1)));
  assert.equal(JSON.stringify(toDoc(e2)), JSON.stringify(d1));
  assert.notEqual(toDoc(e2).equipment.weapon, e2.equipment.weapon, 'the doc holds copies');
  // the fresh character's doc round-trips too, and unknown skills / slots are dropped
  const { world: w3, zone: z3, e: e3 } = setup({ ...hero, skills: { cleave: 1, bogus: 4 }, slots: ['bogus', 'cleave'] });
  assert.deepEqual(e3.skills, { cleave: 1 });
  assert.deepEqual(e3.slots, ['cleave', 'cleave', null, null, null, null]);
  const d3 = toDoc(e3);
  assert.equal(JSON.stringify(toDoc(createPlayerEnt(w3, z3, d3))), JSON.stringify(d3));
});

test('one-shots (act / use / pick) run once per seq even when the intent repeats for 10 ticks', () => {
  const { world, zone, e } = setup();
  const s = sword(zone);
  addItem(e, s);
  addItem(e, makePotion('lifeMinor', 2));
  const [gid] = dropAt(world, zone, e.x + 2.5, e.z, [{ gold: 30 }]);
  Object.assign(world.ents[gid], { x: e.x + 2.5, z: e.z }); // beyond auto-pickup, inside pickupRange (dropAt scatters)
  world.events = [];
  e.hp = 50; e.lastCombatTick = world.tick;
  const all = [];
  const intent = { seq: 7, act: { op: 'equip', iid: s.iid }, use: 0, pick: gid, mv: [0, 0] };
  for (let i = 0; i < 10; i++) all.push(...tick(world, zone, e, intent));
  assert.equal(all.filter((v) => v.k === 'equip').length, 1);
  assert.equal(all.filter((v) => v.k === 'potion').length, 1);
  assert.equal(all.filter((v) => v.k === 'gold').length, 1);
  assert.equal(all.filter((v) => v.k === 'invalid').length, 0, JSON.stringify(all.filter((v) => v.k === 'invalid')));
  assert.equal(e.equipment.weapon.iid, s.iid);
  assert.equal(e.belt[0].count, 1);
  assert.equal(e.gold, 30);
  assert.equal(e.lastSeq, 7);
  // a new seq runs them again: equip and pick now fail (the sword and the pile are gone) and the
  // drink is refused by the 1 s belt cooldown; the one-shots run in act → use → pick order
  const ev = tick(world, zone, e, { ...intent, seq: 8 });
  assert.deepEqual(ev.filter((v) => v.k === 'invalid').map((v) => v.why), ['no item', 'belt cooldown', 'no item']);
  assert.equal(ev.filter((v) => v.k === 'potion').length, 0);
  assert.equal(e.belt[0].count, 1, 'the cooldown kept the potion');
  world.tick = e.beltCd.life;
  const evb = tick(world, zone, e, { seq: 9, use: 0 });
  assert.equal(evb.filter((v) => v.k === 'potion').length, 1);
  assert.equal(e.belt[0], null, 'the last potion left the belt');
  // an intent without seq never fires one-shots
  const ev2 = tick(world, zone, e, { act: { op: 'unequip', slot: 'weapon' } });
  assert.equal(ev2.length, 0);
  assert.equal(e.equipment.weapon.iid, s.iid);
});

test('potions heal over 2 s, respect the 1 s belt cooldown per kind and refill from the bag', () => {
  const { world, zone, e } = setup();
  // a full life column, a single mana potion, and one spare life potion in the bag
  // (addItem would fill empty belt slots first, so the belt is laid out by hand)
  e.belt[0] = { potionId: 'lifeMinor', count: 10 };
  e.belt[1] = { potionId: 'manaMinor', count: 1 };
  e.inventory.items.push({ iid: 'pot.lifeMinor', x: 0, y: 0, item: makePotion('lifeMinor', 1) });
  e.invVer++;
  assert.equal(e.inventory.items[0].item.stack, 1);
  const P = items.potions.lifeMinor;
  e.hp = 50; e.mp = 0;
  e.lastCombatTick = world.tick; // life regen stays off for lifeAfterSec
  const t0 = world.tick + 1;
  const ev = tick(world, zone, e, { seq: 1, use: 0 });
  assert.deepEqual(ev.filter((v) => v.k === 'potion'), [{ k: 'potion', pid: e.id, kind: 'life' }]);
  assert.equal(e.belt[0].count, 10, 'drank one, refilled one from the bag');
  assert.equal(e.inventory.items.length, 0, 'the spare left the bag');
  assert.equal(e.beltCd.life, t0 + secTicks(classes.belt.cooldownSec));
  const ticks = P.overSec * TICK_HZ;
  assert.ok(near(e.hp, 50 + P.amount / ticks), 'the first tick of healing lands at once');
  const ev2 = tick(world, zone, e, { seq: 2, use: 0 });
  assert.deepEqual(ev2.filter((v) => v.k === 'invalid'), [{ k: 'invalid', pid: e.id, why: 'belt cooldown' }]);
  assert.equal(e.belt[0].count, 10);
  // a mana potion is another kind: no shared cooldown
  const ev3 = tick(world, zone, e, { seq: 3, use: 1 });
  assert.ok(ev3.some((v) => v.k === 'potion' && v.kind === 'mana'));
  assert.equal(e.belt[1], null, 'a single potion empties its slot');
  for (let i = 3; i < ticks; i++) tick(world, zone, e, { seq: 3 });
  assert.ok(near(e.hp, 50 + P.amount), 'healed exactly the amount over 2 s: ' + e.hp);
  assert.equal(e.potion.hpLeft, 0);
  assert.ok(e.potion.mpLeft > 0, 'the mana potion started two ticks later and is still running');
  tick(world, zone, e, { seq: 3 }); tick(world, zone, e, { seq: 3 });
  assert.equal(e.potion, null);
  const regen = (classes.regen.manaBase + classes.regen.manaPerEne * e.derived.ene) / TICK_HZ;
  assert.ok(near(e.mp - regen * (ticks + 2), items.potions.manaMinor.amount, 1e-6), 'mana potion restored its amount: ' + e.mp);
  // ready again after the cooldown; overheal caps at hpMax
  e.hp = e.hpMax - 1;
  world.tick = e.beltCd.life - 1;
  const ev4 = tick(world, zone, e, { seq: 4, use: 0 });
  assert.ok(ev4.some((v) => v.k === 'potion'));
  assert.equal(e.belt[0].count, 9, 'the bag is empty now');
  for (let i = 0; i < ticks; i++) tick(world, zone, e, { seq: 4 });
  assert.equal(e.hp, e.hpMax);
  assert.equal(e.potion, null);
  // no potion → invalid, nothing spent
  const ev5 = tick(world, zone, e, { seq: 5, use: 3 });
  assert.deepEqual(ev5.filter((v) => v.k === 'invalid'), [{ k: 'invalid', pid: e.id, why: 'no potion' }]);
});

test('death → respawn at playerSpawn with −10% gold after respawnAfterSec; act respawn is immediate', () => {
  const { world, zone, e } = setup();
  const sp = zone.layout.playerSpawn;
  e.gold = 1000;
  e.x = sp.x + 3; e.z = sp.z - 3;
  e.hp = 0;
  const t0 = world.tick + 1;
  const ev = tick(world, zone, e, { seq: 1, mv: [0, -1], skill: 0 });
  assert.equal(e.dead, true);
  assert.equal(e.anim, 'die');
  assert.equal(e.deaths, 1);
  assert.equal(e.deadAt, t0);
  assert.equal(e.respawnAt, t0 + secTicks(classes.respawnAfterSec));
  assert.deepEqual(ev.filter((v) => v.k === 'death'), [{ k: 'death', id: e.id, x: sp.x + 3, z: sp.z - 3 }]);
  assert.equal(ev.filter((v) => v.k === 'skill').length, 0);
  const z1 = e.z;
  while (world.tick < e.respawnAt - 1) {
    const evs = tick(world, zone, e, { seq: 2, mv: [0, -1], skill: 0, use: 0 });
    assert.equal(e.z, z1, 'the dead do not walk');
    assert.equal(evs.length, 0);
  }
  const ev2 = tick(world, zone, e, { seq: 3 });
  assert.equal(e.dead, false);
  assert.deepEqual(ev2, [{ k: 'respawn', id: e.id }]);
  assert.deepEqual([e.x, e.z, e.dx, e.dz], [sp.x, sp.z, sp.dx, sp.dz]);
  assert.equal(e.hp, e.hpMax); assert.equal(e.mp, e.mpMax);
  assert.equal(e.gold, 1000 - Math.floor(1000 * classes.deathGoldLossPct / 100));
  assert.equal(e.anim, 'idle');
  assert.equal(e.respawnAt, null);
  // the act respawns without waiting; the loss is floored on the current gold
  e.gold = 905; e.hp = 0;
  tick(world, zone, e, { seq: 4 });
  assert.ok(e.dead);
  const ev3 = tick(world, zone, e, { seq: 5, act: { op: 'respawn' } });
  assert.ok(!e.dead && ev3.some((v) => v.k === 'respawn'));
  assert.equal(e.gold, 905 - Math.floor(90.5));
  assert.equal(e.deaths, 2);
  // respawn while alive is invalid; killPlayer is idempotent
  const ev4 = tick(world, zone, e, { seq: 6, act: { op: 'respawn' } });
  assert.deepEqual(ev4, [{ k: 'invalid', pid: e.id, why: 'not dead' }]);
  killPlayer(world, zone, e); killPlayer(world, zone, e);
  assert.equal(e.deaths, 3);
  assert.equal(world.events.filter((v) => v.k === 'death').length, 1);
  respawn(world, zone, e);
  assert.ok(!e.dead);
});

test('movement: runSpeed per second, blocked while swing-locked, moveMult while channelling, dash first', () => {
  const { world, zone, e } = setup();
  const z0 = e.z;
  for (let i = 0; i < TICK_HZ; i++) tick(world, zone, e, { seq: 1, mv: [0, -1] });
  assert.ok(near(z0 - e.z, e.speed), 'one second north covers runSpeed metres');
  assert.equal(e.anim, 'run');
  const x0 = e.x, z1 = e.z;
  for (let i = 0; i < TICK_HZ; i++) tick(world, zone, e, { seq: 1, mv: [0, -0.5] });
  assert.ok(near(z1 - e.z, e.speed * 0.5, 1e-6), 'analog input scales');
  assert.equal(e.x, x0);
  // idle faces the aim; no intent is idle
  tick(world, zone, e, { seq: 1, mv: [0, 0], aim: [e.x + 10, e.z] });
  assert.equal(e.anim, 'idle');
  assert.deepEqual([e.dx, e.dz], [1, 0]);
  tick(world, zone, e, undefined);
  assert.equal(e.anim, 'idle');
  // a cleave locks the feet
  const z2 = e.z;
  tick(world, zone, e, { seq: 2, mv: [0, -1], aim: [e.x, e.z - 5], skill: 0 });
  const locked = e.lockUntil - world.tick;
  assert.ok(locked > 0);
  assert.equal(e.z, z2, 'no step on the swing tick');
  for (let i = 1; i < locked; i++) { // lockUntil > tick holds for the next locked−1 ticks
    tick(world, zone, e, { seq: 2, mv: [0, -1], aim: [e.x, e.z - 5] });
    assert.equal(e.z, z2, 'no step while locked');
    assert.equal(e.anim, 'attack');
  }
  tick(world, zone, e, { seq: 2, mv: [0, -1], aim: [e.x, e.z - 5] });
  assert.equal(e.anim, 'run', 'moves again the tick the lock ends');
  assert.ok(e.z < z2);
  // whirl: moves at moveMult, facing stays on the aim
  e.skills.whirl = 1; e.slots[1] = 'whirl'; e.mp = e.mpMax;
  const z3 = e.z;
  tick(world, zone, e, { seq: 3, mv: [0, -1], aim: [e.x + 5, e.z], skill: 1 });
  assert.ok(e.channel);
  assert.ok(near(z3 - e.z, e.speed * SK.whirl.moveMult * DT, 1e-9), 'moved ' + (z3 - e.z));
  assert.deepEqual([e.dx, e.dz], [1, 0]);
  assert.equal(e.anim, 'attack');
  // knockback pre-empts voluntary movement
  tick(world, zone, e, { seq: 4 });
  e.kb = { dx: 1, dz: 0, left: 2, step: 0.25 };
  const x1 = e.x, z4 = e.z;
  tick(world, zone, e, { seq: 4, mv: [0, -1], skill: 0 });
  assert.ok(near(e.x - x1, 0.25) && e.z === z4, 'flew sideways, did not walk or swing');
  assert.equal(world.events.length, 0);
  tick(world, zone, e, { seq: 4, mv: [0, -1] });
  assert.equal(e.kb, null);
  tick(world, zone, e, { seq: 4, mv: [0, -1] });
  assert.ok(e.z < z4, 'walks again once the knockback is spent');
});

test('regen: mana always, life only after lifeAfterSec without combat', () => {
  const { world, zone, e } = setup();
  const R = classes.regen;
  e.mp = 0; e.hp = 100;
  e.lastCombatTick = world.tick;
  for (let i = 0; i < TICK_HZ; i++) tick(world, zone, e, { seq: 1 });
  assert.ok(near(e.mp, R.manaBase + R.manaPerEne * e.derived.ene), 'mana per second: ' + e.mp);
  assert.equal(e.hp, 100, 'no life yet');
  world.tick = e.lastCombatTick + secTicks(R.lifeAfterSec) - 2;
  tick(world, zone, e, { seq: 1 });
  assert.equal(e.hp, 100);
  for (let i = 0; i < TICK_HZ; i++) tick(world, zone, e, { seq: 1 });
  assert.ok(near(e.hp, 100 + e.hpMax * R.lifePctPerSec / 100), 'life per second: ' + e.hp);
  e.hp = e.hpMax - 0.01; e.mp = e.mpMax - 0.01;
  tick(world, zone, e, { seq: 1 });
  assert.equal(e.hp, e.hpMax); assert.equal(e.mp, e.mpMax);
});

test('autoPickup every tick; a pick act beyond pickupRange is refused', () => {
  const { world, zone, e } = setup();
  const [g1] = dropAt(world, zone, e.x + 0.5, e.z, [{ gold: 12 }]);
  const [g2] = dropAt(world, zone, e.x + 0.4, e.z + 0.4, [{ item: makePotion('manaMinor', 2) }]);
  const [g3] = dropAt(world, zone, e.x + 0.5, e.z, [{ item: sword(zone) }]);
  const [far] = dropAt(world, zone, e.x + 5, e.z, [{ gold: 5 }]);
  // dropAt scatters within 1.5 m; pin the piles where the test wants them
  Object.assign(world.ents[g1], { x: e.x + 0.5, z: e.z });
  Object.assign(world.ents[g2], { x: e.x + 0.4, z: e.z + 0.4 });
  Object.assign(world.ents[g3], { x: e.x + 0.5, z: e.z });
  Object.assign(world.ents[far], { x: e.x + 5, z: e.z });
  world.events = [];
  const ev = tick(world, zone, e, { seq: 1, pick: far });
  assert.equal(e.gold, 12);
  assert.deepEqual(e.belt[0], { potionId: 'manaMinor', count: 2 });
  assert.equal(world.ents[g1], undefined); assert.equal(world.ents[g2], undefined);
  assert.ok(world.ents[g3], 'gear waits for a click');
  assert.ok(ev.some((v) => v.k === 'gold' && v.amount === 12));
  assert.ok(ev.some((v) => v.k === 'pickup' && v.id === g2));
  assert.deepEqual(ev.filter((v) => v.k === 'invalid'), [{ k: 'invalid', pid: e.id, why: 'too far' }]);
  const ev2 = tick(world, zone, e, { seq: 2, pick: g3 });
  assert.ok(ev2.some((v) => v.k === 'pickup' && v.id === g3));
  assert.equal(e.inventory.items.length, 1);
});

test('acts: stat and skill points, row unlocks, hotbar assignment, inventory ops refresh derived stats', () => {
  const { world, zone, e } = setup();
  const why = (intent) => tick(world, zone, e, intent).filter((v) => v.k === 'invalid').map((v) => v.why);
  assert.deepEqual(why({ seq: 1, act: { op: 'stat', stat: 'str' } }), ['no stat points']);
  e.statPoints = 2;
  assert.deepEqual(why({ seq: 2, act: { op: 'stat', stat: 'luck' } }), ['bad stat']);
  assert.deepEqual(why({ seq: 3, act: { op: 'stat', stat: 'vit' } }), []);
  assert.equal(e.stats.vit, 21); assert.equal(e.statPoints, 1);
  assert.equal(e.hpMax, 120 + classes.classes.warrior.life.perVit, 'derived refreshed at once');
  e.skillPoints = 3;
  assert.deepEqual(why({ seq: 4, act: { op: 'skill', id: 'lunge' } }), ['needs level 3']);
  assert.deepEqual(why({ seq: 5, act: { op: 'skill', id: 'cleave' } }), []);
  assert.equal(e.skills.cleave, 2);
  e.level = 6;
  tick(world, zone, e, { seq: 6 });
  assert.equal(e.derivedLevel, 6, 'level change recomputes the sheet');
  assert.deepEqual(why({ seq: 7, act: { op: 'skill', id: 'warcry' } }), ['needs the skill above']);
  assert.deepEqual(why({ seq: 8, act: { op: 'skill', id: 'lunge' } }), []);
  assert.deepEqual(why({ seq: 9, act: { op: 'skill', id: 'warcry' } }), []);
  assert.equal(e.skillPoints, 0);
  assert.deepEqual(why({ seq: 10, act: { op: 'skill', id: 'cleave' } }), ['no skill points']);
  assert.deepEqual(why({ seq: 11, act: { op: 'assign', slot: 0, id: null } }), ['slot 0 needs a skill']);
  assert.deepEqual(why({ seq: 12, act: { op: 'assign', slot: 2, id: 'earthbreak' } }), ['skill not learned']);
  assert.deepEqual(why({ seq: 13, act: { op: 'assign', slot: 1, id: 'lunge' } }), []);
  assert.deepEqual(why({ seq: 14, act: { op: 'assign', slot: 9, id: 'lunge' } }), ['bad slot']);
  assert.deepEqual(why({ seq: 15, act: { op: 'assign', slot: 1, id: null } }), []);
  assert.deepEqual(e.slots, ['cleave', null, null, null, null, null]);
  assert.deepEqual(why({ seq: 16, act: { op: 'dance' } }), ['unknown act']);
  assert.deepEqual(why({ seq: 17, act: 5 }), ['bad act']);
  // inventory ops: equip, move, unequip, belt/unbelt, drop
  const s = sword(zone);
  const cap = generateItem(zone.streams.loot, { ilvl: 1, rarity: 'normal', baseId: 'cap' });
  addItem(e, s); addItem(e, cap); addItem(e, makePotion('lifeMinor', 3));
  e.belt[0] = null;
  e.inventory.items.push({ iid: 'pot.lifeMinor', x: 8, y: 4, item: makePotion('lifeMinor', 3) });
  const ev = tick(world, zone, e, { seq: 18, act: { op: 'equip', iid: s.iid } });
  assert.deepEqual(ev, [{ k: 'equip', pid: e.id, iid: s.iid }]);
  assert.equal(e.derived.weapon.kind, 'sword');
  assert.deepEqual(why({ seq: 19, act: { op: 'move', iid: cap.iid, x: 5, y: 2 } }), []);
  assert.deepEqual(why({ seq: 20, act: { op: 'belt', iid: 'pot.lifeMinor', slot: 2 } }), []);
  assert.deepEqual(e.belt[2], { potionId: 'lifeMinor', count: 3 });
  assert.deepEqual(why({ seq: 21, act: { op: 'unbelt', slot: 2 } }), []);
  assert.equal(e.belt[2], null);
  assert.deepEqual(why({ seq: 22, act: { op: 'unequip', slot: 'weapon' } }), []);
  assert.equal(e.derived.weapon.kind, 'unarmed');
  const ev2 = tick(world, zone, e, { seq: 23, act: { op: 'drop', iid: cap.iid } });
  assert.ok(ev2.some((v) => v.k === 'drop'));
  assert.equal(e.inventory.items.find((r) => r.iid === cap.iid), undefined);
});

test('stat, skill and assign acts bump invVer (a delta carries the sheet change); no-ops do not', () => {
  const { world, zone, e } = setup();
  e.statPoints = 1; e.skillPoints = 1; e.level = 3;
  let v = e.invVer;
  tick(world, zone, e, { seq: 1, act: { op: 'stat', stat: 'str' } });
  assert.equal(e.invVer, v + 1); assert.equal(e.derivedVer, e.invVer); assert.equal(e.derived.str, classes.classes.warrior.stats.str + 1);
  v = e.invVer;
  tick(world, zone, e, { seq: 2, act: { op: 'stat', stat: 'str' } }); // no points: refused
  assert.equal(e.invVer, v);
  tick(world, zone, e, { seq: 3, act: { op: 'skill', id: 'lunge' } });
  assert.equal(e.invVer, v + 1); assert.equal(e.derivedVer, e.invVer);
  v = e.invVer;
  tick(world, zone, e, { seq: 4, act: { op: 'assign', slot: 1, id: 'lunge' } });
  assert.equal(e.invVer, v + 1);
  v = e.invVer;
  tick(world, zone, e, { seq: 5, act: { op: 'assign', slot: 1, id: 'lunge' } }); // already there
  assert.equal(e.invVer, v);
  tick(world, zone, e, { seq: 6, act: { op: 'assign', slot: 1, id: null } });
  assert.equal(e.invVer, v + 1);
});

test('predictPlayer moves like stepPlayer but never swings, drinks, picks up, regenerates or draws a stream', () => {
  const { world, zone, e } = setup();
  const { world: w2, zone: z2, e: e2 } = setup();
  const walk = { seq: 1, mv: [0, -1], aim: [e.x + 5, e.z] };
  for (let i = 0; i < 10; i++) { world.tick++; stepPlayer(world, zone, e, walk); w2.tick++; assert.equal(predictPlayer(w2, z2, e2, walk), true); }
  assert.ok(near(e.z, e2.z) && near(e.x, e2.x), 'same path');
  assert.deepEqual([e2.dx, e2.dz], [0, -1]);
  // prediction ignores skill/use/pick and touches no stream; the real tick would swing and lock
  const c0 = z2.streams.combat.state, l0 = z2.streams.loot.state;
  const stand = { seq: 2, mv: [0, 0], aim: [e2.x + 5, e2.z], skill: 0, use: 0, pick: 'g1' };
  w2.tick++;
  assert.equal(predictPlayer(w2, z2, e2, stand), false);
  assert.equal(e2.lockUntil, 0);
  world.tick++; stepPlayer(world, zone, e, stand);
  assert.ok(e.lockUntil > world.tick, 'the real tick swung');
  assert.deepEqual([z2.streams.combat.state, z2.streams.loot.state], [c0, l0]);
  assert.deepEqual([e2.dx, e2.dz], [1, 0], 'faces the aim when idle');
  assert.deepEqual(w2.events, []);
  // a dash left on the entity by the last snapshot slides but does not strike
  e2.dash = { id: 'lunge', dx: 0, dz: -1, left: 2, step: 1 };
  const z0 = e2.z;
  w2.tick++; assert.equal(predictPlayer(w2, z2, e2, stand), true);
  w2.tick++; assert.equal(predictPlayer(w2, z2, e2, stand), true);
  assert.ok(near(e2.z, z0 - 2));
  assert.equal(e2.dash, null);
  assert.equal(e2.lockUntil, 0, 'no dashHit swing lock');
  assert.deepEqual(w2.events, []);
  // hp does not regenerate, potions do not tick
  e2.hp = 10; e2.lastCombatTick = -1000; e2.potion = { hpLeft: 20, hpPerTick: 1, mpLeft: 0, mpPerTick: 0 };
  w2.tick++; predictPlayer(w2, z2, e2, stand);
  assert.equal(e2.hp, 10);
  e2.dead = true;
  assert.equal(predictPlayer(w2, z2, e2, walk), false);
});

test('newCharacterDoc: class weapon equipped from a per-character stream, belt from startPotions, round-trips through createPlayerEnt', () => {
  const a = newCharacterDoc('Ash', 'warrior', 5), b = newCharacterDoc('Ash', 'warrior', 5), c = newCharacterDoc('Bo', 'warrior', 5);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'deterministic');
  assert.notEqual(a.equipment.weapon.iid, c.equipment.weapon.iid, 'another name, another iid');
  assert.notEqual(a.equipment.weapon.iid, newCharacterDoc('Ash', 'warrior', 6).equipment.weapon.iid, 'another seed, another iid');
  const W = classes.classes.warrior;
  assert.equal(a.equipment.weapon.base, W.weapon);
  assert.equal(a.equipment.weapon.rarity, 'normal');
  assert.deepEqual(a.belt, [{ potionId: 'lifeMinor', count: W.startPotions.lifeMinor }, null, null, null]);
  assert.deepEqual(a.skills, { [W.startSkill]: 1 });
  assert.equal(a.slots[0], W.startSkill);
  assert.deepEqual(Object.keys(a), ['v', 'name', 'cls', 'level', 'xp', 'gold', 'statPoints', 'skillPoints', 'deaths', 'playtime', 'stats', 'skills', 'slots', 'inventory', 'equipment', 'belt', 'zone']);
  const { e } = setup(a);
  assert.equal(JSON.stringify(toDoc(e)), JSON.stringify(a), 'toDoc(createPlayerEnt(doc)) is the doc');
  assert.equal(e.derived.weapon.kind, 'sword');
  assert.equal(e.belt[0].count, W.startPotions.lifeMinor);
  assert.throws(() => newCharacterDoc('X', 'bard'));
});

test('anim precedence: die > hit > cast/attack > run > idle; target tracks the intent', () => {
  const { world, zone, e } = setup();
  e.skills.warcry = 1; e.slots[1] = 'warcry';
  const mid = [...zone.ents].find((id) => world.ents[id].kind === 'monster');
  tick(world, zone, e, { seq: 1, skill: 1, target: mid });
  assert.equal(e.anim, 'cast');
  assert.equal(e.target, mid);
  tick(world, zone, e, { seq: 1, target: 'm999999' });
  assert.equal(e.target, null);
  e.lockUntil = 0;
  tick(world, zone, e, { seq: 1, mv: [1, 0] });
  assert.equal(e.anim, 'run');
  tick(world, zone, e, { seq: 1 });
  assert.equal(e.anim, 'idle');
  e.stunUntil = world.tick + 2; e.lockUntil = world.tick + 5;
  tick(world, zone, e, { seq: 1, mv: [1, 0] });
  assert.equal(e.anim, 'hit');
  e.hp = 0;
  tick(world, zone, e, { seq: 1, mv: [1, 0] });
  assert.equal(e.anim, 'die');
  assert.equal(e.target, null);
});

test('playtime counts whole seconds', () => {
  const { world, zone, e } = setup({ ...hero, playtime: 41 });
  for (let i = 0; i < 2 * TICK_HZ + 3; i++) tick(world, zone, e, { seq: 1 });
  assert.equal(e.playtime, 43);
  assert.equal(toDoc(e).playtime, 43);
});

test('determinism: two worlds, same seed and scripted intents, 400 ticks, identical state and events', () => {
  const make = () => {
    const world = createWorld({ recipes, seed: 1234 });
    const zone = ensureZone(world, 'gallowsmoor');
    const e = createPlayerEnt(world, zone, hero);
    e.skills.whirl = 1; e.skills.lunge = 1; e.skills.earthbreak = 1; e.skills.skullbreak = 1;
    e.slots[1] = 'whirl'; e.slots[2] = 'lunge'; e.slots[3] = 'earthbreak'; e.slots[4] = 'skullbreak';
    const ms = [...zone.ents].map((id) => world.ents[id]).filter((m) => m.kind === 'monster');
    for (let i = 0; i < ms.length; i++) { ms[i].x = e.x + (i % 7) - 3; ms[i].z = e.z - 1 - (i % 5); }
    addItem(e, sword(zone)); addItem(e, makePotion('lifeMinor', 5));
    world.events = [];
    return { world, zone, e };
  };
  const a = make(), b = make();
  const mvs = [[0, -1], [1, 0], [0, 0], [-1, -1], [0, 1]];
  const runs = [];
  for (const w of [a, b]) {
    const log = [];
    for (let t = 0; t < 400; t++) {
      const e = w.e;
      const intent = {
        seq: t, mv: mvs[Math.floor(t / 25) % mvs.length], aim: [e.x + 2, e.z - 2],
        skill: t % 60 < 12 ? 0 : t % 60 < 30 ? 1 : t % 60 === 31 ? 2 : t % 60 === 45 ? 3 : t % 60 === 50 ? 4 : null,
        use: t % 90 === 10 ? 0 : null,
        act: t === 5 ? { op: 'equip', iid: e.inventory.items[0].iid } : null,
      };
      if (t === 200) e.hp = 0;
      const ev = tick(w.world, w.zone, e, intent);
      log.push(JSON.stringify(ev));
      if (t % 50 === 0) log.push(JSON.stringify(Object.values(w.world.ents)));
    }
    log.push(JSON.stringify(Object.values(w.world.ents)), JSON.stringify(toDoc(w.e)));
    runs.push(log);
  }
  assert.equal(runs[0].length, runs[1].length);
  for (let i = 0; i < runs[0].length; i++) assert.equal(runs[0][i], runs[1][i], 'entry ' + i);
  const kinds = new Set(runs[0].flatMap((s) => (s.startsWith('[{"k"') ? JSON.parse(s).map((v) => v.k) : [])));
  for (const k of ['hit', 'skill', 'potion', 'equip', 'death', 'respawn']) assert.ok(kinds.has(k), 'the script exercised ' + k);
});
