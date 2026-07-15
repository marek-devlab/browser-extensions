import { createContext, useContext, type ReactNode } from 'react';
import { LocaleProvider, useLocaleController, type Locale } from '@blur/ui';
import { localeItem, LOCALE_SEED_KEY } from './storage';

// Wires the persisted UI-language pref (local:locale) to @blur/ui's runtime i18n.
// Like the shared theme plumbing it keeps the @blur/ui package browser-agnostic —
// the extension owns the storage read/write. The initial value is a synchronous
// localStorage seed (LOCALE_SEED_KEY) so the first paint is already in the chosen
// language — English by default on a fresh install, regardless of browser locale.
//
// Every React root (popup, options) wraps its content in <BlurLocaleProvider>.
// That provider both feeds @blur/ui's <LocaleProvider> (so components read the
// active locale via useLocale / useT) AND exposes the setter through a small
// context, so the options page's <LanguageSwitcher> can drive the controller
// without prop-drilling.

const SetLocaleContext = createContext<(locale: Locale) => void>(() => {});

/** The setter paired with @blur/ui's `useLocale()` reader, for the switcher. */
export function useSetLocale(): (locale: Locale) => void {
  return useContext(SetLocaleContext);
}

export function BlurLocaleProvider({ children }: { children: ReactNode }) {
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
