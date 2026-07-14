import { todoLogic } from '@blur/ui';
import type { RecordingSession } from './types';

// Recording STATE + chunk persistence — the fault-tolerance backbone (design
// capture.md §1.2, §9.6, §10.1, §10.5). This module is a STUB: it documents the
// architecture the real implementation must obey, and throws todoLogic() from
// every I/O path so a wired-but-empty call fails loudly instead of silently
// corrupting a recording.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE INVARIANT: recording state and chunks NEVER live in storage.local as a
// Blob array, and NEVER accumulate in a service-worker variable (design §0,
// §10.1, §10.3). Where things actually live:
//
//   • MediaStream / MediaRecorder → the OFFSCREEN document (Chrome) or the
//     recorder WINDOW (Firefox). The service worker owns NOTHING (design §1.2,
//     §10.1) — it can die at 30 s idle and the recording continues.
//   • Each MediaRecorder `ondataavailable` (timeslice 3000 ms) → IMMEDIATELY
//     IDBObjectStore.put(chunk). NEVER `chunks.push(blob)` — a 2-hour recording
//     would OOM the tab (design §10.3, the #1 trap of the genre).
//   • The SESSION MANIFEST (below) → IndexedDB, updated on every flush. This is
//     what a resurrected service worker rehydrates from (design §10.1), and what
//     the "interrupted recording" recovery card reads (design §5.11, §10.5).
//   • A mirror of {id, status} → storage.session, for fast SW rehydration.
//
// Storage keys, quotas, the whole reason `unlimitedStorage` is a permission —
// all of it exists to make the above true.

/** The crash-recovery manifest persisted to IndexedDB on every chunk flush
 *  (design §10.5). Deliberately small + serialisable — the Blobs are separate. */
export interface SessionManifest {
  id: string;
  startedAt: number;
  source: RecordingSession['source'];
  host: string;
  resolution: RecordingSession['resolution'];
  fps: number;
  format: RecordingSession['format'];
  audioBps: number;
  chunkCount: number;
  lastFlushAt: number;
  status: 'recording' | 'paused' | 'done' | 'interrupted';
}

/** Open (and upgrade) the IndexedDB database that holds chunks + manifests.
 *  Stores: `chunks` (keyed by [sessionId, seq]) and `manifests` (keyed by id). */
export async function openRecordingDb(): Promise<IDBDatabase> {
  // TODO_LOGIC: real indexedDB.open('capture', 1) with onupgradeneeded creating
  // the `chunks` and `manifests` object stores. See design §9.6, §10.5.
  throw todoLogic('capture: openRecordingDb (IndexedDB schema)');
}

/** Append one MediaRecorder chunk. MUST write straight to IndexedDB — the whole
 *  point of the module (design §10.3). Also bumps the manifest's chunkCount +
 *  lastFlushAt so recovery knows how far the recording got. */
export async function appendChunk(_sessionId: string, _blob: Blob): Promise<void> {
  // TODO_LOGIC: IDBObjectStore.put(blob) + manifest flush. NEVER buffer in RAM.
  throw todoLogic('capture: appendChunk (write to IndexedDB, never chunks.push)');
}

/** Persist / update the session manifest. Called on start and every flush. */
export async function writeManifest(_manifest: SessionManifest): Promise<void> {
  throw todoLogic('capture: writeManifest');
}

/** On Studio start, find any manifest still `recording` whose lastFlushAt is in
 *  the past → surfaced as an "interrupted recording" recovery card (design
 *  §5.11, §2.13). "Last ~3 s may not have been saved" is the honest copy. */
export async function findInterruptedSessions(): Promise<SessionManifest[]> {
  // TODO_LOGIC: cursor over `manifests` where status==='recording'.
  throw todoLogic('capture: findInterruptedSessions (crash recovery)');
}

/** Read chunks back as a STREAM (IDB cursor), never assembling one giant Blob —
 *  the export pipeline consumes this lazily (design §10.3). */
export async function* readChunks(
  _sessionId: string,
): AsyncGenerator<Blob, void, unknown> {
  // TODO_LOGIC: openCursor over `chunks` ordered by seq, yielding each blob.
  // A generator function needs no `yield` to satisfy the return type; throwing
  // here keeps the stub loud without an unreachable `yield`.
  throw todoLogic('capture: readChunks (streaming cursor, not one Blob)');
}
