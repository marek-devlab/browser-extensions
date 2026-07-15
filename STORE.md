# Store submission guide

Submission checklist and per-extension listing copy for the ten extensions in
this monorepo. Ground truth for names, descriptions, and permissions is each
extension's **generated manifest**
(`extensions/<name>/.output/{chrome-mv3,firefox-mv2}/manifest.json`), with the
rationale in `extensions/<name>/wxt.config.ts`; this file must match them. The
shared privacy policy is [`PRIVACY.md`](./PRIVACY.md) — host it and link it from
every listing.

All ten ship as **ten separate add-ons** at version **1.0.0**, `author:
"Blockaly"`, `homepage_url: "https://blockaly.com"`, with permanent AMO ids
`<name>@blockaly.com`. The first four are the original wave; the last six were
added later:

| Package | Store name | Single purpose | Gecko id |
|---|---|---|---|
| `extensions/blur` | Content Blur | Hide unwanted content on web pages | `blur@blockaly.com` |
| `extensions/adblock` | Ad & Tracker Blocker | Block ads and trackers | `adblock@blockaly.com` |
| `extensions/perf` | Page Performance & Network | Measure page performance | `perf@blockaly.com` |
| `extensions/seo` | SEO & Accessibility Auditor | Audit page markup and accessibility | `seo@blockaly.com` |
| `extensions/devdata` | Data Format Toolkit | Parse and convert structured data locally | `devdata@blockaly.com` |
| `extensions/export` | Page Content Exporter | Export page content to a file | `export@blockaly.com` |
| `extensions/assets` | Asset Inspector | Inspect where page assets came from | `assets@blockaly.com` |
| `extensions/whoami` | Connection & Device Info | Show your connection and device | `whoami@blockaly.com` |
| `extensions/capture` | Capture Studio | Record the current tab and export media | `capture@blockaly.com` |
| `extensions/compose` | Markdown Workbench | Write and format Markdown | `compose@blockaly.com` |

---

## Read this before filling in any Privacy-practices tab

**The original four extensions (blur, adblock, perf, seo) each declare a static
content script matching `<all_urls>`.** Consequently **those four** trigger the
install-time *"Read and change all your data on all websites"* warning, on Chrome
and on Firefox. There is no version of those four listings in which that warning
is absent, and any copy claiming host access is "optional / requested at runtime
/ not at install" for blur, adblock or perf is **false** and will be contradicted
by the manifest the reviewer is looking at. Do not write it.

**The six newer extensions are different — most install with no broad-access
warning.** `assets`, `whoami`, `capture`, and `compose` declare **no**
`<all_urls>` (whoami declares `host_permissions: []` and asks for at most the
single optional origin `https://ipinfo.io/*` when used). `devdata` has
`<all_urls>` only as an **optional** host permission, requested by gesture for
its opt-in "auto-format JSON pages" feature — never at install. `export` reads
pages only through `activeTab`. Do **not** write the all-sites warning copy for
the new wave; it does not apply.

What each of the original four actually needs the broad access for (say this, per
listing):

| Extension | Content script | Why broad access is genuinely required |
|---|---|---|
| blur | `<all_urls>`, `document_start` | Content must be blurred **before first paint** — an image you blur after it is visible is an image you already saw. |
| adblock | `<all_urls>`, `document_start` | Cosmetic element-hiding (`display: none`) on the ad containers the network layer cannot remove, applied before they can flash on screen; also backs the element picker. |
| perf | `<all_urls>`, `document_start` (collector in the **MAIN** world + an ISOLATED-world relay) | Core Web Vitals must be observed from before the page paints; a `PerformanceObserver` attached late has already missed LCP/FCP. |
| seo | `<all_urls>`, `document_idle` | Reads page markup (meta, headings, structured data) and runs the audit; this is why it needs **neither** `activeTab` **nor** `scripting`. |

The honest and defensible framing — use it verbatim in the Privacy-practices
justification — is: **access is not collection.** The original four have
permission to read every page; none of them take anything off the device. Across
all ten extensions there are exactly **two** off-device data flows, both opt-in
and click-gated: (1) `perf`'s PageSpeed Insights call, which sends the audited
URL to Google; and (2) `whoami`'s IP/ISP lookup, which shows you your own IP via
Cloudflare and, if you opt in, sends only that IP to ipinfo.io. The other eight —
including `devdata`, `export`, `assets`, `capture`, and `compose` — make **zero
network calls** (several enforce this with `connect-src 'none'`).

