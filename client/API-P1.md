# Client module contract — P1 additions (read with `client/API.md`)

P1 adds combat, loot, panels, audio and pointer-first controls. Sim facts come from
`shared/sim/API.md` (intent schema, entity fields, events). Rules unchanged: vanilla ES modules,
relative URLs, importmap names, no allocation per frame in hot paths, nothing in `client/`
mutates `world.ents`. One scheme for mouse and touch (see CLAUDE.md "Controls").

## Boot and loop (`client/src/main.js`, `client/src/game/local.js`)
- `createLocalGame` gains: `events` (array of the events produced by the steps taken in the last
  `update()` call, reused between calls), `pause(ms)` (hit-stop: the accumulator ignores wall
  time for `ms`), and accepts the intent object from the steering module each frame via
  `setIntent(intent)`.
- main.js per frame: `steer.update(...)` → intent; `game.update(now)`; dispatch `game.events`
  to `fx`, `labels`, `sfx`, `hud`, `camera.shake`; `entities.sync(...)`; `items.sync(...)`;
  `labels.update(...)`; `hud.update(player, world)` (text ≤ 10×/s, globes every frame); render.
  `window.hm` also exposes `steer`, `hud`, `sfx`, `panels`, `fx`.
- `index.html` adds `<meta name="viewport" content="width=device-width, initial-scale=1,
  viewport-fit=cover, user-scalable=no">`, `canvas { touch-action: none }`, and
  `<link rel="stylesheet" href="./client/src/ui/ui.css">`.

## Input (`client/src/input/input.js`, rewrite)
- `createInput(canvas)` → `{ keys: Set<code>, pointer: {down, button, ndcX, ndcY, touch, id},
  onKey(cb), onWheel(cb), onPointerDown(cb), onPointerUp(cb), dispose() }`.
  Pointer events only (no separate mouse/touch listeners); `pointer.touch` is true for touch
  and pen so the pick radius can grow. Prevents `contextmenu`, the TAB default and text
  selection. `keys` still holds WASD for the alternative movement.

## Steering (`client/src/game/steer.js`)
- `createSteering(game, camera, input)` → `{ update(dt, groundY) → intent, hover, target,
  moveTarget, castSlot(i), queue(oneShot), cancel() }`.
  Each frame: `aim = camera.screenToGround(ndc, playerGroundY)`; `hover = pickEntity(...)`
  (nearest monster or item whose projected position is within 24 px, 40 px on touch).
  On LMB/touch down over a monster → `target = id` (attack mode); over an item → `pick` one-shot
  when in range, else moveTarget to it; over terrain → `moveTarget = aim`, and while held it
  re-targets to the live aim every 120 ms.
  Attack mode: path toward the target until within `range` (slot 0 skill's `shape.range` or
  `hitRange`, default 2.2) + target.r, then send `skill: 0` every tick while held. RMB →
  `skill: 1` at `aim`. Keys 1–4 → `skill: 2..5` while held. HUD skill buttons call
  `castSlot(i)` (a burst of ~3 ticks at `target` or `aim`).
  Path following: `findPath` from `shared/sim/path.js` on the zone layout, then `simplifyPath`;
  re-path when the goal moves more than 1 m or the player has not progressed for 0.5 s; `mv`
  points at the next waypoint with magnitude 1; waypoints pop within 0.35 m; arrival stops.
  WASD cancels steering for that frame and clears moveTarget. No allocation per frame beyond
  the path arrays on re-path. Returns the same intent object each frame with `seq` incremented.
  One-shots (`use`, `pick`, `act`) are queued via `queue({use|pick|act})`, attached to the next
  intent, then cleared.

## Entity picking (`client/src/game/pick.js`)
- `pickEntity(world, camera, ndcX, ndcY, radiusPx, viewportW, viewportH, groundY, ents?)` → id|null.
  A live monster is a vertical capsule: feet (`groundY`) and head (`groundY + 1.9·size`,
  `MONSTER_HEIGHT`) are projected and the pointer's distance to that screen segment must be
  inside the radius, so the shadow, legs and head all pick it; a ground item is one point at
  `groundY + 0.25`. Nearest wins, monsters before items on ties. Two scratch Vector3s reused.
  `MONSTER_PICK_HEIGHT` (0.9·size, the chest) stays exported for label and fx heights.

