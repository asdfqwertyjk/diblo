// client/src/input/input.js — keyboard + pointer → raw state for the steering module.
// createInput(canvas) → { keys: Set<code>, pointer: {down, button, buttons, ndcX, ndcY, touch, id},
//   onKey(cb), onWheel(cb), onPointerDown(cb), onPointerUp(cb), dispose() }.
// Pointer events only (one scheme for mouse, touch and pen): the first pointer that goes
// down on the canvas is captured until it lifts; other fingers are ignored meanwhile.
// `pointer.touch` is true for touch and pen so the pick radius can grow. `buttons` is the
// live bitmask (1 LMB, 2 RMB, 4 MMB; 1 for a finger) so a chord (RMB while LMB is held)
// is visible, and onPointerDown / onPointerUp fire per button bit: cb(button, pointer, event).
// keys holds WASD (and everything else) by KeyboardEvent.code; onKey(cb) fires cb(code, event)
// on every non-repeat keydown. contextmenu, the TAB/Space/Alt defaults and text selection are
// prevented. The pointer object is reused; callers copy what they keep.

const PREVENT_DOWN = new Set(['Tab', 'Space', 'AltLeft', 'AltRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const PREVENT_UP = new Set(['AltLeft', 'AltRight']);   // Firefox/Windows raise the menu bar on Alt keyup
const BUTTON_BITS = [1, 4, 2];                          // e.button index (0 LMB, 1 MMB, 2 RMB) → e.buttons bit

/** True when the event's target takes text (a future chat box): keys must not reach the game. */
function typing(e) {
  const t = e.target;
  if (!t || t === document.body || t === window) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
}

export function createInput(canvas) {
  const keys = new Set();
  const pointer = { down: false, button: -1, buttons: 0, ndcX: 0, ndcY: 0, touch: false, id: -1 };
  const keyCbs = [];
  const wheelCbs = [];
  const downCbs = [];
  const upCbs = [];

  function fire(list, a, b, c) { for (let i = 0; i < list.length; i++) list[i](a, b, c); }

  // --- keyboard ---------------------------------------------------------------------
  function onKeyDown(e) {
    if (typing(e)) return;
    if (PREVENT_DOWN.has(e.code)) e.preventDefault();
    if (e.repeat) return;                 // held keys stay in the set; one-shot callbacks fire once
    keys.add(e.code);
    fire(keyCbs, e.code, e);
  }
  function onKeyUp(e) {
    if (PREVENT_UP.has(e.code)) e.preventDefault();
    keys.delete(e.code);
  }
  function onBlur() { keys.clear(); release(null); }

  // --- pointer ----------------------------------------------------------------------
  function setNdc(e) {
    // the canvas is full-window (index.html), so the window size is the canvas size
    const w = window.innerWidth || 1, h = window.innerHeight || 1;
    pointer.ndcX = (e.clientX / w) * 2 - 1;
    pointer.ndcY = -(e.clientY / h) * 2 + 1;
  }

  /** Fire down/up callbacks for every button bit that changed between `prev` and `next`. */
  function diffButtons(prev, next, e) {
    if (prev === next) return;
    for (let i = 0; i < BUTTON_BITS.length; i++) {
      const bit = BUTTON_BITS[i];
      if ((next & bit) && !(prev & bit)) fire(downCbs, i, pointer, e);
      else if ((prev & bit) && !(next & bit)) fire(upCbs, i, pointer, e);
    }
  }

  function onPointerDown(e) {
    if (pointer.down && e.pointerId !== pointer.id) return;   // a second finger: ignored
    const prev = pointer.buttons;
    pointer.down = true;
    pointer.id = e.pointerId;
    pointer.touch = e.pointerType !== 'mouse';
    pointer.button = e.button >= 0 ? e.button : 0;
    pointer.buttons = e.buttons || BUTTON_BITS[pointer.button] || 1;
    setNdc(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* capture is a nicety */ }
    if (canvas.focus) canvas.focus({ preventScroll: true });
    diffButtons(prev, pointer.buttons, e);
  }

  function onPointerMove(e) {
    if (pointer.down) {
      if (e.pointerId !== pointer.id) return;
      setNdc(e);
      // a mouse chord (second button pressed or released while another is held) arrives as a
      // move with a changed `buttons` mask, never as a second pointerdown
      if (!pointer.touch && e.buttons !== pointer.buttons) {
        const prev = pointer.buttons;
        pointer.buttons = e.buttons;
        diffButtons(prev, e.buttons, e);
        if (e.buttons === 0) release(e);
      }
    } else if (e.pointerType === 'mouse' || e.isPrimary) {
      setNdc(e);                                                // hover
    }
  }

  function release(e) {
    if (!pointer.down) return;
    const prev = pointer.buttons;
    pointer.down = false;
    pointer.buttons = 0;
    if (e && e.pointerId != null) { try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ } }
    pointer.id = -1;
    diffButtons(prev, 0, e);
    pointer.button = -1;
  }

  function onPointerUp(e) {
    if (!pointer.down || e.pointerId !== pointer.id) return;
    setNdc(e);
    if (!pointer.touch && e.buttons) {                          // one of several buttons lifted
      const prev = pointer.buttons;
      pointer.buttons = e.buttons;
      diffButtons(prev, e.buttons, e);
      return;
    }
    release(e);
  }

  function onPointerCancel(e) { if (pointer.down && e.pointerId === pointer.id) release(e); }
  function onContextMenu(e) { e.preventDefault(); }
  function onSelectStart(e) { e.preventDefault(); }
  function onWheel(e) { fire(wheelCbs, e.deltaY, e); }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('selectstart', onSelectStart);
  canvas.addEventListener('wheel', onWheel, { passive: true });

  function sub(list, cb) { list.push(cb); return () => { const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1); }; }

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('selectstart', onSelectStart);
    canvas.removeEventListener('wheel', onWheel);
    keyCbs.length = 0; wheelCbs.length = 0; downCbs.length = 0; upCbs.length = 0;
    keys.clear();
    pointer.down = false; pointer.buttons = 0; pointer.id = -1; pointer.button = -1;
  }

  return {
    keys, pointer,
    /** cb(code, event) on every non-repeat keydown. */
    onKey: (cb) => sub(keyCbs, cb),
    /** cb(deltaY, event) on wheel over the canvas. */
    onWheel: (cb) => sub(wheelCbs, cb),
    /** cb(button, pointer, event) when a button (0 LMB / finger, 1 MMB, 2 RMB) goes down on the canvas. */
    onPointerDown: (cb) => sub(downCbs, cb),
    /** cb(button, pointer, event) when that button lifts (or the pointer is cancelled / the window blurs). */
    onPointerUp: (cb) => sub(upCbs, cb),
    dispose,
  };
}
