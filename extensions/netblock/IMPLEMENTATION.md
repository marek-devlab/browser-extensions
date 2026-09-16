# Request Blocker (netblock) — implementation notes

Single purpose: "block, fail and delay network requests for frontend
resilience testing." Written against `docs/design/netblock.md` (v1.1),
`docs/research/2026-09-15-netblock.md` and the spikes in
`e2e/netblock-spikes/REPORT.md`. Phase-1 plan (Russian, with sources):
`docs/plans/netblock/01-foundation.md`.

## What exists after phase 1

- **Manifest** (`wxt.config.ts`) for both targets with the reviewer-facing
  rationale for every permission, `options_ui → tool.html#/settings`,
  `connect-src 'none'`, Firefox `gecko.id`, `strict_min_version 140`,
  `data_collection_permissions: none`, `gecko_android`. The runtime content
  scripts' `<all_urls>` is stripped from the Chrome manifest in
  `build:manifestGenerated`; `npm run guards` verifies the built manifests.
- **Core model** (`utils/`, pure TS, Node-testable):
  - `rule-types.ts` — `Rule`, `RuleGroup`, `Condition`, `State`, `Action`,
    `RulesDocument`, failure reasons (CDP `Network.ErrorReason` subset),
    body content-type allowlist, `LIMITS`.
  - `rule-schema.ts` — strict validator (`validateRule`,
    `validateRulesDocument`, `parseRulesImport`): unknown keys are errors,
    `__proto__`/`constructor`/`prototype` are refused, size limits enforced,
    regexes go through `checkRegexSafety` (`@blur/netcore`).
  - `resource-types.ts` — our names ↔ DNR ↔ Firefox webRequest ↔ CDP.
  - `status-match.ts` — `5xx` / `503` / `429,500-599` → predicate.
  - `engine-select.ts` — `selectEngine()` decision table + `compileRules()`;
    every decision carries the design-§6 honesty keys.
  - `state.ts` — pure counters: `decide()`, `countKeyOf()`, `openWindow()`,
    `markMatched()`, resets; mulberry32 PRNG seeded per rule+key.
  - `log.ts` — ring buffer (entry + 4 MB caps), header masking
    (`Authorization`/`Cookie`… always `•••`), query stripping, HAR 1.2 without
    bodies.
  - `protocol.ts` — typed UI ↔ background messages, relay/page bridge types.
  - `i18n.ts` — EN/RU catalog (+ ET seeded from EN), `honesty.*` strings.
  - `storage.ts` — WXT `defineItem`s (`local:rules`, `sync:prefs`,
    `session:state|log|pausedTabs|nlTabs|restartNotice`) + `withLock` /
    `updateState` / `updateRules` (Web Locks RMW).
  - `prefs.ts` — single-writer React hook for `sync:prefs` (theme + locale).
- **Engines** (`utils/engines/`): the `Engine` contract (`types.ts`),
  `createEngines()` (`index.ts`) and four **stubs** (`dnr`, `page`,
  `debugger`, `webrequest`) that honour the contract and carry the phase-2
  TODO list in their headers (all four are now implemented — see below).
- **Background** (`entrypoints/background.ts`): loads + validates rules,
  compiles, applies to every engine (fail-open), routes every protocol
  message, tab lifecycle (`onRemoved` → resume/forget, `onUpdated(loading)`
  → navigation resets + window triggers), restart notice, watchdog alarm
  (30 s), startup cleanup of orphaned `tabIds` session rules.
- **Content scripts**: `relay.content.ts` (ISOLATED, nonce handshake, event
  forwarding) and `netblock-page.content.ts` (MAIN, re-injection guard, command
  listener) — both `registration: 'runtime'`, both stubs.
- **UI shells**: popup and tool page render with `@blur/ui` theme + i18n and
  talk to the background (`getTabSummary`, `listRules`). Placeholders only.
- **Tests**: `npm run e2e:netblock-logic` (42 checks, Node, real `.ts`).

## The Engine contract

```ts
interface Engine {
  readonly id: 'dnr' | 'page' | 'debugger' | 'webrequest';
  readonly available: boolean;                 // API + permission exist here
  supports(rule: Rule): boolean;               // selectEngine(...).engine === id
  apply(set: CompiledRuleSet): Promise<void>;  // idempotent, total for this engine
  pauseTab(tabId: number): Promise<void>;
  resumeTab(tabId: number): Promise<void>;
  dispose(): Promise<void>;                    // idempotent; called from finally
  onEvent(cb: (e: EngineEvent) => void): () => void;
}
// EngineEvent: log | hit | matched | error | detached
// CompiledRuleSet: { byEngine: Record<EngineId, CompiledRule[]>, inactive, compiledAt }
// CompiledRule:    { rule, engine, reasons: HonestyKey[], degraded?: HonestyKey }
```

Rules of the road: fail-open (never leave a request hanging, never block by
accident), the background owns counters/log/UI, engines only emit events.

## Decisions that differ from the design (see plan §1)

1. **`debugger` is an install-time permission of the Chrome build** (owner
   decision, 2026-09-15; supersedes the phase-1 "ship without it"). Chromium
   marks `debugger` `kFlagCannotBeOptional`: `optional_permissions:
   ['debugger']` is dropped with an install warning and `permissions.request`
   rejects, so the design's optional shape cannot exist. Network-level mode is
   still **opt-in per tab** at runtime: nothing attaches until the user toggles
   it in the popup (consent dialog §2.7); everything detaches on toggle-off,
   tab close, the banner's Cancel, enterprise policy, three handler errors and
   `dispose()` (design §11 "never always-on" holds). Price: the install warning
   "Access the page debugger backend" + "Read and change all your data on all
   websites". Reviewer rationale lives in the `wxt.config.ts` header; the
   guard allowlist is `BASELINE_DEBUGGER_ALLOWED.netblock` in
   `scripts/check-guards.mjs`. `caps.debugger` is true whenever
   `chrome.debugger` exists; the phase-1 degradations (`nlUnavailableBuild`,
   `failReasonImitated`) stay for builds without the permission. Firefox is
   untouched (no `debugger` in its manifest, no `.debugger.` in its bundle).
   ⚠️ `perf` has the same latent problem (`optional_permissions: ['debugger']`
   is silently dropped by Chrome) — not touched, separate decision.
