import { useCallback, useEffect, useState } from 'react';
import { useThemeController, useLocaleController, type Theme, type Locale } from '@blur/ui';
import { assetsPrefsItem, DEFAULT_PREFS, localeItem, type AssetsPrefs } from './storage';

// Small hooks shared by the popup / options / DevTools panel. Preferences are the
// ONLY persisted state (design §9.3), so this is the whole state layer.

/** Load prefs and expose a patching setter that persists to storage.local. */
export function usePrefs(): {
  prefs: AssetsPrefs;
  update: (patch: Partial<AssetsPrefs>) => void;
  loaded: boolean;
} {
  const [prefs, setPrefs] = useState<AssetsPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void assetsPrefsItem.getValue().then((v) => {
      if (active) { setPrefs(v); setLoaded(true); }
    });
    const unwatch = assetsPrefsItem.watch((v) => { if (v) setPrefs(v); });
    return () => { active = false; unwatch(); };
  }, []);

  const update = useCallback((patch: Partial<AssetsPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      void assetsPrefsItem.setValue(next);
      return next;
    });
  }, []);

  return { prefs, update, loaded };
}

/**
 * Wire the persisted theme to the DOM via @blur/ui. `devtoolsTheme` is
 * `browser.devtools?.panels?.themeName` on the panel (omit on popup/options), so a
 * panel follows DevTools and a page follows prefers-color-scheme (design §11.3).
 */
export function useAssetsTheme(devtoolsTheme?: 'light' | 'dark'): {
  theme: Theme | null;
  setTheme: (t: Theme) => void;
} {
  return useThemeController({
    key: 'blur-assets:theme',
    read: () => assetsPrefsItem.getValue().then((p) => p.theme),
    write: (theme) => assetsPrefsItem.getValue().then((p) => assetsPrefsItem.setValue({ ...p, theme })),
    devtoolsTheme,
  });
}

/**
 * Wire the persisted UI language to React state. The initial value is the
 * synchronous localStorage seed (English on a fresh install), so a surface paints
 * in the right language on the FIRST frame; the async read then reconciles. Used by
 * the popup, options and DevTools panel roots, each wrapping its tree in
 * <LocaleProvider locale={locale}>.
 */
export function useAssetsLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  return useLocaleController({
    key: 'blur-assets:locale',
    read: () => localeItem.getValue(),
    write: (locale) => localeItem.setValue(locale),
  });
}
