import { test } from 'node:test';
import assert from 'node:assert/strict';
import classes from '../../data/classes.js';
import items from '../../data/items.js';
import recipes from '../../data/zones/index.js';
import { createWorld, addPlayer, step } from '../world.js';
import { makeRng } from '../rng.js';
import { walkableAt } from '../zonegen.js';
import { generateItem, makePotion } from '../itemgen.js';
import { ensureBags, findSlot, addItem } from '../inventory.js';
import { dropAt, tryPickup, autoPickup } from '../ground.js';

const SCATTER = items.ground.scatterRadius;
const GR = items.ground.r;
const rng = makeRng(4);
const gear = (baseId) => generateItem(rng, { ilvl: 1, rarity: 'normal', baseId });

function setup(seed = 42) {
  const w = createWorld({ recipes, seed });
  const pid = addPlayer(w, { name: 'T', cls: 'warrior', level: 1 });
  const e = ensureBags(w.ents[pid]);
  e.gold = 0;
  w.events = [];
  return { w, e, zone: w.zones[e.zone] };
}
const d2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z);

test('dropAt scatters gold, gear and potions onto walkable cells near the point', () => {
  const { w, e, zone } = setup();
  const sword = gear('sword'), pot = makePotion('lifeMinor', 2, rng);
  const ids = dropAt(w, zone, e.x, e.z, [{ gold: 17 }, { item: sword }, { item: pot }, { gold: 0 }, null]);
  assert.equal(ids.length, 3);
  for (const id of ids) {
    assert.ok(/^g\d+$/.test(id), id);
    const g = w.ents[id];
    assert.equal(g.kind, 'item');
    assert.equal(g.zone, zone.id);
    assert.equal(g.r, GR);
    assert.equal(g.owner, null);
    assert.ok(!('hp' in g) && !('anim' in g) && !('speed' in g));
    assert.ok(walkableAt(zone.layout, g.x, g.z), 'on walkable ground');
    assert.ok(d2(g, e) <= SCATTER * SCATTER + 1e-9, 'within the scatter radius');
    assert.ok(zone.ents.has(id));
  }
  const [gg, gi, gp] = ids.map((id) => w.ents[id]);
  assert.deepEqual([gg.gold, gg.item], [17, null]);
  assert.deepEqual([gi.gold, gi.item], [0, sword]);
  assert.equal(gp.item, pot);
  const drops = w.events.filter((ev) => ev.k === 'drop');
  assert.deepEqual(drops.map((ev) => [ev.id, ev.rarity]), [[ids[0], 'gold'], [ids[1], 'normal'], [ids[2], 'normal']]);
  for (const ev of drops) assert.deepEqual([ev.x, ev.z], [w.ents[ev.id].x, w.ents[ev.id].z]);
  // step() reports them in full on their first tick — except gold or a potion that landed
  // within autoPickupRange of the player, which that same step auto-picks (P1) and lists in gone
  const near = ids.map((id) => d2(w.ents[id], e) <= classes.autoPickupRange * classes.autoPickupRange);
  const r = step(w);
  assert.equal(r.delta[ids[1]].kind, 'item', 'gear stays on the ground');
  for (let i = 0; i < ids.length; i++) {
    if (i !== 1 && near[i]) assert.ok(r.gone.includes(ids[i]), ids[i] + ' auto-picked');
    else assert.equal(r.delta[ids[i]].kind, 'item');
  }
  assert.equal(e.gold, near[0] ? 17 : 0);
  assert.equal(dropAt(w, zone, e.x, e.z, [{ item: gear('cap') }], 'p9')[0] && w.ents['g' + (w.nextId - 1)].owner, 'p9');
});

test('autoPickup takes gold and potions in range, leaves gear, and reports the count', () => {
  const { w, e, zone } = setup();
  const sword = gear('sword');
  const ids = dropAt(w, zone, e.x, e.z, [{ gold: 25 }, { item: sword }, { item: makePotion('manaMinor', 3, rng) }]);
  // pull everything onto the player so range is not a question
  for (const id of ids) { w.ents[id].x = e.x; w.ents[id].z = e.z; }
  w.events = [];
  assert.equal(autoPickup(w, zone, e), 2);
  assert.equal(e.gold, 25);
  assert.deepEqual(e.belt[0], { potionId: 'manaMinor', count: 3 });
  assert.ok(w.ents[ids[1]], 'gear stays on the ground');
  assert.ok(!w.ents[ids[0]] && !w.ents[ids[2]]);
  assert.ok(!zone.ents.has(ids[0]) && !zone.ents.has(ids[2]));
  assert.deepEqual(w.events.map((ev) => ev.k).sort(), ['gold', 'pickup']);
  assert.equal(w.events.find((ev) => ev.k === 'gold').amount, 25);
  assert.equal(autoPickup(w, zone, e), 0);
  const gone = step(w).gone;
  assert.ok(gone.includes(ids[0]) && gone.includes(ids[2]));
  // out of range: nothing happens
  const far = dropAt(w, zone, e.x, e.z, [{ gold: 5 }])[0];
  w.ents[far].x = e.x + classes.autoPickupRange + 0.5; w.ents[far].z = e.z;
  assert.equal(autoPickup(w, zone, e), 0);
  assert.equal(e.gold, 25);
  // dead players pick nothing up
  w.ents[far].x = e.x;
  e.dead = 1;
  assert.equal(autoPickup(w, zone, e), 0);
});

