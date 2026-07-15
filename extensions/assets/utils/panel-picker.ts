/**
 * The DevTools panel's picker, as source text for `inspectedWindow.eval()`.
 *
 * ⚠️ Why it cannot simply reuse `utils/element-picker.ts` (design §1.4, §4.6):
 * a DevTools panel does NOT get `activeTab` from a click inside it (the rake `seo`
 * already stepped on, PLAN §18a), and this extension deliberately has no persistent
 * content script to message. So `scripting.executeScript` is unavailable to the
 * panel, and the only way to run code in the inspected page is
 * `devtools.inspectedWindow.eval()` — which takes a STRING and runs it in the page's
 * MAIN world. Hence a compact, self-contained picker here, and the full one (closed
 * shadow root, keyboard, touch, breadcrumbs) in the injected content script.
 *
 * 🔴 Consequences, and how they are contained:
 *   - This code runs in the PAGE's world, so the page can see and forge
 *     `window.__blurAssetsPick`. It is therefore treated as UNTRUSTED page data on
 *     arrival: the panel renders it as text (React escapes), and any URL is
 *     protocol-checked before it is allowed near an `href`. Nothing privileged is
 *     ever handed to it.
 *   - Zero network: it reads `currentSrc` / `src` and nothing else. It does not
 *     fetch, and it cannot — there is no request code in it.
 *   - No `innerHTML`: every node is createElement + textContent.
 *   - It removes itself on Escape, on pick, and on a second run.
 */

const PICK_GLOBAL = '__blurAssetsPick';

/** Arm the picker in the inspected page. Resolves nothing — the panel polls. */
export const PICKER_SOURCE = `(function () {
  var KEY = '${PICK_GLOBAL}';
  if (window[KEY + 'Active']) { window[KEY + 'Stop'](); }
  window[KEY] = null;
  window[KEY + 'Active'] = true;

  var ring = document.createElement('div');
  ring.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;' +
    'outline:2px solid #1d6fff;box-shadow:0 0 0 1px #fff, 0 0 0 3px rgba(0,0,0,.55);' +
    'background:rgba(56,132,255,.16);border-radius:2px;display:none';
  var tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;top:8px;left:50%;' +
    'transform:translateX(-50%);background:#111;color:#fff;font:13px system-ui,sans-serif;' +
    'padding:8px 14px;border-radius:8px';
  tip.textContent = 'Asset Inspector: click an element · Esc to cancel';
  var current = null;

  function label(el) {
    var t = el.tagName.toLowerCase();
    return el.classList[0] ? t + '.' + el.classList[0] : t;
  }
  function urlOf(el) {
    if (el.currentSrc) return el.currentSrc;
    if (el.src) return el.src;
    if (el.poster) return el.poster;
    try {
      var bg = getComputedStyle(el).backgroundImage;
      var m = /url\\((['"]?)(.*?)\\1\\)/.exec(bg);
      if (m) return new URL(m[2], location.href).href;
    } catch (e) { /* unreadable style — degrade, never throw */ }
    return '';
  }
  function place(el) {
    var r = el.getBoundingClientRect();
    ring.style.display = '';
    ring.style.left = r.left + 'px';
    ring.style.top = r.top + 'px';
    ring.style.width = r.width + 'px';
    ring.style.height = r.height + 'px';
  }
  function onMove(e) {
    var path = e.composedPath ? e.composedPath() : [e.target];
    var el = null;
    for (var i = 0; i < path.length; i++) {
      if (path[i] instanceof Element && path[i] !== ring && path[i] !== tip) { el = path[i]; break; }
    }
    if (!el) return;
    current = el;
    place(el);
  }
  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    var el = current;
    if (!el) return;
    window[KEY] = {
      label: label(el),
      url: urlOf(el),
      natural: el.naturalWidth ? [el.naturalWidth, el.naturalHeight]
        : (el.videoWidth ? [el.videoWidth, el.videoHeight] : null)
    };
    stop();
  }
  function onKey(e) { if (e.key === 'Escape') { window[KEY] = { cancelled: true }; stop(); } }
  function stop() {
    window[KEY + 'Active'] = false;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    ring.remove();
    tip.remove();
  }
  window[KEY + 'Stop'] = stop;

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  document.documentElement.appendChild(ring);
  document.documentElement.appendChild(tip);
  return true;
})()`;

/** Read (and clear) the pick result. Polled by the panel — `eval` cannot await. */
export const POLL_SOURCE = `(function () {
  var r = window['${PICK_GLOBAL}'];
  if (r) window['${PICK_GLOBAL}'] = null;
  return r || null;
})()`;

/** Tear the picker down (panel closed, navigation, user cancelled). */
export const STOP_SOURCE = `(function () {
  if (window['${PICK_GLOBAL}Stop']) window['${PICK_GLOBAL}Stop']();
  window['${PICK_GLOBAL}'] = null;
  return true;
})()`;

/** What the eval'd picker sends back. 🔴 UNTRUSTED: the page shares that world. */
export interface PanelPick {
  label?: string;
  url?: string;
  natural?: [number, number] | null;
  cancelled?: boolean;
}
