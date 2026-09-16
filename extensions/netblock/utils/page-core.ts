import { matchesSuffix, matchesUrlCondition } from '@blur/netcore';
import { kindMatches } from './resource-types';
import type { Action, HeaderCondition, Rule } from './rule-types';
import { statusMatches } from './status-match';
import type { Counter, StateSnapshot } from './state';
import { countKeyOf, decide, emptySnapshot, openWindow, resetCounters, resetForNavigation } from './state';
import type { PageEvent, RelayCommand } from './protocol';

// The page engine's DECISION LAYER — everything the MAIN-world script does
// that is not touching `window.fetch`/`XMLHttpRequest`. PURE: no browser
// imports, no DOM, so it bundles into the MAIN script unchanged AND loads in
// Node for e2e/netblock/page.test.mjs. The same `decide()`/`matchesUrlCondition`
// /`statusMatches` the background and the Firefox engine use (design §4:
// one rule format, one matcher — a rule previewed in the editor behaves the
// same in the page).
//
// Ownership (plan §4): the background owns `session:state`; this mirror
// exists so a decision is SYNCHRONOUS and exact even while the service worker
// sleeps. Every `decide()` here is reported as a `hit` event with the resulting
// counter; the background copies it ("larger `seen` wins") and fans it out to
// the other tabs as `page:state`.

/* ------------------------------- request ------------------------------- */

export interface PageRequest {
  /** Absolute URL. */
  url: string;
  /** Upper-cased. */
  method: string;
}

/** Resolve what a `fetch(input, init)` call is asking for, without touching
 *  the body. Never throws — an unparsable URL yields `null` (fail-open). */
export function describeFetch(input: unknown, init: RequestInit | undefined, baseUrl: string): PageRequest | null {
  try {
    let url: string;
    let method: string | undefined;
    if (typeof Request !== 'undefined' && input instanceof Request) {
      url = input.url;
      method = input.method;
    } else if (input instanceof URL) {
      url = input.href;
    } else {
      url = new URL(String(input), baseUrl).href;
    }
    if (init && typeof init.method === 'string') method = init.method;
    return { url, method: (method ?? 'GET').toUpperCase() };
  } catch {
    return null;
  }
}

/** The signal a fetch call carries, if any (`init.signal` wins over `Request.signal`). */
export function signalOf(input: unknown, init: RequestInit | undefined): AbortSignal | undefined {
  if (init && init.signal) return init.signal;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.signal;
  return undefined;
}

/* ------------------------------- matching ------------------------------ */

export interface MatchContext {
  url: string;
  method: string;
  /** `location.hostname` of the document that made the request (DNR's initiator). */
  pageHost: string;
  tabId: number;
  activeTabId?: number;
}

export function needsResponse(rule: Rule): boolean {
  return rule.condition.responseStatus !== undefined || (rule.condition.responseHeaders?.length ?? 0) > 0;
}

/** Static (pre-request) part of the condition. Pure, never throws. */
export function matchesStatic(rule: Rule, ctx: MatchContext): boolean {
  try {
    const c = rule.condition;
    if (rule.scope === 'activeTab' && (ctx.activeTabId === undefined || ctx.activeTabId !== ctx.tabId)) return false;
    // The page engine only ever sees fetch/XHR — a rule that excludes `xhr` cannot match here.
    if (!kindMatches(c.resourceTypes, 'xhr')) return false;
    if (c.methods && c.methods.length > 0 && !c.methods.includes(ctx.method as (typeof c.methods)[number])) return false;
    if (c.pageDomains && c.pageDomains.length > 0 && !matchesSuffix(ctx.pageHost, c.pageDomains)) return false;
    if (c.url && !matchesUrlCondition({ key: 'url', ...c.url }, ctx.url)) return false;
    return true;
  } catch {
    return false;
  }
}

export interface ResponseView {
  status: number;
  /** Case-insensitive header lookup; `null` when absent or invisible (CORS). */
  header: (name: string) => string | null;
}

function headerMatches(h: HeaderCondition, view: ResponseView): boolean {
  const v = view.header(h.name);
  if (v === null) return false;
  switch (h.op) {
    case 'exists':
      return true;
    case 'equals':
      return v.toLowerCase() === (h.value ?? '').toLowerCase();
    case 'contains':
      return (h.value ?? '').length > 0 && v.toLowerCase().includes(h.value!.toLowerCase());
  }
}

