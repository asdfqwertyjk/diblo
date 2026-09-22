// client/src/render/rig.js — rigs for players and monsters: biped, quad, bird.
// Part geometry comes from rig_biped.js / rig_beasts.js (tapered low-poly prisms, painted in colour
// zones); this file resolves palettes, caches geometry per kind/palette/weapon, assembles the joint
// hierarchy and hands anim.js a parts table. Limbs pivot at their joint (geometry offset so the mesh
// origin is the shoulder / elbow / hip / knee / neck), so anim.js poses them by setting rotations.
// The rig faces +z, so a sim facing (dx, dz) is group.rotation.y = Math.atan2(dx, dz).
// Heights at size 1: biped 1.84 m, quad 0.86 m, bird 0.9 m (authored 0.6 m, KIND_SCALE ×1.5).
// `size` × KIND_SCALE is baked into the inner root and the shadow; group.scale stays (1,1,1) for the
// caller (champion scaling). disposeRigCache() frees the shared geometry (ents.js calls it).
import * as THREE from 'three';
import { part, STEEL, DARK } from './rig_parts.js';
import { buildBipedParts, BIPED } from './rig_biped.js';
import { buildQuadParts, buildBirdParts, QUAD, BIRD } from './rig_beasts.js';
import { WEAPON_POSE } from './anim.js';
export { animateRig } from './anim.js';

export const WEAPON_KINDS = ['sword', 'axe', 'mace', 'bow', 'staff', 'wand', 'dagger', 'spear'];
export const RIG_HEIGHT = { biped: BIPED.height, quad: QUAD.height, bird: BIRD.height * 1.5 };
/** Base scale per rig kind, multiplied into `size`; the bird is authored at 0.6 m and shown at 0.9 m. */
const KIND_SCALE = { biped: 1, quad: 1, bird: 1.5 };
const SHADOW = { biped: [0.42, 0.42], quad: [0.34, 0.58], bird: [0.24, 0.3] };

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

// Geometry is shared between rigs of the same kind + palette + weapon (a handful per zone).
const geoCache = new Map();
function geometryFor(kind, p, weapon) {
  const key = kind + '|' + weapon + '|' + p.skin + ',' + p.hair + ',' + p.cloth + ',' + p.armour + ',' +
    p.trim + ',' + p.weapon + ',' + p.eyes + ',' + p.body + ',' + p.belly;
  let g = geoCache.get(key);
  if (!g) {
    g = kind === 'quad' ? buildQuadParts(p) : kind === 'bird' ? buildBirdParts(p) : buildBipedParts(p, weapon);
    geoCache.set(key, g);
  }
  return g;
}

// ---------------------------------------------------------------- assembly

function assembleBiped(r, g) {
  const root = r.root, P = r.parts, B = BIPED;
  P.torso = part(g.torso, 0, B.torsoY, 0);
  P.head = part(g.head, 0, B.headY, 0);
  P.armL = part(g.upperArm, B.shoulderX, B.shoulderY, 0, 0.05, 0, 0.1);
  P.armR = part(g.upperArm, -B.shoulderX, B.shoulderY, 0, -0.2, 0, -0.1);
  P.forearmL = part(g.forearm, 0, B.elbowY, 0, -0.25, 0, 0);
  P.forearmR = part(g.forearm, 0, B.elbowY, 0, -0.25, 0, 0);
  P.legL = part(g.thigh, B.hipX, B.torsoY, 0);
  P.legR = part(g.thigh, -B.hipX, B.torsoY, 0);
  P.shinL = part(g.shin, 0, B.kneeY, 0, 0.06, 0, 0);
  P.shinR = part(g.shin, 0, B.kneeY, 0, 0.06, 0, 0);
  root.add(P.torso, P.legL, P.legR);
  P.torso.add(P.head, P.armL, P.armR);
  P.armL.add(P.forearmL); P.armR.add(P.forearmR);
  P.legL.add(P.shinL); P.legR.add(P.shinR);
  r.animated.push(P.torso, P.head, P.armL, P.armR, P.forearmL, P.forearmR, P.legL, P.legR, P.shinL, P.shinR);
  if (g.weapon) {
    const pose = WEAPON_POSE[r.weapon];
    P.weapon = part(g.weapon, 0, B.handY, B.handZ, pose ? pose.rest : 0, pose ? (pose.roll || 0) : 0, 0);
    P.forearmR.add(P.weapon);
    r.animated.push(P.weapon);
  }
}

function assembleQuad(r, g) {
  const root = r.root, P = r.parts, Q = QUAD;
  P.torso = part(g.torso, 0, Q.torsoY, 0);
  P.head = part(g.head, Q.neckEnd[0], Q.neckEnd[1], Q.neckEnd[2]);
  P.tail = part(g.tail, Q.tailAt[0], Q.tailAt[1], Q.tailAt[2], 0.5, 0, 0);
  P.tail2 = part(g.tail2, 0, 0, Q.tail2Y, 0.25, 0, 0);
  const legY = Q.torsoY + Q.legY;
  P.armL = part(g.upperLeg, Q.legX, legY, Q.frontZ);      // front legs
  P.armR = part(g.upperLeg, -Q.legX, legY, Q.frontZ);
  P.legL = part(g.upperLeg, Q.legX, legY, Q.backZ);       // back legs
  P.legR = part(g.upperLeg, -Q.legX, legY, Q.backZ);
  P.forearmL = part(g.lowerLeg, 0, Q.kneeY, 0, 0.1, 0, 0);
  P.forearmR = part(g.lowerLeg, 0, Q.kneeY, 0, 0.1, 0, 0);
  P.shinL = part(g.lowerLeg, 0, Q.kneeY, 0, -0.1, 0, 0);
  P.shinR = part(g.lowerLeg, 0, Q.kneeY, 0, -0.1, 0, 0);
  root.add(P.torso, P.armL, P.armR, P.legL, P.legR);
  P.torso.add(P.head, P.tail);
  P.tail.add(P.tail2);
  P.armL.add(P.forearmL); P.armR.add(P.forearmR);
  P.legL.add(P.shinL); P.legR.add(P.shinR);
  r.animated.push(P.torso, P.head, P.tail, P.tail2, P.armL, P.armR, P.legL, P.legR, P.forearmL, P.forearmR, P.shinL, P.shinR);
}

function assembleBird(r, g) {
  const root = r.root, P = r.parts, B = BIRD;
  P.torso = part(g.torso, 0, B.torsoY, 0);
  P.head = part(g.head, B.headAt[0], B.headAt[1], B.headAt[2]);
  P.wingL = part(g.wingL, B.wingX, 0.05, 0, 0, 0, -0.35);
  P.wingR = part(g.wingR, -B.wingX, 0.05, 0, 0, 0, 0.35);
  P.legL = part(g.leg, 0.05, B.legY, 0.02);
  P.legR = part(g.leg, -0.05, B.legY, 0.02);
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
    group, root, parts: {}, shadow: null, kind, rigKind: kind, size, height: RIG_HEIGHT[kind] * size, weapon: wkind,
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
