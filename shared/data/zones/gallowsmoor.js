// shared/data/zones/gallowsmoor.js — the moor outside Hollowmark. A recipe, not a map.
export default {
  id: 'gallowsmoor', name: 'Gallowsmoor', kind: 'wilderness', size: 128,
  biome: {
    sky: 0x14131c,
    fog: { near: 26, far: 78 },
    sun:  { color: 0xb9b1e6, intensity: 1.05, dir: [-0.45, 1, 0.35] },
    hemi: { sky: 0x3b3a5a, ground: 0x241f16, intensity: 0.6 },
    ground: { low: 0x2b3520, high: 0x5a6531, water: 0x16222d, shore: 0x4a4f2f, cliff: 0x4a4443, path: 0x5c4c34 },
    // one entry per prop kind: density is per grass cell, r is the collision radius (0 = walk-through)
    props: [
      { kind: 'deadTree',   density: 0.012,  r: 0.45, variants: 3 },
      { kind: 'tree',       density: 0.004,  r: 0.5,  variants: 3 },
      { kind: 'rock',       density: 0.008,  r: 0.55, variants: 3 },
      { kind: 'gravestone', density: 0.004,  r: 0.3,  variants: 2 },
      { kind: 'bones',      density: 0.003,  r: 0,    variants: 2 },
      { kind: 'stump',      density: 0.003,  r: 0.35, variants: 1 },
      { kind: 'ruinWall',   density: 0.0015, r: 0.9,  variants: 2 },
    ],
    exitProp: 'torch',
  },
  terrain: {
    scale: 19, octaves: 4, amp: 3.4, waterLine: -1.0, cliffSlope: 1.1,
    padRadius: 7, padFalloff: 5, pathWidth: 2.5, pathWander: 22, pathDamp: 0.12, pathFalloff: 6,
  },
  spawns: {
    types: ['gallowswolf', 'carrioncrow', 'moorcutthroat', 'moorpoacher'],
    cellSize: 35, packMin: 3, packMax: 6, championChance: 0.08, minDistFromSpawn: 22, packRadius: 3,
  },
  // exits[0] is where the player arrives from
  exits: [{ to: 'town', side: 'south' }, { to: 'saltcrypt', side: 'north' }],
  waypoint: false,
  level: { dusk: [1, 8], blight: [14, 19], hollow: [23, 27] },
  dropTable: 'moorBasic',
};
