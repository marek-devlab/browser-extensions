import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

// Runtime i18n shared by every extension. Like ./theme, this stays a PURE
// presentational module: it does NOT import `wxt/browser` or any extension
// storage. Each extension owns its persisted locale pref (a `storage.defineItem`
// in its utils/storage.ts) and wires it in via `useLocaleController`.
//
// Why not Chrome's native `_locales` / `chrome.i18n`? That is locked to the
// BROWSER UI language and cannot be switched by the user at runtime. The product
// requirement here is an in-settings switch that defaults to English regardless
// of the browser locale, so we ship our own tiny catalog-based translator.

export type Locale = 'en' | 'ru' | 'et';

/** The default is English on purpose — independent of the browser's UI language. */
export const DEFAULT_LOCALE: Locale = 'en';

/** Switcher metadata. Labels are the language's OWN endonym (English/Русский/
 *  Eesti) so a speaker recognises their language whatever the current UI. */
export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'et', label: 'Eesti' },
];

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ru' || value === 'et';
}

/**
 * Mirror the locale to a synchronous localStorage seed so the NEXT open renders
 * in the right language on the FIRST paint (async extension storage only resolves
 * after first paint — without this the UI would flash English then swap). `key`
 * must be unique per extension, e.g. `'blur-whoami:locale'`.
 */
export function cacheLocale(key: string, locale: Locale): void {
  try {
    localStorage.setItem(key, locale);
  } catch {
    // Private mode / disabled storage — the async pref still applies on load,
    // just without the flash-free seed.
  }
}

/** The synchronous best guess used as the initial render locale, before async
 *  storage resolves. Falls back to the English default when nothing is cached. */
export function seedLocale(key: string): Locale {
  try {
    const cached = localStorage.getItem(key);
    if (isLocale(cached)) return cached;
  } catch {
    // Ignore — fall back to the default.
  }
  return DEFAULT_LOCALE;
}

/**
 * Wire a persisted locale pref to React state. `read`/`write` are the extension's
 * own async storage accessors; `key` is its localStorage seed key. The initial
 * value is the synchronous seed (never null, so there is no flash and no
 * loading branch), then the async read reconciles and re-seeds.
 */
export function useLocaleController(options: {
  key: string;
  read: () => Promise<Locale>;
  write: (locale: Locale) => void | Promise<void>;
}): { locale: Locale; setLocale: (locale: Locale) => void } {
  const { key, read, write } = options;
  const [locale, setLocaleState] = useState<Locale>(() => seedLocale(key));

  useEffect(() => {
    void read().then((value) => {
      setLocaleState(value);
      cacheLocale(key, value);
    });
  }, [key, read]);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      cacheLocale(key, next);
      void write(next);
    },
    [key, write],
  );

  return { locale, setLocale };
}

/**
 * A translation catalog: the SAME keys in every locale. Typed as a full
 * `Record<Locale, Record<K, string>>`, so TypeScript fails the build if any
 * locale is missing a key — a compile-time guarantee that nothing ships
 * half-translated.
 */
export type Catalog<K extends string> = Record<Locale, Record<K, string>>;

export type TFunction<K extends string> = (
  key: K,
  vars?: Record<string, string | number>,
) => string;

/**
 * Build a translator bound to a catalog. Resolution order for a key is:
 * current locale → English → the key itself, so the UI NEVER renders blank even
 * if a string is somehow missing. `{name}` placeholders are interpolated from
 * `vars` (plain string replace, no regex, so user data is never a pattern).
 */
export function createTranslator<K extends string>(catalog: Catalog<K>) {
  return (
    locale: Locale,
    key: K,
    vars?: Record<string, string | number>,
  ): string => {
    const table = catalog[locale] ?? catalog[DEFAULT_LOCALE];
    let out = table?.[key] ?? catalog[DEFAULT_LOCALE]?.[key] ?? String(key);
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        out = out.split(`{${name}}`).join(String(value));
      }
    }
    return out;
  };
}

// React context so components read the active locale without prop-drilling it
// through every level. An extension wraps each of its React roots in
// <LocaleProvider locale={locale}> (locale from useLocaleController) and its
// components call a `t(key)` bound via `useLocale()` + `createTranslator`.
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** The active locale for the current React tree. */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/**
 * Segmented EN/RU/ET control — the sibling of ThemeToggle. Styled by
 * `.lang-toggle` in components.css, which is `flex-wrap`, so a longer label set
 * WRAPS to a second row instead of overflowing and breaking the layout. Lives in
 * each extension's settings surface.
 */
export function LanguageSwitcher({
  locale,
  onChange,
  label = 'Interface language',
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
  label?: string;
}) {
  return (
    <div className="lang-toggle" role="group" aria-label={label}>
      {LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          className={
            locale === l.code
              ? 'lang-toggle__btn lang-toggle__btn--active'
              : 'lang-toggle__btn'
          }
          aria-pressed={locale === l.code}
          onClick={() => onChange(l.code)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
