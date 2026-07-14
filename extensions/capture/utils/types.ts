// Shared data model for Capture Studio (design capture.md §3, §6, §7).
//
// One captured artifact — a recording or a screenshot — flows through the SAME
// pipeline: source → (record) → clip → edit (trim/redact/watermark) → export
// (format/resolution/target-size). These types describe that flow. None of the
// heavy media objects (MediaStream, MediaRecorder, VideoFrame, Blob chunks) live
// here — those belong to the offscreen document / recorder window and IndexedDB
// (design §1.2, §9.6). This file is plain, serialisable state only.

/** Which pipeline is live. Decided by `import.meta.env` at build time + runtime
 *  feature probe, NOT stored — kept here for the UI's honest per-browser copy. */
export type Pipeline = 'chrome-offscreen' | 'firefox-window';

export type RecordingSource = 'tab' | 'screen';

/** Live recording lifecycle (design §5). `interrupted` is the crash-recovery
 *  state (SW/offscreen died mid-record); the chunks on disk are still valid. */
export type RecordingStatus =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'processing'
  | 'done'
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

/** A running or finished recording session. The MANIFEST persisted to IndexedDB
 *  for crash recovery is a subset of this (design §10.5). */
export interface RecordingSession {
  id: string;
  status: RecordingStatus;
  source: RecordingSource;
  /** hostname of the recorded tab, e.g. "example.com" — from URL(tab.url), never
   *  document.title (title is page-controlled — design §9.4). */
  host: string;
  startedAt: number;
  /** Accumulated recorded milliseconds (excludes paused time). */
  durationMs: number;
  /** Bytes flushed to IndexedDB so far — the honest "recorded to disk" figure
   *  the recorder window shows, NOT an estimated container size (design §8). */
  bytesOnDisk: number;
  resolution: Resolution;
  fps: number;
  format: VideoFormat;
  tabAudio: boolean;
  mic: boolean;
}

/** A finished, editable clip in the library. */
export interface Clip {
  id: string;
  kind: 'video' | 'screenshot';
  title: string;
  host: string;
  createdAt: number;
  /** ms for video; 0 for screenshots. */
  durationMs: number;
  resolution: Resolution;
  /** Physical-pixel resolution for screenshots differs from viewport by DPR — we
   *  show both (design §6.6, §8, PLAN.md §6.2). */
  devicePixelRatio?: number;
  format: VideoFormat | ScreenshotFormat;
  sizeBytes: number;
  /** Recovered-from-crash clips must be re-muxed before export (design §10.5). */
  needsRemux?: boolean;
}

// ── Redaction & overlays (design §7) ────────────────────────────────────────

/** SOLID FILL is the ONLY protection mode. Blur/pixelate are reversible and live
 *  in a physically separate "cosmetic — NOT protection" group (design §7.2). */
export type RedactionMode = 'fill' | 'blur' | 'pixelate';

export interface RedactionRegion {
  id: string;
  mode: RedactionMode;
  /** Fraction-of-frame rect [0..1] so it survives resolution changes. */
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
  /** Logo is an IndexedDB Blob loaded via createImageBitmap(File) or a packaged
   *  asset via runtime.getURL — NEVER an external URL (taints canvas → export
   *  fails at the end — design §9.3). Here it is just a stored blob key. */
  logoBlobKey?: string;
  position: WatermarkPosition;
  /** 10..100 (%). */
  opacity: number;
  /** % of frame HEIGHT, not px — else a logo covers half a 480p frame (§3.3). */
  sizePct: number;
}

// ── Export & target size (design §6) ────────────────────────────────────────

/** A platform upload ceiling. Baked in locally, editable, may be stale — we do
 *  NOT hit the network to check (design §6.2). `hard` = "12.4 in Discord simply
 *  will not upload"; soft (custom target) = "missed by +24%, save anyway?". */
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
  /** null = "don't limit". Otherwise a byte ceiling. */
  targetBytes: number | null;
  /** Whether targetBytes came from a HARD platform preset (design §6.5). */
  targetHard: boolean;
  maxPasses: number;
  filenameTemplate: string;
  askWhereToSave: boolean;
  deleteSourceAfter: boolean;
}
