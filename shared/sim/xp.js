// shared/sim/xp.js — level curve, monster xp, level-difference penalty, co-op share, and
// grantXp (levels, points, full heal, events). Pure: numbers from classes.xp; events go to
// world.events; nothing here touches rng or the clock.
import { refreshDerived } from './stats.js';
import { clamp, dist2 } from './dmath.js';
import classes from '../data/classes.js';

/** XP rules (CLAUDE.md "XP"): classes.xp, the single source. */
const XP_RULES = classes.xp;

/** XP needed to go from level L to L+1. */
export function xpToNext(L) {
  const l = L > 1 ? Math.floor(L) : 1;
  return XP_RULES.perLevelSq * l * l;
}

/** Base xp a monster of level mlvl is worth (before penalty and co-op). Boss beats champion. */
export function monsterXp(mlvl, champion = false, boss = false) {
  const L = mlvl > 1 ? mlvl : 1;
  const R = XP_RULES;
  // written as base·L + (base·perLevel)·L² so integer levels give exact integers
  let xp = R.monsterBase * L + (R.monsterBase * R.monsterPerLevel) * L * L;
  if (boss) xp *= R.bossMult;
  else if (champion) xp *= R.championMult;
  return Math.floor(xp);
}

/** Below-level penalty: 1 until the character out-levels the monster by more than the free
 *  band, then falls linearly to penaltyMin. Never above 1 (no bonus for fighting up). */
export function penalty(clvl, mlvl) {
  const over = ((+clvl || 1) - (+mlvl || 1)) - XP_RULES.penaltyFreeLevels;
  if (over <= 0) return 1;
  return clamp(1 - XP_RULES.penaltyPerLevel * over, XP_RULES.penaltyMin, 1);
}

/** Co-op multiplier for the number of players in the game (not the zone). */
export function coopMult(playersInGame) {
  const n = playersInGame > 1 ? playersInGame : 1;
  return 1 + XP_RULES.coopPerPlayer * (n - 1);
}

/**
 * Add xp to a player and level up as many times as the total allows. Per level: statPoints
 * and skillPoints from classes.js, derived stats recomputed, full heal, event `levelup`.
 * Event `xp` once per grant. Levels stop at classes.maxLevel (xp keeps accumulating).
 * @returns levels gained
 */
export function grantXp(world, e, amount) {
  const add = Math.floor(+amount || 0);
  if (!e || add <= 0) return 0;
  if (!(e.level >= 1)) e.level = 1;
  e.xp = (e.xp || 0) + add;
  world.events.push({ k: 'xp', pid: e.id, amount: add });
  const maxL = classes.maxLevel;
  let gained = 0;
  while (e.level < maxL && e.xp >= xpToNext(e.level)) {
    e.xp -= xpToNext(e.level);
    e.level++;
    e.statPoints = (e.statPoints || 0) + classes.statPointsPerLevel;
    e.skillPoints = (e.skillPoints || 0) + classes.skillPointsPerLevel;
    refreshDerived(e);
    e.derivedLevel = e.level;
    e.hp = e.hpMax;
    e.mp = e.mpMax;
    gained++;
    world.events.push({ k: 'levelup', pid: e.id, level: e.level });
  }
  return gained;
}

/**
 * On a monster death: every live player in the zone within classes.xpShareRange of the
 * corpse gets `xpValue · penalty(clvl, mlvl) · coopMult(world.players.length)`, floored.
 * Uses m.xpValue (set by monsterStats) or falls back to monsterXp(m.level, …).
 * @returns [{pid, amount}] for the players who received xp (amount ≥ 1)
 */
export function shareKillXp(world, zone, m) {
  const r2 = classes.xpShareRange * classes.xpShareRange;
  const base = m.xpValue > 0 ? m.xpValue : monsterXp(m.level, !!m.champion, !!m.boss);
  const coop = coopMult(world.players.length);
  const out = [];
  for (const pid of world.players) {
    const p = world.ents[pid];
    if (!p || p.zone !== zone.id || p.dead) continue;
    if (dist2(p.x, p.z, m.x, m.z) > r2) continue;
    const amount = Math.floor(base * penalty(p.level, m.level) * coop);
    if (amount < 1) continue;
    grantXp(world, p, amount);
    out.push({ pid, amount });
  }
  return out;
}
