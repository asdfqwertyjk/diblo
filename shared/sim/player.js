// shared/sim/player.js — the player entity: creation from a character document, the
// persistence document, one tick of a player (one-shots, movement, skills, potions, regen,
// death and respawn). Pure: numbers from shared/data, ticks from world.tick, no rng here
// (skills.js and ground.js draw from the zone streams).
import classes from '../data/classes.js';
import items from '../data/items.js';
import { dnormInto } from './dmath.js';
import { DT, TICK_HZ, secTicks } from './world.js';
import { hash32, hashString, makeRng } from './rng.js';
import { tryMove, applyKnockback } from './movement.js';
import { refreshDerived } from './stats.js';
import { generateItem } from './itemgen.js';
import { ensureBags, moveItem, equip, unequip, toBelt, fromBelt, refillBelt, dropItem } from './inventory.js';
import { tryPickup, autoPickup } from './ground.js';
import { useSkill, stepChannel, dashHit, skillRow } from './skills.js';

const RULES = classes.skillRules;
const NONE = {};
const tmp = [0, 0];

const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
const int = (v, d = 0) => (Number.isFinite(+v) ? Math.floor(+v) : d);

function invalid(world, e, why) {
  world.events.push({ k: 'invalid', pid: e.id, why });
}

/** Recompute e.derived (hpMax/mpMax/speed) and remember which invVer/level it reflects. */
function syncDerived(e) {
  refreshDerived(e);
  e.derivedVer = e.invVer;
  e.derivedLevel = e.level;
}

/** A character-sheet change that touches no derived stat (skill rank, hotbar): bump invVer so a delta carries it. */
function bumpSheet(e) {
  e.invVer = (e.invVer | 0) + 1;
  e.derivedVer = e.invVer;
}

// --- creation and persistence ---------------------------------------------------------

/**
 * A fresh character document (toDoc shape, v 1): level 1, the class's startSkill on slot 0,
 * the class weapon rolled plain from a per-character stream (hash32(hashString(name), seed))
 * and equipped, the belt filled from the class's `startPotions`. Character creation (the
 * offline client now, the server in P3) and the bot build characters here.
 */
export function newCharacterDoc(name, cls, seed = 0) {
  const c = classes.classes[cls];
  if (!c) throw new Error('unknown class ' + cls);
  const rng = makeRng(hash32(hashString(name || ''), seed | 0));
  const equipment = {};
  for (const s of items.slots) equipment[s] = null;
  if (c.weapon) equipment.weapon = generateItem(rng, { ilvl: 1, rarity: 'normal', baseId: c.weapon });
  const belt = new Array(classes.belt.slots).fill(null);
  let bs = 0;
  for (const pid of Object.keys(c.startPotions || NONE)) {
    const n = c.startPotions[pid] | 0;
    if (n > 0 && items.potions[pid] && bs < belt.length) belt[bs++] = { potionId: pid, count: Math.min(n, classes.belt.stack) };
  }
  const slots = new Array(RULES.slots.length).fill(null);
  slots[0] = c.startSkill || null;
  return {
    v: 1,
    name: name || 'Nameless', cls, level: 1, xp: 0, gold: 0,
    statPoints: 0, skillPoints: 0, deaths: 0, playtime: 0,
    stats: { str: c.stats.str, dex: c.stats.dex, vit: c.stats.vit, ene: c.stats.ene },
    skills: c.startSkill ? { [c.startSkill]: 1 } : {},
    slots,
    inventory: { w: classes.inventory.w, h: classes.inventory.h, items: [] },
    equipment,
    belt,
    zone: classes.startZone,
  };
}

/**
 * Build a player entity from a character document at the zone's playerSpawn and register it
 * (world.ents, zone.ents, world.players, event spawn). Applies the class's startSkill at
 * rank 1, keeps slots[0] a learned skill, copies inventory/equipment/belt from the doc or
 * starts them empty, derives stats and fills hp/mp. → the entity (addPlayer returns e.id)
 */
