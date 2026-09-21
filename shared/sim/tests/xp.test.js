// Formulas from CLAUDE.md "XP" and grantXp/shareKillXp behaviour. Entities are built by hand
// against the shape in API.md; stats.js is not imported here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import classes from '../../data/classes.js';
import { xpToNext, monsterXp, penalty, coopMult, grantXp, shareKillXp } from '../xp.js';

const XP_RULES = classes.xp;

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

function warrior(over = {}) {
  const c = classes.classes.warrior;
  return {
    id: 'p1', kind: 'player', cls: 'warrior', level: 1, xp: 0, zone: 'gallowsmoor', x: 10, z: 10,
    stats: { ...c.stats }, hp: 50, hpMax: 120, mp: 5, mpMax: 25, statPoints: 0, skillPoints: 0,
    dead: false, ...over,
  };
}

function world(players = []) {
  const w = { tick: 5, events: [], ents: {}, players: [] };
  for (const p of players) { w.ents[p.id] = p; if (p.kind === 'player') w.players.push(p.id); }
  return w;
}

test('xpToNext is 100·L² and totals about 855k to level 30', () => {
  assert.equal(xpToNext(1), 100);
  assert.equal(xpToNext(2), 400);
  assert.equal(xpToNext(10), 10000);
  assert.equal(xpToNext(29), 84100);
  assert.equal(xpToNext(0), 100, 'level 0 is treated as 1');
  let total = 0;
  for (let L = 1; L < classes.maxLevel; L++) total += xpToNext(L);
  assert.equal(total, 855500);
});

test('monsterXp = 20·mlvl·(1 + mlvl/10); champion ×3, boss ×20, boss wins', () => {
  assert.equal(XP_RULES.monsterBase, 20);
  assert.equal(XP_RULES.monsterPerLevel, 0.1);
  assert.equal(monsterXp(1), 22);
  assert.equal(monsterXp(8), 288);
  assert.equal(monsterXp(14), 672);
  for (let L = 1; L <= 31; L++) {
    assert.equal(monsterXp(L), 20 * L + 2 * L * L, 'integer at level ' + L);
    assert.equal(monsterXp(L, true), (20 * L + 2 * L * L) * XP_RULES.championMult);
    assert.equal(monsterXp(L, false, true), (20 * L + 2 * L * L) * XP_RULES.bossMult);
  }
  assert.equal(monsterXp(8, true, true), 288 * 20, 'a champion boss is a boss');
  assert.equal(monsterXp(0), 22, 'level 0 is treated as 1');
});

test('penalty: none within 5 levels, −10%/level beyond, clamped to 0.05, never above 1', () => {
  assert.equal(penalty(1, 1), 1);
  assert.equal(penalty(6, 1), 1);
  assert.equal(penalty(1, 20), 1, 'fighting up gives no bonus');
  near(penalty(7, 1), 0.9);
  near(penalty(8, 1), 0.8);
  near(penalty(10, 1), 0.6);
  near(penalty(14, 1), 0.2);
  near(penalty(15, 1), 0.1);
  assert.equal(penalty(16, 1), 0.05);
  assert.equal(penalty(30, 1), 0.05);
  for (let c = 1; c <= 30; c++) for (let m = 1; m <= 30; m++) {
    const p = penalty(c, m);
    assert.ok(p >= XP_RULES.penaltyMin && p <= 1, `${c} vs ${m}: ${p}`);
  }
});

test('coopMult = 1 + 0.15·(players − 1)', () => {
  assert.equal(coopMult(1), 1);
  assert.equal(coopMult(0), 1);
  assert.equal(coopMult(undefined), 1);
  near(coopMult(2), 1.15);
  near(coopMult(4), 1.45);
  near(coopMult(8), 2.05);
});

