// client/src/world/ents.js — one rig per live entity, interpolated between sim ticks.
// createEntityView(scene, kit) → { sync(world, prev, alpha, groundY, time, zoneId?), onHit(id),
//   rigs: Map, count, dispose() }.
// A rig is created on first sight (class palette for players, type/family palette for
// monsters), removed when its id leaves world.ents, placed at lerp(prev, current, alpha)
// with y = groundY(x, z), turned so the rig's +z forward points along (dx, dz), and posed by
// animateRig with the entity's anim. Champions are already sized ×1.25 by the sim; here their
// trim is brightened. P1: `kind:'proj'` gets a pooled arrow mesh (0.6 m along dx,dz at
// groundY + 1.0) in the same Map; `kind:'item'` is skipped (items.js draws ground drops);
// a monster's `die` plays to the end because animateRig holds the final pose until the sim
// removes the corpse; onHit(id) makes the target flinch (`hit`) for HIT_FLINCH s unless it is
// dying, attacking or casting; a player's moveSpeed comes from derived.speed when present.
// Nothing allocates per frame beyond what three.js does internally: sync walks the game's
// `prev` Map with one pre-bound callback (a for-in over world.ents would allocate a key array
// every frame), so an entity gets its rig on the first tick after it enters `prev`, at most
// 50 ms after it spawns. Nothing here mutates world.ents.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRig, animateRig, disposeRigCache } from '../render/rig.js';
import { flatMaterial, paintGeometry } from '../render/materials.js';
import classes from 'shared/data/classes.js';
import monsters from 'shared/data/monsters.js';

const CHAMPION_TRIM_LIFT = 0.6;   // 0 = untouched, 1 = white
const FACING_EPS = 1e-6;
const HIT_FLINCH = 0.2;           // seconds the `hit` pose is forced after a hit event
const PROJ_HEIGHT = 1.0;          // arrows fly at chest height
const PROJ_LENGTH = 0.6;
const WOOD = 0x6e5236, STEEL = 0xb8bcc4, FLETCH = 0x2a2620;

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

/** The weapon kind a player rig should carry: the equipped weapon's kind, else the class kit weapon. */
function playerWeapon(ent) {
  const w = ent.equipment && ent.equipment.weapon ? ent.equipment.weapon.kind : null;
  if (w) return w;
  const cls = classes.classes[ent.cls] || classes.classes.warrior;
  return ent.equipment ? null : (cls.weapon || null);   // a sheet with an empty weapon slot is unarmed
}

/** Rig spec for an entity row, read from the shared data tables. */
function specFor(ent) {
  if (ent.kind === 'player') {
    const cls = classes.classes[ent.cls] || classes.classes.warrior;
    return { rig: 'biped', palette: cls.palette, size: 1, weapon: playerWeapon(ent) };
  }
  const type = monsters.types[ent.type] || {};
  const family = monsters.families[ent.family] || monsters.families[type.family] || null;
  let palette = type.palette || (family && family.palette) || monsters.families.beast.palette;
  if (ent.champion) palette = championPalette(palette);
  return { rig: ent.rig || type.rig || 'biped', palette, size: ent.size || type.size || 1, weapon: type.weapon || null };
}

/** One painted non-indexed box moved to (x, y, z). */
function pbox(w, h, d, hex, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(x, y, z);
  return paintGeometry(g, hex);
}

