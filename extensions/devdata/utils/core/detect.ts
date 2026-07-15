// Format autodetection (design §4.1 step 3): BOM → braces → `---`/`:` → `<` →
// delimiters → three base64url segments.
//
// This is a HEURISTIC and the UI says so: the chip shows "авто" next to the
// chosen format and a one-click override sits beside it (design §6.8). We never
// pretend to be sure.
//
// 🔴 B1 — this runs on the MAIN THREAD (before the Worker job is even created),
// so it must be CHEAP on a 50 MB input. It performs no full parse of the
// document: braces default to strict JSON by structure alone, and the actual
// JSON-vs-JSON5 decision is deferred to the Worker, which retries JSON→JSONC→
// JSON5 on a strict-parse failure of an autodetected document (core/parse.ts).
// The only sub-parses here are of the tiny JWT header segment and a bounded
// comment scan — both O(1)/O(bound) regardless of document size. A full
// `JSON.parse` here previously blocked the main thread for ~333 ms on 50 MB and
// could OOM the tab near HARD_MAX; that is gone.
//
// Pure: no browser APIs, so it is equally safe to call from the Worker.

export type DetectedFormat =
  | 'json'
  | 'json5'
  | 'jsonc'
  | 'yaml'
  | 'xml'
  | 'csv'
  | 'jwt';

export interface Detection {
  format: DetectedFormat;
  /** False when we are guessing between plausible candidates. */
  confident: boolean;
}

/** Strip a UTF-8 BOM, which otherwise breaks every parser (and JSON.parse). */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const B64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** No real JWT is this large; the cap keeps the check O(1) on a big document. */
const MAX_JWT_LEN = 1_000_000;

/**
 * Three dot-separated base64url segments whose header decodes to `{"alg":…}`.
 *
 * ⚠️ Runs on the main thread as part of autodetect, so it must stay cheap on a
 * 50 MB input: we bound the length and locate the two dots with `indexOf`
 * instead of `text.split('.')` (which, on a big JSON full of decimal points,
 * would allocate a huge array and scan the whole string).
 */
export function looksLikeJwt(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_JWT_LEN) return false;
  const d1 = t.indexOf('.');
  if (d1 <= 0) return false;
  const d2 = t.indexOf('.', d1 + 1);
  if (d2 <= d1 + 1) return false;
  if (t.indexOf('.', d2 + 1) !== -1) return false; // more than three segments
  const header = t.slice(0, d1);
  const payload = t.slice(d1 + 1, d2);
  if (!B64URL_SEGMENT.test(header) || !B64URL_SEGMENT.test(payload)) return false;
  // The header must base64url-decode to a JSON object carrying `alg`. The header
  // segment is tiny, so this parse is cheap regardless of document size.
  try {
    const obj: unknown = JSON.parse(atobUrl(header));
    return typeof obj === 'object' && obj !== null && 'alg' in (obj as object);
  } catch {
    return false;
  }
}

/** base64url → string. Shared with the JWT decoder; throws on bad input. */
export function atobUrl(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded); // throws on non-base64 — callers report WHICH segment
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Only the first this-many characters are scanned during autodetect. Detection
 * is a HEURISTIC (the UI shows "авто" + a one-click override), and a full scan
 * of a 50 MB document on the main thread is exactly what B1 forbids. A comment
 * or JSON5 feature past this bound is caught by the Worker parse instead (it
 * retries JSON→JSONC→JSON5 when autodetected — see core/parse.ts).
 */
export const DETECT_SCAN_LIMIT = 262_144;

/** Does the text carry line or block comments outside of string literals?
 *  (i.e. is this JSONC rather than plain JSON) */
export function hasJsonComments(text: string): boolean {
  let inString = false;
  let escaped = false;
  const limit = Math.min(text.length, DETECT_SCAN_LIMIT);
  for (let i = 0; i < limit; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) return true;
  }
  return false;
}

const DELIMS = [',', ';', '\t', '|'] as const;
export type Delimiter = (typeof DELIMS)[number];

/**
 * Pick the delimiter whose per-line column count is most consistent across the
 * first lines. Returns null when nothing looks tabular.
 * ⚠️ This can be fooled by `;` inside quotes (design §6.12) — the UI therefore
 * always shows which delimiter was used and how many columns were found.
 */
export function sniffDelimiter(text: string): Delimiter | null {
  const lines = text.split('\n', 20).filter((l) => l.trim() !== '');
  if (lines.length < 2) return null;
  let best: { d: Delimiter; cols: number } | null = null;
  for (const d of DELIMS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const first = counts[0] ?? 0;
    if (first < 1) continue;
    const consistent = counts.every((c) => c === first);
    if (!consistent) continue;
    if (!best || first > best.cols) best = { d, cols: first };
  }
  return best?.d ?? null;
}

function countOutsideQuotes(line: string, delim: string): number {
  let inQuote = false;
  let n = 0;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && c === delim) n += 1;
  }
  return n;
}

/** The first line, without splitting the whole (possibly 50 MB) string. */
function firstLineOf(text: string): string {
  const nl = text.indexOf('\n');
  return nl === -1 ? text : text.slice(0, nl);
}

export function detectFormat(input: string): Detection {
  const text = stripBom(input).trim();
  if (text === '') return { format: 'json', confident: false };

  if (looksLikeJwt(text)) return { format: 'jwt', confident: true };

  if (text.startsWith('<')) {
    return { format: 'xml', confident: true };
  }

  const first = text[0];
  if (first === '{' || first === '[') {
    if (hasJsonComments(text)) return { format: 'jsonc', confident: true };
    // 🔴 B1: we must NOT `JSON.parse` here — that would block the main thread for
    // hundreds of ms on a 50 MB document (and build a ~1 GB throwaway graph near
    // HARD_MAX) before the loading spinner / Cancel can even paint. Default to
    // strict JSON; if the document is actually JSON5 (trailing commas, single
    // quotes, unquoted keys, hex), the WORKER parse retries as JSON5 when the
    // format was autodetected (core/parse.ts). The real parse happens off-thread.
    return { format: 'json', confident: true };
  }

  const firstLine = firstLineOf(text);
  // YAML document markers and block mappings.
  if (/^---(\s|$)/m.test(firstLine) || /^[\w."'[\]-]+:\s/.test(firstLine)) {
    // A YAML block mapping and a one-column CSV header look alike; a delimiter
    // that is consistent across lines tips the balance towards CSV.
    if (!firstLine.includes(':') && sniffDelimiter(text) !== null) {
      return { format: 'csv', confident: false };
    }
    return { format: 'yaml', confident: text.startsWith('---') };
  }

  if (sniffDelimiter(text) !== null) return { format: 'csv', confident: false };

  // Scalar YAML documents ("just a string") land here; YAML parses anything.
  return { format: 'yaml', confident: false };
}
