import { LocaleProvider, useLocaleController } from '@blur/ui';
import { Workbench } from './Workbench';
import { usePrefs } from '../utils/use-prefs';
import { localeItem } from '../utils/storage';
import { tAt } from '../utils/i18n';

// Thin wrapper shared by the side panel (S1) and the full-page Workbench (S2)
// entrypoints (design §1.2 — one app, two shells; S2 is also the ONLY surface
// Firefox for Android has). Loads prefs, wires the runtime locale, then renders
// the single <Workbench> inside a <LocaleProvider>.
export function WorkbenchApp({ surface }: { surface: 'panel' | 'workbench' }) {
  // Reuse the theme-seed prefix + `:locale`; the initial value is the synchronous
  // localStorage seed, so the first paint is already in the right language.
  const { locale } = useLocaleController({
    key: 'blur-compose:locale',
    read: () => localeItem.getValue(),
    write: (l) => localeItem.setValue(l),
  });
  const { settings, update, theme, setTheme } = usePrefs();

  return (
    <LocaleProvider locale={locale}>
      {!settings ? (
        <div className="cw-loading">{tAt(locale, 'loading')}</div>
      ) : (
        <Workbench
          surface={surface}
          settings={settings}
          updateSettings={update}
          theme={theme}
          setTheme={setTheme}
        />
      )}
    </LocaleProvider>
  );
}
