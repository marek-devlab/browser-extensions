import { defineBackground, browser } from '#imports';
import {
  CHROME_DEFAULT_CAPS,
  FIREFOX_CAPS,
  compileRules,
  emptyRuleSet,
  selectEngine,
  type CompiledRuleSet,
  type EngineCaps,
  type Platform,
} from '../utils/engine-select';
import { createEngines, type Engine, type EngineEvent } from '../utils/engines';
import { asDnrEngine } from '../utils/engines/dnr';
import { needsObservation } from '../utils/engines/dnr-translate';
import { startDnrCounters } from '../utils/dnr-counters';
import { asDebuggerEngine, type DbgTabsApi } from '../utils/engines/debugger';
import { mergeSnapshot, type PageEngine } from '../utils/engines/page';
import { matchesSuffix, matchesUrlCondition, type DebuggerApi } from '@blur/netcore';
import { clearLog, logSince, pushLog, resizeLog, type LogInput } from '../utils/log';
import type { PushMessage, QueryMessage, ReplyFor, RulesApplied, TabRuleStatus, TabSummary } from '../utils/protocol';
import { isPrivilegedSender, isQueryMessage, isRelayMessage, isRelaySender } from '../utils/protocol';
import { parseRulesImport, serializeRulesDocument, validateRulesDocument, type RuleError } from '../utils/rule-schema';
import { deleteBlockedError, dependantsOf, planRulesCommit } from '../utils/rules-commit';
import type { RulesDocument } from '../utils/rule-types';
import { countKeyOf, forgetTab, markMatched, openWindow, recordHit, resetCounters, resetForNavigation } from '../utils/state';
import {
  LOG_LOCK,
  logItem,
  nlTabsItem,
  pausedTabsItem,
  prefsItem,
  restartNoticeItem,
  rulesItem,
  stateItem,
  STATE_LOCK,
  updateRules,
  updateState,
  withLock,
} from '../utils/storage';

// THIN ORCHESTRATOR (design §4, §8). It owns: the rules document, the compiled
// set, the engines, the counters (`session:state`, under a Web Lock), the log
// and the message router. It does NOT touch request APIs itself — that is what
// the engines are for (utils/engines/*).
//
// Fail-open is the rule everywhere here: an engine that throws in `apply`
// reports an error and the OTHER engines keep running; nothing ever leaves a
// request hanging because this file mis-stepped. Every async path that is not
// awaited by a caller ends in a `.catch` that records the failure in
// `runtimeErrors` (visible in the tool page) — a storage quota error must never
// surface only as an unhandled rejection in the worker console.

const PLATFORM: Platform = import.meta.env.FIREFOX ? 'firefox' : 'chrome';

/** Watchdog cadence (design §5.5): `alarms` cannot go below 30 s (Chrome 120+). */
const WATCHDOG_ALARM = 'netblock-watchdog';
const WATCHDOG_PERIOD_MIN = 0.5;

