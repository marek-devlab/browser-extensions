# Asset Inspector — implementation notes

Extension #8 (`@blur/assets`). Single purpose (PLAN-2.md §4): **"Find the source of
any element on the page and the requests that loaded it."** An **inspector, not a
downloader.** Built as a UI-complete scaffold (PLAN.md §15): every surface,
navigation path and preference is real; the element-inspection / Resource-Timing /
HAR domain logic is stubbed on mocks. Spec: [`docs/design/assets.md`](../../docs/design/assets.md).

---

## 🔴 Permanent guardrails (never regress these — PLAN-2.md §4, §10.5; design §0, §13)

These are the red lines that keep the product in the "minimal-risk review" category
instead of a store ban. The difference between an inspector and a media downloader
is **one button**, and it is never added back — not even mocked.

- **NO download button, NO `downloads` permission, NO `<a download>`, NO
  `URL.createObjectURL`+click.** Card export is clipboard-only ("Copy as JSON").
- **NO `fetch()`/XHR/`img.src`/`video.src` of any URL we display.** The preview is
  `canvas.drawImage(existingElement)` — zero network (design §0 И1). We never call
  `toDataURL`/`toBlob`, so no path to the bytes exists.
- **NO m3u8/mpd parsing, NO segment stitching, NO stream byte-sum.** A manifest is
  shown as a resource (a fact about the page) but never opened or parsed.
- **NO `webRequest`, NO `<all_urls>`/host_permissions, NO `chrome.debugger`, NO
  persistent content script.** Request data comes from Resource Timing (in page) and
  DevTools HAR (panel).
- **NO bulk operations** in the "all resources" table — per-row copy only, no
  select-all, no checkboxes (design §2.7, §13 №3).
- **The words download / save / grabber / ripper never appear** in UI, `aria-label`,
  tooltips or the store listing (design §13 №8).
- **Boundary vs `perf`:** no waterfall, no time axis, no byte-sum-of-page, no CWV, no
  speed thresholds. Per-resource bytes are shown for the ONE selected resource only
  (design §8.1). Separability test: hide both panels' titles — a stranger must tell
  them apart in 3 seconds.
- **Weight is never faked.** Cross-origin without `Timing-Allow-Origin` is
  `not measured`, never `0 KB` (design §7 №1). `WeightState` carries the null all the
  way to the DOM.

The install-time permission set is exactly `activeTab`, `scripting`, `storage`,
`contextMenus` (+ `commands` key, which is not a permission). None triggers an
install warning — that no-warning property is the main asset (design §9.4).

---

## Surface map

| Surface | File(s) | Role | Real vs mocked |
|---|---|---|---|
| **Picker overlay** | `entrypoints/inspector.content.ts` | 🥇 entry — hover, keyboard, z-stack, breadcrumbs, open-shadow piercing | **Interaction shell REAL** (closed shadow root, rAF highlight, ↑↓←→/`[`/`]`/`R`, aria-live, `composedPath()[0]`, `AbortController` teardown). DOM reading mocked. |
| **Resource card** (in-page overlay) | `entrypoints/inspector.content.ts` | 🥇 **core** — URL+copy, srcset table, overweight, requests, redirects, MSE/DRM, iframe/no-resource | **Layout REAL** (closed shadow root, `adoptedStyleSheets`, textContent-only, real `<a>`+protocol check, **real `canvas.drawImage` preview**). Card data from mock models. |
| **Popup** | `entrypoints/popup/` | 🥈 launch picker, completeness counters, links | Launch + nav REAL. Counters mocked (`MockBadge`). |
| **Context menu** | `entrypoints/background.ts` | 🥈 "What is this element?" on image/video/audio/page | REAL: injects overlay on the click gesture, passes `srcUrl`. |
| **DevTools panel** | `entrypoints/panel/` | 🥉 initiators, redirect chains, exact MIME/status | Panel shell REAL (theme from `panels.themeName`, real `inspectedWindow.eval`, real `onNavigated` stale banner). Resource/redirect/initiator data mocked; a scenario selector shows every honest state. |
| **DevTools page** | `entrypoints/devtools.html`, `entrypoints/devtools/main.ts` | registers the "Assets" panel | REAL. |
| **Options** | `entrypoints/options/` | all prefs | **Fully REAL** — every control persists to `storage.local`. |
| **All resources (v2)** | `entrypoints/resources/` | origin table, reverse `resource → element` | Stub screen, mocked rows, per-row copy only (`MockBadge`). |
| **Background** | `entrypoints/background.ts` | context menus + on-gesture injection | REAL. **Holds no state** (design §1.4, §10.1). |

Shared: `utils/assets-types.ts` (data shapes), `utils/storage.ts` (prefs, local-only),
`utils/format.ts` (units/weight, honest), `utils/srcset.ts` (**REAL** winner
recompute), `utils/mock-data.ts` (fabricated resources + state gallery),
`utils/inspect.ts` (real-vs-mock seam), `utils/use-prefs.ts` (prefs + theme hooks).

---

## Real now vs mocked

**Real:**
- Picker interaction shell — keyboard walk, z-stack disambiguation, ancestor
  breadcrumbs, open-shadow piercing via `composedPath()[0]`, focus-visible,
  `aria-live` status, single-`AbortController` teardown, idempotent re-injection.
- Closed shadow-root overlay with constructed `CSSStyleSheet`; **zero `innerHTML`**.
- Canvas preview: `drawImage(theElement)` with `SecurityError`/black-frame fallback —
  genuinely zero-network (the signature И1 invariant).