## Entity view changes (`client/src/world/ents.js`)
- Handles `kind:'proj'` (thin box 0.6 m long oriented along `dx,dz`, y = groundY + 1.0) and
  delegates `kind:'item'` to `items.js`. Monster `anim:'die'` plays to the end; the rig is
  removed when the entity is gone. On a `hit` event the target rig plays `hit` for 0.2 s unless
  dead or attacking. Champions get ×1.25 scale and a brighter trim. Player `anim:'attack'` plays
  the weapon swing. `moveSpeed` uses `derived.speed` when present.

## Ground items (`client/src/world/items.js`)
- `createItemView(scene)` → `{ sync(world, groundY, time), dispose() }`. One pooled mesh per
  ground item: gold = a small coin pile (yellow), potion = a flask-shaped box in the potion's
  colour, gear = a rotated box sized by `item.size` in dark grey with a rarity-coloured edge
  (vertex colours). A rarity beam (additive thin box 3 m tall) for 1.5 s after `born`, then a
  faint glow. Bobs 5 cm. Pool ≤ 200 meshes; pool materials shared.

## Labels (`client/src/ui/labels.js`)
- `createLabels(root, camera)` → `{ damage(x, y, z, text, kind), ground(id, x, y, z, text,
  colourHex, onClick), release(id), showAll(bool), update(viewW, viewH, dt), dispose() }`.
  ≤ 64 pooled DOM nodes; `pointer-events:auto` only on ground labels (LMB on a label picks up).
  `kind` ∈ `hit crit hurt heal xp block` sets the style; damage numbers rise 1.2 m over 0.9 s
  and fade. Ground labels show while ALT is held (or the HUD "labels" toggle is on) or when the
  item is hovered; text is the item name in its rarity colour, `N gold`, or the potion name.

## FX (`client/src/render/fx.js`)
- `createFx(scene)` → `{ hit(x,y,z,crit), swipe(x,y,z,dx,dz,arcDeg,range), whirl(x,y,z,r),
  quake(x,y,z,r), dash(x0,z0,x1,z1,y), shout(x,y,z), levelUp(x,y,z), lootPop(x,y,z,rarity),
  puff(x,y,z), update(dt), dispose() }`. Every effect draws from a pool (≤ 96 meshes/sprites),
  additive `MeshBasicMaterial`s shared per colour, no allocation after construction. Swipe is a
  flat ring sector (`RingGeometry` with thetaLength) fading over 0.15 s; quake is an expanding
  ring; levelUp is a rising ring plus sparks; lootPop is a short arc of a small box.

## Camera additions (`client/src/render/camera.js`)
- `shake(strength, seconds)` adds a decaying offset (client-side `Math.random` is fine here);
  `update(dt)` applies it. Crits shake 0.15 for 0.2 s; skullbreak (`fx: 'smash'`) 0.1 for
  0.15 s; earthbreak 0.3 for 0.3 s (main.js `CRIT_SHAKE / SMASH_SHAKE / QUAKE_SHAKE`).

## HUD (`client/src/ui/hud.js`, rewrite) and `client/src/ui/ui.css`
- `createHud(root, commands)` → `{ update(player, world), toast(text, kind), setTarget(ent|null),
  toggle(), setLabelsMode(on), dispose() }`. `commands` = `{ castSlot(i), drink(i),
  openPanel(name), zoom(), toggleLabels(), toggleHud() }` provided by main.js.
  Layout: life globe bottom-left and mana (labelled from `classes.mana.label`) bottom-right as
  circular fills with the number inside; XP bar along the bottom edge with a level badge; the
  belt (4 tappable slots with potion colour and count; `Q E R F` hints on desktop) left of
  centre; the skill bar centre-bottom: 6 tappable buttons `LMB RMB 1 2 3 4` showing the skill's
  short name, a cooldown sweep and a dimmed state when mana is short; the target bar
  top-centre (name, champion tag, hp bar) while a monster is targeted or hovered; top-right
  buttons `Bag Char Skills Labels Zoom` (44 px minimum); gold and zone name top-left; a small
  dev line (fps, tick, ents, draw) under it, hidden by H. Everything scales with `vmin` and
  stays usable at 375×667. Toasts stack top-centre and fade after 2 s.

## Panels: `client/src/ui/window.js`, `tooltip.js`, `inventory.js`, `character.js`, `skills.js`, `panels.js`
- `createWindow(root, {id, title, onClose, x?, y?})` → `{ el, body, titleEl, open(), close(),
  isOpen(), toggle(), setTitle(text), moveTo(x, y), dispose(), placed }`: a draggable panel with
  a title bar (pointer events) on wide screens; below 700 px wide **or 451 px tall** (landscape
  phones) it is a fixed, full-width bottom sheet stacked above the HUD with a scrolling body
  (`SHEET_QUERY` in window.js and the media block in ui.css match). A window that fits is kept
  fully on screen; a taller one keeps its title bar on screen. Panels use `pointer-events:auto`.
