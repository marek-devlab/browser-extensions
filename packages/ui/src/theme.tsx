import { useCallback, useEffect, useState } from 'react';

// Storage-agnostic theme plumbing shared by every extension's popup/panel/page.
//
// This module deliberately does NOT import `wxt/browser` or any extension
// storage — it only touches the DOM and localStorage, so @blur/ui stays a pure
// presentational package (like @blur/core is a pure logic package). Each
// extension owns its own persisted pref (a `storage.defineItem` in its
// utils/storage.ts) and wires it to these helpers via `useThemeController`.
//
// The colour tokens key off `:root[data-theme]` (see tokens.css), so applying a
// theme is just stamping that attribute. 'auto' removes it, deferring to the
// DevTools theme (panels) or `prefers-color-scheme` (popups/pages).

export type Theme = 'auto' | 'light' | 'dark';

export function isTheme(value: unknown): value is Theme {
  return value === 'auto' || value === 'light' || value === 'dark';
}

/**
 * Apply a theme by stamping `:root[data-theme]`. For 'auto', pass the DevTools
 * host theme if there is one (`browser.devtools?.panels?.themeName`) so a panel
 * follows DevTools; omit it on a popup/page so the attribute is removed and the
 * `prefers-color-scheme` fallback in tokens.css applies. Keeping the DevTools
 * value as a PARAM (rather than importing `browser` here) is what lets this
 * package avoid a `wxt` dependency.
 */
export function applyTheme(theme: Theme, devtoolsTheme?: 'light' | 'dark'): void {
  const root = document.documentElement;
  if (theme === 'auto') {
    if (devtoolsTheme) root.dataset.theme = devtoolsTheme;
    else delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}

/**
 * Mirror the theme to a synchronous localStorage seed so the NEXT open is
 * flash-free (async extension storage only resolves after first paint). `key`
 * must be unique per extension, e.g. `'blur-devdata:theme'`.
 */
export function cacheTheme(key: string, theme: Theme): void {
  try {
    localStorage.setItem(key, theme);
  } catch {
    // Private mode / disabled storage — the async pref still applies on load,
    // just without the flash-free seed.
  }
}

/**
 * Synchronously stamp the last-known theme BEFORE React mounts, to avoid a
 * light/dark flash. Call from the entrypoint's main.tsx before `createRoot`.
 * No-op if nothing cached yet, so the caller's own default stands.
 */
export function seedTheme(key: string, devtoolsTheme?: 'light' | 'dark'): void {
  try {
    const cached = localStorage.getItem(key);
    if (isTheme(cached)) applyTheme(cached, devtoolsTheme);
  } catch {
    // Ignore — fall back to the caller's default stamping.
  }
}

/**
 * Wire a persisted theme pref to the DOM. `read`/`write` are the extension's own
 * async storage accessors; `key` is its localStorage seed key; `devtoolsTheme`
 * is `browser.devtools?.panels?.themeName` (or undefined on a popup/page).
 * Returns the current theme (null until the first read resolves) and a setter
 * that persists, re-applies and refreshes the seed.
 */
export function useThemeController(options: {
  key: string;
  read: () => Promise<Theme>;
  write: (theme: Theme) => void | Promise<void>;
  devtoolsTheme?: 'light' | 'dark';
}): { theme: Theme | null; setTheme: (theme: Theme) => void } {
  const { key, read, write, devtoolsTheme } = options;
  const [theme, setThemeState] = useState<Theme | null>(null);

  useEffect(() => {
    void read().then((value) => {
      setThemeState(value);
      applyTheme(value, devtoolsTheme);
      cacheTheme(key, value);
    });
  }, [key, read, devtoolsTheme]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      applyTheme(next, devtoolsTheme);
      cacheTheme(key, next);
      void write(next);
    },
    [key, write, devtoolsTheme],
  );

  return { theme, setTheme };
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/** Segmented Auto/Light/Dark control. Class names live in tokens-consuming CSS
 *  (`.theme-toggle`) — every extension already styles them identically. */
export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
}) {
  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={
            theme === t.id
              ? 'theme-toggle__btn theme-toggle__btn--active'
              : 'theme-toggle__btn'
          }
          aria-pressed={theme === t.id}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
