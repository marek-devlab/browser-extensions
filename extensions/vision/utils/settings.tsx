import { useCallback, useEffect, useState } from 'react';
import { applyTheme, cacheTheme, useLocaleController, type Locale } from '@blur/ui';
import {
  DEFAULT_SETTINGS,
  localeItem,
  normalizeSettings,
  settingsItem,
  type Theme,
  type VisionSettings,
} from './storage';

// React wiring over the pure `settingsItem`. Same house pattern as the other
// extensions: `seedTheme('blur-vision:theme')` runs in main.tsx before mount
// (flash-free), and this hook keeps the synchronous seeds in step for next open.

export const THEME_SEED_KEY = 'blur-vision:theme';
export const LOCALE_SEED_KEY = 'blur-vision:locale';

export function useVisionLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  return useLocaleController({
    key: LOCALE_SEED_KEY,
    read: () => localeItem.getValue(),
    write: (l) => localeItem.setValue(l),
  });
}

export function useSettings(): {
  settings: VisionSettings | null;
  update: (patch: Partial<VisionSettings>) => void;
  reset: () => void;
} {
  const [settings, setSettings] = useState<VisionSettings | null>(null);

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

  const update = useCallback((patch: Partial<VisionSettings>) => {
    setSettings((prev) => {
      const base = prev ?? DEFAULT_SETTINGS;
      const next: VisionSettings = { ...base, ...patch };
      if (patch.theme !== undefined && patch.theme !== base.theme) {
        applyTheme(next.theme);
        cacheTheme(THEME_SEED_KEY, next.theme);
      }
      void settingsItem.setValue(next).catch(() => undefined);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    // Reset only the simulation selection, keep theme/locale (the user's chrome).
    setSettings((prev) => {
      const keep = { theme: prev?.theme ?? DEFAULT_SETTINGS.theme };
      const next: VisionSettings = { ...DEFAULT_SETTINGS, ...keep };
      void settingsItem.setValue(next).catch(() => undefined);
      return next;
    });
  }, []);

  return { settings, update, reset };
}

export function useThemeSetter(
  settings: VisionSettings | null,
  update: (patch: Partial<VisionSettings>) => void,
): { theme: Theme; setTheme: (t: Theme) => void } {
  return {
    theme: settings?.theme ?? 'auto',
    setTheme: (theme) => update({ theme }),
  };
}
