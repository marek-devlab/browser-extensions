import { browser } from '#imports';
import type { StartOptions } from './messages';
import type { VideoFormat } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE — the platform-bound half of the product. Two pipelines, and that is
// permanent (design capture.md §1.2, PLAN-2 §1.1):
//
//   CHROME   background: tabCapture.getMediaStreamId({targetTabId})
//            offscreen:  getUserMedia({video:{mandatory:{chromeMediaSource:'tab',
//                        chromeMediaSourceId}}}) → MediaRecorder
//   FIREFOX  recorder window: getDisplayMedia() (transient activation required →
//            an extra click + the browser's own picker). tabCapture and
//            chrome.offscreen do not exist there at all.
//
// Encoding lives in ./encode.ts; this file only opens streams and records them.

/** 🔴 The streamId is single-use and expires within SECONDS (design §1.5, §10.2).
 *  It is taken in the same turn as the user gesture and spent immediately. It is
 *  never cached, never fetched "in advance", never reused. */
export async function getTabStreamId(tabId: number): Promise<string> {
  const api = (
    browser as unknown as {
      tabCapture?: {
        getMediaStreamId: (
          opts: { targetTabId?: number },
          cb?: (id: string) => void,
        ) => Promise<string> | void;
      };
    }
  ).tabCapture;
  if (!api?.getMediaStreamId) {
    throw new Error('tabCapture недоступен в этом браузере.');
  }
  return new Promise<string>((resolve, reject) => {
    try {
      const maybe = api.getMediaStreamId({ targetTabId: tabId }, (id: string) => {
        const err = (
          globalThis as { chrome?: { runtime?: { lastError?: { message?: string } } } }
        ).chrome?.runtime?.lastError;
        if (err) reject(new Error(err.message ?? 'getMediaStreamId failed'));
        else if (id) resolve(id);
        else reject(new Error('tabCapture не вернул streamId.'));
      });
      // Chrome also returns a promise; whichever settles first wins.
      if (maybe && typeof (maybe as Promise<string>).then === 'function') {
        void (maybe as Promise<string>).then(resolve, reject);
      }
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** CHROME, whole screen / window — the ONLY consumer of the `desktopCapture`
 *  OPTIONAL permission (design §3.1). Never requested at install, never by
 *  default: only when the user picks "Весь экран или окно…". */
export async function getDesktopStreamId(tab: unknown): Promise<string> {
  const api = (
    globalThis as {
      chrome?: {
        desktopCapture?: {
          chooseDesktopMedia: (
            sources: string[],
            targetTab: unknown,
            cb: (id: string) => void,
          ) => number;
        };
      };
    }
  ).chrome?.desktopCapture;
  if (!api) throw new Error('desktopCapture недоступен.');
  return new Promise<string>((resolve, reject) => {
    api.chooseDesktopMedia(['screen', 'window', 'tab'], tab, (id: string) => {
      // An empty id means the user dismissed the picker. That is a CANCEL, not an
      // error — the caller must not show a red "capture failed" for it.
      if (!id) reject(new Error('CANCELLED'));
      else resolve(id);
    });
  });
}

/** CHROME (inside the offscreen document): spend the streamId. */
export async function openChromeStream(
  streamId: string,
  kind: 'tab' | 'desktop',
  options: StartOptions,
): Promise<MediaStream> {
  const video: Record<string, unknown> = {
    chromeMediaSource: kind,
    chromeMediaSourceId: streamId,
    maxFrameRate: options.fps,
  };
  if (options.maxHeight) video.maxHeight = options.maxHeight;

  const constraints = {
    audio: options.tabAudio
      ? { mandatory: { chromeMediaSource: kind, chromeMediaSourceId: streamId } }
      : false,
    video: { mandatory: video },
  } as unknown as MediaStreamConstraints;

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    // The overwhelmingly likely cause is an EXPIRED streamId (design §10.2), and
    // "Unknown error" is exactly the message we promised never to show.
    throw new Error(
      `Не удалось начать запись — идентификатор потока истёк или доступ отозван. Нажмите на иконку и сразу «Записать». (${
        err instanceof Error ? err.name : 'ошибка'
      })`,
    );
  }
}

/**
 * FIREFOX (inside the recorder window): getDisplayMedia.
 *
 * 🔴 `audio` is FALSE and cannot be otherwise: Firefox's getDisplayMedia returns
 * no audio track at all (BCD: audio → version_added: false). Tab and system audio
 * recording is IMPOSSIBLE in Firefox — not disabled by us, absent from the
 * platform. The UI says exactly that, and offers the microphone as the only
 * possible sound (design §1.1, §2.2, §8).
 *
 * Requires transient user activation → it is called from a click handler in the
 * window, never from the background (design §1.5).
 */
export async function openDisplayStream(options: StartOptions): Promise<MediaStream> {
  const video: MediaTrackConstraints = { frameRate: { ideal: options.fps } };
  if (options.maxHeight) video.height = { max: options.maxHeight };
  return navigator.mediaDevices.getDisplayMedia({ video, audio: false });
}

export interface AudioMix {
  /** The stream handed to MediaRecorder (video + the mixed audio track). */
  stream: MediaStream;
  /** Live mic level in 0..1, or null when there is no microphone. */
  level: () => number | null;
  /** True when a microphone track was actually obtained (the grant may be
   *  refused — we then keep recording video and say the mic is off). */
  hasMic: boolean;
  setMicMuted: (muted: boolean) => void;
  close: () => void;
}

/**
 * Compose the final recorded stream: capture video + (tab audio) + (microphone).
 *
 * ⚠️ Two non-obvious duties here.
 *   1. **Tab audio must be echoed back to the speakers.** Capturing tab audio
 *      through getUserMedia MUTES the tab for the user. Every screen recorder
 *      that forgets this ships with "the video has sound, but I heard nothing
 *      while recording". We reconnect the captured audio to the AudioContext
 *      destination so the user keeps hearing their own tab.
 *   2. **The mic prompt cannot come from the offscreen document** — it has no UI
 *      (design §5.9). The grant is per extension ORIGIN, so the visible recorder
 *      window asks for it once and the offscreen document then gets the device
 *      silently. If the grant is missing or refused, we degrade honestly: the
 *      video keeps recording WITHOUT sound rather than the capture failing.
 */
export async function mixAudio(
  captureStream: MediaStream,
  options: StartOptions,
): Promise<AudioMix> {
  const videoTracks = captureStream.getVideoTracks();
  const capturedAudio = captureStream.getAudioTracks();

  let micStream: MediaStream | null = null;
  if (options.mic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: options.micDeviceId ? { deviceId: { exact: options.micDeviceId } } : true,
      });
    } catch {
      micStream = null; // honest degradation — see (2) above
    }
  }

  // Nothing to mix → hand the capture stream straight through (cheapest path).
  if (capturedAudio.length === 0 && !micStream) {
    return {
      stream: new MediaStream(videoTracks),
      level: () => null,
      hasMic: false,
      setMicMuted: () => undefined,
      close: () => undefined,
    };
  }

  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();

  if (capturedAudio.length > 0) {
    const tabSrc = ctx.createMediaStreamSource(new MediaStream(capturedAudio));
    tabSrc.connect(dest); // into the recording
    tabSrc.connect(ctx.destination); // …and back to the speakers (duty 1 above)
  }

  let analyser: AnalyserNode | null = null;
  let micGain: GainNode | null = null;
  if (micStream) {
    const micSrc = ctx.createMediaStreamSource(micStream);
    micGain = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    micSrc.connect(micGain);
    micGain.connect(analyser);
    micGain.connect(dest);
    // 🔴 The mic is deliberately NOT connected to ctx.destination: that would
    // play the user's own voice out of their speakers and back into the mic.
  }

  const buf = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
  const stream = new MediaStream([...videoTracks, ...dest.stream.getAudioTracks()]);

  return {
    stream,
    hasMic: !!micStream,
    level: () => {
      if (!analyser || !buf) return null;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i += 1) {
        const v = ((buf[i] ?? 128) - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / buf.length) * 3);
    },
    setMicMuted: (muted) => {
      if (micGain) micGain.gain.value = muted ? 0 : 1;
      micStream?.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
    },
    close: () => {
      micStream?.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => undefined);
    },
  };
}