2. **`activeTab` added** (no warning): without it the popup cannot learn the
   host to offer "Enable on <host>"; the design relies on it (§1.2) but omits
   it from the §0 table.
3. **CSP is `connect-src 'none'`** (mechanical zero-network, like capture/
   compose) rather than "no connect-src"; the guard accepts `'none'`.

## What phase-2 agents implement

| Agent | Files | Work |
|---|---|---|
| dnr | **done** — see "DNR engine (done)" below | — |
| debugger | **done** — see "Debugger engine (done)" below | — |
| page | **done** — see "Page engine (done)" below | — |
| webrequest | **done** — see "webRequest engine (done)" below | — |
| UI | **done** — see "UI (done)" below | — |

## DNR engine (done)

Plan (Russian, with sources): `docs/plans/netblock/02-dnr.md`. Chrome only.

- **Files**: `utils/engines/dnr-translate.ts` (pure: id scheme, rule
  translation, `desiredRules`, `planSessionUpdate`, reactive reducer
  `reactiveStep`, `recoverReactive`, `requestMatchesRule`, error hints),
  `utils/engines/dnr.ts` (`DnrEngine` = `Engine` + `onTrigger`, `activeFor`,
  `report`; no `#imports`, browser APIs via `globalThis.chrome`),
  `utils/dnr-counters.ts` (≈ counters over `webRequest`). Background hooks:
  `startDnrCounters`, `onTrigger` from hit/matched events, `tabs.onUpdated`,
  `tabs.onActivated`, `tabs.onRemoved`, the watchdog alarm, `resetCounters`,
  `openWindowTrigger`; `needsSite` for observation-armed rules.
- **What it does**: every `block` rule on the dnr slice becomes ONE session
  rule (`urlFilter` for contains/equals/wildcard, `regexFilter` for regex or
  when the value carries `*`/`|`/`^`; `requestMethods`, `resourceTypes`,
  `initiatorDomains`, `responseHeaders` when `RuleConditionKeys` says so).
  Scope `activeTab` = the active tab of each window (`tabIds`, follows
  `tabs.onActivated`). Everything is **session** rules — dynamic rules are
  never used (fail-open: they die with the browser and with an update). Ids are
  positional (`1 + index·128 + slot`, pause `2^29 + slot`); `apply` diffs the
  desired set against the browser's and sends one atomic
  `updateSessionRules`; a rejection blames the rule Chrome names and retries
  without it (browser message verbatim + `hint` for i18n `dnrError.<hint>`).
  Regexes are pre-checked with `isRegexSupported`. Pause = one `allow` rule
  per tab (priority 1 000 000; ⚠️ 2^29+ loses in Chromium 153, measured).
  Reactive `afterRule` / `window` / `skipFirst` install per-tab / per-URL /
  global instances on triggers; instances are recovered from
  `getSessionRules()` after a worker restart (`window` ones are dropped).
- **Limits / honesty**: counters are ≈ and exist only on granted origins
  (`webRequest` needs host access; `activeTab` grants count); `afterRule` and
  `skipFirst` are armed by that observation, so they show `siteNotEnabled`
  without it. With A itself blocked, a B fired within ~10 ms of A's rejection
  slips (live: 0 ms 0/3, 10 ms 3/3, 30 ms 3/3) — `reactiveParallelSlip`. Log
  rows: ≈ hits AND (since phase 3) a plain `passed`/`error` row for every
  observed page request on a granted origin — `dnr-counters.ts` is the Chrome
  log source of design §2.5 (see "Integration"). Other extensions' requests
  (tabId −1) are not excluded for scope `all`.
- **Tests**: `npm run e2e:netblock-dnr` (24 Node checks on the pure module);
  `npm run e2e:netblock-dnr-live` (15 checks, Chromium via Playwright, offline;
  the built extension is copied with `host_permissions` for the fixture origin
  because the real `permissions.request` prompt cannot be pressed by
  automation).

## Page engine (done)

Plan (Russian, with sources): `docs/plans/netblock/02-page.md`. Chrome only.

- **Files**: `utils/page-core.ts` (pure decision layer: `describeFetch`,
  `matchesStatic`/`matchesResponse`, `decideRequest`, `PageMirror`,
  `mergeSnapshot`, `interceptFetch`), `utils/page-registration.ts`
  (`reconcileRegistration` / `unregisterAll`), `utils/engines/page.ts`
  (`PageEngine`: `configure`, `handleRelay`, `resetCounters` on top of the
  `Engine` contract), `entrypoints/netblock-page.content.ts` (MAIN),
  `entrypoints/relay.content.ts` (ISOLATED). No `#imports` outside the two
  content scripts, so everything loads in Node (`npm run e2e:netblock-page`).
