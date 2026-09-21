// tools/validate.js — shape checks for every data table. Run: node tools/validate.js
import classes from '../shared/data/classes.js';
import monsters from '../shared/data/monsters.js';
import recipes from '../shared/data/zones/index.js';

const errors = [];
const fail = (msg) => errors.push(msg);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isColour = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffff;
const need = (obj, keys, where) => { for (const k of keys) if (!(k in obj)) fail(`${where}: missing ${k}`); };

// classes
need(classes, ['maxLevel', 'statPointsPerLevel', 'skillPointsPerLevel', 'startZone', 'classes'], 'classes');
if (!recipes[classes.startZone]) fail(`classes.startZone ${classes.startZone} is not a zone`);
for (const [id, c] of Object.entries(classes.classes)) {
  const w = 'classes.' + id;
  need(c, ['name', 'stats', 'life', 'mana', 'runSpeed', 'radius', 'palette', 'trees', 'weapon'], w);
  for (const s of ['str', 'dex', 'vit', 'ene']) if (!isNum(c.stats?.[s])) fail(`${w}.stats.${s}`);
  for (const k of ['base', 'perLevel', 'perVit']) if (!isNum(c.life?.[k])) fail(`${w}.life.${k}`);
  for (const k of ['base', 'perLevel', 'perEne']) if (!isNum(c.mana?.[k])) fail(`${w}.mana.${k}`);
  for (const [k, v] of Object.entries(c.palette || {})) if (!isColour(v)) fail(`${w}.palette.${k} not a colour`);
  for (const t of c.trees || []) need(t, ['id', 'name'], w + '.trees');
}

// monsters
need(monsters, ['curve', 'archetypes', 'families', 'types', 'modifiers'], 'monsters');
for (const [id, a] of Object.entries(monsters.archetypes)) for (const k of ['hp', 'dmg', 'speed']) if (!isNum(a[k])) fail(`archetype ${id}.${k}`);
for (const [id, f] of Object.entries(monsters.families)) for (const [k, v] of Object.entries(f.palette || {})) if (!isColour(v)) fail(`family ${id}.palette.${k}`);
for (const [id, t] of Object.entries(monsters.types)) {
  const w = 'monsters.types.' + id;
  need(t, ['name', 'family', 'arch', 'rig', 'size', 'r'], w);
  if (!monsters.families[t.family]) fail(`${w}: unknown family ${t.family}`);
  if (!monsters.archetypes[t.arch]) fail(`${w}: unknown archetype ${t.arch}`);
  if (!['biped', 'quad', 'bird'].includes(t.rig)) fail(`${w}: unknown rig ${t.rig}`);
  if (t.palette) for (const [k, v] of Object.entries(t.palette)) if (!isColour(v)) fail(`${w}.palette.${k}`);
}
for (const [id, m] of Object.entries(monsters.modifiers)) if (!m.name) fail(`modifier ${id}: missing name`);

// zones
for (const [id, r] of Object.entries(recipes)) {
  const w = 'zone ' + id;
  need(r, ['id', 'name', 'kind', 'size', 'biome', 'terrain', 'spawns', 'exits', 'level', 'dropTable'], w);
  if (r.id !== id) fail(`${w}: id mismatch ${r.id}`);
  if (!['wilderness', 'cave', 'crypt', 'town'].includes(r.kind)) fail(`${w}: kind ${r.kind}`);
  if (!Number.isInteger(r.size) || r.size % 32 !== 0) fail(`${w}: size must be a multiple of 32`);
  need(r.biome, ['sky', 'fog', 'sun', 'hemi', 'ground', 'props', 'exitProp'], w + '.biome');
  for (const [k, v] of Object.entries(r.biome.ground || {})) if (!isColour(v)) fail(`${w}.biome.ground.${k}`);
  for (const p of r.biome.props || []) {
    need(p, ['kind', 'density', 'r', 'variants'], w + '.biome.props');
    if (p.density < 0 || p.density > 0.2) fail(`${w}: prop ${p.kind} density ${p.density}`);
  }
  need(r.terrain, ['scale', 'octaves', 'amp', 'waterLine', 'cliffSlope', 'padRadius', 'padFalloff', 'pathWidth', 'pathWander', 'pathDamp', 'pathFalloff'], w + '.terrain');
  need(r.spawns, ['types', 'cellSize', 'packMin', 'packMax', 'championChance', 'minDistFromSpawn', 'packRadius'], w + '.spawns');
  for (const t of r.spawns.types || []) if (!monsters.types[t]) fail(`${w}: spawn type ${t} is not in monsters.types`);
  if (r.spawns.packMin > r.spawns.packMax) fail(`${w}: packMin > packMax`);
  if (!Array.isArray(r.exits) || r.exits.length < 1) fail(`${w}: needs at least one exit (the entrance)`);
  for (const e of r.exits || []) {
    need(e, ['to', 'side'], w + '.exits');
    if (!['north', 'south', 'east', 'west'].includes(e.side)) fail(`${w}: exit side ${e.side}`);
  }
  for (const d of ['dusk', 'blight', 'hollow']) {
    const band = r.level?.[d];
    if (!Array.isArray(band) || band.length !== 2 || band[0] > band[1]) fail(`${w}.level.${d}`);
  }
}

if (errors.length) {
  console.error('validate: ' + errors.length + ' problem(s)');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`validate: ok (${Object.keys(classes.classes).length} classes, ${Object.keys(monsters.types).length} monster types, ${Object.keys(recipes).length} zones)`);