/**
 * Pick a MediaRecorder mimeType.
 *
 * Chrome 126+ writes MP4 (H.264 + AAC) straight out of MediaRecorder → on Chrome
 * an MP4 export needs NO transcoding at all (design §4.4, PLAN-2 §1.2). Firefox
 * cannot: it writes WebM only, so MP4 there is a MANDATORY re-encode at export
 * time. 🔴 We never write WebM bytes into a `.mp4` file — the returned type is
 * what is actually recorded, and the UI is told the truth (design §8).
 */
export function pickMimeType(format: VideoFormat, wantAudio: boolean): string {
  const a = wantAudio;
  const candidates: string[] =
    format === 'mp4'
      ? [
          a ? 'video/mp4;codecs=avc1.42E01E,mp4a.40.2' : 'video/mp4;codecs=avc1.42E01E',
          'video/mp4',
        ]
      : [
          a ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp9',
          a ? 'video/webm;codecs=vp8,opus' : 'video/webm;codecs=vp8',
          'video/webm',
        ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  // Last resort: let the browser choose. `MediaRecorder.mimeType` AFTER start()
  // reports what it really picked, and that is what we persist — never a guessed
  // extension.
  return '';
}

const BITRATE_TIERS: Record<StartOptions['quality'], number> = {
  high: 8_000_000,
  medium: 4_000_000,
  low: 1_500_000,
};

/** ⚠️ videoBitsPerSecond is a WISH, not a contract — the browser may ignore it.
 *  That is exactly why the target-size feature runs at EXPORT time and never at
 *  record time (design §3.1, §6.1, PLAN-2 §1.2). */
export function bitrateFor(quality: StartOptions['quality']): number {
  return BITRATE_TIERS[quality];
}

/**
 * 🔴 The 3000 ms TIMESLICE is mandatory. Without it MediaRecorder keeps the whole
 * file in memory until stop(), and a two-hour recording kills the tab (design
 * §10.3 — trap #1 of the genre). With it, every 3 s we get a chunk that goes
 * STRAIGHT to IndexedDB, and any crash costs at most those 3 seconds.
 */
export const TIMESLICE_MS = 3000;

export function startRecorder(
  stream: MediaStream,
  mimeType: string,
  videoBitsPerSecond: number,
  handlers: {
    onChunk: (blob: Blob) => void;
    onStop: () => void;
    onError: (err: Error) => void;
  },
): MediaRecorder {
  const rec = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond,
  });
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) handlers.onChunk(e.data);
  };
  rec.onstop = () => handlers.onStop();
  rec.onerror = (e) => {
    const err = (e as unknown as { error?: DOMException }).error;
    handlers.onError(err ?? new Error('MediaRecorder failed'));
  };
  rec.start(TIMESLICE_MS);
  return rec;
}

