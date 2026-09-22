// skills.js — the six Onslaught behaviours against the numbers in classes.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import recipes from '../../data/zones/index.js';
import classes from '../../data/classes.js';
import { createWorld, ensureZone, TICK_HZ } from '../world.js';
import { createPlayerEnt, stepPlayer } from '../player.js';
import { generateItem } from '../itemgen.js';
import { addItem } from '../inventory.js';
import { applyKnockback } from '../movement.js';
import { playerAttackPacket } from '../combat.js';
import {
  ARC_COS, skillRow, skillMult, skillCost, swingTicks, secTicks, canUse, useSkill, inArc, stepChannel,
} from '../skills.js';

const SEED = 77; // spawn at (64,120) facing north with a clear 12 m runway (scanned)
const SK = classes.skills;
const R = classes.skillRules;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
/** Mana regen lands every tick, including the tick a skill is paid for. */
const manaTick = (e) => (classes.regen.manaBase + classes.regen.manaPerEne * e.derived.ene) / TICK_HZ;
const spent = (e, mp0, cost) => near(e.mp, Math.min(e.mpMax, mp0 - cost + manaTick(e)));

/** World + zone + a level-1 warrior holding a plain sword; every monster parked far away. */
function setup() {
  const world = createWorld({ recipes, seed: SEED });
  const zone = ensureZone(world, 'gallowsmoor');
  const e = createPlayerEnt(world, zone, { name: 'Hero', cls: 'warrior', level: 1 });
  for (const id of zone.ents) { const m = world.ents[id]; if (m.kind === 'monster') { m.x = -50; m.z = -50; } }
  const sword = generateItem(zone.streams.loot, { ilvl: 1, rarity: 'normal', baseId: 'sword' });
  addItem(e, sword);
  world.tick++;
  stepPlayer(world, zone, e, { seq: 1, act: { op: 'equip', iid: sword.iid } });
  assert.equal(e.derived.weapon.kind, 'sword');
  world.events = [];
  return { world, zone, e };
}

function learn(e, id, rank = 1, slot = 1) { e.skills[id] = rank; e.slots[slot] = id; }

/** Park the idx-th monster at an offset from the player at full hp. */
function monsterAt(world, zone, e, ox, oz, idx = 0) {
  const ms = [...zone.ents].map((id) => world.ents[id]).filter((m) => m.kind === 'monster');
  const m = ms[idx];
  m.x = e.x + ox; m.z = e.z + oz; m.hp = m.hpMax; m.stunUntil = 0; m.kb = null;
  return m;
}

function tick(world, zone, e, intent) {
  world.tick++;
  stepPlayer(world, zone, e, intent);
  const ev = world.events; world.events = [];
  return ev;
}

test('ARC_COS holds cos(arc/2) for every arc the tables use', () => {
  assert.equal(ARC_COS[60], 0.8660254037844387);
  assert.equal(ARC_COS[90], 0.7071067811865476);
  assert.equal(ARC_COS[120], 0.5);
  for (const row of Object.values(SK)) if (row.shape && row.shape.arc != null) assert.ok(ARC_COS[row.shape.arc] != null, row.id);
  assert.ok(near(ARC_COS[60], Math.cos(Math.PI / 6), 1e-15) && near(ARC_COS[90], Math.cos(Math.PI / 4), 1e-15));
});

test('skillMult / skillCost / swingTicks follow the skill rules', () => {
  const { e } = setup();
  assert.equal(skillMult(SK.cleave, 1, e), SK.cleave.weaponPct);
  assert.ok(near(skillMult(SK.cleave, 3, e), SK.cleave.weaponPct * (1 + 2 * R.effectPerRank)));
  e.skills.cleave = 2;
  assert.ok(near(skillMult(SK.whirl, 1, e), SK.whirl.weaponPct * (1 + 2 * R.synergyPerPoint)), 'synergy counts hard points');
  e.skills.skullbreak = 3;
  assert.ok(near(skillMult(SK.earthbreak, 2, e), SK.earthbreak.weaponPct * (1 + R.effectPerRank) * (1 + 3 * R.synergyPerPoint)));
  assert.equal(skillMult(SK.warcry, 1, e), 1, 'a buff has no weaponPct');
  assert.equal(skillCost(SK.lunge, 1), SK.lunge.cost);
  assert.equal(skillCost(SK.lunge, 3), SK.lunge.cost + 2 * R.manaPerRank);
  assert.ok(near(skillCost(SK.whirl, 1), SK.whirl.costPerSec * SK.whirl.tickEvery), 'channel cost per channel tick');
  assert.equal(skillCost(SK.cleave, 10), 0, 'a 0-cost row (the basic attack) stays free at every rank');
  assert.equal(swingTicks(e), Math.round(TICK_HZ * R.swingSec / 1.0), 'sword speed 1.0');
  e.derived.weapon.speed = 0.85;
  assert.equal(swingTicks(e), Math.round(TICK_HZ * R.swingSec / 0.85));
  e.derived.weapon.speed = 1; e.derived.ias = 100;
  assert.equal(swingTicks(e), Math.round(TICK_HZ * R.swingSec / 2));
  e.derived.ias = 100000;
  assert.equal(swingTicks(e), 2, 'never below two ticks');
});

