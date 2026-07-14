import { applyStylesheet, processInChunks, scheduleTask } from '@blur/core';

/**
 * Text blur — the one blur target the shared `DomRuleEngine` cannot do, because
 * matched *text* is not addressable by a CSS selector.
 *
 * Two strategies behind one interface:
 *  1. CSS Custom Highlight API (Baseline ~March 2026) — style `Range`s with no
 *     DOM mutation at all. `filter` is NOT a supported `::highlight()` property,
 *     so a Gaussian blur is impossible there; `color: transparent` +
 *     `text-shadow` is supported and reproduces the blur look.
 *  2. Span wrapping — the fallback. Wrap each match in a `<span>` styled the same
 *     transparent-text + shadow way (lighter than `filter: blur()`, which would
 *     promote a compositing layer per span).
 *
 * ACCESSIBILITY: blurred text stays in the DOM and the accessibility tree, so
 * screen readers still read it aloud and Ctrl+F still finds it. This visually
 * softens content; it does not truly hide it. (Surfaced in the options UI.)
 */

const HIGHLIGHT_NAME = 'bx-text';
const TEXT_BLUR_CLASS = 'bx-text-blur';
const TEXT_REVEAL_ATTR = 'data-bx-text-revealed';
const STYLE_MARKER = 'bx-text';
const BATCH_SIZE = 128;

/** Tags whose text content must never be touched. */
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'CODE',
  'PRE',
  // The walk starts at documentElement, so it visits <head> and <title> text
  // too. Wrapping a <span> inside <title> corrupts the tab title and inflates
  // the match count; OPTION/SELECT text is likewise not real page content (C4).
  'TITLE',
  'HEAD',
  'OPTION',
  'SELECT',
]);

export interface TextBlurrer {
  start(): void;
  stop(): void;
  /**
   * Stop observing but LEAVE THE TEXT BLURRED. Used when the extension context is
   * invalidated (an update): `stop()` removes the stylesheet and the effect, which
   * would repaint every hidden word on screen. See DomRuleEngine.freeze().
   */
  freeze(): void;
  /** Reveal all blurred text, until the next navigation. */
  revealAll(): void;
  /** Undo a `revealAll` and re-blur everything (used by the reveal-timeout). */
  reblur(): void;
  readonly matches: number;
}

interface CompiledFragment {
  source: string;
  flags: string;
}

/**
 * Compile one user pattern. Plain keywords are escaped and word-bounded;
 * `/pattern/flags` literal syntax is honoured. Returns `null` for an invalid
 * regex so a single bad entry cannot take the whole matcher down.
 */
function compileFragment(raw: string): CompiledFragment | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const literal = /^\/(.+)\/([a-z]*)$/.exec(trimmed);
  try {
    if (literal) {
      const body = literal[1] ?? '';
      const flags = literal[2] ?? '';
      new RegExp(body, flags); // validate in isolation
      return { source: `(?:${body})`, flags };
    }
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // JS `\b` is ASCII-only, so `/\bспойлер\b/i` never matches "спойлер". Use
    // Unicode-property boundaries plus the `u` flag so whole-word matching works
    // for any script; `\p{L}\p{N}_` requires `u` (or `v`) to be legal at all.
    return {
      source: `(?:(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_]))`,
      flags: 'iu',
    };
  } catch {
    return null;
  }
}

/**
 * Compile the user's patterns into ONE alternation regex, compiled once.
 *
 * Alternation backtracks, so beyond roughly 1–2k terms this must move to an
 * Aho-Corasick automaton (one linear scan regardless of term count). Exported
 * so the options page can validate a pattern with the same rules the content
 * script uses.
 */
