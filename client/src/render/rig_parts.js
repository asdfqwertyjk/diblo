// client/src/render/rig_parts.js — low-poly primitives for the rigs: painted, non-indexed, merged.
// Every primitive is built, transformed into part-local space, painted one colour with a small
// deterministic per-face brightness variation (so flat colour reads as painted cloth, leather or
// steel instead of plastic), and returned without a uv attribute so mergeGeometries accepts any mix.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flatMaterial, paintFaces, shadeHex } from './materials.js';

export const WOOD = 0x4a3220, STEEL = 0xb0b4bc, DARK = 0x1a1410, STRING = 0x2a2620, LEATHER = 0x3a2718;

/** ±amount brightness per face, from the face index alone (deterministic, no rng). */
export function vary(hex, f, amount = 0.06) {
  const h = ((Math.imul(f + 1, 2654435761) >>> 0) % 1000) / 1000;
  return shadeHex(hex, 1 + (h - 0.5) * 2 * amount);
}

function finish(g, hex, amount, x, y, z, rx, ry, rz) {
  g.deleteAttribute('uv');
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  if (x || y || z) g.translate(x, y, z);
  paintFaces(g, (f) => vary(hex, f, amount));
  return g;
}

/** Box w×h×d centred at (x y z) after rotation. */
export function box(w, h, d, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, amount = 0.06) {
  return finish(new THREE.BoxGeometry(w, h, d).toNonIndexed(), hex, amount, x, y, z, rx, ry, rz);
}

/**
 * Box whose top (y > 0) and bottom (y < 0) faces are scaled separately, for jaws, hands, boots,
 * feather tips. Scale factors apply to x and z.
 */
export function taperBox(w, h, d, topX, topZ, botX, botZ, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, amount = 0.06) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setX(i, p.getX(i) * (top ? topX : botX));
    p.setZ(i, p.getZ(i) * (top ? topZ : botZ));
  }
  g.computeVertexNormals();
  return finish(g, hex, amount, x, y, z, rx, ry, rz);
}

/** Tapered prism along y (radiusTop at +y), `seg` sides, optionally squashed by sx/sz before rotation. */
export function prism(rTop, rBot, h, seg, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sz = 1, amount = 0.06) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg).toNonIndexed();
  if (sx !== 1 || sz !== 1) { g.scale(sx, 1, sz); g.computeVertexNormals(); }
  return finish(g, hex, amount, x, y, z, rx, ry, rz);
}

/** Cone along +y with its base at y = 0 (tip at +h). */
export function cone(r, h, seg, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, amount = 0.06) {
  const g = new THREE.ConeGeometry(r, h, seg).toNonIndexed();
  g.translate(0, h / 2, 0);
  return finish(g, hex, amount, x, y, z, rx, ry, rz);
}

/** Low-poly sphere (or a cap of one via thetaStart/thetaLength), scaled by sx sy sz. */
export function ball(r, ws, hs, hex, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, thetaStart = 0, thetaLength = Math.PI, amount = 0.06) {
  const g = new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, thetaStart, thetaLength).toNonIndexed();
  if (sx !== 1 || sy !== 1 || sz !== 1) { g.scale(sx, sy, sz); g.computeVertexNormals(); }
  return finish(g, hex, amount, x, y, z, 0, 0, 0);
}

/**
 * A flat wing along +x (mirror with s = -1): a box whose tip end narrows to `chordTip` and thins,
 * plus feather notches at the tip. The root is at the origin.
 */
export function wing(len, thick, chordRoot, chordTip, hex, tipHex, s = 1) {
  const g = new THREE.BoxGeometry(len, thick, chordRoot).toNonIndexed();
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    if (p.getX(i) > 0) { p.setZ(i, p.getZ(i) * (chordTip / chordRoot) - chordRoot * 0.12); p.setY(i, p.getY(i) * 0.6); }
  }
  g.computeVertexNormals();
  g.translate(len / 2, 0, 0);
  if (s < 0) { g.scale(-1, 1, 1); g.computeVertexNormals(); }
  const main = finish(g, hex, 0.06, 0, 0, 0, 0, 0, 0);
  const tips = [];
  for (let k = 0; k < 3; k++) {
    tips.push(box(len * 0.22, thick * 0.6, chordTip * 0.32, tipHex, s * (len + len * 0.08), 0, -chordRoot * 0.12 + (k - 1) * chordTip * 0.36, 0, 0, 0));
  }
  return merge([main, ...tips]);
}

export function merge(list) {
  const g = mergeGeometries(list, false);
  for (let i = 0; i < list.length; i++) list[i].dispose();
  g.computeBoundingSphere();
  return g;
}

/** A part Mesh whose rest transform is remembered in userData for anim.js restPose(). */
export function part(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, flatMaterial());
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  const u = m.userData;
  u.y0 = y; u.z0 = z; u.rx = rx; u.ry = ry; u.rz = rz;
  return m;
}

export function shade(hex, f) { return shadeHex(hex, f); }
