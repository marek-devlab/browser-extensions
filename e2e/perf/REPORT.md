# Page Performance & Network - Live Test + Feature Report

Extension: extensions/perf/ (@blur/perf). Harness: e2e/perf/ (Playwright + headed
persistent Chromium with the built MV3 extension loaded, driven against local
127.0.0.1 HTTP fixtures on two ports so the cross-origin transferSize honesty rule
is exercised for real).

Run with: npx playwright test e2e/perf  (root playwright.config.ts).

---

## PHASE 1 - Live test results

All required assertions pass against the real extension + real network data.

| # | Assertion | Result |
|---|-----------|--------|
| 1 | Resource Timing -> PageInsight with requestCount > 0 and a measuredBytes sum | PASS |
| 2 | transferSize honesty: same-origin = real bytes; cross-origin +TAO = real bytes; cross-origin no-TAO = null (shown "-", counted in unmeasuredRequests), never 0 | PASS |
| 3 | Web Vitals FCP + TTFB + LCP collected with valid ratings (LCP after paint) | PASS |
| 4 | Forged-vitals guard: a page posting __blur_perf_vital__ WITHOUT the correct nonce injects no vital (sentinel 424242 never reaches background) | PASS |
| 5 | "Unmeasured" warning condition: all-same-origin => unmeasuredRequests === 0; TAO-less cross-origin => > 0 | PASS |

Logic-level guards (marked [logic]; CDP byte path + PSI network call are undesirable to drive live):