**Firefox data-collection consent (mandatory for new AMO submissions since
2025-11-03).** Every Firefox build declares
`browser_specific_settings.gecko.data_collection_permissions`:

| Extension | Declaration |
|---|---|
| blur, adblock, seo | `required: ["none"]` — Firefox renders "does not collect data". |
| perf | `required: ["none"]`, `optional: ["websiteActivity"]` — nothing by default; the audited page URL is shared with Google only if the user opts into a PageSpeed Insights audit. |
| devdata, export, assets, capture, compose | `required: ["none"]` — Firefox renders "does not collect data". |
| whoami | `required: ["none"]`, `optional: ["locationInfo"]` — nothing by default; the user's IP is shared with ipinfo.io only if the user opts into the ISP/ASN lookup. |

These must stay consistent with `PRIVACY.md` and with the Chrome data-usage
disclosures. They currently are.

---

## Why four separate extensions (Chrome Web Store single-purpose policy)

The Chrome Web Store **Single Purpose policy** requires that "an extension must
have a single purpose that is narrow and easy to understand" and explicitly
prohibits "bundles of unrelated functionality." The reviewer test is whether the
purpose fits in one short phrase.

These four capabilities — blurring content, blocking network requests, measuring
performance, and auditing markup — are unrelated functionality that would be
rejected if bundled. Splitting them also keeps each **permission set** matched to
its purpose. Most importantly, the `debugger` permission (full DevTools Protocol
access, with a non-dismissable "extension is debugging this browser" banner) is
**only** defensible in the one extension whose stated purpose is measuring real
transferred bytes (Page Performance & Network) — and even there it is optional
and opt-in. A meta-tag inspector or ad blocker requesting `debugger` is the
textbook permission/purpose mismatch that gets rejected, so that capability is
quarantined in `perf` alone.

Reference: Chrome Web Store Developer Program Policies → "Single Purpose"
(developer.chrome.com/docs/webstore/program-policies/single-purpose).

---

## Submission checklist (per store, per extension)

**Do NOT** run builds, `wxt zip`, or `wxt submit` as part of writing this
documentation. The steps below are the release runbook for whoever ships.

### Chrome Web Store (also covers Edge, Brave, Opera, Vivaldi, Yandex via the Chrome build)
- [ ] Produce the production `-b chrome` build and zip for each extension.
- [ ] Register/verify a Chrome Web Store developer account (one-time fee).
- [ ] Fill the listing: name, short + detailed description, category, screenshots, 128px icon.
- [ ] Complete the **Privacy practices** tab: single-purpose statement, a
      justification for **every** permission (see per-extension strings below),
      data-usage disclosures, and the hosted privacy-policy URL.
- [ ] **All four:** justify the broad host access that comes from the
      `<all_urls>` content script — the reviewer will see the warning regardless
      of what the listing says. Use the table above.
- [ ] `adblock` only: justify `optional_host_permissions: <all_urls>` (Chrome
      DNR "unsafe" actions need a *granted host permission*; see below).
- [ ] `perf` only: disclose the PageSpeed Insights data transmission (audited URL sent to Google) and justify the opt-in `debugger` permission.
- [ ] Confirm no remote code (MV3 requirement) — all code is bundled.

### Firefox Add-ons (AMO) — desktop + Firefox for Android
- [ ] Produce the production `-b firefox` build/zip for each extension.
- [ ] **Sources ZIP requirement:** because the build uses a bundler/minifier
      (WXT + Vite), AMO requires you to upload a **source-code ZIP** alongside
      the add-on, plus build instructions a reviewer can follow to reproduce the
      submitted artifact from source. Keep it ready for each extension.
- [ ] Each Firefox build declares `browser_specific_settings.gecko.id`,
      `gecko_android`, and `data_collection_permissions` (already in each
      `wxt.config.ts`) so AMO marks it Android-compatible and renders the
      data-consent panel.
