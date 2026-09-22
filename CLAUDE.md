# HOLLOWMARK (working title) — a browser hack-and-slash sandbox
### CLAUDE.md — project brain. Read fully before touching code. Keep me updated as you ship.

A low-poly, top-down action RPG in the spirit of the great 2000-era hack-and-slash
games: kill, loot fountains with rarities and affixes, skill trees, a town hub with
generated wilderness and dungeons beyond it, and small co-op games of up to 8 players.
Runs in the browser with no install. **Inspired by, not a parody of, and not a copy
of** any real game: every name, item, class, monster, zone and piece of lore is invented
here. No real game's assets, text, mechanic names or trademarks ever. If a name in this
document or the code resembles a real game's, rename it.

## State (keep current)
- **P0 shipped 2026-09-21** (see NOTES.md): the moor generates and steps headlessly under
  `node tools/test.js` (27 tests, golden hashes pinned), and the offline client draws it:
  chunked flat-shaded terrain and props, three procedural rigs (biped/quad/bird) with
  idle/run/attack/hit/die/cast, isometric follow camera with two zoom steps, WASD + mouse
  aim, a dev HUD, and preview pages under `tools/`. Monsters stand idle; no combat yet.
- **P1 client integrated 2026-09-21**: click-to-move over A*, click-to-attack, Warrior
  Onslaught skills with FX/sfx, damage floats, drops with beams + ground labels, inventory /
  character / skills panels, potions, death → respawn (−10% gold), HUD, procedural audio,
  mobile layout. See client/API-P1.md "As built". Rigs reworked the same day to old-school
  humanoid proportions (rig_parts/rig_biped/rig_beasts). Gate: bot reaches level 5–6 in ten
  minutes; console clean; 0.6 ms/frame. Next: P1.5 network spike, then P2 (town, crypt,
  exits, waypoints, stash, vendors, corpse/healer, Warrior's other two trees, localStorage save).
- Play: `node tools/serve.js` → http://localhost:8642/ (offline, `?seed=` picks the world).
  Public: https://asdfqwertyjk.github.io/diblo/ (GitHub Pages, branch main, root).

## Pillars (do not trade these away)
1. **Kill → loot → power.** Every monster is a piñata. Most drops are trash you glance
   at and skip; that is what makes the good drop feel good.
2. **Numbers go up, visibly.** Damage floats, XP bar, rarity colours, item comparisons.
3. **Zones are sandboxes.** A fixed town hub; everything past the gate is generated from
   a recipe + seed, so runs feel different and the map is never "done".
4. **Danger is density.** Packs, champions with modifiers, occasional bosses. Death costs
   something; hardcore characters die for good.
5. **Co-op, not massively.** A game holds 1–8 players. The server holds many games.
   Prototype gate: 10 concurrent players. Target: 100 concurrent.
6. **Readable at a glance.** Isometric camera, flat-shaded low poly, hard silhouettes,
   rarity colours you can read from across the room.
7. **One simulation.** The offline game and the online game run the same `shared/sim`
   code. The renderer only reads state; it never owns it.

## Tech stack (fixed)
- **Client**: vanilla ES modules, no framework, no bundler. three.js from jsdelivr via an
  importmap, pinned: `"three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"`,
  `"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"`,
  `"shared/": "./shared/"`. Static site hosted on **GitHub Pages from the repo root**
  (Settings → Pages → branch `main`, folder `/`). `index.html` sits at the repo root next
  to `client/` and `shared/`. **All URLs are relative** (`./client/...`), never `/...`:
  project pages are served under `/<repo>/`.
- **Offline mode first**: the client runs with no server (local game, localStorage
  save). Graphics and every system are built and tested offline before P3.
- **Server**: Node 20 LTS (≥ 20.12), `ws`, `better-sqlite3`, passwords with the built-in
  `crypto.scrypt` (no argon2/bcrypt dependency). One process. Docker base
  `node:20-bookworm-slim` (glibc, so the sqlite prebuilt binary loads; never alpine).
- **Hosting the server (decided 2026-09-21: self-hosted)**: GitHub Pages cannot run a
  server. The owner runs the Node server on a **spare home PC**, always on, with SQLite
  on its local disk (WAL mode, `synchronous=NORMAL`, `DATA_DIR` env, nightly
  `VACUUM INTO <DATA_DIR>/backup.db`). The server binds to localhost only; a **tunnel**
  in front of it provides the public `https://`/`wss://` hostname and the TLS
  certificate (the GitHub Pages client is https, so a bare `ws://` home IP can never
  work). Preferred tunnel: a free one with a stable hostname and websocket support, no
  router port-forwarding needed. `client/config.js` holds that hostname as
  `SERVER_URL`. Docker is optional here; a plain `node server/index.js` under a
  service manager that restarts on boot and crash is the target. The Fly.io route from
  the original brief stays documented in `HACKSLASH-CLAUDE.md` as the fallback. The
  P3 deliverable includes a written **HOSTING.md** walk-through for that PC.
- **Client connect flow**: `GET https://<server>/health` with retry/backoff for up to
  60 s ("waking the server…") before opening `wss://`; on socket close, auto-reconnect
  with the session token and re-join the game. Local dev is `http://localhost` against a
  local `ws://` server; an https page cannot open `ws://`.
- **Shared code**: `shared/` holds data tables and pure simulation logic imported by
  BOTH client and server. Data tables are **`.js` modules** (`export default {...}`), not
  `.json`, so the same import works in Node and every browser without import
  attributes. Never duplicate a formula; if it exists in `shared/sim` it is used on
  both sides. No DOM, no three.js, no `Date`, no `Math.random` inside `shared/`.

## Repo layout
```
index.html              importmap + <canvas> + UI root (repo root, served by Pages)
/client
  config.js             SERVER_URL, VERSION, ALLOWED flags, OFFLINE
  src/main.js           boot: renderer, scene, input, ui, then local or net adapter
  src/render/           camera, lighting, materials, kit builders, rigs + anim, fx pools, labels
  src/input/input.js    keyboard + mouse → intents (WASD, ground-plane aim, wheel/Z zoom)
  src/world/            zone mesh build from sim state (terrain, props, ents), minimap, occluder fade
  src/game/local.js     offline: shared world + the local player + localStorage save
  src/game/net.js       online: socket, snapshot buffer, prediction, same interface
  src/ui/               hud, inventory, skills, stash, vendor, lobby, chat, tooltips (DOM)
  src/audio/            synth engine (ported from FakeDMZ) + sample hooks
  assets/               palette textures (optional), font, small sounds
/shared
  data/classes.js       classes, base stats, skill trees, skill rows
  data/items.js         bases, affixes, uniques, sets, drop tables
  data/monsters.js      families, archetypes, champion modifiers, bosses
  data/zones/*.js       recipes (town is authored; others are recipes + seed)
  data/sounds.js        sound keys
  sim/rng.js            hash32 / hashString / mulberry32 streams (layout, loot, combat)
  sim/dmath.js          dsqrt (Newton), dnormInto, clamp/lerp/smooth, DIR16 facing table
  sim/noise.js          value noise + fbm on hash32
  sim/stats.js          deriveVitals(doc) → hpMax, mpMax, speed, radius
  sim/golden.js         pinned hashes (rng, zonegen) checked in node and in browsers
  sim/world.js          createWorld / ensureZone / addPlayer / applyIntent / step  (THE game)
  sim/zonegen.js        recipe + seed → layout, walkable mask, spawns, exits
  sim/itemgen.js        rarity roll, affixes, bases, value
  sim/combat.js         damage, crit, armour, block, resists
  sim/skills.js         behaviour per skill kind
  sim/ai.js             monster brains
  sim/path.js           A* over the walk mask (client steering now, monster AI later)
  sim/xp.js             curve, monster xp, level-difference penalty
  sim/tests/*.test.js   node --test
/server
  index.js              http (/health, /stats), ws, lobby, one master tick for all games
  auth.js               scrypt accounts, sessions, rate limits, BOT_KEY
  db.js                 sqlite schema + queries
  game.js               one co-op game = shared world + sockets + saves
  bots.js               load-test bots: node server/bots.js <n>
/tools                  serve.js (dev server :8642), test.js (runs node --test), validate.js
                        (table shapes), kit/rig/zone/golden preview pages
client/API.md           the client module contract (exports per file); update it with the code
.claude/launch.json     "hollowmark" preview config → node tools/serve.js 8642
CLAUDE.md               this file
NOTES.md                one short entry per shipped phase
```

## The simulation contract (read twice)
`shared/sim/world.js` exposes plain-object state and four functions:
`createWorld({recipes, seed, difficulty?, startZone?})`, `addPlayer(world, characterDoc)`,
`applyIntent(world, playerId, intent)`, `step(world) → {delta, events}` at a fixed
**20 Hz**. Entities are rows in `world.ents` keyed by id. The server wraps a world with
sockets and saves; the offline client wraps a world with the local player. The render
layer reads `world.ents` and interpolates between steps; it never mutates gameplay
state. P0's gate includes: the world steps headlessly under `node --test` with scripted
intents and produces deterministic deltas.

**Determinism rules**: `zonegen`, movement and collision use ONLY integer hashing and
`+ − × ÷ floor min max` (no `Math.sin/cos/pow/exp/atan2/random`, no `Date`). Square roots
go through `dsqrt` in `sim/dmath.js` (Newton on those ops), facings through the literal
`DIR16` table; `Math.sqrt`/`hypot` are banned in `shared/` and
`sim/tests/forbidden.test.js` fails the build if any banned call or platform API appears. A golden test
`hash(zonegen(recipe, 1234))` must equal a stored value under `node --test` AND on the
tools page in Chrome, Firefox and Safari. The server still sends the walkable bitmask
(~2 KB for 128×128) and the exit/prop list on zone enter, and the online client uses
that, not its own bake, for collision. Three rng streams per zone instance: layout (from
the game seed), loot (server only), combat. A client never advances a stream the server
uses.

## Camera, controls, feel
- **Camera**: fixed-angle isometric-ish perspective (yaw 45°, pitch ~55°, distance
  18–24), follows the player, no rotation in v1, two zoom steps. Occluders near the
  camera (buildings, big walls) fade by opacity; they are ordinary meshes, never instanced.
- **Controls (decided 2026-09-21: pointer-first, one scheme for mouse and touch, no
  platform prompt)**: Pointer events unify mouse and touch. **Hold LMB / touch on terrain**
  moves toward the pointer and keeps following it while held; the client routes with
  `shared/sim/path.js` (A* over the walk mask) so obstacles never stick. **LMB / tap on a
  monster** walks into range and attacks with the primary skill; holding keeps attacking.
  **RMB** casts the secondary skill at the pointer; `1–4` cast the hotbar skills at the
  pointer or the current target. The HUD's skill bar, belt, bag / character / skills
  buttons and zoom button are tappable so phones need no keyboard. Keys stay as
  shortcuts: `Q/E/R/F` belt, `SPACE` first life potion, hold `ALT` shows all ground labels
  (LMB on a label always picks up, never attacks), `TAB` inventory, `C` character,
  `K` skills, `M` waypoint map, `ENTER` chat, `ESC` menu, `Z` zoom; `WASD` still moves
  for people who prefer it. Mouse aim is a raycast to the ground plane, not screen delta.
  `contextmenu`, the TAB default and touch scrolling (`touch-action:none`) are prevented.
  UI root has `pointer-events:none`, panels and HUD buttons `auto`. Monster picking projects
  entity positions to the screen and takes the nearest within a finger-sized radius (no
  raycast against rigs). Phones are a test target from P1 on; the viewport meta tag,
  vmin-scaled HUD and a pixel-ratio cap keep it playable.
- **Feel targets**: 60 fps on a mid laptop with 40 monsters on screen; hit-stop 40 ms
  on kills; screen shake on crits; loot pops with an arc and a colour beam by rarity;
  damage numbers float and fade.

## Graphics (low-poly, filled, flat)
- Materials: `MeshLambertMaterial` with `flatShading:true` and **vertex colours**; one
  directional light (sun/moon per zone), one hemisphere light, fog matched to the sky.
  Optional 64–256px palette textures. No PBR, no shadow maps in v1 (blob shadows).
- **Kit geometry is non-indexed** (`geometry.toNonIndexed()`) so a face keeps one hard
  colour; parts are merged with `mergeGeometries` from
  `three/addons/utils/BufferGeometryUtils.js`. Kit list: walls, roofs, doors, fences,
  crates, barrels, torches, gravestones, dead trees ×3, live trees ×3, rocks ×3, bridges,
  wells, tents, ruin pieces, bones, chests, waypoint stones, portals. Built once per
  session by procedural part builders (the FakeDMZ gun-builder approach).
- **Instancing is chunked**: one `InstancedMesh` per prop type per 64 m cell (terrain
  meshes use 32 m) so cells frustum-cull (a single zone-wide InstancedMesh never culls;
  32 m prop cells split a 128 m zone into ~190 near-empty meshes). Budgets: prop ≤ 300 tris,
  character ≤ 1,200, boss ≤ 3,000, ≤ 250k tris on screen.
- **Characters and monsters (look decided 2026-09-21: old-school EverQuest proportions)**:
  low-poly humans, not boxes — ~7 heads tall, chest wider than hips, tapered 6–8-sided limb
  prisms with elbow and knee joints, hands, boots, a head with jaw, nose and hair cap,
  pauldrons/belt/breastplate as painted colour zones (skin, hair, cloth, leather, armour,
  trim) standing in for 1999-era textures. Parts: torso, head, armL/R → forearmL/R (hand),
  legL/R → shinL/R (boot), weapon socket, blob shadow; quads get two-segment legs, a
  tapered muzzle, ears and tail; birds a beak and tapered wings. Procedural animations
  (idle, run, attack, hit, die, cast) bend elbows and knees. Budgets: biped ≤ 1,200 tris
  (aim 500–800), wolf ≤ 900, crow ≤ 400. Palettes per class/family, size scale for elites.
  glTF models remain an optional upgrade later.
- **Terrain**: heightfield per zone (port `groundH`, flattened pads and colliders from
  FakeDMZ), vertex-coloured by biome, walkable mask from the recipe. Dungeons are
  tile-based (rooms + corridors on a grid, walls as kit pieces).
- **FX and labels**: pooled additive sprites/wire spheres for hits, fire, ice, poison,
  holy; loot beams; level-up ring. Damage numbers and ground labels are a **pooled set
  of ≤ 64 DOM nodes** (or a canvas sprite atlas) positioned with `Vector3.project`, never
  created per hit. Nothing allocates per frame.

## Zones
- **Town (authored)**: `shared/data/zones/town.js` — hand-placed hub: stash, vendors
  (weapons, armour, potions; gambling in P4), healer, waypoint, gate to the wilds, a
  quest board with two flag quests stored on the character as
  `quests:{championDead, bossDead}` per difficulty. Safe; no monsters.
- **Generated zones**: recipe + seed → deterministic layout (same `zonegen` on both
  sides). Recipe fields: `id`, `name`, `kind` (wilderness | cave | crypt), `size`,
  `biome` (palette, props, fog, sky, light), `terrain` (noise params, water line,
  cliffs), `structure` (dungeons: room count, corridor rules, tile set), `spawns`
  (families, density, pack size, champion chance, boss), `exits` (connected zone ids,
  waypoint yes/no), `level` (monster level range per difficulty), `dropTable`.
- **Starter set (3 zones)**:
  1. `town` — Hollowmark, the hub.
  2. `gallowsmoor` — wilderness, wolves/bandits/crows, a named bandit elite.
  3. `saltcrypt` — crypt under the moor, skeletons/ghouls, a named necromancer boss in
     the last room, waypoint at the entrance.
- **Density** (`spawns`): moor 1 pack per ~35 m cell, pack 3–6, champion 8% of packs;
  crypt 1–2 packs per room of 4–8, champion 15%, boss in the last room. Monster level
  ramps low → high by distance from the entrance (wilderness) or room index (dungeon).
- **Transitions**: walk into an exit trigger → fade → the world swaps zone → fade in.
  Waypoints: touch to activate, `M` to travel. Zones with no players do not tick.
- **Instancing**: a game owns its zone instances (seeded at game creation); players in
  the same game share them. New game = new seeds = new layout. Dropped LOOT vanishes
  with the game; corpses do not (see Death).

## Character
- **Classes (5, one ships first)**: `Warrior` (melee), `Paladin` (holy melee + auras),
  `Rogue` (bows, traps, speed), `Cleric` (holy caster, spirits, curses), `Wizard`
  (elemental caster). The Warrior ships in P1/P2; the other four are designed to the same
  schema in P4. Every class uses mana in v1 (the Warrior's globe is merely labelled
  "fury"); there is no separate rage system. Levels 1–30.
- **Stats**: STR, DEX, VIT, ENE; 5 stat points per level, 1 skill point per level.
  A new character (`player.newCharacterDoc`) starts with the class weapon equipped and
  `startPotions` (4 minor life) on the belt.
  Starting STR/DEX/VIT/ENE: Warrior 25/15/20/10 · Paladin 20/10/25/15 · Rogue 15/30/15/10 ·
  Cleric 15/10/20/25 · Wizard 10/15/15/30. Life L1 / per level / per VIT and mana L1 /
  per level / per ENE: Warrior 60/+10/3 ; 15/+1/1 · Paladin 55/+9/3 ; 20/+2/1.5 ·
  Rogue 45/+7/2 ; 20/+2/1.5 · Cleric 45/+7/2 ; 30/+2/2.5 · Wizard 40/+6/2 ; 35/+3/3. Derived: armour, block, resists (fire/cold/lightning/poison),
  crit, cast rate, run speed, magic find (MF).
- **XP** (`sim/xp.js`): `xpToNext(L) = 100·L²` (≈ 855k total to 30). Monster xp
  `= 20·mlvl·(1 + mlvl/10)` (`classes.xp.monsterBase`; 10 left a full moor clear at level 5);
  champion ×3, boss ×20. Below-level penalty:
  `xp *= clamp(1 − 0.1·((clvl − mlvl) − 5), 0.05, 1)`; no bonus above. Co-op: every
  player in the same zone within 40 m of the kill receives full xp ×
  `(1 + 0.15·(playersInGame − 1))`.
- **Skill rules**: 3 trees × 6 skills per class. Max rank 10; tree rows unlock at
  character level 1/3/6/9/12/18 (row = skill index); a skill needs ≥ 1 point in the row
  above it in the same tree; effect +12% per rank, mana cost +1 per rank (a 0-cost row such as
  Cleave stays free at every rank so the basic attack never stalls on fury). Synergy: each
  skill lists ≤ 2 same-tree skills, +8% base damage per hard point in each. One respec
  token per difficulty clears all points.
- **Skill row schema**: `{id, class, tree, row, kind: melee|projectile|aoe|buff|summon|
  curse, cost, cooldown, shape:{arc|radius|range|width}, weaponPct | dmg:[[min,max] per
  rank], element, duration, fx, synergies[]}`; one behaviour function per `kind` in
  `sim/skills.js`. Summons (Cleric spirits, Wizard constructs): cap `2 + floor(rank/3)`, hard cap 6 per player;
  summons count against the zone entity budget.
- **P1 skills (Warrior, tree "Onslaught")**: Cleave (row 1, 120° arc 2.5 m, 110% wpn,
  0 mana) · Lunge (row 2, dash 6 m, 150%, 4 s cd, 6 mana) · Warcry (row 3, +20% dmg
  10 s, 15 s cd, 10 mana) · Skullbreak (row 4, single target 280% + 1 s stun, 6 s cd,
  8 mana) · Whirl (row 5, channelled 360° 80% per 0.4 s, 4 mana/s) · Earthbreak (row 6,
  ground AoE r4 220% + knockback, 12 s cd, 15 mana). Synergies: Whirl ← Cleave,
  Earthbreak ← Skullbreak. The other two Warrior trees ship in P2; the other four
  classes are designed to the same schema in P4.
- **Potions and regen**: belt of 4 slots, stack 10 per slot, auto-refills from
  inventory. Life minor 40 / light 90 / greater 200 (over 2 s); mana 20 / 50 / 120.
  Shared 1 s belt cooldown per type. Regen: life 1%/s only after 5 s without dealing or
  taking damage; mana `(1 + ENE/40)/s` always.
- **Death**: softcore → lose 10% of carried gold (never stash), respawn in town with
  inventory intact and equipment on the corpse. The corpse is stored ON the character
  (`corpse:{zoneId, items[], gold}`), shown where you died in that game, and next to the
  town waypoint on next login if the game closed. Healer retrieval fee = 20% of the
  corpse's item value, min 100 gold. Hardcore → `dead = 1`, hall of the dead entry,
  broadcast to the game. Games carry `hardcore:bool`; a character only lists, creates
  and joins games of its own kind.
- **Persistence**: the character document is ONE JSON object with a `v` field (class,
  level, xp, stats, skills, inventory, equipment, belt, gold, corpse, waypoints,
  quests, difficulty progress, hardcore, dead, deaths, playtime). The offline save
  (`localStorage` key `hm_chars_v1`) is byte-for-byte the document the server stores in
  `characters.data`. Saves on: zone change, level up, every 60 s, logout, game close.
  Inventory 10×6 cells, stash 10×10 (per account × hardcore), gold cap 999,999.

## Items and loot (`sim/itemgen.js`)
- **ilvl** = monster level (+2 champion, +4 boss); vendor/gamble ilvl = character level.
  An affix tier is usable when `ilvl >= tier.minIlvl`.
- **Rarity roll** per dropped item at MF 0: normal 72% / magic 20% / rare 6% /
  unique-or-set 2% (until P4 the 2% falls to rare). MF: `w_r *= 1 + MF/100·k_r`,
  k = 1 magic / 0.6 rare / 0.35 unique, then renormalise. Magic = 1 prefix and/or
  1 suffix; rare = 3–6 affixes, max 3 prefixes + 3 suffixes, one per `group`, generated
  name. Unique (gold) and set (green) are authored with fixed rolls within ranges.
  Colours: grey / blue / yellow / gold / green, identical on beam, label and tooltip.
- **Drop table row**: `{id, picks, noDrop, weights:{gold, potion, item}, ilvlBonus}`;
  e.g. moor basic `{picks:1, noDrop:.55, gold:.4, potion:.4, item:.2}` (life potions 3:1 over
  mana until a mana-using class ships: `manaMinor/manaLight` weight 2); champion
  `{picks:3, noDrop:.15}`; boss `{picks:6, noDrop:0}`. Personal loot: the server rolls
  the drop table once per eligible player and tags each drop with `owner`; free-for-all
  is a game option later.
- **Affix schema**: `{id, kind:prefix|suffix, group, stat, slots[], tiers:[{minIlvl,
  min, max, weight}]}`. P1 ships ≥ 24 affixes with tiers at ilvl 1 / 8 / 16: +flat phys,
  +% dmg, +life, +mana, +STR/DEX/VIT/ENE, +armour, +% armour, +fire/cold/lightning/
  poison dmg, +each resist, +all resist, +crit, +attack speed, +cast rate, +run speed,
  +MF, +gold find, life on hit, mana on kill.
- **Base schema**: `{id, slot, hands, size:[w,h], lvlReq, reqs:{str,dex}, dmg:[min,max]
  | armour:[min,max], speed, value, tier}`; tiers `crude / tempered / hallowed` scale
  with difficulty. P1 set of 12 bases: dagger, sword, axe, mace, 2H spear, bow, staff,
  wand, shield, cap, leather chest, boots. Slots in v1: weapon, shield, helm, chest,
  gloves, boots, belt, amulet, ring ×2.
- **Value** `= base.value·rarityMult(1/3/8/20) + Σ(affix tier·15)`; sell = 25% of value,
  cap 3,000. No identification in v1: everything drops identified. Gambling (P4) = pay
  `40·clvl` gold for a shown base that rolls rarity at MF +100.
- **Ground**: hold `ALT` shows labels; click to pick up; gold and potions auto-pickup.

## Combat (`sim/combat.js`) and monsters
- **Server-authoritative** (or the local world offline): the client sends intents at
  20 Hz; the world resolves hits, damage, deaths, drops and XP in `step()`.
- **Player attacks never miss.** No accuracy/attack-rating stat. Crit% `= 5 + DEX·0.1`
  (cap 50), crit = 150% dmg. Physical: `dmg = roll(weapon.dmg)·skill.weaponPct·(1 +
  STR/100)` (bows: DEX). Spells: `dmg = roll(skill.dmg[rank])·(1 + ENE/200)`.
  Armour: `DR = armour / (armour + 25·attackerLevel)`, cap 60%. Block (shield, physical
  only): `shield.block + DEX/40`, cap 50%. Resists cap 75%, floor −100%.
- **Monster curve**: `hp = (15 + 10·mlvl)·archMult`, `dmg = (3 + 1.6·mlvl)·archMult`;
  archMult hp/dmg: rusher 1/1, swarm .5/.6, ranged .8/.7, caster .7/1.2, tank 2.2/1.3.
  Champion ×3.5 hp ×1.5 dmg; boss ×15 hp ×2 dmg. Move 4.5 m/s (swarm 5.5, tank 3.2, ranged 3.5;
  an archer backing off at 4.5 from a 6 m/s warrior made poacher packs 8× slower to clear),
  wind-up 0.5 s, attack every 1.2 s, aggro on sight, leash 30 m, packs share aggro,
  cowards flee under 20% hp. Per extra player in the game: monster hp +50%, dmg +10%.
- **Families** (beast, undead, bandit, demon) × archetypes. **Champion modifiers**
  (champions roll 1–2, bosses 3 + a name), in `monsters.js`: swift (+40% move/attack
  speed) · brutal (+60% dmg) · hexer (hits apply −25% all resist for 8 s) · ember (fire
  aura 4/s r3 + burst on death) · blink (teleports to target every 6 s) · wraith (attacks
  ignore armour) · stone (+100% hp, −20% speed) · mender (heals its pack 5%/s).
- **Difficulties**: `dusk → blight → hollow`, unlocked by the crypt boss. Monster levels:
  dusk moor 1–8 / crypt 6–14 · blight moor 14–19 / crypt 18–24 · hollow moor 23–27 /
  crypt 26–31. Resist penalty 0 / −25 / −50. Expected clear levels ≈ 14 / 24 / 30.

## Multiplayer (small co-op games, not an MMO)
- **Lobby**: after login, a game list (name, players/8, difficulty, hardcore, level
  range, password?) and lobby chat. Create or join. A game lives while someone is in it
  and dies 60 s after the last player leaves.
- **Server**: one process runs a `Lobby` and N `Game`s. ONE master `setInterval` steps
  all games at 20 Hz; each game has its own zone instances, monsters and loot. Interest
  management is per zone within a game. 100 concurrent ≈ 15–30 games ≈ one process; a
  second process per region is the scale step, not v1.
- **Protocol** (JSON over ws in v1):
  input `{t:"in", seq, mv:[x,z], aim:[x,z], skill, use, pick, act}` at 20 Hz;
  snapshot `{t:"snap", tick, ack:<last seq applied>, ents:{id:{changed fields}},
  gone:[ids], ev:[{k,…}]}` at a fixed 20 Hz per zone (positions as integer centimetres;
  idle entities send nothing). Client: buffer snapshots, render remote entities at
  `tick − 2` (100 ms); for the local player re-simulate unacked inputs on top of the
  acked server state. Skills are cosmetically predicted (swing/cast animation plays on
  input); hits, numbers and drops appear only from server `ev`. Binary only if
  measurements demand it.
- **Socket hygiene**: the server accepts only `Origin` in `ALLOWED_ORIGINS`
  (`https://<user>.github.io`, `http://localhost:*`); browsers do not apply CORS to
  websocket handshakes, so this check is ours. The first message must be
  `{t:"auth", token}` within 5 s or the socket closes. Server pings every 25 s and
  terminates sockets that miss two pongs (`isAlive` pattern) so games never hold ghosts
  and idle proxies never drop us.
- **Authority**: the server never trusts damage, position jumps, cooldowns, item rolls
  or gold. It validates speed, range, cost, cooldown and line of sight, and it generates
  every item. The client is a renderer with an input device.
- **Chat**: game, lobby, whisper by name. Minimal filter; mute list.
- **Load test / gate for 100**: 100 bots (`node server/bots.js 100`) from a DIFFERENT
  machine than the server, 60 minutes, in ≥ 12 games: server step time p95 ≤ 25 ms and
  p99 ≤ 45 ms at 20 Hz, event-loop lag p95 ≤ 20 ms, RSS < 400 MB, average egress
  ≤ 20 KB/s per client. `GET /stats` exposes games, players, step p95/p99, lag, bytes
  in/out. Bots authenticate with a `BOT_KEY` env token that bypasses account creation
  and rate limits and is unset in production.

## Accounts (basic on purpose)
- Username (3–16 chars) + password (8+), `crypto.scrypt` with a per-user 16-byte salt
  (N=2^15, r=8, p=1; async, off the tick thread). No email, no recovery in v1 (say so on
  the sign-up screen). Session token in memory + localStorage; expires 30 days.
- Rate limits on login/create per IP. No PII beyond the username. 8 characters per
  account.
- SQLite: `accounts(id, name, hash, salt, created)`, `characters(id, account_id, name,
  class, hardcore, dead, data JSON, updated)`, `stash(account_id, hardcore, data JSON)`,
  `hall_of_dead(name, class, level, killed_by, when)`.

## UI (DOM over the canvas)
HUD: life/mana globes bottom corners, xp bar bottom edge, belt, skill bar (LMB/RMB +
1–4), target/boss bar top, minimap top-right (zone name, waypoint, exits), damage numbers,
chat bottom-left. Screens: inventory (grid + equipment paper doll + comparison
tooltips), character sheet, skill trees, stash, vendor, waypoint map, game lobby,
login, character select/create, hall of the dead, settings (audio, keybinds, damage
numbers, performance). Style: parchment-and-iron, pixel-ish font, rarity colours exact,
colour-blind shapes on rarity later.

## Audio
Port the FakeDMZ synth engine (buses, `osc`, `nz`, per-bus gains) and add sample hooks
keyed by name (`shared/data/sounds.js`). Needed early: hit ×3, crit, kill, loot drop by
rarity (the rare/unique "ding" matters), potion, level up, zone ambience per biome,
footsteps by surface, UI clicks, waypoint, death, boss roar. Music beds optional.

## Roadmap (ship and verify each phase; do not skip ahead)
- **P0 — Look, move, step (offline)**: `shared/sim/world.js` with one generated
  wilderness zone stepping headlessly under `node --test`; renderer draws it: flat-shaded
  chunked kit, lights + fog, isometric follow camera, player rig running, 40 idle
  monsters at 60 fps. Gate: the headless test passes and a screenshot reads as the style.
- **P1 — Kill and loot (offline)**: Warrior with the 6 Onslaught skills, monster AI,
  damage pipeline, damage numbers, deaths, drops with rarities and tooltips, the 12
  bases and 24 affixes, inventory grid, XP and levels, potions and belt.
  Gate: 10 minutes of fun in one zone.
- **P1.5 — Network spike (1 day)**: the shared world running in Node, one browser client
  over ws rendering its snapshots with the protocol above. Gate: it moves; no rewrite
  needed later.
- **P2 — Zones and persistence (offline)**: town + moor + crypt, exits, waypoints,
  stash, vendors, death/corpse/healer, the named bandit elite and necromancer boss as
  plain elites (multipliers, a name, 2 attacks, no modifiers yet), the two quest flags,
  Warrior complete (18 skills), localStorage save in the final document format.
  Gate: a character carries level, gear, corpse and stash across all three zones and a
  reload.
- **P3 — Online (10 players)**: server with accounts, lobby, games, authoritative world,
  snapshots, prediction, chat, saves, health/reconnect, Origin checks, pings.
  Gate: 10 real players in 2–3 games kill the crypt boss together with no desync and
  nobody loses a character.
- **P4 — Depth**: champion/boss modifiers, Paladin/Rogue/Cleric/Wizard trees, uniques and
  sets, difficulty tiers, hardcore + hall of the dead, gambling, respec.
- **P5 — Scale and polish**: the 100-bot gate, binary protocol if measurements demand
  it, glTF characters if wanted, music, keybinds, colour-blind rarity shapes.

## Non-goals (v1)
PvP, trading UI, crafting, sockets/runes, housing, mounts, voice, an open MMO world,
seasons/ladders, cosmetics shop, item identification. (Mobile controls were a non-goal
until 2026-09-21; the pointer-first scheme above covers phones.)

## Working conventions for Claude
- Commands: `node tools/test.js` (all headless tests), `node tools/validate.js` (table
  shapes), `node tools/serve.js` then `http://localhost:8642/` (game) and
  `http://localhost:8642/tools/` (preview pages). Golden hashes live in `shared/sim/golden.js`;
  changing one on purpose needs a NOTES.md line saying why.
- One system per file, files under ~600 lines. Pure sim code in `shared/sim` with tests
  under `node --test shared/`. No DOM or three.js imports in `shared/`.
- Data lives in `shared/data/*.js`; code reads tables, never hard-codes a number twice.
  The `/tools` validator checks every table's shape.
- Deterministic seeded rng everywhere gameplay-relevant (see the simulation contract).
- Every change: `node --check` the touched files, `node --test shared/`, open the
  client locally (`npx serve .` at the repo root), play the affected loop, keep the
  console clean. For server changes also run `node server/bots.js 10` for a minute and
  read `/stats`.
- Keep this file current: state, data schema changes, protocol changes, tunables, bugs
  worth remembering. Append a short entry to `NOTES.md` per shipped phase.
- Names: invent everything. If a name, item, monster, difficulty or mechanic term
  resembles a real game's, rename it before it reaches code.

## Reuse from the FakeDMZ project (copy, do not link)
Heightfield terrain + `groundH` + flattened pads + colliders; the box-rig skeleton and
procedural walk/idle; the WebAudio synth engine and bus layout; the draggable DOM window
helper for inventory/stash; the toast/float-text helpers. Leave behind: the desktop OS
layer, the cheat theme, the single-file constraint, `Math.random` in world generation.

## Decisions log (newest first; the sections above are already updated to match)
- **2026-09-21** Repo root is this folder (`D:Di`), git initialised on `main`, remote
  `origin` = `https://github.com/asdfqwertyjk/diblo` (public). Pages will serve from
  `main` / root at `https://asdfqwertyjk.github.io/diblo/`, so `ALLOWED_ORIGINS` must
  include `https://asdfqwertyjk.github.io`. Note: the repo name `diblo` is one letter
  from a real game's name; the owner may rename it (GitHub redirects, but the Pages URL
  changes, so do it before links go to friends). Claude commits per phase; the owner
  pushes, or runs `gh auth login` once so Claude can push. The original brief is kept
  untouched as `HACKSLASH-CLAUDE.md`; this file is the live one.
