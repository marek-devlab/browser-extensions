import { checkRegexSafety } from '@blur/netcore';
import {
  BODY_CONTENT_TYPES,
  COUNT_KEYS,
  FAILURE_REASONS,
  HEADER_OPS,
  HTTP_METHODS,
  LIMITS,
  RESET_ON,
  RESOURCE_KINDS,
  RULES_DOCUMENT_VERSION,
  STATUS_CODE_MAX,
  STATUS_CODE_MIN,
  type Action,
  type Condition,
  type HeaderCondition,
  type Rule,
  type RuleGroup,
  type RulesDocument,
  type State,
  type UrlCondition,
} from './rule-types';
import { parseStatusPattern } from './status-match';

// STRICT validation of an untrusted rules document — the import file AND
// whatever is read back from `local:rules` (design §7.1). Hand-written on
// purpose (same approach as adblock/utils/backup-parse.ts): no schema library
// in the bundle, and every rejection carries the rule index + field path so
// the import preview can list "N rules, M with errors" (design §4.5).
//
// Unlike adblock's lenient parser this one REFUSES rather than normalises:
//   - unknown keys are an error (`additionalProperties: false` semantics),
//   - `__proto__` / `constructor` / `prototype` keys are an error anywhere,
//   - every size limit from design §5.8/§7.1 is enforced here, before storage,
//   - regexes go through `checkRegexSafety` (ReDoS gate; in Firefox a rule
//     regex runs inside a blocking listener on EVERY request).
// Pure: no browser imports, Node-testable.

export interface RuleError {
  /** Index in `rules` (or `groups` when `where === 'groups'`); null for
   *  document-level errors. */
  index: number | null;
  where: 'document' | 'rules' | 'groups';
  /** Dotted field path inside the rule, e.g. `condition.url.value`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  /** The validated document — only rules/groups that passed. */
  doc: RulesDocument;
  errors: RuleError[];
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ID_RE = /^[A-Za-z0-9_-]+$/;
// A hostname label list (`a.example.com`, `localhost`, punycode) — no scheme,
// path, port or wildcard; the DNR `initiatorDomains` field takes exactly this.
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// No parameter properties / enums here: Node's strip-only TS mode (which the
// logic tests rely on) refuses them.
class Ctx {
  readonly errors: RuleError[] = [];
  private readonly where: RuleError['where'];
  private readonly index: number | null;
  constructor(where: RuleError['where'], index: number | null) {
    this.where = where;
    this.index = index;
  }
  err(path: string, message: string): void {
    this.errors.push({ index: this.index, where: this.where, path, message });
  }
  /** Reject forbidden and unknown keys. Returns false if any were found. */
  keys(obj: Record<string, unknown>, path: string, allowed: readonly string[]): boolean {
    let ok = true;
    for (const k of Object.keys(obj)) {
      if (FORBIDDEN_KEYS.has(k)) {
        this.err(path ? `${path}.${k}` : k, 'forbidden key');
        ok = false;
      } else if (!allowed.includes(k)) {
        this.err(path ? `${path}.${k}` : k, 'unknown field');
        ok = false;
      }
    }
    return ok;
  }
}

/* ------------------------------ primitives ------------------------------ */

function str(c: Ctx, v: unknown, path: string, max: number, min = 0): string | undefined {
  if (typeof v !== 'string') {
    c.err(path, 'expected a string');
    return undefined;
  }
  if (v.length < min) {
    c.err(path, min === 1 ? 'must not be empty' : `shorter than ${min}`);
    return undefined;
  }
  if (v.length > max) {
    c.err(path, `longer than ${max} characters`);
    return undefined;
  }
  return v;
}

function int(c: Ctx, v: unknown, path: string, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    c.err(path, 'expected an integer');
    return undefined;
  }
  if (v < min || v > max) {
    c.err(path, `must be between ${min} and ${max}`);
    return undefined;
  }
  return v;
}

function bool(c: Ctx, v: unknown, path: string): boolean | undefined {
  if (typeof v !== 'boolean') {
    c.err(path, 'expected true or false');
    return undefined;
  }
  return v;
}

