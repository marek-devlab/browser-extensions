import { storage } from '#imports';
import type { Locale } from '@blur/ui';
import type { SeoReportEx } from './checks';

// Storage layout. The sync/local split is a hard requirement:
//   - `sync`  : lightweight UI prefs only. Quotas are HARD failures on exceed
//               (102,400 bytes total / 8,192 per item / 512 items). Prefs fit.
//   - `local` : cached reports and larger payloads. 10 MB, no per-item cap.
//
// A `SeoReport` (heading outlines, hreflang rows, check lists) can easily blow
// past the 8 KB per-item sync cap, so it lives in `local`; only the tiny prefs
// object goes in `sync`.
//
// `version` + `migrations` are declared from day one so the schema can evolve
// without wiping user data on update.

export interface PanelPrefs {
  defaultTab: 'seo' | 'a11y';
  theme: 'auto' | 'light' | 'dark';
}

export const panelPrefsItem = storage.defineItem<PanelPrefs>('sync:panelPrefs', {
  fallback: { defaultTab: 'seo', theme: 'auto' },
  version: 1,
  migrations: {
    // Populate as the prefs schema changes, e.g. `2: (old) => ({ ...old })`.
  },
});

export const lastReportItem = storage.defineItem<SeoReportEx | null>(
  'local:lastReport',
  {
    fallback: null,
    version: 1,
    migrations: {},
  },
);

/**
 * The user's chosen UI language. Independent of the browser's own UI locale and
 * of the theme; defaults to English on a fresh install (the switcher lives in the
 * DevTools panel header, beside the theme toggle). Read synchronously-seeded by
 * @blur/ui's useLocaleController on the React surfaces (popup / panel), and read
 * directly (`await localeItem.getValue()`) when the non-React content script
 * builds the SEO report so its check prose is localised too.
 */
export const localeItem = storage.defineItem<Locale>('local:locale', {
  fallback: 'en',
});
