// shared/sim/inventory.js — grid, equipment and belt operations on a player entity.
// Pure grid ops on `e.inventory = {w, h, items:[{iid, x, y, item}]}`. Every call that takes
// the entity bumps `e.invVer` when it changes something and returns {ok, why?}. The bare
// `findSlot / place / remove / addToBag` work on an inventory object and do not bump.
import classes from '../data/classes.js';
import items from '../data/items.js';
import { canEquip, equipSlotOf } from './stats.js';
import { makePotion } from './itemgen.js';
import { dropAt } from './ground.js';
import { hashFloat, hashString } from './rng.js';

const STACK = classes.belt.stack;
const bump = (e) => { e.invVer = (e.invVer | 0) + 1; };
const isPotion = (item) => !!item && item.slot === 'potion';

/** Give a player entity empty bags when it has none (P0 entities, fresh characters). */
export function ensureBags(e) {
  if (!e.inventory) e.inventory = { w: classes.inventory.w, h: classes.inventory.h, items: [] };
  if (!e.equipment) e.equipment = {};
  for (const s of items.slots) if (!(s in e.equipment)) e.equipment[s] = null;
  if (!e.belt) e.belt = new Array(classes.belt.slots).fill(null);
  if (e.invVer == null) e.invVer = 0;
  return e;
}

const overlaps = (x, y, w, h, r) => x < r.x + r.item.size[0] && r.x < x + w && y < r.y + r.item.size[1] && r.y < y + h;

/** True when a w×h rect at (x,y) is inside the grid and touches no item except those in `ignore`. */
function fits(inv, size, x, y, ignore = null) {
  const [w, h] = size;
  if (x < 0 || y < 0 || x + w > inv.w || y + h > inv.h) return false;
  for (const r of inv.items) {
    if (ignore && ignore.includes(r.iid)) continue;
    if (overlaps(x, y, w, h, r)) return false;
  }
  return true;
}

/** Row-major first fit for a [w,h] item → [x,y] | null. */
export function findSlot(inv, size) {
  for (let y = 0; y + size[1] <= inv.h; y++) {
    for (let x = 0; x + size[0] <= inv.w; x++) if (fits(inv, size, x, y)) return [x, y];
  }
  return null;
}

export function entryOf(inv, iid) {
  for (const r of inv.items) if (r.iid === iid) return r;
  return null;
}

/** Put an item at a cell. Rejects overlap, bounds and duplicate iids (potion iids get a suffix). */
export function place(inv, item, x, y) {
  if (!item) return { ok: false, why: 'no item' };
  if (!fits(inv, item.size, x, y)) return { ok: false, why: 'blocked' };
  if (entryOf(inv, item.iid)) {
    if (!isPotion(item)) return { ok: false, why: 'duplicate' };
    let n = 2;
    while (entryOf(inv, item.iid + '.' + n)) n++;
    item.iid = item.iid + '.' + n;
  }
  inv.items.push({ iid: item.iid, x, y, item });
  return { ok: true };
}

/** Take an item out of the grid → item | null. */
export function remove(inv, iid) {
  for (let i = 0; i < inv.items.length; i++) {
    if (inv.items[i].iid === iid) return inv.items.splice(i, 1)[0].item;
  }
  return null;
}

/** Merge a potion into same-kind stacks, then place the rest first-fit. → {ok, why?, left}. */
function addToBag(inv, item) {
  if (isPotion(item)) {
    for (const r of inv.items) {
      if (item.stack <= 0) break;
      if (!isPotion(r.item) || r.item.base !== item.base || r.item.stack >= STACK) continue;
      const n = Math.min(STACK - r.item.stack, item.stack);
      r.item.stack += n; item.stack -= n;
    }
    if (item.stack <= 0) return { ok: true, left: 0 };
  }
  const pos = findSlot(inv, item.size);
  if (!pos) return { ok: false, why: 'bag full', left: isPotion(item) ? item.stack : 1 };
  const r = place(inv, item, pos[0], pos[1]);
  if (!r.ok) return { ok: false, why: r.why, left: isPotion(item) ? item.stack : 1 };
  return { ok: true, left: 0 };
}

