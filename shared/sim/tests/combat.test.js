// Formulas from CLAUDE.md "Combat" and "Monster curve". Entities are built by hand against
// the shape in API.md (e.derived.weapon.dmg etc.); stats.js is not imported here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../rng.js';
import classes from '../../data/classes.js';
import monsters from '../../data/monsters.js';
import items from '../../data/items.js';
import { monsterXp } from '../xp.js';
import { ELEMENTS, roll, armourDR, playerAttackPacket, applyToMonster, monsterAttack, monsterStats } from '../combat.js';

const RULES = classes.combat;

function near(a, b, eps = 1e-9, msg) {
  if (typeof eps === 'string') { msg = eps; eps = 1e-9; }
  assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}` + (msg ? ': ' + msg : ''));
}

function derived(over = {}) {
  return {
    str: 25, dex: 15, vit: 20, ene: 10, hpMax: 120, mpMax: 25, armour: 0, block: 0, crit: 0,
    ias: 0, fcr: 0, frw: 0, mf: 0, goldFind: 0, lifeOnHit: 0, manaOnKill: 0,
    flatPhys: 0, pctDmg: 0, fireDmg: 0, coldDmg: 0, lightDmg: 0, poisonDmg: 0,
    fireRes: 0, coldRes: 0, lightRes: 0, poisonRes: 0,
    weapon: { dmg: [5, 5], speed: 1, scaling: 'str', ranged: false, kind: 'sword' },
    speed: 6, ...over,
  };
}

function player(d = {}, over = {}) {
  return {
    id: 'p1', kind: 'player', cls: 'warrior', level: 1, zone: 'gallowsmoor', x: 3, z: 4,
    hp: 100, hpMax: 120, mp: 10, mpMax: 25, dead: false, buffUntil: 0, buffDmgPct: 0,
    derived: derived(d), ...over,
  };
}

function monster(over = {}) {
  return { id: 'm1', kind: 'monster', level: 1, x: 1, z: 2, hp: 100, hpMax: 100, armour: 0, dmg: [10, 10], dead: false, ...over };
}

function world(ents = []) {
  const w = { tick: 100, events: [], ents: {}, players: [] };
  for (const e of ents) { w.ents[e.id] = e; if (e.kind === 'player') w.players.push(e.id); }
  return w;
}

test('armourDR = armour/(armour + 25·level), capped at 0.6', () => {
  assert.equal(armourDR(0, 1), 0);
  assert.equal(armourDR(-5, 1), 0);
  near(armourDR(25, 1), 0.5);
  near(armourDR(100, 4), 0.5);
  near(armourDR(20, 1), 20 / 45);
  assert.equal(armourDR(50, 1), 0.6, '50/75 raw is capped');
  assert.equal(armourDR(75, 1), 0.6, '0.75 raw is capped');
  assert.equal(armourDR(1e9, 1), 0.6);
  near(armourDR(25, 0), 0.5, 'attacker level below 1 counts as 1');
  near(armourDR(25, undefined), 0.5);
  assert.equal(RULES.armourPerLevel, 25);
  assert.equal(RULES.armourCap, 0.6);
});

test('crit rate over 20k rolls matches crit%, the cap holds, and a crit is ×1.5', () => {
  const N = 20000;
  const e = player({ crit: 25 });
  const rng = makeRng(77);
  let crits = 0;
  for (let i = 0; i < N; i++) if (playerAttackPacket(e, 1, rng).crit) crits++;
  assert.ok(Math.abs(crits / N * 100 - 25) < 1.5, 'crit rate ' + crits / N);
  const capped = player({ crit: 90 });
  crits = 0;
  for (let i = 0; i < N; i++) if (playerAttackPacket(capped, 1, rng).crit) crits++;
  assert.ok(Math.abs(crits / N * 100 - RULES.critCap) < 1.5, 'capped crit rate ' + crits / N);
  const none = player({ crit: 0 });
  for (let i = 0; i < 500; i++) assert.equal(playerAttackPacket(none, 1, rng).crit, false);
  // ×1.5: weapon [5,5] and str 25 give 6.25 plain, 9.375 on a crit
  const both = player({ crit: 50 });
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = playerAttackPacket(both, 1, rng);
    seen.add(p.crit);
    near(p.phys, p.crit ? 6.25 * RULES.critMult : 6.25);
  }
  assert.equal(seen.size, 2);
});

test('playerAttackPacket: weapon + flatPhys, ×pctDmg, ×STAT, ×mult, elements ×mult, warcry by tick', () => {
  const e = player({ flatPhys: 2, pctDmg: 20, str: 25, fireDmg: 3, coldDmg: 0, lightDmg: 0, poisonDmg: 0 });
  const rng = makeRng(1);
  let p = playerAttackPacket(e, 1.1, rng);
  near(p.phys, (5 + 2) * 1.2 * 1.25 * 1.1);
  near(p.fire, 3 * 1.1);
  assert.equal(p.cold, 0); assert.equal(p.light, 0); assert.equal(p.poison, 0);
  assert.equal(p.crit, false);
  assert.deepEqual(Object.keys(p).sort(), ['cold', 'crit', 'fire', 'light', 'phys', 'poison']);
  // default multiplier is 1
  near(playerAttackPacket(e, undefined, rng).phys, 7 * 1.2 * 1.25);
  // warcry applies only while buffUntil > tick, to everything
  e.buffUntil = 200; e.buffDmgPct = 20;
  p = playerAttackPacket(e, 1, rng, { tick: 100 });
  near(p.phys, 7 * 1.2 * 1.25 * 1.2);
  near(p.fire, 3 * 1.2);
  p = playerAttackPacket(e, 1, rng, { tick: 200 });
  near(p.phys, 7 * 1.2 * 1.25);
  p = playerAttackPacket(e, 1, rng);
  near(p.phys, 7 * 1.2 * 1.25, 'no tick given: no warcry');
  // element moves the weapon part; flat elemental still adds
  p = playerAttackPacket(e, 1, rng, { element: 'fire' });
  assert.equal(p.phys, 0);
  near(p.fire, 7 * 1.2 * 1.25 + 3);
  p = playerAttackPacket(e, 1, rng, { element: 'bogus' });
  near(p.phys, 7 * 1.2 * 1.25, 'unknown element falls back to phys');
  p = playerAttackPacket(e, 1, rng, { element: 'crit' });
  assert.equal(p.crit, false, 'element cannot clobber the crit flag');
  // weaponPctOverride scales the weapon part only
  p = playerAttackPacket(e, 1, rng, { weaponPctOverride: 2 });
  near(p.phys, 7 * 1.2 * 1.25 * 2);
  near(p.fire, 3);
});

test('playerAttackPacket rolls the weapon range, scales by the weapon stat, and falls back to unarmed', () => {
  const rng = makeRng(9);
  const e = player({ weapon: { dmg: [4, 9], speed: 1, scaling: 'str' }, str: 0 });
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 2000; i++) { const v = playerAttackPacket(e, 1, rng).phys; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(lo >= 4 && lo < 4.05, 'min ' + lo);
  assert.ok(hi <= 9 && hi > 8.95, 'max ' + hi);
  const bow = player({ weapon: { dmg: [10, 10], speed: 1, scaling: 'dex', ranged: true }, str: 100, dex: 50 });
  near(playerAttackPacket(bow, 1, rng).phys, 15, 'bows scale with DEX');
  const bare = player({ weapon: undefined, str: 0 });
  const u = classes.unarmed;
  for (let i = 0; i < 200; i++) {
    const v = playerAttackPacket(bare, 1, rng).phys;
    assert.ok(v >= u.dmg[0] && v <= u.dmg[1], 'unarmed ' + v);
  }
  const noDerived = { id: 'p9', kind: 'player', level: 1, stats: { str: 100, dex: 0, vit: 0, ene: 0 } };
  const v = playerAttackPacket(noDerived, 1, rng).phys;
  assert.ok(v >= u.dmg[0] * 2 && v <= u.dmg[1] * 2, 'no derived cache: unarmed × allocated STR');
});

test('the same rng seed gives the same packet sequence', () => {
  const a = makeRng(4242), b = makeRng(4242);
  const e = player({ weapon: { dmg: [4, 9], speed: 1, scaling: 'str' }, crit: 30, fireDmg: 2 });
  const sa = [], sb = [];
  for (let i = 0; i < 300; i++) { sa.push(playerAttackPacket(e, 1.3, a)); sb.push(playerAttackPacket(e, 1.3, b)); }
  assert.equal(JSON.stringify(sa), JSON.stringify(sb));
  assert.equal(a.state, b.state);
});

test('roll is inclusive of min, below max, and constant for a degenerate range', () => {
  const rng = makeRng(3);
  for (let i = 0; i < 1000; i++) { const v = roll(rng, [2, 6]); assert.ok(v >= 2 && v < 6); }
  assert.equal(roll(rng, [7, 7]), 7);
  assert.equal(roll(rng, [7, 3]), 7, 'inverted range yields min');
});

test('applyToMonster: armour DR on phys, resists on elements, integer ≥ 1, fields and hit event', () => {
  const p = player();
  const m = monster({ armour: 25 });
  const w = world([p, m]);
  let dealt = applyToMonster(w, null, m, { phys: 10, fire: 4, cold: 0, light: 0, poison: 0, crit: false }, 'p1');
  assert.equal(dealt, 9, '10·(1−0.5) + 4');
  assert.equal(m.hp, 91);
  assert.equal(m.lastHitBy, 'p1');
  assert.equal(m.lastCombatTick, 100);
  assert.equal(p.lastCombatTick, 100, 'dealing damage counts as combat for regen');
  assert.deepEqual(w.events, [{ k: 'hit', src: 'p1', tgt: 'm1', dmg: 9, crit: false, el: 'phys', x: 1, z: 2 }]);
  // attacker level raises the DR denominator
  p.level = 4;
  dealt = applyToMonster(w, null, m, { phys: 10, crit: true }, 'p1');
  assert.equal(dealt, 8, '10·(1 − 25/125)');
  assert.equal(w.events[1].crit, true);
  // minimum 1 after reductions
  dealt = applyToMonster(w, null, m, { phys: 0.01 }, 'p1');
  assert.equal(dealt, 1);
  dealt = applyToMonster(w, null, m, {}, 'p1');
  assert.equal(dealt, 1);
  // monster resists reduce elements; missing resists mean 0; negative resists amplify
  m.res = { fire: 50, cold: -100 };
  dealt = applyToMonster(w, null, m, { fire: 8, cold: 3 }, 'p1');
  assert.equal(dealt, 4 + 6);
  assert.equal(w.events.at(-1).el, 'cold', 'el is the largest post-reduction share');
  // unknown attacker: level 1 DR, no crash
  dealt = applyToMonster(w, null, m, { phys: 10 }, 'nobody');
  assert.equal(dealt, 5);
  assert.equal(m.lastHitBy, 'nobody');
  // rounding: .5 rounds up
  m.armour = 0;
  assert.equal(applyToMonster(w, null, m, { phys: 2.5 }, 'p1'), 3);
  assert.equal(applyToMonster(w, null, m, { phys: 2.49 }, 'p1'), 2);
});

test('applyToMonster ignores dead monsters and applies life on hit and mana on kill once', () => {
  const p = player({ lifeOnHit: 5, manaOnKill: 7 }, { hp: 100, hpMax: 103, mp: 10, mpMax: 12 });
  const corpse = monster({ dead: true, hp: 0 });
  const w = world([p, corpse]);
  assert.equal(applyToMonster(w, null, corpse, { phys: 10 }, 'p1'), 0);
  assert.deepEqual(w.events, []);
  assert.equal(p.hp, 100);
  const m = monster({ hp: 12 });
  w.ents.m1 = m;
  applyToMonster(w, null, m, { phys: 10 }, 'p1');
  assert.equal(p.hp, 103, 'life on hit, capped at hpMax');
  assert.equal(p.mp, 10, 'no kill yet');
  assert.equal(m.hp, 2);
  applyToMonster(w, null, m, { phys: 10 }, 'p1');
  assert.equal(m.hp, -8);
  assert.equal(p.mp, 12, 'mana on kill, capped at mpMax');
  p.mp = 0;
  // a monster already at hp <= 0 (killed earlier this tick, not yet flagged by the deaths
  // phase) takes nothing more: no event, no mana, and the kill credit stays with the killer
  w.ents.p2 = player({ manaOnKill: 3 }, { id: 'p2', mp: 0, mpMax: 9 });
  assert.equal(applyToMonster(w, null, m, { phys: 10 }, 'p2'), 0);
  assert.equal(m.hp, -8);
  assert.equal(m.lastHitBy, 'p1', 'the second hitter does not steal the kill');
  assert.equal(w.ents.p2.mp, 0);
  assert.equal(w.events.length, 2);
  // a dead attacker gets no life on hit
  const ghost = player({ lifeOnHit: 5 }, { id: 'p2', dead: true, hp: 0 });
  w.ents.p2 = ghost;
  applyToMonster(w, null, monster({ id: 'm2', hp: 50 }), { phys: 10 }, 'p2');
  assert.equal(ghost.hp, 0);
});

test('monsterAttack: roll, DR by the player armour vs monster level, ≥ 1, hit event, lastCombatTick', () => {
  const p = player({ armour: 100 });
  const m = monster({ level: 4, dmg: [10, 10] });
  const w = world([p, m]);
  const rng = makeRng(5);
  let dealt = monsterAttack(w, null, m, p, rng);
  assert.equal(dealt, 5, '10·(1 − 100/(100+25·4))');
  assert.equal(p.hp, 95);
  assert.equal(p.lastCombatTick, 100);
  assert.deepEqual(w.events, [{ k: 'hit', src: 'm1', tgt: 'p1', dmg: 5, crit: false, el: 'phys', x: 3, z: 4 }]);
  // minimum 1 even under the cap
  p.derived.armour = 1e9;
  dealt = monsterAttack(w, null, m, p, rng);
  assert.equal(dealt, Math.max(1, Math.floor(10 * (1 - RULES.armourCap) + 0.5)));
  m.dmg = [1, 1];
  assert.equal(monsterAttack(w, null, m, p, rng), 1);
  // the roll spans the monster's range
  p.derived.armour = 0;
  m.dmg = [4, 9];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 2000; i++) { const v = monsterAttack(w, null, m, p, rng); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.equal(lo, 4); assert.equal(hi, 9);
  // dead players take nothing
  const dead = player({}, { id: 'p2', dead: true, hp: 0 });
  const n = w.events.length;
  assert.equal(monsterAttack(w, null, m, dead, rng), 0);
  assert.equal(w.events.length, n);
  assert.equal(dead.hp, 0);
});

test('monsterAttack opts: elemental hits use resists not armour; dmg and level overrides for arrows', () => {
  const p = player({ armour: 1e9, fireRes: 50 });
  const m = monster({ level: 1, dmg: [10, 10] });
  const w = world([p, m]);
  const rng = makeRng(8);
  assert.equal(monsterAttack(w, null, m, p, rng, { el: 'fire' }), 5);
  assert.equal(w.events.at(-1).el, 'fire');
  assert.equal(monsterAttack(w, null, m, p, rng, { el: 'poison' }), 10, 'missing resist is 0');
  p.derived.armour = 100;
  assert.equal(monsterAttack(w, null, m, p, rng, { dmg: [20, 20], level: 4 }), 10, '20·(1 − 100/200)');
  const arrow = { id: 'q7', dmg: [20, 20] };
  assert.equal(monsterAttack(w, null, arrow, p, rng), Math.floor(20 * (1 - armourDR(100, 1)) + 0.5));
  assert.equal(w.events.at(-1).src, 'q7');
});

test('block only vs physical, rate = block% capped at 50, event block and 0 dealt', () => {
  const N = 20000;
  const p = player({ block: 100 });
  const m = monster({ dmg: [10, 10] });
  const w = world([p, m]);
  const rng = makeRng(21);
  let blocks = 0;
  for (let i = 0; i < N; i++) {
    p.hp = 100;
    const dealt = monsterAttack(w, null, m, p, rng);
    if (dealt === 0) { blocks++; assert.equal(p.hp, 100); } else assert.equal(dealt, 10);
  }
  assert.ok(Math.abs(blocks / N * 100 - RULES.blockCap) < 1.5, 'block rate ' + blocks / N);
  assert.equal(w.events.filter((e) => e.k === 'block').length, blocks);
  assert.ok(w.events.every((e) => e.k !== 'block' || e.pid === 'p1'));
  assert.equal(w.events.filter((e) => e.k === 'hit').length, N - blocks);
  // an uncapped value below the cap is used as is
  p.derived.block = 30;
  w.events.length = 0;
  blocks = 0;
  for (let i = 0; i < N; i++) if (monsterAttack(w, null, m, p, rng) === 0) blocks++;
  assert.ok(Math.abs(blocks / N * 100 - 30) < 1.5, 'block 30 rate ' + blocks / N);
  // never against elements
  p.derived.block = 100;
  for (let i = 0; i < 2000; i++) assert.equal(monsterAttack(w, null, m, p, rng, { el: 'fire' }), 10);
  // no shield: never
  p.derived.block = 0;
  for (let i = 0; i < 2000; i++) assert.equal(monsterAttack(w, null, m, p, rng), 10);
});

function expectStats(archId, L, { champion = false, boss = false, players = 1 } = {}) {
  const cv = monsters.curve, arch = monsters.archetypes[archId];
  const rank = boss ? cv.boss : champion ? cv.champion : null;
  const extra = Math.max(1, players) - 1;
  const hpMax = Math.floor((cv.hpBase + cv.hpPerLevel * L) * arch.hp * (rank ? rank.hp : 1) * (1 + cv.perExtraPlayer.hp * extra));
  const mid = (cv.dmgBase + cv.dmgPerLevel * L) * arch.dmg * (rank ? rank.dmg : 1) * (1 + cv.perExtraPlayer.dmg * extra);
  const lo = Math.max(1, Math.floor(mid * (1 - monsters.curve.dmgSpread) + 0.5));
  const hi = Math.max(lo, Math.floor(mid * (1 + monsters.curve.dmgSpread) + 0.5));
  return { hpMax, mid, dmg: [lo, hi], armour: items.monsterArmourPerLevel[archId] * L };
}

test('monsterStats: hp and dmg per archetype at levels 1, 8, 14 follow the curve', () => {
  for (const archId of Object.keys(monsters.archetypes)) {
    for (const L of [1, 8, 14]) {
      const s = monsterStats(archId, L, false, 1, { dropTable: 'moorBasic' });
      const x = expectStats(archId, L);
      assert.equal(s.hpMax, x.hpMax, `${archId} L${L} hp`);
      assert.deepEqual(s.dmg, x.dmg, `${archId} L${L} dmg`);
      assert.ok(s.dmg[0] <= x.mid && x.mid <= s.dmg[1] && s.dmg[0] >= 1, `${archId} L${L} dmg brackets the curve`);
      assert.ok(Number.isInteger(s.dmg[0]) && Number.isInteger(s.dmg[1]));
      assert.equal(s.armour, x.armour, `${archId} L${L} armour`);
      assert.equal(s.speed, monsters.archetypes[archId].speed);
      assert.equal(s.xpValue, monsterXp(L));
      assert.equal(s.dropTable, 'moorBasic');
      assert.equal(s.ilvl, L);
      assert.equal(s.arch, archId);
    }
  }
  // spot values from CLAUDE.md: hp = (15 + 10·mlvl)·archMult
  assert.equal(monsterStats('rusher', 1, false, 1).hpMax, 25);
  assert.equal(monsterStats('rusher', 8, false, 1).hpMax, 95);
  assert.equal(monsterStats('rusher', 14, false, 1).hpMax, 155);
  assert.equal(monsterStats('tank', 1, false, 1).hpMax, 55);
  assert.equal(monsterStats('swarm', 1, false, 1).hpMax, 12);
  assert.equal(monsterStats('rusher', 8, false, 1).armour, 32);
  // the P0 world test's plain-rusher check still holds
  for (let L = 1; L <= 30; L++) assert.equal(monsterStats('gallowswolf', L, false, 1).hpMax, Math.floor(15 + 10 * L));
});

test('monsterStats resolves types to archetypes and rejects unknown ids', () => {
  const wolf = monsterStats('gallowswolf', 5, false, 1);
  assert.equal(wolf.arch, 'rusher');
  assert.equal(wolf.hpMax, monsterStats('rusher', 5, false, 1).hpMax);
  assert.equal(monsterStats('carrioncrow', 5, false, 1).hpMax, expectStats('swarm', 5).hpMax);
  assert.equal(monsterStats('moorpoacher', 5, false, 1).arch, 'ranged');
  assert.throws(() => monsterStats('dragon', 5, false, 1), /unknown monster type/);
  assert.equal(monsterStats('rusher', 0, false, 1).hpMax, 25, 'level below 1 counts as 1');
  assert.equal(monsterStats('rusher', 3, false, 1).dropTable, null, 'no zone table given');
});

test('monsterStats champion ×3.5 hp ×1.5 dmg, drop table champion, xp ×3, ilvl +2; boss ×15/×2', () => {
  const plain = monsterStats('rusher', 8, false, 1, { dropTable: 'moorBasic' });
  const champ = monsterStats('rusher', 8, true, 1, { dropTable: 'moorBasic' });
  const x = expectStats('rusher', 8, { champion: true });
  assert.equal(champ.hpMax, Math.floor(95 * 3.5));
  assert.equal(champ.hpMax, x.hpMax);
  assert.deepEqual(champ.dmg, x.dmg);
  near((champ.dmg[0] + champ.dmg[1]) / 2, (plain.dmg[0] + plain.dmg[1]) / 2 * 1.5, 1.5);
  assert.equal(champ.armour, plain.armour);
  assert.equal(champ.speed, plain.speed);
  assert.equal(champ.dropTable, 'champion');
  assert.equal(champ.xpValue, monsterXp(8, true));
  assert.equal(champ.ilvl, 8 + monsters.curve.champion.ilvl);
  assert.ok(champ.dmg[0] > plain.dmg[0] && champ.dmg[1] > plain.dmg[1], 'champion hits harder');
  const boss = monsterStats('rusher', 8, true, 1, { dropTable: 'moorBasic', boss: true });
  const xb = expectStats('rusher', 8, { boss: true });
  assert.equal(boss.hpMax, Math.floor(95 * 15));
  assert.equal(boss.hpMax, xb.hpMax);
  assert.deepEqual(boss.dmg, xb.dmg);
  assert.equal(boss.dropTable, 'boss');
  assert.equal(boss.xpValue, monsterXp(8, false, true));
  assert.equal(boss.ilvl, 8 + monsters.curve.boss.ilvl);
});

test('monsterStats co-op: hp +50% and dmg +10% per extra player in the game', () => {
  const one = monsterStats('rusher', 8, false, 1);
  assert.equal(monsterStats('rusher', 8, false, 0).hpMax, one.hpMax);
  assert.equal(monsterStats('rusher', 8, false, undefined).hpMax, one.hpMax);
  for (const n of [2, 3, 5, 8]) {
    const s = monsterStats('rusher', 8, false, n);
    const x = expectStats('rusher', 8, { players: n });
    assert.equal(s.hpMax, Math.floor(95 * (1 + 0.5 * (n - 1))), 'hp for ' + n);
    assert.equal(s.hpMax, x.hpMax);
    assert.deepEqual(s.dmg, x.dmg, 'dmg for ' + n);
    near((s.dmg[0] + s.dmg[1]) / 2, (one.dmg[0] + one.dmg[1]) / 2 * (1 + 0.1 * (n - 1)), 1.5);
    assert.equal(s.armour, one.armour, 'armour does not scale with players');
    assert.equal(s.xpValue, one.xpValue, 'xp does not scale here; coopMult does');
  }
  const champ2 = monsterStats('tank', 14, true, 2);
  assert.equal(champ2.hpMax, expectStats('tank', 14, { champion: true, players: 2 }).hpMax);
});

test('ELEMENTS lists the four affix damage keys', () => {
  assert.deepEqual(ELEMENTS, ['fire', 'cold', 'light', 'poison']);
  for (const x of ELEMENTS) assert.ok(items.affixes.some((a) => a.stat === x + 'Dmg') && items.affixes.some((a) => a.stat === x + 'Res'));
});
