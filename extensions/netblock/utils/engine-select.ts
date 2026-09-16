import type { Rule, RuleGroup } from './rule-types';

// `engine: auto` — pick the CHEAPEST engine that can honour the rule, and say
// honestly what that engine cannot do (design §0 table, Research §4, spikes
// S2/S3/S4). Pure: no browser imports; the decision table is unit-tested in
// e2e/netblock/logic.test.mjs.
//
// Chrome ladder:  dnr  →  page  →  debugger
//   dnr       stateless (or reactive-approximate) block; no host access needed
//   page      MAIN-world fetch/XHR patch: exact counters, status/delay/body for
//             xhr ONLY; DevTools shows the real response (✱)
//   debugger  CDP Fetch: real status, fail reasons, every resource type the
//             Fetch domain can pause (not WebSocket) — install-time
//             permission, opt-in per tab, banner (see wxt.config.ts)
// Firefox: one engine, `webrequest` (blocking listener), with two degradations.

export type EngineId = 'dnr' | 'page' | 'debugger' | 'webrequest';
export type Platform = 'chrome' | 'firefox';

/** What this build/browser can do — feature-detected once in the background. */
export interface EngineCaps {
  /** `RuleConditionKeys` contains RESPONSE_HEADERS (Chrome 145+; assume 128+). */
  dnrResponseHeaders: boolean;
  /** `chrome.debugger` exists AND the build carries the permission. */
  debugger: boolean;
  /** The user has not disabled the page engine in Settings. */
  page: boolean;
}

export const CHROME_DEFAULT_CAPS: EngineCaps = { dnrResponseHeaders: false, debugger: false, page: true };
export const FIREFOX_CAPS: EngineCaps = { dnrResponseHeaders: false, debugger: false, page: false };

/**
 * Keys of the honesty strings (design §6) — each becomes `honesty.<key>` in
 * i18n.ts. A decision carries the ones that apply, so the badge tooltip, the
 * inactive card and the log legend all read from one source.
 */
export type HonestyKey =
  | 'dnrCountApprox' // §6.1  ≈ counter
  | 'pageNotNetwork' // §6.2  ✱ DevTools shows the real response
  | 'pageOnlyXhr' // §6.2  page engine cannot see images/scripts/workers
  | 'dnrHeadersHalfBlock' // §6.3  server already processed the request
  | 'dnrHeadersUnsupported' // §6.3  Chrome < 128 / no RuleConditionKeys
  | 'nlBanner' // §6.4
  | 'nlSlowsTab' // §6.5
  | 'ffFailCancel' // §6.6  wr↓ fail reason → cancel
  | 'ffStatusCancel' // §6.6  wr↓ status → cancel (spike S2)
  | 'countersResetOnRestart' // §6.7
  | 'reactiveParallelSlip' // §6.8  ≈ parallel requests may slip
  | 'noLogWithoutAccess' // §6.9
  | 'rulesAreData' // §6.10
  | 'seedSameOrder' // §6.11
  | 'status2xxIsMock' // §6.12
  | 'wsOnlyBlock' // spike S4: WebSocket only via DNR block
  | 'needsNetworkLevel' // §2.8: rule needs the debugger engine on this tab
  | 'nlUnavailableBuild' // wxt.config.ts: no debugger permission in this build
  | 'failReasonImitated' // page/fail: TypeError, reason not selectable
  | 'preferenceIgnored'; // pinned engine cannot honour the rule

export interface EngineDecision {
  /** null = no engine in this build can run the rule (see `unsupported`). */
  engine: EngineId | null;
  /** Honest caveats that apply when the rule runs on `engine`. */
  reasons: HonestyKey[];
  /** The engine runs the rule in a weaker form (Firefox `wr↓`, page `fail`). */
  degraded?: HonestyKey;
  /** Why nothing can run it. */
  unsupported?: HonestyKey;
}

/* ------------------------------- predicates ----------------------------- */

