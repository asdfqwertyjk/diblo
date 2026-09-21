// shared/sim/itemgen.js — rarity roll, bases, tiers, affixes, potions, drop tables, value
// and tooltip lines. Pure: every random choice comes from the rng handed in (the zone's loot
// stream); every number comes from shared/data/items.js.
import items from '../data/items.js';

const R = items.rarity;
const BASE_LIST = Object.values(items.bases);
const TIER_LIST = Object.entries(items.tiers)
  .map(([id, t]) => ({ id, ...t }))
  .sort((a, b) => a.minIlvl - b.minIlvl);
const AFFIX_BY_ID = new Map(items.affixes.map((a) => [a.id, a]));
const DROP = items.drop;
const RING_SLOTS = ['ring', 'ring1', 'ring2'];

// --- helpers ------------------------------------------------------------------------

/** Weighted pick over `arr` using `wf(el)`; the last element on rounding, null on empty. */
function weightedPick(rng, arr, wf) {
  if (!arr.length) return null;
  let total = 0;
  for (let i = 0; i < arr.length; i++) total += wf(arr[i]);
  if (!(total > 0)) return rng.pick(arr);
  let x = rng.float() * total;
  for (let i = 0; i < arr.length; i++) {
    const w = wf(arr[i]);
    if (x < w) return arr[i];
    x -= w;
  }
  return arr[arr.length - 1];
}

/** Two words of the stream in base36 plus the ilvl: unique for practical purposes, deterministic. */
function makeIid(rng, ilvl) {
  return 'i' + rng.next().toString(36) + rng.next().toString(36) + '.' + ilvl;
}

/** Highest tier whose minIlvl <= ilvl. */
export function tierFor(ilvl) {
  let t = TIER_LIST[0];
  for (let i = 1; i < TIER_LIST.length; i++) if (TIER_LIST[i].minIlvl <= ilvl) t = TIER_LIST[i];
  return t;
}

export function affixDef(id) { return AFFIX_BY_ID.get(id) || null; }

const eligibleCache = new Map();
/** Affixes whose `slots` allow this item slot ('*' or the slot; rings match ring1/ring2). */
function eligibleAffixes(slot) {
  let list = eligibleCache.get(slot);
  if (list) return list;
  const ring = RING_SLOTS.includes(slot);
  list = items.affixes.filter((a) => a.slots.includes('*') || a.slots.includes(slot)
    || (ring && RING_SLOTS.some((s) => a.slots.includes(s))));
  eligibleCache.set(slot, list);
  return list;
}

const usableTiers = (a, ilvl) => a.tiers.filter((t) => t.minIlvl <= ilvl);

/** Roll one affix instance: tier weighted among tiers with minIlvl <= ilvl, value in [min,max]. */
function rollAffix(rng, a, ilvl) {
  const usable = usableTiers(a, ilvl);
  const t = weightedPick(rng, usable, (x) => x.weight);
  if (!t) return null;
  return { id: a.id, stat: a.stat, value: rng.range(t.min, t.max), name: a.name, kind: a.kind, tier: a.tiers.indexOf(t) };
}

function addAffix(rng, pool, kind, ilvl, out, groups) {
  const cands = pool.filter((a) => (!kind || a.kind === kind) && !groups.has(a.group) && usableTiers(a, ilvl).length > 0);
  if (!cands.length) return false;
  const a = rng.pick(cands);
  const rolled = rollAffix(rng, a, ilvl);
  if (!rolled) return false;
  out.push(rolled);
  groups.add(a.group);
  return true;
}

