// shared/sim/tests/bot.js — a headless bot that plays the moor through the public world API
// only (createWorld / addPlayer / applyIntent / step). play.test.js asserts on its run; the
// `trace` option lets a debug script watch it tick by tick. Not a test file (no *.test.js).
import recipes from '../../data/zones/index.js';
import classes from '../../data/classes.js';
import items from '../../data/items.js';
import { createWorld, addPlayer, applyIntent, step } from '../world.js';
import { newCharacterDoc } from '../player.js';
import { canEquip, equipSlotOf } from '../stats.js';
import { dist2, dsqrt } from '../dmath.js';

const ATTACK_AT = 2;          // hold cleave when the target is within this many metres (+ its radius)
const STUCK_TICKS = 40;       // no progress toward the goal for this long → pick another
const AVOID_TICKS = 1200;     // how long a stuck goal (monster or loot) is ignored
const PROGRESS = 0.25;        // metres closer that count as progress
const LOOT_WALK = 6;          // walk to gear lying within this range when no monster is close
const POTION_AT = 0.4;        // drink a life potion below this fraction of hpMax
const RETREAT_AT = 0.35;      // no potion and hp below this → back off and regenerate
const RETREAT_UNTIL = 0.9;    // …until hp is back above this
const SAFE_DIST = 14;         // while retreating, keep every monster farther than this (sight is 12)

function nearestMonster(w, zone, p, avoid) {
  let best = null, bd = Infinity;
  for (const id of zone.ents) {
    const m = w.ents[id];
    if (!m || m.kind !== 'monster' || m.dead || !(m.hp > 0)) continue;
    if (avoid[id] > w.tick) continue;
    const d2 = dist2(p.x, p.z, m.x, m.z);
    if (d2 < bd) { bd = d2; best = m; }
  }
  return best;
}

function nearestGear(w, zone, p, range, avoid) {
  let best = null, bd = range * range;
  for (const id of zone.ents) {
    const g = w.ents[id];
    if (!g || g.kind !== 'item' || !g.item || avoid[id] > w.tick) continue;
    const d2 = dist2(p.x, p.z, g.x, g.z);
    if (d2 <= bd) { bd = d2; best = g; }
  }
  return best;
}

function lifeSlot(p) {
  for (let i = 0; i < p.belt.length; i++) {
    const b = p.belt[i];
    if (b && b.count > 0 && items.potions[b.potionId] && items.potions[b.potionId].kind === 'life') return i;
  }
  return -1;
}

/** Score an item for the bot: weapon max damage, else armour. */
function worth(item) {
  if (!item) return 0;
  return item.dmg ? item.dmg[1] : item.armour || 0;
}

/** iid of the first bag item canEquip accepts that beats what is worn in its slot, or null. */
function bestUpgrade(p) {
  for (const row of p.inventory.items) {
    const it = row.item;
    const slot = equipSlotOf(it);
    if (!slot || !canEquip(p, it).ok) continue;
    const cur = slot === 'weapon' ? (p.equipment.weapon ? worth(p.equipment.weapon) : classes.unarmed.dmg[1]) : worth(p.equipment[slot]);
    if (worth(it) > cur) return it.iid;
  }
  return null;
}

/**
 * Play `ticks` ticks on `seed` with a level-1 warrior. Each tick: target the nearest live
 * monster, walk straight at it (a target that makes no progress for STUCK_TICKS is avoided
 * for a while), hold cleave within ATTACK_AT m, drink a life potion under POTION_AT, pick up
 * gear within pickupRange (walking to gear within LOOT_WALK when no monster is near), equip
 * whatever canEquip accepts that scores higher. @returns the tally plus world and player.
 */