export function compileTextMatcher(patterns: readonly string[]): RegExp | null {
  const fragments: CompiledFragment[] = [];
  for (const p of patterns) {
    const f = compileFragment(p);
    if (f) fragments.push(f);
  }
  if (fragments.length === 0) return null;

  const flags = new Set<string>(['g']);
  for (const f of fragments) for (const ch of f.flags) flags.add(ch);
  // `u` and `v` are mutually exclusive, but `v` is a strict superset of `u`
  // (Unicode-aware, and `\p{L}` is valid under it), so drop `u` when a literal
  // pulled in `v` rather than throwing away every pattern.
  if (flags.has('u') && flags.has('v')) flags.delete('u');
  const flagStr = [...flags].join('');

  // Each fragment was validated in ISOLATION by compileFragment, but the union
  // regex is compiled with the COMBINED flag set. A single plain keyword forces
  // `u` onto the whole alternation (its boundaries need `\p{L}`), and a literal
  // that is legal without `u` — e.g. `/a{/`, where `{` is a literal brace — is a
  // syntax error under `u`. Compiling the union then throws, the catch returns
  // null, and ALL text blur silently dies (C2). So re-validate every fragment
  // under the EFFECTIVE flags and keep only the ones that survive, rather than
  // letting one offender poison the batch.
  const usable = fragments.filter((f) => {
    try {
      new RegExp(f.source, flagStr);
      return true;
    } catch {
      return false;
    }
  });
  if (usable.length === 0) return null;

  try {
    return new RegExp(usable.map((f) => f.source).join('|'), flagStr);
  } catch {
    // Any remaining incompatible flag combination — degrade to no-op rather
    // than throwing and taking the whole content script down.
    return null;
  }
}

/**
 * Validate a single pattern for the options UI. Returns an error string or null.
 *
 * A plain keyword is compiled with `u` (its Unicode word boundaries require it),
 * so validate it exactly as the matcher will — otherwise the UI could accept a
 * `/regex/` literal that survives alone but is dropped once combined. This mirrors
 * `compileFragment` + the effective-flag re-check in `compileTextMatcher`.
 */
export function validateTextPattern(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'Pattern is empty.';
  const fragment = compileFragment(trimmed);
  if (!fragment) return 'Invalid regular expression.';
  // Re-check the compiled source under the same Unicode flag a keyword would
  // impose, so "valid here, silently dropped there" cannot happen.
  try {
    new RegExp(fragment.source, fragment.flags.includes('u') ? fragment.flags : 'u');
    return null;
  } catch {
    return 'This pattern is not valid with Unicode matching.';
  }
}

interface Match {
  index: number;
  length: number;
}

function findMatches(re: RegExp, text: string): Match[] {
  const out: Match[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const full = m[0];
    if (full === undefined) break;
    if (full === '') {
      // Zero-width match would loop forever; step past it.
      re.lastIndex++;
      continue;
    }
    out.push({ index: m.index, length: full.length });
  }
  return out;
}

function isSkippable(node: Text): boolean {
  const data = node.data;
  if (!data || !data.trim()) return true;
  const parent = node.parentElement;
  if (!parent) return true;
  for (let el: Element | null = parent; el; el = el.parentElement) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.classList.contains(TEXT_BLUR_CLASS)) return true;
    if (el instanceof HTMLElement && el.isContentEditable) return true;
  }
  return false;
}

/* --------------------- Custom Highlight API access ---------------------- */
/* Access the globals through narrow local types: TS lib coverage for the
 * Highlight API is inconsistent across versions and this keeps us off `any`. */

type HighlightConstructor = new (...ranges: Range[]) => object;
interface HighlightRegistryLike {
  set(name: string, highlight: object): void;
  delete(name: string): boolean;
}

function getHighlightApi(): {
  registry: HighlightRegistryLike;
  Ctor: HighlightConstructor;
} | null {
  const g = globalThis as {
    CSS?: { highlights?: unknown };
    Highlight?: unknown;
  };
  if (typeof g.CSS === 'undefined' || !g.CSS || !('highlights' in g.CSS)) {
    return null;
  }
  const registry = g.CSS.highlights;
  const Ctor = g.Highlight;
  if (!registry || typeof Ctor !== 'function') return null;
  return {
    registry: registry as HighlightRegistryLike,
    Ctor: Ctor as HighlightConstructor,
  };
}

/* ------------------------------ Strategies ------------------------------ */

abstract class BaseTextBlurrer implements TextBlurrer {
  protected count = 0;
  protected running = false;
  protected readonly processed = new WeakSet<Text>();
  protected styleTeardown?: () => void;

  #observer?: MutationObserver;
  #pending = new Set<Node>();
  #drainScheduled = false;

  constructor(
    protected readonly matcher: RegExp,
    protected readonly onCount: () => void,
  ) {}

  get matches(): number {
    return this.count;
  }

