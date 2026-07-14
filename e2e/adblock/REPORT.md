# Ad & Tracker Blocker — live test report

Owner run covering PHASE 1 (live test) -> PHASE 2 (fix) -> PHASE 3 (features) ->
PHASE 4 (re-test). Numbers below are from re-running the harness against the
**rebuilt** extension.

## How to run

```bash
npm run build:rules   -w @blur/adblock    # regenerates public/rules/* (already built)
npm run compile       -w @blur/adblock    # tsc --noEmit, strict + noUncheckedIndexedAccess, no any
npm run build         -w @blur/adblock    # chrome-mv3
npm run build:firefox -w @blur/adblock    # firefox-mv2
node e2e/adblock/logic.test.mjs           # pure logic tests (Node TS type-stripping, no browser)
node e2e/adblock/harness.mjs              # live Chromium E2E (headed persistent context)
```

## Harness method (real, offline, deterministic)

- Loads the **real built** `.output/chrome-mv3` into a **headed** persistent
  Chromium context via `--load-extension` (Playwright `chromium` channel).
- One local **HTTPS** server (`server.mjs`) serves both the fixture pages and the
  sub-resources for hosts that appear in the bundled rules. Chromium
  `--host-resolver-rules` MAPs the blockable hosts AND the page hosts back to that
  server, so nothing touches the real internet. HTTPS + a self-signed cert +
  `--ignore-certificate-errors` are used because the site-specific cosmetic fixture
  must load as `youtube.com`, which is HSTS-preloaded (http is refused).
- **Network BLOCK** is detected as a Chromium DNR failure
  (`net::ERR_BLOCKED_BY_CLIENT`) - a blocked request never resolves, so it can
  never leak. **NOT-blocked** is the same request resolving to the local server
  (img fires `load`).
- **Cosmetic hiding** read from `getComputedStyle(el).display === 'none'`.
- Confirmed blockable hosts (whole-host `||host^` rules in the bundle):
  `buzzoola.com` (easylist), `mradx.net` (easyprivacy).
- Settings changes are driven through the **real options-page UI** (clicks), so
  the harness exercises storage -> background reconcile end to end.

Behaviors this harness genuinely can't drive are covered by **logic tests**
against the **real source modules** (imported via Node TS type-stripping): the
popup's "~"/"—" honesty formatting, the Firefox webRequest decision core,
custom-filter parsing, and backup validation. (The Chrome popup opened standalone
always sees itself as the active tab, so it can't display a web page's stats -
hence formatting is logic-tested and the exact cosmetic **badge** is tested live.)

## PHASE 1 baseline (before fixes) -> PHASE 4 (after fixes)

| #   | Assertion                                                    | Baseline | After fix | Root cause (fixed)                                                                   |
|-----|--------------------------------------------------------------|----------|-----------|--------------------------------------------------------------------------------------|
| T1  | Network request to a bundled host is blocked (standard)      | PASS     | PASS      | - (static rulesets ship enabled)                                                     |
| T2  | Cosmetic filtering hides a matching element (site-specific)  | PASS     | PASS      | -                                                                                    |
| T2b | Generic cosmetic gated to `aggressive` only                  | PASS     | PASS      | -                                                                                    |
| T3  | Allowlisting stops **both** network + cosmetic               | **FAIL** | PASS      | Background never reconciled the DNR backend on a UI settings change                  |
| T4  | Badge reflects cosmetic hides **exactly** (no `~`)           | **FAIL** | PASS      | Core engine counts via IntersectionObserver -> never counts display:none -> always 0 |
| T5  | Level `off` -> nothing blocked/hidden                        | **FAIL** | PASS      | Same as T3 - network stayed blocked after UI change                                  |
| T6  | Custom cosmetic filter (My filters UI) is applied            | new      | PASS      | Feature added                                                                        |
| T7  | Element picker hides + persists a per-site filter            | new      | PASS      | Feature added                                                                        |
| T8  | Per-site "disable cosmetic only" keeps network, stops hiding | new      | PASS      | Feature added                                                                        |
| T9  | Backup export -> import round-trips + applies                | new      | PASS      | Feature added                                                                        |

Live result after fixes: **10 / 10 PASS**.

### Logic tests (assertions 4 & 6, plus feature units) - 20 / 20 PASS

- **L1-L3** - assertion 4 honesty: `formatCount` shows `~N` only for approximate,
  `—` for unmeasurable (never a fake `0`), bare `N` for exact. Real
  `utils/format-count.ts` the popup renders with.
- **L4-L13** - assertion 6 (Firefox over-block fix): `decideRequest` / `parseRule`
  / `matchesSuffix` - `main_frame` is **never** cancelled, `@@` exceptions win over
  blocks, allowlisted page host blocks nothing, `tabId < 0` ignored, and a path
  rule (`||host/ads^`) is **skipped** not widened to a bare-domain block. Real
  `utils/backends/webrequest-match.ts` that `WebRequestBackend` now delegates to.
- **L14-L17** - custom-filter parsing/scoping (feature 6/2).
- **L18-L20** - backup validation of untrusted JSON (feature 4).

