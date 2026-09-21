import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import recipes from '../../data/zones/index.js';
import classes from '../../data/classes.js';
import { generateZone, CELL } from '../zonegen.js';
import { findPath, nearestWalkable, simplifyPath, lineOfWalk, buildNavMask } from '../path.js';

const moor = recipes.gallowsmoor;
const SEEDS = [1, 1234, 77];
const R = classes.classes.warrior.radius;
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const layouts = new Map();
const moorLayout = (seed) => layouts.get(seed) || (layouts.set(seed, generateZone(moor, seed)), layouts.get(seed));

/** Start-exclusive, target-inclusive, cell centres, 8-adjacent, corner-safe, walkable. Returns the 10/14 cost. */
function checkRoute(L, path, sx, sz, tx, tz, mask = L.walk) {
  const N = L.size;
  let px = Math.floor(sx), pz = Math.floor(sz), cost = 0;
  for (let i = 0; i < path.length; i += 2) {
    const cx = Math.floor(path[i]), cz = Math.floor(path[i + 1]);
    assert.equal(path[i], cx + 0.5, 'cell centre x'); assert.equal(path[i + 1], cz + 0.5, 'cell centre z');
    assert.ok(mask[cz * N + cx], `waypoint ${i / 2} is not walkable`);
    const dx = cx - px, dz = cz - pz;
    assert.ok(Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && (dx || dz), `step ${i / 2} is not 8-adjacent`);
    if (dx && dz) assert.ok(mask[pz * N + cx] && mask[cz * N + px], `step ${i / 2} cuts a corner`);
    cost += dx && dz ? 14 : 10;
    px = cx; pz = cz;
  }
  assert.equal(px, Math.floor(tx)); assert.equal(pz, Math.floor(tz));
  return cost;
}

/** Dial's Dijkstra with the same 8-neighbour, no-corner-cut rule: the reference costs. */
function dialDist(L, sx, sz, mask = L.walk) {
  const N = L.size, INF = 0x7fffffff;
  const dist = new Int32Array(N * N).fill(INF);
  const start = Math.floor(sz) * N + Math.floor(sx);
  dist[start] = 0;
  const buckets = [[start]];
  for (let d = 0; d < buckets.length; d++) {
    const b = buckets[d];
    if (!b) continue;
    for (const c of b) {
      if (dist[c] !== d) continue;
      const cx = c % N, cz = (c - cx) / N;
      for (const [dx, dz] of NB) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const ni = nz * N + nx;
        if (!mask[ni]) continue;
        if (dx && dz && (!mask[cz * N + nx] || !mask[nz * N + cx])) continue;
        const nd = d + (dx && dz ? 14 : 10);
        if (nd < dist[ni]) { dist[ni] = nd; (buckets[nd] || (buckets[nd] = [])).push(ni); }
      }
    }
  }
  return dist;
}

test('spawn reaches every exit for seeds 1, 1234, 77 with a legal, optimal route', () => {
  for (const seed of SEEDS) {
    const L = moorLayout(seed);
    const sp = L.playerSpawn;
    const ref = dialDist(L, sp.x, sp.z);
    for (const ex of L.exits) {
      const path = findPath(L, sp.x, sp.z, ex.x, ex.z);
      assert.ok(path, `no route to ${ex.to} for seed ${seed}`);
      const cost = checkRoute(L, path, sp.x, sp.z, ex.x, ex.z);
      assert.equal(cost, ref[Math.floor(ex.z) * L.size + Math.floor(ex.x)], `route to ${ex.to} not optimal for seed ${seed}`);
      assert.deepEqual(findPath(L, sp.x, sp.z, ex.x, ex.z), path, 'deterministic');
    }
    // a spread of reachable cells across the zone, also optimal
    let checked = 0;
    for (let i = 977; i < L.walk.length && checked < 12; i += 1301) {
      if (ref[i] === 0x7fffffff) continue;
      const tx = (i % L.size) + 0.5, tz = Math.floor(i / L.size) + 0.5;
      const path = findPath(L, sp.x, sp.z, tx, tz);
      assert.ok(path, `no route to cell ${i}`);
      assert.equal(checkRoute(L, path, sp.x, sp.z, tx, tz), ref[i]);
      checked++;
    }
    assert.ok(checked >= 8, 'checked ' + checked);
  }
});

test('the same cell is an empty route; leaving the grid or exhausting maxExpand is null', () => {
  const L = moorLayout(1);
  const sp = L.playerSpawn, ex = L.exits[1];
  assert.deepEqual(findPath(L, sp.x, sp.z, sp.x + 0.2, sp.z + 0.2), []);
  assert.equal(findPath(L, sp.x, sp.z, -1, 5), null);
  assert.equal(findPath(L, sp.x, sp.z, ex.x, ex.z, 1), null, 'budget of one expansion');
  assert.ok(findPath(L, sp.x, sp.z, ex.x, ex.z), 'default budget');
});

