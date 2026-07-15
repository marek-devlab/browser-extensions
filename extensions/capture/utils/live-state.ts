import { storage } from '#imports';
import type { LiveState } from './types';

// The LIVE record — `storage.session`, written ONLY by the context that owns the
// MediaRecorder (offscreen doc on Chrome, recorder window on Firefox) and read by
// everyone else (design capture.md §1.2, §10.1).
//
// 🔴 Why not a variable in the service worker: the SW is evicted at ~30 s idle
// (design §5.12). Anything it "remembers" is gone, and the classic bug of this
// genre — a badge that still says REC over a recording that no longer exists —
// follows immediately. Here the badge is DERIVED: background subscribes to this
// item and mirrors it. It cannot form an independent (i.e. wrong) opinion.
//
// `storage.session` is the right store: it is fast, it is not persisted to disk
// (a live pointer has no business surviving a browser restart — the MANIFEST in
// IndexedDB does that job, and it is the one that drives crash recovery), and it
// is readable from every extension context (but NOT from content scripts).

export const liveItem = storage.defineItem<LiveState | null>('session:live', {
  fallback: null,
});

/** A live owner that has not heartbeat within this window is presumed dead: its
 *  document crashed, was OOM-killed, or the browser tore it down. Chunks up to
 *  the last flush are safe on disk (design §5.11). Timeslice is 3 s, and the
 *  owner also beats every 2 s while paused, so 12 s is ~4 missed beats. */
export const STALE_MS = 12_000;

export function isStale(live: LiveState | null): boolean {
  if (!live) return false;
  if (live.status === 'error' || live.status === 'interrupted') return false;
  return Date.now() - live.updatedAt > STALE_MS;
}

/** True when a recording is genuinely in progress right now. A STALE live record
 *  is NOT "recording" — it is a corpse, and the UI says so. */
export function isActive(live: LiveState | null): boolean {
  if (!live) return false;
  if (isStale(live)) return false;
  return (
    live.status === 'starting' ||
    live.status === 'recording' ||
    live.status === 'paused' ||
    live.status === 'stopping'
  );
}

export async function getLive(): Promise<LiveState | null> {
  return liveItem.getValue();
}

export async function setLive(live: LiveState | null): Promise<void> {
  await liveItem.setValue(live);
}

/** Patch + beat. Only the OWNER calls this. */
export async function patchLive(patch: Partial<LiveState>): Promise<LiveState | null> {
  const cur = await liveItem.getValue();
  if (!cur) return null;
  const next: LiveState = { ...cur, ...patch, updatedAt: Date.now() };
  await liveItem.setValue(next);
  return next;
}

export async function clearLive(): Promise<void> {
  await liveItem.setValue(null);
}

export function watchLive(cb: (live: LiveState | null) => void): () => void {
  return liveItem.watch((value) => cb(value ?? null));
}