test('canUse reports unknown / dead / stunned / locked / cooldown / mana in that order', () => {
  const { world, e } = setup();
  assert.deepEqual(canUse(world, e, null), { ok: false, why: 'unknown' });
  assert.deepEqual(canUse(world, e, skillRow('cleave')), { ok: true, rank: 1 });
  assert.equal(canUse(world, e, SK.lunge).why, 'locked');
  learn(e, 'lunge');
  e.mp = 1;
  assert.equal(canUse(world, e, SK.lunge).why, 'mana');
  e.mp = 25;
  e.cooldowns.lunge = world.tick + 1;
  assert.equal(canUse(world, e, SK.lunge).why, 'cooldown');
  e.cooldowns.lunge = world.tick;
  assert.equal(canUse(world, e, SK.lunge).ok, true, 'ready at the ready tick');
  e.lockUntil = world.tick + 1;
  assert.equal(canUse(world, e, SK.lunge).why, 'cooldown');
  e.lockUntil = 0; e.stunUntil = world.tick + 1;
  assert.equal(canUse(world, e, SK.lunge).why, 'stunned');
  e.dead = true;
  assert.equal(canUse(world, e, SK.lunge).why, 'dead');
});

test('inArc: range + m.r, half-arc from the facing', () => {
  const e = { x: 0, z: 0, dx: 1, dz: 0 };
  assert.ok(inArc(e, { x: 2.5, z: 0, r: 0.4 }, 2.5, 120));
  assert.ok(inArc(e, { x: 2.8, z: 0, r: 0.4 }, 2.5, 120), 'target radius extends the reach');
  assert.ok(!inArc(e, { x: 3.0, z: 0, r: 0.4 }, 2.5, 120));
  assert.ok(inArc(e, { x: Math.cos(0.9), z: Math.sin(0.9), r: 0 }, 2.5, 120), '52° is inside a 120° arc');
  assert.ok(!inArc(e, { x: Math.cos(1.2), z: Math.sin(1.2), r: 0 }, 2.5, 120), '69° is outside');
  assert.ok(!inArc(e, { x: Math.cos(0.7), z: Math.sin(0.7), r: 0 }, 2.5, 60), '40° is outside a 60° arc');
  assert.ok(inArc(e, { x: 0, z: 0, r: 0 }, 2.5, 60), 'standing on the target counts');
  assert.throws(() => inArc(e, { x: 1, z: 0, r: 0 }, 2.5, 45), /cosine/);
});

