/**
 * Element picker — **copied from `extensions/adblock/utils/element-picker.ts`**
 * (the house picker; PLAN-2 / TODO §J: "reuse it, do not rewrite it") and extended
 * for the Asset Inspector. It is a copy rather than an import because
 * `extensions/*` are separate WXT apps with no shared picker package; only
 * `@blur/core` / `@blur/ui` cross the boundary. Attribution and the diff are here
 * so the two can be reconciled if a `@blur/picker` package ever lands.
 *
 * Reused verbatim from adblock:
 *   - `isStableClass` / `escapeIdent` / `computeSelector` — the "selector a human
 *     would accept" heuristic;
 *   - the double-ring highlight (light + dark ring) so it reads on any page;
 *   - swallow the pick click in the capture phase so the page never navigates;
 *   - idempotent teardown.
 *
 * Added here (design §2.1, §11.1 — adblock's picker is mouse-only and sees only
 * the shadow HOST, which are exactly the two gaps an inspector cannot have):
 *   - renders into a CLOSED shadow root owned by the caller (no inline styles on
 *     page nodes, page CSS cannot restyle or hide us, page JS cannot read us);
 *   - open-shadow-DOM piercing via `event.composedPath()[0]` (adblock uses
 *     `event.target`, which stops at the host);
 *   - full keyboard walk: ↑ parent / ↓ child / ← → siblings / `[` `]` z-stack /
 *     `R` nearest resource / Enter / Esc;
 *   - TOUCH support: on Firefox for Android there is no hover, so a tap SELECTS
 *     and a separate ≥44px "Inspect this element" button CONFIRMS (design: mobile
 *     is load-bearing, and hover-to-preview does not exist there);
 *   - ancestor breadcrumbs with a "has a resource" marker;
 *   - one `AbortController` for every listener → a single `abort()` is a complete
 *     teardown, and the page cursor/overlay is always restored.
 *
 * Pure DOM. No extension APIs, no network, nothing is fetched — it only reads the
 * DOM of the page the script was injected into on a user gesture.
 */

/** Classes that look auto-generated (hashes, CSS-modules, utility soup) — skip. */
function isStableClass(cls: string): boolean {
  if (cls.length === 0 || cls.length > 40) return false;
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
 * (Verbatim from adblock — in the inspector it names the element on the card and
 * in the "Copy as JSON" payload, instead of naming a cosmetic filter.)
 */
export function computeSelector(el: Element): string {
  const id = el.getAttribute('id');
  if (id && isStableClass(id)) return `#${escapeIdent(id)}`;

  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).filter(isStableClass).slice(0, 2);
  if (classes.length > 0) {
    return `${tag}.${classes.map(escapeIdent).join('.')}`;
  }

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
    if (sameTag.length === 1) parts.unshift(t);
    else parts.unshift(`${t}:nth-of-type(${sameTag.indexOf(cur) + 1})`);
    node = parent;
    depth += 1;
  }
  return parts.join(' > ');
}

/** `<img class="hero">`-style label for the card header and the picker tag. */
export function elementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const cls = el.classList[0];
  return cls ? `<${tag} class="${cls}">` : `<${tag}>`;
}

/** Short form for breadcrumbs: `img.hero`. */
export function shortLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  return el.classList[0] ? `${tag}.${el.classList[0]}` : tag;
}

/**
 * Does this element currently carry a browser-loaded resource? Read from the DOM
 * only — `complete`/`currentSrc`/computed style. 🔴 Nothing is requested to find
 * out (design §0 И1); a broken image is still "has a resource", and we say so on
 * the card instead of probing the network.
 */
export function hasResource(el: Element): boolean {
  if (el instanceof HTMLImageElement) return el.currentSrc !== '' || el.src !== '';
  if (el instanceof HTMLMediaElement) {
    return el.currentSrc !== '' || (el instanceof HTMLVideoElement && el.poster !== '');
  }
  if (el instanceof HTMLIFrameElement || el instanceof HTMLEmbedElement) return true;
  if (el instanceof HTMLObjectElement) return true;
  try {
    const bg = getComputedStyle(el).backgroundImage;
    return bg !== 'none' && bg.includes('url(');
  } catch {
    return false;
  }
}

/**
 * Walk up (≤20 ancestors) then down (≤200 descendants) to the first element that
 * carries a resource. Bounded on purpose: the cost must not scale with page size
 * (design §10.3).
 */
export function nearestResource(el: Element): Element | null {
  let up: Element | null = el;
  for (let i = 0; up && i < 20; i += 1) {
    if (hasResource(up)) return up;
    up = up.parentElement;
  }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  for (let i = 0; node && i < 200; i += 1) {
    if (node instanceof Element && hasResource(node)) return node;
    node = walker.nextNode();
  }
  return null;
}

