# Perf extension — implementation notes

Single purpose: "measure page performance." Written against PLAN.md §7–§9.

## What is measurable

- **Core Web Vitals + FCP/TTFB** — `web-vitals@5.3.0` *attribution* build
  (`web-vitals/attribution`), registered in a `document_start` + `world:'MAIN'`
  content script. MAIN + document_start is mandatory: LCP/CLS/FCP replay via
  `buffered:true` from a bounded buffer, so at `document_idle` the real LCP is
  already gone. Each `onX()` runs at most once per load (each opens a
  `PerformanceObserver`); a `window`-level flag guards re-injection.
- **Attribution element** — LCP `target`, INP `interactionTarget`, CLS
  `largestShiftTarget`. FCP/TTFB are timing-only and carry no element.
- **Request inventory, timings, type breakdown, third-party domains** —
  Resource Timing, accurate and cross-origin.
- **Bytes, three honest tiers** (below).

## What is NOT measurable, and why

- **Per-element render timing** — Element Timing "does not work retroactively"
  (W3C); a content script cannot instrument elements already painted. We surface
  `LCP.entry`'s element instead. Not attempted.
- **True page weight from Resource Timing** — `transferSize` is `0` for
  cross-origin resources without `Timing-Allow-Origin` (most third parties). We
  map that to `null`, never `0`. `transferSize===0 && decodedBodySize>0` is a
  cache hit and stays `0`. This is the correctness crux of the extension.
- **Lighthouse in-process** — it is a Node app; MV3 bans remote code. Only the
  PSI REST *data* API is used, and only for public URLs.
- **Exact bytes on Firefox** — `chrome.debugger` does not exist in Firefox
  (bugzilla 1323098), and its `webRequest.onCompleted` exposes **no** response-size
  field (verified against MDN — `responseSize`/`requestSize` are absent). There is
  therefore no banner-free exact path on Firefox; it honestly falls back to
  Resource Timing and the UI says so. We never report ~0 bytes as "exact".

## Byte-source tiers (ByteSource + a `mechanism` the UI reads)

1. `resource-timing` — always on, in the popup. Undercounts; `unmeasuredRequests`
   counts the `null`s; caveat always shown.
2. `devtools-har` — DevTools panel only, `onRequestFinished` + `getHAR()` backfill,
   real `_transferSize` (fallback `bodySize`). Misses pre-open requests → "reload"
   caveat. When only `bodySize` is available (Firefox) the total is flagged
   **approximate** (uncompressed, excludes headers), never presented as exact.
3. `cdp-debugger` (Chrome only) — opt-in exact wire bytes. `debugger` (optional
   perm, runtime request), `Network.enable`, reload, sum
   `loadingFinished.encodedDataLength`, detach in `finally`. Non-dismissable
   banner. The trigger lives in the **popup**, not the DevTools panel: the debugger
   cannot attach while DevTools is open, and the panel is hosted inside DevTools —
   so a panel-hosted trigger could never attach. Firefox has no exact path.

## Core (packages/core is READ-ONLY)

`ByteSource` now includes `'webrequest'`, but this extension no longer produces it:
Firefox has no accurate webRequest size field, so the Firefox exact path was
removed entirely. The only exact source is Chrome CDP (`'cdp-debugger'`).

## Build order

1. `utils/registrable-domain.ts`, `utils/protocol.ts` (shared types).
2. `utils/resource-timing.ts` — mapping + collector.
3. `entrypoints/content.ts` (MAIN vitals) + `entrypoints/relay.content.ts`
   (ISOLATED bridge + resource timing) → background.
4. `entrypoints/background.ts` — per-tab store + protocol.
5. `utils/debugger-bytes.ts` (CDP / webRequest), `utils/har.ts`, `utils/psi.ts`.
6. UI: panel (Vitals/Network/Audit), popup, PSI section.
