// client/src/ui/inventory.js — the inventory panel: bag grid (classes.inventory, 10×6), paper
// doll, belt strip and gold. createInventoryPanel(root, {steer, tooltip, getPlayer, panels, hud})
// → { window, refresh(player), dispose() }.
// Reads the player entity only; every change leaves as steer.queue({act}) (ops in
// shared/sim/API.md). The DOM is rebuilt only when player.invVer changes (pooled item nodes);
// the carried item is one reused ghost node moved with a transform. One pointer scheme for
// mouse and touch: press → carry (sticky) or drag; second press on a cell / doll slot / belt
// slot places it; a press outside the panel drops it; right-click or double-tap equips; a
// 350 ms hold on touch shows the tooltip and the next tap acts.
import classes from 'shared/data/classes.js';
import items from 'shared/data/items.js';
import { equipSlotOf, canEquip } from 'shared/sim/stats.js';
import { findSlot, entryOf } from 'shared/sim/inventory.js';
import { createWindow } from './window.js';
import { rarityColour, potionCss } from './tooltip.js';

const FONT = 'var(--hm-font, ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace)';
const HOLD_MS = 350;   // touch hold → tooltip
const TAP_MS = 350;    // second press on the same item → equip
const DRAG_PX = 6;     // movement before a press becomes a drag
const STACK = classes.belt.stack;
const SLOTS = items.slots;
const NONE = {};
const EMPTY = [];
const SIZE11 = [1, 1];
const CELL = [0, 0];
const TIP = ['', '', ''];
const BELT_ITEM = { iid: '', base: '', slot: 'potion', kind: 'potion', rarity: 'normal', stack: 1, size: SIZE11 };
const LABEL = { weapon: 'Weapon', shield: 'Shield', helm: 'Helm', chest: 'Chest', gloves: 'Gloves', boots: 'Boots', belt: 'Belt', amulet: 'Amulet', ring1: 'Ring', ring2: 'Ring' };
const PH_KEY = { ring1: 'ring', ring2: 'ring' };

// 16×16 flat glyphs by base kind (or slot for placeholders); fill = currentColor, evenodd.
const GLYPH = {
  dagger: 'M8 .5L10 9 8 15.5 6 9Z M4.5 9h7v1.5h-7z',
  sword: 'M8 .5L10.5 8v3h-5V8Z M3.5 11h9v1.5h-9z M7 12.5h2v3H7z',
  axe: 'M7.4 1.5h1.2v14H7.4z M8.6 3l5.4 1.2-.4 5-5 .4z',
  mace: 'M7.4 6h1.2v9.5H7.4z M8 .5l4 2.3v4.4L8 9.5 4 7.2V2.8z',
  spear: 'M8 .5l2 4.5-1.4.5v10h-1.2V5.5L6 5z',
  bow: 'M4 1h1.2v14H4z M5.5 1c5 3.5 5 10.5 0 14h1.6c5-3.5 5-10.5 0-14z',
  staff: 'M7.4 4h1.2v11.5H7.4z M8 .5l2.5 2.5L8 5.5 5.5 3z',
  wand: 'M7.2 5h1.6v10.5H7.2z M8 .5l2 2.5-2 2.5-2-2.5z',
  shield: 'M8 1l6 2-1 7-5 5-5-5-1-7z',
  helm: 'M3 8c1-5 9-5 10 0v4h-3V9.5H6V12H3z',
  chest: 'M4 2l3-1h2l3 1 2 3-2 1v9H4V6L2 5z',
  boots: 'M5 1h5v8l4 3v3H4z',
  gloves: 'M5 2h6v6l2 2-2 1v4H5z',
  belt: 'M1 6h4v4H1z M11 6h4v4h-4z M5.5 4.5h5v7h-5z',
  amulet: 'M8 1l.8 3.5L8 6l-.8-1.5z M8 6.5a3 3 0 1 0 .01 0z M8 8.5a1.2 1.2 0 1 0 .01 0z',
  ring: 'M8 2.5a5.5 5.5 0 1 0 .01 0z M8 5.5a2.5 2.5 0 1 0 .01 0z M8 .5l1.5 2h-3z',
  potion: 'M6 .5h4v1h-.5v2.5l3.5 5v5.5H3V9L6.5 4V1.5H6z',
  gem: 'M8 1l7 7-7 7-7-7z',
};

