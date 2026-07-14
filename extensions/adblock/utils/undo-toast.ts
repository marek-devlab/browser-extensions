/**
 * The in-page "Element hidden — Undo" snackbar.
 *
 * WHY A TOAST AND NOT A KEYBOARD SHORTCUT / A NOTIFICATION / THE OPTIONS PAGE.
 * The overwhelmingly common regret is "I just blocked the wrong thing, one
 * second ago", and at that moment the user's hand is on the mouse and their eyes
 * are on the page. A shortcut (Ctrl+Z) is invisible and undiscoverable, and does
 * not exist on a touch device at all — Firefox for Android is a shipped target.
 * A `notifications` API toast needs a new permission and is off to the side of the
 * screen. The Options page is the very dead end this feature exists to remove.
 * So: a transient, tappable control, in the page, where the user is looking.
 *
 * WHY A CLOSED SHADOW ROOT (same reasoning as blur's LabelOverlay). This UI is an
 * *undo* affordance on a page that may be actively hostile to being un-adblocked:
 * a page must not be able to restyle it, hide it, or read it back out. One host
 * element on `documentElement` (never inside the page's own containers, so no
 * `:nth-child`/flex/grid of the page's is disturbed), `:host { all: initial }` so
 * nothing inherits in, and `mode: 'closed'` so the page's JS cannot reach the
 * contents.
 *
 * TOUCH FIRST. Both controls are ≥40px tall real `<button>`s — no hover-only
 * affordance anywhere in this flow. The layout is deliberately FIXED-SIZE (see
 * the CSS): it makes the panel predictable on a phone, and it lets the live e2e
 * harness land a real mouse click on the Undo button through the closed root.
 */

/** Panel geometry. Mirrored by e2e/adblock/harness.mjs to click Undo for real. */
const PANEL_W = 360;
const PANEL_H = 56;
const BOTTOM = 20;

const CSS = `
  :host { all: initial; }
  .toast {
    position: fixed;
    left: 50%;
    bottom: ${BOTTOM}px;
    transform: translateX(-50%);
    width: min(${PANEL_W}px, calc(100vw - 24px));
    height: ${PANEL_H}px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px;
    z-index: 2147483647;
    /* Same dark card the popup uses, so the two surfaces read as one product. */
    background: #1e2128;
    color: #f2f3f5;
    border: 1px solid #2a2e37;
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
    font: 13px/1.4 system-ui, -apple-system, sans-serif;
    pointer-events: auto;
    opacity: 0;
    transition: opacity 140ms ease-out;
  }
  .toast.in { opacity: 1; }
  @media (prefers-reduced-motion: reduce) {
    .toast { transition: none; }
  }
  .msg {
    flex: 1;
    min-width: 0;
    padding: 0 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .msg b { font-weight: 600; }
  .msg .desc { color: #9aa2ad; }
  button {
    flex: none;
    height: 40px;
    box-sizing: border-box;
    border-radius: 8px;
    font: 600 13px/1 system-ui, -apple-system, sans-serif;
    cursor: pointer;
  }
  .undo {
    width: 80px;
    background: #5b8cff;
    color: #0b1220;
    border: 1px solid #5b8cff;
  }
  .undo:hover { filter: brightness(1.08); }
  .close {
    width: 32px;
    font-size: 16px;
    background: transparent;
    color: #9aa2ad;
    border: 1px solid #2a2e37;
  }
  .close:hover { color: #f2f3f5; }
  button:focus-visible { outline: 2px solid #5b8cff; outline-offset: 2px; }
`;

const HIDE_MS = 8000;
const CONFIRM_MS = 2500;

export interface ToastHandle {
  dismiss: () => void;
}

/** Remove any toast on screen (content-script teardown / extension reload). */
export function dismissToast(): void {
  teardown();
}

// One toast at a time: picking a second element replaces the first one's toast
// (whose Undo would otherwise silently refer to the wrong element).
let current: { host: HTMLElement; timer: ReturnType<typeof setTimeout> } | undefined;

function teardown(): void {
  if (!current) return;
  clearTimeout(current.timer);
  current.host.remove();
  current = undefined;
}

/**
 * Show "Element hidden — Undo" for `description`. `onUndo` is invoked when the
 * user activates Undo (click, tap, or keyboard); the toast then confirms and
 * fades. Auto-dismisses after 8s — long enough to notice and reach on a phone.
 */
export function showUndoToast(description: string, onUndo: () => void): ToastHandle {
  teardown();

  const host = document.createElement('div');
  host.setAttribute('data-abx-undo', '');
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = CSS;

  const toast = document.createElement('div');
  toast.className = 'toast';
  // polite, not assertive: it must not interrupt a screen-reader mid-sentence,
  // but it MUST be announced — it is the only path to undo for a blind user.
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const msg = document.createElement('div');
  msg.className = 'msg';
  const strong = document.createElement('b');
  strong.textContent = 'Element hidden';
  const desc = document.createElement('span');
  desc.className = 'desc';
  // textContent, never innerHTML: `description` is derived from page content.
  desc.textContent = description ? ` · ${description}` : '';
  msg.append(strong, desc);

  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'undo';
  undo.textContent = 'Undo';
  undo.setAttribute('aria-label', `Undo hiding ${description || 'this element'}`);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Dismiss');

  undo.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onUndo();
    // Confirm in place rather than vanishing: the user needs to see that the
    // undo actually happened, especially when the restored element is off screen.
    strong.textContent = 'Element restored';
    desc.textContent = '';
    undo.remove();
    if (current) {
      clearTimeout(current.timer);
      current.timer = setTimeout(teardown, CONFIRM_MS);
    }
  });
  close.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    teardown();
  });

  toast.append(msg, undo, close);
  root.append(style, toast);
  // documentElement, not body: the content script runs at document_start.
  document.documentElement.append(host);
  // Next frame, so the opacity transition actually runs.
  requestAnimationFrame(() => toast.classList.add('in'));

  current = { host, timer: setTimeout(teardown, HIDE_MS) };
  return { dismiss: teardown };
}
