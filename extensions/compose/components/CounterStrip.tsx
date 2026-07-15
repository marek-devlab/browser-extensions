import { useLocale, type Locale } from '@blur/ui';
import type { Counts } from '../utils/counter';
import { useT, type MsgKey } from '../utils/i18n';
import type { Settings, Target } from '../utils/types';

// Always-visible one-line counter (design §2.8).
//
// The numbers come from Intl.Segmenter (utils/counter.ts); the compatibility
// status comes from the SAME converter that will run on copy (utils/convert.ts),
// so the strip can never promise something the clipboard then contradicts.
//
// ⚠️ Severity is carried by TEXT, not colour alone (design §2.8, PLAN §18c).
// ⚠️ NOT aria-live: a screen reader must not read the counters out on every
// keystroke (design §9.2). It is aria-label-described and read on demand.

export function CounterStrip({
  counts,
  target,
  degradations,
  expanded,
  onToggle,
  onCompat,
  fields,
}: {
  counts: Counts;
  target: Target;
  degradations: string[];
  expanded: boolean;
  onToggle: () => void;
  onCompat: () => void;
  fields: Settings['counterFields'];
}) {
  const t = useT();
  const locale = useLocale();
  const label = t(`target_${target}` as MsgKey);

  const compat =
    degradations.length === 0
      ? t('counter_compat_ok', { label })
      : t('counter_compat_warn', {
          label,
          items: t(pluralKey(locale, degradations.length), { n: degradations.length }),
        });

  const parts: string[] = [];
  if (fields.graphemes !== false)
    parts.push(`${counts.graphemes}${counts.approximate ? '~' : ''} ${t('unit_chars_short')}`);
  if (fields.utf16) parts.push(`${counts.utf16} UTF-16`);
  if (fields.bytes !== false) parts.push(`${counts.bytes} ${t('unit_utf8_short')}`);
  if (fields.words !== false) parts.push(`${counts.words} ${t('unit_words_short')}`);
  if (fields.lines) parts.push(`${counts.lines} ${t('unit_lines_short')}`);
  if (fields.reading) parts.push(`~${counts.readingMinutes} ${t('unit_min_short')}`);

  return (
    <div
      className="cw-counter"
      aria-label={t('counter_aria', {
        g: counts.graphemes,
        w: counts.words,
        b: counts.bytes,
        compat,
      })}
    >
      <span className="mono">{parts.join(' · ')}</span>
      {degradations.length > 0 ? (
        <button type="button" className="cw-linklike cw-counter__compat" onClick={onCompat}>
          · {compat} — {t('counter_which')}
        </button>
      ) : (
        <span className="cw-counter__compat">· {compat}</span>
      )}
      <button
        type="button"
        className="cw-tool cw-tool--inline"
        aria-expanded={expanded}
        aria-controls="cw-drawer"
        title={expanded ? t('counter_collapse_title') : t('counter_expand_title')}
        aria-label={expanded ? t('counter_collapse_aria') : t('counter_expand_aria')}
        onClick={onToggle}
      >
        {expanded ? '⌄' : '⌃'}
      </button>
    </div>
  );
}

/** Plural bucket for the "N constructs will be simplified" clause. Russian has a
 *  three-way rule; English and Estonian split one vs. many. */
function pluralKey(locale: Locale, n: number): MsgKey {
  if (locale === 'ru') {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'counter_items_one';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'counter_items_few';
    return 'counter_items_many';
  }
  return n === 1 ? 'counter_items_one' : 'counter_items_few';
}
