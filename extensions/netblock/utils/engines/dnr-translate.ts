import { hostOf, matchesSuffix, matchesUrlCondition, wildcardToRegExp } from '@blur/netcore';
import type { CompiledRule } from '../engine-select';
import { kindMatches, toDnrTypes, type DnrResourceType } from '../resource-types';
import type { HeaderCondition, HttpMethod, ResourceKind, Rule, UrlCondition } from '../rule-types';
import { countKeyOf } from '../state';

// PURE half of the DNR engine (docs/plans/netblock/02-dnr.md §2–§4): our rule
// model → `declarativeNetRequest` session rules, the deterministic id scheme,
// the diff-based reconcile plan, the reactive-instance reducer and the error
// mapping. No browser imports — e2e/netblock/dnr.test.mjs loads this file
// directly in Node. utils/engines/dnr.ts is the thin browser-facing half.

/* --------------------------------- ids ---------------------------------- */

/**
 * Id layout. Every rule owns a block of SLOTS_PER_RULE consecutive ids keyed by
 * its POSITION in `compiled.byEngine.dnr` (which is priority order): slot 0 is
 * the stateless rule, slots 1… are reactive instances (per tab / per URL).
 * Pause rules live in their own block (`PAUSE_ID_BASE + slot`, one slot per
 * paused tab, the tab itself is in the rule's `tabIds`). Rule ids are 32-bit
 * signed in Chromium and tab ids are NOT small (Chromium 153 hands out ids
 * around 2·10⁹), so nothing here is ever derived from a tab id arithmetically.
 * Anything outside these ranges in `getSessionRules()` is not ours and is
 * never touched. Positional ids are stable as long as the document does not
 * change — and when it does, the diff simply replaces the moved rules (apply
 * is idempotent either way).
 */
export const SLOTS_PER_RULE = 128;
export const RULE_ID_BASE = 1;
/** Twice LIMITS.rulesHard: ids at or above `ruleIdFor(MAX_RULE_INDEX, 0)` are not ours. */
export const MAX_RULE_INDEX = 4096;
export const PAUSE_ID_BASE = 1 << 29;
export const MAX_PAUSE_SLOTS = 4096;
/**
 * Above every block rule (their priorities are ≤ rule count). Deliberately
 * modest: measured on Chromium 153 with `testMatchOutcome`, an allow rule at
 * priority 2^29 or 2^30 LOSES to a priority-1 block rule (2^20 and 2·10^9
 * win) — the indexed priority is packed with the action bits internally, so
 * very large values wrap. e2e/netblock/dnr.live.mjs (d) guards this.
 */
export const PAUSE_PRIORITY = 1_000_000;

export function ruleIdFor(index: number, slot: number): number {
  return RULE_ID_BASE + index * SLOTS_PER_RULE + slot;
}

export function pauseRuleIdFor(slot: number): number {
  return PAUSE_ID_BASE + slot;
}

export type DecodedId = { kind: 'rule'; index: number; slot: number } | { kind: 'pause'; slot: number };

/** Which of our ids this is, or null when the rule is not ours. */
export function decodeRuleId(id: number): DecodedId | null {
  if (!Number.isInteger(id) || id < RULE_ID_BASE) return null;
  if (id >= PAUSE_ID_BASE) {
    const slot = id - PAUSE_ID_BASE;
    return slot < MAX_PAUSE_SLOTS ? { kind: 'pause', slot } : null;
  }
  const n = id - RULE_ID_BASE;
  const index = Math.floor(n / SLOTS_PER_RULE);
  return index < MAX_RULE_INDEX ? { kind: 'rule', index, slot: n % SLOTS_PER_RULE } : null;
}

/* ------------------------------- DNR shapes ------------------------------ */

// Structural subset of `Browser.declarativeNetRequest.Rule` — kept local so
// this module has no browser type imports; dnr.ts casts at the API boundary.
export type DnrRequestMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

export interface DnrHeaderInfo {
  header: string;
  values?: string[];
}