- **Registration**: ids `netblock-relay` + `netblock-page`,
  `matches = permissions.getAll().origins` (http(s)/`<all_urls>` only),
  `document_start`, `allFrames`, `persistAcrossSessions`,
  `matchOriginAsFallback` (retry without on old Chrome). Reconciled on every
  `apply()`, on `permissions.onAdded/onRemoved`, on `siteAccessChanged`;
  `dispose()` unregisters. Nothing registers on Firefox (engine not created).
  ⚠️ The MAIN entrypoint is `netblock-page.content.ts`, not `page.content.ts`:
  WXT names the IIFE after the file and `var page` in the page's global scope
  collides with any site that declares `page` (SyntaxError).
- **Bridge**: `relay:ready` → reply `page:rules {rules, paused, state, tabId,
  activeTabId}`; background → relays `page:state` (cross-tab counter delta),
  `page:pause`, `page:reset {ruleId?}` via `tabs.sendMessage` (all frames);
  page → background `relay:event` with `hit {key, counter, applied}`,
  `window {key, counter}`, `log {…, error?}`; relay queues + retries (2 s)
  while the worker is asleep. Nonce in `data-blur-netblock-nonce`,
  `event.source === window`, postMessage target `'/'`.
- **Counters**: background is the source of truth (`session:state`); the page
  mirror decides synchronously and reports; the background merges with
  `mergeSnapshot` ("larger `seen` wins") and fans out to other tabs. A fresh
  top-level document applies `resetForNavigation` + `window(navigation)` itself
  (idempotent with `tabs.onUpdated`). Click windows open in-page.
- **Actions**: `block`/`fail` → `TypeError('Failed to fetch')` / XHR
  `readystatechange(4)→error→loadend` (sync XHR: `NetworkError`), no request
  sent; `delay` → `sleep` (abort-aware) then the real call (sync XHR: skipped,
  logged); `status` → the real request GOES OUT (design §6.2), the app gets
  `new Response(body, {status, 'content-type', nosniff})` / XHR instance
  overrides honouring `responseType` (`json`/`arraybuffer`/`blob`/`document`),
  `responseText` throwing `InvalidStateError` like the real one; 1xx →
  fail-open. Response conditions: one lazy real request, then the walk resumes.
- **Log**: only applied actions, `engine: 'page'`, `type: 'xhr'`,
  `marks: ['clientSide']` (✱); `fail` rows carry `error: <reason>` while the
  rule is `degraded: 'failReasonImitated'` (page↓).
- **Out of scope (honest)**: `sendBeacon`, `EventSource`, `WebSocket`,
  navigations, static resources, worker requests, requests before injection.
- **Tests**: `npm run e2e:netblock-page` (25 Node checks, in the `e2e` chain);
  `npm run e2e:netblock-page-live` (28 live checks, Chromium, offline; the test
  copy of the manifest declares the fixture origin under `host_permissions`
  because the real `permissions.request` prompt cannot be pressed by
  automation — documented in the file header).

## webRequest engine (done)

Plan (Russian, with sources): `docs/plans/netblock/02-webrequest.md`. Firefox
only (desktop + Android), the ONE engine there — every rule resolves to it.

- **Files**: `utils/webrequest-eval.ts` (pure: `isPageTraffic`, `stageOf`,
  `ruleMatches`, `evaluateRequest`, `responseFor`, `typesFilterFor`,
  `mergeDeltas`), `utils/webrequest-state.ts` (pure `StateCache`: base +
  pending-delta overlay, 200 ms cold read, write-through),
  `utils/engines/webrequest.ts` (glue to `browser.webRequest`/`browser.tabs`).
  The engine module never imports `#imports` or `../storage` statically —
  `engines/index.ts` is loaded by the Node tests — the browser comes from
  `globalThis` and `../storage` is a dynamic `import()` on the first `apply()`
  (Vite inlines it into the IIFE bundle: 0 `import(` in `background.js`).
- **Listeners** (registered in `apply()`, only while rules exist; removed in
  `dispose()`): `onBeforeRequest` `['blocking']` for request-stage rules
  (no response condition) and `onHeadersReceived` `['blocking']`
  (+ `'responseHeaders'` only when a header condition exists) for
  response-stage rules; both with `{ urls: ['<all_urls>'], types }` where
  `types` is the union of the rules' Firefox types (dropped when a rule has no
  type restriction). Re-registered only when the filter changes.
  `onCompleted`/`onErrorOccurred` (non-blocking, all types) produce ONE log
  row per request and release parked delays. Stages are independent: a
  request-stage rule acts before the network, a response-stage rule on the
  answer; priority is first-match within a stage (plan §1.2).
- **Matching**: URL via `@blur/netcore`, method, type via `fromFirefoxType`
  (`xmlhttprequest`/`json` → xhr, `imageset` → image, `beacon`/`speculative`… →
  other), page domain = host of `originUrl ?? documentUrl` (suffix match),
  status via `statusMatches(details.statusCode)`, headers exists/equals/
  contains (case-insensitive). `scope: 'activeTab'` = the active tab of each
  window (`tabs.query({active:true})` + `tabs.onActivated`) — the `Rule` has
  no tab id, so this is the reading the engine takes; UI/dnr should share it.
  A matched-but-not-applied rule (nth/once/window…) is transparent: it counts
  and the next rule is asked. Only page traffic is touched: http(s)/ws(s),
  not initiated by `moz-extension:`/`about:`; `tabId === -1` requests count
  only with a web `originUrl` (service workers) and are never logged.
- **Actions → BlockingResponse**: `block` → `{cancel:true}` (sync);
  `fail(reason)` → `{cancel:true}` + `degraded: 'ffFailCancel'`; `status` →
  `{cancel:true}` + `degraded: 'ffStatusCancel'` (spike S2: `redirectUrl` is
  always a 200 — not used at all, nothing is ever redirected or rewritten);
  `delay ms` → a Promise resolved with `{}` after `ms` (`onErrorOccurred` and
  `dispose()` release it early; live: 800 → 830 ms). The listener answers
  synchronously except for delays and the first request after start.
