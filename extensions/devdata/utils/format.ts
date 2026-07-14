import { MOCK, mockAsync, todoLogic } from '@blur/ui';
import {
  MOCK_CONVERSION,
  MOCK_INSPECTED,
  MOCK_PARSED_DOC,
} from './mock-data';
import type {
  ConversionResult,
  Format,
  InspectedValue,
  ParsedDoc,
} from './types';
import type { FormatPref } from './storage';

// Parse / detect / convert — STUBBED on mocks for the scaffold phase.
//
// Every function returns realistic mock data (so the Data tab looks alive) and
// also carries a `todoLogic` path guarded by `!MOCK`, so `grep TODO_LOGIC`
// enumerates the whole remaining backlog and a wired-but-empty real path fails
// loudly instead of returning garbage.
//
// Libraries to wire (design §10.3), all declared in package.json, all LAZY
// (`await import()`, design §10.3): the initial tool bundle must carry only the
// JSON path; YAML/CSV/XML come in on first use.
//   - jsonc-parser : JSONC + error-tolerant parse + token OFFSETS (for §5.4
//                    position reporting — do NOT trust engine SyntaxError text).
//   - json5        : JSON5 parse.
//   - yaml (eemeli): YAML <-> JSON (ISC, zero-dep).
//   - papaparse    : CSV parse/serialise (delimiter autodetect, BOM on export).
//   - DOMParser / XMLSerializer : native XML <-> JSON (0 KB, no fast-xml-parser).
// The real parse/convert must run in a Worker on the tool page (design §4, §8) —
// never in the service worker.

/** Sniff a format from raw text (BOM → braces → `---`/`:` → `<` → delimiters →
 *  3 base64url segments). Stubbed: returns JSON. */
export async function detectFormat(text: string): Promise<Format> {
  if (!MOCK) {
    // TODO_LOGIC: devdata — real format autodetect (design §4.1 step 3).
    throw todoLogic('devdata: detect format');
  }
  void text;
  return 'json';
}

/** Parse `text` as `format` into a flattened, virtualisable tree. Stubbed. */
export async function parseDocument(
  text: string,
  format: FormatPref,
): Promise<ParsedDoc> {
  if (!MOCK) {
    // TODO_LOGIC: devdata — real parse via jsonc-parser/json5/yaml/papaparse in
    // a Worker; return offsets for error positions and preserve source number
    // text (JSON.parse source access) for exact big numbers (design §2.4, §5.6).
    throw todoLogic('devdata: parse document');
  }
  void text;
  void format;
  // Exercise the >150ms loading state (design §5.1) against mock data.
  return mockAsync(MOCK_PARSED_DOC, 500);
}

/** Inspect a single node's exact source text + precision note. Stubbed. */
export function inspectValue(path: string): InspectedValue {
  if (!MOCK) {
    // TODO_LOGIC: devdata — resolve node by JSONPath, return the RAW source text
    // (not the re-serialised value) and a precision note when it cannot survive
    // a JS double (design §2.4, differentiator from PLAN-2 §10.1).
    throw todoLogic('devdata: inspect value');
  }
  return { ...MOCK_INSPECTED, path };
}

/** Beautify/minify the current document to text. Stubbed. */
export async function reformat(
  doc: ParsedDoc,
  _indent: FormatPref | '2' | '4' | 'tab' | 'min',
): Promise<string> {
  if (!MOCK) {
    // TODO_LOGIC: devdata — re-serialise with the chosen indent; "sort keys"
    // affects OUTPUT only, never the tree (design §3).
    throw todoLogic('devdata: reformat document');
  }
  void _indent;
  return mockAsync(doc.textLines.join('\n'), 300);
}

/** Convert the document to another format. Stubbed. */
export async function convert(
  _doc: ParsedDoc,
  to: Format,
): Promise<ConversionResult> {
  if (!MOCK) {
    // TODO_LOGIC: devdata — real conversion in a Worker with the MANDATORY
    // lossy-conversion warnings (design §2.5): null-in-XML, types-in-CSV,
    // nesting-in-CSV, duplicate/ordered keys, -0, NaN/Infinity, dropped JSONC
    // comments, recursive YAML anchors (reject — billion-laughs).
    throw todoLogic('devdata: convert document');
  }
  void _doc;
  return mockAsync({ ...MOCK_CONVERSION, to }, 400);
}