/** An arrow along +z, PROJ_LENGTH long, centred on its middle. */
function buildArrowGeometry() {
  const L = PROJ_LENGTH;
  const parts = [
    pbox(0.025, 0.025, L, WOOD, 0, 0, 0),
    pbox(0.045, 0.045, 0.1, STEEL, 0, 0, L / 2 - 0.04),
    pbox(0.08, 0.012, 0.1, FLETCH, 0, 0, -L / 2 + 0.07),
    pbox(0.012, 0.08, 0.1, FLETCH, 0, 0, -L / 2 + 0.07),
  ];
  const g = mergeGeometries(parts, false);
  for (let i = 0; i < parts.length; i++) parts[i].dispose();
  g.computeBoundingSphere();
  return g;
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

  // arrows: one shared geometry, meshes and records pooled (spawned on first sight, reused after)
  let arrowGeo = null;
  const arrowFree = [];

  function spawnProj(ent) {
    let r = arrowFree.pop();
    if (!r) {
      if (!arrowGeo) arrowGeo = buildArrowGeometry();
      const mesh = new THREE.Mesh(arrowGeo, flatMaterial());
      mesh.name = 'proj';
      r = { id: null, kind: 'proj', group: mesh, champion: false, hitUntil: 0, flinchPending: false };
    }
    r.id = ent.id;
    r.group.position.set(ent.x, PROJ_HEIGHT, ent.z);
    r.group.visible = true;
    scene.add(r.group);
    rigs.set(ent.id, r);
    return r;
  }

  function spawn(ent) {
    if (ent.kind === 'proj') return spawnProj(ent);
    const spec = specFor(ent);
    const r = createRig(spec);
    r.id = ent.id;
    r.kind = ent.kind;
    r.champion = !!ent.champion;
    r.weaponKind = spec.weapon;
    r.hitUntil = 0;
    r.flinchPending = false;
    r.group.position.set(ent.x, 0, ent.z);
    scene.add(r.group);
    rigs.set(ent.id, r);
    return r;
  }

  function removeRig(r, id) {
    scene.remove(r.group);
    if (r.kind === 'proj') { r.id = null; r.group.visible = false; arrowFree.push(r); }
    else if (typeof r.dispose === 'function') r.dispose(); // rig.js owns its geometries, if it offers this
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
    if (!e || e.kind === 'item' || (curZone !== null && e.zone !== curZone)) return;
    let r = rigs.get(id);
    if (!r) r = spawn(e);
    else if (e.kind === 'player' && playerWeapon(e) !== r.weaponKind) { removeRig(r, id); r = spawn(e); } // re-armed: rebuild (event-rate, not per frame)
    const s = interpolate(e, p, curAlpha);
    const g = r.group;
    const facing = s.dx * s.dx + s.dz * s.dz > FACING_EPS;
    if (r.kind === 'proj') {
      g.position.set(s.x, curGroundY(s.x, s.z) + PROJ_HEIGHT, s.z);
      if (facing) g.rotation.y = Math.atan2(s.dx, s.dz);
      curCount++;
      return;
    }
    g.position.set(s.x, curGroundY(s.x, s.z), s.z);
    if (facing) g.rotation.y = Math.atan2(s.dx, s.dz);
    let anim = e.anim || 'idle';
    if (r.flinchPending) {
      r.flinchPending = false;
      r.hitUntil = curTime + HIT_FLINCH;
      if (r.anim.name === 'hit') r.anim.name = '';   // restart the pose on a repeat hit
    }
    if (r.hitUntil > curTime && !e.dead && anim !== 'die' && anim !== 'attack' && anim !== 'cast') anim = 'hit';
    const d = e.derived;
    const moveSpeed = d && d.speed > 0 ? d.speed : (e.speed || 0);
    animateRig(r, anim, curTime, moveSpeed);
    curCount++;
  }

  /** A `hit` event landed on entity `id`: its rig flinches on the next sync. → true if it has a rig. */
  function onHit(id) {
    const r = rigs.get(id);
    if (!r || r.kind === 'proj') return false;
    r.flinchPending = true;
    return true;
  }

  function dispose() {
    rigs.forEach((r, id) => removeRig(r, id));
    rigs.clear();
    for (let i = 0; i < arrowFree.length; i++) arrowFree[i].group.removeFromParent();
    arrowFree.length = 0;
    if (arrowGeo) { arrowGeo.dispose(); arrowGeo = null; }
    count = 0;
    disposeRigCache(); // shared part geometries + the shadow disc, rebuilt on demand
  }

  return {
    sync, onHit, rigs, dispose, kit,
    get count() { return count; },
  };
}
