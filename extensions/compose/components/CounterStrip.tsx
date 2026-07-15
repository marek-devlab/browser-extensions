import type { Counts } from '../utils/counter';
import { targetInfo } from '../utils/targets';
import type { Settings, Target } from '../utils/types';

// Always-visible one-line counter (design §2.8).
//
// The numbers come from Intl.Segmenter (utils/counter.ts); the compatibility
// status comes from the SAME converter that will run on copy (utils/convert.ts),
// so the strip can never promise something the clipboard then contradicts.
//
// ⚠️ Severity is carried by TEXT, not colour alone (design §2.8, PLAN §18c) —
// "⚠️ Slack: 2 конструкции упростятся", not a yellow dot.
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
  const info = targetInfo(target);
  const compat =
    degradations.length === 0
      ? `${info.label} ✓ совместимо`
      : `⚠️ ${info.label}: ${degradations.length} ${plural(degradations.length)}`;

  const parts: string[] = [];
  if (fields.graphemes !== false)
    parts.push(`${counts.graphemes}${counts.approximate ? '~' : ''} симв`);
  if (fields.utf16) parts.push(`${counts.utf16} UTF-16`);
  if (fields.bytes !== false) parts.push(`${counts.bytes} Б UTF-8`);
  if (fields.words !== false) parts.push(`${counts.words} слов`);
  if (fields.lines) parts.push(`${counts.lines} строк`);
  if (fields.reading) parts.push(`~${counts.readingMinutes} мин`);

  return (
    <div
      className="cw-counter"
      aria-label={`${counts.graphemes} символов, ${counts.words} слов, ${counts.bytes} байт. ${compat}`}
    >
      <span className="mono">{parts.join(' · ')}</span>
      {degradations.length > 0 ? (
        <button type="button" className="cw-linklike cw-counter__compat" onClick={onCompat}>
          · {compat} — что именно?
        </button>
      ) : (
        <span className="cw-counter__compat">· {compat}</span>
      )}
      <button
        type="button"
        className="cw-tool cw-tool--inline"
        aria-expanded={expanded}
        aria-controls="cw-drawer"
        title={expanded ? 'Свернуть инструменты' : 'Подробнее — статистика и инструменты'}
        aria-label={expanded ? 'Свернуть инструменты' : 'Подробнее'}
        onClick={onToggle}
      >
        {expanded ? '⌄' : '⌃'}
      </button>
    </div>
  );
}

function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'конструкция упростится';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'конструкции упростятся';
  return 'конструкций упростятся';
}