export interface DnrCondition {
  urlFilter?: string;
  regexFilter?: string;
  isUrlFilterCaseSensitive?: boolean;
  requestMethods?: DnrRequestMethod[];
  resourceTypes?: DnrResourceType[];
  initiatorDomains?: string[];
  responseHeaders?: DnrHeaderInfo[];
  tabIds?: number[];
}

export interface DnrRule {
  id: number;
  priority: number;
  action: { type: 'block' | 'allow' };
  condition: DnrCondition;
}

/* ------------------------------ error hints ------------------------------ */

/**
 * Our translation of a browser rejection (design §5.7): the UI shows the
 * browser's words verbatim AND a hint keyed here (`dnrError.<hint>` in i18n).
 */
export type DnrErrorHint =
  | 'regexTooComplex'
  | 'regexInvalid'
  | 'nonAscii'
  | 'tooManyRules'
  | 'tooManyRegexRules'
  | 'unknown';

/** Chrome prefixes per-rule errors with `Rule with id N` (constants.cc). */
export function parseRuleIdFromError(message: string): number | null {
  const m = /Rule with id (\d+)/.exec(message);
  return m ? Number(m[1]) : null;
}

export function hintForDnrError(message: string): DnrErrorHint {
  const m = message.toLowerCase();
  if (m.includes('2kb memory limit') || m.includes('more complex regex') || m.includes('memorylimitexceeded')) {
    return 'regexTooComplex';
  }
  if (m.includes('non-ascii')) return 'nonAscii';
  if (m.includes('rule count for regex rules exceeded')) return 'tooManyRegexRules';
  if (m.includes('rule count exceeded')) return 'tooManyRules';
  if (m.includes('regexfilter') || m.includes('syntaxerror')) return 'regexInvalid';
  return 'unknown';
}

/* ------------------------------ translation ------------------------------ */

const SPECIAL_RE = /[.*+?^${}()|[\]\\]/g;
function escapeRegExp(s: string): string {
  return s.replace(SPECIAL_RE, '\\$&');
}

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) return false;
  return true;
}

/** `*`, `|` and `^` are urlFilter metacharacters; a literal one needs regex. */
const URL_FILTER_META = /[*|^]/;

export interface UrlTranslation {
  urlFilter?: string;
  regexFilter?: string;
  isUrlFilterCaseSensitive?: boolean;
  problem?: DnrErrorHint;
}

/**
 * Our URL op → `urlFilter` where the grammar allows an exact rendering, else
 * `regexFilter`. The JS matcher (`@blur/netcore`) is the reference semantics:
 * `contains` is a plain substring, `equals` the whole URL, `wildcard` is
 * anchored on both ends with `*`/`?`. Regex counts against Chrome's
 * 1 000-per-type limit, so it is the fallback, not the default.
 */
export function translateUrl(url: UrlCondition): UrlTranslation {
  const v = url.value;
  const cs = url.caseSensitive === true;
  if (!isAscii(v)) return { problem: 'nonAscii' };
  const out: UrlTranslation = {};
  if (cs) out.isUrlFilterCaseSensitive = true;
  switch (url.op) {
    case 'contains':
      if (URL_FILTER_META.test(v)) out.regexFilter = escapeRegExp(v);
      else out.urlFilter = v;
      break;
    case 'equals':
      if (URL_FILTER_META.test(v)) out.regexFilter = `^${escapeRegExp(v)}$`;
      else out.urlFilter = `|${v}|`;
      break;
    case 'wildcard':
      // `*` means the same in both grammars; `?` does not exist in urlFilter
      // and `|`/`^` would be read as anchors — those go through the same
      // glob→RegExp the preview uses, so the browser and the preview agree.
      if (/[?|^]/.test(v)) out.regexFilter = wildcardToRegExp(v, cs).source;
      else out.urlFilter = `|${v}|`;
      break;
    case 'regex':
      out.regexFilter = v;
      break;
  }
  return out;
}

function translateHeader(h: HeaderCondition): DnrHeaderInfo {
  const header = h.name.toLowerCase();
  switch (h.op) {
    case 'exists':
      return { header };
    case 'equals':
      return { header, values: [h.value ?? ''] };
    case 'contains':
      // HeaderInfo values have no escaping: a `*`/`?` inside the value is a
      // wildcard for the browser too (documented in the UI hint).
      return { header, values: [`*${h.value ?? ''}*`] };
  }
}

