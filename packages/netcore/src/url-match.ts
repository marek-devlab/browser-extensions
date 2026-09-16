/**
 * PURE URL matching — no browser APIs, no relative imports outside this package,
 * so it runs unchanged in Node (`e2e/netcore/logic.test.mjs`).
 *
 * Why a JS matcher when the browser matches DNR rules itself: in a packaged
 * extension neither `declarativeNetRequest.testMatchOutcome` nor
 * `onRuleMatchedDebug` is available (both are unpacked-only, Research §2.1), so
 * a "does this URL match this rule?" preview, the Firefox blocking-webRequest
 * engine and the MAIN-world page engine all need the same decision made in JS.
 * The `urlFilter` implementation follows the documented DNR semantics so that a
 * rule previewed here behaves the same once handed to the browser.
 */

/* ------------------------------- hosts ---------------------------------- */

/** Hostname of `url`, or `undefined` when it does not parse. */
export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** True if `host` equals or is a subdomain of any domain in the set. */
export function matchesSuffix(host: string, domains: Iterable<string>): boolean {
  const set = domains instanceof Set ? domains : new Set(domains);
  let h: string = host;
  while (h.length > 0) {
    if (set.has(h)) return true;
    const dot = h.indexOf('.');
    if (dot === -1) break;
    h = h.slice(dot + 1);
  }
  return false;
}

/* ---------------------------- DNR urlFilter ----------------------------- */

const SPECIAL = /[.*+?^${}()|[\]\\]/g;
function escapeRegExp(s: string): string {
  return s.replace(SPECIAL, '\\$&');
}

/**
 * Compile a DNR `urlFilter` to a RegExp using the documented grammar
 * (developer.chrome.com → declarativeNetRequest → RuleCondition.urlFilter):
 *   `*`   — any number of characters
 *   `^`   — separator: anything that is not a letter, digit or `_ - . %`, OR the
 *           end of the URL
 *   `||`  — at the start: domain-name anchor (matches `scheme://`, and any
 *           subdomain boundary — `||example.com` matches `sub.example.com`)
 *   `|`   — at the start: anchor to the beginning of the URL; at the end: anchor
 *           to the end of the URL
 * `urlFilter` is ASCII-only in the browser; non-ASCII input is rejected so a
 * rule the browser would refuse is never previewed as matching.
 */
export function urlFilterToRegExp(filter: string, caseSensitive = false): RegExp | null {
  if (filter.length === 0) return null;
  // The browser rejects non-ASCII filters outright.
  for (let i = 0; i < filter.length; i++) if (filter.charCodeAt(i) > 0x7f) return null;

  let src = '';
  let body = filter;
  if (body.startsWith('||')) {
    // Scheme, then optionally any subdomains, then the filter text.
    src += '^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?';
    body = body.slice(2);
  } else if (body.startsWith('|')) {
    src += '^';
    body = body.slice(1);
  }
  let endAnchor = false;
  if (body.endsWith('|')) {
    endAnchor = true;
    body = body.slice(0, -1);
  }
  for (const ch of body) {
    if (ch === '*') src += '.*';
    else if (ch === '^') src += '(?:[^a-zA-Z0-9_\\-.%]|$)';
    else src += escapeRegExp(ch);
  }
  if (endAnchor) src += '$';
  try {
    return new RegExp(src, caseSensitive ? '' : 'i');
  } catch {
    return null;
  }
}

/** Does `url` match the DNR `urlFilter`? (Same semantics the browser applies.) */
export function matchesUrlFilter(filter: string, url: string, caseSensitive = false): boolean {
  const re = urlFilterToRegExp(filter, caseSensitive);
  return re ? re.test(url) : false;
}

/* -------------------------- user-facing operators ----------------------- */

/** How the rule editor lets a user express a URL condition. */
export type UrlOp = 'contains' | 'equals' | 'wildcard' | 'regex';
/** Which part of the URL the condition is checked against. */
export type UrlKey = 'url' | 'host' | 'path';

export interface UrlCondition {
  key: UrlKey;
  op: UrlOp;
  value: string;
  caseSensitive?: boolean;
}

/**
 * Glob → RegExp for the `wildcard` op. Only `*` (any run of characters) and `?`
 * (one character) are special; everything else is literal. Anchored on both
 * ends, so a glob like `*` + `/api/` + `*` must cover the whole tested string —
 * a user who wants a substring reaches for `contains` instead, and the editor
 * says so.
 */
export function wildcardToRegExp(glob: string, caseSensitive = false): RegExp {
  let src = '^';
  for (const ch of glob) {
    if (ch === '*') src += '.*';
    else if (ch === '?') src += '.';
    else src += escapeRegExp(ch);
  }
  return new RegExp(src + '$', caseSensitive ? '' : 'i');
}

function partOf(url: string, key: UrlKey): string | null {
  if (key === 'url') return url;
  try {
    const u = new URL(url);
    return key === 'host' ? u.hostname : u.pathname + u.search;
  } catch {
    return null;
  }
}

/**
 * Evaluate one URL condition. Returns `false` (never throws) for an invalid
 * regex or an unparsable URL — a broken rule must fail closed in the preview and
 * fail OPEN in the engines, and both call sites handle that explicitly; this
 * function only answers "did it match".
 */
