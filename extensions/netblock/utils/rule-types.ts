import type { UrlOp } from '@blur/netcore';

// The rule model — the ONE format every engine consumes (design §3, Research
// §5). Pure types and constants: no browser imports, so this module (and every
// module that only depends on it) loads unchanged in Node for
// `e2e/netblock/logic.test.mjs`.
//
// Vocabulary is deliberately the user's, not the browser's: resource types are
// OUR names (`xhr`, not `xmlhttprequest`), and the browser-specific enums are
// mapped in `resource-types.ts`. A rule is DATA — nothing in here is ever
// evaluated as code (design §6.10, CWS remote-code rule).

/* ------------------------------- condition ------------------------------ */

export type { UrlOp };

export interface UrlCondition {
  /** `contains` / `equals` / `wildcard` (`*`, `?`) / `regex` (JS + RE2-safe subset). */
  op: UrlOp;
  value: string;
  caseSensitive?: boolean;
}

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Resource types as the editor shows them. `xhr` covers both XMLHttpRequest and
 * fetch (one DNR type, `xmlhttprequest`); `document` covers main and sub frames;
 * `other` absorbs pings/beacons/CSP reports/objects/etc. (design §3).
 */
export const RESOURCE_KINDS = [
  'xhr',
  'script',
  'image',
  'font',
  'stylesheet',
  'media',
  'websocket',
  'document',
  'other',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const HEADER_OPS = ['exists', 'equals', 'contains'] as const;
export type HeaderOp = (typeof HEADER_OPS)[number];

/** Response-header condition. Every op is expressible as a DNR `HeaderInfo`
 *  (`values` with `*` wildcards), which is what keeps it on the cheap engine. */
export interface HeaderCondition {
  name: string;
  op: HeaderOp;
  /** Ignored for `exists`. */
  value?: string;
}

export interface Condition {
  url?: UrlCondition;
  /** Empty/absent = any method. */
  methods?: HttpMethod[];
  /** Empty/absent = any type. */
  resourceTypes?: ResourceKind[];
  /** Domain of the PAGE that made the request (DNR `initiatorDomains` /
   *  Firefox `originUrl`). Empty/absent = any page. */
  pageDomains?: string[];
  /** `5xx`, `503`, `429,500-599` — see status-match.ts. Presence of this field
   *  moves the rule off DNR (no engine can match a status declaratively). */
  responseStatus?: string;
  responseHeaders?: HeaderCondition[];
}

/* --------------------------------- state -------------------------------- */

export type WindowTrigger = 'navigation' | 'click' | 'manual';

/**
 * When the rule fires, given a match (design §3 "Состояние"). `every` is the
 * stateless default. Each stateful kind is counted per `countKey`.
 */
export type State =
  | { kind: 'every' }
  | { kind: 'once' }
  | { kind: 'times'; n: number }
  /** Exactly the N-th match; with `every`, every N-th (N, 2N, 3N …). */
  | { kind: 'nth'; n: number; every?: boolean }
  /** Let the first `skip` matches through, then fire `times` times (or forever). */
  | { kind: 'skipFirst'; skip: number; times?: number }
  /** Fire with probability `percent`, from a seeded PRNG — reproducible for the
   *  same seed AND the same request order (design §6.11). */
  | { kind: 'probability'; percent: number; seed: number }
  /** Fire only for `seconds` after the trigger event. */
  | { kind: 'window'; trigger: WindowTrigger; seconds: number }
  /** Fire only once rule `ruleId` has matched at least once. */
  | { kind: 'afterRule'; ruleId: string };

export type StateKind = State['kind'];
export const STATE_KINDS: readonly StateKind[] = [
  'every',
  'once',
  'times',
  'nth',
  'skipFirst',
  'probability',
  'window',
  'afterRule',
];

export const COUNT_KEYS = ['rule', 'rule+tab', 'url'] as const;
export type CountKey = (typeof COUNT_KEYS)[number];

export const RESET_ON = ['navigation', 'session', 'manual'] as const;
export type ResetOn = (typeof RESET_ON)[number];

/* -------------------------------- action -------------------------------- */

/**
 * The network error the request fails with. These are CDP `Network.ErrorReason`
 * values verbatim (browser_protocol.json) — the `debugger` engine passes them
 * straight to `Fetch.failRequest`. The page engine can only throw a `TypeError`
 * (reason imitated), Firefox can only cancel — both say so (design §6.6, §3).
 */
export const FAILURE_REASONS = [
  'Failed',
  'TimedOut',
  'ConnectionReset',
  'ConnectionRefused',
  'NameNotResolved',
  'InternetDisconnected',
  'Aborted',
  'BlockedByClient',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/**
 * Bodies a `status` action may carry. `text/html` is served only with a status
 * ≥ 400 and `X-Content-Type-Options: nosniff` — otherwise this would be an HTML
 * injection tool for someone else's origin (design §7.1).
 */
export const BODY_CONTENT_TYPES = [
  'application/json',
  'text/plain',
  'text/html',
  'application/xml',
] as const;
export type BodyContentType = (typeof BODY_CONTENT_TYPES)[number];

export type Action =
  | { type: 'block' }
  | { type: 'fail'; reason: FailureReason }
  | { type: 'delay'; ms: number }
  | { type: 'status'; code: number; body?: string; contentType?: BodyContentType };

export type ActionType = Action['type'];

/* --------------------------------- rule --------------------------------- */

export type RuleScope = 'all' | 'activeTab';

/** Engine preference. `auto` (the default) picks the cheapest engine that can
 *  honour the rule (engine-select.ts); a pinned engine that cannot honour it is
 *  ignored with a note, never silently obeyed. */
export type EnginePreference = 'auto' | 'dnr' | 'page' | 'debugger' | 'webrequest';

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  /** Lower runs first. Recomputed from list order on reorder (design §3). */
  priority: number;
  groupId?: string;
  /** Epoch ms. */
  createdAt: number;
  scope: RuleScope;
  condition: Condition;
  state: State;
  countKey: CountKey;
  resetOn: ResetOn;
  action: Action;
  engine?: EnginePreference;
}

export interface RuleGroup {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
}

/** What `local:rules` holds and what import/export files carry. */
export interface RulesDocument {
  version: 1;
  rules: Rule[];
  groups: RuleGroup[];
}

export const RULES_DOCUMENT_VERSION = 1 as const;

export const EMPTY_RULES_DOCUMENT: RulesDocument = { version: 1, rules: [], groups: [] };

/* -------------------------------- limits -------------------------------- */

// Design §5.8 / §7.1. Soft caps warn, hard caps refuse.
export const LIMITS = {
  /** Soft cap: warn ("Chrome: 5 000 session rules for all tabs"). */
  rulesSoft: 500,
  /** Hard cap: refuse to store more. */
  rulesHard: 2000,
  /** Chrome allows 1 000 regex rules per type; we keep a wide margin. */
  regexRules: 200,
  groups: 200,
  /** Response body for a `status` action. */
  bodyBytes: 64 * 1024,
  /** Import file. */
  importBytes: 2 * 1024 * 1024,
  /** `local:rules` serialised. */
  rulesBytes: 2 * 1024 * 1024,
  delayMs: 60_000,
  windowSeconds: 3600,
  counter: 1_000_000,
  nameLength: 120,
  idLength: 64,
  urlValueLength: 2048,
  headerNameLength: 128,
  headerValueLength: 1024,
  headerConditions: 10,
  pageDomains: 50,
  domainLength: 253,
  statusPatternLength: 64,
} as const;

/** Status codes a `status` action may return. */
export const STATUS_CODE_MIN = 100;
export const STATUS_CODE_MAX = 599;

/* ------------------------------- defaults ------------------------------- */

/** A fresh rule from the editor's "+ Rule" (design §3 defaults column). */
export function defaultRule(id: string, now: number): Rule {
  return {
    id,
    name: '',
    enabled: true,
    priority: 0,
    createdAt: now,
    scope: 'all',
    condition: { url: { op: 'contains', value: '' }, resourceTypes: ['xhr'] },
    state: { kind: 'every' },
    countKey: 'rule+tab',
    resetOn: 'navigation',
    action: { type: 'block' },
    engine: 'auto',
  };
}
