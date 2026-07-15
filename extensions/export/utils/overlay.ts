// The on-page UI shell: one CLOSED shadow root on <html>, a toast, and the
// building blocks the picker and the export dialog share.
//
// 🔴 ZERO innerHTML anywhere in this file (design §8.1). Everything is
// `createElement` + `textContent` + `append`. Page content (captions, cell text,
// filenames, hostnames) is UNTRUSTED and only ever enters the DOM as a text node.
//
// A CLOSED root means the page cannot restyle or read our UI, and our CSS cannot
// disturb the page's `:nth-child` (same argument as blur/label-overlay.ts).
// `:host { all: initial }` cuts inherited styles.
//
// Accessibility & mobile (design §10.1, brief): keyboard-first, capture-phase
// listeners (SPAs steal Escape/Tab otherwise), aria-live status, double contrast
// ring (the page's background colour is unknown to us), touch targets ≥44px,
// responsive to 360px, no hover-only affordance, forced-colors + reduced-motion.

export const OVERLAY_MARKER = 'data-blur-export-overlay';

export type OverlayTheme = 'auto' | 'light' | 'dark';

interface Host {
  shadow: ShadowRoot;
  root: HTMLDivElement;
  layer: HTMLDivElement; // rings drawn over page elements
  ui: HTMLDivElement; // panels / dialogs / toasts
}

let host: Host | null = null;
let hostEl: HTMLElement | null = null;

/**
 * §9.5 — a second injection must NOT create a second overlay.
 *
 * ⚠️ Checks the DOM, not module state, on purpose: re-running `engine.js` through
 * `executeScript` creates a FRESH module instance whose `host` variable is null
 * even though the previous instance's overlay is still on screen. Only the DOM
 * marker survives across instances.
 */
export function overlayExists(): boolean {
  return document.documentElement.querySelector(`[${OVERLAY_MARKER}]`) !== null;
}

export function getHost(theme: OverlayTheme = 'auto'): Host {
  if (host && hostEl?.isConnected) return host;

  hostEl = document.createElement('div');
  hostEl.setAttribute(OVERLAY_MARKER, '');
  const shadow = hostEl.attachShadow({ mode: 'closed' });
  document.documentElement.append(hostEl);

  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  shadow.append(style);

  const root = document.createElement('div');
  root.className = 'bx';
  // ⚠️ The overlay's theme comes from the EXTENSION's setting, not the page's: a
  // dark page is not a dark-theme user (design §10.2).
  root.setAttribute('data-theme', theme);
  shadow.append(root);

  const layer = document.createElement('div');
  layer.className = 'bx-layer';
  layer.setAttribute('aria-hidden', 'true'); // decoration; the list is the a11y surface
  root.append(layer);

  const ui = document.createElement('div');
  ui.className = 'bx-ui';
  root.append(ui);

  host = { shadow, root, layer, ui };
  return host;
}

export function destroyOverlay(): void {
  hostEl?.remove();
  hostEl = null;
  host = null;
}

/** Focus the existing overlay instead of stacking a second one (design §9.5). */
export function focusOverlay(): void {
  const focusable = host?.ui.querySelector<HTMLElement>('[data-autofocus]');
  focusable?.focus();
}

/* ---------------------------------------------------------------- *
 * DOM helpers — the only way anything is built here
 * ---------------------------------------------------------------- */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // 🔴 textContent, never innerHTML. This single line is the XSS boundary.
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label: string, onClick: () => void, variant = ''): HTMLButtonElement {
  const b = el('button', `bx-btn ${variant}`.trim(), label);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return b;
}

/* ---------------------------------------------------------------- *
 * Toast (design §7.8 — states a FACT, never "Готово! ✨")
 * ---------------------------------------------------------------- */

export interface ToastAction {
  label: string;
  onClick: () => void;
}

let toastTimer: number | undefined;

