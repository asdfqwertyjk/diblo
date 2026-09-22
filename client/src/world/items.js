// client/src/world/items.js — ground drops: one pooled body mesh + one beam per `kind:'item'`
// entity. createItemView(scene) → { sync(world, groundY, time, zoneId?), dispose() }.
// Bodies share flatMaterial() and swap between prebuilt vertex-coloured geometries: a coin
// pile for gold, a flask in the potion's colour, and for gear a flat plate sized by item.size
// (dark top, rarity-coloured sides and rim) turned by a hash of the id. The beam is a thin
// additive box in the rarity colour, 3 m tall for BEAM_SEC after the item is first seen, then
// a short faint glow; its fade goes through an RGBA colour attribute on the beam's own tiny
// geometry so one material per colour serves the whole pool. Bodies bob 5 cm. The pool is
// POOL entries (body + beam = 2·POOL meshes); when it is dry, extra items are simply not drawn.
// sync walks zone.ents with Set.forEach and a pre-bound callback (no key arrays per frame) for
// the given zone, else the zone of every player; records not touched this frame are released.
// Nothing here mutates world.ents.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import items from 'shared/data/items.js';
import { flatMaterial, paintFaces, shadeHex, mixHex } from '../render/materials.js';

const POOL = 100;
const BEAM_SEC = 1.5;
const BEAM_H = 3;
const GLOW_H = 0.9;
const GLOW_ALPHA = 0.16;
const BOB_AMP = 0.05;
const BOB_HZ = 1.1;
const CELL_M = 0.22;        // metres per inventory cell for the ground plate
const TAU = Math.PI * 2;

const RARITY = items.rarity.colours;
const GOLD = 0xe6c24a;
const PLATE_TOP = 0x3a3a42;
const PLATE_BOTTOM = 0x1e1e24;
const CORK = 0x6e5236;

// ---------------------------------------------------------------- geometry builders (once)

function prep(g) {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  n.deleteAttribute('uv');
  return n;
}
const box = (w, h, d) => prep(new THREE.BoxGeometry(w, h, d));
const cyl = (r, h, seg = 6) => prep(new THREE.CylinderGeometry(r, r, h, seg, 1));

function finish(parts) {
  const g = mergeGeometries(parts, false);
  for (let i = 0; i < parts.length; i++) parts[i].dispose();
  g.computeBoundingSphere();
  return g;
}

/** Hard colour with a little per-face brightness noise (deterministic per builder call). */
function paintNoisy(g, hex, seed, vary) {
  let s = seed | 0;
  return paintFaces(g, () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return shadeHex(hex, 1 + (((s >>> 8) & 1023) / 1023 - 0.5) * 2 * vary);
  });
}

function buildGold() {
  const parts = [];
  const spots = [[0, 0], [0.11, 0.05], [-0.09, 0.08], [0.03, -0.11], [-0.1, -0.06], [0.12, -0.07]];
  for (let i = 0; i < spots.length; i++) {
    const c = cyl(0.075, 0.028, 6);
    c.rotateY(i * 0.4);
    c.translate(spots[i][0], 0.014 + (i < 2 ? 0.028 * (2 - i) : 0), spots[i][1]);
    parts.push(paintNoisy(c, GOLD, 17 + i, 0.12));
  }
  return finish(parts);
}

function buildFlask(colour) {
  const glass = mixHex(colour, 0xffffff, 0.35);
  const body = paintNoisy(box(0.15, 0.19, 0.15), colour, 3, 0.06);
  body.translate(0, 0.095, 0);
  const shoulder = paintNoisy(box(0.1, 0.045, 0.1), glass, 5, 0.05);
  shoulder.translate(0, 0.21, 0);
  const neck = paintNoisy(box(0.06, 0.08, 0.06), glass, 7, 0.05);
  neck.translate(0, 0.27, 0);
  const cork = paintNoisy(box(0.07, 0.035, 0.07), CORK, 9, 0.08);
  cork.translate(0, 0.325, 0);
  return finish([body, shoulder, neck, cork]);
}

