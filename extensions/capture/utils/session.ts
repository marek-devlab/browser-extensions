import { browser } from '#imports';
import {
  appendChunk,
  getManifest,
  manifestToClip,
  newManifest,
  putClip,
  putManifest,
  storageEstimate,
  updateManifest,
  type SessionManifest,
} from './db';
import { clearLive, patchLive, setLive } from './live-state';
import { bitrateFor, mixAudio, pickMimeType, startRecorder, type AudioMix } from './media';
import type { StartOptions } from './messages';
import type { LiveState, RecordingSource } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// THE RECORDING SESSION — one class, used by BOTH owners:
//   • the offscreen document (Chrome), and
//   • the recorder window   (Firefox).
// Whoever holds the MediaStream runs this. The service worker never does: it can
// die at any moment and must own nothing (design §1.2, §10.1).
//
// Everything that can go wrong here ends in a RECOVERABLE ARTIFACT, never a
// zero-byte file:
//   • disk full (QuotaExceededError)  → stop + finalise what is on disk (§5.6)
//   • the user ends the share from the browser's own UI, or closes the recorded
//     tab                             → track `ended` → the ordinary Stop path,
//                                        announced as "stopped", not "failed" (§5.3, §5.4)
//   • MediaRecorder error             → stop + finalise, badge = error
//   • this document is killed (OOM,
//     crash, window closed)           → nothing runs at all; but the manifest on
//                                        disk still says `recording`, and the
//                                        chunks up to the last 3 s flush are
//                                        intact → recovery card (§5.11, §10.5)
//
// The live record is heartbeat every 2 s so a dead owner is detectable, and every
// state change is written there BEFORE it is announced anywhere — the badge reads
// that record, so it cannot claim a state the recorder is not in.

const HEARTBEAT_MS = 2000;
/** Below this the recorder warns that space is running out (design §5.6). */
export const LOW_DISK_BYTES = 500 * 1024 * 1024;
/** Same-origin channel for the mic level: recorder-window ← stream owner. It does
 *  NOT go through runtime.sendMessage, so it never wakes the service worker. */
export const MIC_CHANNEL = 'capture:mic-level';

export interface SessionInit {
  sessionId: string;
  owner: LiveState['owner'];
  stream: MediaStream;
  options: StartOptions;
  source: RecordingSource;
  host: string;
  tabId: number | null;
}

export class RecordingSession {
  private rec: MediaRecorder | null = null;
  private mix: AudioMix | null = null;
  private seq = 0;
  private beat: ReturnType<typeof setInterval> | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private meter: BroadcastChannel | null = null;
  private accumulatedMs = 0;
  private runningSince: number | null = null;
  private bytes = 0;
  private finished = false;
  private cancelled = false;
  private mimeType = '';
  private stopResolve: (() => void) | null = null;
  /** Serialises chunk writes so a later chunk can never land before an earlier
   *  one, and so stop() can await "everything is actually on disk". */
  private writeChain: Promise<void> = Promise.resolve();

  readonly id: string;
  private readonly init: SessionInit;

  constructor(init: SessionInit) {
    this.init = init;
    this.id = init.sessionId;
  }

  /** Open the stream for recording. Throws only if the recording could not START
   *  at all — after this resolves, every later failure is survivable. */
  async begin(): Promise<void> {
    const { options, stream } = this.init;

    this.mix = await mixAudio(stream, options);
    const wantAudio = this.mix.stream.getAudioTracks().length > 0;
    this.mimeType = pickMimeType(options.format, wantAudio);

    const track = this.mix.stream.getVideoTracks()[0];
    const settings = track?.getSettings();
    const width = settings?.width ?? 0;
    const height = settings?.height ?? 0;

    const live: LiveState = {
      sessionId: this.id,
      status: 'recording',
      owner: this.init.owner,
      source: this.init.source,
      host: this.init.host,
      tabId: this.init.tabId,
      startedAt: Date.now(),
      accumulatedMs: 0,
      runningSince: Date.now(),
      bytesOnDisk: 0,
      width,
      height,
      fps: options.fps,
      // 🔴 The RECORDED format is whatever MediaRecorder actually accepted, not
      // what the user picked. If Firefox gives us WebM we say WebM — we do not
      // put WebM bytes in a .mp4 (design §8).
      format: this.mimeType.includes('mp4') ? 'mp4' : 'webm',
      tabAudio: options.tabAudio && wantAudio,
      mic: options.mic && (this.mix?.hasMic ?? false),
      micMuted: false,
      updatedAt: Date.now(),
    };

    // The manifest is on disk BEFORE the first byte of media. A crash two seconds
    // in therefore still leaves a self-describing, recoverable record.
    await putManifest(newManifest(live, this.mimeType, wantAudio ? 128_000 : 0));
    await setLive(live);

    this.runningSince = live.runningSince;

    this.rec = startRecorder(
      this.mix.stream,
      this.mimeType,
      bitrateFor(options.quality),
      {
        onChunk: (blob) => this.onChunk(blob),
        onStop: () => this.stopResolve?.(),
        onError: (err) => void this.fail(err),
      },
    );

    // The REAL mimeType only exists after start(). Merge-RMW (not a blind
    // read-then-put): the recorder is already running, so a first chunk could
    // arrive during this update, and a blind put would clobber its counters — the
    // same race as pause/resume (audit C2).
    if (this.rec.mimeType) {
      this.mimeType = this.rec.mimeType;
      await updateManifest(this.id, { mimeType: this.mimeType });
      await patchLive({ format: this.mimeType.includes('mp4') ? 'mp4' : 'webm' });
    }

    // The user ended the share from the browser's OWN indicator, or the recorded
    // tab was closed. Both are ordinary stops — not errors (design §5.3, §5.4).
    for (const t of this.mix.stream.getTracks()) {
      t.addEventListener('ended', () => {
        if (!this.finished) void this.stop('source-ended');
      });
    }

    this.beat = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);