  abstract protectedStyle(): string;
  protected abstract processNode(node: Text): void;
  /** Apply the accumulated effect and prune anything detached from the DOM. */
  protected abstract commit(): void;
  protected abstract clearEffect(): void;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.styleTeardown = applyStylesheet(
      document,
      this.protectedStyle(),
      STYLE_MARKER,
    );
    this.#startObserver();
    // The initial walk can be large; never run it synchronously at
    // document_start or it becomes a long task before first paint.
    scheduleTask(() => this.#scan(document.documentElement));
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#pending.clear();
    this.#drainScheduled = false;
    this.clearEffect();
    this.styleTeardown?.();
    this.styleTeardown = undefined;
    this.count = 0;
  }

  /**
   * Fail closed: release the observer, keep the blur. On an extension update the
   * content script is invalidated, and a full `stop()` here would strip the
   * stylesheet and the effect — un-blurring every matched word on every open tab,
   * with no user action. Freezing leaves the page exactly as hidden as it was.
   */
  freeze(): void {
    if (!this.running) return;
    this.running = false;
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#pending.clear();
    this.#drainScheduled = false;
    // Deliberately NOT run: clearEffect() and styleTeardown() — those are what
    // would reveal the text.
  }

  revealAll(): void {
    document.documentElement.setAttribute(TEXT_REVEAL_ATTR, '');
    this.revealHook();
  }

  reblur(): void {
    if (!this.running) return;
    document.documentElement.removeAttribute(TEXT_REVEAL_ATTR);
    // Span strategy: dropping the attribute alone restores the CSS blur. Highlight
    // strategy: `commit()` re-`set`s the registry now that the gate is clear.
    this.commit();
  }

  /** Strategy-specific reveal (the Highlight API has no ancestor to key off). */
  protected revealHook(): void {}

  #startObserver(): void {
    this.#observer = new MutationObserver((records) => {
      let removed = false;
      for (const record of records) {
        if (record.type === 'characterData') {
          if (record.target instanceof Text) {
            this.processed.delete(record.target);
            this.#pending.add(record.target);
          }
          continue;
        }
        for (const node of record.addedNodes) {
          if (node instanceof Element || node instanceof Text) {
            this.#pending.add(node);
          }
        }
        // Removals must still schedule a drain: detached text nodes leave stale
        // ranges/spans behind, and `commit()` prunes them (see #8).
        if (record.removedNodes.length > 0) removed = true;
      }
      if (this.#pending.size > 0 || removed) this.#scheduleDrain();
    });
    this.#observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  #scheduleDrain(): void {
    if (this.#drainScheduled) return;
    this.#drainScheduled = true;
    scheduleTask(() => void this.#drain());
  }

  async #drain(): Promise<void> {
    this.#drainScheduled = false;
    if (!this.running) return;
    const roots = [...this.#pending];
    this.#pending.clear();
    const nodes: Text[] = [];
    for (const root of roots) this.#collectInto(root, nodes);
    await this.#process(nodes);
  }

  async #scan(root: Node): Promise<void> {
    if (!this.running) return;
    const nodes: Text[] = [];
    this.#collectInto(root, nodes);
    await this.#process(nodes);
  }

  /** Collect matches first; mutation happens only in `#process` afterwards. */
  #collectInto(root: Node, out: Text[]): void {
    if (root instanceof Text) {
      if (!this.processed.has(root) && !isSkippable(root)) out.push(root);
      return;
    }
    if (!(root instanceof Element) && !(root instanceof Document)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node instanceof Text &&
        !this.processed.has(node) &&
        !isSkippable(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    let node = walker.nextNode();
    while (node) {
      if (node instanceof Text) out.push(node);
      node = walker.nextNode();
    }
  }

  async #process(nodes: readonly Text[]): Promise<void> {
    const before = this.count;
    if (nodes.length > 0) {
      await processInChunks(nodes, BATCH_SIZE, (node) => this.processNode(node));
    }
    // Always commit, even with no new nodes: a removal-only drain still needs to
    // prune detached matches from the count and the effect.
    this.commit();
    if (this.count !== before) this.onCount();
  }
}

class HighlightTextBlurrer extends BaseTextBlurrer {
  #ranges: Range[] = [];
  #registry: HighlightRegistryLike;
  #Ctor: HighlightConstructor;

  constructor(
    matcher: RegExp,
    onCount: () => void,
    api: { registry: HighlightRegistryLike; Ctor: HighlightConstructor },
  ) {
    super(matcher, onCount);
    this.#registry = api.registry;
    this.#Ctor = api.Ctor;
  }