export function showToast(
  message: string,
  opts: { actions?: ToastAction[]; tone?: 'info' | 'warn' | 'error'; theme?: OverlayTheme } = {},
): void {
  const h = getHost(opts.theme ?? 'auto');
  h.ui.querySelector('.bx-toast')?.remove();

  const toast = el('div', `bx-toast bx-toast--${opts.tone ?? 'info'}`);
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.append(el('p', 'bx-toast__msg', message));

  if (opts.actions?.length) {
    const row = el('div', 'bx-toast__actions');
    for (const a of opts.actions) row.append(button(a.label, a.onClick, 'bx-btn--ghost'));
    toast.append(row);
  }
  toast.append(
    button('Закрыть', () => {
      toast.remove();
      if (!h.ui.childElementCount && !h.layer.childElementCount) destroyOverlay();
    }, 'bx-btn--x'),
  );

  h.ui.append(toast);
  clearTimeout(toastTimer);
  // A toast with actions must not vanish under the user's cursor.
  toastTimer = window.setTimeout(
    () => {
      toast.remove();
      if (!h.ui.childElementCount && !h.layer.childElementCount) destroyOverlay();
    },
    opts.actions?.length ? 30_000 : 6_000,
  );
}

/* ---------------------------------------------------------------- *
 * Focus trap + Escape, in the CAPTURE phase
 * ---------------------------------------------------------------- */

/** ⚠️ Capture phase + stopPropagation: SPA pages hang their own Escape/Tab
 *  handlers on document and would otherwise steal ours (design §10.1). */
