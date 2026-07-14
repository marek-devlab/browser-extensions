import { useThemeController, type Theme } from '@blur/ui';
import { prefsItem } from './storage';

// Wires the persisted `ExportPrefs.theme` (utils/storage.ts) to @blur/ui's shared
// theme controller. @blur/ui stays browser-free (it never imports wxt/storage);
// this thin adapter supplies the extension's own async read/write and the
// localStorage seed key. The popup/options/preview stylesheets key colour tokens
// off `:root[data-theme]` via @blur/ui tokens.css, so applying a theme is just
// stamping that attribute.

/** localStorage seed key — unique per extension (flash-free next open). */
export const THEME_CACHE_KEY = 'blur-export:theme';

export function useExportTheme(): {
  theme: Theme | null;
  setTheme: (theme: Theme) => void;
} {
  return useThemeController({
    key: THEME_CACHE_KEY,
    read: async () => (await prefsItem.getValue()).theme,
    write: async (theme) => {
      const prefs = await prefsItem.getValue();
      await prefsItem.setValue({ ...prefs, theme });
    },
    // No DevTools host on any of these surfaces (popup/options/preview page), so
    // 'auto' defers to prefers-color-scheme — omit the devtoolsTheme param.
  });
}
