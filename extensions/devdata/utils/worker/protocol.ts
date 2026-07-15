// The Worker wire protocol. Shared by the client (tool page) and the Worker.
//
// The Worker is STATELESS: every job carries everything it needs. That is a
// deliberate consequence of the cancellation strategy — `worker.terminate()` is
// the ONLY way to stop a runaway JS loop (a catastrophic-backtracking `pattern`
// in a JSON Schema, a pathological CSV), so a worker must be disposable at any
// moment (design §8). A worker that held the parsed document would make
// terminating it expensive, and we would be tempted not to.

import type { FlatNode } from '../core/tree';
import type { ParseFormat, ParseResult } from '../core/parse';
import type { ConversionWarning } from '../core/serialize';
import type { IndentPref } from '../core/serialize';

/** Where a job gets its tree from. XML never comes as `text`: DOMParser does not
 *  exist in a Worker, so the main thread parses XML and passes the nodes. */
export type Source =
  | { kind: 'text'; text: string; format: ParseFormat; csvDelimiter?: string }
  | { kind: 'nodes'; nodes: FlatNode[] };

export type TargetFormat = 'json' | 'json5' | 'jsonc' | 'yaml' | 'xml' | 'csv';

export type SchemaDraft = '2020-12' | '2019-09' | '7' | '4';

export type JobRequest =
  | {
      op: 'parse';
      text: string;
      format: ParseFormat;
      csvDelimiter?: string;
      /** When true, the Worker may fall back JSON→JSONC→JSON5 on a strict-parse
       *  failure (the main-thread detector only sniffed lexically — B1). */
      autodetected?: boolean;
    }
  | {
      op: 'convert';
      source: Source;
      from: TargetFormat;
      to: TargetFormat;
      indent: IndentPref;
      sortKeys: boolean;
      csvBom: boolean;
      csvDelimiter?: string;
    }
  | {
      op: 'validate';
      source: Source;
      schemaText: string;
      draft: SchemaDraft;
      checkFormats: boolean;
    };

export interface ParseResponse {
  op: 'parse';
  result: ParseResult;
  /** Line-start offsets, transferred (not copied) as an Int32Array. */
  lineStarts: Int32Array;
  lines: number;
  bytes: number;
}

export interface ConvertResponse {
  op: 'convert';
  text: string;
  warnings: ConversionWarning[];
  /** Real JSONPaths to arrays-of-objects, when CSV cannot take the whole doc. */
  candidates: string[];
  /** True when the target simply does not fit the document (CSV on a tree). */
  refused: boolean;
  refusal: string | null;
}

export interface SchemaIssue {
  instancePath: string;
  message: string;
  schemaPath: string;
}

export interface ValidateResponse {
  op: 'validate';
  valid: boolean;
  errors: SchemaIssue[];
  /** Non-fatal honesty notes (what was NOT checked). */
  notes: string[];
}

export type JobResponse = ParseResponse | ConvertResponse | ValidateResponse;

export type WorkerMessage =
  | { type: 'result'; id: number; payload: JobResponse }
  | { type: 'error'; id: number; message: string }
  | { type: 'progress'; id: number; done: number; total: number };
