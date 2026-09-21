// client/src/input/input.js — keyboard + mouse → intents.
// createInput(canvas) → { keys: Set, mouse: {ndcX, ndcY, buttons}, intent(aimWorld) → {mv, aim},
//   onKey(cb), onWheel(cb), dispose() }.
// WASD (and arrows) → mv in [-1,1]²: W is −z (north), D is +x. Diagonals are sent as ±1 on
// both axes; the sim normalises. The returned intent object and its arrays are reused every
// call, so callers copy what they keep. contextmenu and the TAB default are prevented.

export function createInput(canvas) {
  const keys = new Set();
  const mouse = { ndcX: 0, ndcY: 0, buttons: 0 };
  const intentObj = { mv: [0, 0], aim: [0, 0] };
  const keyCbs = [];
  const wheelCbs = [];

  function onKeyDown(e) {
    if (e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;                 // held keys stay in the set; one-shot callbacks fire once
    keys.add(e.code);
    for (let i = 0; i < keyCbs.length; i++) keyCbs[i](e.code, e);
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function onBlur() { keys.clear(); mouse.buttons = 0; }

  function onMouseMove(e) {
    // the canvas is full-window (index.html), so the window size is the canvas size
    const w = window.innerWidth || 1, h = window.innerHeight || 1;
    mouse.ndcX = (e.clientX / w) * 2 - 1;
    mouse.ndcY = -(e.clientY / h) * 2 + 1;
  }
  function onMouseDown(e) { mouse.buttons = e.buttons; if (canvas.focus) canvas.focus({ preventScroll: true }); }
  function onMouseUp(e) { mouse.buttons = e.buttons; }
  function onContextMenu(e) { e.preventDefault(); }
  function onWheel(e) {
    for (let i = 0; i < wheelCbs.length; i++) wheelCbs[i](e.deltaY, e);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('wheel', onWheel, { passive: true });

  /** Build this frame's intent. aimWorld is [x, z] or null (keep the previous aim). */
  function intent(aimWorld) {
    const mv = intentObj.mv;
    mv[0] = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    mv[1] = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    if (aimWorld) { intentObj.aim[0] = aimWorld[0]; intentObj.aim[1] = aimWorld[1]; }
    return intentObj;
  }

  /** cb(code, event) on every non-repeat keydown. */
  function onKey(cb) { keyCbs.push(cb); return () => { const i = keyCbs.indexOf(cb); if (i >= 0) keyCbs.splice(i, 1); }; }
  /** cb(deltaY, event) on wheel over the canvas. */
  function onWheelCb(cb) { wheelCbs.push(cb); return () => { const i = wheelCbs.indexOf(cb); if (i >= 0) wheelCbs.splice(i, 1); }; }

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('wheel', onWheel);
    keyCbs.length = 0; wheelCbs.length = 0; keys.clear();
  }

  return { keys, mouse, intent, onKey, onWheel: onWheelCb, dispose };
}