- **State**: in-memory mirror of `session:state`. First decision waits
  `Promise.race([stateItem.getValue(), 200 ms])`; on timeout the mirror starts
  empty, an `error` event says so, and the request proceeds (fail-open). Every
  decision's changed counters are written through with `updateState`
  (Web Lock) fire-and-forget; the pending deltas overlay the base until
  acknowledged, so echoes and background resets never roll a counter back
  (`StateCache.setBase` also ignores a notification older than the last
  acknowledged `seen` for a key, ≤ 10 s). Background resets
  (`resetForNavigation`, `resetCounters`, `forgetTab`, `openWindow`) arrive
  through `stateItem.watch` — no `background.ts` edits were needed. Known
  race: a reset landing between a decision and its write resurrects that one
  key (one storage round-trip).
- **Events** (UI-facing): `hit {ruleId, tabId, url, approx:false, degraded?}`
  — `degraded` (`HonestyKey`) is the `wr↓` flag, new optional field on the
  contract; `log` rows: `blocked` (block, or status↓ with `marks:['degraded']`),
  `failed` (fail↓, `marks:['degraded']`), `delayed` (+`delayMs`, real
  `status`), `passed` (+`status`), `error` (browser's `error` string);
  `engine: 'webrequest'` + `ruleId` only when a rule was involved. New
  `LogMark` `'degraded'` (glyph `↓`) in `log.ts`. `logStripQuery` is applied
  by the background (`pushLog`). Rows are batched by the background since
  phase 3 (one `session:log` RMW per ≤ 250 ms / 50 rows — see "Integration").
- **Firefox facts that shaped it**: the built MV2 background has no
  `persistent` key → persistent page, so the cold read happens once per
  process. If it ever becomes an event page, the blocking listeners must be
  registered synchronously at top level (MDN), not in `apply()`.
- **Android**: same code path (blocking webRequest, `tabs.onActivated`, no
  `windows` use). The OS may kill the extension process; counters live in
  `session:state` and are re-read on the next start. No blocking listener is
  registered while there are no rules; the non-blocking observer
  (`onCompleted`/`onErrorOccurred`, the log source) is registered from the
  first `apply()` on. Popup = overlay from the Add-ons menu; the tool page opens in a
  tab. Not live-tested on a device.
- **Tests**: `npm run e2e:netblock-webrequest` (20 Node checks on the real
  `.ts`, in the `e2e` chain: priority, transparency, type mapping, page domain,
  headers stage, degradation table, pause, tabId −1, cold-read timeout with
  fake timers, overlay/echo, engine glue against a fake `browser`);
  `npm run e2e:netblock-webrequest-live` (19 checks: real `.output/firefox-mv2`
  in the installed Firefox via `web-ext-run` + Marionette, offline fixture
  server; a–e of the brief plus log rows and written-through counters). The
  live harness drives the extension through its own tool page —
  `importRules`/`pauseTab`/`getLogPage` — opened with `gBrowser.addTab` from
  Marionette's chrome context (`--remote-allow-system-access`), because
  WebDriver navigation to `moz-extension://` is refused in Firefox ≥ 153
  (BiDi and classic alike) and Marionette's content sandbox hides `browser`
  behind Xrays (`window.wrappedJSObject` in the system sandbox instead).

## UI (done)

Plan (Russian, with sources): `docs/plans/netblock/02-ui.md`. Surfaces:

- **Popup** (`entrypoints/popup/App.tsx`, 320 px): design §2.1 (site not
  enabled → "Enable on <host>", `permissions.request({origins})` called
  synchronously in the click handler), §2.2 (rules on this tab with the
  engine badge, `2/3 ↻` state counters, `≈` on DNR counts, `—` without site
  access, inactive rules with the reason in words), §2.3 + §2.7 (Network-level
  block with "Intercepted N · rules applied M" from `TabSummary.nl`, and the
  `<dialog>` consent — the dialog IS the gate: `debugger` is install-time, so
  the popup checks `permissions.contains` and never calls `permissions.request`
  for it; rendered ONLY when the background reports `networkLevelAvailable`), pause/resume on
  the tab, "Open the tool" → `tool.html#/rules?tab=<id>`, restart notice
  (§5.6), theme control, offline footer. Polls `getTabSummary` every second.
- **Tool page** (`entrypoints/tool/`): hash router (`router.ts`: `#/rules`,
  `#/rules/new[?preset=]`, `#/rules/:id`, `#/log`, `#/settings`, `?tab=`).
  - `pages/RulesPage.tsx` + `RuleList.tsx` + `RuleEditor.tsx` — §2.4 split
    view (single column < 720 px, §2.9), groups with toggles/rename/delete,
    drag reorder + `Alt+↑↓`, `role="listbox"` with roving tabindex, the form
    with Condition / State / Action / Scope / Test URL, live engine badge via
    `selectEngine()` on every edit, §2.8 card with "Replace with Block",
    §5.2 "applying…" until the background answers, §5.7 browser error verbatim
    + translation (`utils/error-translate.ts`), §5.8 caps, §6.12 2xx hint,
    64 KB body cap + content-type allowlist, `Ctrl/⌘+S`. Empty state §5.1 with
    three presets that pre-fill the editor (`utils/rule-presets.ts`).
  - `pages/LogPage.tsx` — §2.5 `role="grid"`, tab/url/type/"only applied"
    filters, pause/clear, HAR export (`utils/download.ts`: Blob + `<a download>`,
    no `downloads` permission), row menu (block URL · rule from request · copy ·
    hide domain), marks `✱ ≈ ○` + legend, §5.3 no-access line, eviction count.
    Feed = `log:append` pushes + `getLogPage` cursor polling at 1 s while the
    log page is visible (`utils/use-log-feed.ts`).
  - `pages/SettingsPage.tsx` — §2.6 incl. §4.5 import preview (error table from
    `parseRulesImport`, "Import valid (N)"), two-step delete-all, access list
    from `permissions.getAll()` with remove, NL status (gated), §6.10 line.
- **Shared** (`utils/`): `messaging.ts` (typed `sendQuery` + push subscription),
  `use-rules.ts` (single writer for the rules document), `use-caps.ts`
  (`getCaps` → platform + `EngineCaps` for the live badge — the background's
  effective caps, re-read on every `rules:applied` push), `engine-badge.tsx` (text + glyph badge, honesty
  list), `rule-summary.ts`.
- **i18n**: EN/RU/ET complete (`utils/i18n.ts`; Estonian is a real
  translation). Not translated on purpose: engine badges, marks, HTTP
  methods/codes, CDP reasons, API names.
- **Protocol additions** (`utils/protocol.ts`, additive): `getCaps` →
  `CapsReply`; `testUrl` gained optional `resourceType` / `pageDomain`.
  `background.ts`: `testUrl` now filters by method / type / page domain (via
  `@blur/netcore` `matchesSuffix`), sorted by priority; `getCaps` handler.
- **Tests**: `npm run e2e:netblock-ui` — `e2e/netblock/ui.spec.ts` (10 checks,
  Playwright + built Chrome extension): empty state + preset, dnr/page badges
  after save, live badge change on response status + 2xx hint, `Alt+↓`
  reorder persisted, bad-JSON import preview → only valid imported, settings
  persist across reload, seeded `session:log` rows with marks + "rule from
  request", RU/ET switch, popup on a restricted page without the NL block,
  zero console errors.

Design-§6 honesty coverage (where each note is shown):

| § | Where |
|---|---|
| 6.1 | popup `≈N` + line under the list; log `≈` + legend; editor honesty list under a `dnr` badge |
| 6.2 | log `✱` + legend; editor honesty list under a `page` badge (`pageNotNetwork`, `pageOnlyXhr`) |
| 6.3 | editor "Response headers" subsection (`dnrHeadersHalfBlock`; `dnrHeadersUnsupported` when the browser lacks `RuleConditionKeys`) |
| 6.4 | popup `<dialog>` before enabling; `nl:detached` toast (tool page, `aria-live="assertive"`) |
| 6.5 | popup NL block + `<dialog>` (`nlSlowsTab`) |
| 6.6 | Firefox: `wr↓` badge + `ffFailCancel` / `ffStatusCancel` in the editor and list |
| 6.7 | popup restart notice (§5.6) + editor State section hint |
| 6.8 | editor honesty list (`reactiveParallelSlip`) for reactive rules on `dnr` |
| 6.9 | log empty state on Chrome without granted origins; popup `—` counters without access |
| 6.10 | Settings callout + line under the rule list + empty state |
| 6.11 | editor seed field (`seedSameOrder`) |
| 6.12 | editor hint when the status code is < 400 (does not block saving) |

Deviations: the language control is `@blur/ui`'s EN/RU/ET segmented switcher
(house default EN, no "Auto"); the response-headers subsection stays enabled
when `RuleConditionKeys` is missing because `engine-select` still routes such
rules to the page engine — the note explains it instead of disabling. (Two
phase-2 gaps — the page domain in "create rule from request" and the §2.3 NL
counters — were closed in phase 3, see "Integration".)

## Debugger engine (done)

Plan (Russian, with sources): `docs/plans/netblock/02-debugger.md`. Chrome
only — "Network-level mode" (NL), `chrome.debugger` + CDP `Fetch`.

- **Files**: `utils/debugger-eval.ts` (pure: `fetchPatternsFor`,
  `urlPatternFor`, `stageOfRule`/`stageOfEvent`, `ruleMatches`,
  `evaluatePaused`, `commandFor`/`fulfillHeaders`, `patternsCover`,
  `stalled`, `nextErrorCount`, `FETCH_FILTER_TYPES`), `utils/engines/debugger.ts`
  (`DebuggerEngine` = `Engine` + `configure`, `enableTab`, `disableTab`,
  `isAttached`, `attachedTabs`, `stats`, `tick`; `asDebuggerEngine`). The
  engine module has NO browser globals and no `.debugger.` reference:
  `chrome.debugger`, `chrome.tabs`, the state store, `session:nlTabs`, prefs
  and `isPaused` are injected by the background under
  `!import.meta.env.FIREFOX` (so the Firefox bundle stays clean and the Node
  tests drive it with a fake CDP). Sessions go through `@blur/netcore`
  `attachCdp` (per-tab routing, `onDetach` reason, idempotent detach, browser
  error text verbatim). Background hook lines: `configure(...)`,
  `setNetworkLevel` → `enableTab`/`disableTab` (`{ok, error?}` with the
  browser's message), `tabs.onRemoved` → `disableTab`, watchdog alarm →
  `tick()`, `tabSummary` → `stats(tabId)` (`networkLevel`, new optional
  `TabSummary.nl {attached, intercepted, applied, lastDetachReason?}`;
  debugger rules are `active` only while attached, reason
  `needsNetworkLevel` otherwise); `detached` events → `nlTabsItem` cleared +
  `nl:detached` push (phase-1 code).
- **Lifecycle**: `enableTab` = attach `1.3` → `Page.getFrameTree` (page host
  for `pageDomains` — `tabs.get().url` is hidden without host access) +
  `Page.enable`/`frameNavigated` to keep it current → `Fetch.enable` with the
  rules' patterns (or `Fetch.disable` when the slice is empty — an empty
  `patterns` array means "everything" to Chrome) → `nlTabs += id`. `apply()`
  recomputes the patterns and re-enables on every attached tab (idempotent
  via a per-tab key). `disableTab` releases every paused request, `Fetch.disable`,
  detach, `nlTabs -= id` (no `detached` event — the user asked). Browser
  detach (`canceled_by_user`, `target_closed`, policy) → `detached {reason}`;
  three consecutive handler errors → own detach with reason
  `handler errors (3 in a row)`. Startup reconcile on the first `apply()`:
  ids left in `session:nlTabs` by a dead worker are dropped, or re-attached
  when `prefs.nlSticky`; with `nlSticky` a `tabs.onUpdated(loading)` for a
  tab in `nlTabs` that lost its session re-attaches too (never after
  `canceled_by_user`). `dispose()` detaches everything in `finally`.
- **Patterns**: one `Fetch.RequestPattern` per (url glob × CDP type × stage),
  stage `Response` only for rules with `responseStatus`/`responseHeaders`.
  The glob is a PRE-FILTER only (the JS matcher decides): CDP's matcher is
  case-sensitive and our URL ops are case-insensitive by default, so a narrow
  glob is emitted only for `caseSensitive: true` (or letter-free values);
  otherwise `*` + resource type. ⚠️ The Fetch filter accepts only 12 of the 19
  `ResourceType`s (live, Chromium 149): `TextTrack`, `Prefetch`, `WebSocket`,
  `Manifest`, `SignedExchange`, `Preflight`, `FedCM` are refused and are
  filtered out (`FETCH_FILTER_TYPES`) — a rule whose kinds map only to those
  is not intercepted.
- **Decisions** (`evaluatePaused`, mirrors the Firefox engine): first-match
  within a stage; a matched-but-not-applied rule (nth/once/…) is transparent;
  paused tabs and `Preflight` requests are continued untouched. Counters:
  `StateCache` from `webrequest-state.ts` (base + pending overlay, 200 ms cold
  read, write-through via `updateState` under the Web Lock, resets via
  `stateItem.watch`) — exact, `approx: false`. Actions: `block` →
  `Fetch.failRequest(BlockedByClient)`; `fail(reason)` → `failRequest(reason)`
  (CDP `Network.ErrorReason` verbatim); `delay` → abort-aware timer then
  `continueRequest` (released early by disable/detach/dispose/watchdog);
  `status` → `fulfillRequest` with `Content-Type; charset=utf-8`,
  `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, and
  `Access-Control-Allow-Origin` echoing the request's `Origin` (so a
  cross-origin page observes OUR status instead of a CORS error), body
  base64. Response-stage rules issue the same commands after seeing the real
  `responseStatusCode`/headers. `continueRequest` is used at both stages
  (`continueResponse` is experimental). `Fetch.getResponseBody` is never
  called.
- **Fail-open**: every handler ends in `finally` → `continueRequest` unless a
  command was sent; a refused `fulfillRequest`/`failRequest` (e.g. an odd
  status) is followed by a `continueRequest` + `error` event; the watchdog
  (`tick()`, alarm every 30 s) continues any request whose handler has been
  running > 20 s (parked delays up to `LIMITS.delayMs` are not stalls; a lost
  delay timer is) and logs `error: released hung request (watchdog)`.
- **Log**: one row per intercepted request, `engine: 'debugger'`, type via
  `fromCdpType`, no `clientSide` mark (this IS the network): `failed`
  (`error: <reason>`), `blocked`, `status` (our code), `delayed` (+`delayMs`),
  `passed` (real status at Response stage), `error` (real
  `responseErrorReason`). A request that a Response-stage pattern will also
  see is logged once, at the Response stage (`patternsCover`); response
  headers are attached only when a rule has a header condition (masking is
  `pushLog`'s job). Preflights are not logged.
- **Live facts** (Playwright Chromium 149, offline): `chrome.debugger.attach`
  works while Playwright's own CDP client is attached (spikes S1/S6 hold);
  `debugger.getTargets().attached` reports *any* debugger (Playwright,
  DevTools) so it cannot prove our detach — `sendCommand` failing with
  "Debugger is not attached" does; `permissions.request({permissions:
  ['debugger']})` on the install-time permission resolves `true` with no
  prompt; Chrome accepts `fulfillRequest` with status 101 (the refused-command
  path is Node-tested).
- **Tests**: `npm run e2e:netblock-debugger` (25 Node checks, in the `e2e`
  chain); `npm run e2e:netblock-debugger-live` (32 checks: the built
  extension loaded UNMODIFIED — NL needs no host access — scenarios a–g of the
  brief, log rows, counters write-through, detach/close/re-enable).

## Running

```
npm run typecheck                          # all workspaces
npm run build:netblock                     # Chrome MV3
npm run build:firefox --workspace @blur/netblock
npm run guards                             # built-manifest checks
npm run e2e:netblock-logic                 # Node logic tests (real .ts)
npm run e2e:netblock-dnr                   # DNR translation/reconcile/reactive (Node)
npm run e2e:netblock-dnr-live              # DNR engine, Chromium via Playwright (after build:netblock)
npm run e2e:netblock-page                  # page engine decision layer (Node)
npm run e2e:netblock-page-live             # page engine, Chromium via Playwright (after build:netblock)
npm run e2e:netblock-debugger              # debugger engine: patterns/decisions/glue against a fake CDP (Node)
npm run e2e:netblock-debugger-live         # debugger engine (NL mode), Chromium via Playwright (after build:netblock)
npm run e2e:netblock-webrequest            # Firefox engine: matching/state/glue (Node)
npm run e2e:netblock-webrequest-live       # Firefox engine, installed Firefox via web-ext-run + Marionette (after build:firefox)
npm run e2e:netblock-ui                    # popup + tool page, Chromium via Playwright (after build:netblock)
npm run e2e:netblock-integration           # design §4 flows + §8 end-to-end (real popup, fixture server; after build:netblock)
npm run e2e:netblock                       # both Playwright specs (this is what the root `e2e` chain runs)
npm run dev:netblock / dev:netblock:firefox
```

Manual-only checks (native permission prompt, `activeTab` on a real toolbar
click, the debugger infobar and its Cancel, a full browser restart):
`docs/netblock-headed-smoke.md`.

## Integration (phase 3, done)

Plan (Russian, with sources + scenario matrix): `docs/plans/netblock/03-integration.md`.
Test harness: `e2e/netblock/helpers.ts` (shared by `ui.spec.ts` and
`integration.spec.ts`) — a test copy of the manifest with
`host_permissions: ['http://127.0.0.1/*']` because the native
`permissions.request` prompt cannot be pressed by automation; the REAL popup is
opened with `chrome.action.openPopup()` and driven over a raw CDP WebSocket
(`--remote-debugging-port=0` → `DevToolsActivePort`), since Chrome does not
auto-attach Playwright to the popup target; the service worker is stopped with
CDP `ServiceWorker.stopAllWorkers` for the §8 scenario.

Defects fixed (letters = the phase-3 brief):

- **a** `relay:click` was never sent. `page:rules` now carries `wantsClicks`
  (true when any `dnr` rule uses `window(trigger:'click')`, computed in
  `engines/page.ts apply()`); `relay.content.ts` adds ONE capture+passive click
  listener only while that flag is set (removed when it clears), throttled to
  250 ms, and sends `relay:click` → background → `dnrEngine.onTrigger({click})`.
  Sites without such a rule have no listener at all.
- **b** `caps.page` ignored `prefs.pageEngineEnabled`. The background now sets
  `caps.page` from the pref at `init()` and in `prefsItem.watch` (then
  `applyAll()`), in place — the same object the engines and `getCaps` read, so
  compile, script registration and the editor's live badge agree; the UI no
  longer ANDs the pref itself and `useBuildCaps` re-reads `getCaps` on every
  `rules:applied` push.
- **c** `LogEntry.initiatorHost?` (host only, never a path/port): Chrome
  observation → `hostOf(details.initiator)`; page engine → the reporting
  frame's `location.hostname` (`relay:event.host`); debugger → the session's
  top-document host; Firefox → `hostOf(originUrl ?? documentUrl)`.
  `ruleFromLogEntry` pre-fills `pageDomains` with it (not for "Block this URL").
- **c′** Design §4.1 step 2 ("the log shows `POST /api/checkout 200`") had no
  Chrome source: `dnr-counters.ts` only logged ≈ blocks. It now logs a
  `passed` (+status) / `error` row for every observed request with
  `tabId ≥ 0` on a granted origin (design §2.5), skipping tabs in NL mode
  (`isObservedElsewhere` — the debugger engine logs those itself). A page-engine
  `status` substitution therefore shows as TWO rows, `503 ✱` (what the app saw)
  and `200` (what the network saw) — intended, the ✱ legend explains it.
- **d** The popup called `permissions.request({permissions:['debugger']})`,
  which resolves `true` without a prompt for an install-time permission; it is
  `permissions.contains` now and the §2.7 `<dialog>` is the gate. §2.3
  "Intercepted N · rules applied M" is rendered from `TabSummary.nl`.
- **e** i18n keys `nlReason.handlerErrors` and `logError.watchdog` (EN/RU/ET);
  the raw strings live once in `log.ts OWN_REASON` (used by the debugger engine)
  and `i18n.ts translateReason()` maps them in the `nl:detached` toast and the
  log's status column; the browser's own reasons stay verbatim.
- **f** Log batching in the background: `enqueueLog` coalesces rows for
  ≤ 250 ms (or 50 rows), one `withLock(LOG_LOCK)` RMW per batch with `pushLog`
  per row inside (ring-buffer caps, eviction count and monotonic ids — the UI
  cursor — unchanged), one `log:append` push per batch; forced flush before
  `getLogPage`, queued rows dropped on `clearLog`, best-effort flush on
  `runtime.onSuspend`. Resize/clear/append all take the same lock.
- **g** `scope: 'activeTab'` is "the active tab of each window" in all four
  engines now: the page engine used `tabs.query({active, lastFocusedWindow})`
  (idled a rule in a second window) and now reads the tab's own `active` flag
  (`tabs.get`). `pageDomains` is `matchesSuffix` on a lower-case hostname
  (no port) everywhere; the schema lower-cases the rule side. One documented
  difference: the debugger engine matches the tab's TOP document host, dnr and
  the page engine the requesting frame's origin.
- **h** DNR ≈ counters never grew: an approximate `hit` only marked the rule
  matched and `tabSummary` hid counters of `every` rules. `state.recordHit`
  now counts seen+hits under the rule key for approximate hits, and the popup
  shows counters for `every` rules too (`≈N` for dnr, plain hits for page).

Service-worker restart (design §8), per engine — verified by
`integration.spec.ts` §8 (worker stopped via CDP, woken by a message):

| Engine | What survives | What the fresh worker does |
|---|---|---|
| dnr | session rules (incl. pause `allow` rules and reactive instances) live in the browser | first `apply()` → `recover()` re-reads `getSessionRules()` + live tabs, re-learns paused tabs, drops `window` instances (expiry unknown → fail-open) and rules of dead tabs; `cleanupOrphanedSessionRules` at `init()` |
| page | registered content scripts (`persistAcrossSessions`), every page's mirror + queued events | `applyAll()` broadcasts `page:rules` (mirror merges, "larger `seen` wins"); relays retry queued events every 2 s — the first message wakes the worker |
| debugger | `session:nlTabs`; the CDP sessions do NOT (an attached session keeps the worker alive, Chrome 118+, so this only happens on a forced stop) | first `apply()` → `reconcile()`: ids without a session are dropped, or re-attached with `prefs.nlSticky` |
| webrequest (Firefox) | persistent background page — no restart short of a browser restart | `StateCache` cold-reads `session:state` once (≤ 200 ms budget) |
| counters / log | `session:state`, `session:log` | read on demand; the ≤ 250 ms log batch in flight at the kill is lost (documented) |

`dispose()` is not wired to `runtime.onSuspend` on purpose: MV3 gives no
reliable pre-termination hook, and every engine is built to be re-entered by
the next worker instance instead (table above).

## Audit fixes (phase 4, done)

Plan + findings (Russian): `docs/plans/netblock/04-audit.md`; status per
finding: `docs/audit/2026-09-15-netblock.md` → "Post-fix status".

- **Rules commit path** (`utils/rules-commit.ts`, `background.ts commitRules`):
  every mutation (`saveRule`, `deleteRule`, `saveGroup`, `deleteGroup`,
  `reorderRules`, `importRules`, `deleteAllRules`) starts from the validated
  projection of storage, applies the change and validates the WHOLE result
  (`afterRule` target exists, `groupId` exists, ≤ 200 regex, ≤ 2 000 rules,
  ≤ 2 MB serialised) before writing. A refused commit writes nothing and
  returns `RuleError[]`; `deleteRule` refuses when other rules follow the
  victim (`afterRule`) and the editor shows why. Invalid entries found in
  storage are reported in `applied.errors` (`stored …`) and dropped at the
  next successful commit. Import merges are no longer silently truncated.
- **Sender checks** (`protocol.ts isPrivilegedSender/isRelaySender`):
  privileged queries only from `runtime.getURL('/')` pages; `relay:*` only
  from a tab. Web pages cannot reach `runtime.onMessage` anyway (no
  `externally_connectable`) — defence in depth.
- **Page reports are untrusted** (`page-core.ts sanitizePageEvents`, used in
  `engines/page.ts handleRelay`): ≤ 500 events per message; `hit`/`window`
  only for rules the page was given, with the key in that rule's own
  `countKeyOf` shape (for `rule+tab`: the SENDER's tab); counters rebuilt
  field by field; log rows with a known outcome and bounded strings.
- **Fulfilled responses** (`debugger-eval.ts fulfillHeaders`): +
  `Content-Security-Policy: sandbox` — a `text/html` body answered to a
  navigation renders script-less and origin-less (design §7.1 intent; the
  header is ignored on subresources).
- **`resetOn: navigation` without host access** (`background.ts
  tabs.onUpdated`): `tab.url` is hidden without site access but
  `status: 'loading'` is not; the reset no longer requires the URL, so
  Network-level-mode tabs (which need no site access) reset on reload
  (live check (h) in `debugger.live.mjs`).
- **No unhandled rejections**: every fire-and-forget path in the background
  (`onEngineEvent`, `tabs.onRemoved/onUpdated`, `prefs.watch`, `ready`) ends
  in `noteFailure()` → `applied.errors` (`runtimeErrors`, last 10); popup and
  Settings catch their own `sendQuery`/`permissions.remove` rejections.
- **Copy** (`i18n.ts`, EN/RU/ET): NL description and consent dialog name the
  limit (not WebSocket, not worker requests) instead of promising "workers";
  `puNlUnavailable` no longer claims the permission is not asked at install;
  `nlDialogBreak` says dbg rules become inactive (they are not re-routed);
  `puBlockWorksWithout` excludes exact-counter rules; `settingsPageEngineHint`
  says such rules need NL mode; `engineDebuggerLong` "every resource type
  the protocol can pause (not WebSocket)". Settings: the dead "Revoke" button
  is gone — one honest line (`stNlInstallTime`).
- **Tests**: logic 42 → 46, page 25 → 27, debugger live 32 → 34 (reload
  reset + session survives).

Scenario matrix (`npm run e2e:netblock-integration`, 11 checks, all through the
real UI + the fixture journal): §4.1 rule from a log row (URL/POST/xhr/page
domain pre-filled) → nth 3 / 503 → 200,200,503, popup `2/3 ↻` → `3/3`, rows
`503 ✱` + real `200`; §4.2 dnr image block, server never reached, popup `≈1`,
block works without site access; §4.3 dbg rule inactive → consent dialog →
attach → TypeError on a real 500, NL stats, detach → real 500, tab close →
`nlTabs = []`; §4.4 seed 42 → identical delay pattern across two reloads;
§4.5 3 valid + 2 invalid import → indices + only valid imported, export
round-trips through `importRules`; afterRule B-after-A sequential + honesty
note; `window(click)` via the relay; the page-engine pref flips the compiled
engine and the live badge; pause/resume from the popup across engines; §8
worker restart; zero console errors. Not automatable (manual checklist in
`docs/netblock-headed-smoke.md`): the native site-access prompt, `activeTab`
on a real toolbar click (§2.1 / §6.9 `—`), the debugger infobar + Cancel, a
browser restart (§5.6).
