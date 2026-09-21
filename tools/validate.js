// tools/validate.js — shape checks for every data table. Run: node tools/validate.js
import classes from '../shared/data/classes.js';
import items from '../shared/data/items.js';
import monsters from '../shared/data/monsters.js';
import recipes from '../shared/data/zones/index.js';
import { AFFIX_STATS } from '../shared/sim/stats.js';
import { ELEMENTS as DMG_ELEMENTS } from '../shared/sim/combat.js';

const errors = [];
const fail = (msg) => errors.push(msg);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isColour = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffff;
const isRange = (v) => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && v[0] <= v[1];
const need = (obj, keys, where) => { for (const k of keys) if (!obj || !(k in obj)) fail(`${where}: missing ${k}`); };

// classes
need(classes, ['maxLevel', 'statPointsPerLevel', 'skillPointsPerLevel', 'startZone', 'classes', 'unarmed', 'inventory', 'belt', 'goldCap', 'pickupRange', 'autoPickupRange', 'combat', 'xp', 'skillRules', 'skills'], 'classes');
need(classes.combat, ['armourPerLevel', 'armourCap', 'critBase', 'critPerDex', 'critCap', 'critMult', 'blockDexDivisor', 'blockCap', 'resCap', 'resFloor'], 'classes.combat');
for (const [k, v] of Object.entries(classes.combat || {})) if (!isNum(v)) fail(`classes.combat.${k} not a number`);
need(classes.xp, ['perLevelSq', 'monsterBase', 'monsterPerLevel', 'championMult', 'bossMult', 'penaltyFreeLevels', 'penaltyPerLevel', 'penaltyMin', 'coopPerPlayer'], 'classes.xp');
for (const [k, v] of Object.entries(classes.xp || {})) if (!isNum(v)) fail(`classes.xp.${k} not a number`);
need(classes.skillRules, ['rowUnlockLevels', 'maxRank', 'effectPerRank', 'manaPerRank', 'synergyPerPoint', 'swingSec', 'knockbackTicks', 'slots'], 'classes.skillRules');
if (!(Number.isInteger(classes.skillRules?.knockbackTicks) && classes.skillRules.knockbackTicks >= 1)) fail('classes.skillRules.knockbackTicks');
if (!recipes[classes.startZone]) fail(`classes.startZone ${classes.startZone} is not a zone`);
if (!isRange(classes.unarmed?.dmg) || !isNum(classes.unarmed?.speed) || !['str', 'dex'].includes(classes.unarmed?.scaling)) fail('classes.unarmed');
for (const k of ['w', 'h']) if (!Number.isInteger(classes.inventory?.[k]) || classes.inventory[k] < 1) fail(`classes.inventory.${k}`);
for (const k of ['slots', 'stack', 'cooldownSec']) if (!isNum(classes.belt?.[k]) || classes.belt[k] <= 0) fail(`classes.belt.${k}`);
for (const [id, c] of Object.entries(classes.classes)) {
  const w = 'classes.' + id;
  need(c, ['name', 'stats', 'life', 'mana', 'runSpeed', 'radius', 'palette', 'trees', 'weapon', 'weapons', 'startPotions'], w);
  if (!items.bases[c.weapon] || items.bases[c.weapon].slot !== 'weapon') fail(`${w}.weapon ${c.weapon} is not a weapon base`);
  for (const [pid, n] of Object.entries(c.startPotions || {})) {
    if (!items.potions[pid]) fail(`${w}.startPotions.${pid} is not a potion`);
    if (!Number.isInteger(n) || n < 0 || n > classes.belt.stack) fail(`${w}.startPotions.${pid} must be 0..belt.stack`);
  }
  for (const s of ['str', 'dex', 'vit', 'ene']) if (!isNum(c.stats?.[s])) fail(`${w}.stats.${s}`);
  for (const k of ['base', 'perLevel', 'perVit']) if (!isNum(c.life?.[k])) fail(`${w}.life.${k}`);
  for (const k of ['base', 'perLevel', 'perEne']) if (!isNum(c.mana?.[k])) fail(`${w}.mana.${k}`);
  for (const [k, v] of Object.entries(c.palette || {})) if (!isColour(v)) fail(`${w}.palette.${k} not a colour`);
  for (const t of c.trees || []) need(t, ['id', 'name'], w + '.trees');
  if (!Array.isArray(c.weapons) || !c.weapons.every(isStr)) fail(`${w}.weapons`);
  if (c.startSkill && classes.skills[c.startSkill]?.class !== id) fail(`${w}.startSkill ${c.startSkill} is not this class's skill`);
}

