import { attachCdp, errorMessage, type CdpSession, type DebuggerApi } from '@blur/netcore';
import {
  evaluatePaused,
  fetchPatternsFor,
  nextErrorCount,
  patternsCover,
  stageOfEvent,
  stalled,
  type CdpCommand,
  type DbgContext,
  type FetchPattern,
  type PendingRequest,
  type RequestPausedParams,
} from '../debugger-eval';
import type { CompiledRule, CompiledRuleSet } from '../engine-select';
import { selectEngine, type EngineCaps } from '../engine-select';
import { OWN_REASON, type LogInput } from '../log';
import { fromCdpType } from '../resource-types';
import type { Rule } from '../rule-types';
import type { StateSnapshot } from '../state';
import { StateCache, type StateStore } from '../webrequest-state';
import { EngineEvents, type Engine, type EngineEventListener } from './types';

// L3 — `chrome.debugger` + CDP `Fetch`: "Network-level mode" (NL), Chrome only.
// Plan: docs/plans/netblock/02-debugger.md. The pure decision layer is
// utils/debugger-eval.ts; this file owns the sessions, the paused-request
// bookkeeping and the fail-open guarantees.
//
// Reviewer-facing summary of what this engine does with `debugger`: it
// attaches to ONE tab, only after the user switched Network-level mode on for
// that tab in the popup (consent dialog, design §2.7), enables `Fetch` for the
// URL patterns / resource types of the user's own rules, and answers every
// `Fetch.requestPaused` with exactly one of continueRequest / failRequest /
// fulfillRequest. It never reads a response body (`Fetch.getResponseBody` is
// not called anywhere — design §7.2), never rewrites URLs or headers of real
// requests, never attaches on its own initiative (design §11), and detaches on
// toggle-off, tab close, three consecutive handler errors, and `dispose()`.
//
// Fail-open (design §8): a paused request NEVER outlives its handler without a
// decision — `finally` continues it; a rejected fulfil/fail is followed by a
// continue; the background's 30 s watchdog calls `tick()` and releases anything
// older than 20 s (design §5.5).
//
// This module carries no browser globals and no `#imports`: everything
// (`chrome.debugger`, `chrome.tabs`, storage, prefs) is injected through
// `configure()` by the background under `if (!import.meta.env.FIREFOX)`, so the
// Firefox bundle contains no `.debugger.` reference and the Node tests drive
// it with a fake CDP.

/* ------------------------------- injected ------------------------------- */

export interface DbgTabsApi {
  get(tabId: number): Promise<{ url?: string; active?: boolean; windowId?: number }>;
  query(q: { active: boolean }): Promise<{ id?: number; windowId?: number }[]>;
  onActivated: { addListener(cb: (info: { tabId: number; windowId: number }) => void): void };
  onUpdated: { addListener(cb: (tabId: number, info: { status?: string; url?: string }) => void): void };
}

export interface DebuggerDeps {
  api: DebuggerApi;
  tabs: DbgTabsApi;
  /** Counters (`session:state`): read + RMW under the state lock. */
  state: StateStore;
  /** Background resets reach the mirror through this (stateItem.watch). */
  watchState?: (cb: (snap: StateSnapshot) => void) => () => void;
  /** `session:nlTabs` — attached tab ids, for the popup and the restart reconcile. */
  nlTabs: { get(): Promise<number[]>; set(ids: number[]): Promise<void> };
  prefs: () => Promise<{ nlSticky: boolean }>;
  isPaused(tabId: number): boolean;
}

export type EnableResult = { ok: true } | { ok: false; error: string };

export interface NlTabStats {
  attached: boolean;
  intercepted: number;
  applied: number;
  lastDetachReason?: string;
}

/** The engine plus the NL-specific entry points the background hooks up. */
export interface DebuggerEngine extends Engine {
  configure(deps: DebuggerDeps): void;
  /** Attach + `Fetch.enable`. The error is the browser's own message (design §5.5 toast). */
  enableTab(tabId: number): Promise<EnableResult>;
  /** Release everything, detach. No `detached` event — this is the user's choice. */
  disableTab(tabId: number): Promise<void>;
  isAttached(tabId: number): boolean;
  attachedTabs(): number[];
  stats(tabId: number): NlTabStats;
  /** Watchdog (background alarm, 30 s): release requests paused > 20 s. */
  tick(now?: number): Promise<void>;
}

