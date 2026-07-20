import { useCallback, useEffect, useState } from 'react';
import { applyTheme, cacheTheme, useLocaleController, type Locale } from '@blur/ui';
import {
  DEFAULT_SETTINGS,
  localeItem,
  normalizeSettings,
  settingsItem,
  type ConvertSettings,
  type Theme,
} from './storage';

// React wiring over the pure `settingsItem`. Mirrors the house pattern
// (whoami/utils/settings.tsx): load on mount, apply the saved theme, expose a
// merged `update` that re-applies/re-seeds the theme when it changes. Theme uses
// the shared @blur/ui plumbing: `seedTheme(THEME_SEED_KEY)` runs in main.tsx before
// createRoot (flash-free), and this hook keeps the localStorage seed in step.

export const THEME_SEED_KEY = 'blur-convert:theme';
export const LOCALE_SEED_KEY = 'blur-convert:locale';

/** The runtime UI language, wired to the persisted `localeItem`. */
export function useConvertLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  return useLocaleController({
    key: LOCALE_SEED_KEY,
    read: () => localeItem.getValue(),
    write: (l) => localeItem.setValue(l),
  });
}

export function useSettings(): {
  settings: ConvertSettings | null;
  update: (patch: Partial<ConvertSettings>) => void;
} {
  const [settings, setSettings] = useState<ConvertSettings | null>(null);

  useEffect(() => {
    void settingsItem
      .getValue()
      .then((value) => normalizeSettings(value))
      .catch(() => DEFAULT_SETTINGS)
      .then((value) => {
        setSettings(value);
        applyTheme(value.theme);
        cacheTheme(THEME_SEED_KEY, value.theme);
      });
  }, []);

  const update = useCallback((patch: Partial<ConvertSettings>) => {
    setSettings((prev) => {
      const base = prev ?? DEFAULT_SETTINGS;
      const next: ConvertSettings = { ...base, ...patch };
      if (patch.theme !== undefined && patch.theme !== base.theme) {
        applyTheme(next.theme);
        cacheTheme(THEME_SEED_KEY, next.theme);
      }
      void settingsItem.setValue(next).catch(() => undefined);
      return next;
    });
  }, []);

  return { settings, update };
}

/** Narrow helper for the theme setter. */
export function useThemeSetter(
  settings: ConvertSettings | null,
  update: (patch: Partial<ConvertSettings>) => void,
): { theme: Theme; setTheme: (t: Theme) => void } {
  return {
    theme: settings?.theme ?? 'auto',
    setTheme: (theme) => update({ theme }),
  };
}
