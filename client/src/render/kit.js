// client/src/render/kit.js — the procedural prop kit. Every piece is boxes, low-segment
// cylinders and cones, each painted a hard colour with a little per-face noise, merged into one
// non-indexed vertex-coloured geometry. Origin at the ground centre, +y up. Built once per session.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import recipes from 'shared/data/zones/index.js';
import { paintFaces, shadeHex, mixHex } from './materials.js';

export const TRI_BUDGET = 300;

/** Variant count per kind (the P0 list). */
export const KIT_VARIANTS = {
  deadTree: 3, tree: 3, rock: 3, gravestone: 2, bones: 2, stump: 1, ruinWall: 2, torch: 1,
  crate: 1, barrel: 1, fence: 1, well: 1, chest: 1, waypointStone: 1,
};

/** Collision radius per kind: the zone recipes' values where a recipe lists the kind, else these defaults. */
export const KIT_COLLIDER_RADIUS = (() => {
  const r = { torch: 0.25, crate: 0.5, barrel: 0.45, fence: 1.0, well: 1.0, chest: 0.5, waypointStone: 0.7 };
  for (const recipe of Object.values(recipes)) for (const p of recipe.biome?.props || []) r[p.kind] = p.r;
  return r;
})();

// --- palette: moor at dusk -----------------------------------------------------------------
const P = {
  deadBark: 0x4a4038, bark: 0x3b2d21, barkLight: 0x8a6e4a, leaf: 0x3f5f2b, pine: 0x2c4a32, sallow: 0x5e6a2e,
  stone: 0x6d6a68, stoneDark: 0x4c4846, moss: 0x4b5c33, bone: 0xd9d0b4,
  wood: 0x6e5236, woodDark: 0x4a3623, iron: 0x3a3a42, gold: 0xc8a24a,
  flame: 0xff8c1a, flameTip: 0xffe38a, rune: 0x7ad0ff, water: 0x16222d, missing: 0xff00ff,
};

// --- deterministic noise so the kit looks the same every session ---------------------------
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedOf(kind, v) {
  let h = 2166136261;
  for (let i = 0; i < kind.length; i++) h = Math.imul(h ^ kind.charCodeAt(i), 16777619);
  return (h ^ Math.imul(v + 1, 0x9e3779b1)) >>> 0;
}

// --- part builders: non-indexed, uv stripped (nothing here is textured) ---------------------
const TAU = Math.PI * 2;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

function prep(g) {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  n.deleteAttribute('uv');
  return n;
}
const box = (w, h, d) => prep(new THREE.BoxGeometry(w, h, d));
const cyl = (rTop, rBot, h, seg = 6, open = false) => prep(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open));
const cone = (r, h, seg = 6) => prep(new THREE.ConeGeometry(r, h, seg, 1));
const disc = (r, seg = 8) => prep(new THREE.CircleGeometry(r, seg)).rotateX(-Math.PI / 2);
const ico = (r) => prep(new THREE.IcosahedronGeometry(r, 0));
const dodeca = (r) => prep(new THREE.DodecahedronGeometry(r, 0));
const octa = (r) => prep(new THREE.OctahedronGeometry(r, 0));

/** Lift a centred cylinder/cone so it stands on y = 0. */
const stand = (g, h) => g.translate(0, h / 2, 0);
/** Orient (rx), tilt (rz), spin (ry), then move. Rotations are about the geometry's origin. */
function put(g, x, y, z, ry = 0, rz = 0, rx = 0) {
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  return g.translate(x, y, z);
}
/** Tilt and spin an already-positioned upright part about the ground origin. */
const lean = (g, rz, ry) => g.rotateZ(rz).rotateY(ry);

/** Nudge every distinct vertex by up to `amt`; shared corners move together so faces stay joined. */
function jitter(g, rnd, amt) {
  const a = g.getAttribute('position').array, seen = new Map();
  for (let i = 0; i < a.length; i += 3) {
    const key = `${Math.round(a[i] * 1e3)},${Math.round(a[i + 1] * 1e3)},${Math.round(a[i + 2] * 1e3)}`;
    let d = seen.get(key);
    if (!d) { d = [(rnd() * 2 - 1) * amt, (rnd() * 2 - 1) * amt, (rnd() * 2 - 1) * amt]; seen.set(key, d); }
    a[i] += d[0]; a[i + 1] += d[1]; a[i + 2] += d[2];
  }
  g.computeVertexNormals();
  return g;
}