export function createPlayerEnt(world, zone, doc) {
  const d = doc || NONE;
  const c = classes.classes[d.cls];
  if (!c) throw new Error('unknown class ' + d.cls);
  const id = 'p' + world.nextId++;
  const sp = zone.layout.playerSpawn;
  const st = d.stats || c.stats;
  const e = {
    id, kind: 'player', name: d.name || 'Nameless', cls: d.cls, zone: zone.id,
    x: sp.x, z: sp.z, dx: sp.dx, dz: sp.dz, anim: 'idle', r: c.radius, speed: c.runSpeed,
    hp: 0, hpMax: 0, mp: 0, mpMax: 0, dead: false,
    level: int(d.level, 1) >= 1 ? int(d.level, 1) : 1, xp: int(d.xp), gold: int(d.gold),
    statPoints: int(d.statPoints), skillPoints: int(d.skillPoints), deaths: int(d.deaths), playtime: int(d.playtime),
    stats: { str: int(st.str), dex: int(st.dex), vit: int(st.vit), ene: int(st.ene) },
    skills: {}, slots: new Array(RULES.slots.length).fill(null),
    inventory: null, equipment: null, belt: null, invVer: 0, derived: null,
    lastSeq: null, lockUntil: 0, lockAnim: 'attack', channel: null, dash: null, cooldowns: {},
    buffUntil: 0, buffDmgPct: 0, stunUntil: 0, kb: null,
    potion: null, beltCd: { life: 0, mana: 0 },
    lastCombatTick: 0, deadAt: null, respawnAt: null, target: null, heldSlot: null, playTicks: 0,
  };
  const ids = Object.keys(d.skills || NONE).sort();
  for (const k of ids) if (classes.skills[k] && d.skills[k] > 0) e.skills[k] = int(d.skills[k]);
  if (c.startSkill && !(e.skills[c.startSkill] >= 1)) e.skills[c.startSkill] = 1;
  const ds = Array.isArray(d.slots) ? d.slots : [];
  for (let i = 0; i < e.slots.length; i++) if (ds[i] && e.skills[ds[i]] >= 1) e.slots[i] = ds[i];
  if (!e.slots[0]) e.slots[0] = c.startSkill && e.skills[c.startSkill] >= 1 ? c.startSkill : ids.find((k) => e.skills[k] >= 1) || null;
  if (d.inventory && Array.isArray(d.inventory.items)) {
    e.inventory = { w: int(d.inventory.w, classes.inventory.w), h: int(d.inventory.h, classes.inventory.h), items: [] };
    for (const r of d.inventory.items) if (r && r.item) e.inventory.items.push({ iid: r.iid, x: int(r.x), y: int(r.y), item: clone(r.item) });
  }
  if (d.equipment) {
    e.equipment = {};
    for (const s of items.slots) e.equipment[s] = d.equipment[s] ? clone(d.equipment[s]) : null;
  }
  if (Array.isArray(d.belt)) {
    e.belt = new Array(classes.belt.slots).fill(null);
    for (let i = 0; i < e.belt.length; i++) {
      const b = d.belt[i];
      if (b && items.potions[b.potionId] && b.count > 0) e.belt[i] = { potionId: b.potionId, count: int(b.count) };
    }
  }
  ensureBags(e);
  syncDerived(e);
  e.hp = e.hpMax;
  e.mp = e.mpMax;
  world.ents[id] = e;
  zone.ents.add(id);
  world.players.push(id);
  world.events.push({ k: 'spawn', id });
  return e;
}

/** The persistence document (v 1), keys in a fixed order so equal states serialise identically. */
export function toDoc(e) {
  const inv = e.inventory || { w: classes.inventory.w, h: classes.inventory.h, items: [] };
  const eq = e.equipment || NONE;
  const skills = {};
  for (const k of Object.keys(e.skills || NONE).sort()) if (e.skills[k] > 0) skills[k] = e.skills[k];
  const equipment = {};
  for (const s of items.slots) equipment[s] = eq[s] ? clone(eq[s]) : null;
  return {
    v: 1,
    name: e.name, cls: e.cls, level: e.level, xp: e.xp, gold: e.gold,
    statPoints: e.statPoints, skillPoints: e.skillPoints, deaths: e.deaths, playtime: e.playtime,
    stats: { str: e.stats.str, dex: e.stats.dex, vit: e.stats.vit, ene: e.stats.ene },
    skills,
    slots: (e.slots || []).map((s) => s || null),
    inventory: { w: inv.w, h: inv.h, items: inv.items.map((r) => ({ iid: r.iid, x: r.x, y: r.y, item: clone(r.item) })) },
    equipment,
    belt: (e.belt || []).map((b) => (b ? { potionId: b.potionId, count: b.count } : null)),
    zone: e.zone,
  };
}

// --- death and respawn ----------------------------------------------------------------

