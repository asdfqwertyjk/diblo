// shared/sim/ai.js — monster brains: idle / chase / windup / recover / flee / return.
// One brain for every archetype (champions and bosses included); ranged archetypes keep
// their distance and shoot through projectiles.js. Pure: timings and ranges come from
// monsters.curve, movement goes through movement.js, hits through combat.monsterAttack
// (the only consumer of zone.streams.combat here). world.step runs this after players and
// projectiles, so a monster reacts to where the player stands this tick.
import monsters from '../data/monsters.js';
import { dist2, dsqrt, dnormInto } from './dmath.js';
import { moveToward, applyKnockback } from './movement.js';
import { monsterAttack } from './combat.js';
import { spawnProjectile } from './projectiles.js';
import { TICK_HZ, DT, secTicks } from './world.js';

const cv = monsters.curve;
const tmp = [0, 0];
let nearD2 = 0; // squared distance to the player nearestPlayer() last returned

/**
 * Set m.ai from the monster's current position (its leash anchor). world.js calls this once
 * per spawned monster; stepMonsters also calls it lazily for a monster that has none.
 */
export function initMonsterAI(m) {
  m.ai = {
    state: 'idle', targetId: null, anchorX: m.x, anchorZ: m.z,
    nextThink: 0, windupUntil: 0, recoverUntil: 0, fleeUntil: 0,
  };
  if (m.stunUntil == null) m.stunUntil = 0;
  if (m.kb === undefined) m.kb = null;
  return m.ai;
}

/** Step every live monster in the zone. Dead (or hp ≤ 0, dying this tick) monsters do nothing. */
export function stepMonsters(world, zone) {
  for (const id of zone.ents) {
    const m = world.ents[id];
    if (!m || m.kind !== 'monster' || m.dead || !(m.hp > 0)) continue;
    if (!m.ai) initMonsterAI(m);
    stepMonster(world, zone, m);
  }
}

function stepMonster(world, zone, m) {
  const ai = m.ai, tick = world.tick;
  // Being hurled or stunned interrupts an attack in progress and costs the whole tick.
  if (applyKnockback(zone, m)) { interrupt(ai); m.anim = 'hit'; return; }
  if (m.stunUntil > tick) { interrupt(ai); m.anim = 'hit'; return; }
  if (ai.fleeUntil === 0 && (ai.state === 'chase' || ai.state === 'windup' || ai.state === 'recover')
    && m.hp < cv.fleeBelow * m.hpMax && cv.fleeArchetypes.includes(m.arch)) {
    ai.state = 'flee';
    ai.fleeUntil = tick + secTicks(cv.fleeSec);
  }
  // A state either ends the tick (return) or hands over to the next state (continue);
  // the longest chain is recover → chase → windup, so four hops always suffice.
  for (let hop = 0; hop < 4; hop++) {
    switch (ai.state) {
      case 'idle': {
        const p = nearestPlayer(world, zone, m);
        if (!p || nearD2 > cv.sight * cv.sight) { m.anim = 'idle'; return; }
        ai.state = 'chase';
        ai.targetId = p.id;
        alertPack(world, zone, m, p.id);
        world.events.push({ k: 'aggro', id: m.id, type: m.type });
        continue;
      }
      case 'chase': {
        const p = nearestPlayer(world, zone, m);
        if (!p || dist2(m.x, m.z, ai.anchorX, ai.anchorZ) > cv.leash * cv.leash) { startReturn(m, tick); continue; }
        ai.targetId = p.id;
        const d = dsqrt(nearD2);
        if (cv.rangedArchetypes.includes(m.arch)) rangedChase(zone, m, p, d, tick);
        else if (d <= m.r + p.r + cv.meleeReach) startWindup(m, p, tick);
        else run(zone, m, p.x, p.z);
        return;
      }
      case 'windup': {
        if (tick < ai.windupUntil) { m.anim = 'attack'; return; }
        strike(world, zone, m);
        ai.state = 'recover';
        m.anim = 'attack';
        return;
      }
      case 'recover': {
        if (tick < ai.recoverUntil) { m.anim = 'idle'; return; }
        ai.state = 'chase';
        continue;
      }
      case 'flee': {
        if (tick >= ai.fleeUntil) { ai.state = 'chase'; continue; }
        const p = nearestPlayer(world, zone, m);
        if (p) runAway(zone, m, p); else m.anim = 'idle';
        return;
      }
      case 'return': {
        const left = moveToward(zone, m, ai.anchorX, ai.anchorZ, m.speed * DT);
        m.anim = 'run';
        if (left > m.r && tick < ai.nextThink) return;
        if (left > m.r) { ai.anchorX = m.x; ai.anchorZ = m.z; } // anchor unreachable: settle here
        m.hp = m.hpMax;
        ai.state = 'idle'; ai.targetId = null; ai.fleeUntil = 0;
        m.anim = 'idle';
        return;
      }
      default:
        ai.state = 'idle';
        continue;
    }
  }
}

