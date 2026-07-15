import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { Callout, LanguageSwitcher, LocaleProvider, ThemeToggle, useLocaleController } from '@blur/ui';
import { DEFAULT_PREFS, localeItem, prefsItem } from '../../utils/storage';
import type { ExportPrefs } from '../../utils/types';
import { useExportTheme } from '../../utils/theme';
import { useT } from '../../utils/i18n';
import { buildFilename } from '../../utils/filename';

// Options — the persisted defaults (design §2.5 / §3). Persistence is REAL: every
// control writes through `prefsItem` (sync storage). Column include/type and the
// per-export filename are NOT here — they are per-table decisions (design §3).
//
// The filename example updates live through the REAL sanitizer (utils/filename),
// so the "reserved names / RTL / traversal are neutralized" claim is demonstrable.

type TabId = 'tables' | 'text' | 'filenames' | 'about';

function usePrefs(): {
  prefs: ExportPrefs | null;
  update: (patch: Partial<ExportPrefs>) => void;
} {
  const [prefs, setPrefs] = useState<ExportPrefs | null>(null);
  useEffect(() => {
    void prefsItem.getValue().then(setPrefs);
  }, []);
  const update = useCallback((patch: Partial<ExportPrefs>) => {
    setPrefs((prev) => {
      const next = { ...(prev ?? DEFAULT_PREFS), ...patch };
      void prefsItem.setValue(next);
      return next;
    });
  }, []);
  return { prefs, update };
}

export function App() {
  const { locale, setLocale } = useLocaleController({
    key: 'blur-export:locale',
    read: () => localeItem.getValue(),
    write: (l) => localeItem.setValue(l),
  });
  return (
    <LocaleProvider locale={locale}>
      <AppBody locale={locale} setLocale={setLocale} />
    </LocaleProvider>
  );
}

