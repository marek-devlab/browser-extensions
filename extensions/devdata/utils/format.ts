// The document API the Data tab talks to. Everything expensive is delegated to
// the Worker (utils/worker/*); this module is orchestration, plus the one thing
// a Worker cannot do — parse XML, which needs `DOMParser` (design §10.4).

import { detectFormat, type Detection } from './core/detect';
import { parseXmlToTree, XmlRefused } from './core/xml';
import {
  ancestorsOf,
  findByPath,
  lineStartsOf,
  losesPrecision,
  pathOf,
  type FlatNode,
} from './core/tree';
import { JobError, runJob, type RunningJob } from './worker/client';
import type { ConvertResponse, ParseResponse, Source } from './worker/protocol';
import type { ParseFormat } from './core/parse';
import type {
  ConversionResult,
  DocFormat,
  InspectedValue,
  ParsedDoc,
  ParseFailure,
} from './types';
import type { DevdataPrefs, FormatPref } from './storage';

/** Hard limits (design §4.2). Above the first we warn; above the second we refuse. */
export const SOFT_MAX_BYTES = 50_000_000;
export const HARD_MAX_BYTES = 200_000_000;

export { detectFormat };
export type { Detection };

/** Autodetect, resolving the "auto" pref against the text (design §4.1). */
export function resolveFormat(
  text: string,
  pref: FormatPref,
): { format: DocFormat | 'jwt'; autodetected: boolean } {
  if (pref !== 'auto') return { format: pref, autodetected: false };
  const detected = detectFormat(text);
  return { format: detected.format, autodetected: true };
}

export class ParseFailed extends Error {
  readonly failure: ParseFailure;
  constructor(failure: ParseFailure) {
    super(failure.message);
    this.failure = failure;
    this.name = 'ParseFailed';
  }
}

/**
 * Parse `text` as `format`. Returns a cancellable job — the Cancel button in the
 * loading state really terminates the worker (design §5.1).
 *
 * XML is the exception: `DOMParser` does not exist in a Worker, so XML is parsed
 * here, on the main thread, under a hard size cap (core/xml.ts).
 */
export function parseDocument(
  text: string,
  format: DocFormat,
  opts: { autodetected: boolean; name?: string | null; prefs: DevdataPrefs },
): RunningJob<ParsedDoc> {
  if (format === 'xml') {
    return { promise: parseXmlHere(text, opts), cancel: () => undefined };
  }

  const job = runJob<ParseResponse>({
    op: 'parse',
    text,
    format: format as ParseFormat,
    csvDelimiter: opts.prefs.csvDelimiter,
    // Detection was a cheap lexical sniff on the main thread (B1); let the Worker
    // fall back JSON→JSONC→JSON5 when the sniff guessed JSON but strict parse fails.
    autodetected: opts.autodetected,
  });

  const promise = job.promise.then((response): ParsedDoc => {
    const { result } = response;
    if (!result.ok) {
      throw new ParseFailed({
        message: result.message,
        line: result.line,
        column: result.column,
        suggestions: result.suggestions,
        partial: result.partial,
        text,
      });
    }
    return {
      // The Worker reports the format it ACTUALLY parsed — an autodetected
      // 'json' that turned out to be JSON5 comes back as 'json5' here.
      format: result.format as DocFormat,
      autodetected: opts.autodetected,
      text,
      lineStarts: response.lineStarts,
      bytes: response.bytes,
      lines: response.lines,
      tree: result.nodes,
      truncated: result.truncated,
      bigNumbers: result.bigNumbers,
      exact: result.exact,
      notes: result.notes,
      name: opts.name ?? null,
    };
  });

  return { promise, cancel: job.cancel };
}

