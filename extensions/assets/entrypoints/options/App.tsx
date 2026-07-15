import type { ReactNode } from 'react';
import { browser } from '#imports';
import { ThemeToggle, LanguageSwitcher, LocaleProvider } from '@blur/ui';
import { usePrefs, useAssetsTheme, useAssetsLocale } from '../../utils/use-prefs';
import { useT } from '../../utils/i18n';
import type { OverweightThreshold, Units, RequestScope, BufferSize } from '../../utils/storage';

// Options (design §2.8). Every control is a REAL persisted pref (storage.local,
// design §3). 🔴 What is deliberately ABSENT: a save folder, a filename template,
// an "export quality", a "recently inspected" list — each of those would be a claim
// that we store or download something (design §13 №10).

const BUFFER_OPTIONS: BufferSize[] = [250, 500, 1500, 5000];

// The numeric labels are symbols (1.5× / 2×), not prose — only the `off` label is
// translated, at render time (below).
const OVERWEIGHT_OPTIONS: { value: OverweightThreshold; label: string }[] = [
  { value: 1.5, label: '1.5×' },
  { value: 2, label: '2×' },
  { value: 3, label: '3×' },
  { value: 4, label: '4×' },
  { value: 'off', label: '' },
];

export function App() {
  // Owns the locale (with setLocale for the switcher) and provides it to the tree.
  const { locale, setLocale } = useAssetsLocale();
  return (
    <LocaleProvider locale={locale}>
      <OptionsBody locale={locale} setLocale={setLocale} />
    </LocaleProvider>
  );
}

function OptionsBody({
  locale,
  setLocale,
}: {
  locale: ReturnType<typeof useAssetsLocale>['locale'];
  setLocale: ReturnType<typeof useAssetsLocale>['setLocale'];
}) {
  const t = useT();
  const { prefs, update, loaded } = usePrefs();
  const { theme, setTheme } = useAssetsTheme();

  if (!loaded) return <main className="options"><p>{t('loading')}</p></main>;

  return (
    <main className="options">
      <h1>{t('optTitle')}</h1>

      <section>
        <h2>{t('secAppearance')}</h2>
        <Field label={t('language')}>
          <LanguageSwitcher locale={locale} onChange={setLocale} label={t('interfaceLanguage')} />
        </Field>
        <Field label={t('fldTheme')}>
          <ThemeToggle theme={theme ?? prefs.theme} onChange={setTheme} />
        </Field>
        <Field label={t('fldSizeUnits')}>
          <Radios<Units>
            name="units"
            value={prefs.units}
            options={[{ value: 1024, label: t('unit1024') }, { value: 1000, label: t('unit1000') }]}
            onChange={(units) => update({ units })}
          />
        </Field>
      </section>

      <section>
        <h2>{t('secPicker')}</h2>
        <Field label={t('fldShortcut')}>
          <span className="mono">Alt+Shift+A</span>{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); openShortcuts(); }}>{t('changeInBrowser')}</a>
        </Field>
        <Toggle label={t('tglBreadcrumbs')} checked={prefs.showBreadcrumbs} onChange={(v) => update({ showBreadcrumbs: v })} />
        <Toggle label={t('tglAutoResource')} checked={prefs.autoJumpToResource} onChange={(v) => update({ autoJumpToResource: v })} />
        <Toggle label={t('tglPreview')} checked={prefs.preview} onChange={(v) => update({ preview: v })}
          hint={t('tglPreviewHint')} />
      </section>

      <section>
        <h2>{t('secCard')}</h2>
        <Field label={t('fldOverweight')}>
          <select value={String(prefs.overweightThreshold)} onChange={(e) => update({ overweightThreshold: parseThreshold(e.target.value) })}>
            {OVERWEIGHT_OPTIONS.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.value === 'off' ? t('optDontShow') : o.label}
              </option>
            ))}
          </select>
        </Field>
        <Toggle label={t('tglSrcsetExpanded')} checked={prefs.srcsetExpanded} onChange={(v) => update({ srcsetExpanded: v })} />
        <Field label={t('fldShowRequests')}>
          <Radios<RequestScope>
            name="scope"
            value={prefs.requestScope}
            options={[{ value: 'related', label: t('scopeRelated') }, { value: 'all', label: t('scopeAll') }]}
            onChange={(requestScope) => update({ requestScope })}
          />
        </Field>
      </section>

      <section>
        <h2>{t('secHints')}</h2>
        <Toggle label={t('tglHints')} checked={prefs.hints} onChange={(v) => update({ hints: v })} />
        <button type="button" className="ghost" onClick={() => update({ hintsDismissed: [] })}>
          {t('btnShowHints')}
        </button>
      </section>

      <section>
        <h2>{t('secData')}</h2>
        <Field label={t('fldBufferSize')}>
          <select value={String(prefs.bufferSize)} onChange={(e) => update({ bufferSize: Number(e.target.value) as BufferSize })}>
            {BUFFER_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <p className="hint">{t('dataWarning')}</p>
      </section>

      <footer>{t('optFooter')}</footer>
    </main>
  );
}

/**
 * The ONE correct way to rebind: the browser's own shortcuts page. We deliberately
 * ship no in-app rebind form — it would only create the illusion of control, since
 * the binding lives in the browser (design §13 №16).
 *
 * The URL differs per engine, and we pick it by FEATURE, not by user-agent string:
 * an extension's own origin tells us which engine is hosting it. `about:addons` is
 * the Firefox equivalent (and the only shortcuts entry point on Firefox for
 * Android, where `chrome://` does not exist at all).
 */
function openShortcuts(): void {
  const isGecko = browser.runtime.getURL('').startsWith('moz-extension://');
  const url = isGecko ? 'about:addons' : 'chrome://extensions/shortcuts';
  void browser.tabs.create({ url }).catch(() => {
    // Some builds refuse to open a privileged page from an extension page. Nothing
    // to recover — the user can reach it from the browser menu.
  });
}

function parseThreshold(v: string): OverweightThreshold {
  return v === 'off' ? 'off' : (Number(v) as OverweightThreshold);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="field__control">{children}</div>
    </div>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <span className="hint block">{hint}</span>}</span>
    </label>
  );
}

function Radios<T extends string | number>({ name, value, options, onChange }: {
  name: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="radios" role="radiogroup">
      {options.map((o) => (
        <label key={String(o.value)} className="radio">
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}