/** Flag a player dead once (hp 0, anim die, timers, event death). world's death phase or stepPlayer calls it. */
export function killPlayer(world, zone, e) {
  if (e.dead) return;
  e.hp = 0; e.dead = true; e.anim = 'die';
  e.deaths = (e.deaths | 0) + 1;
  e.deadAt = world.tick;
  e.respawnAt = world.tick + secTicks(classes.respawnAfterSec);
  e.channel = null; e.dash = null; e.potion = null; e.kb = null; e.target = null;
  e.lockUntil = 0; e.stunUntil = 0;
  world.events.push({ k: 'death', id: e.id, x: e.x, z: e.z });
}

/** Back on your feet at the zone's playerSpawn: full hp/mp, −deathGoldLossPct% gold, event respawn. */
export function respawn(world, zone, e) {
  const sp = zone.layout.playerSpawn;
  if (e.zone !== zone.id) {
    const old = world.zones[e.zone];
    if (old) old.ents.delete(e.id);
    zone.ents.add(e.id);
    e.zone = zone.id;
  }
  e.x = sp.x; e.z = sp.z; e.dx = sp.dx; e.dz = sp.dz;
  e.gold = (e.gold | 0) - Math.floor((e.gold | 0) * classes.deathGoldLossPct / 100);
  e.dead = false; e.anim = 'idle';
  e.hp = e.hpMax; e.mp = e.mpMax;
  e.deadAt = null; e.respawnAt = null;
  e.lastCombatTick = world.tick;
  e.buffUntil = 0; e.buffDmgPct = 0; e.kb = null; e.dash = null; e.channel = null; e.potion = null;
  world.events.push({ k: 'respawn', id: e.id });
}

// --- one-shots: act / use / pick ------------------------------------------------------

function spendStat(e, stat) {
  const c = classes.classes[e.cls];
  if (!(stat in c.stats)) return { ok: false, why: 'bad stat' };
  if (!(e.statPoints > 0)) return { ok: false, why: 'no stat points' };
  e.stats[stat]++; e.statPoints--;
  e.invVer = (e.invVer | 0) + 1;   // the sheet changed: a delta carries invVer (and statPoints)
  syncDerived(e);
  return { ok: true };
}

function hasPointInRowAbove(e, row) {
  for (const k in classes.skills) {
    const r = classes.skills[k];
    if (r.class === row.class && r.tree === row.tree && r.row === row.row - 1 && (e.skills[k] | 0) >= 1) return true;
  }
  return false;
}

function spendSkill(e, id) {
  const row = skillRow(id);
  if (!row || row.class !== e.cls) return { ok: false, why: 'unknown skill' };
  if (!(e.skillPoints > 0)) return { ok: false, why: 'no skill points' };
  const rank = e.skills[id] | 0;
  if (rank >= RULES.maxRank) return { ok: false, why: 'max rank' };
  const need = RULES.rowUnlockLevels[row.row - 1];
  if (need == null || e.level < need) return { ok: false, why: 'needs level ' + need };
  if (row.row > 1 && !hasPointInRowAbove(e, row)) return { ok: false, why: 'needs the skill above' };
  e.skills[id] = rank + 1; e.skillPoints--;
  bumpSheet(e);
  return { ok: true };
}

function assignSlot(e, slot, id) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= e.slots.length) return { ok: false, why: 'bad slot' };
  if (id == null) {
    if (slot === 0) return { ok: false, why: 'slot 0 needs a skill' };
    if (e.slots[slot] !== null) { e.slots[slot] = null; bumpSheet(e); }
    return { ok: true };
  }
  if (!skillRow(id) || !((e.skills[id] | 0) >= 1)) return { ok: false, why: 'skill not learned' };
  if (e.slots[slot] !== id) { e.slots[slot] = id; bumpSheet(e); }
  return { ok: true };
}