- [ ] Note the Firefox permission differences (below): `adblock` requires
      install-time `<all_urls>` **host permission** on Firefox and has **no**
      `optional_host_permissions` there (WXT drops the MV3-only key for the MV2
      build); `perf` has no `debugger` on Firefox.
- [ ] Provide the privacy-policy URL in the listing.
- [ ] Have the **Reviewer notes** (below) ready to paste — `addons-linter` warns
      on all four, every warning is a vendor/data false positive, and the
      reviewer will likely ask.

### Safari (out of scope here)
- [ ] Safari requires **macOS + Xcode** (`safari-web-extension-converter`) and a
      paid **Apple Developer Program** membership. This cannot be produced on the
      current (Windows) environment and is **out of scope** for this pass. Track
      separately.

### Store assets

**Generated and ready (see `store-assets/README.md`):**
- [x] **Icons** 16/32/48/128 px per extension — `npm run icons` →
      `extensions/<name>/public/icon/*.png`. The 128 px is the store icon.
- [x] **Small promo tiles** 440×280 per extension — `npm run store-assets` →
      `store-assets/<name>/promo-tile-440x280.png`.

**Still MISSING — a human must produce these; a script cannot:**
- [ ] **Screenshots — BLOCKING. Not done. Chrome requires at least one, at
      exactly 1280×800 or 640×400 px.** They must show the real extension running
      in a real browser (popup / options / DevTools panel against a real page).
      Load the built extension via `chrome://extensions` → Load unpacked and
      capture them; save to `store-assets/<name>/screenshot-N-<what>.png`. This
      cannot be generated, and faking one is a store-policy problem. **No listing
      can be submitted until this is done.**
- [ ] **Human review of the generated art** — nobody has yet looked at the icons
      at 16 px in a real toolbar (light and dark), and the promo-tile type is
      drawn with a hand-built stroke font, not a real typeface.
- [ ] **Marquee promo tile** 1400×560 (optional, Chrome only).
- [ ] Short **promo video** (optional).

---

## Content Blur (`extensions/blur`)

- **Store name:** Content Blur
- **Category:** Productivity (Accessibility as secondary)
- **Short description (≤132 chars):** Blur images, video, thumbnails and matched text on any page. Local only, nothing leaves your browser. (94 chars)

**Single-purpose statement:**
> Hide unwanted content on web pages by blurring images, video, video
> posters/thumbnails, and text matching your patterns. It does no network
> blocking and ships no rule lists.

**Detailed description:**
> Content Blur lets you hide anything you would rather not see on a page —
> images, video, video posters and thumbnails, and text that matches patterns you
> define. Toggle blurring globally or per site, reveal blurred content on demand,
> or use the panic shortcut to blur all media instantly.
>
> Right-click actions ("Blur this", "Always blur images here") and keyboard
> shortcuts make it fast. To blur content before you see it, the extension runs on
> every page you open — that is why your browser warns that it can read all your
> data on all websites. It reads pages only to blur them: what you blur and your
> settings never leave your device. No analytics, no tracking, no remote code. Ad
> blocking is a separate companion extension — this one only blurs.

**Per-permission justification (Chrome dashboard):**
- `storage` — Save your blur settings and per-site preferences locally.
- `activeTab` — Apply or toggle blurring on the tab you are currently viewing when you invoke the extension.
- `contextMenus` — Provide the right-click "Blur this / Always blur images here" actions. No host or network access.
- **Host access via `<all_urls>` content script (`document_start`)** — The source
  of the "read and change all your data on all websites" warning. Blurring is only
  meaningful if it happens before the content is painted, so the script must
  already be present on any page the user opens. It applies CSS locally and
  transmits nothing.

**Note:** blur has **no** `optional_host_permissions` — the key was removed as
dead (nothing ever called `permissions.request()`, and the content script already
grants standing access). Do not write "requests host access at runtime" anywhere
in this listing.

---

## Ad & Tracker Blocker (`extensions/adblock`)

- **Store name:** Ad & Tracker Blocker
- **Category:** Productivity
- **Short description (≤132 chars):** Block ads and trackers with filter lists, per-site allowlisting and parameter stripping. All local, no tracking. (110 chars)

