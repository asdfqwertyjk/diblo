// client/src/ui/hud.js — the P1 HUD (replaces the P0 dev panel; the dev line survives, small,
// hidden by H). createHud(root, commands) → { update(player, world), toast(text, kind),
// setTarget(ent|null), toggle(), setLabelsMode(on), set(fields), setTooltip(tip),
// setPanelOpen(name|null), dispose(), el }.
// commands = { castSlot(i), drink(i), openPanel(name), zoom(), toggleLabels(), toggleHud(),
//              newGame()?, respawn()? } from main.js; every command is optional.
// Layout (all css in ui.css): life globe bottom-left, mana globe bottom-right (label from
// classes.mana.label), xp strip along the bottom with a level badge, belt + skill bar centre
// bottom, target bar top-centre, button column top-right, gold/zone/dev line top-left, toasts
// under the target bar. update() touches the DOM only when a shown value changes, so the
// per-frame path allocates nothing while nothing moves; text is refreshed at most 10×/s.
import classes from 'shared/data/classes.js';
import items from 'shared/data/items.js';
import { TICK_HZ } from 'shared/sim/world.js';
import { xpToNext } from 'shared/sim/xp.js';
import { skillRow, skillCost } from 'shared/sim/skills.js';
import { potionCss, rarityColour } from './tooltip.js';

const SLOT_KEYS = ['LMB', 'RMB', '1', '2', '3', '4'];
const BELT_KEYS = ['Q', 'E', 'R', 'F'];
const BUTTONS = [
  ['bag', 'Bag', 'inventory'], ['char', 'Char', 'character'], ['skills', 'Skills', 'skills'],
  ['labels', 'Labels', null], ['zoom', 'Zoom', null], ['new', 'New', null],
];
const TEXT_INTERVAL_MS = 100;   // text refresh ≤ 10×/s; globes and sweeps every frame
const TOAST_MS = 2000, TOAST_FADE_MS = 350, TOAST_MAX = 6;
const HOLD_MS = 350;            // touch hold → tooltip; the following release does not act
const REPEAT_MS = 180;          // a held skill button re-casts at this rate
const NEW_CONFIRM_MS = 2000;    // 'New' is armed by one tap and fires on a second within this
const LOW_LIFE_PCT = 25;
const RARITY = items.rarity.colours;

function h(tag, cls, parent, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

/** 'Skullbreak' → 'Skull', 'Cleave' → 'Cleave': ≤ 6 characters on a button. */
function shortName(name) {
  const s = String(name || '');
  return s.length <= 6 ? s : s.slice(0, 5);
}

/**
 * One scheme for mouse and touch on a tappable element: pointerdown/up = tap (no click
 * events, so touch and mouse behave identically); a touch/pen hold of HOLD_MS shows the
 * tooltip instead and swallows the release; mouse hover shows it; `repeat` re-fires the tap
 * while held — and a repeat button never turns a touch hold into a tooltip, so holding a
 * skill button keeps casting on a phone (skill details stay in the Skills panel).
 * Returns an unbind function.
 */
function bindTap(el, { onTap, onHover, onLeave, repeat = false }) {
  let downId = null, holdTimer = 0, repeatTimer = 0, tipShown = false;
  const clearTimers = () => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
    if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = 0; }
  };
  const onDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    downId = e.pointerId;
    tipShown = false;
    el.classList.add('down');
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
    clearTimers();
    if (e.pointerType !== 'mouse' && onHover && !repeat) {
      holdTimer = setTimeout(() => { holdTimer = 0; tipShown = true; onHover(e.clientX, e.clientY); }, HOLD_MS);
    }
    if (repeat && onTap) {
      onTap();
      repeatTimer = setInterval(() => { if (!tipShown) onTap(); }, REPEAT_MS);
    }
  };
  const onUp = (e) => {
    if (e.pointerId !== downId) return;
    downId = null;
    el.classList.remove('down');
    const acted = repeat;
    clearTimers();
    if (tipShown) { tipShown = false; if (onLeave) onLeave(); return; }
    if (!acted && onTap) onTap();
    if (e.pointerType !== 'mouse' && onLeave) onLeave();
  };
  const onCancel = (e) => {
    if (e.pointerId !== downId) return;
    downId = null;
    el.classList.remove('down');
    clearTimers();
    if (tipShown) { tipShown = false; if (onLeave) onLeave(); }
  };
  // mouse hover shows the tooltip once on enter (not on every move) and hides it on leave
  const onEnter = (e) => { if (e.pointerType === 'mouse' && downId == null && onHover) onHover(e.clientX, e.clientY); };
  const onOut = (e) => { if (e.pointerType === 'mouse' && onLeave) onLeave(); };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointerleave', onOut);
  return () => {
    clearTimers();
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    el.removeEventListener('pointerenter', onEnter);
    el.removeEventListener('pointerleave', onOut);
  };
}

