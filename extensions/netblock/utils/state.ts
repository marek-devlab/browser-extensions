import type { Rule } from './rule-types';

// Stateful rules as a PURE decision function over a snapshot (design §3
// "Состояние", §8). Every engine — page script, Firefox blocking listener,
// background — calls `decide()` with the snapshot it holds and stores the
// returned one; the background persists snapshots to `session:state` under
// the `netblock-state` Web Lock (storage.ts). No browser imports.
//
// Terminology: a rule's condition MATCHES a request; the rule then either
// APPLIES (fires its action) or lets the request through. `seen` counts
// matches, `hits` counts applications — both per `countKey`.

export interface Counter {
  seen: number;
  hits: number;
  /** Epoch ms until which a `window` rule fires; absent = closed. */
  windowUntil?: number;
  /** mulberry32 state for `probability`; seeded on first use. */
  rng?: number;
  lastAt?: number;
}

export interface StateSnapshot {
  /** Per countKey (see `countKeyOf`). */
  counters: Record<string, Counter>;
  /** ruleId → epoch ms of its last MATCH; drives `afterRule`. */
  matched: Record<string, number>;
}

export function emptySnapshot(): StateSnapshot {
  return { counters: {}, matched: {} };
}

export interface DecideContext {
  tabId?: number;
  url: string;
  now: number;
}

export interface Decision {
  apply: boolean;
  next: StateSnapshot;
  /** The counter after this decision — for the popup's `2/3` display. */
  counter: Counter;
  key: string;
}

/* ------------------------------ count keys ------------------------------ */

function urlWithoutQuery(url: string): string {
  const i = url.indexOf('?');
  const j = url.indexOf('#');
  const cut = Math.min(i === -1 ? url.length : i, j === -1 ? url.length : j);
  return url.slice(0, cut);
}

/** `rule` → `<id>`; `rule+tab` → `<id>|t<tab>`; `url` → `<id>|u<url-sans-query>`. */
export function countKeyOf(rule: Pick<Rule, 'id' | 'countKey'>, ctx: Pick<DecideContext, 'tabId' | 'url'>): string {
  switch (rule.countKey) {
    case 'rule':
      return rule.id;
    case 'rule+tab':
      return `${rule.id}|t${ctx.tabId ?? -1}`;
    case 'url':
      return `${rule.id}|u${urlWithoutQuery(ctx.url)}`;
  }
}

/* --------------------------------- PRNG --------------------------------- */

/** mulberry32: 32-bit state → [0, 1). Tiny, fast, good enough for chaos. */
export function mulberry32(state: number): { value: number; next: number } {
  let a = (state + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, next: a };
}

/** FNV-1a over a string → uint32. Folds the count key into the seed so two
 *  tabs with the same seed do not share one sequence. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* -------------------------------- decide -------------------------------- */

function withCounter(snap: StateSnapshot, key: string, counter: Counter): StateSnapshot {
  return { counters: { ...snap.counters, [key]: counter }, matched: snap.matched };
}

/**
 * The rule's condition matched a request: decide whether it applies, and
 * return the advanced snapshot. Pure — the caller stores `next`.
 */
export function decide(rule: Rule, snap: StateSnapshot, ctx: DecideContext): Decision {
  const key = countKeyOf(rule, ctx);
  const prev: Counter = snap.counters[key] ?? { seen: 0, hits: 0 };
  const seen = prev.seen + 1; // this match, 1-based
  const c: Counter = { ...prev, seen, lastAt: ctx.now };
  let apply: boolean;

  const s = rule.state;
  switch (s.kind) {
    case 'every':
      apply = true;
      break;
    case 'once':
      apply = prev.hits === 0;
      break;
    case 'times':
      apply = prev.hits < s.n;
      break;
    case 'nth':
      apply = s.every ? seen % s.n === 0 : seen === s.n;
      break;
    case 'skipFirst':
      apply = seen > s.skip && (s.times === undefined || prev.hits < s.times);
      break;
    case 'probability': {
      const state = prev.rng ?? (s.seed ^ fnv1a(key)) >>> 0;
      const r = mulberry32(state);
      c.rng = r.next;
      apply = r.value * 100 < s.percent;
      break;
    }
    case 'window':
      apply = prev.windowUntil !== undefined && ctx.now < prev.windowUntil;
      break;
    case 'afterRule':
      apply = snap.matched[s.ruleId] !== undefined;
      break;
  }
  if (apply) c.hits = prev.hits + 1;

  const next: StateSnapshot = {
    counters: { ...snap.counters, [key]: c },
    matched: { ...snap.matched, [rule.id]: ctx.now },
  };
  return { apply, next, counter: c, key };
}

