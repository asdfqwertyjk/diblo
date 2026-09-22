// client/src/game/pick.js — entity picking by screen distance, no raycast against rigs.
// pickEntity(world, camera, ndcX, ndcY, radiusPx, viewportW, viewportH, groundY, ents?) → id | null
// A live monster is tested as a vertical capsule: its feet (groundY) and head
// (groundY + MONSTER_HEIGHT·size) are projected and the pointer's distance to that screen
// segment must be within radiusPx, so a click on the shadow, the legs or the head all pick it.
// A ground item is one point at groundY + 0.25. The nearest wins, monsters before items on
// ties. `ents` (optional) is the iterable of ids to consider — pass the zone's `ents` Set so
// the walk allocates nothing (Set.forEach with a pre-bound callback); without it world.ents
// is walked with for-in. Two scratch Vector3s, reused.
import { Vector3 } from 'three';

export const MONSTER_PICK_HEIGHT = 0.9;   // × entity size, metres above the ground: chest (labels, fx)
export const MONSTER_HEIGHT = 1.9;        // × entity size: the top of the pick capsule
export const ITEM_PICK_HEIGHT = 0.25;
const ITEM_TIE_BIAS = 1e-3;               // px²: a monster wins an exact tie with an item

const v = new Vector3();
const v2 = new Vector3();

// per-call state for the pre-bound Set callback
let cWorld = null, cCamera = null, cGroundY = null;
let cW = 1, cH = 1, cPx = 0, cPy = 0, cR2 = 0;
let bestId = null, bestD2 = Infinity;

/** Projects `p` (already set in world space) to screen px in place; false when off the depth range. */
function toScreen(p) {
  p.project(cCamera);
  if (p.z > 1 || p.z < -1) return false;   // outside the near/far range (behind the camera)
  p.x = (p.x + 1) * 0.5 * cW;
  p.y = (1 - p.y) * 0.5 * cH;
  return true;
}

/** Squared distance from the pointer to the screen segment a→b (x, y in px). */
function segD2(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((cPx - ax) * dx + (cPy - ay) * dy) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const ex = ax + dx * t - cPx, ey = ay + dy * t - cPy;
  return ex * ex + ey * ey;
}

function consider(e) {
  let d2;
  if (e.kind === 'monster') {
    if (e.dead || !(e.hp > 0)) return;
    const gy = cGroundY(e.x, e.z), size = e.size || 1;
    v.set(e.x, gy, e.z);
    v2.set(e.x, gy + MONSTER_HEIGHT * size, e.z);
    if (!toScreen(v) || !toScreen(v2)) return;
    d2 = segD2(v.x, v.y, v2.x, v2.y);
  } else if (e.kind === 'item') {
    v.set(e.x, cGroundY(e.x, e.z) + ITEM_PICK_HEIGHT, e.z);
    if (!toScreen(v)) return;
    const dx = v.x - cPx, dy = v.y - cPy;
    d2 = dx * dx + dy * dy + ITEM_TIE_BIAS;
  } else return;
  if (d2 > cR2) return;
  if (d2 < bestD2) { bestD2 = d2; bestId = e.id; }
}

function considerId(id) {
  const e = cWorld.ents[id];
  if (e) consider(e);
}

/**
 * @param world   the sim world (read only)
 * @param camera  THREE.Camera with a current matrixWorld / projectionMatrix
 * @param ndcX,ndcY pointer in normalised device coordinates (−1..1, y up)
 * @param radiusPx pick radius in CSS pixels (24 mouse, 40 touch)
 * @param viewportW,viewportH CSS pixel size of the viewport
 * @param groundY(x, z) rendered surface height
 * @param ents    optional Set/array of entity ids to consider (a zone's `ents`)
 */
export function pickEntity(world, camera, ndcX, ndcY, radiusPx, viewportW, viewportH, groundY, ents = null) {
  cWorld = world; cCamera = camera; cGroundY = groundY;
  cW = viewportW || 1; cH = viewportH || 1;
  cPx = (ndcX + 1) * 0.5 * cW; cPy = (1 - ndcY) * 0.5 * cH;
  cR2 = radiusPx * radiusPx;
  bestId = null; bestD2 = Infinity;
  if (ents) ents.forEach(considerId);
  else for (const id in world.ents) consider(world.ents[id]);
  cWorld = null; cCamera = null; cGroundY = null;
  return bestId;
}
