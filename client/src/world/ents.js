// client/src/world/ents.js — one rig per live entity, interpolated between sim ticks.
// createEntityView(scene, kit) → { sync(world, prev, alpha, groundY, time), rigs: Map, dispose() }.
// A rig is created on first sight (class palette for players, type/family palette for
// monsters), removed when its id leaves world.ents, placed at lerp(prev, current, alpha)
// with y = groundY(x, z), turned so the rig's +z forward points along (dx, dz), and posed by
// animateRig. Champions are already sized ×1.25 by the sim; here only their trim is
// brightened. Nothing allocates per frame beyond what three.js does internally: sync walks
// the game's `prev` Map with one pre-bound callback (a for-in over world.ents would allocate
// a key array every frame), so an entity gets its rig on the first tick after it enters
// `prev`, at most 50 ms after it spawns.
import { createRig, animateRig, disposeRigCache } from '../render/rig.js';
import classes from 'shared/data/classes.js';
import monsters from 'shared/data/monsters.js';

const CHAMPION_TRIM_LIFT = 0.6;   // 0 = untouched, 1 = white
const FACING_EPS = 1e-6;

/** Blend a 0xRRGGBB colour toward white. Used once per champion rig, never per frame. */
function brighten(hex, t) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const rr = Math.round(r + (255 - r) * t), gg = Math.round(g + (255 - g) * t), bb = Math.round(b + (255 - b) * t);
  return (rr << 16) | (gg << 8) | bb;
}

function championPalette(palette) {
  const p = Object.assign({}, palette);
  if (p.trim != null) p.trim = brighten(p.trim, CHAMPION_TRIM_LIFT);
  if (p.eyes != null) p.eyes = brighten(p.eyes, CHAMPION_TRIM_LIFT * 0.5);
  return p;
}

/** Rig spec for an entity row, read from the shared data tables. */
function specFor(ent) {
  if (ent.kind === 'player') {
    const cls = classes.classes[ent.cls] || classes.classes.warrior;
    return { rig: 'biped', palette: cls.palette, size: 1, weapon: cls.weapon || null };
  }
  const type = monsters.types[ent.type] || {};
  const family = monsters.families[ent.family] || monsters.families[type.family] || null;
  let palette = type.palette || (family && family.palette) || monsters.families.beast.palette;
  if (ent.champion) palette = championPalette(palette);
  return { rig: ent.rig || type.rig || 'biped', palette, size: ent.size || type.size || 1, weapon: type.weapon || null };
}

export function createEntityView(scene, kit) {
  const rigs = new Map();
  const scratch = { x: 0, z: 0, dx: 0, dz: 0 }; // interpolation result, reused
  let count = 0;
  // Per-call state for the pre-bound Map callbacks (set in sync, cleared after).
  let curWorld = null;
  let curZone = null;
  let curAlpha = 0;
  let curGroundY = null;
  let curTime = 0;
  let curCount = 0;

  function spawn(ent) {
    const spec = specFor(ent);
    const r = createRig(spec);
    r.id = ent.id;
    r.kind = ent.kind;
    r.champion = !!ent.champion;
    r.group.position.set(ent.x, 0, ent.z);
    scene.add(r.group);
    rigs.set(ent.id, r);
    return r;
  }

  function removeRig(r, id) {
    scene.remove(r.group);
    if (typeof r.dispose === 'function') r.dispose(); // rig.js owns its geometries, if it offers this
    rigs.delete(id);
  }

  /** Map.forEach callback (defined once): drop rigs whose entity is gone or in another zone. */
  function pruneOne(r, id) {
    const e = curWorld.ents[id];
    if (!e || (curZone !== null && e.zone !== curZone)) removeRig(r, id);
  }

  /** Interpolate prev → current into scratch. */
  function interpolate(e, p, alpha) {
    if (p) {
      scratch.x = p.x + (e.x - p.x) * alpha;
      scratch.z = p.z + (e.z - p.z) * alpha;
      scratch.dx = p.dx + (e.dx - p.dx) * alpha;
      scratch.dz = p.dz + (e.dz - p.dz) * alpha;
    } else {
      scratch.x = e.x; scratch.z = e.z; scratch.dx = e.dx; scratch.dz = e.dz;
    }
    return scratch;
  }

  /**
   * @param world  the sim world (read only)
   * @param prev   Map<id, {x,z,dx,dz}> from the local game
   * @param alpha  0..1 within the current tick
   * @param groundY(x, z) rendered surface height
   * @param time   seconds, for animateRig
   * @param zoneId optional: only entities in this zone get rigs
   */
  function sync(world, prev, alpha, groundY, time, zoneId) {
    curWorld = world;
    curZone = zoneId == null ? null : zoneId;
    rigs.forEach(pruneOne);
    curAlpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    curGroundY = groundY;
    curTime = time;
    curCount = 0;
    if (prev) prev.forEach(syncOne);                          // no per-frame allocation
    else for (const id in world.ents) syncOne(null, id);      // no interpolation source: draw current
    count = curCount;
    curWorld = null;
    curGroundY = null;
  }

  /** Map.forEach callback (defined once): place and pose one entity's rig. */
  function syncOne(p, id) {
    const e = curWorld.ents[id];
    if (!e || (curZone !== null && e.zone !== curZone)) return;
    let r = rigs.get(id);
    if (!r) r = spawn(e);
    const s = interpolate(e, p, curAlpha);
    const g = r.group;
    g.position.set(s.x, curGroundY(s.x, s.z), s.z);
    if (s.dx * s.dx + s.dz * s.dz > FACING_EPS) g.rotation.y = Math.atan2(s.dx, s.dz);
    animateRig(r, e.anim || 'idle', curTime, e.speed || 0);
    curCount++;
  }

  function dispose() {
    rigs.forEach((r, id) => removeRig(r, id));
    rigs.clear();
    count = 0;
    disposeRigCache(); // shared part geometries + the shadow disc, rebuilt on demand
  }

  return {
    sync, rigs, dispose, kit,
    get count() { return count; },
  };
}
