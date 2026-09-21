// shared/sim/skills.js — one behaviour per skill kind: melee, dash, buff, strike, channel, aoe.
// Pure: rolls come from zone.streams.combat (inside combat.js), ticks from world.tick,
// every number from shared/data/classes.js. Damage goes through combat.playerAttackPacket
// and applyToMonster; movement effects (dash, knockback) are written as state that
// player.js / movement.js consume. No Math.cos: the arc test uses the literal ARC_COS table.
import classes from '../data/classes.js';
import { dist2, dsqrt, dnormInto } from './dmath.js';
import { playerAttackPacket, applyToMonster } from './combat.js';
import { TICK_HZ, secTicks } from './world.js';

/** Re-exported for the tests and player.js; the definition lives next to TICK_HZ in world.js. */
export { secTicks };

const RULES = classes.skillRules;

/** cos(arc/2) for every arc the skill tables use (60/90/120°). Literal, so no Math.cos. */
export const ARC_COS = { 60: 0.8660254037844387, 90: 0.7071067811865476, 120: 0.5 };

const KB_TICKS = RULES.knockbackTicks;

const NONE = {};
const tmp = [0, 0];

/** The skill row for an id, or null. */
export function skillRow(id) {
  return (id && classes.skills[id]) || null;
}

/** Hard points the player has in a skill (0 when unknown). */
function rankOf(e, id) {
  return (e.skills && e.skills[id]) | 0;
}

const rankMult = (rank) => 1 + RULES.effectPerRank * ((rank > 1 ? rank : 1) - 1);

/** weaponPct × (1 + effectPerRank·(rank−1)) × (1 + synergyPerPoint·Σ hard points in row.synergies). */
export function skillMult(row, rank, e) {
  let syn = 0;
  const list = row.synergies || [];
  for (let i = 0; i < list.length; i++) syn += rankOf(e, list[i]);
  const wp = row.weaponPct != null ? row.weaponPct : 1;
  return wp * rankMult(rank) * (1 + RULES.synergyPerPoint * syn);
}

/** Mana per use (cost + manaPerRank·(rank−1)); for a channel, mana per channel tick. */
export function skillCost(row, rank) {
  const extra = RULES.manaPerRank * ((rank > 1 ? rank : 1) - 1);
  if (row.kind === 'channel') return ((row.costPerSec || 0) + extra) * (row.tickEvery || 0);
  return (row.cost || 0) + extra;
}

/** Swing lock in ticks: max(2, round(TICK_HZ·swingSec / (weapon.speed·(1+ias/100)))). */
export function swingTicks(e) {
  const d = e.derived || NONE;
  const w = d.weapon || classes.unarmed;
  const t = Math.floor(TICK_HZ * RULES.swingSec / (w.speed * (1 + (d.ias || 0) / 100)) + 0.5);
  return t < 2 ? 2 : t;
}

/**
 * Can the player fire this row now? why ∈ unknown | dead | stunned | locked | cooldown | mana.
 * A swing lock, a running dash and a skill cooldown all report 'cooldown'.
 */
export function canUse(world, e, row) {
  if (!row) return { ok: false, why: 'unknown' };
  if (e.dead) return { ok: false, why: 'dead' };
  const tick = world.tick;
  if (e.stunUntil > tick) return { ok: false, why: 'stunned' };
  const rank = rankOf(e, row.id);
  if (rank < 1) return { ok: false, why: 'locked' };
  if (e.lockUntil > tick || e.dash) return { ok: false, why: 'cooldown' };
  if (e.cooldowns && e.cooldowns[row.id] > tick) return { ok: false, why: 'cooldown' };
  if ((e.mp || 0) < skillCost(row, rank)) return { ok: false, why: 'mana' };
  return { ok: true, rank };
}

/**
 * Where a skill points: the target entity's position when intent.target lives in this zone,
 * else intent.aim, else one metre ahead. → [ax, az, targetEntity|null]
 */
function aimOf(world, zone, e, intent) {
  const it = intent || NONE;
  const t = it.target != null ? world.ents[it.target] : null;
  if (t && t.zone === zone.id) return [t.x, t.z, t];
  if (it.aim) return [+it.aim[0] || 0, +it.aim[1] || 0, null];
  return [e.x + e.dx, e.z + e.dz, null];
}

function faceToward(e, ax, az) {
  if (dnormInto(tmp, ax - e.x, az - e.z) > 1e-6) { e.dx = tmp[0]; e.dz = tmp[1]; }
}

