// shared/sim/zonegen.js — recipe + seed → layout. Runs identically on client and server.
// Only integer hashing and + − × ÷ floor min max (dsqrt is Newton on those), so the
// golden hash in tests matches under node --test and in every browser.
import { hash32, hashString, makeRng } from './rng.js';
import { clamp, lerp, smooth, dist2, dsqrt } from './dmath.js';
import { fbm2 } from './noise.js';

export const CELL = { GRASS: 0, WATER: 1, CLIFF: 2, PATH: 3 };

/** Unit vector pointing into the zone from each side. */
export const INWARD = { south: [0, -1], north: [0, 1], east: [-1, 0], west: [1, 0] };

/**
 * @returns {object} layout — see README block at the bottom of this file.
 */
export function generateZone(recipe, seed) {
  seed = seed | 0;
  const N = recipe.size | 0, V = N + 1;
  const T = recipe.terrain, B = recipe.biome;
  const rng = makeRng(hash32(seed, hashString(recipe.id), 0x51));
  const nseed = hash32(seed, hashString(recipe.id), 0x7e);
  const layout = {
    id: recipe.id, name: recipe.name, kind: recipe.kind, seed, size: N,
    heights: new Float32Array(V * V),   // vertex heights, (N+1)² row-major (z major)
    cell: new Uint8Array(N * N),        // CELL.* per cell
    walk: new Uint8Array(N * N),        // 1 = walkable
    pathDist: new Float32Array(V * V),  // per vertex, metres to the nearest path point
    exits: [], playerSpawn: null, pads: [], paths: [], props: [], colliders: [], spawns: [],
  };

  // --- exits, spawn, pads --------------------------------------------------------
  for (const ex of recipe.exits) layout.exits.push(placeExit(ex, N, rng));
  const entrance = layout.exits[0];
  const inw = INWARD[entrance.side];
  layout.playerSpawn = { x: entrance.x + inw[0] * 5, z: entrance.z + inw[1] * 5, dx: inw[0], dz: inw[1] };
  layout.pads.push({ x: layout.playerSpawn.x, z: layout.playerSpawn.z, r: T.padRadius });
  for (const ex of layout.exits) layout.pads.push({ x: ex.x, z: ex.z, r: T.padRadius });

  // --- paths from the entrance to every other exit ---------------------------------
  for (let i = 1; i < layout.exits.length; i++) {
    layout.paths.push(makePath(entrance, layout.exits[i], hash32(nseed, i), T));
  }

  // --- per-vertex distance to the nearest path point -------------------------------
  const pd = layout.pathDist;
  for (let vz = 0; vz < V; vz++) {
    for (let vx = 0; vx < V; vx++) {
      let best = 1e9;
      for (const path of layout.paths) {
        for (let k = 0; k < path.length; k += 2) {
          const d = dist2(vx, vz, path[k], path[k + 1]);
          if (d < best) best = d;
        }
      }
      pd[vz * V + vx] = layout.paths.length ? dsqrt(best) : 1e4;
    }
  }

  // --- heights ---------------------------------------------------------------------
  const H = layout.heights;
  for (let vz = 0; vz < V; vz++) {
    for (let vx = 0; vx < V; vx++) {
      let h = fbm2(nseed, vx / T.scale, vz / T.scale, T.octaves) * T.amp;
      const dp = pd[vz * V + vx];
      h *= lerp(T.pathDamp, 1, smooth(clamp((dp - T.pathWidth) / T.pathFalloff, 0, 1)));
      for (const pad of layout.pads) {
        const d = dsqrt(dist2(vx, vz, pad.x, pad.z));
        h *= smooth(clamp((d - pad.r) / T.padFalloff, 0, 1));
      }
      H[vz * V + vx] = h;
    }
  }

  // --- cell types and the walkable mask --------------------------------------------
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const i = cz * N + cx;
      const h00 = H[cz * V + cx], h10 = H[cz * V + cx + 1];
      const h01 = H[(cz + 1) * V + cx], h11 = H[(cz + 1) * V + cx + 1];
      const hmin = Math.min(h00, h10, h01, h11), hmax = Math.max(h00, h10, h01, h11);
      const havg = (h00 + h10 + h01 + h11) * 0.25;
      const dpc = cellPathDist(pd, V, cx, cz);
      let t;
      if (cx < 2 || cz < 2 || cx >= N - 2 || cz >= N - 2) t = inExitGap(layout.exits, cx, cz, N) ? CELL.PATH : CELL.CLIFF;
      else if (dpc < T.pathWidth) t = CELL.PATH;
      else if (havg < T.waterLine) t = CELL.WATER;
      else if (hmax - hmin > T.cliffSlope) t = CELL.CLIFF;
      else t = CELL.GRASS;
      layout.cell[i] = t;
      layout.walk[i] = (t === CELL.GRASS || t === CELL.PATH) ? 1 : 0;
    }
  }

  // --- props (one per grass cell at most) ------------------------------------------
  const kinds = B.props;
  for (let cz = 2; cz < N - 2; cz++) {
    for (let cx = 2; cx < N - 2; cx++) {
      if (layout.cell[cz * N + cx] !== CELL.GRASS) continue;
      if (cellPathDist(pd, V, cx, cz) < T.pathWidth + 1.5) continue;
      if (nearPad(layout.pads, cx + 0.5, cz + 0.5, 1.5)) continue;
      for (let k = 0; k < kinds.length; k++) {
        const kd = kinds[k];
        if (!rng.chance(kd.density)) continue;
        const x = cx + rng.between(0.15, 0.85), z = cz + rng.between(0.15, 0.85);
        const s = Math.floor(rng.between(0.8, 1.25) * 100) / 100;
        layout.props.push({ kind: kd.kind, v: rng.int(kd.variants), x, z, rot: rng.int(16), s });
        if (kd.r > 0) layout.colliders.push({ x, z, r: kd.r * s });
        break;
      }
    }
  }
  // two exit markers flank every exit, one metre inside it
  for (const ex of layout.exits) {
    const d = INWARD[ex.side];
    const px = -d[1], pz = d[0];
    for (const sgn of [-1, 1]) {
      layout.props.push({ kind: B.exitProp, v: 0, x: ex.x + px * sgn * 2.4 + d[0], z: ex.z + pz * sgn * 2.4 + d[1], rot: 0, s: 1 });
    }
  }

  // --- monster packs, one anchor per spawn cell ------------------------------------
  const S = recipe.spawns, C = S.cellSize;
  const cells = Math.ceil(N / C);
  const minD2 = S.minDistFromSpawn * S.minDistFromSpawn;
  const ps = layout.playerSpawn;
  let packIndex = 0;
  for (let gz = 0; gz < cells; gz++) {
    for (let gx = 0; gx < cells; gx++) {
      let ax = -1, az = -1;
      for (let attempt = 0; attempt < 12; attempt++) {
        const x = clamp(gx * C + rng.between(2, C - 2), 2.5, N - 2.5);
        const z = clamp(gz * C + rng.between(2, C - 2), 2.5, N - 2.5);
        if (!walkableAt(layout, x, z)) continue;
        if (dist2(x, z, ps.x, ps.z) < minD2) continue;
        ax = x; az = z; break;
      }
      if (ax < 0) continue;
      const type = rng.pick(S.types);
      const count = rng.range(S.packMin, S.packMax);
      const champion = rng.chance(S.championChance);
      const t = clamp(((ax - entrance.x) * inw[0] + (az - entrance.z) * inw[1]) / N, 0, 1);
      const members = [];
      for (let m = 0; m < count; m++) {
        let mx = ax, mz = az;
        for (let attempt = 0; attempt < 6; attempt++) {
          const x = ax + rng.between(-S.packRadius, S.packRadius);
          const z = az + rng.between(-S.packRadius, S.packRadius);
          if (walkableAt(layout, x, z)) { mx = x; mz = z; break; }
        }
        members.push({ x: mx, z: mz, facing: rng.int(16) });
      }
      layout.spawns.push({ index: packIndex++, x: ax, z: az, type, count, champion, t, members });
    }
  }
  return layout;
}

