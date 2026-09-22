// client/src/render/fx.js — pooled combat and loot effects, keyed off sim events by main.js.
// createFx(scene) → { hit, swipe, whirl, quake, dash, shout, levelUp, lootPop, puff, update(dt),
//   dispose() }. Two pools built once: 72 unit boxes and 24 writable ring sectors (96 meshes).
// Every material is a shared MeshBasicMaterial per colour (additive, depthWrite false, fog off);
// per-particle fading goes through an RGBA `color` attribute on the particle's own tiny geometry,
// so one material serves any number of particles at different alphas. Nothing allocates after
// construction: spawning an effect resets a pooled record (stealing the oldest when the pool is
// dry) and update() integrates position / scale / alpha in place. Every effect takes the GROUND
// height at its point as `y` and lifts itself as needed (sparks burst at chest height, rings sit
// a hand above the turf so they clear the heightfield). Client-side Math.random is fine here:
// effects never feed the sim.
import * as THREE from 'three';
import items from 'shared/data/items.js';

const BOX_POOL = 72;
const RING_POOL = 24;
const RING_SEG = 20;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const MAX_DT = 0.1;
const RING_LIFT = 0.18;    // rings float this far above the ground so bumpy terrain never eats them
const SPARK_HEIGHT = 0.9;  // hit sparks burst at chest height

// Effect colours. Rarity colours come from items.js so beam, label and pop match exactly.
const C = {
  spark: 0xffc070, crit: 0xfff4b0, steel: 0xd8ecff, whirl: 0xc0d8ff, dust: 0xd9a066,
  dash: 0xbfd8ff, shout: 0xffb347, gold: 0xffd54a, smoke: 0x141210,
};
const RARITY = items.rarity.colours;

// ---------------------------------------------------------------- geometry

/** RGBA colour attribute (white, alpha 1) sized for `count` vertices: the per-particle fade channel. */
function rgba(count) {
  const a = new Float32Array(count * 4);
  for (let i = 0; i < a.length; i++) a[i] = 1;
  return new THREE.BufferAttribute(a, 4);
}

/** Unit box with only position + rgba colour (MeshBasicMaterial needs no normals or uvs). */
function makeBoxGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g.setAttribute('color', rgba(g.getAttribute('position').count));
  return g;
}

/** A flat ring sector whose radii and arc are rewritten in place by writeRing(). */
function makeRingGeometry() {
  const n = (RING_SEG + 1) * 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('color', rgba(n));
  const idx = new Uint16Array(RING_SEG * 6);
  for (let s = 0; s < RING_SEG; s++) {
    const a = s * 2, b = a + 1, c = a + 2, d = a + 3, k = s * 6;
    idx[k] = a; idx[k + 1] = c; idx[k + 2] = b;
    idx[k + 3] = b; idx[k + 4] = c; idx[k + 5] = d;
  }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 16);
  return g;
}

/** Sector from rIn to rOut spanning `theta` radians, centred on local +z (the rig's forward). */
function writeRing(g, rIn, rOut, theta) {
  const pos = g.getAttribute('position').array;
  for (let i = 0; i <= RING_SEG; i++) {
    const a = -theta / 2 + (theta * i) / RING_SEG;
    const s = Math.sin(a), c = Math.cos(a), k = i * 6;
    pos[k] = rIn * s; pos[k + 1] = 0; pos[k + 2] = rIn * c;
    pos[k + 3] = rOut * s; pos[k + 4] = 0; pos[k + 5] = rOut * c;
  }
  g.getAttribute('position').needsUpdate = true;
}

// ---------------------------------------------------------------- materials