    if (live.mic) {
      this.meter = new BroadcastChannel(MIC_CHANNEL);
      this.meterTimer = setInterval(() => this.tickMeter(), 120);
    }
  }

  private async heartbeat(): Promise<void> {
    if (this.finished) return;
    const { free } = await storageEstimate();
    await patchLive({
      accumulatedMs: this.accumulatedMs,
      runningSince: this.runningSince,
      bytesOnDisk: this.bytes,
      ...(free != null ? { freeBytes: free } : {}),
    });
  }

  /**
   * The mic VU meter, on a BroadcastChannel — NOT runtime.sendMessage and NOT
   * storage.
   *
   * ⚠️ Both obvious choices are wrong. A storage write ten times a second for a
   * decorative bar is indefensible. And `runtime.sendMessage` would WAKE THE
   * SERVICE WORKER on every frame of the meter — the exact battery/lifecycle sin
   * the design refuses to commit for the badge (§1.3), committed for something far
   * less important. A BroadcastChannel goes offscreen-document → recorder-window
   * directly, same origin, never touching the extension message bus. If no window
   * is listening, the messages fall on the floor, which is precisely right.
   */
  private tickMeter(): void {
    if (this.finished || !this.mix) return;
    const level = this.mix.level();
    if (level == null) return;
    this.meter?.postMessage({ level });
  }

  private elapsed(): number {
    return this.accumulatedMs + (this.runningSince ? Date.now() - this.runningSince : 0);
  }

  /**
   * One chunk from MediaRecorder → straight to IndexedDB. Never buffered (§10.3).
   *
   * 🔴 Two things here are load-bearing and both are about NOT LOSING BYTES.
   *
   *   1. `seq` is allocated SYNCHRONOUSLY, before the first await. If it were read
   *      after the await, two overlapping writes — which is exactly what happens
   *      when the final chunk lands while the previous one is still being written
   *      on stop() — would take the SAME sequence number, and the second would
   *      silently overwrite the first. Three seconds of video, gone, with no error
   *      anywhere.
   *   2. Writes are SERIALISED through `writeChain`, and stop() awaits that chain.
   *      Otherwise "stopped" could be announced while the last chunk is still in
   *      flight, and a document torn down a millisecond later would drop it.
   */
  private onChunk(blob: Blob): void {
    if (this.cancelled) return;
    const seq = this.seq;
    this.seq += 1;
    const at = this.elapsed();

    this.writeChain = this.writeChain
      .then(async () => {
        const m = await appendChunk(this.id, seq, blob, at);
        this.bytes = m.bytes;
        await patchLive({ bytesOnDisk: this.bytes });
      })
      .catch((err: unknown) => {
        // ⚠️ Do NOT await stop()/fail() here. Both drain `writeChain` — which is
        // the very promise this handler is settling — so awaiting them from inside
        // it deadlocks the recording at exactly the moment it is trying to save
        // itself. Kicking them off unawaited lets this link settle first, and they
        // then find a drained chain.
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'QuotaExceededError') {
          // Disk full. STOP and finalise — everything already flushed is a valid
          // recording. Throwing it away because the thirteenth minute did not fit
          // would be the worst possible reading of "out of space" (design §5.6).
          void this.stop('quota');
          return;
        }
        void this.fail(err instanceof Error ? err : new Error(String(err)));
      });
  }

  async pause(): Promise<void> {
    if (!this.rec || this.rec.state !== 'recording') return;
    this.rec.pause();
    // Fold the running span into the accumulated total: the timer freezes exactly
    // where it was, and resume does not create a hole in the duration (§5.2).
    this.accumulatedMs = this.elapsed();
    this.runningSince = null;
    await this.queueManifestUpdate({ status: 'paused', durationMs: this.accumulatedMs });
    await patchLive({
      status: 'paused',
      accumulatedMs: this.accumulatedMs,
      runningSince: null,
    });
  }

  async resume(): Promise<void> {
    if (!this.rec || this.rec.state !== 'paused') return;
    this.rec.resume();
    this.runningSince = Date.now();
    await this.queueManifestUpdate({ status: 'recording' });
    await patchLive({ status: 'recording', runningSince: this.runningSince });
  }

  /**
   * Route a manifest status change through the SAME `writeChain` as chunk writes,
   * so it can never interleave with `appendChunk`'s counter RMW (audit C2). Two
   * guarantees together:
   *   • serialised — it runs as one link between chunk-write links, never during
   *     one; and
   *   • merge-RMW (`updateManifest` reads inside its own transaction), so even the
   *     old two-transaction gap cannot clobber chunkCount / bytes / durationMs.
   * The chain is kept always-resolving (the `.catch` is part of the assigned
   * promise), exactly as `onChunk` does, so a failed status write can never poison
   * the chunk-write queue — a cosmetic status hiccup must not stop the recording.
   */
  private queueManifestUpdate(patch: Partial<SessionManifest>): Promise<void> {
    const link = this.writeChain.then(() => updateManifest(this.id, patch)).then(() => undefined);
    this.writeChain = link.catch(() => undefined);
    return this.writeChain;
  }

  setMuted(muted: boolean): void {
    this.mix?.setMicMuted(muted);
    void patchLive({ micMuted: muted });
  }

  /** Stop and KEEP the recording. Always ends with a clip in the library. */
  async stop(reason: 'user' | 'source-ended' | 'quota' = 'user'): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    await patchLive({ status: 'stopping' });

    this.accumulatedMs = this.elapsed();
    this.runningSince = null;

    await this.flushAndStopRecorder();
    this.teardown();

    const m = await getManifest(this.id);
    if (m) {
      const done: SessionManifest = {
        ...m,
        status: 'done',
        endedAt: Date.now(),
        durationMs: this.accumulatedMs,
      };
      await putManifest(done);
      // A recording with zero chunks is not a clip — it is a failed start, and
      // pretending otherwise would put a 0-byte entry in the library.
      if (done.chunkCount > 0) {
        await putClip(manifestToClip(done));
      }
    }

    await clearLive();
    void browser.runtime
      .sendMessage({
        type: 'session:finished',
        sessionId: this.id,
        ok: true,
        reason,
      })
      .catch(() => undefined);
  }

  /** Cancel and DELETE. Two-step confirmed in the UI before it ever gets here. */
  async cancel(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.cancelled = true;
    await this.flushAndStopRecorder();
    this.teardown();
    const { deleteSession } = await import('./db');
    await deleteSession(this.id);
    await clearLive();
    void browser.runtime
      .sendMessage({ type: 'session:finished', sessionId: this.id, ok: true, reason: 'cancelled' })
      .catch(() => undefined);
  }

  private async fail(err: Error): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    await this.flushAndStopRecorder();
    this.teardown();
    const m = await getManifest(this.id);
    if (m) {
      // 🔴 Even on failure the bytes stay and the manifest is closed as
      // `interrupted`, not deleted: the user gets a recovery card, not silence.
      await putManifest({ ...m, status: 'interrupted', durationMs: this.accumulatedMs });
      if (m.chunkCount > 0) await putClip(manifestToClip(m, { needsRemux: true }));
    }
    await patchLive({ status: 'error', error: err.message });
    void browser.runtime
      .sendMessage({ type: 'session:finished', sessionId: this.id, ok: false, reason: err.message })
      .catch(() => undefined);
  }

  /** MediaRecorder.stop() emits ONE FINAL `dataavailable`. We must wait for it and
   *  for its write to land, or the last (up to 3 s) of the recording is silently
   *  dropped — and "silently" is the part that makes it unforgivable. */
  private async flushAndStopRecorder(): Promise<void> {
    const rec = this.rec;
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        this.stopResolve = done;
        try {
          rec.stop();
        } catch {
          done();
        }
        // If `onstop` never fires (a wedged recorder), do not hang forever:
        // everything flushed so far is already durable on disk.
        globalThis.setTimeout(done, 4000);
      });
    }
    // Drain the write queue: only now is "saved" actually true.
    await this.writeChain.catch(() => undefined);
  }

  private teardown(): void {
    if (this.beat) clearInterval(this.beat);
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.beat = null;
    this.meterTimer = null;
    this.meter?.close();
    this.meter = null;
    this.mix?.close();
    this.init.stream.getTracks().forEach((t) => t.stop());
    this.mix?.stream.getTracks().forEach((t) => t.stop());
    this.rec = null;
  }
}
