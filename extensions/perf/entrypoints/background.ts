import { defineBackground, browser } from '#imports';
import type { PageInsight, WebVital } from '@blur/core';
import type { MeasureResult, PerfMessage } from '../utils/protocol';
import type {
  LongFrameSummary,
  PageTiming,
  PerfWebVital,
  TimedNetworkEntry,
} from '../utils/perf-types';
import { emptyLongFrameSummary } from '../utils/perf-types';
import { measureExactBytes } from '../utils/debugger-bytes';

// Real message router for `PerfProtocol` (PLAN.md §7–§9). Live vitals and
// Resource-Timing insight are pushed here by the ISOLATED relay content script
// and cached per tab; the popup and DevTools panel query them. Exact bytes are
// measured on demand from the popup via the opt-in Chrome debugger (Firefox has
// no exact path and falls back to Resource Timing).

interface TabState {
  vitals: Map<WebVital['name'], PerfWebVital>;
  insight: PageInsight | null;
  entries: TimedNetworkEntry[];
  /** Navigation Timing phases; null until the page reports them. */
  timing: PageTiming | null;
  longFrames: LongFrameSummary;
}

/** JSON-serialisable mirror of TabState (a Map can't be stored directly). */
interface StoredTabState {
  vitals: PerfWebVital[];
  insight: PageInsight | null;
  entries: TimedNetworkEntry[];
  timing: PageTiming | null;
  longFrames: LongFrameSummary;
}