/** Response part of the condition (only meaningful when `needsResponse`). */
export function matchesResponse(rule: Rule, view: ResponseView): boolean {
  try {
    const c = rule.condition;
    if (c.responseStatus !== undefined && !statusMatches(c.responseStatus, view.status)) return false;
    for (const h of c.responseHeaders ?? []) if (!headerMatches(h, view)) return false;
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------- decision ------------------------------ */

export type Outcome =
  /** No rule applies; `snap` carries the advanced counters (`seen` of non-applied matches). */
  | { kind: 'pass'; snap: StateSnapshot; events: PageEvent[] }
  /** Rule `index` needs the real response — do the request, call again with `from: index`. */
  | { kind: 'needResponse'; index: number; snap: StateSnapshot; events: PageEvent[] }
  | { kind: 'apply'; rule: Rule; action: Action; key: string; counter: Counter; snap: StateSnapshot; events: PageEvent[] };

/**
 * Walk the rules in priority order (plan §3). Rules without response
 * conditions decide immediately; the first response-conditioned rule stops
 * the walk with `needResponse` so the caller performs the real request ONCE
 * and resumes from that index with `response`. The first rule whose
 * `decide()` says apply wins; a matched-but-not-applied rule (the 2nd of
 * `nth: 3`) counts `seen` and lets the walk continue.
 */
export function decideRequest(
  rules: readonly Rule[],
  snap: StateSnapshot,
  ctx: MatchContext & { now: number },
  from = 0,
  response?: ResponseView,
): Outcome {
  const events: PageEvent[] = [];
  let cur = snap;
  for (let i = from; i < rules.length; i++) {
    const rule = rules[i]!;
    if (!matchesStatic(rule, ctx)) continue;
    if (needsResponse(rule)) {
      if (!response) return { kind: 'needResponse', index: i, snap: cur, events };
      if (!matchesResponse(rule, response)) continue;
    }
    const d = decide(rule, cur, ctx);
    cur = d.next;
    events.push({ kind: 'hit', ruleId: rule.id, url: ctx.url, key: d.key, counter: d.counter, applied: d.apply });
    if (d.apply) return { kind: 'apply', rule, action: rule.action, key: d.key, counter: d.counter, snap: cur, events };
  }
  return { kind: 'pass', snap: cur, events };
}

/* -------------------------------- mirror ------------------------------- */

/** "Larger `seen` wins": merge a counter delta from the source of truth (or
 *  another tab) without rolling back decisions this document already made. */
export function mergeSnapshot(local: StateSnapshot, counters: Record<string, Counter>, matched: Record<string, number>): StateSnapshot {
  const nextCounters = { ...local.counters };
  for (const [k, c] of Object.entries(counters)) {
    const mine = nextCounters[k];
    if (!mine || c.seen >= mine.seen) nextCounters[k] = c;
  }
  const nextMatched = { ...local.matched };
  for (const [id, t] of Object.entries(matched)) {
    const mine = nextMatched[id];
    if (mine === undefined || t >= mine) nextMatched[id] = t;
  }
  return { counters: nextCounters, matched: nextMatched };
}

/**
 * The per-document mirror the MAIN script drives. Holds the rule list and the
 * counter snapshot, applies relay commands, and exposes the decision walk.
 * No side effects beyond its own fields — the script decides what to do with
 * the returned events.
 */
export class PageMirror {
  rules: Rule[] = [];
  snap: StateSnapshot = emptySnapshot();
  paused = false;
  tabId = -1;
  activeTabId: number | undefined;
  /** Rules never arrived (SW asleep / not enabled) → nothing is intercepted. */
  ready = false;

  readonly pageHost: string;

  // No parameter properties: Node's type stripping (the logic tests) rejects them.
  constructor(pageHost: string) {
    this.pageHost = pageHost;
  }

  /**
   * Apply a relay command. `topLevelNavigation` is true when the document is
   * the top frame of a fresh load: the mirror then applies the navigation
   * reset + `window(navigation)` opening itself, so the outcome is right even
   * if `relay:ready` overtook the background's `tabs.onUpdated` handler
   * (idempotent with it — both compute the same thing).
   */
  command(cmd: RelayCommand, now: number, topLevelNavigation = false): void {
    switch (cmd.type) {
      case 'page:rules': {
        this.rules = cmd.rules;
        this.paused = cmd.paused;
        this.tabId = cmd.tabId;
        this.activeTabId = cmd.activeTabId;
        let snap = this.ready ? mergeSnapshot(this.snap, cmd.state.counters, cmd.state.matched) : cmd.state;
        if (!this.ready && topLevelNavigation) {
          snap = resetForNavigation(snap, cmd.rules, cmd.tabId);
          for (const r of cmd.rules) {
            if (r.state.kind === 'window' && r.state.trigger === 'navigation') {
              snap = openWindow(r, snap, { tabId: cmd.tabId, url: '', now });
            }
          }
        }
        this.snap = snap;
        this.ready = true;
        break;
      }
      case 'page:state':
        this.snap = mergeSnapshot(this.snap, cmd.counters, cmd.matched);
        break;
      case 'page:pause':
        this.paused = cmd.paused;
        break;
      case 'page:reset':
        this.snap = resetCounters(this.snap, cmd.ruleId);
        break;
    }
  }

  /** A user click in this document: open every `window(click)` rule. */
  click(now: number, url: string): PageEvent[] {
    const out: PageEvent[] = [];
    for (const r of this.rules) {
      if (r.state.kind !== 'window' || r.state.trigger !== 'click') continue;
      const ctx = { tabId: this.tabId, url, now };
      this.snap = openWindow(r, this.snap, ctx);
      const key = countKeyOf(r, ctx);
      const counter = this.snap.counters[key];
      if (counter) out.push({ kind: 'window', ruleId: r.id, key, counter });
    }
    return out;
  }

  ctx(req: PageRequest, now: number): MatchContext & { now: number } {
    return { url: req.url, method: req.method, pageHost: this.pageHost, tabId: this.tabId, activeTabId: this.activeTabId, now };
  }

  /** Run the walk and COMMIT the advanced snapshot. Returns `null` when idle. */
  decide(req: PageRequest, now: number, from = 0, response?: ResponseView): Outcome | null {
    if (!this.ready || this.paused || this.rules.length === 0) return null;
    const out = decideRequest(this.rules, this.snap, this.ctx(req, now), from, response);
    this.snap = out.snap;
    return out;
  }
}

/* ------------------------------ fetch path ------------------------------ */

/** Statuses that must carry no body (`new Response` throws otherwise). */
export function isNullBodyStatus(code: number): boolean {
  return code === 101 || code === 103 || code === 204 || code === 205 || code === 304;
}

/** Response headers for a substituted `status` action. `nosniff` is what
 *  makes a `text/html` body safe to serve on someone else's origin (design §7.1). */
export function syntheticHeaders(action: Extract<Action, { type: 'status' }>): Record<string, string> {
  return {
    'content-type': `${action.contentType ?? 'text/plain'}; charset=utf-8`,
    'x-content-type-options': 'nosniff',
  };
}

export interface FetchDeps {
  origFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  now: () => number;
  /** Deliver events to the relay (the script batches them). */
  emit: (events: PageEvent[]) => void;
  /** Read per call — `pushState` moves the base of relative URLs. */
  baseUrl: () => string;
  sleep: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

function abortError(signal: AbortSignal | undefined): unknown {
  const reason = (signal as { reason?: unknown } | undefined)?.reason;
  if (reason !== undefined) return reason;
  return new DOMException('The user aborted a request.', 'AbortError');
}

function networkError(): TypeError {
  // Chrome's exact wording for a network failure of `fetch`.
  return new TypeError('Failed to fetch');
}

function logOf(req: PageRequest, outcome: Extract<Outcome, { kind: 'apply' }>, status?: number): PageEvent {
  const a = outcome.action;
  const base = { kind: 'log' as const, method: req.method, url: req.url, ruleId: outcome.rule.id };
  switch (a.type) {
    case 'block':
      return { ...base, outcome: 'blocked' };
    case 'fail':
      return { ...base, outcome: 'failed', error: a.reason };
    case 'delay':
      return { ...base, outcome: 'delayed', delayMs: a.ms, status };
    case 'status':
      return { ...base, outcome: 'status', status: a.code };
  }
}

function viewOf(res: Response): ResponseView {
  return {
    status: res.status,
    header: (name) => {
      try {
        return res.headers.get(name);
      } catch {
        return null;
      }
    },
  };
}

/**
 * The patched `fetch`, minus the `window` plumbing. Everything that can go
 * wrong in OUR code falls through to `origFetch` (fail-open); errors that are
 * the ACTION (TypeError, AbortError) propagate to the page.
 */
export async function interceptFetch(
  mirror: PageMirror,
  deps: FetchDeps,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<Response> {
  const req = describeFetch(input, init, deps.baseUrl());
  if (!req) return deps.origFetch(input, init);
  const signal = signalOf(input, init);
  if (signal?.aborted) throw abortError(signal);

  let outcome: Outcome | null;
  try {
    outcome = mirror.decide(req, deps.now());
  } catch {
    return deps.origFetch(input, init);
  }
  if (!outcome) return deps.origFetch(input, init);
  if (outcome.events.length) deps.emit(outcome.events);

  // The real request, performed at most once (plan §3). Started lazily: a
  // `block` decided before any response-conditioned rule never hits the network.
  let real: Promise<Response> | undefined;
  const realOnce = (): Promise<Response> => (real ??= deps.origFetch(input, init));

  while (outcome.kind === 'needResponse') {
    const res = await realOnce();
    let next: Outcome | null;
    try {
      next = mirror.decide(req, deps.now(), outcome.index, viewOf(res));
    } catch {
      return res;
    }
    if (!next) return res;
    if (next.events.length) deps.emit(next.events);
    outcome = next;
  }
  if (outcome.kind === 'pass') return real ?? deps.origFetch(input, init);

  const action = outcome.action;
  switch (action.type) {
    case 'block':
    case 'fail': {
      // A real response we already received is discarded; free its stream.
      if (real) void real.then((r) => r.body?.cancel().catch(() => undefined)).catch(() => undefined);
      deps.emit([logOf(req, outcome)]);
      throw networkError();
    }
    case 'delay': {
      await deps.sleep(action.ms, signal);
      if (signal?.aborted) throw abortError(signal);
      const res = await realOnce();
      deps.emit([logOf(req, outcome, res.status)]);
      return res;
    }
    case 'status': {
      // Honest (design §6.2): the request goes out and DevTools shows the real
      // answer; the app gets ours. An abort while it is in flight stays an abort.
      const body = action.body !== undefined && action.body.length > 0 && !isNullBodyStatus(action.code) ? action.body : null;
      let res: Response;
      try {
        res = new Response(body, { status: action.code, headers: syntheticHeaders(action) });
      } catch {
        // 1xx cannot be represented by `Response` (RangeError) — fail open,
        // and the real response is handed over intact.
        deps.emit([{ kind: 'log', method: req.method, url: req.url, outcome: 'passed', ruleId: outcome.rule.id, error: `status ${action.code} not constructible` }]);
        return realOnce();
      }
      try {
        const r = await realOnce();
        void r.body?.cancel().catch(() => undefined);
      } catch (err) {
        if (signal?.aborted) throw err;
        // Real network failure — the substituted status still stands.
      }
      try {
        // A constructed Response has `url: ''`; apps read `res.url` back.
        Object.defineProperty(res, 'url', { value: req.url, configurable: true });
      } catch {
        // Not load-bearing.
      }
      deps.emit([logOf(req, outcome)]);
      return res;
    }
  }
}

/* --------------------------- relay input hygiene --------------------------- */

/** Bounds for what a page may report (design §7.3 residual: the page can read
 *  the nonce, so its reports are UNTRUSTED input to the background). */
export const PAGE_EVENT_LIMITS = {
  /** Events per `relay:event` message; the rest of a flood is dropped. */
  batch: 500,
  /** `countKeyOf` output: rule id (≤ 64) + `|u` + URL sans query. */
  keyLength: 4096,
  urlLength: 8192,
  methodLength: 32,
  errorLength: 256,
  /** `Action.delay` cap (LIMITS.delayMs) — a log row cannot claim more. */
  delayMs: 60_000,
} as const;

const OUTCOMES = new Set(['passed', 'blocked', 'failed', 'delayed', 'status', 'error']);

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validCounter(v: unknown): Counter | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const c = v as Record<string, unknown>;
  if (!isCount(c.seen) || !isCount(c.hits) || c.hits > c.seen) return null;
  const out: Counter = { seen: c.seen, hits: c.hits };
  if (c.windowUntil !== undefined) {
    if (!isFiniteNumber(c.windowUntil)) return null;
    out.windowUntil = c.windowUntil;
  }
  if (c.rng !== undefined) {
    if (!isFiniteNumber(c.rng)) return null;
    out.rng = c.rng;
  }
  if (c.lastAt !== undefined) {
    if (!isFiniteNumber(c.lastAt)) return null;
    out.lastAt = c.lastAt;
  }
  return out;
}

/**
 * Keep only well-formed events that refer to rules THIS engine gave the page:
 * a hit/window must name a current page rule and a key in that rule's own
 * `countKeyOf` shape (for `rule+tab`, the sender's tab); a log row must carry a known outcome and bounded
 * strings. Anything else (a forged key for another tab, a 3 MB URL, a
 * counter that is not a counter) is dropped, so the worst a hostile page can
 * do is skew the counters of rules that already run on it.
 */
export function sanitizePageEvents(events: unknown, rules: readonly Rule[], tabId?: number): PageEvent[] {
  if (!Array.isArray(events)) return [];
  const byId = new Map(rules.map((r) => [r.id, r]));
  const L = PAGE_EVENT_LIMITS;
  const out: PageEvent[] = [];
  for (const raw of events.slice(0, L.batch)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const ev = raw as Record<string, unknown>;
    if (ev.kind === 'hit' || ev.kind === 'window') {
      if (typeof ev.ruleId !== 'string' || typeof ev.key !== 'string') continue;
      const rule = byId.get(ev.ruleId);
      if (!rule || ev.key.length > L.keyLength) continue;
      // `rule+tab` keys must name the SENDER's tab — a page cannot count for another tab.
      const expected = rule.countKey === 'rule' ? rule.id : rule.countKey === 'rule+tab' ? `${rule.id}|t${tabId ?? -1}` : `${rule.id}|u`;
      if (rule.countKey === 'url' ? !ev.key.startsWith(expected) : ev.key !== expected) continue;
      const counter = validCounter(ev.counter);
      if (!counter) continue;
      if (ev.kind === 'hit') {
        if (typeof ev.url !== 'string' || typeof ev.applied !== 'boolean') continue;
        out.push({ kind: 'hit', ruleId: rule.id, url: ev.url.slice(0, L.urlLength), key: ev.key, counter, applied: ev.applied });
      } else {
        out.push({ kind: 'window', ruleId: rule.id, key: ev.key, counter });
      }
      continue;
    }
    if (ev.kind === 'log') {
      if (typeof ev.method !== 'string' || typeof ev.url !== 'string' || typeof ev.outcome !== 'string' || !OUTCOMES.has(ev.outcome)) continue;
      const row: Extract<PageEvent, { kind: 'log' }> = {
        kind: 'log',
        method: ev.method.slice(0, L.methodLength),
        url: ev.url.slice(0, L.urlLength),
        outcome: ev.outcome as Extract<PageEvent, { kind: 'log' }>['outcome'],
      };
      if (ev.ruleId !== undefined) {
        if (typeof ev.ruleId !== 'string' || !byId.has(ev.ruleId)) continue;
        row.ruleId = ev.ruleId;
      }
      if (ev.status !== undefined) {
        if (!isCount(ev.status) || ev.status > 999) continue;
        row.status = ev.status;
      }
      if (ev.delayMs !== undefined) {
        if (!isCount(ev.delayMs) || ev.delayMs > L.delayMs) continue;
        row.delayMs = ev.delayMs;
      }
      if (ev.error !== undefined) {
        if (typeof ev.error !== 'string') continue;
        row.error = ev.error.slice(0, L.errorLength);
      }
      out.push(row);
    }
  }
  return out;
}
