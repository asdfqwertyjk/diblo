# Sim contract (P1) — read with CLAUDE.md "The simulation contract"

Everything under `shared/sim` is pure: no DOM, no three.js, no `Date`, no `Math.random`, no
`Math.sqrt/sin/cos/pow/…` (`sim/tests/forbidden.test.js` enforces it). Randomness comes from
the zone's streams: `zone.streams.combat` for hits, crits, AI choices; `zone.streams.loot`
for monster drops and item rolls. Data comes from `shared/data/*.js`; never restate a number.
Every rule constant lives in a table and `tools/validate.js` requires it: `classes.combat`
(armour DR, crit, block, resist caps), `classes.xp`, `classes.skillRules` (incl.
`knockbackTicks`), `monsters.curve` (incl. `dmgSpread fleeSec fleeArchetypes rangedArchetypes
ranged.arrowR`), `items.drop.baseLvlSlack`, `items.ground`. No sim module keeps a fallback copy.

## Tick order — `step(world)` in `world.js`
1. `world.tick++`.
2. For every zone with at least one player (zones without players do not tick):
   a. players: `stepPlayer(world, zone, e, intent)` (`player.js`) — one-shots, movement,
      skills, channel ticks, potions, regen, buffs, death timer.
   b. projectiles: `stepProjectiles(world, zone)` (`projectiles.js`).
   c. monsters: `stepMonsters(world, zone)` (`ai.js`).
   d. deaths: monsters at `hp <= 0` die once (`onMonsterDeath`): drops via `ground.js`,
      xp via `xp.js`, event `kill`; players at `hp <= 0` enter `dead` (`player.js`).
   e. cleanup: dead monsters removed `monsters.curve.dieTicks` (24) ticks after death.
3. delta / gone / events as in P0. `TRACKED` = `zone x z dx dz anim speed hp mp hpMax mpMax
   level xp gold dead stunUntil buffUntil invVer target statPoints skillPoints`. An entity's
   first-sight row is a projection, not the entity: the `FIRST_SIGHT` identity fields it has
   (`id kind type name cls r champion boss pack rig size family arch`, ground `item gold owner`,
   projectile `el src`) plus its `TRACKED` fields. Bags, cooldowns, `derived`, `lockUntil`,
   `lockAnim`, `heldSlot`, `channel`, `dash`, `kb`, `potion`, `beltCd`, `lastSeq`,
   `playTicks`, `derivedVer/Level` and monster `ai`/`armour`/`dmg`/`xpValue`/`dropTable` never
   leave the sim through delta; the client keys attack/stun FX off events. `invVer` bumps on
   any character-sheet change (bags, equipment, belt, a stat or skill point spent, a hotbar
   slot), so a server ships the owner its sheet (`stats statPoints skillPoints skills slots
   inventory equipment belt cooldowns`) whenever `invVer` appears in that player's delta.

`applyIntent(world, id, intent)` stores the latest intent; `step` reads it every tick.

## Intent
```
{ seq, mv:[x,z], aim:[x,z], target: entityId|null,
  skill: slotIndex|null,           // 0 lmb, 1 rmb, 2..5 keys 1..4; held: sent every tick
  use: beltSlot|null,              // one-shot: drink belt slot 0..3
  pick: groundItemId|null,         // one-shot
  act: {op, ...}|null }            // one-shot
```
`skill` is "held": the sim tries it every tick it is present and cooldown/lock/mana gate it.
`use`, `pick`, `act` are consumed once per distinct `seq` (`e.lastSeq`).

`act.op`: `move {iid, x, y}` (inventory cell; swaps with a single overlapping item when both
fit) · `equip {iid}` · `unequip {slot}` · `belt {iid, slot}` · `unbelt {slot}` (to inventory)
· `drop {iid}` (to the ground at the player; the scatter is a stateless hash of seed/iid/tick,
never the loot stream) · `stat {stat}` · `skill {id}` (spend a point) · `assign {slot, id}`
(hotbar; slot 0 must stay a skill) · `respawn`. `stat`, `skill` and `assign` bump `invVer`
when they change something.

## Entities (`world.ents[id]`, plain objects; all positions metres)
Common: `{id, kind, zone, x, z, dx, dz, anim, r, speed, hp, hpMax, dead}`.
`anim` ∈ `idle run attack hit die cast`.