// ── Screenshots (design §4.2, §5.14, PLAN.md §6.1/§6.2) ─────────────────────

/** Chrome enforces MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2. We enforce it
 *  OURSELVES and tell the UI, because a silently swallowed click reads as "the
 *  extension is broken" (design §5.14). */
export const SHOT_COOLDOWN_MS = 550;
let lastShotAt = 0;

export function shotCooldownLeft(): number {
  return Math.max(0, SHOT_COOLDOWN_MS - (Date.now() - lastShotAt));
}

/**
 * Capture the visible area of the active tab.
 *
 * ⚠️ The result is in PHYSICAL pixels: CSS px × devicePixelRatio (PLAN.md §6.2).
 * On a 2× display a 1280-CSS-px viewport yields a 2560 px image. We never pretend
 * otherwise: the library and the editor show the real pixel size. And redaction
 * rectangles are stored as FRACTIONS of the frame, then multiplied by the
 * bitmap's real pixel dimensions — so the classic "selection was in CSS px, the
 * bitmap was in device px, the black box landed in the wrong place" bug (PLAN.md
 * §6.2) cannot occur here by construction.
 */
export async function captureScreenshot(windowId?: number): Promise<Blob> {
  const left = shotCooldownLeft();
  if (left > 0) {
    throw new Error(`Скриншоты ограничены двумя в секунду. Подождите ${left} мс.`);
  }
  lastShotAt = Date.now();
  const dataUrl = await browser.tabs.captureVisibleTab(windowId as number, { format: 'png' });
  if (!dataUrl) throw new Error('Не удалось снять эту вкладку.');
  return dataUrlToBlob(dataUrl);
}

/**
 * data: URL → Blob, decoded by hand.
 *
 * ⚠️ PLAN.md §6.3 suggests `fetch(dataUrl)`, and normally that is the tidy way.
 * It does not work HERE: our extension-pages CSP carries `connect-src 'none'`
 * (the structural "zero network" guarantee, design §9.1), and `connect-src`
 * governs fetch() to `data:` URLs as well — so the tidy version would be blocked
 * by our own policy, in the service worker, on the very first screenshot. atob +
 * Uint8Array touches no fetch machinery and cannot be blocked by any CSP.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const mime = header.slice(header.indexOf(':') + 1, header.indexOf(';')) || 'image/png';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
