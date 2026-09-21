# Client module contract (P0)

Every client module is a vanilla ES module. Imports use the importmap names `three`,
`three/addons/`, and `shared/` (see `index.html`). Pages under `tools/` carry their own
importmap with `"shared/": "../shared/"`. All URLs are relative. No bundler, no framework.
Nothing in `client/` mutates `world.ents`; the renderer reads and draws.

Sim facts the client relies on (from `shared/`):

- `shared/sim/world.js`: `createWorld({recipes, seed, difficulty})`, `addPlayer(world, doc)`,
  `applyIntent(world, id, {seq, mv:[x,z], aim:[x,z]})`, `step(world)`, `TICK_HZ = 20`, `DT`.
  Entities in `world.ents[id]`: `{id, kind:'player'|'monster', zone, x, z, dx, dz, anim:'idle'|'run',
  r, speed, hp, hpMax, ...}`. Monsters add `{type, name, family, arch, rig:'biped'|'quad'|'bird',
  size, champion, level}`. Players add `{cls, name, level, mp, mpMax}`.
- `shared/sim/zonegen.js`: layout shape is documented at the bottom of that file.
  `groundHeight(layout, x, z)` is the rendered surface height; the terrain mesh splits each
  cell along the (0,0)→(1,1) diagonal to match it. `CELL = {GRASS:0, WATER:1, CLIFF:2, PATH:3}`.
- `shared/data/classes.js`: `classes.classes[cls].palette = {skin, hair, cloth, armour, trim, weapon}`,
  `.weapon` is the kit weapon kind.
- `shared/data/monsters.js`: `monsters.types[type].palette` (optional) else
  `monsters.families[family].palette`; palettes are `{body, belly, eyes, trim, skin?}`.
- `shared/data/zones/*.js`: `recipe.biome = {sky, fog:{near,far}, sun:{color,intensity,dir},
  hemi:{sky,ground,intensity}, ground:{low,high,water,shore,cliff,path}, props:[{kind,density,r,variants}], exitProp}`.

Coordinates: sim x/z are metres with the zone's north-west corner at (0,0); three.js uses the
same x and z, and y is up. A sim facing `(dx,dz)` is the +x/+z direction the entity looks toward.

## Files and exports

### `client/src/render/materials.js`
- `export function flatMaterial()` → one shared `MeshLambertMaterial({vertexColors:true, flatShading:true})`.
- `export function paintGeometry(geometry, colorHex)` → sets a `color` attribute on a non-indexed geometry (all faces one colour).
- `export function paintFaces(geometry, fn)` → per-face colour, `fn(faceIndex, centroidVec3) → hex`.
- `export function shadeHex(hex, mul)` → hex brightened (mul > 1) or darkened (mul < 1) per channel, clamped.
- `export function mixHex(a, b, t)` → linear blend of two hex colours, `t` clamped to 0..1.
- `export const LIGHT_SCALE = Math.PI` — three r155+ lights use physical units, so an intensity
  of 1 reads ≈ π× dimmer than the legacy scale the biome tables were authored against; every
  light built from biome data multiplies its intensity by this once, at creation.

### `client/src/render/kit.js`
- `export function buildKit()` → `{ get(kind, variant=0) → BufferGeometry, kinds: string[], variants(kind) → count, dispose() }`.
  Every geometry is non-indexed, vertex-coloured, merged with `mergeGeometries`, origin at the
  ground centre, +y up, ≤ 300 triangles, and computed bounding sphere. Kinds required in P0:
  `deadTree`(3 variants) `tree`(3) `rock`(3) `gravestone`(2) `bones`(2) `stump`(1) `ruinWall`(2)
  `torch`(1) `crate` `barrel` `fence` `well` `chest` `waypointStone`. Built once per session.
- `export const KIT_COLLIDER_RADIUS = {kind: r}` mirrors the recipe values for the preview page.

