// tools/test.js — run every *.test.js under shared/ with node --test.
// A script rather than a glob so it behaves the same on Node 20 and 24, Windows and Linux.
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

const files = collect(join(root, 'shared'));
const extra = process.argv.slice(2);
const r = spawnSync(process.execPath, ['--test', ...extra, ...files], { stdio: 'inherit', cwd: root });
process.exit(r.status ?? 1);
