import { storage } from '#imports';
import type { Locale } from '@blur/ui';
import {
  AUTOSAVE_ID,
  EMPTY_INDEX,
  INDEX_VERSION,
  normalizeSession,
  toMeta,
  type SavedSession,
  type SessionIndex,
  type SessionMeta,
} from './model';

// Storage layer (PLAN.md §14.4). Two concerns live here, kept apart:
//
//   1. PREFERENCES — theme, locale, and a handful of behaviour toggles. Never data
//      ABOUT the user; local only, never `sync`.
//   2. SESSION DATA — the `idx` pointer + one `sess:<id>` key per session, plus a
//      rolling `sess:autosave`. This is the fault-tolerant model from §14.4:
//        • write the session key FIRST, flip the `idx` pointer LAST → a crash
//          mid-write leaves an orphan key, never a dangling index entry;
//        • per-key storage means saving one session never rewrites the others
//          (the ~10 MB quota is spent on data, not on rewrite churn);
//        • every read is validated (normalizeSession); a corrupt key is QUARANTINED
//          (renamed out of the way) rather than deleted or allowed to crash the list
//          — the direct answer to Session Buddy v4's data loss.
//
// The IP/analytics-style guards from whoami don't apply (there is no network half);
// the guarantee here is instead "no user data is ever lost to a bad write or a bad
// read", enforced by the write-order and the quarantine path below.

/* ========================================================================== */
/* Preferences                                                                 */
/* ========================================================================== */

export type Theme = 'auto' | 'light' | 'dark';

export interface SessionSaverSettings {
  theme: Theme;
  /** MV3 event-driven auto-save + heartbeat into `sess:autosave` (design §14.5). */
  autoSaveEnabled: boolean;
  /** Restore tabs unloaded (discarded / suspended placeholder) to avoid a resource
   *  spike on large sessions (design §14.3). */
  lazyRestore: boolean;
  /** Drop duplicate URLs per window when saving (design §14). */
  dedupeOnSave: boolean;
  /** Attempt to restore tab-group name/colour (needs optional `tabGroups`). */
  restoreGroups: boolean;
}

export const DEFAULT_SETTINGS: SessionSaverSettings = {
  theme: 'auto',
  autoSaveEnabled: true,
  lazyRestore: true,
  dedupeOnSave: true,
  restoreGroups: true,
};

export const SETTINGS_KEYS = [
  'theme',
  'autoSaveEnabled',
  'lazyRestore',
  'dedupeOnSave',
  'restoreGroups',
] as const satisfies readonly (keyof SessionSaverSettings)[];

/** Defensive read — storage.local can be corrupt or from an older build. Every
 *  field is validated against its type and falls back to the default. */
export function normalizeSettings(raw: unknown): SessionSaverSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown, f: boolean) => (typeof v === 'boolean' ? v : f);
  const theme: Theme =
    r.theme === 'light' || r.theme === 'dark' || r.theme === 'auto' ? r.theme : DEFAULT_SETTINGS.theme;
  return {
    theme,
    autoSaveEnabled: bool(r.autoSaveEnabled, DEFAULT_SETTINGS.autoSaveEnabled),
    lazyRestore: bool(r.lazyRestore, DEFAULT_SETTINGS.lazyRestore),
    dedupeOnSave: bool(r.dedupeOnSave, DEFAULT_SETTINGS.dedupeOnSave),
    restoreGroups: bool(r.restoreGroups, DEFAULT_SETTINGS.restoreGroups),
  };
}

export const settingsItem = storage.defineItem<SessionSaverSettings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
  version: 1,
});

/** Runtime UI language, in its own item (house pattern from whoami). Default EN. */
export const localeItem = storage.defineItem<Locale>('local:locale', { fallback: 'en' });

/* ========================================================================== */
/* Session data — keys                                                         */
/* ========================================================================== */

const INDEX_KEY = 'local:idx' as const;
const SESS_PREFIX = 'sess:';
const QUAR_PREFIX = 'quar:';

type LocalKey = `local:${string}`;

function sessKey(id: string): LocalKey {
  return `local:${SESS_PREFIX}${id}`;
}
function quarKey(id: string): LocalKey {
  return `local:${QUAR_PREFIX}${id}${'-'}${Date.now()}`;
}

/* ---- Index -------------------------------------------------------------- */

function normalizeIndex(raw: unknown): SessionIndex {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_INDEX };
  const r = raw as Record<string, unknown>;
  const order = Array.isArray(r.order) ? r.order : [];
  const clean: SessionMeta[] = [];
  for (const m of order) {
    if (typeof m !== 'object' || m === null) continue;
    const mm = m as Record<string, unknown>;
    if (typeof mm.id !== 'string' || !mm.id) continue;
    clean.push({
      id: mm.id,
      name: typeof mm.name === 'string' ? mm.name : mm.id,
      createdAt: typeof mm.createdAt === 'number' ? mm.createdAt : Date.now(),
      updatedAt: typeof mm.updatedAt === 'number' ? mm.updatedAt : Date.now(),
      kind: mm.kind === 'autosave' ? 'autosave' : 'manual',
      tabCount: typeof mm.tabCount === 'number' ? mm.tabCount : 0,
      windowCount: typeof mm.windowCount === 'number' ? mm.windowCount : 0,
      bytes: typeof mm.bytes === 'number' ? mm.bytes : 0,
    });
  }
  return { version: INDEX_VERSION, order: clean };
}

