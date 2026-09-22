// client/src/ui/skills.js — the skill trees: one column per tree of the player's class (only
// trees that have rows in classes.skills), a row per skill with name, rank pips, rank/max, a +
// that spends a point (act skill) when the sim would accept it (row unlock level, ≥ 1 point in
// the row above in the same tree, points left, below maxRank), and six assign buttons
// LMB RMB 1 2 3 4 (act assign; the active slot is highlighted from player.slots, tapping an
// active slot > 0 clears it). Tooltip via tooltip.showSkill on hover or a 350 ms touch hold.
// createSkillsPanel(root, {steer, tooltip, getPlayer, panels}) → { window, refresh(player), dispose() }.
// The DOM is built once per class; refresh() touches it only when invVer / level / skillPoints change.
import classes from 'shared/data/classes.js';
import { createWindow } from './window.js';

const FONT = 'var(--hm-font, ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace)';
const HOLD_MS = 350;
const RULES = classes.skillRules;
const MAX_RANK = RULES.maxRank;
const SLOT_KEYS = RULES.slots.map((s) => (s.charAt(0) === 'k' && s.length === 2 ? s.slice(1) : s.toUpperCase()));
const NONE = {};

const CSS = `
.hm-sk{font:12px/1.3 ${FONT};color:var(--hm-text,#d8c8a0);user-select:none;-webkit-user-select:none}
.hm-sk-head{display:flex;align-items:baseline;gap:10px;margin-bottom:6px;flex-wrap:wrap}
.hm-sk-cls{color:var(--hm-dim,#8f7c58)}
.hm-sk-pts{margin-left:auto;color:var(--hm-dim,#8f7c58)}
.hm-sk-pts.has{color:var(--hm-good,#4fd66b)}
.hm-sk-trees{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
.hm-sk-tree{flex:1 1 250px;min-width:min(250px,calc(100vw - 40px));max-width:340px}
.hm-sk-tree-h{color:var(--hm-gold,#c8a24a);font-size:.8em;letter-spacing:.16em;text-transform:uppercase;border-bottom:1px solid var(--hm-border-dark,#3a3020);padding-bottom:3px;margin-bottom:6px}
.hm-sk-row{border:1px solid var(--hm-border-dark,#3a3020);background:var(--hm-panel-2,#24201a);border-radius:2px;padding:5px 7px 6px;margin-bottom:6px}
.hm-sk-row.learned{border-color:var(--hm-border,#6b5a3a)}
.hm-sk-row.locked{opacity:.55}
.hm-sk-top{display:flex;align-items:baseline;gap:8px;min-height:20px}
.hm-sk-name{font-weight:700;letter-spacing:.03em}
.hm-sk-row.learned .hm-sk-name{color:var(--hm-gold,#c8a24a)}
.hm-sk-rank{color:var(--hm-dim,#8f7c58);font-size:.9em}
.hm-sk-lock{margin-left:auto;color:var(--hm-bad,#e04a3a);font-size:.8em;letter-spacing:.06em}
.hm-sk-row.learned .hm-sk-lock,.hm-sk-row.open .hm-sk-lock{display:none}
.hm-sk-pips{display:flex;gap:3px;margin:4px 0 5px}
.hm-sk-pip{width:9px;height:9px;box-sizing:border-box;border:1px solid var(--hm-border,#6b5a3a);background:#0f0d0a}
.hm-sk-pip.on{background:var(--hm-gold,#c8a24a);border-color:#e6c76a}
.hm-sk-btns{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.hm-sk-btns .hm-btn{min-width:34px;min-height:28px;height:28px;padding:0 .45em;font-size:.85em;letter-spacing:.02em}
.hm-sk-plus{font-weight:700;color:var(--hm-good,#4fd66b);margin-right:4px}
.hm-sk-plus:disabled{color:var(--hm-faint,#5e5140)}
.hm-sk-as.on{border-color:var(--hm-gold,#c8a24a);color:var(--hm-gold,#c8a24a);background:#2a2418}
@media (pointer:coarse){.hm-sk-btns .hm-btn{min-width:44px;min-height:44px;height:44px}}
`;

function ensureStyle(id, css) {
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id; s.textContent = css;
  document.head.appendChild(s);
}
const el = (tag, cls, parent, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
};
const setText = (n, s) => { if (n._t !== s) { n._t = s; n.textContent = s; } };
const setCls = (n, c) => { if (n._c !== c) { n._c = c; n.className = c; } };

/** Rows of classes.skills for a class and tree, sorted by row. */
function rowsFor(cls, tree) {
  const out = [];
  for (const id in classes.skills) {
    const r = classes.skills[id];
    if (r.class === cls && r.tree === tree) out.push(r);
  }
  out.sort((a, b) => a.row - b.row);
  return out;
}