function toPunycode(domain: string): string {
  try {
    return new URL(`http://${domain}`).hostname;
  } catch {
    return domain;
  }
}

export interface ConditionTranslation {
  condition: DnrCondition;
  problem?: DnrErrorHint;
}

/**
 * The base condition of a rule — everything except `tabIds`, which depends on
 * scope / instance and is added by `desiredRules`.
 */
export function translateCondition(rule: Rule, headersSupported: boolean): ConditionTranslation {
  const c = rule.condition;
  const out: DnrCondition = {};
  let problem: DnrErrorHint | undefined;
  if (c.url && c.url.value.length > 0) {
    const u = translateUrl(c.url);
    if (u.problem) problem = u.problem;
    if (u.urlFilter !== undefined) out.urlFilter = u.urlFilter;
    if (u.regexFilter !== undefined) out.regexFilter = u.regexFilter;
    if (u.isUrlFilterCaseSensitive) out.isUrlFilterCaseSensitive = true;
  }
  const types = c.resourceTypes && c.resourceTypes.length > 0 ? toDnrTypes(c.resourceTypes) : [];
  if (types.length > 0) out.resourceTypes = types;
  // `requestMethods` silently excludes non-HTTP requests; on a websocket-only
  // rule it would make the rule dead, so it is dropped there.
  const wsOnly = types.length > 0 && types.every((t) => t === 'websocket');
  if (c.methods && c.methods.length > 0 && !wsOnly) {
    out.requestMethods = Array.from(new Set(c.methods.map((m) => m.toLowerCase() as DnrRequestMethod)));
  }
  if (c.pageDomains && c.pageDomains.length > 0) {
    out.initiatorDomains = Array.from(new Set(c.pageDomains.map(toPunycode)));
  }
  if (headersSupported && c.responseHeaders && c.responseHeaders.length > 0) {
    out.responseHeaders = c.responseHeaders.map(translateHeader);
  }
  return problem ? { condition: out, problem } : { condition: out };
}

/* --------------------------- reactive instances --------------------------- */

export function isReactive(rule: Rule): boolean {
  const k = rule.state.kind;
  return k === 'afterRule' || k === 'window' || k === 'skipFirst';
}

/** Reactive rules whose trigger is a network observation (needs site access). */
export function needsObservation(rule: Rule): boolean {
  const k = rule.state.kind;
  return k === 'afterRule' || k === 'skipFirst';
}

/**
 * One armed copy of a reactive rule. `tabId` scopes it to a tab (`rule+tab`
 * count key), `urlPrefix` to one URL sans query (`url` key); neither = global.
 * `until` is the `window` expiry (epoch ms).
 */
export interface ReactiveInstance {
  ruleId: string;
  key: string;
  slot: number;
  tabId?: number;
  urlPrefix?: string;
  until?: number;
}

export interface ReactiveState {
  /** key → instance. */
  instances: Record<string, ReactiveInstance>;
  /** key → observed matches / hits (skipFirst). */
  counters: Record<string, { seen: number; hits: number }>;
}

export function emptyReactiveState(): ReactiveState {
  return { instances: {}, counters: {} };
}

export type DnrTrigger =
  /** A rule's condition matched a request (any engine; `applied` = it fired). */
  | { type: 'matched'; ruleId: string; tabId: number; url: string; applied: boolean }
  | { type: 'navigation'; tabId: number; url: string }
  | { type: 'click'; tabId: number }
  | { type: 'manual'; ruleId: string; tabId?: number }
  | { type: 'tabActivated'; tabId: number; windowId: number }
  | { type: 'tabRemoved'; tabId: number }
  | { type: 'reset'; ruleId?: string }
  | { type: 'tick' };

function urlSansQuery(url: string): string {
  const i = url.indexOf('?');
  const j = url.indexOf('#');
  return url.slice(0, Math.min(i === -1 ? url.length : i, j === -1 ? url.length : j));
}

