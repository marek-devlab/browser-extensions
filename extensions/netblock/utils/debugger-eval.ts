import { matchesSuffix, matchesUrlCondition } from '@blur/netcore';
import type { CompiledRule } from './engine-select';
import { fromCdpType, kindMatches, toCdpTypes, type CdpResourceType } from './resource-types';
import type { Action, HeaderCondition, Rule, UrlCondition } from './rule-types';
import { decide, type Counter, type StateSnapshot } from './state';
import { statusMatches } from './status-match';
import type { StateDelta } from './webrequest-eval';

// The debugger engine's decision logic as PURE functions (design §4.3, §5.5,
// §8; plan docs/plans/netblock/02-debugger.md §3–§5). `engines/debugger.ts`
// is the glue to `chrome.debugger`; everything that can be unit-tested with a
// fake CDP session lives here. No browser imports, no `#imports`.
//
// Two stages, evaluated independently — exactly like the Firefox engine
// (webrequest-eval.ts): a rule WITHOUT response conditions acts at the
// `Request` stage (before the network); a rule WITH `responseStatus` /
// `responseHeaders` acts at the `Response` stage, when the real status and
// headers are known. Priority is first-match within a stage.

/* --------------------------------- CDP ---------------------------------- */

export type CdpStage = 'Request' | 'Response';

export interface CdpHeaderEntry {
  name: string;
  value: string;
}

/** `Fetch.RequestPattern` (browser_protocol.json, tot 2026-09-15). */
export interface FetchPattern {
  urlPattern: string;
  resourceType?: CdpResourceType;
  requestStage: CdpStage;
}

/** The subset of `Fetch.requestPaused` the engine reads. */
export interface RequestPausedParams {
  requestId: string;
  request: { url: string; method: string; headers?: Record<string, string> };
  frameId?: string;
  resourceType: string;
  responseErrorReason?: string;
  responseStatusCode?: number;
  responseStatusText?: string;
  responseHeaders?: CdpHeaderEntry[];
  networkId?: string;
  redirectedRequestId?: string;
}

/** The three ways a paused request is released. Never anything else. */
export interface FulfillParams {
  requestId: string;
  responseCode: number;
  responseHeaders: CdpHeaderEntry[];
  /** base64 */
  body?: string;
}

export type CdpCommand =
  | { method: 'Fetch.continueRequest'; params: { requestId: string } }
  | { method: 'Fetch.failRequest'; params: { requestId: string; errorReason: string } }
  | { method: 'Fetch.fulfillRequest'; params: FulfillParams };

/** "the request is at the response stage if either of these fields is present" (protocol docs). */
export function stageOfEvent(p: Pick<RequestPausedParams, 'responseStatusCode' | 'responseErrorReason'>): CdpStage {
  return p.responseStatusCode !== undefined || p.responseErrorReason !== undefined ? 'Response' : 'Request';
}

/* ------------------------------- patterns ------------------------------- */

export function stageOfRule(rule: Rule): CdpStage {
  const c = rule.condition;
  return c.responseStatus !== undefined || (c.responseHeaders?.length ?? 0) > 0 ? 'Response' : 'Request';
}

/** CDP glob escape: `\`, `*` and `?` are the only special characters. */
function escapeGlob(s: string): string {
  return s.replace(/[\\*?]/g, '\\$&');
}

const ASCII_LETTER = /[a-z]/i;

/**
 * `urlPattern` for a rule's URL condition. The pattern is only a PRE-FILTER —
 * the JS matcher decides — so it must never exclude a URL the rule would
 * match. CDP's matcher (`base::MatchPattern`) is case-sensitive while our
 * `contains`/`equals`/`wildcard` are case-insensitive by default, so a narrow
 * pattern is emitted only when the condition is case-sensitive or its value
 * has no ASCII letters to mis-case; everything else (and `regex`) is `*`.
 */
export function urlPatternFor(cond: UrlCondition | undefined): string {
  if (!cond || cond.op === 'regex' || cond.value.length === 0) return '*';
  if (cond.caseSensitive !== true && ASCII_LETTER.test(cond.value)) return '*';
  switch (cond.op) {
    case 'contains':
      return `*${escapeGlob(cond.value)}*`;
    case 'equals':
      return escapeGlob(cond.value);
    case 'wildcard':
      // Our glob (`*`, `?`) is CDP's glob; only backslashes need escaping.
      return cond.value.replace(/\\/g, '\\\\');
  }
}