function rollAffixes(rng, rarity, slot, ilvl) {
  if (rarity === 'normal') return [];
  const pool = eligibleAffixes(slot);
  const out = [], groups = new Set();
  if (rarity === 'magic') {
    const M = items.magic;
    let wantP = rng.chance(M.prefixChance), wantS = rng.chance(M.suffixChance);
    if (!wantP && !wantS && M.atLeastOne) { if (rng.int(2) === 0) wantP = true; else wantS = true; }
    if (wantP) addAffix(rng, pool, 'prefix', ilvl, out, groups);
    if (wantS) addAffix(rng, pool, 'suffix', ilvl, out, groups);
    if (!out.length) addAffix(rng, pool, null, ilvl, out, groups);
    return out;
  }
  const RR = items.rare;
  const count = rng.range(RR.affixMin, RR.affixMax);
  let nP = 0, nS = 0;
  while (out.length < count) {
    const cands = pool.filter((a) => !groups.has(a.group) && usableTiers(a, ilvl).length > 0
      && (a.kind === 'prefix' ? nP < RR.maxPrefixes : nS < RR.maxSuffixes));
    if (!cands.length) break;
    const a = rng.pick(cands);
    const rolled = rollAffix(rng, a, ilvl);
    if (!rolled) break;
    out.push(rolled);
    groups.add(a.group);
    if (a.kind === 'prefix') nP++; else nS++;
  }
  return out;
}

function computeValue(base, tier, rarity, affixes) {
  let v = base.value * tier.valueMult * (R.valueMult[rarity] || R.valueMult.normal);
  for (let i = 0; i < affixes.length; i++) v += (affixes[i].tier + 1) * items.value.affixTierValue;
  return Math.round(v);
}

function nameFor(rng, item, base, tier) {
  const baseName = tier.name + base.name;
  if (item.rarity === 'rare') return rng.pick(items.rareNames.first) + ' ' + rng.pick(items.rareNames.second);
  if (item.rarity === 'magic') {
    let p = null, s = null;
    for (const a of item.affixes) { if (a.kind === 'prefix' && !p) p = a; else if (a.kind === 'suffix' && !s) s = a; }
    return (p ? p.name + ' ' : '') + baseName + (s ? ' ' + s.name : '');
  }
  return baseName;
}

// --- public API ---------------------------------------------------------------------

/** 'normal' | 'magic' | 'rare' by the table weights, MF-boosted; unique/set fall to rare until P4. */
export function rollRarity(rng, mf = 0) {
  const m = mf > 0 ? mf / 100 : 0;
  const rows = [];
  for (const r of R.order) {
    if (!(r in R.weights)) continue;
    rows.push({ r, w: R.weights[r] * (1 + m * (R.mfK[r] || 0)) });
  }
  let pick = weightedPick(rng, rows, (x) => x.w).r;
  if (pick === 'unique' || pick === 'set') pick = 'rare';
  return pick;
}

/** A base weighted by `base.weight` among bases whose crude lvlReq <= ilvl + slack (optionally one slot). */
export function pickBase(rng, { ilvl = 1, slot = null } = {}) {
  const maxReq = ilvl + DROP.baseLvlSlack;
  const bySlot = slot ? BASE_LIST.filter((b) => b.slot === slot) : BASE_LIST;
  let pool = bySlot.filter((b) => b.lvlReq <= maxReq);
  if (!pool.length && bySlot.length) {
    let lo = Infinity;
    for (const b of bySlot) if (b.lvlReq < lo) lo = b.lvlReq;
    pool = bySlot.filter((b) => b.lvlReq === lo);
  }
  return weightedPick(rng, pool, (b) => b.weight);
}