function applyAct(world, zone, e, act) {
  if (!act || typeof act.op !== 'string') return invalid(world, e, 'bad act');
  let r;
  switch (act.op) {
    case 'move': r = moveItem(e, act.iid, int(act.x), int(act.y)); break;
    case 'equip': r = equip(e, act.iid); if (r.ok) world.events.push({ k: 'equip', pid: e.id, iid: act.iid }); break;
    case 'unequip': r = unequip(e, act.slot); break;
    case 'belt': r = toBelt(e, act.iid, act.slot); break;
    case 'unbelt': r = fromBelt(e, act.slot); break;
    case 'drop': r = e.dead ? { ok: false, why: 'dead' } : dropItem(world, zone, e, act.iid); break;
    case 'stat': r = spendStat(e, act.stat); break;
    case 'skill': r = spendSkill(e, act.id); break;
    case 'assign': r = assignSlot(e, act.slot, act.id); break;
    case 'respawn': if (e.dead) { respawn(world, zone, e); r = { ok: true }; } else r = { ok: false, why: 'not dead' }; break;
    default: r = { ok: false, why: 'unknown act' };
  }
  if (!r.ok) invalid(world, e, r.why || 'invalid');
  if (e.derivedVer !== e.invVer) syncDerived(e);
  return r;
}

/** Drink belt slot `slot`: one potion, effect spread over overSec, 1 s cooldown per kind, refill. */
function drink(world, e, slot) {
  const b = e.belt && e.belt[slot];
  const p = b && b.count > 0 ? items.potions[b.potionId] : null;
  if (!p) return invalid(world, e, 'no potion');
  const cd = e.beltCd || (e.beltCd = { life: 0, mana: 0 });
  if ((cd[p.kind] || 0) > world.tick) return invalid(world, e, 'belt cooldown');
  b.count--;
  if (b.count <= 0) e.belt[slot] = null;
  e.invVer = (e.invVer | 0) + 1;
  cd[p.kind] = world.tick + secTicks(classes.belt.cooldownSec);
  const ticks = secTicks(p.overSec) || 1;
  const pot = e.potion || (e.potion = { hpLeft: 0, hpPerTick: 0, mpLeft: 0, mpPerTick: 0 });
  if (p.kind === 'life') { pot.hpLeft += p.amount; pot.hpPerTick = pot.hpLeft / ticks; }
  else { pot.mpLeft += p.amount; pot.mpPerTick = pot.mpLeft / ticks; }
  world.events.push({ k: 'potion', pid: e.id, kind: p.kind });
  refillBelt(e);
}

function pick(world, zone, e, id) {
  const r = tryPickup(world, zone, e, id);
  if (!r.ok && r.why !== 'bag full') invalid(world, e, r.why);
  return r;
}

// --- per-tick pieces ------------------------------------------------------------------

/** Slide one tick along e.dash. → the finished dash (e.dash cleared) or null while it runs */
function slideDash(zone, e) {
  const d = e.dash;
  if (d.left > 0) {
    if (d.step > 0) tryMove(zone, e, d.dx * d.step, d.dz * d.step);
    e.dx = d.dx; e.dz = d.dz;
    d.left--;
  }
  if (d.left > 0) return null;
  e.dash = null;
  return d;
}

/** Slide along e.dash; at the last tick resolve the strike. → true while dashing */
function stepDash(world, zone, e) {
  const done = slideDash(zone, e);
  if (done) dashHit(world, zone, e, done.id);
  return true;
}

/** WASD-style mv: unit direction, magnitude ≤ 1 scales speed; channelling moves at moveMult. → moved */
function moveBy(world, zone, e, it, channelling) {
  if (e.lockUntil > world.tick && !channelling) return false;
  let mx = 0, mz = 0;
  if (it.mv) { mx = +it.mv[0] || 0; mz = +it.mv[1] || 0; }
  if (mx * mx + mz * mz <= 1e-6) return false;
  const l = dnormInto(tmp, mx, mz);
  let k = l > 1 ? 1 : l;
  if (channelling) { const row = skillRow(e.channel.id); k *= row && row.moveMult != null ? row.moveMult : 1; }
  const step = e.speed * k * DT;
  if (!channelling) { e.dx = tmp[0]; e.dz = tmp[1]; }
  tryMove(zone, e, tmp[0] * step, tmp[1] * step);
  return true;
}

function faceAim(e, aim) {
  const ax = (+aim[0] || 0) - e.x, az = (+aim[1] || 0) - e.z;
  if (ax * ax + az * az > 0.04) { dnormInto(tmp, ax, az); e.dx = tmp[0]; e.dz = tmp[1]; }
}

function tickPotion(e) {
  const p = e.potion;
  if (!p) return;
  if (p.hpLeft > 0) {
    const h = p.hpPerTick < p.hpLeft ? p.hpPerTick : p.hpLeft;
    e.hp = Math.min(e.hpMax, e.hp + h); p.hpLeft -= h;
  }
  if (p.mpLeft > 0) {
    const m = p.mpPerTick < p.mpLeft ? p.mpPerTick : p.mpLeft;
    e.mp = Math.min(e.mpMax, e.mp + m); p.mpLeft -= m;
  }
  if (p.hpLeft <= 1e-9 && p.mpLeft <= 1e-9) e.potion = null;
}

