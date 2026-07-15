// Shared data model for Capture Studio (design capture.md §3, §6, §7).
//
// One captured artifact — a recording or a screenshot — flows through the SAME
// pipeline: source → (record) → clip → edit (trim/redact/watermark) → export
// (format/resolution/target-size). These types describe that flow. None of the
// heavy media objects (MediaStream, MediaRecorder, VideoFrame) live here — those
// belong to the offscreen document / recorder window. This file is plain,
// serialisable state only (plus the Blob handles IndexedDB stores for us).

/** Which pipeline is live. Decided by a RUNTIME feature probe (utils/platform.ts),
 *  not by a build flag alone — a Firefox build on Android has neither pipeline. */
export type Pipeline = 'chrome-offscreen' | 'firefox-window' | 'none';

export type RecordingSource = 'tab' | 'screen';

/** Live recording lifecycle (design §5). `interrupted` is the crash-recovery
 *  state (offscreen/window died mid-record); the chunks on disk are still valid. */
export type RecordingStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'encoding'
  | 'interrupted'
  | 'error';

export type VideoFormat = 'mp4' | 'webm';
export type ScreenshotFormat = 'png' | 'jpeg' | 'webp';

export interface Resolution {
  width: number;
  height: number;
  /** true = "As-is" passthrough (no scaling). Upscale is never offered (§13). */
  asRecorded?: boolean;
}

/**
 * THE LIVE RECORDING RECORD — the single source of truth for "what is happening
 * right now", written ONLY by whoever owns the MediaRecorder (the offscreen doc
 * on Chrome, the recorder window on Firefox) and mirrored into `storage.session`
 * (utils/live-state.ts).
 *
 * 🔴 It is deliberately NOT a service-worker variable: the SW dies at ~30 s idle
 * (design §5.12, §10.1) and any state there would evaporate. Every surface —
 * badge, popup, recorder window — DERIVES from this record, which is precisely
 * why the badge cannot lie: it is not an independent opinion about the state.
 *
 * `updatedAt` is a heartbeat. A consumer that sees `recording` with a stale
 * `updatedAt` knows the owner died, and says so (design §5.11) instead of
 * showing REC forever.
 */
export interface LiveState {
  sessionId: string;
  status: Exclude<RecordingStatus, 'idle'>;
  /** Who physically holds the stream — the honest basis for the "you may close
   *  this window" (Chrome) vs "do NOT close it" (Firefox) copy (§1.2, §2.4). */
  owner: 'offscreen' | 'recorder';
  source: RecordingSource;
  /** hostname of the recorded tab — from URL(tab.url), never document.title
   *  (title is page-controlled — design §9.4). Empty for screen capture. */
  host: string;
  tabId: number | null;
  startedAt: number;
  /** Recorded ms COMPLETED before the current running span (pause-aware). */
  accumulatedMs: number;
  /** Epoch ms the current span started; null while paused (design §5.2). */
  runningSince: number | null;
  /** Bytes actually flushed to IndexedDB — the honest "recorded to disk" figure,
   *  never an estimated container size (design §8). */
  bytesOnDisk: number;
  width: number;
  height: number;
  fps: number;
  format: VideoFormat;
  tabAudio: boolean;
  mic: boolean;
  micMuted: boolean;
  /** Heartbeat. Stale ⇒ the owner died ⇒ say so (design §5.11). */
  updatedAt: number;
  /** Free bytes from navigator.storage.estimate() (design §5.6). */
  freeBytes?: number;
  error?: string;
}

/** Elapsed recorded ms, pause-aware. The ONE place this is computed. */
export function elapsedMs(
  live: Pick<LiveState, 'accumulatedMs' | 'runningSince'>,
): number {
  return live.accumulatedMs + (live.runningSince ? Date.now() - live.runningSince : 0);
}

/** A finished, editable artifact in the library.
 *  Media lives in ONE of two places, never both:
 *   - `sessionId` → the chunk stream in IndexedDB (recordings);
 *   - `blobKey`   → a single Blob in IndexedDB (screenshots, imported files). */