/** Flat plate w×h cells: dark top, rarity sides and a slightly wider rarity rim underneath. */
function buildGear(w, h, rarityHex) {
  const pw = w * CELL_M, pd = h * CELL_M, ph = 0.1;
  const plate = box(pw, ph, pd);
  paintFaces(plate, (f, c) => (c.y > ph * 0.4 ? PLATE_TOP : c.y < -ph * 0.4 ? PLATE_BOTTOM : rarityHex));
  plate.translate(0, 0.03 + ph / 2, 0);
  const rim = paintNoisy(box(pw + 0.05, 0.03, pd + 0.05), rarityHex, 11, 0.04);
  rim.translate(0, 0.015, 0);
  const inset = paintNoisy(box(pw * 0.55, 0.03, pd * 0.7), shadeHex(PLATE_TOP, 0.75), 13, 0.04);
  inset.translate(0, 0.03 + ph + 0.015, 0);
  return finish([plate, rim, inset]);
}

/** Unit-height beam (y 0..1) with an RGBA colour attribute for the per-item fade. */
function makeBeamGeometry() {
  const g = new THREE.BoxGeometry(0.1, 1, 0.1);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g.translate(0, 0.5, 0);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 4);
  for (let i = 0; i < a.length; i++) a[i] = 1;
  g.setAttribute('color', new THREE.BufferAttribute(a, 4));
  g.computeBoundingSphere();
  return g;
}

function beamMaterial(hex) {
  return new THREE.MeshBasicMaterial({
    color: hex, vertexColors: true, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
  });
}

/** FNV-1a of a string → [0,1), for a per-item phase and turn. */
function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- the view

