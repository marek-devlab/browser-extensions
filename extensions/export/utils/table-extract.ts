// REAL DOM extraction. Runs ONLY inside the injected `engine.js` (page context,
// isolated world) — never in the service worker, never in an extension page.
//
// 🔴 Page content is UNTRUSTED. Nothing here ever produces HTML: every value that
// leaves this module is a plain string that the UI puts into a text node
// (design §8.1). No innerHTML / outerHTML / insertAdjacentHTML anywhere.
//
// Covers design §4.2 (scan + data-vs-layout scoring), §6.1 (colspan/rowspan grid
// matrix), §6.2 (headers), §6.3 (caption), §6.4/§4.5 (nested tables), §6.5
// (conservative number parsing), §6.6 (links), §6.7 (br / img / checkbox / select),
// §5.10 (virtualization suspicion) and §9.1 (chunking + clamps).

import { collectOpenShadowRoots, deepQuerySelectorAll, yieldToMain } from '@blur/core';
import { isPlainNumber } from './csv-guard';
import {
  MAX_COLS,
  MAX_SPAN,
  PREVIEW_ROWS,
  type Cell,
  type ColumnType,
  type ExtractOptions,
  type PageInventory,
  type TableColumn,
  type TableModel,
} from './types';

/* ====================================================================== *
 * Text normalization (design §6.7)
 * ====================================================================== */

/** Elements whose content is UI chrome, never data (design §6.7). */
const SKIP_TAGS = new Set([
  'BUTTON',
  'SVG',
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'NOSCRIPT',
  'IFRAME',
  'CANVAS',
  'AUDIO',
  'VIDEO', // 🔴 present only to be SKIPPED. We never read media (design §12).
]);

const MAX_CELL_DEPTH = 12;

function isHidden(el: Element): boolean {
  // `checkVisibility` is the only correct check (display / visibility / hidden /
  // content-visibility all at once, design §11). Older engines: fall back to a
  // cheap computed-style read.
  const anyEl = el as Element & {
    checkVisibility?: (o?: Record<string, boolean>) => boolean;
  };
  if (typeof anyEl.checkVisibility === 'function') {
    return !anyEl.checkVisibility({
      visibilityProperty: true,
      contentVisibilityAuto: true,
    });
  }
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !cs || cs.display === 'none' || cs.visibility === 'hidden';
}

