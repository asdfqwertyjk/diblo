// shared/sim/combat.js — damage packets, crit, armour DR, block, resists, and the monster
// stat curve. Pure: every roll comes from the rng passed in (zone.streams.combat); events
// go to world.events; numbers come from classes.combat and monsters.curve.
import { clamp } from './dmath.js';
import classes from '../data/classes.js';
import monsters from '../data/monsters.js';
import items from '../data/items.js';
import { monsterXp } from './xp.js';

/** Damage keys other than 'phys'. Affix stats are `<el>Dmg`, resists `<el>Res`. */
export const ELEMENTS = ['fire', 'cold', 'light', 'poison'];

/** Combat rules (armour DR, crit, block caps): one source, classes.combat; stats.js reads the same. */
const RULES = classes.combat;

const NONE = {};

/** Continuous roll in [min, max] from a [min,max] pair; consumes one rng value. */
export function roll(rng, range) {
  const lo = +range[0] || 0, hi = +range[1] || 0;
  return hi > lo ? lo + rng.float() * (hi - lo) : lo;
}

/** Physical damage reduction 0..armourCap for `armour` against an attacker of that level. */
export function armourDR(armour, attackerLevel) {
  const a = +armour || 0;
  if (a <= 0) return 0;
  const L = attackerLevel > 1 ? attackerLevel : 1;
  return clamp(a / (a + RULES.armourPerLevel * L), 0, RULES.armourCap);
}

/**
 * Roll a player's attack. `mult` is the skill multiplier from skills.js (weaponPct × rank ×
 * synergy; 1 for a bare swing). opts: `element` (key the weapon damage lands on, default
 * 'phys'), `weaponPctOverride` (extra factor on the weapon part when `mult` lacks the row's
 * weaponPct), `tick` (world.tick; Warcry applies only while `e.buffUntil > tick`).
 * rng order: weapon roll, then crit roll. Values are floats; applyToMonster rounds.
 * @returns {phys, fire, cold, light, poison, crit}
 */
export function playerAttackPacket(e, mult, rng, opts) {
  const o = opts || NONE;
  const d = e.derived || NONE;
  const w = d.weapon || classes.unarmed;
  const m = mult > 0 ? mult : mult === 0 ? 0 : 1;
  const statKey = w.scaling || classes.unarmed.scaling;
  const stat = d[statKey] != null ? d[statKey] : (e.stats && e.stats[statKey]) || 0;
  const tick = o.tick;
  const warcry = tick != null && e.buffUntil > tick && e.buffDmgPct ? 1 + e.buffDmgPct / 100 : 1;
  const base = roll(rng, w.dmg) + (d.flatPhys || 0);
  const wpn = base * (1 + (d.pctDmg || 0) / 100) * (1 + stat / 100) * m
    * (o.weaponPctOverride != null ? o.weaponPctOverride : 1);
  const crit = rng.chance(clamp(d.crit || 0, 0, RULES.critCap) / 100);
  const k = warcry * (crit ? RULES.critMult : 1);
  const p = { phys: 0, fire: 0, cold: 0, light: 0, poison: 0, crit };
  const el = o.element && o.element in p && o.element !== 'crit' ? o.element : 'phys';
  p[el] += wpn * k;
  for (const x of ELEMENTS) {
    const flat = d[x + 'Dmg'];
    if (flat > 0) p[x] += flat * m * k;
  }
  return p;
}

/**
 * Apply a packet to a monster. Physical is reduced by armourDR(m.armour, attacker level),
 * elements by `m.res[el]` percent (missing = 0). Total rounds to an integer ≥ 1. Sets m.hp,
 * m.lastHitBy, m.lastCombatTick; the attacker's lastCombatTick, life on hit and mana on
 * kill (once, when this hit takes hp through 0). Event `hit` with `el` = the largest share.
 * A monster already flagged `dead`, or already at hp <= 0 from an earlier hit this tick, takes
 * nothing and emits nothing (so kill credit and MF stay with whoever took it through 0).
 * @returns dealt
 */
