/// <reference lib="webworker" />

// The document Worker. Everything expensive or attacker-controlled happens here
// and NOWHERE else (design §8):
//
//   - parsing multi-megabyte documents,
//   - converting them,
//   - running a JSON Schema whose `pattern` may be a ReDoS bomb.
//
// The main thread stays responsive because it is never the one looping. When a
// job overruns its budget the client calls `terminate()` on this worker — the
// only reliable way to interrupt JavaScript — and tells the user why.
//
// This file must not import anything DOM-shaped: `DOMParser`/`XMLSerializer` do
// not exist here (XML is handled on the main thread and arrives pre-parsed as
// nodes, see protocol.ts).

import { lineStartsOf, pathOf, toValue, type FlatNode } from '../core/tree';
import { parseText, type ParseFormat } from '../core/parse';
import {
  commentLossWarning,
  emitJson,
  emitXml,
  indentString,
  shapeForCsv,
  yamlWarnings,
  type ConversionWarning,
} from '../core/serialize';
import type {
  ConvertResponse,
  JobRequest,
  ParseResponse,
  SchemaIssue,
  Source,
  ValidateResponse,
  WorkerMessage,
} from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<{ id: number; job: JobRequest }>) => {
  const { id, job } = event.data;
  void run(id, job);
});

async function run(id: number, job: JobRequest): Promise<void> {
  try {
    switch (job.op) {
      case 'parse': {
        const payload = await doParse(
          job.text,
          job.format,
          job.csvDelimiter,
          job.autodetected,
        );
        post({ type: 'result', id, payload }, [payload.lineStarts.buffer]);
        return;
      }
      case 'convert': {
        const payload = await doConvert(job);
        post({ type: 'result', id, payload });
        return;
      }
      case 'validate': {
        const payload = await doValidate(job);
        post({ type: 'result', id, payload });
        return;
      }
    }
  } catch (err) {
    // Nothing may escape as an unhandled rejection: a silent dead worker is the
    // blank screen the design forbids (§8).
    post({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function post(message: WorkerMessage, transfer: Transferable[] = []): void {
  ctx.postMessage(message, transfer);
}

/* --------------------------------- parse --------------------------------- */

async function doParse(
  text: string,
  format: ParseFormat,
  csvDelimiter?: string,
  autodetected?: boolean,
): Promise<ParseResponse> {
  const result = await parseText(text, format, { csvDelimiter, autodetected });
  const lineStarts = lineStartsOf(text);
  return {
    op: 'parse',
    result,
    lineStarts,
    lines: lineStarts.length,
    // The byte count the UI shows must be BYTES, not UTF-16 units — a document
    // full of Cyrillic is twice as big as `text.length` suggests.
    bytes: new TextEncoder().encode(text).length,
  };
}

/* -------------------------------- convert -------------------------------- */

async function nodesFrom(source: Source): Promise<FlatNode[]> {
  if (source.kind === 'nodes') return source.nodes;
  const parsed = await parseText(source.text, source.format, {
    csvDelimiter: source.csvDelimiter,
  });
  if (!parsed.ok) {
    throw new Error(
      `Документ не разобран (строка ${parsed.line}): ${parsed.message}`,
    );
  }
  return parsed.nodes;
}

async function doConvert(
  job: Extract<JobRequest, { op: 'convert' }>,
): Promise<ConvertResponse> {
  const nodes = await nodesFrom(job.source);
  const indent = indentString(job.indent);
  const warnings: ConversionWarning[] = [...commentLossWarning(job.from)];

  switch (job.to) {
    case 'json':
    case 'jsonc': {
      return {
        op: 'convert',
        text: emitJson(nodes, { indent, sortKeys: job.sortKeys }),
        warnings,
        candidates: [],
        refused: false,
        refusal: null,
      };
    }

    case 'json5': {
      const JSON5 = (await import('json5')).default;
      const value = toValue(nodes);
      warnings.push({
        severity: 'warn',
        message:
          'JSON5: сериализатор работает со значениями, а не с исходным текстом — числа за пределами точного целого выводятся округлёнными.',
      });
      return {
        op: 'convert',
        text: JSON5.stringify(value, null, indent === '' ? undefined : indent),
        warnings,
        candidates: [],
        refused: false,
        refusal: null,
      };
    }

    case 'yaml': {
      const YAML = await import('yaml');
      const value = toValue(nodes);
      warnings.push(...yamlWarnings(nodes));
      return {
        op: 'convert',
        text: YAML.stringify(value, {
          indent: indent === '\t' || indent === '' ? 2 : indent.length,
        }),
        warnings,
        candidates: [],
        refused: false,
        refusal: null,
      };
    }

    case 'xml': {
      const xml = emitXml(nodes, { indent: indent === '' ? '  ' : indent });
      warnings.push(...xml.warnings);
      return {
        op: 'convert',
        text: xml.text,
        warnings,
        candidates: [],
        refused: false,
        refusal: null,
      };
    }

    case 'csv': {
      const shape = shapeForCsv(nodes, (i) => pathOf(nodes, i));
      if (!shape.ok) {
        // NOT an empty CSV. An explicit refusal, with real candidate paths taken
        // from this very document (design §4.6).
        return {
          op: 'convert',
          text: '',
          warnings,
          candidates: shape.candidates,
          refused: true,
          refusal:
            'CSV — плоская таблица, а документ ею не является: в корне должен быть массив объектов. Выберите массив внутри документа.',
        };
      }
      const Papa = (await import('papaparse')).default;
      const delim =
        job.csvDelimiter === 'semicolon'
          ? ';'
          : job.csvDelimiter === 'tab'
            ? '\t'
            : ',';
      const body = Papa.unparse(shape.rows, {
        columns: shape.columns,
        delimiter: delim,
      });
      warnings.push(...shape.warnings);
      // Excel reads a BOM-less UTF-8 CSV as the local codepage and mangles
      // Cyrillic — the BOM is a pref, defaulted on (design §3).
      const text = job.csvBom ? `﻿${body}` : body;
      return {
        op: 'convert',
        text,
        warnings,
        candidates: [],
        refused: false,
        refusal: null,
      };
    }
  }
}

/* -------------------------------- validate -------------------------------- */

const EXTERNAL_REF = /^(https?:)?\/\//i;

/** Find `$ref`s pointing at the network. Iterative: a schema can be deep. */
function externalRefs(schema: unknown): string[] {
  const found: string[] = [];
  const stack: unknown[] = [schema];
  let guard = 0;
  while (stack.length > 0 && guard < 200_000) {
    guard += 1;
    const cur = stack.pop();
    if (cur === null || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
      continue;
    }
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      if (k === '$ref' && typeof v === 'string' && EXTERNAL_REF.test(v)) {
        found.push(v);
      }
      stack.push(v);
    }
  }
  return found;
}

async function doValidate(
  job: Extract<JobRequest, { op: 'validate' }>,
): Promise<ValidateResponse> {
  let schema: unknown;
  try {
    schema = JSON.parse(job.schemaText);
  } catch (err) {
    throw new Error(`Схема не является JSON: ${(err as Error).message}`);
  }

  const refs = externalRefs(schema);
  if (refs.length > 0) {
    // An explicit failure, never a silent skip (design §4.5). The extension has
    // no network at all, so this `$ref` can never be resolved — say so.
    throw new Error(
      `Внешняя ссылка ${refs[0]} не может быть загружена: у расширения нет сети вообще. Вставьте схему целиком (используйте $defs вместо внешних $ref).`,
    );
  }

  const nodes = await nodesFrom(job.source);
  const data = toValue(nodes);

  // The spec makes `format` an ANNOTATION, not an assertion, and the pref lets
  // the user say so. @cfworker asserts `format` whenever the keyword is present,
  // so honouring "off" means removing the keyword — filtering the resulting
  // errors would still let a failed `format` steer an `anyOf`/`oneOf` branch and
  // the UI would be lying about what was checked.
  const effective = job.checkFormats ? schema : stripKeyword(schema, 'format');

  const { Validator } = await import('@cfworker/json-schema');
  // @cfworker/json-schema evaluates the schema — it never codegens a validator
  // with `new Function`, which MV3's CSP forbids outright (design §10.2: this is
  // exactly why ajv is impossible here).
  const validator = new Validator(
    effective as Record<string, unknown>,
    job.draft,
    false,
  );
  const result = validator.validate(data);

  const errors: SchemaIssue[] = result.errors
    .map((e) => ({
      instancePath: pointerToPath(e.instanceLocation),
      message: e.error,
      schemaPath: e.keywordLocation,
    }))
    .slice(0, 500);

  const notes: string[] = [
    'Проверены: типы, required, enum, pattern, диапазоны, зависимости.',
    'НЕ проверены: внешние $ref (сети нет) и custom keywords.',
  ];
  notes.push(
    job.checkFormats
      ? 'format: проверяется (это аннотация по спецификации, а не ограничение — включено вами).'
      : 'format: НЕ проверяется (по спецификации это аннотация; включите в Настройках).',
  );
  if (result.errors.length > errors.length) {
    notes.push(
      `Показаны первые ${errors.length} ошибок из ${result.errors.length}.`,
    );
  }

  return { op: 'validate', valid: result.valid, errors, notes };
}

/** Deep copy of a schema with one keyword removed everywhere. Iterative. */
function stripKeyword(schema: unknown, keyword: string): unknown {
  if (schema === null || typeof schema !== 'object') return schema;

  // Explicit stack, no recursion — a hostile schema can be pathologically deep
  // and a recursive clone would overflow (same reason externalRefs above is
  // iterative). Each task copies its source into a slot on an already-created
  // parent container, so parents exist before their children are filled in.
  const root: { out: unknown } = { out: undefined };
  type Task = { src: unknown; set: (v: unknown) => void };
  const stack: Task[] = [{ src: schema, set: (v) => (root.out = v) }];
  let guard = 0;

  while (stack.length > 0) {
    if ((guard += 1) > 2_000_000) {
      // Absurdly large schema — honouring the pref is not worth an unbounded
      // walk; validate it as written rather than fail the whole run.
      return schema;
    }
    const { src, set } = stack.pop() as Task;
    if (Array.isArray(src)) {
      const arr: unknown[] = new Array(src.length);
      set(arr);
      for (let i = 0; i < src.length; i += 1) {
        const idx = i;
        stack.push({ src: src[i], set: (v) => (arr[idx] = v) });
      }
    } else if (src !== null && typeof src === 'object') {
      const out: Record<string, unknown> = {};
      set(out);
      for (const [k, val] of Object.entries(src as Record<string, unknown>)) {
        if (k === keyword && typeof val === 'string') continue;
        const key = k;
        stack.push({ src: val, set: (v) => (out[key] = v) });
      }
    } else {
      set(src);
    }
  }
  return root.out;
}

/** `#/users/1/age` → `$.users[1].age` — so schema errors speak the tree's language. */
function pointerToPath(pointer: string): string {
  const parts = pointer
    .replace(/^#/, '')
    .split('/')
    .filter((p) => p !== '');
  let out = '$';
  for (const raw of parts) {
    const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    out += /^\d+$/.test(part) ? `[${part}]` : `.${part}`;
  }
  return out;
}