// --- painters --------------------------------------------------------------------------------
/** Hard colour with a little per-face brightness noise so flat faces still read as separate. */
function paint(g, hex, rnd, vary = 0.08) {
  return paintFaces(g, () => shadeHex(hex, 1 + (rnd() * 2 - 1) * vary));
}
/** Darker toward y0, full colour at y1, plus noise: undersides read as shadowed. */
function paintY(g, hex, rnd, y0, y1, dark = 0.7, vary = 0.06) {
  const span = y1 - y0 || 1;
  return paintFaces(g, (f, c) => shadeHex(hex, dark + (1 - dark) * clamp01((c.y - y0) / span) + (rnd() * 2 - 1) * vary));
}
/** Stone with moss creeping up from the ground line to `mossTo`. */
function paintStone(g, hex, rnd, mossTo = 0.4, vary = 0.1) {
  return paintFaces(g, (f, c) => {
    const m = c.y < mossTo ? (1 - c.y / mossTo) * 0.6 : 0;
    return shadeHex(mixHex(hex, P.moss, m), 1 + (rnd() * 2 - 1) * vary);
  });
}

/** Merge painted parts into the finished piece: bounds, tri count, budget check. */
function finish(parts, kind) {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error(`kit: mergeGeometries failed for ${kind} (attribute mismatch)`);
  for (const p of parts) p.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.userData.tris = g.getAttribute('position').count / 3;
  g.userData.kind = kind;
  if (g.userData.tris > TRI_BUDGET) console.warn(`kit: ${kind} has ${g.userData.tris} tris (budget ${TRI_BUDGET})`);
  return g;
}

/** A tapered stick from (x,y,z), tilted `tilt` from vertical and spun `spin` about y; optional twig at its tip. */
function branch(parts, rnd, hex, x, y, z, len, tilt, spin, r0, r1, seg, twig) {
  const b = cyl(r0, r1, len, seg);
  stand(b, len);
  parts.push(paint(put(b, x, y, z, spin, tilt), hex, rnd, 0.1));
  if (twig) {
    const tx = x - len * Math.sin(tilt) * Math.cos(spin), ty = y + len * Math.cos(tilt), tz = z + len * Math.sin(tilt) * Math.sin(spin);
    branch(parts, rnd, hex, tx, ty, tz, len * 0.55, tilt + (rnd() - 0.5) * 1.2, spin + (rnd() - 0.5) * 1.4, r0 * 0.6, r1 * 0.6, 4, false);
  }
}

// --- pieces ------------------------------------------------------------------------------------
function deadTree(v, rnd) {
  const parts = [], h = 3.0 + v * 0.55, tilt = (rnd() - 0.5) * 0.1;
  const trunk = cyl(0.1, 0.3, h, 6);
  stand(trunk, h);
  parts.push(paintY(put(trunk, 0, -0.15, 0, 0, tilt), P.deadBark, rnd, 0, h, 0.75, 0.08));
  const flare = cone(0.5, 0.55, 5);
  stand(flare, 0.55);
  parts.push(paint(put(flare, 0, -0.2, 0, rnd() * TAU), shadeHex(P.deadBark, 0.8), rnd, 0.1));
  const n = 3 + v;
  for (let i = 0; i < n; i++) {
    const spin = (i / n) * TAU + rnd() * 0.9, y = h * (0.42 + 0.4 * rnd());
    branch(parts, rnd, P.deadBark, -y * Math.sin(tilt), y * Math.cos(tilt) - 0.15, 0,
      0.8 + rnd() * 0.7 + v * 0.1, 0.8 + rnd() * 0.5, spin, 0.03, 0.09, 5, true);
  }
  return finish(parts, 'deadTree');
}

