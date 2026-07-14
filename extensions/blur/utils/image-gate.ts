import { SMALL_IMAGE_ATTR } from './features';

/**
 * Minimum image-size gate.
 *
 * Favicons, spacer GIFs and 1px tracking pixels are `<img>` elements, so the
 * block-first `img` rule blurs them too — a pointless GPU layer on invisible
 * content. CSS cannot select by rendered size, so this is a JS post-filter: it
 * stamps `SMALL_IMAGE_ATTR` on images below `minPx` in BOTH axes, and the engine's
 * `img:not([data-bx-small])` selector (see `buildImageSelector`) then leaves them
 * sharp. Runs off the main render path — the brief blur before an image's size is
 * known is invisible for the tiny images this targets.
 *
 * NOTE: the core engine has no per-element matched hook, so an image already
 * counted before it is marked stays in the tally for this page load. The visual
 * result is correct; only the count is marginally generous. A core callback would
 * make the count exact — see the report.
 */
export function installImageSizeGate(minPx: number): () => void {
  if (!(minPx > 0)) return () => {};

  // A `{ once: true }` load listener registered below can still fire AFTER
  // teardown (e.g. the user set the minimum size back to 0). Since
  // `buildImageSelector` always emits `:not([data-bx-small])`, a late re-stamp
  // would strand that image sharp when it should blur. This flag lets the teardown
  // neutralize any such pending evaluate() (#5).
  let disposed = false;

  function evaluate(img: HTMLImageElement): void {
    if (disposed) return;
    // Prefer intrinsic size (known once loaded); fall back to the layout box.
    const w = img.naturalWidth || img.clientWidth;
    const h = img.naturalHeight || img.clientHeight;
    if (w && h && w < minPx && h < minPx) img.setAttribute(SMALL_IMAGE_ATTR, '');
    else img.removeAttribute(SMALL_IMAGE_ATTR);
  }

  function consider(img: HTMLImageElement): void {
    if (img.complete) evaluate(img);
    else img.addEventListener('load', () => evaluate(img), { once: true });
  }

  function scan(root: ParentNode): void {
    for (const img of root.querySelectorAll('img')) consider(img as HTMLImageElement);
  }

  scan(document);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLImageElement) consider(node);
        else if (node instanceof Element) scan(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  return () => {
    disposed = true;
    observer.disconnect();
    for (const img of document.querySelectorAll(`img[${SMALL_IMAGE_ATTR}]`)) {
      img.removeAttribute(SMALL_IMAGE_ATTR);
    }
  };
}