// skills
const KIND_FIELDS = {
  melee: ['cost', 'cooldown', 'shape', 'weaponPct', 'element', 'fx'],
  dash: ['cost', 'cooldown', 'shape', 'weaponPct', 'dashTicks', 'element', 'fx'],
  buff: ['cost', 'cooldown', 'duration', 'effect', 'fx'],
  strike: ['cost', 'cooldown', 'shape', 'weaponPct', 'stun', 'element', 'fx'],
  channel: ['costPerSec', 'cooldown', 'shape', 'weaponPct', 'tickEvery', 'moveMult', 'element', 'fx'],
  aoe: ['cost', 'cooldown', 'shape', 'weaponPct', 'knockback', 'element', 'fx'],
};
const SHAPE_FIELDS = { melee: ['arc', 'range'], dash: ['range', 'arc', 'hitRange'], strike: ['arc', 'range'], channel: ['radius'], aoe: ['radius', 'range'] };
const ELEMENTS = ['phys', ...DMG_ELEMENTS];
const maxRow = classes.skillRules?.rowUnlockLevels?.length || 6;
const rowsSeen = new Set();
for (const [id, s] of Object.entries(classes.skills || {})) {
  const w = 'skills.' + id;
  need(s, ['id', 'class', 'tree', 'row', 'name', 'kind', 'synergies', 'desc'], w);
  if (s.id !== id) fail(`${w}: id mismatch ${s.id}`);
  const cls = classes.classes[s.class];
  if (!cls) { fail(`${w}: unknown class ${s.class}`); continue; }
  if (!(cls.trees || []).some((t) => t.id === s.tree)) fail(`${w}: tree ${s.tree} is not in ${s.class}.trees`);
  if (!Number.isInteger(s.row) || s.row < 1 || s.row > maxRow) fail(`${w}: row ${s.row} outside 1..${maxRow}`);
  const key = `${s.class}/${s.tree}/${s.row}`;
  if (rowsSeen.has(key)) fail(`${w}: row ${s.row} of ${s.class}/${s.tree} used twice`); else rowsSeen.add(key);
  const fields = KIND_FIELDS[s.kind];
  if (!fields) { fail(`${w}: unknown kind ${s.kind}`); continue; }
  need(s, fields, w);
  for (const f of fields) if (f !== 'shape' && f !== 'effect' && f !== 'element' && f !== 'fx' && !isNum(s[f])) fail(`${w}.${f} not a number`);
  if (SHAPE_FIELDS[s.kind]) for (const f of SHAPE_FIELDS[s.kind]) if (!isNum(s.shape?.[f])) fail(`${w}.shape.${f}`);
  if ('element' in s && !ELEMENTS.includes(s.element)) fail(`${w}: element ${s.element}`);
  if (s.kind === 'buff' && (typeof s.effect !== 'object' || !Object.values(s.effect).every(isNum))) fail(`${w}.effect`);
  if (!isStr(s.fx)) fail(`${w}.fx`);
  if (!Array.isArray(s.synergies) || s.synergies.length > 2) fail(`${w}.synergies must list at most two skills`);
  for (const sid of s.synergies || []) {
    const t = classes.skills[sid];
    if (!t) fail(`${w}: synergy ${sid} does not exist`);
    else if (sid === id || t.class !== s.class || t.tree !== s.tree) fail(`${w}: synergy ${sid} is not another skill of the same tree`);
  }
}