export function createItemView(scene) {
  const group = new THREE.Group();
  group.name = 'items';
  scene.add(group);

  // shared geometries: gold, one flask per potion, one plate per (size × rarity) in the tables
  const goldGeo = buildGold();
  const flaskGeo = new Map();
  for (const id in items.potions) flaskGeo.set(id, buildFlask(items.potions[id].colour));
  const gearGeo = new Map();
  function gearKey(w, h, rarity) { return w + 'x' + h + rarity; }
  for (const id in items.bases) {
    const b = items.bases[id];
    for (const r in RARITY) {
      const key = gearKey(b.size[0], b.size[1], r);
      if (!gearGeo.has(key)) gearGeo.set(key, buildGear(b.size[0], b.size[1], RARITY[r]));
    }
  }
  function gearFor(item) {
    const w = item.size ? item.size[0] : 1, h = item.size ? item.size[1] : 1;
    const key = gearKey(w, h, item.rarity);
    let g = gearGeo.get(key);
    if (!g) { g = buildGear(w, h, RARITY[item.rarity] || RARITY.normal); gearGeo.set(key, g); } // unseen size: built once
    return g;
  }

  // shared beam materials per colour
  const beamMats = new Map();
  function beamMat(hex) {
    let m = beamMats.get(hex);
    if (!m) { m = beamMaterial(hex); beamMats.set(hex, m); }
    return m;
  }
  for (const r in RARITY) beamMat(RARITY[r]);
  for (const id in items.potions) beamMat(items.potions[id].colour);
  beamMat(GOLD);

  const body = flatMaterial();
  const free = [];
  const active = new Map();
  for (let i = 0; i < POOL; i++) {
    const b = new THREE.Mesh(goldGeo, body);
    b.visible = false;
    const beam = new THREE.Mesh(makeBeamGeometry(), beamMats.get(GOLD));
    beam.visible = false;
    beam.frustumCulled = false;
    group.add(b, beam);
    free.push({ id: null, body: b, beam, col: beam.geometry.getAttribute('color'), born: 0, phase: 0, stamp: 0, lastA: -1, gear: false });
  }
  let warned = false;
  let frame = 0;
  let curWorld = null, curGround = null, curTime = 0;
  const visited = [];

  function setBeamAlpha(rec, a) {
    if (a < 0) a = 0; else if (a > 1) a = 1;
    if (Math.abs(a - rec.lastA) < 1 / 96) return;
    rec.lastA = a;
    const arr = rec.col.array;
    for (let i = 3; i < arr.length; i += 4) arr[i] = a;
    rec.col.needsUpdate = true;
  }

  function assign(e) {
    const rec = free.pop();
    if (!rec) {
      if (!warned) { warned = true; console.warn('items: pool of ' + POOL + ' ground items exhausted; extra drops are not drawn'); }
      return null;
    }
    const it = e.item;
    let hex;
    if (!it) { rec.body.geometry = goldGeo; hex = GOLD; rec.gear = false; }
    else if (it.slot === 'potion') { rec.body.geometry = flaskGeo.get(it.base) || flaskGeo.values().next().value; hex = (items.potions[it.base] || {}).colour || RARITY.normal; rec.gear = false; }
    else { rec.body.geometry = gearFor(it); hex = RARITY[it.rarity] || RARITY.normal; rec.gear = true; }
    rec.id = e.id;
    rec.born = curTime;
    rec.phase = hash01(e.id);
    rec.lastA = -1;
    rec.beam.material = beamMat(hex);
    rec.body.rotation.set(0, rec.phase * TAU, 0);
    rec.body.visible = true;
    rec.beam.visible = true;
    active.set(e.id, rec);
    return rec;
  }

  function releaseRec(rec, id) {
    active.delete(id);
    rec.id = null;
    rec.body.visible = false;
    rec.beam.visible = false;
    free.push(rec);
  }

  function place(rec, e) {
    const gy = curGround(e.x, e.z);
    const bob = BOB_AMP * (0.5 + 0.5 * Math.sin(curTime * TAU * BOB_HZ + rec.phase * TAU));
    rec.body.position.set(e.x, gy + 0.01 + bob, e.z);
    const beam = rec.beam;
    beam.position.set(e.x, gy, e.z);
    const age = curTime - rec.born;
    if (age < BEAM_SEC) {
      beam.scale.y = BEAM_H * (1 - 0.2 * (age / BEAM_SEC));
      const fade = age < BEAM_SEC * 0.6 ? 1 : 1 - (age - BEAM_SEC * 0.6) / (BEAM_SEC * 0.4);
      setBeamAlpha(rec, fade > GLOW_ALPHA ? fade : GLOW_ALPHA);
    } else {
      beam.scale.y = GLOW_H;
      setBeamAlpha(rec, GLOW_ALPHA + 0.05 * Math.sin(curTime * 3 + rec.phase * TAU));
    }
  }

  /** Set.forEach callback (bound once): draw one ground item. */
  function visit(id) {
    const e = curWorld.ents[id];
    if (!e || e.kind !== 'item') return;
    let rec = active.get(id);
    if (!rec) rec = assign(e);
    if (!rec) return;
    rec.stamp = frame;
    place(rec, e);
  }

  /** Map.forEach callback (bound once): release records not touched this frame. */
  function pruneOne(rec, id) {
    if (rec.stamp !== frame) releaseRec(rec, id);
  }

  /**
   * @param world   the sim world (read only)
   * @param groundY(x, z) rendered surface height
   * @param time    seconds (beam age, bob)
   * @param zoneId  optional: only this zone's items; else the zone of every player
   */
  function sync(world, groundY, time, zoneId) {
    frame++;
    curWorld = world; curGround = groundY; curTime = time;
    if (zoneId != null) {
      const zone = world.zones[zoneId];
      if (zone) zone.ents.forEach(visit);
    } else {
      visited.length = 0;
      const ps = world.players;
      for (let i = 0; i < ps.length; i++) {
        const p = world.ents[ps[i]];
        const zone = p && world.zones[p.zone];
        if (!zone || visited.indexOf(zone) >= 0) continue;
        visited.push(zone);
        zone.ents.forEach(visit);
      }
    }
    active.forEach(pruneOne);
    curWorld = null; curGround = null;
  }

  function dispose() {
    scene.remove(group);
    active.forEach(releaseRec);
    for (let i = 0; i < free.length; i++) free[i].beam.geometry.dispose();
    free.length = 0;
    goldGeo.dispose();
    flaskGeo.forEach((g) => g.dispose());
    gearGeo.forEach((g) => g.dispose());
    beamMats.forEach((m) => m.dispose());
    flaskGeo.clear(); gearGeo.clear(); beamMats.clear();
  }

  return {
    sync, dispose, group,
    get count() { return active.size; },
    get capacity() { return POOL; },
  };
}