test('a target inside water returns null unless nearestWalkable is used first', () => {
  for (const seed of SEEDS) {
    const L = moorLayout(seed), N = L.size;
    const sp = L.playerSpawn;
    const ref = dialDist(L, sp.x, sp.z);
    let tried = 0;
    for (let i = 0; i < L.cell.length && tried < 3; i++) {
      if (L.cell[i] !== CELL.WATER) continue;
      const wx = (i % N) + 0.5, wz = Math.floor(i / N) + 0.5;
      const land = nearestWalkable(L, wx, wz);
      if (!land || ref[Math.floor(land[1]) * N + Math.floor(land[0])] === 0x7fffffff) continue;
      tried++;
      assert.equal(findPath(L, sp.x, sp.z, wx, wz), null, 'water target');
      assert.ok(L.walk[Math.floor(land[1]) * N + Math.floor(land[0])], 'nearestWalkable lands on land');
      assert.ok(Math.max(Math.abs(land[0] - wx), Math.abs(land[1] - wz)) <= 6, 'within maxR rings');
      const path = findPath(L, sp.x, sp.z, land[0], land[1]);
      assert.ok(path, 'route to the shore');
      checkRoute(L, path, sp.x, sp.z, land[0], land[1]);
    }
    assert.equal(tried, 3, 'found shore cases for seed ' + seed);
  }
  const L = moorLayout(1);
  assert.deepEqual(nearestWalkable(L, L.playerSpawn.x, L.playerSpawn.z), [L.playerSpawn.x, L.playerSpawn.z], 'walkable point comes back as is');
  assert.equal(nearestWalkable(L, -20, -20, 4), null, 'nothing in range');
  // the nearest ring wins, then the closest cell inside it
  const N = 8, walk = new Uint8Array(N * N);
  walk[1 * N + 4] = 1; walk[4 * N + 1] = 1; walk[6 * N + 6] = 1;
  const tiny = { size: N, walk, colliders: [] };
  assert.deepEqual(nearestWalkable(tiny, 3.9, 3.2), [4.5, 1.5]);
  assert.deepEqual(nearestWalkable(tiny, 3.2, 3.9), [1.5, 4.5]);
  assert.deepEqual(nearestWalkable(tiny, 3.5, 3.5, 1), null);
});

test('lineOfWalk refuses blocked cells and corner cuts, and findPath obeys the same rule', () => {
  const N = 8, walk = new Uint8Array(N * N).fill(1);
  const L = { size: N, walk, colliders: [] };
  assert.ok(lineOfWalk(L, 1.5, 1.5, 6.5, 1.5));
  assert.ok(lineOfWalk(L, 1.5, 1.5, 6.5, 6.5));
  assert.ok(lineOfWalk(L, 6.5, 6.5, 1.5, 1.5));
  assert.ok(lineOfWalk(L, 1.5, 1.5, 6.5, 3.5));
  assert.ok(lineOfWalk(L, 2.5, 2.5, 2.5, 2.5), 'a point');
  walk[3 * N + 3] = 0;
  assert.equal(lineOfWalk(L, 1.5, 1.5, 6.5, 6.5), false, 'a blocked cell on the diagonal');
  assert.equal(lineOfWalk(L, 3.5, 3.5, 6.5, 6.5), false, 'a blocked start');
  walk[3 * N + 3] = 1;
  walk[2 * N + 3] = 0; walk[3 * N + 2] = 0; // both orthogonals of the (2,2)→(3,3) step
  assert.equal(lineOfWalk(L, 2.5, 2.5, 3.5, 3.5), false, 'corner cut with both blocked');
  walk[2 * N + 3] = 1;
  assert.equal(lineOfWalk(L, 2.5, 2.5, 3.5, 3.5), false, 'corner cut with one blocked');
  assert.equal(lineOfWalk(L, 3.5, 3.5, 2.5, 2.5), false, 'from the other end too');
  walk[3 * N + 2] = 1;
  assert.ok(lineOfWalk(L, 2.5, 2.5, 3.5, 3.5), 'open corner');
  assert.equal(lineOfWalk(L, 1.5, 1.5, 9.5, 1.5), false, 'off the grid');
  // A* around the pinched corner: the detour is legal and as short as Dijkstra says
  walk[2 * N + 3] = 0; walk[3 * N + 2] = 0;
  const path = findPath(L, 2.5, 2.5, 3.5, 3.5);
  assert.ok(path && path.length > 2, 'detour instead of a corner cut');
  const cost = checkRoute(L, path, 2.5, 2.5, 3.5, 3.5);
  assert.equal(cost, dialDist(L, 2.5, 2.5)[3 * N + 3]);
  // sealed off: null
  for (let x = 0; x < N; x++) walk[5 * N + x] = 0;
  assert.equal(findPath(L, 2.5, 2.5, 3.5, 6.5), null);
});