/** Move an inventory item to a cell; swaps with exactly one overlapping item when both fit. */
export function moveItem(e, iid, x, y) {
  ensureBags(e);
  const inv = e.inventory;
  const me = entryOf(inv, iid);
  if (!me) return { ok: false, why: 'no item' };
  const [w, h] = me.item.size;
  if (x < 0 || y < 0 || x + w > inv.w || y + h > inv.h) return { ok: false, why: 'out of bounds' };
  const others = inv.items.filter((r) => r !== me && overlaps(x, y, w, h, r));
  if (others.length === 0) {
    if (me.x === x && me.y === y) return { ok: true };
    me.x = x; me.y = y; bump(e);
    return { ok: true };
  }
  if (others.length > 1) return { ok: false, why: 'blocked' };
  const o = others[0];
  const [ow, oh] = o.item.size;
  // the other item goes where I was; it must not touch my new rect or anything else
  if (!fits(inv, o.item.size, me.x, me.y, [me.iid, o.iid])) return { ok: false, why: 'blocked' };
  if (me.x < x + w && x < me.x + ow && me.y < y + h && y < me.y + oh) return { ok: false, why: 'blocked' };
  o.x = me.x; o.y = me.y; me.x = x; me.y = y; bump(e);
  return { ok: true, swapped: o.iid };
}

function ringSlotFor(eq, item) {
  const s = equipSlotOf(item);
  if (s !== 'ring1' && s !== 'ring2') return s;
  if (item.slot === 'ring1' || item.slot === 'ring2') return item.slot;
  return !eq.ring1 ? 'ring1' : !eq.ring2 ? 'ring2' : 'ring1';
}

/** Equip an inventory item. Displaced items go to the bag (the vacated cell first) or the op fails. */
export function equip(e, iid) {
  ensureBags(e);
  const inv = e.inventory, eq = e.equipment;
  const me = entryOf(inv, iid);
  if (!me) return { ok: false, why: 'no item' };
  const item = me.item;
  const c = canEquip(e, item);
  if (!c.ok) return c;
  const slot = ringSlotFor(eq, item);
  const displaced = [];
  if (eq[slot]) displaced.push([slot, eq[slot]]);
  if (slot === 'weapon' && item.hands === 2 && eq.shield) displaced.push(['shield', eq.shield]);
  if (slot === 'shield' && eq.weapon && eq.weapon.hands === 2) displaced.push(['weapon', eq.weapon]);
  const ox = me.x, oy = me.y, idx = inv.items.indexOf(me);
  remove(inv, iid);
  const placed = [];
  for (const [s, it] of displaced) {
    const pos = fits(inv, it.size, ox, oy) ? [ox, oy] : findSlot(inv, it.size);
    if (!pos) {
      for (const [ps, pit] of placed) { remove(inv, pit.iid); eq[ps] = pit; }
      inv.items.splice(idx, 0, me);
      return { ok: false, why: 'bag full' };
    }
    place(inv, it, pos[0], pos[1]);
    eq[s] = null;
    placed.push([s, it]);
  }
  eq[slot] = item;
  bump(e);
  return { ok: true, slot, displaced: placed.map((p) => p[1].iid) };
}

/** Move an equipped item back to the bag. */
export function unequip(e, slot) {
  ensureBags(e);
  const eq = e.equipment;
  const it = eq[slot];
  if (!it) return { ok: false, why: 'empty slot' };
  const pos = findSlot(e.inventory, it.size);
  if (!pos) return { ok: false, why: 'bag full' };
  place(e.inventory, it, pos[0], pos[1]);
  eq[slot] = null;
  bump(e);
  return { ok: true };
}

/** Put an inventory potion stack into a belt slot: fill an empty slot, merge a matching one, swap a different one. */
export function toBelt(e, iid, slot) {
  ensureBags(e);
  if (!Number.isInteger(slot) || slot < 0 || slot >= e.belt.length) return { ok: false, why: 'bad slot' };
  const inv = e.inventory;
  const me = entryOf(inv, iid);
  if (!me) return { ok: false, why: 'no item' };
  const item = me.item;
  if (!isPotion(item)) return { ok: false, why: 'not a potion' };
  const b = e.belt[slot];
  if (!b) {
    const n = Math.min(item.stack, STACK);
    e.belt[slot] = { potionId: item.base, count: n };
    item.stack -= n;
  } else if (b.potionId === item.base) {
    const room = STACK - b.count;
    if (room <= 0) return { ok: false, why: 'belt slot full' };
    const n = Math.min(room, item.stack);
    b.count += n; item.stack -= n;
  } else {
    if (item.stack > STACK) return { ok: false, why: 'stack too big' };
    remove(inv, iid);
    place(inv, makePotion(b.potionId, b.count), me.x, me.y);
    e.belt[slot] = { potionId: item.base, count: item.stack };
    item.stack = 0;
    bump(e);
    return { ok: true };
  }
  if (item.stack <= 0) remove(inv, iid);
  bump(e);
  return { ok: true };
}

