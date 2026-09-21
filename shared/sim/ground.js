// shared/sim/ground.js — items and gold lying in a zone: drop, pick up, auto-pickup.
// Ground entities are `kind:'item'`, id 'g<n>', r from items.ground, no hp/anim/speed.
import classes from '../data/classes.js';
import items from '../data/items.js';
import { walkableAt } from './zonegen.js';
import { dist2 } from './dmath.js';
import { addItem } from './inventory.js';
import { removeEnt } from './world.js';

const GROUND = items.ground;

/**
 * Scatter `[{item}|{gold:n}]` around (x,z) onto walkable cells within scatterRadius using
 * `rng.between` — the zone's loot stream by default (monster drops); inventory.dropItem passes
 * a stateless hash so a player's own drop never advances the stream. Event `drop {id,
 * rarity|'gold', x, z}` per entity. → ids.
 */
export function dropAt(world, zone, x, z, drops, owner = null, rng = zone.streams.loot) {
  const ids = [];
  const L = zone.layout;
  const R = GROUND.scatterRadius;
  for (const d of drops) {
    if (!d || (!d.item && !(d.gold > 0))) continue;
    let px = x, pz = z;
    for (let t = 0; t < GROUND.scatterTries; t++) {
      const ox = rng.between(-R, R), oz = rng.between(-R, R);
      if (ox * ox + oz * oz > R * R) continue;
      if (walkableAt(L, x + ox, z + oz)) { px = x + ox; pz = z + oz; break; }
    }
    const id = 'g' + world.nextId++;
    const g = {
      id, kind: 'item', zone: zone.id, x: px, z: pz, r: GROUND.r,
      item: d.item || null, gold: d.item ? 0 : Math.floor(d.gold), owner,
    };
    world.ents[id] = g;
    zone.ents.add(id);
    world.events.push({ k: 'drop', id, rarity: g.item ? g.item.rarity : 'gold', x: px, z: pz });
    ids.push(id);
  }
  return ids;
}

function pickup(world, zone, e, id, range, quiet) {
  const g = world.ents[id];
  if (!g || g.kind !== 'item' || g.zone !== zone.id) return { ok: false, why: 'no item' };
  if (g.owner && g.owner !== e.id) return { ok: false, why: 'not yours' };
  if (dist2(e.x, e.z, g.x, g.z) > range * range) return { ok: false, why: 'too far' };
  if (!g.item) {
    const before = e.gold || 0;
    const taken = Math.min(g.gold, classes.goldCap - before);
    if (taken <= 0) return { ok: false, why: 'gold cap' };
    e.gold = before + taken;
    g.gold -= taken;
    if (g.gold <= 0) removeEnt(world, id);
    world.events.push({ k: 'gold', pid: e.id, amount: taken });
    return { ok: true, gold: taken };
  }
  const it = g.item;
  const stackBefore = it.stack || 1;
  const r = addItem(e, it);
  // the event names the item (the ground entity is in the same step's `gone`) and how many were taken
  if (r.ok) {
    removeEnt(world, id);
    world.events.push({ k: 'pickup', pid: e.id, id, rarity: it.rarity, name: it.name, base: it.base, stack: stackBefore });
    return { ok: true };
  }
  const took = it.stack != null ? stackBefore - it.stack : 0;
  if (took > 0) world.events.push({ k: 'pickup', pid: e.id, id, rarity: it.rarity, name: it.name, base: it.base, stack: took });
  if (!quiet) world.events.push({ k: 'full', pid: e.id });
  return { ok: false, why: r.why || 'bag full' };
}

/** Pick up ground entity `id` if within classes.pickupRange. Gold → e.gold (capped), items → addItem. */
export function tryPickup(world, zone, e, id) {
  return pickup(world, zone, e, id, classes.pickupRange, false);
}

/** Gold and potions within classes.autoPickupRange jump into the player. → count picked up. */
export function autoPickup(world, zone, e) {
  if (e.dead) return 0;
  const R = classes.autoPickupRange;
  let n = 0;
  for (const id of zone.ents) {
    const g = world.ents[id];
    if (!g || g.kind !== 'item') continue;
    if (g.item ? g.item.slot !== 'potion' : !(g.gold > 0)) continue;
    if (dist2(e.x, e.z, g.x, g.z) > R * R) continue;
    if (pickup(world, zone, e, id, R, true).ok) n++;
  }
  return n;
}