// Scoped styles (ui.css carries the window/HUD/tooltip; the panel's own rules live with it).
const CSS = `
.hm-inv{--cell:clamp(28px,calc((100vw - 36px)/10),40px);display:flex;flex-wrap:wrap;gap:10px 16px;justify-content:center;align-items:flex-start;padding:4px 0;font:12px/1.3 ${FONT};color:var(--hm-text,#d8c8a0);user-select:none;-webkit-user-select:none;touch-action:pan-y}
.hm-inv-doll{display:grid;grid-template-columns:56px 72px 56px;grid-template-rows:48px 96px 46px 48px;gap:5px;grid-template-areas:". helm amulet" "weapon chest shield" "gloves belt ring1" "ring2 boots ."}
.hm-inv-slot{position:relative;box-sizing:border-box;border:1px solid var(--hm-border,#6b5a3a);background:#0f0d0a;border-radius:2px}
.hm-inv-slot .lbl{position:absolute;left:3px;top:2px;font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:var(--hm-faint,#5e5140);pointer-events:none}
.hm-inv-slot .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--hm-border-dark,#3a3020);pointer-events:none}
.hm-inv-slot .ph svg{width:50%;height:50%;max-width:32px;max-height:32px}
.hm-inv-slot.ok{border-color:var(--hm-good,#4fd66b);box-shadow:0 0 6px rgba(79,214,107,.45)}
.hm-inv-bag{display:flex;flex-direction:column;align-items:flex-start}
.hm-inv-grid{position:relative;display:grid;background:#0f0d0a;border:1px solid var(--hm-border,#6b5a3a)}
.hm-inv-cell{position:absolute;width:var(--cell);height:var(--cell);box-sizing:border-box;border:1px solid #2a2318}
.hm-inv-item{position:absolute;box-sizing:border-box;border:2px solid #bdbdbd;background:#221d15;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:2px}
.hm-inv-item .g{display:flex;width:100%;height:100%;align-items:center;justify-content:center}
.hm-inv-item svg{width:72%;height:72%;max-width:44px;max-height:44px}
.hm-inv-item .n{position:absolute;right:2px;bottom:0;font-size:10px;color:var(--hm-text,#d8c8a0);text-shadow:0 1px 0 #000}
.hm-inv-item.carried{opacity:.3}
.hm-inv-slot>.hm-inv-item{inset:4px}
.hm-inv-belt{display:flex;gap:6px;margin-top:8px}
.hm-inv-bslot{position:relative;width:44px;height:44px;box-sizing:border-box;border:1px solid var(--hm-border,#6b5a3a);background:#0f0d0a;border-radius:2px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.hm-inv-bslot svg{width:60%;height:60%}
.hm-inv-bslot .n{position:absolute;right:3px;bottom:1px;font-size:10px;text-shadow:0 1px 0 #000}
.hm-inv-bslot .k{position:absolute;left:3px;top:1px;font-size:8px;color:var(--hm-faint,#5e5140)}
.hm-inv-gold{margin-top:8px;color:#f0d47a;letter-spacing:.04em}
.hm-inv-gold::before{content:"¤ ";color:var(--hm-dim,#8f7c58)}
.hm-inv-ghost{position:fixed;left:0;top:0;pointer-events:none;z-index:2000;opacity:.9;will-change:transform;display:none}
@media (max-width:420px){.hm-inv-doll{grid-template-columns:52px 64px 52px;grid-template-rows:44px 80px 44px 44px;gap:4px}}
`;