function oneOf<T extends string>(
  c: Ctx,
  v: unknown,
  path: string,
  values: readonly T[],
): T | undefined {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
    c.err(path, `expected one of: ${values.join(', ')}`);
    return undefined;
  }
  return v as T;
}

function enumList<T extends string>(
  c: Ctx,
  v: unknown,
  path: string,
  values: readonly T[],
  max: number,
): T[] | undefined {
  if (!Array.isArray(v)) {
    c.err(path, 'expected a list');
    return undefined;
  }
  if (v.length > max) {
    c.err(path, `more than ${max} entries`);
    return undefined;
  }
  const out: T[] = [];
  let ok = true;
  v.forEach((item, i) => {
    const x = oneOf(c, item, `${path}[${i}]`, values);
    if (x === undefined) ok = false;
    else if (!out.includes(x)) out.push(x);
  });
  return ok ? out : undefined;
}

/* -------------------------------- pieces -------------------------------- */

const URL_KEYS = ['op', 'value', 'caseSensitive'] as const;
function urlCondition(c: Ctx, v: unknown, path: string): UrlCondition | undefined {
  if (!isRecord(v)) {
    c.err(path, 'expected an object');
    return undefined;
  }
  if (!c.keys(v, path, URL_KEYS)) return undefined;
  const op = oneOf(c, v.op, `${path}.op`, ['contains', 'equals', 'wildcard', 'regex'] as const);
  const value = str(c, v.value, `${path}.value`, LIMITS.urlValueLength, 1);
  if (op === undefined || value === undefined) return undefined;
  const out: UrlCondition = { op, value };
  if (v.caseSensitive !== undefined) {
    const cs = bool(c, v.caseSensitive, `${path}.caseSensitive`);
    if (cs === undefined) return undefined;
    if (cs) out.caseSensitive = true;
  }
  if (op === 'regex') {
    const safety = checkRegexSafety(value);
    if (!safety.ok) {
      c.err(`${path}.value`, `unsafe or invalid regex (${safety.reason})`);
      return undefined;
    }
  }
  return out;
}

const HEADER_KEYS = ['name', 'op', 'value'] as const;
function headerCondition(c: Ctx, v: unknown, path: string): HeaderCondition | undefined {
  if (!isRecord(v)) {
    c.err(path, 'expected an object');
    return undefined;
  }
  if (!c.keys(v, path, HEADER_KEYS)) return undefined;
  const name = str(c, v.name, `${path}.name`, LIMITS.headerNameLength, 1);
  const op = oneOf(c, v.op, `${path}.op`, HEADER_OPS);
  if (name === undefined || op === undefined) return undefined;
  if (!HEADER_NAME_RE.test(name)) {
    c.err(`${path}.name`, 'not a valid header name');
    return undefined;
  }
  const out: HeaderCondition = { name: name.toLowerCase(), op };
  if (op !== 'exists') {
    const value = str(c, v.value, `${path}.value`, LIMITS.headerValueLength, 1);
    if (value === undefined) return undefined;
    out.value = value;
  } else if (v.value !== undefined) {
    const value = str(c, v.value, `${path}.value`, LIMITS.headerValueLength);
    if (value === undefined) return undefined;
  }
  return out;
}

