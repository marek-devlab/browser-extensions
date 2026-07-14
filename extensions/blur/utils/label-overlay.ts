import { REVEAL_ATTR } from '@blur/core';
import { describeElement, labelFor } from './media-info';

/**
 * The "what's under the mask?" chips.
 *
 * WHY AN OVERLAY AND NOT A PSEUDO-ELEMENT. The obvious implementation is
 * `el::after { content: attr(data-bx-label) }`. It cannot work: `<img>` and
 * `<video>` are REPLACED elements and do not render pseudo-elements at all —
 * measured in both engines. The other tempting option, inserting a chip as a
 * sibling next to each masked element, mutates the page's own DOM: it changes
 * child counts and breaks `:nth-child`, flex and grid layouts on real sites.
 *
 * So the chips live in ONE fixed-position layer, in a CLOSED shadow root, which
 * gives three things that matter:
 *   - the page's CSS cannot reach in and restyle (or un-hide) our UI, and the
 *     page's JS cannot read it back out;
 *   - the page's layout is untouched — we add exactly one element, to
 *     `documentElement`, outside any of the page's own containers;
 *   - one layer, not one node per image, so a feed with 500 thumbnails costs 500
 *     cheap chip divs only while they are ON SCREEN.
 *
 * COST DISCIPLINE (this must not make a phone stutter — Firefox for Android is a
 * real target): chips exist only for elements currently intersecting the
 * viewport, and repositioning is coalesced into a single rAF. When the feature
 * is off, none of this is constructed at all.
 */

/** Below this, a chip would cover the very thing it is annotating. */
const MIN_W = 56;
const MIN_H = 22;

const LAYER_CSS = `
  :host { all: initial; }
  .layer {
    position: fixed;
    inset: 0;
    /* Never intercept a click: the user must still be able to click through to
       reveal the element underneath, or to use the page normally. */
    pointer-events: none;
    z-index: 2147483647;
  }
  .chip {
    position: absolute;
    box-sizing: border-box;
    max-width: 100%;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(12, 14, 20, 0.82);
    color: #e8eaf0;
    border: 1px solid rgba(255, 255, 255, 0.18);
    font: 500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* The mask sits at the element's own stacking level; the chip must read
       clearly against any mask colour the user picks. */
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }
`;

export class LabelOverlay {
  #host: HTMLElement | null = null;
  #layer: HTMLElement | null = null;
  #chips = new Map<Element, HTMLElement>();
  #tracked = new Set<Element>();
  #onScreen = new Set<Element>();
  #io: IntersectionObserver | null = null;
  #rafId = 0;
  #running = false;

  start(): void {
    if (this.#running) return;
    this.#running = true;

    const host = document.createElement('div');
    // A page could still target us by tag+attribute; `all: initial` on :host plus
    // a closed root means it cannot style or read the contents either way.
    host.setAttribute('data-bx-labels', '');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = LAYER_CSS;
    const layer = document.createElement('div');
    layer.className = 'layer';
    root.append(style, layer);

    // documentElement, not body: this runs at document_start, when there is no
    // body yet.
    document.documentElement.append(host);
    this.#host = host;
    this.#layer = layer;

    this.#io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) this.#onScreen.add(e.target);
          else {
            this.#onScreen.delete(e.target);
            this.#removeChip(e.target);
          }
        }
        this.#schedule();
      },
      { rootMargin: '100px' },
    );

    addEventListener('scroll', this.#schedule, { passive: true, capture: true });
    addEventListener('resize', this.#schedule, { passive: true });
  }

  /** Feed the current set of masked elements. Safe to call repeatedly. */
  track(elements: Iterable<Element>): void {
    if (!this.#running || !this.#io) return;
    for (const el of elements) {
      if (this.#tracked.has(el)) continue;
      this.#tracked.add(el);
      this.#io.observe(el);
    }
    this.#schedule();
  }

  /** Drop an element (revealed, or removed from the DOM). */
  untrack(el: Element): void {
    this.#tracked.delete(el);
    this.#onScreen.delete(el);
    this.#io?.unobserve(el);
    this.#removeChip(el);
  }

  #schedule = (): void => {
    if (!this.#running || this.#rafId) return;
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = 0;
      this.#position();
    });
  };

  #removeChip(el: Element): void {
    const chip = this.#chips.get(el);
    if (chip) {
      chip.remove();
      this.#chips.delete(el);
    }
  }

  #position(): void {
    if (!this.#running || !this.#layer) return;

    for (const el of this.#onScreen) {
      // Gone from the DOM between frames — do not leak a chip for it.
      if (!el.isConnected) {
        this.untrack(el);
        continue;
      }
      // A revealed element is showing its real content; a chip describing what is
      // "hidden" underneath would be both wrong and in the way.
      if (el.hasAttribute(REVEAL_ATTR)) {
        this.#removeChip(el);
        continue;
      }

      const r = el.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H) {
        this.#removeChip(el);
        continue;
      }

      let chip = this.#chips.get(el);
      if (!chip) {
        chip = document.createElement('div');
        chip.className = 'chip';
        // Describe once, on first paint of the chip: naturalWidth/videoWidth are
        // stable, and re-reading computed styles every scroll frame would be the
        // one thing here that actually costs.
        chip.textContent = labelFor(describeElement(el));
        this.#layer.append(chip);
        this.#chips.set(el, chip);
      }
      // Pinned to the element's top-left, inset slightly so it reads as sitting
      // ON the mask rather than floating beside it.
      chip.style.left = `${Math.round(r.left + 4)}px`;
      chip.style.top = `${Math.round(r.top + 4)}px`;
      chip.style.maxWidth = `${Math.max(0, Math.round(r.width - 8))}px`;
    }
  }

  destroy(): void {
    if (!this.#running) return;
    this.#running = false;
    removeEventListener('scroll', this.#schedule, { capture: true } as EventListenerOptions);
    removeEventListener('resize', this.#schedule);
    if (this.#rafId) cancelAnimationFrame(this.#rafId);
    this.#rafId = 0;
    this.#io?.disconnect();
    this.#io = null;
    this.#chips.clear();
    this.#tracked.clear();
    this.#onScreen.clear();
    this.#host?.remove();
    this.#host = null;
    this.#layer = null;
  }
}