test('grantXp levels across several levels at once with points, full heal and events', () => {
  const p = warrior();
  const w = world([p]);
  const gained = grantXp(w, p, 100 + 400 + 900);
  assert.equal(gained, 3);
  assert.equal(p.level, 4);
  assert.equal(p.xp, 0);
  assert.equal(p.statPoints, 3 * classes.statPointsPerLevel);
  assert.equal(p.skillPoints, 3 * classes.skillPointsPerLevel);
  const c = classes.classes.warrior;
  const hpMax = Math.floor(c.life.base + c.life.perLevel * 3 + c.life.perVit * c.stats.vit);
  const mpMax = Math.floor(c.mana.base + c.mana.perLevel * 3 + c.mana.perEne * c.stats.ene);
  assert.equal(p.hpMax, hpMax);
  assert.equal(p.mpMax, mpMax);
  assert.equal(p.hp, p.hpMax, 'full heal');
  assert.equal(p.mp, p.mpMax, 'full mana');
  assert.deepEqual(w.events, [
    { k: 'xp', pid: 'p1', amount: 1400 },
    { k: 'levelup', pid: 'p1', level: 2 },
    { k: 'levelup', pid: 'p1', level: 3 },
    { k: 'levelup', pid: 'p1', level: 4 },
  ]);
});

test('grantXp keeps the remainder, floors fractions, ignores non-positive amounts', () => {
  const p = warrior();
  const w = world([p]);
  assert.equal(grantXp(w, p, 150.9), 1);
  assert.equal(p.level, 2);
  assert.equal(p.xp, 50);
  assert.equal(w.events.length, 2);
  assert.equal(grantXp(w, p, 0), 0);
  assert.equal(grantXp(w, p, -5), 0);
  assert.equal(grantXp(w, p, 0.5), 0);
  assert.equal(w.events.length, 2, 'no event for nothing');
  assert.equal(p.xp, 50);
});

test('grantXp stops at maxLevel', () => {
  const p = warrior({ level: classes.maxLevel - 1, xp: 0 });
  const w = world([p]);
  grantXp(w, p, 10000000);
  assert.equal(p.level, classes.maxLevel);
  assert.equal(w.events.filter((e) => e.k === 'levelup').length, 1);
  const before = p.xp;
  grantXp(w, p, 100);
  assert.equal(p.level, classes.maxLevel);
  assert.equal(p.xp, before + 100);
});

test('shareKillXp pays every live player in the zone within xpShareRange, with penalty and co-op', () => {
  const R = classes.xpShareRange;
  const p1 = warrior({ id: 'p1', x: 10, z: 10, level: 2 }); // level 2: a level-3 share never levels them up
  const p2 = warrior({ id: 'p2', x: 10, z: 10 + R - 1, level: 2 });
  const p3 = warrior({ id: 'p3', x: 10, z: 10 + R + 1 });
  const p4 = warrior({ id: 'p4', x: 10, z: 10, zone: 'elsewhere' });
  const p5 = warrior({ id: 'p5', x: 10, z: 10, dead: true });
  const p6 = warrior({ id: 'p6', x: 11, z: 10, level: 12, xp: 0 });
  const w = world([p1, p2, p3, p4, p5, p6]);
  const zone = { id: 'gallowsmoor' };
  const m = { id: 'm1', kind: 'monster', level: 3, x: 10, z: 10, xpValue: monsterXp(3), champion: false };
  const coop = coopMult(w.players.length);
  const paid = shareKillXp(w, zone, m);
  const full = Math.floor(monsterXp(3) * coop);
  const cut = Math.floor(monsterXp(3) * penalty(12, 3) * coop);
  assert.deepEqual(paid, [{ pid: 'p1', amount: full }, { pid: 'p2', amount: full }, { pid: 'p6', amount: cut }]);
  assert.equal(p1.xp, full);
  assert.equal(p2.xp, full);
  assert.equal(p3.xp, 0);
  assert.equal(p4.xp, 0);
  assert.equal(p5.xp, 0);
  assert.equal(p6.xp, cut);
  assert.ok(cut < full);
  assert.equal(w.events.filter((e) => e.k === 'xp').length, 3);
});

test('shareKillXp falls back to monsterXp when the monster has no xpValue', () => {
  const p1 = warrior();
  const w = world([p1]);
  const m = { id: 'm1', kind: 'monster', level: 5, x: 10, z: 10, champion: true };
  const paid = shareKillXp(w, { id: 'gallowsmoor' }, m);
  assert.deepEqual(paid, [{ pid: 'p1', amount: monsterXp(5, true) }]);
});