/**
 * The `Network.ResourceType` values `Fetch.enable` accepts in a pattern
 * filter. Measured live (e2e/netblock/debugger.live.mjs, Chromium 149 under
 * Playwright, 2026-09-15): the other seven — `TextTrack`, `Prefetch`,
 * `WebSocket`, `Manifest`, `SignedExchange`, `Preflight`, `FedCM` — are
 * refused with "Unknown resource type in fetch filter". A rule whose kinds map
 * only to refused types gets no pattern (and is therefore not intercepted);
 * the plan says so.
 */
export const FETCH_FILTER_TYPES: ReadonlySet<CdpResourceType> = new Set<CdpResourceType>([
  'Document',
  'Stylesheet',
  'Image',
  'Media',
  'Font',
  'Script',
  'XHR',
  'Fetch',
  'EventSource',
  'Ping',
  'CSPViolationReport',
  'Other',
]);

/**
 * `Fetch.enable` patterns for the debugger slice: one per (URL pattern ×
 * CDP resource type × stage), deduplicated. An empty result means "call
 * `Fetch.disable`" — an empty `patterns` array is NOT "nothing" to Chrome.
 */
export function fetchPatternsFor(rules: readonly CompiledRule[]): FetchPattern[] {
  const out: FetchPattern[] = [];
  const seen = new Set<string>();
  for (const { rule } of rules) {
    const urlPattern = urlPatternFor(rule.condition.url);
    const requestStage = stageOfRule(rule);
    const kinds = rule.condition.resourceTypes ?? [];
    const types: (CdpResourceType | undefined)[] =
      kinds.length === 0 ? [undefined] : toCdpTypes(kinds).filter((t) => FETCH_FILTER_TYPES.has(t));
    for (const resourceType of types) {
      const key = `${requestStage}|${resourceType ?? ''}|${urlPattern}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(resourceType ? { urlPattern, resourceType, requestStage } : { urlPattern, requestStage });
    }
  }
  return out;
}

/** Does one of OUR patterns (JS re-evaluation of the CDP glob) catch this request at `stage`? */
export function patternsCover(patterns: readonly FetchPattern[], p: Pick<RequestPausedParams, 'request' | 'resourceType'>, stage: CdpStage): boolean {
  for (const pat of patterns) {
    if (pat.requestStage !== stage) continue;
    if (pat.resourceType && pat.resourceType !== p.resourceType) continue;
    if (pat.urlPattern === '*' || cdpGlobMatches(pat.urlPattern, p.request.url)) return true;
  }
  return false;
}

/** CDP glob → test, honouring backslash escapes (wildcardToRegExp has none). */
export function cdpGlobMatches(pattern: string, url: string): boolean {
  let unescaped = '';
  const literal: boolean[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\' && i + 1 < pattern.length) {
      unescaped += pattern[++i]!;
      literal.push(true);
    } else {
      unescaped += ch;
      literal.push(false);
    }
  }
  // Build a case-sensitive regexp: escaped wildcards become literals.
  let src = '^';
  for (let i = 0; i < unescaped.length; i++) {
    const ch = unescaped[i]!;
    if (!literal[i] && ch === '*') src += '.*';
    else if (!literal[i] && ch === '?') src += '.';
    else src += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(src + '$').test(url);
}

/* ------------------------------- matching ------------------------------- */

export interface DbgContext {
  now: number;
  tabId: number;
  /** Host of the tab's top-level document (for `pageDomains`); '' when unknown. */
  tabHost: string;
  paused: boolean;
  /** Is `tabId` the active tab of its window (`scope: 'activeTab'`)? */
  isActiveTab: boolean;
}

function headerMatches(cond: HeaderCondition, headers: readonly CdpHeaderEntry[] | undefined): boolean {
  if (!headers) return false;
  const name = cond.name.toLowerCase();
  const want = (cond.value ?? '').toLowerCase();
  for (const h of headers) {
    if (h.name.toLowerCase() !== name) continue;
    if (cond.op === 'exists') return true;
    const have = h.value.toLowerCase();
    if (cond.op === 'equals' ? have === want : have.includes(want)) return true;
  }
  return false;
}

/** Does the rule's condition match this paused request at this stage? Pure, never throws. */
export function ruleMatches(rule: Rule, p: RequestPausedParams, stage: CdpStage, ctx: DbgContext): boolean {
  if (stageOfRule(rule) !== stage) return false;
  if (rule.scope === 'activeTab' && !ctx.isActiveTab) return false;
  const c = rule.condition;
  if (c.methods && c.methods.length > 0 && !c.methods.includes(p.request.method.toUpperCase() as never)) return false;
  if (!kindMatches(c.resourceTypes, fromCdpType(p.resourceType))) return false;
  if (c.pageDomains && c.pageDomains.length > 0) {
    if (!ctx.tabHost || !matchesSuffix(ctx.tabHost, c.pageDomains)) return false;
  }
  if (c.url && !matchesUrlCondition({ key: 'url', ...c.url }, p.request.url)) return false;
  if (stage === 'Response') {
    if (c.responseStatus !== undefined) {
      if (p.responseStatusCode === undefined || !statusMatches(c.responseStatus, p.responseStatusCode)) return false;
    }
    for (const h of c.responseHeaders ?? []) if (!headerMatches(h, p.responseHeaders)) return false;
  }
  return true;
}

/* -------------------------------- actions ------------------------------- */

/** UTF-8 → base64 (`fulfillRequest.body`). Works in workers and Node. */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/**
 * Headers of a substituted response. `nosniff` + an explicit Content-Type so
 * an HTML body is never sniffed into a script (design §7.1); `no-store` so
 * the substitute never lands in the HTTP cache; `Content-Security-Policy:
 * sandbox` so that when the paused request is a NAVIGATION (resource type
 * `Document`) the user's error page renders as an opaque, script-less document
 * instead of running under the site's origin — `nosniff` alone does not stop
 * a declared `text/html` document from executing (design §7.1's intent;
 * subresource responses ignore the header, so fetch/XHR bodies are unaffected);
 * `Access-Control-Allow-Origin` echoes the request's `Origin` so a
 * cross-origin page sees OUR status code instead of a CORS error (the app
 * under test must observe the failure — the response is ours, no server data).
 */
export const SANDBOX_CSP = 'sandbox';

export function fulfillHeaders(action: Extract<Action, { type: 'status' }>, requestHeaders: Record<string, string> | undefined): CdpHeaderEntry[] {
  const ct = action.contentType ?? 'text/plain';
  const headers: CdpHeaderEntry[] = [
    { name: 'Content-Type', value: ct.startsWith('text/') || ct === 'application/json' || ct === 'application/xml' ? `${ct}; charset=utf-8` : ct },
    { name: 'X-Content-Type-Options', value: 'nosniff' },
    { name: 'Cache-Control', value: 'no-store' },
    { name: 'Content-Security-Policy', value: SANDBOX_CSP },
  ];
  const origin = requestHeaders ? Object.entries(requestHeaders).find(([k]) => k.toLowerCase() === 'origin')?.[1] : undefined;
  if (origin) {
    headers.push({ name: 'Access-Control-Allow-Origin', value: origin });
    headers.push({ name: 'Access-Control-Allow-Credentials', value: 'true' });
  }
  return headers;
}

/** The CDP command an applied action becomes (delay: after `delayMs`). */
export function commandFor(action: Action, p: Pick<RequestPausedParams, 'requestId' | 'request'>): { command: CdpCommand; delayMs?: number } {
  const requestId = p.requestId;
  switch (action.type) {
    case 'block':
      return { command: { method: 'Fetch.failRequest', params: { requestId, errorReason: 'BlockedByClient' } } };
    case 'fail':
      return { command: { method: 'Fetch.failRequest', params: { requestId, errorReason: action.reason } } };
    case 'delay':
      return { command: { method: 'Fetch.continueRequest', params: { requestId } }, delayMs: Math.max(0, action.ms) };
    case 'status': {
      const params: FulfillParams = {
        requestId,
        responseCode: action.code,
        responseHeaders: fulfillHeaders(action, p.request.headers),
      };
      if (action.body !== undefined && action.body.length > 0) params.body = toBase64(action.body);
      return { command: { method: 'Fetch.fulfillRequest', params } };
    }
  }
}

/* -------------------------------- evaluate ------------------------------ */

export type PausedResult =
  /** Not ours to touch (paused tab, preflight): continue, no log row. */
  | { kind: 'skip'; reason: 'paused' | 'preflight' }
  /** No rule applied (some may have matched and counted). */
  | { kind: 'pass'; deltas: StateDelta[]; next: StateSnapshot }
  | {
      kind: 'apply';
      deltas: StateDelta[];
      next: StateSnapshot;
      rule: CompiledRule;
      action: Action;
      command: CdpCommand;
      delayMs?: number;
      counter: Counter;
    };

/**
 * The whole decision for one `Fetch.requestPaused`. Rules come in priority
 * order (compileRules). First rule whose condition matches AND whose state
 * says "apply" wins; a matched-but-not-applied rule is transparent. `deltas`
 * are the changed counters for the write-through.
 */
export function evaluatePaused(
  p: RequestPausedParams,
  rules: readonly CompiledRule[],
  snap: StateSnapshot,
  ctx: DbgContext,
): PausedResult {
  if (ctx.paused) return { kind: 'skip', reason: 'paused' };
  // A CORS preflight is browser plumbing: failing or fulfilling it turns any
  // rule into a CORS TypeError instead of the status/error the user asked for.
  if (p.resourceType === 'Preflight') return { kind: 'skip', reason: 'preflight' };
  const stage = stageOfEvent(p);
  const deltas: StateDelta[] = [];
  let cur = snap;
  const dctx = { tabId: ctx.tabId, url: p.request.url, now: ctx.now };
  for (const compiled of rules) {
    const rule = compiled.rule;
    if (!ruleMatches(rule, p, stage, ctx)) continue;
    const d = decide(rule, cur, dctx);
    cur = d.next;
    deltas.push({ key: d.key, counter: d.counter, ruleId: rule.id, now: ctx.now });
    if (!d.apply) continue;
    const c = commandFor(rule.action, p);
    const result: PausedResult = {
      kind: 'apply',
      deltas,
      next: cur,
      rule: compiled,
      action: rule.action,
      command: c.command,
      counter: d.counter,
    };
    if (c.delayMs !== undefined) result.delayMs = c.delayMs;
    return result;
  }
  return { kind: 'pass', deltas, next: cur };
}

/* -------------------------------- watchdog ------------------------------ */

export interface PendingRequest {
  tabId: number;
  requestId: string;
  /** When the handler started (or, for delays, when the wait started). */
  at: number;
  /** Delay parkings: when the timer is due. Absent for handler-in-progress. */
  until?: number;
}

/** Design §5.5: a request paused for longer than this without a decision is released. */
export const WATCHDOG_STALL_MS = 20_000;

/**
 * Which pending requests the watchdog must release at `now`: a handler that
 * has been running for > 20 s, or a delay whose timer should have fired > 20 s
 * ago (a lost timer). An in-progress delay is NOT a stall — `LIMITS.delayMs`
 * allows 60 s — so it is left to its own timer.
 */
export function stalled(pending: Iterable<PendingRequest>, now: number, stallMs = WATCHDOG_STALL_MS): PendingRequest[] {
  const out: PendingRequest[] = [];
  for (const p of pending) {
    const deadline = (p.until ?? p.at) + stallMs;
    if (now > deadline) out.push(p);
  }
  return out;
}

/* ----------------------------- error counter ---------------------------- */

/** Design §8: three consecutive handler errors on a tab → auto-detach. */
export const MAX_CONSECUTIVE_ERRORS = 3;

/** Advance a per-tab consecutive-error counter; `detach` when the limit is hit. */
export function nextErrorCount(current: number, ok: boolean, limit = MAX_CONSECUTIVE_ERRORS): { count: number; detach: boolean } {
  if (ok) return { count: 0, detach: false };
  const count = current + 1;
  return { count, detach: count >= limit };
}
