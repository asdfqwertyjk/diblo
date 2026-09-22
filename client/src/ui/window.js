// client/src/ui/window.js — a draggable panel window over the canvas.
// createWindow(root, {id, title, onClose, x?, y?}) → { el, body, titleEl, open(), close(),
// isOpen(), toggle(), setTitle(text), moveTo(x, y), dispose() }.
// Drag via pointer events on the title bar (mouse, touch and pen alike), clamped so the title
// bar always stays inside the viewport (a window that fits stays fully on screen); below
// 700 px wide or 451 px tall (landscape phones) the css turns it into a fixed full-width
// bottom sheet stacked above the HUD and dragging is off. Callers build their content before
// open() so the first placement measures the real height. `onClose` fires whenever the window
// goes from open to closed, whatever closed it (× button, close(), the registry).
const SHEET_QUERY = '(max-width: 699px), (max-height: 450px)';   // keep in step with ui.css
const MARGIN = 0;               // px the window may not cross at the left/top

let zTop = 20;                  // the last-touched window comes to the front

export function createWindow(root, { id = '', title = '', onClose = null, x = null, y = null } = {}) {
  const sheet = window.matchMedia ? window.matchMedia(SHEET_QUERY) : { matches: false };

  const el = document.createElement('div');
  el.className = 'hm-win';
  if (id) el.dataset.id = id;
  el.style.zIndex = String(zTop);

  const titleBar = document.createElement('div');
  titleBar.className = 'hm-win-title';
  const titleEl = document.createElement('span');
  titleEl.className = 'hm-win-title-text';
  titleEl.textContent = title;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'hm-win-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close');
  titleBar.appendChild(titleEl);
  titleBar.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'hm-win-body';

  el.appendChild(titleBar);
  el.appendChild(body);
  root.appendChild(el);

  let opened = false;
  let placed = false;             // has a position been chosen (centre on first open)
  let px = x, py = y;             // wanted position (px); null = centre
  let dragId = null, dragDx = 0, dragDy = 0, dragW = 0, dragH = 0;

  const isSheet = () => sheet.matches;

  function raise() {
    zTop++;
    el.style.zIndex = String(zTop);
  }

  /**
   * Clamp (left, top): a window that fits stays fully on screen; a taller one keeps its whole
   * title bar on screen and its body (which scrolls) may hang off the bottom.
   */
  function clamp(left, top, w, h) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const titleH = titleBar.offsetHeight || 44;
    const maxLeft = Math.max(MARGIN, vw - w);
    const maxTop = h <= vh - MARGIN ? vh - h : Math.max(MARGIN, vh - Math.min(h, titleH + 8));
    if (left > maxLeft) left = maxLeft;
    if (top > maxTop) top = maxTop;
    if (left < MARGIN) left = MARGIN;
    if (top < MARGIN) top = MARGIN;
    return [Math.round(left), Math.round(top)];
  }

  function apply() {
    if (isSheet()) return;        // the css positions the sheet
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = px, top = py;
    if (left == null || top == null) {
      left = (window.innerWidth - w) / 2;
      top = Math.max(MARGIN, (window.innerHeight - h) * 0.42);
    }
    [left, top] = clamp(left, top, w, h);
    px = left; py = top;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    placed = true;
  }

  function moveTo(nx, ny) {
    px = nx; py = ny;
    if (opened) apply();
  }

  // --- drag -----------------------------------------------------------------------
  function onDown(e) {
    if (e.target === closeBtn) return;
    if (e.button != null && e.button !== 0) return;
    raise();
    if (isSheet()) return;
    e.preventDefault();
    dragId = e.pointerId;
    const r = el.getBoundingClientRect();
    dragDx = e.clientX - r.left;
    dragDy = e.clientY - r.top;
    dragW = r.width; dragH = r.height;
    el.classList.add('dragging');
    try { titleBar.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
  }
  function onMove(e) {
    if (e.pointerId !== dragId) return;
    e.preventDefault();
    const [left, top] = clamp(e.clientX - dragDx, e.clientY - dragDy, dragW, dragH);
    px = left; py = top;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }
  function onUp(e) {
    if (e.pointerId !== dragId) return;
    dragId = null;
    el.classList.remove('dragging');
  }
  titleBar.addEventListener('pointerdown', onDown);
  titleBar.addEventListener('pointermove', onMove);
  titleBar.addEventListener('pointerup', onUp);
  titleBar.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerdown', raise, true);
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  const onResize = () => { if (opened) apply(); };
  window.addEventListener('resize', onResize);
  const onSheetChange = () => { if (opened) { if (!isSheet()) apply(); else { el.style.left = ''; el.style.top = ''; } } };
  if (sheet.addEventListener) sheet.addEventListener('change', onSheetChange);
  else if (sheet.addListener) sheet.addListener(onSheetChange);

  // --- open / close -----------------------------------------------------------------
  function open() {
    if (opened) { raise(); return; }
    opened = true;
    el.classList.add('open');
    raise();
    if (!isSheet()) apply();
    else { el.style.left = ''; el.style.top = ''; }
  }
  function close() {
    if (!opened) return;
    opened = false;
    el.classList.remove('open');
    if (dragId != null) { dragId = null; el.classList.remove('dragging'); }
    if (typeof onClose === 'function') onClose();
  }
  function isOpen() { return opened; }
  function toggle() { if (opened) close(); else open(); }
  function setTitle(text) { titleEl.textContent = text; }

  closeBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
  closeBtn.addEventListener('pointerup', (e) => { e.preventDefault(); e.stopPropagation(); close(); });

  function dispose() {
    opened = false;
    window.removeEventListener('resize', onResize);
    if (sheet.removeEventListener) sheet.removeEventListener('change', onSheetChange);
    else if (sheet.removeListener) sheet.removeListener(onSheetChange);
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  return { el, body, titleEl, open, close, isOpen, toggle, setTitle, moveTo, dispose, get placed() { return placed; } };
}
