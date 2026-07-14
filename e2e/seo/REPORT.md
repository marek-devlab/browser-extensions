# SEO & Accessibility Auditor — Live Test / Fix / Feature Report

Harness: Playwright + real Chromium, extension loaded unpacked via
`launchPersistentContext(--load-extension)`, headed. Fixtures served over HTTP on
`127.0.0.1` (content scripts do not run on `about:blank`/`data:`/`setContent`).
All operations run through the SAME path the UI uses: the background/SW calls
`chrome.tabs.sendMessage` into the declared `<all_urls>` content script.

Run:
```
npm run compile -w @blur/seo
npm run build -w @blur/seo
npm run build:firefox -w @blur/seo
npx playwright test --config e2e/seo/playwright.config.ts
```

## PASS/FAIL — final (after fixes)

| # | Assertion | Result |
|---|-----------|--------|
| 1 | getSeoReport extracted values (title+chars, desc present, canonical, robots, hreflang, skipped-level flagged, imagesWithoutAlt w/ alt="" excluded, structuredDataBlocks + malformed JSON-LD surfaced, social tags, internal/external + rel, word count) | PASS |
| 1b | Missing meta description -> null -> "Missing" (error), not empty string | PASS |
| 2 | A11y audit runs live: runA11y -> axe executes on page DOM, returns serialisable violations incl. image-alt; passes>0 | PASS |
| 3 | robots.txt / sitemap.xml present reflected; absent (404) degrade gracefully; X-Robots-Tag: noindex detected | PASS |
| 4 | axe code-split: content.js small & axe-free; axe library only in axe-run.js | PASS |
| 5 | Panel/popup: aria-live result regions; severity as text+icon not colour; dark-theme impact-badge contrast | PASS (source/CSS) |
| F1 | SERP snippet preview w/ pixel-width truncation warnings | PASS (unit + live) |
| F2 | Structured-data validation (type + missing required props) | PASS (unit + live) |
| F3 | Mobile-friendliness (viewport + tap-target hints) | PASS (live) |
| F4 | Copy/export works + extended with links/wordcount/indexability/SD/viewport/url | PASS |
| F5 | OG/Twitter preview card (real preview + blank-image warning) | Pre-existing, verified |

15/15 Playwright tests green (9 real-browser in seo.spec.ts, 6 DOM-free logic in unit.spec.ts).

## Phase 1 — the one CRITICAL live failure (root cause)

The a11y audit AND the SEO report were both dead end-to-end.

Root cause: content.ts registered its onMessage listener by RETURNING A PROMISE
(`return buildSeoReport()` / `return runA11y()`). WXT's `browser` is the native
`chrome.*` API — no webextension-polyfill (confirmed: no polyfill markers in the
built bundle). Native chrome.runtime.onMessage IGNORES a returned Promise; an
async reply REQUIRES `return true` + `sendResponse(...)`. So every reply was
silently dropped:
- getSeoReport saw response == null -> {ok:false,'…did not return a report'}.
- runA11yAudit saw null -> error. The headline axe feature never returned a single
  violation in a real browser.

Proven live: a bare-Chromium probe showed chrome.tabs.sendMessage(id,
{type:'extractSeo'}) resolving to undefined (not a throw — the listener ran but
its async result was discarded).

## Phase 2 — fixes

1. Async message reply contract — entrypoints/content.ts: listener now takes
   sendResponse, wraps work in replyAsync() which sends an Outcome envelope
   {ok,data}/{ok,error} and `return true` to hold the channel open. This is the
   fix that brings the a11y audit (and SEO report) alive.
   - New ContentRequest / ContentResponse envelope types in utils/messages.ts.
   - entrypoints/background.ts: new askContent() unwraps the envelope and now
     PRESERVES the real error text (e.g. "The accessibility audit timed out.")
     instead of collapsing to a generic message.
2. Fragment links miscounted as internal — utils/extract-seo.ts: a bare same-page
   fragment (#, #section) resolves to the page's own origin, so the old code
   counted it as internal, contradicting the function's documented contract.
   Added a raw-href startsWith('#') guard. Fixture internal count 3 -> correct 2.

## Phase 3 — features added (fit "audit page markup and accessibility"; no new perms, no new runtime deps)

1. SERP snippet preview (utils/serp.ts + panel SerpPreview/SerpMeter): pixel-width
   measurement via injectable Measure (UI backs it with an offscreen canvas 2D
   context; tests with a stub). Binary-search ellipsis truncation, per-field
   meters, warnings at ~580px (title) / ~920px (description). Google-style URL.
2. Structured-data validation (validateStructuredData in utils/checks.ts): parses
   each JSON-LD block (payloads carried from the page in SeoDomData.jsonLd),
   reports @type(s), walks @graph, flags missing Google-recommended required props
   for Article/Product/BreadcrumbList/Organization. Surfaced as a
   structured-data-required warning check + a panel list. Malformed-JSON detection
   retained.
3. Mobile-friendliness (utils/checks.ts + utils/extract-seo.ts): viewport meta
   presence/content check (missing -> error; no width=device-width or zoom-blocking
   -> warning; else ok) and a tap-target hint counting visible interactive elements
   rendered below the 24px WCAG floor.
4. Export extended (utils/export.ts): Markdown/JSON now include page URL, viewport,
   and a Structured-data section, alongside existing links/word-count and the
   indexability rows (which already ride in checks[]). Copy buttons verified in
   both popup and panel with aria-label.
5. OG/Twitter card: panel already renders a real link-preview card with og:image +
   explicit blank-preview warning when missing — verified, left intact.

New report fields ride in the extension-local composing type SeoReportEx (url,
viewport, structuredData) — core SeoReport untouched (read-only).

## Phase 4 — bundle sizes (chrome-mv3, prove axe stays split)

| File | Size | axe library present? |
|------|------|----------------------|
| content-scripts/content.js | 14.65 kB | No (only the /axe-run.js path string) |
| chunks/popup-*.js | 6.57 kB | No |
| chunks/panel-*.js | 13.04 kB | No (helpUrl is a UI field, not the lib) |
| background.js | 12.24 kB | No |
| axe-run.js | 584.09 kB | Yes — the only place axe lives |

content.js grew ~12.3 -> 14.65 kB purely from the new page-side extraction
(viewport, tap-target scan, JSON-LD payload capture, response envelope) — still
small and 100% axe-free. axe loads only on demand when the audit button is pressed.

## Accessibility of the panel/popup (assertion 5)

- Result regions wrapped in role="status" aria-live="polite" (3 panel, 3 popup),
  incl. the a11y audit status region.
- Severity conveyed by a TEXT label (Pass/Warning/Error) + border, never colour
  alone (WCAG 1.4.1). Impact badges show the impact word.
- Dark-theme impact badges use dark text on the pastel accent backgrounds so every
  badge clears 4.5:1 (style.css @media prefers-color-scheme: dark).
- New controls: SERP meters' decorative track is aria-hidden; truncation warning is
  role="note". :focus-visible outline covers all buttons/tabs/links.

## Honest limits

- axe colour-contrast fires in this headed run, but the hard live assertion is on
  image-alt (fully deterministic); contrast is rendering-dependent, so it is not
  asserted by id to avoid flake. Violations present + passes>0 + serialisable shape
  is the proof axe executed against the live DOM.
- The tap-target hint uses getBoundingClientRect and is a non-blocking warning.
- Permissions unchanged: permissions:['storage'] only; page access via the declared
  <all_urls> content script. No debugger/webRequest/activeTab/scripting added.
