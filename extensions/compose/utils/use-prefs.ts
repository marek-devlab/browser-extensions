import { useCallback, useEffect, useRef, useState } from 'react';
import { useThemeController, type Theme } from '@blur/ui';
import { settingsItem } from './storage';
import { DEFAULT_SETTINGS, type Settings } from './types';

// Wires the persisted `Settings` (utils/storage.ts, sync:) to React and hooks
// the `theme` field into @blur/ui's `useThemeController`. The theme seed key is
// 'blur-compose:theme' (seeded synchronously in each main.tsx before mount).

const THEME_KEY = 'blur-compose:theme';

export function usePrefs(): {
  settings: Settings | null;
  update: (patch: Partial<Settings>) => void;
  theme: Theme | null;
  setTheme: (t: Theme) => void;
} {
  const [settings, setSettings] = useState<Settings | null>(null);
  // Keep the latest settings in a ref so the theme controller's write closure
  // always persists against the current object, not a stale snapshot.
  const ref = useRef<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void settingsItem
      .getValue()
      .then((value) => {
        ref.current = value;
        setSettings(value);
      })
      // Prefs unreadable → run on defaults rather than hang on a spinner.
      .catch(() => setSettings(DEFAULT_SETTINGS));
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    const next: Settings = { ...ref.current, ...patch };
    ref.current = next;
    setSettings(next);
    void settingsItem.setValue(next).catch(() => {});
  }, []);

  const { theme, setTheme } = useThemeController({
    key: THEME_KEY,
    read: async () => (await settingsItem.getValue()).theme,
    write: (t) => update({ theme: t }),
  });

  return { settings, update, theme, setTheme };
}