**player** (`kind:'player'`, id `p<n>`): P0 fields plus
```
name cls level xp gold statPoints skillPoints deaths playtime
stats {str,dex,vit,ene}          // allocated totals (class start + points)
skills {skillId: rank}           // learned ranks
slots [6]                        // skillId|null for lmb rmb k1..k4; slots[0] is never null
inventory {w,h,items:[{iid,x,y,item}]}
equipment {weapon,shield,helm,chest,gloves,boots,belt,amulet,ring1,ring2}   // item|null
belt [4] of {potionId,count}|null
invVer                           // increments on any character-sheet change (bags, equipment, belt, points, hotbar)
derived                          // deriveStats(e) cache, recomputed when invVer/level change
derivedVer derivedLevel          // which invVer / level `derived` reflects
mp mpMax lastSeq lockUntil lockAnim ('attack'|'cast') heldSlot channel {id, nextTick}|null
cooldowns {skillId: readyTick} dash {id,dx,dz,left,step}|null
buffUntil buffDmgPct stunUntil kb {dx,dz,left,step}|null   // step = metres per tick
potion {hpLeft,hpPerTick,mpLeft,mpPerTick}|null beltCd {life,mana}
lastCombatTick deadAt respawnAt target playTicks (ticks toward the next playtime second)
```
Of these only the `TRACKED` ones reach a client through delta (tick order, step 3); the rest are
the sim's own bookkeeping.
**monster** (`kind:'monster'`, id `m<n>`): P0 fields plus
```
armour dmg [min,max] xpValue dropTable ('moorBasic'|'champion'|'boss') ilvl boss
ai {state, targetId, anchorX, anchorZ, nextThink, windupUntil, recoverUntil, fleeUntil}
stunUntil kb|null lastHitBy lastCombatTick deadAt   // dead monsters linger dieTicks, then gone
```
**item** (`kind:'item'`, id `g<n>`, ground drop): `{x, z, item|null, gold|0, owner:null}`.
Ground items have no `hp`, `anim`, `speed`; `r = items.ground.r`.
**proj** (`kind:'proj'`, id `q<n>`): `{x, z, dx, dz, speed, dmg, el:'phys', src, ttl, r: monsters.curve.ranged.arrowR}`.

## Modules and exports

### P0 modules (unchanged)
`sim/rng.js`: `hash32 hashString hashFloat(seed, a, b, c)` (stateless float in [0,1)) `makeRng
makeStreams` · `sim/dmath.js`: `clamp lerp smooth dist2 dsqrt dlen dnormInto DIR16` · `sim/noise.js`:
`vnoise2 fbm2` · `sim/zonegen.js`: `CELL INWARD generateZone cellAt walkableCell walkableAt
groundHeight layoutHash`.

### `sim/movement.js` (moved out of world.js)
`canStand(layout, x, z, r)` · `tryMove(zone, e, ddx, ddz)` (axis-separated slide + prop push-out)
· `moveToward(zone, e, tx, tz, maxStep)` → distance left · `applyKnockback(zone, e)` → true while
a knockback (`e.kb`) was active this tick. Also exports `BUCKET`, `buildColliderGrid(zone)`,
`pushOutOfColliders(zone, e)`.

### `sim/path.js`
`findPath(layout, sx, sz, tx, tz, maxExpand=4000, mask=layout.walk)` → `number[]` of
`[x0,z0,x1,z1,…]` cell-centre waypoints from the start (exclusive) to the target (inclusive),
`[]` when both share a cell, or `null` (target off-grid / not walkable / unreachable / budget). A* on the walk mask, 8-neighbour, no corner cutting (a diagonal needs both orthogonal
cells walkable), integer costs (10 straight, 14 diagonal), binary heap. `nearestWalkable(layout,
x, z, maxR=6)` → `[x,z]|null` (the point itself when its cell is walkable). `simplifyPath(layout, path, from=null,
mask)` removes waypoints with clear line-of-walk between neighbours (Bresenham over cells;
`from = [x,z]` lets the leading waypoints go too). Also `lineOfWalk(layout, ax, az, bx, bz, mask)`
and `buildNavMask(layout, r)` (walk mask with cells within `collider.r + r` of a prop cleared —
pass it as `mask` so routes bend around props). Client steering uses this; monster AI may later.

