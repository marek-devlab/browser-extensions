// Shared domain types for the exporter. Pure data — no browser/React imports, so
// both the injected `engine.js` (page context) and the React surfaces (popup /
// options / save) can share one vocabulary.

/** File formats we can PRODUCE. 🔴 No video, ever (design §12). */
export type TableFormat = 'csv' | 'xlsx' | 'md' | 'txt';
export type TextFormat = 'md' | 'txt';

/** CSV writer knobs (design §2.3 / §3). */
export type CsvDelimiter = 'auto' | ',' | ';' | '\t' | '|';
export type CsvEncoding = 'utf8-bom' | 'utf8';
export type CsvEol = 'crlf' | 'lf';
/** 🔴 The CSV-injection guard (design §8.3). `escape` is the default. */
export type FormulaGuard = 'escape' | 'keep' | 'warn';

/** Per-column type hint (xlsx only — CSV has no types, design §6.5). */
export type ColumnType = 'text' | 'number' | 'date';

/** One cell of the grid matrix (design §6.1). */
export interface Cell {
  /** Normalized display value — exactly what the preview shows and the file gets. */
  value: string;
  /** True when this position is a rowspan/colspan "shadow" of an anchor cell. */
  merged?: boolean;
  /** Flattened content of a nested <table> (design §4.5) — surfaced, never silent. */
  nested?: boolean;
}

export interface TableColumn {
  header: string;
  type: ColumnType;
  /** Unchecking a column drops it from the file (design §2.3, not persisted). */
  included: boolean;
}

/**
 * A scored, parsed table. `preview` holds only the first rows (design §5.3) —
 * the FULL matrix never crosses a message boundary; it is rebuilt in the page by
 * `buildMatrix` at save time.
 */
export interface TableModel {
  id: string;
  caption: string | null;
  rows: number;
  cols: number;
  columns: TableColumn[];
  /** Preview matrix — first N rows only for large tables (design §5.3). */
  preview: Cell[][];
  /** ⚠️ Did the table actually declare a header row (<thead> / all-<th> first row /
   *  th[scope=col])? If not, columns are named `Колонка N` and the dialog's
   *  "first row = headers" toggle must default to OFF (design §6.2, rule 4) —
   *  otherwise we would silently eat a row of real data. */
  hasHeaders: boolean;
  /** Heuristic score & flags (design §4.2). Never hides a table, only warns. */
  looksLikeLayout: boolean;
  hasMergedCells: number;
  hasNestedTables: number;
  /** Virtualized / lazy-loaded rows suspected (design §5.10). */
  virtualized?: boolean;
  /** rows × cols — the number the size guards (design §9.1) act on. */
  cells: number;
}

export interface ImageInventory {
  total: number;
  largerThan200: number;
}

export interface SelectionInfo {
  /** Grapheme count via Intl.Segmenter (design §11 — str.length lies on emoji). */
  chars: number;
  paragraphs: number;
}

/**
 * What the popup shows: "what can I pull off this page?" (design §2.4). Scanned
 * fresh on open — there is no badge and no precomputed count (design §1.2).
 */
export interface PageInventory {
  host: string;
  selection: SelectionInfo | null;
  tables: TableModel[];
  images: ImageInventory;
  /** Cross-origin iframes we can SEE but not READ (design §5.7). */
  crossOriginFrames: number;
  /** Closed shadow-DOM components we cannot reach (design §5.8). */
  closedShadowHosts: number;
}

/** Options — the persisted defaults (design §3). Mirrors utils/storage.ts. */
export interface ExportPrefs {
  defaultTableFormat: TableFormat;
  defaultTextFormat: TextFormat;
  csvDelimiter: CsvDelimiter;
  csvEncoding: CsvEncoding;
  csvEol: CsvEol;
  csvFormulaGuard: FormulaGuard;
  csvSepLine: boolean;
  mergedCells: 'duplicate' | 'empty';
  /** How an `<a>` inside a cell is rendered (design §6.6). */
  linksInCells: 'text' | 'text-url' | 'url';
  parseNumbers: boolean;
  parseDates: boolean;
  visibleRowsOnly: boolean;
  filenameTemplate: string;
  filenameTranslit: boolean;
  alwaysPreview: boolean;
  theme: 'auto' | 'light' | 'dark';
}

/** Knobs the matrix builder needs (subset of prefs — keeps it testable). */
export interface ExtractOptions {
  mergedCells: 'duplicate' | 'empty';
  visibleRowsOnly: boolean;
  linksInCells: 'text' | 'text-url' | 'url';
  /** Abort a long chunked extraction (design §9.3). */
  signal?: AbortSignal;
}

/* -------- Size limits (design §9.1). Named, not magic numbers. ---------- */

/** Above this we chunk the extraction and warn in the dialog. */
export const CELLS_WARN = 50_000;
/** 🔴 Above this .xlsx is refused (write-excel-file holds the whole book in RAM). */
export const CELLS_XLSX_MAX = 200_000;
/** Hard format limit of Excel itself — not ours. */
export const XLSX_MAX_ROWS = 1_048_576;
/** A single runaway colspan="9999" must not birth 10k columns (design §6.1). */
export const MAX_SPAN = 1000;
/** Widest matrix we will ever build. */
export const MAX_COLS = 1000;
/** Rows shown in the dialog preview (never the whole matrix — that kills the tab). */
export const PREVIEW_ROWS = 20;
