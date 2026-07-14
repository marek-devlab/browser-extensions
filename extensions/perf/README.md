# Page Performance & Network (`@blur/perf`)

A browser extension that measures how a page performs: Core Web Vitals and a
network / page-weight inspector.

## Single purpose

> **Measure page performance.**

SEO and accessibility auditing are **not** part of this extension — they ship as
a separate companion extension. The split is deliberate: this extension keeps the
`debugger` permission (opt-in) because measuring real transferred bytes over CDP
is its core job, and that is the only context where `debugger` is justifiable. A
meta-tag inspector shipping `debugger` would fail Chrome Web Store review, so the
auditor lives on its own. The two share `packages/core` but ship as two builds.

## Run it

From the repo root:

```bash
npm run dev:perf          # Chrome
npm run dev:perf:firefox  # Firefox
```

WXT launches a browser with the extension loaded.

## Open the panel

The Performance panel is only reachable with DevTools open:

1. Open DevTools (**F12** / Cmd+Opt+I).
2. Select the **"Performance"** tab.

The toolbar **popup** ("Page Insight") works without DevTools open and shows the
subset of data available cross-origin and accurately.

## How it measures

Every number in the UI is measured on your machine — nothing is fixture data:

- **Web Vitals** — `entrypoints/content.ts` runs at `document_start` in the MAIN
  world and collects LCP / INP / CLS / FCP / TTFB via `web-vitals` (v5,
  attribution build, for the culprit element), bridging each finalised metric to
  the background through the isolated relay content script.
- **Network entries and page weight** — Resource Timing (`utils/resource-timing.ts`),
  rolled up per resource kind and third-party domain.
- **Exact byte measurement** — `measureExactBytes` attaches `chrome.debugger`,
  reloads with `ignoreCache`, and sums CDP `Network.loadingFinished.encodedDataLength`
  (Chrome only; see the limits below).
- **PSI audit** — `utils/psi.ts` calls the PageSpeed Insights REST API.

### What is impossible, and on which browser

These limits are encoded honestly in the UI, not hidden:

- **Exact page weight** requires `chrome.debugger` + CDP
  (`Network.loadingFinished.encodedDataLength`). It is **opt-in**: the extension
  requests the `debugger` permission only when you press "Measure exact bytes",
  and while attached Chrome shows a non-dismissable "extension is debugging this
  browser" banner and conflicts with an open DevTools session (only one debugger
  client may attach to a tab at a time). Resource Timing undercounts:
  `transferSize` is `null` for cross-origin resources without a
  `Timing-Allow-Origin` header — rendered as `—`, never `0`.
- **`chrome.debugger` does not exist in Firefox** on any platform (bugzilla
  1323098, WONTFIX), so the CDP byte-measurement path has no Firefox port. The
  Firefox fallback is `webRequest.onCompleted.responseSize` (a field Firefox has
  and Chrome does not).
- **Per-element timing on pages you don't control is impossible**: the
  `elementtiming` attribute does not work retroactively (W3C spec). We surface
  the LCP element instead.
- **PSI audits only public URLs** — localhost and pages behind auth are
  unreachable by Google's crawler, and the URL is sent to Google (must be
  disclosed in the privacy policy).

## Permissions & privacy

**Installed (Chrome and Firefox):**

- `storage` — save preferences, cached results, and any optional PSI API key (local storage only).
- `activeTab` — measure the tab you are currently viewing.
- `scripting` — inject the Web Vitals collector into the measured page.

**Optional, requested from a user gesture (never at install):**

- `debugger` (**Chrome only, opt-in**) — requested only when you press "Measure
  exact bytes"; attaches CDP to sum real transferred bytes, then detaches. Shows
  a non-dismissable "extension is debugging this browser" banner while attached;
  used for nothing else. Firefox has no `chrome.debugger`, so there is no
  exact-bytes permission there.
- `https://www.googleapis.com/*` — requested only when you run a PageSpeed
  Insights audit.

**The one thing that leaves your browser:** a PageSpeed Insights audit sends the
**audited page URL** (and an optional Google API key) to Google's PSI API. It is
opt-in, runs only when you request it, accepts public URLs only, and is disclosed
here and in the privacy policy. Everything else — Web Vitals, resource timing,
exact-bytes measurement — is entirely local. No analytics, no tracking, no remote
code. See the suite privacy policy at [`../../PRIVACY.md`](../../PRIVACY.md).