test('cleave hits the monster in front and not the one behind', () => {
  const { world, zone, e } = setup();
  const front = monsterAt(world, zone, e, 0, -1.5, 0);
  const back = monsterAt(world, zone, e, 0, 1.5, 1);
  const side = monsterAt(world, zone, e, 1.5 * Math.sin(1.2), -1.5 * Math.cos(1.2), 2); // 69° off: outside 120°
  const inside = monsterAt(world, zone, e, -1.5 * Math.sin(0.9), -1.5 * Math.cos(0.9), 3); // 52° off: inside
  const t0 = world.tick + 1;
  const ev = tick(world, zone, e, { seq: 2, aim: [e.x, e.z - 5], skill: 0 });
  assert.ok(front.hp < front.hpMax, 'front took damage');
  assert.ok(inside.hp < inside.hpMax, 'inside the arc took damage');
  assert.equal(back.hp, back.hpMax, 'behind is untouched');
  assert.equal(side.hp, side.hpMax, 'outside the arc is untouched');
  const hits = ev.filter((v) => v.k === 'hit');
  assert.deepEqual(hits.map((h) => h.tgt).sort(), [front.id, inside.id].sort());
  assert.ok(hits.every((h) => h.src === e.id && h.dmg >= 1 && h.el === 'phys'));
  const sk = ev.filter((v) => v.k === 'skill');
  assert.equal(sk.length, 1);
  assert.deepEqual([sk[0].pid, sk[0].id, sk[0].ax, sk[0].az], [e.id, 'cleave', e.x, e.z - 5]);
  assert.deepEqual([e.dx, e.dz], [0, -1], 'facing turned to the aim');
  assert.equal(e.lockUntil, t0 + swingTicks(e));
  assert.equal(e.anim, 'attack');
  assert.equal(e.mp, e.mpMax, 'cleave is free');
  // aim from a target entity when it is in the zone: turn to it and hit it
  const t = monsterAt(world, zone, e, 2, 0, 4);
  world.tick = e.lockUntil;
  const ev2 = tick(world, zone, e, { seq: 3, aim: [e.x, e.z - 5], target: t.id, skill: 0 });
  assert.ok(near(e.dx, 1) && near(e.dz, 0), 'faced the target, not the aim point');
  assert.ok(ev2.some((v) => v.k === 'hit' && v.tgt === t.id));
});

test('whirl charges mana per channel tick, hits around, stops at empty mana and on release', () => {
  const { world, zone, e } = setup();
  learn(e, 'whirl');
  const m = monsterAt(world, zone, e, 1.0, 0.3, 0);
  const cost = skillCost(SK.whirl, 1);
  const regen = (classes.regen.manaBase + classes.regen.manaPerEne * e.derived.ene) / TICK_HZ;
  const every = secTicks(SK.whirl.tickEvery);
  const hold = { seq: 2, aim: [e.x + 3, e.z], skill: 1 };
  let spins = 0, lastSpin = -1, stoppedAt = -1, hpBefore = m.hp;
  for (let i = 0; i < 400; i++) {
    m.hp = m.hpMax; hpBefore = m.hpMax; // keep the dummy alive: a dead monster is skipped
    const mpBefore = e.mp;
    const ev = tick(world, zone, e, hold);
    const spun = ev.some((v) => v.k === 'skill' && v.id === 'whirl');
    if (spun) {
      spins++;
      if (lastSpin >= 0 && stoppedAt < 0) assert.equal(world.tick - lastSpin, every, 'a channel tick every tickEvery');
      lastSpin = world.tick;
      assert.ok(near(e.mp, mpBefore - cost + regen), `mana −cost at tick ${world.tick}`);
      assert.ok(m.hp < hpBefore, 'hit every channel tick'); hpBefore = m.hp;
      assert.equal(e.anim, 'attack');
      assert.ok(e.channel && e.channel.id === 'whirl');
    } else if (stoppedAt < 0 && spins > 0 && !e.channel) {
      stoppedAt = world.tick;
      assert.ok(mpBefore < cost, 'ran dry: ' + mpBefore);
      break;
    }
  }
  assert.ok(spins >= 15 && stoppedAt > 0, `spun ${spins} times, stopped ${stoppedAt}`);
  assert.equal(e.channel, null);
  // release: a fresh channel ends the tick the slot is let go
  e.mp = e.mpMax;
  tick(world, zone, e, hold);
  assert.ok(e.channel);
  tick(world, zone, e, { seq: 3, aim: hold.aim, skill: null });
  assert.equal(e.channel, null);
  assert.equal(e.anim, 'idle');
  // stepChannel alone: nothing without a channel; ends when the held slot is another skill
  assert.equal(stepChannel(world, zone, e, hold), false);
  tick(world, zone, e, hold);
  assert.ok(e.channel);
  tick(world, zone, e, { seq: 4, aim: hold.aim, skill: 0 });
  assert.equal(e.channel, null, 'switching to cleave ends the spin');
});

