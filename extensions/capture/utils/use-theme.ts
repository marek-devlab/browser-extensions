import { useThemeController, type Theme } from '@blur/ui';
import { prefsItem, THEME_SEED_KEY } from './storage';

// Wires the persisted theme pref (sync:capturePrefs.theme) to @blur/ui's DOM
// plumbing (design §11.3). The package stays browser-agnostic; the extension
// owns the storage read/write. seedTheme(THEME_SEED_KEY) is called in each
// main.tsx BEFORE createRoot for a flash-free first paint (PLAN.md §18c).
export function useCaptureTheme(): {
  theme: Theme | null;
  setTheme: (t: Theme) => void;
} {
  return useThemeController({
    key: THEME_SEED_KEY,
    read: async () => (await prefsItem.getValue()).theme,
    write: async (theme) => {
      const cur = await prefsItem.getValue();
      await prefsItem.setValue({ ...cur, theme });
    },
  });
}