### `sim/stats.js`
`deriveVitals(doc)` (P0) · `AFFIX_STATS` (the affix `stat` keys deriveStats sums; validate.js
checks affixes against it) · `unarmedWeapon()` (from `classes.unarmed`) · `equipSlotOf(item)`
→ slot|null (plain `'ring'` maps to `ring1`; inventory.js and the bot use it) ·
`refreshDerived(e)` (recompute `e.derived`, copy `hpMax mpMax speed` onto the entity, clamp
hp/mp; player.js calls it when invVer/level change, xp.js on level up) · `deriveStats(e)` → object:
```
str dex vit ene hpMax mpMax armour block crit ias fcr frw mf goldFind lifeOnHit manaOnKill
flatPhys pctDmg fireDmg coldDmg lightDmg poisonDmg fireRes coldRes lightRes poisonRes
weapon {dmg:[min,max], speed, scaling, ranged, kind}   // unarmed from classes.unarmed
speed                                                  // runSpeed·(1+frw/100)
```
Rules (numbers from `classes.combat`): affix stats sum over equipped items; `allRes` adds to
each resist; resists cap `resCap`, floor `resFloor`; crit = `critBase` + dex·`critPerDex` +
affix crit, cap `critCap`; block = shield.block + dex/`blockDexDivisor`, cap `blockCap`,
0 without a shield; armour = Σ item armour·(1+pctArmour/100); hpMax/mpMax from `deriveVitals`
with the allocated stats plus affix life/mana. Requirements use the class's base + allocated
`str/dex` (not affix-boosted). `canEquip(e, item)` → `{ok, why}` checks lvlReq, reqs, the
class's `weapons` list for weapon kinds, and hands (2H removes the shield).

### `sim/itemgen.js`
`rollRarity(rng, mf)` · `pickBase(rng, {ilvl, slot?})` (weighted by `base.weight` among bases
whose crude `lvlReq ≤ ilvl + items.drop.baseLvlSlack`) · `generateItem(rng, {ilvl, rarity?, baseId?})` → item ·
`makePotion(potionId, count=1)` · `pickPotion(rng, ilvl)` · `rollDrops(rng, tableId, {ilvl, mf,
goldFind, mlvl})` → `[{item}|{gold:n}]` · `itemValue(item)` · `sellValue(item)` ·
`describe(item)` → lines for tooltips (plain strings) · `affixText(stat, value)` → one tooltip
line · `tierFor(ilvl)` · `affixDef(id)`. Item shape:
```
{ iid ('i' + two base-36 words of the rng + '.' + ilvl; potions without an rng use 'pot.<id>'),
  base, name, rarity, ilvl, tier,
  slot, kind, size:[w,h], hands?, dmg?:[min,max], armour?:n, block?:n, speed?, scaling?, ranged?,
  lvlReq, reqs:{str,dex}, affixes:[{id, stat, value, name, kind}], value,
  stack?:n, potion?:{kind, amount, overSec} }
```
Tier by ilvl from `items.tiers` (highest whose minIlvl ≤ ilvl) scales dmg/armour by `mult`,
lvlReq by `lvlReqAdd`, value by `valueMult`. Magic: prefix and/or suffix (at least one).
Rare: 3–6 affixes, ≤3 prefixes, ≤3 suffixes, one per group, name `<first> <second>` from
`rareNames`. Normal: no affixes. Affix eligibility: `slots` contains `'*'` or the item's slot
(rings match `ring1`/`ring2`). Tier pick: among tiers with `minIlvl <= ilvl`, weighted.
Value = `base.value·tierValueMult·rarityMult + Σ(tierIndex+1)·affixTierValue`; sell 25% cap 3000.