const CONDITION_KEYS = [
  'url',
  'methods',
  'resourceTypes',
  'pageDomains',
  'responseStatus',
  'responseHeaders',
] as const;
function condition(c: Ctx, v: unknown, path: string): Condition | undefined {
  if (!isRecord(v)) {
    c.err(path, 'expected an object');
    return undefined;
  }
  if (!c.keys(v, path, CONDITION_KEYS)) return undefined;
  const out: Condition = {};
  let ok = true;
  if (v.url !== undefined) {
    const u = urlCondition(c, v.url, `${path}.url`);
    if (u) out.url = u;
    else ok = false;
  }
  if (v.methods !== undefined) {
    const m = enumList(c, v.methods, `${path}.methods`, HTTP_METHODS, HTTP_METHODS.length);
    if (m) out.methods = m;
    else ok = false;
  }
  if (v.resourceTypes !== undefined) {
    const t = enumList(c, v.resourceTypes, `${path}.resourceTypes`, RESOURCE_KINDS, RESOURCE_KINDS.length);
    if (t) out.resourceTypes = t;
    else ok = false;
  }
  if (v.pageDomains !== undefined) {
    if (!Array.isArray(v.pageDomains)) {
      c.err(`${path}.pageDomains`, 'expected a list');
      ok = false;
    } else if (v.pageDomains.length > LIMITS.pageDomains) {
      c.err(`${path}.pageDomains`, `more than ${LIMITS.pageDomains} entries`);
      ok = false;
    } else {
      const domains: string[] = [];
      v.pageDomains.forEach((d, i) => {
        const s = str(c, d, `${path}.pageDomains[${i}]`, LIMITS.domainLength, 1);
        if (s === undefined) ok = false;
        else if (!DOMAIN_RE.test(s)) {
          c.err(`${path}.pageDomains[${i}]`, 'not a hostname');
          ok = false;
        } else domains.push(s.toLowerCase());
      });
      out.pageDomains = domains;
    }
  }
  if (v.responseStatus !== undefined) {
    const s = str(c, v.responseStatus, `${path}.responseStatus`, LIMITS.statusPatternLength, 1);
    if (s === undefined) ok = false;
    else {
      const p = parseStatusPattern(s);
      if (!p.ok) {
        c.err(`${path}.responseStatus`, p.error);
        ok = false;
      } else out.responseStatus = s;
    }
  }
  if (v.responseHeaders !== undefined) {
    if (!Array.isArray(v.responseHeaders)) {
      c.err(`${path}.responseHeaders`, 'expected a list');
      ok = false;
    } else if (v.responseHeaders.length > LIMITS.headerConditions) {
      c.err(`${path}.responseHeaders`, `more than ${LIMITS.headerConditions} entries`);
      ok = false;
    } else {
      const hs: HeaderCondition[] = [];
      v.responseHeaders.forEach((h, i) => {
        const x = headerCondition(c, h, `${path}.responseHeaders[${i}]`);
        if (x) hs.push(x);
        else ok = false;
      });
      out.responseHeaders = hs;
    }
  }
  return ok ? out : undefined;
}

const STATE_KEYS: Record<State['kind'], readonly string[]> = {
  every: ['kind'],
  once: ['kind'],
  times: ['kind', 'n'],
  nth: ['kind', 'n', 'every'],
  skipFirst: ['kind', 'skip', 'times'],
  probability: ['kind', 'percent', 'seed'],
  window: ['kind', 'trigger', 'seconds'],
  afterRule: ['kind', 'ruleId'],
};
function state(c: Ctx, v: unknown, path: string): State | undefined {
  if (!isRecord(v)) {
    c.err(path, 'expected an object');
    return undefined;
  }
  const kind = oneOf(c, v.kind, `${path}.kind`, Object.keys(STATE_KEYS) as State['kind'][]);
  if (kind === undefined) return undefined;
  if (!c.keys(v, path, STATE_KEYS[kind])) return undefined;
  switch (kind) {
    case 'every':
    case 'once':
      return { kind };
    case 'times': {
      const n = int(c, v.n, `${path}.n`, 1, LIMITS.counter);
      return n === undefined ? undefined : { kind, n };
    }
    case 'nth': {
      const n = int(c, v.n, `${path}.n`, 1, LIMITS.counter);
      if (n === undefined) return undefined;
      const out: State = { kind, n };
      if (v.every !== undefined) {
        const e = bool(c, v.every, `${path}.every`);
        if (e === undefined) return undefined;
        if (e) out.every = true;
      }
      return out;
    }
    case 'skipFirst': {
      const skip = int(c, v.skip, `${path}.skip`, 0, LIMITS.counter);
      if (skip === undefined) return undefined;
      const out: State = { kind, skip };
      if (v.times !== undefined) {
        const t = int(c, v.times, `${path}.times`, 1, LIMITS.counter);
        if (t === undefined) return undefined;
        out.times = t;
      }
      return out;
    }
    case 'probability': {
      const percent = int(c, v.percent, `${path}.percent`, 0, 100);
      // Seeds are 32-bit: mulberry32 takes exactly that.
      const seed = int(c, v.seed, `${path}.seed`, 0, 0xffffffff);
      return percent === undefined || seed === undefined ? undefined : { kind, percent, seed };
    }
    case 'window': {
      const trigger = oneOf(c, v.trigger, `${path}.trigger`, ['navigation', 'click', 'manual'] as const);
      const seconds = int(c, v.seconds, `${path}.seconds`, 1, LIMITS.windowSeconds);
      return trigger === undefined || seconds === undefined ? undefined : { kind, trigger, seconds };
    }
    case 'afterRule': {
      const ruleId = str(c, v.ruleId, `${path}.ruleId`, LIMITS.idLength, 1);
      if (ruleId === undefined) return undefined;
      if (!ID_RE.test(ruleId)) {
        c.err(`${path}.ruleId`, 'not a rule id');
        return undefined;
      }
      return { kind, ruleId };
    }
  }
}

