import { scheduleTask, processInChunks } from './scheduler';
import { collectOpenShadowRoots, deepQuerySelectorAll } from './shadow';
import { applyStylesheet, buildStylesheet, REVEAL_ATTR, SEEN_ATTR } from './stylesheet';
import type { MaskStyle, RevealMode } from './types';

/**
 * The shared foundation for content blurring and cosmetic ad filtering.
 *
 * Both features do the same job — find elements matching a rule set and apply a
 * CSS effect — so the stylesheet injection, mutation batching, viewport gating
 * and shadow-root traversal live here once. Only the action differs: `blur`
 * sets `filter: blur()`, `hide` sets `display: none`.
 *
 * The design follows uBlock Origin's: declarative rules become a single
 * injected user stylesheet, not per-element JavaScript. JS exists only to do
 * what CSS cannot — reach into shadow roots, count matches, and handle reveals.
 */

export type RuleAction = 'blur' | 'hide';

export interface DomRule {
  selector: string;
  action: RuleAction;
  /** Restrict to these hostnames (subdomains included). Empty means everywhere. */
  hostnames?: string[];
  /**
   * Category key for exact per-category counting (e.g. 'images', 'video').
   * Lets a consumer read precise counts from `stats.byLabel` instead of
   * re-scanning the DOM and guessing categories by tag name.
   */
  label?: string;
}

export interface DomRuleEngineOptions {
  rules: DomRule[];
  blurRadius: number;
  reveal: RevealMode;
  /** How matched content is obscured: gaussian `blur` or an opaque `solid` fill. */
  maskStyle?: MaskStyle;
  maskColor?: string;
  maskOpacity?: number;
  hostname: string;
  /** Nodes processed per chunk before yielding to the event loop. */
  batchSize?: number;
  /** How far outside the viewport to start counting elements. */
  rootMargin?: string;
  onStatsChange?: (stats: EngineStats) => void;
}

export interface EngineStats {
  blurred: number;
  hidden: number;
  shadowRootsPatched: number;
  /** Exact per-category counts, keyed by `DomRule.label`. */
  byLabel: Record<string, number>;
}

const OBSERVED_ATTRIBUTES = ['src', 'srcset', 'poster', 'style', 'class'];

export class DomRuleEngine {
  #options: Required<Omit<DomRuleEngineOptions, 'onStatsChange'>> &
    Pick<DomRuleEngineOptions, 'onStatsChange'>;

  #stats: EngineStats = { blurred: 0, hidden: 0, shadowRootsPatched: 0, byLabel: {} };
  #running = false;

  #mutationObserver?: MutationObserver;
  #intersectionObserver?: IntersectionObserver;
  #teardowns: (() => void)[] = [];
  #patchedRoots = new WeakSet<ShadowRoot>();
  /** Currently observed targets, so removed nodes can be unobserved (no leak). */
  #observed = new Set<Element>();

  /** Nodes seen by the MutationObserver, drained on a scheduler tick. */
  #pending = new Set<Element>();
  #drainScheduled = false;

