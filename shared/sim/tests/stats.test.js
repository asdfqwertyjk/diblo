import { test } from 'node:test';
import assert from 'node:assert/strict';
import classes from '../../data/classes.js';
import { makeRng } from '../rng.js';
import { generateItem, makePotion } from '../itemgen.js';
import { deriveVitals, deriveStats, canEquip, refreshDerived, unarmedWeapon, AFFIX_STATS } from '../stats.js';

const COMBAT = classes.combat;

const rng = makeRng(9);
const gear = (baseId, ilvl = 1, rarity = 'normal') => generateItem(rng, { ilvl, rarity, baseId });
const W = classes.classes.warrior;
const hero = (extra = {}) => ({ id: 'p1', cls: 'warrior', level: 1, stats: { ...W.stats }, equipment: null, ...extra });
const withAffixes = (baseId, affixes) => ({ ...gear(baseId), affixes: affixes.map(([stat, value]) => ({ id: stat, stat, value, name: stat, kind: 'prefix', tier: 0 })) });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

const KEYS = ['str', 'dex', 'vit', 'ene', 'hpMax', 'mpMax', 'armour', 'block', 'crit', 'ias', 'fcr', 'frw', 'mf', 'goldFind',
  'lifeOnHit', 'manaOnKill', 'flatPhys', 'pctDmg', 'fireDmg', 'coldDmg', 'lightDmg', 'poisonDmg',
  'fireRes', 'coldRes', 'lightRes', 'poisonRes', 'weapon', 'speed'];

test('deriveVitals is unchanged: Warrior L1 120 life; per level and per VIT add', () => {
  assert.equal(deriveVitals({ cls: 'warrior', level: 1 }).hpMax, 120);
  assert.equal(deriveVitals({ cls: 'warrior', level: 5 }).hpMax, Math.floor(W.life.base + W.life.perLevel * 4 + W.life.perVit * W.stats.vit));
  assert.equal(deriveVitals({ cls: 'warrior', level: 1, stats: { ...W.stats, vit: 30 } }).hpMax, 120 + 10 * W.life.perVit);
  assert.throws(() => deriveVitals({ cls: 'bard' }));
});

test('a warrior with no gear: hpMax 120, unarmed weapon, crit 6.5, block 0, every key present', () => {
  const d = deriveStats(hero());
  assert.deepEqual(Object.keys(d).sort(), [...KEYS].sort());
  assert.equal(d.hpMax, 120);
  assert.equal(d.mpMax, Math.floor(W.mana.base + W.mana.perEne * W.stats.ene));
  assert.deepEqual(d.weapon, { dmg: [...classes.unarmed.dmg], speed: classes.unarmed.speed, scaling: classes.unarmed.scaling, ranged: false, kind: 'unarmed' });
  assert.deepEqual(d.weapon, unarmedWeapon());
  near(d.crit, 6.5, 'crit');
  assert.equal(d.block, 0);
  assert.equal(d.armour, 0);
  assert.equal(d.speed, W.runSpeed);
  assert.deepEqual([d.str, d.dex, d.vit, d.ene], [W.stats.str, W.stats.dex, W.stats.vit, W.stats.ene]);
  for (const k of KEYS) if (k !== 'weapon') assert.equal(typeof d[k], 'number', k);
  for (const k of ['fireRes', 'coldRes', 'lightRes', 'poisonRes', 'ias', 'fcr', 'frw', 'mf', 'goldFind', 'flatPhys', 'pctDmg']) assert.equal(d[k], 0, k);
});

test('tolerates a P0 entity with no stats and no equipment field at all', () => {
  const d = deriveStats({ cls: 'warrior', level: 1 });
  assert.equal(d.hpMax, 120);
  assert.equal(d.weapon.kind, 'unarmed');
  const d2 = deriveStats({ cls: 'warrior', level: 1, equipment: { weapon: null, shield: null } });
  assert.equal(d2.block, 0);
});

test('with a shield: block = shield.block + dex/40 and armour = the shield armour', () => {
  const e = hero({ equipment: { shield: gear('shield') } });
  const d = deriveStats(e);
  near(d.block, e.equipment.shield.block + W.stats.dex / 40, 'block');
  assert.equal(d.armour, e.equipment.shield.armour);
  assert.equal(d.weapon.kind, 'unarmed');
});