/* ------------------------------- constants ------------------------------ */

/** Cold-read budget for the counter mirror (design §8). */
export const STATE_COLD_TIMEOUT_MS = 200;
/** Reason string for the auto-detach after repeated handler failures (design §8). */
export const HANDLER_ERRORS_REASON = OWN_REASON.handlerErrors;
/** Bound on the "delayed at Request stage" memory so a lost Response stage cannot leak. */
const DELAYED_MAX = 2000;

interface TabSession {
  session: CdpSession;
  /** Host of the top-level document (for `pageDomains`). */
  host: string;
  /** JSON of the last `Fetch.enable` patterns — idempotent re-apply. */
  patternsKey: string | null;
  errors: number;
  intercepted: number;
  applied: number;
}

interface Pending extends PendingRequest {
  url: string;
  method: string;
  type: string;
  /** Delay parking: resolve(false) releases early. */
  release?: (completed: boolean) => void;
}

const CONTINUE = (requestId: string): CdpCommand => ({ method: 'Fetch.continueRequest', params: { requestId } });

export function createDebuggerEngine(caps: EngineCaps, hasApi: boolean): DebuggerEngine {
  const events = new EngineEvents();
  let deps: DebuggerDeps | undefined;
  let rules: CompiledRule[] = [];
  let patterns: FetchPattern[] = [];
  let logHeaders = false;
  let cache: StateCache | null = null;
  let unwatch: (() => void) | null = null;
  let reconciled = false;
  const sessions = new Map<number, TabSession>();
  const pending = new Map<string, Pending>();
  const lastDetach = new Map<number, string>();
  const paused = new Set<number>();
  const activeByWindow = new Map<number, number>();
  const activeTabs = new Set<number>();
  /** networkId → delayMs: delayed at Request stage, logged at Response stage. */
  const delayed = new Map<string, number>();

  const error = (message: string, extra: { ruleId?: string; tabId?: number } = {}): void =>
    events.emit({ type: 'error', message, ...extra });

  /* ------------------------------- state ------------------------------- */

  function ensureCache(): StateCache {
    if (cache) return cache;
    const store: StateStore = deps?.state ?? {
      read: async () => ({ counters: {}, matched: {} }),
      write: async (m) => m({ counters: {}, matched: {} }),
    };
    cache = new StateCache(store, { timeoutMs: STATE_COLD_TIMEOUT_MS, onError: (m) => error(`debugger engine: ${m}`) });
    unwatch = deps?.watchState?.((snap) => cache?.setBase(snap)) ?? null;
    return cache;
  }

  /* -------------------------------- tabs -------------------------------- */

  const onActivated = ({ tabId, windowId }: { tabId: number; windowId: number }): void => {
    const prev = activeByWindow.get(windowId);
    if (prev !== undefined) activeTabs.delete(prev);
    activeByWindow.set(windowId, tabId);
    activeTabs.add(tabId);
  };

  async function seedActiveTabs(): Promise<void> {
    try {
      for (const t of (await deps?.tabs.query({ active: true })) ?? []) {
        if (t.id !== undefined && t.windowId !== undefined) onActivated({ tabId: t.id, windowId: t.windowId });
      }
    } catch {
      // No tabs yet — onActivated fills the set as the user goes.
    }
  }

  function hostOf(url: string | undefined): string {
    if (!url) return '';
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  const onUpdated = (tabId: number, info: { status?: string; url?: string }): void => {
    const ts = sessions.get(tabId);
    if (ts && info.url) ts.host = hostOf(info.url);
    if (info.status !== 'loading' || ts) return;
    // `nlSticky`: a tab that was in NL mode but lost its session (worker
    // restart) gets it back on its next load — unless the user pressed Cancel.
    void (async () => {
      if (!deps || lastDetach.get(tabId) === 'canceled_by_user') return;
      const [prefs, nl] = await Promise.all([deps.prefs(), deps.nlTabs.get()]);
      if (prefs.nlSticky && nl.includes(tabId) && !sessions.has(tabId)) {
        const r = await enableTab(tabId);
        if (!r.ok) await setNlTab(tabId, false);
      }
    })();
  };

  async function setNlTab(tabId: number, on: boolean): Promise<void> {
    if (!deps) return;
    try {
      const cur = await deps.nlTabs.get();
      const next = on ? (cur.includes(tabId) ? cur : [...cur, tabId]) : cur.filter((id) => id !== tabId);
      if (next.length !== cur.length || on !== cur.includes(tabId)) await deps.nlTabs.set(next);
    } catch (e) {
      error(`debugger engine: nlTabs write failed: ${errorMessage(e)}`, { tabId });
    }
  }

  /** First apply after a worker start: sessions died with the worker, `nlTabs` did not. */
  async function reconcile(): Promise<void> {
    if (reconciled || !deps) return;
    reconciled = true;
    let ids: number[] = [];
    try {
      ids = await deps.nlTabs.get();
    } catch {
      return;
    }
    const stale = ids.filter((id) => !sessions.has(id));
    if (stale.length === 0) return;
    let sticky = false;
    try {
      sticky = (await deps.prefs()).nlSticky;
    } catch {
      // default: not sticky
    }
    for (const id of stale) {
      const r = sticky ? await enableTab(id) : { ok: false as const, error: '' };
      if (!r.ok) await setNlTab(id, false);
    }
  }

  /* ------------------------------ sessions ------------------------------ */

  function ctxFor(tabId: number, ts: TabSession): DbgContext {
    return {
      now: Date.now(),
      tabId,
      tabHost: ts.host,
      paused: paused.has(tabId) || (deps?.isPaused(tabId) ?? false),
      isActiveTab: activeTabs.has(tabId),
    };
  }

  async function applyPatterns(tabId: number, ts: TabSession): Promise<void> {
    const key = patterns.length === 0 ? '' : JSON.stringify(patterns);
    if (key === ts.patternsKey) return;
    if (patterns.length === 0) {
      // An EMPTY `patterns` array is not "nothing" to Chrome ("If not set, all
      // requests will be affected") — disable the domain instead.
      await ts.session.send('Fetch.disable');
    } else {
      await ts.session.send('Fetch.enable', { patterns, handleAuthRequests: false });
    }
    ts.patternsKey = key;
  }

  /** Release every paused request of a tab (detach, disable, dispose). */
  async function releaseAll(tabId: number, sendContinue: boolean): Promise<void> {
    const ts = sessions.get(tabId);
    for (const [key, p] of [...pending]) {
      if (p.tabId !== tabId) continue;
      pending.delete(key);
      // A parked delay wakes up and steps aside (its handler sends nothing);
      // an in-progress handler is continued from here and its own `finally`
      // finds nothing left to do.
      p.release?.(false);
      if (sendContinue && ts?.session.attached) {
        await ts.session.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => undefined);
      }
    }
  }

  async function enableTab(tabId: number): Promise<EnableResult> {
    if (!deps) return { ok: false, error: 'Network-level mode is not available in this build.' };
    if (sessions.has(tabId)) return { ok: true };
    const r = await attachCdp(deps.api, tabId, {
      onEvent: (method, params) => {
        if (method === 'Fetch.requestPaused') void onPaused(tabId, params as unknown as RequestPausedParams);
        else if (method === 'Page.frameNavigated') {
          // Main frame only (no parentId): the page host for `pageDomains`.
          const frame = params.frame as { parentId?: string; url?: string } | undefined;
          const ts = sessions.get(tabId);
          if (ts && frame && frame.parentId === undefined) ts.host = hostOf(frame.url);
        }
      },
      onDetach: (reason) => void onBrowserDetach(tabId, reason),
    });
    if (!r.ok) return { ok: false, error: r.error };
    const ts: TabSession = { session: r.session, host: '', patternsKey: null, errors: 0, intercepted: 0, applied: 0 };
    sessions.set(tabId, ts);
    lastDetach.delete(tabId);
    try {
      // The tab's URL is hidden from `tabs.get` without host access, but the
      // debugger session sees it (Page.getFrameTree, no Page.enable needed);
      // `Page.enable` then keeps it current across navigations.
      type FrameTree = { frameTree?: { frame?: { url?: string } } };
      const tree = await r.session.send<FrameTree>('Page.getFrameTree').catch((): FrameTree => ({}));
      ts.host = hostOf(tree.frameTree?.frame?.url) || hostOf((await deps.tabs.get(tabId).catch(() => ({ url: undefined }))).url);
      await r.session.send('Page.enable').catch(() => undefined);
      await seedActiveTabs();
      ensureCache();
      await applyPatterns(tabId, ts);
      await setNlTab(tabId, true);
      return { ok: true };
    } catch (e) {
      // Attached but could not arm Fetch: do not leave a banner-only session behind.
      sessions.delete(tabId);
      await r.session.detach();
      return { ok: false, error: errorMessage(e) || 'Could not enable request interception on this tab.' };
    }
  }

  async function disableTab(tabId: number): Promise<void> {
    const ts = sessions.get(tabId);
    await setNlTab(tabId, false);
    if (!ts) return;
    try {
      await releaseAll(tabId, true);
      if (ts.session.attached) await ts.session.send('Fetch.disable').catch(() => undefined);
    } finally {
      sessions.delete(tabId);
      await ts.session.detach();
    }
  }

  /** The browser ended the session (Cancel on the infobar, tab closed, policy). */
  async function onBrowserDetach(tabId: number, reason: string): Promise<void> {
    const ts = sessions.get(tabId);
    if (!ts) return;
    sessions.delete(tabId);
    lastDetach.set(tabId, reason);
    // Commands are invalid on a dead session: only wake the parked delays.
    await releaseAll(tabId, false);
    await setNlTab(tabId, false);
    events.emit({ type: 'detached', tabId, reason });
  }

  /** Our own decision to end the session (handler errors): detach, then report like the browser would. */
  async function forceDetach(tabId: number, reason: string): Promise<void> {
    const ts = sessions.get(tabId);
    if (!ts) return;
    sessions.delete(tabId);
    lastDetach.set(tabId, reason);
    await releaseAll(tabId, true);
    await ts.session.detach();
    await setNlTab(tabId, false);
    events.emit({ type: 'detached', tabId, reason });
  }

  /* ------------------------------- handler ------------------------------ */

  function emitLog(tabId: number, p: RequestPausedParams, over: Partial<LogInput> & { outcome: LogInput['outcome'] }): void {
    const entry: LogInput = {
      time: Date.now(),
      tabId,
      method: p.request.method,
      url: p.request.url,
      type: fromCdpType(p.resourceType),
      outcome: over.outcome,
      marks: [],
    };
    if (over.status !== undefined) entry.status = over.status;
    if (over.error !== undefined) entry.error = over.error;
    if (over.delayMs !== undefined) entry.delayMs = over.delayMs;
    // The tab's top-level document host (what `pageDomains` is matched against here).
    const host = sessions.get(tabId)?.host;
    if (host) entry.initiatorHost = host;
    if (over.ruleId !== undefined) {
      entry.ruleId = over.ruleId;
      entry.engine = 'debugger';
    }
    // Headers cost a copy per row; only when a rule looks at them (masking is the log's job).
    if (logHeaders && p.responseHeaders) {
      const headers: Record<string, string> = {};
      for (const h of p.responseHeaders) headers[h.name] = h.value;
      entry.headers = headers;
    }
    events.emit({ type: 'log', entry });
  }

  function rememberDelayed(p: RequestPausedParams, ms: number): void {
    if (delayed.size >= DELAYED_MAX) delayed.delete(delayed.keys().next().value as string);
    delayed.set(p.networkId ?? p.requestId, ms);
  }

  function sleep(key: string, entry: Pending, ms: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => done(true), ms);
      function done(completed: boolean): void {
        clearTimeout(timer);
        entry.release = undefined;
        resolve(completed);
      }
      entry.until = Date.now() + ms;
      entry.release = done;
      pending.set(key, entry);
    });
  }

  async function onPaused(tabId: number, p: RequestPausedParams): Promise<void> {
    const ts = sessions.get(tabId);
    if (!ts || !p || typeof p.requestId !== 'string') return;
    const key = `${tabId}:${p.requestId}`;
    const entry: Pending = { tabId, requestId: p.requestId, at: Date.now(), url: p.request?.url ?? '', method: p.request?.method ?? '', type: p.resourceType };
    pending.set(key, entry);
    let released = false;
    let ok = true;

    // One command per paused request, ever. After it the request is not ours;
    // and if someone else (watchdog, disable, detach) released it meanwhile,
    // the entry is gone and this handler must not decide it any more.
    const send = async (cmd: CdpCommand): Promise<void> => {
      released = true;
      if (!pending.delete(key)) return;
      await ts.session.send(cmd.method, cmd.params);
    };

    try {
      ts.intercepted++;
      const stage = stageOfEvent(p);
      const c = ensureCache();
      if (!c.warm) await c.ready();
      const res = evaluatePaused(p, rules, c.snapshot(), ctxFor(tabId, ts));
      if (res.kind === 'skip') {
        await send(CONTINUE(p.requestId));
        return;
      }
      void c.commit(res.deltas);
      const seesResponse = stage === 'Request' && patternsCover(patterns, p, 'Response');
      const netKey = p.networkId ?? p.requestId;

      if (res.kind === 'pass') {
        if (stage === 'Response') {
          const earlier = delayed.get(netKey);
          delayed.delete(netKey);
          if (p.responseErrorReason !== undefined) emitLog(tabId, p, { outcome: 'error', error: p.responseErrorReason, delayMs: earlier });
          else if (earlier !== undefined) emitLog(tabId, p, { outcome: 'delayed', status: p.responseStatusCode, delayMs: earlier });
          else emitLog(tabId, p, { outcome: 'passed', status: p.responseStatusCode });
        } else if (!seesResponse) {
          emitLog(tabId, p, { outcome: 'passed' });
        }
        await send(CONTINUE(p.requestId));
        return;
      }

      ts.applied++;
      const rule = res.rule.rule;
      events.emit({ type: 'hit', ruleId: rule.id, tabId, url: p.request.url, approx: false });

      if (res.delayMs !== undefined) {
        const completed = await sleep(key, entry, res.delayMs);
        if (!completed || !ts.session.attached) {
          // Released early (detach/disable/dispose/watchdog): whoever released us continued it.
          released = true;
          return;
        }
        if (stage === 'Request' && seesResponse) rememberDelayed(p, res.delayMs);
        else emitLog(tabId, p, { outcome: 'delayed', ruleId: rule.id, delayMs: res.delayMs, status: p.responseStatusCode });
        await send(CONTINUE(p.requestId));
        return;
      }

      const outcome: LogInput['outcome'] = res.action.type === 'block' ? 'blocked' : res.action.type === 'fail' ? 'failed' : 'status';
      emitLog(tabId, p, {
        outcome,
        ruleId: rule.id,
        status: res.action.type === 'status' ? res.action.code : p.responseStatusCode,
        error: res.action.type === 'fail' ? res.action.reason : res.action.type === 'block' ? 'BlockedByClient' : undefined,
      });
      try {
        await send(res.command);
      } catch (e) {
        if (!ts.session.attached) return;
        // Chrome refused the substitute (e.g. a 1xx status): fail OPEN.
        ok = false;
        error(`debugger engine: ${res.command.method} rejected: ${errorMessage(e)}`, { ruleId: rule.id, tabId });
        pending.set(key, entry);
        released = false;
      }
    } catch (e) {
      ok = false;
      error(`debugger engine: handler failed: ${errorMessage(e)}`, { tabId });
    } finally {
      // Still ours (nobody released it meanwhile) and undecided → continue.
      if (!released && pending.delete(key) && ts.session.attached) {
        await ts.session.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => undefined);
      }
      const n = nextErrorCount(ts.errors, ok);
      ts.errors = n.count;
      if (n.detach) await forceDetach(tabId, HANDLER_ERRORS_REASON);
    }
  }

  /* ------------------------------- engine ------------------------------- */

  const engine: DebuggerEngine = {
    id: 'debugger',
    available: hasApi,
    supports(rule: Rule): boolean {
      return selectEngine(rule, 'chrome', caps).engine === 'debugger';
    },

    configure(d: DebuggerDeps): void {
      deps = d;
      // MV3: listeners must be registered in the first turn of the worker.
      d.tabs.onActivated.addListener(onActivated);
      d.tabs.onUpdated.addListener(onUpdated);
    },

    async apply(set: CompiledRuleSet): Promise<void> {
      rules = set.byEngine.debugger;
      patterns = fetchPatternsFor(rules);
      logHeaders = rules.some((c) => (c.rule.condition.responseHeaders?.length ?? 0) > 0);
      if (!hasApi || !deps) return;
      await reconcile();
      for (const [tabId, ts] of [...sessions]) {
        try {
          await applyPatterns(tabId, ts);
        } catch (e) {
          error(`debugger engine: Fetch.enable failed: ${errorMessage(e)}`, { tabId });
        }
      }
    },

    async pauseTab(tabId: number): Promise<void> {
      paused.add(tabId);
    },
    async resumeTab(tabId: number): Promise<void> {
      paused.delete(tabId);
    },

    enableTab,
    disableTab,
    isAttached: (tabId) => sessions.has(tabId),
    attachedTabs: () => [...sessions.keys()],
    stats(tabId: number): NlTabStats {
      const ts = sessions.get(tabId);
      const s: NlTabStats = { attached: !!ts, intercepted: ts?.intercepted ?? 0, applied: ts?.applied ?? 0 };
      const reason = lastDetach.get(tabId);
      if (reason !== undefined) s.lastDetachReason = reason;
      return s;
    },

    async tick(now = Date.now()): Promise<void> {
      for (const p of stalled(pending.values(), now) as Pending[]) {
        if (!pending.delete(`${p.tabId}:${p.requestId}`)) continue;
        p.release?.(false);
        const ts = sessions.get(p.tabId);
        if (ts?.session.attached) await ts.session.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => undefined);
        events.emit({
          type: 'log',
          entry: { time: now, tabId: p.tabId, method: p.method, url: p.url, type: fromCdpType(p.type), outcome: 'error', error: OWN_REASON.watchdog, engine: 'debugger', marks: [] },
        });
        error('debugger engine: released a request paused for more than 20 s', { tabId: p.tabId });
      }
    },

    async dispose(): Promise<void> {
      rules = [];
      patterns = [];
      try {
        for (const tabId of [...sessions.keys()]) await disableTab(tabId).catch(() => undefined);
      } finally {
        // Nothing may stay paused after we are gone — even if a detach threw.
        for (const [, p] of pending) p.release?.(false);
        pending.clear();
        for (const ts of sessions.values()) await ts.session.detach();
        sessions.clear();
        delayed.clear();
        unwatch?.();
        unwatch = null;
        cache?.reset();
        cache = null;
        reconciled = false;
      }
    },

    onEvent(listener: EngineEventListener): () => void {
      return events.subscribe(listener);
    },
  };
  return engine;
}

/** The debugger engine of a `createEngines()` list, or a no-op stand-in (Firefox). */
export function asDebuggerEngine(engines: readonly Engine[]): DebuggerEngine {
  const e = engines.find((x) => x.id === 'debugger');
  return e && 'enableTab' in e ? (e as DebuggerEngine) : NOOP_DEBUGGER;
}

const NOOP_DEBUGGER: DebuggerEngine = {
  id: 'debugger',
  available: false,
  supports: () => false,
  apply: () => Promise.resolve(),
  pauseTab: () => Promise.resolve(),
  resumeTab: () => Promise.resolve(),
  dispose: () => Promise.resolve(),
  onEvent: () => () => undefined,
  configure: () => undefined,
  enableTab: () => Promise.resolve({ ok: false, error: 'Network-level mode is not available in this browser.' }),
  disableTab: () => Promise.resolve(),
  isAttached: () => false,
  attachedTabs: () => [],
  stats: () => ({ attached: false, intercepted: 0, applied: 0 }),
  tick: () => Promise.resolve(),
};
