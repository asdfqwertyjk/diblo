// A headless bot plays the moor for ten minutes (12,000 ticks) through the public world API
// only (createWorld / addPlayer / applyIntent / step) and proves the whole P1 loop hangs
// together: kills, drops, pickups, equipment, potions, xp, deaths, respawns — deterministic,
// NaN-free and fast enough for a server tick. The bot itself lives in ./bot.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../player.js';
import { playBot, summaryLine } from './bot.js';

const SEED = 1234;
const TICKS = 12000;          // 10 minutes at 20 Hz

function hasNaN(v, path, out) {
  if (typeof v === 'number') { if (v !== v) out.push(path); return; }
  if (v && typeof v === 'object') for (const k in v) hasNaN(v[k], path + '.' + k, out);
}

test('a bot plays 10 minutes on seed 1234: kills, levels, loot, potions, few deaths, no NaN, deterministic, fast', () => {
  const a = playBot(SEED, TICKS);
  console.log(summaryLine(a));
  assert.ok(a.kills >= 20, 'kills ' + a.kills);
  assert.ok(a.level >= 3, 'level ' + a.level);
  assert.ok(a.deaths <= 4, 'deaths ' + a.deaths);
  assert.ok(a.picked >= 5, 'items picked ' + a.picked);
  assert.ok(a.gold > 0, 'gold ' + a.gold);
  assert.ok(a.magicDrops >= 1, 'no magic drop seen');
  assert.ok(a.hits > 0 && a.potions > 0, 'the bot fought and drank');
  const nan = [];
  hasNaN(a.world.ents, 'ents', nan);
  assert.deepEqual(nan, [], 'NaN in world.ents');
  assert.ok(a.ms < 8000, 'took ' + a.ms.toFixed(0) + ' ms');
  const b = playBot(SEED, TICKS);
  assert.equal(JSON.stringify(a.world.ents), JSON.stringify(b.world.ents), 'final ents differ between two runs');
  assert.equal(JSON.stringify(toDoc(a.player)), JSON.stringify(toDoc(b.player)));
  assert.equal(a.world.tick, b.world.tick);
  assert.deepEqual([a.kills, a.deaths, a.picked, a.gold], [b.kills, b.deaths, b.picked, b.gold]);
});
