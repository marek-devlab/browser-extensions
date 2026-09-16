# Store submission guide

Submission checklist and per-extension listing copy for the fifteen extensions
in this monorepo. Ground truth for names, descriptions, and permissions is each
extension's **generated manifest**
(`extensions/<name>/.output/{chrome-mv3,firefox-mv2}/manifest.json`), with the
rationale in `extensions/<name>/wxt.config.ts`; this file must match them. The
shared privacy policy is [`PRIVACY.md`](./PRIVACY.md) — host it and link it from
every listing.

All ship as **separate add-ons**, `author: "marek-devlab"`, `homepage_url:
"https://github.com/marek-devlab/browser-extensions"`, with permanent AMO ids `<name>@marek-devlab.github.io`. The first
four are the original wave (**v1.0.0**); the next six the second wave; the next
four the **third wave (in preparation — not yet published)**; the fifteenth,
**Request Blocker**, was built on 2026-09-15 and is the one listing that carries
the `debugger` permission at install (its section explains why and how it is
gated):

| Package | Store name | Single purpose | Gecko id |
|---|---|---|---|
| `extensions/blur` | Content Blur | Hide unwanted content on web pages | `blur@marek-devlab.github.io` |
| `extensions/adblock` | Ad & Tracker Blocker | Block ads and trackers | `adblock@marek-devlab.github.io` |
| `extensions/perf` | Page Performance & Network | Measure page performance | `perf@marek-devlab.github.io` |
| `extensions/seo` | SEO & Accessibility Auditor | Audit page markup and accessibility | `seo@marek-devlab.github.io` |
| `extensions/devdata` | Data Format Toolkit | Parse and convert structured data locally | `devdata@marek-devlab.github.io` |
| `extensions/export` | Page Content Exporter | Export page content to a file | `export@marek-devlab.github.io` |
| `extensions/assets` | Asset Inspector | Inspect where page assets came from | `assets@marek-devlab.github.io` |
| `extensions/whoami` | Connection & Device Info | Show your connection and device | `whoami@marek-devlab.github.io` |
| `extensions/capture` | Capture Studio | Record the current tab and export media | `capture@marek-devlab.github.io` |
| `extensions/compose` | Markdown Workbench | Write and format Markdown | `compose@marek-devlab.github.io` |
| `extensions/convert` | Universal Converter | Convert units, currencies, time and dates | `convert@marek-devlab.github.io` |
| `extensions/linksafe` | Link Inspector | Reveal where a link really goes | `linksafe@marek-devlab.github.io` |
| `extensions/vision` | Vision Simulator | Simulate colour-blindness and low vision | `vision@marek-devlab.github.io` |
| `extensions/sessions` | Session Saver | Save and restore tab sessions locally | `sessions@marek-devlab.github.io` |
| `extensions/netblock` | Request Blocker | Block, fail and delay network requests for frontend resilience testing | `netblock@marek-devlab.github.io` |

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
all fifteen extensions there are exactly **four** off-device data flows, each
opt-in / use-triggered, and **none sends the content you work with**: (1) `perf`'s
PageSpeed Insights call, which sends the audited URL to Google; (2) `whoami`'s
IP/ISP lookup, which shows you your own IP via Cloudflare and, if you opt in,
sends only that IP to ipinfo.io; (3) `convert`'s currency/crypto feature, which
fetches a **rate table** from Frankfurter (ECB) / CoinGecko and converts your
amount **locally** (the amount is never sent); and (4) `linksafe`'s opt-in
"Resolve destination", which sends one shortened link's URL to its own server when
you ask. The rest — including `vision`, `sessions`, `devdata`, `export`, `assets`,
`capture`, `compose` and `netblock` — make **zero network calls** (several enforce this with
`connect-src 'none'`; `netblock` does).

**Request Blocker is the one newer extension with a broad-access warning at
install, and it is not from a content script:** Chrome prints "Read and change
all your data on all websites" + "Access the page debugger backend" because of
the `debugger` permission (which Chromium refuses to make optional) and "Block
content on any page" because of `declarativeNetRequest`. Its host access is
still per-site and gesture-only (`optional_host_permissions`). Say exactly
that; see its section.

