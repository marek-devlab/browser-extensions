import type { TranslitStandard } from './types';

// Cyrillic → Latin transliteration (design §2.6). FIVE standards, OWN tables.
//
// ⚠️ Deliberately NOT an npm package (design §10.2): off-the-shelf packages
// implement one "average" standard and get the edges wrong (ь, ъ, й at word end,
// е after a vowel). The DIFFERENCES between the standards ARE the product — a
// passport office, a git branch and an ISO-9 round trip want three different
// answers. Five tables × ~35 rules + a handful of contextual rules is under 5 KB
// of fully testable code, and there is nothing to patch upstream.
//
// Runs SYNCHRONOUSLY on the main thread: a table lookup is linear and has no
// backtracking, so unlike regex (utils/regex.worker.ts) it cannot hang the UI.
// Only "transliterate the whole draft" on a very large draft is chunked by the
// caller (design §8.1).

export interface TranslitStandardInfo {
  id: TranslitStandard;
  label: string;
  reversible: boolean;
  hint: string;
}

export const TRANSLIT_STANDARDS: TranslitStandardInfo[] = [
  {
    id: 'icao',
    label: 'Паспорт / ICAO',
    reversible: false,
    hint: 'То, что напишут в загранпаспорте (ICAO Doc 9303).',
  },
  {
    id: 'bgn',
    label: 'BGN/PCGN',
    reversible: false,
    hint: 'Англо-американский стандарт географических имён. «е» → «ye» после гласной.',
  },
  {
    id: 'iso9',
    label: 'ISO 9 / ГОСТ 7.79-А',
    reversible: true,
    hint: 'Обратимо: одна буква → одна буква с диакритикой.',
  },
  {
    id: 'gost-b',
    label: 'ГОСТ 7.79-Б',
    reversible: true,
    hint: 'Обратимо, без диакритики — диграфы и апострофы.',
  },
  {
    id: 'slug',
    label: 'slug',
    reversible: false,
    hint: 'Для веток GitLab, якорей заголовков и имён файлов: только a–z, 0–9 и разделитель.',
  },
];

/** The sample shown next to each standard when there is no selection (§2.6). */
export const TRANSLIT_SAMPLE = 'Щербаков, Юлия';

export interface SlugOptions {
  separator: '-' | '_';
  lowercase: boolean;
  maxLen: number;
  collapseRepeats: boolean;
}

export const DEFAULT_SLUG_OPTIONS: SlugOptions = {
  separator: '-',
  lowercase: true,
  maxLen: 63,
  collapseRepeats: true,
};

/* ── tables (lowercase source → latin) ─────────────────────────────────────*/

type Table = Record<string, string>;

/** ICAO Doc 9303 (Russian passports since 2014). ь → nothing, ъ → ie. */
const ICAO: Table = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: 'ie', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia',
};

/** BGN/PCGN 1947 (Russian). Contextual: е/ё → ye/yë at word start and after a
 *  vowel, ъ or ь. */
const BGN: Table = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'ë', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: 'ʺ', ы: 'y', ь: 'ʹ', э: 'e', ю: 'yu', я: 'ya',
};

/** ISO 9:1995 / ГОСТ 7.79 system A — strictly one letter → one letter. */
const ISO9: Table = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'ë', ж: 'ž', з: 'z',
  и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'č', ш: 'š', щ: 'ŝ',
  ъ: 'ʺ', ы: 'y', ь: 'ʹ', э: 'è', ю: 'û', я: 'â',
};

/** ГОСТ 7.79 system B — reversible WITHOUT diacritics (digraphs + apostrophes).
 *  ц is contextual: `c` before е/и/й/ы, `cz` otherwise. */
const GOST_B: Table = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
  и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'cz', ч: 'ch', ш: 'sh',
  щ: 'shh', ъ: "''", ы: "y'", ь: "'", э: "e'", ю: 'yu', я: 'ya',
};

/** Slug base: BGN without the ʹ/ʺ modifier letters, ё → yo. The result is fed
 *  through the slug post-processor (lowercase / separator / truncate). */
const SLUG: Table = {
  ...BGN,
  ё: 'yo', ъ: '', ь: '',
};

const TABLES: Record<TranslitStandard, Table> = {
  icao: ICAO,
  bgn: BGN,
  iso9: ISO9,
  'gost-b': GOST_B,
  slug: SLUG,
};

const VOWELS = new Set([...'аеёиоуыэюя']);

