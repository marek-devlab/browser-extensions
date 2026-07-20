import { useCallback, useEffect, useState } from 'react';
import { applyTheme, cacheTheme, useLocaleController, type Locale } from '@blur/ui';
import {
  DEFAULT_SETTINGS,
  localeItem,
  normalizeSettings,
  settingsItem,
  type SessionSaverSettings,
  type Theme,
} from './storage';

// React wiring over the pure `settingsItem`/`localeItem` (utils/storage.ts). Copied
// verbatim from whoami's house pattern: `seedTheme` runs in each surface's main.tsx
// before createRoot (flash-free), and this hook keeps the synchronous localStorage
// seed in step for the NEXT open.

export const THEME_SEED_KEY = 'blur-sessions:theme';
export const LOCALE_SEED_KEY = 'blur-sessions:locale';

export function useSessionsLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  return useLocaleController({
    key: LOCALE_SEED_KEY,
    read: () => localeItem.getValue(),
    write: (l) => localeItem.setValue(l),
  });
}

export function useSettings(): {
  settings: SessionSaverSettings | null;
  update: (patch: Partial<SessionSaverSettings>) => void;
} {
  const [settings, setSettings] = useState<SessionSaverSettings | null>(null);

  useEffect(() => {
    // A corrupt/failed read is NOT fatal — fall back to in-memory defaults.
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

  const update = useCallback((patch: Partial<SessionSaverSettings>) => {
    setSettings((prev) => {
      const base = prev ?? DEFAULT_SETTINGS;
      const next: SessionSaverSettings = { ...base, ...patch };
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

export function useThemeSetter(
  settings: SessionSaverSettings | null,
  update: (patch: Partial<SessionSaverSettings>) => void,
): { theme: Theme; setTheme: (t: Theme) => void } {
  return {
    theme: settings?.theme ?? 'auto',
    setTheme: (theme) => update({ theme }),
  };
}