/** Generate one piece of gear. Tier by ilvl scales dmg/armour/lvlReq/value; affixes by rarity. */
export function generateItem(rng, { ilvl = 1, rarity = null, baseId = null, mf = 0 } = {}) {
  ilvl = Math.max(1, Math.floor(ilvl));
  let rar = rarity || rollRarity(rng, mf);
  if (rar === 'unique' || rar === 'set') rar = 'rare';
  const base = baseId ? items.bases[baseId] : pickBase(rng, { ilvl });
  if (!base) throw new Error('no base ' + baseId);
  const tier = tierFor(ilvl);
  const item = {
    iid: makeIid(rng, ilvl), base: base.id, name: '', rarity: rar, ilvl, tier: tier.id,
    slot: base.slot, kind: base.kind, size: [base.size[0], base.size[1]],
  };
  if (base.hands) item.hands = base.hands;
  if (base.dmg) item.dmg = [Math.round(base.dmg[0] * tier.mult), Math.round(base.dmg[1] * tier.mult)];
  if (base.armour) item.armour = Math.round(rng.range(base.armour[0], base.armour[1]) * tier.mult);
  if (base.block != null) item.block = base.block;
  if (base.speed != null) item.speed = base.speed;
  if (base.scaling) item.scaling = base.scaling;
  if (base.ranged) item.ranged = true;
  item.lvlReq = base.lvlReq + tier.lvlReqAdd;
  item.reqs = { str: base.reqs.str, dex: base.reqs.dex };
  item.affixes = rollAffixes(rng, rar, base.slot, ilvl);
  item.name = nameFor(rng, item, base, tier);
  item.value = computeValue(base, tier, rar, item.affixes);
  return item;
}

/** A potion stack. Without an rng the iid is 'pot.<id>'; inventory.place de-duplicates it. */
export function makePotion(potionId, count = 1, rng = null) {
  const p = items.potions[potionId];
  if (!p) throw new Error('unknown potion ' + potionId);
  return {
    iid: rng ? makeIid(rng, p.minIlvl) : 'pot.' + potionId,
    base: potionId, name: p.name, rarity: 'normal', ilvl: p.minIlvl, tier: TIER_LIST[0].id,
    slot: 'potion', kind: 'potion', size: [p.size[0], p.size[1]],
    lvlReq: 0, reqs: { str: 0, dex: 0 }, affixes: [], value: p.value,
    stack: count, potion: { kind: p.kind, amount: p.amount, overSec: p.overSec },
  };
}

/** One potion weighted among those with minIlvl <= ilvl. */
export function pickPotion(rng, ilvl) {
  const all = Object.values(items.potions);
  let pool = all.filter((p) => p.minIlvl <= ilvl);
  if (!pool.length) {
    let lo = Infinity;
    for (const p of all) if (p.minIlvl < lo) lo = p.minIlvl;
    pool = all.filter((p) => p.minIlvl === lo);
  }
  const p = weightedPick(rng, pool, (x) => x.weight);
  return makePotion(p.id, 1, rng);
}

/**
 * Roll a drop table: `picks` rolls, each nothing with `noDrop`, else gold | potion | item by
 * the table weights. Gold = mlvl·range(perLevelMin, perLevelMax)·(1 + goldFind/100), min pileMin.
 * Items and potions use ilvl + table.ilvlBonus.
 */
export function rollDrops(rng, tableId, { ilvl = null, mf = 0, goldFind = 0, mlvl = null } = {}) {
  const t = items.dropTables[tableId];
  if (!t) throw new Error('unknown drop table ' + tableId);
  if (mlvl == null) mlvl = ilvl == null ? 1 : ilvl;
  if (ilvl == null) ilvl = mlvl;
  const kinds = Object.keys(t.weights);
  const G = items.gold;
  const out = [];
  for (let i = 0; i < t.picks; i++) {
    if (t.noDrop > 0 && rng.chance(t.noDrop)) continue;
    const kind = weightedPick(rng, kinds, (k) => t.weights[k]);
    if (kind === 'gold') {
      let n = Math.round(mlvl * rng.range(G.perLevelMin, G.perLevelMax) * (1 + goldFind / 100));
      if (n < G.pileMin) n = G.pileMin;
      out.push({ gold: n });
    } else if (kind === 'potion') {
      out.push({ item: pickPotion(rng, ilvl + t.ilvlBonus) });
    } else {
      out.push({ item: generateItem(rng, { ilvl: ilvl + t.ilvlBonus, rarity: rollRarity(rng, mf) }) });
    }
  }
  return out;
}

