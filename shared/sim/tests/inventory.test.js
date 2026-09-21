import { test } from 'node:test';
import assert from 'node:assert/strict';
import classes from '../../data/classes.js';
import recipes from '../../data/zones/index.js';
import { makeRng } from '../rng.js';
import { generateItem, makePotion } from '../itemgen.js';
import { createWorld, addPlayer } from '../world.js';
import {
  ensureBags, findSlot, place, remove, entryOf, moveItem, equip, unequip,
  toBelt, fromBelt, refillBelt, addItem, dropItem,
} from '../inventory.js';

const STACK = classes.belt.stack;
const rng = makeRng(1);
const gear = (baseId, ilvl = 1, rarity = 'normal') => generateItem(rng, { ilvl, rarity, baseId });
function hero(cls = 'warrior', level = 1) {
  return ensureBags({ id: 'p1', cls, level, x: 0, z: 0, stats: { ...classes.classes[cls].stats }, hp: 1, mp: 1 });
}

test('ensureBags gives empty bags of the table sizes', () => {
  const e = hero();
  assert.deepEqual(e.inventory, { w: classes.inventory.w, h: classes.inventory.h, items: [] });
  assert.equal(e.belt.length, classes.belt.slots);
  assert.ok(e.belt.every((b) => b === null));
  assert.ok(e.equipment.weapon === null && e.equipment.ring2 === null);
  assert.equal(e.invVer, 0);
});

test('addItem refuses an item whose iid is already in the bag instead of destroying it', () => {
  const e = hero();
  const a = generateItem(makeRng(5), { ilvl: 1, rarity: 'normal', baseId: 'sword' });
  const b = generateItem(makeRng(5), { ilvl: 1, rarity: 'normal', baseId: 'sword' });
  assert.equal(a.iid, b.iid, 'same stream, same iid');
  assert.deepEqual(addItem(e, a), { ok: true });
  assert.equal(e.invVer, 1);
  assert.deepEqual(addItem(e, b), { ok: false, why: 'duplicate' });
  assert.equal(e.inventory.items.length, 1);
  assert.equal(e.invVer, 1, 'a refused add bumps nothing');
});

test('findSlot is row-major first fit', () => {
  const e = hero(), inv = e.inventory;
  assert.deepEqual(findSlot(inv, [1, 1]), [0, 0]);
  assert.ok(place(inv, gear('leatherChest'), 0, 0).ok); // 2x3
  assert.deepEqual(findSlot(inv, [1, 1]), [2, 0]);
  assert.deepEqual(findSlot(inv, [inv.w, 1]), [0, 3]);
  assert.deepEqual(findSlot(inv, [2, 3]), [2, 0]);
  assert.equal(findSlot(inv, [inv.w, inv.h]), null);
  assert.equal(findSlot(inv, [inv.w + 1, 1]), null);
});

test('place rejects bounds, overlap and duplicate iids; remove frees the cells', () => {
  const inv = hero().inventory;
  const sword = gear('sword'); // 1x3
  assert.ok(place(inv, sword, 0, 0).ok);
  assert.equal(place(inv, gear('cap'), 0, 2).why, 'blocked');
  assert.equal(place(inv, gear('cap'), inv.w - 1, 0).why, 'blocked');
  assert.equal(place(inv, gear('cap'), -1, 0).why, 'blocked');
  assert.equal(place(inv, sword, 5, 0).why, 'duplicate');
  assert.equal(place(inv, null, 5, 0).why, 'no item');
  assert.ok(place(inv, gear('cap'), 1, 0).ok);
  assert.equal(inv.items.length, 2);
  assert.equal(remove(inv, sword.iid), sword);
  assert.equal(remove(inv, sword.iid), null);
  assert.equal(entryOf(inv, sword.iid), null);
  assert.ok(place(inv, gear('wand'), 0, 0).ok, 'the freed cells accept a new item');
  // potions without an rng share an iid; the second stack gets a suffix
  const a = makePotion('lifeMinor', 1), b = makePotion('lifeMinor', 1);
  assert.ok(place(inv, a, 9, 5).ok);
  assert.ok(place(inv, b, 8, 5).ok);
  assert.notEqual(a.iid, b.iid);
});

