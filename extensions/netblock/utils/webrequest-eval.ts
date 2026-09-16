import { hostOf, matchesSuffix, matchesUrlCondition } from '@blur/netcore';
import type { CompiledRule, HonestyKey } from './engine-select';
import { fromFirefoxType, kindMatches, toFirefoxTypes, type FirefoxResourceType } from './resource-types';
import type { Action, HeaderCondition, Rule } from './rule-types';
import { decide, type Counter, type StateSnapshot } from './state';
import { statusMatches } from './status-match';

// The Firefox engine's decision logic as PURE functions (design §3, §5.4, §6.6,
// plan 02-webrequest.md §1.2–1.3). `engines/webrequest.ts` is the thin glue
// that feeds `browser.webRequest` details in here and turns the result into a
// BlockingResponse; everything that can be unit-tested without a browser lives
// in this module. No browser imports, no `#imports`.
//
// Two stages, evaluated independently:
//   request  — `onBeforeRequest`: rules WITHOUT response conditions. They act
//              before the network (block/fail/status→cancel, delay).
//   response — `onHeadersReceived`: rules WITH `responseStatus` and/or
//              `responseHeaders`. The server has already answered; we can
//              cancel delivery (`cancel` is honoured there, MDN BlockingResponse
//              2026-08-27) or delay it.
// A strict cross-stage priority would force request-stage rules to wait for
// the response whenever a higher-priority response rule matches the URL, which
// would lose the whole point of "block before the network"; so priority is
// first-match WITHIN a stage, and the plan documents it.

/** The subset of Firefox `webRequest` details every stage provides. */
export interface WrRequestDetails {
  requestId: string;
  url: string;
  method: string;
  /** Firefox `ResourceType` string (`xmlhttprequest`, `beacon`, `imageset`…). */
  type: string;
  /** -1 when the request is not tied to a tab (service workers, browser). */
  tabId: number;
  frameId?: number;
  /** URL of the resource that triggered the request (the page for fetch/XHR). */
  originUrl?: string;
  /** URL of the document the resource is loaded into; absent for top-level. */
  documentUrl?: string;
  /** `onHeadersReceived` / `onCompleted` only. */
  statusCode?: number;
  /** `onHeadersReceived` with `'responseHeaders'` in extraInfoSpec only. */
  responseHeaders?: WrHeader[];
}

export interface WrHeader {
  name: string;
  value?: string;
  binaryValue?: number[];
}

export type WrStage = 'request' | 'response';

/** What the engine knows besides the rules and the counters. */
export interface EvalContext {
  now: number;
  /** Tabs with "Pause on this tab" active — every rule is skipped there. */
  pausedTabs: ReadonlySet<number>;
  /** The active tab of every window — the target of `scope: 'activeTab'` rules. */
  activeTabs: ReadonlySet<number>;
}

/** One changed counter — the write-through unit (plan §1.4). */
export interface StateDelta {
  key: string;
  counter: Counter;
  ruleId: string;
  now: number;
}

/** What the blocking listener returns. `redirectUrl` is deliberately not
 *  representable: it always yields a 200 (spike S2) and AMO reviewers read
 *  redirects as traffic rewriting — neither is what this tool does. */
export type WrBlockingResponse = { cancel: true } | Record<string, never>;

export type EvalResult =
  /** Not page traffic, or the tab is paused: nothing counted, nothing logged as a hit. */
  | { kind: 'skip'; reason: 'notPageTraffic' | 'paused' }
  /** No rule applied (some may have matched and counted). */
  | { kind: 'pass'; deltas: StateDelta[]; next: StateSnapshot }
  /** `rule` applied `action`; return `response` (after `delayMs`, when set). */
  | {
      kind: 'apply';
      deltas: StateDelta[];
      next: StateSnapshot;
      rule: CompiledRule;
      action: Action;
      response: WrBlockingResponse;
      delayMs?: number;
      /** `wr↓` — the action ran in a weaker form (fail/status → cancel). */
      degraded?: HonestyKey;
      counter: Counter;
    };

/* ------------------------------- traffic -------------------------------- */

const WEB_SCHEME = /^(https?|wss?):/i;

/**
 * Is this request the page's own traffic? Everything else passes untouched:
 * other extensions' fetches, browser-internal loads and anything that is not
 * http(s)/ws(s). A request with `tabId === -1` counts only when its initiator
 * is web content (a service worker fetching for a page) — the resilience test
 * must reach SW-driven apps too, but never the browser's own plumbing.
 */
export function isPageTraffic(details: Pick<WrRequestDetails, 'url' | 'tabId' | 'originUrl' | 'documentUrl'>): boolean {
  if (!WEB_SCHEME.test(details.url)) return false;
  const initiator = details.originUrl ?? details.documentUrl;
  if (details.tabId < 0) return initiator !== undefined && WEB_SCHEME.test(initiator);
  return initiator === undefined || WEB_SCHEME.test(initiator);
}

/* --------------------------------- rules -------------------------------- */

export function stageOf(rule: Rule): WrStage {
  const c = rule.condition;
  return c.responseStatus !== undefined || (c.responseHeaders?.length ?? 0) > 0 ? 'response' : 'request';
}

/** Do any of the rules need `onHeadersReceived` at all? */
export function hasResponseStage(rules: readonly CompiledRule[]): boolean {
  return rules.some((c) => stageOf(c.rule) === 'response');
}

/** Only header conditions need the (copied per response) `responseHeaders`. */
export function needsResponseHeaders(rules: readonly CompiledRule[]): boolean {
  return rules.some((c) => (c.rule.condition.responseHeaders?.length ?? 0) > 0);
}