/** Where an instance of `rule` triggered from (`tabId`, `url`) should live. */
function instanceTarget(rule: Rule, tabId: number | undefined, url: string): { tabId?: number; urlPrefix?: string } {
  switch (rule.countKey) {
    case 'rule+tab':
      return tabId !== undefined && tabId >= 0 ? { tabId } : {};
    case 'url': {
      const prefix = urlSansQuery(url);
      // `afterRule` is keyed by B's own requests, which the trigger (A's
      // request) says nothing about; and a prefix with urlFilter metacharacters
      // cannot be anchored — both fall back to a global instance.
      if (rule.state.kind === 'afterRule' || prefix.length === 0 || URL_FILTER_META.test(prefix) || !isAscii(prefix)) return {};
      return { urlPrefix: prefix };
    }
    case 'rule':
      return {};
  }
}

/** Instance key = the count key; a global instance (no tab, no URL) is keyed by the rule id alone. */
function keyFor(rule: Rule, target: { tabId?: number; urlPrefix?: string }): string {
  if (target.tabId === undefined && target.urlPrefix === undefined) return rule.id;
  return countKeyOf(rule, { tabId: target.tabId, url: target.urlPrefix ?? '' });
}

/** Smallest free slot ≥ 1 for `ruleId` — deterministic, so tests can predict ids. */
function freeSlot(state: ReactiveState, ruleId: string): number | null {
  const used = new Set<number>();
  for (const inst of Object.values(state.instances)) if (inst.ruleId === ruleId) used.add(inst.slot);
  for (let s = 1; s < SLOTS_PER_RULE; s++) if (!used.has(s)) return s;
  return null;
}

function arm(state: ReactiveState, rule: Rule, target: { tabId?: number; urlPrefix?: string }, until?: number): ReactiveState {
  const key = keyFor(rule, target);
  const existing = state.instances[key];
  if (existing) {
    if (until === undefined || (existing.until !== undefined && existing.until >= until)) return state;
    return { ...state, instances: { ...state.instances, [key]: { ...existing, until } } };
  }
  const slot = freeSlot(state, rule.id);
  if (slot === null) return state; // > 127 live instances of one rule: leave as is
  const inst: ReactiveInstance = { ruleId: rule.id, key, slot };
  if (target.tabId !== undefined) inst.tabId = target.tabId;
  if (target.urlPrefix !== undefined) inst.urlPrefix = target.urlPrefix;
  if (until !== undefined) inst.until = until;
  return { ...state, instances: { ...state.instances, [key]: inst } };
}

function dropWhere(state: ReactiveState, pred: (key: string, ruleId: string) => boolean): ReactiveState {
  const instances: ReactiveState['instances'] = {};
  const counters: ReactiveState['counters'] = {};
  for (const [k, v] of Object.entries(state.instances)) if (!pred(k, v.ruleId)) instances[k] = v;
  for (const [k, v] of Object.entries(state.counters)) if (!pred(k, k.split('|')[0]!)) counters[k] = v;
  return { instances, counters };
}

function keyBelongs(key: string, ruleId: string): boolean {
  return key === ruleId || key.startsWith(`${ruleId}|`);
}

/** Drop instances of rules that are gone or no longer reactive DNR rules. */
export function pruneReactive(state: ReactiveState, rules: readonly CompiledRule[]): ReactiveState {
  const live = new Set(rules.filter((c) => isReactive(c.rule)).map((c) => c.rule.id));
  return dropWhere(state, (_k, ruleId) => !live.has(ruleId));
}

/**
 * The reactive state machine (plan §4), as a pure reducer. `rules` is the
 * engine's current dnr slice; `now` is epoch ms.
 */
