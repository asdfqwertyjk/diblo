// client/src/game/steer.js — pointer-first steering: click-to-move over A*, click-to-attack,
// click-to-pick, held skills, and the one intent object the local game consumes.
// createSteering(game, camera, input) → { update(dt, groundY) → intent, hover, target,
//   moveTarget, castSlot(i), queue(oneShot), cancel(), pickItem(id), dispose() }.
//
// Each frame: aim = the pointer ray on the plane at the player's ground height; hover = the
// nearest monster or ground item within 24 px (40 px on touch). A primary press (LMB or a
// finger) over a monster targets it: the player paths into the slot-0 skill's reach and holds
// skill 0 while the button is held, or for a short burst after a tap. Over an item it picks
// when in range, else walks there and picks on arrival. Over terrain it walks there, and
// while held re-targets to the live aim every 120 ms. RMB holds skill 1 at the aim; keys 1–4
// hold slots 2..5; HUD buttons call castSlot(i) for a ~3-tick burst. A burst (RMB tap, HUD
// button, monster tap) does not start its 3 ticks while the player is inside a swing lock or
// a dash — the sim would reject every tick of it — but waits, up to BURST_WAIT_SEC, for the
// lock to end, so a tap during a held LMB attack lands after the current swing instead of
// vanishing. WASD overrides steering for that frame and clears the move goal.
//
// Routing uses shared/sim/path.js on a nav mask built ONCE per zone (buildNavMask with the
// player's radius, so routes bend around props): nearestWalkable on the goal first, findPath
// then simplifyPath from the player's position; the last cell-centre waypoint becomes the
// exact goal point when lineOfWalk holds. Waypoints pop within 0.3 m or when their distance
// stops shrinking; re-path when the goal moved > 1 m or nothing progressed for 0.5 s; an
// unreachable goal cell is remembered so it is not searched again every frame. mv points at
// the next waypoint with magnitude 1 (less on the last step so arrival is exact).
// No allocation per frame beyond the path arrays on a re-path; the intent is one reused
// object with seq incremented per update. One-shots (use / pick / act) queued via queue()
// ride on the next intent, then clear (local.js keeps them until a tick consumed them);
// acts queue in order, one per intent, so two acts in one frame are both delivered.
import classes from 'shared/data/classes.js';
import { DT } from 'shared/sim/world.js';
import { dist2 } from 'shared/sim/dmath.js';
import { findPath, nearestWalkable, simplifyPath, lineOfWalk, buildNavMask } from 'shared/sim/path.js';
import { pickEntity } from './pick.js';

const PICK_PX_MOUSE = 24;
const PICK_PX_TOUCH = 40;
const WAYPOINT_REACH = 0.3;      // metres: a waypoint pops inside this
const OVERSHOOT_MAX = 1.0;       // metres: the last waypoint counts as reached when passed within this
const REPATH_GOAL_MOVE = 1.0;    // metres: a goal that moved more than this re-paths
const NO_PROGRESS_SEC = 0.5;     // re-path when the distance to the goal has not shrunk for this long
const HOLD_RETARGET_SEC = 0.12;  // LMB held on terrain: re-target to the live aim this often
const BURST_SEC = 0.15;          // ~3 ticks: a tap or a HUD button holds the skill this long
const BURST_WAIT_SEC = 1.0;      // a burst waits at most this long for a swing lock / dash to end
const DEFAULT_RANGE = 2.2;       // metres: reach when slot 0 has no shape
const RANGE_MARGIN = 0.15;       // stop this much inside the reach so the sim's arc test passes
const PICKUP_MARGIN = 0.3;
const NEAREST_RINGS = 6;
const MAX_EXPAND = 4000;

const GOAL_NONE = 0, GOAL_TERRAIN = 1, GOAL_MONSTER = 2, GOAL_ITEM = 3;
const RESPAWN_ACT = Object.freeze({ op: 'respawn' });
const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];   // → slots 2..5