async function parseXmlHere(
  text: string,
  opts: { autodetected: boolean; name?: string | null },
): Promise<ParsedDoc> {
  try {
    // `application/xml`, never `text/html` — parsing untrusted markup as HTML
    // inside a privileged extension page is exactly the sink we refuse to build
    // (design §7.3). External entities are not resolved by browsers, and a DTD
    // that declares entities is rejected outright by parseXmlToTree.
    const parser = new DOMParser();
    const built = parseXmlToTree(text, (t) =>
      parser.parseFromString(t, 'application/xml'),
    );
    const lineStarts = lineStartsOf(text);
    return {
      format: 'xml',
      autodetected: opts.autodetected,
      text,
      lineStarts,
      bytes: new TextEncoder().encode(text).length,
      lines: lineStarts.length,
      tree: built.nodes,
      truncated: built.truncated,
      bigNumbers: built.bigNumbers,
      exact: false,
      notes: [
        ...built.warnings,
        'XML разбирается нативным DOMParser в основном потоке (в Worker его нет) — поэтому здесь действует отдельный предел размера.',
      ],
      name: opts.name ?? null,
    };
  } catch (err) {
    if (err instanceof XmlRefused) {
      throw new ParseFailed({
        message: err.message,
        line: 1,
        column: 1,
        suggestions: [],
        partial: null,
        text,
      });
    }
    throw err;
  }
}

/**
 * Beautify / minify.
 *
 * ⚠️ This runs in the WORKER, not here. Emitting 50 MB of JSON on the main
 * thread would freeze the tab for seconds — the exact failure the whole Worker
 * architecture exists to prevent — even though the function itself is a pure,
 * non-recursive string builder (core/serialize.ts `emitJson`).
 *
 * It emits from the TREE, not from `JSON.stringify(JSON.parse(text))`, so every
 * scalar keeps its exact source spelling: `12345678901234567890` survives a
 * beautify instead of being silently rounded to `...000` (design §3).
 */
export function reformat(
  doc: ParsedDoc,
  prefs: DevdataPrefs,
  overrides: { indent?: DevdataPrefs['indent'] } = {},
): RunningJob<string> {
  const job = runJob<ConvertResponse>({
    op: 'convert',
    source: sourceOf(doc, prefs),
    from: doc.format,
    to: 'json',
    indent: overrides.indent ?? prefs.indent,
    sortKeys: prefs.sortKeys,
    csvBom: prefs.csvBom,
    csvDelimiter: prefs.csvDelimiter,
  });
  return { promise: job.promise.then((r) => r.text), cancel: job.cancel };
}

/** The Source a Worker job should use for this document. */
export function sourceOf(doc: ParsedDoc, prefs: DevdataPrefs): Source {
  // XML cannot be re-parsed inside the Worker (no DOMParser) — hand it the tree.
  if (doc.format === 'xml') return { kind: 'nodes', nodes: doc.tree };
  return {
    kind: 'text',
    text: doc.text,
    format: doc.format as ParseFormat,
    csvDelimiter: prefs.csvDelimiter,
  };
}

export function convert(
  doc: ParsedDoc,
  to: DocFormat,
  prefs: DevdataPrefs,
): RunningJob<ConversionResult> {
  const job = runJob<ConvertResponse>({
    op: 'convert',
    source: sourceOf(doc, prefs),
    from: doc.format,
    to,
    indent: prefs.indent,
    sortKeys: prefs.sortKeys,
    csvBom: prefs.csvBom,
    csvDelimiter: prefs.csvDelimiter,
  });

  const promise = job.promise.then(
    (r): ConversionResult => ({
      from: doc.format,
      to,
      text: r.text,
      warnings: r.warnings,
      refusal: r.refusal,
      candidates: r.candidates,
    }),
  );
  return { promise, cancel: job.cancel };
}

/** Convert only the subtree at `path` (the way out when CSV refuses, §4.6). */
export function convertSubtree(
  doc: ParsedDoc,
  path: string,
  to: DocFormat,
  prefs: DevdataPrefs,
): RunningJob<ConversionResult> {
  const index = findByPath(doc.tree, path);
  if (index < 0) {
    return {
      promise: Promise.reject(new Error(`Узел ${path} не найден в документе.`)),
      cancel: () => undefined,
    };
  }
  const root = doc.tree[index];
  const nodes = doc.tree.slice(index, index + (root?.subtree ?? 0) + 1).map(
    (n, k) => ({
      ...n,
      parent: k === 0 ? -1 : n.parent - index,
      depth: n.depth - (root?.depth ?? 0),
      key: k === 0 ? null : n.key,
      index: k === 0 ? null : n.index,
    }),
  );

  const job = runJob<ConvertResponse>({
    op: 'convert',
    source: { kind: 'nodes', nodes },
    from: doc.format,
    to,
    indent: prefs.indent,
    sortKeys: prefs.sortKeys,
    csvBom: prefs.csvBom,
    csvDelimiter: prefs.csvDelimiter,
  });
  const promise = job.promise.then(
    (r): ConversionResult => ({
      from: doc.format,
      to,
      text: r.text,
      warnings: r.warnings,
      refusal: r.refusal,
      candidates: r.candidates,
    }),
  );
  return { promise, cancel: job.cancel };
}

