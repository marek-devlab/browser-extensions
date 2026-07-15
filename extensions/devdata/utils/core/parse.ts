// Parsing, one entry point per format. Runs inside the Worker (design §4, §8):
// never on the main thread, never in the service worker.
//
// Every library is pulled in with `await import()` (design §10.3) so a user who
// only ever opens JSON never downloads the YAML or CSV parser.
//
// FAIL-SAFE (design §5.4, §8): a parse failure returns a structured error with a
// real source position AND the partial tree parsed up to that point. An empty
// screen because of one stray comma in 40 MB is cruelty, so we don't do it.

import { lineOf, lineStartsOf, type FlatNode } from './tree';
import { buildTreeFromJsonc, buildTreeFromValue, type JsoncNode } from './tree';
import { sniffDelimiter, stripBom } from './detect';

export type ParseFormat = 'json' | 'json5' | 'jsonc' | 'yaml' | 'csv';

export type SuggestionId = 'json5' | 'jsonc' | 'json';

export interface ParseSuggestion {
  id: SuggestionId;
  label: string;
}

export interface ParseSuccess {
  ok: true;
  /** The format actually parsed. May differ from the requested one when an
   *  autodetected 'json' turned out to be JSON5 and the Worker fell back. */
  format: ParseFormat;
  nodes: FlatNode[];
  truncated: boolean;
  bigNumbers: boolean;
  /** True when scalars carry their EXACT source spelling (JSON/JSONC path). */
  exact: boolean;
  /** Honest, non-fatal notes: CSV delimiter, dropped comments, etc. */
  notes: string[];
}

export interface ParseFailure {
  ok: false;
  message: string;
  line: number;
  /** 1-based, counted in CODE POINTS — what the user actually sees (§5.4). */
  column: number;
  suggestions: ParseSuggestion[];
  /** The tree parsed up to the error, shown ghosted rather than discarded. */
  partial: FlatNode[] | null;
}

export type ParseResult = ParseSuccess | ParseFailure;

export async function parseText(
  input: string,
  format: ParseFormat,
  opts: { csvDelimiter?: string; autodetected?: boolean } = {},
): Promise<ParseResult> {
  const text = stripBom(input);
  switch (format) {
    case 'json':
    case 'jsonc': {
      const primary = await parseJsonFamily(text, format);
      if (primary.ok || !opts.autodetected) return primary;
      // Autodetect picked JSON from a cheap lexical sniff (core/detect.ts does
      // NOT full-parse — that would freeze the main thread, B1). If strict JSON
      // fails, the document may really be JSONC (a comment past the detect scan
      // bound) or JSON5 (trailing commas, single quotes, unquoted keys). Retry
      // HERE, in the Worker, so the fallback never touches the main thread.
      if (format === 'json') {
        const jsonc = await parseJsonFamily(text, 'jsonc');
        if (jsonc.ok) return jsonc;
      }
      const j5 = await parseJson5(text);
      // Keep the strict-JSON error if everything fails: it has the best position.
      return j5.ok ? j5 : primary;
    }
    case 'json5':
      return parseJson5(text);
    case 'yaml':
      return parseYaml(text);
    case 'csv':
      return parseCsv(text, opts.csvDelimiter);
  }
}

/* ------------------------------- JSON / JSONC ---------------------------- */

const JSONC_MESSAGES: Record<number, string> = {
  1: 'Недопустимый символ',
  2: 'Неверный формат числа',
  3: 'Ожидалось имя свойства',
  4: 'Ожидалось значение',
  5: 'Ожидалось двоеточие',
  6: 'Ожидалась запятая',
  7: 'Ожидалась закрывающая «}»',
  8: 'Ожидалась закрывающая «]»',
  9: 'Ожидался конец файла',
  10: 'Комментарии не допускаются в строгом JSON',
  11: 'Незакрытый комментарий',
  12: 'Незакрытая строка',
  13: 'Оборванное число',
  14: 'Неверная escape-последовательность \\u',
  15: 'Неверный escape-символ',
  16: 'Недопустимый символ',
};

