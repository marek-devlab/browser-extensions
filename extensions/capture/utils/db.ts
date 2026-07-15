import type { Clip, LiveState, RecordingSource, VideoFormat } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB — the fault-tolerance backbone (design capture.md §9.6, §10.1, §10.5).
//
// 🔴 THE ONE INVARIANT: recording bytes NEVER accumulate in RAM and NEVER go to
// storage.local. Every MediaRecorder `ondataavailable` (timeslice 3000 ms) is
// written straight into the `chunks` store; the export path reads them back with
// a CURSOR, one chunk at a time. A 2-hour recording therefore has a flat memory
// profile (design §10.3 — "ловушка №1 жанра").
//
// Stores
//   chunks    key [sessionId, seq]  → { sessionId, seq, blob, at }
//   sessions  key id                → SessionManifest (crash-recovery record)
//   clips     key id                → Clip (library entry)
//   blobs     key key               → { key, blob }  (screenshots, imports, logo)
//
// Why a manifest AND a live state (utils/live-state.ts)? The live state is in
// `storage.session` — fast, but it dies with the browser. The manifest is on
// DISK next to the bytes it describes, so after a browser crash it is still
// there, still says `recording`, and that is exactly how we know to offer
// recovery (design §5.11, §2.13).

const DB_NAME = 'capture';
const DB_VERSION = 1;

export interface SessionManifest {
  id: string;
  startedAt: number;
  endedAt?: number;
  source: RecordingSource;
  host: string;
  tabId: number | null;
  width: number;
  height: number;
  fps: number;
  format: VideoFormat;
  /** The exact MediaRecorder mimeType — needed to reassemble a playable Blob. */
  mimeType: string;
  audioBps: number;
  chunkCount: number;
  bytes: number;
  /** Recorded ms (pause-excluded) at the last flush. */
  durationMs: number;
  lastFlushAt: number;
  /** `recording` on disk + no live owner ⇒ interrupted (design §10.5). */
  status: 'recording' | 'paused' | 'done' | 'interrupted';
}

interface ChunkRow {
  sessionId: string;
  seq: number;
  blob: Blob;
  at: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('chunks')) {
        db.createObjectStore('chunks', { keyPath: ['sessionId', 'seq'] });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('clips')) {
        const clips = db.createObjectStore('clips', { keyPath: 'id' });
        clips.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // If another context upgrades the schema, drop our handle rather than
      // blocking it forever with a stale connection.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function tx<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeNames, mode);
        let result: T;
        // Resolve on `complete`, not on the request callback: only `complete`
        // means the bytes are durably in the store. Resolving early is how you
        // report "saved" for data that a subsequent abort silently discards.
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'));
        t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
        void Promise.resolve(body(t)).then(
          (r) => {
            result = r;
          },
          (err) => {
            try {
              t.abort();
            } catch {
              /* already finished */
            }
            reject(err);
          },
        );
      }),
  );
}

function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

// ── Session manifests ───────────────────────────────────────────────────────

export async function putManifest(m: SessionManifest): Promise<void> {
  await tx('sessions', 'readwrite', (t) => {
    t.objectStore('sessions').put(m);
  });
}

export async function getManifest(id: string): Promise<SessionManifest | undefined> {
  return tx('sessions', 'readonly', (t) =>
    reqDone<SessionManifest | undefined>(t.objectStore('sessions').get(id)),
  );
}

/**
 * Read-modify-write a manifest in ONE readwrite transaction, merging `patch` over
 * the CURRENT on-disk record. Unlike `putManifest`, it re-reads inside the same
 * transaction, so it cannot clobber fields a concurrent `appendChunk` just wrote
 * (`chunkCount` / `bytes` / `durationMs`). Used for status changes that race the
 * chunk stream — pause/resume (audit C2). Returns undefined if the manifest is gone.
 */
export async function updateManifest(
  id: string,
  patch: Partial<SessionManifest>,
): Promise<SessionManifest | undefined> {
  return tx('sessions', 'readwrite', async (t) => {
    const store = t.objectStore('sessions');
    const m = await reqDone<SessionManifest | undefined>(store.get(id));
    if (!m) return undefined;
    const next: SessionManifest = { ...m, ...patch };
    store.put(next);
    return next;
  });
}

export async function listManifests(): Promise<SessionManifest[]> {
  return tx('sessions', 'readonly', (t) =>
    reqDone<SessionManifest[]>(t.objectStore('sessions').getAll()),
  );
}

