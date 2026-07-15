import { createContext, useContext, type ReactNode } from 'react';
import { LocaleProvider, useLocaleController, type Locale } from '@blur/ui';
import { localeItem, LOCALE_SEED_KEY } from './storage';

// Wires the persisted UI-language pref (local:locale) to @blur/ui's runtime i18n.
// Like useCaptureTheme it keeps the package browser-agnostic — the extension owns
// the storage read/write. The initial value is a synchronous localStorage seed
// (LOCALE_SEED_KEY) so the first paint is already in the chosen language —
// English by default on a fresh install.
//
// Every React root wraps its content in <CaptureLocaleProvider>. That provider
// both feeds @blur/ui's <LocaleProvider> (so components read the active locale via
// useLocale) AND exposes the setter through a small context, so the shared
// <Settings/> — mounted in both the Studio tab and the standalone options page —
// can drive the SAME controller from its LanguageSwitcher without prop-drilling.

const SetLocaleContext = createContext<(locale: Locale) => void>(() => {});

/** The setter paired with @blur/ui's `useLocale()` reader, for the switcher. */
export function useSetLocale(): (locale: Locale) => void {
  return useContext(SetLocaleContext);
}

export function CaptureLocaleProvider({ children }: { children: ReactNode }) {
  const { locale, setLocale } = useLocaleController({
    key: LOCALE_SEED_KEY,
    read: () => localeItem.getValue(),
    write: (l) => localeItem.setValue(l),
  });
  return (
    <LocaleProvider locale={locale}>
      <SetLocaleContext.Provider value={setLocale}>{children}</SetLocaleContext.Provider>
    </LocaleProvider>
  );
}
