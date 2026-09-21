// shared/sim/path.js — A* over a zone's walk mask. Client steering now, monster AI later.
// 8-neighbour, no corner cutting (a diagonal needs both orthogonal cells walkable),
// integer costs 10 straight / 14 diagonal, octile heuristic, binary heap with decrease-key
// on typed arrays that are cached per zone size and reset by a generation stamp, so a
// route allocates only its result. Deterministic: integer arithmetic and fixed neighbour
// order; no randomness, no clock.
import { dist2 } from './dmath.js';

const STRAIGHT = 10, DIAG = 14;
// Fixed neighbour order: E W S N, then NE NW SE SW. Ties resolve the same way everywhere.
const NX = [1, -1, 0, 0, 1, -1, 1, -1];
const NZ = [0, 0, 1, -1, -1, -1, 1, 1];

const scratch = new Map(); // zone size N → search buffers
let gen = 0;

function buffers(N) {
  let b = scratch.get(N);
  if (!b) {
    const n = N * N;
    b = {
      g: new Int32Array(n), f: new Int32Array(n), h: new Int32Array(n), parent: new Int32Array(n),
      stamp: new Int32Array(n), pos: new Int32Array(n), heap: new Int32Array(n), size: 0,
    };
    scratch.set(N, b);
  }
  gen++;
  if (gen > 0x3fffffff) { for (const o of scratch.values()) o.stamp.fill(0); gen = 1; }
  b.size = 0;
  return b;
}

// --- binary min-heap keyed on f, ties on h (prefers nodes nearer the goal) ------------
function before(b, a, c) {
  const fa = b.f[a], fc = b.f[c];
  return fa < fc || (fa === fc && b.h[a] < b.h[c]);
}

function siftUp(b, i) {
  const heap = b.heap, pos = b.pos, node = heap[i];
  while (i > 0) {
    const p = (i - 1) >> 1, pn = heap[p];
    if (!before(b, node, pn)) break;
    heap[i] = pn; pos[pn] = i; i = p;
  }
  heap[i] = node; pos[node] = i;
}

function siftDown(b, i) {
  const heap = b.heap, pos = b.pos, size = b.size, node = heap[i];
  for (;;) {
    let c = 2 * i + 1;
    if (c >= size) break;
    if (c + 1 < size && before(b, heap[c + 1], heap[c])) c++;
    const cn = heap[c];
    if (!before(b, cn, node)) break;
    heap[i] = cn; pos[cn] = i; i = c;
  }
  heap[i] = node; pos[node] = i;
}

function push(b, node) {
  b.heap[b.size] = node; b.pos[node] = b.size; b.size++;
  siftUp(b, b.size - 1);
}

function pop(b) {
  const top = b.heap[0];
  b.size--;
  if (b.size > 0) { const last = b.heap[b.size]; b.heap[0] = last; b.pos[last] = 0; siftDown(b, 0); }
  b.pos[top] = -1;
  return top;
}

/** Octile distance in the 10/14 cost scale: 10·max + 4·min. */
function heur(x, z, x1, z1) {
  const dx = x < x1 ? x1 - x : x - x1, dz = z < z1 ? z1 - z : z - z1;
  return dx > dz ? STRAIGHT * dx + (DIAG - STRAIGHT) * dz : STRAIGHT * dz + (DIAG - STRAIGHT) * dx;
}

/**
 * Route from (sx,sz) to (tx,tz), metres. @returns number[] of cell-centre waypoints
 * [x0,z0,x1,z1,…] from the start cell (exclusive) to the target cell (inclusive), [] when
 * both share a cell, or null when the target is not walkable, unreachable, or the search
 * expands more than maxExpand cells. `mask` defaults to layout.walk; pass buildNavMask()
 * output to route around props as well.
 */
export function findPath(layout, sx, sz, tx, tz, maxExpand = 4000, mask = layout.walk) {
  const N = layout.size;
  const x0 = Math.floor(sx), z0 = Math.floor(sz), x1 = Math.floor(tx), z1 = Math.floor(tz);
  if (x0 < 0 || z0 < 0 || x0 >= N || z0 >= N || x1 < 0 || z1 < 0 || x1 >= N || z1 >= N) return null;
  const goal = z1 * N + x1;
  if (!mask[goal]) return null;
  const start = z0 * N + x0;
  if (start === goal) return [];

  const b = buffers(N);
  const G = gen;
  const g = b.g, f = b.f, h = b.h, parent = b.parent, stamp = b.stamp, pos = b.pos;
  stamp[start] = G; g[start] = 0; h[start] = heur(x0, z0, x1, z1); f[start] = h[start]; parent[start] = -1;
  push(b, start);

  let expanded = 0;
  while (b.size > 0) {
    const cur = pop(b);
    if (cur === goal) return reconstruct(b, N, goal, start);
    if (++expanded > maxExpand) return null;
    const cx = cur % N, cz = (cur - cx) / N;
    const gc = g[cur];
    for (let k = 0; k < 8; k++) {
      const nx = cx + NX[k], nz = cz + NZ[k];
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const ni = nz * N + nx;
      if (!mask[ni]) continue;
      if (k >= 4 && (!mask[cz * N + nx] || !mask[nz * N + cx])) continue; // no corner cutting
      const ng = gc + (k >= 4 ? DIAG : STRAIGHT);
      if (stamp[ni] === G) {
        if (pos[ni] < 0 || ng >= g[ni]) continue; // closed, or no improvement
        g[ni] = ng; f[ni] = ng + h[ni]; parent[ni] = cur;
        siftUp(b, pos[ni]);
      } else {
        const hh = heur(nx, nz, x1, z1);
        stamp[ni] = G; g[ni] = ng; h[ni] = hh; f[ni] = ng + hh; parent[ni] = cur;
        push(b, ni);
      }
    }
  }
  return null;
}