function placeExit(ex, N, rng) {
  const mid = N / 2;
  let x, z;
  if (ex.side === 'south') { x = mid; z = N - 3; }
  else if (ex.side === 'north') { x = mid + rng.range(-24, 24); z = 3; }
  else if (ex.side === 'east') { x = N - 3; z = mid + rng.range(-24, 24); }
  else { x = 3; z = mid + rng.range(-24, 24); }
  return { to: ex.to, side: ex.side, x, z, r: 2.5 };
}

/** Polyline [x0,z0,x1,z1,...] at ~1 m spacing, wandering sideways, pinned at both ends. */
function makePath(a, b, seed, T) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = dsqrt(dx * dx + dz * dz);
  const n = Math.max(2, Math.ceil(len));
  const px = -dz / len, pz = dx / len;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const env = t * (1 - t) * 4;
    const off = fbm2(seed, t * 3.1, 0.37, 3) * T.pathWander * env;
    pts.push(a.x + dx * t + px * off, a.z + dz * t + pz * off);
  }
  return pts;
}

function cellPathDist(pd, V, cx, cz) {
  return Math.min(pd[cz * V + cx], pd[cz * V + cx + 1], pd[(cz + 1) * V + cx], pd[(cz + 1) * V + cx + 1]);
}

function inExitGap(exits, cx, cz, N) {
  for (const ex of exits) {
    const onSide = ex.side === 'south' ? cz >= N - 2 : ex.side === 'north' ? cz < 2 : ex.side === 'east' ? cx >= N - 2 : cx < 2;
    if (!onSide) continue;
    const along = (ex.side === 'south' || ex.side === 'north') ? (cx + 0.5) - ex.x : (cz + 0.5) - ex.z;
    if (along <= 3 && along >= -3) return true;
  }
  return false;
}

