import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeVideo,
  type VideoSample,
} from 'mediabunny';
import { computeBudget, BPP_FLOOR } from './budget';
import type {
  ExportSettings,
  PassResult,
  RedactionRegion,
  ScreenshotFormat,
  Watermark,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// ENCODING — WebCodecs via **mediabunny** (MPL-2.0, v1.50.x).
//
// 🔴 `mp4-muxer` / `webm-muxer` are DEPRECATED by their own author in favour of
// mediabunny; they are not used. 🔴 ffmpeg.wasm is NOT bundled: its default
// load() fetches the core from unpkg — remotely hosted code, an instant reject in
// both stores — and even bundled it costs ~30 MB with a GPL-tainted core and an
// AMO source review (PLAN-2 §1.2, design §12.2). If Firefox cannot encode H.264
// we say so and offer WebM. We do not smuggle in a compiler.
//
// VideoFrame lifetime (PLAN-2 §1.3, design §10.4): we never construct a raw
// VideoFrame and never touch VideoEncoder directly. The `process` hook below is
// handed a mediabunny `VideoSample`, draws it onto ONE reused OffscreenCanvas and
// returns that canvas; mediabunny wraps it, encodes it and closes every frame it
// creates, and applies encoder backpressure internally. That is deliberate: the
// "leaked VideoFrame exhausts the GPU buffer pool and the pipeline silently stops
// moving" failure mode is designed out rather than guarded against.

/** The one probe that decides whether Firefox gets MP4 at all (design §4.4, §8,
 *  §12.1, PLAN-2 §11). Runs BEFORE the option is shown — never "offer MP4, fail
 *  after three minutes of encoding". Chrome always passes; Firefox is the open
 *  question, and this is the answer at runtime, on the user's actual machine. */
export async function canEncodeH264(width = 1280, height = 720): Promise<boolean> {
  // 1) The raw WebCodecs probe named in PLAN-2 §11.
  try {
    const VE = (globalThis as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder;
    if (VE?.isConfigSupported) {
      const res = await VE.isConfigSupported({
        codec: 'avc1.42001f', // H.264 Baseline L3.1
        width,
        height,
      });
      if (res.supported) return true;
    }
  } catch {
    /* fall through to mediabunny's own probe */
  }
  // 2) mediabunny's probe — it also knows about its custom-coder registrations.
  try {
    return await canEncodeVideo('avc', { width, height });
  } catch {
    return false;
  }
}

export async function canEncodeVp9(width = 1280, height = 720): Promise<boolean> {
  try {
    return await canEncodeVideo('vp9', { width, height });
  } catch {
    return false;
  }
}

// ── Compositing: redaction fills + watermark, baked into PIXELS ──────────────

export interface Composite {
  regions: RedactionRegion[];
  watermark: Watermark | null;
  logo: ImageBitmap | null;
}

/**
 * Load a watermark logo.
 *
 * 🔴 The ONLY accepted source is a Blob — a File the user picked, kept in
 * IndexedDB. A Blob does not taint the canvas. An EXTERNAL URL would: the canvas
 * goes tainted and `convertToBlob()` throws a SecurityError at the very END of the
 * export, after minutes of encoding (design §9.3). That is not a thing you fix
 * with validation; it is a thing that must not exist in the UI — which is why
 * there is no "logo URL" field anywhere, and why this function cannot even take a
 * string.
 */
export async function loadLogo(source: Blob | null | undefined): Promise<ImageBitmap | null> {
  if (!source) return null;
  return createImageBitmap(source);
}

function regionActiveAt(r: RedactionRegion, tSec: number): boolean {
  const t = tSec * 1000;
  if (r.inMs != null && t < r.inMs) return false;
  if (r.outMs != null && t > r.outMs) return false;
  return true;
}

/**
 * Paint one frame's overlays onto `ctx`, in PIXELS.
 *
 * 🔴 Solid fill is applied to the pixels, and nothing about it is written into
 * the container — no layer, no alpha hole, no annotation metadata. That is the
 * classic way redactions leak (PDF editors leaked exactly this way for years)
 * and design §7.4 forbids it outright.
 *
 * ⚠️ Blur and pixelate are COSMETIC and reversible (Unredacter, Depix). They are
 * implemented because people legitimately want to de-emphasise clutter — but the
 * UI never offers them for secrets, and the export summary keeps saying so (§7).
 */
export function paintOverlays(
  ctx: OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  w: number,
  h: number,
  comp: Composite,
  tSec: number,
): void {
  for (const r of comp.regions) {
    if (!regionActiveAt(r, tSec)) continue;
    const x = Math.round(r.x * w);
    const y = Math.round(r.y * h);
    const rw = Math.max(1, Math.round(r.w * w));
    const rh = Math.max(1, Math.round(r.h * h));

    if (r.mode === 'fill') {
      ctx.save();
      ctx.filter = 'none';
      ctx.fillStyle = r.fill ?? '#000000';
      ctx.fillRect(x, y, rw, rh);
      ctx.restore();
      continue;
    }

    if (r.mode === 'pixelate') {
      // Downscale then upscale with smoothing off — the honest "big blocks" look.
      const block = Math.max(4, Math.round(Math.min(rw, rh) / 8));
      const sw = Math.max(1, Math.round(rw / block));
      const sh = Math.max(1, Math.round(rh / block));
      const tmp = new OffscreenCanvas(sw, sh);
      const tctx = tmp.getContext('2d');
      if (!tctx) continue;
      tctx.imageSmoothingEnabled = false;
      tctx.drawImage(source, x, y, rw, rh, 0, 0, sw, sh);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.filter = 'none';
      ctx.drawImage(tmp, 0, 0, sw, sh, x, y, rw, rh);
      ctx.restore();
      continue;
    }

    // Blur: draw the region through ctx.filter into a scratch canvas the size of
    // the region, so the gaussian does not bleed sharp pixels in from outside
    // (PLAN.md §6.3's edge artefact).
    const pad = Math.round(Math.min(rw, rh) * 0.25) + 8;
    const bw = rw + pad * 2;
    const bh = rh + pad * 2;
    const tmp = new OffscreenCanvas(bw, bh);
    const tctx = tmp.getContext('2d');
    if (!tctx) continue;
    tctx.filter = `blur(${Math.max(6, Math.round(Math.min(rw, rh) / 6))}px)`;
    tctx.drawImage(source, x - pad, y - pad, bw, bh, 0, 0, bw, bh);
    ctx.save();
    ctx.filter = 'none';
    ctx.drawImage(tmp, pad, pad, rw, rh, x, y, rw, rh);
    ctx.restore();
  }

  const wm = comp.watermark;
  if (!wm || (!wm.text && !comp.logo)) return;

  ctx.save();
  ctx.filter = 'none';
  ctx.globalAlpha = Math.min(1, Math.max(0.1, wm.opacity / 100));
  // Size is a % of frame HEIGHT, never px: at 480p a px-sized logo covers half
  // the frame (design §3.3).
  const size = Math.max(10, Math.round((wm.sizePct / 100) * h));
  const margin = Math.round(h * 0.02);

  let boxW = 0;
  let boxH = 0;
  if (comp.logo) {
    boxH = size;
    boxW = Math.round((comp.logo.width / comp.logo.height) * size);
  }
  if (wm.text) {
    // 🔴 fillText on a canvas — not innerHTML. There is no XSS vector through the
    // watermark text because there is no HTML anywhere near it (design §9.2).
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    const m = ctx.measureText(wm.text);
    boxW = Math.max(boxW, Math.ceil(m.width));
    boxH += (comp.logo ? Math.round(size * 0.3) : 0) + size;
  }

  const [px, py] = anchor(wm.position, w, h, boxW, boxH, margin);
  let cursorY = py;
  if (comp.logo) {
    const lw = Math.round((comp.logo.width / comp.logo.height) * size);
    ctx.drawImage(comp.logo, px, cursorY, lw, size);
    cursorY += size + Math.round(size * 0.3);
  }
  if (wm.text) {
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = Math.max(2, Math.round(size / 6));
    ctx.fillText(wm.text, px, cursorY);
  }
  ctx.restore();
}

function anchor(
  pos: Watermark['position'],
  w: number,
  h: number,
  bw: number,
  bh: number,
  m: number,
): [number, number] {
  const x =
    pos.endsWith('left') ? m : pos.endsWith('right') ? w - bw - m : Math.round((w - bw) / 2);
  const y =
    pos.startsWith('top') ? m : pos.startsWith('bottom') ? h - bh - m : Math.round((h - bh) / 2);
  return [Math.max(0, x), Math.max(0, y)];
}

// ── Video export ────────────────────────────────────────────────────────────

export interface EncodeProgress {
  pass: number;
  maxPasses: number;
  /** 0..1 WITHIN the current pass. There is deliberately no single global % — it
   *  would jump backwards on a new pass (design §2.9). */
  progress: number;
  bytesSoFar: number;
  /** Linear extrapolation of the final size from bytes-so-far ÷ progress. */
  projectedBytes: number | null;
}

export interface EncodeRequest {
  source: Blob;
  settings: ExportSettings;
  composite: Composite;
  /** Source dimensions; used when the user keeps "as recorded". */
  sourceWidth: number;
  sourceHeight: number;
  sourceDurationMs: number;
  onProgress: (p: EncodeProgress) => void;
  onPass: (p: PassResult) => void;
  signal?: AbortSignal;
}

export interface EncodeResult {
  blob: Blob;
  passes: PassResult[];
  /** true when the last pass still missed a HARD target (design §2.10). */
  missedTarget: boolean;
}

/** Below this we let the encoder run free; below the floor the picture falls
 *  apart and the size barely drops, so chasing it is pointless (design §6.4). */
function floorBitrate(w: number, h: number, fps: number): number {
  return BPP_FLOOR * w * h * fps;
}

/**
 * ONE conversion pass. Returns the produced bytes.
 *
 * Output goes to a BufferTarget — the WHOLE re-encoded file materialises in RAM,
 * on every browser, before it becomes a Blob. There is no streaming-to-disk path
 * here: no `streamCopy`, no `saveStreaming`, no FileSystemWritableFileStream. In
 * practice this is fine, because a target-SIZE export is bounded by the target
 * itself (≤ a few hundred MB in every realistic case). The one case that can
 * genuinely blow up is an UNBOUNDED re-encode of a multi-gigabyte recording, and
 * that is guarded UPSTREAM, not here: ExportDialog pre-warns on `bigRam` (a clip
 * over RAM_EXPORT_WARN_BYTES that is not a stream-copy) and steers the user to
 * "as recorded", trimming, or a lower resolution before a byte is encoded
 * (design §10.3).
 */
async function runPass(
  req: EncodeRequest,
  bitrate: number | null,
  passIndex: number,
  targetBytes: number | null,
): Promise<{ bytes: number; blob: Blob | null; aborted: boolean }> {
  const { settings, composite } = req;
  const input = new Input({ source: new BlobSource(req.source), formats: ALL_FORMATS });

  const width = settings.resolution.asRecorded ? undefined : settings.resolution.width;
  const height = settings.resolution.asRecorded ? undefined : settings.resolution.height;
  const outW = width ?? req.sourceWidth;
  const outH = height ?? req.sourceHeight;

  const target = new BufferTarget();
  const format =
    settings.format === 'mp4'
      ? new Mp4OutputFormat({ fastStart: 'in-memory' })
      : new WebMOutputFormat();
  const output = new Output({ format, target });

  let bytesSoFar = 0;
  target.on('write', ({ end }) => {
    bytesSoFar = Math.max(bytesSoFar, end);
  });

  // ONE canvas reused for every frame. mediabunny copies it into a VideoSample
  // per frame (and closes that sample), so reuse is safe and allocation-free.
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  const needsOverlay = composite.regions.length > 0 || !!composite.watermark;

  const conversion = await Conversion.init({
    input,
    output,
    trim: {
      start: settings.trimInMs / 1000,
      end: settings.trimOutMs / 1000,
    },
    video: {
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      fit: 'contain',
      ...(settings.fps !== 'as-recorded' ? { frameRate: settings.fps } : {}),
      codec: settings.format === 'mp4' ? 'avc' : 'vp9',
      ...(bitrate ? { bitrate: Math.round(bitrate) } : {}),
      ...(needsOverlay && ctx
        ? {
            processedWidth: outW,
            processedHeight: outH,
            process: (sample: VideoSample) => {
              // The sample arrives already resized/frame-rate-corrected. We draw
              // it, paint the overlays on top, and hand back the canvas. We do
              // NOT close `sample` — mediabunny owns it (and closing it here
              // would be a use-after-free); we also never create a VideoFrame, so
              // there is nothing of ours left to leak.
              ctx.filter = 'none';
              ctx.clearRect(0, 0, outW, outH);
              sample.draw(ctx, 0, 0, outW, outH);
              paintOverlays(ctx, canvas, outW, outH, composite, sample.timestamp);
              return canvas;
            },
          }
        : {}),
    },
    audio: settings.keepAudio
      ? { bitrate: settings.audioBps, codec: settings.format === 'mp4' ? 'aac' : 'opus' }
      : { discard: true },
  });

  if (!conversion.isValid) {
    const why = conversion.discardedTracks.map((d) => d.reason).join(', ');
    throw new Error(
      `Этот файл не удаётся перекодировать в выбранный формат (${why || 'нет подходящего кодека'}). Исходная запись цела.`,
    );
  }

  let aborted = false;
  let abortProgress = 0;
  conversion.onProgress = (progress) => {
    req.onProgress({
      pass: passIndex,
      maxPasses: settings.maxPasses,
      progress,
      bytesSoFar,
      projectedBytes: progress > 0.05 ? Math.round(bytesSoFar / progress) : null,
    });
    // ⚠️ EARLY ABORT (design §2.9, §6.4): once ≥30% in, if the projection already
    // overshoots the target by >25%, this pass is dead — kill it and recompute
    // the bitrate rather than burning the remaining CPU to learn what we know.
    if (
      targetBytes &&
      progress >= 0.3 &&
      bytesSoFar / progress > targetBytes * 1.25 &&
      !aborted
    ) {
      aborted = true;
      abortProgress = progress;
      void conversion.cancel();
    }
  };

  const onAbort = () => void conversion.cancel();
  req.signal?.addEventListener('abort', onAbort);

  try {
    await conversion.execute();
  } catch (err) {
    if (err instanceof ConversionCanceledError) {
      if (req.signal?.aborted) throw err;
      // Project the full size from the progress fraction AT CANCEL TIME — not a
      // hardcoded 0.3. The early-abort trips at ≥30% but may fire later, so
      // dividing by a fixed 0.3 would inflate the estimate. Floor the divisor so
      // an abort that somehow lands near 0% can't divide-by-zero.
      const frac = Math.max(abortProgress, 0.05);
      return { bytes: Math.round(bytesSoFar / frac), blob: null, aborted: true };
    }
    throw err;
  } finally {
    req.signal?.removeEventListener('abort', onAbort);
  }

  const buffer = target.buffer;
  if (!buffer) throw new Error('Кодирование завершилось без данных.');
  const blob = new Blob([buffer], {
    type: settings.format === 'mp4' ? 'video/mp4' : 'video/webm',
  });
  return { bytes: blob.size, blob, aborted: false };
}

/**
 * The ITERATIVE manual 2-pass (design §6.4, PLAN-2 §1.2). There is no real 2-pass
 * rate control in any browser, so:
 *
 *   pass 1: bps₀ = the pre-computed budget bitrate (utils/budget.ts)
 *   pass n: bpsₙ = bpsₙ₋₁ × target ÷ actualₙ₋₁,
 *           clamped to ±40% per pass (else it oscillates)
 *           and floored at bpp 0.015 (else it chases the unreachable forever)
 *   stop:   hit · floor · passes exhausted · user said "take it as is"
 *
 * ⚠️ UNDERSHOOT IS A HIT. 8.9 MB against a 10 MB target is DONE — spending
 * another 40 s of CPU to spend the last 1.1 MB is offered as a button, never
 * done by default. That is what usually turns 3 passes into 2.
 */
export async function runTargetEncode(req: EncodeRequest): Promise<EncodeResult> {
  const { settings } = req;
  const durationSec = Math.max(0.001, (settings.trimOutMs - settings.trimInMs) / 1000);
  const outW = settings.resolution.asRecorded ? req.sourceWidth : settings.resolution.width;
  const outH = settings.resolution.asRecorded ? req.sourceHeight : settings.resolution.height;
  const fps = settings.fps === 'as-recorded' ? 30 : settings.fps;

  const passes: PassResult[] = [];

  // No target → a single pass at the encoder's own discretion.
  if (!settings.targetBytes) {
    const r = await runPass(req, null, 1, null);
    if (!r.blob) throw new Error('Кодирование прервано.');
    passes.push({ pass: 1, bitrate: 0, actualBytes: r.bytes, hit: true });
    req.onPass(passes[0]!);
    return { blob: r.blob, passes, missedTarget: false };
  }

  const target = settings.targetBytes;
  const budget = computeBudget({
    targetBytes: target,
    durationSec,
    width: outW,
    height: outH,
    fps,
    audioBps: settings.keepAudio ? settings.audioBps : 0,
  });

  const floor = floorBitrate(outW, outH, fps);
  let bitrate = Math.max(floor, budget.videoBps);

  /** Every pass that actually produced bytes. The winner is chosen at the end,
   *  never "the last one" — a later pass can easily be worse. */
  const candidates: { blob: Blob; bytes: number }[] = [];

  // "Under target is a success" — anything in [target×(1−tol), target] is a hit.
  const tolerance = 0.1;

  for (let i = 1; i <= settings.maxPasses; i += 1) {
    if (req.signal?.aborted) break;
    const r = await runPass(req, bitrate, i, target);

    if (r.aborted) {
      passes.push({
        pass: i,
        bitrate,
        actualBytes: r.bytes,
        hit: false,
        aborted: true,
        note: 'Проход прерван досрочно: прогноз уже был мимо цели.',
      });
      req.onPass(passes[passes.length - 1]!);
    } else if (r.blob) {
      const under = r.bytes <= target;
      const hit = under && r.bytes >= target * (1 - tolerance);
      candidates.push({ blob: r.blob, bytes: r.bytes });
      passes.push({ pass: i, bitrate, actualBytes: r.bytes, hit });
      req.onPass(passes[passes.length - 1]!);
      // ⚠️ Undershoot IS a hit (design §6.4): stop. Spending another pass to use
      // up the last megabyte of budget is offered as a button, never taken by us.
      if (hit || under) break;
    }

    // Correct the bitrate for the next pass, clamped (design §6.4).
    const actual = passes[passes.length - 1]!.actualBytes || target;
    const raw = bitrate * (target / actual);
    const clamped = Math.min(bitrate * 1.4, Math.max(bitrate * 0.6, raw));
    const next = Math.max(floor, clamped);
    if (next <= floor * 1.001 && actual > target) {
      // The floor is the floor: below 0.015 bpp the picture disintegrates and the
      // size stops falling. Chasing it is not persistence, it is a lie (§2.10).
      break;
    }
    if (Math.abs(next - bitrate) / bitrate < 0.02) break; // converged — more passes are theatre
    bitrate = next;
  }

  if (candidates.length === 0) throw new Error('Кодирование не дало результата.');
  const under = candidates.filter((c) => c.bytes <= target);
  const best = under.length
    ? // biggest one that still fits = best quality within the ceiling
      under.reduce((a, b) => (b.bytes > a.bytes ? b : a))
    : // nothing fits → the smallest we managed, so "save as is" is still real
      candidates.reduce((a, b) => (b.bytes < a.bytes ? b : a));

  return { blob: best.blob, passes, missedTarget: best.bytes > target };
}

// ── Screenshots (design §6.6) ───────────────────────────────────────────────

export interface ShotRender {
  blob: Blob;
  width: number;
  height: number;
}

/** Bake redaction + watermark into a still image. Same rule as video: the fill
 *  goes into the PIXELS, not into a layer (design §7.4). */
export async function renderScreenshot(
  bitmap: ImageBitmap,
  comp: Composite,
  format: ScreenshotFormat,
  scale: number,
  quality?: number,
): Promise<ShotRender> {
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D недоступен.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  paintOverlays(ctx, canvas, w, h, comp, 0);
  const type = `image/${format}` as const;
  const blob = await canvas.convertToBlob({
    type,
    ...(format === 'png' ? {} : { quality: quality ?? 0.92 }),
  });
  return { blob, width: w, height: h };
}

/**
 * Hit a size target on an image by binary-searching `quality` — 6–8 iterations,
 * ~10–40 ms each, so no progress screen is warranted (design §6.6).
 *
 * ⚠️ PNG is LOSSLESS: `quality` does nothing there. The caller must offer
 * "PNG can't be compressed to a size — switch to JPEG/WebP?" rather than
 * pretending to try (design §6.6).
 */
export async function encodeImageToTarget(
  bitmap: ImageBitmap,
  comp: Composite,
  targetBytes: number,
  type: 'jpeg' | 'webp',
  scale = 1,
): Promise<ShotRender & { quality: number }> {
  let lo = 0.2;
  let hi = 0.98;
  let bestOut: ShotRender | null = null;
  let bestQ = lo;
  for (let i = 0; i < 8; i += 1) {
    const q = (lo + hi) / 2;
    const out = await renderScreenshot(bitmap, comp, type, scale, q);
    if (out.blob.size <= targetBytes) {
      bestOut = out;
      bestQ = q;
      lo = q; // room to spare → try higher quality
    } else {
      hi = q;
    }
    if (hi - lo < 0.02) break;
  }
  if (!bestOut) {
    // Even the lowest quality overshoots — return it and let the UI say so.
    const out = await renderScreenshot(bitmap, comp, type, scale, 0.2);
    return { ...out, quality: 0.2 };
  }
  return { ...bestOut, quality: bestQ };
}

/** The re-encode path materialises its output in an ArrayBuffer (BufferTarget).
 *  Above this we warn BEFORE starting instead of OOM-ing at 90% (design §10.3).
 *  "Как записано" (stream copy) and screenshots have no such ceiling. */
export const RAM_EXPORT_WARN_BYTES = 1.5 * 1024 * 1024 * 1024;