function reconstruct(b, N, goal, start) {
  const parent = b.parent;
  let n = 0;
  for (let c = goal; c !== start; c = parent[c]) n++;
  const out = new Array(2 * n);
  let i = 2 * n;
  for (let c = goal; c !== start; c = parent[c]) {
    const x = c % N;
    i -= 2;
    out[i] = x + 0.5; out[i + 1] = (c - x) / N + 0.5;
  }
  return out;
}

/**
 * The point itself when its cell is walkable, else the centre of the nearest walkable
 * cell within maxR rings (Chebyshev rings outward, closest by distance inside a ring), or
 * null when none is found.
 */
export function nearestWalkable(layout, x, z, maxR = 6, mask = layout.walk) {
  const N = layout.size;
  const cx = Math.floor(x), cz = Math.floor(z);
  if (cx >= 0 && cz >= 0 && cx < N && cz < N && mask[cz * N + cx]) return [x, z];
  for (let r = 1; r <= maxR; r++) {
    let bestD = Infinity, bx = 0, bz = 0;
    for (let j = -r; j <= r; j++) {
      const pz = cz + j;
      if (pz < 0 || pz >= N) continue;
      const ring = j === -r || j === r;
      for (let i = -r; i <= r; i += ring ? 1 : 2 * r) {
        const px = cx + i;
        if (px < 0 || px >= N || !mask[pz * N + px]) continue;
        const d = dist2(x, z, px + 0.5, pz + 0.5);
        if (d < bestD) { bestD = d; bx = px + 0.5; bz = pz + 0.5; }
      }
    }
    if (bestD < Infinity) return [bx, bz];
  }
  return null;
}

/**
 * Bresenham over cells from (ax,az) to (bx,bz), metres: true when every cell on the line
 * is walkable and no diagonal transition cuts a non-walkable corner (both orthogonal
 * neighbours must be walkable too, the same rule findPath uses).
 */
export function lineOfWalk(layout, ax, az, bx, bz, mask = layout.walk) {
  const N = layout.size;
  let x = Math.floor(ax), z = Math.floor(az);
  const x1 = Math.floor(bx), z1 = Math.floor(bz);
  if (x < 0 || z < 0 || x >= N || z >= N || x1 < 0 || z1 < 0 || x1 >= N || z1 >= N) return false;
  if (!mask[z * N + x]) return false;
  const dx = x < x1 ? x1 - x : x - x1, dz = z < z1 ? z - z1 : z1 - z; // dz ≤ 0
  const sx = x < x1 ? 1 : -1, sz = z < z1 ? 1 : -1;
  let err = dx + dz;
  for (let steps = dx > -dz ? dx : -dz; steps > 0; steps--) {
    const e2 = 2 * err;
    let mx = 0, mz = 0;
    if (e2 >= dz) { err += dz; mx = sx; }
    if (e2 <= dx) { err += dx; mz = sz; }
    if (mx !== 0 && mz !== 0 && (!mask[z * N + x + mx] || !mask[(z + mz) * N + x])) return false;
    x += mx; z += mz;
    if (!mask[z * N + x]) return false;
  }
  return x === x1 && z === z1;
}

/**
 * Drop waypoints that a straight line-of-walk from the previous kept waypoint already
 * covers. `from` = [x,z] (the mover's position) lets the first waypoints go too; without
 * it path[0] is kept. The last waypoint is always kept. Returns a new array.
 */
export function simplifyPath(layout, path, from = null, mask = layout.walk) {
  const n = path.length >> 1;
  const out = [];
  if (n === 0) return out;
  let ax, az, i;
  if (from) { ax = from[0]; az = from[1]; i = -1; } else { ax = path[0]; az = path[1]; out.push(ax, az); i = 0; }
  while (i < n - 1) {
    let j = i + 1; // the next waypoint is always taken (8-adjacent, corner-safe)
    while (j + 1 < n && lineOfWalk(layout, ax, az, path[2 * j + 2], path[2 * j + 3], mask)) j++;
    ax = path[2 * j]; az = path[2 * j + 1];
    out.push(ax, az);
    i = j;
  }
  return out;
}

/**
 * A copy of layout.walk with every cell whose centre lies within (collider.r + r) of a
 * prop collider cleared, so routes for a mover of radius r bend around props instead of
 * relying on push-out. Pass it as the `mask` argument of the functions above.
 */
export function buildNavMask(layout, r = 0) {
  const N = layout.size;
  const mask = new Uint8Array(layout.walk);
  for (const c of layout.colliders) {
    const rr = c.r + r, rr2 = rr * rr;
    const x0 = Math.max(0, Math.floor(c.x - rr)), x1 = Math.min(N - 1, Math.floor(c.x + rr));
    const z0 = Math.max(0, Math.floor(c.z - rr)), z1 = Math.min(N - 1, Math.floor(c.z + rr));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (dist2(cx + 0.5, cz + 0.5, c.x, c.z) < rr2) mask[cz * N + cx] = 0;
      }
    }
  }
  return mask;
}