/** Target inside range + m.r and within `arc` degrees of e's facing (cos from ARC_COS). */
export function inArc(e, m, range, arc) {
  const R = range + (m.r || 0);
  const d2 = dist2(e.x, e.z, m.x, m.z);
  if (d2 > R * R) return false;
  if (d2 < 1e-12) return true;
  const c = ARC_COS[arc];
  if (c == null) throw new Error('no cosine for arc ' + arc);
  return (m.x - e.x) * e.dx + (m.z - e.z) * e.dz >= c * dsqrt(d2);
}

/** The monster behind a zone.ents id while it can still be hit, else null (no per-swing arrays). */
function hittable(world, id) {
  const m = world.ents[id];
  return m && m.kind === 'monster' && !m.dead && m.hp > 0 ? m : null;
}

function strike(world, zone, e, m, row, mult) {
  const packet = playerAttackPacket(e, mult, zone.streams.combat, { tick: world.tick, element: row.element });
  return applyToMonster(world, zone, m, packet, e.id);
}

/** Hit every live monster inside the arc in front of e. → count */
function hitArc(world, zone, e, row, mult, range, arc) {
  let n = 0;
  for (const id of zone.ents) {
    const m = hittable(world, id);
    if (m && inArc(e, m, range, arc)) { strike(world, zone, e, m, row, mult); n++; }
  }
  return n;
}

function nearestInArc(world, zone, e, range, arc) {
  let best = null, bd = Infinity;
  for (const id of zone.ents) {
    const m = hittable(world, id);
    if (!m || !inArc(e, m, range, arc)) continue;
    const d2 = dist2(e.x, e.z, m.x, m.z);
    if (d2 < bd) { bd = d2; best = m; }
  }
  return best;
}

function emitSkill(world, e, id, ax, az) {
  world.events.push({ k: 'skill', pid: e.id, id, x: e.x, z: e.z, dx: e.dx, dz: e.dz, ax, az });
}

function invalid(world, e, why) {
  world.events.push({ k: 'invalid', pid: e.id, why });
}

/** Pay mana, start the cooldown and the swing lock. */
function commit(world, e, row, cost, lockTicks) {
  e.mp -= cost;
  if (row.cooldown > 0) (e.cooldowns || (e.cooldowns = {}))[row.id] = world.tick + secTicks(row.cooldown);
  if (lockTicks > 0) e.lockUntil = world.tick + lockTicks;
  e.lockAnim = row.kind === 'buff' ? 'cast' : 'attack';
}

/**
 * Fire hotbar slot `slot` (0 lmb, 1 rmb, 2..5 keys). Reads e.slots[slot], gates with canUse,
 * turns the facing to the aim and dispatches on row.kind. `invalid {pid, why}` is emitted only
 * on a fresh press (e.heldSlot !== slot, player.js maintains heldSlot) and never for cooldowns,
 * because a held slot is retried every tick. → {ok, why?, hits?}
 */