/**
 * Record that a rule's condition matched WITHOUT deciding (e.g. a DNR rule the
 * browser applied itself, observed via ERR_BLOCKED_BY_CLIENT). Feeds `afterRule`.
 */
export function markMatched(snap: StateSnapshot, ruleId: string, now: number): StateSnapshot {
  return { counters: snap.counters, matched: { ...snap.matched, [ruleId]: now } };
}

/**
 * An engine that does NOT decide through `decide()` (DNR: the browser
 * applied the rule, we only observed `ERR_BLOCKED_BY_CLIENT`) reports the
 * application after the fact: one more match, one more hit, rule matched.
 * This is what the popup's `≈N` counts (design §4.2, §6.1).
 */
export function recordHit(rule: Rule, snap: StateSnapshot, ctx: DecideContext): StateSnapshot {
  const key = countKeyOf(rule, ctx);
  const prev: Counter = snap.counters[key] ?? { seen: 0, hits: 0 };
  const counter: Counter = { ...prev, seen: prev.seen + 1, hits: prev.hits + 1, lastAt: ctx.now };
  return { counters: { ...snap.counters, [key]: counter }, matched: { ...snap.matched, [rule.id]: ctx.now } };
}

/** A `window` rule's trigger fired (navigation / click / manual): open it. */
export function openWindow(
  rule: Rule,
  snap: StateSnapshot,
  ctx: DecideContext,
): StateSnapshot {
  if (rule.state.kind !== 'window') return snap;
  const key = countKeyOf(rule, ctx);
  const prev = snap.counters[key] ?? { seen: 0, hits: 0 };
  return withCounter(snap, key, { ...prev, windowUntil: ctx.now + rule.state.seconds * 1000 });
}

/** Whether a rule is currently inside its window (for the popup's status). */
export function windowOpen(rule: Rule, snap: StateSnapshot, ctx: DecideContext): boolean {
  const c = snap.counters[countKeyOf(rule, ctx)];
  return c?.windowUntil !== undefined && ctx.now < c.windowUntil;
}

/* --------------------------------- reset -------------------------------- */

function keyBelongsToRule(key: string, ruleId: string): boolean {
  return key === ruleId || key.startsWith(`${ruleId}|`);
}

/** Manual reset: one rule's counters (all keys) or everything. */
export function resetCounters(snap: StateSnapshot, ruleId?: string): StateSnapshot {
  if (ruleId === undefined) return emptySnapshot();
  const counters: Record<string, Counter> = {};
  for (const [k, v] of Object.entries(snap.counters)) if (!keyBelongsToRule(k, ruleId)) counters[k] = v;
  const matched = { ...snap.matched };
  delete matched[ruleId];
  return { counters, matched };
}

/**
 * A top-level navigation happened in `tabId`: drop the counters of rules with
 * `resetOn: 'navigation'` that are keyed to that tab, or to the rule as a
 * whole (`countKey: 'rule'` / `'url'` — a navigation anywhere restarts them,
 * which is what "per navigation" means for a cross-tab key).
 */
export function resetForNavigation(snap: StateSnapshot, rules: readonly Rule[], tabId: number): StateSnapshot {
  const counters = { ...snap.counters };
  const matched = { ...snap.matched };
  for (const rule of rules) {
    if (rule.resetOn !== 'navigation') continue;
    for (const key of Object.keys(counters)) {
      if (!keyBelongsToRule(key, rule.id)) continue;
      if (rule.countKey === 'rule+tab' && key !== `${rule.id}|t${tabId}`) continue;
      delete counters[key];
    }
    if (rule.countKey !== 'rule+tab') delete matched[rule.id];
  }
  return { counters, matched };
}

/** A tab closed: its per-tab counters are garbage. */
export function forgetTab(snap: StateSnapshot, tabId: number): StateSnapshot {
  const suffix = `|t${tabId}`;
  const counters: Record<string, Counter> = {};
  for (const [k, v] of Object.entries(snap.counters)) if (!k.endsWith(suffix)) counters[k] = v;
  return { counters, matched: snap.matched };
}
