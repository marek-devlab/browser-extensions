import { storage } from '#imports';
import type { Locale } from '@blur/ui';
import type { Draft, Settings, Snapshot, Template } from './types';
import { DEFAULT_SETTINGS } from './types';
import { BUILTIN_TEMPLATES } from './templates';

// Storage layout (design §1.4).
//
// ⚠️ EVERYTHING PERSISTENT IS `local:`, NEVER `sync:`.
//   - `sync` quotas are HARD failures on exceed: 8 192 bytes PER ITEM. A long
//     bug report blows straight through that; `setValue` rejects and the text is
//     silently gone while the UI still says "saved". That is the exact bug `blur`
//     shipped (PLAN.md §18a), and it is the worst failure this extension could
//     have: it exists to hold text people are about to send to someone.
//   - Settings are small enough for `sync`, but design §1.4 keeps them in `local`
//     too, "on principle: no quota surprises". Cross-device transfer is Export /
//     Import, never cloud sync (design §11).
//
// `session:` holds the unsaved buffer — it survives a service-worker death (and
// a panel document destroyed when the sidebar closed), but not a browser restart.
//
// `version` + `migrations` are declared from day one so the schema can evolve
// without wiping user data on update.

/* ── Prefs ─────────────────────────────────────────────────────────────────*/
export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
  version: 1,
  migrations: {},
});

/** Runtime UI language (design §1.4 — `local:`, English default on fresh install,
 *  independent of the browser locale). Kept next to the drafts it labels. */
export const localeItem = storage.defineItem<Locale>('local:locale', { fallback: 'en' });

/* ── Drafts, active pointer, history, templates ────────────────────────────*/
export const draftsItem = storage.defineItem<Draft[]>('local:drafts', {
  fallback: [],
  version: 1,
  migrations: {},
});

export const activeDraftIdItem = storage.defineItem<string | null>('local:activeDraftId', {
  fallback: null,
  version: 1,
  migrations: {},
});

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

export const recentEmojiItem = storage.defineItem<string[]>('local:recentEmoji', {
  fallback: [],
  version: 1,
  migrations: {},
});

/* ── Unsaved buffer → session: (design §8.3) ───────────────────────────────*/
export const unsavedBufferItem = storage.defineItem<
  { draftId: string; body: string; at: number } | null
>('session:unsaved', { fallback: null, version: 1, migrations: {} });

/**
 * Serialize a draft read-modify-write across EVERY extension context — the side
 * panel / workbench documents AND the background service worker (the context
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

/* ── History ring buffer (design §2.10, §8.2) ──────────────────────────────*/

/**
 * Independent cap on ⚑ pre-destructive snapshots. These are NEVER evicted by the
 * autosave eviction below (that is the whole point — the "before Replace All"
 * point is the one a user comes looking for, design §8.2), so without a cap of
 * their own, repeated "Replace All" on one draft grows history unbounded toward
 * the ~10 MB local quota. Keep only the most-recent few: a user reaches back to
 * the last destructive edit or two, not the twentieth. Per draft.
 */
const PRE_DESTRUCTIVE_CAP = 5;

/**
 * Push a snapshot, evicting the oldest AUTOSAVES first. ⚑ pre-destructive
 * snapshots are never evicted before an autosave — the "before Replace All"
 * point is precisely the one a user comes looking for (design §8.2) — but they
 * ARE capped independently (PRE_DESTRUCTIVE_CAP) so they cannot grow unbounded.
 */
export async function pushSnapshot(
  snapshot: Omit<Snapshot, 'id'>,
  limitPerDraft: number,
): Promise<void> {
  await withDraftsLock(async () => {
    const all = await historyItem.getValue();
    const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const next: Snapshot[] = [...all, { ...snapshot, id }];
    const mine = next.filter((s) => s.draftId === snapshot.draftId);
    const doomed = new Set<string>();

    // 1. Cap ⚑ pre-destructive snapshots on their own — evict the oldest over
    //    the cap, independent of the autosave eviction below.
    const preDestructive = mine
      .filter((s) => s.reason === 'pre-destructive')
      .sort((a, b) => a.createdAt - b.createdAt);
    if (preDestructive.length > PRE_DESTRUCTIVE_CAP) {
      for (const s of preDestructive.slice(0, preDestructive.length - PRE_DESTRUCTIVE_CAP)) {
        doomed.add(s.id);
      }
    }

    // 2. Normal per-draft autosave eviction, over the surviving snapshots.
    const surviving = mine.filter((s) => !doomed.has(s.id));
    if (surviving.length > limitPerDraft) {
      const excess = surviving.length - limitPerDraft;
      const evictable = surviving
        .filter((s) => s.reason === 'autosave')
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, excess);
      if (evictable.length < excess) {
        const more = surviving
          .filter((s) => s.reason !== 'pre-destructive' && !evictable.includes(s))
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(0, excess - evictable.length);
        evictable.push(...more);
      }
      for (const s of evictable) doomed.add(s.id);
    }

    await historyItem.setValue(doomed.size ? next.filter((s) => !doomed.has(s.id)) : next);
  });
}

export async function snapshotsFor(draftId: string): Promise<Snapshot[]> {
  const all = await historyItem.getValue();
  return all.filter((s) => s.draftId === draftId).sort((a, b) => b.createdAt - a.createdAt);
}

/* ── Quota (design §8.2) ───────────────────────────────────────────────────*/

/** `storage.local` is ~10 MB. We deliberately do NOT take `unlimitedStorage`:
 *  an extra install warning to solve a problem that does not occur. */
export const LOCAL_QUOTA_BYTES = 10 * 1024 * 1024;

export interface UsageInfo {
  bytes: number;
  quota: number;
  ratio: number;
  /** true when getBytesInUse is unavailable and `bytes` is a JSON estimate. */
  estimated: boolean;
}

type BytesApi = { getBytesInUse?: (keys: null) => Promise<number> };

export async function storageUsage(): Promise<UsageInfo> {
  const g = globalThis as unknown as {
    chrome?: { storage?: { local?: BytesApi } };
    browser?: { storage?: { local?: BytesApi } };
  };
  const api = g.browser?.storage?.local ?? g.chrome?.storage?.local;
  try {
    if (api?.getBytesInUse) {
      const bytes = await api.getBytesInUse(null);
      return { bytes, quota: LOCAL_QUOTA_BYTES, ratio: bytes / LOCAL_QUOTA_BYTES, estimated: false };
    }
  } catch {
    // fall through to the estimate
  }
  const [drafts, history] = await Promise.all([draftsItem.getValue(), historyItem.getValue()]);
  const bytes = new TextEncoder().encode(JSON.stringify({ drafts, history })).length;
  return { bytes, quota: LOCAL_QUOTA_BYTES, ratio: bytes / LOCAL_QUOTA_BYTES, estimated: true };
}

/** True for the errors that mean "the write did not happen" (design §8.2). */
export function isQuotaError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /quota|exceeded/i.test(msg);
}
