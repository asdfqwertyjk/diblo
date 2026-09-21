// client/src/world/props.js — layout.props → one InstancedMesh per (kind, variant, 64 m chunk).
// Chunking is what lets props frustum-cull: a single zone-wide InstancedMesh never culls.
// Prop chunks are coarser than terrain chunks (32 m): with ~17 kind/variant combos a 32 m
// grid splits a 128 m zone into ~190 meshes, most holding one or two instances, so instancing
// buys nothing and draw calls climb near clusters. 64 m keeps a zone at ~65 meshes.
// Everything allocates at build time; nothing here runs per frame.
import { Group, InstancedMesh, Matrix4, Quaternion, Sphere, Vector3 } from 'three';
import { groundHeight } from 'shared/sim/zonegen.js';
import { flatMaterial } from '../render/materials.js';

/** Prop chunk edge in metres (terrain.js keeps its own, finer 32 m chunks). */
export const CHUNK = 64;
/** layout.props[].rot is in sixteenth turns. */
const SIXTEENTH = Math.PI / 8;

// Build-time scratch objects.
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Vector3();
const _centre = new Vector3();
const _up = new Vector3(0, 1, 0);

/**
 * @param {object} layout  from generateZone; uses layout.props and layout.heights
 * @param {{get:(kind:string, variant?:number)=>object}} kit  from buildKit()
 * @returns {Group} instanced meshes; `group.userData.dispose()` frees instance buffers
 *                  (kit geometries and the shared material stay alive).
 */
export function buildProps(layout, kit) {
  const group = new Group();
  group.name = 'props';
  const props = layout.props;
  const N = layout.size;
  const chunks = Math.max(1, Math.ceil(N / CHUNK));

  // Bucket prop indices by kind / variant / chunk. Empty combos never get a mesh.
  const buckets = new Map();
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    const gx = clampInt(Math.floor(p.x / CHUNK), 0, chunks - 1);
    const gz = clampInt(Math.floor(p.z / CHUNK), 0, chunks - 1);
    const key = p.kind + '/' + (p.v | 0) + '/' + (gz * chunks + gx);
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(i);
  }

  const material = flatMaterial();
  const meshes = [];
  const missing = new Set();
  let instances = 0;
  for (const [key, list] of buckets) {
    const first = props[list[0]];
    const geo = kit.get(first.kind, first.v | 0);
    if (!geo) { missing.add(first.kind); continue; }
    if (!geo.boundingSphere) geo.computeBoundingSphere();

    const mesh = new InstancedMesh(geo, material, list.length);
    mesh.name = 'props:' + key;
    _centre.set(0, 0, 0);
    for (let k = 0; k < list.length; k++) {
      const p = props[list[k]];
      _p.set(p.x, groundHeight(layout, p.x, p.z), p.z);
      _q.setFromAxisAngle(_up, (p.rot | 0) * SIXTEENTH);
      _s.setScalar(p.s);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(k, _m);
      _centre.add(_c.copy(geo.boundingSphere.center).applyMatrix4(_m));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.boundingSphere = instanceSphere(mesh, geo.boundingSphere, list, props, _centre.divideScalar(list.length));
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    meshes.push(mesh);
    instances += list.length;
  }
  if (missing.size) {
    console.warn('[props] kit has no geometry for: ' + Array.from(missing).join(', '));
  }

  group.userData.meshes = meshes.length;
  group.userData.instances = instances;
  group.userData.dispose = () => {
    for (let i = 0; i < meshes.length; i++) meshes[i].dispose();
  };
  return group;
}

/**
 * Sphere enclosing every instance: centre = mean of the transformed geometry sphere
 * centres, radius = max over instances of (distance to that centre + geometry radius × scale).
 */
function instanceSphere(mesh, geoSphere, list, props, centre) {
  let radius = 0;
  for (let k = 0; k < list.length; k++) {
    mesh.getMatrixAt(k, _m);
    _c.copy(geoSphere.center).applyMatrix4(_m);
    const r = _c.distanceTo(centre) + geoSphere.radius * props[list[k]].s;
    if (r > radius) radius = r;
  }
  return new Sphere(centre.clone(), radius);
}

function clampInt(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
