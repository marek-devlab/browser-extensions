# Content Blur — Live Test Report

Harness: real Chromium (headed) via `chromium.launchPersistentContext`, extension
loaded unpacked from `extensions/blur/.output/chrome-mv3`, fixtures served over a
local `http.createServer` on `127.0.0.1` (content scripts do not run on
`about:blank` / `data:` / `setContent`). Settings driven by writing to
`chrome.storage` from the extension service worker (`worker.evaluate`), which the
content script's `storage.watch` picks up live.

Run: `npx playwright test -c e2e/blur/playwright.config.ts`

All assertions below are DOM-real (computed `filter`, live Highlight-API ranges,
real hover/click) unless marked otherwise.

## Phase 1 — original behaviors

| # | Behavior | Result | Notes |
|---|----------|--------|-------|
| 1 | `<img>` gets `filter: blur(...)` by default | PASS | computed `filter` matches `blur(16px)` |
| 2 | `video[poster]` + `div[style*=background-image]` blur when Posters on | PASS | both elements' computed `filter` = `blur(16px)` |
| 3 | Cyrillic "спойлер" + English "spoiler" blur; "safeword" does not | PASS | asserted against live `CSS.highlights.get('bx-text')` range text; injected `::highlight()` rule is `color: transparent; text-shadow: …` |
| 4a | Hover-to-reveal removes blur | PASS | `filter` -> `none` after `page.hover` |
| 4b | Click-to-reveal via capture-phase click | PASS | reveal click swallowed (page handler did NOT fire); a second click passes through |
| 5 | Allowlisting the fixture host disables blur | PASS | `filter` -> `none` for `127.0.0.1` |
| 6 | Dynamically inserted `<img>` blurs (MutationObserver) | PASS | img added 400 ms post-load blurs |
| 7 | `<img>` in an OPEN shadow root blurs (shadow traversal) | PASS | computed `filter` inside `host.shadowRoot` |

### Phase 2 — fixes

No extension code fixes were required: every original behavior passed live on the
unmodified build. The previously-fixed poster/background-image bug is genuinely
fixed — `buildStylesheet` splits the compound
`video[poster], [style*="background-image"]` selector via `splitSelectorList`,
so the blur/reveal suffixes attach to each selector individually.

One issue was found and fixed in the TEST HARNESS, not the extension: the first
draft fixture declared `#bg-thumb`'s `background-image` in a `<style>` block,
which the `[style*="background-image"]` attribute selector (an inline-style
match, by design) does not select. The fixture now uses the inline
`style="background-image:url(...)"` form the feature targets (`server.ts`).

## packages/core — notes (READ-ONLY, not edited)

- Per-category blur radius (feature 2) needs a core change: `BlurSettings.radius`
  is a single number and `DomRuleEngine`/`buildStylesheet` take one `blurRadius`.
  Independent image/video/text radii would require per-category radius fields on
  `BlurSettings` (or a per-rule radius in `buildStylesheet`). The PRESET portion
  (Light/Medium/Heavy) is implemented since it only sets the existing `radius`.

## Phase 3 — features added (all no new host permission)

Verified end-to-end in the real browser (DOM-real) and/or by logic tests. Every
new feature keeps the single purpose "hide unwanted content"; TS stays strict
with `noUncheckedIndexedAccess`, no `any`.

| # | Feature | UI | Verification |
|---|---------|----|--------------|
| 1 | Per-site overrides (which categories + radius per host) | popup Global/This-site scope toggle; options "Per-site overrides" | DOM-real: site override forces images on (global off) and off (global on) |
| 2 | Intensity presets Light/Medium/Heavy | popup + options preset segmented buttons | logic: `presetForRadius` / `BLUR_PRESETS`. Per-CATEGORY radius left as a core follow-up (see below) |
| 3 | Keyboard shortcuts (`commands`): global on/off, reveal-all, panic | manifest `commands`; background `commands.onCommand` | logic: `togglePanic`/`panicState`; DOM-real: the `revealAll` message the reveal-all command sends |
| 4 | Context menu: "Blur this element", "Always blur images on this site" | manifest `contextMenus`; background create/onClicked; content-script manual-blur | DOM-real: `contextmenu` target tracking + `blurElement` message blurs the exact element and revealAll clears it; logic: `setSiteOverride` for the site action |
| 5 | Import / export settings as JSON | options "Backup" tab (download + file import) | logic: `serializeBackup`/`parseBackup` round-trip; rejects garbage; clamps bad values |
| 6 | Image-source allow/block list (never/always blur by URL substring) | options "Image sources" tab | DOM-real: "never" keeps a matching image sharp; "always" blurs it with Images off; logic: `buildImageSelector` |

### New/changed extension files
- `entrypoints/content.ts` — image-source rules wired into the `<img>` selector
  (`buildImageSelector`); `contextmenu` target tracking + `blurElement` manual-blur
  handler; watch `imageSourceRulesItem`; revealAll also clears manual blur.
- `entrypoints/background.ts` — `commands.onCommand` (toggle-global / reveal-all /
  panic via snapshot); `contextMenus` create + onClicked.
- `entrypoints/popup/App.tsx` — Global/This-site scope, presets, per-site reset.
- `entrypoints/options/App.tsx` — presets, Per-site overrides, Image sources tab,
  Backup (import/export) tab; accessible labels + focus-visible on new controls.
- `utils/features.ts` — pure, tested helpers for all six features.
- `utils/storage.ts` — `panicSnapshotItem`, `imageSourceRulesItem` (local; typed
  here, NOT in core).
- `utils/use-storage-item.ts` — generic storage hook for the new lists.
- `wxt.config.ts` — `contextMenus` permission + `commands` (no host warning).

### Design notes / honesty
- Per-CATEGORY blur radius (independent image/video/text radii) is NOT done: it
  needs a core change (`BlurSettings.radius` is a single number and
  `buildStylesheet`/`DomRuleEngine` take one radius). The preset portion of
  feature 2 IS implemented. Documented above under packages/core.
- The keyboard `commands` and `contextMenus.onClicked` callbacks cannot be fired
  from Playwright, so those entry points are covered at the logic level plus the
  underlying messages/handlers they invoke are DOM-real. The command/menu wiring
  itself is verified by manifest inspection and code review.

## Phase 4 — final re-test

`npx playwright test -c e2e/blur/playwright.config.ts` -> **21 passed** (8
original DOM behaviors, 6 new-feature DOM tests, 7 logic tests).

VERIFY:
- `npm run compile -w @blur/blur` — clean (tsc --noEmit, strict).
- `npm run build -w @blur/blur` — chrome-mv3 built.
- `npm run build:firefox -w @blur/blur` — firefox-mv2 built.
- manifest (both targets): permissions `storage, activeTab, scripting,
  contextMenus`; commands `toggle-global, reveal-all, panic-blur`.