function ensureStyle(id, css) {
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id; s.textContent = css;
  document.head.appendChild(s);
}
const el = (tag, cls, parent) => { const n = document.createElement(tag); if (cls) n.className = cls; if (parent) parent.appendChild(n); return n; };
const svg = (k) => '<svg viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd"><path d="' + (GLYPH[k] || GLYPH.gem) + '"/></svg>';
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

/** Create an item node: a glyph holder and a stack-count corner. */
function makeItemEl(parent) {
  const n = el('div', 'hm-inv-item', parent);
  el('span', 'g', n);
  el('span', 'n', n);
  n._k = ''; n._n = '';
  return n;
}

/** Colour, glyph and count for an item; innerHTML only when the kind changes. */
function fillItem(node, item) {
  const potion = item.slot === 'potion';
  const colour = potion ? potionCss(item) : rarityColour(item.rarity);
  node.style.borderColor = colour;
  node.style.color = potion ? colour : '#cfc4ad';
  const k = potion ? 'potion' : (item.kind || item.slot || 'gem');
  if (node._k !== k) { node._k = k; node.firstChild.innerHTML = svg(k); }
  const n = potion && item.stack > 1 ? String(item.stack) : '';
  if (node._n !== n) { node._n = n; node.lastChild.textContent = n; }
  node.dataset.iid = item.iid;
}

function copySrc(dst, src) {
  dst.kind = src.kind; dst.iid = src.iid; dst.item = src.item; dst.slot = src.slot;
  dst.x = src.x; dst.y = src.y; dst.potionId = src.potionId; dst.count = src.count; dst.el = src.el;
}