function AppBody({
  locale,
  setLocale,
}: {
  locale: Parameters<typeof LanguageSwitcher>[0]['locale'];
  setLocale: (l: Parameters<typeof LanguageSwitcher>[0]['locale']) => void;
}) {
  const t = useT();
  const { theme, setTheme } = useExportTheme();
  const { prefs, update } = usePrefs();
  const [tab, setTab] = useState<TabId>('tables');
  const [downloadsGranted, setDownloadsGranted] = useState<boolean | null>(null);

  useEffect(() => {
    void browser.permissions
      ?.contains({ permissions: ['downloads'] })
      .then(setDownloadsGranted);
  }, []);

  if (!prefs) return <div className="opt" />;

  // `permissions.request` MUST be called from an extension page inside a user
  // gesture — a content script cannot do it. That is why the engine's honest
  // refusal (design §5.9) links HERE instead of prompting on the page.
  const requestDownloads = async () => {
    if (downloadsGranted) {
      await browser.permissions?.remove({ permissions: ['downloads'] });
      setDownloadsGranted(false);
      return;
    }
    const granted = await browser.permissions?.request({ permissions: ['downloads'] });
    setDownloadsGranted(!!granted);
  };

  return (
    <div className="opt">
      <header className="opt__head">
        <h1>{t('optionsTitle')}</h1>
        <ThemeToggle theme={theme ?? 'auto'} onChange={setTheme} />
      </header>

      <section className="opt__group">
        <h2>{t('language')}</h2>
        <LanguageSwitcher locale={locale} onChange={setLocale} label={t('language')} />
      </section>

      <nav className="opt__tabs" role="tablist">
        {(
          [
            ['tables', t('tables')],
            ['text', t('tabText')],
            ['filenames', t('tabFilenames')],
            ['about', t('tabAbout')],
          ] as [TabId, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'opt__tab opt__tab--on' : 'opt__tab'}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'tables' && (
        <>
          <Group title={t('groupDefaultFormat')}>
            <RadioRow
              legend={t('tables')}
              value={prefs.defaultTableFormat}
              options={[
                ['xlsx', '.xlsx'],
                ['csv', '.csv'],
                ['md', '.md'],
              ]}
              onChange={(v) => update({ defaultTableFormat: v as ExportPrefs['defaultTableFormat'] })}
            />
            <Callout tone="info">{t('calloutXlsxSafer')}</Callout>
          </Group>

          <Group title="CSV">
            <SelectRow
              label={t('csvDelimiter')}
              value={prefs.csvDelimiter}
              options={[
                ['auto', t('delimiterAuto')],
                [';', t('delimiterSemicolonExcel')],
                [',', ','],
                ['\t', 'Tab'],
                ['|', '|'],
              ]}
              onChange={(v) => update({ csvDelimiter: v as ExportPrefs['csvDelimiter'] })}
            />
            <SelectRow
              label={t('csvEncoding')}
              value={prefs.csvEncoding}
              options={[
                ['utf8-bom', 'UTF-8 + BOM'],
                ['utf8', t('utf8NoBom')],
              ]}
              onChange={(v) => update({ csvEncoding: v as ExportPrefs['csvEncoding'] })}
            />
            <SelectRow
              label={t('csvEol')}
              value={prefs.csvEol}
              options={[
                ['crlf', 'CRLF'],
                ['lf', 'LF'],
              ]}
              onChange={(v) => update({ csvEol: v as ExportPrefs['csvEol'] })}
            />
            <SelectRow
              label={t('csvGuard')}
              value={prefs.csvFormulaGuard}
              options={[
                ['escape', t('guardEscape')],
                ['keep', t('guardKeep')],
                ['warn', t('guardWarn')],
              ]}
              onChange={(v) => update({ csvFormulaGuard: v as ExportPrefs['csvFormulaGuard'] })}
            />
            <CheckRow
              label={t('sepLine')}
              checked={prefs.csvSepLine}
              onChange={(v) => update({ csvSepLine: v })}
            />
          </Group>

          <Group title={t('groupTableSemantics')}>
            <RadioRow
              legend={t('legendMergedCells')}
              value={prefs.mergedCells}
              options={[
                ['duplicate', t('mergedDuplicate')],
                ['empty', t('mergedEmpty')],
              ]}
              onChange={(v) => update({ mergedCells: v as ExportPrefs['mergedCells'] })}
            />
            <SelectRow
              label={t('linksInCells')}
              value={prefs.linksInCells}
              options={[
                ['text', t('linksText')],
                ['text-url', t('linksTextUrl')],
                ['url', t('linksUrl')],
              ]}
              onChange={(v) => update({ linksInCells: v as ExportPrefs['linksInCells'] })}
            />
            <CheckRow
              label={t('parseNumbers')}
              checked={prefs.parseNumbers}
              onChange={(v) => update({ parseNumbers: v })}
            />
            <Callout tone="info">{t('calloutAmbiguousNumbers')}</Callout>
            <CheckRow
              label={t('parseDates')}
              checked={prefs.parseDates}
              onChange={(v) => update({ parseDates: v })}
            />
            <CheckRow
              label={t('visibleRowsOnly')}
              checked={prefs.visibleRowsOnly}
              onChange={(v) => update({ visibleRowsOnly: v })}
            />
            <CheckRow
              label={t('alwaysPreview')}
              checked={prefs.alwaysPreview}
              onChange={(v) => update({ alwaysPreview: v })}
            />
          </Group>
        </>
      )}

      {tab === 'text' && (
        <Group title={t('tabText')}>
          <RadioRow
            legend={t('legendDefaultTextFormat')}
            value={prefs.defaultTextFormat}
            options={[
              ['md', '.md'],
              ['txt', '.txt'],
            ]}
            onChange={(v) => update({ defaultTextFormat: v as ExportPrefs['defaultTextFormat'] })}
          />
          <Callout tone="info">{t('calloutTextMenuOrder')}</Callout>
        </Group>
      )}

      {tab === 'filenames' && (
        <Group title={t('groupFilenameTemplate')}>
          <label className="opt__field opt__field--stack">
            <span>{t('templateLabel')}</span>
            <input
              type="text"
              value={prefs.filenameTemplate}
              onChange={(e) => update({ filenameTemplate: e.target.value })}
            />
          </label>
          <p className="opt__hint">
            {t('availableTokens', {
              tokens: '{host} {title} {caption} {date} {time} {index} {rows} {cols}',
            })}
          </p>
          <p className="opt__hint mono">
            {t('example')}{' '}
            {buildFilename(
              prefs.filenameTemplate,
              {
                host: t('exampleHost'),
                title: t('exampleTitle'),
                caption: t('exampleCaption'),
                date: '2026-07-14',
                time: '1200',
                index: '1',
                rows: '12',
                cols: '4',
              },
              'xlsx',
              prefs.filenameTranslit,
            )}
          </p>
          <CheckRow
            label={t('translitFilename')}
            checked={prefs.filenameTranslit}
            onChange={(v) => update({ filenameTranslit: v })}
          />
          <Callout tone="warn" title={t('calloutFilenameSafetyTitle')}>
            {t('calloutFilenameSafetyBody')}
          </Callout>
        </Group>
      )}

      {tab === 'about' && (
        <>
          <Group title={t('groupHowItWorks')}>
            <p className="opt__hint">{t('aboutHow1')}</p>
            <p className="opt__hint">{t('aboutHow2')}</p>
          </Group>

          <Group title={t('groupPermissions')}>
            <p className="opt__hint">{t('aboutPerm1')}</p>
            <p className="opt__hint">
              <strong>{t('aboutPermImagesTitle')}</strong> {t('aboutPermImagesBody')}
            </p>
            <p className="line">
              {t('statusLabel')}{' '}
              {downloadsGranted === null
                ? '…'
                : downloadsGranted
                  ? t('statusGranted')
                  : t('statusNotGranted')}
            </p>
            <div className="btnrow">
              <button className="opt__btn" onClick={() => void requestDownloads()}>
                {downloadsGranted ? t('revokePermission') : t('requestPermission')}
              </button>
            </div>
          </Group>

          <Group title={t('groupSecurity')}>
            <Callout tone="info" title={t('calloutZeroNetworkTitle')}>
              {t('calloutZeroNetworkBody')}
            </Callout>
            <Callout tone="warn" title={t('calloutCsvFormulaTitle')}>
              {t('calloutCsvFormulaBody')}
            </Callout>
            <Callout tone="info" title={t('calloutFilenamesTitle')}>
              {t('calloutFilenamesBody')}
            </Callout>
          </Group>
        </>
      )}
    </div>
  );
}

/* ---- small presentational helpers -------------------------------- */

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="opt__group">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function RadioRow({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="opt__radios">
      <legend>{legend}</legend>
      {options.map(([v, label]) => (
        <label key={v} className="opt__radio">
          <input type="radio" checked={value === v} onChange={() => onChange(v)} />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="opt__field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="opt__check">
      <input type="checkbox" checked={checked} onChange={() => onChange(!checked)} />
      {label}
    </label>
  );
}
