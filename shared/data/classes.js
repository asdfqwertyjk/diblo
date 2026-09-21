// shared/data/classes.js — classes, base stats, vitals. Skill trees arrive in P1.
// Numbers here are the single source; sim code reads them, never restates them.
export default {
  maxLevel: 30,
  statPointsPerLevel: 5,
  skillPointsPerLevel: 1,
  startZone: 'gallowsmoor', // P0: no town yet; P2 switches this to 'town'
  classes: {
    warrior: {
      name: 'Warrior', role: 'melee', ships: 'P1',
      stats: { str: 25, dex: 15, vit: 20, ene: 10 },
      life: { base: 60, perLevel: 10, perVit: 3 },
      mana: { base: 15, perLevel: 1, perEne: 1, label: 'Fury' },
      runSpeed: 6, radius: 0.4, weapon: 'sword',
      palette: { skin: 0xd8a678, hair: 0x3a2618, cloth: 0x6b2a1e, armour: 0x6e6e78, trim: 0xc8a24a, weapon: 0xb8bcc4 },
      trees: [{ id: 'onslaught', name: 'Onslaught' }],
    },
    paladin: {
      name: 'Paladin', role: 'holy melee', ships: 'P4',
      stats: { str: 20, dex: 10, vit: 25, ene: 15 },
      life: { base: 55, perLevel: 9, perVit: 3 },
      mana: { base: 20, perLevel: 2, perEne: 1.5, label: 'Mana' },
      runSpeed: 6, radius: 0.4, weapon: 'mace',
      palette: { skin: 0xe3b48e, hair: 0xd9c48a, cloth: 0xf0e6c8, armour: 0xa6a9b3, trim: 0xd4af37, weapon: 0xc9ccd2 },
      trees: [],
    },
    rogue: {
      name: 'Rogue', role: 'ranged', ships: 'P4',
      stats: { str: 15, dex: 30, vit: 15, ene: 10 },
      life: { base: 45, perLevel: 7, perVit: 2 },
      mana: { base: 20, perLevel: 2, perEne: 1.5, label: 'Mana' },
      runSpeed: 6.5, radius: 0.4, weapon: 'bow',
      palette: { skin: 0xc9956b, hair: 0x1e1a18, cloth: 0x2f4a2b, armour: 0x4a3a2a, trim: 0x8a8a5a, weapon: 0x7a5a3a },
      trees: [],
    },
    cleric: {
      name: 'Cleric', role: 'holy caster', ships: 'P4',
      stats: { str: 15, dex: 10, vit: 20, ene: 25 },
      life: { base: 45, perLevel: 7, perVit: 2 },
      mana: { base: 30, perLevel: 2, perEne: 2.5, label: 'Mana' },
      runSpeed: 6, radius: 0.4, weapon: 'staff',
      palette: { skin: 0xd8b294, hair: 0x6a5a4a, cloth: 0x3a3a5c, armour: 0x5a5a6c, trim: 0xe0d6a8, weapon: 0x8a6a3a },
      trees: [],
    },
    wizard: {
      name: 'Wizard', role: 'elemental caster', ships: 'P4',
      stats: { str: 10, dex: 15, vit: 15, ene: 30 },
      life: { base: 40, perLevel: 6, perVit: 2 },
      mana: { base: 35, perLevel: 3, perEne: 3, label: 'Mana' },
      runSpeed: 6, radius: 0.4, weapon: 'wand',
      palette: { skin: 0xd6b6a0, hair: 0x2a2038, cloth: 0x4a1f5c, armour: 0x2e2a44, trim: 0x9a7ad0, weapon: 0x5a4a8a },
      trees: [],
    },
  },
};