**Single-purpose statement:**
> Block ads and trackers. Strictness levels, filter lists, tracker blocking,
> URL-parameter stripping, the blocked counter, and per-site allowlisting all
> serve that one purpose.

**Detailed description:**
> Ad & Tracker Blocker blocks advertising and tracking requests using bundled
> filter lists (EasyList / EasyPrivacy, with an optional "annoyances" tier).
> Choose a strictness level, allowlist sites you trust, strip tracking
> parameters from URLs, and watch a live blocked counter.
>
> Blocking is primarily at the network layer. A small element-hiding (cosmetic)
> layer complements it: a short built-in list of common ad-container selectors,
> plus a handful of site-specific rules for YouTube, Twitch and Reddit, and any
> custom selectors you add yourself with the element picker. It is a focused
> supplement to network blocking, not a full cosmetic-filtering engine.
>
> On Chrome it uses the browser's declarative blocking engine; on Firefox it uses
> a per-request engine that blocks and counts exactly. Filter lists are data, not
> code, and are bundled with the extension — nothing is fetched and executed at
> runtime. It runs on every page in order to hide ad elements there, which is why
> your browser warns that it can read all your data on all websites; all blocking
> and counting happen locally and nothing about the pages you visit is sent
> anywhere. No analytics, no tracking.

**Per-permission justification (Chrome dashboard):**
- `storage` — Save strictness level, allowlist, and blocked counts locally.
- `activeTab` — Read the current tab for per-site actions in the popup.
- `scripting` — Apply cosmetic (element-hiding) filtering to the page.
- `declarativeNetRequest` — Block ad/tracker requests using bundled rulesets; the browser evaluates them.
- `declarativeNetRequestWithHostAccess` — Back the dynamic rules for per-site allowlisting and URL-parameter stripping, which act on request URLs.
- `alarms` — Flush blocked-count statistics on a ~30s tick, since the MV3 service worker can be torn down between events.
- `contextMenus` — Right-click "Block this element" / "Pause on this site". No broad access.
- **Host access via `<all_urls>` content script (`document_start`)** — Part of the
  "read and change all your data on all websites" warning. Runs the element-hiding
  layer on ad containers the network layer cannot remove, before they flash on
  screen, and backs the element picker.
- `optional_host_permissions <all_urls>` (**Chrome only, optional, requested at
  runtime from a user gesture**) — A *host permission*, distinct from the content
  script's access, and Chrome requires it specifically: DNR treats `redirect` and
  `modifyHeaders` as **"unsafe" actions** and applies them only on origins for
  which the extension holds **granted `host_permissions`**. A content-script
  `matches` pattern does **not** satisfy that check. Without this grant the
  URL-parameter-stripping redirect rule would silently never fire. Per-site
  allowlisting (`allowAllRequests`) does not need it and works before it is
  granted.

**Static-rule budget — disclose this, it is a good-faith signal:**
Chrome guarantees only **30,000** enabled static DNR rules per extension;
anything above that comes from a global pool **shared with the user's other
extensions**. The "aggressive" strictness level wants **35,000** (easylist 20,000
+ easyprivacy 9,000 + annoyances 6,000). Rather than call
`updateEnabledRulesets()` and let it reject the *entire* set — leaving the UI
claiming aggressive filtering while less was enabled than before — the extension
**predicts the shortfall and degrades deterministically**: it keeps easylist +
easyprivacy (29,000 rules, inside the guarantee, so another extension can never
squeeze them out), leaves annoyances off, and **tells the user in the popup and
options page** why. It never claims to be blocking more than it is. Mention this
in the listing if the "annoyances" tier is advertised.

**Bundled rulesets in the Chrome manifest:** `easylist` (enabled), `easyprivacy`
(enabled), `annoyances` (disabled; only requested at "aggressive").

**Firefox (AMO) permission notes — differs from Chrome:**
- Uses `webRequest` + `webRequestBlocking` (blocking engine) instead of `declarativeNetRequest`.
- Requires **install-time `<all_urls>` host permission**: blocking `webRequest`
  can only cancel requests it can see, and `optional_host_permissions` is an
  MV3-only key that is not emitted for the MV2 build, so there is nothing to
  request at runtime. Justify as: "An ad blocker must see requests on every site
  to block ads on every site."