/** Nearest live player in this zone, or null. Leaves its squared distance in nearD2. */
function nearestPlayer(world, zone, m) {
  let best = null;
  nearD2 = Infinity;
  for (const pid of world.players) {
    const p = world.ents[pid];
    if (!p || p.zone !== zone.id || p.dead || !(p.hp > 0)) continue;
    const d2 = dist2(m.x, m.z, p.x, p.z);
    if (d2 < nearD2) { nearD2 = d2; best = p; }
  }
  return best;
}

/** Every idle live monster sharing m.pack starts chasing targetId (no event: the caller emits one). */
function alertPack(world, zone, m, targetId) {
  if (m.pack == null) return;
  for (const id of zone.ents) {
    const o = world.ents[id];
    if (!o || o === m || o.kind !== 'monster' || o.pack !== m.pack || o.dead || !(o.hp > 0)) continue;
    if (!o.ai) initMonsterAI(o);
    if (o.ai.state === 'idle') { o.ai.state = 'chase'; o.ai.targetId = targetId; }
  }
}

function interrupt(ai) {
  if (ai.state === 'windup') ai.state = 'chase';
}

function face(m, x, z) {
  if (dnormInto(tmp, x - m.x, z - m.z) > 0) { m.dx = tmp[0]; m.dz = tmp[1]; }
}

function run(zone, m, x, z) {
  moveToward(zone, m, x, z, m.speed * DT);
  m.anim = 'run';
}

/** One step straight away from p (or along the current facing when on top of it). */
function runAway(zone, m, p) {
  const step = m.speed * DT;
  if (dnormInto(tmp, m.x - p.x, m.z - p.z) <= 0) { tmp[0] = m.dx; tmp[1] = m.dz; }
  moveToward(zone, m, m.x + tmp[0] * step, m.z + tmp[1] * step, step);
  m.anim = 'run';
}

/** Keep curve.ranged.keepMin..keepMax metres; draw when in the band and within fireRange. */
function rangedChase(zone, m, p, d, tick) {
  const rg = cv.ranged;
  if (d > rg.keepMax) { run(zone, m, p.x, p.z); return; }
  if (d < rg.keepMin) {
    const x0 = m.x, z0 = m.z;
    runAway(zone, m, p);
    // cornered against a wall: shoot point-blank rather than shuffle forever
    if (m.x === x0 && m.z === z0 && d <= rg.fireRange) startWindup(m, p, tick);
    return;
  }
  if (d <= rg.fireRange) startWindup(m, p, tick);
  else run(zone, m, p.x, p.z);
}

/** Attack starts now: strike at windupUntil, next attack no earlier than attackStart + attackEvery. */
function startWindup(m, p, tick) {
  const ai = m.ai;
  ai.state = 'windup';
  ai.windupUntil = tick + secTicks(cv.windup);
  ai.recoverUntil = tick + secTicks(cv.attackEvery);
  face(m, p.x, p.z);
  m.anim = 'attack';
}

/** The windup landed: melee hits if the target is still within reach + meleeReach, ranged looses an arrow within fireRange. */
function strike(world, zone, m) {
  const p = world.ents[m.ai.targetId];
  if (!p || p.kind !== 'player' || p.zone !== zone.id || p.dead || !(p.hp > 0)) return;
  const d2 = dist2(m.x, m.z, p.x, p.z);
  if (cv.rangedArchetypes.includes(m.arch)) {
    const rg = cv.ranged;
    if (d2 > rg.fireRange * rg.fireRange) return;
    face(m, p.x, p.z);
    spawnProjectile(world, zone, {
      x: m.x + m.dx * m.r, z: m.z + m.dz * m.r, dx: m.dx, dz: m.dz,
      speed: rg.arrowSpeed, dmg: m.dmg, ttl: rg.arrowTtlTicks, src: m.id, level: m.level,
    });
    return;
  }
  const reach = m.r + p.r + cv.meleeReach + cv.meleeReach;
  if (d2 > reach * reach) return;
  face(m, p.x, p.z);
  monsterAttack(world, zone, m, p, zone.streams.combat);
}

/** Walk home. nextThink holds the give-up tick (twice the straight-line time plus a second). */
function startReturn(m, tick) {
  const ai = m.ai;
  const d = dsqrt(dist2(m.x, m.z, ai.anchorX, ai.anchorZ));
  const step = m.speed * DT;
  ai.state = 'return';
  ai.targetId = null;
  ai.nextThink = tick + (step > 0 ? 2 * (Math.floor(d / step) + 1) : 0) + TICK_HZ;
}
