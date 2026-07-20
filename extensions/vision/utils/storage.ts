import { storage } from '#imports';
import type { Locale } from '@blur/ui';

// Storage layout — PREFERENCES ONLY. The simulation itself is per-tab and
// ephemeral (it lives as injected filter defs on the page and dies on reload);
// nothing about the page or the user is ever persisted. This holds the UI theme,
// the runtime locale, and the last condition set so reopening the popup resumes
// where the user left off. There is deliberately no field that holds page data,
// a URL, or any identifier.

export type Theme = 'auto' | 'light' | 'dark';

/** The single colour-vision choice (they don't combine meaningfully, so it's a
 *  radio, not a set). `achromatopsia` is total; the three dichromacies carry a
 *  severity for the anomalous-trichromacy slider. */
export type CvdChoice =
  | 'none'
  | 'protanopia'
  | 'deuteranopia'
  | 'tritanopia'
  | 'achromatopsia';

export interface VisionSettings {
  theme: Theme;
  /** Colour-vision deficiency (single-select). */
  cvd: CvdChoice;
  /** 0..1 severity for the three dichromacies (ignored for achromatopsia/none).
   *  ⚠️ Partial severity is an interpolation approximation — exact only at 1.0. */
  cvdSeverity: number;
  /** 0..1 low-vision intensities; 0 = off. */
  cataract: number;
  refractiveBlur: number;
  lowContrast: number;
  /** Quick reliance-on-colour check. */
  grayscale: boolean;
}

export const DEFAULT_SETTINGS: VisionSettings = {
  theme: 'auto',
  cvd: 'none',
  cvdSeverity: 1,
  cataract: 0,
  refractiveBlur: 0,
  lowContrast: 0,
  grayscale: false,
};

export const SETTINGS_KEYS = [
  'theme',
  'cvd',
  'cvdSeverity',
  'cataract',
  'refractiveBlur',
  'lowContrast',
  'grayscale',
] as const satisfies readonly (keyof VisionSettings)[];

/** Runtime UI language — its own item (default English), outside the settings
 *  schema so it can be seeded/read independently. */
export const localeItem = storage.defineItem<Locale>('local:locale', { fallback: 'en' });

export const settingsItem = storage.defineItem<VisionSettings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
  version: 1,
  migrations: {},
});

/** Defensive read: storage.local can be corrupt or hand-edited. Every field is
 *  validated and clamped so an unknown value can never reach the injected filter
 *  builder (which stamps numbers straight into an SVG). */
export function normalizeSettings(raw: unknown): VisionSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const one = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  const bool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb);
  const unit = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;

  return {
    theme: one(r.theme, ['auto', 'light', 'dark'] as const, DEFAULT_SETTINGS.theme),
    cvd: one(
      r.cvd,
      ['none', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'] as const,
      DEFAULT_SETTINGS.cvd,
    ),
    cvdSeverity:
      typeof r.cvdSeverity === 'number' && Number.isFinite(r.cvdSeverity)
        ? Math.min(1, Math.max(0, r.cvdSeverity))
        : 1,
    cataract: unit(r.cataract),
    refractiveBlur: unit(r.refractiveBlur),
    lowContrast: unit(r.lowContrast),
    grayscale: bool(r.grayscale, false),
  };
}

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _keysAreClosed: Exact<(typeof SETTINGS_KEYS)[number], keyof VisionSettings> = true;
export const SCHEMA_GUARDS = { _keysAreClosed } as const;