/** Move a belt slot's potions to the bag (merging into stacks first). */
export function fromBelt(e, slot) {
  ensureBags(e);
  const b = e.belt[slot];
  if (!b) return { ok: false, why: 'empty slot' };
  const it = makePotion(b.potionId, b.count);
  const r = addToBag(e.inventory, it);
  if (r.left === b.count) return { ok: false, why: 'bag full' };
  if (r.left > 0) { b.count = r.left; bump(e); return { ok: false, why: 'bag full' }; }
  e.belt[slot] = null;
  bump(e);
  return { ok: true };
}

/** Pull matching potions from the bag into non-full belt slots, then any potions into empty slots. */
export function refillBelt(e) {
  ensureBags(e);
  const inv = e.inventory;
  let moved = 0;
  const pull = (b) => {
    for (let i = 0; i < inv.items.length && b.count < STACK; i++) {
      const r = inv.items[i];
      if (!isPotion(r.item) || r.item.base !== b.potionId) continue;
      const n = Math.min(STACK - b.count, r.item.stack);
      b.count += n; r.item.stack -= n; moved += n;
      if (r.item.stack <= 0) { inv.items.splice(i, 1); i--; }
    }
  };
  for (const b of e.belt) if (b && b.count < STACK) pull(b);
  for (let s = 0; s < e.belt.length; s++) {
    if (e.belt[s]) continue;
    const r = inv.items.find((x) => isPotion(x.item));
    if (!r) break;
    e.belt[s] = { potionId: r.item.base, count: 0 };
    pull(e.belt[s]);
  }
  if (moved > 0) bump(e);
  return { ok: true, moved };
}

/** Add a picked-up or bought item: potions try the belt first, then the bag; other items first-fit. */
export function addItem(e, item) {
  ensureBags(e);
  if (!item) return { ok: false, why: 'no item' };
  if (!isPotion(item)) {
    const r = addToBag(e.inventory, item);
    if (r.ok) bump(e);
    return r.ok ? { ok: true } : { ok: false, why: r.why };
  }
  const before = item.stack;
  for (const b of e.belt) {
    if (item.stack <= 0) break;
    if (!b || b.potionId !== item.base || b.count >= STACK) continue;
    const n = Math.min(STACK - b.count, item.stack);
    b.count += n; item.stack -= n;
  }
  for (let s = 0; s < e.belt.length && item.stack > 0; s++) {
    if (e.belt[s]) continue;
    const n = Math.min(STACK, item.stack);
    e.belt[s] = { potionId: item.base, count: n };
    item.stack -= n;
  }
  // what the belt did not take merges into bag stacks or becomes a new stack (the item itself)
  let left = item.stack;
  if (left > 0) { const r = addToBag(e.inventory, item); left = r.ok ? 0 : r.left; }
  if (left < before) bump(e);
  return left <= 0 ? { ok: true } : { ok: false, why: 'bag full', left };
}

/**
 * Drop an inventory item on the ground at the player. The scatter comes from a stateless hash
 * of (world.seed, iid, tick), never from zone.streams.loot: a player act must not advance a
 * stream the server owns (a predicting client may run this).
 */
export function dropItem(world, zone, e, iid) {
  ensureBags(e);
  const item = remove(e.inventory, iid);
  if (!item) return { ok: false, why: 'no item' };
  bump(e);
  const h = hashString(String(iid));
  let k = 0;
  const rng = { between: (lo, hi) => lo + hashFloat(world.seed, h, world.tick, k++) * (hi - lo) };
  const ids = dropAt(world, zone, e.x, e.z, [{ item }], null, rng);
  return { ok: true, id: ids[0] };
}