function nearPad(pads, x, z, margin) {
  for (const p of pads) {
    const r = p.r + margin;
    if (dist2(x, z, p.x, p.z) < r * r) return true;
  }
  return false;
}

// --- queries used by the sim and the renderer --------------------------------------

export function cellAt(layout, x, z) {
  const N = layout.size;
  const cx = Math.floor(x), cz = Math.floor(z);
  if (cx < 0 || cz < 0 || cx >= N || cz >= N) return CELL.CLIFF;
  return layout.cell[cz * N + cx];
}

export function walkableCell(layout, cx, cz) {
  const N = layout.size;
  if (cx < 0 || cz < 0 || cx >= N || cz >= N) return false;
  return layout.walk[cz * N + cx] === 1;
}

export function walkableAt(layout, x, z) {
  return walkableCell(layout, Math.floor(x), Math.floor(z));
}

/**
 * Height of the rendered surface at (x,z). Each cell is two triangles split along the
 * (0,0)→(1,1) diagonal; the terrain mesh must use the same split so feet stay on the ground.
 */
export function groundHeight(layout, x, z) {
  const N = layout.size, V = N + 1, H = layout.heights;
  const fx = clamp(x, 0, N - 0.0001), fz = clamp(z, 0, N - 0.0001);
  const cx = Math.floor(fx), cz = Math.floor(fz);
  const tx = fx - cx, tz = fz - cz;
  const i = cz * V + cx;
  const h00 = H[i], h10 = H[i + 1], h01 = H[i + V], h11 = H[i + V + 1];
  if (tx > tz) return h00 + (h10 - h00) * tx + (h11 - h10) * tz;
  return h00 + (h01 - h00) * tz + (h11 - h01) * tx;
}

/** FNV-1a over the gameplay-relevant integers of a layout. The golden test pins this. */
export function layoutHash(layout) {
  let h = 0x811c9dc5;
  const mix = (v) => {
    v = v | 0;
    h ^= v & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  };
  mix(layout.size); mix(layout.seed); mix(hashString(layout.id));
  for (let i = 0; i < layout.heights.length; i++) mix(Math.floor(layout.heights[i] * 256));
  for (let i = 0; i < layout.cell.length; i++) mix(layout.cell[i]);
  for (const p of layout.props) {
    mix(hashString(p.kind)); mix(p.v); mix(Math.floor(p.x * 100)); mix(Math.floor(p.z * 100)); mix(p.rot); mix(Math.floor(p.s * 100));
  }
  for (const s of layout.spawns) {
    mix(hashString(s.type)); mix(s.count); mix(s.champion ? 1 : 0);
    mix(Math.floor(s.x * 100)); mix(Math.floor(s.z * 100)); mix(Math.floor(s.t * 1000));
    for (const m of s.members) { mix(Math.floor(m.x * 100)); mix(Math.floor(m.z * 100)); mix(m.facing); }
  }
  for (const e of layout.exits) { mix(hashString(e.to)); mix(Math.floor(e.x * 100)); mix(Math.floor(e.z * 100)); }
  mix(Math.floor(layout.playerSpawn.x * 100)); mix(Math.floor(layout.playerSpawn.z * 100));
  return h >>> 0;
}

/*
Layout shape (all coordinates in metres, cell = 1 m, origin at the zone's north-west):
  id, name, kind, seed, size N
  heights   Float32Array((N+1)²)   vertex heights, index = vz*(N+1)+vx
  cell      Uint8Array(N²)         CELL.GRASS|WATER|CLIFF|PATH, index = cz*N+cx
  walk      Uint8Array(N²)         1 walkable
  pathDist  Float32Array((N+1)²)   metres from each vertex to the nearest path point
  exits     [{to, side, x, z, r}]  exits[0] is the entrance
  playerSpawn {x, z, dx, dz}
  pads      [{x, z, r}]            flattened discs (spawn, exits)
  paths     [[x0,z0,x1,z1,...]]    polylines
  props     [{kind, v, x, z, rot 0..15 sixteenth-turns, s scale}]
  colliders [{x, z, r}]            circles that block movement
  spawns    [{index, x, z, type, count, champion, t 0..1 progress, members:[{x, z, facing 0..15}]}]
*/