/**
 * `filter.types` for the blocking listeners: the union of the rules' Firefox
 * types, or `undefined` (= every type) when at least one rule has no type
 * restriction. Narrowing the filter is the cheapest possible way to skip
 * requests the rules cannot match (Android).
 */
export function typesFilterFor(rules: readonly CompiledRule[]): FirefoxResourceType[] | undefined {
  const all = new Set<FirefoxResourceType>();
  for (const c of rules) {
    const kinds = c.rule.condition.resourceTypes;
    if (!kinds || kinds.length === 0) return undefined;
    for (const t of toFirefoxTypes(kinds)) all.add(t);
  }
  return [...all].sort();
}

/* ------------------------------- matching ------------------------------- */

function pageHostOf(details: WrRequestDetails): string | undefined {
  return hostOf(details.originUrl ?? details.documentUrl);
}

function headerMatches(cond: HeaderCondition, headers: readonly WrHeader[] | undefined): boolean {
  if (!headers) return false;
  const name = cond.name.toLowerCase();
  const want = (cond.value ?? '').toLowerCase();
  for (const h of headers) {
    if (h.name.toLowerCase() !== name) continue;
    if (cond.op === 'exists') return true;
    const have = (h.value ?? '').toLowerCase();
    if (cond.op === 'equals' ? have === want : have.includes(want)) return true;
  }
  return false;
}

/** Does the rule's condition match this request at this stage? Pure, never throws. */
export function requestRuleMatches(rule: Rule, details: WrRequestDetails, stage: WrStage, ctx: EvalContext): boolean {
  if (stageOf(rule) !== stage) return false;
  if (rule.scope === 'activeTab' && !ctx.activeTabs.has(details.tabId)) return false;
  const c = rule.condition;
  if (c.methods && c.methods.length > 0 && !c.methods.includes(details.method.toUpperCase() as never)) return false;
  if (!kindMatches(c.resourceTypes, fromFirefoxType(details.type))) return false;
  if (c.pageDomains && c.pageDomains.length > 0) {
    const host = pageHostOf(details);
    if (!host || !matchesSuffix(host, c.pageDomains)) return false;
  }
  if (c.url && !matchesUrlCondition({ key: 'url', ...c.url }, details.url)) return false;
  if (stage === 'response') {
    if (c.responseStatus !== undefined) {
      if (details.statusCode === undefined || !statusMatches(c.responseStatus, details.statusCode)) return false;
    }
    for (const h of c.responseHeaders ?? []) if (!headerMatches(h, details.responseHeaders)) return false;
  }
  return true;
}

/* -------------------------------- actions ------------------------------- */

/** Firefox can only cancel or wait (design §5.4, spike S2). */
export function responseFor(action: Action): { response: WrBlockingResponse; delayMs?: number; degraded?: HonestyKey } {
  switch (action.type) {
    case 'block':
      return { response: { cancel: true } };
    case 'fail':
      return { response: { cancel: true }, degraded: 'ffFailCancel' };
    case 'status':
      return { response: { cancel: true }, degraded: 'ffStatusCancel' };
    case 'delay':
      return { response: {}, delayMs: Math.max(0, action.ms) };
  }
}

/* -------------------------------- evaluate ------------------------------ */

/**
 * The whole decision for one request at one stage. Rules come in priority
 * order (compileRules). The first rule whose condition matches AND whose
 * state says "apply" wins; a rule that matched but did not apply (nth, once,
 * window…) is transparent — it counted the match and the next rule is asked.
 * The returned `next` snapshot has every advanced counter; `deltas` lists
 * just the changed keys for the write-through.
 */
export function evaluateRequest(
  details: WrRequestDetails,
  stage: WrStage,
  rules: readonly CompiledRule[],
  snap: StateSnapshot,
  ctx: EvalContext,
): EvalResult {
  if (!isPageTraffic(details)) return { kind: 'skip', reason: 'notPageTraffic' };
  if (details.tabId >= 0 && ctx.pausedTabs.has(details.tabId)) return { kind: 'skip', reason: 'paused' };

  const deltas: StateDelta[] = [];
  let cur = snap;
  const dctx = { tabId: details.tabId >= 0 ? details.tabId : undefined, url: details.url, now: ctx.now };
  for (const compiled of rules) {
    const rule = compiled.rule;
    if (!requestRuleMatches(rule, details, stage, ctx)) continue;
    const d = decide(rule, cur, dctx);
    cur = d.next;
    deltas.push({ key: d.key, counter: d.counter, ruleId: rule.id, now: ctx.now });
    if (!d.apply) continue;
    const r = responseFor(rule.action);
    const result: EvalResult = {
      kind: 'apply',
      deltas,
      next: cur,
      rule: compiled,
      action: rule.action,
      response: r.response,
      counter: d.counter,
    };
    if (r.delayMs !== undefined) result.delayMs = r.delayMs;
    // The compiled rule's honesty key wins (engine-select decided it); the
    // action-level one is the same value derived independently — a belt.
    const degraded = compiled.degraded ?? r.degraded;
    if (degraded) result.degraded = degraded;
    return result;
  }
  return { kind: 'pass', deltas, next: cur };
}

/** Apply write-through deltas onto a stored snapshot (plan §1.4 merge). */
export function mergeDeltas(snap: StateSnapshot, deltas: readonly StateDelta[]): StateSnapshot {
  if (deltas.length === 0) return snap;
  const counters = { ...snap.counters };
  const matched = { ...snap.matched };
  for (const d of deltas) {
    counters[d.key] = d.counter;
    matched[d.ruleId] = d.now;
  }
  return { counters, matched };
}
