# NOTES — one short entry per shipped phase

## P0 — Look, move, step (offline) — shipped 2026-09-21
- **What**: `shared/sim` (rng, dmath, noise, zonegen, world, stats, data tables) with 27
  headless tests; offline client (kit, rigs, terrain, props, camera, input, HUD); preview
  pages `tools/{kit,rig,zone,golden}.html`; dev server `tools/serve.js`.
- **Gate**: `node tools/test.js` 27/27; `tools/golden.html` PASS 18/18 in Chrome (Firefox and
  Safari still to be run by hand); the moor screenshot reads as flat-shaded dusk with a path,
  torches and a readable warrior. Frame cost with 73 rigs (72 idle monsters + player):
  0.56 ms CPU per full frame, 43–57 draw calls, 38–51k triangles. A true 60 fps reading
  needs a visible tab; the desktop app's browser pane was hidden for the whole session.
- **Decisions worth remembering**
  - `dsqrt` (Newton) replaces `Math.sqrt` in `shared/`; `DIR16` literal table replaces sin/cos.
    `sim/tests/forbidden.test.js` fails on any banned call.
  - Layout seed = `hash32(worldSeed, hashString(zoneId), 0)`; `tools/zone.html?seed=` takes
    the world seed by default and `?raw=1` takes a raw layout seed (the golden keys).
  - three r155+ physical light units: every light built from biome data multiplies its
    intensity by `LIGHT_SCALE = Math.PI` (client only; the tables stay legacy-scale).
  - Terrain chunks are 32 m, prop instancing chunks are 64 m (32 m fragmented 433 props into
    194 meshes). The outer vertex ring is lifted 2.5 m so the sealed border reads as a wall.
  - Water plane sits 4 cm above `terrain.waterLine`; higher floods walkable grass.
  - Bird rigs carry a ×1.5 kind scale so a 0.55 crow still reads at 18–24 m.
  - Vitals: `life = base + perLevel·(L−1) + perVit·VIT` (Warrior L1 = 120).
- **Known gaps / carry into P1**: monsters are idle (no `ai.js` yet); no HUD globes; no audio;
  the default seed has no interior cliffs (cliffSlope 1.1 vs max slope ≈ 0.87, tune the
  recipe when the crypt lands); `step()` allocates its delta object every tick (fine at 20 Hz,
  revisit at P1.5 with a `trackDelta` flag if the profiler cares); the crow palette was
  lightened slightly for readability.
