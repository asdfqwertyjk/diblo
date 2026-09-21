// shared/sim/world.js — THE game. Plain-object state and four functions at a fixed 20 Hz.
// The server wraps a world with sockets; the offline client wraps one with the local
// player. Renderers read world.ents and never write.
//
// P1 tick order (API.md): tick++ → for every zone with a player: players (player.js) →
// projectiles (projectiles.js) → monsters (ai.js) → deaths (onMonsterDeath: drops, xp,
// event kill; players enter dead) → cleanup of corpses after monsters.curve.dieTicks →
// delta / gone / events. Zones without players do not tick.
import { hash32, hashString, makeStreams } from './rng.js';
import { generateZone } from './zonegen.js';
import { lerp, DIR16 } from './dmath.js';
import { buildColliderGrid, canStand } from './movement.js';
import { monsterStats } from './combat.js';
import { initMonsterAI, stepMonsters } from './ai.js';
import { stepProjectiles } from './projectiles.js';
import { createPlayerEnt, stepPlayer, killPlayer } from './player.js';
import { rollDrops } from './itemgen.js';
import { dropAt } from './ground.js';
import { shareKillXp } from './xp.js';
import classes from '../data/classes.js';
import monsters from '../data/monsters.js';

export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;
/** Seconds → whole ticks (round half up). Every module turns table seconds into ticks here. */
export function secTicks(sec) {
  return Math.floor((+sec || 0) * TICK_HZ + 0.5);
}
/** Re-exported for P0 callers (world.test.js); the implementation lives in movement.js. */
export { canStand };

/**
 * Fields whose change shows up in step().delta. `lockUntil`, `channel`, `dash` and `ai` stay
 * internal, so the client animates from `anim` and the `skill` / `stun` events. `invVer` bumps
 * on any character-sheet change (bags, equipment, belt, stat/skill points spent, hotbar), so a
 * server ships the owner's sheet whenever it appears in a delta.
 */
export const TRACKED = [
  'zone', 'x', 'z', 'dx', 'dz', 'anim', 'speed', 'hp', 'mp',
  'hpMax', 'mpMax', 'level', 'xp', 'gold', 'dead', 'stunUntil', 'buffUntil', 'invVer', 'target',
  'statPoints', 'skillPoints',
];

/**
 * Static identity fields a first-sight delta row carries on top of TRACKED (only those the
 * entity has). Bags, brains, cooldowns and timers never leave the sim through delta.
 */
export const FIRST_SIGHT = [
  'id', 'kind', 'type', 'name', 'cls', 'r', 'champion', 'boss', 'pack', 'rig', 'size', 'family', 'arch',
  'item', 'gold', 'owner',   // ground items (gold is TRACKED too; harmless)
  'el', 'src',               // projectiles
];

function firstSightRow(e) {
  const row = {};
  for (const f of FIRST_SIGHT) if (f in e) row[f] = e[f];
  for (const f of TRACKED) if (f in e) row[f] = e[f];
  return row;
}

// scratch lists for the per-zone phases: emptied before use, never reallocated per tick
const dying = [];
const corpses = [];

const NONE = {};

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

/**
 * One monster per pack member: identity from monsters.types, numbers from combat.monsterStats
 * (hp, dmg, armour, xp, speed, drop table from the recipe or 'champion'), brain from ai.js.
 * Player scaling is frozen at spawn time (world.players.length then).
 */
function spawnMonsters(world, zone) {
  const [lo, hi] = zone.recipe.level[world.difficulty];
  const players = world.players.length;
  for (const pack of zone.layout.spawns) {
    const type = monsters.types[pack.type];
    const level = Math.floor(lerp(lo, hi, pack.t) + 0.5);
    for (let i = 0; i < pack.members.length; i++) {
      const mem = pack.members[i];
      const champion = !!pack.champion && i === 0;
      const s = monsterStats(pack.type, level, champion, players, { dropTable: zone.recipe.dropTable });
      const id = 'm' + world.nextId++;
      const m = {
        id, kind: 'monster', type: pack.type, name: type.name, family: type.family, arch: type.arch,
        rig: type.rig, size: type.size * (champion ? 1.25 : 1), zone: zone.id,
        x: mem.x, z: mem.z, dx: DIR16[mem.facing * 2], dz: DIR16[mem.facing * 2 + 1],
        anim: 'idle', level, hp: s.hpMax, hpMax: s.hpMax, dead: false, champion, boss: false,
        pack: pack.index, r: type.r, speed: s.speed,
        armour: s.armour, dmg: s.dmg, xpValue: s.xpValue, dropTable: s.dropTable, ilvl: s.ilvl,
        stunUntil: 0, kb: null, lastHitBy: null, lastCombatTick: 0, deadAt: null,
      };
      initMonsterAI(m);
      world.ents[id] = m;
      zone.ents.add(id);
      world.events.push({ k: 'spawn', id });
    }
  }
}