test('lunge dashes ~6 m toward the aim and strikes at the end; toward a target it stops short', () => {
  const { world, zone, e } = setup();
  learn(e, 'lunge');
  const m = monsterAt(world, zone, e, 0, -6.5, 0);
  const z0 = e.z, mp0 = e.mp;
  const t0 = world.tick + 1;
  const ev = tick(world, zone, e, { seq: 2, aim: [e.x, e.z - 10], skill: 1 });
  assert.ok(e.dash && e.dash.left === SK.lunge.dashTicks && near(e.dash.step, SK.lunge.shape.range / SK.lunge.dashTicks));
  assert.ok(spent(e, mp0, SK.lunge.cost), 'mana ' + e.mp);
  assert.equal(e.cooldowns.lunge, t0 + secTicks(SK.lunge.cooldown));
  assert.equal(ev.filter((v) => v.k === 'skill' && v.id === 'lunge').length, 1);
  assert.equal(e.z, z0, 'the first dash step lands next tick');
  let hits = [];
  for (let i = 0; i < SK.lunge.dashTicks; i++) {
    const evs = tick(world, zone, e, { seq: 2, aim: [e.x, e.z - 10], skill: 1, mv: [1, 0] });
    hits = hits.concat(evs.filter((v) => v.k === 'hit'));
    if (i < SK.lunge.dashTicks - 1) assert.equal(e.anim, 'run');
  }
  assert.ok(near(z0 - e.z, SK.lunge.shape.range, 1e-6), 'moved ' + (z0 - e.z));
  assert.equal(e.x, 64, 'mv is ignored while dashing');
  assert.equal(e.dash, null);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].tgt, m.id);
  assert.ok(m.hp < m.hpMax);
  assert.equal(e.lockUntil, world.tick + swingTicks(e), 'swing lock after the strike');
  assert.equal(e.anim, 'attack');
  // toward a target entity: stop at touching distance, then hit it
  e.x = 64; e.z = z0; e.lockUntil = 0; e.cooldowns.lunge = 0; e.mp = e.mpMax;
  const t = monsterAt(world, zone, e, 0, -3, 1);
  tick(world, zone, e, { seq: 3, aim: [e.x + 5, e.z], target: t.id, skill: 1 });
  assert.ok(near(e.dash.step * e.dash.left, 3 - (e.r + t.r)), 'dash length stops short of the target');
  let hit = false;
  for (let i = 0; i < SK.lunge.dashTicks; i++) hit = tick(world, zone, e, { seq: 3, target: t.id, skill: 1 }).some((v) => v.k === 'hit' && v.tgt === t.id) || hit;
  assert.ok(hit && near(e.z, z0 - 3 + e.r + t.r, 1e-6));
});

test('warcry raises the attack packet by 20% for 10 s', () => {
  const { world, zone, e } = setup();
  learn(e, 'warcry');
  const mp0 = e.mp;
  const t0 = world.tick + 1;
  const ev = tick(world, zone, e, { seq: 2, aim: [e.x, e.z - 5], skill: 1 });
  assert.equal(e.buffUntil, t0 + secTicks(SK.warcry.duration));
  assert.equal(e.buffDmgPct, SK.warcry.effect.dmgPct);
  assert.ok(spent(e, mp0, SK.warcry.cost), 'mana ' + e.mp);
  assert.equal(e.cooldowns.warcry, t0 + secTicks(SK.warcry.cooldown));
  assert.equal(e.anim, 'cast');
  assert.ok(ev.some((v) => v.k === 'skill' && v.id === 'warcry'));
  const rng = zone.streams.combat;
  const s = rng.state;
  const buffed = playerAttackPacket(e, 1, rng, { tick: world.tick });
  rng.state = s;
  const lastTick = playerAttackPacket(e, 1, rng, { tick: e.buffUntil - 1 });
  rng.state = s;
  const expired = playerAttackPacket(e, 1, rng, { tick: e.buffUntil });
  assert.ok(near(buffed.phys, expired.phys * (1 + SK.warcry.effect.dmgPct / 100)), `${buffed.phys} vs ${expired.phys}`);
  assert.ok(near(lastTick.phys, buffed.phys));
  e.skills.warcry = 2;
  e.cooldowns.warcry = 0; e.lockUntil = 0; e.mp = e.mpMax;
  tick(world, zone, e, { seq: 3, skill: 1 });
  assert.ok(near(e.buffDmgPct, SK.warcry.effect.dmgPct * (1 + R.effectPerRank)), 'rank 2 shouts louder');
});

