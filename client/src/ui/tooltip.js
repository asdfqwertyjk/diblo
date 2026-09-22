// client/src/ui/tooltip.js — item / skill / text tooltips positioned near the pointer and
// clamped to the viewport, plus small colour/glyph helpers the panels and HUD import.
// createTooltip(root) → { showItem(item, compareWith, x, y, player?), showSkill(row, rank,
// player, x, y), showText(lines, x, y), hide(), setPlayer(e), isVisible(), el }.
// Item tooltip: name in its rarity colour, base with tier, damage/armour with a green/red delta
// against `compareWith`, requirement lines red when canEquip (shared/sim/stats.js) says no,
// affix lines blue, sell value. Line nodes are pooled; nothing here runs per frame.
import items from 'shared/data/items.js';
import classes from 'shared/data/classes.js';
import { canEquip } from 'shared/sim/stats.js';
import { sellValue, affixText } from 'shared/sim/itemgen.js';
import { skillCost, skillMult } from 'shared/sim/skills.js';

const RARITY = items.rarity.colours;
const RULES = classes.skillRules;
const MAX_LINES = 40;
const OFFSET = 14;       // px from the pointer
const MARGIN = 6;        // px kept from the viewport edge

/** 0xrrggbb → '#rrggbb'. */
export function hexCss(hex) {
  return '#' + ((hex | 0) & 0xffffff).toString(16).padStart(6, '0');
}

/** Exact rarity colour from shared/data/items.js as a css string ('normal' when unknown). */
export function rarityColour(rarity) {
  const hex = RARITY[rarity];
  return hexCss(hex != null ? hex : RARITY.normal);
}

/** The potion's colour (items.potions[base].colour) as a css string; life red / mana blue fallback. */
export function potionCss(item) {
  if (!item) return hexCss(RARITY.normal);
  const id = typeof item === 'string' ? item : item.base || (item.potion && item.potion.id);
  const p = id ? items.potions[id] : null;
  if (p && p.colour != null) return hexCss(p.colour);
  const kind = item.potion ? item.potion.kind : (item.kind === 'mana' ? 'mana' : 'life');
  return kind === 'mana' ? hexCss(items.potions.manaMinor.colour) : hexCss(items.potions.lifeMinor.colour);
}

const GLYPH_BY_KIND = {
  dagger: '†', sword: '⚔', axe: '⚒', mace: '❂', spear: '↑', bow: '⌒', staff: '⚚', wand: '✧',
  shield: '◈', helm: '∩', chest: '▣', gloves: 'ⓖ', boots: 'ⓑ', belt: '⊟', amulet: '⊚',
  ring: '○', ring1: '○', ring2: '○', potion: 'Ⓟ', gold: '¤',
};

/** 1–2 characters that read as the item on a grid cell or belt slot. */
export function itemShortGlyph(item) {
  if (!item) return '';
  if (item.gold != null && !item.base) return GLYPH_BY_KIND.gold;
  if (item.potion || item.slot === 'potion') return GLYPH_BY_KIND.potion;
  const g = GLYPH_BY_KIND[item.kind] || GLYPH_BY_KIND[item.slot];
  if (g) return g;
  const n = String(item.name || item.base || '?');
  return n.slice(0, 2);
}

// --- content helpers ----------------------------------------------------------------

function avg(dmg) { return (dmg[0] + dmg[1]) / 2; }

function fmtNum(v) {
  return Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1);
}

/** ' (+2.5)' | ' (−1)' | '' with the sign class, as [text, cls]. */
function deltaSpan(d) {
  if (!(Math.abs(d) >= 0.05)) return null;
  const s = (d > 0 ? '+' : '−') + fmtNum(Math.abs(d));
  return [s, d > 0 ? 'd-up' : 'd-down'];
}

/** Sum of affix values per stat for an item (empty for null). */
function affixSums(item, out) {
  for (const k in out) delete out[k];
  const list = item && item.affixes ? item.affixes : null;
  if (!list) return out;
  for (let i = 0; i < list.length; i++) out[list[i].stat] = (out[list[i].stat] || 0) + list[i].value;
  return out;
}

function shapeText(row) {
  const sh = row.shape;
  if (!sh) return '';
  const parts = [];
  if (sh.arc) parts.push(sh.arc + '° arc');
  if (sh.radius) parts.push(sh.radius + ' m radius');
  if (sh.range) parts.push(sh.range + ' m');
  return parts.join(' · ');
}

const KIND_TEXT = { melee: 'Melee', dash: 'Dash', buff: 'Buff', strike: 'Strike', channel: 'Channelled', aoe: 'Ground' };

function manaLabel(player) {
  const c = player && classes.classes[player.cls];
  return c ? c.mana.label.toLowerCase() : 'mana';
}

// --- the tooltip --------------------------------------------------------------------

