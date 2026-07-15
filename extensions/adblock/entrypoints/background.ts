import { defineBackground } from '#imports';
import type {
  AdBlockExtensionSettings,
  AdBlockLevel,
  AdBlockTabStats,
  AggregateStats,
  CountAccuracy,
  FilterList,
} from '@blur/core';
import {
  settingsItem,
  statsItem,
  statsMetaItem,
  pauseUntilItem,
  pausePrevEnabledItem,
  installDateItem,
} from '../utils/storage';
import { createBackend } from '../utils/backends';
import { StatsStore } from '../utils/stats';
import { publicUrl } from '../utils/public-url';

// Mirrors `AdBlockProtocol` in @blur/core, plus the content-script report. One
// responder per message type (PLAN.md §13).
type AdBlockMessage =
  | { type: 'getSettings' }
  | { type: 'setSettings'; next: AdBlockExtensionSettings }
  | { type: 'getTabStats'; tabId: number }
  // Per-list block breakdown for one tab ("which filter lists this site hits").
  // Firefox reads its exact per-list tally; on Chromium the popup instead reuses
  // its single getMatchedRules read to avoid spending the getMatchedRules quota.
  | { type: 'getTabLists'; tabId: number }
  | { type: 'getAggregateStats' }
  | { type: 'getFilterLists' }
  | { type: 'toggleSite'; hostname: string }
  // Temporarily pause blocking everywhere for `minutes`, then auto-resume via an
  // alarm (survives service-worker teardown). `resumeNow` cancels early.
  | { type: 'pauseFor'; minutes: number }
  | { type: 'resumeNow' }
  // Clear the lifetime aggregate (today/week/total) back to zero from the UI.
  | { type: 'resetStats' }
  // Reported by the content script after cosmetic filtering runs. Cosmetic hides
  // are the ONE thing counted exactly on every browser. `total` is the tab's
  // cumulative hidden count (badge); `delta` is the increment since the last
  // report (accrued into the aggregate) — see stats.ts for why the content script
  // owns the delta rather than the background re-deriving it.
  | { type: 'reportCosmeticHidden'; tabId: number; total: number; delta: number };

interface RulesetManifest {
  buildDate: string;
  lists: {
    id: string;
    title: string;
    ruleCount: number;
    license: string;
    enabledAt: string[];
  }[];
}

const FLUSH_ALARM = 'flush-stats';
const RESUME_ALARM = 'resume-blocking';

function hostFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export default defineBackground({
  main() {
    const backend = createBackend();
    // Firefox counts every cancelled request exactly; Chromium DNR cannot, so its
    // network/tracker figures are approximate (PLAN.md §5).
    const accuracy: CountAccuracy = import.meta.env.FIREFOX ? 'exact' : 'approximate';
    const stats = new StatsStore(accuracy);

    // Last settings the backend was reconciled against. The UI (popup/options)
    // persists changes by writing storage directly — it does NOT send a message —
    // so the background MUST watch storage and reconcile, or level/allowlist
    // changes made in the UI would update cosmetic filtering (content script reads
    // storage) but silently leave the DNR/webRequest network engine untouched.
    let lastSettings: AdBlockExtensionSettings | null = null;

    // Serialize every backend reconcile (init, settings changes, host-grant
    // changes). Each one issues `updateEnabledRulesets`/`updateDynamicRules`, and
    // those are async: a fast burst of toggle flips (or a mass allowlist import
    // landing at the same time as a level change) could otherwise overlap and
    // apply out of order. Chaining onto a single promise makes the LAST write win
    // deterministically. Failures are logged, never left to reject the chain.
    let reconcileChain: Promise<unknown> = Promise.resolve();
    function enqueueReconcile(task: () => Promise<void>): Promise<unknown> {
      reconcileChain = reconcileChain.then(task).catch((err) => {
        console.error('[adblock] reconcile failed', err);
      });
      return reconcileChain;
    }

    // First link in the chain: bring the backend up from stored settings before
    // any settings-change reconcile can run.
    void enqueueReconcile(init);

    // The network engine is driven by an EFFECTIVE level: the master `enabled`
    // switch (and the temporary "pause everywhere") collapse it to `off` so
    // network blocking actually stops — otherwise DNR/webRequest kept filtering
    // while the UI said "off", and the pause feature would only mute cosmetics.
    function effectiveLevel(s: AdBlockExtensionSettings): AdBlockLevel {
      return s.enabled ? s.adblock.level : 'off';
    }

    async function init(): Promise<void> {
      const settings = await settingsItem.getValue();
      await backend.start(effectiveLevel(settings));
      for (const host of settings.allowlist) await backend.allowlistSite(host);
      lastSettings = settings;
      await stampFilterListVersion();
    }

    // Reconcile the network backend whenever settings change from ANY context
    // (popup, options, or a `setSettings` message). Diffs against the last known
    // value so only the allowlist delta is applied. Idempotent: re-applying the
    // same level/allowlist is safe.
    async function reconcileFromSettings(next: AdBlockExtensionSettings): Promise<void> {
      const prev = lastSettings;
      lastSettings = next;
      // `setLevel` re-reads the fine-grained toggles (trackers/annoyances/
      // strip-params) from storage, so it is correct whether the level changed or
      // only a toggle did. Uses the effective level so the master toggle / pause
      // truly disable the network engine.
      await backend.setLevel(effectiveLevel(next));
      await reconcileAllowlist(prev?.allowlist ?? [], next.allowlist);
    }

    settingsItem.watch((next) => {
      if (next) void enqueueReconcile(() => reconcileFromSettings(next));
    });

    // Context menu (feature §5). `removeAll` before create keeps it idempotent
    // across service-worker restarts (create would otherwise throw on a duplicate
    // id). `contextMenus` is not a host permission, so this adds no broad access.
    function setupContextMenus(): void {
      if (!browser.contextMenus) return;
      type Contexts = NonNullable<
        Parameters<typeof browser.contextMenus.create>[0]['contexts']
      >;
      const contexts = ['page', 'frame', 'image', 'video', 'link'] as unknown as Contexts;
      browser.contextMenus.removeAll(() => {
        browser.contextMenus.create({ id: 'block-element', title: 'Block this element…', contexts });
        browser.contextMenus.create({ id: 'pause-site', title: 'Pause on this site', contexts });
      });
    }
    setupContextMenus();

    async function togglePauseForHost(host: string): Promise<void> {
      const current = await settingsItem.getValue();
      const allow = new Set(current.allowlist);
      if (allow.has(host)) allow.delete(host);
      else allow.add(host);
      // Writing settings triggers the watcher above, which reconciles the backend.
      await settingsItem.setValue({ ...current, allowlist: [...allow] });
    }

    browser.contextMenus?.onClicked.addListener((info, tab) => {
      if (!tab?.id) return;
      if (info.menuItemId === 'block-element') {
        // Ask the page's content script to start the element picker.
        void browser.tabs.sendMessage(tab.id, { type: 'startPicker' }).catch(() => {
          // No content script on this page (e.g. chrome:// or the tab predates the
          // extension) — nothing to pick.
        });
      } else if (info.menuItemId === 'pause-site') {
        const host = hostFromUrl(info.pageUrl ?? tab.url);
        if (host) void togglePauseForHost(host);
      }
    });

    async function stampFilterListVersion(): Promise<void> {
      const manifest = await loadManifest();
      if (!manifest) return;
      const current = await statsItem.getValue();
      if (current.filterListVersion !== manifest.buildDate) {
        await statsItem.setValue({ ...current, filterListVersion: manifest.buildDate });
      }
    }

    async function loadManifest(): Promise<RulesetManifest | null> {
      try {
        const res = await fetch(publicUrl('/rules/manifest.json'));
        return (await res.json()) as RulesetManifest;
      } catch {
        return null;
      }
    }

    async function filterLists(): Promise<FilterList[]> {
      const manifest = await loadManifest();
      if (!manifest) return [];
      return manifest.lists.map((l) => ({
        id: l.id,
        title: l.title,
        ruleCount: l.ruleCount,
        enabledAt: l.enabledAt.filter(
          (e): e is FilterList['enabledAt'][number] =>
            e === 'off' || e === 'standard' || e === 'aggressive',
        ),
        license: l.license,
      }));
    }

    async function tabStats(tabId: number): Promise<AdBlockTabStats> {
      if (import.meta.env.FIREFOX) {
        // Exact per-tab counts live in the backend; fold them into the store so
        // the cumulative bucket tracks them too.
        const counts = await backend.getTabCounts(tabId);
        stats.setNetwork(tabId, counts.network, counts.trackers, counts.accuracy);
      }
      const tab = stats.getTab(tabId);
      return { tabId, hostname: '', ...tab };
    }

    // Fold EVERY tab's exact backend counts into the cumulative store, then flush.
    //
    // On Firefox the blocking-webRequest backend tallies each cancelled request
    // per tab, but `tabStats()` only reads a tab's counts when the popup asks for
    // THAT active tab — so blocks on every other tab never reached the aggregate
    // and today/week/total systematically undercounted. Folding all tabs in on the
    // flush tick fixes that. `StatsStore.setNetwork` accrues only the increase over
    // the previous reading, so re-folding the same tabs each tick never double-
    // counts. On Chromium `getAllTabCounts()` is [] (can't measure off-tab).
    async function flushAll(): Promise<void> {
      for (const c of await backend.getAllTabCounts()) {
        stats.setNetwork(c.tabId, c.network, c.trackers, c.accuracy);
      }
      await stats.flush();
    }

    async function reconcileAllowlist(prev: string[], next: string[]): Promise<void> {
      const before = new Set(prev);
      const after = new Set(next);
      for (const host of after) if (!before.has(host)) await backend.allowlistSite(host);
      for (const host of before) if (!after.has(host)) await backend.removeAllowlist(host);
    }

    function updateBadge(tabId: number): void {
      const { cosmeticHidden } = stats.getTab(tabId);
      // Badge shows the COSMETIC-hidden count only — the one figure exact on every
      // browser. Network blocks are approximate on Chromium DNR, so they never
      // drive the badge (PLAN.md §5).
      const action = browser.action ?? browser.browserAction;
      void action?.setBadgeText({
        tabId,
        text: cosmeticHidden > 0 ? String(cosmeticHidden) : '',
      });
    }

    // Temporary "pause everywhere for N minutes". Turns blocking off (the same
    // `enabled` flag the backend + content script already honor) and schedules an
    // alarm to switch it back on. The alarm lives in the background, so it fires
    // even after the popup closes and the service worker is torn down.
    async function pauseBlocking(minutes: number): Promise<number> {
      const until = Date.now() + Math.max(1, minutes) * 60_000;
      const current = await settingsItem.getValue();
      // Pausing a switch that is already off is a no-op: it would only arm an
      // alarm that later flips blocking back ON against the user's intent. The
      // popup also hides the Pause action while globally off.
      if (!current.enabled) return until;
      // Remember the pre-pause master state so auto-resume restores exactly it,
      // never force-enabling a switch the user had deliberately turned off.
      await pausePrevEnabledItem.setValue(current.enabled);
      await settingsItem.setValue({ ...current, enabled: false });
      await pauseUntilItem.setValue(until);
      browser.alarms.create(RESUME_ALARM, { when: until });
      return until;
    }

    async function resumeBlocking(): Promise<void> {
      await browser.alarms.clear(RESUME_ALARM);
      const [current, until, wasEnabled] = await Promise.all([
        settingsItem.getValue(),
        pauseUntilItem.getValue(),
        pausePrevEnabledItem.getValue(),
      ]);
      await pauseUntilItem.setValue(0);
      // Only a genuinely-active pause (until > 0) that turned an ENABLED switch
      // off should be undone, and only back to that pre-pause state. A stray or
      // stale alarm, or a switch the user turned off, is left untouched.
      if (until > 0 && !current.enabled && wasEnabled) {
        await settingsItem.setValue({ ...current, enabled: true });
      }
    }

    browser.runtime.onMessage.addListener(
      (message: AdBlockMessage, sender, sendResponse) => {
        void (async () => {
          switch (message.type) {
            case 'getSettings':
              sendResponse(await settingsItem.getValue());
              return;
            case 'setSettings': {
              // Persist only. Writing settings fires `settingsItem.watch` above,
              // which reconciles the backend once against an up-to-date `prev`.
              // Reconciling here too would run it a second time against a stale
              // `lastSettings` (double-apply), so we deliberately don't.
              await settingsItem.setValue(message.next);
              sendResponse(true);
              return;
            }
            case 'getTabStats':
              sendResponse(await tabStats(message.tabId));
              return;
            case 'getTabLists': {
              // Chromium's `getTabCounts` reads DNR matched-rules, which must
              // NEVER run from the background / off a user gesture (it spends the
              // 20-calls/10-min quota — see matched-rules.ts). The popup only asks
              // for this on Firefox; guard so a stray Chromium call is a no-op.
              if (!import.meta.env.FIREFOX) {
                sendResponse({});
                return;
              }
              const counts = await backend.getTabCounts(message.tabId);
              sendResponse(counts.byList ?? {});
              return;
            }
            case 'getAggregateStats': {
              await flushAll();
              sendResponse(await statsItem.getValue());
              return;
            }
            case 'getFilterLists':
              sendResponse(await filterLists());
              return;
            case 'toggleSite': {
              const settings = await settingsItem.getValue();
              const allow = new Set(settings.allowlist);
              const nowAllowed = !allow.has(message.hostname);
              if (nowAllowed) allow.add(message.hostname);
              else allow.delete(message.hostname);
              await settingsItem.setValue({ ...settings, allowlist: [...allow] });
              if (nowAllowed) await backend.allowlistSite(message.hostname);
              else await backend.removeAllowlist(message.hostname);
              sendResponse(nowAllowed);
              return;
            }
            case 'pauseFor': {
              const until = await pauseBlocking(message.minutes);
              sendResponse(until);
              return;
            }
            case 'resumeNow': {
              await resumeBlocking();
              sendResponse(true);
              return;
            }
            case 'resetStats': {
              // Zero the lifetime aggregate but keep its non-counter fields
              // (accuracy, filterListVersion). Clearing the day/week bucket keys
              // makes the next flush start fresh buckets rather than re-adding to
              // stale ones.
              const current = await statsItem.getValue();
              await Promise.all([
                statsItem.setValue({ ...current, today: 0, week: 0, total: 0 }),
                statsMetaItem.setValue({ dayKey: '', weekKey: '' }),
              ]);
              sendResponse(true);
              return;
            }
            case 'reportCosmeticHidden': {
              // Content scripts can't know their own tabId — trust the sender.
              const tabId = sender.tab?.id ?? message.tabId;
              // A report with no real tab (sender.tab absent → message.tabId is
              // -1) has no page to attribute to. Recording it would pollute the
              // aggregate with a phantom tab id -1 that resetTabState never clears.
              if (tabId < 0) {
                sendResponse(true);
                return;
              }
              stats.recordCosmetic(tabId, message.total, message.delta);
              updateBadge(tabId);
              sendResponse(true);
              return;
            }
          }
        })();
        // Keep the channel open for the async responder (needed until Chrome 148,
        // where returning a Promise supersedes this — PLAN.md §13).
        return true;
      },
    );

    browser.tabs.onActivated.addListener(({ tabId }) => updateBadge(tabId));

    // A tab's per-request counters (Firefox) and cosmetic badge (both browsers)
    // must not outlive the document they describe. Without this, a reused tab id
    // showed a stale badge after an in-tab navigation, and Firefox leaked per-tab
    // counters unbounded.
    function resetTabState(tabId: number): void {
      if (import.meta.env.FIREFOX) {
        // Firefox's backend holds EXACT per-request counts that only reach the
        // aggregate on the 30s flush tick. Blocks accrued since the last tick
        // would be discarded on every reload/close, so fold this tab's counts
        // into the store BEFORE clearing (fire-and-forget; setNetwork accrues
        // only the increase over the last reading, so this never double-counts).
        // Chromium's getTabCounts spends the DNR quota (see matched-rules.ts), so
        // it is skipped there — it has no cumulative off-tick counts anyway.
        void backend.getTabCounts(tabId).then((c) => {
          stats.setNetwork(tabId, c.network, c.trackers, c.accuracy);
          stats.clearTab(tabId);
          backend.resetTab(tabId);
        });
      } else {
        stats.clearTab(tabId);
        backend.resetTab(tabId);
      }
      const action = browser.action ?? browser.browserAction;
      void action?.setBadgeText({ tabId, text: '' });
    }

    browser.tabs.onRemoved.addListener((tabId) => resetTabState(tabId));
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      // `status: 'loading'` marks a fresh main-frame document starting to load
      // (full nav or reload). Reset now so the incoming content script reports
      // onto a clean slate and the badge doesn't show the previous page's count.
      if (changeInfo.status === 'loading') resetTabState(tabId);
    });

    // Stamp the install date once, so the lifetime total can read "since <date>".
    browser.runtime.onInstalled.addListener(() => {
      void (async () => {
        if (!(await installDateItem.getValue())) {
          await installDateItem.setValue(new Date().toISOString().slice(0, 10));
        }
      })();
    });

    // On Chromium the strip-params redirect rule is gated on the runtime host
    // grant; when the user grants it (from the options/popup toggle), re-reconcile
    // so the rule is actually installed. No-op on Firefox (install-time grant).
    if (!import.meta.env.FIREFOX) {
      const reReconcile = (): void => {
        void enqueueReconcile(async () => {
          const current = await settingsItem.getValue();
          await backend.setLevel(effectiveLevel(current));
        });
      };
      browser.permissions.onAdded?.addListener(reReconcile);
      browser.permissions.onRemoved?.addListener(reReconcile);
    }

    // Volatile in-memory counters are flushed to storage.local in ONE batched
    // write on this tick and on suspend — NEVER on every event (PLAN.md §2, §5).
    browser.alarms.create(FLUSH_ALARM, { periodInMinutes: 0.5 });
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === FLUSH_ALARM) void flushAll();
      else if (alarm.name === RESUME_ALARM) void resumeBlocking();
    });
    browser.runtime.onSuspend.addListener(() => void flushAll());
  },
});
