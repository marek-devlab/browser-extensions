import { useEffect, useState } from 'react';
import { browser } from '#imports';
import {
  Button,
  Callout,
  LanguageSwitcher,
  LocaleProvider,
  SectionHeading,
  ThemeToggle,
  type Locale,
} from '@blur/ui';
import { buildVisionDefs, type VisionDefs } from '../../utils/filters';
import { applyVisionToPage } from '../../utils/inject';
import { useSettings, useThemeSetter, useVisionLocale } from '../../utils/settings';
import { useT } from '../../utils/i18n';
import type { CvdChoice, VisionSettings } from '../../utils/storage';

// Popup — the only surface. Toggling any control injects the matching SVG filters
// into the ACTIVE tab (activeTab + scripting, no host warning) and mirrors the
// selection to storage so the next open resumes. The simulation is per-tab and
// ephemeral: it lives as injected defs on the page and dies on reload.

export function App() {
  const { locale, setLocale } = useVisionLocale();
  return (
    <LocaleProvider locale={locale}>
      <PopupApp locale={locale} setLocale={setLocale} />
    </LocaleProvider>
  );
}

async function applyToActiveTab(defs: VisionDefs): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id !== 'number') throw new Error('no-tab');
  await browser.scripting.executeScript({
    target: { tabId: tab.id },
    func: applyVisionToPage,
    args: [defs.svg, defs.css],
  });
}

const CVD_OPTIONS: CvdChoice[] = [
  'none',
  'protanopia',
  'deuteranopia',
  'tritanopia',
  'achromatopsia',
];

const CVD_LABEL_KEY = {
  none: 'cvdNone',
  protanopia: 'cvdProtanopia',
  deuteranopia: 'cvdDeuteranopia',
  tritanopia: 'cvdTritanopia',
  achromatopsia: 'cvdAchromatopsia',
} as const;

function isDichromacy(c: CvdChoice): boolean {
  return c === 'protanopia' || c === 'deuteranopia' || c === 'tritanopia';
}

function anyActive(s: VisionSettings): boolean {
  return (
    s.cvd !== 'none' ||
    s.cataract > 0 ||
    s.refractiveBlur > 0 ||
    s.lowContrast > 0 ||
    s.grayscale
  );
}

function PopupApp({
  locale,
  setLocale,
}: {
  locale: Locale;
  setLocale: (l: Locale) => void;
}) {
  const t = useT();
  const { settings, update, reset } = useSettings();
  const { theme, setTheme } = useThemeSetter(settings, update);
  const [showOriginal, setShowOriginal] = useState(false);
  const [failed, setFailed] = useState(false);

  // Apply the current selection (or the cleared "show original" state) to the
  // active tab whenever either changes. A failure means an un-scriptable page
  // (browser/store internals) — surface it honestly rather than silently no-op.
  useEffect(() => {
    if (!settings) return;
    const defs = showOriginal ? { svg: '', css: '' } : buildVisionDefs(settings);
    setFailed(false);
    void applyToActiveTab(defs).catch(() => setFailed(true));
  }, [settings, showOriginal]);

  if (!settings) {
    return (
      <div className="popup">
        <p className="loading" role="status" aria-live="polite">
          <span className="ui-spinner" aria-hidden="true" /> {t('loading')}
        </p>
      </div>
    );
  }

  const active = anyActive(settings);

  return (
    <div className="popup">
      <header className="head">
        <div>
          <h1 className="head__title">{t('appTitle')}</h1>
          <p className="head__tagline">{t('tagline')}</p>
        </div>
        <ThemeToggle theme={theme} onChange={setTheme} />
      </header>

      {failed && (
        <Callout tone="warn">{t('errCantSimulate')}</Callout>
      )}

      {/* Colour vision — single-select. */}
      <section className="group">
        <SectionHeading>{t('groupColor')}</SectionHeading>
        <div className="radios" role="radiogroup" aria-label={t('groupColor')}>
          {CVD_OPTIONS.map((c) => (
            <label key={c} className="radio">
              <input
                type="radio"
                name="cvd"
                checked={settings.cvd === c}
                onChange={() => update({ cvd: c })}
              />
              <span>{t(CVD_LABEL_KEY[c])}</span>
            </label>
          ))}
        </div>
        {isDichromacy(settings.cvd) && (
          <label className="slider">
            <span className="slider__label">
              {t('severity')}
              <span className="slider__value">{Math.round(settings.cvdSeverity * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(settings.cvdSeverity * 100)}
              onChange={(e) => update({ cvdSeverity: Number(e.target.value) / 100 })}
            />
            <span className="slider__hint">{t('severityApprox')}</span>
          </label>
        )}
      </section>

      {/* Low vision — combinable. */}
      <section className="group">
        <SectionHeading>{t('groupLowVision')}</SectionHeading>
        <IntensitySlider
          label={t('condCataract')}
          value={settings.cataract}
          onChange={(v) => update({ cataract: v })}
        />
        <IntensitySlider
          label={t('condBlur')}
          value={settings.refractiveBlur}
          onChange={(v) => update({ refractiveBlur: v })}
        />
        <IntensitySlider
          label={t('condLowContrast')}
          value={settings.lowContrast}
          onChange={(v) => update({ lowContrast: v })}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={settings.grayscale}
            onChange={(e) => update({ grayscale: e.target.checked })}
          />
          <span>{t('condGrayscale')}</span>
        </label>
      </section>

      <div className="actions">
        <Button
          variant={showOriginal ? 'default' : 'primary'}
          disabled={!active}
          onClick={() => setShowOriginal((v) => !v)}
        >
          {showOriginal ? t('showSimulation') : t('showOriginal')}
        </Button>
        <Button variant="ghost" disabled={!active} onClick={reset}>
          {t('reset')}
        </Button>
      </div>

      {active && !failed && (
        <p className="status" role="status">{t('simulating')}</p>
      )}

      <footer className="foot">
        <Callout tone="info">{t('noteAccuracy')}</Callout>
        <LanguageSwitcher locale={locale} onChange={setLocale} label={t('langSwitcherLabel')} />
      </footer>
    </div>
  );
}

function IntensitySlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span className="slider__label">
        {label}
        <span className="slider__value">{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
    </label>
  );
}
