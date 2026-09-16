import type { CompiledRule, CompiledRuleSet } from '../engine-select';
import { selectEngine, type EngineCaps } from '../engine-select';
import type { LogInput, LogMark } from '../log';
import { hostOf } from '@blur/netcore';
import { fromFirefoxType } from '../resource-types';
import type { Rule } from '../rule-types';
import {
  evaluateRequest,
  hasResponseStage,
  isPageTraffic,
  needsResponseHeaders,
  typesFilterFor,
  type EvalContext,
  type WrBlockingResponse,
  type WrRequestDetails,
  type WrStage,
} from '../webrequest-eval';
import { StateCache, type StateStore } from '../webrequest-state';
import { EngineEvents, type Engine, type EngineEventListener } from './types';

// Firefox — blocking `webRequest`, the ONE engine there (desktop + Android).
// Plan: docs/plans/netblock/02-webrequest.md. Pure parts live in
// utils/webrequest-eval.ts (matching, decisions, BlockingResponse) and
// utils/webrequest-state.ts (in-memory counters with write-through); this file
// is the glue to `browser.webRequest` / `browser.tabs` and the event fan-out.
//
// Shape (plan §1.1):
//   onBeforeRequest   [blocking]                 request-stage rules
//   onHeadersReceived [blocking(,responseHeaders)] response-stage rules
//   onCompleted / onErrorOccurred                one log row per request,
//                                                release of pending delays
// Both blocking listeners answer SYNCHRONOUSLY unless the decision needs a
// delay or the state cache is still cold (first request after start, ≤200 ms):
// an async blocking listener costs ≈25 ms per request (spike S2).
//
// AMO honesty: no `redirectUrl`, no header mutation, no remote code — the
// listener can only cancel or wait, and the manifest says so.
//
// This module must load in Node (e2e/netblock/logic.test.mjs imports
// engines/index.ts), so it never imports `#imports` or `../storage`
// statically: the browser comes from `globalThis`, storage is a dynamic
// import on the first `apply()` (Vite inlines it into the IIFE bundle).

/* ------------------------------ browser API ------------------------------ */

type Listener<D> = (details: D) => unknown;
interface WrEvent<D> {
  addListener(cb: Listener<D>, filter: { urls: string[]; types?: string[] }, extra?: string[]): void;
  removeListener(cb: Listener<D>): void;
  hasListener(cb: Listener<D>): boolean;
}
interface TabEvent<A extends unknown[]> {
  addListener(cb: (...args: A) => void): void;
  removeListener(cb: (...args: A) => void): void;
}
interface CompletedDetails extends WrRequestDetails {
  error?: string;
}
interface WrApi {
  webRequest: {
    onBeforeRequest: WrEvent<WrRequestDetails>;
    onHeadersReceived: WrEvent<WrRequestDetails>;
    onCompleted: WrEvent<CompletedDetails>;
    onErrorOccurred: WrEvent<CompletedDetails>;
  };
  tabs: {
    query(q: { active: boolean }): Promise<{ id?: number; windowId?: number }[]>;
    onActivated: TabEvent<[{ tabId: number; windowId: number }]>;
    onRemoved: TabEvent<[number]>;
  };
}

function hasBrowserGlobal(): boolean {
  const g = globalThis as { browser?: unknown; chrome?: unknown };
  return g.browser !== undefined || g.chrome !== undefined;
}

/** The APIs this engine needs, or undefined when the runtime lacks them. */
function detectApi(): WrApi | undefined {
  const g = globalThis as { browser?: Partial<WrApi>; chrome?: Partial<WrApi> };
  const b = g.browser ?? g.chrome;
  const wr = b?.webRequest;
  if (!wr?.onBeforeRequest || !wr.onHeadersReceived || !wr.onCompleted || !wr.onErrorOccurred) return undefined;
  if (!b?.tabs?.onActivated || !b.tabs.onRemoved || typeof b.tabs.query !== 'function') return undefined;
  return b as WrApi;
}

/* ------------------------------- bookkeeping ----------------------------- */