const ACTION_KEYS: Record<Action['type'], readonly string[]> = {
  block: ['type'],
  fail: ['type', 'reason'],
  delay: ['type', 'ms'],
  status: ['type', 'code', 'body', 'contentType'],
};
function action(c: Ctx, v: unknown, path: string): Action | undefined {
  if (!isRecord(v)) {
    c.err(path, 'expected an object');
    return undefined;
  }
  const type = oneOf(c, v.type, `${path}.type`, Object.keys(ACTION_KEYS) as Action['type'][]);
  if (type === undefined) return undefined;
  if (!c.keys(v, path, ACTION_KEYS[type])) return undefined;
  switch (type) {
    case 'block':
      return { type };
    case 'fail': {
      const reason = oneOf(c, v.reason, `${path}.reason`, FAILURE_REASONS);
      return reason === undefined ? undefined : { type, reason };
    }
    case 'delay': {
      const ms = int(c, v.ms, `${path}.ms`, 0, LIMITS.delayMs);
      return ms === undefined ? undefined : { type, ms };
    }
    case 'status': {
      const code = int(c, v.code, `${path}.code`, STATUS_CODE_MIN, STATUS_CODE_MAX);
      if (code === undefined) return undefined;
      const out: Action = { type, code };
      if (v.body !== undefined) {
        if (typeof v.body !== 'string') {
          c.err(`${path}.body`, 'expected a string');
          return undefined;
        }
        if (utf8Length(v.body) > LIMITS.bodyBytes) {
          c.err(`${path}.body`, `larger than ${LIMITS.bodyBytes} bytes`);
          return undefined;
        }
        out.body = v.body;
      }
      if (v.contentType !== undefined) {
        const ct = oneOf(c, v.contentType, `${path}.contentType`, BODY_CONTENT_TYPES);
        if (ct === undefined) return undefined;
        out.contentType = ct;
      }
      // An HTML body with a success status would be an HTML injection primitive
      // into another origin (design §7.1) — the tool is for failures.
      if (out.contentType === 'text/html' && out.body !== undefined && code < 400) {
        c.err(`${path}.contentType`, 'text/html bodies are allowed only with a status of 400 or above');
        return undefined;
      }
      return out;
    }
  }
}

const RULE_KEYS = [
  'id',
  'name',
  'enabled',
  'priority',
  'groupId',
  'createdAt',
  'scope',
  'condition',
  'state',
  'countKey',
  'resetOn',
  'action',
  'engine',
] as const;

