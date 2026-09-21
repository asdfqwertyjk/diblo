// client/src/render/materials.js — the one flat material and the vertex-colour painters.
// Everything in the world is MeshLambertMaterial + flatShading + vertex colours; kit pieces,
// rigs and terrain all share the single material returned by flatMaterial().
import * as THREE from 'three';

let shared = null;

/** One shared MeshLambertMaterial({vertexColors:true, flatShading:true}). */
export function flatMaterial() {
  if (!shared) shared = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return shared;
}

// Scratch objects reused by every paint call: no allocation while painting.
const _col = new THREE.Color();
const _cen = new THREE.Vector3();

function colorAttr(geometry) {
  const n = geometry.getAttribute('position').count;
  let c = geometry.getAttribute('color');
  if (!c || c.count !== n || c.itemSize !== 3) {
    c = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    geometry.setAttribute('color', c);
  }
  return c;
}

/**
 * Paint every vertex of `geometry` one colour. Works on indexed geometry too, but the kit
 * always calls it on non-indexed geometry so a face keeps one hard colour.
 * @returns the same geometry
 */
export function paintGeometry(geometry, colorHex) {
  const c = colorAttr(geometry);
  _col.setHex(colorHex);
  const a = c.array;
  for (let i = 0; i < a.length; i += 3) { a[i] = _col.r; a[i + 1] = _col.g; a[i + 2] = _col.b; }
  c.needsUpdate = true;
  return geometry;
}

/**
 * Per-face colour on a NON-indexed geometry: fn(faceIndex, centroidVec3) → hex.
 * The centroid vector is a scratch object; copy it if you keep it.
 * @returns the same geometry
 */
export function paintFaces(geometry, fn) {
  if (geometry.index) throw new Error('paintFaces: geometry must be non-indexed (call toNonIndexed() first)');
  const c = colorAttr(geometry);
  const p = geometry.getAttribute('position').array;
  const a = c.array;
  const faces = (p.length / 9) | 0;
  for (let f = 0; f < faces; f++) {
    const i = f * 9;
    _cen.set(
      (p[i] + p[i + 3] + p[i + 6]) / 3,
      (p[i + 1] + p[i + 4] + p[i + 7]) / 3,
      (p[i + 2] + p[i + 5] + p[i + 8]) / 3,
    );
    _col.setHex(fn(f, _cen));
    a[i] = a[i + 3] = a[i + 6] = _col.r;
    a[i + 1] = a[i + 4] = a[i + 7] = _col.g;
    a[i + 2] = a[i + 5] = a[i + 8] = _col.b;
  }
  c.needsUpdate = true;
  return geometry;
}

// --- small hex helpers (extra to the contract; used by kit.js and free for rig.js) ---------

/** Brighten (mul > 1) or darken (mul < 1) a hex colour per channel, clamped. */
export function shadeHex(hex, mul) {
  const r = Math.min(255, Math.max(0, Math.round(((hex >> 16) & 255) * mul)));
  const g = Math.min(255, Math.max(0, Math.round(((hex >> 8) & 255) * mul)));
  const b = Math.min(255, Math.max(0, Math.round((hex & 255) * mul)));
  return (r << 16) | (g << 8) | b;
}

/** Linear blend of two hex colours: t = 0 gives a, t = 1 gives b. */
export function mixHex(a, b, t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * three r155+ lights use physical units, so an intensity of 1 reads about π× dimmer than the
 * legacy scale the biome tables were authored against. Every light built from biome data
 * (sun, hemi) multiplies its intensity by this once, at creation, so the recipes stay as is.
 */
export const LIGHT_SCALE = Math.PI;