### `client/src/render/rig.js`
- `export function createRig({rig, palette, size=1, weapon=null})` → `{group: THREE.Group, parts: {torso, head, armL, armR, legL, legR, weapon?, tail?, wingL?, wingR?}, shadow}`.
  `rig` is `'biped' | 'quad' | 'bird'`. Parts are individual `Mesh`es sharing `flatMaterial()`, each
  a vertex-coloured non-indexed box. `size` scales the whole group. `weapon` is a kit-like
  weapon kind (`sword axe mace bow staff wand dagger spear`) attached to the right hand socket.
  A blob shadow (dark translucent disc) sits under the feet. ≤ 1,200 triangles. Part geometry
  is cached per kind/palette/weapon and shared between rigs; the bird kind carries a ×1.5 base
  scale (`RIG_HEIGHT.bird = 0.9`) so a size-0.55 crow still reads at the game camera.
- `export const RIG_HEIGHT = {biped, quad, bird}` — height in metres at size 1.
- `export const WEAPON_KINDS` — the weapon kinds `createRig` accepts.
- `export function disposeRigCache()` — frees every cached part geometry and the shared shadow
  disc; rigs built afterwards rebuild the cache. `createEntityView().dispose()` calls it.
- `export { animateRig } from './anim.js'` (see below).

### `client/src/render/anim.js`
- `export function animateRig(rigObj, anim, time, moveSpeed)` — procedural pose for
  `'idle' | 'run' | 'attack' | 'hit' | 'die' | 'cast'` at `time` seconds. No allocation per call.
  Per-rig state lives in `rigObj.anim` (written once by `createRig`). Re-exported by `rig.js`.
- `export const WEAPON_POSE = {kind: {rest, wind, end, cast, style}}` — right-arm `rotation.x`
  values per weapon kind; `rig.js` reads `.rest` when it attaches a weapon.

### `client/src/world/terrain.js`
- `export function buildTerrain(layout, biome, waterLine?)` → `THREE.Group` of one mesh per 32 m
  chunk plus one water plane at `waterLine` (default: the recipe's `terrain.waterLine` looked up
  by `layout.id`, else estimated from the layout; `group.userData.waterLine` is the value used).
  Vertex colours by cell type and height (`ground.low/high` by height, `path`, `cliff`, `shore`
  on cells next to water). Diagonal split (0,0)→(1,1). The outermost vertex ring is lifted 2.5 m
  (except across exit gaps) so the sealed border reads as a wall; those cells are never walkable.
  `group.userData.dispose()` frees geometries.
- `export function findWaterLine(layout)` — the default water line described above.
- `export const CHUNK = 32`.

### `client/src/world/props.js`
- `export function buildProps(layout, kit)` → `THREE.Group` with one `InstancedMesh` per prop kind+variant
  per 64 m chunk (`export const CHUNK = 64`; skipping empty ones) so chunks frustum-cull without
  fragmenting a 128 m zone into ~190 one-instance meshes. Uses `groundHeight` for y,
  `rot` (0..15 sixteenth turns) and `s` for scale. Torches also get a small point light? No: a
  warm emissive-coloured flame box, no lights in P0. `group.userData.dispose()` frees resources.

### `client/src/world/zoneview.js`
- `export function createZoneView(scene, layout, biome, kit)` → `{ group, groundY(x,z), dispose() }`.
  Adds terrain, props, lights (one `DirectionalLight` from `biome.sun`, one `HemisphereLight`
  from `biome.hemi`), sets `scene.background` and `scene.fog` (`Fog(sky, near, far)`).

