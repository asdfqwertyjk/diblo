// client/src/ui/character.js — the character sheet: name, class, level, xp to next, the four
// stats with a + while statPoints > 0 (act stat), the derived list (life, mana, damage with the
// weapon, attack speed, armour, block, crit, resists, run speed, MF, gold find), deaths, gold.
// createCharacterPanel(root, {steer, tooltip, getPlayer, panels}) → { window, refresh(player), dispose() }.
// The sheet part rebuilds its strings only when level / statPoints / invVer change (that is when
// stats and `derived` can change); the live numbers (hp, mp, xp, gold, deaths) are diffed as
// numbers so a per-frame refresh allocates nothing while nothing moves.
import classes from 'shared/data/classes.js';
import { xpToNext } from 'shared/sim/xp.js';
import { deriveStats } from 'shared/sim/stats.js';
import { swingTicks } from 'shared/sim/skills.js';
import { TICK_HZ } from 'shared/sim/world.js';
import { createWindow } from './window.js';

const FONT = 'var(--hm-font, ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace)';
const HOLD_MS = 350;
const COMBAT = classes.combat;
const NONE = {};
const STATS = [['str', 'Strength'], ['dex', 'Dexterity'], ['vit', 'Vitality'], ['ene', 'Energy']];
const RESISTS = [['fireRes', 'Fire'], ['coldRes', 'Cold'], ['lightRes', 'Lightning'], ['poisonRes', 'Poison']];
const ELEMENTS = [['fireDmg', 'fire'], ['coldDmg', 'cold'], ['lightDmg', 'lightning'], ['poisonDmg', 'poison']];

const CSS = `
.hm-char{font:12px/1.35 ${FONT};color:var(--hm-text,#d8c8a0);min-width:min(420px,calc(100vw - 40px));user-select:none;-webkit-user-select:none}
.hm-char-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.hm-char-name{font-size:1.25em;font-weight:700;color:var(--hm-gold,#c8a24a);letter-spacing:.04em}
.hm-char-cls{color:var(--hm-dim,#8f7c58)}
.hm-char-lvl{margin-left:auto;color:var(--hm-text,#d8c8a0)}
.hm-char-xp{margin-bottom:10px}
.hm-char-xpbar{height:6px;background:#0f0d0a;border:1px solid var(--hm-border-dark,#3a3020);border-radius:2px;overflow:hidden}
.hm-char-xpfill{height:100%;width:0;background:var(--hm-xp,#b58a2e);transition:width .2s}
.hm-char-xptext{font-size:.85em;color:var(--hm-dim,#8f7c58);margin-top:2px}
.hm-char-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 22px}
.hm-char-h{margin:8px 0 3px;padding-bottom:2px;border-bottom:1px solid var(--hm-border-dark,#3a3020);color:var(--hm-gold,#c8a24a);font-size:.8em;letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:baseline}
.hm-char-h .pts{margin-left:auto;text-transform:none;letter-spacing:0;font-size:1.1em;color:var(--hm-good,#4fd66b)}
.hm-char-row{display:flex;align-items:center;min-height:24px;gap:6px}
.hm-char-row .k{color:var(--hm-dim,#8f7c58);flex:1}
.hm-char-row .v{text-align:right;white-space:nowrap}
.hm-char-row .v.good{color:var(--hm-good,#4fd66b)}
.hm-char-row .v.bad{color:var(--hm-bad,#e04a3a)}
.hm-char-row .v.gold{color:#f0d47a}
.hm-char-plus{min-width:28px;min-height:26px;width:28px;height:26px;padding:0;font-weight:700;color:var(--hm-good,#4fd66b);line-height:1;visibility:hidden}
.hm-char-plus.show{visibility:visible}
@media (pointer:coarse){.hm-char-plus{min-width:44px;min-height:44px;width:44px;height:40px}.hm-char-row{min-height:40px}}
@media (max-width:480px){.hm-char-cols{grid-template-columns:1fr}.hm-char{min-width:0}}
`;

