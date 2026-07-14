# SEO & Accessibility Auditor — implementation notes

## What is read from the DOM (`utils/extract-seo.ts`, runs in the content script)
`extractSeoDom()` runs inside the always-on `document_idle` content script and
returns raw signals only — no derived checks:
- `document.title`; `meta[name="description"]` (blank/whitespace → `null`).
- `link[rel="canonical"]` (resolved href) + the page's own `location.href`.
- `meta[name="robots"]`; `noindex` flag derived from it.
- every `link[rel="alternate"][hreflang]` → `{ lang, href }`.
- `h1..h6` in document order, text trimmed and whitespace-collapsed.
- `img:not([alt])` count — `alt=""` (decorative) keeps its attribute, so it is
  **not** counted; only a wholly absent `alt` is.
- `script[type="application/ld+json"]` that `JSON.parse` cleanly + top-level
  `[itemscope]` roots → `structuredDataBlocks`; parse failures → `jsonLdErrors`.
- OG (`meta[property="og:*"]`) and `meta[name="twitter:card"]` → `SocialPreview`.

`utils/checks.ts` stays browser-free and gains `buildSeoChecks(dom)` +
`assembleSeoReport(dom)`, deriving `SeoCheck[]` with the existing
`titleLengthStatus` / `descriptionLengthStatus` / `findSkippedHeadingLevels` /
`severityRank` helpers. The content script assembles `SeoReport = domData + checks` and returns
it to the background over `tabs.sendMessage`.

`content.ts` keeps its `document_idle` rationale: read the settled DOM — never
`document_start`, which misses framework-injected `<meta>`/JSON-LD. axe-core is
NOT imported here, so this always-on script stays tiny.

## New checks & data
- **Indexability** (`utils/indexability.ts`, runs in the content script): same-
  origin `fetch` of `/robots.txt` and `/sitemap.xml`, plus a `HEAD` of the page
  to read the `X-Robots-Tag` response header. Each becomes a `SeoCheck` merged
  into the report's existing `checks[]` (no core change). Every probe is
  defensive — a 404 or network error is surfaced as a warning, never thrown.
- **Links + word count** (`utils/extract-seo.ts`): internal vs external anchors
  (http(s) navigational links only), `rel="nofollow|sponsored|ugc"` counts, and
  a visible word count from `document.body.innerText`.
- **Export** (`utils/export.ts`): pure JSON / Markdown serialisers; the panel and
  popup copy to the clipboard via `navigator.clipboard`.

## How axe-core is run (the DevTools panel bug fix)
The old design injected axe with `scripting.executeScript` under an `activeTab`
grant — but opening a DevTools panel and clicking a button inside it **never
grants `activeTab`**, so the panel's audit was permanently unreachable. Fixed by
routing everything through the already-injected `<all_urls>` content script:

- `background.runA11yAudit` → `tabs.sendMessage(tabId, { type: 'runA11y' })`
  (a declared content script needs no `activeTab`/`scripting`/host permission to
  be messaged).
- The content script injects `entrypoints/axe-run.ts` on demand with WXT's
  `injectScript()` (declared in `web_accessible_resources`), passing a one-time
  nonce on the script's `dataset`. `axe-run.ts` is the **only** module that
  imports axe-core (via `utils/a11y.ts`); it runs `axe.run(document)` in the page
  and posts the mapped, serialisable `A11yReport` back through a nonce-tagged
  `window` message. axe-core (~584 kB) therefore lives **only** in `axe-run.js`,
  never in the always-on `content.js` (~12 kB), popup, or background.
- `getSeoReport` likewise goes through `tabs.sendMessage(tabId, 'extractSeo')`,
  so the panel loads the SEO report on open with no gesture.

## Permission story (honest)
API permissions are just `storage`. There is **no** `activeTab` and **no**
`scripting` — the messaging path above removed the need for both. The real
standing access is the declared `<all_urls>` content script, which is what
triggers the broad-host install warning; the README and `wxt.config.ts` state
that plainly rather than claiming an `activeTab`-minimal model. `web_accessible_
resources` exposes only `axe-run.js`. Last report persists to `local:lastReport`.

## `@blur/core` change requested (core is read-only)
None. Core stays untouched. The two extra facts the report surfaces (link stats +
word count) ride in `SeoReportEx` (`utils/checks.ts`), an extension-local type
that **composes** the core `SeoReport`. Indexability rides in the existing
`SeoCheck[]`, so it needs no new field at all.

## Build order
1. `checks.ts` (`SeoReportEx`/`LinkStats` + `assembleSeoReportEx`) →
2. `extract-seo.ts` (links + word count) → 3. `indexability.ts` + `export.ts` →
4. `a11y.ts` + `axe-run.ts` (MAIN-world runner) → 5. `content.ts` (message router
+ injectScript) → 6. `background.ts` (relay) → 7. panel + popup UI + CSS →
8. `compile` + `build` (+ firefox), verify axe is absent from `content.js`,
popup, and background chunks.