- There is therefore **no** `optional_host_permissions` in the Firefox manifest —
  do not describe one.
- No static-rule budget applies on Firefox; the degradation notice never fires there.

**Filter-list licensing (AMO reviewers ask):** the bundled `rules/*.json` are an
unmodified subset of AdGuard's pre-converted DNR rulesets (incorporating EasyList
/ EasyPrivacy), redistributed as **data** under GPL-3.0 / CC-BY-SA 3.0 — not
under the extension's MIT license. The package ships
`rules/ATTRIBUTION.md` and `THIRD-PARTY-NOTICES.md` stating exactly that.

---

## Page Performance & Network (`extensions/perf`)

- **Store name:** Page Performance & Network
- **Category:** Developer Tools
- **Short description (≤132 chars):** Measure Core Web Vitals and inspect network traffic and page weight, with an optional PageSpeed Insights audit. (110 chars)

**Single-purpose statement:**
> Measure page performance: Core Web Vitals (LCP, INP, CLS, FCP, TTFB), a
> network / page-weight inspector, and an optional PageSpeed Insights audit.

**Detailed description:**
> Page Performance & Network measures how a page performs. See Core Web Vitals
> with attribution to the responsible element, inspect the request inventory and
> page weight, and optionally measure exact transferred bytes.
>
> To capture Core Web Vitals the collector must be running before the page paints,
> so it runs on every page you open — that is why your browser warns that it can
> read all your data on all websites. Measurement itself runs locally. Two
> features are opt-in and clearly disclosed: (1) "Measure exact bytes" attaches
> Chrome's DevTools Protocol to read real wire bytes and shows a browser banner
> while attached (Chrome only); (2) a PageSpeed Insights audit sends the URL you
> are auditing to Google's PSI API to fetch lab and field results — this is the
> only feature that transmits anything off your device, and it only runs when you
> choose to run it, on public URLs only. No analytics, no tracking, no remote
> code. SEO/accessibility auditing is a separate companion extension.

**Per-permission justification (Chrome dashboard):**
- `storage` — Save preferences, cached results, and any optional PSI API key (in local storage only).
- `activeTab` — Measure the tab you are currently viewing.
- `scripting` — Inject the Web Vitals collector into the measured page.
- **Host access via two `<all_urls>` content scripts at `document_start`** (the
  Web Vitals collector in the **MAIN** world plus an ISOLATED-world relay) — The
  source of the "read and change all your data on all websites" warning. A
  `PerformanceObserver` registered after the page has painted has already missed
  LCP/FCP, so the collector must be present from `document_start`; it runs in the
  page's MAIN world because those timings are page-scoped, and the relay carries
  the numbers back to the extension. It measures; it does not read page content.
- `debugger` (**optional, opt-in, Chrome only**) — Requested only when you press "Measure exact bytes"; attaches the DevTools Protocol to sum real transferred bytes (`Network.loadingFinished.encodedDataLength`), then detaches. Shows a non-dismissable "extension is debugging this browser" banner while attached; used for nothing else.
- `optional_host_permissions https://www.googleapis.com/*` (**optional**) — Requested only when you run a PageSpeed Insights audit, to call Google's PSI API.

**Required data-transmission disclosure (both stores):**
> The optional PageSpeed Insights audit sends the audited page URL (and an
> optional user-supplied Google API key) to Google's PageSpeed Insights API. This
> is opt-in, runs only when the user requests an audit, accepts only public URLs,
> and is disclosed in the privacy policy. No other data leaves the browser.

**Firefox (AMO) notes:** Firefox has no `chrome.debugger`, so there is **no**
exact-bytes permission on Firefox; it falls back to Resource Timing. The only
optional permission on Firefox is the PSI host (`https://www.googleapis.com/*`),
declared under `optional_permissions` (MV2 has no `optional_host_permissions`).
This is the one add-on in the suite whose
`data_collection_permissions` is not purely `none`: it declares
`required: ["none"], optional: ["websiteActivity"]`, matching the opt-in PSI
call exactly. Firefox's consent panel and `PRIVACY.md` must keep saying the same
thing.

---

## SEO & Accessibility Auditor (`extensions/seo`)

