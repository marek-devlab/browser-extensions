# Privacy Policy

_Last updated: 2026-07-15_

This policy covers a suite of ten independent browser extensions that are built
from one monorepo but ship as ten separate add-ons (all at version **1.0.0**,
published by **Blockaly**, https://blockaly.com):

- **Content Blur** — hide images, video, thumbnails, and matched text on any page.
- **Ad & Tracker Blocker** — block ads and trackers.
- **Page Performance & Network** — measure Core Web Vitals and inspect network traffic.
- **SEO & Accessibility Auditor** — inspect meta tags, headings, structured data, and accessibility issues.
- **Data Format Toolkit** — parse, convert, and inspect JSON / YAML / XML / CSV / JWT locally.
- **Page Content Exporter** — export page selections or tables to txt / md / csv / xlsx.
- **Asset Inspector** — inspect where a page's images, media, and other elements came from.
- **Connection & Device Info** — show your device, browser, and (on request) your public IP and ISP.
- **Capture Studio** — record the current tab or a chosen screen/window, plus optional microphone.
- **Markdown Workbench** — write and format Markdown in a side panel.

The first four are the original wave; the last six were added later. The first
part of this document is the **architectural invariant** that applies to all
ten. The second part is a **per-extension section** with the exact permissions
each one declares and what they are used for.

If anything in this document conflicts with what an extension actually does,
treat that as a bug and report it — the whole design of this suite is to be
honest about what it measures and what, if anything, it sends.

---

## The invariant: your page data stays in your browser

**Page-content data never leaves your browser.** What you browse, what an
extension reads from a page (images, text, meta tags, headings, DOM structure,
timings, blocked-request counts), and your settings are all processed locally
and stored only in your browser's local extension storage.

Across all ten extensions there are only **two** features that ever transmit
anything off your device, and **both are opt-in, click-gated, and disclosed in
the UI before the first request**:

> **(a) PageSpeed Insights (Page Performance & Network only).** When you
> explicitly run a "PageSpeed Insights" audit, the extension sends the **URL you
> are auditing** (the current or user-entered page URL) to Google's PageSpeed
> Insights API (`https://www.googleapis.com/pagespeedonline/v5/runPagespeed`) so
> Google can measure that page and return the results. It only runs when you
> choose to run it, and it only accepts public URLs. See the Page Performance &
> Network section below for details. If you provide an optional Google API key,
> it is sent with the request as authentication and is stored only in local
> storage.

> **(b) IP / ISP lookup (Connection & Device Info only).** The entire device
> half of this extension runs with **zero network and zero host permissions**.
> Two features are network-backed and both are gated behind an explicit click
> with an on-screen disclosure shown *before* the first request: (1) pressing
> "Show my IP" makes a keyless call to Cloudflare's trace endpoint
> (`https://one.one.one.one/cdn-cgi/trace`), which returns **your own public IP**
> and country/PoP back to you; (2) opting into an ISP/ASN lookup sends **only
> your public IP** to **ipinfo.io** (operated in the USA). The IP lives in page
> memory only, is **never stored, never forwarded, and never logged**, and no
> fingerprint is ever computed. See the Connection & Device Info section below.

> **(c) Nothing else phones home.** No extension in this suite contains
> analytics, telemetry, crash reporting, advertising, or user tracking of any
> kind. The other **eight** extensions — including all of Data Format Toolkit,
> Page Content Exporter, Asset Inspector, Capture Studio, and Markdown Workbench
> — make **zero network calls of any kind**; several enforce this at the platform
> level with a `connect-src 'none'` content-security policy. Aside from the two
> opt-in calls above, nothing in this suite makes any network request that
> carries data about you or the pages you visit.

### Common guarantees (all ten extensions)

- **Local only.** Settings and any cached results live in your browser's
  extension storage (`storage.local` / `storage.sync`). They are not uploaded to
  us or anyone else. We operate no servers and receive none of your data.
- **No analytics or tracking.** No usage statistics, identifiers, fingerprinting,
  or behavioral data are collected.
- **No selling or sharing of data.** We have no data to sell or share.
- **No remote code.** All executable code ships inside the extension package and
  is reviewed by the store. Nothing is fetched and executed at runtime, which is
  also required by the browsers' Manifest V3 policies.
- **Filter lists are data, not code.** The Ad & Tracker Blocker ships filter
  lists (converted from AdGuard's pre-built DNR rulesets, which incorporate
  EasyList / EasyPrivacy). These are **data** the blocking engine reads —
  matching patterns — not executable code. They are bundled with the extension
  and remain under their own licenses (GPL-3.0 / CC-BY-SA 3.0); see
  `public/rules/ATTRIBUTION.md` inside the add-on package.
- **Your data is your data.** You can clear everything at any time by removing
  the extension or clearing its storage from your browser's extension settings.

### Access is not collection — please read this before the permission tables

**The original four extensions each declare a content script that matches
`<all_urls>`.** That is a *standing*, install-time grant: at install your browser
will warn that the extension can **"read and change all your data on all
websites"**, and it applies to Content Blur, Ad & Tracker Blocker, Page
Performance & Network, and SEO & Accessibility Auditor, on both Chrome and
Firefox. We do not hide that behind an "optional permission" story — for those
four it is not optional, and it is not requested later. Each per-extension
section below states exactly why that extension genuinely needs it.

**The six newer extensions are different, and deliberately so: most of them
install with no broad-access warning at all.** Asset Inspector, Connection &
Device Info, Capture Studio, and Markdown Workbench declare **no** `<all_urls>`
host access — Connection & Device Info in fact declares `host_permissions: []`
and asks for at most a single optional origin (`https://ipinfo.io/*`) at the
moment you use it. Data Format Toolkit *does* have `<all_urls>`, but only as an
**optional** host permission, requested by a user gesture for its opt-in
"auto-format JSON pages" feature — never at install. Page Content Exporter reads
a page only through `activeTab` (the tab you are on when you invoke it), not a
standing content script. So for the new wave, the "read and change all your data
on all websites" warning is mostly absent, and where broad access exists at all
it is opt-in.

The important, and separate, fact is this: **broad access is not data
collection.** Having permission to read a page and actually taking anything off
your device are two different things. These extensions read pages in order to act
on them locally — blur them, hide ad elements, time them, audit their markup,
convert their data, export their contents, inspect their assets — and then the
data stays where it was: in the page, and in your local extension storage. The
only bytes that ever leave your machine are the two opt-in calls described above
(the PageSpeed Insights URL, and Connection & Device Info's IP/ISP lookup).

That is also what the ten add-ons tell Firefox. Every Firefox build declares
`browser_specific_settings.gecko.data_collection_permissions`, the key that
drives the data-consent panel Firefox shows at install (mandatory for new AMO
submissions since 2025-11-03):

| Extension | Firefox data-collection declaration | What the consent panel says |
|---|---|---|
| Content Blur | `required: ["none"]` | Does not collect data |
| Ad & Tracker Blocker | `required: ["none"]` | Does not collect data |
| Page Performance & Network | `required: ["none"]`, `optional: ["websiteActivity"]` | Collects nothing by default; may share website activity (the audited page URL) if you opt into the PageSpeed Insights audit |
| SEO & Accessibility Auditor | `required: ["none"]` | Does not collect data |
| Data Format Toolkit | `required: ["none"]` | Does not collect data |
| Page Content Exporter | `required: ["none"]` | Does not collect data |
| Asset Inspector | `required: ["none"]` | Does not collect data |
| Connection & Device Info | `required: ["none"]`, `optional: ["locationInfo"]` | Collects nothing by default; may share your IP with ipinfo.io for an ISP lookup only if you opt in |
| Capture Studio | `required: ["none"]` | Does not collect data |
| Markdown Workbench | `required: ["none"]` | Does not collect data |

Those declarations and this policy say the same thing on purpose.

### Permissions, in general

Each extension asks for the **minimum** API permissions its single purpose needs.
Where a permission is genuinely optional (the Chrome-only `debugger` permission
and the PageSpeed Insights host in Page Performance & Network; the `<all_urls>`
host *permission* in the Chrome build of Ad & Tracker Blocker; the optional
`<all_urls>` and `scripting` in Data Format Toolkit; the optional `downloads` in
Page Content Exporter; the `https://ipinfo.io/*` origin in Connection & Device
Info; the optional `desktopCapture` in Capture Studio), it is declared as an
optional permission and requested at the moment you use the feature, not at
install. Broad **page access via the content script**, however, is standing for
the original four — see above. The exact list per extension is below.

---

## Content Blur

**Purpose:** hide unwanted content (images, video, video posters/thumbnails, and
text matching your patterns) on web pages. It does no network blocking and ships
no rule lists.

**Permissions declared (Chrome MV3 and Firefox MV2):**

| Permission | Why |
|---|---|
| `storage` | Save your blur settings and per-site preferences locally. |
| `activeTab` | Act on the tab you are currently looking at when you invoke the extension. |
| `contextMenus` | Provide the right-click "Blur this" / "Always blur images here" actions. Adds no host access and no network capability. |
| Content script on `<all_urls>`, `run_at: document_start` | **Standing access to every site — this is what produces the "read and change all your data on all websites" install warning.** Blurring is only useful if it happens *before* the content is visible. The content script must be present at `document_start` on whatever page you open, so the blur styles are applied before first paint (the script injects the block-first stylesheet itself, so no `scripting` permission is needed); there is no "ask me when I get there" moment that would not already have leaked the image you did not want to see. |

Content Blur **no longer declares `optional_host_permissions`**. It previously
declared `<all_urls>` there; that key was removed because nothing in the
extension ever called `permissions.request()`, so it could never be granted and
never changed behavior — while implying a runtime permission flow that did not
exist. Any older copy of this policy that said blur "requests broad access at
runtime" was wrong; this is the correction.

**Data:** what is blurred and your settings are computed and stored entirely on
your device. Nothing is transmitted anywhere. Firefox declaration:
`data_collection_permissions.required = ["none"]`.

---

## Ad & Tracker Blocker

**Purpose:** block ads and trackers. Strictness levels, filter lists, tracker
blocking, parameter stripping, the blocked counter, and per-site allowlisting all
serve that one purpose.

This extension uses **two different blocking engines** depending on the browser,
because Chrome and Firefox diverged in Manifest V3. That changes the exact
permission list.

**Common to both browsers:**

| Permission | Why |
|---|---|
| Content script on `<all_urls>`, `run_at: document_start` | **Standing access to every site — part of the "read and change all your data on all websites" install warning.** This is the cosmetic (element-hiding) engine: it applies `display: none` to ad containers that the network layer cannot remove, and it must run at `document_start` so those elements never flash on screen before being hidden. It also backs the right-click element picker. |

**Chrome / Chromium (declarative engine):**

| Permission | Why |
|---|---|
| `storage` | Save strictness level, allowlist, and blocked counts locally. |
| `activeTab` | Read the current tab for per-site actions from the popup. |
| `scripting` | Apply cosmetic (element-hiding) filtering on the page. |
| `declarativeNetRequest` | Block ad/tracker requests declaratively. The browser evaluates bundled rulesets; the extension never sees the requests. |
| `declarativeNetRequestWithHostAccess` | Back the dynamic rules that act on request URLs (per-site allowlisting and URL-parameter stripping). |
| `alarms` | Flush blocked-count statistics on a periodic (~30s) tick, because the MV3 service worker can be torn down between events. |
| `contextMenus` | Right-click "Block this element" / "Pause on this site". Adds no broad access. |
| `optional_host_permissions: <all_urls>` | **Optional, requested at runtime from a user gesture — Chrome only.** This is a *host permission*, which is a different thing from the content-script access above, and Chrome treats it differently: DNR classifies `redirect` and `modifyHeaders` as **"unsafe" actions** and applies them only on origins for which the extension holds **granted `host_permissions`**. A content-script `matches` pattern does **not** satisfy that check. So without this grant the URL-parameter-stripping redirect rule would silently never fire. Per-site allowlisting (`allowAllRequests`) does **not** need it and works before you grant anything. |

Bundled static rulesets: `easylist` and `easyprivacy` (enabled by default) and
`annoyances` (disabled by default; requested only at the "aggressive" strictness
level). Chrome only *guarantees* 30,000 enabled static rules per extension, and
the aggressive tier wants 35,000 (20,000 + 9,000 + 6,000), with the excess drawn
from a pool shared with your other extensions. When that pool is full the
extension **predicts the shortfall and degrades deterministically**: it keeps ads
and trackers blocked (EasyList + EasyPrivacy, 29,000 rules, inside the
guarantee), leaves annoyances off, and tells you so in the popup and options
page. It never claims to be blocking more than it is. This has no privacy
implication — the degradation state is stored in `storage.local` because it
describes *this machine's* browser budget, and is never transmitted.

**Firefox (per-request engine):**

| Permission | Why |
|---|---|
| `storage`, `activeTab`, `scripting`, `alarms`, `contextMenus` | Same roles as above. |
| `webRequest` + `webRequestBlocking` | Firefox kept blocking `webRequest`, so requests are blocked and counted exactly in `onBeforeRequest`. |
| `<all_urls>` (host access, install-time) | **Required at install time on Firefox.** Blocking `webRequest` can only cancel a request the extension can see; without host access every `{cancel: true}` is a no-op and Firefox would block nothing. `optional_host_permissions` is an MV3 concept that is not emitted for the Firefox MV2 build, so there is no runtime grant to request against — the host permission must be declared up front. To block ads on every site it must see requests on every site. |

**Data:** filter matching and counting happen locally, in-process. Blocked-request
counts and your settings stay in local storage. Filter lists are bundled data.
Nothing about the pages you visit is transmitted anywhere — the extension sees
every request in order to block it, and keeps none of it. Firefox declaration:
`data_collection_permissions.required = ["none"]`.

---

## Page Performance & Network

**Purpose:** measure how a page performs — Core Web Vitals plus a network /
page-weight inspector.

**Base permissions (installed, Chrome and Firefox):**

| Permission | Why |
|---|---|
| `storage` | Save your preferences and cached results (including any optional PSI API key, in `storage.local` only). |
| `activeTab` | Measure the tab you are currently looking at. |
| `scripting` | Inject the Web Vitals collector into the page you are measuring. |
| Content scripts on `<all_urls>`, `run_at: document_start` (two: the collector in the **MAIN** world, plus an **ISOLATED**-world relay) | **Standing access to every site — this is what produces the "read and change all your data on all websites" install warning.** Core Web Vitals (LCP, CLS, INP, FCP, TTFB) can only be observed if the collector is already registered *before the page starts painting* — a metric you attach to after the fact is a metric you have already missed. The collector runs in the page's MAIN world because the `PerformanceObserver` timings it needs are page-scoped; a small isolated-world relay carries the numbers back to the extension. |

A DevTools panel ("Performance") is registered via the DevTools page; a toolbar
popup ("Page Insight") shows the cross-origin-accurate subset without DevTools.

**Optional permissions (requested from a user gesture, never at install):**

| Permission | Platform | Why |
|---|---|---|
| `debugger` | **Chrome only, opt-in** (`optional_permissions`). | Requested **only** when you press "Measure exact bytes". It attaches the Chrome DevTools Protocol to sum real transferred bytes (`Network.loadingFinished.encodedDataLength`). While attached, Chrome shows a non-dismissable "extension is debugging this browser" banner, and it cannot attach while DevTools is open. It is detached when the measurement finishes. It is never used for anything else, and Firefox has no equivalent (`chrome.debugger` does not exist on Firefox). |
| `https://www.googleapis.com/*` | Chrome (`optional_host_permissions`) / Firefox (`optional_permissions`). | Requested when you run a PageSpeed Insights audit, so the extension may call Google's PSI API. |

**The PageSpeed Insights disclosure (the one exception to the invariant):**

- When — and only when — you run a **PageSpeed Insights** audit, the extension
  sends the **URL being audited** to Google's PageSpeed Insights API at
  `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`. Google fetches
  and measures that URL and returns lab results plus Chrome UX Report field data.
- The audited URL is therefore shared with **Google**, governed by Google's
  privacy policy. This is the only data any extension in this suite sends off
  your device.
- This is exactly what the Firefox consent panel means when it lists
  **`websiteActivity` as an optional** data-collection permission for this
  add-on: nothing is collected by default (`required: ["none"]`), and website
  activity is shared only if you choose to run an audit. The declaration and this
  policy are deliberately identical in scope.
- Only **public** URLs are auditable; the extension refuses localhost, private
  network addresses, and non-http(s) URLs before making any call, since Google's
  crawler cannot reach them anyway.
- If you set an optional Google API key (to raise rate limits), it is stored in
  `storage.local` (never `storage.sync`) and sent with the request as
  authentication.
- All other performance measurement — Web Vitals, resource timing, and the
  opt-in exact-bytes measurement — happens **entirely locally** and sends
  nothing anywhere.

---

## SEO & Accessibility Auditor

**Purpose:** audit page markup and accessibility — meta tags, headings,
structured data, social preview, link profile, indexability, and accessibility
issues (via the bundled axe-core engine).

**Permissions declared:**

| Permission | Why |
|---|---|
| `storage` | Cache the last report and your UI preferences locally. This is the **only** API permission. |
| Content script on `<all_urls>`, `run_at: document_idle` | **Standing access to every site — this is what produces the "read and change all your data on all websites" install warning.** It is standing access to the DOM of the sites you visit, used to read the page's markup and run the audit. Both the SEO report and the accessibility audit run through this already-injected content script, which is why the extension needs **neither** `activeTab` **nor** `scripting`. It runs at `document_idle`, because unlike the other three there is nothing to pre-empt: the markup is only worth reading once the page has parsed. |
| `web_accessible_resources: axe-run.js` | The accessibility engine (axe-core) is injected into the page only when you press "Run audit". |

**About axe-core:** the accessibility audit uses
[axe-core](https://github.com/dequelabs/axe-core) (MPL-2.0). It is **bundled**,
unmodified, and runs entirely in your browser; it is never fetched at runtime. It
is code-split into its own chunk and loaded only when you run an audit. Because
`axe-run.js` is a web-accessible resource injected into the *page*, it executes
under the page's own context — no remote code is involved anywhere in this path.

**Data:** the extension reads the DOM to analyze it. It never writes to the page
and never transmits anything off your device. `robots.txt` / `sitemap.xml` /
`X-Robots-Tag` checks use plain **same-origin** requests from the page — no
cross-origin access and no extra permission. Reports you export ("Copy JSON" /
"Copy Markdown") are placed on your clipboard for you; they are not sent
anywhere. Firefox declaration:
`data_collection_permissions.required = ["none"]`.

---

## Data Format Toolkit

**Purpose:** parse, convert, inspect, and validate structured data — JSON, YAML,
XML, CSV, and JWTs — entirely on your device. It is a local developer tool, not a
web service.

**Permissions declared (Chrome MV3 and Firefox MV2):**

| Permission | Why |
|---|---|
| `storage` | Save your preferences and recent conversions locally. |
| `contextMenus` | Provide right-click actions to send selected text into the toolkit. Adds no host access and no network capability. |
| `activeTab` | Read the current tab's selection or content when you invoke the extension on it. |
| `scripting` (**optional**) | Requested by a user gesture, only for the opt-in "auto-format JSON pages" feature, to inject the formatter into a page. Never requested at install. |
| `<all_urls>` host permission (**optional, gesture-only**) | Requested at the moment you enable the opt-in "auto-format JSON pages" feature — **never at install**, so this extension shows no broad-access warning when you add it. On Firefox it is declared under `optional_permissions`. |

**Data:** all parsing and conversion — JSON, YAML, XML, CSV, and JWT — runs
**100% locally** in your browser. JWT decoding and signature verification happen
entirely in the browser; the token **never leaves your device**, and the HS256
secret you type to verify a signature is held in memory only and is **never
persisted**. The extension makes **zero network calls**. Firefox declaration:
`data_collection_permissions.required = ["none"]`.

---

## Page Content Exporter

**Purpose:** export a page selection or table to a file — plain text, Markdown,
CSV, or `.xlsx` — built locally in your browser.

**Permissions declared (Chrome MV3 and Firefox MV2):**

| Permission | Why |
|---|---|
| `contextMenus` | Provide the right-click "Export selection / table" actions. |
| `activeTab` | Read the current tab's selection or content when you invoke the extension. This is how it reads the page — there is **no standing content script and no `<all_urls>`**. |
| `scripting` | Inject the extractor into the active tab to read the selection or table you are exporting. |
| `storage` | Save your export preferences locally. |
| `clipboardWrite` | Copy exported content to your clipboard. |
| `downloads` (**optional**) | Save the finished file to disk. Requested by a user gesture only when a cross-origin save requires it; otherwise files are offered through an in-page `Blob` download link. Never requested at install. |

**Data:** the extension builds `.txt` / `.md` / `.csv` / `.xlsx` files **locally**
from the page content you select, using an in-browser `Blob`. Nothing is uploaded
and the extension makes **zero network calls**. Firefox declaration:
`data_collection_permissions.required = ["none"]`.

---

## Asset Inspector

**Purpose:** inspect where a page's elements came from — the source URL, format,
and dimensions of images, media, and other assets already on the page. It is an
inspector, **not a downloader**.

**Permissions declared (Chrome MV3 and Firefox MV2):**

| Permission | Why |
|---|---|
| `activeTab` | Read the current tab when you invoke the extension. There is **no standing content script and no `<all_urls>`** — so this extension shows no broad-access warning at install. |
| `scripting` | Inject the inspector into the active tab to read where its elements came from. |
| `storage` | Save your UI preferences locally. |
| `contextMenus` | Provide the right-click "Inspect this asset" action. |

**Data:** the extension reports metadata (source URL, format, dimensions) about
elements **already present on the page**, and any preview is drawn from the
existing DOM element via `canvas.drawImage`. It **never fetches media** and
**never downloads anything** — it declares no `downloads` permission, no
`<all_urls>`, no `webRequest`, and no `debugger`. It makes **zero network
calls**. Firefox declaration: `data_collection_permissions.required = ["none"]`.

---

## Connection & Device Info

**Purpose:** show you your own device, browser, screen, and locale — and, on
request, your public IP, country, and ISP. The **entire device half works
offline with zero permissions and zero network**; only the IP/ISP features touch
the network, and only when you ask.

**Permissions declared:**

| Permission | Why |
|---|---|
| `storage` | Save your theme, units, provider choice, an optional ipinfo.io token (stored locally only, **never synced**), and boolean consent flags. The settings schema **physically contains no field** for an IP address, country, ASN, or fingerprint hash. |
| `https://ipinfo.io/*` host permission (**optional**) | Requested at the exact moment you opt into the ISP/ASN lookup, granting access to that **single origin only**. Declared as `optional_host_permissions` on Chrome and `optional_permissions` on Firefox. **Never requested at install.** |

There is **no** `host_permissions`, **no** `activeTab`, **no** `scripting`, and
**no** background service worker — the extension does not touch the pages you
visit at all.

**How the data flows:**

- **Device data (~45 fields).** UA, screen, CPU/RAM, GPU, locale, timezone, and
  media features are read synchronously from `navigator`, `screen`, `Intl`, and
  `matchMedia`. This needs **no permissions and no network**, and it is what you
  see the instant the popup opens — before any request is made.
- **"Show my IP" (opt-in, click-gated).** Only when you press the button does the
  extension make a **keyless** request to Cloudflare's trace endpoint
  (`https://one.one.one.one/cdn-cgi/trace`), which returns **your own public IP**
  plus country/PoP/TLS info back to you. **Cloudflare** therefore sees your IP —
  it is your own request to them — and this is disclosed in the UI, in text that
  sits directly above the button, before the first request.
- **ISP / ASN lookup (opt-in, click-gated).** Only if you choose to look up your
  ISP does the extension send **your public IP and nothing else** to
  **ipinfo.io** (operated in the **USA**). This is gated behind a modal
  disclosure that names the recipient, the data sent, the purpose, and the
  retention, **and** the browser's own permission prompt for the `ipinfo.io`
  origin.

**Recipients (named for store review):** **Cloudflare** (receives your IP when
you press "Show my IP", and shows it back to you) and **ipinfo.io, operated in
the USA** (receives only your IP when you opt into an ISP lookup).

**Data:** your IP address lives in page memory (React state) only. It is **never
stored, never forwarded to us (we operate no server), and never logged**;
closing the popup discards it. **No fingerprint hash is ever computed, stored, or
sent.** The complete set of hosts the extension is even *able* to contact is
pinned in the manifest's content-security policy
(`connect-src 'self' https://one.one.one.one https://ipinfo.io`), so it cannot
reach anywhere else even if a dependency tried. Firefox declaration:
`data_collection_permissions.required = ["none"], optional: ["locationInfo"]` —
nothing by default; your IP is shared with ipinfo.io only if you opt into the ISP
lookup.

---

## Capture Studio

**Purpose:** record the current tab, or a screen/window you choose, plus an
optional microphone; then trim, annotate, and export the result. Everything is
recorded, encoded, and stored **on your device**.

**Permissions declared:**

| Permission | Why |
|---|---|
| `storage` | Save your recording and export preferences locally. |
| `unlimitedStorage` | Store recordings as chunks in IndexedDB without the small default storage quota — video recordings can be large. |
| `downloads` | Save the finished video or screenshot file to disk. |
| `activeTab` | Identify the current tab so it can be the capture target when you press Record. |
| `tabCapture` (**Chrome only**) | Capture the current tab's video and audio. Does not exist on Firefox. |
| `offscreen` (**Chrome only**) | Run the recorder (`MediaRecorder` needs a DOM, which a service worker lacks) in an invisible offscreen document that survives the service worker being torn down. Does not exist on Firefox. |
| `desktopCapture` (**optional**) | Requested **only** when you choose "Record whole screen or window". Never requested at install or by default. |

On **Firefox** there is no `tabCapture` or `offscreen` (those APIs do not exist);
the extension captures a screen or window via `getDisplayMedia` from its recorder
window, and **cannot capture tab audio** there — only the microphone. This limit
is stated in the UI, not hidden.

**Data:** screen and microphone capture is stored **locally in IndexedDB** and
encoded **locally in your browser** (WebCodecs plus the bundled `mediabunny`
library). It is **never transmitted anywhere**: the manifest's content-security
policy is `connect-src 'none'`, which makes the extension **architecturally
incapable of any network request**. It records **your own** tab or screen — it is
not a tool for downloading media from other sites. A privacy policy is provided
because the extension captures your screen and (optionally) your microphone, even
though every byte stays on your device. Firefox declaration:
`data_collection_permissions.required = ["none"]`.

---

## Markdown Workbench

**Purpose:** write, format, and preview Markdown in a browser side panel, with
local drafts. No cloud, no account, no AI.

**Permissions declared:**

| Permission | Why |
|---|---|
| `storage` | Save your Markdown drafts and preferences in local storage. |
| `contextMenus` | Provide right-click actions to send selected text into the workbench. |
| `clipboardWrite` | Copy rendered Markdown or HTML to your clipboard. |
| `activeTab` | Read a selection from the current tab when you send it into the workbench. |
| `sidePanel` (Chrome) / `sidebar_action` (Firefox) | Host the workbench in the browser's side panel (Chrome) or sidebar (Firefox). |

**Data:** Markdown is written, formatted, and previewed **entirely locally**;
your drafts live in `storage.local`. There is **no cloud sync, no account, and no
AI or other network feature of any kind** — the manifest's content-security
policy is `connect-src 'none'`. Firefox declaration:
`data_collection_permissions.required = ["none"]`.

---

## Licensing

Blockaly's own extension code is MIT-licensed (root `LICENSE`). The extensions
also redistribute third-party material under other terms — React (MIT),
`web-vitals` (Apache-2.0), axe-core (MPL-2.0), and the Ad & Tracker Blocker's
filter-list **data** (GPL-3.0 / CC-BY-SA 3.0). The newer extensions add a few
more notable licenses: **mediabunny** (MPL-2.0, Capture Studio's video/audio
encoder), **DOMPurify** (MPL-2.0 OR Apache-2.0, Markdown Workbench), **yaml**
(ISC, Data Format Toolkit), and a set of MIT libraries (papaparse, json5, jose,
`@cfworker/json-schema`, jsonc-parser, markdown-it, write-excel-file, fflate,
emojibase-data). Full notices are in `THIRD-PARTY-NOTICES.md` in the source
repository, a copy ships inside every extension package
(`THIRD-PARTY-NOTICES.md` at the package root), and the filter lists carry their
own `rules/ATTRIBUTION.md`. None of this changes what the extensions do with your
data: nothing.

---

## Contact

Questions about this policy: **nikita@blockaly.com**.