/* -------------------------------- inspector ------------------------------- */

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/**
 * The bottom panel (design §2.4) — and the whole differentiator: we show the
 * text that is IN THE DOCUMENT, not what JavaScript turned it into.
 */
export function inspectValue(doc: ParsedDoc, index: number): InspectedValue | null {
  const node = doc.tree[index];
  if (!node) return null;
  const path = pathOf(doc.tree, index);

  if (node.kind === 'object' || node.kind === 'array') {
    return {
      path,
      raw: node.preview,
      kind: node.kind,
      precisionNote: null,
      exactnessNote: null,
      lengthNote:
        node.count === null ? null : `Элементов: ${node.count.toLocaleString('ru')}.`,
    };
  }

  const raw = node.raw ?? 'null';
  let precisionNote: string | null = null;
  let exactnessNote: string | null = null;
  let lengthNote: string | null = null;

  if (node.kind === 'number' && losesPrecision(raw)) {
    const rounded = String(Number(raw));
    precisionNote = doc.exact
      ? `Число не помещается в double. Показано исходное написание из документа; JavaScript округлил бы его до ${rounded}.`
      : `Точность потеряна при разборе: этот формат не даёт доступа к исходному тексту, поэтому показано округлённое ${rounded}. Исходное написание восстановить нельзя.`;
  }
  if (!doc.exact && node.kind === 'number') {
    exactnessNote =
      'Формат разбирается через значения, а не через позиции в исходнике — исходное написание чисел недоступно.';
  }

  if (node.kind === 'string') {
    let value = raw;
    try {
      value = String(JSON.parse(raw));
    } catch {
      /* keep raw */
    }
    // `str.length` counts UTF-16 units and lies about emoji and combining marks.
    const graphemes = segmenter
      ? [...segmenter.segment(value)].length
      : [...value].length;
    lengthNote = `Длина: ${graphemes.toLocaleString('ru')} символ(ов)${
      graphemes !== value.length
        ? ` (${value.length} кодовых единиц UTF-16 — строка содержит суррогатные пары или составные символы)`
        : ''
    }.`;
  }

  return { path, raw, kind: node.kind, precisionNote, exactnessNote, lengthNote };
}

/* --------------------------------- search --------------------------------- */

export interface SearchHit {
  /** Offset into `doc.text`. */
  offset: number;
  line: number;
}

/** Search is disabled above this size and the UI says why (design §5.2, §9.3). */
export const MAX_SEARCH_BYTES = 20_000_000;
export const MAX_HITS = 2_000;

/** Literal text search over the whole document (not just the rendered window). */
export function searchText(doc: ParsedDoc, query: string): SearchHit[] {
  if (query === '' || doc.text.length > MAX_SEARCH_BYTES) return [];
  const hits: SearchHit[] = [];
  let from = 0;
  // indexOf is a native scan — no user-supplied regex ever reaches an engine
  // here, so there is no ReDoS surface on the main thread.
  for (;;) {
    const at = doc.text.indexOf(query, from);
    if (at === -1 || hits.length >= MAX_HITS) break;
    hits.push({ offset: at, line: lineOfOffset(doc.lineStarts, at) });
    from = at + Math.max(1, query.length);
  }
  return hits;
}

function lineOfOffset(lineStarts: Int32Array, offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Path search: `$.users[1].id` → the node index, plus its ancestors to reveal. */
export function searchPath(
  tree: FlatNode[],
  path: string,
): { index: number; reveal: number[] } | null {
  const index = findByPath(tree, path);
  if (index < 0) return null;
  return { index, reveal: ancestorsOf(tree, index) };
}
