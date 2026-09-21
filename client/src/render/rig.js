// client/src/render/rig.js — box rigs for players and monsters: biped, quad, bird.
// Every part is one Mesh of vertex-coloured non-indexed boxes (merged with mergeGeometries) sharing
// flatMaterial(). Limbs pivot at their joint (geometry offset so the mesh origin is the shoulder /
// hip / neck), so anim.js poses them by setting rotations. The rig faces +z: snout, beak and eyes
// point along +z, so a sim facing (dx, dz) is group.rotation.y = Math.atan2(dx, dz).
// Heights at size 1: biped ~1.8 m, quad ~0.9 m, bird ~0.9 m (parts authored at 0.6 m, KIND_SCALE
// ×1.5). `size` × KIND_SCALE is baked into the inner root and the shadow; group.scale stays
// (1,1,1) for the caller (champion scaling). Part geometry is cached per kind/palette/weapon;
// disposeRigCache() frees it (ents.js calls it from its dispose()).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flatMaterial, paintGeometry } from './materials.js';
import { WEAPON_POSE } from './anim.js';
export { animateRig } from './anim.js';

export const WEAPON_KINDS = ['sword', 'axe', 'mace', 'bow', 'staff', 'wand', 'dagger', 'spear'];
export const RIG_HEIGHT = { biped: 1.84, quad: 0.95, bird: 0.9 };
/**
 * Base scale per rig kind, multiplied into `size`. The bird parts are authored at ~0.6 m and
 * scaled ×1.5 here so a size-0.55 crow is ~0.5 m, not a 33 cm speck at the game's 18–24 m
 * camera; the sim's collision radius is unaffected.
 */
const KIND_SCALE = { biped: 1, quad: 1, bird: 1.5 };

const WOOD = 0x4a3220, STEEL = 0xb0b4bc, DARK = 0x1a1410, STRING = 0x2a2620;
const SHADOW = { biped: [0.42, 0.42], quad: [0.34, 0.58], bird: [0.24, 0.3] };

// ---------------------------------------------------------------- helpers

function shade(hex, f) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}

/** One painted non-indexed box, rotated about its own centre (rx ry rz) then moved to (x y z). */
function box(w, h, d, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return paintGeometry(g, hex) || g;
}

function merge(list) {
  const g = mergeGeometries(list, false);
  for (let i = 0; i < list.length; i++) list[i].dispose();
  g.computeBoundingSphere();
  return g;
}

/** Class palettes are {skin, hair, cloth, armour, trim, weapon}; monster palettes {body, belly, eyes, trim, skin?}. */
function resolvePalette(p) {
  p = p || {};
  const body = p.body ?? p.cloth ?? 0x6b5138;
  const belly = p.belly ?? p.armour ?? 0x3e2f22;
  return {
    skin: p.skin ?? body,
    hair: p.hair ?? p.trim ?? 0x2a2018,
    cloth: p.cloth ?? body,
    armour: p.armour ?? belly,
    trim: p.trim ?? 0x8c7a4a,
    weapon: p.weapon ?? STEEL,
    eyes: p.eyes ?? DARK,
    body, belly,
  };
}

/** A part Mesh whose rest transform is remembered in userData for anim.js restPose(). */
function part(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, flatMaterial());
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  const u = m.userData;
  u.y0 = y; u.z0 = z; u.rx = rx; u.ry = ry; u.rz = rz;
  return m;
}

