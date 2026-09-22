// shared/data/classes.js — classes, base stats, vitals, skill rules and skill rows.
// Numbers here are the single source; sim code reads them, never restates them.
export default {
  maxLevel: 30,
  statPointsPerLevel: 5,
  skillPointsPerLevel: 1,
  startZone: 'gallowsmoor', // P0/P1: no town yet; P2 switches this to 'town'
  unarmed: { dmg: [1, 3], speed: 1.0, scaling: 'str' },
  inventory: { w: 10, h: 6 },
  stash: { w: 10, h: 10 },
  belt: { slots: 4, stack: 10, cooldownSec: 1 },
  goldCap: 999999,
  deathGoldLossPct: 10,
  respawnAfterSec: 5,
  regen: { lifePctPerSec: 1, lifeAfterSec: 5, manaBase: 1, manaPerEne: 1 / 40 },
  pickupRange: 3,
  autoPickupRange: 1.2,
  xpShareRange: 40,
  // Combat rules (CLAUDE.md "Combat"); sim/combat.js and sim/stats.js read these.
  combat: {
    armourPerLevel: 25,     // DR = armour / (armour + armourPerLevel·attackerLevel)
    armourCap: 0.6,
    critBase: 5,            // crit% = critBase + dex·critPerDex + affix crit, capped
    critPerDex: 0.1,
    critCap: 50,            // percent
    critMult: 1.5,
    blockDexDivisor: 40,    // block% = shield.block + dex/blockDexDivisor, capped
    blockCap: 50,           // percent
    resCap: 75,             // percent
    resFloor: -100,
  },
  // XP rules (CLAUDE.md "XP"); sim/xp.js reads these.
  xp: {
    perLevelSq: 100,        // xpToNext(L) = perLevelSq·L²
    monsterBase: 20,        // monsterXp = monsterBase·mlvl·(1 + monsterPerLevel·mlvl)
    monsterPerLevel: 0.1,
    championMult: 3,
    bossMult: 20,
    penaltyFreeLevels: 5,   // no penalty while clvl − mlvl ≤ this
    penaltyPerLevel: 0.1,   // then −penaltyPerLevel per level of difference beyond it
    penaltyMin: 0.05,
    coopPerPlayer: 0.15,    // × (1 + coopPerPlayer·(playersInGame − 1))
  },
  // Skill rules (see CLAUDE.md "Skill rules")
  skillRules: {
    rowUnlockLevels: [1, 3, 6, 9, 12, 18],
    maxRank: 10,
    effectPerRank: 0.12,
    manaPerRank: 1,
    synergyPerPoint: 0.08,
    swingSec: 0.5,          // base attack lock for melee skills at weapon speed 1.0
    knockbackTicks: 4,      // ticks a knockback slides over
    slots: ['lmb', 'rmb', 'k1', 'k2', 'k3', 'k4'],
  },
  classes: {
    warrior: {
      name: 'Warrior', role: 'melee', ships: 'P1',
      stats: { str: 25, dex: 15, vit: 20, ene: 10 },
      life: { base: 60, perLevel: 10, perVit: 3 },
      mana: { base: 15, perLevel: 1, perEne: 1, label: 'Fury' },
      runSpeed: 6, radius: 0.4, weapon: 'sword', startPotions: { lifeMinor: 4 },
      weapons: ['dagger', 'sword', 'axe', 'mace', 'spear'],
      palette: { skin: 0xd8a678, hair: 0x3a2618, cloth: 0x6b2a1e, armour: 0x6e6e78, trim: 0xc8a24a, weapon: 0xb8bcc4 },
      startSkill: 'cleave',
      trees: [
        { id: 'onslaught', name: 'Onslaught', ships: 'P1' },
        { id: 'ironhide', name: 'Ironhide', ships: 'P2' },
        { id: 'warbringer', name: 'Warbringer', ships: 'P2' },
      ],
    },
    paladin: {
      name: 'Paladin', role: 'holy melee', ships: 'P4',
      stats: { str: 20, dex: 10, vit: 25, ene: 15 },
      life: { base: 55, perLevel: 9, perVit: 3 },
      mana: { base: 20, perLevel: 2, perEne: 1.5, label: 'Mana' },
      runSpeed: 6, radius: 0.4, weapon: 'mace', startPotions: { lifeMinor: 4 },
      weapons: ['sword', 'mace', 'axe', 'spear'],
      palette: { skin: 0xe3b48e, hair: 0xd9c48a, cloth: 0xf0e6c8, armour: 0xa6a9b3, trim: 0xd4af37, weapon: 0xc9ccd2 },
      startSkill: null, trees: [],
    },
    rogue: {
      name: 'Rogue', role: 'ranged', ships: 'P4',
      stats: { str: 15, dex: 30, vit: 15, ene: 10 },
      life: { base: 45, perLevel: 7, perVit: 2 },
      mana: { base: 20, perLevel: 2, perEne: 1.5, label: 'Mana' },
      runSpeed: 6.5, radius: 0.4, weapon: 'bow', startPotions: { lifeMinor: 4 },
      weapons: ['dagger', 'sword', 'bow'],
      palette: { skin: 0xc9956b, hair: 0x1e1a18, cloth: 0x2f4a2b, armour: 0x4a3a2a, trim: 0x8a8a5a, weapon: 0x7a5a3a },
      startSkill: null, trees: [],
    },
    cleric: {
      name: 'Cleric', role: 'holy caster', ships: 'P4',
      stats: { str: 15, dex: 10, vit: 20, ene: 25 },
      life: { base: 45, perLevel: 7, perVit: 2 },
      mana: { base: 30, perLevel: 2, perEne: 2.5, label: 'Mana' },
      runSpeed: 6, radius: 0.4, weapon: 'staff', startPotions: { lifeMinor: 4 },
      weapons: ['mace', 'staff', 'wand'],
      palette: { skin: 0xd8b294, hair: 0x6a5a4a, cloth: 0x3a3a5c, armour: 0x5a5a6c, trim: 0xe0d6a8, weapon: 0x8a6a3a },
      startSkill: null, trees: [],
    },
    wizard: {
      name: 'Wizard', role: 'elemental caster', ships: 'P4',
      stats: { str: 10, dex: 15, vit: 15, ene: 30 },
      life: { base: 40, perLevel: 6, perVit: 2 },
      mana: { base: 35, perLevel: 3, perEne: 3, label: 'Mana' },
      runSpeed: 6, radius: 0.4, weapon: 'wand', startPotions: { lifeMinor: 4 },
      weapons: ['dagger', 'staff', 'wand'],
      palette: { skin: 0xd6b6a0, hair: 0x2a2038, cloth: 0x4a1f5c, armour: 0x2e2a44, trim: 0x9a7ad0, weapon: 0x5a4a8a },
      startSkill: null, trees: [],
    },
  },
  // Skill rows. kind → one behaviour function in sim/skills.js:
  //   melee   arc swing in the aim direction, instant hit
  //   dash    move `range` m toward the aim over dashTicks, then hit an arc at the end
  //   buff    self buff for `duration` s
  //   strike  single target: nearest monster in the arc, extra effect (stun)
  //   channel repeats every tickEvery s while held, costs costPerSec, moveMult while active
  //   aoe     circle of `radius` at the aim point within `range`, knockback
  // Damage: weaponPct × (1 + effectPerRank·(rank−1)) × (1 + synergyPerPoint·Σ synergy points).
  // Mana: cost + manaPerRank·(rank−1); a row with cost 0 stays free at every rank. Cooldowns in seconds.
  skills: {
    cleave: { id: 'cleave', class: 'warrior', tree: 'onslaught', row: 1, name: 'Cleave',
      kind: 'melee', cost: 0, cooldown: 0, shape: { arc: 120, range: 2.5 }, weaponPct: 1.10,
      element: 'phys', fx: 'swipe', synergies: [],
      desc: 'A wide swing that hits every enemy in front of you.' },
    lunge: { id: 'lunge', class: 'warrior', tree: 'onslaught', row: 2, name: 'Lunge',
      kind: 'dash', cost: 6, cooldown: 4, shape: { range: 6, arc: 90, hitRange: 2.2 }, weaponPct: 1.50,
      dashTicks: 4, element: 'phys', fx: 'dash', synergies: [],
      desc: 'Dash six metres and strike what stands there.' },
    warcry: { id: 'warcry', class: 'warrior', tree: 'onslaught', row: 3, name: 'Warcry',
      kind: 'buff', cost: 10, cooldown: 15, duration: 10, effect: { dmgPct: 20 },
      fx: 'shout', synergies: [],
      desc: 'A roar that sharpens every blow for ten seconds.' },
    skullbreak: { id: 'skullbreak', class: 'warrior', tree: 'onslaught', row: 4, name: 'Skullbreak',
      kind: 'strike', cost: 8, cooldown: 6, shape: { arc: 60, range: 2.5 }, weaponPct: 2.80,
      stun: 1, element: 'phys', fx: 'smash', synergies: [],
      desc: 'One crushing blow that stuns its target.' },
    whirl: { id: 'whirl', class: 'warrior', tree: 'onslaught', row: 5, name: 'Whirl',
      kind: 'channel', costPerSec: 4, cooldown: 0, shape: { radius: 2.5 }, weaponPct: 0.80,
      tickEvery: 0.4, moveMult: 0.7, element: 'phys', fx: 'whirl', synergies: ['cleave'],
      desc: 'Spin with your weapon out, hitting everything around you while you move.' },
    earthbreak: { id: 'earthbreak', class: 'warrior', tree: 'onslaught', row: 6, name: 'Earthbreak',
      kind: 'aoe', cost: 15, cooldown: 12, shape: { radius: 4, range: 8 }, weaponPct: 2.20,
      knockback: 3, element: 'phys', fx: 'quake', synergies: ['skullbreak'],
      desc: 'Smash the ground; everything nearby is hurled back.' },
  },
};