function tickRegen(world, e) {
  const R = classes.regen;
  if (e.hp < e.hpMax && world.tick - (e.lastCombatTick || 0) >= secTicks(R.lifeAfterSec)) {
    e.hp = Math.min(e.hpMax, e.hp + e.hpMax * R.lifePctPerSec / 100 / TICK_HZ);
  }
  if (e.mp < e.mpMax) {
    const ene = e.derived ? e.derived.ene : e.stats.ene;
    e.mp = Math.min(e.mpMax, e.mp + (R.manaBase + R.manaPerEne * ene) / TICK_HZ);
  }
}

// --- the tick ---------------------------------------------------------------------------

/**
 * One tick for a player in its zone. Order: derived cache, one-shots by seq (act/use/pick),
 * death → wait for the respawn act or timer; knockback, stun, dash, skill (held slot),
 * channel tick, movement (mv; blocked while lockUntil > tick unless channelling), idle
 * facing, potion effect, regen, autoPickup, anim (die > hit > attack/cast > run > idle).
 */
export function stepPlayer(world, zone, e, intent) {
  const it = intent || NONE;
  const tick = world.tick;
  if (e.derivedVer !== e.invVer || e.derivedLevel !== e.level) syncDerived(e);
  e.playTicks = (e.playTicks | 0) + 1;
  if (e.playTicks >= TICK_HZ) { e.playTicks = 0; e.playtime = (e.playtime | 0) + 1; }

  if (it.seq != null && it.seq !== e.lastSeq) {
    e.lastSeq = it.seq;
    if (it.act) applyAct(world, zone, e, it.act);
    if (!e.dead) {
      if (it.use != null) drink(world, e, it.use);
      if (it.pick != null) pick(world, zone, e, it.pick);
    }
  }

  if (!e.dead && e.hp <= 0) killPlayer(world, zone, e);
  if (e.dead) {
    e.anim = 'die';
    e.heldSlot = null;
    if (e.respawnAt != null && tick >= e.respawnAt) respawn(world, zone, e);
    return;
  }

  const t = it.target != null ? world.ents[it.target] : null;
  e.target = t && t.zone === zone.id ? it.target : null;

  const kb = applyKnockback(zone, e);
  const stunned = e.stunUntil > tick;
  let moved = false;
  if (e.dash) moved = stepDash(world, zone, e);
  else if (!kb && !stunned && it.skill != null) useSkill(world, zone, e, it.skill, it);
  e.heldSlot = it.skill != null ? it.skill : null;
  const channelling = stepChannel(world, zone, e, it);
  if (!e.dash && !kb && !stunned) moved = moveBy(world, zone, e, it, channelling);
  if (!moved && !channelling && !e.dash && !stunned && e.lockUntil <= tick && it.aim) faceAim(e, it.aim);

  tickPotion(e);
  tickRegen(world, e);
  autoPickup(world, zone, e);

  e.anim = stunned ? 'hit'
    : e.lockUntil > tick || channelling ? (e.lockAnim || 'attack')
      : moved ? 'run' : 'idle';
}

/**
 * Movement-only tick for a predicting net client (CLAUDE.md "Multiplayer": the local player
 * re-simulates unacked inputs on top of the acked server state). Knockback, stun, the dash
 * slide (no strike at its end), `mv` and facing — nothing here draws a stream, swings, spends,
 * drinks, picks up or regenerates, so the combat and loot streams stay the server's. The
 * lock / channel / dash state it reads is whatever the last acked snapshot left on the entity.
 * → true when the player moved this tick
 */
export function predictPlayer(world, zone, e, intent) {
  const it = intent || NONE;
  const tick = world.tick;
  if (e.dead) return false;
  const kb = applyKnockback(zone, e);
  const stunned = e.stunUntil > tick;
  const channelling = !!e.channel;
  let moved = false;
  if (e.dash) { slideDash(zone, e); moved = true; }
  else if (!kb && !stunned) moved = moveBy(world, zone, e, it, channelling);
  if (!moved && !channelling && !e.dash && !stunned && e.lockUntil <= tick && it.aim) faceAim(e, it.aim);
  return moved;
}