/** Validate ONE rule. `index` is only used to label errors. */
export function validateRule(v: unknown, index: number | null = null): { rule?: Rule; errors: RuleError[] } {
  const c = new Ctx('rules', index);
  if (!isRecord(v)) {
    c.err('', 'expected an object');
    return { errors: c.errors };
  }
  if (!c.keys(v, '', RULE_KEYS)) return { errors: c.errors };

  const id = str(c, v.id, 'id', LIMITS.idLength, 1);
  if (id !== undefined && !ID_RE.test(id)) c.err('id', 'only letters, digits, - and _');
  const name = str(c, v.name, 'name', LIMITS.nameLength);
  const enabled = bool(c, v.enabled, 'enabled');
  const priority = int(c, v.priority, 'priority', -1_000_000, 1_000_000);
  const createdAt = int(c, v.createdAt, 'createdAt', 0, Number.MAX_SAFE_INTEGER);
  const scope = oneOf(c, v.scope, 'scope', ['all', 'activeTab'] as const);
  const cond = condition(c, v.condition, 'condition');
  const st = state(c, v.state, 'state');
  const countKey = oneOf(c, v.countKey, 'countKey', COUNT_KEYS);
  const resetOn = oneOf(c, v.resetOn, 'resetOn', RESET_ON);
  const act = action(c, v.action, 'action');
  let groupId: string | undefined;
  if (v.groupId !== undefined) {
    groupId = str(c, v.groupId, 'groupId', LIMITS.idLength, 1);
    if (groupId !== undefined && !ID_RE.test(groupId)) c.err('groupId', 'not a group id');
  }
  let engine: Rule['engine'];
  if (v.engine !== undefined) {
    engine = oneOf(c, v.engine, 'engine', ['auto', 'dnr', 'page', 'debugger', 'webrequest'] as const);
  }

  if (c.errors.length > 0) return { errors: c.errors };
  const rule: Rule = {
    id: id!,
    name: name!,
    enabled: enabled!,
    priority: priority!,
    createdAt: createdAt!,
    scope: scope!,
    condition: cond!,
    state: st!,
    countKey: countKey!,
    resetOn: resetOn!,
    action: act!,
  };
  if (groupId !== undefined) rule.groupId = groupId;
  if (engine !== undefined) rule.engine = engine;
  return { rule, errors: [] };
}

const GROUP_KEYS = ['id', 'name', 'enabled', 'order'] as const;
function validateGroup(v: unknown, index: number): { group?: RuleGroup; errors: RuleError[] } {
  const c = new Ctx('groups', index);
  if (!isRecord(v)) {
    c.err('', 'expected an object');
    return { errors: c.errors };
  }
  if (!c.keys(v, '', GROUP_KEYS)) return { errors: c.errors };
  const id = str(c, v.id, 'id', LIMITS.idLength, 1);
  if (id !== undefined && !ID_RE.test(id)) c.err('id', 'only letters, digits, - and _');
  const name = str(c, v.name, 'name', LIMITS.nameLength);
  const enabled = bool(c, v.enabled, 'enabled');
  const order = int(c, v.order, 'order', -1_000_000, 1_000_000);
  if (c.errors.length > 0) return { errors: c.errors };
  return { group: { id: id!, name: name!, enabled: enabled!, order: order! }, errors: [] };
}

const DOC_KEYS = ['version', 'rules', 'groups'] as const;

/**
 * Validate a whole document (parsed JSON). Rules that fail are dropped from
 * `doc` and listed in `errors`; the caller decides whether to apply the valid
 * subset (the import preview asks — design §4.5). Cross-rule checks: unique
 * ids, `afterRule` targets exist, `groupId` refers to a known group, regex
 * count and hard caps.
 */
