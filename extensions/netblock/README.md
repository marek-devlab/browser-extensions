# Request Blocker (`@blur/netblock`)

A browser extension that blocks, fails and delays network requests by rule —
for testing how a frontend behaves when the network breaks.

## Single purpose

> **Block, fail and delay network requests for frontend resilience testing.**

Every action answers one question: *what does the frontend see when the
network breaks?* Blocked · failed with a network error · slow · a 503. There is
deliberately no redirect, no header rewriting, no "map local" mocking of
successful responses, no filter lists and no user-supplied JavaScript in rules
(rules are configuration, never code). The audience is developers and QA.

## Run it

From the repo root:

```bash
npm run dev:netblock          # Chrome
npm run dev:netblock:firefox  # Firefox
```

Build and test:

```bash
npm run build:netblock && npm run build:firefox --workspace @blur/netblock
npm run guards                # built-manifest checks (no <all_urls> at install, no DNR feedback, `debugger` only where allowlisted, no network CSP)
npm run e2e:netblock-logic    # Node tests over the real .ts modules (model, schema, counters, log)
npm run e2e:netblock-dnr      # DNR translation / reconcile / reactive rules (Node)
npm run e2e:netblock-page     # page-engine decision layer (Node)
npm run e2e:netblock-debugger # debugger engine against a fake CDP (Node)
npm run e2e:netblock-webrequest # Firefox engine: matching / state / glue (Node)
npm run e2e:netblock-ui       # popup + tool page in a real Chromium (after build:netblock)
# live, outside the default chain (need the built output; all offline):
npm run e2e:netblock-dnr-live · e2e:netblock-page-live · e2e:netblock-debugger-live   # Chromium via Playwright
npm run e2e:netblock-webrequest-live                                                    # installed Firefox via web-ext + Marionette
```

Implementation notes (what each engine does, its limits, live-measured
facts): [`IMPLEMENTATION.md`](./IMPLEMENTATION.md). Design:
[`docs/design/netblock.md`](../../docs/design/netblock.md). Store copy and
permission justifications: [`STORE.md`](../../STORE.md); privacy policy:
[`PRIVACY.md`](../../PRIVACY.md); pre-submission audit:
[`docs/audit/2026-09-15-netblock.md`](../../docs/audit/2026-09-15-netblock.md).

## Surfaces

- **Popup** (toolbar icon) — this tab only: "Enable on <host>" (Chrome asks for
  the site's data; a plain Block rule works without it), the rules active on
  this tab with their engine badge and counters, the **Network-level mode**
  switch for this tab (Chrome; behind a consent dialog that names the
  browser's debugging banner and the slowdown), pause/resume on the tab, and
  "Open the tool".
- **Tool page** (`tool.html`, also the browser's "Extension options"):
  - **Rules** — split view; groups, priority order (drag or `Alt+↑↓`), and the
    editor: URL condition (contains / equals / wildcard / regex), method,
    resource type, page domain, response status/headers; state (every time,
    once, first N, N-th, skip-first, probability with seed, time window, after
    another rule); action (block, network error, delay, status with optional
    body); scope; "Test URL". The engine badge is recomputed on every edit.
  - **Log** — the extension's own request log for this browser session: tab,
    URL and type filters, "only applied", pause, clear, HAR export (without
    bodies), and "create rule from request" on any row.
  - **Settings** — theme, language (EN/RU/ET), log size, query-string masking,
    page-engine toggle, export/import of rules as JSON (with a validation
    preview), reset counters, delete all rules, the list of sites with access.

## Engines and honesty notes

A rule runs on the cheapest engine that can honour it; the badge says which,
and the UI says what that engine cannot do:

- `dnr` (Chrome `declarativeNetRequest`) — stateless block; works without site
  access; the hit counter is **approximate** (`≈`) because the browser does
  not report which rule blocked a request.
- `page` (in-page fetch/XHR interceptor, only on sites you enabled) — exact
  counters, delays, status codes and bodies for fetch/XHR only; DevTools shows
  the real response, the application sees the substituted one (`✱`).
- `dbg` (Network-level mode via `chrome.debugger` + CDP `Fetch`) — real status
  codes, chosen network-error reasons, every resource type the Fetch domain can
  pause (not WebSocket, not worker-initiated requests). **Opt-in per tab**: the
  permission is install-time because Chromium refuses to make `debugger`
  optional, but nothing attaches until you switch the mode on for a tab in the
  popup; rules that need it are shown as inactive ("needs Network-level mode")
  on tabs where it is off. Chrome shows its yellow "started debugging this
  browser" banner while attached; the banner's Cancel button turns the mode off.
  The engine only sends `Fetch.enable/disable/continueRequest/failRequest/
  fulfillRequest` (+ `Page.getFrameTree`/`Page.enable` for the tab's host) and
  never reads bodies.
- `wr` (Firefox blocking `webRequest`) — one engine for every condition;
  Firefox cannot choose a network-error type or change a status code, so those
  actions degrade to a cancel and the badge reads `wr↓`.

Also stated in the UI: counters reset when the browser restarts; reactive
rules (`after rule`, `window`, `skip first`) on `dnr` can miss requests sent in
parallel with the trigger; a `status` below 400 is a mock, not a failure (the
tool allows it but says so); the same probability seed reproduces the same
sequence only for the same request order; without site access there is no
log for that site.

## Permissions

**Chrome, at install:** `storage` (rules, prefs, session-only counters and
log), `activeTab` (learn the host of the current tab), `alarms` (watchdog that
releases any request a broken handler could leave hanging), `scripting`
(register the in-page interceptor on sites you enabled), `webRequest`
(observation only: response status for the log, `ERR_BLOCKED_BY_CLIENT` for
the approximate counter), `declarativeNetRequest` (the block engine — the
reason for Chrome's "block content on any page" warning), `debugger`
(Network-level mode — the reason for the "access the page debugger backend"
and "read and change all your data on all websites" warnings; see the engine
note above for why it cannot be optional and how it is gated). The
per-permission rationale a reviewer reads is the header of
[`wxt.config.ts`](./wxt.config.ts).

**Chrome, on request:** host access per site, from the popup's "Enable on
<host>" button. Never at install.

**Firefox, at install:** `storage`, `activeTab`, `alarms`, `webRequest`,
`webRequestBlocking`, `<all_urls>` (the only way to cancel a request in
Firefox).

## Data handling

Zero network: the extension pages' CSP carries `connect-src 'none'`. Rules live
in `storage.local`, preferences in `storage.sync`, counters and the request log
in `storage.session` (RAM — never written to disk; `Authorization`,
`Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key` and `X-Auth-Token`
headers are always masked; bodies are never captured). No analytics, no
telemetry, no remote code. Detectability is stated honestly: the page engine
replaces `window.fetch` and `XMLHttpRequest` on enabled sites and does not fake
their `toString`, so a page can tell the interceptor is present.

Trust boundaries: the background accepts privileged messages (rules, log,
Network-level mode) only from the extension's own pages; reports from the
in-page interceptor are untrusted input and are validated and bounded
(`sanitizePageEvents`); every change to the rules document is validated as a
whole before it is written (`utils/rules-commit.ts`); a substituted response
in Network-level mode carries `nosniff` + `Content-Security-Policy: sandbox`.
