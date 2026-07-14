import { todoLogic } from '@blur/ui';
import type { TranslitStandard } from './types';

// Cyrillic → Latin transliteration (design §2.6). 🔴 STUBBED.
//
// Five standards, and the DIFFERENCES between them are the product — so we ship
// our OWN tables, not a library (design §10.2): off-the-shelf packages implement
// one "average" standard and get the edges wrong (ь, ъ, й at word end, е after a
// vowel). ~5 tables × ~40 rules + contextual rules, fully testable, < 5 KB.

export interface TranslitStandardInfo {
  id: TranslitStandard;
  label: string;
  reversible: boolean;
  hint: string;
  /** Fabricated example on "Щербаков, Юлия" for the radio list (design §2.6). */
  example: string;
}

export const TRANSLIT_STANDARDS: TranslitStandardInfo[] = [
  { id: 'icao', label: 'Паспорт / ICAO', reversible: false, hint: 'То, что напишут в загранпаспорте.', example: 'Shcherbakov, Iuliia' },
  { id: 'bgn', label: 'BGN/PCGN', reversible: false, hint: 'Англо-американский стандарт географических имён.', example: 'Shcherbakov, Yuliya' },
  { id: 'iso9', label: 'ISO 9 / ГОСТ-А', reversible: true, hint: 'Обратимо: 1 буква → 1 буква с диакритикой.', example: 'Ŝerbakov, Ûliâ' },
  { id: 'gost-b', label: 'ГОСТ 7.79-Б', reversible: true, hint: 'Обратимо, без диакритики (диграфы).', example: 'Shherbakov, Yuliya' },
  { id: 'slug', label: 'slug', reversible: false, hint: 'Для веток GitLab, якорей заголовков, имён файлов.', example: 'shcherbakov-yuliya' },
];

export interface SlugOptions {
  separator: '-' | '_';
  lowercase: boolean;
  maxLen: number;
  collapseRepeats: boolean;
}

/**
 * TODO_LOGIC (compose): implement the five conversion tables + contextual rules
 * (е/ё after vowels, terminal й, ь/ъ handling), and the slug post-processor
 * (lowercase, separator, collapse repeats, truncate to maxLen). Runs synchronously
 * on the main thread (linear, no backtracking) EXCEPT "transliterate whole
 * draft" > 100 KB, which goes to a worker to avoid a long task (design §8.1).
 */
export function transliterate(
  _text: string,
  _standard: TranslitStandard,
  _slug?: SlugOptions,
): string {
  throw todoLogic('translit: 5 standards + contextual rules + slug post-process');
}

/** Scaffold stand-in: the fabricated per-standard example (design §2.6). */
export function mockTransliterate(standard: TranslitStandard): string {
  return TRANSLIT_STANDARDS.find((s) => s.id === standard)?.example ?? '';
}