- `createPanels(root)` → `{ register(name, panel), unregister(name), open(name), close(name),
  toggle(name), isOpen(name), closeAll(), current(), onChange(cb), dispose() }`; only one panel
  is open at a time; main.js uses `closeAll` (ESC) and `onChange` (`hud.setPanelOpen`).
- `createTooltip(root)` → `{ el, showItem(item, compareWith, x, y, player?), showSkill(row, rank,
  player, x, y), showText(lines, x, y), hide(), setPlayer(e), isVisible(), place(x, y),
  dispose() }`; the module also exports the helpers `hexCss`, `rarityColour`, `potionCss` and
  `itemShortGlyph` that the HUD and panels import. Item tooltip: name in rarity colour, base name with tier,
  damage or armour (the roll and, for gear, a green/red delta against `compareWith`),
  requirements (red when unmet per `canEquip`), affix lines in blue, value. On touch a hold of
  350 ms shows the tooltip; a second tap acts.
- Inventory panel: 10×6 grid + paper doll + belt strip + gold. Click an item: it goes "on the
  cursor" (follows the pointer inside the panel); click a free cell → `act move`; click a doll
  slot → `act equip`; click a belt slot → `act belt`; click outside the panel while carrying →
  `act drop`. Right-click or double-tap an item → `act equip`; on an equipped item → `act
  unequip`. Hover/hold shows the tooltip with the equipped comparison. Rebuilds its DOM only
  when `player.invVer` changes.
- Character panel: name, class, level, xp/next, the four stats with a `+` when `statPoints > 0`
  (`act stat`), derived list (life, mana, damage range with the weapon, armour, block, crit,
  resists, attack speed, run speed, MF, gold find), deaths, gold.
- Skills panel: the class's trees as columns (only trees with rows in `classes.skills`); each
  row shows name, rank/10, a `+` when a point can be spent (row unlock level, prerequisite,
  points), and six small assign buttons (LMB RMB 1 2 3 4 → `act assign`); tooltip with
  description, cost, cooldown, damage % at the current and next rank, synergies.

## Audio (`client/src/audio/synth.js`, `client/src/audio/sfx.js`)
- `createSynth()` → `{ ctx, buses:{sfx, ui, ambience, music} (GainNodes), resume(), setGain(bus, v),
  osc(opts), nz(opts) }`. The AudioContext is created lazily on the first pointerdown/keydown
  and resumed on every user gesture (mobile autoplay policy). `osc({type, freq, freqEnd, attack,
  decay, gain, bus, pan})` and `nz({dur, gain, filterHz, filterEnd, bus, pan})` schedule one-shot
  voices; polyphony capped at 24; nothing allocates except the WebAudio nodes.
- `createSfx(synth)` → `{ play(key, {x, z, variant}), startAmbience(key), stopAmbience(), mute(bool) }`.
  One recipe per key in `shared/data/sounds.js` (every key must have one; a missing recipe logs
  once and plays a click). Pan from the entity's screen x when given. Rate-limits identical keys
  to 8 per 100 ms. Loot dings: rare and unique are longer and brighter than magic and normal.
  `ambienceMoor` is a filtered noise loop with slow wind swells and an occasional distant caw.

## Tools pages added
- `tools/items.html` — roll N items at a given ilvl/mf with `shared/sim/itemgen.js`, list them
  with the tooltip module, print rarity and affix histograms.
- `tools/synth.html` — a button per sound key that plays it (and its variants), bus sliders.
- `tools/index.html` gains links to both.

## As built — integration notes (2026-09-21, verified in the browser)
Differences from the contract above that the landed modules rely on; main.js is wired to these.
- **Input**: `pointer.buttons` is the live `e.buttons` bitmask (1 LMB, 2 RMB, 4 MMB; 1 for a
  finger). `onPointerDown/onPointerUp` fire `cb(button, pointer, event)` per button bit with
  `button` = 0 LMB / finger, 1 MMB, 2 RMB (mouse chords that arrive as `pointermove` included).
  Keys are ignored while an input/textarea is focused; Alt is also prevented on keyup.
