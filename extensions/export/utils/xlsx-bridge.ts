// The contract between `engine.js` and `xlsx.js` (design §0).
//
// WHY TWO FILES INSTEAD OF ONE `import()`:
//   A dynamic `import()` inside a content script resolves against the PAGE and its
//   CSP, so on a strict-CSP site it throws. A second `scripting.executeScript` of a
//   separate bundled file does not — and the `activeTab` grant is still alive at
//   that moment. It also means a plain CSV export never pulls a single byte of
//   write-excel-file into the page.
//
// Both files are content scripts of the SAME extension in the SAME document, so
// they share one isolated world — a global is the handoff. If it never appears
// (injection refused), `awaitXlsxWriter` times out and the caller says so out loud
// instead of hanging.

/** Excel's own limit — not ours. Named so the refusal copy can quote it. */
export const EXCEL_SHEET_NAME_MAX = 31;

const EXCEL_FORBIDDEN = /[:\\/?*[\]]/g;
// Built from a string so no literal control characters live in this source file.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

/** ⚠️ Excel: ≤31 chars, none of `: \ / ? * [ ]`, cannot be empty, cannot be
 *  "History". Violating any of these makes the workbook fail to open. */
export function sanitizeSheetName(raw: string, fallback = 'Таблица'): string {
  let s = (raw || '')
    .replace(EXCEL_FORBIDDEN, '-')
    .replace(CONTROL_CHARS, '')
    .replace(/^'+|'+$/g, '') // Excel rejects a leading/trailing apostrophe
    .trim()
    .slice(0, EXCEL_SHEET_NAME_MAX)
    .trim();
  if (s === '' || /^history$/i.test(s)) s = fallback;
  return s.slice(0, EXCEL_SHEET_NAME_MAX);
}

/** Resolve sheet-name collisions the way Excel itself would: `Name (2)`. */
export function uniqueSheetNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const key = n.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 1) return n;
    const suffix = ` (${count})`;
    return sanitizeSheetName(n.slice(0, EXCEL_SHEET_NAME_MAX - suffix.length) + suffix);
  });
}

/**
 * A cell as `write-excel-file` wants it — a TYPED value.
 *
 * 🔴 This is what makes .xlsx structurally immune to CSV injection: in OOXML a
 * formula is a separate `<f>` element, and a string cell is written as an inline
 * string. We never emit an `<f>`. `=cmd|'/c calc'!A0` in an .xlsx opens as the
 * literal TEXT `=cmd|'/c calc'!A0`. That — not "richer format" — is why .xlsx is
 * the recommended default (design §8.3).
 */
export interface XlsxCell {
  value: string | number | null;
  type: 'text' | 'number';
}

export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
}

export interface XlsxWriter {
  write(sheets: XlsxSheet[]): Promise<Blob>;
}

const KEY = '__blurExportXlsxWriter__';

type Holder = Record<string, XlsxWriter | undefined>;

export function setXlsxWriter(writer: XlsxWriter): void {
  (globalThis as unknown as Holder)[KEY] = writer;
}

export function getXlsxWriter(): XlsxWriter | undefined {
  return (globalThis as unknown as Holder)[KEY];
}

/** Wait for `xlsx.js` to land after asking the background to inject it. Times out
 *  honestly rather than hanging the dialog forever. */
export async function awaitXlsxWriter(timeoutMs = 8000): Promise<XlsxWriter | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const w = getXlsxWriter();
    if (w) return w;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 50));
  }
}
