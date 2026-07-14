import { storage } from '#imports';
import type { ExportPrefs } from './types';

// Storage layout.
//   - `sync`  : the small, scalar preference object below. Every field is a
//               scalar or a short string (delimiter, encoding, formula-guard mode,
//               filename template, default format, theme), so the whole object is
//               well under the sync per-item cap (8,192 bytes). Roaming these
//               defaults across a user's devices is the right behaviour for
//               "settings I don't want to re-pick".
//   - `local`: reserved. This extension keeps NO large or per-site state — table
//              content is built and discarded in the page (design §0/§8.4), never
//              persisted. If a future feature needs a growable list (filename
//              history, per-site defaults), it MUST land here, not in sync
//              (design §3 is emphatic: growable lists in sync silently drop data).
//
// ⚠️ NOTE / open decision: design §3 argues for `local` for EVERYTHING and
// "sync — never". This scaffold follows the build brief (small prefs in sync) and
// keeps the growable-list door explicitly closed above. Revisit before release if
// any of these fields becomes a list.
//
// `version` + `migrations` are declared from day one so the schema can evolve
// without wiping user data on update.

export const DEFAULT_PREFS: ExportPrefs = {
  // 🔴 xlsx is the recommended default: it is formula-immune (a string cell can
  // never become a formula — design §8.3) and preserves number/date types, unlike
  // CSV where Excel re-guesses everything (design §6.5 / §7.10).
  defaultTableFormat: 'xlsx',
  defaultTextFormat: 'md',
  csvDelimiter: 'auto',
  csvEncoding: 'utf8-bom', // ⚠️ BOM mandatory or Excel mangles Cyrillic (PLAN-2 §3.2).
  csvEol: 'crlf',
  csvFormulaGuard: 'escape', // 🔴 default guard on (design §8.3).
  csvSepLine: false,
  mergedCells: 'duplicate',
  parseNumbers: true,
  parseDates: false, // ⚠️ off on purpose: `05.06` is unresolvable (design §3).
  visibleRowsOnly: true,
  filenameTemplate: '{host}-{caption}-{date}',
  filenameTranslit: true,
  alwaysPreview: true,
  theme: 'auto',
};

export const prefsItem = storage.defineItem<ExportPrefs>('sync:prefs', {
  fallback: DEFAULT_PREFS,
  version: 1,
  migrations: {
    // Populate as the prefs schema changes, e.g. `2: (old) => ({ ...old })`.
  },
});
