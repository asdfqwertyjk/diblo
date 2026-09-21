// shared/data/monsters.js — families, archetypes, curve, types, champion modifiers.
export default {
  curve: {
    hpBase: 15, hpPerLevel: 10, dmgBase: 3, dmgPerLevel: 1.6,
    champion: { hp: 3.5, dmg: 1.5, ilvl: 2 }, boss: { hp: 15, dmg: 2, ilvl: 4 },
    windup: 0.5, attackEvery: 1.2, leash: 30, fleeBelow: 0.2,
    perExtraPlayer: { hp: 0.5, dmg: 0.1 },
  },
  archetypes: {
    rusher: { hp: 1.0, dmg: 1.0, speed: 4.5 },
    swarm:  { hp: 0.5, dmg: 0.6, speed: 5.5 },
    ranged: { hp: 0.8, dmg: 0.9, speed: 4.5 },
    caster: { hp: 0.7, dmg: 1.2, speed: 4.5 },
    tank:   { hp: 2.2, dmg: 1.3, speed: 3.2 },
  },
  families: {
    beast:  { palette: { body: 0x6b5138, belly: 0x3e2f22, eyes: 0xd7b04a, trim: 0x2a2018 } },
    undead: { palette: { body: 0xb9b3a0, belly: 0x6e6a5c, eyes: 0x8cf0a0, trim: 0x3a3830 } },
    bandit: { palette: { body: 0x7a3f2e, belly: 0x2e2a26, eyes: 0xe8d9c0, trim: 0x8c7a4a, skin: 0xc79a70 } },
    demon:  { palette: { body: 0x7d1f2a, belly: 0x2a0d12, eyes: 0xffb347, trim: 0x1a0a0a } },
  },
  // rig: biped | quad | bird. size scales the rig. r is the collision radius.
  types: {
    gallowswolf:   { name: 'Gallows Wolf',   family: 'beast',  arch: 'rusher', rig: 'quad',  size: 0.9,  r: 0.45,
                     palette: { body: 0x4d4a4a, belly: 0x2b2828, eyes: 0xe0c060, trim: 0x1c1a1a } },
    carrioncrow:   { name: 'Carrion Crow',   family: 'beast',  arch: 'swarm',  rig: 'bird',  size: 0.55, r: 0.3,
                     palette: { body: 0x1a1a22, belly: 0x0e0e12, eyes: 0xd9d9d9, trim: 0x3a3a44 } },
    moorcutthroat: { name: 'Moor Cutthroat', family: 'bandit', arch: 'rusher', rig: 'biped', size: 1.0,  r: 0.4, weapon: 'axe' },
    moorpoacher:   { name: 'Moor Poacher',   family: 'bandit', arch: 'ranged', rig: 'biped', size: 0.95, r: 0.4, weapon: 'bow' },
  },
  // Data only until P4; the schema is fixed now so tables validate early.
  modifiers: {
    swift:  { name: 'Swift',  moveMult: 1.4, attackMult: 1.4 },
    brutal: { name: 'Brutal', dmgMult: 1.6 },
    hexer:  { name: 'Hexer',  onHit: { allRes: -25, seconds: 8 } },
    ember:  { name: 'Ember',  aura: { element: 'fire', dps: 4, radius: 3 }, deathBurst: true },
    blink:  { name: 'Blink',  teleportEvery: 6 },
    wraith: { name: 'Wraith', ignoreArmour: true },
    stone:  { name: 'Stone',  hpMult: 2.0, moveMult: 0.8 },
    mender: { name: 'Mender', packHealPct: 5 },
  },
};