**Firefox data-collection consent (mandatory for new AMO submissions since
2025-11-03).** Every Firefox build declares
`browser_specific_settings.gecko.data_collection_permissions`:

| Extension | Declaration |
|---|---|
| blur, adblock, seo | `required: ["none"]` — Firefox renders "does not collect data". |
| perf | `required: ["none"]`, `optional: ["websiteActivity"]` — nothing by default; the audited page URL is shared with Google only if the user opts into a PageSpeed Insights audit. |
| devdata, export, assets, capture, compose | `required: ["none"]` — Firefox renders "does not collect data". |
| whoami | `required: ["none"]`, `optional: ["locationInfo"]` — nothing by default; the user's IP is shared with ipinfo.io only if the user opts into the ISP/ASN lookup. |
| convert, linksafe, vision, sessions, netblock | `required: ["none"]` — Firefox renders "does not collect data". |

These must stay consistent with `PRIVACY.md` and with the Chrome data-usage
disclosures. They currently are.

---

## Why separate extensions (Chrome Web Store single-purpose policy)

The Chrome Web Store **Single Purpose policy** requires that "an extension must
have a single purpose that is narrow and easy to understand" and explicitly
prohibits "bundles of unrelated functionality." The reviewer test is whether the
purpose fits in one short phrase.

These four capabilities — blurring content, blocking network requests, measuring
performance, and auditing markup — are unrelated functionality that would be
rejected if bundled. Splitting them also keeps each **permission set** matched to
its purpose. Most importantly, the `debugger` permission (full DevTools Protocol
access, with a non-dismissable "extension is debugging this browser" banner) is
only defensible where the DevTools Protocol *is* the stated purpose: measuring
real transferred bytes (Page Performance & Network) and failing requests with a
real status / real network error (Request Blocker, since 2026-09-15). In both it
is opt-in behind a user action. A meta-tag inspector or ad blocker requesting
`debugger` is the textbook permission/purpose mismatch that gets rejected, so
the capability stays quarantined in those two. The same logic keeps **Ad &
Tracker Blocker** and **Request Blocker** apart even though both "block
requests": one is a consumer ad/tracker filter driven by bundled lists, the other
a developer/QA tool driven by the user's own failure rules (block, fail, delay,
error status) — different audience, conditions and promises, and neither
listing may borrow the other's vocabulary. ⚠️ Note the platform fact found
while building Request Blocker: Chromium marks `debugger`
`kFlagCannotBeOptional`, so `perf`'s `optional_permissions: ["debugger"]` is
silently dropped at load — its exact-bytes path cannot currently work and its
listing copy below ("optional, opt-in") describes an intent, not the built
manifest. Tracked in `TODO.md`; fix before submitting `perf`.

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
- [ ] `perf` only: disclose the PageSpeed Insights data transmission (audited URL sent to Google) and justify the opt-in `debugger` permission (⚠️ resolve the non-optional `debugger` finding first — see "Why separate extensions").
- [ ] `netblock` only: paste the eight justification texts from its section (incl. the install-time `debugger` and the optional `<all_urls>`), answer "No" to remote code, tick no data category, link the privacy policy; screenshots must include the Network-level consent dialog so the reviewer sees the gate.
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
- [ ] Note the Firefox permission differences (below): `adblock` and `netblock`
      require install-time `<all_urls>` **host permission** on Firefox (blocking
      `webRequest`) and have **no** `optional_host_permissions` there (WXT drops
      the MV3-only key for the MV2 build); `perf` and `netblock` have no
      `debugger` on Firefox.
