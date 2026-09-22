// client/src/ui/labels.js — pooled DOM labels over the canvas: floating damage numbers and
// ground-item labels. createLabels(root, camera) → { damage(x,y,z,text,kind),
//   ground(id,x,y,z,text,colourHex,onClick), release(id), hover(id|null), showAll(bool),
//   update(viewW, viewH, dt, world?), dispose() }.
// 64 nodes are created once (36 damage + 28 ground) and recycled; update() projects each live
// label with one shared Vector3 and writes transform: translate3d(...). Only ground labels take
// pointer events (LMB on one calls its onClick(id) — main.js queues the pick), damage numbers
// never do. `kind` ∈ hit crit hurt heal xp block picks the style; numbers rise 1.2 m over 0.9 s
// and fade. A ground label shows while showAll(true) is on (ALT held or the HUD toggle) or
// while its id is the hovered one; ground() is idempotent, so calling it once on the drop
// event or every frame both work, and update(…, world) releases labels whose entity is gone.
// Every world position is the GROUND height at the point; the label lifts itself.
import * as THREE from 'three';

const DMG_POOL = 36;
const GROUND_POOL = 28;
const RISE_M = 1.2;
const RISE_S = 0.9;
const GROUND_LIFT = 0.55;   // metres above the ground item
const DMG_LIFT = 1.6;       // metres above the feet where a number starts
const MAX_DT = 0.1;
const STYLE_ID = 'hm-labels-style';
const FONT = 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, Menlo, monospace';
const KINDS = { hit: 1, crit: 1, hurt: 1, heal: 1, xp: 1, block: 1 };

const CSS = `
.hm-labels{position:absolute;inset:0;overflow:hidden;pointer-events:none;font-family:${FONT};z-index:1}
.hm-lbl{position:absolute;left:0;top:0;display:none;white-space:nowrap;user-select:none;-webkit-user-select:none;will-change:transform,opacity;pointer-events:none}
.hm-lbl-dmg{font-weight:700;font-size:calc(13px + .55vmin);line-height:1;color:#f2e6c8;transform-origin:50% 100%;
  text-shadow:-1px 0 #000,1px 0 #000,0 -1px #000,0 1px #000,0 2px 3px rgba(0,0,0,.7);z-index:2}
.hm-lbl-crit{font-size:calc(20px + .9vmin);color:#ffd54a}
.hm-lbl-hurt{color:#ff5a4a}
.hm-lbl-heal{color:#4fd66b}
.hm-lbl-xp{color:#cfc6e0;font-size:calc(11px + .4vmin);font-weight:600}
.hm-lbl-block{color:#b8c4d0;font-size:calc(11px + .4vmin);letter-spacing:.06em}
.hm-lbl-ground{pointer-events:auto;cursor:pointer;z-index:1;font-size:calc(11px + .35vmin);line-height:1.2;
  color:#d8c8a0;background:rgba(26,23,18,.88);border:1px solid #6b5a3a;border-radius:2px;padding:3px 7px;
  box-shadow:0 1px 4px rgba(0,0,0,.55);text-shadow:0 1px 0 #000}
.hm-lbl-ground::before{content:'';position:absolute;left:-6px;right:-6px;top:-8px;bottom:-8px}
.hm-lbl-ground:hover{border-color:#c8a24a;background:rgba(40,34,24,.96)}
@media (pointer:coarse){.hm-lbl-ground{padding:5px 9px}.hm-lbl-ground::before{left:-10px;right:-10px;top:-14px;bottom:-14px}}
`;

function hex6(n) {
  const s = (n & 0xffffff).toString(16);
  return '#' + '000000'.slice(s.length) + s;
}

