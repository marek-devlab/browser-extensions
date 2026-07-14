/**
 * Element picker (feature §1): let the user click an element to create a custom
 * per-site cosmetic (`display:none`) filter. Pure DOM — no extension APIs — so it
 * is portable and unit-testable.
 *
 * NO new permission is needed: hiding is content-script CSS, and the picker only
 * reads the DOM of the page the content script already runs on.
 */

/** Classes that look auto-generated (hashes, CSS-modules, utility soup) — skip. */
function isStableClass(cls: string): boolean {
  if (cls.length === 0 || cls.length > 40) return false;
  // Reject hash-like or state classes: contains digits-heavy hashes, or looks
  // like `css-1a2b3c` / `jsx-123` / `sc-xxxx`.
  if (/^(css|sc|jsx)-/.test(cls)) return false;
  if (/[0-9a-f]{6,}/i.test(cls)) return false;
  if (/^(is-|has-|active|open|selected|hover|focus)/.test(cls)) return false;
  return /^[a-zA-Z_][\w-]*$/.test(cls);
}

function escapeIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/([^\w-])/g, '\\$1');
}

/**
 * Build a reasonably specific, reasonably stable CSS selector for `el`:
 *   1. `#id` when the id is present and not obviously auto-generated,
 *   2. else `tag.class.class` from up to two stable classes,
 *   3. else an `:nth-of-type` path walked up to 4 ancestors for uniqueness.
 * The goal is a selector a human would accept as "this ad box", not a brittle
 * full-path — cosmetic rules are meant to generalize across page reloads.
 */
export function computeSelector(el: Element): string {
  const id = el.getAttribute('id');
  if (id && isStableClass(id)) return `#${escapeIdent(id)}`;

  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).filter(isStableClass).slice(0, 2);
  if (classes.length > 0) {
    const sel = `${tag}.${classes.map(escapeIdent).join('.')}`;
    // If that already uniquely matches, use it — it generalizes best.
    try {
      if (el.ownerDocument.querySelectorAll(sel).length === 1) return sel;
      return sel; // still acceptable even if it matches siblings (hide all ads)
    } catch {
      /* fall through */
    }
  }

  // Positional fallback: build an nth-of-type chain.
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node !== node.ownerDocument.documentElement && depth < 4) {
    const cur: Element = node;
    const t = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    if (!parent) {
      parts.unshift(t);
      break;
    }
    const sameTag = Array.from(parent.children).filter((c: Element) => c.tagName === cur.tagName);
    if (sameTag.length === 1) {
      parts.unshift(t);
    } else {
      const idx = sameTag.indexOf(cur) + 1;
      parts.unshift(`${t}:nth-of-type(${idx})`);
    }
    node = parent;
    depth += 1;
  }
  return parts.join(' > ');
}

export interface PickerHandle {
  cancel: () => void;
}

/**
 * Start interactive picking. Highlights the element under the cursor; a click
 * selects it (and is swallowed so the page never navigates). Escape cancels.
 * Returns a handle whose `cancel()` tears everything down. Idempotent teardown.
 */
export function startPicker(
  onPick: (selector: string, el: Element) => void,
  onCancel?: () => void,
): PickerHandle {
  const doc = document;
  const highlight = doc.createElement('div');
  Object.assign(highlight.style, {
    position: 'fixed',
    zIndex: '2147483647',
    background: 'rgba(56,132,255,0.25)',
    // A blue fill plus a light+dark double ring so the highlight is clearly
    // visible against both light and dark page backgrounds (contrast §2/§6).
    border: '2px solid #1d6fff',
    boxShadow: '0 0 0 1px #ffffff, 0 0 0 3px rgba(0,0,0,0.55)',
    borderRadius: '2px',
    pointerEvents: 'none',
    margin: '0',
    boxSizing: 'border-box',
    transition: 'all 40ms ease-out',
  } satisfies Partial<CSSStyleDeclaration>);
  const label = doc.createElement('div');
  Object.assign(label.style, {
    position: 'fixed',
    zIndex: '2147483647',
    background: '#111',
    color: '#fff',
    font: '12px/1.4 system-ui, sans-serif',
    padding: '2px 6px',
    borderRadius: '3px',
    pointerEvents: 'none',
    maxWidth: '90vw',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } satisfies Partial<CSSStyleDeclaration>);
  label.setAttribute('role', 'status');

  // A persistent instruction banner so the picker is discoverable and its exit
  // is obvious. aria-live announces it to screen readers; pointer-events:none so
  // it never intercepts the pick click.
  const instruction = doc.createElement('div');
  Object.assign(instruction.style, {
    position: 'fixed',
    zIndex: '2147483647',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#111',
    color: '#fff',
    font: '13px/1.4 system-ui, sans-serif',
    padding: '8px 14px',
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
    maxWidth: '92vw',
    textAlign: 'center',
  } satisfies Partial<CSSStyleDeclaration>);
  instruction.setAttribute('role', 'status');
  instruction.setAttribute('aria-live', 'polite');
  instruction.textContent = 'Click an element to block it · press Esc to cancel';

  let current: Element | null = null;
  let done = false;

  function place(el: Element): void {
    const r = el.getBoundingClientRect();
    Object.assign(highlight.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    const sel = computeSelector(el);
    // Show exactly what the click will hide (uBO/AdGuard-style preview).
    label.textContent = `Block: ${sel}`;
    label.style.left = `${Math.max(0, r.left)}px`;
    label.style.top = `${Math.max(0, r.top - 22)}px`;
  }

  function onMove(e: MouseEvent): void {
    const el = e.target as Element | null;
    if (!el || el === highlight || el === label) return;
    current = el;
    place(el);
  }

  function onClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const el = current ?? (e.target as Element);
    if (el && el !== highlight && el !== label) {
      const sel = computeSelector(el);
      teardown();
      onPick(sel, el);
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      teardown();
      onCancel?.();
    }
  }

  function teardown(): void {
    if (done) return;
    done = true;
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKey, true);
    highlight.remove();
    label.remove();
    instruction.remove();
  }

  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKey, true);
  doc.documentElement.append(highlight, label, instruction);
  return { cancel: teardown };
}