// items
need(items, ['rarity', 'magic', 'rare', 'value', 'gamble', 'drop', 'ground', 'tiers', 'slots', 'bases', 'affixes', 'potions', 'dropTables', 'gold', 'rareNames', 'monsterArmourPerLevel'], 'items');
if (!isNum(items.drop?.baseLvlSlack)) fail('items.drop.baseLvlSlack');
for (const k of ['r', 'scatterRadius']) if (!isNum(items.ground?.[k]) || items.ground[k] <= 0) fail(`items.ground.${k}`);
if (!(Number.isInteger(items.ground?.scatterTries) && items.ground.scatterTries >= 1)) fail('items.ground.scatterTries');
const R = items.rarity || {};
for (const r of Object.keys(R.weights || {})) if (!isNum(R.weights[r]) || R.weights[r] < 0 || !R.order?.includes(r)) fail(`items.rarity.weights.${r}`);
for (const r of Object.keys(R.mfK || {})) if (!(r in (R.weights || {}))) fail(`items.rarity.mfK.${r} has no weight`);
for (const r of R.order || []) if (!isNum(R.valueMult?.[r]) || !isColour(R.colours?.[r])) fail(`items.rarity.valueMult/colours.${r}`);
for (const k of ['affixTierValue', 'sellPct', 'sellCap']) if (!isNum(items.value?.[k])) fail(`items.value.${k}`);
if (!(items.rare?.affixMin >= 1 && items.rare.affixMin <= items.rare.affixMax && items.rare.affixMax <= items.rare.maxPrefixes + items.rare.maxSuffixes)) fail('items.rare bounds');
const tiers = Object.entries(items.tiers || {});
tiers.forEach(([id, t], i) => {
  for (const k of ['minIlvl', 'mult', 'lvlReqAdd', 'valueMult']) if (!isNum(t[k])) fail(`items.tiers.${id}.${k}`);
  if (typeof t.name !== 'string') fail(`items.tiers.${id}.name`);
  if (i > 0 && !(t.minIlvl > tiers[i - 1][1].minIlvl)) fail(`items.tiers.${id}: minIlvl must ascend`);
});
if (!tiers.length || tiers[0][1].minIlvl > 1) fail('items.tiers: the first tier must start at ilvl 1');
if (!Array.isArray(items.slots) || !items.slots.every(isStr)) fail('items.slots');
for (const [id, b] of Object.entries(items.bases || {})) {
  const w = 'items.bases.' + id;
  need(b, ['id', 'name', 'slot', 'kind', 'size', 'lvlReq', 'reqs', 'value', 'weight'], w);
  if (b.id !== id) fail(`${w}: id mismatch ${b.id}`);
  if (!items.slots.includes(b.slot)) fail(`${w}: slot ${b.slot}`);
  if (!Array.isArray(b.size) || b.size.length !== 2 || !b.size.every((n) => Number.isInteger(n) && n >= 1)) fail(`${w}.size`);
  else if (b.size[0] > classes.inventory.w || b.size[1] > classes.inventory.h) fail(`${w}.size does not fit the inventory`);
  if (!Number.isInteger(b.lvlReq) || b.lvlReq < 1) fail(`${w}.lvlReq`);
  if (!isNum(b.reqs?.str) || !isNum(b.reqs?.dex)) fail(`${w}.reqs`);
  if (!isNum(b.value) || b.value <= 0) fail(`${w}.value`);
  if (!isNum(b.weight) || b.weight <= 0) fail(`${w}.weight`);
  const hasDmg = 'dmg' in b, hasArmour = 'armour' in b;
  if (hasDmg === hasArmour) fail(`${w}: needs exactly one of dmg or armour`);
  if (hasDmg) {
    if (!isRange(b.dmg)) fail(`${w}.dmg`);
    if (!isNum(b.speed) || b.speed <= 0) fail(`${w}.speed`);
    if (!['str', 'dex'].includes(b.scaling)) fail(`${w}.scaling`);
    if (![1, 2].includes(b.hands)) fail(`${w}.hands`);
    if (b.slot !== 'weapon') fail(`${w}: dmg on a non-weapon slot`);
  }
  if (hasArmour && !isRange(b.armour)) fail(`${w}.armour`);
  if ('block' in b && !(isNum(b.block) && b.block >= 0 && b.block <= 100)) fail(`${w}.block`);
}
const affixIds = new Set();
for (const a of items.affixes || []) {
  const w = 'items.affixes.' + (a.id || '?');
  need(a, ['id', 'kind', 'group', 'stat', 'name', 'slots', 'tiers'], w);
  if (affixIds.has(a.id)) fail(`${w}: duplicate id`); else affixIds.add(a.id);
  if (!['prefix', 'suffix'].includes(a.kind)) fail(`${w}: kind ${a.kind}`);
  if (!isStr(a.group)) fail(`${w}.group`);
  if (!AFFIX_STATS.includes(a.stat)) fail(`${w}: stat ${a.stat} is not read by deriveStats`);
  if (!isStr(a.name)) fail(`${w}.name`);
  if (!Array.isArray(a.slots) || !a.slots.length || !a.slots.every((s) => s === '*' || items.slots.includes(s))) fail(`${w}.slots`);
  if (!Array.isArray(a.tiers) || !a.tiers.length) { fail(`${w}.tiers`); continue; }
  a.tiers.forEach((t, i) => {
    if (!isNum(t.minIlvl) || !isNum(t.min) || !isNum(t.max) || !isNum(t.weight)) fail(`${w}.tiers[${i}]`);
    if (t.min > t.max) fail(`${w}.tiers[${i}]: min > max`);
    if (t.weight <= 0) fail(`${w}.tiers[${i}]: weight`);
    if (i > 0 && !(t.minIlvl > a.tiers[i - 1].minIlvl)) fail(`${w}.tiers[${i}]: minIlvl must ascend`);
  });
  if (a.tiers[0].minIlvl > 1) fail(`${w}: the first tier must be usable at ilvl 1`);
}
for (const [id, p] of Object.entries(items.potions || {})) {
  const w = 'items.potions.' + id;
  need(p, ['id', 'name', 'kind', 'amount', 'overSec', 'minIlvl', 'value', 'size', 'weight', 'colour'], w);
  if (p.id !== id) fail(`${w}: id mismatch`);
  if (!['life', 'mana'].includes(p.kind)) fail(`${w}.kind`);
  for (const k of ['amount', 'overSec', 'minIlvl', 'value', 'weight']) if (!isNum(p[k]) || p[k] <= 0) fail(`${w}.${k}`);
  if (!Array.isArray(p.size) || p.size.length !== 2) fail(`${w}.size`);
  if (!isColour(p.colour)) fail(`${w}.colour`);
}
for (const [id, t] of Object.entries(items.dropTables || {})) {
  const w = 'items.dropTables.' + id;
  need(t, ['id', 'picks', 'noDrop', 'weights', 'ilvlBonus'], w);
  if (t.id !== id) fail(`${w}: id mismatch`);
  if (!Number.isInteger(t.picks) || t.picks < 1) fail(`${w}.picks`);
  if (!isNum(t.noDrop) || t.noDrop < 0 || t.noDrop >= 1) fail(`${w}.noDrop`);
  if (!isNum(t.ilvlBonus)) fail(`${w}.ilvlBonus`);
  const keys = Object.keys(t.weights || {});
  if (!keys.length || !keys.every((k) => ['gold', 'potion', 'item'].includes(k) && isNum(t.weights[k]) && t.weights[k] >= 0)) fail(`${w}.weights`);
  const sum = keys.reduce((s, k) => s + t.weights[k], 0);
  if (Math.abs(sum - 1) > 0.001) fail(`${w}.weights sum to ${sum}, not 1`);
}
for (const r of Object.values(recipes)) if (r.dropTable && !items.dropTables?.[r.dropTable]) fail(`zone ${r.id}: dropTable ${r.dropTable} does not exist`);
if (!(isNum(items.gold?.perLevelMin) && isNum(items.gold?.perLevelMax) && items.gold.perLevelMin <= items.gold.perLevelMax && isNum(items.gold?.pileMin))) fail('items.gold');
for (const k of ['first', 'second']) if (!Array.isArray(items.rareNames?.[k]) || !items.rareNames[k].length || !items.rareNames[k].every(isStr)) fail(`items.rareNames.${k}`);
for (const [arch] of Object.entries(monsters.archetypes)) if (!isNum(items.monsterArmourPerLevel?.[arch])) fail(`items.monsterArmourPerLevel.${arch}`);

