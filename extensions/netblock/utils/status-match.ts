import { LIMITS, STATUS_CODE_MAX, STATUS_CODE_MIN } from './rule-types';

// Response-status patterns for the "Ответ: код" condition (design §3):
//   `503`          one code
//   `5xx`          a class (500–599); `4xx`, `2xx` … likewise
//   `500-599`      an inclusive range
//   `429,500-599`  a comma-separated union of any of the above
// Whitespace around tokens is ignored; matching is against the integer status.
// Pure: no browser imports.

export type StatusRange = { from: number; to: number };

export type StatusParse =
  | { ok: true; ranges: StatusRange[]; test: (code: number) => boolean }
  | { ok: false; error: string };

const CLASS = /^([1-5])xx$/i;
const SINGLE = /^(\d{3})$/;
const RANGE = /^(\d{3})\s*-\s*(\d{3})$/;

function inBounds(n: number): boolean {
  return n >= STATUS_CODE_MIN && n <= STATUS_CODE_MAX;
}

/**
 * Parse a status pattern. Never throws — an invalid pattern yields
 * `{ ok: false, error }` so the editor can point at the exact token, and the
 * engines treat an unparsable pattern as "never matches" (fail-open: a broken
 * condition must not block anything).
 */
export function parseStatusPattern(pattern: string): StatusParse {
  if (typeof pattern !== 'string') return { ok: false, error: 'not a string' };
  if (pattern.length > LIMITS.statusPatternLength) return { ok: false, error: 'too long' };
  if (pattern.trim().length === 0) return { ok: false, error: 'empty' };
  const tokens = pattern.split(',').map((t) => t.trim());

  const ranges: StatusRange[] = [];
  for (const tok of tokens) {
    // `429,,500` or a trailing comma is a typo the editor should point at, not
    // something to silently swallow.
    if (tok.length === 0) return { ok: false, error: 'empty token' };
    let m: RegExpExecArray | null;
    if ((m = CLASS.exec(tok))) {
      const hundreds = Number(m[1]) * 100;
      ranges.push({ from: hundreds, to: hundreds + 99 });
    } else if ((m = SINGLE.exec(tok))) {
      const n = Number(m[1]);
      if (!inBounds(n)) return { ok: false, error: `out of range: ${tok}` };
      ranges.push({ from: n, to: n });
    } else if ((m = RANGE.exec(tok))) {
      const from = Number(m[1]);
      const to = Number(m[2]);
      if (!inBounds(from) || !inBounds(to)) return { ok: false, error: `out of range: ${tok}` };
      if (from > to) return { ok: false, error: `inverted range: ${tok}` };
      ranges.push({ from, to });
    } else {
      return { ok: false, error: `unrecognised token: ${tok}` };
    }
  }
  const test = (code: number): boolean => {
    if (!Number.isInteger(code)) return false;
    for (const r of ranges) if (code >= r.from && code <= r.to) return true;
    return false;
  };
  return { ok: true, ranges, test };
}

/** Convenience for engines: does `code` satisfy `pattern`? Unparsable → false. */
export function statusMatches(pattern: string, code: number): boolean {
  const p = parseStatusPattern(pattern);
  return p.ok ? p.test(code) : false;
}