function tree(v, rnd) {
  const parts = [];
  if (v === 0) { // pine: tall trunk, three stacked cones
    const trunk = cyl(0.12, 0.26, 1.8, 6);
    stand(trunk, 1.8);
    parts.push(paintY(put(trunk, 0, -0.15, 0), P.bark, rnd, 0, 1.8, 0.7));
    for (const [r, h, y] of [[1.35, 1.7, 1.2], [1.05, 1.5, 2.2], [0.7, 1.4, 3.1]]) {
      const c = cone(r, h, 6);
      stand(c, h);
      parts.push(paintY(put(c, 0, y, 0, rnd() * TAU), P.pine, rnd, y, y + h, 0.6));
    }
  } else if (v === 1) { // broadleaf: two lumpy crowns
    const trunk = cyl(0.16, 0.32, 2.2, 6);
    stand(trunk, 2.2);
    parts.push(paintY(put(trunk, 0, -0.15, 0, 0, 0.05), P.bark, rnd, 0, 2.2, 0.7));
    const big = jitter(dodeca(1.45), rnd, 0.16);
    parts.push(paintY(put(big, 0.1, 3.0, 0, rnd() * TAU), P.leaf, rnd, 1.6, 4.4, 0.55));
    const small = jitter(dodeca(0.95), rnd, 0.12);
    parts.push(paintY(put(small, -0.9, 2.4, 0.5, rnd() * TAU), P.leaf, rnd, 1.5, 3.3, 0.55));
  } else { // sallow: leaning trunk, two boughs, ragged crowns
    const tilt = 0.16, h = 2.4;
    const trunk = cyl(0.18, 0.34, h, 7);
    stand(trunk, h);
    parts.push(paintY(put(trunk, 0, -0.15, 0, 0, tilt), P.bark, rnd, 0, h, 0.7));
    const tx = -(h - 0.2) * Math.sin(tilt), ty = (h - 0.2) * Math.cos(tilt) - 0.15;
    for (let i = 0; i < 2; i++) {
      const spin = i * Math.PI + 0.6 + rnd() * 0.5, bt = 0.7 + rnd() * 0.3, len = 1.2 + rnd() * 0.3;
      branch(parts, rnd, P.bark, tx, ty, 0, len, bt, spin, 0.06, 0.14, 5, false);
      const r = 0.85 + rnd() * 0.25, cy = ty + len * Math.cos(bt) + 0.2;
      const crown = jitter(ico(r), rnd, 0.12);
      put(crown, tx - len * Math.sin(bt) * Math.cos(spin), cy, len * Math.sin(bt) * Math.sin(spin), rnd() * TAU);
      parts.push(paintY(crown, P.sallow, rnd, cy - r, cy + r, 0.55));
    }
  }
  return finish(parts, 'tree');
}

function rock(v, rnd) {
  const parts = [];
  if (v === 0) { // one boulder and a pebble
    const b = jitter(ico(0.75), rnd, 0.14).scale(1.15, 0.8, 1);
    parts.push(paintStone(put(b, 0, 0.42, 0, rnd() * TAU), P.stone, rnd, 0.35));
    const p = jitter(ico(0.32), rnd, 0.06);
    parts.push(paintStone(put(p, 0.85, 0.18, 0.35, rnd() * TAU), P.stone, rnd, 0.25));
  } else if (v === 1) { // a cluster of three
    for (const [x, y, z, r] of [[0, 0.45, 0, 0.8], [0.9, 0.3, 0.4, 0.55], [-0.6, 0.25, 0.7, 0.45]]) {
      const d = jitter(dodeca(r), rnd, r * 0.15).scale(1, 0.85, 1);
      parts.push(paintStone(put(d, x, y, z, rnd() * TAU), P.stone, rnd, 0.35));
    }
  } else { // a tilted slab half sunk in the moor
    const s = jitter(box(1.8, 0.55, 1.1), rnd, 0.06);
    parts.push(paintStone(put(s, 0, 0.18, 0, rnd() * TAU, 0.12, 0.08), P.stoneDark, rnd, 0.3));
    const p = jitter(ico(0.3), rnd, 0.06);
    parts.push(paintStone(put(p, -0.9, 0.15, -0.5, rnd() * TAU), P.stone, rnd, 0.25));
  }
  return finish(parts, 'rock');
}

function gravestone(v, rnd) {
  const parts = [], tilt = (rnd() - 0.5) * 0.14, spin = (rnd() - 0.5) * 0.4;
  parts.push(paintStone(put(box(0.8, 0.16, 0.5), 0, 0.04, 0, spin), P.stoneDark, rnd, 0.2));
  if (v === 0) { // headstone with a rounded crown and a dark inscription
    const slab = box(0.56, 0.95, 0.14).translate(0, 0.55, 0);
    const crown = cyl(0.28, 0.28, 0.14, 8).rotateX(Math.PI / 2).translate(0, 1.0, 0);
    const plaque = box(0.36, 0.4, 0.03).translate(0, 0.62, 0.075);
    for (const g of [slab, crown]) parts.push(paintStone(lean(g, tilt, spin), P.stone, rnd, 0.4, 0.07));
    parts.push(paint(lean(plaque, tilt, spin), P.stoneDark, rnd, 0.05));
  } else { // a weathered cross
    const post = box(0.18, 1.35, 0.18).translate(0, 0.7, 0);
    const arm = box(0.72, 0.18, 0.18).translate(0, 1.0, 0);
    for (const g of [post, arm]) parts.push(paintStone(lean(g, tilt, spin), P.stone, rnd, 0.4, 0.07));
    const rubble = jitter(ico(0.18), rnd, 0.04);
    parts.push(paintStone(put(rubble, 0.5, 0.1, 0.3, rnd() * TAU), P.stone, rnd, 0.25));
  }
  return finish(parts, 'gravestone');
}

