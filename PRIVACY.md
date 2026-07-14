# Privacy Policy

_Last updated: 2026-07-14_

This policy covers a suite of four independent browser extensions that are built
from one monorepo but ship as four separate add-ons (all at version **1.0.0**,
published by **Blockaly**, https://blockaly.com):

- **Content Blur** — hide images, video, thumbnails, and matched text on any page.
- **Ad & Tracker Blocker** — block ads and trackers.
- **Page Performance & Network** — measure Core Web Vitals and inspect network traffic.
- **SEO & Accessibility Auditor** — inspect meta tags, headings, structured data, and accessibility issues.

The first part of this document is the **architectural invariant** that applies
to all four. The second part is a **per-extension section** with the exact
permissions each one declares and what they are used for.

If anything in this document conflicts with what an extension actually does,
treat that as a bug and report it — the whole design of this suite is to be
honest about what it measures and what, if anything, it sends.

---

## The invariant: your page data stays in your browser

**Page-content data never leaves your browser.** What you browse, what an
extension reads from a page (images, text, meta tags, headings, DOM structure,
timings, blocked-request counts), and your settings are all processed locally
and stored only in your browser's local extension storage.

There is exactly **one** exception, and it is opt-in and disclosed:

> **(a) PageSpeed Insights (Page Performance & Network only).** When you
> explicitly run a "PageSpeed Insights" audit, the extension sends the **URL you
> are auditing** (the current or user-entered page URL) to Google's PageSpeed
> Insights API (`https://www.googleapis.com/pagespeedonline/v5/runPagespeed`) so
> Google can measure that page and return the results. This is the only feature
> in the entire suite that transmits anything off your device, it only runs when
> you choose to run it, and it only accepts public URLs. See the Page
> Performance & Network section below for details. If you provide an optional
> Google API key, it is sent with the request as authentication and is stored
> only in local storage.

> **(b) Nothing else phones home.** No extension in this suite contains
> analytics, telemetry, crash reporting, advertising, or user tracking of any
> kind. Aside from the opt-in PageSpeed Insights call above, none of them make
> any network request that carries data about you or the pages you visit.

### Common guarantees (all four extensions)

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

**All four extensions declare a content script that matches `<all_urls>`.** That
is a *standing*, install-time grant: at install your browser will warn that the
extension can **"read and change all your data on all websites"**, and it applies
to every extension in this suite, on both Chrome and Firefox. We do not hide
that behind an "optional permission" story — it is not optional, and it is not
requested later. Each per-extension section below states exactly why that
extension genuinely needs it.

The important, and separate, fact is this: **broad access is not data
collection.** Having permission to read a page and actually taking anything off
your device are two different things. These extensions read pages in order to act
on them locally — blur them, hide ad elements, time them, audit their markup —
and then the data stays where it was: in the page, and in your local extension
storage. The only bytes that ever leave your machine are the opt-in PageSpeed
Insights URL described above.

That is also what the four add-ons tell Firefox. Every Firefox build declares
`browser_specific_settings.gecko.data_collection_permissions`, the key that
drives the data-consent panel Firefox shows at install (mandatory for new AMO
submissions since 2025-11-03):

| Extension | Firefox data-collection declaration | What the consent panel says |
|---|---|---|
| Content Blur | `required: ["none"]` | Does not collect data |
| Ad & Tracker Blocker | `required: ["none"]` | Does not collect data |
| Page Performance & Network | `required: ["none"]`, `optional: ["websiteActivity"]` | Collects nothing by default; may share website activity (the audited page URL) if you opt into the PageSpeed Insights audit |
| SEO & Accessibility Auditor | `required: ["none"]` | Does not collect data |

Those declarations and this policy say the same thing on purpose.

### Permissions, in general

Each extension asks for the **minimum** API permissions its single purpose needs.
Where a permission is genuinely optional (the Chrome-only `debugger` permission
and the PageSpeed Insights host in Page Performance & Network; the `<all_urls>`
host *permission* in the Chrome build of Ad & Tracker Blocker), it is declared as
an optional permission and requested at the moment you use the feature, not at
install. Broad **page access via the content script**, however, is standing for
all four — see above. The exact list per extension is below.

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
| `scripting` | Inject the block-first stylesheet that blurs content on the page. |
| `contextMenus` | Provide the right-click "Blur this" / "Always blur images here" actions. Adds no host access and no network capability. |
| Content script on `<all_urls>`, `run_at: document_start` | **Standing access to every site — this is what produces the "read and change all your data on all websites" install warning.** Blurring is only useful if it happens *before* the content is visible. The content script must be present at `document_start` on whatever page you open, so the blur styles are applied before first paint; there is no "ask me when I get there" moment that would not already have leaked the image you did not want to see. |

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

## Licensing

Blockaly's own extension code is MIT-licensed (root `LICENSE`). The extensions
also redistribute third-party material under other terms — React (MIT),
`web-vitals` (Apache-2.0), axe-core (MPL-2.0), and the Ad & Tracker Blocker's
filter-list **data** (GPL-3.0 / CC-BY-SA 3.0). Full notices are in
`THIRD-PARTY-NOTICES.md` in the source repository, a copy ships inside every
extension package (`THIRD-PARTY-NOTICES.md` at the package root), and the filter
lists carry their own `rules/ATTRIBUTION.md`. None of this changes what the
extensions do with your data: nothing.

---

## Contact

Questions about this policy: **nikita@blockaly.com**.
