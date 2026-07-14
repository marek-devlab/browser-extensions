// Shared domain types for the exporter. Pure data — no browser/React imports, so
// both the injected `engine.js` (page context) and the React surfaces (popup /
// options / preview) can share one vocabulary.

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
  /** True when the trimmed value starts with = + - @ (0x09/0x0D) and is NOT a
   *  valid number → the formula guard will prefix it (design §8.3). */
  formulaRisk?: boolean;
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
 * A scored, parsed table. In the scaffold this is fabricated (see
 * utils/mock-data.ts); the real matrix builder is a TODO_LOGIC in
 * utils/table-extract.ts.
 */
export interface TableModel {
  id: string;
  caption: string | null;
  rows: number;
  cols: number;
  columns: TableColumn[];
  /** Preview matrix — first N rows only for large tables (design §5.3). */
  preview: Cell[][];
  /** Heuristic score & flags (design §4.2). Never hides a table, only warns. */
  looksLikeLayout: boolean;
  hasMergedCells: number;
  hasNestedTables: number;
  /** Virtualized / lazy-loaded rows suspected (design §5.10). */
  virtualized?: boolean;
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
 * fresh on open — there is no badge and no precomputed count (design §1.2), so
 * this is always a live read, mocked for now.
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
  parseNumbers: boolean;
  parseDates: boolean;
  visibleRowsOnly: boolean;
  filenameTemplate: string;
  filenameTranslit: boolean;
  alwaysPreview: boolean;
  theme: 'auto' | 'light' | 'dark';
}
