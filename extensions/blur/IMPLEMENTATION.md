# Content Blur — implementation notes

## What `@blur/core` already does (used as-is, read-only)
- `DomRuleEngine`: block-first stylesheet injection at `document_start`, MutationObserver
  with a narrow `attributeFilter`, `IntersectionObserver` viewport gating, open-shadow-root
  traversal, batched sweeps, exact `stats.blurred` counting, `reveal`/`revealAll`.
- `buildStylesheet`: emits the blur/hide CSS incl. `hover` reveal and the `[data-bx-revealed]`
  escape hatch. `click` reveal only gets `cursor: pointer` here — the JS is ours.
- `BLUR_SELECTORS`, `REVEAL_ATTR`, `SEEN_ATTR`, `deepQuerySelectorAll`, `processInChunks`,
  `scheduleTask`, `yieldToMain`, `applyStylesheet`.

## What was missing (a UI mock before this change)
- Text blur — not expressible as a CSS selector, so the engine cannot do it.
- `click`-to-reveal interaction logic.
- Real content-script wiring (engine lifecycle, stats reporting, live settings, cleanup).
- Real background stats (was seeded from the mock fixture).
- Popup/options reading live values; options regex validation + persistence.

## What I built
1. `utils/text-blur.ts` — text blurrer behind one interface, two strategies:
   - **Custom Highlight API** (preferred): `Range`s + `CSS.highlights.set('bx-text', …)`,
     styled `::highlight(bx-text){color:transparent;text-shadow:…}` — no DOM mutation.
     `filter` is not a valid `::highlight()` property, so the transparent-text+shadow trick
     produces the blur look. Feature-detected via `'highlights' in CSS`.
   - **Span wrapping** (fallback): TreeWalker `SHOW_TEXT` + `acceptNode` rejecting
     SCRIPT/STYLE/NOSCRIPT/TEXTAREA/CODE/PRE, contenteditable, and processed nodes.
     Collect-then-mutate. Spans use the same transparent+shadow CSS (no per-span layer).
   - One compiled alternation regex (keywords escaped + `\b…\b`; `/re/flags` literals).
     Each fragment validated in isolation so a bad pattern can't kill the script.
     Aho-Corasick note left inline for the >1–2k term case. Mutation re-scan uses
     `scheduleTask` (debounce) + `processInChunks`.
2. `utils/reveal.ts` — capture-phase `click` reveal, keyed off `REVEAL_ATTR` so only the
   first click on a blurred element is intercepted; later clicks pass through. No overlay.
3. `entrypoints/content.ts` — engine + text blurrer lifecycle, category-split exact stats
   (bucketed from `[data-bx-seen]`) reported to background, `revealAll`, live re-apply on
   settings/site-config changes and on a `reevaluate` message, full teardown on invalidate.
4. `entrypoints/background.ts` — real per-tab `Map`, badge = total blurred, cleared on
   `tabs.onRemoved` and `tabs.onUpdated`(loading); `toggleSite` persists + re-evaluates.
5. Popup/options — live values, no mock; options validates regex with an inline error and
   persists patterns; accessibility caveat kept in the UI.

## Core changes I would have wanted (implemented locally instead)
- `EngineStats` lumps all media into `blurred`; it cannot split images vs. video. I derive the
  split locally by bucketing `[data-bx-seen]` elements by tag. A per-rule counter in core would
  make this exact without a re-query.

## Ordering
core (read) → text-blur → reveal → content → background → popup/options → verify.