test('skullbreak stuns its target; without a target in the arc it costs nothing', () => {
  const { world, zone, e } = setup();
  learn(e, 'skullbreak');
  const m = monsterAt(world, zone, e, 0, -1.5, 0);
  const far = monsterAt(world, zone, e, 0, -2.5, 1);
  const mp0 = e.mp;
  const t0 = world.tick + 1;
  const ev = tick(world, zone, e, { seq: 2, aim: [e.x, e.z - 5], skill: 1 });
  const ticks = secTicks(SK.skullbreak.stun);
  assert.equal(m.stunUntil, t0 + ticks);
  assert.deepEqual(ev.find((v) => v.k === 'stun'), { k: 'stun', id: m.id, ticks });
  assert.equal(ev.filter((v) => v.k === 'hit').length, 1, 'single target: the nearest');
  assert.equal(far.hp, far.hpMax);
  assert.ok(spent(e, mp0, SK.skullbreak.cost), 'mana ' + e.mp);
  assert.equal(e.cooldowns.skullbreak, t0 + secTicks(SK.skullbreak.cooldown));
  // whiff: nobody in the 60° arc
  m.x = -50; far.x = -50;
  e.cooldowns.skullbreak = 0; e.lockUntil = 0;
  tick(world, zone, e, { seq: 3, aim: [e.x, e.z - 5], skill: null }); // release so the whiff is a fresh press
  e.mp = mp0;
  const ev2 = tick(world, zone, e, { seq: 3, aim: [e.x, e.z - 5], skill: 1 });
  assert.ok(spent(e, mp0, 0), 'no mana spent on a whiff: ' + e.mp);
  assert.equal(e.cooldowns.skullbreak, 0, 'no cooldown on a whiff');
  assert.deepEqual(ev2.filter((v) => v.k === 'invalid'), [{ k: 'invalid', pid: e.id, why: 'no target' }]);
  const ev3 = tick(world, zone, e, { seq: 3, aim: [e.x, e.z - 5], skill: 1 });
  assert.equal(ev3.filter((v) => v.k === 'invalid').length, 0, 'held slot does not repeat the message');
});

test('earthbreak hits a circle at the aim and knocks monsters back ~3 m', () => {
  const { world, zone, e } = setup();
  learn(e, 'earthbreak');
  const m = monsterAt(world, zone, e, 0, -4, 0);      // 1 m past the centre: pushed north
  const nearMe = monsterAt(world, zone, e, 0, -0.5, 1); // 2.5 m from the centre: inside r 4
  const out = monsterAt(world, zone, e, 0, -8, 2);     // 5 m from the centre: outside
  const mp0 = e.mp;
  const ev = tick(world, zone, e, { seq: 2, aim: [e.x, e.z - 3], skill: 1 });
  assert.ok(spent(e, mp0, SK.earthbreak.cost), 'mana ' + e.mp);
  const sk = ev.find((v) => v.k === 'skill');
  assert.deepEqual([sk.ax, sk.az], [e.x, e.z - 3], 'the quake is centred on the aim');
  assert.deepEqual(ev.filter((v) => v.k === 'hit').map((h) => h.tgt).sort(), [m.id, nearMe.id].sort());
  assert.equal(out.hp, out.hpMax);
  assert.ok(m.kb && near(m.kb.dx, 0) && near(m.kb.dz, -1) && near(m.kb.step * m.kb.left, SK.earthbreak.knockback));
  assert.ok(nearMe.kb && near(nearMe.kb.dz, 1), 'the one short of the centre flies toward the player');
  const z0 = m.z;
  let n = 0;
  while (applyKnockback(zone, m)) n++;
  assert.ok(near(z0 - m.z, SK.earthbreak.knockback, 1e-6), 'flew ' + (z0 - m.z));
  assert.equal(m.kb, null);
  assert.ok(n >= 2 && n <= 10, 'over a few ticks: ' + n);
  // the centre is clamped to shape.range from the player
  e.cooldowns.earthbreak = 0; e.lockUntil = 0; e.mp = e.mpMax;
  const ev2 = tick(world, zone, e, { seq: 3, aim: [e.x, e.z - 30], skill: 1 });
  const sk2 = ev2.find((v) => v.k === 'skill');
  assert.ok(near(sk2.az, e.z - SK.earthbreak.shape.range, 1e-9) && near(sk2.ax, e.x));
});

