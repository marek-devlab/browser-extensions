// JSON Schema validation (design §2.8, §4.5).
//
// Validator: `@cfworker/json-schema` — NOT ajv. ajv compiles schemas with
// `new Function()`, which MV3's CSP forbids outright; there is no flag, no
// workaround, and a manifest `sandbox` page (the usual escape hatch) does not
// exist in Firefox (design §10.2). @cfworker evaluates the schema instead of
// generating code, so it runs under the strict CSP unchanged.
//
// The validation itself runs in the Worker with a 5 s budget: a schema is
// user-supplied, and a `pattern` with catastrophic backtracking is a ReDoS that
// no amount of care in *our* code prevents. `terminate()` is the only cure
// (utils/worker/client.ts).

import { runJob, type RunningJob } from './worker/client';
import { sourceOf } from './format';
import type { ValidateResponse } from './worker/protocol';
import type { DevdataPrefs } from './storage';
import type { ParsedDoc, SchemaIssue } from './types';

export interface SchemaValidation {
  valid: boolean;
  errors: SchemaIssue[];
  /** What was and was NOT checked — shown, never assumed (design §4.5). */
  notes: string[];
}

export function validateSchema(
  doc: ParsedDoc,
  schemaText: string,
  prefs: DevdataPrefs,
): RunningJob<SchemaValidation> {
  const job = runJob<ValidateResponse>({
    op: 'validate',
    source: sourceOf(doc, prefs),
    schemaText,
    draft: prefs.schemaDraft,
    checkFormats: prefs.schemaFormats,
  });

  const promise = job.promise.then(
    (r): SchemaValidation => ({ valid: r.valid, errors: r.errors, notes: r.notes }),
  );
  return { promise, cancel: job.cancel };
}
