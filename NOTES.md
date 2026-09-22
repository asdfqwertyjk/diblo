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

## P1 — Kill and loot (offline) — shipped 2026-09-21
- **What**: `shared/sim` combat, skills, ai, loot, inventory, xp and death (155 headless tests);
  the client plays it offline: click-to-move over A* (`sim/path.js`), click-to-attack, the Warrior's
  Onslaught tree with pooled FX and a procedural synth, damage floats and ground labels, bag /
  character / skills panels (draggable windows, bottom sheets on phones), belt potions, death →
  respawn (−10 % gold), the P1 HUD, mobile layout. Contract: `client/API-P1.md` ("As built").
- **Gate**: `node tools/validate.js` ok, `node tools/test.js` 155/155. Frame cost (hidden pane,
  synthetic 60 Hz via `hm.step`): 0.61 ms/frame on 1024×768 in a fight, 0.63 ms on a 375×812 phone
  idle, 33–61 draw calls. Pool peaks under Whirl + Earthbreak in a pack: 56/96 fx, 15/64 labels;
  sfx ≤ 16/s; console clean through ~9 000 ticks of driven play.
- **Decisions worth remembering**
  - `input.js` `BUTTON_BITS = [1, 4, 2]` maps `e.button` index (0 LMB, 1 MMB, 2 RMB) → `e.buttons`
    bit; `onPointerDown/Up` fire per button bit (mouse chords arriving as `pointermove` included).
  - One scheme for mouse and touch: a tap on a monster is a 3-tick burst, a press held over a
    monster keeps swinging, a held LMB sweeping over a monster targets it (drag-to-attack). Bursts
    (RMB tap, HUD button, monster tap) wait up to 1 s for the current swing lock / dash to end
    instead of dying inside it.
  - A 0-cost skill row (Cleave) stays free at every rank (`skillCost`): the basic attack must never
    stall on fury (rank 2 used to cost 1/swing and out-regenned the warrior in ~35 s).
  - Double-tap / right-click equip goes through the inventory panel's carry branch (a second press
    on the item just picked up within 350 ms is the quick action); by touch a sticky carry cancels
    on a press outside the sheet and only a real drag drops on the ground.
  - Monsters are picked as feet-to-head screen capsules (`pick.js`), not one chest point.
  - Pools: fx 96 (72 + 24), labels 64 (36 damage + 28 ground, drops beyond that are adopted by
    the 250 ms sweep), ground items 100 bodies + 100 beams, toasts 6, synth 24 voices.
  - Panels build before they open so `window.js` measures the real height; a window that fits is
    clamped fully on screen; the sheet breakpoint is `(max-width: 699px), (max-height: 450px)`.
  - The HUD's 'New' button arms on one tap and only a second tap within 2 s reloads with a new seed.
  - `hm.step(now)` drives one frame without rAF so hidden tabs and agents can play deterministically.
- **Known gaps / carry into P2**: no save yet (localStorage lands with P2); bag cells are 34 px on a
  375 px phone (a 44 px cell needs a 440 px grid that would have to pan under a drag-to-carry grid —
  the 350 ms hold + double-tap scheme covers it for now); Firefox / Safari golden runs still by hand;
  the cursor-side skill tooltip is not reachable by touch on the HUD (Skills panel only).
