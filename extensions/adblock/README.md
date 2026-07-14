# Ad & Tracker Blocker

A WXT + React + TypeScript browser extension that blocks ads and trackers.
Chrome (MV3) and Firefox (incl. Firefox for Android) build from the same
codebase.

**Single purpose:** _"Block ads and trackers."_ Every feature — strictness
levels, filter lists, tracker blocking, parameter stripping, the blocked
counter, per-site allowlisting — serves that one phrase. Content blurring and
the developer toolkit are **separate companion extensions** in this suite, so
the Chrome Web Store single-purpose policy is satisfied (a reviewer must be able
to write each add-on's purpose as one short phrase; bundling unrelated
functionality is rejected — see `PLAN.md` §0).

## Run

From the monorepo root:

```bash
npm install
npm run dev:adblock           # Chrome
npm run dev:adblock:firefox   # Firefox
```

## Two engines, one codebase

This is the interesting part. Chrome and Firefox diverged in MV3:

- **Chrome** removed blocking `webRequest`. Blocking is declarative
  (`declarativeNetRequest`): rules ship as JSON, the browser evaluates them, and
  the extension never sees the request — so network counts are **approximate**
  (see `entrypoints/background.ts`).
- **Firefox** kept blocking `webRequest`, so it runs a per-request JS engine
  that both blocks and counts **exactly**.

The engine hides behind one `BlockingBackend` interface; the concrete class
(`DnrBackend` vs `WebRequestBackend`) is chosen at build time via
`import.meta.env.FIREFOX`.

## Statistics — measured, never fabricated

All counts are real. A fresh install shows zeros, and pages the extension does
not run on (chrome://, about:, New Tab) show an explicit empty state — no mock
data is imported into any production screen.

- **Cosmetic hides** — counted exactly on every browser by the content script.
- **Network / tracker blocks** — exact on Firefox (blocking `webRequest`);
  on Chrome they are per-tab, on-demand and **approximate** (prefixed `~`), read
  from `getMatchedRules()` only when the popup opens, and shown as `—` when the
  read is unavailable. See `PLAN.md` §5 and `IMPLEMENTATION.md`.
- **Cumulative total** — exact: only exactly-counted increments are accrued into
  it. Its label reflects what actually feeds it per engine.

Types and helpers come from `@blur/core`; they are not redefined here.

## Permissions & privacy

The permission set differs by engine (Chrome vs Firefox).

**Chrome / Chromium (declarative engine):** `storage`, `activeTab`, `scripting`,
`declarativeNetRequest`, `declarativeNetRequestWithHostAccess`, `alarms`,
`contextMenus`, plus `optional_host_permissions: <all_urls>` (granted **per site
at runtime** for allowlisting and parameter stripping — never a blanket
install-time grant). Bundled rulesets: `easylist`, `easyprivacy` (on by default)
and `annoyances` (off by default; on only at the "aggressive" level).

**Firefox (per-request engine):** `storage`, `activeTab`, `scripting`,
`webRequest`, `webRequestBlocking`, `alarms`, `contextMenus`, and **install-time**
`<all_urls>`. The broad host grant is required on Firefox: blocking `webRequest`
can only cancel requests it can see, and the MV2 build cannot request host access
at runtime. An ad blocker must see requests on every site to block ads on every
site. Chrome does not need this because its declarative engine blocks without a
broad host grant.

Filter lists are **data, not code** — matching patterns the engine reads, bundled
with the extension, never fetched and executed at runtime. All blocking and
counting happen locally; nothing about the pages you visit is sent anywhere. No
analytics, no tracking. See the suite privacy policy at
[`../../PRIVACY.md`](../../PRIVACY.md).