### `client/src/render/renderer.js`
- `export function createRenderer(canvas)` → `{ renderer, scene, resize(camera?), render(camera), dispose() }`.
  `WebGLRenderer({antialias:true, powerPreference:'high-performance'})`, pixel ratio capped at 2,
  `outputColorSpace = SRGBColorSpace`. Resizes to the window (and updates the last rendered
  camera's aspect); `dispose()` removes the resize listener and disposes the renderer.

### `client/src/render/camera.js`
- `export function createIsoCamera(aspect)` → `{ camera, follow(x, y, z), setZoom(step), zoomStep,
  screenToGround(ndcX, ndcY, groundY) → [x, z] | null, update(dt) }`.
  Perspective, yaw 45°, pitch ≈ 55°, distance 18 (step 0) or 24 (step 1), follows the target with
  light smoothing, no rotation. `screenToGround` raycasts against the plane `y = groundY`.

### `client/src/input/input.js`
- `export function createInput(canvas)` → `{ keys: Set, mouse: {ndcX, ndcY, buttons}, intent(aimWorld) → {mv:[x,z], aim:[x,z]}, onKey(cb), onWheel(cb), dispose() }`.
  WASD → `mv` in [-1,1]², where W is −z (north on screen up), D is +x. Prevents `contextmenu`
  and the TAB default. `onKey(cb)` fires `cb(code, event)` on every non-repeat keydown (for zoom,
  hud toggles); `onWheel(cb)` fires `cb(deltaY, event)` on wheel over the canvas. Both return an
  unsubscribe function. `intent()` returns one reused object.

### `client/src/game/local.js`
- `export function createLocalGame({ seed, character, difficulty='dusk' })` → `{ world, playerId,
  update(nowMs) → stepsTaken, alpha, prev: Map<id, {x, z, dx, dz}>, setIntent(intent) }`.
  Fixed-step accumulator at `TICK_HZ`; before each `step()` it copies every entity's `x z dx dz`
  into `prev`, so the renderer can interpolate `prev → current` by `alpha` (0..1 within the tick).
  Caps catch-up at 5 steps per frame. No localStorage yet (P2).

### `client/src/world/ents.js`
- `export function createEntityView(scene, kit)` → `{ sync(world, prev, alpha, groundY, time, zoneId?), rigs: Map, count, dispose() }`.
  Creates a rig per entity on first sight (class palette for players, type/family palette for
  monsters), removes rigs whose entity is gone (or, when `zoneId` is given, not in that zone),
  positions each at the interpolated `x z` with `y = groundY(x, z)`, faces `(dx, dz)`, and calls
  `animateRig` with the entity's `anim`. Champions are scaled up by the sim and tinted here.
  `sync` iterates the game's `prev` Map with a pre-bound callback (never `for-in` over
  `world.ents`, which allocates a key array per frame), so a new entity gets its rig on the
  first tick after it enters `prev` (≤ 50 ms). No allocation per frame beyond what three.js
  does internally. `dispose()` removes every rig and calls `disposeRigCache()`.

### `client/src/ui/hud.js`
- `export function createHud(root)` → `{ set(fields), toggle() }`. P0 HUD is a small top-left panel:
  zone name, fps, sim tick, entity count, draw calls, controls hint. `root` is `#ui`.

### `client/src/main.js`
Boot order: config → renderer → kit → local game → zone view → entity view → camera → input →
hud → loop. `requestAnimationFrame` loop: `game.update(now)`, `entities.sync(...)`, camera follows
the player, `hud.set(...)` at most 4×/s, `render()`. Zoom on mouse wheel or `Z`.

### `client/config.js`
`export default { VERSION: '0.0.1-p0', OFFLINE: true, SERVER_URL: '', SEED: null }` — a `null`
seed means "from the URL `?seed=` or a fixed default 1234".

### `index.html`
Importmap (pinned three 0.160.0 on jsdelivr, `shared/` → `./shared/`), `<canvas id="game">`,
`<div id="ui">` with `pointer-events:none` (panels set `auto`), dark background, no scrollbars,
`<script type="module" src="./client/src/main.js">`. Minimal inline CSS: system fallback font
stack, parchment-and-iron colours (`#1a1712` panels, `#d8c8a0` text, `#6b5a3a` borders).

## Tools pages (`tools/`)
- `kit.html` — grid of every kit kind and variant on a turntable, labels, triangle counts.
- `rig.html` — one of each rig kind with every anim cycling, plus each class palette.
- `zone.html` — 2D canvas of a layout for a given `?seed=`: cell types, path, props, packs, exits, spawn.
  `?seed=` is the **world** seed by default and the layout seed is derived as the game does
  (`hash32(seed, hashString(zoneId), 0)`), so `zone.html?seed=1234` shows what `index.html?seed=1234`
  walks into; `?raw=1` (or the checkbox) feeds the seed straight to `generateZone` for golden keys.
- `golden.html` — runs the pinned hashes from `shared/sim/golden.js` in the browser and prints
  PASS/FAIL per key with the user agent, for the Chrome/Firefox/Safari check.
- `index.html` — links to all of the above.

---

P1 additions (pointer-first controls, steering, panels, FX, labels, audio) are specified in
`client/API-P1.md`; read both files together.