- **Store name:** SEO & Accessibility Auditor
- **Category:** Developer Tools
- **Short description (≤132 chars):** Audit meta tags, headings, structured data and accessibility (axe-core). Runs locally; nothing is sent anywhere. (111 chars)

**Single-purpose statement:**
> Audit page markup and accessibility: meta tags, headings, structured data,
> social preview, link profile, indexability, and accessibility issues via the
> bundled axe-core engine.

**Detailed description:**
> SEO & Accessibility Auditor inspects a page's meta tags, headings, structured
> data, social preview, link profile, and indexability, and runs an accessibility
> audit powered by the bundled axe-core engine. View the full report in a
> DevTools panel or a headline verdict in the toolbar popup, and export it as JSON
> or Markdown.
>
> Everything runs locally in your browser and nothing is ever sent anywhere. The
> extension reads page markup through a content script on all sites (which is why
> the browser shows a "read and change all your data on all websites" warning at
> install) but never writes to the page and never transmits data off your device.
> axe-core is bundled, not fetched at runtime. No analytics, no tracking, no
> remote code.

**Per-permission justification (Chrome dashboard):**
- `storage` — Cache the last report and your UI preferences locally. This is the only API permission.
- **Host access via `<all_urls>` content script (`document_idle`)** — The source
  of the "read and change all your data on all websites" warning. Standing DOM
  access to read page markup and run the audit through the already-injected
  content script. This is why the extension needs **neither** `activeTab` **nor**
  `scripting`. It reads the DOM only; it never writes and never transmits.
- `web_accessible_resources: axe-run.js` — The bundled axe-core engine, injected into the page only when you press "Run audit".

---

## New-wave extensions — Privacy-practices & data-recipient checklist

The six later extensions each need their own Privacy-practices tab filled in.
Only `whoami` and `capture` have any store-review sensitivity; the other four are
purely-local, zero-network tools. Ground truth is each generated manifest; the
shared policy is [`PRIVACY.md`](./PRIVACY.md).

### Data Format Toolkit (`extensions/devdata`)

- **Category:** Developer Tools. **Single purpose:** parse/convert/inspect JSON, YAML, XML, CSV, and JWTs locally.
- **Chrome permissions:** `storage`, `contextMenus`, `activeTab`; **optional** `scripting`; **optional host** `<all_urls>`. Firefox: same, with `<all_urls>` under `optional_permissions`.
- **Broad access:** `<all_urls>` is **optional and gesture-only** (opt-in "auto-format JSON pages"). Do **not** write the all-sites install warning — it is absent at install.
- **Data collection:** none. `required: ["none"]`. **Zero network.** JWT parsing/verification is fully local; the token never leaves the browser; the HS256 secret is never persisted. **Recipients: none.**

### Page Content Exporter (`extensions/export`)

- **Category:** Productivity. **Single purpose:** export a page selection/table to txt / md / csv / xlsx.
- **Chrome permissions:** `contextMenus`, `activeTab`, `scripting`, `storage`, `clipboardWrite`; **optional** `downloads`. Firefox: same, `downloads` optional.
- **Broad access:** none — reads the page via `activeTab`, no content script. `downloads` is optional, requested by gesture only for cross-origin saves.
- **Data collection:** none. `required: ["none"]`. **Zero network** — files are built locally via `Blob`. **Recipients: none.**

### Asset Inspector (`extensions/assets`)

- **Category:** Developer Tools. **Single purpose:** inspect where a page's images/media/elements came from.
- **Chrome & Firefox permissions:** `activeTab`, `scripting`, `storage`, `contextMenus`. No optional, no host.
- **Honest framing:** it **inspects** where assets came from and previews them via `canvas.drawImage` on the element already on the page. It is **not a downloader** — no `downloads`, no `<all_urls>`, no `webRequest`, no `debugger`. Do not describe it as one.
- **Data collection:** none. `required: ["none"]`. **Zero network.** **Recipients: none.**

### Connection & Device Info (`extensions/whoami`) — REVIEW-SENSITIVE