async function parseJsonFamily(
  text: string,
  format: 'json' | 'jsonc',
): Promise<ParseResult> {
  // jsonc-parser is ERROR-TOLERANT and reports stable token OFFSETS. We never
  // parse the engine's SyntaxError text: V8 and SpiderMonkey word it differently
  // and neither gives a dependable offset (design §5.4).
  const { parseTree } = await import('jsonc-parser');
  const errors: { error: number; offset: number; length: number }[] = [];
  const root = parseTree(text, errors, {
    allowTrailingComma: format === 'jsonc',
    disallowComments: format === 'json',
    allowEmptyContent: false,
  }) as JsoncNode | undefined;

  const lineStarts = lineStartsOf(text);

  if (errors.length > 0 || !root) {
    const first = errors[0];
    const offset = first?.offset ?? text.length;
    const { line, column } = positionOf(text, lineStarts, offset);
    const partial = root
      ? buildTreeFromJsonc(root, text, lineStarts).nodes
      : null;
    return {
      ok: false,
      message: first
        ? `${JSONC_MESSAGES[first.error] ?? 'Ошибка разбора'} (позиция ${offset})`
        : 'Документ пуст или не является JSON',
      line,
      column,
      suggestions: suggestFor(text, format),
      partial,
    };
  }

  const built = buildTreeFromJsonc(root, text, lineStarts);
  const notes: string[] = [];
  if (built.truncated) {
    notes.push(
      'Документ слишком большой: дерево построено частично. Текст показан целиком.',
    );
  }
  if (format === 'jsonc') {
    notes.push('JSONC: комментарии сохраняются в тексте, но не являются узлами дерева и теряются при конвертации.');
  }
  return {
    ok: true,
    format,
    nodes: built.nodes,
    truncated: built.truncated,
    bigNumbers: built.bigNumbers,
    exact: true,
    notes,
  };
}

/** Trailing comma / comment / single quote near the failure → concrete offers. */
function suggestFor(text: string, format: 'json' | 'jsonc'): ParseSuggestion[] {
  const out: ParseSuggestion[] = [];
  const trailingComma = /,\s*[}\]]/.test(text);
  const comments = /(^|[^:"])\/\//.test(text) || text.includes('/*');
  const singleQuotes = /'[^']*'\s*:/.test(text);

  if (format === 'json' && (trailingComma || comments)) {
    out.push({ id: 'jsonc', label: 'Разобрать как JSONC (комментарии, висячие запятые)' });
  }
  if (trailingComma || singleQuotes) {
    out.push({ id: 'json5', label: 'Разобрать как JSON5 (кавычки, запятые, hex)' });
  }
  if (format === 'jsonc') {
    out.push({ id: 'json', label: 'Разобрать как строгий JSON' });
  }
  if (out.length === 0) {
    out.push({ id: 'json5', label: 'Попробовать JSON5' });
  }
  return out;
}

/* ---------------------------------- JSON5 -------------------------------- */

async function parseJson5(text: string): Promise<ParseResult> {
  const JSON5 = (await import('json5')).default;
  const lineStarts = lineStartsOf(text);
  try {
    const value: unknown = JSON5.parse(text);
    const built = buildTreeFromValue(value);
    return {
      ok: true,
      format: 'json5',
      nodes: built.nodes,
      truncated: built.truncated,
      bigNumbers: built.bigNumbers,
      // JSON5 hands back plain JS values with no offsets, so we cannot show a
      // number's original spelling. Say so rather than pretend (design §6.3).
      exact: false,
      notes: [
        'JSON5: парсер отдаёт готовые значения без позиций в исходнике, поэтому исходное написание больших чисел показать нельзя — они уже прошли через double.',
        ...(built.truncated ? ['Документ слишком большой: дерево построено частично.'] : []),
      ],
    };
  } catch (err) {
    const e = err as { lineNumber?: number; columnNumber?: number; message?: string };
    const line = e.lineNumber ?? 1;
    const column = e.columnNumber ?? 1;
    void lineStarts;
    return {
      ok: false,
      message: e.message ?? 'JSON5: ошибка разбора',
      line,
      column,
      suggestions: [{ id: 'json', label: 'Разобрать как строгий JSON' }],
      partial: null,
    };
  }
}

/* ---------------------------------- YAML --------------------------------- */

