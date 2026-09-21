// client/src/ui/hud.js — the P0 debug HUD: a small top-left panel over the canvas.
// createHud(root) → { set(fields), toggle(), el }. Fields: zone, seed, fps, tick, ents, calls.
// Self-styled (parchment-and-iron) so it works on any page; pointer-events none.

const FONT = 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, Menlo, monospace';
const HINT = 'WASD move · mouse aim · wheel/Z zoom · H hide hud';

const ROWS = [
  ['zone', 'zone'],
  ['seed', 'seed'],
  ['fps', 'fps'],
  ['tick', 'tick'],
  ['ents', 'ents'],
  ['calls', 'draw'],
];

function format(key, v) {
  if (v == null) return '—';
  if (typeof v === 'number') return key === 'fps' ? String(Math.round(v)) : String(v);
  return String(v);
}

export function createHud(root) {
  const panel = document.createElement('div');
  panel.className = 'hud-panel';
  panel.style.cssText = [
    'position:absolute', 'left:12px', 'top:12px', 'padding:8px 11px 7px',
    'background:rgba(26,23,18,0.86)', 'color:#d8c8a0', 'border:1px solid #6b5a3a',
    'border-radius:2px', 'box-shadow:0 2px 10px rgba(0,0,0,0.45)',
    'font:12px/1.5 ' + FONT, 'letter-spacing:0.02em', 'white-space:nowrap',
    'pointer-events:none', 'user-select:none', 'text-shadow:0 1px 0 #000',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'HOLLOWMARK';
  title.style.cssText = 'font-weight:700;letter-spacing:0.18em;color:#c8a24a;margin-bottom:3px;font-size:11px';
  panel.appendChild(title);

  const values = {};
  const shown = {};
  for (let i = 0; i < ROWS.length; i++) {
    const [key, label] = ROWS[i];
    const row = document.createElement('div');
    const k = document.createElement('span');
    k.textContent = label.padEnd(5, ' ');
    k.style.cssText = 'color:#8f7c58;white-space:pre';
    const v = document.createElement('span');
    v.textContent = '—';
    row.appendChild(k); row.appendChild(v);
    panel.appendChild(row);
    values[key] = v;
    shown[key] = '—';
  }

  const hint = document.createElement('div');
  hint.textContent = HINT;
  hint.style.cssText = 'margin-top:5px;padding-top:4px;border-top:1px solid #4a3f2a;color:#a08d64;font-size:11px';
  panel.appendChild(hint);

  root.appendChild(panel);
  let visible = true;

  /** Update whichever fields are present; untouched DOM when a value has not changed. */
  function set(fields) {
    if (!fields) return;
    for (const key in fields) {
      const el = values[key];
      if (!el) continue;
      const text = format(key, fields[key]);
      if (text !== shown[key]) { shown[key] = text; el.textContent = text; }
    }
  }

  function toggle(force) {
    visible = force == null ? !visible : !!force;
    panel.style.display = visible ? '' : 'none';
    return visible;
  }

  return { set, toggle, el: panel, get visible() { return visible; } };
}
