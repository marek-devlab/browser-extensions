import type { EngineId, HonestyKey } from './engine-select';
import { engineBadge, engineExplanation, honestyKey, useT } from './i18n';

// The engine badge (design §2.2, §2.4, §9.2): TEXT (`dnr`/`page`/`dbg`/`wr`,
// `↓` when degraded) plus a glyph — never colour alone. The tooltip carries the
// one-line engine explanation. Shared by the popup and the tool page.

const GLYPH: Record<EngineId, string> = {
  dnr: '▸',
  page: '✱',
  debugger: '⚡',
  webrequest: '▹',
};

export function EngineBadge({
  engine,
  degraded = false,
  inactive = false,
}: {
  engine: EngineId | null;
  degraded?: boolean;
  inactive?: boolean;
}) {
  const t = useT();
  if (engine === null) {
    return (
      <span className="ebadge ebadge--none" data-engine="none">
        {t('engineNone')}
      </span>
    );
  }
  const label = engineBadge(t, engine, degraded);
  return (
    <span
      className={`ebadge ebadge--${engine}${inactive ? ' ebadge--inactive' : ''}`}
      data-engine={engine}
      data-degraded={degraded ? 'true' : undefined}
      title={engineExplanation(t, engine)}
    >
      <span aria-hidden="true">{GLYPH[engine]} </span>
      {label}
    </span>
  );
}

/** The honesty lines (design §6) that apply to a decision — one `<li>` each. */
export function HonestyNotes({ keys, className }: { keys: readonly HonestyKey[]; className?: string }) {
  const t = useT();
  if (keys.length === 0) return null;
  const unique = Array.from(new Set(keys));
  return (
    <ul className={`honesty${className ? ` ${className}` : ''}`}>
      {unique.map((k) => (
        <li key={k} data-honesty={k}>
          {t(honestyKey(k))}
        </li>
      ))}
    </ul>
  );
}