  constructor(options: DomRuleEngineOptions) {
    this.#options = {
      batchSize: 64,
      rootMargin: '200px',
      // Defaults keep the engine's masking behaviour unchanged for callers that
      // never opt into solid masking (the adblock extension's cosmetic filtering
      // uses `hide`, not `blur`, and passes none of these).
      maskStyle: 'blur',
      maskColor: '#1f2430',
      maskOpacity: 1,
      ...options,
    };
  }

  get stats(): Readonly<EngineStats> {
    // Deep-copy byLabel: a consumer that snapshots the stats must not see the
    // object mutate under it as the engine keeps incrementing counts.
    return { ...this.#stats, byLabel: { ...this.#stats.byLabel } };
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;

    this.#injectInto(document);
    this.#startIntersectionObserver();
    this.#startMutationObserver();

    // The initial sweep can be large; never run it synchronously at
    // document_start or it becomes a long task before first paint.
    scheduleTask(() => void this.#sweep(document));
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;

    this.#mutationObserver?.disconnect();
    this.#intersectionObserver?.disconnect();
    this.#mutationObserver = undefined;
    this.#intersectionObserver = undefined;

    for (const teardown of this.#teardowns.splice(0)) teardown();

    // Strip the engine's attributes so a subsequent start() re-processes
    // elements cleanly and stale [data-bx-seen] can't inflate a consumer's
    // count of what is currently blurred.
    for (const el of deepQuerySelectorAll(document, `[${SEEN_ATTR}], [${REVEAL_ATTR}]`)) {
      el.removeAttribute(SEEN_ATTR);
      el.removeAttribute(REVEAL_ATTR);
    }

    this.#pending.clear();
    this.#observed.clear();
    this.#drainScheduled = false;
    this.#patchedRoots = new WeakSet();
    this.#stats = { blurred: 0, hidden: 0, shadowRootsPatched: 0, byLabel: {} };
    this.#emitStats();
  }

  /**
   * Stop observing, but LEAVE THE MASKS IN PLACE. Fail closed.
   *
   * `stop()` is a clean teardown: it removes the injected stylesheets and strips
   * the engine's attributes, which un-hides everything. That is right when the
   * user turns the extension off — and catastrophic when the extension context is
   * merely INVALIDATED (an update, or a reload during development). In that case
   * every open tab would suddenly repaint the exact content it was hiding, with
   * no action from the user and no warning. For a tool whose whole purpose is
   * keeping content off the screen, un-hiding as a side effect of an update is
   * the worst possible failure.
   *
   * So on invalidation we freeze instead: the observers (which would leak, since
   * nothing will ever tear them down) are disconnected, while the stylesheet stays
   * adopted and the attributes stay put. The page keeps whatever it is already
   * masking until it is reloaded — content never becomes visible by accident.
   */
  freeze(): void {
    if (!this.#running) return;
    this.#running = false;
    this.#mutationObserver?.disconnect();
    this.#intersectionObserver?.disconnect();
    this.#mutationObserver = undefined;
    this.#intersectionObserver = undefined;
    this.#pending.clear();
    this.#observed.clear();
    this.#drainScheduled = false;
    // Deliberately NOT run: this.#teardowns (they remove the stylesheets) and the
    // attribute cleanup. Those are what would reveal the content.
  }

  /** Swap the rule set without a full teardown, e.g. on a settings change. */
  updateRules(rules: DomRule[]): void {
    const wasRunning = this.#running;
    if (wasRunning) this.stop();
    this.#options = { ...this.#options, rules };
    if (wasRunning) this.start();
  }

  /** Reveal one element. Reversible: the stylesheet keys off an attribute. */
  reveal(element: Element): void {
    element.setAttribute(REVEAL_ATTR, '');
  }

  revealAll(): void {
    for (const el of this.#matchingElements(document)) {
      el.setAttribute(REVEAL_ATTR, '');
    }
  }

  /* ---------------------------------------------------------------- */

  get #css(): string {
    const { rules, blurRadius, reveal, hostname, maskStyle, maskColor, maskOpacity } =
      this.#options;
    return buildStylesheet(rules, {
      blurRadius,
      reveal,
      hostname,
      maskStyle,
      maskColor,
      maskOpacity,
    });
  }

  #injectInto(root: Document | ShadowRoot): void {
    const css = this.#css;
    if (!css) return;
    this.#teardowns.push(applyStylesheet(root, css, 'bx-engine'));
  }

  #patchShadowRoot(shadowRoot: ShadowRoot): void {
    if (this.#patchedRoots.has(shadowRoot)) return;
    this.#patchedRoots.add(shadowRoot);
    this.#injectInto(shadowRoot);
    // One MutationObserver can watch many targets; attach it to this root so
    // dynamically-added shadow content (YouTube lazily appends thumbnails into
    // an existing shadow root on scroll) is caught and counted, not just the
    // top document tree. disconnect() in stop() tears down all targets at once.
    this.#mutationObserver?.observe(shadowRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: OBSERVED_ATTRIBUTES,
    });
    this.#stats.shadowRootsPatched++;
  }

  #selector(): string {
    const selectors = this.#options.rules.map((r) => r.selector);
    return selectors.length > 0 ? selectors.join(',') : '';
  }

  #matchingElements(root: Document | ShadowRoot): Element[] {
    const selector = this.#selector();
    return selector ? deepQuerySelectorAll(root, selector) : [];
  }

  async #sweep(root: Document | ShadowRoot): Promise<void> {
    if (!this.#running) return;

    for (const shadowRoot of collectOpenShadowRoots(root)) {
      this.#patchShadowRoot(shadowRoot);
    }

    const elements = this.#matchingElements(root);
    await processInChunks(elements, this.#options.batchSize, (el) => {
      // stop() may have run during a yield between chunks; if so, bail rather
      // than re-populating #observed with elements stop() just cleared.
      if (!this.#running) return;
      this.#observe(el);
    });
    if (!this.#running) return;
    this.#emitStats();
  }

  /**
   * Counting is gated on visibility rather than done during the sweep: an
   * element that never scrolls into view costs nothing, and the compositor
   * never has to promote a layer for it.
   */
  #startIntersectionObserver(): void {
    this.#intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.#count(entry.target);
          // Without this the entry queue outgrows the drain rate on fast scroll.
          this.#intersectionObserver?.unobserve(entry.target);
          this.#observed.delete(entry.target);
        }
        this.#emitStats();
      },
      { rootMargin: this.#options.rootMargin },
    );
  }

  /** The first rule that applies to this element on the current host, if any. */
  #ruleFor(element: Element): DomRule | undefined {
    const { rules, hostname } = this.#options;
    return rules.find(
      (r) =>
        element.matches(r.selector) &&
        (!r.hostnames?.length ||
          r.hostnames.some((h) => hostname === h || hostname.endsWith(`.${h}`))),
    );
  }

  #observe(element: Element): void {
    if (element.hasAttribute(SEEN_ATTR)) return;

    const rule = this.#ruleFor(element);
    if (!rule) return;

    // A `hide` element gets `display: none`, so it has no box and the
    // IntersectionObserver would never fire for it — count it immediately.
    // Only `blur` elements, which stay laid out, are gated on visibility.
    if (rule.action === 'hide') {
      this.#count(element, rule);
      return;
    }

    this.#observed.add(element);
    this.#intersectionObserver?.observe(element);
  }

  #count(element: Element, knownRule?: DomRule): void {
    if (element.hasAttribute(SEEN_ATTR)) return;

    const rule = knownRule ?? this.#ruleFor(element);
    if (!rule) return;
    element.setAttribute(SEEN_ATTR, '');

    if (rule.action === 'blur') this.#stats.blurred++;
    else this.#stats.hidden++;

    const label = rule.label ?? rule.action;
    this.#stats.byLabel[label] = (this.#stats.byLabel[label] ?? 0) + 1;
  }

  /** Release observer references to nodes that have left the DOM. */
  #pruneObserved(): void {
    for (const el of this.#observed) {
      if (!el.isConnected) {
        this.#intersectionObserver?.unobserve(el);
        this.#observed.delete(el);
      }
    }
  }

  /**
   * The callback only collects. Doing layout work here — `getBoundingClientRect`,
   * `getComputedStyle` — thrashes layout on infinite-scroll pages, where this
   * fires continuously.
   */
  #startMutationObserver(): void {
    this.#mutationObserver = new MutationObserver((records) => {
      let removed = false;
      for (const record of records) {
        if (record.type === 'attributes') {
          if (record.target instanceof Element) this.#pending.add(record.target);
          continue;
        }
        for (const node of record.addedNodes) {
          if (node instanceof Element) this.#pending.add(node);
        }
        if (record.removedNodes.length > 0) removed = true;
      }
      if (removed) this.#pruneObserved();
      this.#scheduleDrain();
    });

    this.#mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      // Watching every attribute with subtree:true fires constantly. SPAs reuse
      // an <img> and swap src/srcset, so those specifically must be caught.
      attributeFilter: OBSERVED_ATTRIBUTES,
    });
  }

  #scheduleDrain(): void {
    if (this.#drainScheduled) return;
    this.#drainScheduled = true;
    scheduleTask(() => void this.#drain());
  }

  async #drain(): Promise<void> {
    this.#drainScheduled = false;
    if (!this.#running) return;

    const batch = [...this.#pending];
    this.#pending.clear();
    const selector = this.#selector();
    if (!selector) return;

    await processInChunks(batch, this.#options.batchSize, (element) => {
      if (!this.#running) return;
      if (element.shadowRoot) this.#patchShadowRoot(element.shadowRoot);
      // A newly-inserted subtree may itself contain shadow hosts; querySelectorAll
      // does not pierce them, so patch each open root and query inside it.
      for (const shadowRoot of collectOpenShadowRoots(element)) {
        this.#patchShadowRoot(shadowRoot);
        for (const el of shadowRoot.querySelectorAll(selector)) this.#observe(el);
      }
      if (element.matches(selector)) this.#observe(element);
      for (const descendant of element.querySelectorAll(selector)) {
        this.#observe(descendant);
      }
    });
    if (!this.#running) return;
    this.#emitStats();
  }

  #emitStats(): void {
    this.#options.onStatsChange?.(this.stats);
  }
}

/** Selectors for the categorical blur features, in block-first form. */
export const BLUR_SELECTORS = {
  images: 'img',
  video: 'video',
  // Thumbnails are frequently a background-image on a div, not an <img>, so a
  // tag selector alone misses them on most video platforms.
  posters: 'video[poster], [style*="background-image"]',
} as const;