export function trapKeys(
  panel: HTMLElement,
  handlers: { onEscape: () => void; onKey?: (e: KeyboardEvent) => boolean },
): () => void {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handlers.onEscape();
      return;
    }
    if (handlers.onKey?.(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((n) => !n.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      // The shadow root reports its own active element.
      const active = (panel.getRootNode() as ShadowRoot).activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  document.addEventListener('keydown', onKeyDown, true);
  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    previouslyFocused?.focus?.(); // Esc returns focus where it came from (§10.1)
  };
}

/* ---------------------------------------------------------------- *
 * Rings drawn over page elements (the picker's highlight)
 * ---------------------------------------------------------------- */

export interface Ring {
  box: HTMLDivElement;
  update: () => void;
}

export function createRing(target: Element, label: string, index: number): Ring {
  const h = getHost();
  const box = el('div', 'bx-ring');
  const tag = el('span', 'bx-ring__tag', `${index + 1}. ${label}`);
  box.append(tag);
  h.layer.append(box);

  const update = (): void => {
    const r = target.getBoundingClientRect();
    box.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(r.top)}px)`;
    box.style.width = `${Math.round(r.width)}px`;
    box.style.height = `${Math.round(r.height)}px`;
  };
  update();
  return { box, update };
}

/** Reposition rings in ONE rAF on scroll/resize (pattern: blur/label-overlay). The
 *  picker deliberately does NOT block page scrolling — a table can be taller than
 *  the viewport (design §2.2). */
export function trackRings(rings: Ring[]): () => void {
  let raf = 0;
  const schedule = (): void => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      for (const r of rings) r.update();
    });
  };
  addEventListener('scroll', schedule, true);
  addEventListener('resize', schedule);
  return () => {
    cancelAnimationFrame(raf);
    removeEventListener('scroll', schedule, true);
    removeEventListener('resize', schedule);
  };
}

/* ---------------------------------------------------------------- *
 * Styles
 * ---------------------------------------------------------------- */

const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }

.bx {
  --bg: #ffffff; --bg2: #f4f6f8; --fg: #16181d; --dim: #5f6570;
  --line: #d5d9e0; --accent: #1a73e8; --accent-fg: #ffffff;
  --warn-bg: #fff4d6; --warn-fg: #6b4b00;
  --err-bg: #fde7e7; --err-fg: #8a1c1c;
  color-scheme: light;
  font: 400 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.bx[data-theme="dark"] {
  --bg: #1b1f24; --bg2: #24292f; --fg: #e8eaed; --dim: #9aa0a6;
  --line: #3c4043; --accent: #8ab4f8; --accent-fg: #111418;
  --warn-bg: #4a3a00; --warn-fg: #fdd663;
  --err-bg: #4a1f1f; --err-fg: #f6aeae;
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  .bx[data-theme="auto"] {
    --bg: #1b1f24; --bg2: #24292f; --fg: #e8eaed; --dim: #9aa0a6;
    --line: #3c4043; --accent: #8ab4f8; --accent-fg: #111418;
    --warn-bg: #4a3a00; --warn-fg: #fdd663;
    --err-bg: #4a1f1f; --err-fg: #f6aeae;
    color-scheme: dark;
  }
}

.bx-layer { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; }
.bx-ui    { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
.bx-ui > * { pointer-events: auto; }

/* --- picker rings: a DOUBLE ring, because the page's background is unknown --- */
.bx-ring {
  position: absolute; top: 0; left: 0;
  border: 2px dashed #8ab4f8;
  box-shadow: 0 0 0 2px rgba(10, 12, 16, 0.75);
  border-radius: 4px;
}
.bx-ring--active {
  border-style: solid; border-color: #8ab4f8; border-width: 3px;
  background: rgba(138, 180, 248, 0.22);
  box-shadow: 0 0 0 3px #0b0d10, 0 0 0 6px #8ab4f8;
}
.bx-ring__tag {
  position: absolute; top: -22px; left: -2px;
  background: #0b0d10; color: #fff; font: 600 11px/1 system-ui, sans-serif;
  padding: 4px 6px; border-radius: 4px 4px 0 0; white-space: nowrap;
  max-width: 60vw; overflow: hidden; text-overflow: ellipsis;
}

/* --- panels --- */
.bx-panel {
  position: absolute; left: 50%; transform: translateX(-50%);
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  padding: 14px; width: min(720px, calc(100vw - 24px));
  max-height: calc(100vh - 32px); overflow: auto;
}
.bx-panel--top    { top: 12px; }
.bx-panel--center { top: 50%; transform: translate(-50%, -50%); }

.bx-status {
  background: var(--bg2); border: 1px solid var(--line); border-radius: 8px;
  padding: 8px 10px; font-size: 13px; color: var(--fg); margin: 0 0 10px;
}
.bx-h { margin: 0 0 2px; font-size: 16px; font-weight: 700; }
.bx-sub { margin: 0 0 10px; font-size: 12px; color: var(--dim); word-break: break-word; }
.bx-list { display: flex; flex-direction: column; gap: 8px; margin: 0 0 12px; padding: 0; list-style: none; }

.bx-cand {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  width: 100%; min-height: 44px; /* touch target */
  text-align: left; cursor: pointer; font: inherit;
  background: var(--bg2); color: var(--fg);
  border: 2px dashed var(--line); border-radius: 8px; padding: 8px 10px;
}
.bx-cand--active { border-style: solid; border-color: var(--accent); background: color-mix(in srgb, var(--accent) 16%, var(--bg2)); }
.bx-cand__num {
  flex: none; width: 24px; height: 24px; border-radius: 50%;
  background: var(--accent); color: var(--accent-fg); font-weight: 700; font-size: 12px;
  display: inline-flex; align-items: center; justify-content: center;
}
.bx-cand__label { font-weight: 600; }
.bx-cand__warn { flex-basis: 100%; color: var(--warn-fg); font-size: 12px; }

.bx-btn {
  appearance: none; font: inherit; font-size: 13px; cursor: pointer;
  min-height: 44px; padding: 8px 14px; /* ≥44px touch target, no hover-only cues */
  background: var(--bg2); color: var(--fg);
  border: 1px solid var(--line); border-radius: 8px;
}
.bx-btn--primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); font-weight: 600; }
.bx-btn--ghost { background: transparent; }
.bx-btn--x { background: transparent; border: none; text-decoration: underline; min-height: 32px; padding: 4px 6px; }
.bx-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.bx-btn:focus-visible, .bx-cand:focus-visible, .bx-field :focus-visible {
  outline: 3px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 6px #1a73e8;
}

.bx-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.bx-foot { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
.bx-summary { margin-right: auto; font-size: 12px; color: var(--dim); word-break: break-all; }

.bx-field { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; margin: 6px 0; }
.bx-field > span:first-child { flex: 0 0 150px; color: var(--dim); }
.bx-field select, .bx-field input[type="text"] {
  font: inherit; font-size: 13px; min-height: 44px; padding: 6px 8px;
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--line); border-radius: 8px; flex: 1; min-width: 140px;
}
.bx-check { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; cursor: pointer; font-size: 13px; }
.bx-check input, .bx-field input[type="checkbox"], .bx-field input[type="radio"] { width: 20px; height: 20px; accent-color: var(--accent); }

.bx-note { border-radius: 8px; padding: 8px 10px; font-size: 12px; margin: 8px 0; }
.bx-note--warn { background: var(--warn-bg); color: var(--warn-fg); }
.bx-note--err  { background: var(--err-bg);  color: var(--err-fg); }
.bx-note--info { background: var(--bg2); color: var(--dim); }

.bx-tabs { display: flex; gap: 6px; margin: 10px 0 6px; }
.bx-tab { min-height: 40px; }
.bx-tab[aria-selected="true"] { border-color: var(--accent); font-weight: 700; }

.bx-tablewrap { overflow: auto; max-height: 40vh; border: 1px solid var(--line); border-radius: 8px; }
.bx-table { border-collapse: collapse; width: 100%; font-size: 12px; }
.bx-table caption { text-align: left; padding: 6px 8px; font-size: 11px; color: var(--dim); }
.bx-table th, .bx-table td { border: 1px solid var(--line); padding: 5px 8px; text-align: left; vertical-align: top; white-space: pre-wrap; }
.bx-table th { background: var(--bg2); }
.bx-table td.risk { background: var(--warn-bg); color: var(--warn-fg); }
.bx-raw {
  border: 1px solid var(--line); border-radius: 8px; background: var(--bg2);
  padding: 10px; margin: 0; font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace;
  overflow: auto; max-height: 40vh; white-space: pre; color: var(--fg);
}
.bx-ta {
  width: 100%; min-height: 140px; font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace;
  background: var(--bg2); color: var(--fg); border: 1px solid var(--line);
  border-radius: 8px; padding: 8px; resize: vertical;
}

.bx-toast {
  position: absolute; right: 12px; bottom: 12px;
  width: min(420px, calc(100vw - 24px));
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--line); border-left: 4px solid var(--accent);
  border-radius: 10px; padding: 10px 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
  display: flex; flex-direction: column; gap: 6px; align-items: flex-start;
}
.bx-toast--warn  { border-left-color: #f9ab00; }
.bx-toast--error { border-left-color: #d93025; }
.bx-toast__msg { margin: 0; font-size: 13px; }
.bx-toast__actions { display: flex; gap: 6px; flex-wrap: wrap; }

/* --- 360px / mobile --- */
@media (max-width: 480px) {
  .bx-panel { width: calc(100vw - 12px); padding: 10px; border-radius: 10px; }
  .bx-field > span:first-child { flex-basis: 100%; }
  .bx-foot { justify-content: stretch; }
  .bx-foot .bx-btn { flex: 1; }
}

@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
@media (forced-colors: active) {
  .bx-ring, .bx-ring--active { border-color: Highlight; box-shadow: none; }
  .bx-panel, .bx-toast, .bx-btn, .bx-cand { border-color: CanvasText; background: Canvas; color: CanvasText; }
  .bx-note--warn, .bx-note--err { background: Canvas; color: CanvasText; border: 1px solid CanvasText; }
}
`;