function additive(hex) {
  return new THREE.MeshBasicMaterial({
    color: hex, vertexColors: true, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------- particles

let serial = 0;

function makeParticle(geo, ring, mat) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.frustumCulled = false;
  const col = geo.getAttribute('color');
  return {
    mesh, col, ring, active: false, born: 0, t: 0, dur: 1, lastA: -1,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grav: 0, arc: 0,
    sx0: 1, sy0: 1, sz0: 1, sx1: 1, sy1: 1, sz1: 1, a0: 1, a1: 0, fadeAt: 0,
    rx: 0, ry: 0, rz: 0, spinX: 0, spinY: 0,
  };
}

function reset(p) {
  p.active = true; p.born = ++serial; p.t = 0; p.dur = 1; p.lastA = -1;
  p.vx = p.vy = p.vz = 0; p.grav = 0; p.arc = 0;
  p.sx0 = p.sy0 = p.sz0 = 1; p.sx1 = p.sy1 = p.sz1 = 1;
  p.a0 = 1; p.a1 = 0; p.fadeAt = 0;
  p.rx = p.ry = p.rz = 0; p.spinX = p.spinY = 0;
  p.mesh.visible = false;
  return p;
}

/** A free particle, or the oldest live one when the pool is dry. */
function take(pool) {
  let oldest = null;
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    if (!p.active) return reset(p);
    if (!oldest || p.born < oldest.born) oldest = p;
  }
  return reset(oldest);
}

function setAlpha(p, a) {
  if (a < 0) a = 0; else if (a > 1) a = 1;
  if (Math.abs(a - p.lastA) < 1 / 128) return;      // skip the upload when nothing visible changed
  p.lastA = a;
  const arr = p.col.array;
  for (let i = 3; i < arr.length; i += 4) arr[i] = a;
  p.col.needsUpdate = true;
}

/** One integration step for a live particle; returns 1 while it stays alive. */
function stepParticle(p, dt) {
  p.t += dt;
  if (p.t < 0) return 1;                             // delayed start
  const k = p.t / p.dur;
  if (k >= 1) { p.active = false; p.mesh.visible = false; return 0; }
  p.vy -= p.grav * dt;
  p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  const m = p.mesh;
  m.position.set(p.x, p.y + p.arc * 4 * k * (1 - k), p.z);
  m.scale.set(p.sx0 + (p.sx1 - p.sx0) * k, p.sy0 + (p.sy1 - p.sy0) * k, p.sz0 + (p.sz1 - p.sz0) * k);
  m.rotation.set(p.rx + p.spinX * p.t, p.ry + p.spinY * p.t, p.rz);
  const f = p.fadeAt > 0 ? (k < p.fadeAt ? 0 : (k - p.fadeAt) / (1 - p.fadeAt)) : k;
  setAlpha(p, p.a0 + (p.a1 - p.a0) * f);
  m.visible = true;
  return 1;
}

// ---------------------------------------------------------------- the view

export function createFx(scene) {
  const group = new THREE.Group();
  group.name = 'fx';
  scene.add(group);

  const mats = new Map();
  for (const k in C) if (k !== 'smoke') mats.set(C[k], additive(C[k]));
  for (const k in RARITY) if (!mats.has(RARITY[k])) mats.set(RARITY[k], additive(RARITY[k]));
  const smokeMat = new THREE.MeshBasicMaterial({
    color: C.smoke, vertexColors: true, transparent: true, depthWrite: false, fog: false,
    blending: THREE.NormalBlending,
  });
  const fallback = mats.get(C.spark);
  const matFor = (hex) => mats.get(hex) || fallback;

  const boxes = [], rings = [];
  for (let i = 0; i < BOX_POOL; i++) { const p = makeParticle(makeBoxGeometry(), false, fallback); boxes.push(p); group.add(p.mesh); }
  for (let i = 0; i < RING_POOL; i++) { const p = makeParticle(makeRingGeometry(), true, fallback); rings.push(p); group.add(p.mesh); }
  let active = 0;

  /** A cube of `size` at (x,y,z) in colour `hex`; the caller sets velocity, life and fade. */
  function box(x, y, z, hex, size) {
    const p = take(boxes);
    p.x = x; p.y = y; p.z = z;
    p.sx0 = p.sy0 = p.sz0 = size; p.sx1 = p.sy1 = p.sz1 = size;
    p.mesh.material = matFor(hex);
    return p;
  }

  /** A sector ring (rIn..rOut, `theta` radians about local +z) lying flat at (x,y,z). */
  function ring(x, y, z, hex, rIn, rOut, theta) {
    const p = take(rings);
    writeRing(p.mesh.geometry, rIn, rOut, theta);
    p.x = x; p.y = y; p.z = z;
    p.mesh.material = matFor(hex);
    return p;
  }

  function spark(x, y, z, hex, size, speed, up, grav, dur, delay) {
    const p = box(x, y, z, hex, size);
    const a = Math.random() * TAU, v = speed * (0.6 + Math.random() * 0.7);
    p.vx = Math.cos(a) * v; p.vz = Math.sin(a) * v; p.vy = up * (0.6 + Math.random() * 0.8);
    p.grav = grav; p.dur = dur; p.t = -delay;
    p.sx1 = p.sy1 = p.sz1 = size * 0.35;
    p.fadeAt = 0.4; p.ry = a; p.spinX = 9; p.spinY = 6;
    return p;
  }

  function smoke(x, y, z, size0, size1, dur, delay) {
    const p = box(x, y, z, C.smoke, size0);
    p.mesh.material = smokeMat;
    p.sx1 = p.sy1 = p.sz1 = size1;
    p.a0 = 0.55; p.a1 = 0; p.dur = dur; p.t = -delay;
    p.ry = Math.random() * TAU; p.spinY = (Math.random() - 0.5) * 3;
    return p;
  }

  // --- the contract's effects -------------------------------------------------------------

  /** Six sparks flung out from chest height; crits are bigger, brighter and faster. */
  function hit(x, y, z, crit) {
    const hex = crit ? C.crit : C.spark, size = crit ? 0.13 : 0.085, sp = crit ? 5 : 3.5;
    for (let i = 0; i < 6; i++) spark(x, y + SPARK_HEIGHT, z, hex, size, sp, crit ? 3.5 : 2.5, 12, 0.3, 0);
  }

  /** Arc sector of `arcDeg` reaching `range` metres, facing (dx,dz), fading over 0.15 s. */
  function swipe(x, y, z, dx, dz, arcDeg, range) {
    const R = range > 0 ? range : 2.5;
    const p = ring(x, y + RING_LIFT, z, C.steel, R * 0.45, R, (arcDeg > 0 ? arcDeg : 120) * DEG);
    p.ry = Math.atan2(dx, dz);
    p.dur = 0.15; p.a0 = 0.95; p.a1 = 0;
    p.sx0 = p.sz0 = 0.88; p.sx1 = p.sz1 = 1.12;
  }

  /** Full ring pulsing out to radius r (one per channel tick), with a trailing inner ring. */
  function whirl(x, y, z, r) {
    const R = r > 0 ? r : 2.5;
    const p = ring(x, y + RING_LIFT, z, C.whirl, R * 0.72, R, TAU);
    p.dur = 0.3; p.a0 = 0.75; p.a1 = 0; p.sx0 = p.sz0 = 0.8; p.sx1 = p.sz1 = 1.08; p.spinY = 8;
    const q = ring(x, y + RING_LIFT + 0.05, z, C.whirl, R * 0.35, R * 0.5, TAU);
    q.dur = 0.25; q.a0 = 0.5; q.a1 = 0; q.sx0 = q.sz0 = 0.7; q.sx1 = q.sz1 = 1.3; q.t = -0.06;
  }

  /** Expanding ring to radius r plus a burst of dust puffs and dirt sparks. */
  function quake(x, y, z, r) {
    const R = r > 0 ? r : 4;
    const p = ring(x, y + RING_LIFT, z, C.dust, R * 0.78, R, TAU);
    p.dur = 0.45; p.a0 = 1; p.a1 = 0; p.sx0 = p.sz0 = 0.2; p.sx1 = p.sz1 = 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.random() * 0.4, d = R * 0.3;
      const s = smoke(x + Math.cos(a) * d, y + 0.3, z + Math.sin(a) * d, 0.3, 0.75, 0.6, i * 0.02);
      const v = 2 + Math.random() * 1.5;
      s.vx = Math.cos(a) * v; s.vz = Math.sin(a) * v; s.vy = 1.2; s.grav = 1.5;
    }
    for (let i = 0; i < 6; i++) spark(x, y + 0.2, z, C.dust, 0.12, 4.5, 4, 10, 0.45, 0);
  }

  /** A translucent streak between the two points (y is the ground height there), 0.2 s. */
  function dash(x0, z0, x1, z1, y) {
    const ddx = x1 - x0, ddz = z1 - z0;
    const L = Math.sqrt(ddx * ddx + ddz * ddz);
    if (!(L > 0.05)) return;
    const p = box((x0 + x1) / 2, (y || 0) + 0.7, (z0 + z1) / 2, C.dash, 1);
    p.ry = Math.atan2(ddx, ddz);
    p.sx0 = 0.35; p.sy0 = 0.55; p.sz0 = L; p.sx1 = 0.15; p.sy1 = 0.25; p.sz1 = L;
    p.dur = 0.2; p.a0 = 0.8; p.a1 = 0;
  }

  /** Two rings rising from the shouter, the second a beat behind. */
  function shout(x, y, z) {
    for (let i = 0; i < 2; i++) {
      const p = ring(x, y + 0.4, z, C.shout, 0.55, 0.8, TAU);
      p.vy = 2.2; p.dur = 0.5; p.a0 = 0.9; p.a1 = 0; p.sx1 = p.sz1 = 2.4; p.t = -0.15 * i;
    }
  }

  /** Gold rings closing in as they rise, with a fountain of gold sparks. */
  function levelUp(x, y, z) {
    for (let i = 0; i < 2; i++) {
      const p = ring(x, y + 0.1, z, C.gold, 0.95, 1.2, TAU);
      p.vy = 2.6; p.dur = 0.9; p.a0 = 1; p.a1 = 0; p.sx1 = p.sz1 = 0.45; p.t = -0.3 * i;
    }
    for (let i = 0; i < 12; i++) spark(x, y + 0.3, z, C.gold, 0.1, 1.6, 5, 5, 0.8, Math.random() * 0.2);
  }

  /** A small box in the rarity colour hopping 0.5 m up and back down over 0.4 s. */
  function lootPop(x, y, z, rarity) {
    const hex = rarity === 'gold' ? C.gold : (RARITY[rarity] || RARITY.normal);
    const big = rarity === 'rare' || rarity === 'unique' || rarity === 'set';
    const p = box(x, y + 0.15, z, hex, big ? 0.2 : 0.16);
    p.arc = 0.5; p.dur = 0.4; p.a0 = 1; p.a1 = 0; p.fadeAt = 0.65;
    p.ry = Math.random() * TAU; p.spinY = 9; p.spinX = 5;
  }

  /** Dark smoke: five boxes drifting up and growing as they thin out. */
  function puff(x, y, z) {
    for (let i = 0; i < 5; i++) {
      const s = smoke(x + (Math.random() - 0.5) * 0.4, y + 0.3 + Math.random() * 0.2, z + (Math.random() - 0.5) * 0.4, 0.22, 0.5, 0.6, i * 0.03);
      s.vy = 0.5 + Math.random() * 0.4;
    }
  }

  function update(dt) {
    if (!(dt > 0)) return;
    if (dt > MAX_DT) dt = MAX_DT;
    let n = 0;
    for (let i = 0; i < boxes.length; i++) { const p = boxes[i]; if (p.active) n += stepParticle(p, dt); }
    for (let i = 0; i < rings.length; i++) { const p = rings[i]; if (p.active) n += stepParticle(p, dt); }
    active = n;
  }

  function dispose() {
    scene.remove(group);
    for (let i = 0; i < boxes.length; i++) boxes[i].mesh.geometry.dispose();
    for (let i = 0; i < rings.length; i++) rings[i].mesh.geometry.dispose();
    mats.forEach((m) => m.dispose());
    mats.clear();
    smokeMat.dispose();
    boxes.length = 0; rings.length = 0;
    active = 0;
  }

  return {
    hit, swipe, whirl, quake, dash, shout, levelUp, lootPop, puff, update, dispose, group,
    get count() { return active; },
    get capacity() { return BOX_POOL + RING_POOL; },
  };
}