test('tryPickup: range, ownership, unknown ids, gear into the bag', () => {
  const { w, e, zone } = setup();
  const sword = gear('sword');
  const [id] = dropAt(w, zone, e.x, e.z, [{ item: sword }]);
  w.ents[id].x = e.x + classes.pickupRange + 0.1; w.ents[id].z = e.z;
  assert.deepEqual(tryPickup(w, zone, e, id), { ok: false, why: 'too far' });
  w.ents[id].x = e.x + classes.pickupRange - 0.1;
  w.ents[id].owner = 'p99';
  assert.deepEqual(tryPickup(w, zone, e, id), { ok: false, why: 'not yours' });
  w.ents[id].owner = e.id;
  w.events = [];
  assert.deepEqual(tryPickup(w, zone, e, id), { ok: true });
  assert.equal(w.ents[id], undefined);
  assert.equal(e.inventory.items[0].item, sword);
  assert.equal(e.invVer, 1);
  assert.deepEqual(w.events, [{ k: 'pickup', pid: e.id, id, rarity: 'normal', name: sword.name, base: 'sword', stack: 1 }]);
  assert.deepEqual(tryPickup(w, zone, e, id), { ok: false, why: 'no item' });
  assert.deepEqual(tryPickup(w, zone, e, e.id), { ok: false, why: 'no item' });
});

test('a full bag leaves the item on the ground with a full event; autoPickup stays quiet', () => {
  const { w, e, zone } = setup();
  while (findSlot(e.inventory, [1, 1])) addItem(e, makePotion('lifeLight', classes.belt.stack));
  const cap = gear('cap');
  const [id] = dropAt(w, zone, e.x, e.z, [{ item: cap }, { item: makePotion('manaMinor', 1, rng) }]);
  for (const gid of zone.ents) if (w.ents[gid].kind === 'item') { w.ents[gid].x = e.x; w.ents[gid].z = e.z; }
  w.events = [];
  assert.deepEqual(tryPickup(w, zone, e, id), { ok: false, why: 'bag full' });
  assert.ok(w.ents[id]);
  assert.deepEqual(w.events, [{ k: 'full', pid: e.id }]);
  // a stack that only partly fits reports how many were taken; the rest stays on the ground
  e.inventory.items.length = 0; e.belt.fill(null); e.invVer++;
  addItem(e, makePotion('manaMinor', classes.belt.stack - 2)); // belt slot 0 has room for 2
  while (findSlot(e.inventory, [1, 1])) addItem(e, makePotion('lifeLight', classes.belt.stack));
  const [pid] = dropAt(w, zone, e.x, e.z, [{ item: makePotion('manaMinor', 5, rng) }]);
  w.ents[pid].x = e.x; w.ents[pid].z = e.z;
  w.events = [];
  assert.deepEqual(tryPickup(w, zone, e, pid), { ok: false, why: 'bag full' });
  assert.equal(w.ents[pid].item.stack, 3);
  assert.deepEqual(w.events.map((ev) => ev.k), ['pickup', 'full']);
  assert.deepEqual([w.events[0].base, w.events[0].stack, w.events[0].name], ['manaMinor', 2, items.potions.manaMinor.name]);
  w.events = [];
  assert.equal(autoPickup(w, zone, e), 0);
  assert.deepEqual(w.events, []);
});

test('gold pickup honours the cap and leaves the rest on the ground', () => {
  const { w, e, zone } = setup();
  e.gold = classes.goldCap - 5;
  const [id] = dropAt(w, zone, e.x, e.z, [{ gold: 20 }]);
  w.ents[id].x = e.x; w.ents[id].z = e.z;
  w.events = [];
  assert.deepEqual(tryPickup(w, zone, e, id), { ok: true, gold: 5 });
  assert.equal(e.gold, classes.goldCap);
  assert.equal(w.ents[id].gold, 15);
  assert.deepEqual(w.events, [{ k: 'gold', pid: e.id, amount: 5 }]);
  assert.deepEqual(tryPickup(w, zone, e, id), { ok: false, why: 'gold cap' });
  assert.equal(autoPickup(w, zone, e), 0);
});

test('drops are deterministic: same seed, same scatter, same ids', () => {
  const a = setup(7), b = setup(7);
  const ra = makeRng(3), rb = makeRng(3);
  for (let i = 0; i < 20; i++) {
    const da = [{ gold: 10 + i }, { item: generateItem(ra, { ilvl: 4 }) }];
    const db = [{ gold: 10 + i }, { item: generateItem(rb, { ilvl: 4 }) }];
    assert.deepEqual(dropAt(a.w, a.zone, a.e.x + i, a.e.z, da), dropAt(b.w, b.zone, b.e.x + i, b.e.z, db));
  }
  const rows = (w) => Object.values(w.ents).filter((x) => x.kind === 'item').map((x) => JSON.stringify(x)).join('\n');
  assert.equal(rows(a.w), rows(b.w));
  assert.equal(JSON.stringify(a.w.events), JSON.stringify(b.w.events));
});