export function createHud(root, commands = {}) {
  const cmd = commands || {};
  const unbinds = [];
  const call = (name, arg) => { const f = cmd[name]; if (typeof f === 'function') f(arg); };
  let tooltip = cmd.tooltip || null;
  let player = null;               // the last player passed to update(), for tooltips

  const el = h('div', 'hm-hud', root);
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- top-left: zone, gold, dev line ---------------------------------------------
  const topLeft = h('div', 'hm-topleft hm-plate', el);
  const zoneEl = h('div', 'hm-zone', topLeft, 'Hollowmark');
  const goldEl = h('div', 'hm-gold-line', topLeft, '0');
  const devEl = h('div', 'hm-dev', topLeft, '—');
  const dev = { fps: -1, tick: -1, ents: -1, calls: -1, seed: null, text: '' };
  let devVisible = true;

  // --- top-centre: target bar -------------------------------------------------------
  const targetEl = h('div', 'hm-target hm-plate', el);
  const targetName = h('span', 'hm-target-name', targetEl, '');
  const targetTag = h('span', 'hm-target-tag', targetEl, '');
  const targetLvl = h('span', 'hm-target-lvl', targetEl, '');
  const targetBar = h('div', 'hm-target-bar', targetEl);
  const targetFill = h('div', 'hm-target-fill', targetBar);
  let target = null, targetPct = -1, targetShown = false;

  // --- toasts -----------------------------------------------------------------------
  const toastsEl = h('div', 'hm-toasts', el);
  const toasts = [];
  for (let i = 0; i < TOAST_MAX; i++) toasts.push({ el: h('div', 'hm-toast'), timer: 0, busy: false, at: 0 });

  // --- top-right buttons ------------------------------------------------------------
  const buttonsEl = h('div', 'hm-buttons', el);
  const buttonEls = {};
  for (let i = 0; i < BUTTONS.length; i++) {
    const [key, label, panel] = BUTTONS[i];
    const b = h('button', 'hm-btn', buttonsEl, label);
    b.type = 'button';
    b.dataset.cmd = key;
    buttonEls[key] = b;
    const onTap = panel ? () => call('openPanel', panel)
      : key === 'labels' ? () => call('toggleLabels')
        : key === 'zoom' ? () => call('zoom')
          : newRunTap;
    unbinds.push(bindTap(b, { onTap }));
  }
  if (typeof cmd.newGame !== 'function') buttonEls.new.style.display = 'none';
  // 'New' throws the whole run away (no save in P1) and sits under Zoom, so one tap only arms
  // it (button lit + toast) and a second tap within NEW_CONFIRM_MS starts the new run.
  let newArmedAt = -1e9, newTimer = 0;
  function disarmNew() { newTimer = 0; newArmedAt = -1e9; buttonEls.new.classList.remove('on'); }
  function newRunTap() {
    const now = performance.now();
    if (now - newArmedAt < NEW_CONFIRM_MS) { if (newTimer) clearTimeout(newTimer); disarmNew(); call('newGame'); return; }
    newArmedAt = now;
    buttonEls.new.classList.add('on');
    if (newTimer) clearTimeout(newTimer);
    newTimer = setTimeout(disarmNew, NEW_CONFIRM_MS);
    toast('Tap New again to start a new run', 'bad');
  }

  // --- bottom: globes, belt, skills -------------------------------------------------
  const bottom = h('div', 'hm-bottom', el);
  function makeGlobe(kind, label) {
    const g = h('div', 'hm-globe ' + kind, bottom);
    const fill = h('div', 'hm-globe-fill', g);
    const num = h('div', 'hm-globe-num', g);
    const val = h('span', 'hm-globe-val', num, '0');
    const lbl = h('span', 'hm-globe-lbl', num, label);
    return { el: g, fill, val, lbl, pct: -1, shown: -1, low: false, label };
  }
  const life = makeGlobe('life', 'Life');
  const mana = makeGlobe('mana', 'Mana');

  const centre = h('div', 'hm-centre', bottom);
  const beltEl = h('div', 'hm-belt', centre);
  const belt = [];
  for (let i = 0; i < classes.belt.slots; i++) {
    const b = h('button', 'hm-slot hm-belt-slot empty', beltEl);
    b.type = 'button';
    b.dataset.slot = String(i);
    const pot = h('span', 'hm-pot', b);
    const count = h('span', 'hm-count', b, '');
    if (BELT_KEYS[i]) h('span', 'hm-key', b, BELT_KEYS[i]);
    const s = { el: b, pot, count, pid: null, n: -1, cd: false };
    belt.push(s);
    unbinds.push(bindTap(b, {
      onTap: () => call('drink', i),
      onHover: (x, y) => showBeltTip(s, x, y),
      onLeave: hideTip,
    }));
  }

  const skillsEl = h('div', 'hm-skills', centre);
  const skills = [];
  for (let i = 0; i < SLOT_KEYS.length; i++) {
    const b = h('button', 'hm-slot hm-skill empty', skillsEl);
    b.type = 'button';
    b.dataset.slot = String(i);
    const name = h('span', 'hm-skill-name', b, '');
    const cd = h('span', 'hm-cd', b);
    const cdNum = h('span', 'hm-cd-num', b, '');
    h('span', 'hm-key', b, SLOT_KEYS[i]);
    const s = { el: b, name, cd, cdNum, id: undefined, row: null, pct: -1, tenths: -1, dim: false, held: false, learned: false };
    skills.push(s);
    unbinds.push(bindTap(b, {
      onTap: () => call('castSlot', i),
      onHover: (x, y) => showSkillTip(s, x, y),
      onLeave: hideTip,
      repeat: true,
    }));
  }

  // --- xp strip ---------------------------------------------------------------------
  const xpEl = h('div', 'hm-xp', el);
  const xpFill = h('div', 'hm-xp-fill', xpEl);
  const xpLvl = h('div', 'hm-xp-lvl', xpEl, '1');
  let xpTenths = -1, shownLevel = -1, shownGold = -1;

  // --- death banner -----------------------------------------------------------------
  const deadEl = h('div', 'hm-dead hm-plate', el);
  h('div', 'hm-dead-title', deadEl, 'You died');
  const deadSub = h('div', 'hm-dead-sub', deadEl, '');
  const deadBtn = h('button', 'hm-btn', deadEl, 'Rise');
  deadBtn.type = 'button';
  if (typeof cmd.respawn !== 'function') deadBtn.style.display = 'none';
  unbinds.push(bindTap(deadBtn, { onTap: () => call('respawn') }));
  let deadShown = false, deadSecs = -1;

  // --- tooltips ---------------------------------------------------------------------
  function hideTip() { if (tooltip) tooltip.hide(); }
  function showSkillTip(s, x, y) {
    if (!tooltip || !s.row) return;
    const rank = player && player.skills ? (player.skills[s.row.id] | 0) : 0;
    tooltip.showSkill(s.row, rank, player, x, y);
  }
  function showBeltTip(s, x, y) {
    if (!tooltip) return;
    const p = s.pid ? items.potions[s.pid] : null;
    if (!p) { tooltip.showText(['Empty belt slot', { text: 'Potions go here from the bag', cls: 'dim' }], x, y); return; }
    tooltip.showText([
      { text: p.name, cls: 'name', colour: potionCss(s.pid) },
      { text: 'Restores ' + p.amount + ' ' + p.kind + ' over ' + p.overSec + ' s', cls: 'dim' },
      { text: s.n + ' left', cls: 'faint' },
    ], x, y);
  }

  // --- per-frame update -------------------------------------------------------------
  let textAt = -1e9;

  function setGlobe(g, v, max) {
    const pct = max > 0 ? Math.max(0, Math.min(100, Math.round(v / max * 100))) : 0;
    if (pct !== g.pct) { g.pct = pct; g.fill.style.height = pct + '%'; }
    const n = v > 0 ? Math.round(v) : 0;
    if (n !== g.shown) { g.shown = n; g.val.textContent = String(n); }
  }

  function updateSkills(p, tick) {
    const slots = p.slots;
    const cds = p.cooldowns;
    for (let i = 0; i < skills.length; i++) {
      const s = skills[i];
      const id = slots ? slots[i] : null;
      if (id !== s.id) {
        s.id = id;
        s.row = skillRow(id);
        s.name.textContent = s.row ? shortName(s.row.name) : '';
      }
      const row = s.row;
      const rank = row && p.skills ? (p.skills[row.id] | 0) : 0;
      const learned = !!row && rank > 0;
      if (learned !== s.learned) { s.learned = learned; s.el.classList.toggle('empty', !learned); }
      let pct = 0, tenths = 0, dim = false, held = false;
      if (learned) {
        const ready = cds ? cds[row.id] : 0;
        if (ready > tick && row.cooldown > 0) {
          const left = (ready - tick) / TICK_HZ;
          pct = Math.min(100, Math.round(left / row.cooldown * 100));
          tenths = Math.ceil(left * 10);
        }
        dim = (p.mp || 0) < skillCost(row, rank);
        held = p.heldSlot === i || (!!p.channel && p.channel.id === row.id);
      }
      if (pct !== s.pct) { s.pct = pct; s.cd.style.setProperty('--cd', pct + '%'); }
      if (tenths !== s.tenths) {
        if ((tenths > 0) !== (s.tenths > 0)) s.el.classList.toggle('cooling', tenths > 0);   // css hides the name under the seconds
        s.tenths = tenths;
        s.cdNum.textContent = tenths <= 0 ? '' : tenths >= 10 ? String(Math.ceil(tenths / 10)) : '0.' + tenths;
      }
      if (dim !== s.dim) { s.dim = dim; s.el.classList.toggle('dim', dim); }
      if (held !== s.held) { s.held = held; s.el.classList.toggle('held', held); }
    }
  }

  function updateBelt(p, tick) {
    const list = p.belt;
    const cd = p.beltCd;
    for (let i = 0; i < belt.length; i++) {
      const s = belt[i];
      const b = list ? list[i] : null;
      const pid = b && b.count > 0 ? b.potionId : null;
      if (pid !== s.pid) {
        s.pid = pid;
        s.pot.style.color = pid ? potionCss(pid) : '';
        s.el.classList.toggle('empty', !pid);
        s.el.classList.toggle('filled', !!pid);
      }
      const n = pid ? b.count : 0;
      if (n !== s.n) { s.n = n; s.count.textContent = n > 0 ? String(n) : ''; }
      const pot = pid ? items.potions[pid] : null;
      const cooling = !!(pot && cd && cd[pot.kind] > tick);
      if (cooling !== s.cd) { s.cd = cooling; s.el.classList.toggle('cd', cooling); }
    }
  }

  function updateText(p, tick) {
    const gold = p.gold | 0;
    if (gold !== shownGold) { shownGold = gold; goldEl.textContent = String(gold); }
    const level = p.level | 0;
    if (level !== shownLevel) { shownLevel = level; xpLvl.textContent = String(level); }
    const need = xpToNext(level);
    const tenths = need > 0 ? Math.max(0, Math.min(1000, Math.floor((p.xp || 0) / need * 1000))) : 0;
    if (tenths !== xpTenths) { xpTenths = tenths; xpFill.style.width = (tenths / 10) + '%'; }
    updateBelt(p, tick);

    const dead = !!p.dead;
    if (dead !== deadShown) { deadShown = dead; deadEl.classList.toggle('show', dead); deadSecs = -1; }
    if (dead) {
      const secs = p.respawnAt != null && p.respawnAt > tick ? Math.ceil((p.respawnAt - tick) / TICK_HZ) : 0;
      if (secs !== deadSecs) {
        deadSecs = secs;
        deadSub.textContent = secs > 0 ? 'You rise again in ' + secs + ' s' : 'Rising…';
      }
    }
  }

  function updateTarget(world) {
    const t = target;
    const live = !!t && (!world || world.ents[t.id] === t);
    if (live !== targetShown) { targetShown = live; targetEl.classList.toggle('show', live); }
    if (!live) return;
    const pct = t.hpMax > 0 ? Math.max(0, Math.min(100, Math.round(t.hp / t.hpMax * 100))) : 0;
    if (pct !== targetPct) { targetPct = pct; targetFill.style.width = pct + '%'; }
  }

  /** Every frame: globes, cooldown sweeps, target hp; text fields at most 10×/s. */
  function update(p, world) {
    if (!p) return;
    player = p;
    const tick = world ? world.tick | 0 : 0;
    setGlobe(life, p.hp, p.hpMax);
    setGlobe(mana, p.mp, p.mpMax);
    const low = life.pct < LOW_LIFE_PCT && life.pct >= 0 && !p.dead;
    if (low !== life.low) { life.low = low; life.el.classList.toggle('low', low); }
    const c = classes.classes[p.cls];
    const label = c ? c.mana.label : 'Mana';
    if (label !== mana.label) { mana.label = label; mana.lbl.textContent = label; }
    updateSkills(p, tick);
    updateTarget(world);
    const now = performance.now();
    if (now - textAt >= TEXT_INTERVAL_MS) { textAt = now; updateText(p, tick); }
  }

  // --- public bits ------------------------------------------------------------------
  function setTarget(ent) {
    if (ent === target) return;
    target = ent || null;
    targetPct = -1;
    if (!target) return;
    targetName.textContent = target.name || target.type || target.id || '';
    targetTag.textContent = target.boss ? 'Boss' : target.champion ? 'Champion' : '';
    targetTag.classList.toggle('boss', !!target.boss);
    targetLvl.textContent = target.level ? 'L' + target.level : '';
  }

  /** Top-centre toast; `kind` is a css class (good bad gold xp levelup) or a rarity name. */
  function toast(text, kind) {
    let t = null, oldest = null;
    for (let i = 0; i < toasts.length; i++) {
      const c = toasts[i];
      if (!c.busy) { t = c; break; }
      if (!oldest || c.at < oldest.at) oldest = c;
    }
    if (!t) t = oldest;
    if (t.timer) { clearTimeout(t.timer); t.timer = 0; }
    t.busy = true;
    t.at = performance.now();
    t.el.textContent = String(text);
    t.el.className = 'hm-toast' + (kind ? ' ' + kind : '');
    t.el.style.color = kind && RARITY[kind] != null ? rarityColour(kind) : '';
    toastsEl.appendChild(t.el);
    t.timer = setTimeout(() => {
      t.el.classList.add('fade');
      t.timer = setTimeout(() => {
        t.timer = 0; t.busy = false;
        if (t.el.parentNode) t.el.parentNode.removeChild(t.el);
      }, TOAST_FADE_MS);
    }, TOAST_MS);
  }

  /** Show/hide the dev line (H). Returns the new state. */
  function toggle(force) {
    devVisible = force == null ? !devVisible : !!force;
    devEl.classList.toggle('hidden', !devVisible);
    return devVisible;
  }

  function setLabelsMode(on) { buttonEls.labels.classList.toggle('on', !!on); }

  /** Highlight the button of the open panel ('inventory' | 'character' | 'skills' | null). */
  function setPanelOpen(name) {
    for (let i = 0; i < BUTTONS.length; i++) {
      const [key, , panel] = BUTTONS[i];
      if (panel) buttonEls[key].classList.toggle('on', !!name && panel === name);
    }
  }

  /** P0-compatible dev fields: { zone, seed, fps, tick, ents, calls }. Untouched DOM when unchanged. */
  function set(fields) {
    if (!fields) return;
    if (fields.zone != null) { const z = String(fields.zone); if (zoneEl.textContent !== z) zoneEl.textContent = z; }
    let changed = false;
    if (fields.seed != null && fields.seed !== dev.seed) { dev.seed = fields.seed; changed = true; }
    if (fields.fps != null) { const v = Math.round(fields.fps); if (v !== dev.fps) { dev.fps = v; changed = true; } }
    if (fields.tick != null && fields.tick !== dev.tick) { dev.tick = fields.tick; changed = true; }
    if (fields.ents != null && fields.ents !== dev.ents) { dev.ents = fields.ents; changed = true; }
    if (fields.calls != null && fields.calls !== dev.calls) { dev.calls = fields.calls; changed = true; }
    if (!changed) return;
    devEl.textContent = (dev.fps < 0 ? '—' : dev.fps) + ' fps · tick ' + (dev.tick < 0 ? '—' : dev.tick)
      + ' · ' + (dev.ents < 0 ? '—' : dev.ents) + ' ents · ' + (dev.calls < 0 ? '—' : dev.calls) + ' draw'
      + (dev.seed != null ? ' · seed ' + dev.seed : '');
  }

  function setTooltip(tip) { tooltip = tip || null; }

  function dispose() {
    for (let i = 0; i < unbinds.length; i++) unbinds[i]();
    unbinds.length = 0;
    for (let i = 0; i < toasts.length; i++) if (toasts[i].timer) clearTimeout(toasts[i].timer);
    if (newTimer) clearTimeout(newTimer);
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  return {
    el, update, toast, setTarget, toggle, setLabelsMode, setPanelOpen, set, setTooltip, dispose,
    get visible() { return devVisible; },
    buttons: buttonEls, skillEls: skills.map((s) => s.el), beltEls: belt.map((s) => s.el),
  };
}