export function reactiveStep(state: ReactiveState, rules: readonly CompiledRule[], trigger: DnrTrigger, now: number): ReactiveState {
  let next = state;
  switch (trigger.type) {
    case 'matched': {
      for (const { rule } of rules) {
        if (rule.state.kind === 'afterRule' && rule.state.ruleId === trigger.ruleId) {
          next = arm(next, rule, instanceTarget(rule, trigger.tabId, trigger.url));
        }
        if (rule.id === trigger.ruleId && rule.state.kind === 'skipFirst') {
          const target = instanceTarget(rule, trigger.tabId, trigger.url);
          const key = keyFor(rule, target);
          const prev = next.counters[key] ?? { seen: 0, hits: 0 };
          const c = { seen: prev.seen + 1, hits: prev.hits + (trigger.applied ? 1 : 0) };
          next = { ...next, counters: { ...next.counters, [key]: c } };
          const { skip, times } = rule.state;
          if (times !== undefined && c.hits >= times) {
            next = dropWhere(next, (k) => k === key);
            // Keep the exhausted counter so the instance is not re-armed by the
            // next observed match (decide() has the same "hits < times" gate).
            next = { ...next, counters: { ...next.counters, [key]: c } };
          } else if (c.seen >= skip) {
            next = arm(next, rule, target);
          }
        }
      }
      break;
    }
    case 'navigation': {
      // Mirror state.ts resetForNavigation: per-tab keys of that tab, global
      // keys entirely — then open navigation-triggered windows.
      const resetIds = new Set(rules.filter((c) => c.rule.resetOn === 'navigation').map((c) => c.rule.id));
      const byId = new Map(rules.map((c) => [c.rule.id, c.rule]));
      next = dropWhere(next, (key, ruleId) => {
        if (!resetIds.has(ruleId)) return false;
        const rule = byId.get(ruleId)!;
        return rule.countKey !== 'rule+tab' || key === `${ruleId}|t${trigger.tabId}`;
      });
      for (const { rule } of rules) {
        if (rule.state.kind === 'window' && rule.state.trigger === 'navigation') {
          next = arm(next, rule, instanceTarget(rule, trigger.tabId, trigger.url), now + rule.state.seconds * 1000);
        }
      }
      break;
    }
    case 'click':
      for (const { rule } of rules) {
        if (rule.state.kind === 'window' && rule.state.trigger === 'click') {
          next = arm(next, rule, instanceTarget(rule, trigger.tabId, ''), now + rule.state.seconds * 1000);
        }
      }
      break;
    case 'manual':
      for (const { rule } of rules) {
        if (rule.id === trigger.ruleId && rule.state.kind === 'window') {
          next = arm(next, rule, instanceTarget(rule, trigger.tabId, ''), now + rule.state.seconds * 1000);
        }
      }
      break;
    case 'tabRemoved':
      next = dropWhere(next, (key) => key.endsWith(`|t${trigger.tabId}`));
      break;
    case 'reset': {
      const id = trigger.ruleId;
      if (id === undefined) return emptyReactiveState();
      // Resetting A also un-arms every "B after A" (state.ts drops matched[A]).
      const dependants = new Set(rules.filter((c) => c.rule.state.kind === 'afterRule' && c.rule.state.ruleId === id).map((c) => c.rule.id));
      next = dropWhere(next, (key, ruleId) => keyBelongs(key, id) || dependants.has(ruleId));
      break;
    }
    case 'tick':
      next = dropWhere(next, (key) => {
        const inst = next.instances[key];
        return inst?.until !== undefined && inst.until <= now;
      });
      break;
    case 'tabActivated':
      break; // engine-level (active tab map), nothing to do in the reducer
  }
  return next;
}

/** Earliest `window` expiry, for the engine's timer. */
export function nextExpiry(state: ReactiveState): number | undefined {
  let min: number | undefined;
  for (const inst of Object.values(state.instances)) {
    if (inst.until !== undefined && (min === undefined || inst.until < min)) min = inst.until;
  }
  return min;
}

/* ------------------------------ desired set ------------------------------ */

export interface DesiredInput {
  /** The dnr slice, priority order (ids are positional — never filter it). */
  rules: readonly CompiledRule[];
  /** Rule ids the browser or the translation refused: skipped, index kept. */
  refused?: ReadonlySet<string>;
  headersSupported: boolean;
  /** Active tab of every window (scope `activeTab`). */
  activeTabs: readonly number[];
  pausedTabs: readonly number[];
  reactive: ReactiveState;
}

export interface DesiredOutput {
  rules: DnrRule[];
  /** Rules that cannot be expressed (non-ASCII…) — the engine reports them. */
  problems: { ruleId: string; hint: DnrErrorHint }[];
}