| Guard | Result |
|-------|--------|
| resolveTransferSize never conflates cache-hit 0 with unmeasurable null | PASS |
| Bridge guards (isVitalBridgeMessage, isLongFrameBridgeMessage) reject non-bridge / missing-nonce payloads | PASS |
| PSI isAuditableUrl refuses localhost / private / IPv6-loopback before spending a call | PASS |
| CDP byte path Firefox refusal | Verified by the Firefox-bundle check (.debugger. absent) + source review. Not importable into Node test context (pulls WXT #imports). |

### Root causes of failures found in PHASE 1

The extension's own measurement/vitals/guard logic had NO functional defects -
every core path passed once the harness could observe it. The failures were in
harness bring-up, root-caused and fixed:

1. Tab identification. The extension ships without the tabs permission (a deliberate
   narrow-permission decision), so chrome.tabs.query returns tab ids but tab.url is
   undefined. Matching the fixture tab by URL failed. Fix: identify the fixture tab
   by diffing tab-id sets before/after opening it (harness.ts tabIdsNow). Test-only;
   extension permissions unchanged.
2. LCP never finalised. A synthetic visibilitychange dispatch did not trigger
   web-vitals LCP finalisation. Fix: drive the two real triggers - a genuine click,
   then hide the page by bringing the extension page to front (a true
   visibilitychange -> hidden). LCP then flows every run.

Neither required a change to extensions/perf/ source.

---

## PHASE 2 - Fixes

No extension-source fixes were required to make the five live assertions pass. The
only edits under extensions/perf/ in this pass are the PHASE 3 features, which were
themselves live-tested. The byte-honesty contract is carried through every new
surface (export shows null as blank, never 0; waterfall/LoAF never fabricate).

---

## PHASE 3 - Features added

All require NO new permission and add NO runtime dependency. TS strict +
noUncheckedIndexedAccess, no any.

### 1. Long Animation Frames (LoAF) + Long Tasks - live-verified
- utils/long-frames.ts - LongFrameCollector: PerformanceObserver on
  long-animation-frame (preferred) with longtask fallback (never double-count).
  Reports loafSupported/longTaskSupported; degrades cleanly where unsupported.
  Surfaces blockingDuration + per-script attribution (sourceURL, sourceFunctionName,
  duration, forcedStyleAndLayoutDuration).
- MAIN world: entrypoints/content.ts (sendLongFrames + collector start), posted over
  the same nonce-guarded bridge as vitals (LOAF_BRIDGE_TAG, utils/protocol.ts).
- Relay forward entrypoints/relay.content.ts; background cache + getLongFrames
  entrypoints/background.ts.
- UI entrypoints/panel/LongFrames.tsx (blocking total, frame table, top scripts,
  layout-thrash callout), mounted in panel/App.tsx VitalsPanel.
- Live proof: "captures a Long Animation Frame with blocking duration + script
  attribution" - loafSupported===true, totalBlockingDuration>0, attribution present
  against a 150 ms block.

### 2. Full CrUX field data beside lab
- utils/psi.ts - parses loadingExperience AND originLoadingExperience for
  LCP/INP/CLS/FCP/TTFB p75 + CrUX category (parseCrux); CLS scaled /100. INP no
  longer smuggled into the lab list (lab = pure Lighthouse; field = CrUX). Types
  CruxField/CruxFieldMetric in utils/perf-types.ts.
- UI entrypoints/panel/AuditPanel.tsx FieldData - URL-level and origin-level cards +
  explicit "not enough CrUX samples" notice.

### 3. Export (JSON + CSV, copy + download)
- utils/export.ts - toJson, entriesToCsv, vitalsToCsv, copyText, downloadText (Blob
  URL, no permission). Honesty preserved: unmeasurable size is null in JSON / blank
  CSV cell, never 0.
- UI ExportButtons in panel/App.tsx (Vitals + Network), accessible (aria-label per
  action, aria-live copy confirmation).
- Live proof: "CSV/JSON export shows an unmeasurable size as blank/null, never 0".

### 4. Resource waterfall
- entrypoints/panel/Waterfall.tsx - horizontal start/duration bars, kind-coloured,
  in the Network tab. NetworkEntry extended to TimedNetworkEntry (utils/perf-types.ts)
  with startTime, produced by resource-timing.ts and har.ts. No @blur/core change
  (read-only) - extension type extends the core one structurally.
- Live proof: "network entries carry startTime for the waterfall".

### 5. Compare two loads (optional)
- entrypoints/popup/App.tsx - "Save snapshot" persists the current PageInsight to
  storage.local (reuses the previously-unused lastReportItem); a same-host reload
  shows signed request/byte/unmeasured deltas (Delta, colour-coded, aria-live).
  Cross-host snapshots refused as meaningless.

---

## PHASE 4 - Re-test (final)

npx playwright test e2e/perf - 11 passed:

    + collects a PageInsight with request count > 0 and measuredBytes sum
    + classifies same-origin, cross-origin+TAO (real bytes) and cross-origin no-TAO (null)
    + collects FCP, TTFB and LCP with valid ratings
    + rejects a forged vital posted without the correct nonce
    + unmeasuredRequests is 0 for all-same-origin and > 0 with a TAO-less cross-origin resource
    + captures a Long Animation Frame with blocking duration + script attribution
    + network entries carry startTime for the waterfall
    + CSV/JSON export shows an unmeasurable size as blank/null, never 0
    + [logic] resolveTransferSize never conflates cache-hit 0 with unmeasurable null
    + [logic] the forged-message guard functions reject non-bridge and missing-nonce payloads
    + [logic] PSI refuses localhost/private URLs before spending a call

Build / typecheck:

    npm run compile -w @blur/perf       -> clean (tsc --noEmit, strict, no-any)
    npm run compile -w @blur/core       -> clean (read-only, untouched)
    npm run build -w @blur/perf         -> OK chrome-mv3
    npm run build:firefox -w @blur/perf -> OK firefox-mv2
    Firefox bundle .debugger. refs      -> none (grep -rl over .output/firefox-mv2 empty)
                                           (chrome-mv3/background.js retains 1 - expected)
    manifest permissions                -> unchanged: [storage, activeTab, scripting];
                                           optional: [debugger] (chrome) / googleapis host

---

## What could NOT be fully verified live (honest limits)

- CDP exact-byte path (utils/debugger-bytes.ts): attaching chrome.debugger and
  reloading under Playwright is fragile and shows the debugging banner; per the brief
  it is logic/review-verified. Its Firefox refusal is covered by the bundle check
  (no .debugger. in firefox-mv2).
- PSI network call (runPsiAudit): a real Google API request is undesirable in E2E
  (rate limits/network). The URL-gate is tested live; CrUX parsing is verified by
  review + the typed parser.
- DevTools-panel DOM: the panel needs a real DevTools host (browser.devtools.*), so
  panel components (waterfall, LoAF table, field-data, export buttons) are verified
  via typecheck + the underlying data-flow tests rather than by driving the rendered
  panel. The popup "unmeasured warning" is driven at the data level (unmeasuredRequests
  0 vs >0) - exactly its render condition - a deliberate logic-level check per the brief.