function needsResponse(rule: Rule): boolean {
  return rule.condition.responseStatus !== undefined;
}
function hasHeaderCondition(rule: Rule): boolean {
  return (rule.condition.responseHeaders?.length ?? 0) > 0;
}
/** Absent/empty = all types, which is "beyond xhr". */
function onlyXhr(rule: Rule): boolean {
  const t = rule.condition.resourceTypes;
  return !!t && t.length > 0 && t.every((k) => k === 'xhr');
}
function includesWebSocket(rule: Rule): boolean {
  const t = rule.condition.resourceTypes;
  return !t || t.length === 0 || t.includes('websocket');
}
function onlyWebSocket(rule: Rule): boolean {
  const t = rule.condition.resourceTypes;
  return !!t && t.length > 0 && t.every((k) => k === 'websocket');
}
/** Exact counting the browser cannot do declaratively. */
function needsExactState(rule: Rule): boolean {
  const k = rule.state.kind;
  return k === 'once' || k === 'times' || k === 'nth' || k === 'probability';
}
/** Sequential dependencies DNR can follow reactively (spike S3: 40/40 sequential, 0/5 parallel). */
function isReactiveState(rule: Rule): boolean {
  const k = rule.state.kind;
  return k === 'afterRule' || k === 'window' || k === 'skipFirst';
}

/* ------------------------------- selection ------------------------------ */

function chromeAuto(rule: Rule, caps: EngineCaps): EngineDecision {
  const action = rule.action.type;

  // WebSocket handshakes are invisible to CDP Fetch (S4) and to the page patch
  // (v1 patches fetch/XHR only); DNR can only block them. Anything else on a
  // websocket-only rule is unsupported; on a mixed rule the websocket part is
  // simply not honoured, which the note says.
  if (onlyWebSocket(rule) && (action !== 'block' || needsResponse(rule) || needsExactState(rule))) {
    return { engine: null, reasons: [], unsupported: 'wsOnlyBlock' };
  }

  // --- L1: DNR --------------------------------------------------------------
  const dnrAction = action === 'block';
  const dnrCondition = !needsResponse(rule) && (!hasHeaderCondition(rule) || caps.dnrResponseHeaders);
  if (dnrAction && dnrCondition && !needsExactState(rule)) {
    const reasons: HonestyKey[] = ['dnrCountApprox'];
    if (hasHeaderCondition(rule)) reasons.push('dnrHeadersHalfBlock');
    if (isReactiveState(rule)) reasons.push('reactiveParallelSlip');
    if (includesWebSocket(rule) && !onlyWebSocket(rule)) reasons.push('wsOnlyBlock');
    return { engine: 'dnr', reasons };
  }

  // --- L2: page (xhr only) --------------------------------------------------
  const pageReasons: HonestyKey[] = ['pageNotNetwork', 'pageOnlyXhr'];
  if (hasHeaderCondition(rule) && !caps.dnrResponseHeaders && dnrAction && !needsResponse(rule)) {
    pageReasons.push('dnrHeadersUnsupported');
  }
  if (caps.page && onlyXhr(rule)) {
    if (action === 'fail') {
      // The page can only throw a TypeError. With a debugger engine available
      // the exact reason wins; without one (v1 build) we degrade honestly,
      // mirroring Firefox's wr↓, instead of leaving `fail` dead on Chrome.
      if (caps.debugger) return { engine: 'debugger', reasons: ['nlBanner', 'nlSlowsTab', 'needsNetworkLevel'] };
      return { engine: 'page', reasons: pageReasons, degraded: 'failReasonImitated' };
    }
    if (action === 'status' && rule.action.type === 'status' && rule.action.code < 400) {
      pageReasons.push('status2xxIsMock');
    }
    if (rule.state.kind === 'probability') pageReasons.push('seedSameOrder');
    return { engine: 'page', reasons: pageReasons };
  }

  // --- L3: debugger ---------------------------------------------------------
  const reasons: HonestyKey[] = ['nlBanner', 'nlSlowsTab', 'needsNetworkLevel'];
  if (includesWebSocket(rule)) reasons.push('wsOnlyBlock');
  if (caps.debugger) return { engine: 'debugger', reasons };
  // No debugger in this build: the rule is shown with its would-be engine and
  // the reason it cannot run — never silently dropped, never silently downgraded.
  return { engine: 'debugger', reasons, unsupported: 'nlUnavailableBuild' };
}

