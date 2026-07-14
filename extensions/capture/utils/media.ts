import { todoLogic } from '@blur/ui';
// mediabunny (MPL-2.0) is the real mux/demux/convert path (design §12.2). It is
// imported ONLY here, where the stub-calls live, so the dependency has exactly
// one home. The types are referenced to keep the import honest; no real call is
// made yet. When implemented, notes go in THIRD-PARTY-NOTICES.md (weak copyleft:
// edits INSIDE the library's files must be published; linking need not be).
import type * as Mediabunny from 'mediabunny';
import type { BudgetInput } from './budget';
import { computeBudget } from './budget';
import type { ExportSettings, RedactionRegion, Watermark } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// The MEDIA pipeline — every genuinely hard, platform-bound operation. All of it
// is STUBBED: each function throws todoLogic('capture: <what>') so the surface
// that calls it fails loudly (and `grep TODO_LOGIC` yields the whole backlog).
// The UI around these is REAL; only the pixel/byte work is deferred.
//
// The Chrome vs Firefox split (design §1.2) is reflected in which stub the caller
// reaches: the offscreen document calls the getUserMedia/MediaRecorder stubs; the
// Firefox recorder window calls the getDisplayMedia stub. Neither exists yet.

/** CHROME: background asks tabCapture for a one-shot stream id, in the SAME tick
 *  as the user gesture — it expires in seconds and is never cached (design §1.5,
 *  §10.2). Passed to the offscreen document, spent immediately. */
export async function getTabStreamId(_tabId: number): Promise<string> {
  throw todoLogic('capture: tabCapture.getMediaStreamId (expires in seconds — §1.5)');
}

/** CHROME (offscreen doc): turn the stream id into a real MediaStream. */
export async function openTabStream(_streamId: string): Promise<MediaStream> {
  throw todoLogic('capture: getUserMedia(chromeMediaSourceId) in offscreen (§1.5)');
}

/** FIREFOX (recorder window): getDisplayMedia. Requires transient activation →
 *  the extra user click + the browser's own picker (design §1.5). audio:false —
 *  Firefox physically cannot capture tab audio (design §1.1, §8). */
export async function openDisplayStream(): Promise<MediaStream> {
  throw todoLogic('capture: getDisplayMedia (Firefox, audio:false — §1.1)');
}

/** Mix an optional microphone track into the composite via AudioContext
 *  (design §3.1). The mic PROMPT needs a visible page — an offscreen doc has no
 *  UI (design §5.9), a design-defining constraint. */
export async function addMicrophone(
  _stream: MediaStream,
  _deviceId: string,
): Promise<MediaStream> {
  throw todoLogic('capture: microphone getUserMedia + AudioContext mix (§5.9)');
}

/** Start MediaRecorder with a MANDATORY 3000 ms timeslice so each chunk flushes
 *  to IndexedDB and nothing accumulates in RAM (design §10.3). onDataAvailable
 *  must call recording-state.appendChunk — never chunks.push(). */
export function startRecorder(
  _stream: MediaStream,
  _onChunk: (blob: Blob) => void,
): MediaRecorder {
  throw todoLogic('capture: MediaRecorder.start(3000) — timeslice mandatory (§10.3)');
}

/** Take a screenshot of the active tab. activeTab is already granted by the
 *  toolbar/command gesture. Rate-limited to 2/sec — the button greys for 500 ms
 *  rather than swallowing the click (design §4.2, §5.14). DPR matters: the file
 *  is in PHYSICAL pixels (design §6.6, PLAN.md §6.2). */
export async function captureScreenshot(): Promise<Blob> {
  throw todoLogic('capture: tabs.captureVisibleTab (2/sec limit, DPR — §5.14)');
}

/** Probe whether this browser's VideoEncoder can emit H.264 — decides if MP4 is
 *  offered at all on Firefox (design §4.4, §8, §12.1). Runs BEFORE showing the
 *  option, so we never present MP4 and fail at the end. */
export async function canEncodeH264(): Promise<boolean> {
  throw todoLogic('capture: VideoEncoder.isConfigSupported(avc1.42001f) — §12.1');
}

/** Bake redaction fills + watermark into frames and MUX to the target container
 *  via mediabunny. Solid fill writes to PIXELS, never a layer (design §7.4). The
 *  `_mb` param exists to anchor the mediabunny import at the one call site. */
export async function composeAndMux(
  _clipId: string,
  _regions: RedactionRegion[],
  _watermark: Watermark | null,
  _settings: ExportSettings,
  _mb?: typeof Mediabunny,
): Promise<Blob> {
  throw todoLogic('capture: mediabunny compose + mux (fill to pixels, §7.4/§12.2)');
}

export interface PassResult {
  pass: number;
  bitrate: number;
  actualBytes: number;
  hit: boolean;
}

/**
 * The ITERATIVE 2-pass encoder (design §6.4) — there is no real 2-pass rate
 * control in the browser, so we re-encode and correct:
 *   pass 1: bps₀ = video_bps from computeBudget()
 *   pass n: bpsₙ = bpsₙ₋₁ × target / actualₙ₋₁, clamped ±40%/pass, floored at
 *           bpp 0.015; stop on hit / floor / max passes / user "take as is".
 * The BUDGET math it starts from is real (utils/budget.ts) — only the encode is
 * stubbed. `onPass` streams honest per-pass log entries to the progress UI.
 */
export async function runTargetEncode(
  _input: BudgetInput,
  _settings: ExportSettings,
  _onPass: (result: PassResult) => void,
): Promise<Blob> {
  // The first bitrate we WOULD start from is genuinely computed here, to show the
  // real math is wired even though the encode is not:
  void computeBudget(_input);
  throw todoLogic('capture: iterative 2-pass target encoder (§6.4)');
}

/** Binary-search JPEG/WebP quality to hit a screenshot size target — 6–8 fast
 *  iterations, no progress screen needed (design §6.6). PNG is lossless so a
 *  size target there honestly offers "switch to JPEG/WebP?" instead. */
export async function encodeImageToTarget(
  _bitmap: ImageBitmap,
  _targetBytes: number,
  _type: 'image/jpeg' | 'image/webp',
): Promise<Blob> {
  throw todoLogic('capture: image quality binary-search to target size (§6.6)');
}