/** Ground-label text and colour for a ground entity ({item|null, gold}); a reused result object. */
const described = { text: '', colour: 0xbdbdbd };
export function describeGround(ent, rarityColours) {
  if (!ent) { described.text = ''; described.colour = 0xbdbdbd; return described; }
  if (ent.item) {
    const it = ent.item;
    described.text = it.stack > 1 ? it.name + ' ×' + it.stack : it.name;
    described.colour = (rarityColours && rarityColours[it.rarity]) || 0xbdbdbd;
  } else {
    described.text = (ent.gold | 0) + ' gold';
    described.colour = 0xffd54a;
  }
  return described;
}

export function createLabels(root, camera) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const box = document.createElement('div');
  box.className = 'hm-labels';
  root.appendChild(box);

  const v = new THREE.Vector3();   // projection scratch
  let px = 0, py = 0;
  let serial = 0;
  let allShown = false;
  let hovered = null;
  const groundMap = new Map();

  function onGroundDown(ev) {
    const rec = ev.currentTarget.hmRec;
    if (!rec || !rec.active || ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (rec.onClick) rec.onClick(rec.id, ev);
  }

  function makeRec(ground) {
    const el = document.createElement('div');
    el.className = 'hm-lbl';
    box.appendChild(el);
    const rec = {
      el, ground, active: false, born: 0, shown: false, id: null,
      x: 0, y: 0, z: 0, t: 0, kind: 'hit', text: '', colour: -1, onClick: null, cls: '', op: -1,
    };
    if (ground) { el.hmRec = rec; el.addEventListener('pointerdown', onGroundDown); }
    return rec;
  }
  const dmg = [], grd = [];
  for (let i = 0; i < DMG_POOL; i++) dmg.push(makeRec(false));
  for (let i = 0; i < GROUND_POOL; i++) grd.push(makeRec(true));

  function hide(rec) {
    if (rec.shown) { rec.shown = false; rec.el.style.display = 'none'; }
  }
  function show(rec) {
    if (!rec.shown) { rec.shown = true; rec.el.style.display = 'block'; }
  }
  function free(rec) {
    rec.active = false;
    rec.onClick = null;
    hide(rec);
  }
  function setText(rec, text) {
    if (rec.text !== text) { rec.text = text; rec.el.textContent = text; }
  }
  function setClass(rec, cls) {
    if (rec.cls !== cls) { rec.cls = cls; rec.el.className = cls; }
  }
  function setOpacity(rec, a) {
    const q = (a * 16 + 0.5) | 0;   // 1/16 steps: fewer style writes, no visible banding on text
    if (rec.op !== q) { rec.op = q; rec.el.style.opacity = q >= 16 ? '1' : q <= 0 ? '0' : String(q / 16); }
  }

  /** Free record from `pool`, else the oldest live one (a stale number is worth less than a new one). */
  function takeDmg() {
    let oldest = null;
    for (let i = 0; i < dmg.length; i++) {
      const r = dmg[i];
      if (!r.active) return r;
      if (!oldest || r.born < oldest.born) oldest = r;
    }
    return oldest;
  }
  function takeGround() {
    for (let i = 0; i < grd.length; i++) if (!grd[i].active) return grd[i];
    return null;
  }

  /** Project world (x,y,z) to viewport pixels in px/py; false when behind the camera. */
  function project(x, y, z, w, h) {
    v.set(x, y, z).project(camera);
    if (!(v.z < 1 && v.z > -1)) return false;
    px = (v.x * 0.5 + 0.5) * w;
    py = (-v.y * 0.5 + 0.5) * h;
    return px > -80 && px < w + 80 && py > -40 && py < h + 60;
  }

  // --- API ------------------------------------------------------------------------------------

  /** A floating number/word at (x, groundY, z). kind: hit crit hurt heal xp block. */
  function damage(x, y, z, text, kind) {
    const rec = takeDmg();
    const k = KINDS[kind] ? kind : 'hit';
    rec.active = true; rec.born = ++serial; rec.t = 0; rec.kind = k;
    rec.x = x + (Math.random() - 0.5) * 0.5;   // a little scatter so stacked hits stay readable
    rec.y = y + DMG_LIFT;
    rec.z = z + (Math.random() - 0.5) * 0.3;
    setClass(rec, 'hm-lbl hm-lbl-dmg hm-lbl-' + k);
    setText(rec, text == null ? '' : String(text));
    rec.op = -1;
    hide(rec);
    return rec;
  }

  /** Register or update the ground label of entity `id`. Returns false when the pool is dry. */
  function ground(id, x, y, z, text, colourHex, onClick) {
    let rec = groundMap.get(id);
    if (!rec) {
      rec = takeGround();
      if (!rec) return false;
      rec.active = true; rec.born = ++serial; rec.id = id; rec.colour = -1; rec.op = -1;
      groundMap.set(id, rec);
      setClass(rec, 'hm-lbl hm-lbl-ground');
      setOpacity(rec, 1);
    }
    rec.x = x; rec.y = y; rec.z = z;
    setText(rec, text == null ? '' : String(text));
    const col = colourHex == null ? 0xd8c8a0 : colourHex | 0;
    if (rec.colour !== col) { rec.colour = col; rec.el.style.color = hex6(col); }
    if (onClick !== undefined) rec.onClick = onClick;
    return true;
  }

  function release(id) {
    const rec = groundMap.get(id);
    if (!rec) return false;
    groundMap.delete(id);
    free(rec);
    return true;
  }

  function hover(id) { hovered = id == null ? null : id; }
  function showAll(on) { allShown = !!on; }

  // per-update state for the Map callback (no closures per frame)
  let uw = 0, uh = 0, uworld = null;
  function updateGround(rec, id) {
    if (uworld && !uworld.ents[id]) { groundMap.delete(id); free(rec); return; }
    if (!allShown && id !== hovered) { hide(rec); return; }
    if (!project(rec.x, rec.y + GROUND_LIFT, rec.z, uw, uh)) { hide(rec); return; }
    rec.el.style.transform = 'translate3d(' + (px | 0) + 'px,' + (py | 0) + 'px,0) translate(-50%,-100%)';
    show(rec);
  }

  /**
   * @param viewW,viewH viewport size in CSS pixels
   * @param dt          seconds since the last update
   * @param world       optional: ground labels whose entity left world.ents are released
   */
  function update(viewW, viewH, dt, world) {
    if (!(dt >= 0)) dt = 0;
    if (dt > MAX_DT) dt = MAX_DT;
    uw = viewW; uh = viewH; uworld = world || null;
    for (let i = 0; i < dmg.length; i++) {
      const rec = dmg[i];
      if (!rec.active) continue;
      rec.t += dt;
      const k = rec.t / RISE_S;
      if (k >= 1) { free(rec); continue; }
      if (!project(rec.x, rec.y + RISE_M * k, rec.z, viewW, viewH)) { hide(rec); continue; }
      let tf = 'translate3d(' + (px | 0) + 'px,' + (py | 0) + 'px,0) translate(-50%,-100%)';
      if (rec.kind === 'crit') {
        const pop = k < 0.15 ? 1.6 - 4 * k : 1;   // 1.6 → 1.0 over the first 0.15 s
        if (pop > 1.001) tf += ' scale(' + pop.toFixed(2) + ')';
      }
      rec.el.style.transform = tf;
      setOpacity(rec, k < 0.45 ? 1 : 1 - (k - 0.45) / 0.55);
      show(rec);
    }
    groundMap.forEach(updateGround);
    uworld = null;
  }

  function dispose() {
    groundMap.clear();
    for (let i = 0; i < grd.length; i++) { grd[i].el.removeEventListener('pointerdown', onGroundDown); grd[i].el.hmRec = null; }
    box.remove();
    dmg.length = 0; grd.length = 0;
  }

  return {
    damage, ground, release, hover, showAll, update, dispose, el: box,
    get hovered() { return hovered; },
    get allShown() { return allShown; },
  };
}