- **Local game**: one-shots (`use`, `pick`, `act`) stay in the world's intent until a sim step
  consumed them (a one-shot set between ticks is never lost); acts wait in a small FIFO and ride
  the next intent one per seq, so two acts queued before a tick ran are both applied in order
  (`game.pendingActs`); `pause(ms)` is capped at 250 ms. `snapshot()` walks only the zones that
  hold players via `zone.ents.forEach` (no per-tick enumeration). `config.DIFFICULTY` (null →
  `?difficulty=`, validated against the start zone's level table).
- **Steering** extras: `castSlot(i)`, `queue()` (acts append, never overwrite), `cancel()`,
  `pickItem(id) → bool` (the ground label's click), `dispose()`, getters `hover target moveTarget
  pickTarget inRange intent path navMask burstSlot pendingActs`. A tap (down+up within a frame,
  i.e. touch) on a monster walks into range and swings for a ~150 ms burst; a quick RMB tap or a
  HUD button bursts its slot; a burst (or a monster tap) that lands inside a swing lock or a dash
  waits up to 1 s (`BURST_WAIT_SEC`) for the lock to end and then counts its 3 ticks, so a skill
  tapped during a held LMB attack lands after the current swing instead of vanishing; a primary
  press while dead queues `act {op:'respawn'}`; waypoints pop at 0.3 m; a live monster swept
  under a held LMB becomes the target (drag-to-attack). Nav mask built once per zone with the
  player's radius.
- **Pick**: optional 9th argument, the zone's `ents` Set (allocation-free walk); monsters are
  picked as feet-to-head capsules (see the Entity picking section), `MONSTER_HEIGHT` exported.
- **HUD**: `createHud(root, commands)` also takes `newGame()` ('New' button), `respawn()`
  ('Rise' on the death banner) and `tooltip`; `toggle()` hides only the dev line; extra
  `setPanelOpen(name)`, `set(fields)`, `setTooltip(tip)`, `buttons`, `skillEls`, `beltEls`.
  'New' is armed by one tap (button lit, toast) and fires `newGame` only on a second tap within
  2 s. A touch hold on a skill button (a `repeat` button) keeps re-casting and never turns into
  a tooltip; belt buttons and the HUD's non-repeat buttons keep the 350 ms hold-to-tooltip. While
  a skill's seconds show, the button carries the `cooling` class and the css hides its name.
- **main.js**: `invalid` reasons are mapped to player text (`INVALID_TEXT`, 'mana' → 'Not enough
  fury' from the class's `mana.label`; 'needs …' passes through; else 'Cannot do that'). `spawn`
  has no handler on purpose (rigs and ground meshes appear on first sight in `entities.sync` /
  `items.sync`). A drop registers its ground label at once when `labels.ground()` has a free
  node; otherwise the 250 ms sweep adopts unlabelled items as older ones are picked up.
- **Panels**: each factory returns `{ window, refresh(player), dispose, open, close, isOpen,
  toggle, el }` so the result registers with `panels` directly; `open()` runs `refresh` before
  the window opens so window.js measures the built content when it places it; main.js calls
  `refresh(player)` every frame for open panels (O(1) when nothing changed) — the panels' own
  rAF loop is a fallback only. Double-tap / right-click on a bag item equips (potions go to the
  belt). By mouse a click on the canvas while carrying drops the item; by touch a sticky carry
  (a tap) only cancels when the next press lands outside the sheet (the press goes through to
  the HUD / canvas) and dropping needs a real drag released over the canvas.
- **Labels**: `hover(id|null)`, `update(W, H, dt, world?)` (releases ground labels whose entity
  left `world.ents`), `describeGround(ent, rarityColours)`, `ground()` → bool (false when the
  pool is dry; idempotent for an id already labelled); pool 36 damage + 28 ground.
- **Items view**: `sync(world, groundY, time, zoneId?)`; pool of 100 drawn items.
- **Entity view**: projectiles live in `rigs` as `{id, kind:'proj', group}` (no parts/anim);
  `onHit(id)` flinches 0.2 s; the player rig carries the equipped weapon kind.
- **Audio**: `createSynth()` adds `onReady(cb)`, `setMuted`, `getGain`, `voiceCount`, `now`,
  `dispose`; `createSfx()` adds `setProjector((x, z) → ndcX)` (pan from world position),
  `event(ev, playerId)`, `hasRecipe`, `keys`. `invalid` is silent by design.
- **Dev handle**: `window.hm.step(now)` drives one frame without rAF (hidden tabs, agents).
