import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { useLocaleController, type Locale } from '@blur/ui';
import { localeItem, panelPrefsItem, type PanelPrefs } from './storage';
import { useT } from './i18n';

// Wires the persisted `PanelPrefs.theme` (utils/storage.ts) to a working
// light/dark/auto toggle shared by the panel and popup. The CSS keys colour
// tokens off `:root[data-theme]` (see both stylesheets), so applying a theme is
// just stamping that attribute; 'auto' removes it so the DevTools theme
// (panel) or `prefers-color-scheme` (popup) takes over.

export type Theme = PanelPrefs['theme'];

// A synchronous mirror of the theme pref. `PanelPrefs` lives in async extension
// storage, which only resolves AFTER first paint — long enough for a light flash
// (FOUC) when the saved theme differs from the OS / DevTools default. We mirror
// the pref into `localStorage` (synchronous) and stamp it BEFORE React mounts
// (see `seedTheme`), so the popup/panel open already themed. Async storage stays
// the source of truth and re-applies on load; localStorage is only the seed.
const THEME_CACHE_KEY = 'blur-seo:theme';

function isTheme(value: unknown): value is Theme {
  return value === 'auto' || value === 'light' || value === 'dark';
}

/** Persist the theme pref to the synchronous localStorage seed. */
function cacheTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, theme);
  } catch {
    // localStorage may be unavailable (private mode / disabled) — the async
    // pref still applies on load, just without the flash-free seed.
  }
}

/**
 * Synchronously stamp the last-known theme BEFORE React mounts, to avoid a
 * light/dark flash on open. Call from the entrypoint before `createRoot`. Does
 * nothing if no theme has been cached yet, so the caller's own default (e.g. the
 * panel's DevTools theme) stands.
 */
export function seedTheme(): void {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY);
    if (isTheme(cached)) applyTheme(cached);
  } catch {
    // Ignore — fall back to the caller's default stamping.
  }
}

/** Resolve 'auto' to a concrete theme, or null to defer to CSS media queries. */
function resolveAuto(): 'light' | 'dark' | null {
  const devtools = browser.devtools?.panels?.themeName;
  if (devtools) return devtools === 'dark' ? 'dark' : 'light';
  // No DevTools host (the popup): return null so `data-theme` is removed and the
  // `prefers-color-scheme` fallback in the stylesheet applies.
  return null;
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') {
    const resolved = resolveAuto();
    if (resolved) root.dataset.theme = resolved;
    else delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}

/**
 * Load `PanelPrefs`, applying the saved theme on mount, and expose a merged
 * `update` that persists a patch to `sync` storage and re-applies the theme.
 * `prefs` is null until the first read resolves.
 */
export function usePanelPrefs(): {
  prefs: PanelPrefs | null;
  update: (patch: Partial<PanelPrefs>) => void;
} {
  const [prefs, setPrefs] = useState<PanelPrefs | null>(null);

  useEffect(() => {
    void panelPrefsItem.getValue().then((value) => {
      setPrefs(value);
      applyTheme(value.theme);
      // Refresh the synchronous seed so the NEXT open is flash-free.
      cacheTheme(value.theme);
    });
  }, []);

  const update = useCallback((patch: Partial<PanelPrefs>) => {
    setPrefs((prev) => {
      const base: PanelPrefs = prev ?? { defaultTab: 'seo', theme: 'auto' };
      const next: PanelPrefs = { ...base, ...patch };
      if (patch.theme !== undefined) {
        applyTheme(next.theme);
        cacheTheme(next.theme);
      }
      void panelPrefsItem.setValue(next);
      return next;
    });
  }, []);

  return { prefs, update };
}

const THEME_LABELS: { id: Theme; key: 'themeAuto' | 'themeLight' | 'themeDark' }[] = [
  { id: 'auto', key: 'themeAuto' },
  { id: 'light', key: 'themeLight' },
  { id: 'dark', key: 'themeDark' },
];

/** Segmented Auto/Light/Dark control. Rendered inside a <LocaleProvider>, so it
 *  reads its labels from the active-locale catalog. */
export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
}) {
  const t = useT();
  return (
    <div className="theme-toggle" role="group" aria-label={t('colourTheme')}>
      {THEME_LABELS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={
            theme === item.id
              ? 'theme-toggle__btn theme-toggle__btn--active'
              : 'theme-toggle__btn'
          }
          aria-pressed={theme === item.id}
          onClick={() => onChange(item.id)}
        >
          {t(item.key)}
        </button>
      ))}
    </div>
  );
}

/**
 * Wire the persisted UI language (utils/storage `localeItem`) to React state. The
 * initial value is the synchronous localStorage seed (English on a fresh install,
 * so a surface paints in the right language on the FIRST frame); the async read
 * then reconciles. The seed key reuses the theme prefix (`blur-seo:`) so the two
 * prefs sit together. Used by the popup and DevTools-panel roots, each wrapping
 * its tree in <LocaleProvider locale={locale}>.
 */
export function useSeoLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  return useLocaleController({
    key: 'blur-seo:locale',
    read: () => localeItem.getValue(),
    write: (locale) => localeItem.setValue(locale),
  });
}