export default defineBackground({
  main() {
    // In-memory cache. The MV3 service worker is evicted (~30 s idle), which wipes
    // this Map even for a fully-measured page — so every push is mirrored to
    // storage.session (a device-local, tab-lifetime store) and the query handlers
    // fall back to it when the cache is cold after a restart (bug 1a).
    const tabs = new Map<number, TabState>();

    // storage.session survives SW eviction but not a browser restart — the right
    // lifetime for per-tab measurements. Firefox < 115 lacks it, so fall back to
    // storage.local (which we then clear on tab close / navigation to avoid leaks).
    const store = browser.storage.session ?? browser.storage.local;
    // True only on the storage.local fallback path — session auto-clears on restart
    // and never leaks (bug 1g); local does, so it needs the startup prune below.
    const usingLocalFallback = !browser.storage.session;

    // Tabs whose cache was just cleared (navigation / tab close). While a tabId is
    // here, getState must NOT rehydrate from storage — a query racing a forget()
    // could otherwise read the pre-navigation record before store.remove lands and
    // resurrect the old page's LCP (bug 1f). The next real push clears the flag.
    const forgotten = new Set<number>();
    // Trailing debounce handles per tab so a burst of pushes (insight 200ms,
    // longframe 300ms, each vital) coalesces into one disk write (bug 1h).
    const persistTimers = new Map<number, ReturnType<typeof setTimeout>>();

    const PERSIST_DEBOUNCE_MS = 600;

    function keyFor(tabId: number): string {
      return `perf:tab:${tabId}`;
    }

    function stateFor(tabId: number): TabState {
      // A real push arriving — this tab is live again, so lift any forget() guard
      // and let storage rehydration resume after the next SW eviction.
      forgotten.delete(tabId);
      let s = tabs.get(tabId);
      if (!s) {
        s = {
          vitals: new Map(),
          insight: null,
          entries: [],
          timing: null,
          longFrames: emptyLongFrameSummary(),
        };
        tabs.set(tabId, s);
      }
      return s;
    }

    function persist(tabId: number, _s: TabState): void {
      // Trailing debounce: coalesce a burst of pushes into one write. The timer
      // reads the freshest cached state when it fires, so no update is lost.
      if (persistTimers.has(tabId)) return;
      const handle = globalThis.setTimeout(() => {
        persistTimers.delete(tabId);
        const cur = tabs.get(tabId);
        if (!cur) return;
        const stored: StoredTabState = {
          vitals: [...cur.vitals.values()],
          insight: cur.insight,
          entries: cur.entries,
          timing: cur.timing,
          longFrames: cur.longFrames,
        };
        // Fire-and-forget: a dropped write is re-sent on the next push, and the
        // cache is authoritative while the worker is alive.
        void store.set({ [keyFor(tabId)]: stored }).catch(() => undefined);
      }, PERSIST_DEBOUNCE_MS);
      persistTimers.set(tabId, handle);
    }

    function forget(tabId: number): void {
      tabs.delete(tabId);
      // Suppress storage rehydration until the next real push, so a query racing
      // this forget() can't re-seed the cache from the pre-navigation record.
      forgotten.add(tabId);
      // Cancel any pending debounced write so it can't re-create the removed key.
      const pending = persistTimers.get(tabId);
      if (pending !== undefined) {
        globalThis.clearTimeout(pending);
        persistTimers.delete(tabId);
      }
      void store.remove(keyFor(tabId)).catch(() => undefined);
    }

    async function getState(tabId: number): Promise<TabState | null> {
      const mem = tabs.get(tabId);
      if (mem) return mem;
      // Cold cache after SW eviction — rehydrate from storage.
      try {
        const got = await store.get(keyFor(tabId));
        // A push may have populated the cache while the get was in flight; that
        // live entry is newer than this snapshot, so prefer it and never clobber
        // it with stale storage (bug 1e).
        const live = tabs.get(tabId);
        if (live) return live;
        // A forget() (navigation / tab close) raced this rehydrate — the stored
        // record is the OLD page's, so refuse to resurrect it (bug 1f).
        if (forgotten.has(tabId)) return null;
        const stored = got[keyFor(tabId)] as StoredTabState | undefined;
        if (!stored) return null;
        const s: TabState = {
          vitals: new Map(stored.vitals.map((v) => [v.name, v])),
          insight: stored.insight,
          entries: stored.entries,
          // Records written before this field existed rehydrate with no timing.
          timing: stored.timing ?? null,
          longFrames: stored.longFrames,
        };
        tabs.set(tabId, s);
        return s;
      } catch {
        return null;
      }
    }

    // Firefox storage.local fallback only: session storage auto-clears on restart,
    // but local persists, leaking perf:tab:<id> keys across restarts and letting a
    // reused tabId rehydrate a prior session's data (bug 1g). On startup, drop any
    // stored key whose tab is no longer open.
    async function pruneStaleTabKeys(): Promise<void> {
      if (!usingLocalFallback) return;
      try {
        const all = await store.get(null);
        const open = new Set(
          (await browser.tabs.query({}))
            .map((t) => t.id)
            .filter((id): id is number => id !== undefined),
        );
        const prefix = 'perf:tab:';
        const stale = Object.keys(all).filter((k) => {
          if (!k.startsWith(prefix)) return false;
          const id = Number(k.slice(prefix.length));
          return Number.isInteger(id) && !open.has(id);
        });
        if (stale.length > 0) {
          void store.remove(stale).catch(() => undefined);
        }
      } catch {
        // Best-effort cleanup — a failure just leaves the keys for next startup.
      }
    }
    void pruneStaleTabKeys();

    browser.tabs.onRemoved.addListener((tabId) => {
      forget(tabId);
    });

    browser.runtime.onMessage.addListener(
      (message: PerfMessage, sender, sendResponse) => {
        switch (message.type) {
          case 'perf:navigated': {
            // A fresh document — clear the previous page's vitals for this tab so
            // its LCP can't leak into the new one.
            const tabId = sender.tab?.id;
            if (tabId !== undefined) {
              forget(tabId);
            }
            sendResponse(true);
            return true;
          }
          case 'perf:vital': {
            const tabId = sender.tab?.id;
            if (tabId !== undefined) {
              const s = stateFor(tabId);
              s.vitals.set(message.vital.name, message.vital);
              persist(tabId, s);
            }
            sendResponse(true);
            return true;
          }
          case 'perf:insight': {
            const tabId = sender.tab?.id;
            if (tabId !== undefined) {
              const s = stateFor(tabId);
              s.insight = message.insight;
              s.entries = message.entries;
              persist(tabId, s);
            }
            sendResponse(true);
            return true;
          }
          case 'perf:timing': {
            const tabId = sender.tab?.id;
            if (tabId !== undefined) {
              const s = stateFor(tabId);
              s.timing = message.timing;
              persist(tabId, s);
            }
            sendResponse(true);
            return true;
          }
          case 'perf:longframes': {
            const tabId = sender.tab?.id;
            if (tabId !== undefined) {
              const s = stateFor(tabId);
              s.longFrames = message.summary;
              persist(tabId, s);
            }
            sendResponse(true);
            return true;
          }
          case 'getWebVitals':
            void getState(message.tabId).then((s) =>
              sendResponse(s ? [...s.vitals.values()] : []),
            );
            return true;
          case 'getPageInsight':
            void getState(message.tabId).then((s) =>
              sendResponse(s?.insight ?? null),
            );
            return true;
          case 'getNetworkEntries':
            void getState(message.tabId).then((s) =>
              sendResponse(s?.entries ?? []),
            );
            return true;
          case 'getPageTiming':
            void getState(message.tabId).then((s) => sendResponse(s?.timing ?? null));
            return true;
          case 'getLongFrames':
            void getState(message.tabId).then((s) =>
              sendResponse(s?.longFrames ?? emptyLongFrameSummary()),
            );
            return true;
          case 'measureExactBytes': {
            void (async () => {
              const result = await measureForTab(message.tabId);
              sendResponse(result);
            })();
            // Async responder — keep the channel open (PLAN.md §13).
            return true;
          }
        }
      },
    );

    async function measureForTab(tabId: number): Promise<MeasureResult> {
      const s = await getState(tabId);
      const hostname = s?.insight?.hostname ?? (await hostnameForTab(tabId));
      return measureExactBytes(tabId, hostname);
    }

    async function hostnameForTab(tabId: number): Promise<string> {
      try {
        const tab = await browser.tabs.get(tabId);
        return tab.url ? new URL(tab.url).hostname : '';
      } catch {
        return '';
      }
    }
  },
});