## PHASE 2 - fixes (file:line)

1. **UI settings changes never reached the network engine (T3, T5).**
   The popup/options persist via `settingsItem.setValue` (storage) and send **no**
   message; the background had **no** storage watcher, so DNR ruleset enablement
   and the per-site `allowAllRequests` allowlist rule were never reconciled after
   any UI change. Cosmetic filtering appeared to respond (the content script reads
   storage on the next load), masking that network blocking was frozen at whatever
   the service worker set at cold-start.
   **Fix:** `entrypoints/background.ts:81` `reconcileFromSettings` + `:91`
   `settingsItem.watch(...)` - diffs the allowlist and re-applies level/toggles on
   every settings change from any context. Verified: T3, T5, T9.

2. **Cosmetic hides always counted as 0 -> empty badge, aggregate never grew (T4).**
   `@blur/core` `DomRuleEngine` counts matched elements via an IntersectionObserver;
   a `display:none` element has no layout box, so it never reports `isIntersecting`,
   so `stats.hidden` stays 0 forever. `packages/core` is read-only, so the count is
   now computed in the content script: `entrypoints/content.ts:114` `recount()`
   counts **distinct** elements matched by the applicable hide selectors (via core's
   own `deepQuerySelectorAll`, which pierces shadow DOM), tracked in a `WeakSet` - an
   exact figure - while the engine still owns CSS injection + shadow traversal.
   Verified live: badge = "2" = exact DOM hidden count.

3. **Refactor for testability (no behavior change).** Firefox request-decision logic
   extracted into a pure, browser-free `utils/backends/webrequest-match.ts`
   (`decideRequest`, `parseRule`, `matchesSuffix`) that `webrequest.ts` delegates to,
   so the over-block fix (assertion 6) is unit-tested against shipping code. Likewise
   the popup's count formatting -> `utils/format-count.ts`, and backup validation ->
   `utils/backup-parse.ts`.

## PHASE 3 - features added

1. **Element picker** (`utils/element-picker.ts`, wired in `content.ts`): click an
   element -> a per-site `display:none` filter, from a stable-ish selector heuristic
   (`#id` -> `tag.class` -> `:nth-of-type` path), persisted to `local:customFilters`
   and applied live by the same `DomRuleEngine`. No new permission. Live: T7.
2. **Custom cosmetic-filter management UI** (options -> "My filters"): list / add /
   remove per-site selectors, plus text export. Live: T6; units L16-L17.
3. **Per-site "disable cosmetic only"** (`AdBlockSiteConfigX.disableCosmetic`, read
   in `content.ts`; popup toggle): keeps network blocking, stops hiding - distinct
   from the full allowlist. Live: T8.
4. **Import/export of settings + allowlist + per-site config + custom filters** as
   one JSON document (`utils/backup.ts` + `backup-parse.ts`; options -> About ->
   Backup, with Export / Download .json / Import). Untrusted input validated +
   normalized. Live: T9; units L18-L20.
5. **Context menu** (`background.ts:98`/`:120`, `contextMenus` permission - not a
   host permission): right-click -> "Block this element..." (starts the picker in the
   tab) / "Pause on this site" (toggles the allowlist, which the watcher reconciles).
   The picker path shares the exact message T7 drives; the pause path shares the
   allowlist reconcile T3/T9 verify.
6. **Custom filter-list import (paste text)** (options -> "My filters" -> Import):
   accepts EasyList cosmetic `##selector` lines (site-specific + generic), reports
   how many were skipped and why (network rules -> DNR; extended non-CSS syntax and
   `#@#` exceptions unsupported). Runtime-fetched **remote** lists are intentionally
   **out of scope** (need extra host permissions + review) - stated in panel copy.
   Units L14-L15.

## Constraints upheld

- `packages/core/` untouched (the counting bug was worked around in the extension).
- No new runtime deps; `contextMenus` is the only new (non-host) permission, on both
  targets. No `webRequest`/`debugger`/`declarativeNetRequestFeedback` on Chrome; no
  `declarative_net_request` on Firefox. Picker + context menu add no host permissions.
- `tsc --noEmit` clean under strict + `noUncheckedIndexedAccess`, no `any`.
- Honesty: the badge shows the **exact** cosmetic count; network figures render `~N`
  (approximate) or `—` (unmeasurable), never as exact - enforced by `formatCount`.

## Honestly not verified live

- Firefox request blocking end-to-end: Playwright only loads extensions in Chromium,
  so the Firefox webRequest path is covered by logic tests (L4-L13) against the real
  decision module + a clean `build:firefox` (matches the task's guidance).
- Chromium per-tab **network** counts in the popup: `getMatchedRules()` is quota-
  limited and the standalone popup can't target a web tab here, so the popup's "~/—"
  rendering is logic-tested; the exact cosmetic badge is tested live.
- `contextMenus.onClicked` can't be synthesized by Playwright; its two actions reuse
  code paths verified live (picker T7, allowlist reconcile T3/T9).
