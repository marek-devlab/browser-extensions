import { useCallback, useEffect, useState } from 'react';
import { applyTheme, cacheTheme, useLocaleController, type Locale } from '@blur/ui';
import {
  DEFAULT_PREFS,
  localeItem,
  normalizePrefs,
  prefsItem,
  type LinksafePrefs,
  type Theme,
} from './storage';

// React wiring over the pure `prefsItem` (utils/storage.ts). Copied from the family
// house pattern (whoami/utils/settings.tsx): loads prefs on mount, applies the saved
// theme, and exposes a merged `update` that persists a patch and re-applies/re-seeds
// the theme when it changes. Theme uses the shared @blur/ui plumbing — `seedTheme`
// runs in each surface's main.tsx BEFORE createRoot (flash-free); this hook keeps the
// synchronous localStorage seed in step for the NEXT open.

export const THEME_SEED_KEY = 'blur-linksafe:theme';
export const LOCALE_SEED_KEY = 'blur-linksafe:locale';

/** The runtime UI language, wired to the persisted `localeItem`. */
export function useLinksafeLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  return useLocaleController({
    key: LOCALE_SEED_KEY,
    read: () => localeItem.getValue(),
    write: (l) => localeItem.setValue(l),
  });
}

export function useSettings(): {
  settings: LinksafePrefs | null;
  update: (patch: Partial<LinksafePrefs>) => void;
} {
  const [settings, setSettings] = useState<LinksafePrefs | null>(null);

  useEffect(() => {
    void prefsItem
      .getValue()
      .then((value) => normalizePrefs(value))
      .catch(() => DEFAULT_PREFS)
      .then((value) => {
        setSettings(value);
        applyTheme(value.theme);
        cacheTheme(THEME_SEED_KEY, value.theme);
      });
  }, []);

  const update = useCallback((patch: Partial<LinksafePrefs>) => {
    setSettings((prev) => {
      const base = prev ?? DEFAULT_PREFS;
      const next: LinksafePrefs = { ...base, ...patch };
      if (patch.theme !== undefined && patch.theme !== base.theme) {
        applyTheme(next.theme);
        cacheTheme(THEME_SEED_KEY, next.theme);
      }
      void prefsItem.setValue(next).catch(() => undefined);
      return next;
    });
  }, []);

  return { settings, update };
}

/** Narrow helper for the theme toggle. */
export function useThemeSetter(
  settings: LinksafePrefs | null,
  update: (patch: Partial<LinksafePrefs>) => void,
): { theme: Theme; setTheme: (t: Theme) => void } {
  return {
    theme: settings?.theme ?? 'auto',
    setTheme: (theme) => update({ theme }),
  };
}
