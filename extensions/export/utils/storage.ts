import { storage } from '#imports';
import type { ExportPrefs } from './types';

// Storage layout.
//   - `local` : the small, scalar preference object below (delimiter, encoding,
//               formula-guard mode, filename template, default format, theme).
//               Design §3 is emphatic — "sync — never": the per-item sync cap
//               (8,192 bytes) silently DROPS data the moment any field grows into
//               a list, and we refuse to build a storage layout that can lose a
//               user's settings without an error. Everything therefore lives in
//               `local`, and any future growable list (filename history, per-site
//               defaults) lands here too.
//
// This extension keeps NO large or per-site state — table content is built and
// discarded in the page (design §0/§8.4), never persisted.
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
  linksInCells: 'text',
  parseNumbers: true,
  parseDates: false, // ⚠️ off on purpose: `05.06` is unresolvable (design §3).
  visibleRowsOnly: true,
  filenameTemplate: '{host}-{caption}-{date}',
  filenameTranslit: true,
  alwaysPreview: true,
  theme: 'auto',
};

export const prefsItem = storage.defineItem<ExportPrefs>('local:prefs', {
  fallback: DEFAULT_PREFS,
  version: 2,
  migrations: {
    // v2 added `linksInCells` (design §6.6). Existing users keep every other value.
    2: (old: Partial<ExportPrefs>): ExportPrefs => ({
      ...DEFAULT_PREFS,
      ...old,
      linksInCells: old.linksInCells ?? 'text',
    }),
  },
});