- [ ] Provide the privacy-policy URL in the listing.
- [ ] Have the **Reviewer notes** (below) ready to paste — `addons-linter` warns
      on all four, every warning is a vendor/data false positive, and the
      reviewer will likely ask. For `netblock` add its AMO notes (the
      `webRequestBlocking` + `<all_urls>` text, and the inert Chrome-only files
      in the Firefox package).

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
      `store-assets/<name>/promo-tile-440x280.png` (all fifteen, incl.
      `netblock`, regenerated 2026-09-15).

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

The ten later extensions (second + third wave) each need their own
Privacy-practices tab filled in. Review-sensitive ones: `whoami` and `capture`
(second wave), and — in the third wave — `convert` (fetches rate tables),
`linksafe` (opt-in link resolve), and `sessions` (the `tabs` "read your browsing
history" warning). The rest are purely-local, zero-network tools. Ground truth is
each generated manifest; the shared policy is [`PRIVACY.md`](./PRIVACY.md).

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
- **State plainly:** the IP lives in page memory only, is **never stored, never forwarded to marek-devlab (no server exists), never logged**; **no fingerprint hash is ever computed**. No `ip-api.com`, no `ipapi.co` in the shipped build.
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

### Universal Converter (`extensions/convert`) — REVIEW-SENSITIVE (network)

- **Category:** Productivity / Utilities. **Single purpose:** convert units, currencies, time zones and calendars.
- **Chrome permissions:** `storage`, `activeTab`, `scripting`, `contextMenus`; `omnibox` key; **optional host** `https://api.frankfurter.dev/*`, `https://api.coingecko.com/*`. Firefox: same (⚠️ MV2 optional origins under `optional_permissions`).
- **Broad access:** none — no `host_permissions`, no static content script. Selection conversion injects via `activeTab` on the "Convert selection" gesture. Do **not** write an all-sites install warning; it is absent.
- **Data collection:** none. `required: ["none"]`. Units/dates/calendars are **fully offline**. Currency/crypto fetch a **rate table** and convert the amount **locally** — the amount is **never sent**.
- **REQUIRED — name the recipients:** **Frankfurter / European Central Bank** (`api.frankfurter.dev`, keyless — receives a request for the public rate table when you use currency) and **CoinGecko** (`api.coingecko.com`, keyless — receives the coin symbols you price). Neither receives your amount, selection, or any identifier. CoinGecko attribution ("Data provided by CoinGecko") is shown in-UI.
- **Listing copy:** describe it as an on-device converter; do not imply it stores or transmits your data.

### Link Inspector (`extensions/linksafe`) — REVIEW-SENSITIVE (opt-in network)

- **Category:** Productivity / Developer Tools. **Single purpose:** reveal where a link really goes before you click.
- **Chrome permissions:** `contextMenus`, `activeTab`, `scripting`, `storage`; **optional host** `<all_urls>`. Firefox: `<all_urls>` under `optional_permissions`.
- **Broad access:** the hover/scan overlay injects via `activeTab` on a click; the hoisted `<all_urls>` is **stripped in a `build:manifestGenerated` hook**, so the baseline install shows **no** all-sites warning. Optional `<all_urls>` is requested by gesture only, for network resolve.
- **Data collection:** none by default — every phishing/redirect heuristic is **local**. Only the opt-in **"Resolve destination"** sends **one link's URL** to that link's own server (with an on-screen warning that a tracking token would be sent). No blocklist/reputation API; **Safe Browsing is deliberately NOT used** (its API is non-commercial-only). `required: ["none"]`.
- **REQUIRED — name the recipients:** only the **link's own host**, only when you resolve that specific link. No other recipient.

### Vision Simulator (`extensions/vision`)

- **Category:** Developer Tools / Accessibility. **Single purpose:** simulate colour-blindness and low vision on a page.
- **Chrome & Firefox permissions:** `activeTab`, `scripting`, `storage`. No optional, no host.
- **Broad access:** none — SVG filters are injected via `activeTab` on the toolbar click. No content script, no install warning.
- **Data collection:** none. `required: ["none"]`. **Zero network** — pure local rendering; reads no page content. **Recipients: none.** Colour-vision matrices are Machado 2009 (the model Chrome uses); partial severity and tritanopia are labelled approximate.

### Session Saver (`extensions/sessions`) — REVIEW-SENSITIVE (`tabs` warning)

- **Category:** Productivity. **Single purpose:** save and restore tab sessions, stored only on this device.
- **Chrome permissions:** `tabs`, `storage`, `alarms`; **optional** `tabGroups`, `sessions`, `unlimitedStorage`. Firefox: `tabs`, `storage`, `alarms`; **optional** `sessions`, `cookies`, `unlimitedStorage`.
- **The one unavoidable warning:** `tabs` prints **"Read your browsing history"** — it reads tab URLs/titles to save them, which is the single purpose. Own it: the listing/Privacy-practices copy states "reads tab titles/URLs to save them; nothing leaves your browser." Every other permission is **optional and gesture-only**, so the baseline install shows exactly one warning.
- **Data collection:** none. `required: ["none"]`. **Zero network, no cloud, no account, no sync** — sessions live in local storage; export/import is a local JSON file (no `downloads`). **Recipients: none.**
- **Listing copy:** lead with **"local-only / nothing leaves your device"** — it is the differentiator vs cloud session managers.

---

## Request Blocker (`extensions/netblock`) — REVIEW-SENSITIVE (`debugger` baseline)

Ground truth: `extensions/netblock/.output/chrome-mv3/manifest.json` and
`.output/firefox-mv2/manifest.json`; rationale in the header of
`extensions/netblock/wxt.config.ts`; pre-submission audit in
[`docs/audit/2026-09-15-netblock.md`](./docs/audit/2026-09-15-netblock.md);
policy matrix with sources in
[`docs/plans/netblock/03-compliance.md`](./docs/plans/netblock/03-compliance.md).

- **Store name:** Request Blocker
- **Category:** Developer Tools
- **Short description (≤132 chars):** Block, fail and delay network requests by rule to test how your frontend copes when the network breaks. Local only. (115 chars)
- **Chrome permissions (install):** `storage`, `activeTab`, `alarms`, `scripting`, `webRequest`, `declarativeNetRequest`, `debugger`; **optional host** `<all_urls>` (per site, by gesture). CSP `connect-src 'none'`.
- **Firefox permissions (install):** `storage`, `activeTab`, `alarms`, `webRequest`, `webRequestBlocking`, `<all_urls>`. No `debugger`, no DNR. `data_collection_permissions.required: ["none"]`, `gecko_android: {}`.
- **Install warnings the user sees (Chrome, from the permissions-list reference 2026-09-09):** "Read and change all your data on all websites" + "Access the page debugger backend" (both from `debugger`, which Chromium flags `kFlagImpliesFullURLAccess`), and "Block content on any page" (from `declarativeNetRequest`). `storage`, `activeTab`, `alarms`, `scripting`, `webRequest` print nothing. The optional `<all_urls>` host grant is prompted per site at runtime ("Read and change your data on *host*"). **Firefox:** exactly one warning, "Access your data for all websites", plus the line "The developer says this extension doesn't require data collection".
- **Data collection:** none. **Zero network** (mechanically: `connect-src 'none'`). **Recipients: none.**

### Single-purpose statement (paste verbatim)

> Request Blocker: block, fail and delay network requests for frontend
> resilience testing. Developers and QA write rules (URL pattern, method,
> resource type, response status, sequence such as "every 3rd call" or "30%
> of calls") and the extension makes the matching requests fail the way a
> broken network would — blocked, a chosen network error, a delay, or an
> error status code. Every feature answers one question: what does the
> frontend see when the network breaks? It does not redirect, rewrite headers,
> mock successful responses, or ship filter lists; rules are configuration,
> never code.

### Per-permission justification (Chrome dashboard — each ≤ 1000 chars)

- `storage` — Stores the user's rules (storage.local), UI preferences such as
  theme, language and log size (storage.sync), and — only in storage.session,
  i.e. memory the browser discards when it closes — the per-rule hit counters
  and the request log. The log is never written to disk. Nothing is
  transmitted: the extension has no server and its pages carry
  `connect-src 'none'`.
- `activeTab` — When the user clicks the toolbar icon, the popup reads the
  host of that tab so it can (1) name the site in the "Enable on <host>"
  button, which requests the optional host permission for that origin only,
  and (2) show which rules are active on this tab and scope the request log
  to it. It adds no install warning and no standing access.
- `alarms` — A 30-second periodic alarm runs a watchdog that releases any
  request the extension might have left paused — a "delay" rule whose timer
  was lost when the service worker was suspended, or a Network-level-mode
  request whose handler failed. The tool must fail open (a request must never
  hang because of us), and in Manifest V3 an alarm is the only timer that
  survives service-worker suspension.
- `scripting` — Used only for `scripting.registerContentScripts` /
  `unregisterContentScripts`: the in-page fetch/XMLHttpRequest interceptor
  ("page" engine — a static file bundled in the package, no remote code, no
  eval) is registered exclusively on origins the user granted through "Enable
  on <host>", and unregistered when the user removes the site in Settings.
  Nothing is injected at install and `executeScript` is never called.
- `webRequest` — Observation only; the Chrome build registers no blocking
  listener. `onCompleted` / `onErrorOccurred` on granted origins give (1) the
  response status shown in the extension's own request log, (2) the
  `net::ERR_BLOCKED_BY_CLIENT` signal behind the approximate hit counter of
  declarativeNetRequest rules (DNR itself reports nothing without
  `declarativeNetRequestFeedback`, which we deliberately do not request
  because it adds a "read your browsing history" warning), and (3) the
  "request A finished" trigger for sequence rules ("fail B after A"). It only
  fires on sites the user enabled.
- `declarativeNetRequest` — The stateless block engine. Each "Block" rule the
  user writes becomes one session-scoped DNR rule (URL filter, method,
  resource type, initiator domain, tab id); the browser evaluates it and the
  extension never sees the request. It is the only engine that can block
  without host access, which is why it is install-time — a request blocker
  that blocked nothing until a site was granted would not do what its name
  says. No static rulesets are bundled; rules are the user's own
  configuration (data, not code) and die with the browser session.
  `declarativeNetRequestFeedback` is not requested.
- `debugger` — Network-level mode: the one feature that can fail a request
  with its REAL server status or a REAL network error type
  (`net::ERR_TIMED_OUT`, `ERR_CONNECTION_RESET`, …) for every resource type
  the debugging protocol can pause (documents, scripts, images, fonts,
  fetch/XHR — not WebSocket), so the frontend under test sees what it would
  see live. No other
  API can: declarativeNetRequest cannot match a response status or return a
  chosen status/error; blocking webRequest is enterprise-only in MV3; an
  in-page fetch/XHR patch cannot see images, scripts, fonts or navigations.
  Only CDP Fetch (`failRequest` with a `Network.ErrorReason`,
  `fulfillRequest` with a status) can. Install-time because Chrome does not
  allow "debugger" in optional_permissions. Opt-in per tab: nothing
  attaches until the user turns the mode on for ONE tab in the popup after a
  consent dialog naming Chrome's banner; it detaches on toggle-off, tab
  close, the banner's Cancel, policy or errors. Commands sent:
  Fetch.enable/disable/continueRequest/failRequest/fulfillRequest,
  Page.getFrameTree/enable; bodies are never read. A substituted response is
  served with `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: sandbox`, so a user-written body can never run
  script under the site's origin.
- **Host permission `<all_urls>` (optional only)** — Declared under
  `optional_host_permissions`; never granted at install. The popup's "Enable
  on <host>" button calls `permissions.request` for that one origin
  (`https://host/*` and `http://host/*`) from the user's click. The grant is
  needed for the in-page interceptor and for webRequest observation
  (log/counters) on that site. Sites can be removed in Settings → Access.
  Plain Block rules work without any grant.

### Privacy-practices tab answers

- **Single purpose:** the statement above.
- **Remote code:** *No, I am not using remote code.* All code is bundled; the
  Debugger API is used only to fail/answer requests, never to evaluate script
  (`Runtime.evaluate` does not appear in the package); user rules are JSON
  data validated against a strict schema.
- **Data usage:** tick **nothing** — the extension does not collect or
  transmit any category of user data. (Web history / website content are
  *accessed* locally to apply rules and shown in a session-only log that is
  never stored on disk or transmitted; per the CWS definition, collection is
  transfer off the device, and there is none.)
- **Certifications:** tick all three (no sale, use only for the single
  purpose, no creditworthiness use).
- **Privacy policy URL:** the hosted `PRIVACY.md` (required even for
  local-only handling — user-data FAQ Q14), section "Request Blocker".

### Listing description (detailed, EN)

> Request Blocker breaks the network on purpose so you can test how your
> frontend copes. Write a rule — a URL pattern, optionally a method, resource
> type, page domain, response status or header — and choose what happens to
> the matching requests: block them, fail them with a specific network error,
> delay them, or answer with an error status such as 503 (with an optional
> body). Rules can be stateful: fire once, the first N times, every N-th
> request, skip the first N, with a probability and a reproducible seed, in a
> time window after a navigation or a click, or only after another rule has
> fired — "make the checkout fail on the third call" is one rule.
>
> The extension picks the cheapest engine that can honour each rule and says
> so with a badge: a browser-level declarative rule (works without site
> access; approximate counter), the in-page fetch/XHR interceptor (exact
> counters, delays and status codes on sites you enabled), or Network-level
> mode (Chrome), which attaches the browser's debugging protocol to one tab
> you choose so the page receives real status codes and real network errors
> for documents, scripts, images, fonts and fetch/XHR alike (not WebSocket).
> Network-level mode is opt-in per tab, behind a
> consent dialog, and shows Chrome's yellow "started debugging this browser"
> banner while it is on; the banner's Cancel button turns it off.
>
> A built-in request log (this browser session only, kept in memory, never
> written to disk, credentials always masked) shows what each engine saw and
> lets you create a rule from any row; export it as HAR without bodies.
> Rules export and import as JSON with validation.
>
> Because the extension must be able to block requests, Chrome warns at
> install that it can block content on any page and, because of the
> debugging permission it cannot request later, that it can read and change
> data on all websites. Host access is still granted per site from the
> popup. Everything stays in your browser: no server, no analytics, no
> remote code — the extension's pages are built with a policy that forbids
> network connections. It is a testing tool for developers and QA; it does
> not redirect or rewrite requests, does not mock successful responses, and
> ships no filter lists.
>
> On Firefox (desktop and Android) a single per-request engine covers every
> condition; a chosen error type or status code becomes a plain cancel there,
> and the rule badge says so.

(Words deliberately absent, per design §11: "adblock", "ad", "tracker",
"privacy", "anonymous", "VPN", "protect".)

### Screenshots (1280×800 or 640×400; a human must capture these)

1. Tool page → Rules, split view: a saved "Every 3rd call → 503" rule with the
   `page` badge and its honesty line, editor open on the right.
2. Tool page → Rules: a `dnr` "Block images from CDN" rule with the ≈ counter
   line under the badge.
3. Popup on an enabled site: active rules with badges and `2/3 ↻` counters,
   Network-level switch OFF, pause button.
4. Popup with the Network-level consent `<dialog>` open (shows the banner
   text and the slowdown line — the reviewer sees the gate).
5. Tool page → Log with rows marked `✱` / `≈` and the row menu "Create rule
   from request"; the legend line visible ("never written to disk").
6. (optional) Tool page → Settings with the "Sites with access" list and the
   "Rules are configuration, not code" callout; or the Firefox editor showing
   a `wr↓` degradation.

### What a reviewer will ask (answers ready)

- **Why is `debugger` install-time and not optional?** Chrome refuses it:
  the permissions reference lists `debugger` among the permissions that
  "cannot be specified as optional" and Chromium marks it
  `kFlagCannotBeOptional`; an optional declaration is silently dropped with an
  install warning and `permissions.request` rejects. Every currently listed
  CDP-based developer tool (Netify, Network Overrides API, Playwright
  Extension, axe DevTools, Automa) declares it in baseline `permissions` and
  gates attach behind a user action — this extension does the same
  (audit §b / plan `03-compliance.md` list the CRX-verified manifests).
- **Why both `webRequest` and `declarativeNetRequest`?** Different jobs: DNR
  blocks (without seeing the request); `webRequest` only *observes*
  completions/errors on granted sites so the log and counters are honest.
  There is no `webRequestBlocking` in the Chrome build.
- **Why `scripting` if there is no content script in the manifest?** The
  interceptor is registered at runtime with `registerContentScripts`, only
  for origins the user granted, and removed when the grant goes. Declaring it
  statically would force `<all_urls>` at install.
- **What does the MAIN-world script do?** `content-scripts/netblock-page.js`
  is a static file from the package that wraps `window.fetch` and
  `XMLHttpRequest` on enabled sites; rules arrive as JSON over a nonce-checked
  `postMessage` bridge and are matched by pure functions. No `eval`, no
  `new Function`, no rule text is executed. It does not fake `toString`.
  Reports coming back from the page are treated as untrusted input: the
  background keeps only well-formed events about rules it gave that tab
  (`sanitizePageEvents`), and privileged messages (rules, log, Network-level
  mode) are accepted only from the extension's own pages.
- **Does the debugger read page content?** No. Commands are limited to
  `Fetch.enable/disable/continueRequest/failRequest/fulfillRequest`,
  `Page.getFrameTree`, `Page.enable`. `Fetch.getResponseBody`,
  `Runtime.*`, `DOM.*` and `Network.enable` do not appear in the package
  (`grep` the built `background.js`). `handleAuthRequests` is `false`. A
  substituted response carries `nosniff` + `Content-Security-Policy: sandbox`,
  so even a `text/html` body on a navigation renders script-less and
  origin-less.
- **Proof of zero network?** `content_security_policy` carries
  `connect-src 'none'` on both targets (a `fetch` from any extension page or
  the worker is refused by the browser); `npm run guards` fails the build if
  any other `connect-src` appears; the only marek-devlab URL in the package is
  the manifest's `homepage_url` (`https://github.com/marek-devlab/browser-extensions`), which the browser
  shows as a link and nothing ever fetches.
- **Is the request log "browsing activity"?** It is shown to the user who
  created it, only for sites they enabled or tabs they attached, only in
  `storage.session` (memory), never persisted, never transmitted, with
  credentials masked. The Limited Use policy allows web-browsing activity
  "to the extent required for a user-facing feature described prominently"
  — the log is that feature and is described in the listing and in-product.
- **Why `alarms`?** Fail-open watchdog (30 s) for paused requests; MV3
  workers lose `setTimeout` on suspension.
- **Why is the page engine detectable?** Honesty: we do not fake
  `Function.prototype.toString`; a page can tell the interceptor is present.
  The listing says so.

### Firefox (AMO) — notes and reviewer text

- **`webRequestBlocking` + `<all_urls>` justification (paste):** "Request
  Blocker cancels or delays network requests that match the user's rules.
  On Firefox the only API that can cancel a request is blocking
  `webRequest`, and it can only cancel requests it is allowed to see, so
  host access to all sites is required at install (the MV2 build has no
  optional-host mechanism to request a site later). Blocking listeners are
  registered only while the user has rules; a non-blocking observer
  (`onCompleted`/`onErrorOccurred`) feeds the extension's own session-only
  request log. Nothing is redirected and no header is modified — `redirectUrl`
  and `responseHeaders` mutation are not used; the only `BlockingResponse`
  values are `{cancel: true}` and an empty object after a delay. The
  extension makes no network requests of its own (`connect-src 'none'`)."
- **`data_collection_permissions: none` consistency:** the manifest says
  `required: ["none"]`; `PRIVACY.md` and the Chrome data-usage tab say the
  same. Under Mozilla's taxonomy, "collection" is transmission off the
  browser — locally applied rules and a session-only log are not collection.
- **Source-code submission (mandatory — WXT + Vite bundle):** upload the
  repo source ZIP (include `package-lock.json`, exclude `node_modules` and
  `.output`) with a README stating: reviewer environment assumed Ubuntu
  24.04.4 LTS ARM64, Node 24.14.0, npm 11.9.0 (AMO default); steps
  `npm ci` → `npm run build:firefox --workspace @blur/netblock` → compare
  `extensions/netblock/.output/firefox-mv2/` with the uploaded XPI (identical
  bytes; the build is deterministic). Same procedure as the other add-ons.
- **Android:** `gecko_android: {}` marks it compatible; blocking webRequest
  and `tabs.onActivated` work there; the popup renders as an overlay from the
  Add-ons menu, the tool page opens in a tab. Not yet smoke-tested on a
  device (TODO). The background is a persistent page (no `persistent: false`
  in the MV2 build) — Mozilla recommends event pages on Android; listed as a
  v2 item.
- **Reviewer-visible honesty:** on Firefox the actions "network error (type)"
  and "response status" degrade to a cancel and the UI badge reads `wr↓`
  with the text "Firefox cannot choose the network error type" / "cannot
  change a response status code". This is intentional and disclosed, not a
  broken feature.
- **Unused files a reviewer may notice:** the Firefox package also ships
  `content-scripts/netblock-page.js` and `relay.js` (the Chrome-only page
  engine; never registered on Firefox — `scripting` is not in the manifest)
  and the Chrome debugger engine's code inside `background.js` (dead on
  Firefox: the API is injected only under the Chrome build flag). They are
  inert; removing them from the Firefox bundle is a build-hygiene TODO.
- **Expected `addons-linter` warnings:** `UNSAFE_VAR_ASSIGNMENT` from React's
  bundled runtime (same as every add-on in the suite — Reviewer note 1). The
  custom CSP passes the linter (`script-src 'self'`; `connect-src` is not
  inspected). No `DANGEROUS_EVAL`: the package contains no `eval` /
  `new Function`.

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

### 4. `netblock` — `debugger` permission and CDP `Fetch` strings in `background.js` (Chrome build; AMO does not see this)

> The Chrome package declares `debugger` at install because Chromium does not
> permit it as an optional permission (permissions API reference: "cannot be
> specified as optional"). It is used for one feature, Network-level mode,
> which the user turns on per tab from the popup after a consent dialog; the
> service worker attaches with `chrome.debugger.attach({tabId}, "1.3")` and
> sends only `Fetch.enable/disable/continueRequest/failRequest/fulfillRequest`
> and `Page.getFrameTree/enable`. `Fetch.getResponseBody`, `Runtime.*`,
> `DOM.*` and `Network.enable` do not occur in the package. Detach happens on
> toggle-off, tab close, the banner's Cancel, policy, or after three handler
> errors, and in `dispose()`.

### 5. `netblock` — `window.fetch` / `XMLHttpRequest` replaced by `content-scripts/netblock-page.js` (both stores)

> The file is a static, bundled MAIN-world content script registered at runtime
> (`scripting.registerContentScripts`) only for origins the user granted from
> the popup; it is not in the manifest's `content_scripts` and is never injected
> at install. It wraps `fetch` and `XMLHttpRequest` so that rules the user wrote
> (block / network error / delay / status) apply to the page's own calls. Rules
> reach it as JSON over a nonce-checked `postMessage` bridge and are matched by
> pure functions; there is no `eval`, no `new Function`, and no rule text is
> ever executed. In the Firefox package the file is present but inert
> (`scripting` is not declared and nothing registers it).

---

## Licensing (for both stores)

- Root [`LICENSE`](./LICENSE) — MIT, covering **marek-devlab's own code only**.
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
