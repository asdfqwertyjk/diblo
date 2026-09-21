// shared/sim/world.js — THE game. Plain-object state and four functions at a fixed 20 Hz.
// The server wraps a world with sockets; the offline client wraps one with the local
// player. Renderers read world.ents and never write.
import { hash32, hashString, makeStreams } from './rng.js';
import { generateZone, walkableCell } from './zonegen.js';
import { dist2, dsqrt, dnormInto, lerp, DIR16 } from './dmath.js';
import { deriveVitals } from './stats.js';
import classes from '../data/classes.js';
import monsters from '../data/monsters.js';

export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;
const BUCKET = 8; // metres per collider bucket

/** Fields whose change shows up in step().delta. */
export const TRACKED = ['zone', 'x', 'z', 'dx', 'dz', 'anim', 'hp', 'mp'];

export function createWorld({ recipes, seed, difficulty = 'dusk', startZone = classes.startZone }) {
  return {
    seed: seed | 0, difficulty, startZone, recipes,
    tick: 0, zones: {}, ents: {}, players: [], intents: {}, events: [], nextId: 1,
    _last: {}, _gone: [],
  };
}

/** Instantiate a zone (layout + monsters) on first use. */
export function ensureZone(world, zoneId) {
  let zone = world.zones[zoneId];
  if (zone) return zone;
  const recipe = world.recipes[zoneId];
  if (!recipe) throw new Error('no recipe for zone ' + zoneId);
  const layout = generateZone(recipe, hash32(world.seed, hashString(zoneId), 0));
  zone = { id: zoneId, recipe, layout, streams: makeStreams(world.seed, zoneId, 0), ents: new Set(), grid: null, gridW: 0 };
  buildColliderGrid(zone);
  world.zones[zoneId] = zone;
  spawnMonsters(world, zone);
  return zone;
}

function buildColliderGrid(zone) {
  const N = zone.layout.size;
  const gw = Math.ceil(N / BUCKET);
  const grid = new Array(gw * gw).fill(null);
  for (const c of zone.layout.colliders) {
    const gx = Math.floor(c.x / BUCKET), gz = Math.floor(c.z / BUCKET);
    if (gx < 0 || gz < 0 || gx >= gw || gz >= gw) continue;
    (grid[gz * gw + gx] || (grid[gz * gw + gx] = [])).push(c);
  }
  zone.grid = grid; zone.gridW = gw;
}

function spawnMonsters(world, zone) {
  const [lo, hi] = zone.recipe.level[world.difficulty];
  const cv = monsters.curve;
  for (const pack of zone.layout.spawns) {
    const type = monsters.types[pack.type];
    const arch = monsters.archetypes[type.arch];
    const level = Math.floor(lerp(lo, hi, pack.t) + 0.5);
    for (let m = 0; m < pack.members.length; m++) {
      const mem = pack.members[m];
      const champion = pack.champion && m === 0;
      const hpMax = Math.floor((cv.hpBase + cv.hpPerLevel * level) * arch.hp * (champion ? cv.champion.hp : 1));
      const id = 'm' + world.nextId++;
      const e = {
        id, kind: 'monster', type: pack.type, name: type.name, family: type.family, arch: type.arch,
        rig: type.rig, size: type.size * (champion ? 1.25 : 1), zone: zone.id,
        x: mem.x, z: mem.z, dx: DIR16[mem.facing * 2], dz: DIR16[mem.facing * 2 + 1],
        anim: 'idle', level, hp: hpMax, hpMax, champion, pack: pack.index, r: type.r, speed: arch.speed,
      };
      world.ents[id] = e;
      zone.ents.add(id);
      world.events.push({ k: 'spawn', id });
    }
  }
}

/** @param doc character document {name, cls, level, stats?, zone?} @returns player entity id */
export function addPlayer(world, doc) {
  const zoneId = doc.zone || world.startZone;
  const zone = ensureZone(world, zoneId);
  const v = deriveVitals(doc);
  const id = 'p' + world.nextId++;
  const sp = zone.layout.playerSpawn;
  const e = {
    id, kind: 'player', name: doc.name || 'Nameless', cls: doc.cls, level: doc.level || 1, zone: zoneId,
    x: sp.x, z: sp.z, dx: sp.dx, dz: sp.dz, anim: 'idle',
    hp: v.hpMax, hpMax: v.hpMax, mp: v.mpMax, mpMax: v.mpMax, speed: v.speed, r: v.radius,
  };
  world.ents[id] = e;
  zone.ents.add(id);
  world.players.push(id);
  world.events.push({ k: 'spawn', id });
  return id;
}

