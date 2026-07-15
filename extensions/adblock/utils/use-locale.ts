import { useLocaleController, type Locale } from '@blur/ui';
import { localeItem } from './storage';

// Module-level, stable read/write refs so `useLocaleController`'s effect deps do
// not change every render (they are used in its dependency array).
const readLocale = (): Promise<Locale> => localeItem.getValue();
const writeLocale = (locale: Locale): Promise<void> => localeItem.setValue(locale);

/**
 * Owns the persisted UI language for the React surfaces (popup / options). The
 * initial value is a synchronous localStorage seed (no first-paint flash), then
 * the async pref reconciles. Reuse this extension's own seed key namespace.
 */
export function useAdblockLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  return useLocaleController({
    key: 'blur-adblock:locale',
    read: readLocale,
    write: writeLocale,
  });
}
