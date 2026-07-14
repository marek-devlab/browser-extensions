import type { FormatPref } from './storage';

// Domain types shared by the (stubbed) logic and the (real) UI. Keeping these
// here means the tabs render against a stable shape now, and wiring the real
// parsers later is a matter of making the stubs in format.ts / jwt.ts /
// schema.ts return the same types.

/** A concrete, detected format (never 'auto' — that is only a *pref*). */
export type Format = Exclude<FormatPref, 'auto'> | 'jwt';

export const FORMAT_LABELS: Record<Format, string> = {
  json: 'JSON',
  json5: 'JSON5',
  jsonc: 'JSONC',
  yaml: 'YAML',
  xml: 'XML',
  csv: 'CSV',
  jwt: 'JWT',
};

/** One row in the flattened, virtualisable tree view (design §2.4). */
export interface TreeRow {
  id: string;
  /** Indentation level. */
  depth: number;
  /** Typographic marker so type is never colour-only (design §9.2). */
  kind: 'object' | 'array' | 'string' | 'number' | 'bool' | 'null';
  /** Object key or array index label; null at the document root. */
  key: string | null;
  /** Short value preview for scalars, or child count for containers. */
  preview: string;
  /** Child count for containers, else null. */
  count: number | null;
  /** JSONPath to this node, e.g. `$.users[1].id`. */
  path: string;
  expandable: boolean;
}

/** The value-inspector payload (bottom panel, design §2.4). */
export interface InspectedValue {
  path: string;
  /** The raw text exactly as written in the source document. */
  raw: string;
  /**
   * A precision warning when the source number cannot round-trip through a JS
   * double — the differentiator from PLAN-2 §10.1 (JSON.parse source access).
   */
  precisionNote: string | null;
}

/** Result of parsing a document (design §2.4). */
export interface ParsedDoc {
  format: Format;
  /** Whether autodetect (vs. an explicit override) chose the format. */
  autodetected: boolean;
  bytes: number;
  lines: number;
  nodes: number;
  valid: boolean;
  rows: TreeRow[];
  /** The (possibly re-indented) source text lines for the text pane. */
  textLines: string[];
}

/** A parse error with a source position (design §5.4). */
export interface ParseError {
  message: string;
  line: number;
  column: number;
  /** Suggested fixes offered as buttons (e.g. "remove trailing comma"). */
  suggestions: string[];
  /** Partial tree parsed up to the error, shown ghosted (design §5.4). */
  partial: TreeRow[] | null;
}

/** A lossy-conversion warning (design §2.5 — mandatory panel). */
export interface ConversionWarning {
  severity: 'warn' | 'poor';
  message: string;
}

export interface ConversionResult {
  from: Format;
  to: Format;
  text: string;
  warnings: ConversionWarning[];
}

/** Decoded JWT (design §2.6). */
export interface JwtDecoded {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  /** Pretty-printed header/payload for the panes. */
  headerText: string;
  payloadText: string;
  alg: string;
  /** e.g. 'none' triggers the red warning block (design §4.4). */
  algNone: boolean;
  claims: JwtClaim[];
  /** base64url segment boundaries for Highlight-API colouring (design §2.6). */
  segments: { header: [number, number]; payload: [number, number]; signature: [number, number] };
}

export interface JwtClaim {
  name: string;
  label: string;
  value: string;
  /** Human relative time / status, e.g. "expired 1h 4m ago". */
  note: string | null;
  status: 'ok' | 'warn' | 'poor' | 'info';
}

export type JwtVerifyResult =
  | { status: 'valid'; detail: string }
  | { status: 'invalid'; detail: string }
  | { status: 'error'; detail: string };

/** A single JSON Schema validation error (design §2.8). */
export interface SchemaError {
  /** JSONPath into the data. */
  instancePath: string;
  message: string;
  /** JSON pointer into the schema that failed. */
  schemaPath: string;
}