function bones(v, rnd) {
  const parts = [], spin = rnd() * TAU;
  const skull = jitter(dodeca(0.17), rnd, 0.02).scale(1, 0.9, 1.1).translate(v ? -0.75 : 0.25, 0.15, v ? 0.2 : -0.1);
  parts.push(paintY(put(skull, 0, 0, 0, spin), P.bone, rnd, 0, 0.32, 0.7, 0.05));
  if (v === 0) { // a skull and two long bones
    for (let i = 0; i < 2; i++) {
      const a = 0.5 + i * 1.9, x = -0.2 + i * 0.3, z = 0.25 - i * 0.5;
      const shaft = cyl(0.035, 0.035, 0.75, 5).rotateX(Math.PI / 2).rotateY(a).translate(x, 0.05, z);
      parts.push(paint(put(shaft, 0, 0, 0, spin), P.bone, rnd, 0.06));
      for (const s of [-1, 1]) {
        const knob = octa(0.075).translate(x + s * 0.38 * Math.sin(a), 0.07, z + s * 0.38 * Math.cos(a));
        parts.push(paint(put(knob, 0, 0, 0, spin), P.bone, rnd, 0.06));
      }
    }
  } else { // a ribcage on a spine
    const spine = cyl(0.04, 0.04, 1.1, 5).rotateZ(Math.PI / 2).translate(0.1, 0.06, 0);
    parts.push(paint(put(spine, 0, 0, 0, spin), P.bone, rnd, 0.06));
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const rib = box(0.06, 0.06, 0.6).translate(0, 0, 0.3 * side).rotateX(-0.9 * side).translate(-0.3 + i * 0.22, 0.06, 0);
        parts.push(paint(put(rib, 0, 0, 0, spin), P.bone, rnd, 0.06));
      }
    }
  }
  return finish(parts, 'bones');
}

function stump(v, rnd) {
  const parts = [], h = 0.6;
  const body = cyl(0.36, 0.46, h, 7);
  stand(body, h);
  put(body, 0, -0.1, 0, rnd() * TAU);
  parts.push(paintFaces(body, (f, c) => (c.y > h - 0.25
    ? shadeHex(P.barkLight, 1 + (rnd() * 2 - 1) * 0.06)
    : shadeHex(P.bark, 0.85 + (rnd() * 2 - 1) * 0.1))));
  for (let i = 0; i < 3; i++) {
    const root = box(0.6, 0.14, 0.2).translate(0.5, 0, 0);
    parts.push(paint(put(root, 0, 0.03, 0, (i / 3) * TAU + rnd() * 0.6, -0.12), P.bark, rnd, 0.1));
  }
  parts.push(paint(put(box(0.12, 0.35, 0.1), 0.25, h - 0.1 + 0.12, 0.05, 0, 0.15), P.bark, rnd, 0.08));
  return finish(parts, 'stump');
}

function ruinWall(v, rnd) {
  const parts = [];
  const block = (w, h, d, x, z, ry = 0) => {
    const b = jitter(box(w, h, d), rnd, 0.025);
    parts.push(paintStone(put(b, x, h / 2 - 0.05, z, ry), P.stoneDark, rnd, 0.45, 0.1));
  };
  if (v === 0) { // a straight run that has lost its top toward one end
    block(0.9, 1.7, 0.55, -1.35, 0);
    block(0.8, 1.35, 0.55, -0.5, 0);
    block(0.7, 1.0, 0.55, 0.25, 0);
    block(0.7, 0.55, 0.55, 0.95, 0);
    block(0.5, 0.3, 0.55, 1.55, 0);
    block(0.45, 0.35, 0.45, 1.1, 0.75, 0.4);
    block(0.3, 0.22, 0.75, -1.35, 0.05);
  } else { // a corner with its pillar still standing
    block(1.9, 1.5, 0.55, -0.55, -0.7);
    block(0.55, 1.2, 1.6, 0.6, 0.35);
    block(0.7, 2.0, 0.7, 0.6, -0.7);
    block(0.6, 0.4, 0.55, -1.8, -0.7);
    const rubble = jitter(ico(0.3), rnd, 0.06);
    parts.push(paintStone(put(rubble, -0.4, 0.15, 0.4, rnd() * TAU), P.stoneDark, rnd, 0.3));
  }
  return finish(parts, 'ruinWall');
}