/** ≥ 1 hard point in some skill of the row above `row` in the same tree (the sim's prerequisite). */
function hasPointAbove(skills, row) {
  if (row.row <= 1) return true;
  if (!skills) return false;
  for (const id in classes.skills) {
    const r = classes.skills[id];
    if (r.class === row.class && r.tree === row.tree && r.row === row.row - 1 && (skills[id] | 0) >= 1) return true;
  }
  return false;
}

export function createSkillsPanel(root, opts) {
  const o = opts || NONE;
  const steer = o.steer, tooltip = o.tooltip, getPlayer = o.getPlayer;
  const play = typeof o.play === 'function' ? o.play : null;
  ensureStyle('hm-sk-style', CSS);
  const win = createWindow(root, { id: 'skills', title: 'Skills', onClose: () => { hideTip(); stopLoop(); } });

  const wrap = el('div', 'hm-sk', win.body);
  const head = el('div', 'hm-sk-head', wrap);
  const clsEl = el('span', 'hm-sk-cls', head, '');
  const ptsEl = el('span', 'hm-sk-pts', head, '');
  const trees = el('div', 'hm-sk-trees', wrap);

  let builtCls = '';
  const rowStates = [];      // {id, row, el, rankEl, pips[], plus, as[]}
  const byId = new Map();

  function build(cls) {
    builtCls = cls;
    trees.textContent = '';
    rowStates.length = 0;
    byId.clear();
    const c = classes.classes[cls];
    setText(clsEl, c ? c.name : cls);
    const list = c && c.trees ? c.trees : [];
    for (let t = 0; t < list.length; t++) {
      const tree = list[t];
      const rows = rowsFor(cls, tree.id);
      if (rows.length === 0) continue;
      const col = el('div', 'hm-sk-tree', trees);
      el('div', 'hm-sk-tree-h', col, tree.name || tree.id);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const r = el('div', 'hm-sk-row', col);
        r.dataset.id = row.id;
        const top = el('div', 'hm-sk-top', r);
        el('span', 'hm-sk-name', top, row.name || row.id);
        const rankEl = el('span', 'hm-sk-rank', top, '0/' + MAX_RANK);
        const need = RULES.rowUnlockLevels[row.row - 1];
        el('span', 'hm-sk-lock', top, need != null ? 'Lv ' + need : '');
        const pipsEl = el('div', 'hm-sk-pips', r);
        const pips = [];
        for (let k = 0; k < MAX_RANK; k++) pips.push(el('span', 'hm-sk-pip', pipsEl));
        const btns = el('div', 'hm-sk-btns', r);
        const plus = el('button', 'hm-btn hm-sk-plus', btns, '+');
        plus.type = 'button'; plus.dataset.act = 'plus'; plus.dataset.id = row.id;
        plus.setAttribute('aria-label', 'Spend a point on ' + row.name);
        plus.disabled = true;
        const as = [];
        for (let s = 0; s < SLOT_KEYS.length; s++) {
          const b = el('button', 'hm-btn hm-sk-as', btns, SLOT_KEYS[s]);
          b.type = 'button'; b.dataset.act = 'as'; b.dataset.id = row.id; b.dataset.slot = String(s);
          b.setAttribute('aria-label', 'Assign ' + row.name + ' to ' + SLOT_KEYS[s]);
          b.disabled = true;
          as.push(b);
        }
        const st = { id: row.id, row, el: r, rankEl, pips, plus, as, rank: 0 };
        rowStates.push(st);
        byId.set(row.id, st);
      }
    }
  }

  // --- refresh -----------------------------------------------------------------------
  let sVer = -1, sLevel = -1, sPts = -1;

  function refresh(p) {
    if (!p) return;
    if (p.cls !== builtCls) { build(p.cls); sVer = -1; }
    const ver = p.invVer | 0, level = p.level | 0, pts = p.skillPoints | 0;
    if (ver === sVer && level === sLevel && pts === sPts) return;
    sVer = ver; sLevel = level; sPts = pts;
    setText(ptsEl, pts > 0 ? pts + (pts === 1 ? ' point to spend' : ' points to spend') : 'No points to spend');
    setCls(ptsEl, pts > 0 ? 'hm-sk-pts has' : 'hm-sk-pts');
    const skills = p.skills || NONE;
    const slots = p.slots || NONE;
    for (let i = 0; i < rowStates.length; i++) {
      const st = rowStates[i], row = st.row;
      const rank = skills[row.id] | 0;
      st.rank = rank;
      const need = RULES.rowUnlockLevels[row.row - 1];
      const unlocked = need != null && level >= need;
      const canPlus = pts > 0 && rank < MAX_RANK && unlocked && hasPointAbove(skills, row);
      setText(st.rankEl, rank + '/' + MAX_RANK);
      setCls(st.el, 'hm-sk-row' + (rank > 0 ? ' learned' : '') + (unlocked ? ' open' : ' locked'));
      for (let k = 0; k < st.pips.length; k++) setCls(st.pips[k], k < rank ? 'hm-sk-pip on' : 'hm-sk-pip');
      st.plus.disabled = !canPlus;
      for (let s = 0; s < st.as.length; s++) {
        const b = st.as[s];
        const on = slots[s] === row.id;
        b.disabled = rank < 1;
        setCls(b, on ? 'hm-btn hm-sk-as on' : 'hm-btn hm-sk-as');
      }
    }
  }

  // --- actions -----------------------------------------------------------------------
  function queue(act) { if (steer && steer.queue) steer.queue({ act }); if (play) play('uiClick'); }

  function onClick(e) {
    const b = e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!b || b.disabled) return;
    e.preventDefault();
    const p = getPlayer ? getPlayer() : null;
    if (!p) return;
    const id = b.dataset.id;
    if (b.dataset.act === 'plus') { queue({ op: 'skill', id }); return; }
    const slot = b.dataset.slot | 0;
    const active = p.slots && p.slots[slot] === id;
    if (!active) queue({ op: 'assign', slot, id });
    else if (slot !== 0) queue({ op: 'assign', slot, id: null });   // slot 0 must keep a skill
  }
  trees.addEventListener('click', onClick);

  // --- tooltip: hover (mouse) or a hold (touch) on a row, never over its buttons ---------------
  let tipShown = false, holdTimer = 0, hoverId = '';
  function hideTip() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
    hoverId = '';
    if (tipShown && tooltip) { tipShown = false; tooltip.hide(); }
  }
  function showTip(id, x, y) {
    const st = byId.get(id);
    if (!st || !tooltip) return;
    const p = getPlayer ? getPlayer() : null;
    tooltip.showSkill(st.row, st.rank, p, x, y);
    tipShown = true;
    hoverId = id;
  }
  function rowUnder(t) {
    if (!t || !t.closest || t.closest('button')) return null;
    return t.closest('.hm-sk-row');
  }
  function onMove(e) {
    if (e.pointerType !== 'mouse') return;
    const r = rowUnder(e.target);
    const id = r ? r.dataset.id : '';
    if (id === hoverId) return;
    if (!id) { hideTip(); return; }
    showTip(id, e.clientX, e.clientY);
  }
  function onDown(e) {
    if (e.pointerType === 'mouse') return;
    const r = rowUnder(e.target);
    hideTip();
    if (!r) return;
    const id = r.dataset.id, x = e.clientX, y = e.clientY;
    holdTimer = setTimeout(() => { holdTimer = 0; showTip(id, x, y); }, HOLD_MS);
  }
  function onUp(e) { if (e.pointerType !== 'mouse') hideTip(); }
  function onLeave() { hideTip(); }
  trees.addEventListener('pointermove', onMove);
  trees.addEventListener('pointerdown', onDown);
  trees.addEventListener('pointerup', onUp);
  trees.addEventListener('pointercancel', onUp);
  trees.addEventListener('pointerleave', onLeave);

  // --- self-refresh while open: three integer compares per frame when nothing changed -------
  let raf = 0;
  function loop() { raf = 0; if (!win.isOpen()) return; if (getPlayer) refresh(getPlayer()); raf = requestAnimationFrame(loop); }
  function startLoop() { if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(loop); }
  function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  const pane = {
    get el() { return win.el; },
    get body() { return win.body; },
    // build before placing: window.js measures the window as it opens
    open() { if (getPlayer) refresh(getPlayer()); win.open(); startLoop(); },
    close() { win.close(); },
    isOpen() { return win.isOpen(); },
    toggle() { if (win.isOpen()) win.close(); else pane.open(); return win.isOpen(); },
  };

  function dispose() {
    stopLoop();
    hideTip();
    trees.removeEventListener('click', onClick);
    trees.removeEventListener('pointermove', onMove);
    trees.removeEventListener('pointerdown', onDown);
    trees.removeEventListener('pointerup', onUp);
    trees.removeEventListener('pointercancel', onUp);
    trees.removeEventListener('pointerleave', onLeave);
    win.dispose();
  }

  return {
    window: pane, refresh, dispose,
    open: pane.open, close: pane.close, isOpen: pane.isOpen, toggle: pane.toggle,
    get el() { return win.el; },
  };
}