/** Collapse whitespace but KEEP the newlines that <br> produced (design §6.7). */
function normalizeWhitespace(s: string): string {
  return s
    .replace(/[^\S\n]+/g, ' ') // any horizontal whitespace run → one space
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

interface CellScan {
  text: string;
  nested: boolean;
}

/**
 * Read one <td>/<th> as a string. 🔴 Uses `textContent` + normalization, NOT
 * `innerText`: innerText forces a reflow per cell, which on a 60 000-cell table
 * costs seconds (design §6.7).
 */
function readCell(td: Element, opts: ExtractOptions): CellScan {
  const out: string[] = [];
  let nested = false;
  const base = td.ownerDocument.baseURI;

  const walk = (node: Node, depth: number): void => {
    if (depth > MAX_CELL_DEPTH) return;

    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.nodeValue ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toUpperCase();

    if (SKIP_TAGS.has(tag)) return;

    // 🔴 Nested <table>: does NOT map into a 2-D grid (design §4.5). We FLATTEN it
    // to text and flag the cell, so the dialog can say so. We never "expand" it
    // into extra parent rows — that silently corrupts data.
    if (tag === 'TABLE') {
      nested = true;
      out.push(flattenNestedTable(el as HTMLTableElement, opts));
      return;
    }

    if (tag === 'BR') {
      out.push('\n');
      return;
    }
    if (tag === 'IMG') {
      out.push((el as HTMLImageElement).alt ?? '');
      return;
    }
    if (tag === 'INPUT') {
      const input = el as HTMLInputElement;
      const type = input.type.toLowerCase();
      // Very common in admin panels (design §6.7).
      if (type === 'checkbox' || type === 'radio') out.push(input.checked ? 'да' : 'нет');
      else if (type !== 'button' && type !== 'submit' && type !== 'hidden') out.push(input.value);
      return;
    }
    if (tag === 'SELECT') {
      const sel = el as HTMLSelectElement;
      out.push(sel.selectedOptions[0]?.textContent ?? ''); // the CHOSEN option, not all
      return;
    }

    // sr-only / tooltip text ("Sort ascending") is chrome, not data (design §6.7).
    if (opts.visibleRowsOnly && isHidden(el)) return;

    if (tag === 'A' && opts.linksInCells !== 'text') {
      const href = (el as HTMLAnchorElement).getAttribute('href');
      const abs = href ? absoluteUrl(href, base) : '';
      const label = normalizeWhitespace(el.textContent ?? '');
      if (opts.linksInCells === 'url') {
        out.push(abs || label);
      } else {
        out.push(abs ? `${label} (${abs})` : label);
      }
      return;
    }

    for (const child of el.childNodes) walk(child, depth + 1);
  };

  for (const child of td.childNodes) walk(child, 0);
  return { text: normalizeWhitespace(out.join('')), nested };
}

/** `Иванов / 42 · Петров / 17` — the honest flattening of a nested table (§4.5). */
function flattenNestedTable(table: HTMLTableElement, opts: ExtractOptions): string {
  const rows: string[] = [];
  for (const tr of Array.from(table.rows).slice(0, 20)) {
    const cells: string[] = [];
    for (const td of Array.from(tr.cells).slice(0, 20)) {
      // depth-1 read only: no recursion into a nested-nested table.
      cells.push(normalizeWhitespace(td.textContent ?? ''));
    }
    const line = cells.filter(Boolean).join(' / ');
    if (line) rows.push(line);
  }
  void opts;
  return rows.join(' · ');
}

/* ====================================================================== *
 * Numbers (design §6.5) — conservative on purpose
 * ====================================================================== */

/** Decimal separator of the PAGE's locale, then the browser's (design §6.5). */
export function pageDecimalSeparator(doc: Document): string {
  const lang = doc.documentElement.getAttribute('lang') || navigator.language || 'en';
  try {
    const parts = new Intl.NumberFormat(lang).formatToParts(1.1);
    return parts.find((p) => p.type === 'decimal')?.value ?? '.';
  } catch {
    return '.';
  }
}

/**
 * `1 234,56` → 1234.56 — but ONLY when unambiguous.
 * 🔴 `1,234` stays TEXT: it is 1234 or 1.234 depending on locale, and guessing
 * wrong silently corrupts someone's report (design §6.5). Percent / currency stay
 * text too; the user can force the column type by hand.
 */
export function parseLocaleNumber(raw: string, decimalSep: string): number | null {
  const s = raw
    .trim()
    .replace(/[   ]/g, '')
    .replace(/−/g, '-')
    .replace(/(?<=\d) (?=\d)/g, '');
  if (s === '') return null;

  const thousandsSep = decimalSep === ',' ? '.' : ',';
  // Ambiguous: a single separator-that-is-not-the-decimal-one with exactly 3
  // digits behind it (`1,234` in an en page, `1.234` in a ru page).
  const ambiguous = new RegExp(`^[+-]?\\d{1,3}\\${thousandsSep}\\d{3}$`);
  if (ambiguous.test(s)) return null;

  const cleaned = s.split(thousandsSep).join('');
  const canonical = decimalSep === ',' ? cleaned.replace(',', '.') : cleaned;
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(canonical)) return null;
  const n = Number(canonical);
  return Number.isFinite(n) ? n : null;
}

/* ====================================================================== *
 * Data-table vs layout-table scoring (design §4.2)
 * ====================================================================== */

/** ⚠️ Scoring NEVER hides a table (design §4.2). It only sorts and warns. */
export function scoreTable(table: HTMLTableElement): number {
  let score = 0;
  if (table.querySelector('th, thead, caption, [scope]')) score += 3;

  const rowCount = table.rows.length;
  const colCount = table.rows[0]?.cells.length ?? 0;
  if (rowCount >= 2 && colCount >= 2) score += 1;
  if (rowCount <= 1 || colCount <= 1) score -= 2;

  // Nested <table> inside → the 2005 layout-table smell.
  if (table.querySelector('table')) score -= 1;

  // ≥70% of cells are images/inputs with no text → toolbar, not data.
  const cells = table.querySelectorAll('td, th');
  if (cells.length > 0) {
    let widgety = 0;
    for (const c of cells) {
      const hasText = normalizeWhitespace(c.textContent ?? '') !== '';
      if (!hasText && c.querySelector('img, input')) widgety++;
    }
    if (widgety / cells.length >= 0.7) score -= 2;
  }
  return score;
}

