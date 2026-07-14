# Ad & Tracker Blocker — implementation notes

## What `@blur/core` gives us (read-only)
`DomRuleEngine({rules, blurRadius, reveal, hostname, onStatsChange})` does block-first
CSS injection, mutation batching, viewport-gated counting and open-shadow-root traversal.
Cosmetic filtering = feeding it `DomRule[]` with `action: 'hide'` (→ `display:none`).
We consume it for CSS injection + shadow-root traversal — no core changes were needed.

⚠️ We do NOT use `.stats.hidden` for the count: the engine counts via an
`IntersectionObserver`, and a `display:none` element has no layout box, so it never
reports `isIntersecting` — its hidden count is therefore always 0. Since core is
read-only, the content script counts hides itself (`content.ts` `recount()`): the
number of DISTINCT elements matched by the applicable hide selectors, via core's own
shadow-piercing `deepQuerySelectorAll`, tracked in a `WeakSet`. Exact everywhere,
drives the badge and the cumulative total. (This was a live-test failure — see
`e2e/adblock/REPORT.md` T4.)

## Settings → engine reconcile (live-test fix)
The popup/options persist changes by writing storage directly (`settingsItem.setValue`)
and send NO message. The background therefore `settingsItem.watch(...)`es storage and
reconciles the network backend (DNR ruleset enablement + per-site `allowAllRequests`
allowlist) on every change from any context — without it, a level/allowlist change in
the UI updated cosmetic filtering but left network blocking frozen (REPORT.md T3/T5).

## User cosmetic filters, picker, per-site cosmetic toggle
`utils/element-picker.ts` (click → selector), `utils/custom-filters.ts` (per-host
selector store + EasyList `##selector` paste parsing), and `AdBlockSiteConfigX.
disableCosmetic` (keep network, stop hiding) layer on top of the same engine. Custom
rules apply at every level (explicit user intent), unlike the generic tier.

## DNR vs webRequest split (PLAN.md §4)
Selected at **build time** via `import.meta.env.FIREFOX`, so the loser is tree-shaken and
its permissions never ship.
- **DnrBackend** (Chrome/Chromium/Safari): static rulesets toggled per level with
  `declarativeNetRequest.updateEnabledRulesets`. Per-site allowlist = a **dynamic**
  `allowAllRequests` rule at high priority keyed on `requestDomains`/`initiatorDomains`.
  `stripTrackingParams` = a **dynamic `redirect`** rule (`transform.queryTransform.removeParams`)
  for the utm_*/fbclid/gclid/... set. `redirect` is "unsafe" (≤5,000 dynamic) — asserted.
- **WebRequestBackend** (Firefox): blocking `webRequest.onBeforeRequest` → `{cancel:true}`.

## Counting constraints (PLAN.md §5)
- **cosmeticHidden** — exact on every browser (content script). Never prefixed `~`.
- **network/trackers on Chromium** — `accuracy:'approximate'`, per-tab and on-demand only.
  `onRuleMatchedDebug` is dev-mode only; `getMatchedRules()` is 20 calls / 10 min with a
  last-5-min window. Chrome documents a user-gesture exemption, but the popup reads it from
  an async effect **after** mount, so the exemption is **not guaranteed** and the quota can
  still be hit. `utils/matched-rules.ts` therefore treats a throw as *unavailable* and returns
  `null`; the popup renders `—` (never a fake `~0`). The **background never calls it**;
  `DnrBackend.getTabCounts` delegates to the same helper for interface-compliance only.
- **Firefox** — exact per-tab counters incremented on every cancelled request.
- **Aggregate total is EXACT.** Only exactly-counted increments are ever accrued into it —
  cosmetic hides everywhere, plus exact webRequest network/tracker blocks on Firefox.
  Chromium's approximate DNR figures are per-tab/on-demand and never reach the cumulative
  bucket, so `stats.flush()` stamps `accuracy:'exact'` and the popup shows totals with **no**
  `~`. The label differs by engine (Chromium: "Elements hidden"; Firefox also folds in
  network/tracker blocks) so the number is never implied to include more than it does.
- The content script reports a **delta since its last message** (not the cumulative count):
  the MV3 background's in-memory per-tab baseline is wiped on SW teardown (~30s idle), so
  re-deriving the delta there would double-count the full cumulative on the next report after
  every restart. Reports are also **coalesced** (≤1 per 500ms) to avoid a message storm.