/* ── case handling ─────────────────────────────────────────────────────────*/

/**
 * Re-apply the source letter's case to a multi-character replacement:
 * `Щ` → `Shch` (title case), but `ЩЕРБАКОВ` → `SHCHERBAKOV` (all caps, decided
 * by looking at the NEXT letter — the classic bug in naive implementations).
 */
function applyCase(latin: string, upper: boolean, nextUpper: boolean): string {
  if (!upper || latin === '') return latin;
  if (nextUpper) return latin.toUpperCase();
  return latin.charAt(0).toUpperCase() + latin.slice(1);
}

function isCyrillic(ch: string): boolean {
  return /[а-яёА-ЯЁ]/.test(ch);
}

/* ── core ──────────────────────────────────────────────────────────────────*/

/**
 * Transliterate Cyrillic (ru) to Latin under one of the five standards.
 * Non-Cyrillic characters pass through untouched — the caller may hand us a
 * whole draft, and Latin text, punctuation and emoji must survive verbatim.
 */
export function transliterate(
  text: string,
  standard: TranslitStandard,
  slug: SlugOptions = DEFAULT_SLUG_OPTIONS,
): string {
  const table = TABLES[standard] ?? ICAO;
  const chars = [...text];
  let out = '';

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (!isCyrillic(ch)) {
      out += ch;
      continue;
    }
    const lower = ch.toLowerCase();
    const upper = ch !== lower;
    const nextRaw = chars[i + 1] ?? '';
    const nextLower = nextRaw.toLowerCase();
    const nextUpper = isCyrillic(nextRaw) && nextRaw !== nextLower;
    const prevLower = (chars[i - 1] ?? '').toLowerCase();
    const atWordStart = !isCyrillic(chars[i - 1] ?? '');

    let latin = table[lower] ?? ch;

    // ── contextual rules ────────────────────────────────────────────────
    if ((standard === 'bgn' || standard === 'slug') && (lower === 'е' || lower === 'ё')) {
      // BGN/PCGN: е → ye, ё → yë at word start and after a vowel, ъ or ь.
      const after = atWordStart || VOWELS.has(prevLower) || prevLower === 'ъ' || prevLower === 'ь';
      if (after) {
        if (standard === 'slug') latin = lower === 'е' ? 'ye' : 'yo';
        else latin = lower === 'е' ? 'ye' : 'yë';
      }
    }
    if (standard === 'gost-b' && lower === 'ц') {
      // ГОСТ 7.79-Б: c before е/и/й/ы, cz elsewhere (keeps the mapping reversible).
      latin = 'еийы'.includes(nextLower) ? 'c' : 'cz';
    }

    out += applyCase(latin, upper, nextUpper);
  }

  return standard === 'slug' ? slugify(out, slug) : out;
}

/**
 * Slug post-processor: everything that is not a–z/0–9 becomes the separator.
 * ⚠️ Runs on the ALREADY transliterated string, so `Щербаков` is `shcherbakov`,
 * not the dropped-to-nothing result you get from slugging Cyrillic directly.
 */
export function slugify(latin: string, o: SlugOptions = DEFAULT_SLUG_OPTIONS): string {
  // ̀-ͯ = the combining-diacritics block: ž → z, ë → e, â → a.
  let s = latin.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  if (o.lowercase) s = s.toLowerCase();
  s = s.replace(/[^a-zA-Z0-9]+/g, o.separator);
  if (o.collapseRepeats) {
    const sep = o.separator === '-' ? '-' : '_';
    s = s.replace(new RegExp(`\\${sep}{2,}`, 'g'), sep);
  }
  s = s.replace(new RegExp(`^\\${o.separator}+|\\${o.separator}+$`, 'g'), '');
  if (o.maxLen > 0 && s.length > o.maxLen) {
    s = s.slice(0, o.maxLen).replace(new RegExp(`\\${o.separator}+$`), '');
  }
  return s;
}

/**
 * The live per-standard example shown in the radio list (design §2.6). It is
 * computed from the REAL tables on the user's own text — never a hard-coded
 * string, which could drift from what the button actually produces (that is
 * exactly the "don't lie in the UI" rule).
 */
export function translitExample(
  standard: TranslitStandard,
  source: string,
  slug: SlugOptions = DEFAULT_SLUG_OPTIONS,
): string {
  const sample = source.trim() === '' ? TRANSLIT_SAMPLE : source.slice(0, 60);
  return transliterate(sample, standard, slug);
}
