// client/src/ui/panels.js — the panel registry: one panel open at a time, ESC closes.
// createPanels(root) → { register(name, panel), unregister(name), open(name), close(name),
// toggle(name), isOpen(name), closeAll(), current(), onChange(cb), dispose() }.
// A `panel` is anything with open() / close() / isOpen() (a createWindow result, or a panel
// module wrapping one). The window is the source of truth: the registry never keeps its own
// open flag, so a window closed by its × button reads as closed here too. `root` gets the
// class `hm-panel-open` while any panel is open (css hooks; the HUD can dim under a sheet).
export function createPanels(root) {
  const reg = new Map();
  const listeners = [];
  let disposed = false;

  function emit() {
    const name = current();
    if (root && root.classList) root.classList.toggle('hm-panel-open', name != null);
    for (let i = 0; i < listeners.length; i++) listeners[i](name);
  }

  function register(name, panel) {
    if (!panel || typeof panel.open !== 'function' || typeof panel.isOpen !== 'function') {
      throw new Error('panels.register(' + name + '): a panel needs open/close/isOpen');
    }
    reg.set(name, panel);
    if (panel.isOpen()) open(name);     // registered already open → it becomes the one
    return panel;
  }

  function unregister(name) {
    const p = reg.get(name);
    if (!p) return;
    if (p.isOpen()) p.close();
    reg.delete(name);
    emit();
  }

  /** First open panel's name, or null. */
  function current() {
    for (const [name, p] of reg) if (p.isOpen()) return name;
    return null;
  }

  function isOpen(name) {
    const p = reg.get(name);
    return !!p && p.isOpen();
  }

  function open(name) {
    const p = reg.get(name);
    if (!p) return false;
    for (const [other, q] of reg) if (other !== name && q.isOpen()) q.close();
    if (!p.isOpen()) p.open();
    emit();
    return true;
  }

  function close(name) {
    const p = reg.get(name);
    if (!p) return false;
    if (p.isOpen()) p.close();
    emit();
    return true;
  }

  function toggle(name) {
    const p = reg.get(name);
    if (!p) return false;
    if (p.isOpen()) close(name); else open(name);
    return p.isOpen();
  }

  function closeAll() {
    let any = false;
    for (const [, p] of reg) if (p.isOpen()) { p.close(); any = true; }
    emit();
    return any;
  }

  /** cb(openName|null) after every registry-driven change. Returns an unsubscribe. */
  function onChange(cb) {
    listeners.push(cb);
    return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
  }

  function isTyping(t) {
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function onKey(e) {
    if (e.code !== 'Escape' && e.key !== 'Escape') return;
    if (isTyping(e.target)) return;
    if (current() == null) return;
    e.preventDefault();
    closeAll();
  }
  window.addEventListener('keydown', onKey);

  /** A window closed by its own × does not pass through the registry: after any pointerup has
   *  finished dispatching (setTimeout 0, so the button's own handler has run), re-check. */
  function check() {
    if (disposed) return;
    const was = root && root.classList ? root.classList.contains('hm-panel-open') : false;
    if (was !== (current() != null)) emit();
  }
  function onPointerUp() { if (!disposed) setTimeout(check, 0); }
  window.addEventListener('pointerup', onPointerUp, true);

  function dispose() {
    disposed = true;
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointerup', onPointerUp, true);
    reg.clear();
    listeners.length = 0;
  }

  return { register, unregister, open, close, toggle, isOpen, closeAll, current, onChange, dispose };
}