export async function readIndex(): Promise<SessionIndex> {
  try {
    return normalizeIndex(await storage.getItem(INDEX_KEY));
  } catch {
    // A failed read must not brick the UI — start from an empty index.
    return { ...EMPTY_INDEX };
  }
}

async function writeIndex(index: SessionIndex): Promise<void> {
  await storage.setItem(INDEX_KEY, index);
}

/* ---- Read a single session (with quarantine) ---------------------------- */

/**
 * Read and validate one manual session. On corruption the key is QUARANTINED
 * (moved to `quar:<id>-<ts>` and dropped from the index) and `null` is returned —
 * the rest of the list is untouched. Never throws.
 */
export async function readSession(id: string): Promise<SavedSession | null> {
  let raw: unknown;
  try {
    raw = await storage.getItem(sessKey(id));
  } catch {
    return null;
  }
  const session = normalizeSession(raw, id);
  if (session) return session;
  if (raw != null) {
    // There was SOMETHING there but it did not validate — preserve it out of the
    // way (don't destroy possibly-recoverable bytes) and unlink it from the index.
    await quarantine(id, raw);
  } else {
    await unlinkFromIndex(id);
  }
  return null;
}

async function quarantine(id: string, raw: unknown): Promise<void> {
  try {
    await storage.setItem(quarKey(id), raw);
  } catch {
    // If even the quarantine write fails (quota), we still unlink so the list works.
  }
  try {
    await storage.removeItem(sessKey(id));
  } catch {
    /* best effort */
  }
  await unlinkFromIndex(id);
}

async function unlinkFromIndex(id: string): Promise<void> {
  const index = await readIndex();
  const order = index.order.filter((m) => m.id !== id);
  if (order.length !== index.order.length) await writeIndex({ ...index, order });
}

/* ---- Save (atomic-ish commit) ------------------------------------------- */

/**
 * Persist a manual session. 🔴 ORDER MATTERS (design §14.4): the `sess:<id>` key is
 * written FIRST and fully; only then is the `idx` pointer updated to reference it.
 * A crash between the two leaves an orphan key (harmless, swept later), never an
 * index entry pointing at missing/half-written data.
 */
export async function saveSession(session: SavedSession): Promise<void> {
  await storage.setItem(sessKey(session.id), session); // 1. data first
  const index = await readIndex();
  const meta = toMeta(session);
  const existing = index.order.findIndex((m) => m.id === session.id);
  const order = index.order.slice();
  if (existing >= 0) order[existing] = meta;
  else order.unshift(meta); // newest first
  await writeIndex({ ...index, order }); // 2. flip the pointer last
}

export async function renameSession(id: string, name: string): Promise<SavedSession | null> {
  const session = await readSession(id);
  if (!session) return null;
  const updated: SavedSession = { ...session, name: name.slice(0, 200), updatedAt: Date.now() };
  await saveSession(updated);
  return updated;
}

/**
 * Delete a manual session: unlink from the index FIRST (so it vanishes from the UI
 * even if the key removal fails), then remove the data key. The manager keeps the
 * in-memory copy for UNDO and re-`saveSession`s it if the user reverts.
 */
export async function deleteSession(id: string): Promise<void> {
  await unlinkFromIndex(id);
  try {
    await storage.removeItem(sessKey(id));
  } catch {
    /* the index no longer references it; a stray key is swept later */
  }
}

/* ---- Autosave (rolling, separate from the index) ------------------------ */

const AUTOSAVE_KEY = sessKey(AUTOSAVE_ID);

export async function writeAutosave(session: SavedSession): Promise<void> {
  await storage.setItem(AUTOSAVE_KEY, { ...session, id: AUTOSAVE_ID, kind: 'autosave' as const });
}

export async function readAutosave(): Promise<SavedSession | null> {
  let raw: unknown;
  try {
    raw = await storage.getItem(AUTOSAVE_KEY);
  } catch {
    return null;
  }
  return normalizeSession(raw, AUTOSAVE_ID);
}

export async function clearAutosave(): Promise<void> {
  try {
    await storage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* best effort */
  }
}

/* ---- Maintenance -------------------------------------------------------- */

/** Sweep `sess:*` keys that the index no longer references (orphans from an
 *  interrupted write). Safe to run on startup: it only removes keys nothing points
 *  at, and never touches the autosave key. */
export async function sweepOrphans(): Promise<number> {
  let snapshot: Record<string, unknown>;
  try {
    snapshot = await storage.snapshot('local');
  } catch {
    return 0;
  }
  const index = await readIndex();
  const referenced = new Set(index.order.map((m) => sessKey(m.id).slice('local:'.length)));
  referenced.add(`${SESS_PREFIX}${AUTOSAVE_ID}`);
  const kill: LocalKey[] = [];
  for (const key of Object.keys(snapshot)) {
    if (key.startsWith(SESS_PREFIX) && !referenced.has(key)) {
      kill.push(`local:${key}`);
    }
  }
  if (kill.length) {
    try {
      await storage.removeItems(kill);
    } catch {
      /* best effort */
    }
  }
  return kill.length;
}

/** Rough storage usage against the ~10 MB `storage.local` cap, for the quota
 *  indicator and the `unlimitedStorage` upgrade prompt (design §14.4). */
export async function estimateUsage(): Promise<{ bytes: number; quota: number }> {
  const quota = 10 * 1024 * 1024;
  try {
    const snapshot = await storage.snapshot('local');
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
    return { bytes, quota };
  } catch {
    return { bytes: 0, quota };
  }
}