  protectedStyle(): string {
    // `filter` is not a valid `::highlight()` property; transparent text + a
    // shadow of the current colour is, and reads as a blur.
    return `::highlight(${HIGHLIGHT_NAME}) { color: transparent; text-shadow: 0 0 8px currentColor; }`;
  }

  protected processNode(node: Text): void {
    this.processed.add(node);
    for (const { index, length } of findMatches(this.matcher, node.data)) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + length);
      this.#ranges.push(range);
      this.count++;
    }
  }

  protected commit(): void {
    // Ranges point at text nodes that may since have been removed. The observer
    // never re-visits detached nodes, so without pruning here the array (and the
    // count) only ever grows. Drop disconnected ranges each commit.
    const kept: Range[] = [];
    for (const range of this.#ranges) {
      if (range.startContainer.isConnected) kept.push(range);
      else this.count--;
    }
    this.#ranges = kept;
    // Once the user revealed all, a later mutation drain must NOT re-blur (C3).
    // The span strategy survives reveal via a CSS attribute on <html>, but a
    // highlight has no ancestor to key off, so `revealHook` only deletes the
    // registry — and this `set` would immediately undo it. Gate on the same
    // document attribute so reveal persists across commits until navigation.
    if (document.documentElement.hasAttribute(TEXT_REVEAL_ATTR)) {
      this.#registry.delete(HIGHLIGHT_NAME);
      return;
    }
    if (kept.length > 0) {
      this.#registry.set(HIGHLIGHT_NAME, new this.#Ctor(...kept));
    } else {
      this.#registry.delete(HIGHLIGHT_NAME);
    }
  }

  protected clearEffect(): void {
    this.#registry.delete(HIGHLIGHT_NAME);
    this.#ranges = [];
  }

  protected revealHook(): void {
    // No ancestor attribute reaches a highlight, so revealing means dropping it.
    this.#registry.delete(HIGHLIGHT_NAME);
  }
}

class SpanTextBlurrer extends BaseTextBlurrer {
  // Every wrapper span we inject, tracked so `commit()` can prune the ones whose
  // subtree has since been removed from the DOM — mirroring the Highlight path's
  // range pruning. Without this the "Text" tally climbs monotonically on browsers
  // without the Custom Highlight API as wrapped matches scroll out (#8/C2).
  #spans = new Set<HTMLSpanElement>();

  protectedStyle(): string {
    return [
      `.${TEXT_BLUR_CLASS} { color: transparent; text-shadow: 0 0 8px currentColor; }`,
      `html[${TEXT_REVEAL_ATTR}] .${TEXT_BLUR_CLASS} { color: inherit; text-shadow: none; }`,
    ].join('\n');
  }

  protected processNode(node: Text): void {
    if (this.processed.has(node)) return;
    const text = node.data;
    const matches = findMatches(this.matcher, text);
    this.processed.add(node);
    if (matches.length === 0) return;

    const frag = document.createDocumentFragment();
    let last = 0;
    for (const { index, length } of matches) {
      if (index > last) frag.append(text.slice(last, index));
      const span = document.createElement('span');
      span.className = TEXT_BLUR_CLASS;
      span.textContent = text.slice(index, index + length);
      frag.append(span);
      this.#spans.add(span);
      last = index + length;
      this.count++;
    }
    if (last < text.length) frag.append(text.slice(last));
    node.replaceWith(frag);
  }

  protected commit(): void {
    // Prune spans whose subtree left the DOM (the observer never re-visits
    // detached nodes), decrementing the tally by one per lost match — the span
    // counterpart to HighlightTextBlurrer.commit()'s disconnected-range pruning.
    for (const span of this.#spans) {
      if (!span.isConnected) {
        this.#spans.delete(span);
        this.count--;
      }
    }
  }

  protected clearEffect(): void {
    for (const span of document.querySelectorAll(`.${TEXT_BLUR_CLASS}`)) {
      const parent = span.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(span.textContent ?? ''), span);
      parent.normalize();
    }
    this.#spans.clear();
    document.documentElement.removeAttribute(TEXT_REVEAL_ATTR);
  }
}

export function createTextBlurrer(
  patterns: readonly string[],
  onCount: () => void,
): TextBlurrer | null {
  const matcher = compileTextMatcher(patterns);
  if (!matcher) return null;
  const api = getHighlightApi();
  return api
    ? new HighlightTextBlurrer(matcher, onCount, api)
    : new SpanTextBlurrer(matcher, onCount);
}