export interface PickerChrome {
  /** Ring drawn around the current element. `outline`, not `box-shadow`, so it
   *  survives forced-colors mode (design §11.3). */
  ring: HTMLElement;
  /** Floating `img.hero · 480×320 · resource` tag above the ring. */
  tag: HTMLElement;
  /** Instruction bar (holds Cancel and, on touch, the Confirm button). */
  banner: HTMLElement;
  /** Ancestor breadcrumb bar. */
  crumbs: HTMLElement;
  /** Visually-hidden aria-live region. */
  live: HTMLElement;
  /** Big Confirm button — shown only once a touch pointer is seen. */
  confirm: HTMLButtonElement;
  /** Cancel button — the pointer-driven escape hatch (Esc is the keyboard one). */
  cancel: HTMLButtonElement;
}

export interface PickerOptions {
  /** Our own host node. Never a pick target, and clicks inside it pass through. */
  host: Element;
  chrome: PickerChrome;
  signal: AbortSignal;
  showBreadcrumbs: boolean;
  /** Pref: on a wrapper div, jump straight to the nested img/video. */
  autoJumpToResource: boolean;
  onPick: (el: Element) => void;
  onCancel: () => void;
}

export interface PickerHandle {
  /** Re-arm picking (used after the card is closed, and on re-injection). */
  restart: () => void;
  /** Hide the picker chrome while the card is open — listeners stay, no leak. */
  suspend: () => void;
  /** True while the picker is armed. */
  isActive: () => boolean;
}

/**
 * Start interactive picking. Every listener is bound to `options.signal`, so the
 * caller's single `abort()` removes all of them — there is no second teardown path
 * to forget (design §10.6). Re-injection calls `restart()` on the existing handle
 * instead of creating a second picker.
 */