- **Category:** Developer Tools / Utilities. **Single purpose:** show your connection and device.
- **Chrome permissions:** `storage` **only**; **optional host** `https://ipinfo.io/*`. Firefox: `storage`; `https://ipinfo.io/*` under `optional_permissions`. No `host_permissions`, no `activeTab`, no `scripting`.
- **CSP:** `connect-src 'self' https://one.one.one.one https://ipinfo.io` — the only hosts the extension can reach at all.
- **Data collection (Chrome disclosure + Firefox `data_collection_permissions`):** `required: ["none"]`, `optional: ["locationInfo"]`. Nothing by default; the device half is fully local with **zero permissions and zero network**.
- **REQUIRED — name the data recipients (this is the store-review requirement):**
  - **Cloudflare** — pressing "Show my IP" makes a keyless request to `https://one.one.one.one/cdn-cgi/trace`; Cloudflare receives your IP (your own request to them) and returns it, with country/PoP, back to you. Disclosed in-UI, above the button, before the first request.
  - **ipinfo.io (operated in the USA)** — opting into the ISP/ASN lookup sends **only your public IP** to ipinfo.io, gated behind a modal disclosure **and** the browser's own `ipinfo.io` permission prompt.
- **State plainly:** the IP lives in page memory only, is **never stored, never forwarded to Blockaly (no server exists), never logged**; **no fingerprint hash is ever computed**. No `ip-api.com`, no `ipapi.co` in the shipped build.
- **Listing copy — do NOT use** "anonymous", "hide your IP", "protect", or "VPN": those pull the extension into the adjacent adware category and invite manual review.

### Capture Studio (`extensions/capture`) — PRIVACY POLICY REQUIRED

- **Category:** Productivity / Developer Tools. **Single purpose:** record the current tab (or a chosen screen/window) and export media.
- **Chrome permissions:** `storage`, `unlimitedStorage`, `downloads`, `activeTab`, `tabCapture`, `offscreen`; **optional** `desktopCapture`. Firefox: `storage`, `unlimitedStorage`, `downloads`, `activeTab` (no `tabCapture`/`offscreen` — they do not exist there).
- **CSP:** `connect-src 'none'` — the extension is architecturally incapable of any network request.
- **Honest framing:** it records **your own** tab (Chrome, with tab audio) or a screen/window you pick via `getDisplayMedia` (Firefox, **no** tab audio), plus optional microphone. Do **NOT** frame it as "download videos from other sites" — it does not fetch or download third-party media.
- **Data collection:** none. `required: ["none"]`. Recordings are stored **locally in IndexedDB** and encoded **locally** (WebCodecs + bundled `mediabunny`); **never transmitted**. **Recipients: none.**
- **Why a privacy policy is still required:** the extension captures your **screen and (optionally) microphone**, so both stores require a policy even though everything stays on-device. This is the reason `capture` must link `PRIVACY.md`.

### Markdown Workbench (`extensions/compose`)

- **Category:** Productivity. **Single purpose:** write and format Markdown.
- **Chrome permissions:** `storage`, `contextMenus`, `clipboardWrite`, `activeTab`, `sidePanel`. Firefox: same, with `sidebar_action` instead of `sidePanel`.
- **CSP:** `connect-src 'none'`.
- **Data collection:** none. `required: ["none"]`. **Zero network** — drafts live in `storage.local`; no cloud sync, no account, no AI. **Recipients: none.**

---

## Reviewer notes (paste these when asked)

We ran the official AMO validator (`addons-linter`) on all four Firefox zips:
**0 errors** in every one. The remaining warnings are all vendor/data false
positives. Expect to be asked about them; the explanations below are ready to
paste into a reviewer note.

### 1. `UNSAFE_VAR_ASSIGNMENT` — `innerHTML` (all four)

> The flagged `innerHTML` assignments are inside **React's own bundled runtime**
> (`chunks/jsx-runtime*`, `chunks/style*`), not in our code. React (MIT, v19.2.7)
> ships unmodified from npm and is bundled by Vite; the pattern is part of its
> DOM implementation. We have verified that our own source contains **zero** uses
> of `innerHTML` (or `outerHTML` / `insertAdjacentHTML` / `document.write`). All
> DOM the extensions create is created via React or explicit DOM APIs; no
> user-controlled or page-controlled string is ever assigned as HTML.

