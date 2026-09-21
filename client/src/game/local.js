// client/src/game/local.js — the offline game: a shared world plus the local player.
// createLocalGame({seed, character, difficulty}) → { world, playerId, update(nowMs) → steps,
//   alpha, prev: Map<id, {x,z,dx,dz}>, setIntent(intent) }.
// Fixed-step accumulator at TICK_HZ. Before EACH step every entity's x z dx dz is copied
// into `prev` (objects reused, never reallocated per tick), so the renderer can draw
// prev → current at `alpha` (0..1 within the tick). Catch-up is capped at 5 steps per
// frame; leftover time is dropped so a stalled tab never spirals. No localStorage yet (P2).
import { createWorld, addPlayer, applyIntent, step, DT } from 'shared/sim/world.js';
import zones from 'shared/data/zones/index.js';

const MAX_STEPS_PER_FRAME = 5;

export function createLocalGame({ seed, character, difficulty = 'dusk' }) {
  const world = createWorld({ recipes: zones, seed: seed | 0, difficulty });
  const playerId = addPlayer(world, character);
  const stepMs = DT * 1000;
  const prev = new Map();
  const intentOut = { seq: 0, mv: [0, 0], aim: [0, 0] }; // the world only ever sees this object
  let acc = 0;
  let lastMs = -1;
  let seq = 0;

  /** prev ← current for every entity, reusing the per-id objects. */
  function snapshot() {
    const ents = world.ents;
    for (const id in ents) {
      const e = ents[id];
      const p = prev.get(id);
      if (p) { p.x = e.x; p.z = e.z; p.dx = e.dx; p.dz = e.dz; }
      else prev.set(id, { x: e.x, z: e.z, dx: e.dx, dz: e.dz });
    }
  }

  function update(nowMs) {
    if (lastMs < 0) { lastMs = nowMs; snapshot(); game.alpha = 0; return 0; }
    acc += nowMs - lastMs;
    lastMs = nowMs;
    let steps = 0;
    while (acc >= stepMs && steps < MAX_STEPS_PER_FRAME) {
      snapshot();
      const r = step(world);
      const gone = r.gone;
      for (let i = 0; i < gone.length; i++) prev.delete(gone[i]);
      acc -= stepMs;
      steps++;
    }
    if (acc > stepMs) acc = stepMs; // hit the cap: drop the backlog rather than chase it
    game.alpha = acc / stepMs;
    game.stepsTaken = steps;
    return steps;
  }

  /** Copies mv/aim from `intent` (the input's reused object) and applies it with a fresh seq. */
  function setIntent(intent) {
    const mv = intent && intent.mv, aim = intent && intent.aim;
    intentOut.seq = ++seq;
    intentOut.mv[0] = mv ? +mv[0] || 0 : 0;
    intentOut.mv[1] = mv ? +mv[1] || 0 : 0;
    if (aim) { intentOut.aim[0] = +aim[0] || 0; intentOut.aim[1] = +aim[1] || 0; }
    applyIntent(world, playerId, intentOut);
    return seq;
  }

  const game = {
    world, playerId, prev, update, setIntent,
    alpha: 0, stepsTaken: 0, stepMs,
    get tick() { return world.tick; },
    get seq() { return seq; },
  };
  snapshot();
  return game;
}
