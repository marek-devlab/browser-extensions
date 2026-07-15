import { storage } from '#imports';
import type { Locale } from '@blur/ui';

// Storage layout. The sync/local split is a HARD requirement in this repo:
//   - `sync`  : lightweight UI prefs only. Quotas are HARD failures on exceed
//               (102,400 bytes total / 8,192 per item / 512 items). The 8 KB
//               per-item cap silently shredded data in `blur` (PLAN.md §18a),
//               so anything that could ever exceed it goes to `local` instead.
//   - `local` : cached document + schema text. ~10 MB, no per-item cap.
//
// `DevdataPrefs` is a flat object of ~15 boolean/enum fields (~300 bytes) — it
// fits `sync` with huge margin. The last document (up to 1 MB) and the last
// schema text (up to 256 KB) can obviously blow the sync per-item cap, so they
// live in `local`.
//
// NEVER persisted, at any setting (design §7.2): the JWT token, the HS256
// secret, and the public key. Those live ONLY in React state (RAM) on the JWT
// tab and have no storage item here by design — that is an architectural
// invariant, not a "remember not to". The JWT tab must never feed `local:document`.
//
// `version` + `migrations` are declared from day one so the schema can evolve
// without wiping user data on update.

export type Theme = 'auto' | 'light' | 'dark';
export type ToolTab = 'data' | 'jwt' | 'schema';
export type IndentPref = '2' | '4' | 'tab' | 'min';
export type FormatPref =
  | 'auto'
  | 'json'
  | 'json5'
  | 'jsonc'
  | 'yaml'
  | 'xml'
  | 'csv';
export type CsvDelimiterPref = 'comma' | 'semicolon' | 'tab' | 'auto';
export type SchemaDraftPref = '2020-12' | '2019-09' | '7' | '4';

export interface DevdataPrefs {
  // --- View ---
  theme: Theme;
  /** Which tab the tool page opens on. */
  defaultTab: ToolTab;
  indent: IndentPref;
  wrap: boolean;
  lineNumbers: boolean;
  // --- Parse ---
  defaultFormat: FormatPref;
  sortKeys: boolean;
  /** 0..5 — how deep the tree auto-expands on load. */
  expandDepth: number;
  /** Use JSON.parse source access for exact big numbers (design §5.6). */
  exactNumbers: boolean;
  csvDelimiter: CsvDelimiterPref;
  csvBom: boolean;
  // --- Schema ---
  schemaDraft: SchemaDraftPref;
  schemaFormats: boolean;
  // --- Storage ---
  /** Whether to write `local:document` at all. */
  restore: boolean;
  // --- Page formatting ---
  /**
   * INTENT to auto-format JSON pages. This is separate from whether the
   * `<all_urls>` permission is actually granted — the UI must always show the
   * PERMISSION FACT (`permissions.contains`), and use this only to offer
   * "you asked for this on another device — grant it here?" (design §3, §8).
   */
  autoFormat: boolean;
}

export const DEFAULT_PREFS: DevdataPrefs = {
  theme: 'auto',
  defaultTab: 'data',
  indent: '2',
  wrap: true,
  lineNumbers: true,
  defaultFormat: 'auto',
  sortKeys: false,
  expandDepth: 2,
  exactNumbers: true,
  csvDelimiter: 'auto',
  csvBom: true,
  schemaDraft: '2020-12',
  schemaFormats: false,
  restore: true,
  autoFormat: false,
};

/** Runtime UI language. English by default, independent of the browser locale.
 *  Persisted separately from `prefs` so the non-React surfaces (background,
 *  content script) can read just the locale without loading the whole prefs blob. */
export const localeItem = storage.defineItem<Locale>('local:locale', { fallback: 'en' });

export const prefsItem = storage.defineItem<DevdataPrefs>('sync:prefs', {
  fallback: DEFAULT_PREFS,
  version: 1,
  migrations: {
    // Populate as the prefs schema evolves, e.g. `2: (old) => ({ ...old })`.
  },
});

/** A parsed document cached for "restore last document". Never larger than 1 MB
 *  (design §3, §8) — larger docs are intentionally NOT saved and the UI says so.
 *  JWT-tab content is NEVER stored here. */
export interface CachedDocument {
  /** Raw source text, as typed/dropped. */
  text: string;
  /** Detected/overridden format at save time. */
  format: FormatPref;
  /** Byte length, so the UI can warn before rehydrating a big doc. */
  bytes: number;
  /** Original file name, if the doc came from a dropped file. */
  name: string | null;
  savedAt: number;
}

export const documentItem = storage.defineItem<CachedDocument | null>(
  'local:document',
  {
    fallback: null,
    version: 1,
    migrations: {},
  },
);

/** Last JSON Schema text, cached only when "restore" is on. ≤256 KB (design §3). */
export const schemaItem = storage.defineItem<string | null>('local:schema', {
  fallback: null,
  version: 1,
  migrations: {},
});

/** Hard cap: documents larger than this are not persisted (design §3, §8). */
export const MAX_PERSIST_BYTES = 1_000_000;

/** Hard cap for the cached schema text (design §3). */
export const MAX_SCHEMA_BYTES = 256_000;

export type SaveOutcome =
  | { status: 'saved' }
  | { status: 'skipped-off' }
  | { status: 'skipped-too-big'; bytes: number }
  | { status: 'failed'; message: string };

/**
 * Persist the current document — or explain, out loud, why it was not persisted.
 *
 * Three ways this goes wrong, and all three are USER-VISIBLE rather than silent
 * (design §8; the `blur` bug in PLAN.md §18a was precisely a storage write that
 * failed in silence):
 *   - the user turned "restore" off        → skipped-off
 *   - the document is over 1 MB            → skipped-too-big (we SAY so)
 *   - storage.local is full (QUOTA_BYTES)  → failed, with the browser's message
 */
export async function saveDocument(
  doc: CachedDocument,
  restore: boolean,
): Promise<SaveOutcome> {
  if (!restore) return { status: 'skipped-off' };
  if (doc.bytes > MAX_PERSIST_BYTES) {
    return { status: 'skipped-too-big', bytes: doc.bytes };
  }
  try {
    await documentItem.setValue(doc);
    return { status: 'saved' };
  } catch (err) {
    return {
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function saveSchema(text: string, restore: boolean): Promise<SaveOutcome> {
  if (!restore) return { status: 'skipped-off' };
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_SCHEMA_BYTES) return { status: 'skipped-too-big', bytes };
  try {
    await schemaItem.setValue(text);
    return { status: 'saved' };
  } catch (err) {
    return {
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