- **2026-09-21** Classes are Warrior / Paladin / Rogue / Cleric / Wizard. Warrior first.
  Zone and town names stay as written (Hollowmark, Gallowsmoor, Saltcrypt) unless the
  owner vetoes them.
- **2026-09-21** Look target: the feel of the 2000-era isometric hack-and-slash classics
  (dark, readable, loot-first), executed in original flat-shaded low poly. Nothing copied.
- **2026-09-21** FakeDMZ (`D:FakeDMZ`, single-file game in `build/modern-wallfare.html`)
  is a reference for design patterns only: `groundH` terrain, `makeRig` box rig,
  `osc`/`nz` synth buses, `toast`/`floatText`. Port the approach, rewrite the code
  to fit the module layout here.
- **2026-09-21** Server is written to Node 20 LTS semantics as specified, even though the
  dev machine runs Node 24. Use nothing newer than Node 20.12 supports.
- **2026-09-21** Claude verifies each gate itself (headless tests plus browser screenshots
  from a local static server). No mandatory owner review stop at P0.
- **2026-09-21** P1 scope answers: a minimal WebAudio synth ships in P1 (hit ×3, crit, kill,
  loot ding by rarity, potion, level up, UI click); death in P1 respawns at the zone entrance
  with −10% carried gold, gear kept; corpse/healer arrive with town in P2. Mobile: still a
  non-goal until the owner chose pointer-first controls the same day (see Controls);
  phones are a test target from P1.