export function startPicker(o: PickerOptions): PickerHandle {
  const { signal, host, chrome } = o;
  let current: Element | null = null;
  let stack: Element[] = [];
  let stackIndex = 0;
  let pointer = { x: 0, y: 0 };
  let active = false;
  let touchMode = false;
  let announceTimer: ReturnType<typeof setTimeout> | null = null;
  let rafHandle = 0;

  const ours = (e: Event): boolean => e.composedPath().includes(host);

  function setCurrent(el: Element | null): void {
    if (!el || el === host) return;
    current = el;
    draw();
    renderCrumbs(el);
    announce(el);
  }

  function draw(): void {
    if (!current || !active) return;
    // Elements that were removed from the DOM report a zero rect — drop them
    // rather than draw a ring at 0,0 (SPA churn, design §10.2).
    if (!current.isConnected) {
      const under = document.elementsFromPoint(pointer.x, pointer.y).find((n) => n !== host);
      current = under ?? null;
      if (!current) {
        chrome.ring.style.display = 'none';
        return;
      }
    }
    const r = current.getBoundingClientRect();
    Object.assign(chrome.ring.style, {
      display: '',
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    const res = hasResource(current) ? ' · resource' : '';
    const pos = stack.length > 1 ? ` · ${stackIndex + 1} of ${stack.length} under cursor` : '';
    chrome.tag.textContent = `${shortLabel(current)} · ${Math.round(r.width)}×${Math.round(r.height)}${res}${pos}`;
    Object.assign(chrome.tag.style, {
      display: '',
      left: `${Math.max(4, Math.min(r.left, window.innerWidth - 240))}px`,
      top: `${r.top > 28 ? r.top - 24 : r.bottom + 4}px`,
    });
  }

  function renderCrumbs(el: Element): void {
    if (!o.showBreadcrumbs) {
      chrome.crumbs.style.display = 'none';
      return;
    }
    chrome.crumbs.style.display = '';
    chrome.crumbs.replaceChildren();
    const chain: Element[] = [];
    let node: Element | null = el;
    for (let d = 0; node && d < 6; d += 1) {
      chain.unshift(node);
      node = parentOf(node);
    }
    chain.forEach((n, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = '›';
        chrome.crumbs.append(sep);
      }
      // Make the shadow boundary visible — the user must know when the tree they
      // are walking crosses into a web component (design §2.1).
      if (n.parentElement === null && n.getRootNode() instanceof ShadowRoot) {
        const marker = document.createElement('span');
        marker.className = 'sep';
        marker.textContent = '#shadow-root ›';
        chrome.crumbs.append(marker);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = shortLabel(n) + (hasResource(n) ? ' ●' : '');
      if (!hasResource(n)) btn.classList.add('muted');
      if (n === el) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', () => setCurrent(n), { signal });
      chrome.crumbs.append(btn);
    });
  }

  function announce(el: Element): void {
    if (announceTimer) clearTimeout(announceTimer);
    // 150ms debounce: with a mouse this fires on every move and would machine-gun
    // a screen reader (design §11.2).
    announceTimer = setTimeout(() => {
      const r = el.getBoundingClientRect();
      chrome.live.textContent = `${shortLabel(el)}, ${Math.round(r.width)} by ${Math.round(r.height)}, ${
        hasResource(el) ? 'has a resource' : 'no resource'
      }${stack.length > 1 ? `, ${stackIndex + 1} of ${stack.length} under the cursor` : ''}`;
    }, 150);
  }

  function refreshStack(x: number, y: number): void {
    pointer = { x, y };
    stack = document.elementsFromPoint(x, y).filter((n) => n !== host);
    stackIndex = 0;
  }

  function target(e: Event): Element | null {
    // composedPath()[0] pierces OPEN shadow roots; event.target would stop at the
    // host (adblock's blind spot). Closed roots are unreachable by definition and
    // the card says so honestly (design §4.7).
    const first = e.composedPath().find((n) => n instanceof Element && n !== host);
    return (first as Element | undefined) ?? null;
  }

  function commit(el: Element | null): void {
    if (!el) return;
    suspend();
    o.onPick(el);
  }

  /* ---- listeners: all bound to one signal ------------------------------- */

  document.addEventListener(
    'mousemove',
    (e: MouseEvent) => {
      if (!active || touchMode || ours(e)) return;
      refreshStack(e.clientX, e.clientY);
      const t = target(e);
      setCurrent(o.autoJumpToResource && t ? (nearestResource(t) ?? t) : t);
    },
    { capture: true, signal, passive: true },
  );

  // Touch: no hover exists, so a tap SELECTS and the Confirm button PICKS.
  document.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (!active || ours(e)) return;
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        touchMode = true;
        chrome.confirm.style.display = '';
        e.preventDefault();
        e.stopPropagation();
        refreshStack(e.clientX, e.clientY);
        const t = target(e);
        setCurrent(o.autoJumpToResource && t ? (nearestResource(t) ?? t) : t);
      }
    },
    { capture: true, signal },
  );

  // Swallow every page-navigating gesture while armed, so a pick never follows a
  // link or submits a form. Our own chrome (`ours`) passes through untouched.
  for (const type of ['mousedown', 'mouseup', 'click', 'auxclick', 'dblclick', 'submit'] as const) {
    document.addEventListener(
      type,
      (e: Event) => {
        if (!active || ours(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (type === 'click' && !touchMode) commit(current ?? target(e));
      },
      { capture: true, signal },
    );
  }

  // Right-click is a pointer-only escape hatch on desktop (Esc is the keyboard one,
  // Cancel is the touch one) — never leave the user trapped in picking mode.
  document.addEventListener(
    'contextmenu',
    (e: MouseEvent) => {
      if (!active || ours(e)) return;
      e.preventDefault();
      o.onCancel();
    },
    { capture: true, signal },
  );

  document.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (!active) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        o.onCancel();
        return;
      }
      const cur = current;
      if (!cur) return;
      const move = (next: Element | null | undefined): void => {
        if (!next) return;
        e.preventDefault();
        e.stopPropagation();
        setCurrent(next);
      };
      switch (e.key) {
        case 'ArrowUp':
          move(parentOf(cur));
          break;
        case 'ArrowDown':
          move(firstChildOf(cur));
          break;
        case 'ArrowLeft':
          move(cur.previousElementSibling);
          break;
        case 'ArrowRight':
          move(cur.nextElementSibling);
          break;
        case '[':
        case ']': {
          if (stack.length === 0) refreshStack(pointer.x, pointer.y);
          if (stack.length === 0) break;
          stackIndex = (stackIndex + (e.key === ']' ? 1 : -1) + stack.length) % stack.length;
          move(stack[stackIndex]);
          break;
        }
        case 'r':
        case 'R':
          move(nearestResource(cur));
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          e.stopPropagation();
          commit(cur);
          break;
        default:
          break;
      }
    },
    { capture: true, signal },
  );

  chrome.confirm.addEventListener('click', () => commit(current), { signal });
  chrome.cancel.addEventListener('click', () => o.onCancel(), { signal });

  // The ring follows the element by rAF, not by mousemove: if the SPA re-lays out
  // under the cursor, the ring rides along instead of pointing at empty space
  // (design §10.2).
  function tick(): void {
    if (signal.aborted) return;
    if (active) draw();
    rafHandle = requestAnimationFrame(tick);
  }
  rafHandle = requestAnimationFrame(tick);
  signal.addEventListener('abort', () => {
    cancelAnimationFrame(rafHandle);
    if (announceTimer) clearTimeout(announceTimer);
  });

  function suspend(): void {
    active = false;
    chrome.ring.style.display = 'none';
    chrome.tag.style.display = 'none';
    chrome.banner.style.display = 'none';
    chrome.crumbs.style.display = 'none';
  }

  function restart(): void {
    active = true;
    chrome.banner.style.display = '';
    chrome.confirm.style.display = touchMode ? '' : 'none';
    // Keyboard entry point: the focused element, else whatever was current.
    const focused = document.activeElement;
    const start =
      current ??
      (focused instanceof Element && focused !== document.body && focused !== host ? focused : null);
    if (start) setCurrent(start);
    else chrome.live.textContent = 'Element picker active. Move the pointer or press arrow keys.';
  }

  restart();
  return { restart, suspend, isActive: () => active };
}

/** Parent, crossing an OPEN shadow boundary upward to the host. */
function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** First child, descending into an OPEN shadow root when the element has one. */
function firstChildOf(el: Element): Element | null {
  if (el.shadowRoot?.firstElementChild) return el.shadowRoot.firstElementChild;
  return el.firstElementChild;
}