function torch(v, rnd) {
  const parts = [];
  const post = cyl(0.055, 0.085, 1.75, 5);
  stand(post, 1.75);
  parts.push(paintY(put(post, 0, -0.1, 0), P.woodDark, rnd, 0, 1.7, 0.75));
  parts.push(paint(put(cyl(0.13, 0.13, 0.1, 6, true), 0, 1.5, 0), P.iron, rnd, 0.06));
  parts.push(paint(put(cyl(0.14, 0.07, 0.2, 6), 0, 1.7, 0), P.iron, rnd, 0.06));
  // the flame: vertex colour only, no light. Orange body, pale yellow tip.
  parts.push(paintY(put(box(0.24, 0.34, 0.24), 0, 1.97, 0, Math.PI / 4), P.flame, rnd, 1.8, 2.14, 0.8, 0.04));
  const tip = cone(0.12, 0.26, 4);
  stand(tip, 0.26);
  parts.push(paint(put(tip, 0, 2.13, 0, Math.PI / 4), P.flameTip, rnd, 0.03));
  return finish(parts, 'torch');
}

function crate(v, rnd) {
  const parts = [], s = 0.9;
  parts.push(paintY(put(box(s, s, s), 0, s / 2 - 0.02, 0), P.wood, rnd, 0, s, 0.8, 0.08));
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    parts.push(paint(put(box(0.11, s + 0.04, 0.11), x * s / 2, s / 2, z * s / 2), P.woodDark, rnd, 0.08));
  }
  for (const rz of [Math.PI / 4, -Math.PI / 4]) {
    parts.push(paint(put(box(1.15, 0.1, 0.05), 0, s / 2, s / 2 + 0.03, 0, rz), P.woodDark, rnd, 0.08));
  }
  parts.push(paint(put(box(0.1, 0.05, s + 0.04), 0, s + 0.02, 0), P.woodDark, rnd, 0.08));
  return finish(parts, 'crate');
}

function barrel(v, rnd) {
  const parts = [], seg = 7;
  const staves = (g) => paintFaces(g, (f) => (f < 2 * seg
    ? shadeHex(P.wood, 0.88 + ((f >> 1) & 1) * 0.18 + (rnd() * 2 - 1) * 0.03)
    : shadeHex(P.woodDark, 1 + (rnd() * 2 - 1) * 0.05)));
  const lo = cyl(0.44, 0.37, 0.5, seg);
  stand(lo, 0.5);
  parts.push(staves(put(lo, 0, -0.02, 0)));
  const hi = cyl(0.37, 0.44, 0.5, seg);
  stand(hi, 0.5);
  parts.push(staves(put(hi, 0, 0.48, 0)));
  for (const [y, r] of [[0.12, 0.42], [0.5, 0.46], [0.86, 0.42]]) {
    parts.push(paint(put(cyl(r, r, 0.08, seg, true), 0, y, 0), P.iron, rnd, 0.06));
  }
  return finish(parts, 'barrel');
}

function fence(v, rnd) {
  const parts = [];
  for (const x of [-0.9, 0.9]) {
    parts.push(paintY(put(box(0.15, 1.15, 0.15), x, 0.5, 0, 0, (rnd() - 0.5) * 0.06), P.woodDark, rnd, -0.1, 1.1, 0.8));
  }
  for (const y of [0.42, 0.82]) {
    parts.push(paint(put(box(2.05, 0.11, 0.07), 0, y, 0, 0, (rnd() - 0.5) * 0.04), P.wood, rnd, 0.08));
  }
  return finish(parts, 'fence');
}