function firefoxAuto(rule: Rule): EngineDecision {
  const reasons: HonestyKey[] = [];
  if (rule.state.kind === 'probability') reasons.push('seedSameOrder');
  switch (rule.action.type) {
    case 'fail':
      return { engine: 'webrequest', reasons, degraded: 'ffFailCancel' };
    case 'status':
      // Spike S2: `redirectUrl` → data: reaches the page but always as 200; a
      // status cannot be changed, so an error status degrades to cancel.
      return { engine: 'webrequest', reasons, degraded: 'ffStatusCancel' };
    default:
      return { engine: 'webrequest', reasons };
  }
}

/**
 * Decide the engine for one rule. A pinned `rule.engine` is honoured only if
 * the auto decision could also have produced it (i.e. the engine can actually
 * run the rule); otherwise auto wins and `preferenceIgnored` is noted.
 */
export function selectEngine(rule: Rule, platform: Platform, caps: EngineCaps): EngineDecision {
  const auto = platform === 'firefox' ? firefoxAuto(rule) : chromeAuto(rule, caps);
  const pref = rule.engine ?? 'auto';
  if (pref === 'auto' || pref === auto.engine) return auto;
  if (platform === 'chrome' && auto.engine === 'dnr' && pref === 'page' && caps.page && onlyXhr(rule)) {
    // A user may prefer exact counters over a cheaper block: allowed.
    return { engine: 'page', reasons: ['pageNotNetwork', 'pageOnlyXhr'] };
  }
  return { ...auto, reasons: [...auto.reasons, 'preferenceIgnored'] };
}

/* ------------------------------ compilation ----------------------------- */

export interface CompiledRule {
  rule: Rule;
  engine: EngineId;
  reasons: HonestyKey[];
  degraded?: HonestyKey;
}

export interface InactiveRule {
  rule: Rule;
  /** Engine it would need, if any. */
  engine: EngineId | null;
  reason: HonestyKey | 'disabled' | 'groupDisabled';
}

/** Everything the engines need, grouped per engine, in priority order. */
export interface CompiledRuleSet {
  byEngine: Record<EngineId, CompiledRule[]>;
  inactive: InactiveRule[];
  compiledAt: number;
}

export function emptyRuleSet(now = 0): CompiledRuleSet {
  return { byEngine: { dnr: [], page: [], debugger: [], webrequest: [] }, inactive: [], compiledAt: now };
}

/**
 * Sort by priority then by creation (stable, explicit — DNR's order at equal
 * priority is unspecified, Research §2.1), decide an engine per rule, and split
 * enabled rules from inactive ones with the reason for each.
 */
export function compileRules(
  rules: readonly Rule[],
  groups: readonly RuleGroup[],
  platform: Platform,
  caps: EngineCaps,
  now: number,
): CompiledRuleSet {
  const set = emptyRuleSet(now);
  const disabledGroups = new Set(groups.filter((g) => !g.enabled).map((g) => g.id));
  const ordered = [...rules].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  for (const rule of ordered) {
    if (!rule.enabled) {
      set.inactive.push({ rule, engine: null, reason: 'disabled' });
      continue;
    }
    if (rule.groupId !== undefined && disabledGroups.has(rule.groupId)) {
      set.inactive.push({ rule, engine: null, reason: 'groupDisabled' });
      continue;
    }
    const d = selectEngine(rule, platform, caps);
    if (d.engine === null || d.unsupported) {
      set.inactive.push({ rule, engine: d.engine, reason: d.unsupported ?? 'wsOnlyBlock' });
      continue;
    }
    const compiled: CompiledRule = { rule, engine: d.engine, reasons: d.reasons };
    if (d.degraded) compiled.degraded = d.degraded;
    set.byEngine[d.engine].push(compiled);
  }
  return set;
}
