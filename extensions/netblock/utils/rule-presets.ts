import { stripQuery, type LogEntry } from './log';
import { HTTP_METHODS, defaultRule, type HttpMethod, type Rule } from './rule-types';

// Rule constructors for the tool page: the three empty-state presets (design
// §5.1), "create rule from request" / "block this URL" from a log row (§2.5,
// §4.1 step 3) and fresh ids. Pure — no browser imports — so the logic tests
// can cover it. A preset only PRE-FILLS the editor; nothing here saves.

export type PresetId = 'blockDomain' | 'nth503' | 'flaky';

export const PRESET_IDS: readonly PresetId[] = ['blockDomain', 'nth503', 'flaky'];

/** 16 hex chars from `crypto.getRandomValues` — unique enough for a local list
 *  and valid for the schema's `[A-Za-z0-9_-]+`. */
export function newRuleId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! % 1_000_000;
}

/** A preset as the editor should open it (design §5.1, §4.2, §4.1, §4.4). */
export function presetRule(kind: PresetId, id: string, now: number, name: string): Rule {
  const base = defaultRule(id, now);
  base.name = name;
  switch (kind) {
    case 'blockDomain':
      return {
        ...base,
        condition: { url: { op: 'wildcard', value: '*cdn.example.com/*' }, resourceTypes: ['image'] },
        action: { type: 'block' },
      };
    case 'nth503':
      return {
        ...base,
        condition: { url: { op: 'contains', value: '/api/checkout' }, resourceTypes: ['xhr'] },
        state: { kind: 'nth', n: 3 },
        action: { type: 'status', code: 503 },
      };
    case 'flaky':
      return {
        ...base,
        condition: { url: { op: 'contains', value: '/api/' }, resourceTypes: ['xhr'] },
        state: { kind: 'probability', percent: 30, seed: newSeed() },
        action: { type: 'delay', ms: 10_000 },
      };
  }
}

/**
 * "Create rule from request" (§4.1 step 3): URL `equals` without the query,
 * the request's method, resource type and page domain (the row's
 * `initiatorHost` — a host, never a path). `blockOnly` is the "Block this
 * URL" shortcut — same URL condition, action Block, no method / page filter.
 */
export function ruleFromLogEntry(entry: LogEntry, id: string, now: number, blockOnly: boolean): Rule {
  const base = defaultRule(id, now);
  const url = stripQuery(entry.url);
  let name = url;
  try {
    const u = new URL(url);
    name = `${blockOnly ? '' : `${entry.method} `}${u.hostname}${u.pathname}`;
  } catch {
    // Keep the raw URL as the name.
  }
  const rule: Rule = {
    ...base,
    name: name.slice(0, 120),
    condition: {
      url: { op: 'equals', value: url },
      resourceTypes: [entry.type],
    },
    action: { type: 'block' },
  };
  const method = entry.method.toUpperCase();
  if (!blockOnly && (HTTP_METHODS as readonly string[]).includes(method)) {
    rule.condition.methods = [method as HttpMethod];
  }
  const host = entry.initiatorHost?.trim().toLowerCase();
  if (!blockOnly && host) rule.condition.pageDomains = [host];
  return rule;
}

/** A deep copy the editor can mutate without touching the store's object. */
export function cloneRule(rule: Rule): Rule {
  return JSON.parse(JSON.stringify(rule)) as Rule;
}

export function rulesEqual(a: Rule, b: Rule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
