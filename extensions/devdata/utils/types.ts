import type { FlatNode } from './core/tree';
import type { ParseSuggestion } from './core/parse';
import type { FormatPref } from './storage';

// Domain types shared by the logic and the UI.

/** A concrete, detected format (never 'auto' — that is only a *pref*). */
export type Format = Exclude<FormatPref, 'auto'> | 'jwt';

/** Formats a *document* can be (JWT is a credential, not a document — §1.3). */
export type DocFormat = Exclude<Format, 'jwt'>;

export const FORMAT_LABELS: Record<Format, string> = {
  json: 'JSON',
  json5: 'JSON5',
  jsonc: 'JSONC',
  yaml: 'YAML',
  xml: 'XML',
  csv: 'CSV',
  jwt: 'JWT',
};

/** A parsed document. `tree` is flat and pre-order (see core/tree.ts). */
export interface ParsedDoc {
  format: DocFormat;
  /** Whether autodetect (vs. an explicit override) chose the format. */
  autodetected: boolean;
  /** The source text, verbatim. The text pane renders windows of this. */
  text: string;
  /** Offsets of each line start, for O(log n) line lookups + virtualisation. */
  lineStarts: Int32Array;
  bytes: number;
  lines: number;
  tree: FlatNode[];
  /** MAX_NODES / MAX_DEPTH cut the tree short — the UI must say so. */
  truncated: boolean;
  /** At least one number does not survive a JS double. */
  bigNumbers: boolean;
  /** Scalars carry their exact source spelling (JSON/JSONC offsets). */
  exact: boolean;
  /** Honest, non-fatal notes from the parser (CSV delimiter, YAML anchors …). */
  notes: string[];
  /** File name when the document came from a dropped/selected file. */
  name: string | null;
}

/** A parse failure with a real source position (design §5.4). */
export interface ParseFailure {
  message: string;
  line: number;
  column: number;
  suggestions: ParseSuggestion[];
  /** Tree parsed up to the error, shown ghosted rather than discarded. */
  partial: FlatNode[] | null;
  /** The text that failed, so the error view can show the offending lines. */
  text: string;
}

/** The value-inspector payload (bottom panel, design §2.4). */
export interface InspectedValue {
  path: string;
  /** The raw text exactly as written in the source document, when known. */
  raw: string;
  kind: FlatNode['kind'];
  /** Set when the source number cannot round-trip through a JS double. */
  precisionNote: string | null;
  /** Set when this format cannot give us the exact source spelling at all. */
  exactnessNote: string | null;
  /** Length in GRAPHEMES for strings — `str.length` lies about emoji. */
  lengthNote: string | null;
}

export type { ConversionWarning } from './core/serialize';
export type { SchemaIssue } from './worker/protocol';

export interface ConversionResult {
  from: DocFormat;
  to: DocFormat;
  text: string;
  warnings: import('./core/serialize').ConversionWarning[];
  /** Set when the target format cannot represent this document at all. */
  refusal: string | null;
  /** Real JSONPaths of arrays-of-objects, offered when CSV refuses (§4.6). */
  candidates: string[];
}

/* ------------------------------- JWT (§2.6) ------------------------------- */

export interface JwtClaim {
  name: string;
  label: string;
  value: string;
  /** Human note, e.g. "⛔ ПРОСРОЧЕН на 1 ч 4 мин". */
  note: string | null;
  status: 'ok' | 'warn' | 'poor' | 'info';
}

export interface JwtDecoded {
  header: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  headerText: string;
  payloadText: string;
  /** Raw payload text when it is not JSON — a legal, if unusual, JWT (§4.4). */
  payloadIsJson: boolean;
  alg: string;
  algNone: boolean;
  /** HS* → a shared secret; RS/ES/PS/EdDSA → a public key. */
  symmetric: boolean;
  claims: JwtClaim[];
  /** Segment boundaries in the token string, for Highlight-API colouring. */
  segments: {
    header: [number, number];
    payload: [number, number];
    signature: [number, number];
  };
  /** Non-fatal problems: header decoded but payload did not, etc. */
  problems: string[];
}

export type JwtVerifyResult =
  | { status: 'valid'; detail: string }
  | { status: 'invalid'; detail: string }
  | { status: 'error'; detail: string };
