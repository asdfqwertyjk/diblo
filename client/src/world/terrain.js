// client/src/world/terrain.js — heightfield mesh, one non-indexed chunk per 32 m, plus one
// flat water plane. Faces are coloured by cell type; every cell is split along the
// (0,0)→(1,1) diagonal exactly like groundHeight in shared/sim/zonegen.js so feet stay
// on the ground. Nothing here runs per frame; all allocation happens at build time.
import {
  BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial, PlaneGeometry,
} from 'three';
import { CELL } from 'shared/sim/zonegen.js';
import zones from 'shared/data/zones/index.js';
import { flatMaterial } from '../render/materials.js';

/** Chunk edge in metres (cells). layout.size is normally a multiple of this. */
export const CHUNK = 32;
/** Per-face colour jitter amplitude (fraction of the colour), so flat shading reads. */
const JITTER = 0.05;
/**
 * The water plane floats this far above the recipe's water line: enough to hide the flat
 * WATER cells' corners, small enough that GRASS cells (mean height ≥ waterLine, where packs
 * and props may sit) never read as flooded.
 */
const WATER_LIFT = 0.04;
const WATER_OPACITY = 0.85;
/**
 * The outermost vertex ring of the zone is lifted by this much so the sealed 2-cell CLIFF
 * border reads as a wall instead of a flat grey strip ending in sky. Those cells are never
 * walkable, so the sim's groundHeight is untouched where anything can stand. Vertices inside
 * an exit gap (walkable PATH cells) keep their true height.
 */
const RIM_LIFT = 2.5;
/** Half-width in metres of the exit gap left unlifted (the gap itself is 7 cells wide). */
const RIM_GAP = 4;

// Scratch colours reused across chunks (build-time only).
const cLow = new Color(), cHigh = new Color(), cPath = new Color(), cCliff = new Color();
const cWater = new Color(), cShore = new Color(), cTmp = new Color();

/**
 * @param {object} layout   from generateZone
 * @param {object} biome    recipe.biome (ground palette)
 * @param {number} [waterLine]  recipe.terrain.waterLine; when omitted it is read from the
 *                              zone table by layout.id, else estimated from the layout.
 * @returns {Group} terrain chunks + water; `group.userData.dispose()` frees geometries,
 *                  `group.userData.waterLine` is the water line used.
 */
export function buildTerrain(layout, biome, waterLine) {
  const N = layout.size, H = layout.heights;
  if (typeof waterLine !== 'number') waterLine = findWaterLine(layout);
  const g = biome.ground;
  cLow.set(g.low); cHigh.set(g.high); cPath.set(g.path);
  cCliff.set(g.cliff); cWater.set(g.water); cShore.set(g.shore);

  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < H.length; i++) {
    const h = H[i];
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
  const hSpan = hMax - hMin > 1e-6 ? hMax - hMin : 1;

  const group = new Group();
  group.name = 'terrain';
  const material = flatMaterial();
  const geometries = [];
  const chunks = Math.ceil(N / CHUNK);
  for (let gz = 0; gz < chunks; gz++) {
    for (let gx = 0; gx < chunks; gx++) {
      const geo = buildChunk(layout, gx, gz, hMin, hSpan);
      const mesh = new Mesh(geo, material);
      mesh.name = 'terrain:' + gx + ',' + gz;
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      geometries.push(geo);
    }
  }

  // One flat water plane over the whole zone; the terrain under it is drawn too.
  const waterGeo = new PlaneGeometry(N, N, 1, 1);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new MeshLambertMaterial({
    color: g.water, transparent: true, opacity: WATER_OPACITY, depthWrite: false,
  });
  const water = new Mesh(waterGeo, waterMat);
  water.name = 'water';
  water.position.set(N / 2, waterLine + WATER_LIFT, N / 2);
  water.updateMatrix();
  water.matrixAutoUpdate = false;
  water.renderOrder = 1;
  group.add(water);

  group.userData.waterLine = waterLine;
  group.userData.chunks = geometries.length;
  group.userData.dispose = () => {
    for (let i = 0; i < geometries.length; i++) geometries[i].dispose();
    waterGeo.dispose();
    waterMat.dispose();
  };
  return group;
}

