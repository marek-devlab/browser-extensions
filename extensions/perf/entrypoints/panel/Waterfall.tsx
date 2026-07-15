import type { TimedNetworkEntry } from '../../utils/perf-types';
import { useT } from '../../utils/i18n';

// A simple horizontal waterfall of resource start/duration (PLAN §10 "developer").
// No new permission: it draws purely from the Resource-Timing / HAR entries already
// collected. Start offsets are normalised by subtracting the earliest start across
// the shown set, so it works whether the source's zero point is navigation-start
// (Resource Timing) or wall-clock (HAR).

const KIND_CLASS: Record<string, string> = {
  document: 'wf--document',
  script: 'wf--script',
  stylesheet: 'wf--stylesheet',
  image: 'wf--image',
  font: 'wf--font',
  xhr: 'wf--xhr',
  media: 'wf--media',
  other: 'wf--other',
};

// Legend order — colour alone can't convey kind (fails for colour-blind users and
// in monochrome), so each kind is also named in a visible legend and every bar
// carries a text label via its row's per-kind class + hover title.
const KIND_ORDER: readonly string[] = [
  'document',
  'script',
  'stylesheet',
  'image',
  'font',
  'xhr',
  'media',
  'other',
];

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const tail = u.pathname.split('/').filter(Boolean).pop() ?? u.hostname;
    return tail || u.hostname;
  } catch {
    return url;
  }
}

export function Waterfall({ entries }: { entries: TimedNetworkEntry[] }) {
  const t = useT();
  if (entries.length === 0) return null;

  // Cap rows so a heavy page doesn't render thousands of bars; keep the earliest.
  const MAX_ROWS = 60;
  const rows = [...entries].sort((a, b) => a.startTime - b.startTime).slice(0, MAX_ROWS);

  const minStart = Math.min(...rows.map((e) => e.startTime));
  const maxEnd = Math.max(...rows.map((e) => e.startTime + e.duration));
  const span = Math.max(1, maxEnd - minStart);

  // Only legend the kinds actually present, in a stable order.
  const presentKinds = KIND_ORDER.filter((k) => rows.some((e) => e.kind === k));

  return (
    <figure className="waterfall" aria-label={t('wfAria')}>
      <figcaption className="note">
        {t('wfCaptionPre')}
        {entries.length > MAX_ROWS
          ? t('wfFirstOf', { max: MAX_ROWS, total: entries.length })
          : ''}
        {t('wfCaptionPost', { ms: Math.round(span) })}
      </figcaption>
      <ul className="wf-legend" aria-label={t('wfKinds')}>
        {presentKinds.map((k) => (
          <li key={k} className="wf-legend__item">
            <span className={`wf-legend__swatch ${KIND_CLASS[k] ?? 'wf--other'}`} aria-hidden="true" />
            {k}
          </li>
        ))}
      </ul>
      <div className="waterfall__rows">
        {rows.map((e, i) => {
          const offset = ((e.startTime - minStart) / span) * 100;
          const width = Math.max(0.5, (e.duration / span) * 100);
          return (
            <div className="waterfall__row" key={`${e.url}|${i}`}>
              <span className="waterfall__label mono" title={e.url}>{shortUrl(e.url)}</span>
              <span className="waterfall__track">
                <span
                  className={`waterfall__bar ${KIND_CLASS[e.kind] ?? 'wf--other'}`}
                  style={{ marginInlineStart: `${offset}%`, inlineSize: `${width}%` }}
                  title={t('wfBarTitle', {
                    kind: e.kind,
                    start: Math.round(e.startTime - minStart),
                    dur: Math.round(e.duration),
                  })}
                />
              </span>
              <span className="waterfall__dur mono">{Math.round(e.duration)} ms</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
