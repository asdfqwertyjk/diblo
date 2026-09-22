// client/src/main.js — boot and the frame loop.
// Boot: config → renderer → kit → local game → zone view → entity view → items view → fx →
// camera → input → steering → audio → labels → tooltip → panels → hud → loop.
// Per frame: steer.update → intent; game.update; dispatch game.events (one table, one
// consumer per event kind; `spawn` is deliberately unhandled); entities.sync; items.sync;
// fx.update; camera; labels; hud; open panels' refresh(player); render.
// Boot and frame errors are printed into #ui so a blank page never hides the cause.
// window.hm is the dev handle; hm.step(now) drives one frame without rAF (hidden tabs, agents).
import { Vector3 } from 'three';
import config from '../config.js';
import classes from 'shared/data/classes.js';
import items from 'shared/data/items.js';
import monsters from 'shared/data/monsters.js';
import zones from 'shared/data/zones/index.js';
import { hashString } from 'shared/sim/rng.js';
import { newCharacterDoc } from 'shared/sim/player.js';
import { createRenderer } from './render/renderer.js';
import { buildKit } from './render/kit.js';
import { createIsoCamera } from './render/camera.js';
import { createFx } from './render/fx.js';
import { createLocalGame } from './game/local.js';
import { createSteering } from './game/steer.js';
import { MONSTER_PICK_HEIGHT } from './game/pick.js';
import { createZoneView } from './world/zoneview.js';
import { createEntityView } from './world/ents.js';
import { createItemView } from './world/items.js';
import { createInput } from './input/input.js';
import { createHud } from './ui/hud.js';
import { createLabels } from './ui/labels.js';
import { createPanels } from './ui/panels.js';
import { createTooltip } from './ui/tooltip.js';
import { createInventoryPanel } from './ui/inventory.js';
import { createCharacterPanel } from './ui/character.js';
import { createSkillsPanel } from './ui/skills.js';
import { createSynth } from './audio/synth.js';
import { createSfx } from './audio/sfx.js';

const DEFAULT_SEED = 1234;
const DEFAULT_DIFFICULTY = 'dusk';
const CHARACTER_NAME = 'Wanderer';
const CHARACTER_CLASS = 'warrior';
const MAX_FRAME_DT = 0.1;          // seconds; a stalled tab does not fling the camera
const STATS_INTERVAL_MS = 250;     // fps / tick / draw-call line (hud.set) 4×/s
const SWEEP_INTERVAL_MS = 250;     // release ground labels whose item is gone
const XP_LABEL_INTERVAL_MS = 400;  // '+N xp' floats at most this often (amounts merge)
const TOAST_THROTTLE_MS = 300;     // 'invalid' / 'full' toasts
const HIT_STOP_MS = 40;
const CRIT_SHAKE = [0.15, 0.2];
const SMASH_SHAKE = [0.1, 0.15];
const QUAKE_SHAKE = [0.3, 0.3];
const GOLD_LABEL_COLOUR = 0xf0c040;
// sim 'invalid' reasons → player text (the sim's strings are keys, not copy); others fall back
const INVALID_TEXT = {
  mana: null,                       // filled at boot from the class's resource label
  'no target': 'Nothing in reach', 'belt cooldown': 'Potion cooling down', 'bad slot': 'Cannot do that',
  locked: 'Skill not learned', 'skill not learned': 'Skill not learned', stunned: 'Stunned',
  dead: 'You are dead', 'bag full': 'Bag full', 'no potion': 'No potion there', 'too far': 'Too far away',
  'gold cap': 'Gold pouch full', 'no skill points': 'No skill points', 'no stat points': 'No stat points',
  'max rank': 'Already at max rank', 'needs the skill above': 'Needs the skill above it', blocked: 'Blocked',
};
const LOOT_SFX = { normal: 'lootNormal', magic: 'lootMagic', rare: 'lootRare', unique: 'lootUnique', set: 'lootUnique' };
const AMBIENCE = { gallowsmoor: 'ambienceMoor' };
const PANEL_KEYS = { Tab: 'inventory', KeyC: 'character', KeyK: 'skills' };
const BELT_KEYS = { KeyQ: 0, KeyE: 1, KeyR: 2, KeyF: 3 };
const USE_SLOT = [{ use: 0 }, { use: 1 }, { use: 2 }, { use: 3 }];   // prebuilt one-shots, never mutated
const RESPAWN = Object.freeze({ act: Object.freeze({ op: 'respawn' }) });
const NONE = {};

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