- Counters live in memory and flush in **one** batched `storage.local.set` on a 30s
  `chrome.alarms` tick and on `runtime.onSuspend` (`utils/stats.ts`). SW death can lose the
  last window → cumulative totals are commented as approximate-by-a-little.

## Ruleset build pipeline (`scripts/build-rulesets.mjs`, `npm run build:rules`)
`@adguard/dnr-rulesets` ships **prebuilt DNR JSON offline** in
`dist/filters/chromium-mv3/declarative/ruleset_<id>/`, so the build reads those directly —
no network. (The canonical upstream refresh is `npx dnr-rulesets load <out>` /
`new AssetsLoader().load(out)`, which repopulates that same layout from filters.adtidy.org.)
Mapping → outputs (AdGuard is the source; EasyList/EasyPrivacy are folded into AdGuard Base/
Tracking Protection, not shipped standalone):
- `easylist.json`  ← AdGuard Base filter (id 2), capped 20,000
- `easyprivacy.json` ← AdGuard Tracking Protection (id 3), capped 9,000
- `annoyances.json` ← Cookie Notices/Popups/Other/Widgets (18,19,21,22) merged, capped 6,000

Per source: drop the AdGuard metadata sentinel rule, drop `redirect` rules (they reference
`$redirect` web-accessible resources we don't bundle), strip stray `metadata`, reassign
sequential ids, cap, count. Emits `manifest.json` (id, title, ruleCount, regexCount, license,
enabledAt, build date). **Fails loudly** if the source assets are missing (prints the real
`dnr-rulesets load` invocation) and keeps placeholders.

Asserted hard limits: standard tier (easylist+easyprivacy) ≤ **30,000** (fails build if over);
combined regex ≤ **1,000**; declared rulesets ≤ **100**, enabled-at-once ≤ **50**. The
**aggressive** tier (easylist+easyprivacy+annoyances ≈ 35,000) deliberately exceeds the 30,000
per-extension guarantee: the build **warns** and fails only if it cannot fit the shared 300,000
global pool. At runtime `DnrBackend.reconcile()` catches an `updateEnabledRulesets` rejection
(global pool exhausted), and the options "Filter lists" panel shows the over-budget warning, so
aggressive never silently does nothing.

## Cosmetic selectors — documented stub
DNR JSON carries **no** cosmetic (`##selector`) rules, and the raw AdGuard text filters that
tsurlfilter's `CosmeticEngine` would parse are **not bundled** offline. So `build:rules` emits a
small **curated** `cosmetic.json` (`siteSpecific` + `generic`); `standard` uses site-specific
only, `aggressive` adds generic. A full pipeline would run `dnr-rulesets load --latest-filters`
then feed the text to `@adguard/tsurlfilter` `Engine.getCosmeticResult()`.

## Firefox matcher — documented choice
`@adguard/tsurlfilter@5` `Engine.createSync({filters})` + `matchRequest()` is confirmed in
`node_modules`, but it needs **raw filter text** (not bundled — we ship DNR JSON). So
`WebRequestBackend` builds a **hostname-set matcher from the same DNR JSON** (`||host^`
patterns): self-contained, offline, and exact-counting. Wiring the real tsurlfilter Engine
only needs the raw text filters added to the bundle.

**Correctness over coverage** (never blank a page): the listener never cancels `main_frame`
navigations; `@@` exception rules (DNR `action:'allow'`/`allowAllRequests`) are parsed into an
exception host-set and win over blocks; and only rules anchored to a **whole host** (`||host^`)
are used — a rule with a path (`||host/ads^`) or wildcard is **skipped**, never collapsed to a
bare-domain block that would cancel every request to the host. Deliberately **not modelled**:
`$third-party`/first-party party (it lives in DNR `condition.domainType`, which a flat hostname
set cannot represent) — acceptable since those hosts are ads/trackers anyway and `main_frame`
is already protected.

## Build order
1. `build:rules` → real `public/rules/*.json` + `manifest.json`.
2. `utils/backends/*` (interface + 2 impls + factory), `utils/matched-rules.ts`, `utils/stats.ts`.
3. `background.ts` router/lifecycle/alarms/badge; `content.ts` cosmetic; `popup`/`options` wiring.
