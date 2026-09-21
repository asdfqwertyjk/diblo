import { test } from 'node:test';
import assert from 'node:assert/strict';
import items from '../../data/items.js';
import { makeRng } from '../rng.js';
import {
  rollRarity, pickBase, generateItem, makePotion, pickPotion, rollDrops,
  itemValue, sellValue, describe, tierFor, affixDef,
} from '../itemgen.js';

const N = 20000;
const pct = (n, total = N) => (100 * n) / total;

function countRarity(rng, mf) {
  const c = {};
  for (let i = 0; i < N; i++) { const r = rollRarity(rng, mf); c[r] = (c[r] || 0) + 1; }
  return c;
}

test('rollRarity: 20k rolls at MF 0 sit within 1.5 points of the table; unique falls to rare', () => {
  const rng = makeRng(77);
  const w = items.rarity.weights;
  const total = w.normal + w.magic + w.rare + w.unique;
  const c = countRarity(rng, 0);
  assert.deepEqual(Object.keys(c).sort(), ['magic', 'normal', 'rare'], 'no unique/set until P4');
  assert.ok(Math.abs(pct(c.normal) - pct(w.normal, total)) < 1.5, 'normal ' + pct(c.normal));
  assert.ok(Math.abs(pct(c.magic) - pct(w.magic, total)) < 1.5, 'magic ' + pct(c.magic));
  assert.ok(Math.abs(pct(c.rare) - pct(w.rare + w.unique, total)) < 1.5, 'rare ' + pct(c.rare));
});

test('rollRarity: MF 100 shifts magic and rare up by the k factors', () => {
  const rng = makeRng(78);
  const w = items.rarity.weights, k = items.rarity.mfK;
  const c0 = countRarity(rng, 0), c1 = countRarity(rng, 100);
  assert.ok(pct(c1.magic) > pct(c0.magic) + 5);
  assert.ok(pct(c1.rare) > pct(c0.rare));
  assert.ok(pct(c1.normal) < pct(c0.normal) - 5);
  const bw = { normal: w.normal, magic: w.magic * (1 + k.magic), rare: w.rare * (1 + k.rare), unique: w.unique * (1 + k.unique) };
  const bt = bw.normal + bw.magic + bw.rare + bw.unique;
  assert.ok(Math.abs(pct(c1.normal) - pct(bw.normal, bt)) < 1.5);
  assert.ok(Math.abs(pct(c1.magic) - pct(bw.magic, bt)) < 1.5);
  assert.ok(Math.abs(pct(c1.rare) - pct(bw.rare + bw.unique, bt)) < 1.5);
});

test('5k generated items: affix legality, counts per rarity, names, values, tiers, unique iids', () => {
  const rng = makeRng(99);
  const iids = new Set();
  const seen = { normal: 0, magic: 0, rare: 0 };
  for (let i = 0; i < 5000; i++) {
    const ilvl = rng.range(1, 30);
    const it = generateItem(rng, { ilvl, mf: (i % 3) * 50 });
    assert.ok(!iids.has(it.iid), 'duplicate iid ' + it.iid);
    iids.add(it.iid);
    seen[it.rarity]++;
    assert.ok(typeof it.name === 'string' && it.name.length > 0);
    assert.ok(it.value > 0);
    assert.equal(it.ilvl, ilvl);
    assert.equal(it.tier, tierFor(ilvl).id);
    const base = items.bases[it.base], tier = items.tiers[it.tier];
    assert.ok(base && tier);
    assert.ok(base.lvlReq <= ilvl + 2, 'base too high for ilvl'); // pickBase slack
    assert.equal(it.slot, base.slot);
    assert.equal(it.kind, base.kind);
    assert.deepEqual(it.size, base.size);
    assert.equal(it.lvlReq, base.lvlReq + tier.lvlReqAdd);
    assert.deepEqual(it.reqs, base.reqs);
    if (base.dmg) assert.deepEqual(it.dmg, [Math.round(base.dmg[0] * tier.mult), Math.round(base.dmg[1] * tier.mult)]);
    if (base.armour) assert.ok(it.armour >= Math.round(base.armour[0] * tier.mult) && it.armour <= Math.round(base.armour[1] * tier.mult), 'armour ' + it.armour);
    if (base.hands) assert.equal(it.hands, base.hands);
    if (base.block != null) assert.equal(it.block, base.block);
    const groups = new Set();
    let nP = 0, nS = 0, v = base.value * tier.valueMult * items.rarity.valueMult[it.rarity];
    for (const a of it.affixes) {
      const def = affixDef(a.id);
      assert.ok(def, 'affix ' + a.id);
      assert.ok(def.slots.includes('*') || def.slots.includes(it.slot), `${a.id} on ${it.slot}`);
      assert.ok(!groups.has(def.group), 'two affixes in group ' + def.group);
      groups.add(def.group);
      const t = def.tiers[a.tier];
      assert.ok(t && t.minIlvl <= ilvl, `tier ${a.tier} of ${a.id} at ilvl ${ilvl}`);
      assert.ok(a.value >= t.min && a.value <= t.max, `${a.id} value ${a.value}`);
      assert.equal(a.stat, def.stat); assert.equal(a.kind, def.kind); assert.equal(a.name, def.name);
      if (a.kind === 'prefix') nP++; else nS++;
      v += (a.tier + 1) * items.value.affixTierValue;
    }
    assert.equal(it.value, Math.round(v), 'value formula');
    if (it.rarity === 'normal') {
      assert.equal(it.affixes.length, 0);
      assert.equal(it.name, tier.name + base.name);
    } else if (it.rarity === 'magic') {
      assert.ok(it.affixes.length >= 1 && it.affixes.length <= 2, 'magic affixes ' + it.affixes.length);
      assert.ok(nP <= 1 && nS <= 1);
      for (const a of it.affixes) assert.ok(it.name.includes(a.name), it.name);
      assert.ok(it.name.includes(base.name));
    } else {
      assert.equal(it.rarity, 'rare');
      assert.ok(it.affixes.length >= items.rare.affixMin && it.affixes.length <= items.rare.affixMax, 'rare affixes ' + it.affixes.length);
      assert.ok(nP <= items.rare.maxPrefixes && nS <= items.rare.maxSuffixes);
      const [f, s, extra] = it.name.split(' ');
      assert.ok(items.rareNames.first.includes(f) && items.rareNames.second.includes(s) && extra === undefined, it.name);
    }
  }
  assert.ok(seen.normal > 2000 && seen.magic > 500 && seen.rare > 200, JSON.stringify(seen));
});