export function removeEnt(world, id) {
  const e = world.ents[id];
  if (!e) return;
  const zone = world.zones[e.zone];
  if (zone) zone.ents.delete(id);
  delete world.ents[id];
  const pi = world.players.indexOf(id);
  if (pi >= 0) world.players.splice(pi, 1);
  delete world.intents[id];
  world._gone.push(id);
}

/** intent: {seq, mv:[x,z], aim:[x,z], skill, use, pick, act}. The latest one wins. */
export function applyIntent(world, playerId, intent) {
  world.intents[playerId] = intent;
}

const tmp = [0, 0];

/** Advance one tick. @returns {tick, delta:{id:{changed fields}} , gone:[ids], events:[]} */
export function step(world) {
  world.tick++;
  for (const pid of world.players) {
    const e = world.ents[pid];
    if (e) movePlayer(world.zones[e.zone], e, world.intents[pid]);
  }
  // monsters stand idle in P0; ai.js takes over in P1

  const delta = {};
  for (const id in world.ents) {
    const e = world.ents[id];
    const last = world._last[id];
    if (!last) {
      delta[id] = { ...e };
      const copy = {};
      for (const f of TRACKED) copy[f] = e[f];
      world._last[id] = copy;
      continue;
    }
    let d = null;
    for (const f of TRACKED) {
      if (e[f] !== last[f]) { (d || (d = {}))[f] = e[f]; last[f] = e[f]; }
    }
    if (d) delta[id] = d;
  }
  const gone = world._gone; world._gone = [];
  for (const id of gone) delete world._last[id];
  const events = world.events; world.events = [];
  return { tick: world.tick, delta, gone, events };
}

function movePlayer(zone, e, intent) {
  let mx = 0, mz = 0;
  if (intent && intent.mv) { mx = +intent.mv[0] || 0; mz = +intent.mv[1] || 0; }
  const l2 = mx * mx + mz * mz;
  if (l2 > 1e-6) {
    const l = dnormInto(tmp, mx, mz);
    e.dx = tmp[0]; e.dz = tmp[1];
    e.anim = 'run';
    const stepLen = e.speed * (l > 1 ? 1 : l) * DT;
    tryMove(zone, e, tmp[0] * stepLen, tmp[1] * stepLen);
  } else {
    e.anim = 'idle';
    if (intent && intent.aim) {
      const ax = (+intent.aim[0] || 0) - e.x, az = (+intent.aim[1] || 0) - e.z;
      if (ax * ax + az * az > 0.04) { dnormInto(tmp, ax, az); e.dx = tmp[0]; e.dz = tmp[1]; }
    }
  }
}

function tryMove(zone, e, ddx, ddz) {
  const L = zone.layout;
  if (canStand(L, e.x + ddx, e.z, e.r)) e.x += ddx;
  if (canStand(L, e.x, e.z + ddz, e.r)) e.z += ddz;
  pushOutOfColliders(zone, e);
}

/** True when every cell under a circle of radius r at (x,z) is walkable. */
export function canStand(layout, x, z, r) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
  const z0 = Math.floor(z - r), z1 = Math.floor(z + r);
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) if (!walkableCell(layout, cx, cz)) return false;
  }
  return true;
}

function pushOutOfColliders(zone, e) {
  const gw = zone.gridW;
  const gx = Math.floor(e.x / BUCKET), gz = Math.floor(e.z / BUCKET);
  for (let z = gz - 1; z <= gz + 1; z++) {
    for (let x = gx - 1; x <= gx + 1; x++) {
      if (x < 0 || z < 0 || x >= gw || z >= gw) continue;
      const list = zone.grid[z * gw + x];
      if (!list) continue;
      for (const c of list) {
        const minD = e.r + c.r;
        const d2 = dist2(e.x, e.z, c.x, c.z);
        if (d2 >= minD * minD || d2 < 1e-9) continue;
        const d = dsqrt(d2), k = (minD - d) / d;
        const nx = e.x + (e.x - c.x) * k, nz = e.z + (e.z - c.z) * k;
        if (canStand(zone.layout, nx, nz, e.r)) { e.x = nx; e.z = nz; }
      }
    }
  }
}