- **2026-09-21** Vitals formula reading: `life = base + perLevel·(L−1) + perVit·VIT` with
  the class's full starting VIT counted (Warrior L1 = 120 life, 25 fury). Same shape for mana.
  Tune in P1 if the numbers feel off.
- **2026-09-21** Layout = `generateZone(recipe, seed)` (shape documented at the bottom of
  `sim/zonegen.js`): 1 m cells, cell types GRASS/WATER/CLIFF/PATH, a wandering flattened
  path from the entrance to every other exit, flattened pads at spawn and exits, a sealed
  2-cell border with 7-cell gaps at exits, one prop per grass cell at most, packs anchored
  one per 35 m spawn cell with member positions baked in. Tests prove the entrance reaches
  every exit on foot for eight seeds.
- **2026-09-21** Server hosting: the owner self-hosts on a spare **Windows** PC that is
  **always on**, where any software may be installed and Claude Code is already present.
  Claude writes `HOSTING.md` in P3 as the step-by-step setup, written so that Claude
  Code on that PC can execute it: install Node 20 LTS, clone the repo, install the tunnel
  client, register the server as a Windows service that restarts on boot and crash, set
  `DATA_DIR`, `ALLOWED_ORIGINS` and `BOT_KEY` (unset in production), and verify
  `/health` through the tunnel. `better-sqlite3` ships Windows x64 prebuilds for
  Node 20, so no build tools are needed there.
