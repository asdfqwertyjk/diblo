// client/src/main.js — boot: config → renderer → kit → local game → zone view → entity
// view → camera → input → hud → loop. Boot errors are printed into #ui so a blank page
// never hides the cause. window.hm is a dev handle for inspection (harmless).
import config from '../config.js';
import { hashString } from 'shared/sim/rng.js';
import { createRenderer } from './render/renderer.js';
import { buildKit } from './render/kit.js';
import { createLocalGame } from './game/local.js';
import { createZoneView } from './world/zoneview.js';
import { createEntityView } from './world/ents.js';
import { createIsoCamera } from './render/camera.js';
import { createInput } from './input/input.js';
import { createHud } from './ui/hud.js';

const DEFAULT_SEED = 1234;
const HUD_INTERVAL_MS = 250;   // hud.set at most 4×/s
const MAX_FRAME_DT = 0.1;      // seconds; a stalled tab does not fling the camera

const ui = document.getElementById('ui');

function showError(title, err) {
  const box = document.createElement('div');
  box.className = 'boot-error';
  const detail = err && err.stack ? err.stack : String(err);
  box.textContent = title + '\n\n' + detail + '\n\nThe browser console has the full detail.';
  ui.appendChild(box);
}

/** config.SEED ?? URL ?seed= (integer, or any word hashed) ?? 1234 */
function readSeed() {
  if (config.SEED != null) return config.SEED | 0;
  const q = new URLSearchParams(location.search).get('seed');
  if (q == null || q === '') return DEFAULT_SEED;
  const n = Number(q);
  return Number.isFinite(n) ? n | 0 : hashString(q) | 0;
}

function boot() {
  const canvas = document.getElementById('game');
  const seed = readSeed();

  const view = createRenderer(canvas);
  const kit = buildKit();
  const game = createLocalGame({
    seed, difficulty: 'dusk',
    character: { name: 'Wanderer', cls: 'warrior', level: 1 },
  });
  const world = game.world;
  const player = world.ents[game.playerId];
  const zoneId = player.zone;
  const zone = world.zones[zoneId];
  const zoneView = createZoneView(view.scene, zone.layout, zone.recipe.biome, kit);
  const groundY = zoneView.groundY;
  const entities = createEntityView(view.scene, kit);
  const cam = createIsoCamera(window.innerWidth / window.innerHeight);
  cam.follow(player.x, groundY(player.x, player.z), player.z); // first follow snaps
  const input = createInput(canvas);
  const hud = createHud(ui);
  hud.set({ zone: zone.recipe.name || zone.layout.name || zoneId, seed });

  input.onKey((code) => {
    if (code === 'KeyZ') cam.setZoom(cam.zoomStep ? 0 : 1);
    else if (code === 'KeyH') hud.toggle();
  });
  input.onWheel((deltaY) => { if (deltaY !== 0) cam.setZoom(deltaY > 0 ? 1 : 0); });

  window.hm = {
    config, seed, world, game, renderer: view.renderer, scene: view.scene, camera: cam.camera,
    cam, entities, zoneView, input, hud, kit, layout: zone.layout,
  };

  // --- loop ------------------------------------------------------------------------
  const hudFields = { fps: 0, tick: 0, ents: 0, calls: 0 }; // reused, never reallocated
  const prev = game.prev;
  let playerPos = null;          // the player's rig position (Vector3) once the rig exists
  let lastT = -1;
  let hudAt = 0, fpsFrames = 0, fpsAt = 0;
  let halted = false;

  function frame(now) {
    if (halted) return;
    requestAnimationFrame(frame);
    stepFrame(now);
  }

  /** One frame of the loop; exposed as hm.step so tools can drive it without rAF. */
  function stepFrame(now) {
    if (halted) return;
    try {
      if (lastT < 0) { lastT = now; hudAt = now; fpsAt = now; }
      const dt = Math.min((now - lastT) / 1000, MAX_FRAME_DT);
      lastT = now;

      // aim: mouse ray onto the plane at the player's ground height (last frame's position)
      const px = playerPos ? playerPos.x : player.x;
      const pz = playerPos ? playerPos.z : player.z;
      const py = playerPos ? playerPos.y : groundY(px, pz);
      const aim = cam.screenToGround(input.mouse.ndcX, input.mouse.ndcY, py);
      game.setIntent(input.intent(aim));

      game.update(now);
      entities.sync(world, prev, game.alpha, groundY, now / 1000, zoneId);

      const rig = entities.rigs.get(game.playerId);
      if (rig) {
        playerPos = rig.group.position;
        cam.follow(playerPos.x, playerPos.y, playerPos.z);
      }
      cam.update(dt);

      fpsFrames++;
      if (now - hudAt >= HUD_INTERVAL_MS) {
        const span = (now - fpsAt) / 1000;
        hudFields.fps = span > 0 ? fpsFrames / span : 0;
        hudFields.tick = world.tick;
        hudFields.ents = entities.count;
        hudFields.calls = view.renderer.info.render.calls;
        hud.set(hudFields);
        hudAt = now; fpsAt = now; fpsFrames = 0;
      }

      view.render(cam.camera);
    } catch (err) {
      halted = true;
      showError('Hollowmark stopped: an error in the frame loop', err);
      console.error(err);
    }
  }
  window.hm.step = stepFrame;
  requestAnimationFrame(frame);
}

try {
  boot();
} catch (err) {
  showError('Hollowmark failed to start', err);
  console.error(err);
}