export function validateRulesDocument(raw: unknown): ValidationResult {
  const c = new Ctx('document', null);
  const doc: RulesDocument = { version: RULES_DOCUMENT_VERSION, rules: [], groups: [] };
  if (!isRecord(raw)) {
    c.err('', 'expected a JSON object');
    return { ok: false, doc, errors: c.errors };
  }
  if (!c.keys(raw, '', DOC_KEYS)) return { ok: false, doc, errors: c.errors };
  if (raw.version !== RULES_DOCUMENT_VERSION) {
    c.err('version', `unsupported version (expected ${RULES_DOCUMENT_VERSION})`);
    return { ok: false, doc, errors: c.errors };
  }
  const errors: RuleError[] = [];

  const groupsRaw = raw.groups === undefined ? [] : raw.groups;
  if (!Array.isArray(groupsRaw)) {
    c.err('groups', 'expected a list');
    return { ok: false, doc, errors: c.errors };
  }
  if (groupsRaw.length > LIMITS.groups) {
    c.err('groups', `more than ${LIMITS.groups} groups`);
    return { ok: false, doc, errors: c.errors };
  }
  const groupIds = new Set<string>();
  groupsRaw.forEach((g, i) => {
    const r = validateGroup(g, i);
    if (!r.group) {
      errors.push(...r.errors);
      return;
    }
    if (groupIds.has(r.group.id)) {
      errors.push({ index: i, where: 'groups', path: 'id', message: 'duplicate group id' });
      return;
    }
    groupIds.add(r.group.id);
    doc.groups.push(r.group);
  });

  const rulesRaw = raw.rules;
  if (!Array.isArray(rulesRaw)) {
    c.err('rules', 'expected a list');
    return { ok: false, doc, errors: [...c.errors, ...errors] };
  }
  if (rulesRaw.length > LIMITS.rulesHard) {
    c.err('rules', `more than ${LIMITS.rulesHard} rules`);
    return { ok: false, doc, errors: [...c.errors, ...errors] };
  }
  const ruleIds = new Set<string>();
  const candidates: { index: number; rule: Rule }[] = [];
  rulesRaw.forEach((r, i) => {
    const res = validateRule(r, i);
    if (!res.rule) {
      errors.push(...res.errors);
      return;
    }
    if (ruleIds.has(res.rule.id)) {
      errors.push({ index: i, where: 'rules', path: 'id', message: 'duplicate rule id' });
      return;
    }
    ruleIds.add(res.rule.id);
    candidates.push({ index: i, rule: res.rule });
  });

  let regexCount = 0;
  for (const { index, rule } of candidates) {
    if (rule.groupId !== undefined && !groupIds.has(rule.groupId)) {
      errors.push({ index, where: 'rules', path: 'groupId', message: 'unknown group' });
      continue;
    }
    if (rule.state.kind === 'afterRule') {
      if (rule.state.ruleId === rule.id) {
        errors.push({ index, where: 'rules', path: 'state.ruleId', message: 'a rule cannot follow itself' });
        continue;
      }
      if (!ruleIds.has(rule.state.ruleId)) {
        errors.push({ index, where: 'rules', path: 'state.ruleId', message: 'unknown rule' });
        continue;
      }
    }
    if (rule.condition.url?.op === 'regex') {
      regexCount++;
      if (regexCount > LIMITS.regexRules) {
        errors.push({ index, where: 'rules', path: 'condition.url', message: `more than ${LIMITS.regexRules} regex rules` });
        continue;
      }
    }
    doc.rules.push(rule);
  }

  const all = [...c.errors, ...errors];
  return { ok: all.length === 0, doc, errors: all };
}

/**
 * Import entry point: raw file text → validated document. Size is checked
 * BEFORE `JSON.parse` (a 200 MB file must not be parsed at all).
 */
export function parseRulesImport(text: string): ValidationResult {
  const empty: RulesDocument = { version: RULES_DOCUMENT_VERSION, rules: [], groups: [] };
  if (utf8Length(text) > LIMITS.importBytes) {
    return {
      ok: false,
      doc: empty,
      errors: [{ index: null, where: 'document', path: '', message: `file larger than ${LIMITS.importBytes} bytes` }],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      doc: empty,
      errors: [{ index: null, where: 'document', path: '', message: 'not valid JSON' }],
    };
  }
  return validateRulesDocument(parsed);
}

/** Serialise for export / storage. Deterministic key order comes from the
 *  typed constructors above, so two exports of the same rules are byte-equal. */
export function serializeRulesDocument(doc: RulesDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** UTF-8 byte length without allocating an encoder per call in hot paths. */
export function utf8Length(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair → one 4-byte sequence.
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