const STAT_TIP = {
  str: ['Strength', 'Weapon damage ×(1 + STR/100) for strength weapons', 'Meets the strength requirement of gear'],
  dex: ['Dexterity', 'Crit +' + COMBAT.critPerDex + '% per point', 'Block +1% per ' + COMBAT.blockDexDivisor + ' points with a shield', 'Bows scale with DEX', 'Meets the dexterity requirement of gear'],
  vit: ['Vitality', 'More life per point (see the class table)'],
  ene: ['Energy', 'More mana per point and faster mana regen', 'Spells scale with ENE'],
};

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
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const pct = (v) => Math.round(v) + '%';
const sign = (v) => (v > 0 ? '+' : '') + Math.round(v);

/** Hover (mouse) or a 350 ms hold (touch/pen) shows `lines` through the tooltip; release/leave hides. */
function bindTip(node, tooltip, lines) {
  if (!tooltip) return () => {};
  let timer = 0, shown = false;
  const show = (x, y) => { tooltip.showText(typeof lines === 'function' ? lines() : lines, x, y); shown = true; };
  const hide = () => { if (shown) { shown = false; tooltip.hide(); } };
  const clear = () => { if (timer) { clearTimeout(timer); timer = 0; } };
  const onEnter = (e) => { if (e.pointerType === 'mouse') show(e.clientX, e.clientY); };
  const onDown = (e) => {
    if (e.pointerType === 'mouse' || e.target.tagName === 'BUTTON') return;
    clear();
    const x = e.clientX, y = e.clientY;
    timer = setTimeout(() => { timer = 0; show(x, y); }, HOLD_MS);
  };
  const onUp = () => { clear(); hide(); };
  node.addEventListener('pointerenter', onEnter);
  node.addEventListener('pointerleave', onUp);
  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onUp);
  return () => {
    clear(); hide();
    node.removeEventListener('pointerenter', onEnter);
    node.removeEventListener('pointerleave', onUp);
    node.removeEventListener('pointerdown', onDown);
    node.removeEventListener('pointerup', onUp);
    node.removeEventListener('pointercancel', onUp);
  };
}