export function useSkill(world, zone, e, slot, intent) {
  const id = e.slots ? e.slots[slot] : null;
  const row = skillRow(id);
  const pressed = e.heldSlot !== slot;
  if (row && row.kind === 'channel' && e.channel && e.channel.id === id) {
    const [ax, az] = aimOf(world, zone, e, intent);
    faceToward(e, ax, az);
    return { ok: true };
  }
  const c = canUse(world, e, row);
  if (!c.ok) {
    if (pressed && c.why !== 'cooldown') invalid(world, e, c.why);
    return c;
  }
  const rank = c.rank;
  const cost = skillCost(row, rank);
  const mult = skillMult(row, rank, e);
  const tick = world.tick;
  const [ax, az, tgt] = aimOf(world, zone, e, intent);
  faceToward(e, ax, az);
  const sh = row.shape || NONE;

  switch (row.kind) {
    case 'melee': {
      commit(world, e, row, cost, swingTicks(e));
      const hits = hitArc(world, zone, e, row, mult, sh.range, sh.arc);
      emitSkill(world, e, id, ax, az);
      return { ok: true, hits };
    }
    case 'strike': {
      const live = tgt && tgt.kind === 'monster' && !tgt.dead && tgt.hp > 0;
      const m = live && inArc(e, tgt, sh.range, sh.arc) ? tgt : nearestInArc(world, zone, e, sh.range, sh.arc);
      if (!m) {
        if (pressed) invalid(world, e, 'no target');
        return { ok: false, why: 'no target' };
      }
      commit(world, e, row, cost, swingTicks(e));
      strike(world, zone, e, m, row, mult);
      if (row.stun > 0) {
        const ticks = secTicks(row.stun);
        const until = tick + ticks;
        if (!(m.stunUntil > until)) m.stunUntil = until;
        world.events.push({ k: 'stun', id: m.id, ticks });
      }
      emitSkill(world, e, id, m.x, m.z);
      return { ok: true, hits: 1 };
    }
    case 'dash': {
      let dx = e.dx, dz = e.dz, len = sh.range;
      const d = dnormInto(tmp, ax - e.x, az - e.z);
      if (d > 1e-6) {
        dx = tmp[0]; dz = tmp[1];
        const stop = tgt ? d - (e.r + (tgt.r || 0)) : d;
        if (stop < len) len = stop < 0 ? 0 : stop;
      }
      const ticks = row.dashTicks > 0 ? row.dashTicks : 1;
      commit(world, e, row, cost, 0);
      e.dash = { id, dx, dz, left: ticks, step: len / ticks };
      emitSkill(world, e, id, ax, az);
      return { ok: true };
    }
    case 'buff': {
      commit(world, e, row, cost, swingTicks(e));
      e.buffUntil = tick + secTicks(row.duration);
      e.buffDmgPct = ((row.effect && row.effect.dmgPct) || 0) * rankMult(rank);
      emitSkill(world, e, id, ax, az);
      return { ok: true };
    }
    case 'channel': {
      e.channel = { id, nextTick: tick };
      e.lockAnim = 'attack';
      return { ok: true };
    }
    case 'aoe': {
      let cx = ax, cz = az;
      const d = dnormInto(tmp, ax - e.x, az - e.z);
      if (d > sh.range) { cx = e.x + tmp[0] * sh.range; cz = e.z + tmp[1] * sh.range; }
      commit(world, e, row, cost, swingTicks(e));
      let hits = 0;
      for (const id of zone.ents) {
        const m = hittable(world, id);
        if (!m) continue;
        const R = sh.radius + (m.r || 0);
        if (dist2(cx, cz, m.x, m.z) > R * R) continue;
        strike(world, zone, e, m, row, mult);
        hits++;
        if (row.knockback > 0) {
          const l = dnormInto(tmp, m.x - cx, m.z - cz);
          const kx = l > 1e-6 ? tmp[0] : e.dx, kz = l > 1e-6 ? tmp[1] : e.dz;
          m.kb = { dx: kx, dz: kz, left: KB_TICKS, step: row.knockback / KB_TICKS };
        }
      }
      emitSkill(world, e, id, cx, cz);
      return { ok: true, hits };
    }
    default:
      if (pressed) invalid(world, e, 'unknown');
      return { ok: false, why: 'unknown' };
  }
}

/**
 * The strike at the end of a dash (player.js calls this when e.dash.left reaches 0): an arc of
 * shape.hitRange / shape.arc in the dash direction, then a swing lock. → hits
 */
export function dashHit(world, zone, e, id) {
  const row = skillRow(id);
  if (!row) return 0;
  const sh = row.shape || NONE;
  const mult = skillMult(row, rankOf(e, id) || 1, e);
  const hits = hitArc(world, zone, e, row, mult, sh.hitRange != null ? sh.hitRange : sh.range, sh.arc);
  e.lockUntil = world.tick + swingTicks(e);
  e.lockAnim = 'attack';
  emitSkill(world, e, id, e.x + e.dx, e.z + e.dz);
  return hits;
}

/**
 * One tick of e.channel. Ends (channel = null) when the slot is no longer held, the player
 * is dead or stunned, or the next tick's mana is missing. On a due tick: pays skillCost,
 * hits every live monster within shape.radius (+ m.r), schedules the next tick, event skill.
 * → true while channelling this tick
 */
export function stepChannel(world, zone, e, intent) {
  const ch = e.channel;
  if (!ch) return false;
  const it = intent || NONE;
  const row = skillRow(ch.id);
  const held = it.skill != null && e.slots && e.slots[it.skill] === ch.id;
  if (!row || !held || e.dead || e.stunUntil > world.tick) { e.channel = null; return false; }
  if (world.tick < ch.nextTick) return true;
  const rank = rankOf(e, ch.id) || 1;
  const cost = skillCost(row, rank);
  if ((e.mp || 0) < cost) { e.channel = null; return false; }
  e.mp -= cost;
  const mult = skillMult(row, rank, e);
  const R = (row.shape && row.shape.radius) || 0;
  for (const id of zone.ents) {
    const m = hittable(world, id);
    if (!m) continue;
    const rr = R + (m.r || 0);
    if (dist2(e.x, e.z, m.x, m.z) <= rr * rr) strike(world, zone, e, m, row, mult);
  }
  ch.nextTick = world.tick + secTicks(row.tickEvery);
  emitSkill(world, e, ch.id, e.x + e.dx, e.z + e.dz);
  return true;
}
