/**
 * "Show me where that was": briefly un-hide + outline the elements a stored
 * cosmetic filter is currently hiding, and scroll the first one into view.
 *
 * Used by the popup's "Hidden by you on this site" list so a person can confirm
 * WHICH thing an entry refers to before restoring it — the deferred-undo
 * counterpart to the in-page toast.
 *
 * HOW IT BEATS OUR OWN HIDE RULE. The engine hides with
 * `selector { display: none !important }`, injected as a constructed stylesheet.
 * An override therefore has to win on SPECIFICITY (both declarations are author
 * `!important`, so source order is irrelevant), against a selector we don't know
 * the shape of. `html :is(SEL)[data-abx-peek]` always does: `:is()` takes the
 * MAXIMUM specificity of its arguments — so it matches whatever SEL scores, even
 * for a comma list — and the tag plus the attribute add strictly more on top.
 *
 * WHY NOT INLINE STYLES. `element.style` would also outrank the rule, and was the
 * first implementation — but the DomRuleEngine's MutationObserver watches the
 * `style` attribute (`OBSERVED_ATTRIBUTES`), so writing inline styles onto page
 * elements makes the engine re-process them mid-peek and left an empty `style=""`
 * attribute on the page's own element on some runs (caught by T12 in the live
 * harness — it was intermittent). A marker attribute the engine does not watch,
 * plus a stylesheet of our own, mutates nothing the engine cares about and leaves
 * provably nothing behind: teardown removes one attribute and one <style>.
 */

/** Cap the work: a broad selector could match hundreds of nodes. */
const MAX_ELEMENTS = 25;
const PEEK_MS = 2200;

const PEEK_ATTR = 'data-abx-peek';

let restore: (() => void) | undefined;

/**
 * Reveal everything matching `selector` for `ms`. Returns how many elements were
 * revealed (0 for an invalid selector or no match, so the caller can say so).
 * Calling again cancels any peek in flight.
 */
export function peekElements(selector: string, ms: number = PEEK_MS): number {
  restore?.();

  let els: Element[];
  try {
    els = [...document.querySelectorAll(selector)].slice(0, MAX_ELEMENTS);
  } catch {
    return 0; // Malformed selector (hand-typed in Options) — never throw.
  }
  if (els.length === 0) return 0;

  for (const el of els) el.setAttribute(PEEK_ATTR, '');

  const style = document.createElement('style');
  style.textContent =
    `html :is(${selector})[${PEEK_ATTR}] {` +
    ' display: revert !important;' +
    ' outline: 3px solid #5b8cff !important;' +
    ' outline-offset: 2px !important;' +
    ' }';
  document.documentElement.append(style);

  els[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });

  let done = false;
  const undo = (): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    style.remove();
    for (const el of els) el.removeAttribute(PEEK_ATTR);
    if (restore === undo) restore = undefined;
  };
  const timer = setTimeout(undo, ms);
  restore = undo;
  return els.length;
}

/** Cancel any peek in flight (content-script teardown). */
export function cancelPeek(): void {
  restore?.();
}