/** `role="presentation"|"none"` is the author telling us it is NOT data. */
function isExplicitlyPresentational(table: Element): boolean {
  const role = table.getAttribute('role');
  return role === 'presentation' || role === 'none';
}

/**
 * ⚠️ Virtualization (ag-grid, react-virtual): only the visible window is in the
 * DOM. Signal: a scrollable ancestor whose scrollHeight far exceeds the height the
 * present rows occupy. We can only SUSPECT it — and we say "possibly", never
 * "экспортировано всё" (design §5.10 / §7.5).
 */
function looksVirtualized(table: HTMLTableElement): boolean {
  const rows = table.rows.length;
  if (rows === 0) return false;
  let el: HTMLElement | null = table.parentElement;
  for (let i = 0; i < 5 && el; i++, el = el.parentElement) {
    const overflowing = el.scrollHeight > el.clientHeight * 1.5 && el.clientHeight > 0;
    if (overflowing && el.scrollHeight > table.getBoundingClientRect().height * 1.5) return true;
  }
  return false;
}

/* ====================================================================== *
 * The grid matrix (design §6.1)
 * ====================================================================== */

export interface Matrix {
  cells: Cell[][];
  mergedCount: number;
  nestedCount: number;
  /** Index of the last row that is part of the header block (-1 = no headers). */
  headerRows: number;
}

/**
 * `<table>` → `Cell[row][col]`, honouring colspan/rowspan with anchor + shadow
 * cells (the browser's own table-formation algorithm).
 *
 * ⚠️ Broken tables with `colspan="9999"` are clamped (MAX_SPAN / MAX_COLS):
 * otherwise one cell births 10 000 columns and kills the tab (design §6.1).
 *
 * Chunked: yields to the event loop every `CHUNK_ROWS` rows so a 60 000-cell table
 * does not freeze the page (design §9.1), and honours an AbortSignal (§9.3).
 */
export async function buildMatrix(
  table: HTMLTableElement,
  opts: ExtractOptions,
  maxRows = Infinity,
): Promise<Matrix> {
  const CHUNK_ROWS = 200;
  const grid: Cell[][] = [];
  // Pending rowspans: colIndex → { remaining, cell }.
  const spans = new Map<number, { left: number; cell: Cell }>();
  let mergedCount = 0;
  let nestedCount = 0;

  const domRows = Array.from(table.rows).filter(
    (tr) => !opts.visibleRowsOnly || !isHidden(tr),
  );

  let headerRows = 0;
  let sawHeaderBlock = false;

  for (let r = 0; r < domRows.length && grid.length < maxRows; r++) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const tr = domRows[r]!;

    // Header block (design §6.2), in the doc's exact order of preference:
    //  1. every <thead> row;  2. a first row that is entirely <th>;
    //  3. a first row carrying th[scope=col].
    // ⚠️ th[scope=row] does NOT make a header — it is the first data column, and
    // dropping it would silently delete a column.
    const inThead = tr.parentElement?.tagName === 'THEAD';
    const cellsArr = Array.from(tr.cells);
    const allTh = cellsArr.length > 0 && cellsArr.every((c) => c.tagName === 'TH');
    const scopeCol = cellsArr.some((c) => c.getAttribute('scope') === 'col');
    const isHeaderRow = inThead || (grid.length === 0 && (allTh || scopeCol));
    if (isHeaderRow && !sawHeaderBlock) headerRows = grid.length + 1;
    else sawHeaderBlock = true;

    const row: Cell[] = [];
    let col = 0;

    const placePendingSpans = (): void => {
      // Fill positions owned by a rowspan that started above.
      for (;;) {
        const pending = spans.get(col);
        if (!pending) break;
        row[col] = { ...pending.cell, merged: true };
        if (opts.mergedCells === 'empty') row[col] = { value: '', merged: true };
        mergedCount++;
        pending.left--;
        if (pending.left <= 0) spans.delete(col);
        col++;
        if (col >= MAX_COLS) break;
      }
    };

    placePendingSpans();

    for (const td of Array.from(tr.cells)) {
      if (col >= MAX_COLS) break;
      const scan = readCell(td, opts);
      if (scan.nested) nestedCount++;

      const colspan = Math.min(Math.max(1, td.colSpan || 1), MAX_SPAN);
      const rowspan = Math.min(Math.max(1, td.rowSpan || 1), MAX_SPAN);
      const anchor: Cell = { value: scan.text };
      if (scan.nested) anchor.nested = true;

      for (let c = 0; c < colspan && col < MAX_COLS; c++) {
        const isAnchor = c === 0;
        if (isAnchor) {
          row[col] = anchor;
        } else {
          row[col] =
            opts.mergedCells === 'empty'
              ? { value: '', merged: true }
              : { ...anchor, merged: true };
          mergedCount++;
        }
        if (rowspan > 1) {
          spans.set(col, { left: rowspan - 1, cell: anchor });
        }
        col++;
      }
      placePendingSpans();
    }

    grid.push(row);
    if ((r + 1) % CHUNK_ROWS === 0) await yieldToMain();
  }

  // Normalize width: a ragged table (missing <td>s) must still be rectangular,
  // otherwise CSV rows have different field counts and no parser will open it.
  const width = Math.min(
    grid.reduce((m, row) => Math.max(m, row.length), 0),
    MAX_COLS,
  );
  for (const row of grid) {
    for (let c = 0; c < width; c++) if (!row[c]) row[c] = { value: '' };
    row.length = width;
  }

  return { cells: grid, mergedCount, nestedCount, headerRows };
}

