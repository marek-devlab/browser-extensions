import type { Counts } from '../utils/counter';
import { targetInfo } from '../utils/targets';
import type { Target } from '../utils/types';

// Always-visible one-line counter (design §2.8). The NUMBERS are REAL (from the
// Intl.Segmenter counter). The platform-compat status text is mock (from the
// stubbed converter). Severity is conveyed by TEXT, not colour alone (design
// §2.8, PLAN §18c). Not aria-live — a screen reader must not read counts on
// every keystroke (design §9.2); it is aria-label described and read on demand.

export function CounterStrip({
  counts,
  target,
  degradations,
  expanded,
  onToggle,
}: {
  counts: Counts;
  target: Target;
  degradations: string[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const info = targetInfo(target);
  const compat =
    degradations.length === 0
      ? `${info.label} ✓ совместимо`
      : `⚠️ ${info.label}: ${degradations.length} ${degradations.length === 1 ? 'конструкция упростится' : 'конструкции упростятся'}`;

  return (
    <div
      className="cw-counter"
      aria-label={`${counts.graphemes} символов, ${counts.words} слов, ${counts.bytes} байт. ${compat}`}
    >
      <span className="mono">
        {counts.graphemes}{counts.approximate ? '~' : ''} симв · {counts.words} слов · {counts.bytes} Б
      </span>
      <span className="cw-counter__compat">· {compat}</span>
      <button
        type="button"
        className="cw-tool cw-tool--inline"
        aria-expanded={expanded}
        aria-controls="cw-drawer"
        title={expanded ? 'Свернуть' : 'Подробнее'}
        onClick={onToggle}
      >
        {expanded ? '⌄' : '⌃'}
      </button>
    </div>
  );
}
