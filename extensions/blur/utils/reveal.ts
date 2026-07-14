import type { DomRuleEngine } from '@blur/core';
import { REVEAL_ATTR } from '@blur/core';

/**
 * Click-to-reveal (PLAN.md §3.7).
 *
 * `hover` reveal is pure CSS emitted by `buildStylesheet`, so nothing is needed
 * for it here. `click` reveal must not cover media with an intercepting overlay
 * — instead a single capture-phase listener catches the first click on a still
 * blurred element, reveals it, and swallows THAT click so the page's own handler
 * doesn't fire on the reveal. It keys off `REVEAL_ATTR` rather than removing the
 * listener, so once an element is revealed every later click passes straight
 * through to the page.
 */
export function installClickReveal(
  engine: DomRuleEngine,
  blurSelector: string,
  /** Auto re-hide a click-revealed element after this many seconds. 0 = never. */
  revealTimeoutSec = 0,
): () => void {
  if (!blurSelector) return () => {};

  // Match a blurred ancestor that has NOT been revealed yet.
  const notRevealed = blurSelector
    .split(',')
    .map((s) => `${s.trim()}:not([${REVEAL_ATTR}])`)
    .join(',');

  // Track pending re-hide timers so teardown clears them (no leak, no firing
  // after the engine has stopped).
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const blurred = target.closest(notRevealed);
    if (!blurred) return; // already revealed, or not a blur target — pass through
    engine.reveal(blurred);
    // This click only: don't let the page act on the click that just revealed.
    event.stopPropagation();
    event.preventDefault();

    if (revealTimeoutSec > 0) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        // Reversible reveal: dropping the attribute re-applies the CSS blur.
        blurred.removeAttribute(REVEAL_ATTR);
      }, revealTimeoutSec * 1000);
      timers.add(timer);
    }
  };

  document.addEventListener('click', onClick, { capture: true });
  return () => {
    document.removeEventListener('click', onClick, { capture: true });
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}