/**
 * The complete set of session rules we want installed right now. Pure and
 * total: the same input always yields the same list (sorted by id), which is
 * what makes `apply` idempotent.
 */
export function desiredRules(input: DesiredInput): DesiredOutput {
  const out: DnrRule[] = [];
  const problems: DesiredOutput['problems'] = [];
  const n = input.rules.length;
  const active = new Set(input.activeTabs);
  input.rules.forEach(({ rule }, index) => {
    if (input.refused?.has(rule.id)) return;
    const t = translateCondition(rule, input.headersSupported);
    if (t.problem) {
      problems.push({ ruleId: rule.id, hint: t.problem });
      return;
    }
    const priority = n - index;
    const scopeTabs = rule.scope === 'activeTab' ? input.activeTabs : undefined;
    if (scopeTabs && scopeTabs.length === 0) return; // no active tab → nothing to scope to
    if (!isReactive(rule)) {
      const condition: DnrCondition = { ...t.condition };
      if (scopeTabs) condition.tabIds = [...scopeTabs].sort((a, b) => a - b);
      out.push({ id: ruleIdFor(index, 0), priority, action: { type: 'block' }, condition });
      return;
    }
    for (const inst of Object.values(input.reactive.instances)) {
      if (inst.ruleId !== rule.id) continue;
      const condition: DnrCondition = { ...t.condition };
      if (inst.tabId !== undefined) {
        if (scopeTabs && !active.has(inst.tabId)) continue;
        condition.tabIds = [inst.tabId];
      } else if (scopeTabs) {
        condition.tabIds = [...scopeTabs].sort((a, b) => a - b);
      }
      if (inst.urlPrefix !== undefined) {
        delete condition.regexFilter;
        condition.urlFilter = `|${inst.urlPrefix}`;
      }
      out.push({ id: ruleIdFor(index, inst.slot), priority, action: { type: 'block' }, condition });
    }
  });
  // Pause slots follow the sorted tab list: deterministic, and a re-slot on
  // pause/resume is just a remove+add inside the same atomic update.
  [...new Set(input.pausedTabs)]
    .filter((t) => t >= 0)
    .sort((a, b) => a - b)
    .slice(0, MAX_PAUSE_SLOTS)
    .forEach((tabId, slot) => {
      out.push({ id: pauseRuleIdFor(slot), priority: PAUSE_PRIORITY, action: { type: 'allow' }, condition: { tabIds: [tabId] } });
    });
  out.sort((a, b) => a.id - b.id);
  return { rules: out, problems };
}

/* -------------------------------- reconcile ------------------------------ */

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface SessionPlan {
  removeRuleIds: number[];
  addRules: DnrRule[];
}

/**
 * Diff `desired` against what the browser holds. Only OUR ids are considered
 * (foreign session rules are invisible to the plan); an unchanged rule is left
 * alone, a changed one is removed and re-added in the same atomic update.
 */
export function planSessionUpdate(desired: readonly DnrRule[], current: readonly DnrRule[]): SessionPlan {
  const cur = new Map<number, DnrRule>();
  for (const r of current) if (decodeRuleId(r.id)) cur.set(r.id, r);
  const want = new Map(desired.map((r) => [r.id, r]));
  const removeRuleIds: number[] = [];
  const addRules: DnrRule[] = [];
  for (const [id, r] of want) {
    const c = cur.get(id);
    if (c && canonical(c) === canonical(r)) continue;
    if (c) removeRuleIds.push(id);
    addRules.push(r);
  }
  for (const id of cur.keys()) if (!want.has(id)) removeRuleIds.push(id);
  removeRuleIds.sort((a, b) => a - b);
  return { removeRuleIds, addRules };
}

/** `current` after a plan was applied successfully. */
export function applyPlan(current: readonly DnrRule[], plan: SessionPlan): DnrRule[] {
  const removed = new Set(plan.removeRuleIds);
  return [...current.filter((r) => !removed.has(r.id)), ...plan.addRules].sort((a, b) => a.id - b.id);
}