/** @param doc character document (player.toDoc shape or {name, cls, level}) @returns player entity id */
export function addPlayer(world, doc) {
  const zone = ensureZone(world, (doc && doc.zone) || world.startZone);
  return createPlayerEnt(world, zone, doc).id;
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

/** intent: {seq, mv:[x,z], aim:[x,z], target, skill, use, pick, act}. The latest one wins. */
export function applyIntent(world, playerId, intent) {
  world.intents[playerId] = intent;
}

/**
 * A monster dies once: flagged dead (anim die, deadAt), drops rolled on the zone's loot
 * stream with the killer's MF / gold find, xp shared, event kill. The corpse stays until
 * cleanup removes it dieTicks later.
 */
export function onMonsterDeath(world, zone, m) {
  if (m.dead) return;
  m.dead = true;
  m.hp = 0;
  m.anim = 'die';
  m.deadAt = world.tick;
  m.kb = null;
  m.stunUntil = 0;
  const killer = m.lastHitBy ? world.ents[m.lastHitBy] : null;
  const d = (killer && killer.derived) || NONE;
  if (m.dropTable) {
    const drops = rollDrops(zone.streams.loot, m.dropTable, {
      ilvl: m.ilvl != null ? m.ilvl : m.level, mlvl: m.level, mf: d.mf || 0, goldFind: d.goldFind || 0,
    });
    dropAt(world, zone, m.x, m.z, drops);
  }
  shareKillXp(world, zone, m);
  world.events.push({ k: 'kill', id: m.id, by: m.lastHitBy || null, x: m.x, z: m.z, champion: !!m.champion, type: m.type });
}

/** Deaths phase: monsters at hp ≤ 0 die once, players at hp ≤ 0 enter dead (both idempotent). */
function stepDeaths(world, zone) {
  dying.length = 0;
  for (const id of zone.ents) {
    const e = world.ents[id];
    if (e && !e.dead && e.hp <= 0 && (e.kind === 'monster' || e.kind === 'player')) dying.push(e);
  }
  for (let i = 0; i < dying.length; i++) {
    const e = dying[i];
    if (e.kind === 'monster') onMonsterDeath(world, zone, e);
    else killPlayer(world, zone, e);
  }
  dying.length = 0;
}

/** Cleanup phase: dead monsters leave the world monsters.curve.dieTicks ticks after death. */
function stepCleanup(world, zone) {
  const after = monsters.curve.dieTicks;
  corpses.length = 0;
  for (const id of zone.ents) {
    const e = world.ents[id];
    if (e && e.kind === 'monster' && e.dead && world.tick - e.deadAt >= after) corpses.push(id);
  }
  for (let i = 0; i < corpses.length; i++) removeEnt(world, corpses[i]);
  corpses.length = 0;
}

function zoneHasPlayers(world, zone) {
  for (const pid of world.players) {
    const p = world.ents[pid];
    if (p && p.zone === zone.id) return true;
  }
  return false;
}

/** Advance one tick. @returns {tick, delta:{id:{changed fields}}, gone:[ids], events:[]} */
export function step(world) {
  world.tick++;
  for (const zid in world.zones) {
    const zone = world.zones[zid];
    if (!zoneHasPlayers(world, zone)) continue;
    // by index: nothing inside stepPlayer adds or removes a player
    const players = world.players;
    for (let i = 0; i < players.length; i++) {
      const pid = players[i];
      const e = world.ents[pid];
      if (e && e.zone === zid) stepPlayer(world, zone, e, world.intents[pid]);
    }
    stepProjectiles(world, zone);
    stepMonsters(world, zone);
    stepDeaths(world, zone);
    stepCleanup(world, zone);
  }

  const delta = {};
  for (const id in world.ents) {
    const e = world.ents[id];
    const last = world._last[id];
    if (!last) {
      delta[id] = firstSightRow(e);
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