/* ====================================================================== *
 * Headers (design §6.2)
 * ====================================================================== */

/** Multi-level headers are JOINED with ` / ` into one row — two header rows would
 *  make pandas lose its mind (design §6.2). Empty → `Колонка N`. Dupes → `X (2)`. */
export function headersFrom(matrix: Matrix, width: number): string[] {
  const out: string[] = [];
  for (let c = 0; c < width; c++) {
    const levels: string[] = [];
    for (let r = 0; r < matrix.headerRows; r++) {
      const v = matrix.cells[r]?.[c]?.value ?? '';
      if (v && levels[levels.length - 1] !== v) levels.push(v);
    }
    out.push(levels.join(' / '));
  }

  const seen = new Map<string, number>();
  return out.map((h, i) => {
    const base = h || `Колонка ${i + 1}`; // never '' — pandas would emit `Unnamed: 2`
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/** Conservative column typing (design §6.5). `date` is NEVER auto-detected — that
 *  is `parseDates`, off by default, because `05.06` is unresolvable. */
function inferColumnType(body: readonly Cell[][], col: number): ColumnType {
  let seen = 0;
  for (const row of body) {
    const v = row[col]?.value ?? '';
    if (v === '') continue;
    seen++;
    if (!isPlainNumber(v)) return 'text';
    if (seen >= 50) break; // a 50-row sample is enough
  }
  return seen > 0 ? 'number' : 'text';
}

/* ====================================================================== *
 * Public API
 * ====================================================================== */

/** Every `<table>` on the page, open shadow roots included (design §4.2 / §5.8). */
export function scanTables(doc: Document = document): HTMLTableElement[] {
  return deepQuerySelectorAll(doc, 'table')
    .filter((el): el is HTMLTableElement => el instanceof HTMLTableElement)
    .filter((el) => !isExplicitlyPresentational(el)) // author said "not data"
    .filter((el) => !el.closest('[data-blur-export-overlay]')); // never our own UI
}

export function defaultExtractOptions(
  over: Partial<ExtractOptions> = {},
): ExtractOptions {
  return {
    mergedCells: 'duplicate',
    visibleRowsOnly: true,
    linksInCells: 'text',
    ...over,
  };
}

/**
 * Build the TableModel a UI surface renders: dimensions, flags, columns, and the
 * FIRST `PREVIEW_ROWS` rows. 🔴 The full matrix is deliberately NOT included —
 * rendering 60 000 cells would kill the tab, and the model crosses a message
 * boundary to the popup (design §5.3).
 */
export async function buildTableModel(
  table: HTMLTableElement,
  id: string,
  opts: ExtractOptions,
): Promise<TableModel> {
  const domRows = table.rows.length;
  const previewMatrix = await buildMatrix(table, opts, PREVIEW_ROWS + 4);
  const width = previewMatrix.cells[0]?.length ?? 0;

  const headers = headersFrom(previewMatrix, width);
  const body = previewMatrix.cells.slice(previewMatrix.headerRows);
  const columns: TableColumn[] = headers.map((header, c) => ({
    header,
    type: inferColumnType(body, c),
    included: true,
  }));

  // ⚠️ The FULL merged/nested counts need the full table; the preview matrix only
  // sees the first rows. Count spans cheaply over the DOM instead of building the
  // whole matrix here (design §9.1 — no eager giant matrix).
  let mergedCount = 0;
  let nestedCount = 0;
  for (const tr of table.rows) {
    for (const td of tr.cells) {
      if ((td.colSpan || 1) > 1 || (td.rowSpan || 1) > 1) mergedCount++;
      if (td.querySelector('table')) nestedCount++;
    }
  }

  const bodyRows = Math.max(0, domRows - previewMatrix.headerRows);
  const score = scoreTable(table);

  return {
    id,
    caption: normalizeWhitespace(table.caption?.textContent ?? '') || null,
    rows: bodyRows,
    cols: width,
    cells: bodyRows * width,
    columns,
    preview: body.slice(0, PREVIEW_ROWS),
    hasHeaders: previewMatrix.headerRows > 0,
    looksLikeLayout: score < 1,
    hasMergedCells: mergedCount,
    hasNestedTables: nestedCount,
    virtualized: looksVirtualized(table),
  };
}

/** Count graphemes, not code units — `str.length` lies on emoji (design §11). */
function graphemeCount(s: string): number {
  const Seg = (globalThis.Intl as unknown as {
    Segmenter?: new (
      l?: string,
      o?: { granularity: string },
    ) => { segment(input: string): Iterable<unknown> };
  }).Segmenter;
  if (!Seg) return s.length;
  try {
    let n = 0;
    for (const _part of new Seg(undefined, { granularity: 'grapheme' }).segment(s)) n++;
    return n;
  } catch {
    return s.length;
  }
}

/** The popup's page inventory (design §2.4). A LIVE read on open — no badge, no
 *  precomputed count, because either would need a standing content script (§1.2). */
export async function scanPageInventory(opts: ExtractOptions): Promise<PageInventory> {
  const tables = scanTables(document);
  const models: TableModel[] = [];
  for (let i = 0; i < tables.length && i < 40; i++) {
    models.push(await buildTableModel(tables[i]!, `t${i}`, opts));
  }

  const images = Array.from(document.images);
  const selText = document.getSelection()?.toString() ?? '';

  return {
    host: location.hostname || location.protocol,
    selection: selText.trim()
      ? {
          chars: graphemeCount(selText),
          paragraphs: selText.split(/\n{2,}/).filter((p) => p.trim()).length || 1,
        }
      : null,
    tables: models,
    images: {
      total: images.length,
      largerThan200: images.filter((im) => im.naturalWidth > 200 && im.naturalHeight > 200)
        .length,
    },
    // ⚠️ We can SEE these frames but never READ them (design §5.7) — say so.
    crossOriginFrames: Array.from(document.querySelectorAll('iframe')).filter((f) => {
      try {
        return f.contentDocument === null;
      } catch {
        return true;
      }
    }).length,
    // ⚠️ A closed shadow root is unreachable for everyone, us included (§5.8).
    closedShadowHosts: countClosedShadowHosts(),
  };
}

function countClosedShadowHosts(): number {
  // Heuristic and honestly labelled as such: a custom element with no light-DOM
  // children and no OPEN shadowRoot is very likely a closed-root component.
  const open = new Set(collectOpenShadowRoots(document).map((r) => r.host));
  let n = 0;
  for (const el of document.querySelectorAll('*')) {
    if (!el.tagName.includes('-')) continue;
    if (el.shadowRoot || open.has(el)) continue;
    if (el.children.length === 0 && (el.textContent ?? '').trim() === '') n++;
  }
  return n;
}