test('simplifyPath output still passes the line-of-walk check', () => {
  for (const seed of SEEDS) {
    const L = moorLayout(seed);
    const sp = L.playerSpawn;
    for (const ex of L.exits) {
      const path = findPath(L, sp.x, sp.z, ex.x, ex.z);
      for (const from of [null, [sp.x, sp.z]]) {
        const s = simplifyPath(L, path, from);
        assert.ok(s.length >= 2 && s.length <= path.length);
        assert.ok(s.length % 2 === 0);
        assert.equal(s[s.length - 2], path[path.length - 2]); assert.equal(s[s.length - 1], path[path.length - 1]);
        if (!from) { assert.equal(s[0], path[0]); assert.equal(s[1], path[1]); }
        let ax = from ? from[0] : s[0], az = from ? from[1] : s[1];
        for (let i = from ? 0 : 2; i < s.length; i += 2) {
          assert.ok(lineOfWalk(L, ax, az, s[i], s[i + 1]), `segment to waypoint ${i / 2} for seed ${seed}`);
          ax = s[i]; az = s[i + 1];
        }
        // every kept waypoint is one of the original ones, in order
        let k = 0;
        for (let i = 0; i < s.length; i += 2) {
          while (k < path.length && (path[k] !== s[i] || path[k + 1] !== s[i + 1])) k += 2;
          assert.ok(k < path.length, 'kept waypoint comes from the route');
        }
      }
    }
    const long = findPath(L, sp.x, sp.z, L.exits[1].x, L.exits[1].z);
    assert.ok(simplifyPath(L, long, [sp.x, sp.z]).length < long.length / 3, 'a cross-zone route shrinks a lot');
  }
  assert.deepEqual(simplifyPath(moorLayout(1), []), []);
});

test('buildNavMask clears cells under props and spawn still reaches every exit around them', () => {
  for (const seed of SEEDS) {
    const L = moorLayout(seed), N = L.size;
    const nav = buildNavMask(L, R);
    assert.equal(nav.length, L.walk.length);
    let cleared = 0;
    for (let i = 0; i < N * N; i++) {
      assert.ok(nav[i] <= L.walk[i], 'nav never adds walkable cells');
      if (nav[i] !== L.walk[i]) cleared++;
    }
    assert.ok(cleared >= L.colliders.length, 'at least one cell per prop');
    for (const c of L.colliders) assert.equal(nav[Math.floor(c.z) * N + Math.floor(c.x)], 0, "the prop's own cell");
    const sp = L.playerSpawn;
    for (const ex of L.exits) {
      const path = findPath(L, sp.x, sp.z, ex.x, ex.z, 4000, nav);
      assert.ok(path, `nav route to ${ex.to} for seed ${seed}`);
      checkRoute(L, path, sp.x, sp.z, ex.x, ex.z, nav);
      for (let i = 0; i < path.length; i += 2) {
        for (const c of L.colliders) assert.ok(Math.hypot(path[i] - c.x, path[i + 1] - c.z) >= c.r + R, 'waypoint clear of props');
      }
    }
  }
});

test('a 128×128 route averages under 3 ms, and a whole-zone flood stays cheap', () => {
  const runs = [];
  for (const seed of SEEDS) {
    const L = moorLayout(seed);
    const sp = L.playerSpawn;
    for (const ex of L.exits) runs.push([L, sp.x, sp.z, ex.x, ex.z]);
  }
  for (const [L, sx, sz, tx, tz] of runs) for (let i = 0; i < 5; i++) findPath(L, sx, sz, tx, tz); // warm up
  const REPS = 20;
  const t0 = performance.now();
  for (let i = 0; i < REPS; i++) for (const [L, sx, sz, tx, tz] of runs) findPath(L, sx, sz, tx, tz);
  const avg = (performance.now() - t0) / (REPS * runs.length);
  assert.ok(avg < 3, `average ${avg.toFixed(3)} ms`);
  // worst case: a walkable cell no route reaches makes A* visit every reachable cell
  const L = moorLayout(1234), N = L.size;
  const ref = dialDist(L, L.playerSpawn.x, L.playerSpawn.z);
  let pocket = -1;
  for (let i = 0; i < N * N; i++) if (L.walk[i] && ref[i] === 0x7fffffff) { pocket = i; break; }
  assert.ok(pocket >= 0, 'the moor has an unreachable walkable pocket');
  const px = (pocket % N) + 0.5, pz = Math.floor(pocket / N) + 0.5;
  for (let i = 0; i < 5; i++) assert.equal(findPath(L, L.playerSpawn.x, L.playerSpawn.z, px, pz, N * N), null);
  // best of a few batches: the suite runs files in parallel and a GC pause is not a regression
  let flood = Infinity;
  for (let b = 0; b < 5; b++) {
    const t1 = performance.now();
    for (let i = 0; i < REPS; i++) findPath(L, L.playerSpawn.x, L.playerSpawn.z, px, pz, N * N);
    flood = Math.min(flood, (performance.now() - t1) / REPS);
  }
  assert.ok(flood < 3, `flood ${flood.toFixed(3)} ms`);
});
