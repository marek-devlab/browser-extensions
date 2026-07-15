import type { WeightState } from './assets-types';
import type { Units } from './storage';
import type { TFn } from './i18n';

// Formatting helpers. Pure, no DOM. Weight formatting respects the honesty rule:
// an unmeasured weight is words ("not measured"), never a fabricated 0 (design §7).
//
// The word-bearing formatters take an optional translator `t` (type-only import, so
// this stays React-free and light in the content-script bundle). When omitted they
// fall back to English — a safety net, never the normal path.

/** Bytes -> "184 KB" / "1.4 MB". `base` is 1024 or 1000 (the units pref). Unit
 *  suffixes are format tokens, not prose, so they are the same in every locale. */
export function formatBytes(bytes: number, base: Units = 1024): string {
  if (bytes === 0) return '0 B';
  const units = base === 1024 ? ['B', 'KB', 'MB', 'GB'] : ['B', 'kB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(base)));
  const value = bytes / base ** i;
  const rounded = i === 0 ? value : Number(value.toFixed(value >= 100 ? 0 : 1));
  return `${rounded} ${units[i]}`;
}

/** Render a WeightState as a user-facing string. Never returns "0" for unknowns. */
export function formatWeight(w: WeightState, base: Units = 1024, t?: TFn): string {
  switch (w.kind) {
    case 'measured':
      return formatBytes(w.bytes, base);
    case 'cache':
      return t ? t('weightCache') : '0 B (served from cache)';
    case 'unmeasured':
      return t ? t('weightNotMeasured') : 'not measured';
    case 'not-in-buffer':
      return t ? t('weightNoRecord') : 'no request record found';
  }
}

/** "2400 × 1600". */
export function formatDimensions(w: number, h: number): string {
  return `${w} × ${h}`;
}

/** A percentage for the overweight verdict, e.g. "90%". */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Seconds -> "3:07". A media duration, NOT a page timing — this extension draws no
 *  time axis and no waterfall; that boundary belongs to `perf` (design §8.1). */
export function formatDuration(seconds: number, t?: TFn): string {
  if (!Number.isFinite(seconds) || seconds < 0) return t ? t('durationUnknown') : 'unknown';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Hostname of a URL, or '' for blob:/data:/malformed (never throws). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