/** Value of the item (a stack counts every potion). */
export function itemValue(item) {
  if (!item) return 0;
  if (item.slot === 'potion') return (items.potions[item.base]?.value ?? item.value ?? 0) * (item.stack || 1);
  if (typeof item.value === 'number') return item.value;
  const base = items.bases[item.base];
  return base ? computeValue(base, items.tiers[item.tier] ? { ...items.tiers[item.tier] } : TIER_LIST[0], item.rarity, item.affixes || []) : 0;
}

/** What a vendor pays: sellPct of value, capped. */
export function sellValue(item) {
  const v = Math.floor(itemValue(item) * items.value.sellPct / 100);
  return Math.min(items.value.sellCap, v);
}

const STAT_TEXT = {
  flatPhys: (v) => `+${v} Damage`, pctDmg: (v) => `+${v}% Damage`,
  life: (v) => `+${v} Life`, mana: (v) => `+${v} Mana`,
  armour: (v) => `+${v} Armour`, pctArmour: (v) => `+${v}% Armour`,
  fireDmg: (v) => `+${v} Fire Damage`, coldDmg: (v) => `+${v} Cold Damage`,
  lightDmg: (v) => `+${v} Lightning Damage`, poisonDmg: (v) => `+${v} Poison Damage`,
  fireRes: (v) => `+${v}% Fire Resist`, coldRes: (v) => `+${v}% Cold Resist`,
  lightRes: (v) => `+${v}% Lightning Resist`, poisonRes: (v) => `+${v}% Poison Resist`,
  allRes: (v) => `+${v}% All Resists`,
  str: (v) => `+${v} Strength`, dex: (v) => `+${v} Dexterity`, vit: (v) => `+${v} Vitality`, ene: (v) => `+${v} Energy`,
  crit: (v) => `+${v}% Critical Chance`, ias: (v) => `+${v}% Attack Speed`, fcr: (v) => `+${v}% Cast Speed`,
  frw: (v) => `+${v}% Run Speed`, mf: (v) => `+${v}% Magic Find`, goldFind: (v) => `+${v}% Gold Find`,
  lifeOnHit: (v) => `+${v} Life per Hit`, manaOnKill: (v) => `+${v} Mana per Kill`,
};

/** One tooltip line for an affix stat. */
export function affixText(stat, value) {
  const f = STAT_TEXT[stat];
  return f ? f(value) : `+${value} ${stat}`;
}

/** Tooltip lines (plain strings); the client colours line 0 by item.rarity. */
export function describe(item) {
  if (!item) return [];
  const lines = [item.name];
  if (item.potion) {
    lines.push(`Restores ${item.potion.amount} ${item.potion.kind} over ${item.potion.overSec} s`);
    if ((item.stack || 1) > 1) lines.push(`Stack of ${item.stack}`);
    lines.push(`Sells for ${sellValue(item)}`);
    return lines;
  }
  const base = items.bases[item.base];
  const tier = items.tiers[item.tier];
  if (item.rarity !== 'normal' && base) lines.push((tier ? tier.name : '') + base.name);
  if (item.dmg) lines.push(`Damage: ${item.dmg[0]}-${item.dmg[1]}`);
  if (item.armour != null) lines.push(`Armour: ${item.armour}`);
  if (item.block != null) lines.push(`Block: ${item.block}%`);
  if (item.hands === 2) lines.push('Two-handed');
  if (item.speed != null) lines.push(`Speed: ${item.speed}`);
  for (const a of item.affixes || []) lines.push(affixText(a.stat, a.value));
  if (item.lvlReq > 1) lines.push(`Requires level ${item.lvlReq}`);
  if (item.reqs && item.reqs.str > 0) lines.push(`Requires ${item.reqs.str} strength`);
  if (item.reqs && item.reqs.dex > 0) lines.push(`Requires ${item.reqs.dex} dexterity`);
  lines.push(`Sells for ${sellValue(item)}`);
  return lines;
}
