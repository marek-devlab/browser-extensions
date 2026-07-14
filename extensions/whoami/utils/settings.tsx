import { useCallback, useEffect, useState } from 'react';
import { applyTheme, cacheTheme } from '@blur/ui';
import {
  DEFAULT_SETTINGS,
  settingsItem,
  type Theme,
  type WhoamiSettings,
} from './storage';

// React wiring over the pure `settingsItem` (utils/storage.ts). Loads settings on
// mount, applies the saved theme, and exposes a merged `update` that persists a
// patch and re-applies/re-seeds the theme when `theme` changes.
//
// Theme uses the shared @blur/ui plumbing: `seedTheme('blur-whoami:theme')` runs
// in each surface's main.tsx BEFORE createRoot (flash-free), and this hook keeps
// the synchronous localStorage seed in step for the NEXT open.

export const THEME_SEED_KEY = 'blur-whoami:theme';

export function useSettings(): {
  settings: WhoamiSettings | null;
  update: (patch: Partial<WhoamiSettings>) => void;
  reset: () => Promise<void>;
} {
  const [settings, setSettings] = useState<WhoamiSettings | null>(null);

  useEffect(() => {
    void settingsItem.getValue().then((value) => {
      setSettings(value);
      applyTheme(value.theme);
      cacheTheme(THEME_SEED_KEY, value.theme);
    });
  }, []);

  const update = useCallback((patch: Partial<WhoamiSettings>) => {
    setSettings((prev) => {
      const base = prev ?? DEFAULT_SETTINGS;
      const next: WhoamiSettings = { ...base, ...patch };
      if (patch.theme !== undefined && patch.theme !== base.theme) {
        applyTheme(next.theme);
        cacheTheme(THEME_SEED_KEY, next.theme);
      }
      void settingsItem.setValue(next);
      return next;
    });
  }, []);

  const reset = useCallback(async () => {
    // 🔴 "Reset all" clears prefs AND drops any host permission we hold, so a
    // revoke is total (design §3, control #13). The IP itself was never stored,
    // so there is nothing else to purge.
    await settingsItem.setValue(DEFAULT_SETTINGS);
    setSettings(DEFAULT_SETTINGS);
    applyTheme(DEFAULT_SETTINGS.theme);
    cacheTheme(THEME_SEED_KEY, DEFAULT_SETTINGS.theme);
  }, []);

  return { settings, update, reset };
}

/** Narrow helper for the two surfaces that only care about the theme setter. */
export function useThemeSetter(
  settings: WhoamiSettings | null,
  update: (patch: Partial<WhoamiSettings>) => void,
): { theme: Theme; setTheme: (t: Theme) => void } {
  return {
    theme: settings?.theme ?? 'auto',
    setTheme: (theme) => update({ theme }),
  };
}
