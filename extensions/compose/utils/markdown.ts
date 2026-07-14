import { todoLogic } from '@blur/ui';
import { mockPreviewFragment, type SanitizeResult } from './sanitize';

// Markdown → preview render pipeline (design §7.1). The ONLY allowed pipeline:
//
//   draft(text)
//     → markdown-it({ html: true, linkify: false, typographer: false })
//     → HTML string (TREATED AS HOSTILE)
//     → sanitizeToFragment(html)        // the security boundary — utils/sanitize.ts
//     → DocumentFragment
//     → previewEl.replaceChildren(fragment)   // NODES, not a string
//
// ⚠️ `html: true` is mandatory (we need <details>); `linkify: false` is NOT
// cosmetic — auto-linking would turn arbitrary user text into href attributes,
// widening the attack surface (design §7.1). Links come only from explicit
// [t](u).

/**
 * Render a draft body to a sanitized preview fragment.
 *
 * TODO_LOGIC (compose): instantiate markdown-it with the options above, render
 * to a string, and hand it to `sanitizeToFragment`. Kept as one function so the
 * parser is swappable and the sanitizer stays the single choke point.
 */
export function renderPreview(_body: string): SanitizeResult {
  throw todoLogic('markdown: markdown-it render → sanitizeToFragment');
}

/**
 * Scaffold stand-in: returns a static, safe fragment built node-by-node (no
 * string ever becomes DOM). Surfaces render THIS today, behind a <MockBadge>.
 */
export function renderPreviewMock(): SanitizeResult {
  return mockPreviewFragment();
}