test('moveItem: free move, swap with exactly one overlapping item, rejections', () => {
  const e = hero(), inv = e.inventory;
  const sword = gear('sword'), dagger = gear('dagger'); // 1x3, 1x2
  place(inv, sword, 0, 0); place(inv, dagger, 1, 0);
  assert.ok(moveItem(e, sword.iid, 5, 0).ok);
  assert.equal(e.invVer, 1);
  assert.deepEqual([entryOf(inv, sword.iid).x, entryOf(inv, sword.iid).y], [5, 0]);
  assert.ok(moveItem(e, sword.iid, 5, 0).ok, 'no-op move');
  assert.equal(e.invVer, 1);
  const r = moveItem(e, sword.iid, 1, 0);
  assert.ok(r.ok && r.swapped === dagger.iid);
  assert.deepEqual([entryOf(inv, sword.iid).x, entryOf(inv, sword.iid).y], [1, 0]);
  assert.deepEqual([entryOf(inv, dagger.iid).x, entryOf(inv, dagger.iid).y], [5, 0]);
  assert.equal(moveItem(e, sword.iid, 0, 4).why, 'out of bounds');
  assert.equal(moveItem(e, 'nope', 0, 0).why, 'no item');
  // two overlapping items
  const cap = gear('cap'); place(inv, cap, 8, 4); // 2x2 at 8..9,4..5
  const p1 = makePotion('lifeMinor', 1), p2 = makePotion('manaMinor', 1);
  place(inv, p1, 6, 4); place(inv, p2, 6, 5);
  assert.equal(moveItem(e, cap.iid, 6, 4).why, 'blocked');
  // one overlap, but the other item would not fit where I was
  remove(inv, p2.iid);
  const p3 = makePotion('lifeLight', 1);
  place(inv, p3, 7, 5);
  const ver = e.invVer;
  assert.equal(moveItem(e, p1.iid, 8, 4).why, 'blocked', 'the cap cannot sit on the potion at 7,5');
  assert.equal(e.invVer, ver);
  remove(inv, p3.iid);
  assert.ok(moveItem(e, p1.iid, 8, 4).ok, 'with 7,5 free the cap swaps into 6,4');
  assert.deepEqual([entryOf(inv, cap.iid).x, entryOf(inv, cap.iid).y], [6, 4]);
  // the other item would land on my new rect
  const w1 = gear('wand'), w2 = gear('wand'); // 1x2 each
  place(inv, w1, 3, 0); place(inv, w2, 3, 2);
  assert.equal(moveItem(e, w1.iid, 3, 1).why, 'blocked');
});

test('equip and unequip: displaced items go to the bag, ring slots alternate', () => {
  const e = hero(), inv = e.inventory, eq = e.equipment;
  const s1 = gear('sword'), s2 = gear('sword');
  place(inv, s1, 0, 0); place(inv, s2, 1, 0);
  const r = equip(e, s1.iid);
  assert.ok(r.ok && r.slot === 'weapon');
  assert.equal(eq.weapon, s1);
  assert.equal(entryOf(inv, s1.iid), null);
  assert.equal(e.invVer, 1);
  const r2 = equip(e, s2.iid);
  assert.ok(r2.ok);
  assert.deepEqual(r2.displaced, [s1.iid]);
  assert.equal(eq.weapon, s2);
  assert.deepEqual([entryOf(inv, s1.iid).x, entryOf(inv, s1.iid).y], [1, 0], 'the vacated cell first');
  assert.ok(unequip(e, 'weapon').ok);
  assert.equal(eq.weapon, null);
  assert.ok(entryOf(inv, s2.iid));
  assert.equal(unequip(e, 'weapon').why, 'empty slot');
  assert.equal(equip(e, 'nope').why, 'no item');
  // rings: plain 'ring' items fill ring1 then ring2 then replace ring1
  const ring = (n) => ({ iid: 'r' + n, base: 'ring', name: 'Ring', rarity: 'normal', ilvl: 1, tier: 'crude', slot: 'ring', kind: 'ring', size: [1, 1], lvlReq: 1, reqs: { str: 0, dex: 0 }, affixes: [], value: 1 });
  const ra = ring(1), rb = ring(2), rc = ring(3);
  place(inv, ra, 9, 5); place(inv, rb, 8, 5); place(inv, rc, 7, 5);
  assert.equal(equip(e, ra.iid).slot, 'ring1');
  assert.equal(equip(e, rb.iid).slot, 'ring2');
  const r3 = equip(e, rc.iid);
  assert.equal(r3.slot, 'ring1');
  assert.deepEqual(r3.displaced, [ra.iid]);
});