/** One non-indexed BufferGeometry for the cells [gx*CHUNK, +CHUNK) × [gz*CHUNK, +CHUNK). */
function buildChunk(layout, gx, gz, hMin, hSpan) {
  const N = layout.size, V = N + 1, H = layout.heights;
  const x0 = gx * CHUNK, z0 = gz * CHUNK;
  const x1 = Math.min(N, x0 + CHUNK), z1 = Math.min(N, z0 + CHUNK);
  const cellCount = (x1 - x0) * (z1 - z0);
  // 2 triangles × 3 vertices × 3 floats per cell
  const pos = new Float32Array(cellCount * 18);
  const col = new Float32Array(cellCount * 18);
  let p = 0;
  for (let cz = z0; cz < z1; cz++) {
    for (let cx = x0; cx < x1; cx++) {
      const ci = cz * N + cx;
      const vi = cz * V + cx;
      const h00 = H[vi] + rimLift(layout, cx, cz);
      const h10 = H[vi + 1] + rimLift(layout, cx + 1, cz);
      const h01 = H[vi + V] + rimLift(layout, cx, cz + 1);
      const h11 = H[vi + V + 1] + rimLift(layout, cx + 1, cz + 1);
      cellColour(layout, cx, cz, ci, (H[vi] + H[vi + 1] + H[vi + V] + H[vi + V + 1]) * 0.25, hMin, hSpan);
      const r = cTmp.r, gg = cTmp.g, b = cTmp.b;

      // Triangle A covers the tx > tz half: corners (0,0) (1,0) (1,1). Wound so the
      // normal points +y: v00 → v11 → v10.
      let j = 1 + JITTER * (hash01(ci * 2) * 2 - 1);
      let cr = r * j, cg = gg * j, cb = b * j;
      pos[p] = cx;     pos[p + 1] = h00; pos[p + 2] = cz;
      pos[p + 3] = cx + 1; pos[p + 4] = h11; pos[p + 5] = cz + 1;
      pos[p + 6] = cx + 1; pos[p + 7] = h10; pos[p + 8] = cz;
      col[p] = cr; col[p + 1] = cg; col[p + 2] = cb;
      col[p + 3] = cr; col[p + 4] = cg; col[p + 5] = cb;
      col[p + 6] = cr; col[p + 7] = cg; col[p + 8] = cb;
      p += 9;

      // Triangle B covers the tx <= tz half: corners (0,0) (0,1) (1,1): v00 → v01 → v11.
      j = 1 + JITTER * (hash01(ci * 2 + 1) * 2 - 1);
      cr = r * j; cg = gg * j; cb = b * j;
      pos[p] = cx;     pos[p + 1] = h00; pos[p + 2] = cz;
      pos[p + 3] = cx;     pos[p + 4] = h01; pos[p + 5] = cz + 1;
      pos[p + 6] = cx + 1; pos[p + 7] = h11; pos[p + 8] = cz + 1;
      col[p] = cr; col[p + 1] = cg; col[p + 2] = cb;
      col[p + 3] = cr; col[p + 4] = cg; col[p + 5] = cb;
      col[p + 6] = cr; col[p + 7] = cg; col[p + 8] = cb;
      p += 9;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals(); // non-indexed → one hard normal per face
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Extra height for vertex (vx, vz): RIM_LIFT on the zone's outermost ring, 0 elsewhere and
 * within RIM_GAP metres along the edge of an exit on that side. Build-time only.
 */
function rimLift(layout, vx, vz) {
  const N = layout.size;
  const west = vx === 0, east = vx === N, north = vz === 0, south = vz === N;
  if (!(west || east || north || south)) return 0;
  const exits = layout.exits;
  for (let i = 0; i < exits.length; i++) {
    const ex = exits[i];
    const s = ex.side;
    const onSide = s === 'south' ? south : s === 'north' ? north : s === 'east' ? east : west;
    if (!onSide) continue;
    const along = (s === 'south' || s === 'north') ? vx - ex.x : vz - ex.z;
    if (along >= -RIM_GAP && along <= RIM_GAP) return 0;
  }
  return RIM_LIFT;
}

/** Writes the cell's base colour (linear, before jitter) into cTmp. */
function cellColour(layout, cx, cz, ci, havg, hMin, hSpan) {
  const t = layout.cell[ci];
  if (t === CELL.PATH) cTmp.copy(cPath);
  else if (t === CELL.CLIFF) cTmp.copy(cCliff);
  else if (t === CELL.WATER) cTmp.copy(cWater);
  else if (touchesWater(layout, cx, cz)) cTmp.copy(cShore);
  else cTmp.copy(cLow).lerp(cHigh, clamp01((havg - hMin) / hSpan));
}

/** True when any 4-neighbour of cell (cx,cz) is WATER. */
function touchesWater(layout, cx, cz) {
  const N = layout.size, cell = layout.cell;
  if (cx > 0 && cell[cz * N + cx - 1] === CELL.WATER) return true;
  if (cx < N - 1 && cell[cz * N + cx + 1] === CELL.WATER) return true;
  if (cz > 0 && cell[(cz - 1) * N + cx] === CELL.WATER) return true;
  if (cz < N - 1 && cell[(cz + 1) * N + cx] === CELL.WATER) return true;
  return false;
}

/**
 * Water line for a layout: the recipe's terrain.waterLine when the zone table knows the
 * id, else the highest mean height among WATER cells, else just under the lowest vertex
 * (so the plane exists but stays hidden).
 */
export function findWaterLine(layout) {
  const recipe = zones[layout.id];
  if (recipe && recipe.terrain && typeof recipe.terrain.waterLine === 'number') {
    return recipe.terrain.waterLine;
  }
  const N = layout.size, V = N + 1, H = layout.heights, cell = layout.cell;
  let best = -Infinity, lowest = Infinity;
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const vi = cz * V + cx;
      const havg = (H[vi] + H[vi + 1] + H[vi + V] + H[vi + V + 1]) * 0.25;
      if (havg < lowest) lowest = havg;
      if (cell[cz * N + cx] === CELL.WATER && havg > best) best = havg;
    }
  }
  return best > -Infinity ? best : lowest - 1;
}

/** Deterministic [0,1) from an integer; integer ops only, no Math.random. */
function hash01(i) {
  let h = (i | 0) ^ 0x2545f491;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
