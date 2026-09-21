// shared/data/items.js — bases, affixes, potions, rarity, drop tables, naming. P1 set.
// Every number that sim/itemgen.js or sim/stats.js uses lives here.
export default {
  rarity: {
    order: ['normal', 'magic', 'rare', 'unique', 'set'],
    weights: { normal: 72, magic: 20, rare: 6, unique: 2 }, // unique falls to rare until P4
    mfK: { magic: 1, rare: 0.6, unique: 0.35 },
    valueMult: { normal: 1, magic: 3, rare: 8, unique: 20, set: 20 },
    colours: { normal: 0xbdbdbd, magic: 0x6f8fff, rare: 0xffd54a, unique: 0xc9a227, set: 0x4fd66b },
    uniquesShip: 'P4',
  },
  magic: { prefixChance: 0.5, suffixChance: 0.5, atLeastOne: true },
  rare: { affixMin: 3, affixMax: 6, maxPrefixes: 3, maxSuffixes: 3 },
  ilvl: { champion: 2, boss: 4 },
  value: { affixTierValue: 15, sellPct: 25, sellCap: 3000 },
  gamble: { costPerLevel: 40, mfBonus: 100, ships: 'P4' },
  // Tiers scale bases with difficulty; picked by ilvl.
  tiers: {
    crude:    { minIlvl: 1,  mult: 1.0, lvlReqAdd: 0,  valueMult: 1, name: '' },
    tempered: { minIlvl: 14, mult: 1.8, lvlReqAdd: 12, valueMult: 3, name: 'Tempered ' },
    hallowed: { minIlvl: 26, mult: 2.8, lvlReqAdd: 22, valueMult: 8, name: 'Hallowed ' },
  },
  slots: ['weapon', 'shield', 'helm', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring1', 'ring2'],
  // size is [w,h] inventory cells. speed multiplies attacks per second. scaling picks the stat.
  bases: {
    dagger:       { id: 'dagger', name: 'Dagger', slot: 'weapon', kind: 'dagger', hands: 1, size: [1, 2], lvlReq: 1, reqs: { str: 0, dex: 10 }, dmg: [2, 5],  speed: 1.15, scaling: 'str', value: 8,  weight: 10 },
    sword:        { id: 'sword', name: 'Sword', slot: 'weapon', kind: 'sword', hands: 1, size: [1, 3], lvlReq: 1, reqs: { str: 15, dex: 0 }, dmg: [4, 9],  speed: 1.0,  scaling: 'str', value: 15, weight: 12 },
    axe:          { id: 'axe', name: 'Axe', slot: 'weapon', kind: 'axe', hands: 1, size: [2, 3], lvlReq: 3, reqs: { str: 22, dex: 0 }, dmg: [6, 14], speed: 0.85, scaling: 'str', value: 20, weight: 9 },
    mace:         { id: 'mace', name: 'Mace', slot: 'weapon', kind: 'mace', hands: 1, size: [1, 3], lvlReq: 2, reqs: { str: 18, dex: 0 }, dmg: [5, 11], speed: 0.9,  scaling: 'str', value: 16, weight: 10 },
    spear:        { id: 'spear', name: 'Spear', slot: 'weapon', kind: 'spear', hands: 2, size: [2, 4], lvlReq: 5, reqs: { str: 20, dex: 12 }, dmg: [9, 20], speed: 0.8, scaling: 'str', value: 28, weight: 6 },
    bow:          { id: 'bow', name: 'Bow', slot: 'weapon', kind: 'bow', hands: 2, size: [2, 3], lvlReq: 3, reqs: { str: 0, dex: 20 }, dmg: [3, 10], speed: 1.0, scaling: 'dex', ranged: true, value: 18, weight: 7 },
    staff:        { id: 'staff', name: 'Staff', slot: 'weapon', kind: 'staff', hands: 2, size: [1, 4], lvlReq: 1, reqs: { str: 0, dex: 0 }, dmg: [4, 10], speed: 0.9, scaling: 'str', value: 14, weight: 6 },
    wand:         { id: 'wand', name: 'Wand', slot: 'weapon', kind: 'wand', hands: 1, size: [1, 2], lvlReq: 1, reqs: { str: 0, dex: 0 }, dmg: [2, 4],  speed: 1.1, scaling: 'str', value: 12, weight: 6 },
    shield:       { id: 'shield', name: 'Shield', slot: 'shield', kind: 'shield', size: [2, 3], lvlReq: 1, reqs: { str: 12, dex: 0 }, armour: [6, 12], block: 20, value: 14, weight: 10 },
    cap:          { id: 'cap', name: 'Cap', slot: 'helm', kind: 'helm', size: [2, 2], lvlReq: 1, reqs: { str: 0, dex: 0 }, armour: [3, 6],  value: 8,  weight: 12 },
    leatherChest: { id: 'leatherChest', name: 'Leather Jerkin', slot: 'chest', kind: 'chest', size: [2, 3], lvlReq: 1, reqs: { str: 10, dex: 0 }, armour: [8, 16], value: 12, weight: 12 },
    boots:        { id: 'boots', name: 'Boots', slot: 'boots', kind: 'boots', size: [2, 2], lvlReq: 1, reqs: { str: 0, dex: 0 }, armour: [2, 5],  value: 8,  weight: 12 },
  },
  // Affixes: one per group per item. tiers usable when ilvl >= minIlvl; weight picks among usable tiers.
  // stat keys are read by sim/stats.js: flat values add, pct values add as percent points.
  affixes: [
    { id: 'jagged',    kind: 'prefix', group: 'phys',      stat: 'flatPhys',  name: 'Jagged',    slots: ['weapon'], tiers: [{ minIlvl: 1, min: 1, max: 3, weight: 5 }, { minIlvl: 8, min: 3, max: 6, weight: 3 }, { minIlvl: 16, min: 6, max: 10, weight: 2 }] },
    { id: 'brutal',    kind: 'prefix', group: 'pctdmg',    stat: 'pctDmg',    name: 'Brutal',    slots: ['weapon'], tiers: [{ minIlvl: 1, min: 10, max: 20, weight: 5 }, { minIlvl: 8, min: 20, max: 35, weight: 3 }, { minIlvl: 16, min: 35, max: 50, weight: 2 }] },
    { id: 'hale',      kind: 'prefix', group: 'life',      stat: 'life',      name: 'Hale',      slots: ['*'],      tiers: [{ minIlvl: 1, min: 5, max: 15, weight: 5 }, { minIlvl: 8, min: 15, max: 30, weight: 3 }, { minIlvl: 16, min: 30, max: 50, weight: 2 }] },
    { id: 'lucid',     kind: 'prefix', group: 'mana',      stat: 'mana',      name: 'Lucid',     slots: ['*'],      tiers: [{ minIlvl: 1, min: 5, max: 12, weight: 5 }, { minIlvl: 8, min: 12, max: 25, weight: 3 }, { minIlvl: 16, min: 25, max: 40, weight: 2 }] },
    { id: 'plated',    kind: 'prefix', group: 'armour',    stat: 'armour',    name: 'Plated',    slots: ['shield', 'helm', 'chest', 'gloves', 'boots', 'belt'], tiers: [{ minIlvl: 1, min: 5, max: 15, weight: 5 }, { minIlvl: 8, min: 15, max: 30, weight: 3 }, { minIlvl: 16, min: 30, max: 50, weight: 2 }] },
    { id: 'bulwark',   kind: 'prefix', group: 'pctarmour', stat: 'pctArmour', name: "Bulwark's", slots: ['shield', 'helm', 'chest', 'gloves', 'boots', 'belt'], tiers: [{ minIlvl: 1, min: 10, max: 20, weight: 5 }, { minIlvl: 8, min: 20, max: 40, weight: 3 }, { minIlvl: 16, min: 40, max: 60, weight: 2 }] },
    { id: 'searing',   kind: 'prefix', group: 'fire',      stat: 'fireDmg',   name: 'Searing',   slots: ['weapon'], tiers: [{ minIlvl: 1, min: 1, max: 4, weight: 5 }, { minIlvl: 8, min: 4, max: 9, weight: 3 }, { minIlvl: 16, min: 9, max: 16, weight: 2 }] },
    { id: 'rimed',     kind: 'prefix', group: 'cold',      stat: 'coldDmg',   name: 'Rimed',     slots: ['weapon'], tiers: [{ minIlvl: 1, min: 1, max: 4, weight: 5 }, { minIlvl: 8, min: 4, max: 9, weight: 3 }, { minIlvl: 16, min: 9, max: 16, weight: 2 }] },
    { id: 'charged',   kind: 'prefix', group: 'light',     stat: 'lightDmg',  name: 'Charged',   slots: ['weapon'], tiers: [{ minIlvl: 1, min: 1, max: 5, weight: 5 }, { minIlvl: 8, min: 3, max: 11, weight: 3 }, { minIlvl: 16, min: 6, max: 20, weight: 2 }] },
    { id: 'venomed',   kind: 'prefix', group: 'poison',    stat: 'poisonDmg', name: 'Venomed',   slots: ['weapon'], tiers: [{ minIlvl: 1, min: 1, max: 4, weight: 5 }, { minIlvl: 8, min: 4, max: 9, weight: 3 }, { minIlvl: 16, min: 9, max: 16, weight: 2 }] },
    { id: 'fortunate', kind: 'prefix', group: 'mf',        stat: 'mf',        name: 'Fortunate', slots: ['*'],      tiers: [{ minIlvl: 1, min: 5, max: 10, weight: 5 }, { minIlvl: 8, min: 10, max: 20, weight: 3 }, { minIlvl: 16, min: 20, max: 35, weight: 2 }] },
    { id: 'gilded',    kind: 'prefix', group: 'gold',      stat: 'goldFind',  name: 'Gilded',    slots: ['*'],      tiers: [{ minIlvl: 1, min: 10, max: 25, weight: 5 }, { minIlvl: 8, min: 25, max: 50, weight: 3 }, { minIlvl: 16, min: 50, max: 80, weight: 2 }] },
    { id: 'keen',      kind: 'prefix', group: 'crit',      stat: 'crit',      name: 'Keen',      slots: ['weapon', 'amulet', 'ring1', 'ring2'], tiers: [{ minIlvl: 1, min: 1, max: 2, weight: 5 }, { minIlvl: 8, min: 2, max: 4, weight: 3 }, { minIlvl: 16, min: 4, max: 6, weight: 2 }] },
    { id: 'ox',        kind: 'suffix', group: 'str',       stat: 'str',       name: 'of the Ox',   slots: ['*'], tiers: [{ minIlvl: 1, min: 1, max: 3, weight: 5 }, { minIlvl: 8, min: 3, max: 6, weight: 3 }, { minIlvl: 16, min: 6, max: 10, weight: 2 }] },
    { id: 'fox',       kind: 'suffix', group: 'dex',       stat: 'dex',       name: 'of the Fox',  slots: ['*'], tiers: [{ minIlvl: 1, min: 1, max: 3, weight: 5 }, { minIlvl: 8, min: 3, max: 6, weight: 3 }, { minIlvl: 16, min: 6, max: 10, weight: 2 }] },
    { id: 'boar',      kind: 'suffix', group: 'vit',       stat: 'vit',       name: 'of the Boar', slots: ['*'], tiers: [{ minIlvl: 1, min: 1, max: 3, weight: 5 }, { minIlvl: 8, min: 3, max: 6, weight: 3 }, { minIlvl: 16, min: 6, max: 10, weight: 2 }] },
    { id: 'owl',       kind: 'suffix', group: 'ene',       stat: 'ene',       name: 'of the Owl',  slots: ['*'], tiers: [{ minIlvl: 1, min: 1, max: 3, weight: 5 }, { minIlvl: 8, min: 3, max: 6, weight: 3 }, { minIlvl: 16, min: 6, max: 10, weight: 2 }] },
    { id: 'embers',    kind: 'suffix', group: 'resfire',   stat: 'fireRes',   name: 'of Embers',   slots: ['*'], tiers: [{ minIlvl: 1, min: 5, max: 10, weight: 5 }, { minIlvl: 8, min: 10, max: 20, weight: 3 }, { minIlvl: 16, min: 20, max: 30, weight: 2 }] },
    { id: 'frost',     kind: 'suffix', group: 'rescold',   stat: 'coldRes',   name: 'of Frost',    slots: ['*'], tiers: [{ minIlvl: 1, min: 5, max: 10, weight: 5 }, { minIlvl: 8, min: 10, max: 20, weight: 3 }, { minIlvl: 16, min: 20, max: 30, weight: 2 }] },
    { id: 'storms',    kind: 'suffix', group: 'reslight',  stat: 'lightRes',  name: 'of Storms',   slots: ['*'], tiers: [{ minIlvl: 1, min: 5, max: 10, weight: 5 }, { minIlvl: 8, min: 10, max: 20, weight: 3 }, { minIlvl: 16, min: 20, max: 30, weight: 2 }] },
    { id: 'bile',      kind: 'suffix', group: 'respoison', stat: 'poisonRes', name: 'of Bile',     slots: ['*'], tiers: [{ minIlvl: 1, min: 5, max: 10, weight: 5 }, { minIlvl: 8, min: 10, max: 20, weight: 3 }, { minIlvl: 16, min: 20, max: 30, weight: 2 }] },
    { id: 'wards',     kind: 'suffix', group: 'resall',    stat: 'allRes',    name: 'of Wards',    slots: ['*'], tiers: [{ minIlvl: 1, min: 3, max: 6, weight: 5 }, { minIlvl: 8, min: 6, max: 10, weight: 3 }, { minIlvl: 16, min: 10, max: 15, weight: 2 }] },
    { id: 'haste',     kind: 'suffix', group: 'ias',       stat: 'ias',       name: 'of Haste',    slots: ['weapon', 'gloves'], tiers: [{ minIlvl: 1, min: 5, max: 10, weight: 5 }, { minIlvl: 8, min: 10, max: 15, weight: 3 }, { minIlvl: 16, min: 15, max: 20, weight: 2 }] },
    { id: 'quickening', kind: 'suffix', group: 'fcr',      stat: 'fcr',       name: 'of Quickening', slots: ['weapon', 'amulet', 'ring1', 'ring2', 'helm'], tiers: [{ minIlvl: 1, min: 5, max: 10, weight: 5 }, { minIlvl: 8, min: 10, max: 15, weight: 3 }, { minIlvl: 16, min: 15, max: 20, weight: 2 }] },
    { id: 'hare',      kind: 'suffix', group: 'frw',       stat: 'frw',       name: 'of the Hare', slots: ['boots'], tiers: [{ minIlvl: 1, min: 5, max: 10, weight: 5 }, { minIlvl: 8, min: 10, max: 15, weight: 3 }, { minIlvl: 16, min: 15, max: 20, weight: 2 }] },
    { id: 'leeching',  kind: 'suffix', group: 'loh',       stat: 'lifeOnHit', name: 'of Leeching', slots: ['weapon', 'ring1', 'ring2'], tiers: [{ minIlvl: 1, min: 1, max: 2, weight: 5 }, { minIlvl: 8, min: 2, max: 4, weight: 3 }, { minIlvl: 16, min: 4, max: 6, weight: 2 }] },
    { id: 'reaping',   kind: 'suffix', group: 'mok',       stat: 'manaOnKill', name: 'of Reaping', slots: ['weapon', 'ring1', 'ring2'], tiers: [{ minIlvl: 1, min: 1, max: 2, weight: 5 }, { minIlvl: 8, min: 2, max: 3, weight: 3 }, { minIlvl: 16, min: 3, max: 5, weight: 2 }] },
  ],
  // Potions are items with slot 'potion', stackable; the belt holds one kind+size per slot.
  potions: {
    lifeMinor:   { id: 'lifeMinor',   name: 'Minor Life Potion',   kind: 'life', amount: 40,  overSec: 2, minIlvl: 1,  value: 5,  size: [1, 1], weight: 6, colour: 0xc0392b },
    lifeLight:   { id: 'lifeLight',   name: 'Light Life Potion',   kind: 'life', amount: 90,  overSec: 2, minIlvl: 8,  value: 12, size: [1, 1], weight: 4, colour: 0xe74c3c },
    lifeGreater: { id: 'lifeGreater', name: 'Greater Life Potion', kind: 'life', amount: 200, overSec: 2, minIlvl: 16, value: 30, size: [1, 1], weight: 2, colour: 0xff6b5b },
    manaMinor:   { id: 'manaMinor',   name: 'Minor Mana Potion',   kind: 'mana', amount: 20,  overSec: 2, minIlvl: 1,  value: 5,  size: [1, 1], weight: 6, colour: 0x2e86c1 },
    manaLight:   { id: 'manaLight',   name: 'Light Mana Potion',   kind: 'mana', amount: 50,  overSec: 2, minIlvl: 8,  value: 12, size: [1, 1], weight: 4, colour: 0x3498db },
    manaGreater: { id: 'manaGreater', name: 'Greater Mana Potion', kind: 'mana', amount: 120, overSec: 2, minIlvl: 16, value: 30, size: [1, 1], weight: 2, colour: 0x5dade2 },
  },
  // Drop tables: picks rolls, each roll is nothing with noDrop else one of the weighted kinds.
  dropTables: {
    moorBasic: { id: 'moorBasic', picks: 1, noDrop: 0.55, weights: { gold: 0.5, potion: 0.2, item: 0.3 }, ilvlBonus: 0 },
    champion:  { id: 'champion',  picks: 3, noDrop: 0.15, weights: { gold: 0.4, potion: 0.2, item: 0.4 }, ilvlBonus: 0 },
    boss:      { id: 'boss',      picks: 6, noDrop: 0.0,  weights: { gold: 0.3, potion: 0.2, item: 0.5 }, ilvlBonus: 0 },
  },
  gold: { perLevelMin: 3, perLevelMax: 8, pileMin: 2 },
  // Rare item names: <first> <second>
  rareNames: {
    first: ['Doom', 'Grim', 'Bone', 'Storm', 'Raven', 'Blood', 'Iron', 'Shadow', 'Wolf', 'Gallows', 'Ash', 'Salt', 'Hollow', 'Night', 'Crow'],
    second: ['Bite', 'Song', 'Brand', 'Fang', 'Mark', 'Ward', 'Edge', 'Howl', 'Grasp', 'Shroud', 'Spur', 'Tooth', 'Knell', 'Whisper', 'Hide'],
  },
  // Monster defence in P1 (no resists yet): armour per level by archetype.
  monsterArmourPerLevel: { rusher: 4, swarm: 2, ranged: 3, caster: 2, tank: 6 },
};
