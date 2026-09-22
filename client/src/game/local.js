// client/src/game/local.js — the offline game: a shared world plus the local player.
// createLocalGame({seed, character, difficulty}) → { world, playerId, update(nowMs) → steps,
//   alpha, prev: Map<id, {x,z,dx,dz}>, events: [], setIntent(intent), pause(ms) }.
// Fixed-step accumulator at TICK_HZ. Before EACH step every entity's x z dx dz is copied
// into `prev` (objects reused, never reallocated per tick), so the renderer can draw
// prev → current at `alpha` (0..1 within the tick). Catch-up is capped at 5 steps per
// frame; leftover time is dropped so a stalled tab never spirals.
// `events` holds every event the steps of the last update() produced (the array is reused;
// consumers read it before the next update). `pause(ms)` is hit-stop: the accumulator
// ignores that much wall time. The intent given to setIntent is copied field by field into
// the one object the world ever sees; one-shots (use / pick / act) are kept until a step has
// consumed them, so a one-shot set on a frame with no sim step is not lost. Acts queue: the
// sim applies one act per distinct seq, so a second act arriving before a tick ran waits in
// a small FIFO and rides the next intent instead of overwriting the first.
// No localStorage yet (P2).
import { createWorld, addPlayer, applyIntent, step, DT } from 'shared/sim/world.js';
import zones from 'shared/data/zones/index.js';

const MAX_STEPS_PER_FRAME = 5;
const MAX_PAUSE_MS = 250;   // a burst of kills never freezes the sim longer than this

export function createLocalGame({ seed, character, difficulty = 'dusk' }) {
  const world = createWorld({ recipes: zones, seed: seed | 0, difficulty });
  const playerId = addPlayer(world, character);
  const stepMs = DT * 1000;
  const prev = new Map();
  const events = [];
  // the world only ever sees this object; the full intent schema from shared/sim/API.md
  const intentOut = { seq: 0, mv: [0, 0], aim: [0, 0], target: null, skill: null, use: null, pick: null, act: null };
  let acc = 0;
  let lastMs = -1;
  let seq = 0;
  let pauseLeft = 0;
  let oneShotPending = false;
  const actQueue = [];                  // acts waiting for their own seq (FIFO)

  /** prev ← current for one entity id, reusing the per-id object (pre-bound for Set.forEach). */
  function snapOne(id) {
    const e = world.ents[id];
    if (!e) return;
    const p = prev.get(id);
    if (p) { p.x = e.x; p.z = e.z; p.dx = e.dx; p.dz = e.dz; }
    else prev.set(id, { x: e.x, z: e.z, dx: e.dx, dz: e.dz });
  }

  /** prev ← current for every entity in a zone that holds a player (the only zones that tick). */
  function snapshot() {
    const players = world.players;
    for (let i = 0; i < players.length; i++) {
      const p = world.ents[players[i]];
      const zone = p ? world.zones[p.zone] : null;
      if (zone && zone.ents) zone.ents.forEach(snapOne);
    }
  }

  function update(nowMs) {
    events.length = 0;
    if (lastMs < 0) { lastMs = nowMs; snapshot(); game.alpha = 0; game.stepsTaken = 0; return 0; }
    let dtMs = nowMs - lastMs;
    lastMs = nowMs;
    if (dtMs < 0) dtMs = 0;
    if (pauseLeft > 0) {                  // hit-stop: wall time spent paused is not accumulated
      const p = dtMs < pauseLeft ? dtMs : pauseLeft;
      pauseLeft -= p;
      dtMs -= p;
    }
    acc += dtMs;
    let steps = 0;
    while (acc >= stepMs && steps < MAX_STEPS_PER_FRAME) {
      snapshot();
      const r = step(world);
      const gone = r.gone;
      for (let i = 0; i < gone.length; i++) prev.delete(gone[i]);
      const ev = r.events;
      for (let i = 0; i < ev.length; i++) events.push(ev[i]);
      acc -= stepMs;
      steps++;
    }
    if (steps > 0 && oneShotPending) {    // consumed by the first step (the sim keys on seq)
      intentOut.use = null; intentOut.pick = null; intentOut.act = null;
      oneShotPending = false;
    }
    if (intentOut.act == null && actQueue.length > 0) {   // next act rides the next seq
      intentOut.act = actQueue.shift();
      oneShotPending = true;
    }
    if (acc > stepMs) acc = stepMs;       // hit the cap: drop the backlog rather than chase it
    game.alpha = acc / stepMs;
    game.stepsTaken = steps;
    return steps;
  }

  /**
   * Copies mv / aim / target / skill from `intent` (the steering module's reused object) and
   * applies it with a fresh seq. One-shots (use / pick / act) are taken when non-null and
   * kept until a step has run, so they survive frames between ticks.
   */
  function setIntent(intent) {
    const it = intent || null;
    const mv = it && it.mv, aim = it && it.aim;
    intentOut.seq = ++seq;
    intentOut.mv[0] = mv ? +mv[0] || 0 : 0;
    intentOut.mv[1] = mv ? +mv[1] || 0 : 0;
    if (aim) { intentOut.aim[0] = +aim[0] || 0; intentOut.aim[1] = +aim[1] || 0; }
    intentOut.target = it && it.target != null ? it.target : null;
    intentOut.skill = it && it.skill != null ? it.skill : null;
    if (it) {
      if (it.use != null) { intentOut.use = it.use; oneShotPending = true; }
      if (it.pick != null) { intentOut.pick = it.pick; oneShotPending = true; }
      if (it.act != null) {
        if (intentOut.act == null) { intentOut.act = it.act; oneShotPending = true; }
        else actQueue.push(it.act);       // an act is still waiting for a tick: keep both, in order
      }
    }
    applyIntent(world, playerId, intentOut);
    return seq;
  }

  /** Hit-stop: ignore `ms` of wall time (the longest pending pause wins, capped). */
  function pause(ms) {
    const m = +ms || 0;
    if (m > pauseLeft) pauseLeft = m > MAX_PAUSE_MS ? MAX_PAUSE_MS : m;
  }

  const game = {
    world, playerId, prev, events, update, setIntent, pause,
    alpha: 0, stepsTaken: 0, stepMs,
    get tick() { return world.tick; },
    get seq() { return seq; },
    get paused() { return pauseLeft > 0; },
    get intent() { return intentOut; },
    get pendingActs() { return actQueue.length + (intentOut.act != null ? 1 : 0); },
  };
  snapshot();
  return game;
}