/**
 * Every recording that never became a finished clip and therefore MUST surface as
 * a recovery card. Three on-disk states qualify, and all three have bytes on disk:
 *
 *   • `recording` / `paused` — the owner died before anything flipped the manifest
 *     (a hard browser/power crash: the SW never even ran);
 *   • `interrupted`          — the SW *did* notice the owner died (offscreen OOM,
 *     relay timeout, stale heartbeat, Firefox window force-close) and flipped it.
 *
 * 🔴 The `interrupted` state was the audit-B1 leak: `markOrphansInterrupted()`
 * flips a manifest to `interrupted`, but this feed used to filter it back OUT, so
 * a detected interruption became invisible in the Library AND its chunks leaked in
 * IndexedDB forever — recovery only worked when the extension *failed* to notice.
 * Now the flip does not hide anything: whoever marks the interruption, the recovery
 * card appears (design §5.11, §10.5), and the user can Recover or Discard it — so
 * the bytes are always either recovered or reclaimed, never orphaned.
 */
export async function findInterruptedSessions(): Promise<SessionManifest[]> {
  const all = await listManifests();
  return all
    .filter(
      (m) => m.status === 'recording' || m.status === 'paused' || m.status === 'interrupted',
    )
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** Manifests still `recording`/`paused` on disk — the ones a dead owner leaves that
 *  need flipping to `interrupted`. Kept distinct from `findInterruptedSessions` so
 *  the flip does NOT re-process (and the callers do not re-announce) sessions that
 *  are already marked. */
async function findOpenSessions(): Promise<SessionManifest[]> {
  const all = await listManifests();
  return all
    .filter((m) => m.status === 'recording' || m.status === 'paused')
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** Mark every still-open manifest as interrupted. Called when we KNOW nothing is
 *  recording (no offscreen context, no live state) so the badge and the library
 *  cannot keep claiming a recording that no longer exists. The flipped sessions
 *  stay VISIBLE as recovery cards (see findInterruptedSessions) — this only closes
 *  the "still recording" claim, it never hides the recording. */
export async function markOrphansInterrupted(exceptId?: string): Promise<SessionManifest[]> {
  const open = await findOpenSessions();
  const orphans = open.filter((m) => m.id !== exceptId);
  for (const m of orphans) {
    await putManifest({ ...m, status: 'interrupted' });
  }
  return orphans;
}

// ── Chunks ──────────────────────────────────────────────────────────────────

/**
 * Append ONE MediaRecorder chunk and advance the manifest — in a SINGLE
 * transaction, so a crash can never leave a manifest that claims more chunks
 * than exist on disk (which would produce a truncated, un-demuxable file).
 *
 * Throws `QuotaExceededError` when the disk is full; the caller (offscreen /
 * recorder) treats that as "stop now and finalise what we have", never as a
 * crash (design §5.6).
 */
export async function appendChunk(
  sessionId: string,
  seq: number,
  blob: Blob,
  durationMs: number,
): Promise<SessionManifest> {
  return tx(['chunks', 'sessions'], 'readwrite', async (t) => {
    const row: ChunkRow = { sessionId, seq, blob, at: Date.now() };
    t.objectStore('chunks').put(row);

    const store = t.objectStore('sessions');
    const m = await reqDone<SessionManifest | undefined>(store.get(sessionId));
    if (!m) throw new Error(`No manifest for session ${sessionId}`);
    const next: SessionManifest = {
      ...m,
      chunkCount: Math.max(m.chunkCount, seq + 1),
      bytes: m.bytes + blob.size,
      durationMs,
      lastFlushAt: Date.now(),
    };
    store.put(next);
    return next;
  });
}

/** Stream chunks back with a cursor — never assembling one giant array (§10.3). */
export async function* readChunks(sessionId: string): AsyncGenerator<Blob, void, unknown> {
  const db = await openDb();
  const range = IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]);
  let cursorKey: [string, number] | null = null;

  // One transaction per batch: an IDB transaction auto-closes when the microtask
  // queue drains, and an async generator's consumer yields between chunks. So we
  // re-open per chunk from the last key. Slower, but it cannot deadlock — which
  // is the property that matters when the alternative is a hung export.
  for (;;) {
    const row = await new Promise<ChunkRow | null>((resolve, reject) => {
      const t = db.transaction('chunks', 'readonly');
      const store = t.objectStore('chunks');
      const r = cursorKey
        ? store.openCursor(
            IDBKeyRange.bound([sessionId, cursorKey[1] + 1], [sessionId, Infinity]),
          )
        : store.openCursor(range);
      r.onsuccess = () => resolve((r.result?.value as ChunkRow | undefined) ?? null);
      r.onerror = () => reject(r.error);
    });
    if (!row) return;
    cursorKey = [row.sessionId, row.seq];
    yield row.blob;
  }
}

/**
 * Assemble the recording into one Blob.
 *
 * ⚠️ This does NOT read the bytes into memory: `new Blob([...blobRefs])` keeps
 * the parts as references to the browser's on-disk blob store. We never call
 * `.arrayBuffer()` on the whole thing anywhere in this codebase — that is what
 * would OOM on a 2-hour recording.
 */