export function createSteering(game, camera, input) {
  const world = game.world;
  const playerId = game.playerId;
  const pointer = input.pointer;
  const keys = input.keys;
  const pickR2 = (classes.pickupRange - PICKUP_MARGIN) * (classes.pickupRange - PICKUP_MARGIN);

  const intent = { seq: 0, mv: [0, 0], aim: [0, 0], target: null, skill: null, use: null, pick: null, act: null };
  const oneShot = { use: null, pick: null };
  const actQueue = [];             // acts in order; finish() attaches one per intent
  const from = [0, 0];             // scratch for simplifyPath
  const moveGoal = [0, 0];         // the exposed moveTarget array, reused

  let hover = null, target = null, pickTarget = null, moveTarget = null;
  // nav
  let navZoneId = null, layout = null, navMask = null;
  let path = null, wpi = 0;
  let goalX = 0, goalZ = 0, goalKind = GOAL_NONE;
  let lastWpDist = Infinity, bestGoalDist = Infinity, progressAt = 0;
  let unreachableCell = -1;
  // press / hold state
  let pressEdge = 0;               // button bits (1 LMB, 4 RMB) pressed since the last update
  let holdRetargetAt = 0;
  let tapAttack = false, tapUntil = 0, tapWaitUntil = 0;
  let burstSlot = -1, burstUntil = 0, burstWaitUntil = 0;
  let inRange = false;
  let locked = false;              // this frame: the sim would reject a fresh skill (swing lock / dash)
  let t = 0;                       // seconds, from the dt fed to update()

  const unsubDown = input.onPointerDown((button) => { pressEdge |= 1 << button; });

  // --- helpers ----------------------------------------------------------------------
  function cellOf(x, z) { return layout ? Math.floor(z) * layout.size + Math.floor(x) : -1; }

  function clearPath() {
    path = null; wpi = 0; goalKind = GOAL_NONE; moveTarget = null;
    lastWpDist = Infinity; bestGoalDist = Infinity;
  }

  function clearAll() {
    clearPath();
    target = null; pickTarget = null;
    tapAttack = false; tapUntil = 0; tapWaitUntil = 0;
    burstSlot = -1; burstUntil = 0; burstWaitUntil = 0;
    unreachableCell = -1;
  }

  /** Arm a ~3-tick burst of `slot`; while locked it waits (≤ BURST_WAIT_SEC) before counting. */
  function startBurst(slot) {
    burstSlot = slot; burstUntil = t + BURST_SEC; burstWaitUntil = t + BURST_WAIT_SEC;
  }

  function ensureNav(p) {
    if (p.zone === navZoneId && navMask) return;
    const zone = world.zones[p.zone];
    navZoneId = p.zone;
    layout = zone ? zone.layout : null;
    navMask = layout ? buildNavMask(layout, p.r || 0) : null;   // once per zone
    clearAll();
  }

  /** Reach of the slot-0 skill: shape.range, else hitRange, radius for a channel, else 2.2. */
  function slotRange(p) {
    const id = p.slots ? p.slots[0] : null;
    const row = id ? classes.skills[id] : null;
    const sh = row && row.shape;
    if (!sh) return DEFAULT_RANGE;
    if (row.kind === 'channel') return sh.radius != null ? sh.radius : DEFAULT_RANGE;
    if (sh.range != null) return sh.range;
    if (sh.hitRange != null) return sh.hitRange;
    if (sh.radius != null) return sh.radius;
    return DEFAULT_RANGE;
  }

  function withinRange(p, m) {
    const r = slotRange(p) + (m.r || 0) - RANGE_MARGIN;
    return dist2(p.x, p.z, m.x, m.z) <= r * r;
  }

  /** The last waypoint becomes the exact goal point when the walk from the one before is clear. */
  function snapEnd(p, pth, wx, wz) {
    const n = pth.length;
    const px = n >= 4 ? pth[n - 4] : p.x, pz = n >= 4 ? pth[n - 3] : p.z;
    if (lineOfWalk(layout, px, pz, wx, wz, navMask)) { pth[n - 2] = wx; pth[n - 1] = wz; }
  }

  /** A goal within 1 m of the current one: just move the end of the live path. */
  function retargetEnd(p, gx, gz) {
    const w = nearestWalkable(layout, gx, gz, 2, navMask);
    if (!w) return;
    const n = path.length;
    const px = n >= 4 ? path[n - 4] : p.x, pz = n >= 4 ? path[n - 3] : p.z;
    if (!lineOfWalk(layout, px, pz, w[0], w[1], navMask)) return;
    path[n - 2] = w[0]; path[n - 1] = w[1];
    goalX = gx; goalZ = gz; moveGoal[0] = gx; moveGoal[1] = gz;
    if (wpi >= n) wpi = n - 2;
    bestGoalDist = Infinity; progressAt = t;
  }

  /**
   * Route the player to (gx, gz). → true when a path (or a straight walk) exists. A goal the
   * mask cannot reach leaves path = null: terrain goals are dropped, monster/item goals fall
   * back to a direct walk (the sim slides along colliders) until the watchdog gives up.
   */
  function setGoal(p, gx, gz, kind, force) {
    if (!layout) return false;
    if (!force && path && goalKind === kind && dist2(goalX, goalZ, gx, gz) <= REPATH_GOAL_MOVE * REPATH_GOAL_MOVE) {
      retargetEnd(p, gx, gz);
      return true;
    }
    goalX = gx; goalZ = gz; goalKind = kind;
    moveGoal[0] = gx; moveGoal[1] = gz; moveTarget = moveGoal;
    path = null; wpi = 0; lastWpDist = Infinity; bestGoalDist = Infinity; progressAt = t;
    const w = nearestWalkable(layout, gx, gz, NEAREST_RINGS, navMask);
    if (!w) { if (kind === GOAL_TERRAIN) clearPath(); return false; }
    const wx = w[0], wz = w[1];
    const cell = cellOf(wx, wz);
    if (cell === unreachableCell && !force) { if (kind === GOAL_TERRAIN) clearPath(); return false; }
    let pth;
    if (lineOfWalk(layout, p.x, p.z, wx, wz, navMask)) {
      pth = [wx, wz];
    } else {
      const raw = findPath(layout, p.x, p.z, wx, wz, MAX_EXPAND, navMask);
      if (!raw) { unreachableCell = cell; if (kind === GOAL_TERRAIN) clearPath(); return false; }
      if (raw.length === 0) pth = [wx, wz];
      else { from[0] = p.x; from[1] = p.z; pth = simplifyPath(layout, raw, from, navMask); }
      snapEnd(p, pth, wx, wz);
    }
    path = pth;
    unreachableCell = -1;
    return true;
  }

  function arrive() { clearPath(); }

  /** mv toward (wx, wz), magnitude 1, or less on the last step so the sim lands exactly. */
  function moveToward(p, wx, wz, d) {
    if (d <= 1e-6) return;
    const stepLen = (p.speed || classes.classes[p.cls].runSpeed || 6) * DT;
    const k = d < stepLen ? d / stepLen : 1;
    intent.mv[0] = ((wx - p.x) / d) * k;
    intent.mv[1] = ((wz - p.z) / d) * k;
  }

  /** True when the distance to the goal shrank recently; re-paths (or gives up) otherwise. */
  function watchdog(p) {
    const gd = dist2(p.x, p.z, goalX, goalZ);
    if (gd < bestGoalDist - 0.01) { bestGoalDist = gd; progressAt = t; return true; }
    if (t - progressAt <= NO_PROGRESS_SEC) return true;
    progressAt = t; bestGoalDist = Infinity;
    if (path) { setGoal(p, goalX, goalZ, goalKind, true); return true; }
    arrive();                                       // a direct walk that goes nowhere: stop
    return false;
  }

  /** Straight at the goal (no path): monsters and items standing where the mask is clear. */
  function direct(p) {
    const d = Math.sqrt(dist2(p.x, p.z, goalX, goalZ));
    if (d <= WAYPOINT_REACH) { arrive(); return; }
    if (!watchdog(p)) return;
    moveToward(p, goalX, goalZ, d);
  }

  function follow(p) {
    if (!path) { direct(p); return; }
    const n = path.length;
    let wx = path[wpi], wz = path[wpi + 1];
    let d = Math.sqrt(dist2(p.x, p.z, wx, wz));
    const last = wpi + 2 >= n;
    const stalled = d > lastWpDist + 1e-4;          // passed it: the distance grows again
    if (d <= WAYPOINT_REACH || (stalled && (!last || d < OVERSHOOT_MAX))) {
      wpi += 2; lastWpDist = Infinity;
      if (wpi >= n) { arrive(); return; }
      wx = path[wpi]; wz = path[wpi + 1];
      d = Math.sqrt(dist2(p.x, p.z, wx, wz));
    }
    lastWpDist = d;
    if (!watchdog(p)) return;
    if (!path) { direct(p); return; }              // the watchdog re-pathed to nothing
    if (wpi >= path.length) { arrive(); return; }
    moveToward(p, path[wpi], path[wpi + 1], Math.sqrt(dist2(p.x, p.z, path[wpi], path[wpi + 1])));
  }

  // --- presses ----------------------------------------------------------------------
  function primaryPress(p, a) {
    const e = hover ? world.ents[hover] : null;
    if (e && e.kind === 'monster' && !e.dead && e.hp > 0) {
      target = hover; tapAttack = true; tapUntil = 0; tapWaitUntil = t + BURST_WAIT_SEC; pickTarget = null;
      if (goalKind !== GOAL_MONSTER) clearPath();
    } else if (e && e.kind === 'item') {
      pickItem(hover);
    } else if (a) {
      target = null; pickTarget = null; tapAttack = false; tapUntil = 0;
      setGoal(p, a[0], a[1], GOAL_TERRAIN, false);
      holdRetargetAt = t + HOLD_RETARGET_SEC;
    }
  }

  /** Pick ground item `id` now when in range, else walk to it and pick on arrival. → accepted */
  function pickItem(id) {
    const p = world.ents[playerId], g = world.ents[id];
    if (!p || !g || g.kind !== 'item' || p.dead) return false;
    target = null; tapAttack = false; tapUntil = 0;
    if (dist2(p.x, p.z, g.x, g.z) <= pickR2) { oneShot.pick = id; pickTarget = null; clearPath(); }
    else { pickTarget = id; setGoal(p, g.x, g.z, GOAL_ITEM, false); }
    return true;
  }

  function validateTargets(p) {
    if (target) {
      const m = world.ents[target];
      if (!m || m.kind !== 'monster' || m.dead || !(m.hp > 0) || m.zone !== p.zone) {
        target = null; tapAttack = false; tapUntil = 0;
        if (goalKind === GOAL_MONSTER) clearPath();
      }
    }
    if (pickTarget) {
      const g = world.ents[pickTarget];
      if (!g || g.zone !== p.zone) { pickTarget = null; if (goalKind === GOAL_ITEM) clearPath(); }
    }
  }

  // --- per frame --------------------------------------------------------------------
  function steerFrame(p, lmb) {
    if (target && (lmb || tapAttack)) {
      const m = world.ents[target];
      if (withinRange(p, m)) { inRange = true; if (goalKind === GOAL_MONSTER) clearPath(); return; }
      if (goalKind !== GOAL_MONSTER || dist2(goalX, goalZ, m.x, m.z) > REPATH_GOAL_MOVE * REPATH_GOAL_MOVE) {
        setGoal(p, m.x, m.z, GOAL_MONSTER, false);
      }
      follow(p);
      return;
    }
    if (pickTarget) {
      const g = world.ents[pickTarget];
      if (dist2(p.x, p.z, g.x, g.z) <= pickR2) { oneShot.pick = pickTarget; pickTarget = null; clearPath(); return; }
      if (goalKind !== GOAL_ITEM) setGoal(p, g.x, g.z, GOAL_ITEM, false);
      follow(p);
      return;
    }
    if (goalKind === GOAL_TERRAIN) follow(p);
  }

  function chooseSkill(lmb, rmb) {
    // a burst inside a swing lock / dash keeps its 3 ticks ahead of it until the lock ends
    if (burstSlot >= 0 && locked && t < burstWaitUntil) burstUntil = t + BURST_SEC;
    let slot = null;
    if (keys.has(SLOT_KEYS[0])) slot = 2;
    else if (keys.has(SLOT_KEYS[1])) slot = 3;
    else if (keys.has(SLOT_KEYS[2])) slot = 4;
    else if (keys.has(SLOT_KEYS[3])) slot = 5;
    else if (burstSlot > 0 && t < burstUntil) slot = burstSlot;
    else if (rmb) slot = 1;
    else if (target && inRange) {
      if (lmb) slot = 0;
      else if (tapAttack) {
        if (tapUntil === 0) {
          if (locked && t < tapWaitUntil) slot = 0;     // hold the slot; the countdown starts unlocked
          else tapUntil = t + BURST_SEC;
        }
        if (tapUntil !== 0) {
          if (t < tapUntil) slot = 0;
          else { tapAttack = false; tapUntil = 0; }
        }
      }
    } else if (!target && burstSlot === 0 && t < burstUntil) slot = 0;   // HUD LMB button: swing at the aim
    if (burstSlot >= 0 && t >= burstUntil) burstSlot = -1;
    intent.skill = slot;
  }

  function finish(p) {
    intent.target = p ? target : null;
    intent.use = oneShot.use; intent.pick = oneShot.pick;
    intent.act = actQueue.length > 0 ? actQueue.shift() : null;
    oneShot.use = null; oneShot.pick = null;
    intent.seq++;
    return intent;
  }

  /**
   * @param dt seconds since the last frame
   * @param groundY(x, z) rendered surface height (the aim plane sits at the player's)
   * @returns the reused intent object
   */
  function update(dt, groundY) {
    t += dt > 0 ? dt : 0;
    intent.skill = null;
    intent.mv[0] = 0; intent.mv[1] = 0;
    inRange = false;
    const p = world.ents[playerId];
    if (!p) { pressEdge = 0; hover = null; return finish(null); }
    ensureNav(p);
    const zone = world.zones[p.zone];
    const a = camera.screenToGround(pointer.ndcX, pointer.ndcY, groundY(p.x, p.z));
    if (a) { intent.aim[0] = a[0]; intent.aim[1] = a[1]; }
    hover = pickEntity(world, camera.camera, pointer.ndcX, pointer.ndcY,
      pointer.touch ? PICK_PX_TOUCH : PICK_PX_MOUSE,
      window.innerWidth || 1, window.innerHeight || 1, groundY, zone ? zone.ents : null);
    const lmb = pointer.down && (pointer.buttons & 1) !== 0;
    const rmb = pointer.down && (pointer.buttons & 2) !== 0;
    locked = p.lockUntil > world.tick || !!p.dash;

    if (p.dead) {
      if (pressEdge & 1 && actQueue.length === 0) actQueue.push(RESPAWN_ACT);   // a tap while dead: up at once
      pressEdge = 0;
      clearAll();
      return finish(p);
    }

    if (pressEdge & 1) primaryPress(p, a);
    if (pressEdge & 4) startBurst(1);                 // a quick RMB tap still casts
    pressEdge = 0;
    validateTargets(p);

    // LMB held with nothing to attack or pick: keep walking toward the live aim, and a live
    // monster swept under the pointer becomes the target (drag-to-attack, as a press would)
    if (lmb && !target && !pickTarget && t >= holdRetargetAt) {
      const h = hover ? world.ents[hover] : null;
      if (h && h.kind === 'monster' && !h.dead && h.hp > 0) primaryPress(p, a);
      else if (a) { setGoal(p, a[0], a[1], GOAL_TERRAIN, false); holdRetargetAt = t + HOLD_RETARGET_SEC; }
    }

    const kx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const kz = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    if (kx !== 0 || kz !== 0) {
      intent.mv[0] = kx; intent.mv[1] = kz;
      clearPath(); pickTarget = null; tapAttack = false; tapUntil = 0;
      if (target && lmb) inRange = withinRange(p, world.ents[target]);
    } else {
      steerFrame(p, lmb);
    }
    chooseSkill(lmb, rmb);
    return finish(p);
  }

  // --- commands ---------------------------------------------------------------------
  /** HUD skill button: slot 0 walks into range of the target (or swings at the aim), others burst ~3 ticks. */
  function castSlot(i) {
    const slot = i | 0;
    if (slot < 0 || slot >= classes.skillRules.slots.length) return;
    if (slot === 0 && target) { tapAttack = true; tapUntil = 0; tapWaitUntil = t + BURST_WAIT_SEC; return; }
    startBurst(slot);
  }

  /** queue({use: beltSlot} | {pick: groundId} | {act: {op, …}}): rides on the next intent (acts in order). */
  function queue(o) {
    if (!o) return;
    if (o.use != null) oneShot.use = o.use;
    if (o.pick != null) oneShot.pick = o.pick;
    if (o.act != null) actQueue.push(o.act);
  }

  function cancel() { clearAll(); }

  function dispose() { unsubDown(); clearAll(); }

  return {
    update, castSlot, queue, cancel, pickItem, dispose,
    get hover() { return hover; },
    get target() { return target; },
    get moveTarget() { return moveTarget; },
    get pickTarget() { return pickTarget; },
    get inRange() { return inRange; },
    get intent() { return intent; },
    get path() { return path; },
    get navMask() { return navMask; },
    get burstSlot() { return burstSlot; },
    get pendingActs() { return actQueue.length; },
  };
}