function well(v, rnd) {
  const parts = [];
  const ring = cyl(0.86, 0.92, 0.72, 8);
  stand(ring, 0.72);
  parts.push(paintStone(put(ring, 0, -0.05, 0), P.stone, rnd, 0.3));
  parts.push(paint(put(disc(0.62, 8), 0, 0.685, 0), P.water, rnd, 0.02));
  for (const x of [-0.72, 0.72]) parts.push(paintY(put(box(0.15, 1.6, 0.15), x, 1.4, 0), P.woodDark, rnd, 0.6, 2.2, 0.8));
  parts.push(paint(put(cyl(0.06, 0.06, 1.6, 5).rotateZ(Math.PI / 2), 0, 2.05, 0), P.wood, rnd, 0.06));
  const roof = cone(1.3, 0.8, 4);
  stand(roof, 0.8);
  parts.push(paintY(put(roof, 0, 2.2, 0, Math.PI / 4), P.woodDark, rnd, 2.2, 3.0, 0.7, 0.05));
  parts.push(paint(put(box(0.03, 0.85, 0.03), 0, 1.65, 0), P.iron, rnd, 0.02));
  parts.push(paint(put(box(0.26, 0.28, 0.26), 0, 1.1, 0, 0.3), P.woodDark, rnd, 0.08));
  return finish(parts, 'well');
}

function chest(v, rnd) {
  const parts = [];
  parts.push(paintY(put(box(1.0, 0.5, 0.62), 0, 0.25, 0), P.wood, rnd, 0, 0.5, 0.8, 0.06));
  parts.push(paintY(put(cyl(0.31, 0.31, 1.0, 6).rotateZ(Math.PI / 2), 0, 0.5, 0), P.wood, rnd, 0.3, 0.82, 0.8, 0.06));
  for (const x of [-0.3, 0.3]) {
    parts.push(paint(put(box(0.1, 0.52, 0.66), x, 0.25, 0), P.iron, rnd, 0.06));
    parts.push(paint(put(cyl(0.33, 0.33, 0.1, 6, true).rotateZ(Math.PI / 2), x, 0.5, 0), P.iron, rnd, 0.06));
  }
  parts.push(paint(put(box(0.16, 0.2, 0.06), 0, 0.45, 0.33), P.gold, rnd, 0.05));
  return finish(parts, 'chest');
}

function waypointStone(v, rnd) {
  const parts = [];
  const base = cyl(1.0, 1.1, 0.26, 8);
  stand(base, 0.26);
  parts.push(paintStone(put(base, 0, -0.05, 0), P.stone, rnd, 0.15));
  const spin = rnd() * TAU;
  const obelisk = cyl(0.26, 0.42, 2.3, 5);
  stand(obelisk, 2.3);
  parts.push(paintY(put(obelisk, 0, 0.2, 0, spin), P.stoneDark, rnd, 0.2, 2.5, 0.75, 0.06));
  parts.push(paint(put(cyl(0.37, 0.37, 0.28, 5, true), 0, 1.55, 0, spin), P.rune, rnd, 0.03));
  parts.push(paint(put(octa(0.26), 0, 2.78, 0, spin), shadeHex(P.rune, 1.15), rnd, 0.03));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const m = box(0.22, 0.55, 0.22).translate(0.95, 0.2, 0);
    parts.push(paintStone(put(m, 0, 0, 0, a), P.stoneDark, rnd, 0.3));
  }
  return finish(parts, 'waypointStone');
}

function missing() {
  const g = paintFaces(put(box(1, 1, 1), 0, 0.5, 0), () => P.missing);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.userData.tris = 12;
  g.userData.kind = 'missing';
  return g;
}

const BUILDERS = { deadTree, tree, rock, gravestone, bones, stump, ruinWall, torch, crate, barrel, fence, well, chest, waypointStone };

/**
 * Build every kind and variant once. get(kind, variant) returns the shared BufferGeometry
 * (never clone it per instance; InstancedMesh and Mesh both take it as is). Out-of-range
 * variants wrap; an unknown kind warns once and returns a magenta box.
 */
export function buildKit() {
  const geos = new Map();
  const kinds = Object.keys(BUILDERS);
  for (const kind of kinds) {
    const n = KIT_VARIANTS[kind] || 1;
    for (let v = 0; v < n; v++) {
      const g = BUILDERS[kind](v, rng32(seedOf(kind, v)));
      g.userData.variant = v;
      geos.set(kind + ':' + v, g);
    }
  }
  const warned = new Set();
  let fallback = null;
  return {
    kinds,
    variants: (kind) => KIT_VARIANTS[kind] || 0,
    get(kind, variant = 0) {
      const n = KIT_VARIANTS[kind];
      if (!n || !geos.size) {
        if (!warned.has(kind)) { warned.add(kind); console.warn(`kit: unknown kind "${kind}"`); }
        return fallback || (fallback = missing());
      }
      const v = (((variant | 0) % n) + n) % n;
      return geos.get(kind + ':' + v);
    },
    dispose() {
      for (const g of geos.values()) g.dispose();
      geos.clear();
      if (fallback) fallback.dispose();
    },
  };
}
