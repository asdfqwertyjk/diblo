// Guards the determinism contract: gameplay code in shared/ never calls anything whose
// result can differ between engines, and never touches the DOM, three.js or the clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'tests') walk(p, out); }
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const FORBIDDEN = [
  /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|pow|exp|expm1|log|log2|log10|log1p|random|sqrt|cbrt|hypot|fround)\b/,
  /\*\*/,
  /\bDate\b/,
  /performance\.now/,
  /\b(document|window|navigator|localStorage|requestAnimationFrame)\b/,
  /from\s+['"]three/,
  /\bsetTimeout\b|\bsetInterval\b/,
];

test('shared/ uses only deterministic math and no platform APIs', () => {
  const files = walk(root);
  assert.ok(files.length >= 8, 'found ' + files.length + ' files');
  const bad = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const re of FORBIDDEN) {
      const m = src.match(re);
      if (m) bad.push(`${f.slice(root.length)}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('no shared/ file grows past 600 lines', () => {
  for (const f of walk(root)) {
    const lines = readFileSync(f, 'utf8').split('\n').length;
    assert.ok(lines <= 600, `${f} has ${lines} lines`);
  }
});
