import { test } from 'node:test';
import assert from 'node:assert/strict';
import recipes from '../../data/zones/index.js';
import { generateZone, layoutHash, walkableAt, groundHeight, CELL } from '../zonegen.js';
import golden from '../golden.js';

const moor = recipes.gallowsmoor;

test('golden hashes match', () => {
  for (const [key, want] of Object.entries(golden.zonegen)) {
    const [id, seed] = key.split(':');
    assert.equal(layoutHash(generateZone(recipes[id], Number(seed))), want, key);
  }
});

test('same recipe and seed → identical layout; different seed → different layout', () => {
  const a = generateZone(moor, 1234), b = generateZone(moor, 1234), c = generateZone(moor, 1235);
  assert.equal(layoutHash(a), layoutHash(b));
  assert.notEqual(layoutHash(a), layoutHash(c));
  assert.deepEqual(Array.from(a.heights.subarray(0, 64)), Array.from(b.heights.subarray(0, 64)));
});

test('spawn, exits and every pack member stand on walkable ground', () => {
  for (const seed of [1, 2, 3, 1234, 999, -5]) {
    const L = generateZone(moor, seed);
    assert.ok(walkableAt(L, L.playerSpawn.x, L.playerSpawn.z), 'spawn ' + seed);
    for (const ex of L.exits) assert.ok(walkableAt(L, ex.x, ex.z), 'exit ' + ex.to + ' ' + seed);
    for (const s of L.spawns) for (const m of s.members) assert.ok(walkableAt(L, m.x, m.z), 'member ' + seed);
  }
});

test('the entrance reaches every exit on foot (BFS over the walk mask)', () => {
  for (const seed of [1, 2, 3, 1234, 999, -5, 2024, 77]) {
    const L = generateZone(moor, seed);
    const N = L.size;
    const seen = new Uint8Array(N * N);
    const q = [Math.floor(L.playerSpawn.x), Math.floor(L.playerSpawn.z)];
    seen[q[1] * N + q[0]] = 1;
    for (let i = 0; i < q.length; i += 2) {
      const x = q[i], z = q[i + 1];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const k = nz * N + nx;
        if (seen[k] || !L.walk[k]) continue;
        seen[k] = 1; q.push(nx, nz);
      }
    }
    for (const ex of L.exits) assert.ok(seen[Math.floor(ex.z) * N + Math.floor(ex.x)], `exit ${ex.to} unreachable for seed ${seed}`);
    const reached = q.length / 2;
    assert.ok(reached > N * N * 0.4, `only ${reached} cells reachable for seed ${seed}`);
  }
});

test('density lands in the design range', () => {
  const L = generateZone(moor, 1234);
  const monsters = L.spawns.reduce((a, s) => a + s.count, 0);
  assert.ok(L.spawns.length >= 8 && L.spawns.length <= 16, 'packs ' + L.spawns.length);
  assert.ok(monsters >= 40 && monsters <= 96, 'monsters ' + monsters);
  assert.ok(L.props.length >= 150 && L.props.length <= 700, 'props ' + L.props.length);
  for (const s of L.spawns) {
    assert.ok(s.count >= moor.spawns.packMin && s.count <= moor.spawns.packMax);
    assert.equal(s.members.length, s.count);
    assert.ok(s.t >= 0 && s.t <= 1);
    assert.ok(moor.spawns.types.includes(s.type));
  }
  let counts = [0, 0, 0, 0];
  for (const c of L.cell) counts[c]++;
  assert.ok(counts[CELL.PATH] > 200, 'path cells');
  assert.ok(counts[CELL.WATER] > 200, 'water cells');
  assert.ok(counts[CELL.GRASS] > counts[CELL.WATER], 'mostly land');
});

test('the border is sealed except at exits', () => {
  const L = generateZone(moor, 1234);
  const N = L.size;
  let gaps = 0;
  for (let x = 0; x < N; x++) for (const z of [0, 1, N - 2, N - 1]) if (L.walk[z * N + x]) gaps++;
  for (let z = 2; z < N - 2; z++) for (const x of [0, 1, N - 2, N - 1]) if (L.walk[z * N + x]) gaps++;
  // each exit opens a 7-cell wide, 2-cell deep gap
  assert.ok(gaps <= L.exits.length * 14 && gaps > 0, 'border gaps ' + gaps);
});

test('groundHeight interpolates inside the cell and is flat on pads', () => {
  const L = generateZone(moor, 1234);
  const p = L.playerSpawn;
  assert.ok(Math.abs(groundHeight(L, p.x, p.z)) < 0.05, 'spawn pad flat');
  const V = L.size + 1;
  const h = groundHeight(L, 40.5, 40.5);
  const corners = [L.heights[40 * V + 40], L.heights[40 * V + 41], L.heights[41 * V + 40], L.heights[41 * V + 41]];
  assert.ok(h >= Math.min(...corners) - 1e-6 && h <= Math.max(...corners) + 1e-6);
  assert.equal(groundHeight(L, 10, 10), L.heights[10 * V + 10]);
});