### 2. `DANGEROUS_EVAL` — `seo`, `axe-run.js`

> The flagged construct is axe-core's use of `new Function`. `axe-core` (MPL-2.0,
> v4.12.1) is a **bundled, unmodified upstream library** — it is not fetched or
> updated at runtime, and the exact bytes reviewed are the exact bytes that run.
> `axe-run.js` is a **web-accessible resource injected into the page** by the
> content script when the user presses "Run audit", so it executes in the *page's*
> context under the *page's* CSP, not the extension's. No remote code is involved
> anywhere in this path: nothing is downloaded, evaluated from the network, or
> assembled from user input.

### 3. `COINMINER_USAGE_DETECTED` — `adblock`, `rules/easylist.json`

> This is a **known `addons-linter` false positive**
> (mozilla/addons-linter issue #1643). The linter string-matches known
> coin-miner domains inside the file. `rules/easylist.json` is a
> declarativeNetRequest **filter list (data, not code)**, and the lines that
> mention those domains are `block` rules whose entire purpose is to
> **protect users against** coinminers. The extension runs no miner and executes
> nothing from this file — it is JSON evaluated by the browser's own DNR engine.
> The list is an unmodified subset of AdGuard's pre-converted rulesets
> (GPL-3.0 / CC-BY-SA 3.0); see `rules/ATTRIBUTION.md` in the package.

---

## Licensing (for both stores)

- Root [`LICENSE`](./LICENSE) — MIT, covering **Blockaly's own code only**.
- Root [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) — full notices for
  everything redistributed (React MIT, `web-vitals` Apache-2.0, axe-core MPL-2.0,
  filter-list data GPL-3.0 / CC-BY-SA 3.0; and for the new wave: `mediabunny`
  MPL-2.0, `dompurify` MPL-2.0 OR Apache-2.0, `yaml` ISC, plus MIT libraries
  `papaparse`, `json5`, `jose`, `@cfworker/json-schema`, `jsonc-parser`,
  `markdown-it`, `write-excel-file`, `fflate`, `emojibase-data`), verified against
  `package-lock.json`.
- Each extension package also **ships** a copy at `public/THIRD-PARTY-NOTICES.md`,
  so the notices travel with the distributed artifact.
- `adblock` additionally ships `public/rules/ATTRIBUTION.md` for the filter data.

---

## Notes / discrepancies found while writing

- **Corrected in this pass:** earlier copy claimed host access was "optional,
  requested at runtime, not at install" for blur, adblock and perf. That was
  false — all four declare an `<all_urls>` content script and therefore have
  standing all-sites access at install. Every listing string above now says so.
- **Corrected:** blur's `optional_host_permissions` no longer exists in the
  manifest; all claims that blur requests host access at runtime are removed.
- **Corrected:** adblock's `optional_host_permissions` was described as backing
  "per-site allowlisting and parameter stripping". Allowlisting
  (`allowAllRequests`) is a *safe* DNR action and works **without** a host grant;
  only the "unsafe" `redirect` (param-stripping) / `modifyHeaders` actions need
  it. The listing copy now says only that.
- **Toned down:** `extensions/adblock/public/rules/cosmetic.json` is tiny — **10
  generic selectors** (applied only at the "aggressive" level) plus **6
  site-specific ones across 3 sites** (YouTube 3, Twitch 1, Reddit 2). At the
  default "standard" level only the site-specific ones run. Marketing this as
  rich "cosmetic ad-hiding" was an
  over-claim; the description now presents it as a focused supplement to network
  blocking, plus the user's own picker-added selectors.
- Feature logic is **implemented and verified live**, not mocked. Some type-file
  comments still say "MOCK STAGE" (stale), but the shipping behavior is real and
  exercised end-to-end in a headed browser: adblock 10/10 (real network blocking,
  cosmetic hiding, allowlist, element picker, backup round-trip), blur 21/21
  (real CSS blur, text/keyword blur, reveal, shadow-DOM, MutationObserver),
  perf 11/11, seo 15/15 (meta/structured-data/indexability + live axe-core a11y).
- **Remaining before public release:** screenshots (a human must capture them —
  see the asset checklist), a human look at the generated icons/tiles, and the
  Safari native wrapper (macOS/Xcode).