// monsters
need(monsters, ['curve', 'archetypes', 'families', 'types', 'modifiers'], 'monsters');
const cv = monsters.curve || {};
need(cv, ['hpBase', 'hpPerLevel', 'dmgBase', 'dmgPerLevel', 'dmgSpread', 'champion', 'boss', 'windup', 'attackEvery', 'leash', 'fleeBelow', 'sight', 'dieTicks', 'fleeSec', 'fleeArchetypes', 'rangedArchetypes', 'meleeReach', 'ranged', 'perExtraPlayer'], 'monsters.curve');
for (const k of ['hpBase', 'hpPerLevel', 'dmgBase', 'dmgPerLevel', 'dmgSpread', 'windup', 'attackEvery', 'leash', 'fleeBelow', 'sight', 'dieTicks', 'fleeSec', 'meleeReach']) if (!isNum(cv[k])) fail(`monsters.curve.${k}`);
for (const rank of ['champion', 'boss']) for (const k of ['hp', 'dmg', 'ilvl']) if (!isNum(cv[rank]?.[k])) fail(`monsters.curve.${rank}.${k}`);
for (const k of ['keepMin', 'keepMax', 'fireRange', 'arrowSpeed', 'arrowTtlTicks', 'arrowR']) if (!isNum(cv.ranged?.[k])) fail(`monsters.curve.ranged.${k}`);
for (const k of ['hp', 'dmg']) if (!isNum(cv.perExtraPlayer?.[k])) fail(`monsters.curve.perExtraPlayer.${k}`);
for (const k of ['fleeArchetypes', 'rangedArchetypes']) if (!Array.isArray(cv[k]) || !cv[k].every((a) => monsters.archetypes?.[a])) fail(`monsters.curve.${k} must list archetypes`);
for (const [id, a] of Object.entries(monsters.archetypes)) for (const k of ['hp', 'dmg', 'speed']) if (!isNum(a[k])) fail(`archetype ${id}.${k}`);
for (const [id, f] of Object.entries(monsters.families)) for (const [k, v] of Object.entries(f.palette || {})) if (!isColour(v)) fail(`family ${id}.palette.${k}`);
for (const [id, t] of Object.entries(monsters.types)) {
  const w = 'monsters.types.' + id;
  need(t, ['name', 'family', 'arch', 'rig', 'size', 'r'], w);
  if (!monsters.families[t.family]) fail(`${w}: unknown family ${t.family}`);
  if (!monsters.archetypes[t.arch]) fail(`${w}: unknown archetype ${t.arch}`);
  if (!['biped', 'quad', 'bird'].includes(t.rig)) fail(`${w}: unknown rig ${t.rig}`);
  if (t.palette) for (const [k, v] of Object.entries(t.palette)) if (!isColour(v)) fail(`${w}.palette.${k}`);
}
for (const [id, m] of Object.entries(monsters.modifiers)) if (!m.name) fail(`modifier ${id}: missing name`);

