// Target-size budget math (design capture.md §6.3) — the killer feature, and the
// ONE piece of domain logic implemented FOR REAL in this scaffold. It is pure
// arithmetic over numbers we already know (duration, resolution, fps, audio
// bitrate), so it runs in ~200 µs with zero encoded frames. The honesty of the
// whole product rests on showing the user "10 MB is mush" BEFORE burning three
// minutes of CPU, not after (design §0, §2.7, §6.3).
//
// NONE of this encodes anything. The actual 2-pass encoder that consumes these
// numbers is stubbed in utils/media.ts.

import type { MsgKey } from './i18n';

/** 3% reserved for container overhead / indices (design §6.3). */
const CONTAINER_OVERHEAD = 0.03;

/** Absolute bpp floor. Below this the picture falls apart and size barely drops,
 *  so the export button is BLOCKED here (design §6.3 "каша", §6.4 floor). */
export const BPP_FLOOR = 0.015;

export type QualityVerdict = 'excellent' | 'good' | 'acceptable' | 'poor' | 'mush';

export interface BudgetInput {
  targetBytes: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  /** 0 when audio is dropped. */
  audioBps: number;
}

export interface BudgetResult {
  /** Bytes actually available for VIDEO after overhead + audio (may be ≤ 0). */
  videoBytes: number;
  /** The video bitrate the encoder should aim for, in bits/sec. */
  videoBps: number;
  /** Bits per pixel — the quality yardstick (design §6.3). */
  bpp: number;
  verdict: QualityVerdict;
  /** Dots for the ●●●○○ scale (1..5). */
  dots: number;
  /** true when the target is arithmetically impossible (audio alone exceeds it,
   *  or video bytes ≤ 0). Distinct from `verdict==='mush'` which is achievable
   *  but unreadable. */
  impossible: boolean;
  /** Bytes the audio track will consume — surfaced right on the "keep audio"
   *  label, because on short clips it eats a third to half the budget (§6.3). */
  audioBytes: number;
}

/**
 * The core formula (design §6.3):
 *
 *   budget_bits = target_bytes × 8 × (1 − overhead)
 *   audio_bits  = audio_bps × duration
 *   video_bps   = (budget_bits − audio_bits) / duration
 *   bpp         = video_bps / (width × height × fps)
 */
export function computeBudget(input: BudgetInput): BudgetResult {
  const { targetBytes, durationSec, width, height, fps, audioBps } = input;
  const safeDuration = Math.max(durationSec, 0.001);

  const budgetBits = targetBytes * 8 * (1 - CONTAINER_OVERHEAD);
  const audioBits = audioBps * safeDuration;
  const audioBytes = audioBits / 8;

  const videoBits = budgetBits - audioBits;
  const videoBps = videoBits / safeDuration;
  const videoBytes = videoBits / 8;

  const pixelsPerSec = Math.max(width * height * fps, 1);
  const bpp = videoBps / pixelsPerSec;

  const impossible = videoBytes <= 0;
  const verdict = impossible ? 'mush' : verdictForBpp(bpp);

  return {
    videoBytes,
    videoBps,
    bpp,
    verdict,
    dots: DOTS[verdict],
    impossible,
    audioBytes,
  };
}

const DOTS: Record<QualityVerdict, number> = {
  excellent: 5,
  good: 4,
  acceptable: 3,
  poor: 2,
  mush: 1,
};

/** Screen content (static regions, hard edges) compresses better than camera, so
 *  this scale is softer than a cinematic one — and it is an ESTIMATE, marked "≈"
 *  everywhere it surfaces (design §6.3). */
export function verdictForBpp(bpp: number): QualityVerdict {
  if (bpp >= 0.1) return 'excellent';
  if (bpp >= 0.05) return 'good';
  if (bpp >= 0.03) return 'acceptable';
  if (bpp >= BPP_FLOOR) return 'poor';
  return 'mush';
}

/** The per-verdict message keys, resolved to text at the display site through the
 *  i18n catalog (utils/i18n.ts). Kept here so the verdict→copy mapping stays with
 *  the verdict logic; the actual strings live in the catalog, translated. */
export const VERDICT_LABEL_KEY: Record<QualityVerdict, MsgKey> = {
  excellent: 'verdict_excellent_label',
  good: 'verdict_good_label',
  acceptable: 'verdict_acceptable_label',
  poor: 'verdict_poor_label',
  mush: 'verdict_mush_label',
};

export const VERDICT_NOTE_KEY: Record<QualityVerdict, MsgKey> = {
  excellent: 'verdict_excellent_note',
  good: 'verdict_good_note',
  acceptable: 'verdict_acceptable_note',
  poor: 'verdict_poor_note',
  mush: 'verdict_mush_note',
};

/** The tone chip for a verdict (presentation-neutral, so it stays here). */
export const VERDICT_TONE: Record<QualityVerdict, 'ok' | 'warn' | 'poor'> = {
  excellent: 'ok',
  good: 'ok',
  acceptable: 'warn',
  poor: 'warn',
  mush: 'poor',
};

/** The export button is disabled iff the plan is mush/impossible AND the user has
 *  not explicitly overridden via the "export anyway" disclosure (design §2.7). */
export function isExportBlocked(result: BudgetResult): boolean {
  return result.verdict === 'mush' || result.impossible;
}

/**
 * A size-fit escape route. It carries the catalog KEY plus the raw numbers/verdict
 * it needs; the display site (ExportDialog) resolves them to text so the copy is
 * translated — the logic stays language-agnostic.
 */
export interface Suggestion {
  id: string;
  labelKey: MsgKey;
  /** The verdict word to interpolate into the label, when the key expects one. */
  verdict?: QualityVerdict;
  /** Half fps for the downscale option, when the key expects it. */
  fps?: number;
  /** MB freed by dropping audio, when the key expects it. */
  mb?: number;
  /** true = jumps to the trim tool instead of re-running the budget. */
  toTrim?: boolean;
}

/**
 * Honest, RE-COMPUTED escape routes when the target is out of reach (design
 * §2.7, §2.10, §6.3). Each option is re-run through computeBudget so the numbers
 * are real, not decorative. This is deliberately small in the scaffold: it shows
 * the two strongest levers (downscale, drop fps) plus audio and trim.
 */
export function suggestionsFor(input: BudgetInput): Suggestion[] {
  const out: Suggestion[] = [];

  // Downscale to 480p at half fps — the classic "make 10 MB work" move (§6.3).
  const half = computeBudget({
    ...input,
    width: 854,
    height: 480,
    fps: Math.min(input.fps, 15),
  });
  out.push({
    id: 'downscale-480',
    labelKey: 'sugg_downscale',
    fps: Math.min(input.fps, 15),
    verdict: half.verdict,
  });

  // Drop frame rate only.
  const lowFps = computeBudget({ ...input, fps: 15 });
  out.push({ id: 'fps-15', labelKey: 'sugg_fps15', verdict: lowFps.verdict });

  // Drop audio → frees its bytes for video.
  if (input.audioBps > 0) {
    const noAudio = computeBudget({ ...input, audioBps: 0 });
    out.push({
      id: 'drop-audio',
      labelKey: 'sugg_drop_audio',
      mb: Math.round(((noAudio.videoBytes - computeBudget(input).videoBytes) / 1024 / 1024) * 10) / 10,
    });
  }

  // Trim is the strongest lever of all: seconds cut bytes linearly (§6.3, §14.1).
  out.push({ id: 'trim', labelKey: 'sugg_trim', toTrim: true });

  return out;
}