export function applyToMonster(world, zone, m, packet, srcId) {
  if (!m || m.dead || !(m.hp > 0)) return 0;
  const src = world.ents[srcId];
  const level = src && src.level > 1 ? src.level : 1;
  const res = m.res || NONE;
  let total = (packet.phys || 0) * (1 - armourDR(m.armour, level));
  let el = 'phys', best = total;
  for (const x of ELEMENTS) {
    const v = (packet[x] || 0) * (1 - (res[x] || 0) / 100);
    if (v > best) { best = v; el = x; }
    total += v;
  }
  let dealt = Math.floor(total + 0.5);
  if (dealt < 1) dealt = 1;
  m.hp -= dealt;
  m.lastHitBy = srcId;
  m.lastCombatTick = world.tick;
  if (src && src.kind === 'player' && !src.dead) {
    src.lastCombatTick = world.tick;
    const sd = src.derived;
    if (sd) {
      if (sd.lifeOnHit > 0) src.hp = Math.min(src.hpMax, src.hp + sd.lifeOnHit);
      if (sd.manaOnKill > 0 && m.hp <= 0) src.mp = Math.min(src.mpMax, src.mp + sd.manaOnKill);
    }
  }
  world.events.push({ k: 'hit', src: srcId, tgt: m.id, dmg: dealt, crit: !!packet.crit, el, x: m.x, z: m.z });
  return dealt;
}

/**
 * A monster (or anything with `id`, `dmg`, `level`) hits a player. Rolls m.dmg, then for
 * physical rolls the player's block (capped) → event `block {pid}`, 0 dealt. Otherwise
 * physical is reduced by the player's armour vs m.level, elements by the player's `<el>Res`;
 * integer ≥ 1; p.hp, p.lastCombatTick, event `hit`. opts `{el, dmg, level}` let
 * projectiles.js reuse this with an arrow's own numbers. Dead players take nothing.
 * @returns dealt (0 when blocked)
 */
export function monsterAttack(world, zone, m, p, rng, opts) {
  if (!p || p.dead) return 0;
  const o = opts || NONE;
  const el = o.el || 'phys';
  const range = o.dmg || m.dmg;
  const level = o.level > 1 ? o.level : m.level > 1 ? m.level : 1;
  const d = p.derived || NONE;
  const raw = roll(rng, range);
  if (el === 'phys') {
    const block = clamp(d.block || 0, 0, RULES.blockCap);
    if (block > 0 && rng.chance(block / 100)) {
      p.lastCombatTick = world.tick;
      world.events.push({ k: 'block', pid: p.id });
      return 0;
    }
  }
  const v = el === 'phys'
    ? raw * (1 - armourDR(d.armour, level))
    : raw * (1 - (d[el + 'Res'] || 0) / 100);
  let dealt = Math.floor(v + 0.5);
  if (dealt < 1) dealt = 1;
  p.hp -= dealt;
  p.lastCombatTick = world.tick;
  world.events.push({ k: 'hit', src: m.id, tgt: p.id, dmg: dealt, crit: false, el, x: p.x, z: p.z });
  return dealt;
}

/**
 * Monster numbers for a type (or an archetype id) at a level. Curve, archetype, champion or
 * boss multipliers, per-extra-player scaling and items.monsterArmourPerLevel.
 * opts: `dropTable` (the zone recipe's; the caller passes zone.recipe.dropTable),
 * `boss` (true → boss multipliers and dropTable 'boss'). Champions get 'champion'.
 * Multiplication order matches P0 world.js so plain-monster hp is unchanged.
 * @returns {hpMax, dmg:[min,max], armour, xpValue, speed, dropTable, ilvl, arch}
 */
export function monsterStats(typeId, level, champion, playersInGame, opts) {
  const o = opts || NONE;
  const type = monsters.types[typeId];
  const archId = type ? type.arch : typeId;
  const arch = monsters.archetypes[archId];
  if (!arch) throw new Error('unknown monster type ' + typeId);
  const cv = monsters.curve;
  const boss = !!o.boss;
  const champ = !!champion && !boss;
  const L = level > 1 ? level : 1;
  const extra = (playersInGame > 1 ? playersInGame : 1) - 1;
  const rank = boss ? cv.boss : champ ? cv.champion : null;
  const hpMax = Math.floor((cv.hpBase + cv.hpPerLevel * L) * arch.hp * (rank ? rank.hp : 1)
    * (1 + cv.perExtraPlayer.hp * extra));
  const mid = (cv.dmgBase + cv.dmgPerLevel * L) * arch.dmg * (rank ? rank.dmg : 1)
    * (1 + cv.perExtraPlayer.dmg * extra);
  let lo = Math.floor(mid * (1 - cv.dmgSpread) + 0.5);
  if (lo < 1) lo = 1;
  let hi = Math.floor(mid * (1 + cv.dmgSpread) + 0.5);
  if (hi < lo) hi = lo;
  return {
    hpMax,
    dmg: [lo, hi],
    armour: (items.monsterArmourPerLevel[archId] || 0) * L,
    xpValue: monsterXp(L, champ, boss),
    speed: arch.speed,
    dropTable: boss ? 'boss' : champ ? 'champion' : (o.dropTable || null),
    ilvl: L + (rank ? rank.ilvl : 0),
    arch: archId,
  };
}