test('generateItem and rollDrops are deterministic for a seed', () => {
  const a = makeRng(5), b = makeRng(5);
  for (let i = 0; i < 200; i++) {
    const o = { ilvl: (i % 30) + 1 };
    assert.equal(JSON.stringify(generateItem(a, o)), JSON.stringify(generateItem(b, o)));
  }
  for (let i = 0; i < 50; i++) {
    assert.equal(JSON.stringify(rollDrops(a, 'champion', { ilvl: 5, mlvl: 5, mf: 30, goldFind: 10 })),
      JSON.stringify(rollDrops(b, 'champion', { ilvl: 5, mlvl: 5, mf: 30, goldFind: 10 })));
  }
});

test('pickBase respects the level slack, the slot filter and reaches every base at high ilvl', () => {
  const rng = makeRng(3);
  for (let i = 0; i < 500; i++) assert.ok(pickBase(rng, { ilvl: 1 }).lvlReq <= 3);
  for (let i = 0; i < 200; i++) assert.equal(pickBase(rng, { ilvl: 10, slot: 'shield' }).id, 'shield');
  const seen = new Set();
  for (let i = 0; i < 3000; i++) seen.add(pickBase(rng, { ilvl: 30 }).id);
  assert.equal(seen.size, Object.keys(items.bases).length);
  assert.equal(pickBase(rng, { ilvl: 30, slot: 'ring1' }), null);
});

test('tierFor picks the highest tier whose minIlvl <= ilvl', () => {
  const ts = Object.entries(items.tiers).sort((a, b) => a[1].minIlvl - b[1].minIlvl);
  for (let i = 0; i < ts.length; i++) {
    const [id, t] = ts[i];
    assert.equal(tierFor(t.minIlvl).id, id);
    assert.equal(tierFor(t.minIlvl + 5).id, i + 1 < ts.length && ts[i + 1][1].minIlvl <= t.minIlvl + 5 ? ts[i + 1][0] : id);
    if (i > 0) assert.equal(tierFor(t.minIlvl - 1).id, ts[i - 1][0]);
  }
  assert.equal(tierFor(0).id, ts[0][0]);
});