test('cooldowns and the swing lock hold; invalid only on a fresh press', () => {
  const { world, zone, e } = setup();
  learn(e, 'lunge');
  const m = monsterAt(world, zone, e, 0, -1.5, 0);
  const hold = { seq: 2, aim: [e.x, e.z - 5], skill: 0 };
  const t0 = world.tick + 1;
  assert.equal(tick(world, zone, e, hold).filter((v) => v.k === 'hit').length, 1);
  const lock = swingTicks(e);
  for (let i = 1; i < lock; i++) {
    const ev = tick(world, zone, e, hold);
    assert.equal(ev.filter((v) => v.k === 'hit').length, 0, 'locked at tick ' + world.tick);
    assert.equal(ev.filter((v) => v.k === 'invalid').length, 0, 'a swing lock is silent');
    assert.equal(e.anim, 'attack');
  }
  assert.equal(world.tick, t0 + lock - 1);
  assert.equal(tick(world, zone, e, hold).filter((v) => v.k === 'hit').length, 1, 'swings again when the lock ends');
  // lunge: its cooldown outlasts the dash and the lock
  e.lockUntil = 0;
  const t1 = world.tick + 1;
  tick(world, zone, e, { seq: 3, aim: [e.x, e.z - 10], skill: 1 });
  const ready = t1 + secTicks(SK.lunge.cooldown);
  assert.equal(e.cooldowns.lunge, ready);
  const mp = e.mp;
  while (world.tick < ready - 1) {
    const ev = tick(world, zone, e, { seq: 3, aim: [e.x, e.z - 10], skill: 1 });
    assert.equal(ev.filter((v) => v.k === 'skill' && v.id === 'lunge' && !e.dash).length, e.dash ? 0 : ev.filter((v) => v.k === 'skill').length);
  }
  assert.equal(e.dash, null);
  assert.ok(near(e.mp, mp + (ready - 1 - t1) * (classes.regen.manaBase + classes.regen.manaPerEne * e.derived.ene) / TICK_HZ, 1e-6), 'no mana spent while cooling');
  const ev = tick(world, zone, e, { seq: 3, aim: [e.x, e.z - 10], skill: 1 });
  assert.ok(e.dash && ev.some((v) => v.k === 'skill' && v.id === 'lunge'), 'fires at the ready tick');
  // a press on an unlearned slot says 'locked' once; 'unknown' for an empty slot
  e.dash = null; e.lockUntil = 0;
  e.slots[2] = 'warcry';
  const a = tick(world, zone, e, { seq: 4, skill: 2 });
  assert.deepEqual(a.filter((v) => v.k === 'invalid'), [{ k: 'invalid', pid: e.id, why: 'locked' }]);
  assert.equal(tick(world, zone, e, { seq: 4, skill: 2 }).filter((v) => v.k === 'invalid').length, 0);
  const b = tick(world, zone, e, { seq: 4, skill: 3 });
  assert.deepEqual(b.filter((v) => v.k === 'invalid'), [{ k: 'invalid', pid: e.id, why: 'unknown' }]);
  e.cooldowns.lunge = 0; // the ready-tick lunge re-armed its cooldown; clear it so mana is the gate
  e.mp = 0;
  const c = tick(world, zone, e, { seq: 4, skill: 1 });
  assert.equal(c.find((v) => v.k === 'invalid').why, 'mana');
  assert.equal(useSkill(world, zone, e, 1, {}).why, 'mana');
  assert.ok(m.hp < m.hpMax);
});

test('a stunned or dead player cannot act; a stun ends a channel', () => {
  const { world, zone, e } = setup();
  learn(e, 'whirl');
  const m = monsterAt(world, zone, e, 1, 0, 0);
  tick(world, zone, e, { seq: 2, skill: 1 });
  assert.ok(e.channel);
  const hpAfterSpin = m.hp;
  assert.ok(hpAfterSpin < m.hpMax, 'the first spin landed');
  e.stunUntil = world.tick + 3;
  const ev = tick(world, zone, e, { seq: 2, skill: 1, mv: [0, -1] });
  assert.equal(e.channel, null);
  assert.equal(e.anim, 'hit');
  assert.equal(ev.filter((v) => v.k === 'hit').length, 0);
  assert.equal(e.z, 120, 'no movement while stunned');
  e.stunUntil = 0;
  e.hp = 0;
  tick(world, zone, e, { seq: 3, skill: 0 });
  assert.ok(e.dead);
  assert.equal(useSkill(world, zone, e, 0, {}).why, 'dead');
  assert.equal(m.hp, hpAfterSpin, 'nothing landed after the stun');
});
