// shared/sim/projectiles.js — arrows and other flying things: spawn, move, hit, expire.
// Entities are kind 'proj' (id 'q<n>'); only players are targets in P1. Damage goes through
// combat.monsterAttack with the arrow's own numbers (dmg, level, el) so block, armour DR and
// resists apply exactly as for a melee hit. The hit event names the shooter (spec.src) as
// `src` so the client can attribute it; the arrow id is the fallback when there is none.
import monsters from '../data/monsters.js';
import { dist2, dnormInto } from './dmath.js';
import { walkableAt } from './zonegen.js';
import { monsterAttack } from './combat.js';
import { DT, removeEnt } from './world.js';

const rg = monsters.curve.ranged;

const tmp = [0, 0];

/**
 * Add a projectile to the zone. spec: {x, z, dx, dz, dmg:[min,max]|n, src?, speed?, ttl?,
 * r?, el?, level?}; speed/ttl/r default to monsters.curve.ranged (arrowSpeed, arrowTtlTicks)
 * (arrowSpeed, arrowTtlTicks, arrowR); (dx,dz) is normalised. Event `proj {id}`. @returns the new id
 */
export function spawnProjectile(world, zone, spec) {
  const id = 'q' + world.nextId++;
  dnormInto(tmp, +spec.dx || 0, +spec.dz || 0);
  const dmg = spec.dmg;
  const q = {
    id, kind: 'proj', zone: zone.id, x: +spec.x || 0, z: +spec.z || 0, dx: tmp[0], dz: tmp[1],
    speed: spec.speed != null ? +spec.speed : rg.arrowSpeed,
    dmg: Array.isArray(dmg) ? [+dmg[0] || 0, +dmg[1] || 0] : [+dmg || 0, +dmg || 0],
    el: spec.el || 'phys',
    src: spec.src || null,
    ttl: spec.ttl != null ? Math.floor(spec.ttl) : rg.arrowTtlTicks,
    r: spec.r != null ? +spec.r : rg.arrowR,
    level: spec.level > 1 ? spec.level : 1,
  };
  world.ents[id] = q;
  zone.ents.add(id);
  world.events.push({ k: 'proj', id });
  return id;
}

/**
 * Move every projectile speed·DT along its direction. It is removed when its cell is not
 * walkable (walls stop arrows), when it touches the nearest live player within r + p.r
 * (monsterAttack with its dmg/level/el, event `hit`), or when its ttl runs out.
 */
export function stepProjectiles(world, zone) {
  for (const id of zone.ents) {
    const q = world.ents[id];
    if (!q || q.kind !== 'proj') continue;
    const s = q.speed * DT;
    q.x += q.dx * s;
    q.z += q.dz * s;
    if (!walkableAt(zone.layout, q.x, q.z)) { removeEnt(world, id); continue; }
    const p = playerHit(world, zone, q);
    if (p) {
      monsterAttack(world, zone, { id: q.src || q.id, dmg: q.dmg, level: q.level }, p, zone.streams.combat, { el: q.el });
      removeEnt(world, id);
      continue;
    }
    if (--q.ttl <= 0) removeEnt(world, id);
  }
}

/** Nearest live player in this zone within q.r + p.r of the projectile, or null. */
function playerHit(world, zone, q) {
  let best = null, bd = Infinity;
  for (const pid of world.players) {
    const p = world.ents[pid];
    if (!p || p.zone !== zone.id || p.dead || !(p.hp > 0)) continue;
    const reach = q.r + (p.r || 0);
    const d2 = dist2(q.x, q.z, p.x, p.z);
    if (d2 <= reach * reach && d2 < bd) { bd = d2; best = p; }
  }
  return best;
}