/** config.DIFFICULTY ?? URL ?difficulty= when the start zone's recipe knows it ?? dusk */
function readDifficulty() {
  const q = config.DIFFICULTY != null ? String(config.DIFFICULTY) : new URLSearchParams(location.search).get('difficulty');
  const recipe = zones[classes.startZone];
  return q && recipe && recipe.level && recipe.level[q] ? q : DEFAULT_DIFFICULTY;
}

/** Reload with a fresh random seed (client-side Math.random is fine for choosing one). */
function newRun() {
  const u = new URL(location.href);
  u.searchParams.set('seed', String((Math.random() * 0x7fffffff) | 0));
  location.href = u.href;
}

function boot() {
  const canvas = document.getElementById('game');
  const seed = readSeed();
  const difficulty = readDifficulty();

  // --- world and views ----------------------------------------------------------------
  const view = createRenderer(canvas);
  const kit = buildKit();
  const game = createLocalGame({ seed, difficulty, character: newCharacterDoc(CHARACTER_NAME, CHARACTER_CLASS, seed) });
  const world = game.world;
  const playerId = game.playerId;
  const player = world.ents[playerId];
  const zoneId = player.zone;
  const zone = world.zones[zoneId];
  const zoneView = createZoneView(view.scene, zone.layout, zone.recipe.biome, kit);
  const groundY = zoneView.groundY;
  const entities = createEntityView(view.scene, kit);
  const itemsView = createItemView(view.scene);
  const fx = createFx(view.scene);
  const cam = createIsoCamera(window.innerWidth / window.innerHeight);
  cam.follow(player.x, groundY(player.x, player.z), player.z); // first follow snaps
  const input = createInput(canvas);
  const keys = input.keys;
  const steer = createSteering(game, cam, input);

  // --- audio ----------------------------------------------------------------------------
  const synth = createSynth();
  const sfx = createSfx(synth);
  const panV = new Vector3();                        // scratch for the pan projector
  sfx.setProjector((x, z) => panV.set(x, groundY(x, z), z).project(cam.camera).x);
  const sfxAt = { x: 0, z: 0, variant: undefined };  // reused opts for sfx.play
  function play(key, x, z) { sfxAt.x = x; sfxAt.z = z; sfx.play(key, sfxAt); }
  function click() { play('uiClick', player.x, player.z); }

  // --- labels, tooltip, panels, hud -----------------------------------------------------
  const labels = createLabels(ui, cam.camera);
  const tooltip = createTooltip(ui);
  const panels = createPanels(ui);
  const getPlayer = () => world.ents[playerId];
  let labelsMode = false;
  const cls = classes.classes[player.cls];
  INVALID_TEXT.mana = 'Not enough ' + ((cls && cls.mana && cls.mana.label) || 'mana').toLowerCase();

  const commands = {
    castSlot(i) { steer.castSlot(i); },
    drink(i) { if (USE_SLOT[i]) steer.queue(USE_SLOT[i]); },
    openPanel(name) { panels.toggle(name); click(); },
    zoom() { cam.setZoom(cam.zoomStep ? 0 : 1); click(); },
    toggleLabels() { labelsMode = !labelsMode; hud.setLabelsMode(labelsMode); click(); },
    toggleHud() { hud.toggle(); },
    respawn() { steer.queue(RESPAWN); },
    newGame: newRun,                                 // the HUD's 'New run' button
    newRun,
    tooltip,
  };
  const hud = createHud(ui, commands);
  hud.setTooltip(tooltip);
  hud.set({ zone: zone.recipe.name || zone.layout.name || zoneId, seed });

  const panelOpts = { steer, tooltip, getPlayer, panels, hud };
  const inventoryPanel = createInventoryPanel(ui, panelOpts);
  const characterPanel = createCharacterPanel(ui, panelOpts);
  const skillsPanel = createSkillsPanel(ui, panelOpts);
  panels.register('inventory', inventoryPanel.window || inventoryPanel);
  panels.register('character', characterPanel.window || characterPanel);
  panels.register('skills', skillsPanel.window || skillsPanel);
  panels.onChange((name) => hud.setPanelOpen(name));

  // --- keys and gestures ---------------------------------------------------------------
  function drinkFirstLife() {
    const belt = player.belt || NONE;
    for (let i = 0; i < USE_SLOT.length; i++) {
      const b = belt[i];
      const p = b && b.count > 0 ? items.potions[b.potionId] : null;
      if (p && p.kind === 'life') { steer.queue(USE_SLOT[i]); return; }
    }
    hud.toast('No life potion', 'bad');
  }
  input.onKey((code) => {
    if (code === 'KeyZ') commands.zoom();
    else if (code === 'KeyH') commands.toggleHud();
    else if (code === 'Escape') { if (panels.current()) { panels.closeAll(); click(); } }
    else if (PANEL_KEYS[code]) commands.openPanel(PANEL_KEYS[code]);
    else if (BELT_KEYS[code] != null) commands.drink(BELT_KEYS[code]);
    else if (code === 'Space') drinkFirstLife();
  });
  input.onWheel((deltaY) => { if (deltaY !== 0) cam.setZoom(deltaY > 0 ? 1 : 0); });

  // The synth creates its AudioContext on the first gesture anywhere and startAmbience defers
  // until that context runs, so the wind starts on the first tap whether it lands on the
  // canvas or a HUD button; resuming on our own gestures covers the mobile autoplay policy.
  sfx.startAmbience(AMBIENCE[zoneId] || 'ambienceMoor');
  const gesture = () => synth.resume();
  input.onPointerDown(gesture);
  input.onKey(gesture);

  // --- ground labels --------------------------------------------------------------------
  // A drop registers its label at once; when the ground pool is dry (28+ items lying about)
  // the 250 ms sweep adopts unlabelled items as older ones are picked up (ground() is
  // idempotent, so re-registering is a no-op).
  const labelled = new Set();
  function labelGround(id) {
    const g = world.ents[id];
    if (!g || g.kind !== 'item') return false;
    let text, colour;
    if (g.gold > 0) { text = g.gold + ' gold'; colour = GOLD_LABEL_COLOUR; }
    else if (g.item) {
      const it = g.item;
      if (it.slot === 'potion') {
        const pd = items.potions[it.base];
        colour = pd ? pd.colour : items.rarity.colours.normal;
        text = it.stack > 1 ? it.name + ' x' + it.stack : it.name;
      } else {
        colour = items.rarity.colours[it.rarity] || items.rarity.colours.normal;
        text = it.name;
      }
    } else return false;
    if (!labels.ground(id, g.x, groundY(g.x, g.z) + 0.35, g.z, text, colour, steer.pickItem)) return false;   // onClick(id)
    labelled.add(id);
    return true;
  }
  function releaseLabel(id) { if (labelled.delete(id)) labels.release(id); }
  function sweepOne(id) { if (!world.ents[id]) { labels.release(id); labelled.delete(id); } }
  function adoptOne(id) {
    if (labelled.has(id)) return;
    const g = world.ents[id];
    if (g && g.kind === 'item') labelGround(id);
  }

  // --- events -----------------------------------------------------------------------------
  let toastAt = -1e9, xpPending = 0, xpAt = 0;
  function throttledToast(text, kind, now) {
    if (now - toastAt < TOAST_THROTTLE_MS) return;
    toastAt = now; hud.toast(text, kind);
  }
  function aggroKey(type) {
    if (!type) return 'growl';
    if (type.rig === 'bird') return 'caw';
    if (type.family === 'bandit') return 'banditCall';
    return 'growl';
  }
  // skill event → FX by row.fx; a handler may return the sfx key to use instead of row.fx
  const SKILL_FX = {
    swipe(ev, y, sh) { fx.swipe(ev.x, y + 0.9, ev.z, ev.dx, ev.dz, sh.arc || 120, sh.range || 2.5); },
    dash(ev, y, sh) {
      // emitted at the start (aim far away) and at the landing strike (aim one metre ahead)
      let len = sh.range || 6;
      const dx = ev.ax - ev.x, dz = ev.az - ev.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d < len) len = d;
      fx.dash(ev.x, ev.z, ev.x + ev.dx * len, ev.z + ev.dz * len, y + 0.6);
      return len > 1.5 ? 'dash' : 'swipe';
    },
    shout(ev, y) { fx.shout(ev.x, y + 1.2, ev.z); },
    smash(ev) { fx.hit(ev.ax, groundY(ev.ax, ev.az) + 0.9, ev.az, true); cam.shake(SMASH_SHAKE[0], SMASH_SHAKE[1]); },
    whirl(ev, y, sh) { fx.whirl(ev.x, y + 0.8, ev.z, sh.radius || 2.5); },
    quake(ev, y, sh) { fx.quake(ev.ax, groundY(ev.ax, ev.az) + 0.1, ev.az, sh.radius || 4); cam.shake(QUAKE_SHAKE[0], QUAKE_SHAKE[1]); },
  };
  // `spawn` has no handler on purpose: rigs and ground meshes appear on first sight in
  // entities.sync / items.sync; `xp` is merged into one float below; every other kind is here.
  const ON = {
    hit(ev) {
      const y = groundY(ev.x, ev.z);
      if (ev.tgt === playerId) {
        labels.damage(ev.x, y + 1.9, ev.z, '-' + ev.dmg, 'hurt');
        fx.hit(ev.x, y + 1.0, ev.z, false);
        play('hurt', ev.x, ev.z);
        entities.onHit(ev.tgt);
        return;
      }
      const tgt = world.ents[ev.tgt];
      const h = tgt ? MONSTER_PICK_HEIGHT * (tgt.size || 1) : 0.9;
      labels.damage(ev.x, y + h + 0.6, ev.z, String(ev.dmg), ev.crit ? 'crit' : 'hit');
      fx.hit(ev.x, y + h, ev.z, !!ev.crit);
      play(ev.crit ? 'crit' : 'hit', ev.x, ev.z);
      if (ev.crit) cam.shake(CRIT_SHAKE[0], CRIT_SHAKE[1]);
      entities.onHit(ev.tgt);
    },
    block(ev) {
      const p = world.ents[ev.pid];
      if (!p) return;
      labels.damage(p.x, groundY(p.x, p.z) + 1.9, p.z, 'block', 'block');
      play('block', p.x, p.z);
    },
    kill(ev) {
      fx.puff(ev.x, groundY(ev.x, ev.z) + 0.5, ev.z);
      play('kill', ev.x, ev.z);
      game.pause(HIT_STOP_MS);
    },
    death(ev) {
      if (ev.id !== playerId) return;
      play('death', ev.x, ev.z);
      hud.toast('You died', 'bad');
      steer.cancel();
    },
    respawn(ev) {
      if (ev.id !== playerId) return;
      play('respawn', player.x, player.z);
      hud.toast('Back on your feet', 'good');
      steer.cancel();
    },
    drop(ev) {
      fx.lootPop(ev.x, groundY(ev.x, ev.z), ev.z, ev.rarity);
      const key = LOOT_SFX[ev.rarity];              // gold makes no sound until picked up
      if (key) play(key, ev.x, ev.z);
      labelGround(ev.id);
    },
    pickup(ev) {
      if (ev.pid !== playerId) return;
      play('pickup', player.x, player.z);
      releaseLabel(ev.id);
      if (ev.rarity && ev.rarity !== 'normal') hud.toast(ev.name, ev.rarity);
    },
    gold(ev) { if (ev.pid === playerId) play('gold', player.x, player.z); },
    full(ev, now) { if (ev.pid === playerId) { play('full', player.x, player.z); throttledToast('Bag full', 'bad', now); } },
    potion(ev) { if (ev.pid === playerId) play('potion', player.x, player.z); },
    levelup(ev) {
      if (ev.pid !== playerId) return;
      fx.levelUp(player.x, groundY(player.x, player.z), player.z);
      play('levelup', player.x, player.z);
      hud.toast('Level ' + ev.level + '!', 'good');
    },
    xp(ev) { if (ev.pid === playerId) xpPending += ev.amount | 0; },
    skill(ev) {
      const row = classes.skills[ev.id];
      if (!row) return;
      const f = SKILL_FX[row.fx];
      const key = (f && f(ev, groundY(ev.x, ev.z), row.shape || NONE)) || row.fx;
      if (key) play(key, ev.x, ev.z);
    },
    aggro(ev) {
      const m = world.ents[ev.id];
      if (m) play(aggroKey(monsters.types[ev.type]), m.x, m.z);
    },
    stun(ev) {
      const m = world.ents[ev.id];
      if (!m) return;
      labels.damage(m.x, groundY(m.x, m.z) + MONSTER_PICK_HEIGHT * (m.size || 1) + 0.6, m.z, 'stunned', 'block');
      play('stun', m.x, m.z);
    },
    equip(ev) { if (ev.pid === playerId) play('equip', player.x, player.z); },
    invalid(ev, now) {
      if (ev.pid !== playerId) return;
      const why = ev.why || '';
      const text = INVALID_TEXT[why] || (why.indexOf('needs ') === 0 ? 'Needs ' + why.slice(6) : 'Cannot do that');
      throttledToast(text, 'bad', now);
    },
    proj(ev) { const q = world.ents[ev.id]; if (q) play('arrow', q.x, q.z); },
  };
  function dispatch(list, now) {
    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      const fn = ON[ev.k];
      if (fn) fn(ev, now);
    }
  }
  function flushXp(now) {
    if (xpPending <= 0 || now - xpAt < XP_LABEL_INTERVAL_MS) return;
    labels.damage(player.x, groundY(player.x, player.z) + 2.3, player.z, '+' + xpPending + ' xp', 'xp');
    xpPending = 0; xpAt = now;
  }

  // --- loop -------------------------------------------------------------------------------
  const prev = game.prev;
  const stats = { fps: 0, tick: 0, ents: 0, calls: 0 };   // reused for hud.set
  let playerPos = null;
  let lastT = -1, statsAt = 0, fpsAt = 0, fpsFrames = 0, sweepAt = 0;
  let labelsShown = false, lastHover = null;
  let halted = false;

  /** Open panels re-read the player every frame (each refresh is an O(1) signature check). */
  const panelList = [inventoryPanel, characterPanel, skillsPanel];
  function refreshPanels() {
    const p = getPlayer();
    for (let i = 0; i < panelList.length; i++) {
      const pn = panelList[i];
      if (p && pn.refresh && pn.isOpen && pn.isOpen()) pn.refresh(p);
    }
  }

  /** The monster for the target bar: the steering target, else a hovered monster. */
  function targetEnt() {
    const tid = steer.target;
    if (tid) { const m = world.ents[tid]; if (m) return m; }
    const hid = steer.hover;
    if (hid) { const h = world.ents[hid]; if (h && h.kind === 'monster') return h; }
    return null;
  }

  /** Ground labels: all while ALT is held or the HUD toggle is on; the hovered one always. */
  function updateLabelVisibility() {
    const alt = keys.has('AltLeft') || keys.has('AltRight');
    const hid = steer.hover;
    const h = hid ? world.ents[hid] : null;
    const hoverItem = h && h.kind === 'item' ? hid : null;
    if (hoverItem !== lastHover) { labels.hover(hoverItem); lastHover = hoverItem; }
    const show = alt || labelsMode;
    if (show !== labelsShown) { labelsShown = show; labels.showAll(show); }
  }

  function frame(now) {
    if (halted) return;
    requestAnimationFrame(frame);
    stepFrame(now);
  }

  /** One frame; exposed as hm.step so tools can drive the loop without rAF. */
  function stepFrame(now) {
    if (halted) return;
    try {
      if (lastT < 0) { lastT = now; statsAt = now; fpsAt = now; sweepAt = now; xpAt = now; }
      const dt = Math.min((now - lastT) / 1000, MAX_FRAME_DT);
      lastT = now;
      const W = window.innerWidth || 1, H = window.innerHeight || 1;

      game.setIntent(steer.update(dt, groundY));
      game.update(now);
      dispatch(game.events, now);

      const time = now / 1000;
      entities.sync(world, prev, game.alpha, groundY, time, zoneId);
      itemsView.sync(world, groundY, time, zoneId);
      fx.update(dt);

      const rig = entities.rigs.get(playerId);
      if (rig) { playerPos = rig.group.position; cam.follow(playerPos.x, playerPos.y, playerPos.z); }
      cam.update(dt);

      updateLabelVisibility();
      flushXp(now);
      labels.update(W, H, dt, world);

      hud.setTarget(targetEnt());
      hud.update(player, world);                     // globes every frame; the hud throttles text
      refreshPanels();                               // open panels: O(1) signature checks
      fpsFrames++;
      if (now - statsAt >= STATS_INTERVAL_MS) {
        const span = (now - fpsAt) / 1000;
        stats.fps = span > 0 ? fpsFrames / span : 0;
        stats.tick = world.tick;
        stats.ents = entities.count;
        stats.calls = view.renderer.info.render.calls;
        hud.set(stats);
        statsAt = now; fpsAt = now; fpsFrames = 0;
      }
      if (now - sweepAt >= SWEEP_INTERVAL_MS) {
        sweepAt = now;
        labelled.forEach(sweepOne);
        zone.ents.forEach(adoptOne);                 // drops the label pool could not take yet
      }

      view.render(cam.camera);
    } catch (err) {
      halted = true;
      showError('Hollowmark stopped: an error in the frame loop', err);
      console.error(err);
    }
  }

  window.hm = {
    config, seed, difficulty, world, game, renderer: view.renderer, scene: view.scene, camera: cam.camera,
    cam, entities, items: itemsView, steer, input, hud, panels, fx, sfx, synth, labels, tooltip, kit, zoneView,
    layout: zone.layout, playerId, inventoryPanel, characterPanel, skillsPanel, commands, step: stepFrame, newRun,
  };
  requestAnimationFrame(frame);
}

try {
  boot();
} catch (err) {
  showError('Hollowmark failed to start', err);
  console.error(err);
}