export function matchesUrlCondition(cond: UrlCondition, url: string): boolean {
  const subject = partOf(url, cond.key);
  if (subject === null) return false;
  const cs = cond.caseSensitive === true;
  const a = cs ? subject : subject.toLowerCase();
  const b = cs ? cond.value : cond.value.toLowerCase();
  switch (cond.op) {
    case 'contains':
      return b.length > 0 && a.includes(b);
    case 'equals':
      return a === b;
    case 'wildcard':
      return wildcardToRegExp(cond.value, cs).test(subject);
    case 'regex': {
      const check = checkRegexSafety(cond.value);
      if (!check.ok) return false;
      try {
        return new RegExp(cond.value, cs ? '' : 'i').test(subject);
      } catch {
        return false;
      }
    }
  }
}

/* ---------------------------- regex safety ------------------------------ */

export type RegexSafety = { ok: true } | { ok: false; reason: string };

/** Hard cap: Chrome rejects regex rules whose compiled form exceeds 2 KB. */
export const MAX_REGEX_SOURCE_LENGTH = 1024;

/**
 * Conservative ReDoS gate for user-supplied patterns, applied BEFORE a regex is
 * ever compiled or stored. In Firefox a rule regex runs inside a blocking
 * `webRequest` listener on EVERY request, so a catastrophic pattern would stall
 * all page traffic (design §7.1). Rejected shapes:
 *   - nested quantifiers: `(a+)+`, `(a*)*`, `(a|aa)+`  (star height > 1)
 *   - backreferences `\1` (not supported by RE2 in Chrome either)
 *   - lookbehind/lookahead (RE2 has neither; keeps both engines equivalent)
 *   - length over MAX_REGEX_SOURCE_LENGTH
 *   - a pattern that does not compile
 * This is a heuristic, not a proof — the point is to refuse the well-known
 * catastrophic shapes, and to refuse anything Chrome's RE2 would refuse.
 */
export function checkRegexSafety(pattern: string): RegexSafety {
  if (pattern.length === 0) return { ok: false, reason: 'empty' };
  if (pattern.length > MAX_REGEX_SOURCE_LENGTH) return { ok: false, reason: 'too-long' };
  if (/\\[1-9]/.test(pattern)) return { ok: false, reason: 'backreference' };
  if (/\(\?<?[=!]/.test(pattern)) return { ok: false, reason: 'lookaround' };
  try {
    new RegExp(pattern);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (starHeight(pattern) > 1) return { ok: false, reason: 'nested-quantifier' };
  return { ok: true };
}

/**
 * Star height: maximum nesting depth of quantified groups. `(a+)+` → 2. Computed
 * on the raw source with a small tokenizer: escapes are skipped, character
 * classes are opaque, and a quantifier right after `)` raises the group's
 * height. Alternation inside a quantified group (`(a|aa)+`) counts as height 2
 * as well, because that is the other classic blow-up.
 */
export function starHeight(pattern: string): number {
  const QUANT = new Set(['*', '+', '?', '{']);
  let max = 0;
  // Stack of { height: max quantified depth seen inside, hasAlt }
  const stack: { inner: number; hasAlt: boolean }[] = [];
  let i = 0;
  const n = pattern.length;
  let lastWasAtomHeight = 0; // height contributed by the atom that just closed
  while (i < n) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      i += 2;
      lastWasAtomHeight = 0;
      continue;
    }
    if (ch === '[') {
      // skip class
      i++;
      if (pattern[i] === '^') i++;
      if (pattern[i] === ']') i++;
      while (i < n && pattern[i] !== ']') {
        if (pattern[i] === '\\') i++;
        i++;
      }
      i++;
      lastWasAtomHeight = 0;
      continue;
    }
    if (ch === '(') {
      stack.push({ inner: 0, hasAlt: false });
      i++;
      // skip group modifiers like ?: ?<name>
      if (pattern[i] === '?') {
        i++;
        if (pattern[i] === '<') {
          while (i < n && pattern[i] !== '>') i++;
          i++;
        } else i++;
      }
      lastWasAtomHeight = 0;
      continue;
    }
    if (ch === '|') {
      const top = stack[stack.length - 1];
      if (top) top.hasAlt = true;
      i++;
      lastWasAtomHeight = 0;
      continue;
    }
    if (ch === ')') {
      const g = stack.pop();
      i++;
      // group closed: its height is what was quantified inside it (+ alternation)
      lastWasAtomHeight = g ? Math.max(g.inner, g.hasAlt ? 1 : 0) : 0;
      continue;
    }
    if (QUANT.has(ch)) {
      // quantifier applies to the previous atom
      const h = lastWasAtomHeight + 1;
      if (h > max) max = h;
      const top = stack[stack.length - 1];
      if (top && h > top.inner) top.inner = h;
      if (ch === '{') while (i < n && pattern[i] !== '}') i++;
      i++;
      if (pattern[i] === '?') i++; // lazy
      lastWasAtomHeight = 0;
      continue;
    }
    i++;
    lastWasAtomHeight = 0;
  }
  return max;
}