async function parseYaml(text: string): Promise<ParseResult> {
  const YAML = await import('yaml');
  const notes: string[] = [];
  const doc = YAML.parseDocument(text);
  const fatal = doc.errors[0];
  if (fatal) {
    const pos = fatal.linePos?.[0];
    return {
      ok: false,
      message: `YAML: ${fatal.message}`,
      line: pos?.line ?? 1,
      column: pos?.col ?? 1,
      suggestions: [],
      partial: null,
    };
  }
  for (const w of doc.warnings) notes.push(`YAML: ${w.message}`);

  let value: unknown;
  try {
    // `maxAliasCount` is the billion-laughs guard: a recursive anchor would
    // otherwise expand until the tab dies (design §4.6). It belongs to toJS(),
    // which is where the aliases are actually resolved.
    value = doc.toJS({ maxAliasCount: 100 });
  } catch (err) {
    return {
      ok: false,
      message: `YAML: ${(err as Error).message}. Обычно это рекурсивный якорь (&a … *a) — разворачивать его бесконечно мы не будем.`,
      line: 1,
      column: 1,
      suggestions: [],
      partial: null,
    };
  }

  const built = buildTreeFromValue(value);
  notes.push(
    'YAML: якоря и алиасы развёрнуты в значения. Комментарии YAML не переносятся в дерево.',
  );
  return {
    ok: true,
    format: 'yaml',
    nodes: built.nodes,
    truncated: built.truncated,
    bigNumbers: built.bigNumbers,
    exact: false,
    notes,
  };
}

/* ----------------------------------- CSV --------------------------------- */

const DELIM_MAP: Record<string, string> = {
  comma: ',',
  semicolon: ';',
  tab: '\t',
};

async function parseCsv(text: string, delimiterPref?: string): Promise<ParseResult> {
  const Papa = (await import('papaparse')).default;
  const chosen =
    delimiterPref && delimiterPref !== 'auto'
      ? (DELIM_MAP[delimiterPref] ?? ',')
      : (sniffDelimiter(text) ?? '');

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    delimiter: chosen, // '' → papaparse autodetects
  });

  const notes: string[] = [];
  const delim = result.meta.delimiter === '\t' ? 'Tab' : result.meta.delimiter;
  const columns = result.meta.fields ?? [];
  notes.push(
    `CSV: разделитель «${delim}», колонок ${columns.length}. Автоопределение может ошибиться на данных с разделителем внутри кавычек — смените его в шапке.`,
  );

  const mismatches = result.errors.filter((e) => e.type === 'FieldMismatch');
  if (mismatches.length > 0) {
    const rows = mismatches
      .slice(0, 5)
      .map((e) => e.row)
      .filter((r): r is number => typeof r === 'number')
      .map((r) => r + 2); // +1 for the header, +1 for 1-based
    notes.push(
      `CSV: в ${mismatches.length} строк(ах) число полей не совпадает с заголовком (строки: ${rows.join(', ')}${mismatches.length > 5 ? ' …' : ''}).`,
    );
  }

  const fatal = result.errors.find((e) => e.type === 'Delimiter' || e.type === 'Quotes');
  if (fatal && result.data.length === 0) {
    return {
      ok: false,
      message: `CSV: ${fatal.message}`,
      line: (fatal.row ?? 0) + 1,
      column: 1,
      suggestions: [],
      partial: null,
    };
  }

  const built = buildTreeFromValue(result.data);
  notes.push(
    'CSV показан как массив объектов (одна строка = один объект). Типы не выводятся: каждая ячейка — строка.',
  );
  return {
    ok: true,
    format: 'csv',
    nodes: built.nodes,
    truncated: built.truncated,
    bigNumbers: false,
    exact: false,
    notes,
  };
}

/* --------------------------------- shared -------------------------------- */

/**
 * Offset → line/column. The column is counted in CODE POINTS, not UTF-16 code
 * units, because the user is looking at characters, not at surrogate pairs
 * (design §5.4).
 */
export function positionOf(
  text: string,
  lineStarts: Int32Array,
  offset: number,
): { line: number; column: number } {
  const line = lineOf(lineStarts, offset);
  const start = lineStarts[line - 1] ?? 0;
  const prefix = text.slice(start, offset);
  // Array.from() iterates code points; `.length` would count surrogate halves.
  const column = Array.from(prefix).length + 1;
  return { line, column };
}