// zones
for (const [id, r] of Object.entries(recipes)) {
  const w = 'zone ' + id;
  need(r, ['id', 'name', 'kind', 'size', 'biome', 'terrain', 'spawns', 'exits', 'level', 'dropTable'], w);
  if (r.id !== id) fail(`${w}: id mismatch ${r.id}`);
  if (!['wilderness', 'cave', 'crypt', 'town'].includes(r.kind)) fail(`${w}: kind ${r.kind}`);
  if (!Number.isInteger(r.size) || r.size % 32 !== 0) fail(`${w}: size must be a multiple of 32`);
  need(r.biome, ['sky', 'fog', 'sun', 'hemi', 'ground', 'props', 'exitProp'], w + '.biome');
  for (const [k, v] of Object.entries(r.biome.ground || {})) if (!isColour(v)) fail(`${w}.biome.ground.${k}`);
  for (const p of r.biome.props || []) {
    need(p, ['kind', 'density', 'r', 'variants'], w + '.biome.props');
    if (p.density < 0 || p.density > 0.2) fail(`${w}: prop ${p.kind} density ${p.density}`);
  }
  need(r.terrain, ['scale', 'octaves', 'amp', 'waterLine', 'cliffSlope', 'padRadius', 'padFalloff', 'pathWidth', 'pathWander', 'pathDamp', 'pathFalloff'], w + '.terrain');
  need(r.spawns, ['types', 'cellSize', 'packMin', 'packMax', 'championChance', 'minDistFromSpawn', 'packRadius'], w + '.spawns');
  for (const t of r.spawns.types || []) if (!monsters.types[t]) fail(`${w}: spawn type ${t} is not in monsters.types`);
  if (r.spawns.packMin > r.spawns.packMax) fail(`${w}: packMin > packMax`);
  if (!Array.isArray(r.exits) || r.exits.length < 1) fail(`${w}: needs at least one exit (the entrance)`);
  for (const e of r.exits || []) {
    need(e, ['to', 'side'], w + '.exits');
    if (!['north', 'south', 'east', 'west'].includes(e.side)) fail(`${w}: exit side ${e.side}`);
  }
  for (const d of ['dusk', 'blight', 'hollow']) {
    const band = r.level?.[d];
    if (!Array.isArray(band) || band.length !== 2 || band[0] > band[1]) fail(`${w}.level.${d}`);
  }
}

if (errors.length) {
  console.error('validate: ' + errors.length + ' problem(s)');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`validate: ok (${Object.keys(classes.classes).length} classes, ${Object.keys(classes.skills).length} skills, ${Object.keys(items.bases).length} bases, ${items.affixes.length} affixes, ${Object.keys(items.potions).length} potions, ${Object.keys(items.dropTables).length} drop tables, ${Object.keys(monsters.types).length} monster types, ${Object.keys(recipes).length} zones)`);