test('a 2H weapon removes the shield to the bag, or fails untouched when the bag is full', () => {
  const e = hero(), inv = e.inventory, eq = e.equipment;
  const shield = gear('shield'), spear = gear('spear', 5), sword = gear('sword');
  e.level = 5;
  place(inv, shield, 0, 0); place(inv, spear, 2, 0); place(inv, sword, 4, 0);
  assert.ok(equip(e, shield.iid).ok);
  assert.ok(equip(e, sword.iid).ok);
  assert.equal(inv.items.length, 1);
  const r = equip(e, spear.iid);
  assert.ok(r.ok);
  assert.equal(eq.weapon, spear);
  assert.equal(eq.shield, null);
  assert.deepEqual(r.displaced.sort(), [shield.iid, sword.iid].sort());
  assert.ok(entryOf(inv, shield.iid) && entryOf(inv, sword.iid));
  // equipping a shield while a 2H weapon is worn displaces the weapon
  assert.ok(equip(e, shield.iid).ok);
  assert.equal(eq.weapon, null);
  assert.equal(eq.shield, shield);
  assert.ok(entryOf(inv, spear.iid));
  // now fill the bag so the second displaced item has nowhere to go
  assert.ok(equip(e, sword.iid).ok);
  while (findSlot(inv, [1, 1])) place(inv, makePotion('manaMinor', 1), ...findSlot(inv, [1, 1]));
  const before = JSON.stringify([inv.items.map((x) => [x.iid, x.x, x.y]), eq.weapon.iid, eq.shield.iid, e.invVer]);
  const fail = equip(e, spear.iid);
  assert.equal(fail.ok, false);
  assert.equal(fail.why, 'bag full');
  assert.equal(JSON.stringify([inv.items.map((x) => [x.iid, x.x, x.y]), eq.weapon.iid, eq.shield.iid, e.invVer]), before, 'rolled back');
  // unequip into a full bag fails too
  remove(inv, spear.iid);
  while (findSlot(inv, [1, 1])) place(inv, makePotion('manaMinor', 1), ...findSlot(inv, [1, 1]));
  assert.equal(unequip(e, 'shield').why, 'bag full');
  assert.equal(eq.shield, shield);
});

test('canEquip through equip: level, requirements, class weapon kinds, potions', () => {
  const e = hero(), inv = e.inventory;
  const high = gear('sword', 20); // tempered: lvlReq 13
  const bow = gear('bow', 1), wand = gear('wand'), pot = makePotion('lifeMinor', 1);
  place(inv, high, 0, 0); place(inv, bow, 1, 0); place(inv, wand, 3, 0); place(inv, pot, 9, 5);
  assert.equal(equip(e, high.iid).why, 'needs level ' + high.lvlReq);
  e.level = 5;
  assert.equal(equip(e, bow.iid).why, 'needs ' + bow.reqs.dex + ' dexterity');
  e.stats.dex = 40;
  assert.ok(/cannot use bow/.test(equip(e, bow.iid).why));
  assert.ok(/cannot use wand/.test(equip(e, wand.iid).why));
  assert.equal(equip(e, pot.iid).why, 'not equippable');
  assert.equal(inv.items.length, 4);
  assert.equal(e.invVer, 0);
  const wiz = hero('wizard', 5);
  place(wiz.inventory, gear('wand'), 0, 0);
  assert.ok(equip(wiz, wiz.inventory.items[0].iid).ok);
});

test('addItem: potions fill the belt first, merge, then stack in the bag', () => {
  const e = hero(), inv = e.inventory;
  assert.ok(addItem(e, makePotion('lifeMinor', 3)).ok);
  assert.deepEqual(e.belt, [{ potionId: 'lifeMinor', count: 3 }, null, null, null]);
  assert.equal(inv.items.length, 0);
  assert.ok(addItem(e, makePotion('lifeMinor', 12)).ok);
  assert.deepEqual(e.belt.slice(0, 2), [{ potionId: 'lifeMinor', count: STACK }, { potionId: 'lifeMinor', count: 15 - STACK }]);
  assert.ok(addItem(e, makePotion('manaMinor', 25)).ok);
  assert.deepEqual(e.belt.slice(2), [{ potionId: 'manaMinor', count: STACK }, { potionId: 'manaMinor', count: STACK }]);
  assert.equal(inv.items.length, 1);
  assert.equal(inv.items[0].item.stack, 25 - 2 * STACK);
  assert.ok(addItem(e, makePotion('manaMinor', 3)).ok);
  assert.equal(inv.items.length, 1, 'merged into the bag stack');
  assert.equal(inv.items[0].item.stack, 25 - 2 * STACK + 3);
  const ver = e.invVer;
  assert.ok(addItem(e, gear('cap')).ok);
  assert.equal(e.invVer, ver + 1);
  // fill everything, then a partial add reports what is left
  while (findSlot(inv, [1, 1])) addItem(e, makePotion('lifeLight', STACK));
  const big = makePotion('lifeMinor', 7);
  const r = addItem(e, big);
  assert.equal(r.ok, false);
  assert.equal(r.why, 'bag full');
  assert.ok(r.left > 0 && r.left === big.stack);
  assert.equal(addItem(e, gear('cap')).why, 'bag full');
});