export function playBot(seed, ticks, trace = null) {
  const w = createWorld({ recipes, seed });
  // the character creation hands out: the class weapon equipped and the starting belt
  const pid = addPlayer(w, newCharacterDoc('Bot', 'warrior', seed));
  const p = w.ents[pid];
  const s = { kills: 0, deaths: 0, picked: 0, byRarity: {}, potions: 0, magicDrops: 0, gold: 0, levelups: 0, hits: 0, blocks: 0 };
  const avoid = {};
  let target = null, goal = null, bestD = Infinity, bestAt = 0, retreating = false;
  const t0 = performance.now();
  for (let t = 1; t <= ticks; t++) {
    const zone = w.zones[p.zone];
    const it = { seq: t, mv: [0, 0], aim: null, target: null, skill: null, use: null, pick: null, act: null };
    let walking = false;
    if (!p.dead) {
      let m = target ? w.ents[target] : null;
      if (!m || m.dead || !(m.hp > 0) || m.zone !== p.zone) { target = null; m = null; }
      if (!m) { m = nearestMonster(w, zone, p, avoid); target = m ? m.id : null; }
      const md = m ? dsqrt(dist2(p.x, p.z, m.x, m.z)) : Infinity;
      const loot = nearestGear(w, zone, p, LOOT_WALK, avoid);
      if (loot && dist2(p.x, p.z, loot.x, loot.z) <= classes.pickupRange * classes.pickupRange) it.pick = loot.id;
      if (retreating ? p.hp >= RETREAT_UNTIL * p.hpMax : p.hp < RETREAT_AT * p.hpMax && lifeSlot(p) < 0) retreating = !retreating;
      if (retreating) {
        // back away from the closest monster until everything is out of sight, then stand and regen
        const near = nearestMonster(w, zone, p, {});
        if (near) {
          const d = dsqrt(dist2(p.x, p.z, near.x, near.z)) || 1;
          if (d < SAFE_DIST) it.mv = [(p.x - near.x) / d, (p.z - near.z) / d];
        }
      } else if (m && md <= ATTACK_AT + m.r) {
        it.target = m.id; it.aim = [m.x, m.z]; it.skill = 0;
      } else if (loot && md > 4 && !it.pick) {
        const d = dsqrt(dist2(p.x, p.z, loot.x, loot.z)) || 1;
        it.mv = [(loot.x - p.x) / d, (loot.z - p.z) / d]; walking = loot.id;
      } else if (m) {
        it.target = m.id; it.aim = [m.x, m.z];
        it.mv = [(m.x - p.x) / md, (m.z - p.z) / md]; walking = m.id;
      }
      if (p.hp < POTION_AT * p.hpMax) {
        const slot = lifeSlot(p);
        if (slot >= 0 && !(p.beltCd.life > w.tick)) it.use = slot;
      }
      const up = bestUpgrade(p);
      if (up) it.act = { op: 'equip', iid: up };
      else if (p.statPoints > 0) it.act = { op: 'stat', stat: 'vit' };
      else if (p.skillPoints > 0) it.act = { op: 'skill', id: 'cleave' };
    }
    applyIntent(w, pid, it);
    const r = step(w);
    // stuck = walking toward a goal without getting PROGRESS metres closer for STUCK_TICKS
    if (walking) {
      const g = w.ents[walking];
      const d = g ? dsqrt(dist2(p.x, p.z, g.x, g.z)) : 0;
      if (walking !== goal) { goal = walking; bestD = d; bestAt = w.tick; }
      else if (d < bestD - PROGRESS) { bestD = d; bestAt = w.tick; }
      else if (w.tick - bestAt >= STUCK_TICKS) { avoid[goal] = w.tick + AVOID_TICKS; if (goal === target) target = null; goal = null; }
    } else goal = null;
    for (const ev of r.events) {
      switch (ev.k) {
        case 'kill': if (ev.by === pid) s.kills++; break;
        case 'death': if (ev.id === pid) s.deaths++; break;
        case 'pickup': if (ev.pid === pid) { s.picked++; s.byRarity[ev.rarity] = (s.byRarity[ev.rarity] || 0) + 1; } break;
        case 'gold': if (ev.pid === pid) s.gold += ev.amount; break;
        case 'potion': if (ev.pid === pid) s.potions++; break;
        case 'drop': if (ev.rarity === 'magic') s.magicDrops++; break;
        case 'levelup': if (ev.pid === pid) s.levelups++; break;
        case 'hit': if (ev.src === pid) s.hits++; break;
        case 'block': s.blocks++; break;
      }
    }
    if (trace) trace(w, p, it, t, target, goal ? w.tick - bestAt : 0, r, retreating);
  }
  s.ms = performance.now() - t0;
  s.msPerTick = s.ms / ticks;
  s.level = p.level;
  s.goldHeld = p.gold;
  s.player = p;
  s.world = w;
  return s;
}

export const summaryLine = (s) => `play: kills=${s.kills} deaths=${s.deaths} level=${s.level} gold=${s.goldHeld} `
  + `items=${JSON.stringify(s.byRarity)} potions=${s.potions} avg=${s.msPerTick.toFixed(3)}ms/tick (${(s.ms / 1000).toFixed(2)}s)`;