test('allRes adds to each resist; caps and floors hold; crit and block cap at 50', () => {
  const helm = withAffixes('cap', [['fireRes', 70], ['allRes', 10], ['coldRes', -200]]);
  const d = deriveStats(hero({ equipment: { helm } }));
  assert.equal(d.fireRes, COMBAT.resCap);
  assert.equal(d.coldRes, COMBAT.resFloor);
  assert.equal(d.lightRes, 10);
  assert.equal(d.poisonRes, 10);
  const keen = withAffixes('sword', [['crit', 100]]);
  assert.equal(deriveStats(hero({ equipment: { weapon: keen } })).crit, COMBAT.critCap);
  const dexy = withAffixes('boots', [['dex', 5000]]);
  const d2 = deriveStats(hero({ equipment: { shield: gear('shield'), boots: dexy } }));
  assert.equal(d2.block, COMBAT.blockCap);
  assert.equal(d2.crit, COMBAT.critCap);
  assert.equal(d2.dex, W.stats.dex + 5000);
});

test('affix sums: stats, life/mana, run speed, percent armour, weapon fields', () => {
  const helm = withAffixes('cap', [['str', 5], ['vit', 10], ['life', 20], ['mana', 7], ['ene', 4], ['mf', 12], ['lifeOnHit', 2]]);
  const boots = withAffixes('boots', [['frw', 20], ['pctArmour', 50], ['goldFind', 30]]);
  const chest = withAffixes('leatherChest', [['pctArmour', 25], ['fireRes', 5], ['poisonDmg', 3]]);
  const sword = withAffixes('sword', [['flatPhys', 4], ['pctDmg', 15], ['ias', 10], ['fireDmg', 2]]);
  const e = hero({ equipment: { helm, boots, chest, weapon: sword } });
  const d = deriveStats(e);
  assert.equal(d.str, W.stats.str + 5);
  assert.equal(d.vit, W.stats.vit + 10);
  assert.equal(d.ene, W.stats.ene + 4);
  const v = deriveVitals({ cls: 'warrior', level: 1, stats: { str: d.str, dex: d.dex, vit: d.vit, ene: d.ene } });
  assert.equal(d.hpMax, v.hpMax + 20);
  assert.equal(d.mpMax, v.mpMax + 7);
  near(d.speed, W.runSpeed * 1.2, 'speed');
  assert.equal(d.frw, 20);
  assert.equal(d.armour, Math.round((helm.armour + boots.armour + chest.armour) * 1.75));
  assert.deepEqual([d.mf, d.goldFind, d.lifeOnHit, d.fireRes, d.poisonDmg, d.flatPhys, d.pctDmg, d.ias, d.fireDmg], [12, 30, 2, 5, 3, 4, 15, 10, 2]);
  assert.deepEqual(d.weapon, { dmg: sword.dmg, speed: sword.speed, scaling: sword.scaling, ranged: false, kind: 'sword' });
  const bow = gear('bow', 1);
  assert.equal(deriveStats(hero({ equipment: { weapon: bow } })).weapon.ranged, true);
  assert.ok(AFFIX_STATS.includes('allRes') && AFFIX_STATS.includes('manaOnKill'));
});

test('canEquip: level, str/dex requirements on allocated stats only, class weapon kinds, hands', () => {
  const e = hero();
  assert.equal(canEquip(e, gear('sword', 20)).why, 'needs level 13');
  assert.deepEqual(canEquip(e, gear('sword')), { ok: true, hands: 1 });
  e.level = 5;
  assert.equal(canEquip(e, gear('bow', 1)).why, 'needs 20 dexterity');
  e.equipment = { boots: withAffixes('boots', [['dex', 50]]) };
  assert.equal(canEquip(e, gear('bow', 1)).why, 'needs 20 dexterity', 'affix dex never counts for requirements');
  e.stats.dex = 20;
  assert.equal(canEquip(e, gear('bow', 1)).why, 'Warrior cannot use bow');
  assert.equal(canEquip(e, gear('wand')).why, 'Warrior cannot use wand');
  assert.deepEqual(canEquip(e, gear('spear', 5)), { ok: true, hands: 2 });
  assert.equal(canEquip(e, makePotion('lifeMinor')).why, 'not equippable');
  assert.equal(canEquip(e, null).why, 'not equippable');
  const wiz = { cls: 'wizard', level: 1, stats: { ...classes.classes.wizard.stats } };
  assert.equal(canEquip(wiz, gear('sword')).why, 'needs 15 strength');
  assert.ok(canEquip(wiz, gear('wand')).ok);
});

test('refreshDerived writes derived, hpMax/mpMax/speed and clamps hp/mp', () => {
  const e = hero({ hp: 500, mp: 500 });
  const d = refreshDerived(e);
  assert.equal(e.derived, d);
  assert.equal(e.hpMax, 120);
  assert.equal(e.hp, 120);
  assert.equal(e.mp, e.mpMax);
  assert.equal(e.speed, W.runSpeed);
  e.equipment = { helm: withAffixes('cap', [['life', 30]]) };
  refreshDerived(e);
  assert.equal(e.hpMax, 150);
  assert.equal(e.hp, 120, 'hp does not grow with the cap');
});
