import { createTranslator, useLocale, type Catalog, type Locale } from '@blur/ui';
import { useCallback } from 'react';

// Runtime UI catalog for the Vision Simulator. English is the source of truth and
// the default; `ru`/`et` are complete mirrors, enforced at compile time by
// `Catalog<MsgKey>` (a missing key fails `tsc`). Only user-facing copy lives here;
// the medical condition names keep their standard forms.

export type TFn = (key: MsgKey, vars?: Record<string, string | number>) => string;

const en = {
  appTitle: 'Vision Simulator',
  tagline: 'See this page the way others do',
  loading: 'Loading…',
  language: 'Language',
  langSwitcherLabel: 'Interface language',

  groupColor: 'Colour vision',
  groupLowVision: 'Low vision',

  cvdNone: 'Normal colour vision',
  cvdProtanopia: 'Protanopia (red-blind)',
  cvdDeuteranopia: 'Deuteranopia (green-blind)',
  cvdTritanopia: 'Tritanopia (blue-blind)',
  cvdAchromatopsia: 'Achromatopsia (no colour)',

  severity: 'Severity',
  severityApprox: 'Approximate below 100% — exact at full strength.',

  condCataract: 'Cataract',
  condBlur: 'Blurred vision',
  condLowContrast: 'Low contrast',
  condGrayscale: 'Grayscale',
  intensity: 'Intensity',

  reset: 'Reset',
  showOriginal: 'Show original',
  showSimulation: 'Show simulation',
  simulating: 'Simulating the current tab.',

  noteAccuracy:
    'Colour-vision matrices use the Machado (2009) model — the same one Chrome uses. Partial severity and tritanopia are approximations.',
  errCantSimulate:
    'This page can’t be simulated (browser and store pages are off-limits). Open a normal web page and try again.',
} as const;

type MsgKey = keyof typeof en;

const ru: Record<MsgKey, string> = {
  appTitle: 'Симулятор зрения',
  tagline: 'Посмотрите на страницу глазами других',
  loading: 'Загрузка…',
  language: 'Язык',
  langSwitcherLabel: 'Язык интерфейса',

  groupColor: 'Цветовое зрение',
  groupLowVision: 'Слабое зрение',

  cvdNone: 'Обычное цветовое зрение',
  cvdProtanopia: 'Протанопия (нечувствительность к красному)',
  cvdDeuteranopia: 'Дейтеранопия (нечувствительность к зелёному)',
  cvdTritanopia: 'Тританопия (нечувствительность к синему)',
  cvdAchromatopsia: 'Ахроматопсия (без цвета)',

  severity: 'Степень',
  severityApprox: 'Ниже 100% — приблизительно, точно только на максимуме.',

  condCataract: 'Катаракта',
  condBlur: 'Размытое зрение',
  condLowContrast: 'Низкий контраст',
  condGrayscale: 'Оттенки серого',
  intensity: 'Интенсивность',

  reset: 'Сбросить',
  showOriginal: 'Показать оригинал',
  showSimulation: 'Показать симуляцию',
  simulating: 'Симуляция активной вкладки.',

  noteAccuracy:
    'Матрицы цветового зрения по модели Machado (2009) — той же, что использует Chrome. Частичная степень и тританопия — приближения.',
  errCantSimulate:
    'Эту страницу нельзя симулировать (внутренние страницы браузера и магазина недоступны). Откройте обычную веб-страницу и повторите.',
};

const et: Record<MsgKey, string> = {
  appTitle: 'Nägemise simulaator',
  tagline: 'Vaata seda lehte nii, nagu näevad teised',
  loading: 'Laadimine…',
  language: 'Keel',
  langSwitcherLabel: 'Liidese keel',

  groupColor: 'Värvinägemine',
  groupLowVision: 'Vaegnägemine',

  cvdNone: 'Tavaline värvinägemine',
  cvdProtanopia: 'Protanoopia (punapimedus)',
  cvdDeuteranopia: 'Deuteranoopia (rohepimedus)',
  cvdTritanopia: 'Tritanoopia (sinipimedus)',
  cvdAchromatopsia: 'Ahromatoopia (värvitu)',

  severity: 'Raskusaste',
  severityApprox: 'Alla 100% ligikaudne — täpne ainult täisväärtusel.',

  condCataract: 'Kae',
  condBlur: 'Hägune nägemine',
  condLowContrast: 'Madal kontrast',
  condGrayscale: 'Halltoonid',
  intensity: 'Intensiivsus',

  reset: 'Lähtesta',
  showOriginal: 'Näita originaali',
  showSimulation: 'Näita simulatsiooni',
  simulating: 'Simuleerin aktiivset kaarti.',

  noteAccuracy:
    'Värvinägemise maatriksid kasutavad Machado (2009) mudelit — sama, mida kasutab Chrome. Osaline raskusaste ja tritanoopia on ligikaudsed.',
  errCantSimulate:
    'Seda lehte ei saa simuleerida (brauseri ja poe siselehed on välistatud). Ava tavaline veebileht ja proovi uuesti.',
};

const messages: Catalog<MsgKey> = { en, ru, et };
const translate = createTranslator<MsgKey>(messages);

export function useT(): TFn {
  const locale = useLocale();
  return useCallback(
    (key: MsgKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
}

export function tAt(locale: Locale, key: MsgKey, vars?: Record<string, string | number>): string {
  return translate(locale, key, vars);
}
