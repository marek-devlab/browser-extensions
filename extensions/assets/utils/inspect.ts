import { todoLogic } from '@blur/ui';
import type { ResourceCardModel } from './assets-types';
import {
  mockImageResource,
  mockIframeResource,
  mockMseResource,
  mockNoResource,
} from './mock-data';

// The real-vs-mock seam for element inspection (MOCK rules, PLAN.md §15).
//
// `readResourceMetadata` is the REAL entry point and is intentionally NOT
// implemented — it throws todoLogic so a wired-but-empty path fails loudly and
// `grep TODO_LOGIC` lists it as backlog. When implemented it will read, from the
// picked DOM element and Resource Timing, all with ZERO network (design §4.1, И1):
//   - currentSrc, srcset, sizes, naturalWidth/Height, getBoundingClientRect,
//     devicePixelRatio, loading/decoding/fetchpriority, alt, getComputedStyle;
//   - performance.getEntriesByType('resource') matched by NORMALISED URL, reading
//     initiatorType + resolveTransferSize() (null-preserving) + responseStatus;
//   - the MSE/DRM fork: currentSrc.startsWith('blob:') and video.mediaKeys !== null.
//
// `inspectElement` is what the SCAFFOLD overlay actually calls: it returns a
// fabricated model chosen by element kind, so every card variant and honest state
// is reachable over real picked elements. Each returned model has `mock: true`,
// which renders a MockBadge on the card. Swap the body for `readResourceMetadata`
// once the real reader lands.

/** 🔴 Real reader — not implemented. Throws until the DOM/Resource-Timing logic lands. */
export function readResourceMetadata(_el: Element): ResourceCardModel {
  throw todoLogic(
    'assets: read resource metadata from element (currentSrc/srcset/naturalWidth + Resource Timing correlation, zero network)',
  );
}

/**
 * Scaffold inspector: pick a representative mock model for the picked element by
 * its tag, so the full card layout and the honest-limitation ladder are all
 * exercisable in the running scaffold. Returns fabricated data (`mock: true`).
 */
export function inspectElement(el: Element): ResourceCardModel {
  const tag = el.tagName.toLowerCase();
  if (tag === 'video' || tag === 'audio') {
    // A blob:/MSE currentSrc is the common streaming case worth showing.
    return mockMseResource();
  }
  if (tag === 'iframe') return mockIframeResource();
  if (tag === 'img' || tag === 'picture' || tag === 'source') return mockImageResource();
  return mockNoResource();
}