### `sim/inventory.js`
Pure grid ops on `e.inventory` and slots. Every call that takes the entity bumps `e.invVer`
when it changes something and returns `{ok, why?}`; the inventory-level ops `findSlot / place /
remove / entryOf` work on an inventory object and never bump. `ensureBags(e)` · `findSlot(inv,
size)` → `[x,y]|null` (row-major first fit) · `place(inv, item, x, y)` (rejects overlap, bounds
and a duplicate iid; potion iids get a suffix) · `remove(inv, iid)` → item|null · `entryOf(inv,
iid)` → row|null · `moveItem(e, iid, x, y)` · `equip(e, iid)` (uses `canEquip`; displaced items
go to the inventory or the op fails) · `unequip(e, slot)` · `toBelt(e, iid, slot)` ·
`fromBelt(e, slot)` · `refillBelt(e)` (pull matching potions from the inventory into non-full
belt slots) · `addItem(e, item)` (potions try the belt first, then the bag; stacks merge; an
item whose iid is already in the bag is refused with `why:'duplicate'`, never destroyed) ·
`dropItem(world, zone, e, iid)` (scatter from `hashFloat(world.seed, hashString(iid),
world.tick, k)`, so a player's drop never advances the loot stream).

### `sim/combat.js`
`playerAttackPacket(e, mult, rng, {element?, tick, weaponPctOverride?})` → `{phys, fire, cold,
light, poison, crit}` using weapon roll + flatPhys, ×(1+pctDmg/100), ×(1+STAT/100) with STAT =
weapon.scaling stat, ×`mult` (= skillMult from skills.js; `tick` = world.tick so Warcry applies), ×warcry (1+buffDmgPct/100 while `buffUntil > tick`), ×1.5 on crit;
elemental flat × skillMult too. `applyToMonster(world, zone, m, packet, srcId)` → dealt:
phys reduced by `armourDR(m.armour, e.level)` (`DR = armour/(armour+armourPerLevel·attackerLevel)`,
cap `armourCap`, from `classes.combat`), elements by monster resists (0 in P1), rounds to
integer ≥ 1, `m.hp -= dealt`, `m.lastHitBy`, `m.lastCombatTick`, event `hit`. A monster that is
`dead` or already at `hp <= 0` (killed earlier in the same tick) takes nothing and emits
nothing, so kill credit stays with the hit that took it through 0. `ELEMENTS` = `['fire',
'cold', 'light', 'poison']` (validate.js imports it). `monsterAttack(world, zone, m, p, rng)`:
dmg = roll(m.dmg), block roll first (`block` chance, physical only → event `block`, 0 dmg),
else DR by the player's armour vs `m.level`, ≥1, `p.hp -= dealt`, `p.lastCombatTick`, event `hit`.
Player attacks never miss. Life on hit / mana on kill applied here. `monsterAttack` takes an
optional 6th `{el, dmg, level}` (projectiles). `monsterStats(typeId, level, champion,
playersInGame, {dropTable?, boss?})` → `{hpMax, dmg:[min,max], armour, xpValue, speed, dropTable,
ilvl, arch}` per CLAUDE.md "Monster curve" (`monsters.curve`, dmg range `mid·(1 ∓ dmgSpread)`,
champion/boss `ilvl` bonus from `curve.champion.ilvl` / `curve.boss.ilvl`) and
`items.monsterArmourPerLevel`; `dropTable` is the zone recipe's for plain monsters,
`'champion'` / `'boss'` for ranks.

### `sim/xp.js`
Numbers from `classes.xp`. `xpToNext(L) = perLevelSq·L²` · `monsterXp(mlvl, champion, boss)`
(`monsterBase·mlvl·(1 + monsterPerLevel·mlvl)`, ×championMult / ×bossMult) · `penalty(clvl, mlvl)` ·
`coopMult(playersInGame)` · `grantXp(world, e, amount)` (levels up while `xp >= xpToNext`,
+statPoints +skillPoints, `stats.refreshDerived` + `derivedLevel`, full heal on level up, event `levelup`) ·
`shareKillXp(world, zone, m)` to every player in the zone within `classes.xpShareRange`.

### `sim/skills.js`
`skillRow(id)` → row|null · `secTicks(sec)` (re-export of world.js's; player.js and the tests
use it) · `ARC_COS` (literal cos(arc/2) table) · `skillMult(row, rank, e)` · `skillCost(row,
rank)` (cost + manaPerRank·(rank−1); a row with `cost: 0` stays free at every rank) · `swingTicks(e)` · `inArc(e, m, range, arc)` · `canUse(world, e, row)` → `{ok, why}`
(mana, cooldown, `lockUntil`, dead/stun) · `useSkill(world, zone, e, slotIndex, intent)`
dispatching on `row.kind` to `melee dash buff strike channel aoe` · `dashHit(world, zone, e,
id)` · `stepChannel(world, zone, e, intent)`. Hits walk `zone.ents` directly (no per-swing
arrays); knockbacks slide over `classes.skillRules.knockbackTicks`. Arc test: target inside `range + m.r` and
`dot(dir, toTarget) >= cos(arc/2)` using a literal cosine table for 60/90/120° (no Math.cos).
`melee/strike/aoe` resolve instantly and set `lockUntil = tick + swingTicks` where
`swingTicks = max(2, round(20·swingSec / (weapon.speed·(1+ias/100))))`. `dash` sets
`e.dash = {dx,dz,left:dashTicks,step:range/dashTicks}` consumed by `player.js` movement, hits at
the end. `channel` sets `e.channel = {id, nextTick}` while the slot is held; each tick due it
charges `costPerSec·tickEvery` mana, hits everything in `radius`, keeps `anim='attack'`; the
channel ends when the slot is released, mana runs out, or the player dies. `buff` sets
`buffUntil`, `buffDmgPct`. Events: `skill {pid, id, x, z, dx, dz, ax, az}` on every use/tick.
`aim` for skills = `intent.target`'s position when the target exists in this zone, else
`intent.aim`; the facing turns to it.

### `sim/ai.js`
`initMonsterAI(m)` (sets `m.ai` with the leash anchor at the monster's position; world.js calls it
per spawned monster) · `stepMonsters(world, zone)`. Timings from `monsters.curve` (`windup
attackEvery leash sight fleeBelow fleeSec fleeArchetypes rangedArchetypes meleeReach ranged`)
through `secTicks`. Per monster (skip dead/stunned; knockback first):
- `idle`: if a live player within `sight` (12 m) or the pack was alerted → `chase` and alert the
  pack (`pack` index) (event `aggro {id, type}` once per pack).
- `chase`: pick nearest live player in zone; if distance to anchor > `leash` (30) → `return`;
  melee: if within reach (`m.r + p.r + 0.5`) → `windup` (anim `attack`, `windupUntil = tick +
  10`); else `moveToward` at `speed·DT`. ranged: keep 6–9 m, fire when ≤ 10 m and in windup.
- `windup` → at `windupUntil`: melee hits if still within reach + 0.5 (`monsterAttack`), ranged
  spawns an arrow (`speed 16, dmg = m.dmg, ttl 40`), then `recover` until `attackStart + 24`.
- `flee` (`fleeArchetypes` under `fleeBelow` hp): run away from the target for `fleeSec`, then chase.
- `return`: walk to the anchor; on arrival heal to full, `idle`.
Uses `zone.streams.combat` only for the hit rolls inside `monsterAttack`. Champions: same brain.

### `sim/projectiles.js`
`spawnProjectile(world, zone, spec)` (defaults `speed ttl r` from `monsters.curve.ranged`
`arrowSpeed arrowTtlTicks arrowR`) · `stepProjectiles(world, zone)`: move `speed·DT`, hit the
first player within `r + p.r` (`monsterAttack`-style damage with `packet dmg`, event `hit`),
remove on hit, on `ttl` expiry, or when the cell is not walkable (walls stop arrows).

### `sim/ground.js`
`dropAt(world, zone, x, z, drops, owner = null, rng = zone.streams.loot)` scatters `{item|gold}`
entries into `kind:'item'` entities on walkable cells within `items.ground.scatterRadius`
(`scatterTries` attempts, `rng.between`; the loot stream for monster drops, a stateless hash
from `inventory.dropItem`) (event `drop {id, rarity|gold, x, z}`) · `tryPickup(world, zone, e,
id)` (range `classes.pickupRange`; gold → `e.gold` capped; potions/items via `addItem`; event
`pickup {pid, id, rarity, name, base, stack}` — `stack` = how many were taken, so a partly
taken potion stack reports the part — / `gold {pid, amount}` / `full {pid}`) · `autoPickup(world,
zone, e)` (gold and potions within `autoPickupRange`).

### `sim/player.js`
`newCharacterDoc(name, cls, seed = 0)` → a fresh document (toDoc shape): level 1, `startSkill` on
slot 0, the class weapon rolled plain from `makeRng(hash32(hashString(name), seed))` and equipped,
the belt filled from `classes.<cls>.startPotions`; character creation (offline client now, server
in P3) and the bot use it · `createPlayerEnt(world, zone, doc)` (used by `addPlayer`; applies
`startSkill` rank 1, `slots[0]`, inventory/equipment/belt from the doc or empty, `deriveStats`) ·
`toDoc(e)` (the persistence document, `v: 1`, byte-stable key order) · `killPlayer(world, zone,
e)` (flag dead once: hp 0, anim die, timers, event `death`; world.js's deaths phase calls it) ·
`respawn(world, zone, e)` · `predictPlayer(world, zone, e, intent)` → moved: the movement-only
tick for a predicting net client (knockback, stun, dash slide without its strike, `mv`, facing;
no one-shots, skills, channel, potions, regen, autoPickup — nothing that draws a stream) ·
`stepPlayer(world, zone, e, intent)`: consume
one-shots by `seq` (`act`, `use`, `pick`), then: dead → wait for `respawn` act or
`respawnAfterSec` then `respawn(world, zone, e)` (position = playerSpawn, full hp/mp, gold −10%,
event `respawn`); stun/knockback; dash step; skill (if `intent.skill != null`); channel tick;
movement (`mv`; blocked while `lockUntil > tick` unless channelling at `moveMult`); potion
effects; belt cooldowns; regen; `autoPickup`; `anim` selection (`die` when dead, `attack` while
locked/channelling, `run` when moving, else `idle`); facing.

### `sim/world.js`
`createWorld({recipes, seed, difficulty = 'dusk', startZone = classes.startZone})`, `ensureZone`
(unchanged; monsters now get `monsterStats` fields and `ai`, with player scaling frozen at spawn
time), `addPlayer` (delegates to `player.js`), `applyIntent`, `step` (tick order above; walks
`world.players` by index and reuses two module-level scratch lists, so a zone tick allocates
only delta/events), `removeEnt`, `onMonsterDeath(world, zone, m)` (idempotent: dead, anim die,
deadAt, drops on `zone.streams.loot` with the killer's mf/goldFind at `m.ilvl`, `shareKillXp`,
event `kill`), exports `TICK_HZ DT secTicks(sec) TRACKED FIRST_SIGHT` and re-exports `canStand`.
A fresh character comes from `player.newCharacterDoc` (class weapon + starting belt).

## Events (`step().events`, plain objects, `k` first)
```
spawn {id}                       kill {id, by, x, z, champion, type}
hit {src, tgt, dmg, crit, el, x, z}   block {pid}
death {id, x, z}                 respawn {id}
drop {id, rarity|'gold', x, z}   pickup {pid, id, rarity, name, base, stack}   gold {pid, amount}   full {pid}
potion {pid, kind}               xp {pid, amount}           levelup {pid, level}
skill {pid, id, x, z, dx, dz, ax, az}   aggro {id, type}    stun {id, ticks}
equip {pid, iid}                 invalid {pid, why}         proj {id}
```
The renderer and audio key FX off these; nothing in the client infers a hit from hp deltas.

## Tests every module ships (node --test, deterministic)
Formulas against the numbers in CLAUDE.md; determinism (two worlds, same seed, same scripted
intents, 2000 ticks, identical JSON); itemgen distributions over 20k rolls (rarity within ±1.5
points of the table, one affix per group, tiers legal for ilvl, names non-empty, values
positive); inventory placement/overlap/swap/equip/unequip/2H-shield rules; path A* finds the
spawn→exit route the P0 BFS test proves exists and never cuts corners; AI aggro/leash/flee;
death/respawn/gold loss; potions and belt refill; xp levels and points; corpse cleanup after
`dieTicks`; tracked deltas (hp, gold, invVer, target, statPoints) and the first-sight projection;
zones without players do not tick; spawn-time player scaling; stat/skill/assign bump invVer;
predictPlayer moves without streams; forbidden-call scan still green; golden hashes unchanged.