export function createInventoryPanel(root, opts) {
  const o = opts || NONE;
  const steer = o.steer, tooltip = o.tooltip, getPlayer = o.getPlayer, hud = o.hud;
  const play = typeof o.play === 'function' ? o.play : null;
  ensureStyle('hm-inv-style', CSS);
  const win = createWindow(root, { id: 'inventory', title: 'Inventory', onClose: () => { cancelCarry(); hideTip(); stopLoop(); } });

  // --- DOM (built once; items are pooled) ---------------------------------------------
  const wrap = el('div', 'hm-inv', win.body);
  const doll = el('div', 'hm-inv-doll', wrap);
  const bag = el('div', 'hm-inv-bag', wrap);
  const grid = el('div', 'hm-inv-grid', bag);
  grid.dataset.r = 'grid';
  const belt = el('div', 'hm-inv-belt', bag);
  const goldEl = el('div', 'hm-inv-gold', bag);
  const ghost = makeItemEl(root);
  ghost.classList.add('hm-inv-ghost');

  const dollEls = {};
  for (let i = 0; i < SLOTS.length; i++) {
    const slot = SLOTS[i];
    const s = el('div', 'hm-inv-slot', doll);
    s.style.gridArea = slot;
    s.dataset.r = 'doll'; s.dataset.slot = slot;
    el('span', 'lbl', s).textContent = LABEL[slot] || slot;
    const ph = el('span', 'ph', s);
    ph.innerHTML = svg(PH_KEY[slot] || slot);
    const it = makeItemEl(s);
    it.style.display = 'none';
    dollEls[slot] = { slot: s, ph, item: it };
  }
  const beltEls = [];
  for (let i = 0; i < classes.belt.slots; i++) {
    const b = el('div', 'hm-inv-bslot', belt);
    b.dataset.r = 'belt'; b.dataset.slot = String(i);
    el('span', 'k', b).textContent = String(i + 1);
    const g = el('span', 'g', b);
    g.innerHTML = svg('potion');
    g.style.display = 'none';
    const n = el('span', 'n', b);
    b._g = g; b._n = n; b._pid = null;
    beltEls.push(b);
  }
  let gw = 0, gh = 0;
  const cells = [];
  function buildCells(w, h) {
    gw = w; gh = h;
    for (let i = 0; i < cells.length; i++) cells[i].remove();
    cells.length = 0;
    grid.style.gridTemplateColumns = 'repeat(' + w + ', var(--cell))';
    grid.style.gridTemplateRows = 'repeat(' + h + ', var(--cell))';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = el('div', 'hm-inv-cell', grid);
        c.style.left = 'calc(var(--cell) * ' + x + ')';
        c.style.top = 'calc(var(--cell) * ' + y + ')';
        cells.push(c);
      }
    }
  }
  buildCells(classes.inventory.w, classes.inventory.h);
  const gridItems = [];

  // --- rebuild on invVer --------------------------------------------------------------
  let lastVer = -1, lastGold = -1, dirty = true;

  function rebuild(p) {
    const inv = p.inventory, eq = p.equipment || NONE, bl = p.belt || EMPTY;
    if (inv && (inv.w !== gw || inv.h !== gh)) buildCells(inv.w, inv.h);
    const list = inv ? inv.items : EMPTY;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const node = gridItems[n] || (gridItems[n] = makeItemEl(grid));
      fillItem(node, r.item);
      node.style.left = 'calc(var(--cell) * ' + r.x + ')';
      node.style.top = 'calc(var(--cell) * ' + r.y + ')';
      node.style.width = 'calc(var(--cell) * ' + r.item.size[0] + ')';
      node.style.height = 'calc(var(--cell) * ' + r.item.size[1] + ')';
      node.style.display = '';
      n++;
    }
    for (; n < gridItems.length; n++) gridItems[n].style.display = 'none';
    for (let i = 0; i < SLOTS.length; i++) {
      const slot = SLOTS[i], d = dollEls[slot], it = eq[slot];
      if (it) { fillItem(d.item, it); d.item.style.display = ''; d.ph.style.display = 'none'; }
      else { d.item.style.display = 'none'; d.ph.style.display = ''; d.item.dataset.iid = ''; }
    }
    for (let i = 0; i < beltEls.length; i++) {
      const b = bl[i], node = beltEls[i];
      if (b) {
        const c = potionCss(b.potionId);
        node.style.borderColor = c; node.style.color = c;
        node._g.style.display = ''; node._n.textContent = String(b.count); node._pid = b.potionId;
      } else {
        node.style.borderColor = '#6b5a3a'; node.style.color = '';
        node._g.style.display = 'none'; node._n.textContent = ''; node._pid = null;
      }
    }
    relinkCarry(p);
  }

  /** After a rebuild the carried item's node may have moved pools or vanished. */
  function relinkCarry(p) {
    if (!carry.on) return;
    if (carry.el) carry.el.classList.remove('carried');
    let node = null;
    if (carry.kind === 'inv') {
      const row = p.inventory ? entryOf(p.inventory, carry.iid) : null;
      if (row) { carry.item = row.item; carry.x = row.x; carry.y = row.y; for (let i = 0; i < gridItems.length; i++) if (gridItems[i].dataset.iid === carry.iid && gridItems[i].style.display !== 'none') { node = gridItems[i]; break; } }
    } else if (carry.kind === 'doll') {
      const it = p.equipment && p.equipment[carry.slot];
      if (it && it.iid === carry.iid) { carry.item = it; node = dollEls[carry.slot].item; }
    } else if (carry.kind === 'belt') {
      const b = p.belt && p.belt[carry.slot];
      if (b && b.potionId === carry.potionId) { carry.count = b.count; node = beltEls[carry.slot]; }
    }
    if (!node) return endCarry();
    carry.el = node;
    node.classList.add('carried');
  }

  function refresh(p) {
    if (!p) return;
    const v = p.invVer | 0;
    if (v !== lastVer) { lastVer = v; dirty = true; }
    if (dirty && win.isOpen()) { dirty = false; rebuild(p); }
    const g = p.gold | 0;
    if (g !== lastGold) { lastGold = g; goldEl.textContent = 'Gold  ' + g.toLocaleString(); }
  }

  // --- sources, tooltips ----------------------------------------------------------------
  const SRC = { kind: '', iid: '', item: null, slot: null, x: 0, y: 0, potionId: null, count: 0, el: null };
  const pend = { on: false, moved: false, held: false, timer: 0, px: 0, py: 0, kind: '', iid: '', item: null, slot: null, x: 0, y: 0, potionId: null, count: 0, el: null };
  const carry = { on: false, dragging: false, kind: '', iid: '', item: null, slot: null, x: 0, y: 0, potionId: null, count: 0, el: null };
  let ghostW = 0, ghostH = 0, hoverEl = null, tipShown = false, tapIid = '', tapAt = 0;

  /** What sits under a press inside a region → the shared SRC, or null. */
  function sourceAt(reg, target, p) {
    const r = reg.dataset.r;
    if (r === 'grid') {
      const it = target.closest('[data-iid]');
      const row = it && p.inventory ? entryOf(p.inventory, it.dataset.iid) : null;
      if (!row) return null;
      SRC.kind = 'inv'; SRC.iid = row.iid; SRC.item = row.item; SRC.slot = null; SRC.x = row.x; SRC.y = row.y; SRC.el = it;
      return SRC;
    }
    if (r === 'doll') {
      const slot = reg.dataset.slot, it = p.equipment && p.equipment[slot];
      if (!it) return null;
      SRC.kind = 'doll'; SRC.iid = it.iid; SRC.item = it; SRC.slot = slot; SRC.x = 0; SRC.y = 0; SRC.el = dollEls[slot].item;
      return SRC;
    }
    if (r === 'belt') {
      const i = reg.dataset.slot | 0, b = p.belt && p.belt[i];
      if (!b) return null;
      SRC.kind = 'belt'; SRC.iid = 'belt' + i; SRC.item = null; SRC.slot = i; SRC.x = 0; SRC.y = 0; SRC.potionId = b.potionId; SRC.count = b.count; SRC.el = reg;
      return SRC;
    }
    return null;
  }

  function compareFor(p, item) {
    const s = equipSlotOf(item);
    const eq = s && p.equipment;
    return eq ? (eq[s] || (s === 'ring1' ? eq.ring2 : null)) : null;
  }

  function showTip(src, x, y, p) {
    if (!tooltip) return;
    if (src.kind === 'belt') {
      const pd = items.potions[src.potionId] || NONE;
      TIP[0] = pd.name || src.potionId;
      TIP[1] = 'Restores ' + pd.amount + ' ' + pd.kind + ' over ' + pd.overSec + ' s';
      TIP[2] = src.count + ' of ' + STACK;
      tooltip.showText(TIP, x, y);
    } else {
      tooltip.showItem(src.item, src.kind === 'inv' ? compareFor(p, src.item) : null, x, y, p);
    }
    tipShown = true;
  }
  function hideTip() { if (tipShown && tooltip) tooltip.hide(); tipShown = false; }
  function toast(text) { if (hud && hud.toast) hud.toast(text, 'bad'); }
  function send(act) {
    if (steer && steer.queue) steer.queue({ act });
    if (play && act.op !== 'equip') play('uiClick');   // the sim's equip event brings its own sound
    endCarry();
  }

  // --- carry ------------------------------------------------------------------------------
  function cellPx() { return gw > 0 ? grid.clientWidth / gw : 32; }

  function markDoll(slot) {
    const ring = slot === 'ring1' || slot === 'ring2';
    for (let i = 0; i < SLOTS.length; i++) {
      const s = SLOTS[i];
      dollEls[s].slot.classList.toggle('ok', !!slot && (s === slot || (ring && (s === 'ring1' || s === 'ring2'))));
    }
  }

  function moveGhost(x, y) {
    ghost.style.transform = 'translate(' + (x - ghostW / 2) + 'px,' + (y - ghostH / 2) + 'px)';
  }

  function startCarry(src, dragging, x, y) {
    copySrc(carry, src);
    carry.on = true; carry.dragging = dragging;
    if (carry.el) carry.el.classList.add('carried');
    const c = cellPx();
    let item = src.item;
    if (src.kind === 'belt') { BELT_ITEM.base = src.potionId; BELT_ITEM.stack = src.count; item = BELT_ITEM; }
    fillItem(ghost, item);
    ghostW = c * item.size[0]; ghostH = c * item.size[1];
    ghost.style.width = ghostW + 'px'; ghost.style.height = ghostH + 'px';
    ghost.style.display = '';
    moveGhost(x, y);
    markDoll(src.kind === 'inv' ? equipSlotOf(src.item) : null);
    hideTip();
  }

  function endCarry() {
    if (!carry.on) return;
    if (carry.el) carry.el.classList.remove('carried');
    carry.on = false; carry.dragging = false; carry.el = null; carry.item = null;
    ghost.style.display = 'none';
    markDoll(null);
  }
  const cancelCarry = endCarry;

  /** Target top-left cell for an item of `size` whose centre is under (x, y) → CELL. */
  function cellAt(x, y, size) {
    const r = grid.getBoundingClientRect();
    const c = r.width / gw;
    let cx = Math.floor((x - r.left) / c - size[0] / 2 + 0.5);
    let cy = Math.floor((y - r.top) / c - size[1] / 2 + 0.5);
    cx = cx < 0 ? 0 : cx > gw - size[0] ? gw - size[0] : cx;
    cy = cy < 0 ? 0 : cy > gh - size[1] ? gh - size[1] : cy;
    CELL[0] = cx; CELL[1] = cy;
    return CELL;
  }

  function roomForPotion(p, pid) {
    const inv = p.inventory;
    if (!inv) return false;
    for (let i = 0; i < inv.items.length; i++) {
      const it = inv.items[i].item;
      if (it.slot === 'potion' && it.base === pid && it.stack < STACK) return true;
    }
    return !!findSlot(inv, SIZE11);
  }
  function beltSlotFor(p, pid) {
    const bl = p.belt || EMPTY;
    for (let i = 0; i < bl.length; i++) if (bl[i] && bl[i].potionId === pid && bl[i].count < STACK) return i;
    for (let i = 0; i < bl.length; i++) if (!bl[i]) return i;
    return -1;
  }

  /** Equip an inventory item, optionally onto a specific doll slot; toasts instead of sending when it cannot. */
  function tryEquip(p, item, slot) {
    const want = equipSlotOf(item);
    if (!want) return toast("That can't be worn");
    const ring = want === 'ring1' || want === 'ring2';
    if (slot != null && slot !== want && !(ring && (slot === 'ring1' || slot === 'ring2'))) return toast('Wrong slot');
    const c = canEquip(p, item);
    if (!c.ok) return toast(cap(c.why));
    send({ op: 'equip', iid: item.iid });
  }

  /** Right-click / double-tap: equip, unequip, belt or unbelt in one go. */
  function quickAct(src, p) {
    if (src.kind === 'inv') {
      if (src.item.slot === 'potion') {
        const i = beltSlotFor(p, src.item.base);
        if (i < 0) return toast('Belt full');
        return send({ op: 'belt', iid: src.iid, slot: i });
      }
      return tryEquip(p, src.item, null);
    }
    if (src.kind === 'doll') {
      if (!p.inventory || !findSlot(p.inventory, src.item.size)) return toast('Bag full');
      return send({ op: 'unequip', slot: src.slot });
    }
    if (src.kind === 'belt') {
      if (!roomForPotion(p, src.potionId)) return toast('Bag full');
      return send({ op: 'unbelt', slot: src.slot });
    }
  }

  /** The carried thing is released over a region. Sends an act, cancels, or keeps carrying. */
  function dropOn(reg, x, y, p) {
    const r = reg.dataset.r;
    if (r === 'grid') {
      if (carry.kind === 'inv') {
        cellAt(x, y, carry.item.size);
        if (CELL[0] === carry.x && CELL[1] === carry.y) return cancelCarry();
        return send({ op: 'move', iid: carry.iid, x: CELL[0], y: CELL[1] });
      }
      if (carry.kind === 'doll') {
        if (!p.inventory || !findSlot(p.inventory, carry.item.size)) { toast('Bag full'); return cancelCarry(); }
        return send({ op: 'unequip', slot: carry.slot });
      }
      if (!roomForPotion(p, carry.potionId)) { toast('Bag full'); return cancelCarry(); }
      return send({ op: 'unbelt', slot: carry.slot });
    }
    if (r === 'doll') {
      const slot = reg.dataset.slot;
      if (carry.kind === 'inv') return tryEquip(p, carry.item, slot);
      if (carry.kind === 'doll' && slot === carry.slot) return cancelCarry();
      return;
    }
    if (r === 'belt') {
      const i = reg.dataset.slot | 0;
      if (carry.kind === 'inv') {
        if (carry.item.slot !== 'potion') return toast('Only potions go on the belt');
        return send({ op: 'belt', iid: carry.iid, slot: i });
      }
      if (carry.kind === 'belt' && i === carry.slot) return cancelCarry();
    }
  }

  function dropOutside() {
    if (carry.kind === 'inv' && win.isOpen()) send({ op: 'drop', iid: carry.iid });
    else cancelCarry();
  }

  // --- pointer events (document level; one scheme for mouse and touch) ----------------------
  const consume = (e) => { e.preventDefault(); e.stopPropagation(); };
  function clearHold() { if (pend.timer) { clearTimeout(pend.timer); pend.timer = 0; } }
  function onHold() {
    pend.timer = 0;
    if (!pend.on || pend.moved) return;
    pend.held = true;
    showTip(pend, pend.px, pend.py, getPlayer ? getPlayer() : NONE);
  }

  function onDown(e) {
    if (!e.isPrimary) return;
    const t = e.target;
    if (!t || !t.closest) return;
    const inside = win.el.contains(t);
    const p = getPlayer ? getPlayer() : null;
    if (carry.on) {
      if (!inside) {
        // mouse: a click on the canvas while carrying drops the item on the ground. Touch: a
        // sticky carry (a tap on an item) only cancels, and the press goes through to the HUD or
        // canvas untouched — dropping by touch is a real drag released over the canvas (onUp).
        if (e.pointerType === 'mouse' || carry.dragging) { if (win.isOpen() && carry.kind === 'inv') consume(e); dropOutside(); }
        else cancelCarry();
        return;
      }
      const reg = t.closest('[data-r]');
      if (reg && p) {
        consume(e);
        // a second press on the thing just picked up (the first tap started a sticky carry)
        // within TAP_MS is a double-tap: quick action instead of a same-cell drop
        const src = sourceAt(reg, t, p);
        if (src && src.kind === carry.kind && src.iid === carry.iid && src.slot === carry.slot
            && src.iid === tapIid && performance.now() - tapAt < TAP_MS) {
          cancelCarry(); tapAt = 0; tapIid = '';
          quickAct(src, p);
          return;
        }
        dropOn(reg, e.clientX, e.clientY, p);
      }
      return;
    }
    if (!inside || !p) return;
    const reg = t.closest('[data-r]');
    const src = reg ? sourceAt(reg, t, p) : null;
    if (!src) return;
    consume(e);
    hideTip();
    hoverEl = null;
    const now = performance.now();
    if (e.button === 2 || (src.iid === tapIid && now - tapAt < TAP_MS)) { tapAt = 0; tapIid = ''; quickAct(src, p); return; }
    tapIid = src.iid; tapAt = now;
    copySrc(pend, src);
    pend.on = true; pend.moved = false; pend.held = false; pend.px = e.clientX; pend.py = e.clientY;
    clearHold();
    if (e.pointerType !== 'mouse') pend.timer = setTimeout(onHold, HOLD_MS);
  }

  function onMove(e) {
    if (!e.isPrimary) return;
    if (pend.on) {
      if (!pend.moved && dist2(e.clientX, e.clientY, pend.px, pend.py) > DRAG_PX * DRAG_PX) {
        pend.moved = true;
        clearHold();
        if (!pend.held) startCarry(pend, true, e.clientX, e.clientY);
      }
      if (carry.on) moveGhost(e.clientX, e.clientY);
      return;
    }
    if (carry.on) { moveGhost(e.clientX, e.clientY); return; }
    if (e.pointerType !== 'mouse') return;
    const t = e.target;
    if (!t || !t.closest || !win.el.contains(t)) { if (hoverEl) { hoverEl = null; hideTip(); } return; }
    const reg = t.closest('[data-r]');
    const p = getPlayer ? getPlayer() : null;
    const src = reg && p ? sourceAt(reg, t, p) : null;
    const node = src ? src.el : null;
    if (node !== hoverEl) { hoverEl = node; if (src) showTip(src, e.clientX, e.clientY, p); else hideTip(); }
  }

  function onUp(e) {
    if (!e.isPrimary) return;
    if (pend.on) {
      clearHold();
      const held = pend.held, moved = pend.moved;
      pend.on = false;
      if (held) return;
      if (!moved) { startCarry(pend, false, e.clientX, e.clientY); return; }
    }
    if (!carry.on || !carry.dragging) return;
    carry.dragging = false;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    if (!t) return cancelCarry();
    if (!win.el.contains(t)) return dropOutside();
    const reg = t.closest ? t.closest('[data-r]') : null;
    const p = getPlayer ? getPlayer() : null;
    if (reg && p) dropOn(reg, e.clientX, e.clientY, p);
    // released over the panel but not a slot: it stays on the cursor
  }

  function onCancel() {
    clearHold();
    pend.on = false;
    if (carry.on && carry.dragging) cancelCarry();
  }
  function onLeave() { if (hoverEl) { hoverEl = null; hideTip(); } }
  const noMenu = (e) => e.preventDefault();

  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
  win.el.addEventListener('pointerleave', onLeave);
  win.el.addEventListener('contextmenu', noMenu);

  // --- self-refresh while open: an O(1) signature check per frame, so the panel stays live
  // whether or not main.js calls refresh() itself (calling it twice is harmless).
  let raf = 0;
  function loop() { raf = 0; if (!win.isOpen()) return; if (getPlayer) refresh(getPlayer()); raf = requestAnimationFrame(loop); }
  function startLoop() { if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(loop); }
  function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  // --- window wrapper: a dirty panel rebuilds as it opens ------------------------------------
  const pane = {
    get el() { return win.el; },
    get body() { return win.body; },
    open() { if (getPlayer) refresh(getPlayer()); win.open(); startLoop(); },   // build, then place
    close() { win.close(); },
    isOpen() { return win.isOpen(); },
    toggle() { if (win.isOpen()) win.close(); else pane.open(); return win.isOpen(); },
  };

  function dispose() {
    stopLoop();
    endCarry();
    hideTip();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    win.el.removeEventListener('pointerleave', onLeave);
    win.el.removeEventListener('contextmenu', noMenu);
    ghost.remove();
    win.dispose();
  }

  return {
    window: pane, refresh, dispose,
    open: pane.open, close: pane.close, isOpen: pane.isOpen, toggle: pane.toggle,
    get el() { return win.el; },
    get carrying() { return carry.on ? carry.iid : null; },
  };
}
