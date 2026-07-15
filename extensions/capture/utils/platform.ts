import { browser } from '#imports';
import type { MsgKey } from './i18n';
import type { Pipeline } from './types';

// RUNTIME capability probe (design capture.md §8, §12.1, PLAN.md (Часть II) §1.5).
//
// 🔴 Desktop only, and we say so. Firefox for Android has NO tabCapture, NO
// offscreen, NO windows.create and NO getDisplayMedia; WebCodecs is absent too.
// A build flag alone cannot tell us this — `import.meta.env.FIREFOX` is true on
// both desktop and Android. So we FEATURE-DETECT, and where recording is
// impossible we show an explicit "not supported here" state instead of a dead
// button or a spinner that never resolves.
//
// What still works on such a platform: screenshots (`tabs.captureVisibleTab`)
// and the whole library/editor/export side — so we keep those alive rather than
// blanking the UI.

export interface Capabilities {
  pipeline: Pipeline;
  canRecord: boolean;
  /** captureVisibleTab — present essentially everywhere, including Android. */
  canScreenshot: boolean;
  /** WebCodecs (VideoEncoder/VideoDecoder) → transcode, target size, watermark. */
  canTranscode: boolean;
  /** Tab/system audio. Firefox's getDisplayMedia returns NO audio, ever (§1.1). */
  canRecordTabAudio: boolean;
  /** MediaRecorder can emit MP4 directly (Chrome 126+ — design §4.4). */
  canRecordMp4: boolean;
  /** File System Access → stream the export to disk without a Blob in RAM. */
  canStreamToDisk: boolean;
  /** Human-readable reason recording is unavailable (English fallback, for the
   *  non-React service worker). React surfaces translate `reasonKey` instead. */
  reason?: string;
  /** Catalog key for the reason, so React surfaces (popup) show it translated. */
  reasonKey?: MsgKey;
}

function hasOffscreen(): boolean {
  return !!(globalThis as { chrome?: { offscreen?: unknown } }).chrome?.offscreen;
}

function hasTabCapture(): boolean {
  const api = (browser as unknown as { tabCapture?: { getMediaStreamId?: unknown } }).tabCapture;
  return typeof api?.getMediaStreamId === 'function';
}

/** MediaRecorder.isTypeSupported is only defined in a DOM context; the service
 *  worker has no MediaRecorder at all (that is the whole reason the offscreen
 *  document exists — design §9.5). Probe defensively. */
function recorderSupports(mime: string): boolean {
  try {
    return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime);
  } catch {
    return false;
  }
}

export function capabilities(): Capabilities {
  const isFirefox = import.meta.env.FIREFOX;

  const canScreenshot = typeof browser.tabs?.captureVisibleTab === 'function';
  const canTranscode =
    typeof globalThis.VideoEncoder !== 'undefined' && typeof globalThis.VideoDecoder !== 'undefined';
  const canStreamToDisk =
    typeof (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';

  if (!isFirefox) {
    // Chrome MV3: background gets the streamId, an offscreen document consumes it.
    const ok = hasTabCapture() && hasOffscreen();
    return {
      pipeline: ok ? 'chrome-offscreen' : 'none',
      canRecord: ok,
      canScreenshot,
      canTranscode,
      canRecordTabAudio: true,
      canRecordMp4: recorderSupports('video/mp4;codecs=avc1.42E01E,mp4a.40.2'),
      canStreamToDisk,
      reason: ok
        ? undefined
        : "This browser doesn't provide tabCapture/offscreen — tab recording is unavailable.",
      reasonKey: ok ? undefined : 'plat_no_tabcapture',
    };
  }

  // Firefox: the recorder WINDOW owns getDisplayMedia. On Android there are no
  // windows and no getDisplayMedia → recording is physically impossible (§12.1).
  const hasWindows = typeof browser.windows?.create === 'function';
  const hasDisplayMedia =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  // In a background *script* `navigator.mediaDevices` exists but the picker
  // cannot be raised without transient activation — that is a UI constraint, not
  // a capability one, so it does not affect this probe. What we require here is
  // that the API exists at all AND that we can open a window to host it.
  const ok = hasWindows && (hasDisplayMedia || typeof navigator === 'undefined');
  return {
    pipeline: ok ? 'firefox-window' : 'none',
    canRecord: ok,
    canScreenshot,
    canTranscode,
    // 🔴 Not a setting we chose — getDisplayMedia in Firefox returns no audio
    // track at all (BCD: audio → version_added: false). Tab/system audio
    // recording is IMPOSSIBLE there. Only the microphone is available (§1.1, §8).
    canRecordTabAudio: false,
    canRecordMp4: false, // Firefox MediaRecorder writes WebM only (design §4.4).
    canStreamToDisk, // false in Firefox: no File System Access (design §10.3).
    reason: ok
      ? undefined
      : 'Screen recording is impossible in mobile Firefox: there is no getDisplayMedia and no extension windows. Screenshots work.',
    reasonKey: ok ? undefined : 'plat_no_firefox_mobile',
  };
}