/** What the engine did to a request, kept until `onCompleted`/`onErrorOccurred`. */
interface Inflight {
  at: number;
  ruleId: string;
  delayMs?: number;
  degraded?: LogMark;
  /** The row was already emitted at decision time (cancelled requests). */
  logged: boolean;
}

/** Cold-read budget (design §8): a request never waits longer for counters. */
export const STATE_COLD_TIMEOUT_MS = 200;
/** Bound on the per-request bookkeeping map, so a lost completion cannot leak. */
const INFLIGHT_MAX = 2000;
const INFLIGHT_TTL_MS = 120_000;

export function createWebRequestEngine(caps: EngineCaps, hasApi: boolean): Engine {
  const events = new EngineEvents();
  const api = detectApi();
  // Outside a browser (Node tests) the background's flag is the only truth;
  // inside one the API must really be there.
  const available = hasApi && (api !== undefined || !hasBrowserGlobal());

  let rules: CompiledRule[] = [];
  let registration: string | null = null;
  let observing = false;
  let cache: StateCache | null = null;
  let storeLoading: Promise<void> | null = null;
  let unwatch: (() => void) | null = null;
  const paused = new Set<number>();
  const activeByWindow = new Map<number, number>();
  const activeTabs = new Set<number>();
  const inflight = new Map<string, Inflight>();
  const delays = new Map<string, () => void>();

  const error = (message: string, ruleId?: string): void => events.emit({ type: 'error', message, ruleId });

  /* ------------------------------ storage glue ----------------------------- */

  async function loadStore(): Promise<void> {
    // Dynamic on purpose (see header). Inlined by Vite in the extension bundle.
    const s = await import('../storage');
    const store: StateStore = {
      read: () => s.stateItem.getValue(),
      write: (mutate) => s.updateState(mutate),
    };
    cache = new StateCache(store, { timeoutMs: STATE_COLD_TIMEOUT_MS, onError: error });
    // Background resets (navigation, manual, tab closed) reach the mirror here.
    unwatch = s.stateItem.watch((next) => {
      if (next) cache?.setBase(next);
    });
    for (const id of await s.pausedTabsItem.getValue()) paused.add(id);
    void cache.ready();
  }

  function ensureStore(): Promise<void> {
    if (!storeLoading) {
      storeLoading = loadStore().catch((err: unknown) => {
        // No storage → stateless operation from an empty mirror; say so once.
        error(`state store unavailable: ${err instanceof Error ? err.message : String(err)}`);
        cache = new StateCache(
          { read: async () => ({ counters: {}, matched: {} }), write: async (m) => m({ counters: {}, matched: {} }) },
          { timeoutMs: STATE_COLD_TIMEOUT_MS, onError: error },
        );
      });
    }
    return storeLoading;
  }

  /* -------------------------------- tabs ---------------------------------- */

  const onActivated = ({ tabId, windowId }: { tabId: number; windowId: number }): void => {
    const prev = activeByWindow.get(windowId);
    if (prev !== undefined) activeTabs.delete(prev);
    activeByWindow.set(windowId, tabId);
    activeTabs.add(tabId);
  };
  const onTabRemoved = (tabId: number): void => {
    paused.delete(tabId);
    activeTabs.delete(tabId);
    for (const [w, t] of activeByWindow) if (t === tabId) activeByWindow.delete(w);
  };

  async function startObserving(): Promise<void> {
    if (observing || !api) return;
    observing = true;
    api.tabs.onActivated.addListener(onActivated);
    api.tabs.onRemoved.addListener(onTabRemoved);
    api.webRequest.onCompleted.addListener(onCompleted, { urls: ['<all_urls>'] });
    api.webRequest.onErrorOccurred.addListener(onErrorOccurred, { urls: ['<all_urls>'] });
    try {
      for (const t of await api.tabs.query({ active: true })) {
        if (t.id !== undefined && t.windowId !== undefined) onActivated({ tabId: t.id, windowId: t.windowId });
      }
    } catch {
      // No tabs yet (startup) — onActivated fills the set as the user goes.
    }
  }

  function stopObserving(): void {
    if (!observing || !api) return;
    observing = false;
    api.tabs.onActivated.removeListener(onActivated);
    api.tabs.onRemoved.removeListener(onTabRemoved);
    api.webRequest.onCompleted.removeListener(onCompleted);
    api.webRequest.onErrorOccurred.removeListener(onErrorOccurred);
  }

  /* ------------------------------ registration ----------------------------- */

  function unregisterBlocking(): void {
    if (!api) return;
    if (api.webRequest.onBeforeRequest.hasListener(onBeforeRequest)) api.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
    if (api.webRequest.onHeadersReceived.hasListener(onHeadersReceived)) api.webRequest.onHeadersReceived.removeListener(onHeadersReceived);
    registration = null;
  }

  function registerBlocking(list: readonly CompiledRule[]): void {
    if (!api) return;
    const types = typesFilterFor(list);
    const response = hasResponseStage(list);
    const headers = needsResponseHeaders(list);
    const key = list.length === 0 ? '' : JSON.stringify({ types, response, headers });
    if (key === registration) return;
    unregisterBlocking();
    if (list.length === 0) return;
    const filter = types ? { urls: ['<all_urls>'], types } : { urls: ['<all_urls>'] };
    api.webRequest.onBeforeRequest.addListener(onBeforeRequest, filter, ['blocking']);
    if (response) {
      // `responseHeaders` copies every header of every response into JS —
      // only pay for it when a rule actually looks at headers.
      api.webRequest.onHeadersReceived.addListener(onHeadersReceived, filter, headers ? ['blocking', 'responseHeaders'] : ['blocking']);
    }
    registration = key;
  }

  /* ------------------------------- listeners ------------------------------- */

  function ctx(): EvalContext {
    return { now: Date.now(), pausedTabs: paused, activeTabs };
  }

  function track(requestId: string, entry: Inflight): void {
    if (inflight.size >= INFLIGHT_MAX) {
      const cutoff = entry.at - INFLIGHT_TTL_MS;
      for (const [id, e] of inflight) {
        if (e.at > cutoff && inflight.size < INFLIGHT_MAX) break;
        inflight.delete(id);
      }
    }
    inflight.set(requestId, entry);
  }

  function sleepFor(requestId: string, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        delays.delete(requestId);
        resolve();
      }
      // `onErrorOccurred` (tab closed, navigation) and `dispose()` release it early.
      delays.set(requestId, done);
    });
  }

  function decideNow(details: WrRequestDetails, stage: WrStage): WrBlockingResponse | Promise<WrBlockingResponse> | undefined {
    const c = cache;
    if (!c) return undefined;
    const res = evaluateRequest(details, stage, rules, c.snapshot(), ctx());
    if (res.kind === 'skip') return undefined;
    void c.commit(res.deltas);
    if (res.kind === 'pass') return undefined;

    const rule = res.rule.rule;
    const degraded = res.degraded;
    events.emit({ type: 'hit', ruleId: rule.id, tabId: details.tabId, url: details.url, approx: false, degraded });
    const entry: Inflight = { at: Date.now(), ruleId: rule.id, logged: false };
    if (degraded) entry.degraded = 'degraded';

    if (res.delayMs !== undefined) {
      entry.delayMs = res.delayMs;
      track(details.requestId, entry);
      return sleepFor(details.requestId, res.delayMs).then(() => ({}));
    }
    // Cancelled: the browser may or may not report it through onErrorOccurred
    // — log now, and ignore the later report if it comes.
    entry.logged = true;
    track(details.requestId, entry);
    emitLog(details, {
      outcome: res.action.type === 'fail' ? 'failed' : 'blocked',
      ruleId: rule.id,
      marks: entry.degraded ? ['degraded'] : [],
    });
    return res.response;
  }

  function blocking(details: WrRequestDetails, stage: WrStage): WrBlockingResponse | Promise<WrBlockingResponse> | undefined {
    try {
      if (rules.length === 0 || !isPageTraffic(details)) return undefined;
      if (details.tabId >= 0 && paused.has(details.tabId)) return undefined;
      // Cold mirror: wait for the counters, but never past the 200 ms budget
      // (design §8) — after that the request proceeds from an empty snapshot.
      if (!cache || !cache.warm) {
        return ensureStore()
          .then(() => cache!.ready())
          .then(() => decideNow(details, stage) ?? {})
          .catch((err: unknown) => {
            error(`listener failed: ${err instanceof Error ? err.message : String(err)}`);
            return {};
          });
      }
      return decideNow(details, stage);
    } catch (err) {
      // Fail-open: a bug here must never hang or block a request.
      error(`listener failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  const onBeforeRequest: Listener<WrRequestDetails> = (details) => blocking(details, 'request');
  const onHeadersReceived: Listener<WrRequestDetails> = (details) => blocking(details, 'response');

  function emitLog(
    details: WrRequestDetails,
    over: { outcome: LogInput['outcome']; ruleId?: string; marks: LogMark[]; error?: string; delayMs?: number; status?: number },
  ): void {
    const entry: LogInput = {
      time: Date.now(),
      tabId: details.tabId,
      method: details.method,
      url: details.url,
      type: fromFirefoxType(details.type),
      outcome: over.outcome,
      marks: over.marks,
    };
    if (over.status !== undefined) entry.status = over.status;
    // Same source `ruleMatches` uses for `pageDomains` (originUrl, then documentUrl).
    const initiatorHost = hostOf(details.originUrl ?? details.documentUrl);
    if (initiatorHost) entry.initiatorHost = initiatorHost;
    if (over.ruleId !== undefined) {
      entry.ruleId = over.ruleId;
      entry.engine = 'webrequest';
    }
    if (over.error !== undefined) entry.error = over.error;
    if (over.delayMs !== undefined) entry.delayMs = over.delayMs;
    events.emit({ type: 'log', entry });
  }

  const onCompleted: Listener<CompletedDetails> = (details) => {
    const f = inflight.get(details.requestId);
    inflight.delete(details.requestId);
    // Rows are page traffic only: tab-less requests (service workers, browser
    // plumbing) are still subject to rules but would only be noise in a
    // per-tab log.
    if (f?.logged || details.tabId < 0 || !isPageTraffic(details)) return;
    emitLog(details, {
      outcome: f?.delayMs !== undefined ? 'delayed' : 'passed',
      ruleId: f?.ruleId,
      delayMs: f?.delayMs,
      status: details.statusCode,
      marks: f?.degraded ? ['degraded'] : [],
    });
  };

  const onErrorOccurred: Listener<CompletedDetails> = (details) => {
    delays.get(details.requestId)?.();
    const f = inflight.get(details.requestId);
    inflight.delete(details.requestId);
    if (f?.logged || details.tabId < 0 || !isPageTraffic(details)) return;
    emitLog(details, {
      outcome: 'error',
      ruleId: f?.ruleId,
      delayMs: f?.delayMs,
      error: details.error,
      marks: f?.degraded ? ['degraded'] : [],
    });
  };

  /* -------------------------------- engine --------------------------------- */

  return {
    id: 'webrequest',
    available,
    supports(rule: Rule): boolean {
      return selectEngine(rule, 'firefox', caps).engine === 'webrequest';
    },
    async apply(set: CompiledRuleSet): Promise<void> {
      rules = set.byEngine.webrequest;
      if (!available || !api) {
        if (rules.length > 0) error('blocking webRequest is not available in this browser');
        return;
      }
      await ensureStore();
      await startObserving();
      registerBlocking(rules);
    },
    async pauseTab(tabId: number): Promise<void> {
      paused.add(tabId);
    },
    async resumeTab(tabId: number): Promise<void> {
      paused.delete(tabId);
    },
    async dispose(): Promise<void> {
      rules = [];
      unregisterBlocking();
      stopObserving();
      // Fail-open: nothing may stay parked in a delay after we are gone.
      for (const release of [...delays.values()]) release();
      delays.clear();
      inflight.clear();
      unwatch?.();
      unwatch = null;
      cache?.reset();
      cache = null;
      storeLoading = null;
      paused.clear();
      activeTabs.clear();
      activeByWindow.clear();
    },
    onEvent(listener: EngineEventListener): () => void {
      return events.subscribe(listener);
    },
  };
}
