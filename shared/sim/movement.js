// shared/sim/movement.js — walkable-mask collision, prop push-out, steering and knockback.
// Lifted out of P0's world.js unchanged in behaviour (world.test.js still proves them).
// Deterministic: only + − × ÷ floor and dsqrt/dnormInto from dmath.js.
import { walkableCell } from './zonegen.js';
import { dist2, dsqrt, dnormInto } from './dmath.js';

/** Metres per collider bucket in zone.grid. */
export const BUCKET = 8;

/** Spatial hash of layout.colliders into zone.grid / zone.gridW (BUCKET-metre cells). */
export function buildColliderGrid(zone) {
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

/** True when every cell under a circle of radius r at (x,z) is walkable. */
export function canStand(layout, x, z, r) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
  const z0 = Math.floor(z - r), z1 = Math.floor(z + r);
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) if (!walkableCell(layout, cx, cz)) return false;
  }
  return true;
}

/** Axis-separated move: each axis applies only where the mask allows, so walls slide. */
export function tryMove(zone, e, ddx, ddz) {
  const L = zone.layout;
  if (canStand(L, e.x + ddx, e.z, e.r)) e.x += ddx;
  if (canStand(L, e.x, e.z + ddz, e.r)) e.z += ddz;
  pushOutOfColliders(zone, e);
}

/** Push e radially out of every prop collider it overlaps (only onto walkable ground). */
export function pushOutOfColliders(zone, e) {
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

const tmp = [0, 0];

/**
 * Move e up to maxStep metres toward (tx,tz) with tryMove, facing that way.
 * Never overshoots. @returns the distance still left to the point after the move.
 */
export function moveToward(zone, e, tx, tz, maxStep) {
  const d = dnormInto(tmp, tx - e.x, tz - e.z);
  if (d <= 0) return 0;
  e.dx = tmp[0]; e.dz = tmp[1];
  const s = maxStep < d ? maxStep : d;
  if (s > 0) tryMove(zone, e, tmp[0] * s, tmp[1] * s);
  return dsqrt(dist2(e.x, e.z, tx, tz));
}

/**
 * Consume one tick of e.kb = {dx, dz, left, step}: slide e.kb.step metres along (dx,dz)
 * through tryMove (walls stop it), decrement left, clear kb when it reaches 0.
 * @returns true when a knockback was active this tick (callers skip voluntary movement).
 */
export function applyKnockback(zone, e) {
  const kb = e.kb;
  if (!kb) return false;
  if (kb.left > 0) {
    const s = kb.step || 0;
    if (s > 0) tryMove(zone, e, kb.dx * s, kb.dz * s);
    kb.left--;
  }
  if (kb.left <= 0) e.kb = null;
  return true;
}