let shadowGeo = null, shadowMat = null;
function makeShadow(kind, size) {
  if (!shadowGeo) {
    shadowGeo = new THREE.CircleGeometry(1, 12);
    shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
  }
  const s = SHADOW[kind];
  const m = new THREE.Mesh(shadowGeo, shadowMat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  m.scale.set(s[0] * size, s[1] * size, 1);
  return m;
}

// ---------------------------------------------------------------- weapons (grip at origin, business end +y)

function buildWeapon(kind, p) {
  const steel = p.weapon, trim = p.trim;
  switch (kind) {
    case 'sword': return merge([
      box(0.05, 0.16, 0.05, WOOD, 0, 0, 0),
      box(0.07, 0.07, 0.07, trim, 0, -0.1, 0),
      box(0.22, 0.04, 0.06, trim, 0, 0.1, 0),
      box(0.08, 0.7, 0.03, steel, 0, 0.47, 0),
      box(0.05, 0.1, 0.025, steel, 0, 0.86, 0),
    ]);
    case 'axe': return merge([
      box(0.05, 0.95, 0.05, WOOD, 0, 0.3, 0),
      box(0.07, 0.1, 0.07, trim, 0, 0.5, 0),
      box(0.04, 0.24, 0.26, steel, 0, 0.64, 0.12),
      box(0.04, 0.1, 0.1, steel, 0, 0.64, -0.06),
    ]);
    case 'mace': return merge([
      box(0.05, 0.78, 0.05, WOOD, 0, 0.25, 0),
      box(0.07, 0.1, 0.07, trim, 0, 0.02, 0),
      box(0.16, 0.16, 0.16, steel, 0, 0.66, 0),
      box(0.14, 0.14, 0.14, shade(steel, 0.75), 0, 0.66, 0, 0, Math.PI / 4, 0),
    ]);
    case 'dagger': return merge([
      box(0.04, 0.12, 0.04, WOOD, 0, 0, 0),
      box(0.12, 0.03, 0.04, trim, 0, 0.07, 0),
      box(0.05, 0.3, 0.02, steel, 0, 0.24, 0),
      box(0.03, 0.06, 0.015, steel, 0, 0.42, 0),
    ]);
    case 'bow': return merge([
      box(0.04, 0.14, 0.05, WOOD, 0, 0, 0),
      box(0.03, 0.42, 0.04, WOOD, 0, 0.2, -0.06, -0.3),
      box(0.03, 0.42, 0.04, WOOD, 0, -0.2, -0.06, 0.3),
      box(0.04, 0.05, 0.04, trim, 0, 0.42, -0.125),
      box(0.04, 0.05, 0.04, trim, 0, -0.42, -0.125),
      box(0.012, 0.8, 0.012, STRING, 0, 0, -0.125),
    ]);
    case 'staff': return merge([
      box(0.05, 1.6, 0.05, WOOD, 0, 0.15, 0),
      box(0.12, 0.12, 0.12, trim, 0, 0.98, 0),
      box(0.08, 0.05, 0.08, trim, 0, 0.84, 0),
      box(0.06, 0.06, 0.06, steel, 0, -0.65, 0),
    ]);
    case 'wand': return merge([
      box(0.035, 0.4, 0.035, WOOD, 0, 0.15, 0),
      box(0.05, 0.08, 0.05, trim, 0, 0, 0),
      box(0.06, 0.06, 0.06, steel, 0, 0.37, 0, 0, Math.PI / 4, 0),
    ]);
    case 'spear': return merge([
      box(0.045, 1.7, 0.045, WOOD, 0, 0.25, 0),
      box(0.07, 0.08, 0.07, trim, 0, 1.08, 0),
      box(0.05, 0.28, 0.035, steel, 0, 1.24, 0),
      box(0.05, 0.05, 0.05, steel, 0, -0.6, 0),
    ]);
    default: return null;
  }
}

// ---------------------------------------------------------------- part geometry per rig kind

function buildBiped(p, weapon) {
  return {
    torso: merge([
      box(0.5, 0.62, 0.3, p.cloth, 0, 0.31, 0),           // chest, hips at the origin
      box(0.54, 0.3, 0.34, p.armour, 0, 0.47, 0),         // breastplate
      box(0.18, 0.12, 0.26, p.armour, 0.32, 0.6, 0),      // pauldrons
      box(0.18, 0.12, 0.26, p.armour, -0.32, 0.6, 0),
      box(0.52, 0.08, 0.32, p.trim, 0, 0.06, 0),          // belt
      box(0.12, 0.08, 0.12, p.skin, 0, 0.65, 0),          // neck
    ]),
    head: merge([
      box(0.3, 0.3, 0.3, p.skin, 0, 0.15, 0),             // pivot at the neck
      box(0.33, 0.12, 0.33, p.hair, 0, 0.3, 0),           // hair cap
      box(0.33, 0.2, 0.07, p.hair, 0, 0.18, -0.15),       // back of the hair
      box(0.05, 0.05, 0.03, p.eyes, 0.07, 0.17, 0.155),
      box(0.05, 0.05, 0.03, p.eyes, -0.07, 0.17, 0.155),
    ]),
    arm: merge([
      box(0.14, 0.4, 0.14, p.cloth, 0, -0.2, 0),          // sleeve, shoulder at the origin
      box(0.13, 0.24, 0.13, p.skin, 0, -0.5, 0),          // forearm and fist; hand socket at -0.56
    ]),
    leg: merge([
      box(0.19, 0.5, 0.2, shade(p.cloth, 0.75), 0, -0.25, 0),   // hip at the origin
      box(0.21, 0.32, 0.25, shade(p.armour, 0.7), 0, -0.64, 0.02), // boot
    ]),
    weapon: weapon ? buildWeapon(weapon, p) : null,
  };
}

function buildQuad(p) {
  return {
    torso: merge([
      box(0.3, 0.32, 0.8, p.body, 0, 0, 0),
      box(0.24, 0.1, 0.62, p.belly, 0, -0.18, 0.02),
      box(0.3, 0.16, 0.3, p.body, 0, 0.16, 0.18),         // shoulder hump
      box(0.22, 0.08, 0.24, p.trim, 0, 0.19, -0.2),       // dark ridge along the back
    ]),
    head: merge([
      box(0.26, 0.24, 0.28, p.body, 0, 0.06, 0.12),       // skull, pivot at the neck
      box(0.14, 0.12, 0.22, p.belly, 0, -0.02, 0.34),     // muzzle
      box(0.1, 0.05, 0.06, p.trim, 0, -0.01, 0.43),       // nose
      box(0.06, 0.1, 0.05, p.trim, 0.08, 0.22, 0.04),     // ears
      box(0.06, 0.1, 0.05, p.trim, -0.08, 0.22, 0.04),
      box(0.04, 0.04, 0.03, p.eyes, 0.075, 0.1, 0.265),
      box(0.04, 0.04, 0.03, p.eyes, -0.075, 0.1, 0.265),
    ]),
    leg: merge([
      box(0.11, 0.44, 0.13, p.body, 0, -0.22, 0),
      box(0.12, 0.09, 0.15, p.trim, 0, -0.4, 0.015),      // paw
    ]),
    tail: merge([
      box(0.08, 0.08, 0.34, p.body, 0, 0, -0.17),
      box(0.09, 0.09, 0.12, p.trim, 0, 0.005, -0.38),
    ]),
  };
}

function buildBird(p) {
  const wing = (s) => merge([
    box(0.34, 0.03, 0.24, p.body, s * 0.17, 0, -0.02),
    box(0.16, 0.025, 0.18, p.trim, s * 0.41, 0, -0.06),
  ]);
  return {
    torso: merge([
      box(0.2, 0.18, 0.34, p.body, 0, 0, 0),
      box(0.16, 0.06, 0.26, p.belly, 0, -0.1, 0.02),
      box(0.14, 0.03, 0.24, p.trim, 0, 0, -0.27, 0.35),   // tail feathers, tilted up
    ]),
    head: merge([
      box(0.14, 0.14, 0.15, p.body, 0, 0.06, 0.03),
      box(0.05, 0.04, 0.13, p.trim, 0, 0.04, 0.16),       // beak
      box(0.03, 0.03, 0.02, p.eyes, 0.055, 0.09, 0.105),
      box(0.03, 0.03, 0.02, p.eyes, -0.055, 0.09, 0.105),
    ]),
    wingL: wing(1),
    wingR: wing(-1),
    leg: merge([
      box(0.03, 0.28, 0.03, p.trim, 0, -0.14, 0),
      box(0.05, 0.02, 0.09, p.trim, 0, -0.28, 0.03),
    ]),
  };
}

// Geometry is shared between rigs of the same kind + palette + weapon (a handful per zone).
const geoCache = new Map();
function geometryFor(kind, p, weapon) {
  const key = kind + '|' + weapon + '|' + p.skin + ',' + p.hair + ',' + p.cloth + ',' + p.armour + ',' +
    p.trim + ',' + p.weapon + ',' + p.eyes + ',' + p.body + ',' + p.belly;
  let g = geoCache.get(key);
  if (!g) {
    g = kind === 'quad' ? buildQuad(p) : kind === 'bird' ? buildBird(p) : buildBiped(p, weapon);
    geoCache.set(key, g);
  }
  return g;
}

// ---------------------------------------------------------------- assembly

function assembleBiped(r, g) {
  const root = r.root, P = r.parts;
  P.torso = part(g.torso, 0, 0.8, 0);
  P.head = part(g.head, 0, 0.68, 0);
  P.armL = part(g.arm, 0.34, 0.56, 0, 0.05, 0, 0.12);
  P.armR = part(g.arm, -0.34, 0.56, 0, -0.2, 0, -0.12);
  P.legL = part(g.leg, 0.13, 0.8, 0);
  P.legR = part(g.leg, -0.13, 0.8, 0);
  root.add(P.torso, P.legL, P.legR);
  P.torso.add(P.head, P.armL, P.armR);
  r.animated.push(P.torso, P.head, P.armL, P.armR, P.legL, P.legR);
  if (g.weapon) {
    const pose = WEAPON_POSE[r.weapon];
    P.weapon = part(g.weapon, 0, -0.56, 0.02, pose ? pose.rest : 0, 0, 0);
    P.armR.add(P.weapon);
    r.animated.push(P.weapon);
  }
}

function assembleQuad(r, g) {
  const root = r.root, P = r.parts;
  P.torso = part(g.torso, 0, 0.55, 0);
  P.head = part(g.head, 0, 0.16, 0.38);
  P.tail = part(g.tail, 0, 0.1, -0.4, 0.5, 0, 0);
  P.armL = part(g.leg, 0.12, 0.45, 0.28);     // front legs
  P.armR = part(g.leg, -0.12, 0.45, 0.28);
  P.legL = part(g.leg, 0.12, 0.45, -0.28);    // back legs
  P.legR = part(g.leg, -0.12, 0.45, -0.28);
  root.add(P.torso, P.armL, P.armR, P.legL, P.legR);
  P.torso.add(P.head, P.tail);
  r.animated.push(P.torso, P.head, P.tail, P.armL, P.armR, P.legL, P.legR);
}

function assembleBird(r, g) {
  const root = r.root, P = r.parts;
  P.torso = part(g.torso, 0, 0.34, 0);
  P.head = part(g.head, 0, 0.1, 0.14);
  P.wingL = part(g.wingL, 0.1, 0.05, 0, 0, 0, -0.35);
  P.wingR = part(g.wingR, -0.1, 0.05, 0, 0, 0, 0.35);
  P.legL = part(g.leg, 0.05, 0.29, 0.02);
  P.legR = part(g.leg, -0.05, 0.29, 0.02);
  P.armL = P.wingL; P.armR = P.wingR;         // aliases so parts.armL/armR always exist
  root.add(P.torso, P.legL, P.legR);
  P.torso.add(P.head, P.wingL, P.wingR);
  r.animated.push(P.torso, P.head, P.wingL, P.wingR, P.legL, P.legR);
}

/**
 * @param {{rig?: 'biped'|'quad'|'bird', palette?: object, size?: number, weapon?: string|null}} opts
 * @returns {{group: THREE.Group, root: THREE.Group, parts: object, shadow: THREE.Mesh, kind: string,
 *   size: number, height: number, weapon: string|null, animated: THREE.Mesh[], anim: object, dispose: function}}
 */
export function createRig({ rig = 'biped', palette = null, size = 1, weapon = null } = {}) {
  const kind = rig === 'quad' || rig === 'bird' ? rig : 'biped';
  const wkind = kind === 'biped' && weapon && WEAPON_KINDS.includes(weapon) ? weapon : null;
  const p = resolvePalette(palette);
  const g = geometryFor(kind, p, wkind);

  const group = new THREE.Group();
  group.name = 'rig:' + kind;
  const root = new THREE.Group();
  const scale = size * (KIND_SCALE[kind] || 1);
  root.scale.setScalar(scale);
  group.add(root);

  const r = {
    group, root, parts: {}, shadow: null, kind, size, height: RIG_HEIGHT[kind] * size, weapon: wkind,
    animated: [],
    anim: { name: '', t0: 0, last: 0, phase: 0, run: 0, seed: Math.random() * Math.PI * 2 },
    dispose() { group.removeFromParent(); },
  };
  if (kind === 'quad') assembleQuad(r, g);
  else if (kind === 'bird') assembleBird(r, g);
  else assembleBiped(r, g);

  r.shadow = makeShadow(kind, scale);
  group.add(r.shadow);
  return r;
}

/**
 * Free every cached part geometry and the shared shadow geometry/material. Rigs built later
 * rebuild the cache on demand. Call after the last rig of a session (or zone) is removed;
 * rig.dispose() itself only detaches the group because the geometry is shared.
 */
export function disposeRigCache() {
  for (const parts of geoCache.values()) {
    for (const k in parts) {
      const g = parts[k];
      if (g && typeof g.dispose === 'function') g.dispose();
    }
  }
  geoCache.clear();
  if (shadowGeo) { shadowGeo.dispose(); shadowGeo = null; }
  if (shadowMat) { shadowMat.dispose(); shadowMat = null; }
}