export function createTooltip(root) {
  const el = document.createElement('div');
  el.className = 'hm-tip';
  root.appendChild(el);

  const pool = [];
  let used = 0;
  let visible = false;
  let player = null;
  const cmpSums = {};
  const itemSums = {};

  function node() {
    let n = pool[used];
    if (!n) {
      if (used >= MAX_LINES) return null;
      n = document.createElement('span');
      pool.push(n);
      el.appendChild(n);
    }
    used++;
    n.className = 'hm-tip-line';
    n.style.color = '';
    n.textContent = '';
    return n;
  }

  /** One plain line. cls is a space-separated class list; colour a css string. */
  function line(text, cls, colour) {
    const n = node();
    if (!n) return null;
    n.textContent = text;
    if (cls) n.className += ' ' + cls;
    if (colour) n.style.color = colour;
    return n;
  }

  /** A line with a coloured delta span appended. */
  function lineDelta(text, delta, cls) {
    const n = line(text, cls);
    if (!n) return;
    const d = deltaSpan(delta);
    if (!d) return;
    const s = document.createElement('span');
    s.className = d[1];
    s.textContent = d[0];
    n.appendChild(s);
  }

  function sep() { line('', 'sep'); }

  function begin() {
    used = 0;
  }

  function finish(x, y) {
    for (let i = used; i < pool.length; i++) {
      if (pool[i].className.indexOf('hidden') < 0) pool[i].className = 'hm-tip-line hidden';
    }
    el.classList.add('show');
    visible = true;
    place(x, y);
  }

  /** Near the pointer, flipped and clamped so it never leaves the viewport. */
  function place(x, y) {
    const vw = window.innerWidth, vh = window.innerHeight;
    el.style.left = '0px'; el.style.top = '0px';
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = x + OFFSET, top = y + OFFSET;
    if (left + w > vw - MARGIN) left = x - OFFSET - w;
    if (left < MARGIN) left = Math.max(MARGIN, Math.min(vw - w - MARGIN, x - w / 2));
    if (top + h > vh - MARGIN) top = y - OFFSET - h;
    if (top < MARGIN) top = Math.max(MARGIN, Math.min(vh - h - MARGIN, y + OFFSET));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  function hide() {
    if (!visible) return;
    visible = false;
    el.classList.remove('show');
  }

  function isVisible() { return visible; }

  /** The player the requirement colouring and skill numbers refer to (showItem's 5th argument overrides). */
  function setPlayer(e) { player = e || null; }

  // --- item ---------------------------------------------------------------------------
  function showItem(item, compareWith, x, y, forPlayer) {
    if (!item) { hide(); return; }
    const p = forPlayer || player;
    begin();
    line(item.name || item.base || 'Item', 'name', rarityColour(item.rarity));

    if (item.potion) {
      const pt = item.potion;
      line('Restores ' + pt.amount + ' ' + pt.kind + ' over ' + pt.overSec + ' s', 'dim');
      if ((item.stack || 1) > 1) line('Stack of ' + item.stack, 'dim');
      line('Sells for ' + sellValue(item), 'faint');
      finish(x, y);
      return;
    }

    const base = items.bases[item.base];
    const tier = items.tiers[item.tier];
    if (base) {
      let b = (tier ? tier.name : '') + base.name;
      if (item.hands === 2) b += ' (two-handed)';
      if (item.rarity && item.rarity !== 'normal') b += ' · ' + item.rarity;
      line(b, 'base');
    }

    const cmp = compareWith && compareWith !== item ? compareWith : null;
    if (item.dmg) {
      const d = cmp && cmp.dmg ? avg(item.dmg) - avg(cmp.dmg) : 0;
      lineDelta('Damage: ' + item.dmg[0] + '-' + item.dmg[1], d);
    }
    if (item.armour != null) {
      const d = cmp && cmp.armour != null ? item.armour - cmp.armour : 0;
      lineDelta('Armour: ' + item.armour, d);
    }
    if (item.block != null) {
      const d = cmp && cmp.block != null ? item.block - cmp.block : 0;
      lineDelta('Block: ' + item.block + '%', d);
    }
    if (item.speed != null) {
      const d = cmp && cmp.speed != null ? item.speed - cmp.speed : 0;
      lineDelta('Speed: ' + item.speed, d);
    }

    // affixes in blue, each with its delta against the same stat on the compared item
    affixSums(cmp, cmpSums);
    affixSums(item, itemSums);
    const affixes = item.affixes || [];
    for (let i = 0; i < affixes.length; i++) {
      const a = affixes[i];
      const d = cmp ? a.value - (cmpSums[a.stat] || 0) : 0;
      lineDelta(affixText(a.stat, a.value), d, 'affix');
    }
    if (cmp) {
      let first = true;
      for (const stat in cmpSums) {
        if (itemSums[stat]) continue;
        if (first) { line('Loses:', 'faint'); first = false; }
        line(affixText(stat, cmpSums[stat]).replace('+', '−'), 'bad');
      }
    }

    // requirements: red when unmet (the rules canEquip applies, line by line) plus its verdict
    const st = p ? (p.stats || (classes.classes[p.cls] && classes.classes[p.cls].stats) || null) : null;
    const lvl = p ? (p.level || 1) : null;
    const reqs = item.reqs || {};
    const ce = p ? canEquip(p, item) : null;
    let shownWhy = false;
    if (item.lvlReq > 1) {
      const bad = lvl != null && lvl < item.lvlReq;
      line('Requires level ' + item.lvlReq, bad ? 'bad' : 'dim');
      shownWhy = shownWhy || bad;
    }
    if (reqs.str > 0) {
      const bad = st != null && st.str < reqs.str;
      line('Requires ' + reqs.str + ' strength', bad ? 'bad' : 'dim');
      shownWhy = shownWhy || bad;
    }
    if (reqs.dex > 0) {
      const bad = st != null && st.dex < reqs.dex;
      line('Requires ' + reqs.dex + ' dexterity', bad ? 'bad' : 'dim');
      shownWhy = shownWhy || bad;
    }
    if (ce && !ce.ok && !shownWhy) line(ce.why, 'bad');

    line('Sells for ' + sellValue(item), 'faint');
    finish(x, y);
  }

  // --- skill --------------------------------------------------------------------------
  function showSkill(row, rank, forPlayer, x, y) {
    if (!row) { hide(); return; }
    const p = forPlayer || player;
    const r = rank | 0;
    const max = RULES.maxRank;
    const evalRank = r > 0 ? r : 1;
    begin();
    const n = line(row.name, 'name gold');
    if (n) {
      const s = document.createElement('span');
      s.className = 'd-same';
      s.textContent = r > 0 ? 'rank ' + r + '/' + max : 'not learned';
      n.appendChild(s);
    }
    const kind = KIND_TEXT[row.kind] || row.kind;
    const shape = shapeText(row);
    line(kind + (shape ? ' · ' + shape : ''), 'base');
    if (row.desc) line(row.desc, 'desc');

    const label = manaLabel(p);
    if (row.kind === 'channel') {
      const perSec = row.tickEvery > 0 ? skillCost(row, evalRank) / row.tickEvery : (row.costPerSec || 0);
      line('Cost: ' + fmtNum(perSec) + ' ' + label + '/s', 'dim');
    } else {
      const cost = skillCost(row, evalRank);
      line('Cost: ' + (cost > 0 ? fmtNum(cost) + ' ' + label : 'none'), 'dim');
    }
    if (row.cooldown > 0) line('Cooldown: ' + row.cooldown + ' s', 'dim');

    if (row.weaponPct != null) {
      const cur = Math.round(skillMult(row, evalRank, p || {}) * 100);
      const per = row.kind === 'channel' && row.tickEvery ? ' per ' + row.tickEvery + ' s' : '';
      line((r > 0 ? 'Damage: ' : 'Rank 1: ') + cur + '% weapon' + per, r > 0 ? '' : 'dim');
      if (r > 0 && r < max) {
        const next = Math.round(skillMult(row, r + 1, p || {}) * 100);
        line('Next rank: ' + next + '% weapon', 'faint');
      }
    }
    if (row.effect && row.effect.dmgPct != null) {
      const mult = 1 + RULES.effectPerRank * (evalRank - 1);
      line('+' + Math.round(row.effect.dmgPct * mult) + '% damage for ' + row.duration + ' s', r > 0 ? '' : 'dim');
      if (r > 0 && r < max) line('Next rank: +' + Math.round(row.effect.dmgPct * (1 + RULES.effectPerRank * r)) + '%', 'faint');
    }
    if (row.stun > 0) line('Stuns for ' + row.stun + ' s', 'dim');
    if (row.knockback > 0) line('Knocks back ' + row.knockback + ' m', 'dim');
    if (row.moveMult != null) line('Move at ' + Math.round(row.moveMult * 100) + '% while active', 'dim');

    const syn = row.synergies || [];
    if (syn.length) {
      sep();
      for (let i = 0; i < syn.length; i++) {
        const other = classes.skills[syn[i]];
        const pts = p && p.skills ? (p.skills[syn[i]] | 0) : 0;
        line((other ? other.name : syn[i]) + ': +' + Math.round(RULES.synergyPerPoint * 100) + '% per point (' + pts + ')', pts > 0 ? 'good' : 'faint');
      }
    }

    const unlock = RULES.rowUnlockLevels[(row.row | 0) - 1];
    if (unlock != null && r === 0) {
      const locked = p && (p.level || 1) < unlock;
      line('Unlocks at level ' + unlock, locked ? 'bad' : 'faint');
    }
    finish(x, y);
  }

  // --- text ---------------------------------------------------------------------------
  /** lines: string | {text, cls?, colour?} | array of those. */
  function showText(lines, x, y) {
    begin();
    const list = Array.isArray(lines) ? lines : [lines];
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      if (l == null) continue;
      if (typeof l === 'string') line(l, i === 0 ? 'name' : '');
      else line(l.text != null ? String(l.text) : '', l.cls || (i === 0 ? 'name' : ''), l.colour || null);
    }
    finish(x, y);
  }

  function dispose() {
    hide();
    if (el.parentNode) el.parentNode.removeChild(el);
    pool.length = 0;
  }

  return { el, showItem, showSkill, showText, hide, setPlayer, isVisible, place, dispose };
}