export default defineBackground({
  main() {
    /* -------------------------- capability detection -------------------------- */

    // Feature-detected once. `RuleConditionKeys` (Chrome 145+) is the only
    // reliable way to know `responseHeaders` conditions exist (design §6.3).
    const dnr = (browser as unknown as { declarativeNetRequest?: { RuleConditionKeys?: Record<string, string>; getSessionRules?: () => Promise<{ id: number; condition?: { tabIds?: number[] } }[]>; updateSessionRules?: (o: { removeRuleIds: number[] }) => Promise<void> } }).declarativeNetRequest;
    const apis = {
      declarativeNetRequest: !!dnr,
      scripting: !!(browser as unknown as { scripting?: unknown }).scripting,
      // `chrome.debugger` exists iff the install-time `debugger` permission is
      // present (Chrome build only, wxt.config.ts). Nothing attaches until the
      // user turns Network-level mode on for a tab (utils/engines/debugger.ts).
      debugger: !import.meta.env.FIREFOX && !!(browser as unknown as { debugger?: unknown }).debugger,
      webRequestBlocking: PLATFORM === 'firefox',
    };
    // One object for the whole worker life: the engines hold a reference to
    // it (`selectEngine` in `supports`, `caps.page` in the page engine's
    // registration), so `caps.page` is updated IN PLACE from the pref (below)
    // and every consumer — compile, registration, `getCaps` for the editor's
    // live badge — reads the same truth.
    const caps: EngineCaps =
      PLATFORM === 'firefox'
        ? { ...FIREFOX_CAPS }
        : {
            ...CHROME_DEFAULT_CAPS,
            dnrResponseHeaders: Object.values(dnr?.RuleConditionKeys ?? {}).includes('responseHeaders'),
            debugger: apis.debugger,
          };

    const engines: Engine[] = createEngines(PLATFORM, caps, apis);
    // Debugger engine (NL mode): browser APIs + storage are injected here so the
    // engine module itself is free of them (Firefox bundle, Node tests).
    const debuggerEngine = asDebuggerEngine(engines);
    if (!import.meta.env.FIREFOX && apis.debugger) {
      debuggerEngine.configure({
        api: (browser as unknown as { debugger: DebuggerApi }).debugger,
        tabs: browser.tabs as unknown as DbgTabsApi,
        state: { read: () => stateItem.getValue(), write: (mutate) => updateState(mutate) },
        watchState: (cb) => stateItem.watch((next) => next && cb(next)),
        nlTabs: { get: () => nlTabsItem.getValue(), set: (ids) => nlTabsItem.setValue(ids) },
        prefs: () => prefsItem.getValue(),
        isPaused: (tabId) => pausedTabs.has(tabId),
      });
    }
    // The page engine needs the counters (source of truth stays here) — see utils/engines/page.ts.
    const pageEngine = engines.find((e): e is PageEngine => e.id === 'page');
    pageEngine?.configure({
      getSnapshot: () => withLock(STATE_LOCK, () => stateItem.getValue()),
      mergeState: async (counters, matched) => void (await updateState((snap) => mergeSnapshot(snap, counters, matched))),
      isPaused: (tabId) => pausedTabs.has(tabId),
    });

    /* ------------------------------ in-memory state --------------------------- */

    // Everything here is a CACHE of storage: the MV3 service worker is evicted
    // after ~30 s idle and this closure is rebuilt from storage by `init()`.
    // Listeners are registered synchronously below (an async registration
    // would miss the event that woke the worker); handlers await `ready`.
    let rules: RulesDocument = { version: 1, rules: [], groups: [] };
    let compiled: CompiledRuleSet = emptyRuleSet();
    let applyErrors: RulesApplied['errors'] = [];
    /** Entries of `local:rules` that failed validation at load or at the last
     *  commit — never applied, shown to the user (design §7.1: storage is untrusted). */
    let storageErrors: RulesApplied['errors'] = [];
    /** Failures of fire-and-forget work (storage writes from event handlers). */
    let runtimeErrors: RulesApplied['errors'] = [];
    function noteFailure(where: string): (err: unknown) => void {
      return (err) => {
        const message = `${where}: ${err instanceof Error ? err.message : String(err)}`;
        runtimeErrors = [...runtimeErrors.slice(-9), { message }];
      };
    }
    let pausedTabs = new Set<number>();
    let logStripQuery = false;

    // DNR engine triggers (reactive rules) + ≈ counters + the Chrome observation
    // log — utils/engines/dnr.ts, utils/dnr-counters.ts. A tab in NL mode is
    // logged by the debugger engine, so the observer skips it (no double rows).
    const dnrEngine = asDnrEngine(engines);
    startDnrCounters(dnrEngine, { getSet: () => compiled, isObservedElsewhere: (tabId) => debuggerEngine.isAttached(tabId) });

    // `ready` never rejects: a storage failure at start is recorded and the
    // worker still answers messages (with empty rules) instead of failing every
    // handler that awaits it.
    const ready: Promise<void> = init().catch(noteFailure('startup'));

    async function init(): Promise<void> {
      const [doc, prefs, paused] = await Promise.all([
        rulesItem.getValue(),
        prefsItem.getValue(),
        pausedTabsItem.getValue(),
      ]);
      // Storage is untrusted too (design §7.1): an entry that fails the schema
      // is not applied and is reported through `applied.errors`; the next
      // successful commit (`commitRules`) writes the validated document back.
      const v = validateRulesDocument(doc);
      rules = v.doc;
      storageErrors = toAppliedErrors(v.errors, 'stored');
      pausedTabs = new Set(paused);
      logStripQuery = prefs.logStripQuery;
      // Settings → "Allow the page engine": part of the caps the rules are
      // compiled with, not a UI-only filter (defect b of the integration plan).
      if (PLATFORM === 'chrome') caps.page = prefs.pageEngineEnabled;
      // Ring-buffer capacity follows the pref; shrink evicts immediately.
      await withLock(LOG_LOCK, async () => {
        const log = await logItem.getValue();
        if (log.capacity !== prefs.logSize) await logItem.setValue(resizeLog(log, prefs.logSize));
      });
      await cleanupOrphanedSessionRules();
      await applyAll();
    }

    /* ------------------------------- compilation ------------------------------ */

    async function applyAll(): Promise<RulesApplied> {
      compiled = compileRules(rules.rules, rules.groups, PLATFORM, caps, Date.now());
      applyErrors = [];
      // Every engine gets the whole set and picks its own slice. One engine's
      // failure is recorded and does not stop the others (fail-open).
      await Promise.all(
        engines.map(async (engine) => {
          try {
            await engine.apply(compiled);
          } catch (err) {
            applyErrors.push({ message: err instanceof Error ? err.message : String(err) });
          }
        }),
      );
      const applied = appliedSummary();
      push({ type: 'rules:applied', applied });
      return applied;
    }

    function appliedSummary(): RulesApplied {
      return {
        compiled: Object.values(compiled.byEngine).flat(),
        inactive: compiled.inactive,
        errors: [...applyErrors, ...storageErrors, ...runtimeErrors],
      };
    }

    function toAppliedErrors(errors: readonly RuleError[], label: string): RulesApplied['errors'] {
      return errors.map((e) => ({
        message: `${label} ${e.where}${e.index === null ? '' : ` #${e.index + 1}`} ${e.path}: ${e.message}`.replace(/\s+/g, ' ').trim(),
      }));
    }

    /* ------------------------------ rules commits ----------------------------- */

    /**
     * The ONE write path for `local:rules`. The whole resulting document is
     * validated (cross-rule invariants included — utils/rules-commit.ts) before
     * anything is written, so a document that passed here loads back
     * identically at the next worker start; a refused commit changes nothing
     * and returns the errors for the UI.
     */
    async function commitRules(mutate: (doc: RulesDocument) => RulesDocument): Promise<{ ok: true } | { ok: false; errors: RuleError[] }> {
      let plan: ReturnType<typeof planRulesCommit> | undefined;
      await updateRules((raw) => {
        plan = planRulesCommit(raw, mutate);
        return plan.ok && plan.changed ? plan.doc : raw;
      });
      if (!plan || !plan.ok) return { ok: false, errors: plan?.errors ?? [{ index: null, where: 'document', path: '', message: 'commit failed' }] };
      rules = plan.doc;
      storageErrors = toAppliedErrors(plan.storageErrors, 'stored');
      return { ok: true };
    }

    /** `commitRules` + apply → the reply shape of every mutating query. */
    async function commitAndApply(mutate: (doc: RulesDocument) => RulesDocument): Promise<ReplyFor<'saveRule'>> {
      const r = await commitRules(mutate);
      if (!r.ok) return r;
      return { ok: true, applied: await applyAll() };
    }

    /**
     * Design §8: a session rule with `tabIds` can outlive its tab when the
     * worker was asleep at `tabs.onRemoved`. On every start, drop the ones
     * whose tabs no longer exist (the dnr engine's own `recover()` then
     * re-learns the survivors by id range).
     */
    async function cleanupOrphanedSessionRules(): Promise<void> {
      if (!dnr?.getSessionRules || !dnr.updateSessionRules) return;
      try {
        const [sessionRules, tabs] = await Promise.all([dnr.getSessionRules(), browser.tabs.query({})]);
        const live = new Set(tabs.map((t) => t.id).filter((id): id is number => id !== undefined));
        const orphaned = sessionRules
          .filter((r) => r.condition?.tabIds?.length && !r.condition.tabIds.some((id) => live.has(id)))
          .map((r) => r.id);
        if (orphaned.length) await dnr.updateSessionRules({ removeRuleIds: orphaned });
      } catch {
        // Nothing to clean, or no permission yet — never fatal.
      }
    }

    /* ------------------------------ engine events ----------------------------- */

    async function onEngineEvent(event: EngineEvent): Promise<void> {
      await ready;
      switch (event.type) {
        case 'log':
          enqueueLog(event.entry);
          break;
        case 'hit': {
          // Exact engines count in their own snapshot and report; an approximate
          // (DNR) hit is counted HERE — the browser applied the rule, nobody ran
          // `decide()` — so the popup's `≈N` has something to show (§4.2).
          // Reactive DNR trigger BEFORE the storage write: "B after A" is a race
          // against the page's next request (spike S3), the Web-Lock RMW is not.
          void dnrEngine.onTrigger({ type: 'matched', ruleId: event.ruleId, tabId: event.tabId, url: event.url, applied: true });
          const now = Date.now();
          const rule = event.approx ? rules.rules.find((r) => r.id === event.ruleId) : undefined;
          await updateState((snap) => (rule ? recordHit(rule, snap, { tabId: event.tabId, url: event.url, now }) : markMatched(snap, event.ruleId, now)));
          break;
        }
        case 'matched':
          void dnrEngine.onTrigger({ type: 'matched', ruleId: event.ruleId, tabId: event.tabId, url: event.url, applied: false });
          await updateState((snap) => markMatched(snap, event.ruleId, Date.now()));
          break;
        case 'error':
          applyErrors.push({ ruleId: event.ruleId, message: event.message, hint: event.hint });
          push({ type: 'rules:applied', applied: appliedSummary() });
          break;
        case 'detached': {
          const nl = await nlTabsItem.getValue();
          await nlTabsItem.setValue(nl.filter((id) => id !== event.tabId));
          push({ type: 'nl:detached', tabId: event.tabId, reason: event.reason });
          break;
        }
      }
    }
    for (const engine of engines) engine.onEvent((e) => void onEngineEvent(e).catch(noteFailure('engine event')));

    /* ------------------------------- log batching ----------------------------- */

    // One `session:log` read-modify-write per ROW was the dominant cost on a
    // busy page (Firefox/Android report; now Chrome observation rows too).
    // Rows are coalesced for up to LOG_FLUSH_MS, or sooner when the buffer
    // grows past LOG_FLUSH_ROWS, and written in ONE RMW under the log lock;
    // `pushLog` still runs per row inside, so the ring-buffer contract (caps,
    // eviction count, monotonic ids = the UI cursor) is unchanged. The flush is
    // also forced before a `getLogPage` read (the reader must see what the
    // engines already reported), on `clearLog` (queued rows are dropped with
    // the buffer) and on `runtime.onSuspend` (best effort — MV3 gives no
    // reliable hook; a worker killed inside the 250 ms window loses that delta,
    // which is acceptable for a session-only log).
    const LOG_FLUSH_MS = 250;
    const LOG_FLUSH_ROWS = 50;
    let logQueue: LogInput[] = [];
    let logTimer: ReturnType<typeof setTimeout> | undefined;
    let logFlushing: Promise<void> = Promise.resolve();

    function enqueueLog(entry: LogInput): void {
      logQueue.push(entry);
      if (logQueue.length >= LOG_FLUSH_ROWS) {
        void flushLog();
        return;
      }
      if (logTimer === undefined) {
        logTimer = setTimeout(() => {
          logTimer = undefined;
          void flushLog();
        }, LOG_FLUSH_MS);
      }
    }

    function flushLog(): Promise<void> {
      if (logTimer !== undefined) {
        clearTimeout(logTimer);
        logTimer = undefined;
      }
      if (logQueue.length === 0) return logFlushing;
      const batch = logQueue;
      logQueue = [];
      // Serialised: a second flush queues behind the first, never interleaves.
      logFlushing = logFlushing
        .then(() =>
          withLock(LOG_LOCK, async () => {
            let log = await logItem.getValue();
            for (const entry of batch) log = pushLog(log, entry, logStripQuery);
            await logItem.setValue(log);
            // The rows that survived eviction, in order — the UI dedupes by id.
            push({ type: 'log:append', entries: log.entries.slice(-batch.length) });
          }),
        )
        .catch(() => undefined);
      return logFlushing;
    }

    browser.runtime.onSuspend?.addListener(() => void flushLog());

    /* ------------------------------ tab lifecycle ----------------------------- */

    browser.tabs.onRemoved.addListener((tabId) => {
      void (async () => {
        await ready;
        for (const engine of engines) await engine.resumeTab(tabId).catch(() => undefined);
        await debuggerEngine.disableTab(tabId).catch(() => undefined); // NL session dies with the tab (design §8)
        await updateState((snap) => forgetTab(snap, tabId));
        if (pausedTabs.delete(tabId)) await pausedTabsItem.setValue([...pausedTabs]);
        const nl = await nlTabsItem.getValue();
        if (nl.includes(tabId)) await nlTabsItem.setValue(nl.filter((id) => id !== tabId));
        await dnrEngine.onTrigger({ type: 'tabRemoved', tabId }); // drops this tab's `tabIds` session rules
      })().catch(noteFailure('tab closed'));
    });
    browser.tabs.onActivated.addListener((info) => {
      void ready.then(() => dnrEngine.onTrigger({ type: 'tabActivated', tabId: info.tabId, windowId: info.windowId }));
    });

    // `resetOn: 'navigation'` — a top-level load restarts the tab's counters
    // and opens `window` rules with `trigger: 'navigation'`. No `webNavigation`
    // permission needed (design §10.2). `status: 'loading'` arrives for every
    // tab; `tab.url` only with host access — and Network-level mode needs none,
    // so the reset must not depend on the URL (an empty URL only weakens the
    // `url`-keyed instance of a `window` rule to a global one).
    browser.tabs.onUpdated.addListener((tabId, info, tab) => {
      if (info.status !== 'loading') return;
      const url = tab.url ?? '';
      void (async () => {
        await ready;
        const now = Date.now();
        await updateState((snap) => {
          let next = resetForNavigation(snap, rules.rules, tabId);
          for (const r of rules.rules) {
            if (r.enabled && r.state.kind === 'window' && r.state.trigger === 'navigation') {
              next = openWindow(r, next, { tabId, url, now });
            }
          }
          return next;
        });
        await dnrEngine.onTrigger({ type: 'navigation', tabId, url });
      })().catch(noteFailure('navigation'));
    });

    // Restart notice (design §5.6): storage.session is empty after a browser
    // restart, so every stateful rule starts over — say so once.
    browser.runtime.onStartup.addListener(() => {
      void restartNoticeItem.setValue(true);
    });

    /* -------------------------------- watchdog -------------------------------- */

    // Design §5.5/§8: the debugger engine must never leave a paused request
    // hanging. The alarm exists from phase 1 so the engine only has to hook it.
    void browser.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_PERIOD_MIN });
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name !== WATCHDOG_ALARM) return;
      void ready.then(() => dnrEngine.onTrigger({ type: 'tick' })); // expire `window` session rules
      void ready.then(() => debuggerEngine.tick()); // release requests paused for > 20 s (design §5.5)
    });

    /* ----------------------------- message router ----------------------------- */

    function push(message: PushMessage): void {
      // No UI page open → "Could not establish connection" — expected, ignored.
      void browser.runtime.sendMessage(message).catch(() => undefined);
    }

    // Two classes of sender, two message families (utils/protocol.ts):
    //   - the ISOLATED relay in a tab may only send `relay:*` (untrusted input,
    //     bounded by the page engine);
    //   - privileged queries (rules, log, Network-level mode) are accepted ONLY
    //     from the extension's own pages. Web pages cannot reach this listener
    //     at all (no `externally_connectable`); the check is defence in depth.
    const extensionBase = browser.runtime.getURL('/');
    browser.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
      if (isRelayMessage(raw)) {
        if (!isRelaySender(sender, browser.runtime.id)) return false;
        // Page engine bridge: `relay:ready` is answered with `page:rules`; events become log rows / counters.
        // A page click also opens DNR `window(trigger: 'click')` rules (dnr-translate `click` trigger).
        if (raw.type === 'relay:click' && sender.tab?.id !== undefined) void ready.then(() => dnrEngine.onTrigger({ type: 'click', tabId: sender.tab!.id! })).catch(noteFailure('click'));
        void ready
          .then(() => pageEngine?.handleRelay(raw, sender))
          .then((reply) => sendResponse(reply))
          .catch(() => sendResponse(undefined));
        return true;
      }
      if (!isQueryMessage(raw)) return false;
      if (!isPrivilegedSender(sender, browser.runtime.id, extensionBase)) {
        sendResponse({ ok: false, error: 'Refused: this message is accepted only from the extension\u2019s own pages.' });
        return false;
      }
      void ready
        .then(() => handle(raw))
        .then((reply) => sendResponse(reply))
        .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true;
    });

    async function handle<T extends QueryMessage['type']>(msg: Extract<QueryMessage, { type: T }>): Promise<ReplyFor<T>> {
      return (await route(msg)) as ReplyFor<T>;
    }

    async function route(msg: QueryMessage): Promise<unknown> {
      switch (msg.type) {
        case 'getTabSummary':
          return tabSummary(msg.tabId);

        case 'listRules':
          return { ...rules, applied: appliedSummary() };

        case 'saveRule': {
          // Validated as part of the whole document (unknown group, missing
          // `afterRule` target, regex/rule/byte caps) — utils/rules-commit.ts.
          const rule = msg.rule;
          const id = typeof rule === 'object' && rule !== null ? (rule as { id?: unknown }).id : undefined;
          return commitAndApply((doc) => {
            const idx = doc.rules.findIndex((r) => r.id === id);
            const next = idx === -1 ? [...doc.rules, rule] : doc.rules.map((r, i) => (i === idx ? rule : r));
            return { ...doc, rules: next };
          });
        }

        case 'deleteRule': {
          // A rule other rules follow (`afterRule`) cannot go: the followers
          // would be invalid at the next load. Refuse with their names.
          const dependants = dependantsOf(rules, msg.ruleId);
          if (dependants.length > 0) return { ok: false, errors: [deleteBlockedError(dependants)] };
          const r = await commitAndApply((doc) => ({ ...doc, rules: doc.rules.filter((x) => x.id !== msg.ruleId) }));
          if (r.ok) await updateState((snap) => resetCounters(snap, msg.ruleId));
          return r;
        }

        case 'saveGroup': {
          const group = msg.group;
          const gid = typeof group === 'object' && group !== null ? (group as { id?: unknown }).id : undefined;
          return commitAndApply((doc) => {
            const idx = doc.groups.findIndex((g) => g.id === gid);
            const groups = idx === -1 ? [...doc.groups, group] : doc.groups.map((g, i) => (i === idx ? group : g));
            return { ...doc, groups };
          });
        }

        case 'deleteGroup':
          return commitAndApply((doc) => ({
            ...doc,
            groups: doc.groups.filter((g) => g.id !== msg.groupId),
            rules: doc.rules.map((r) => (r.groupId === msg.groupId ? { ...r, groupId: undefined } : r)),
          }));

        case 'reorderRules': {
          const ids = Array.isArray(msg.ruleIds) ? msg.ruleIds.filter((x): x is string => typeof x === 'string') : [];
          const order = new Map(ids.map((id, i) => [id, i]));
          return commitAndApply((doc) => ({
            ...doc,
            rules: doc.rules.map((r) => ({ ...r, priority: order.get(r.id) ?? r.priority })),
          }));
        }

        case 'resetCounters':
          await updateState((snap) => resetCounters(snap, msg.ruleId));
          await pageEngine?.resetCounters(msg.ruleId);
          await dnrEngine.onTrigger({ type: 'reset', ruleId: msg.ruleId });
          return { ok: true };

        case 'pauseTab': {
          if (msg.paused) pausedTabs.add(msg.tabId);
          else pausedTabs.delete(msg.tabId);
          await pausedTabsItem.setValue([...pausedTabs]);
          for (const engine of engines) {
            await (msg.paused ? engine.pauseTab(msg.tabId) : engine.resumeTab(msg.tabId)).catch(() => undefined);
          }
          return { ok: true };
        }

        case 'setNetworkLevel':
          // Opt-in per tab (design §2.7, §11): attach only here, on the user's
          // toggle; the error is the browser's own message (design §5.5).
          if (!apis.debugger) return { ok: false, error: 'Network-level mode is not available in this build.' };
          if (!msg.enabled) {
            await debuggerEngine.disableTab(msg.tabId);
            return { ok: true };
          }
          return debuggerEngine.enableTab(msg.tabId);

        case 'getLogPage': {
          await flushLog();
          const log = await logItem.getValue();
          let entries = logSince(log, msg.afterId, msg.limit ?? 500);
          if (msg.tabId !== undefined) entries = entries.filter((e) => e.tabId === msg.tabId);
          const latestId = log.entries.length ? log.entries[log.entries.length - 1]!.id : 0;
          return { entries, latestId, evicted: log.evicted, total: log.entries.length };
        }

        case 'clearLog': {
          // Rows still queued belong to the era being cleared: drop them too.
          logQueue = [];
          await logFlushing;
          await withLock(LOG_LOCK, async () => logItem.setValue(clearLog(await logItem.getValue())));
          return { ok: true };
        }

        case 'testUrl': {
          // The preview uses the SAME matcher the JS engines use (@blur/netcore)
          // — the browser's own DNR matcher is unreachable in a packaged build.
          // Method / resource type / page domain are optional: an omitted
          // filter matches every rule ("what would fire for this URL at all?").
          const method = msg.method?.toUpperCase();
          const pageHost = msg.pageDomain?.trim().toLowerCase();
          const ordered = Object.values(compiled.byEngine)
            .flat()
            .sort((a, b) => a.rule.priority - b.rule.priority || a.rule.createdAt - b.rule.createdAt);
          const matches = ordered
            .filter((c) => {
              const cond = c.rule.condition;
              if (cond.url && !matchesUrlCondition({ key: 'url', ...cond.url }, msg.url)) return false;
              if (method && cond.methods?.length && !cond.methods.includes(method as (typeof cond.methods)[number])) return false;
              if (msg.resourceType && cond.resourceTypes?.length && !cond.resourceTypes.includes(msg.resourceType)) return false;
              if (pageHost && cond.pageDomains?.length && !matchesSuffix(pageHost, cond.pageDomains.map((d) => d.toLowerCase()))) return false;
              return true;
            })
            .map((c) => ({ rule: c.rule, decision: selectEngine(c.rule, PLATFORM, caps) }));
          return { matches, first: matches[0] };
        }

        case 'getCaps':
          return { platform: PLATFORM, caps, version: browser.runtime.getManifest().version };

        case 'exportRules':
          return { text: serializeRulesDocument(rules) };

        case 'importRules': {
          const v = parseRulesImport(typeof msg.text === 'string' ? msg.text : '');
          if (v.doc.rules.length === 0 && !v.ok) return { ok: false, imported: 0, errors: v.errors };
          // The merged document is validated as a whole (caps, cross-rule
          // references) — a merge that would exceed a limit is refused, never
          // silently truncated.
          const r = await commitRules((doc) => {
            if (msg.mode === 'replace') return v.doc;
            const ids = new Set(v.doc.rules.map((r) => r.id));
            const gids = new Set(v.doc.groups.map((g) => g.id));
            return {
              version: 1,
              rules: [...doc.rules.filter((r) => !ids.has(r.id)), ...v.doc.rules],
              groups: [...doc.groups.filter((g) => !gids.has(g.id)), ...v.doc.groups],
            };
          });
          if (!r.ok) return { ok: false, imported: 0, errors: [...v.errors, ...r.errors] };
          await applyAll();
          return { ok: v.ok, imported: v.doc.rules.length, errors: v.errors };
        }

        case 'deleteAllRules': {
          const r = await commitAndApply(() => ({ version: 1, rules: [], groups: [] }));
          if (r.ok) await updateState(() => resetCounters({ counters: {}, matched: {} }));
          return r;
        }

        case 'getPermissionStatus': {
          const all = await browser.permissions.getAll();
          return {
            origins: all.origins ?? [],
            debugger: (all.permissions ?? []).includes('debugger'),
            debuggerAvailable: apis.debugger,
            dnrResponseHeaders: caps.dnrResponseHeaders,
          };
        }

        case 'siteAccessChanged':
          // `applyAll` → page engine `apply()` → re-registers the scripts for the granted origins.
          await applyAll();
          return { ok: true };

        case 'openWindowTrigger': {
          const rule = rules.rules.find((r) => r.id === msg.ruleId);
          if (rule) {
            const now = Date.now();
            await updateState((snap) => openWindow(rule, snap, { tabId: msg.tabId, url: '', now }));
            await dnrEngine.onTrigger({ type: 'manual', ruleId: msg.ruleId, tabId: msg.tabId });
          }
          return { ok: true };
        }
      }
    }

    /* ------------------------------- tab summary ------------------------------ */

    async function tabSummary(tabId: number): Promise<TabSummary> {
      const tab = await browser.tabs.get(tabId).catch(() => undefined);
      const url = tab?.url ?? '';
      let host = '';
      let restricted = true;
      try {
        const u = new URL(url);
        restricted = !/^https?:$/.test(u.protocol);
        host = u.hostname;
      } catch {
        // No URL (no tabs permission for other extensions' pages) → restricted.
      }
      const siteEnabled =
        PLATFORM === 'firefox' || restricted
          ? !restricted
          : await browser.permissions.contains({ origins: [`${new URL(url).origin}/*`] }).catch(() => false);
      const paused = pausedTabs.has(tabId);
      const snap = await stateItem.getValue();
      const nl = debuggerEngine.stats(tabId);
      const rulesStatus: TabRuleStatus[] = [];
      for (const c of Object.values(compiled.byEngine).flat()) {
        const key = countKeyOf(c.rule, { tabId, url });
        // dnr `afterRule`/`skipFirst` are armed by webRequest observation, which only fires on granted origins.
        const needsSite = c.engine === 'page' || (c.engine === 'dnr' && needsObservation(c.rule));
        // debugger rules need NL mode attached on THIS tab, not site access (design §2.8).
        const needsNl = c.engine === 'debugger';
        rulesStatus.push({
          rule: c.rule,
          engine: c.engine,
          active: !paused && (!needsSite || siteEnabled) && (!needsNl || nl.attached),
          reason: paused ? 'paused' : needsSite && !siteEnabled ? 'siteNotEnabled' : needsNl && !nl.attached ? 'needsNetworkLevel' : undefined,
          degraded: c.degraded,
          notes: c.reasons,
          // `every` rules count too (page: exact hits; dnr: ≈ observed blocks).
          counter: snap.counters[key],
          approx: c.engine === 'dnr',
        });
      }
      for (const i of compiled.inactive) {
        if (i.reason === 'disabled' || i.reason === 'groupDisabled') continue;
        rulesStatus.push({ rule: i.rule, engine: i.engine, active: false, reason: i.reason, notes: [], approx: false });
      }
      const countersResetNotice = await restartNoticeItem.getValue();
      if (countersResetNotice) await restartNoticeItem.setValue(false);
      return {
        tabId,
        host,
        restricted,
        siteEnabled,
        paused,
        networkLevel: nl.attached,
        networkLevelAvailable: apis.debugger,
        nl,
        rules: rulesStatus,
        countersResetNotice,
      };
    }

    // Keep the tool page's log size in step with the pref without a restart;
    // the page-engine switch recompiles (it changes which engine runs a rule).
    prefsItem.watch((prefs) => {
      if (!prefs) return;
      logStripQuery = prefs.logStripQuery;
      void withLock(LOG_LOCK, async () => {
        const log = await logItem.getValue();
        if (log.capacity !== prefs.logSize) await logItem.setValue(resizeLog(log, prefs.logSize));
      }).catch(noteFailure('log resize'));
      if (PLATFORM === 'chrome' && caps.page !== prefs.pageEngineEnabled) {
        caps.page = prefs.pageEngineEnabled;
        void ready.then(() => applyAll()).catch(noteFailure('apply'));
      }
    });
  },
});