export interface Clip {
  id: string;
  kind: 'video' | 'screenshot';
  title: string;
  host: string;
  createdAt: number;
  /** ms for video; 0 for screenshots. */
  durationMs: number;
  resolution: Resolution;
  /** Screenshots are in PHYSICAL pixels: viewport × DPR. We show BOTH numbers
   *  (design §6.6, §8, PLAN.md §6.2). */
  devicePixelRatio?: number;
  format: VideoFormat | ScreenshotFormat;
  mimeType: string;
  sizeBytes: number;
  sessionId?: string;
  blobKey?: string;
  /** Recovered-from-crash clips must be re-muxed before export (design §10.5):
   *  a truncated container's header has no reliable duration. */
  needsRemux?: boolean;
  /** true when the source is a file the user opened, not something we recorded. */
  imported?: boolean;
}

// ── Redaction & overlays (design §7) ────────────────────────────────────────

/** SOLID FILL is the ONLY protection mode. Blur/pixelate are reversible and live
 *  in a physically separate "cosmetic — NOT protection" group (design §7.2). */
export type RedactionMode = 'fill' | 'blur' | 'pixelate';

export interface RedactionRegion {
  id: string;
  mode: RedactionMode;
  /** Fraction-of-frame rect [0..1] so it survives every resolution change. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Solid-fill colour (fill mode only). */
  fill?: string;
  /** Video interval in ms; default is the WHOLE clip (safer — design §7.5). The
   *  rectangle is STATIONARY: content scrolling out from under it leaks (§7.5). */
  inMs?: number;
  outMs?: number;
}

export type WatermarkPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface Watermark {
  text: string;
  /** A logo comes from a user-picked File (createImageBitmap(File) — a Blob does
   *  NOT taint the canvas) or from a packaged asset via runtime.getURL.
   *  🔴 NEVER an external URL: it taints the canvas and convertToBlob() throws at
   *  the END of the export, after minutes of encoding (design §9.3). */
  logoBlobKey?: string;
  position: WatermarkPosition;
  /** 10..100 (%). */
  opacity: number;
  /** % of frame HEIGHT, not px — else a logo covers half a 480p frame (§3.3). */
  sizePct: number;
}

// ── Export & target size (design §6) ────────────────────────────────────────

/** A platform upload ceiling. Baked in locally, editable, may be stale — we do
 *  NOT hit the network to check (design §6.2). `hard` = "12.4 MB in Discord
 *  simply will not upload"; soft (a custom target) = "missed by +24%, save?". */
export interface SizePreset {
  id: string;
  label: string;
  bytes: number;
  hard: boolean;
}

export interface ExportSettings {
  format: VideoFormat;
  /** Stream-copy: instant, but MUTUALLY EXCLUSIVE with redaction/watermark/
   *  resize/target-size — it cannot bake pixels (design §7.6). */
  keepAsRecorded: boolean;
  resolution: Resolution;
  fps: number | 'as-recorded';
  keepAudio: boolean;
  audioBps: number;
  /** Trim window in ms (design §2.6, §14.1 — v1: the strongest size lever). */
  trimInMs: number;
  trimOutMs: number;
  /** null = "don't limit". Otherwise a byte ceiling. */
  targetBytes: number | null;
  /** Whether targetBytes came from a HARD platform preset (design §6.5). */
  targetHard: boolean;
  maxPasses: number;
  filename: string;
  askWhereToSave: boolean;
  deleteSourceAfter: boolean;
}

/** One completed (or aborted) pass of the iterative target-size fit (§2.9, §6.4). */
export interface PassResult {
  pass: number;
  bitrate: number;
  actualBytes: number;
  hit: boolean;
  /** true when the pass was cut short because the projection already overshot
   *  (design §2.9, "ранний обрыв") — no point burning the remaining CPU. */
  aborted?: boolean;
  note?: string;
}