export async function assembleBlob(sessionId: string, mimeType: string): Promise<Blob> {
  const parts: Blob[] = [];
  for await (const b of readChunks(sessionId)) parts.push(b);
  return new Blob(parts, { type: mimeType });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await tx(['chunks', 'sessions'], 'readwrite', (t) => {
    t.objectStore('chunks').delete(
      IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]),
    );
    t.objectStore('sessions').delete(sessionId);
  });
}

// ── Clips (library) ─────────────────────────────────────────────────────────

export async function putClip(clip: Clip): Promise<void> {
  await tx('clips', 'readwrite', (t) => {
    t.objectStore('clips').put(clip);
  });
}

export async function getClip(id: string): Promise<Clip | undefined> {
  return tx('clips', 'readonly', (t) => reqDone<Clip | undefined>(t.objectStore('clips').get(id)));
}

export async function listClips(): Promise<Clip[]> {
  const all = await tx('clips', 'readonly', (t) =>
    reqDone<Clip[]>(t.objectStore('clips').getAll()),
  );
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteClip(id: string): Promise<void> {
  const clip = await getClip(id);
  if (!clip) return;
  if (clip.sessionId) await deleteSession(clip.sessionId);
  if (clip.blobKey) await deleteBlob(clip.blobKey);
  await tx('clips', 'readwrite', (t) => {
    t.objectStore('clips').delete(id);
  });
}

/** The media behind a clip, wherever it lives. */
export async function clipBlob(clip: Clip): Promise<Blob> {
  if (clip.blobKey) {
    const b = await getBlob(clip.blobKey);
    if (!b) throw new Error('Recording data not found on disk.');
    return b;
  }
  if (clip.sessionId) return assembleBlob(clip.sessionId, clip.mimeType);
  throw new Error('Clip has no data.');
}

// ── Loose blobs (screenshots, imported files, watermark logo) ───────────────

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await tx('blobs', 'readwrite', (t) => {
    t.objectStore('blobs').put({ key, blob });
  });
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const row = await tx('blobs', 'readonly', (t) =>
    reqDone<{ key: string; blob: Blob } | undefined>(t.objectStore('blobs').get(key)),
  );
  return row?.blob;
}

export async function deleteBlob(key: string): Promise<void> {
  await tx('blobs', 'readwrite', (t) => {
    t.objectStore('blobs').delete(key);
  });
}

// ── Housekeeping ────────────────────────────────────────────────────────────

/** Free/used bytes (design §5.6, §2.3). Baseline API; returns nulls if absent. */
export async function storageEstimate(): Promise<{ used: number | null; free: number | null }> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || e.quota == null || e.usage == null) return { used: null, free: null };
    return { used: e.usage, free: Math.max(0, e.quota - e.usage) };
  } catch {
    return { used: null, free: null };
  }
}

/** Auto-delete (design §3.4). Default is NEVER: silently erasing someone's
 *  screencast is worse than using disk, so the caller must opt in. */
export async function pruneOlderThan(days: number): Promise<number> {
  const cutoff = Date.now() - days * 86_400_000;
  const clips = await listClips();
  let n = 0;
  for (const c of clips) {
    if (c.createdAt < cutoff) {
      await deleteClip(c.id);
      n += 1;
    }
  }
  return n;
}

/** Convert a finished session manifest into a library clip (design §4.1 step 4). */
export function manifestToClip(m: SessionManifest, opts?: { needsRemux?: boolean }): Clip {
  return {
    id: m.id,
    kind: 'video',
    title: m.host ? `${m.host} · ${new Date(m.startedAt).toLocaleString('en')}` : 'Screen recording',
    host: m.host,
    createdAt: m.startedAt,
    durationMs: m.durationMs,
    resolution: { width: m.width, height: m.height },
    format: m.format,
    mimeType: m.mimeType,
    sizeBytes: m.bytes,
    sessionId: m.id,
    needsRemux: opts?.needsRemux,
  };
}

/** A fresh manifest for a starting session — written BEFORE the first chunk, so
 *  even a crash two seconds in leaves a recoverable, self-describing record. */
export function newManifest(live: LiveState, mimeType: string, audioBps: number): SessionManifest {
  return {
    id: live.sessionId,
    startedAt: live.startedAt,
    source: live.source,
    host: live.host,
    tabId: live.tabId,
    width: live.width,
    height: live.height,
    fps: live.fps,
    format: live.format,
    mimeType,
    audioBps,
    chunkCount: 0,
    bytes: 0,
    durationMs: 0,
    lastFlushAt: Date.now(),
    status: 'recording',
  };
}
