// shared/sim/stats.js — derived vitals and the full derived-stat sheet from class tables,
// allocated stats and equipped items. Pure: reads shared/data, never restates a number.
import classes from '../data/classes.js';
import items from '../data/items.js';
import { clamp } from './dmath.js';

function classOf(doc) {
  const c = classes.classes[doc.cls];
  if (!c) throw new Error('unknown class ' + doc.cls);
  return c;
}

/** hpMax, mpMax, speed, radius for a character document {cls, level, stats?}. */
export function deriveVitals(doc) {
  const c = classOf(doc);
  const st = doc.stats || c.stats;
  const L = doc.level || 1;
  return {
    hpMax: Math.floor(c.life.base + c.life.perLevel * (L - 1) + c.life.perVit * st.vit),
    mpMax: Math.floor(c.mana.base + c.mana.perLevel * (L - 1) + c.mana.perEne * st.ene),
    speed: c.runSpeed,
    radius: c.radius,
  };
}

/** Affix `stat` keys deriveStats sums over equipped items. tools/validate.js checks affixes against it. */
export const AFFIX_STATS = [
  'str', 'dex', 'vit', 'ene', 'life', 'mana', 'armour', 'pctArmour',
  'flatPhys', 'pctDmg', 'fireDmg', 'coldDmg', 'lightDmg', 'poisonDmg',
  'fireRes', 'coldRes', 'lightRes', 'poisonRes', 'allRes',
  'crit', 'ias', 'fcr', 'frw', 'mf', 'goldFind', 'lifeOnHit', 'manaOnKill',
];

/** Crit / block / resist rules (CLAUDE.md "Combat"): classes.combat, the single source. */
const COMBAT = classes.combat;

/** The weapon a character swings with nothing equipped, from classes.unarmed. */
export function unarmedWeapon() {
  const u = classes.unarmed;
  return { dmg: [u.dmg[0], u.dmg[1]], speed: u.speed, scaling: u.scaling, ranged: false, kind: 'unarmed' };
}

/** Equipment slot an item wants; plain 'ring' maps to ring1 (inventory.equip picks the free ring). */
export function equipSlotOf(item) {
  if (!item || !item.slot || item.slot === 'potion') return null;
  const s = item.slot === 'ring' ? 'ring1' : item.slot;
  return items.slots.includes(s) ? s : null;
}

/**
 * Full derived sheet for a player entity {cls, level, stats?, equipment?}. Tolerates a P0
 * entity with no equipment at all. Affix stats sum over equipped items; str/dex/vit/ene are
 * allocated + affix; hpMax/mpMax come from deriveVitals on those totals plus affix life/mana.
 */
export function deriveStats(e) {
  const c = classOf(e);
  const alloc = e.stats || c.stats;
  const eq = e.equipment || {};
  const sum = {};
  for (const k of AFFIX_STATS) sum[k] = 0;
  let armourFlat = 0;
  for (const slot of items.slots) {
    const it = eq[slot];
    if (!it) continue;
    if (it.armour) armourFlat += it.armour;
    const affixes = it.affixes || [];
    for (let i = 0; i < affixes.length; i++) {
      const a = affixes[i];
      if (a.stat in sum) sum[a.stat] += a.value;
    }
  }
  const str = alloc.str + sum.str, dex = alloc.dex + sum.dex, vit = alloc.vit + sum.vit, ene = alloc.ene + sum.ene;
  const v = deriveVitals({ cls: e.cls, level: e.level || 1, stats: { str, dex, vit, ene } });
  const armour = Math.round(armourFlat * (1 + sum.pctArmour / 100));
  const shield = eq.shield;
  const block = shield ? Math.min(COMBAT.blockCap, (shield.block || 0) + dex / COMBAT.blockDexDivisor) : 0;
  const crit = Math.min(COMBAT.critCap, COMBAT.critBase + dex * COMBAT.critPerDex + sum.crit);
  const res = (k) => clamp(sum[k] + sum.allRes, COMBAT.resFloor, COMBAT.resCap);
  const w = eq.weapon;
  const weapon = w
    ? { dmg: [w.dmg[0], w.dmg[1]], speed: w.speed, scaling: w.scaling, ranged: !!w.ranged, kind: w.kind }
    : unarmedWeapon();
  return {
    str, dex, vit, ene,
    hpMax: v.hpMax + sum.life, mpMax: v.mpMax + sum.mana,
    armour, block, crit,
    ias: sum.ias, fcr: sum.fcr, frw: sum.frw, mf: sum.mf, goldFind: sum.goldFind,
    lifeOnHit: sum.lifeOnHit, manaOnKill: sum.manaOnKill,
    flatPhys: sum.flatPhys, pctDmg: sum.pctDmg,
    fireDmg: sum.fireDmg, coldDmg: sum.coldDmg, lightDmg: sum.lightDmg, poisonDmg: sum.poisonDmg,
    fireRes: res('fireRes'), coldRes: res('coldRes'), lightRes: res('lightRes'), poisonRes: res('poisonRes'),
    weapon,
    speed: v.speed * (1 + sum.frw / 100),
  };
}

/**
 * Recompute `e.derived` and copy hpMax/mpMax/speed onto the entity, clamping hp/mp.
 * player.js calls this when invVer, stats or level change.
 */
export function refreshDerived(e) {
  const d = deriveStats(e);
  e.derived = d;
  e.hpMax = d.hpMax; e.mpMax = d.mpMax; e.speed = d.speed;
  if (e.hp > d.hpMax) e.hp = d.hpMax;
  if (e.mp > d.mpMax) e.mp = d.mpMax;
  return d;
}

/**
 * Can this player wear the item? Checks lvlReq, reqs against the class base + allocated
 * str/dex (never affix-boosted), and the class's weapon kinds. Hands are not a failure:
 * inventory.equip displaces the shield (or a 2H weapon) to the bag, or fails when it cannot.
 */
export function canEquip(e, item) {
  if (!equipSlotOf(item)) return { ok: false, why: 'not equippable' };
  const c = classOf(e);
  const st = e.stats || c.stats;
  const lvlReq = item.lvlReq || 0;
  if ((e.level || 1) < lvlReq) return { ok: false, why: 'needs level ' + lvlReq };
  const rq = item.reqs || {};
  if (st.str < (rq.str || 0)) return { ok: false, why: 'needs ' + rq.str + ' strength' };
  if (st.dex < (rq.dex || 0)) return { ok: false, why: 'needs ' + rq.dex + ' dexterity' };
  if (item.slot === 'weapon' && !c.weapons.includes(item.kind)) return { ok: false, why: c.name + ' cannot use ' + item.kind };
  return { ok: true, hands: item.hands || 1 };
}