test('potions: makePotion shape, pickPotion honours minIlvl and reaches every potion', () => {
  const p = makePotion('lifeMinor', 3);
  const def = items.potions.lifeMinor;
  assert.equal(p.slot, 'potion'); assert.equal(p.kind, 'potion'); assert.equal(p.stack, 3);
  assert.equal(p.iid, 'pot.lifeMinor'); assert.equal(p.base, 'lifeMinor'); assert.equal(p.name, def.name);
  assert.deepEqual(p.potion, { kind: def.kind, amount: def.amount, overSec: def.overSec });
  assert.deepEqual(p.size, def.size); assert.equal(p.value, def.value); assert.equal(p.rarity, 'normal');
  assert.throws(() => makePotion('nope'));
  const rng = makeRng(8);
  for (let i = 0; i < 300; i++) {
    const q = pickPotion(rng, 1);
    assert.ok(items.potions[q.base].minIlvl <= 1, q.base);
    assert.equal(q.stack, 1);
    assert.ok(q.iid.startsWith('i') && q.iid !== 'pot.' + q.base);
  }
  const seen = new Set();
  for (let i = 0; i < 600; i++) seen.add(pickPotion(rng, 30).base);
  assert.equal(seen.size, Object.keys(items.potions).length);
});

test('rollDrops: picks, noDrop, kind weights, gold formula and ilvl bonus', () => {
  const rng = makeRng(11);
  const boss = items.dropTables.boss, G = items.gold;
  assert.equal(boss.noDrop, 0, 'this test assumes the boss table never rolls nothing');
  for (const gf of [0, 100]) {
    for (let i = 0; i < 200; i++) {
      const d = rollDrops(rng, 'boss', { ilvl: 6, mlvl: 6, goldFind: gf });
      assert.equal(d.length, boss.picks);
      for (const x of d) {
        if ('gold' in x) {
          assert.ok(Number.isInteger(x.gold));
          assert.ok(x.gold >= Math.max(G.pileMin, Math.round(6 * G.perLevelMin * (1 + gf / 100))), 'gold low ' + x.gold);
          assert.ok(x.gold <= Math.round(6 * G.perLevelMax * (1 + gf / 100)), 'gold high ' + x.gold);
        } else {
          assert.ok(x.item && x.item.iid);
          if (!x.item.potion) assert.equal(x.item.ilvl, 6 + boss.ilvlBonus);
        }
      }
    }
  }
  const mb = items.dropTables.moorBasic;
  let empty = 0, gold = 0, potion = 0, item = 0;
  const M = 6000;
  for (let i = 0; i < M; i++) {
    const d = rollDrops(rng, 'moorBasic', { ilvl: 3, mlvl: 3 });
    assert.ok(d.length <= mb.picks);
    if (!d.length) { empty++; continue; }
    for (const x of d) { if ('gold' in x) gold++; else if (x.item.potion) potion++; else item++; }
  }
  const got = M - empty;
  assert.ok(Math.abs(empty / M - mb.noDrop) < 0.03, 'noDrop ' + empty / M);
  assert.ok(Math.abs(gold / got - mb.weights.gold) < 0.04, 'gold ' + gold / got);
  assert.ok(Math.abs(potion / got - mb.weights.potion) < 0.04, 'potion ' + potion / got);
  assert.ok(Math.abs(item / got - mb.weights.item) < 0.04, 'item ' + item / got);
  // pileMin holds at mlvl 0
  for (let i = 0; i < 50; i++) for (const x of rollDrops(rng, 'boss', { ilvl: 1, mlvl: 0 })) if ('gold' in x) assert.equal(x.gold, G.pileMin);
  assert.throws(() => rollDrops(rng, 'nope', {}));
});

test('itemValue, sellValue cap and describe', () => {
  const rng = makeRng(2);
  const it = generateItem(rng, { ilvl: 30, rarity: 'rare', baseId: 'spear' });
  assert.equal(itemValue(it), it.value);
  assert.equal(sellValue(it), Math.min(items.value.sellCap, Math.floor((it.value * items.value.sellPct) / 100)));
  assert.equal(sellValue({ ...it, value: 1e9 }), items.value.sellCap);
  const pot = makePotion('lifeMinor', 4);
  assert.equal(itemValue(pot), 4 * items.potions.lifeMinor.value);
  const lines = describe(it);
  assert.equal(lines[0], it.name);
  assert.ok(lines.length >= 3 + it.affixes.length);
  for (const l of lines) assert.ok(typeof l === 'string' && l.length > 0);
  assert.ok(lines.includes('Two-handed'));
  assert.ok(lines.some((l) => l.startsWith('Damage: ')));
  assert.ok(lines.some((l) => l.startsWith('Requires level ')));
  assert.equal(describe(pot)[0], pot.name);
  assert.ok(describe(pot).some((l) => l.startsWith('Restores ')));
  assert.deepEqual(describe(null), []);
  const plain = generateItem(rng, { ilvl: 1, rarity: 'normal', baseId: 'cap' });
  assert.equal(describe(plain)[0], plain.name);
  assert.equal(describe(plain).filter((l) => l === plain.name).length, 1, 'normal items do not repeat the base line');
  assert.ok(describe(plain).some((l) => l.startsWith('Armour: ')));
});
