import { storage } from '#imports';
import type { PageInsight } from '@blur/core';
import type { Locale } from '@blur/ui';

// Runtime UI language. Persisted per-device in storage.local (like the PSI config)
// so it never rides sync quotas, and defaults to English regardless of the
// browser's own UI language (see @blur/ui's DEFAULT_LOCALE). The popup and the
// DevTools panel each wire this into `useLocaleController`.
export const localeItem = storage.defineItem<Locale>('local:locale', {
  fallback: 'en',
});

// Storage layout (PLAN.md §13). The sync/local split is a hard requirement:
//   - `sync`  : lightweight UI prefs only. Quotas are HARD failures on exceed
//               (102,400 bytes total / 8,192 per item / 512 items). Prefs fit.
//   - `local` : cached reports and larger payloads. 10 MB, no per-item cap.
//
// `version` + `migrations` are declared from day one so the schema can evolve
// without wiping user data on update.

export interface PanelPrefs {
  defaultTab: 'vitals' | 'network';
  theme: 'auto' | 'light' | 'dark';
}

export const panelPrefsItem = storage.defineItem<PanelPrefs>('sync:panelPrefs', {
  fallback: { defaultTab: 'vitals', theme: 'auto' },
  version: 2,
  migrations: {
    // v1 → v2: the SEO and accessibility tabs moved to a separate extension.
    // Any pref pointing at a removed tab falls back to 'vitals'.
    2: (old: { defaultTab: string; theme: PanelPrefs['theme'] }): PanelPrefs => ({
      ...old,
      defaultTab:
        old.defaultTab === 'seo' || old.defaultTab === 'a11y'
          ? 'vitals'
          : (old.defaultTab as PanelPrefs['defaultTab']),
    }),
  },
});

export const lastReportItem = storage.defineItem<PageInsight | null>(
  'local:lastReport',
  {
    fallback: null,
    version: 1,
    migrations: {},
  },
);

export interface PsiConfig {
  /** Google Cloud API key. Stored in `local`, NEVER `sync` (PLAN.md §14). */
  apiKey: string;
  /** Whether the user has acknowledged that PSI sends the page URL to Google. */
  disclosureAccepted: boolean;
}

// The API key and the "URL is sent to Google" acknowledgement live in
// storage.local — never sync. A key is a secret; sync propagates across a
// user's devices and has a hard per-item quota.
export const psiConfigItem = storage.defineItem<PsiConfig>('local:psiConfig', {
  fallback: { apiKey: '', disclosureAccepted: false },
  version: 1,
  migrations: {},
});