export function createCharacterPanel(root, opts) {
  const o = opts || NONE;
  const steer = o.steer, tooltip = o.tooltip, getPlayer = o.getPlayer;
  const play = typeof o.play === 'function' ? o.play : null;
  ensureStyle('hm-char-style', CSS);
  const win = createWindow(root, { id: 'character', title: 'Character', onClose: () => stopLoop() });
  const unbinds = [];

  const wrap = el('div', 'hm-char', win.body);
  const head = el('div', 'hm-char-head', wrap);
  const nameEl = el('span', 'hm-char-name', head, '—');
  const clsEl = el('span', 'hm-char-cls', head, '');
  const lvlEl = el('span', 'hm-char-lvl', head, '');
  const xpWrap = el('div', 'hm-char-xp', wrap);
  const xpBar = el('div', 'hm-char-xpbar', xpWrap);
  const xpFill = el('div', 'hm-char-xpfill', xpBar);
  const xpText = el('div', 'hm-char-xptext', xpWrap, '');
  const cols = el('div', 'hm-char-cols', wrap);
  const left = el('div', 'hm-char-col', cols);
  const right = el('div', 'hm-char-col', cols);

  function header(parent, text) {
    const h = el('div', 'hm-char-h', parent, text);
    return h;
  }
  function row(parent, label, tipLines) {
    const r = el('div', 'hm-char-row', parent);
    const k = el('span', 'k', r, label);
    const v = el('span', 'v', r, '—');
    if (tipLines) unbinds.push(bindTip(r, tooltip, tipLines));
    return { el: r, k, v };
  }

  // --- attributes ---------------------------------------------------------------------
  const attrH = header(left, 'Attributes');
  const ptsEl = el('span', 'pts', attrH, '');
  const statRows = {};
  for (let i = 0; i < STATS.length; i++) {
    const [key, label] = STATS[i];
    const r = row(left, label, STAT_TIP[key]);
    const b = el('button', 'hm-btn hm-char-plus', r.el, '+');
    b.type = 'button';
    b.dataset.stat = key;
    b.setAttribute('aria-label', 'Add a point to ' + label);
    r.plus = b;
    statRows[key] = r;
  }
  header(left, 'Vitals');
  const lifeRow = row(left, 'Life');
  const manaRow = row(left, 'Mana');
  header(left, 'Record');
  const deathsRow = row(left, 'Deaths');
  const goldRow = row(left, 'Gold');
  goldRow.v.className = 'v gold';

  // --- combat / derived ----------------------------------------------------------------
  header(right, 'Combat');
  const dmgRow = row(right, 'Damage', () => dmgTip);
  const elemRow = row(right, 'Elemental');
  const iasRow = row(right, 'Attack speed', ['Attack speed', 'Swings per second with this weapon', 'Weapon speed × (1 + attack speed %)']);
  const armourRow = row(right, 'Armour', () => armourTip);
  const blockRow = row(right, 'Block', ['Block', 'Chance to block physical hits with a shield', 'shield block + DEX/' + COMBAT.blockDexDivisor + ', cap ' + COMBAT.blockCap + '%']);
  const critRow = row(right, 'Critical', ['Critical', 'Chance for ×' + COMBAT.critMult + ' damage', COMBAT.critBase + '% + DEX×' + COMBAT.critPerDex + ' + gear, cap ' + COMBAT.critCap + '%']);
  header(right, 'Resists');
  const resRows = {};
  for (let i = 0; i < RESISTS.length; i++) resRows[RESISTS[i][0]] = row(right, RESISTS[i][1]);
  header(right, 'Other');
  const speedRow = row(right, 'Run speed');
  const mfRow = row(right, 'Magic find');
  const gfRow = row(right, 'Gold find');
  const dmgTip = ['Damage', 'weapon roll + flat damage', '× (1 + damage %) × (1 + STAT/100)', 'Skills multiply this by their weapon %'];
  let armourTip = ['Armour'];

  // --- actions -----------------------------------------------------------------------
  function onClick(e) {
    const b = e.target.closest ? e.target.closest('button[data-stat]') : null;
    if (!b || b.disabled) return;
    e.preventDefault();
    const p = getPlayer ? getPlayer() : null;
    if (!p || !(p.statPoints > 0)) return;
    if (steer && steer.queue) steer.queue({ act: { op: 'stat', stat: b.dataset.stat } });
    if (play) play('uiClick');
  }
  left.addEventListener('click', onClick);

  // --- refresh -----------------------------------------------------------------------
  let sLevel = -1, sVer = -1, sPts = -1, sCls = '';
  let lXp = -1, lNext = -1, lHp = -1, lHpMax = -1, lMp = -1, lMpMax = -1, lGold = -1, lDeaths = -1;

  function derivedOf(p) {
    const d = p.derived;
    if (d && p.derivedVer === p.invVer && (p.derivedLevel == null || p.derivedLevel === p.level)) return d;
    return deriveStats(p);
  }

  /** Strings that only change with the sheet (stats, points, gear, level). */
  function updateSheet(p) {
    const c = classes.classes[p.cls] || NONE;
    setText(nameEl, p.name || 'Wanderer');
    setText(clsEl, c.name || p.cls || '');
    setText(lvlEl, 'Level ' + (p.level || 1));
    setText(manaRow.k, c.mana ? c.mana.label : 'Mana');
    const pts = p.statPoints | 0;
    setText(ptsEl, pts > 0 ? pts + (pts === 1 ? ' point' : ' points') : '');
    const alloc = p.stats || c.stats || NONE;
    const d = derivedOf(p);
    for (let i = 0; i < STATS.length; i++) {
      const key = STATS[i][0], r = statRows[key];
      const base = alloc[key] | 0, total = d[key] != null ? d[key] : base;
      setText(r.v, total !== base ? base + ' (' + total + ')' : String(base));
      setCls(r.v, total > base ? 'v good' : 'v');
      setCls(r.plus, pts > 0 ? 'hm-btn hm-char-plus show' : 'hm-btn hm-char-plus');
      r.plus.disabled = !(pts > 0);
    }
    // damage with the weapon: (roll + flat) × (1 + pct/100) × (1 + STAT/100)
    const w = d.weapon || classes.unarmed;
    const stat = d[w.scaling] != null ? d[w.scaling] : 0;
    const mult = (1 + (d.pctDmg || 0) / 100) * (1 + stat / 100);
    const lo = Math.round((w.dmg[0] + (d.flatPhys || 0)) * mult);
    const hi = Math.round((w.dmg[1] + (d.flatPhys || 0)) * mult);
    setText(dmgRow.v, lo + '-' + hi + ' (' + (w.kind || 'unarmed') + ')');
    let elem = '';
    for (let i = 0; i < ELEMENTS.length; i++) {
      const v = d[ELEMENTS[i][0]];
      if (v > 0) elem += (elem ? ', ' : '') + '+' + v + ' ' + ELEMENTS[i][1];
    }
    setText(elemRow.v, elem || '—');
    const ticks = swingTicks(p.derived === d ? p : { derived: d });
    setText(iasRow.v, f1(TICK_HZ / ticks) + '/s' + (d.ias ? ' (+' + d.ias + '%)' : ''));
    const L = p.level || 1;
    const dr = d.armour > 0 ? Math.min(COMBAT.armourCap, d.armour / (d.armour + COMBAT.armourPerLevel * L)) : 0;
    setText(armourRow.v, (d.armour | 0) + ' (' + pct(dr * 100) + ')');
    armourTip = ['Armour', 'Reduces physical damage from monsters', pct(dr * 100) + ' against level ' + L + ', cap ' + pct(COMBAT.armourCap * 100)];
    setText(blockRow.v, pct(d.block || 0));
    setText(critRow.v, pct(d.crit || 0));
    for (let i = 0; i < RESISTS.length; i++) {
      const key = RESISTS[i][0], v = d[key] || 0, r = resRows[key];
      setText(r.v, sign(v) + '%');
      setCls(r.v, v < 0 ? 'v bad' : v > 0 ? 'v good' : 'v');
    }
    setText(speedRow.v, f1(d.speed || 0) + ' m/s' + (d.frw ? ' (+' + d.frw + '%)' : ''));
    setText(mfRow.v, sign(d.mf || 0) + '%');
    setText(gfRow.v, sign(d.goldFind || 0) + '%');
  }

  function refresh(p) {
    if (!p) return;
    const level = p.level | 0, ver = p.invVer | 0, pts = p.statPoints | 0;
    if (level !== sLevel || ver !== sVer || pts !== sPts || p.cls !== sCls) {
      sLevel = level; sVer = ver; sPts = pts; sCls = p.cls;
      updateSheet(p);
    }
    const xp = p.xp | 0, next = xpToNext(level || 1);
    if (xp !== lXp || next !== lNext) {
      lXp = xp; lNext = next;
      const maxed = level >= classes.maxLevel;
      xpFill.style.width = (maxed ? 100 : Math.min(100, (xp / next) * 100)) + '%';
      setText(xpText, maxed ? xp.toLocaleString() + ' xp (max level)' : xp.toLocaleString() + ' / ' + next.toLocaleString() + ' xp');
    }
    const hp = Math.ceil(p.hp || 0), hpMax = p.hpMax | 0;
    if (hp !== lHp || hpMax !== lHpMax) { lHp = hp; lHpMax = hpMax; setText(lifeRow.v, hp + ' / ' + hpMax); }
    const mp = Math.floor(p.mp || 0), mpMax = p.mpMax | 0;
    if (mp !== lMp || mpMax !== lMpMax) { lMp = mp; lMpMax = mpMax; setText(manaRow.v, mp + ' / ' + mpMax); }
    const gold = p.gold | 0;
    if (gold !== lGold) { lGold = gold; setText(goldRow.v, gold.toLocaleString()); }
    const deaths = p.deaths | 0;
    if (deaths !== lDeaths) { lDeaths = deaths; setText(deathsRow.v, String(deaths)); }
  }

  // --- self-refresh while open (numbers are diffed, so an idle frame allocates nothing) ------
  let raf = 0;
  function loop() { raf = 0; if (!win.isOpen()) return; if (getPlayer) refresh(getPlayer()); raf = requestAnimationFrame(loop); }
  function startLoop() { if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(loop); }
  function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

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
    left.removeEventListener('click', onClick);
    for (let i = 0; i < unbinds.length; i++) unbinds[i]();
    unbinds.length = 0;
    win.dispose();
  }

  return {
    window: pane, refresh, dispose,
    open: pane.open, close: pane.close, isOpen: pane.isOpen, toggle: pane.toggle,
    get el() { return win.el; },
  };
}