- Real `<a target=_blank>` with `http/https` protocol validation before `href` is set.
- Clipboard copy in the click handler (no `clipboardWrite` permission).
- **srcset winner recomputation** (`utils/srcset.ts`) — parse + effective-density +
  smallest-≥-DPR selection + model-vs-fact disagreement — scaffolded over mock
  candidates but the algorithm is real.
- Options: all preferences persist (`storage.local`, version 1).
- Theme across popup/options/panel (`@blur/ui`, `seedTheme('blur-assets:theme')`,
  panel via `panels.themeName`).
- Background context menus + `scripting.executeScript` injection on gesture.
- Panel: `inspectedWindow.eval` (hostname), `network.onNavigated` stale-page handling.

**Mocked (return mock objects with a `todoLogic` seam):**
- Real element inspection — reading `currentSrc`/`srcset`/`naturalWidth`/attributes.
- Real `performance.getEntriesByType('resource')` correlation (initiatorType,
  `resolveTransferSize()` null-preserving, `responseStatus`).
- Real HAR reading in the panel (`_initiator`, `redirectURL`, exact MIME/status).
- Page counters (popup), all-resources rows (v2), redirect/initiator stacks (panel).

Every mocked card/screen renders a `<MockBadge>`; mock models carry `mock: true`.

---

## TODO_LOGIC backlog (grep `TODO_LOGIC` + `todoLogic(`)

| Location | What lands here |
|---|---|
| `utils/inspect.ts` → `readResourceMetadata()` | 🔴 the real reader: from the picked element + Resource Timing, all zero-network — `currentSrc`/`srcset`/`sizes`/`naturalWidth`/`getBoundingClientRect`/`devicePixelRatio`/attributes/`getComputedStyle`; match `currentSrc` to `getEntriesByType('resource')` by normalised URL; MSE fork on `blob:` + `video.mediaKeys`. Currently `throw todoLogic(...)`; the overlay calls `inspectElement()` (mock) instead. |
| `entrypoints/inspector.content.ts` → `makeDraggable` on drag-end | persist `cardPositionItem` (coordinates only — never a URL). |
| `entrypoints/options/App.tsx` → `openShortcuts()` | open `chrome://extensions/shortcuts` (we ship no in-app rebind form — design §13 №16). |
| `entrypoints/panel/App.tsx` → `pick()` | inject the picker via `inspectedWindow.eval`, receive the result over `runtime` messaging, match the URL to a HAR record. Currently loads a mock scenario. |
| `entrypoints/popup/App.tsx` counters | real counts from the injected inspector reading Resource Timing (nothing fetched or persisted). |

You **may** implement the `utils/srcset.ts` winner recomputation against real
candidates first — it is already real and pure, scaffolded over mock input.

---

## ⚠️ Caveat: the DevTools panel cannot use `scripting` (design §1.4, §4.6)

`activeTab` is **not** granted from a click inside a DevTools panel (the `seo` rake,
PLAN §18a), and this extension has **no persistent content script** to message. So
the panel's picker path must go through `devtools.inspectedWindow.eval()`, which runs
our code in the inspected page with no permission and outside the page CSP (the same
call `perf/panel/App.tsx` uses). The scaffold's panel makes a **real**
`inspectedWindow.eval('location.hostname', …)` call to demonstrate the path; the
element data it shows is mocked until the eval-injected picker + HAR matching land.

---

## Design-section mapping

| Design § | Where |
|---|---|
| §0 И1–И3 (zero-network preview, no disk write, card in page) | `inspector.content.ts` (closed shadow root, `drawImage`, clipboard-only) |
| §2.1 picker | `inspector.content.ts` picker section |
| §2.2 image/srcset card, §2.4 overweight | `imageSections`, `srcsetSection`, `overweightSection` |
| §2.3 MSE/DRM honest card | `mseSections`, `mockMseResource` |
| §2.5 panel (initiators/redirects/MIME/status) | `entrypoints/panel/App.tsx` |
| §2.6 popup | `entrypoints/popup/` |
| §2.7 all-resources (v2, origin not extraction) | `entrypoints/resources/` |
| §2.8 / §3 options + pref inventory | `entrypoints/options/`, `utils/storage.ts` |
| §4.8 cross-origin iframe honest failure | `iframeSections`, `mockIframeResource` |
| §5 states (no-resource / blob / data / failed / not-in-buffer / stale) | `mock-data.ts` `MOCK_SCENARIOS`, panel scenario selector, card variant switch |
| §6 srcset fact-vs-model | `utils/srcset.ts` (`chosen` vs `modelWinner` vs `modelDisagrees`) |
| §7 honesty ladder | `utils/format.ts` `formatWeight`, MIME certainty, redirect tri-state |
| §9 security (no innerHTML, closed root, protocol check) | `inspector.content.ts` |
| §11.3 theme | `utils/use-prefs.ts`, each `main.tsx` |

## Injection model

The inspector is `entrypoints/inspector.content.ts` with `registration: 'runtime'`,
so WXT builds it to `/content-scripts/inspector.js` but does **not** put it in the
manifest's `content_scripts` (no ambient run, no install warning). The background
injects it with `scripting.executeScript({ target: { tabId }, files: [...] })` on a
user gesture (toolbar click / hotkey / context-menu click), which is what grants
`activeTab`. Injection is idempotent — a second run just restarts the picker.
