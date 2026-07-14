import { MOCK, mockAsync, todoLogic } from '@blur/ui';
import { MOCK_SCHEMA_ERRORS } from './mock-data';
import type { SchemaError } from './types';
import type { SchemaDraftPref } from './storage';

// JSON Schema validation — STUBBED on mocks for the scaffold phase.
//
// Validator (design §2.8, §10.2): `@cfworker/json-schema` — NOT ajv. ajv builds
// validators with `new Function()`, which MV3 CSP forbids; @cfworker evaluates
// the schema without codegen. Consequences to surface honestly (design §4.5):
//   - external `$ref` (https URL) → EXPLICIT error, not a silent skip (no network).
//   - `format:` is an annotation, checked only when the pref is on.
//   - run in a Worker with a 5s timeout → `worker.terminate()` on a runaway
//     `pattern` (ReDoS), with an honest "validation was cancelled" message.

export interface SchemaValidation {
  valid: boolean;
  errors: SchemaError[];
}

/** Validate `dataText` against `schemaText`. Stubbed. */
export async function validateSchema(
  dataText: string,
  schemaText: string,
  draft: SchemaDraftPref,
): Promise<SchemaValidation> {
  if (!MOCK) {
    // TODO_LOGIC: devdata — validate via @cfworker/json-schema in a Worker with
    // a 5s timeout; map errors to { instancePath, message, schemaPath }; reject
    // external $ref with an explicit message (design §4.5).
    throw todoLogic('devdata: validate JSON Schema');
  }
  void dataText;
  void draft;
  if (schemaText.trim() === '') {
    return mockAsync({ valid: true, errors: [] }, 200);
  }
  // Exercise the loading + Cancel state (design §5.1) against mock errors.
  return mockAsync({ valid: false, errors: MOCK_SCHEMA_ERRORS }, 700);
}