/* -------------------------------- recovery ------------------------------- */

/**
 * After a service-worker restart the browser still holds our session rules;
 * rebuild the reactive state from them. `afterRule`/`skipFirst` instances whose
 * content still matches the current translation are kept armed; `window`
 * instances are dropped (their expiry is unknown — fail-open, close early);
 * instances scoped to a dead tab are dropped.
 */
export function recoverReactive(
  sessionRules: readonly DnrRule[],
  rules: readonly CompiledRule[],
  headersSupported: boolean,
  liveTabs: ReadonlySet<number>,
): ReactiveState {
  let state = emptyReactiveState();
  for (const r of sessionRules) {
    const d = decodeRuleId(r.id);
    if (!d || d.kind !== 'rule' || d.slot === 0) continue;
    const compiled = rules[d.index];
    if (!compiled || !isReactive(compiled.rule) || compiled.rule.state.kind === 'window') continue;
    const rule = compiled.rule;
    const target: { tabId?: number; urlPrefix?: string } = {};
    if (r.condition.tabIds?.length === 1 && rule.countKey === 'rule+tab') {
      if (!liveTabs.has(r.condition.tabIds[0]!)) continue;
      target.tabId = r.condition.tabIds[0]!;
    }
    if (rule.countKey === 'url' && r.condition.urlFilter?.startsWith('|')) target.urlPrefix = r.condition.urlFilter.slice(1);
    const key = keyFor(rule, target);
    if (state.instances[key]) continue;
    const inst: ReactiveInstance = { ruleId: rule.id, key, slot: d.slot };
    if (target.tabId !== undefined) inst.tabId = target.tabId;
    if (target.urlPrefix !== undefined) inst.urlPrefix = target.urlPrefix;
    const candidate: ReactiveState = { ...state, instances: { ...state.instances, [key]: inst } };
    // Content check: the recovered rule must be what we would install now.
    const want = desiredRules({ rules, headersSupported, activeTabs: rule.scope === 'activeTab' ? r.condition.tabIds ?? [] : [], pausedTabs: [], reactive: candidate }).rules.find((x) => x.id === r.id);
    if (!want || canonical(want) !== canonical(r)) continue;
    state = candidate;
    if (rule.state.kind === 'skipFirst') {
      state = { ...state, counters: { ...state.counters, [key]: { seen: rule.state.skip, hits: 0 } } };
    }
  }
  return state;
}

/* ------------------------------ observation ------------------------------ */

export interface ObservedRequest {
  url: string;
  method: string;
  kind: ResourceKind;
  /** webRequest `initiator` (an origin), when present. */
  initiator?: string;
}

/**
 * Does a request the counters saw (webRequest on a granted origin) match the
 * rule's condition? Same matcher as the preview and the JS engines; response
 * headers are not checked (the ≈ counter never sees them).
 */
export function requestMatchesRule(rule: Rule, req: ObservedRequest): boolean {
  const c = rule.condition;
  if (c.url && c.url.value.length > 0 && !matchesUrlCondition({ key: 'url', ...c.url }, req.url)) return false;
  if (c.methods && c.methods.length > 0 && !c.methods.includes(req.method.toUpperCase() as HttpMethod)) return false;
  if (!kindMatches(c.resourceTypes, req.kind)) return false;
  if (c.pageDomains && c.pageDomains.length > 0) {
    const host = hostOf(req.initiator);
    if (!host || !matchesSuffix(host, c.pageDomains)) return false;
  }
  return true;
}

/** True when `rule` currently has an installed block rule covering `tabId`. */
export function coversTab(installed: readonly DnrRule[], rules: readonly CompiledRule[], ruleId: string, tabId: number): boolean {
  const index = rules.findIndex((c) => c.rule.id === ruleId);
  if (index === -1) return false;
  if (installed.some((r) => decodeRuleId(r.id)?.kind === 'pause' && r.condition.tabIds?.includes(tabId))) return false;
  return installed.some((r) => {
    const d = decodeRuleId(r.id);
    return d?.kind === 'rule' && d.index === index && (!r.condition.tabIds || r.condition.tabIds.includes(tabId));
  });
}
