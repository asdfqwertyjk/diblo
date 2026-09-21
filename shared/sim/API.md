# Sim contract (P1) — read with CLAUDE.md "The simulation contract"

Everything under `shared/sim` is pure: no DOM, no three.js, no `Date`, no `Math.random`, no
`Math.sqrt/sin/cos/pow/…` (`sim/tests/forbidden.test.js` enforces it). Randomness comes from
the zone's streams: `zone.streams.combat` for hits, crits, AI choices; `zone.streams.loot`
for drops and item rolls. Data comes from `shared/data/*.js`; never restate a number.

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
3. delta / gone / events as in P0; `TRACKED` now also includes `hpMax mpMax level xp gold
   dead stun buffUntil invVer target`.

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
· `drop {iid}` (to the ground at the player) · `stat {stat}` · `skill {id}` (spend a point) ·
`assign {slot, id}` (hotbar; slot 0 must stay a skill) · `respawn`.

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
invVer                           // increments on any inventory/equipment/belt change
derived                          // deriveStats(e) cache, recomputed when invVer/stats/level change
mp mpMax lastSeq lockUntil channel {id, nextTick}|null cooldowns {skillId: readyTick}
buffUntil buffDmgPct stunUntil kb {dx,dz,left}|null
potion {hpLeft,hpPerTick,mpLeft,mpPerTick}|null beltCd {life,mana}
lastCombatTick deadAt respawnAt target
```
**monster** (`kind:'monster'`, id `m<n>`): P0 fields plus
```
armour dmg [min,max] xpValue dropTable ('moorBasic'|'champion'|'boss')
ai {state, targetId, anchorX, anchorZ, nextThink, windupUntil, recoverUntil, fleeUntil}
stunUntil kb|null lastHitBy deadAt
```
**item** (`kind:'item'`, id `g<n>`, ground drop): `{x, z, item|null, gold|0, owner:null, born}`.
Ground items have no `hp`, `anim`, `speed`; `r = 0.4`.
**proj** (`kind:'proj'`, id `q<n>`): `{x, z, dx, dz, speed, dmg, el:'phys', src, ttl, r:0.2}`.

## Modules and exports

### `sim/movement.js` (moved out of world.js)
`canStand(layout, x, z, r)` · `tryMove(zone, e, ddx, ddz)` (axis-separated slide + prop push-out)
· `moveToward(zone, e, tx, tz, maxStep)` → distance left · `applyKnockback(zone, e)`.

### `sim/path.js`
`findPath(layout, sx, sz, tx, tz, maxExpand=4000)` → `Float64Array|number[]` of
`[x0,z0,x1,z1,…]` cell-centre waypoints from the start (exclusive) to the target (inclusive), or
`null`. A* on the walk mask, 8-neighbour, no corner cutting (a diagonal needs both orthogonal
cells walkable), integer costs (10 straight, 14 diagonal), binary heap. `nearestWalkable(layout,
x, z, maxR=6)` → `[x,z]|null`. `simplifyPath(layout, path)` removes waypoints with clear
line-of-walk between neighbours (Bresenham over cells). Client steering uses this; monster AI
may later.

### `sim/stats.js`
`deriveVitals(doc)` (P0) · `deriveStats(e)` → object:
```
str dex vit ene hpMax mpMax armour block crit ias fcr frw mf goldFind lifeOnHit manaOnKill
flatPhys pctDmg fireDmg coldDmg lightDmg poisonDmg fireRes coldRes lightRes poisonRes
weapon {dmg:[min,max], speed, scaling, ranged, kind}   // unarmed from classes.unarmed
speed                                                  // runSpeed·(1+frw/100)
```
Rules: affix stats sum over equipped items; `allRes` adds to each resist; resists cap 75,
floor −100; crit = 5 + dex·0.1 + affix crit, cap 50; block = shield.block + dex/40, cap 50,
0 without a shield; armour = Σ item armour·(1+pctArmour/100); hpMax/mpMax from `deriveVitals`
with the allocated stats plus affix life/mana. Requirements use the class's base + allocated
`str/dex` (not affix-boosted). `canEquip(e, item)` → `{ok, why}` checks lvlReq, reqs, the
class's `weapons` list for weapon kinds, and hands (2H removes the shield).

### `sim/itemgen.js`
`rollRarity(rng, mf)` · `pickBase(rng, {ilvl, slot?})` (weighted by `base.weight` among bases
whose crude `lvlReq ≤ ilvl + 2`) · `generateItem(rng, {ilvl, rarity?, baseId?})` → item ·
`makePotion(potionId, count=1)` · `pickPotion(rng, ilvl)` · `rollDrops(rng, tableId, {ilvl, mf,
goldFind, mlvl})` → `[{item}|{gold:n}]` · `itemValue(item)` · `sellValue(item)` ·
`describe(item)` → lines for tooltips (plain strings). Item shape:
```
{ iid (unique string from rng.next().toString(36)+ilvl), base, name, rarity, ilvl, tier,
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
Pure grid ops on `e.inventory` and slots; every mutating call bumps `e.invVer` and returns
`{ok, why?}`: `findSlot(inv, size)` → `[x,y]|null` (row-major first fit) · `place(inv, item, x, y)`
· `remove(inv, iid)` → item|null · `moveItem(e, iid, x, y)` · `equip(e, iid)` (uses `canEquip`;
displaced items go to the inventory or the op fails) · `unequip(e, slot)` · `toBelt(e, iid, slot)`
· `fromBelt(e, slot)` · `refillBelt(e)` (pull matching potions from the inventory into
non-full belt slots) · `addItem(e, item)` (potions try the belt first, then the bag; stacks merge)
· `dropItem(world, zone, e, iid)`.

### `sim/combat.js`
`playerAttackPacket(e, skill, rank, rng)` → `{phys, fire, cold, light, poison, crit}` using
weapon roll + flatPhys, ×(1+pctDmg/100), ×(1+STAT/100) with STAT = weapon.scaling stat,
×skillMult (skills.js), ×warcry (1+buffDmgPct/100 while `buffUntil > tick`), ×1.5 on crit;
elemental flat × skillMult too. `applyToMonster(world, zone, m, packet, srcId)` → dealt:
phys reduced by `armourDR(m.armour, e.level)` (`DR = armour/(armour+25·attackerLevel)`,
cap 0.6), elements by monster resists (0 in P1), rounds to integer ≥ 1, `m.hp -= dealt`,
`m.lastHitBy`, `m.lastCombatTick`, event `hit`. `monsterAttack(world, zone, m, p, rng)`:
dmg = roll(m.dmg), block roll first (`block` chance, physical only → event `block`, 0 dmg),
else DR by the player's armour vs `m.level`, ≥1, `p.hp -= dealt`, `p.lastCombatTick`, event `hit`.
Player attacks never miss. Life on hit / mana on kill applied here. `monsterStats(typeId,
level, champion, playersInGame)` → `{hpMax, dmg:[min,max], armour, xpValue, speed, dropTable}`
per CLAUDE.md "Monster curve" and `items.monsterArmourPerLevel`.

### `sim/xp.js`
`xpToNext(L) = 100·L²` · `monsterXp(mlvl, champion, boss)` · `penalty(clvl, mlvl)` ·
`coopMult(playersInGame)` · `grantXp(world, e, amount)` (levels up while `xp >= xpToNext`,
+statPoints +skillPoints, full heal on level up, `deriveStats`, event `levelup`) ·
`shareKillXp(world, zone, m)` to every player in the zone within `classes.xpShareRange`.

### `sim/skills.js`
`skillMult(row, rank, e)` · `skillCost(row, rank)` · `canUse(world, e, row)` → `{ok, why}` (mana,
cooldown, `lockUntil`, dead/stun) · `useSkill(world, zone, e, slotIndex, intent)` dispatching on
`row.kind` to `melee dash buff strike channel aoe`. Arc test: target inside `range + m.r` and
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
`stepMonsters(world, zone)`. Per monster (skip dead/stunned; knockback first):
- `idle`: if a live player within `sight` (12 m) or the pack was alerted → `chase` and alert the
  pack (`pack` index) (event `aggro {id, type}` once per pack).
- `chase`: pick nearest live player in zone; if distance to anchor > `leash` (30) → `return`;
  melee: if within reach (`m.r + p.r + 0.5`) → `windup` (anim `attack`, `windupUntil = tick +
  10`); else `moveToward` at `speed·DT`. ranged: keep 6–9 m, fire when ≤ 10 m and in windup.
- `windup` → at `windupUntil`: melee hits if still within reach + 0.5 (`monsterAttack`), ranged
  spawns an arrow (`speed 16, dmg = m.dmg, ttl 40`), then `recover` until `attackStart + 24`.
- `flee` (swarm archetype under `fleeBelow` hp): run away from the target for 60 ticks, then chase.
- `return`: walk to the anchor; on arrival heal to full, `idle`.
Uses `zone.streams.combat` only for the hit rolls inside `monsterAttack`. Champions: same brain.

### `sim/projectiles.js`
`spawnProjectile(world, zone, spec)` · `stepProjectiles(world, zone)`: move `speed·DT`, hit the
first player within `r + p.r` (`monsterAttack`-style damage with `packet dmg`, event `hit`),
remove on hit, on `ttl` expiry, or when the cell is not walkable (walls stop arrows).

### `sim/ground.js`
`dropAt(world, zone, x, z, drops)` scatters `{item|gold}` entries into `kind:'item'` entities on
walkable cells within 1.5 m (event `drop {id, rarity|gold}`) · `tryPickup(world, zone, e, id)`
(range `classes.pickupRange`; gold → `e.gold` capped; potions/items via `addItem`; event
`pickup {pid, id, rarity}` / `gold {pid, amount}` / `full {pid}`) · `autoPickup(world, zone, e)`
(gold and potions within `autoPickupRange`).

### `sim/player.js`
`createPlayerEnt(world, zone, doc)` (used by `addPlayer`; applies `startSkill` rank 1, `slots[0]`,
inventory/equipment/belt from the doc or empty, `deriveStats`) · `toDoc(e)` (the persistence
document, `v: 1`, byte-stable key order) · `stepPlayer(world, zone, e, intent)`: consume
one-shots by `seq` (`act`, `use`, `pick`), then: dead → wait for `respawn` act or
`respawnAfterSec` then `respawn(world, zone, e)` (position = playerSpawn, full hp/mp, gold −10%,
event `respawn`); stun/knockback; dash step; skill (if `intent.skill != null`); channel tick;
movement (`mv`; blocked while `lockUntil > tick` unless channelling at `moveMult`); potion
effects; belt cooldowns; regen; `autoPickup`; `anim` selection (`die` when dead, `attack` while
locked/channelling, `run` when moving, else `idle`); facing.

### `sim/world.js`
`createWorld`, `ensureZone` (unchanged; monsters now get `monsterStats` fields and `ai`),
`addPlayer` (delegates to `player.js`), `applyIntent`, `step` (tick order above), `removeEnt`,
`onMonsterDeath(world, zone, m)`, exports `TICK_HZ DT TRACKED`.

## Events (`step().events`, plain objects, `k` first)
```
spawn {id}                       kill {id, by, x, z, champion, type}
hit {src, tgt, dmg, crit, el, x, z, blocked?}  block {pid}
death {id, x, z}                 respawn {id}
drop {id, rarity|'gold', x, z}   pickup {pid, id, rarity}   gold {pid, amount}   full {pid}
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
death/respawn/gold loss; potions and belt refill; xp levels and points; forbidden-call scan
still green; golden hashes unchanged.
