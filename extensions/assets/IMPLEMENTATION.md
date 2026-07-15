# Asset Inspector — implementation notes

Extension #8 (`@blur/assets`). Single purpose (PLAN.md (Часть II) §4): **"Find the source of
any element on the page and the requests that loaded it."** An **inspector, not a
downloader.** Spec: [`docs/design/assets.md`](../../docs/design/assets.md).

**Status: the domain logic is REAL.** The mock layer (`utils/mock-data.ts`, every
`<MockBadge>`, the panel's scenario selector, the v2 "all resources" screen) has been
deleted. There is no `todoLogic` stub left in this extension.

---

## 🔴 Permanent guardrails (never regress these — PLAN.md (Часть II) §4, §10.5; design §0, §13)

The difference between an inspector and a media downloader is **one button**, and it
is never added back. Each guardrail below names the code that enforces it, because a
guardrail that only exists in a document is a guardrail that will be deleted.

| Invariant | Enforced by |
|---|---|
| **No download button, no `downloads` permission, no `<a download>`, no `createObjectURL`** | `wxt.config.ts` permission list; export is `copyAsJsonButton()` → `navigator.clipboard.writeText` only (`inspector.content.ts`). Grep for `downloads\|createObjectURL` returns comments only. |
| **No `fetch()` of any URL we display** | There is no `fetch`, `XMLHttpRequest`, `new Image()`, `.src =`, `sendBeacon`, `WebSocket` or `EventSource` anywhere in `extensions/assets`. The preview is `canvas.drawImage(theElement)` (`canvasPreview()`), drawing what the browser already decoded — **zero requests**. `toDataURL`/`toBlob` are never called, so no code path to the bytes exists at all. |
| **No m3u8/mpd parsing, no segment stitching** | `mediaFeedRequests()` lists manifest requests as a *fact about the page*; nothing anywhere opens or reads one. There is no manifest parser in the codebase. |
| **No `webRequest`, no `<all_urls>`, no `chrome.debugger`** | The permission list is exactly `activeTab, scripting, storage, contextMenus`; `content_scripts: []`; `host_permissions` **deleted in the `build:manifestGenerated` hook** (see the trap below). Request data comes from Resource Timing (page) and DevTools HAR (panel). |
| **Weight is never faked** | `resolveTransferSize()` returns `null` for cross-origin-without-TAO, `weightOf()` turns that into `{kind:'unmeasured', reason}`, and `formatWeight()` renders words. A `0` is only ever printed for a genuine cache hit (`transferSize === 0 && decodedBodySize > 0`). |
| **No bulk operations** | Per-row reading only in the panel's request list. No select-all, no checkboxes, no "copy all URLs". The v2 "all resources" table is **not shipped** (see Deferred). |
| **The words download / save / grabber / ripper never appear** in UI, `aria-label`, tooltips or the listing | Verified by grep; the only hits are the CSS keyword `cursor: grab` and the comments that forbid them. |
| **Boundary vs `perf`** | No waterfall, no time axis, no page byte-sum, no CWV, no speed thresholds anywhere. The one duration shown is a *media* duration. The one verdict is overweight, expressed in **pixels**. |

### ⚠️ The trap that the build actually produced

`entrypoints/inspector.content.ts` must declare a `matches` (WXT's type demands it),
even though `registration: 'runtime'` keeps it out of `content_scripts`. **WXT also
derives `host_permissions` from that `matches`** — the first build emitted
`"host_permissions": ["*://*/*"]` on Chrome and `"*://*/*"` inside `permissions` on
Firefox. That is `<all_urls>`: the exact install warning this extension's whole
architecture exists to avoid.

It is stripped in a `build:manifestGenerated` hook in `wxt.config.ts`, which now
doubles as a permanent guard: any future host permission dies there instead of in
review. **Check the built manifests, not the config, when auditing permissions.**

---

## Surface map

| Surface | File(s) | Role |
|---|---|---|
| **Picker overlay** | `utils/element-picker.ts` + `entrypoints/inspector.content.ts` | 🥇 entry — hover / keyboard / touch, z-stack, breadcrumbs, open-shadow piercing |
| **Resource card** (in-page, closed shadow root) | `entrypoints/inspector.content.ts` | 🥇 **the product** — URL, srcset, overweight, requests, redirects, MSE/DRM, iframe, data:, failed |
| **Popup** | `entrypoints/popup/` | 🥈 launch the picker, real page counters, settings link |
| **Context menu** | `entrypoints/background.ts` | 🥈 "What is this element?" → injects on the click gesture, passes `srcUrl` |
| **DevTools panel** | `entrypoints/panel/`, `utils/har.ts`, `utils/panel-picker.ts` | 🥉 initiators, redirect chains, exact MIME/status — a **strict enhancement** |
| **Options** | `entrypoints/options/` | every pref, all persisted |
| **Background** | `entrypoints/background.ts` | context menus + on-gesture injection. **Holds no state** (design §1.4, §10.1) |

Utils: `element-picker.ts` (picker + selector), `resource-timing.ts` (correlation,
buffer, honest weight), `inspect.ts` (the reader), `srcset.ts` (winner
recomputation), `har.ts` (DevTools-only facts), `panel-picker.ts` (the `eval` picker
source), `format.ts`, `storage.ts`, `use-prefs.ts`, `assets-types.ts`.

---

## Reuse, not rewrite

- **`utils/element-picker.ts` is copied from `extensions/adblock/utils/element-picker.ts`**
  (TODO §J: "reuse it, don't rewrite it"), with attribution and an explicit diff in
  its header. Copied because the extensions are separate WXT apps and the picker is
  not exported from a shared package — only `@blur/core` / `@blur/ui` cross that
  boundary. Verbatim: `isStableClass` / `escapeIdent` / `computeSelector`, the
  light+dark double ring, the capture-phase click swallow, the idempotent teardown.
  Added: closed shadow root, `composedPath()[0]` open-shadow piercing, the full
  keyboard walk, touch tap-then-confirm, breadcrumbs, one `AbortController`.
- **`resolveTransferSize()` is copied from `extensions/perf/utils/resource-timing.ts`**
  — the single most important correctness detail in the family (PLAN.md §8). It must
  stay bit-identical in both places.
- **Design tokens come from `@blur/ui`.** The in-page overlay imports
  `@blur/ui/tokens.css?inline` and re-scopes `:root` → `:host` (inside a shadow root
  `:root` matches nothing). One set of values, no second copy to drift.

**Cross-cutting change this suggests (not made — `packages/**` is off-limits here):**
a `@blur/picker` package would let `adblock`, `assets` and any future picker share
one implementation instead of a copy. Likewise a home for `resolveTransferSize`.

---

## Real now

- **The reader** (`utils/inspect.ts`): `currentSrc` (the fact) vs the markup `src`,
  `srcset`/`sizes`/`naturalWidth`/`getBoundingClientRect`/`devicePixelRatio`, the
  `loading`/`decoding`/`fetchpriority`/`alt` attributes, `getComputedStyle` for CSS
  backgrounds, `video.error` / `img.complete && naturalWidth === 0` for load
  failures, `getVideoPlaybackQuality()`, and the MSE fork (`blob:` currentSrc or an
  empty one with a live `videoWidth`) with `video.mediaKeys != null` for EME.
- **srcset explanation** (`utils/srcset.ts`): the `<picture>` stage-1 table
  (`matchMedia`, exact), the slot width resolved from `sizes` by **measuring a real
  hidden element inside our own shadow root** (so `vw`/`em`/`calc()` are resolved by
  the layout engine, not by our arithmetic), the effective density of each candidate,
  the model winner, and a loud callout when the model disagrees with `currentSrc`.
- **Resource Timing correlation** (`utils/resource-timing.ts`): normalised-URL match,
  `initiatorType`, null-preserving weight, `responseStatus` (null, never 200), the
  redirect tri-state (`occurred` / `none` / `unknown`), host grouping, and the buffer
  accounting.
- **The buffer, correctly** (design §10.5, correcting PLAN.md (Часть II) §4.2): on overflow the
  browser **drops NEW entries and keeps the early ones**, then fires
  `resourcetimingbufferfull`. So requests made *before* the inspector opened are
  present; it is the **late** ones on a heavy page that vanish.
  `setResourceTimingBufferSize()` runs as the first statement of `main()` and raises
  the cap for the future — it cannot resurrect what was dropped, and the card says so.
- **The DevTools panel**: real `network.getHAR()` backfill + `onRequestFinished`,
  real redirect-chain reconstruction (walking the 30x `redirectURL`s backwards), real
  `_initiator` call stack, exact MIME/status/`_transferSize`, real `onNavigated`
  stale handling, and a picker delivered through `inspectedWindow.eval` (the panel
  cannot use `scripting` — see below).
- **Popup counters**: real, via `scripting.executeScript({func})` under the same
  `activeTab` grant. Counts only — never a byte budget.
- **Options**: every control persists to `storage.local`; "Change in the browser"
  opens `chrome://extensions/shortcuts` or `about:addons`, chosen by inspecting our
  own extension origin (feature detection, not a UA sniff).

## Deferred

- **"All resources" table (v2, design §2.7).** The scaffold's mock screen has been
  **removed** rather than shipped with fabricated rows. When it lands it must be a
  table of *origin* (the reverse `resource → element` lookup), with per-row copy only
  — a bulk-copyable list of media URLs is a harvester, which is the category boundary.
- **`allFrames` injection into cross-origin subframes** (design §14 №1) — v1 is
  designed so the honest cross-origin-iframe card is the final answer either way.
- **Firefox `menus.getTargetElement`** (design §14 №2) — the `srcUrl` match works on
  both engines today; the exact-node path is a free upgrade if it survives late
  injection.

---

## ⚠️ The DevTools panel cannot use `scripting` (design §1.4, §4.6)

`activeTab` is **not** granted by a click inside a DevTools panel (the `seo` rake,
PLAN §18a), and this extension has no persistent content script to message. So the
panel's picker goes through `devtools.inspectedWindow.eval()`, which runs a string in
the inspected page's **main world** with no permission and outside the page CSP.

Two consequences, both handled in `utils/panel-picker.ts`:

1. `eval` cannot await a click, so the picker parks its result on a page global and
   the panel **polls** for it. The poll is bounded and always torn down.
2. That result comes from the page's own world, so **it is untrusted page data**. The
   panel renders it as text (React escapes), and no `href` is ever built from it
   without a protocol check.

---

## Security notes for the reviewer

- The card is built exclusively from **page-controlled strings** (URL, `alt`, MIME,
  class names). There is **zero `innerHTML`/`outerHTML`/`insertAdjacentHTML`/
  `document.write`/`dangerouslySetInnerHTML`** in the extension: every node is
  `createElement` + `textContent` (`h()` in `inspector.content.ts` is the only node
  factory).
- Overlay styles are a **static** constructed `CSSStyleSheet` — no template string
  ever interpolates a URL into CSS.
- `href` is assigned **only** after `new URL(u).protocol ∈ {http:, https:}`
  (`isOpenable()`). A `javascript:` URL inside a page's `srcset` is the one real code-
  execution vector on this card, and it stops there. `blob:` and `data:` produce a
  disabled button with the reason in the tooltip.
- The overlay lives in a **closed** shadow root on a host appended to
  `documentElement`: the page cannot restyle it, hide it, or read it back. It holds
  no extension data — only facts the page already knows about itself.
- Nothing leaves the page: no network of any kind, no analytics, no update check. The
  only message the overlay receives is `assets:start`; it sends none.
- Teardown is a single `AbortController.abort()`, plus restoring the page's original
  `cursor` and returning focus. Escape hatches: `Esc`, the Cancel button (≥44 px, the
  touch path), and right-click. Re-injection is idempotent — the message listener is
  registered behind a one-shot window flag so repeated `executeScript` calls cannot
  stack listeners.

## Injection model

`entrypoints/inspector.content.ts` uses `registration: 'runtime'`, so WXT builds it to
`/content-scripts/inspector.js` but does **not** list it in `content_scripts` (no
ambient run, no install warning). The background injects it with
`scripting.executeScript` on a user gesture (toolbar click / hotkey / context-menu
click), which is what grants `activeTab`.