test('belt: toBelt merges and swaps, fromBelt returns to the bag, refillBelt pulls stacks', () => {
  const e = hero(), inv = e.inventory;
  const life = makePotion('lifeMinor', 4);
  place(inv, life, 0, 0);
  e.belt[0] = { potionId: 'lifeMinor', count: STACK - 2 };
  assert.ok(toBelt(e, life.iid, 0).ok);
  assert.equal(e.belt[0].count, STACK);
  assert.equal(entryOf(inv, life.iid).item.stack, 2);
  assert.equal(toBelt(e, life.iid, 0).why, 'belt slot full');
  assert.ok(toBelt(e, life.iid, 3).ok);
  assert.deepEqual(e.belt[3], { potionId: 'lifeMinor', count: 2 });
  assert.equal(entryOf(inv, life.iid), null);
  assert.equal(toBelt(e, life.iid, 1).why, 'no item');
  assert.equal(toBelt(e, 'x', 9).why, 'bad slot');
  const sword = gear('sword'); place(inv, sword, 5, 0);
  assert.equal(toBelt(e, sword.iid, 1).why, 'not a potion');
  // swap a different potion into an occupied slot
  const mana = makePotion('manaMinor', 4);
  place(inv, mana, 2, 2);
  assert.ok(toBelt(e, mana.iid, 0).ok);
  assert.deepEqual(e.belt[0], { potionId: 'manaMinor', count: 4 });
  const back = inv.items.find((x) => x.item.base === 'lifeMinor');
  assert.ok(back && back.x === 2 && back.y === 2 && back.item.stack === STACK, 'the old belt stack sits where the new one was');
  // fromBelt merges into that stack? it is full, so a new stack appears
  assert.ok(fromBelt(e, 3).ok);
  assert.equal(e.belt[3], null);
  const stacks = inv.items.filter((x) => x.item.base === 'lifeMinor');
  assert.equal(stacks.length, 2);
  assert.equal(fromBelt(e, 3).why, 'empty slot');
  // refill: matching non-full slot first, then empty slots from any potion stack
  const f = hero(), finv = f.inventory;
  f.belt[0] = { potionId: 'lifeMinor', count: 2 };
  place(finv, makePotion('lifeMinor', 5), 0, 0);
  place(finv, makePotion('manaMinor', 3), 1, 0);
  const r = refillBelt(f);
  assert.deepEqual(r, { ok: true, moved: 8 });
  assert.deepEqual(f.belt, [{ potionId: 'lifeMinor', count: 7 }, { potionId: 'manaMinor', count: 3 }, null, null]);
  assert.equal(finv.items.length, 0);
  assert.equal(f.invVer, 1);
  assert.deepEqual(refillBelt(f), { ok: true, moved: 0 });
  assert.equal(f.invVer, 1);
});

test('dropItem puts the item on the ground at the player and bumps invVer', () => {
  const w = createWorld({ recipes, seed: 42 });
  const pid = addPlayer(w, { name: 'T', cls: 'warrior', level: 1 });
  const e = ensureBags(w.ents[pid]);
  const zone = w.zones[e.zone];
  const sword = gear('sword');
  assert.ok(addItem(e, sword).ok);
  w.events = [];
  const r = dropItem(w, zone, e, sword.iid);
  assert.ok(r.ok && /^g\d+$/.test(r.id));
  const g = w.ents[r.id];
  assert.equal(g.kind, 'item');
  assert.equal(g.item, sword);
  assert.ok(Math.abs(g.x - e.x) <= 1.5 && Math.abs(g.z - e.z) <= 1.5);
  assert.equal(e.inventory.items.length, 0);
  assert.equal(e.invVer, 2);
  assert.ok(w.events.some((ev) => ev.k === 'drop' && ev.id === r.id && ev.rarity === 'normal'));
  assert.equal(dropItem(w, zone, e, sword.iid).why, 'no item');
});
