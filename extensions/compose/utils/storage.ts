import { storage } from '#imports';
import type { Draft, Settings, Snapshot, Template } from './types';
import { DEFAULT_SETTINGS } from './types';
import { BUILTIN_TEMPLATES } from './mock';

// Storage layout (design §1.4). The sync/local split is a HARD requirement:
//   - `sync`  : lightweight prefs ONLY. Quotas are HARD failures on exceed
//               (102,400 bytes total / 8,192 PER ITEM / 512 items).
//   - `local` : drafts, history, templates. 10 MB, no per-item cap.
//   - `session`: the unsaved buffer — survives service-worker death, not a
//               browser restart.
//
// ⚠️ DRAFTS GO IN `local:`, NEVER `sync:`. A long bug report trivially exceeds
// the 8 KB per-item sync cap; `setValue` then rejects and the text is silently
// lost while the UI still shows it "saved". This is the exact bug `blur` hit
// with sync (PLAN.md §18a) — do not "optimize" drafts into sync. Cross-device
// transfer is handled by Export .md / Import, not sync.
//
// Prefs (theme, default target, translit standard, editor settings) are a small
// fixed-shape object and DO go in `sync:` so they follow the user across devices.
//
// `version` + `migrations` are declared from day one so the schema can evolve
// without wiping user data on update.

/* ── Prefs → sync: ─────────────────────────────────────────────────────────*/
export const settingsItem = storage.defineItem<Settings>('sync:settings', {
  fallback: DEFAULT_SETTINGS,
  version: 1,
  migrations: {
    // Populate as the settings schema changes, e.g. `2: (old) => ({ ...old })`.
  },
});

/* ── Drafts, active pointer, history, templates → local: ───────────────────*/
export const draftsItem = storage.defineItem<Draft[]>('local:drafts', {
  fallback: [],
  version: 1,
  migrations: {},
});

export const activeDraftIdItem = storage.defineItem<string | null>(
  'local:activeDraftId',
  { fallback: null, version: 1, migrations: {} },
);

export const historyItem = storage.defineItem<Snapshot[]>('local:history', {
  fallback: [],
  version: 1,
  migrations: {},
});

export const templatesItem = storage.defineItem<Template[]>('local:templates', {
  fallback: BUILTIN_TEMPLATES,
  version: 1,
  migrations: {},
});

/* ── Unsaved buffer → session: (design §8.3) ───────────────────────────────*/
export const unsavedBufferItem = storage.defineItem<
  { draftId: string; body: string; at: number } | null
>('session:unsaved', { fallback: null, version: 1, migrations: {} });

/**
 * Serialize a draft read-modify-write across EVERY extension context — the
 * side panel / workbench documents AND the background service worker (context
 * menu appends into the active draft). A module-level queue only orders writes
 * inside one document; two contexts each doing get→modify→set can still
 * interleave and clobber. The Web Locks API is shared process-wide for the
 * extension origin, so one named lock makes those RMWs mutually exclusive —
 * exactly the pattern `blur/utils/storage.ts` uses. Falls back to running
 * directly where `navigator.locks` is unavailable.
 */
const DRAFTS_LOCK = 'compose-drafts';

export function withDraftsLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks?.request) return fn();
  return locks.request(DRAFTS_LOCK, fn);
}
