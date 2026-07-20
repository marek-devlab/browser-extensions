import { storage } from '#imports';
import type { Locale } from '@blur/ui';
import type { CategoryId } from './units';

// Storage layout — 🔴 PREFERENCES + a small cache only. Everything is
// `storage.local` (never `sync`): none of it is data ABOUT the user. It is a
// theme, a rounding precision, a default US/Imperial reading, and a list of
// favourite conversion pairs the user pinned. The fetched RATE TABLES live in
// their own items in utils/rates.ts; the user's AMOUNT is never persisted — it
// lives in the popup's React state and dies with the popup.
//
// A defensive `normalizeSettings` validates every field back onto its closed union
// before it can reach the UI, so a corrupt or hand-edited entry can never break a
// converter or select an impossible unit.

export type Theme = 'auto' | 'light' | 'dark';

/** Default reading for the US/Imperial ambiguity when a bare token ("gallon") is
 *  parsed. Surfaced in the UI, never silent. */
export type MeasureSystem = 'us' | 'imperial';

export interface ConvertSettings {
  theme: Theme;
  /** Significant digits shown in results (2–12). */
  precision: number;
  /** Which reading a bare US/Imperial token defaults to. */
  system: MeasureSystem;
}

export const SETTINGS_KEYS = ['theme', 'precision', 'system'] as const satisfies readonly (keyof ConvertSettings)[];

export const DEFAULT_SETTINGS: ConvertSettings = {
  theme: 'auto',
  precision: 6,
  system: 'us',
};

export interface Favourite {
  mode: 'unit' | 'currency';
  /** Present for `mode: 'unit'`. */
  category?: CategoryId;
  from: string;
  to: string;
}

export const settingsItem = storage.defineItem<ConvertSettings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
  version: 1,
});

export const favouritesItem = storage.defineItem<Favourite[]>('local:favourites', {
  fallback: [],
});

/** Runtime UI language — its OWN item (default English), seeded/read independently
 *  of the rest, matching the house pattern. */
export const localeItem = storage.defineItem<Locale>('local:locale', { fallback: 'en' });

export function normalizeSettings(raw: unknown): ConvertSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const one = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

  let precision = typeof r.precision === 'number' && Number.isFinite(r.precision) ? Math.round(r.precision) : DEFAULT_SETTINGS.precision;
  precision = Math.min(12, Math.max(2, precision));

  return {
    theme: one(r.theme, ['auto', 'light', 'dark'] as const, DEFAULT_SETTINGS.theme),
    precision,
    system: one(r.system, ['us', 'imperial'] as const, DEFAULT_SETTINGS.system),
  };
}

/** Validate a stored favourites list (drop anything malformed). */
export function normalizeFavourites(raw: unknown): Favourite[] {
  if (!Array.isArray(raw)) return [];
  const out: Favourite[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    if ((f.mode !== 'unit' && f.mode !== 'currency') || typeof f.from !== 'string' || typeof f.to !== 'string') {
      continue;
    }
    out.push({
      mode: f.mode,
      category: typeof f.category === 'string' ? (f.category as CategoryId) : undefined,
      from: f.from,
      to: f.to,
    });
    if (out.length >= 40) break; // a pin list, not a database
  }
  return out;
}

/* Compile-time backstop: SETTINGS_KEYS must equal keyof ConvertSettings exactly, so
 * a new field can't be added silently. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _keysAreClosed: Exact<(typeof SETTINGS_KEYS)[number], keyof ConvertSettings> = true;
export const SCHEMA_GUARDS = { _keysAreClosed } as const;
