import type {
  LongFrameEntry,
  LongFrameSummary,
  ScriptAttribution,
} from '../../utils/perf-types';
import { useT } from '../../utils/i18n';

// Long Animation Frames / Long Tasks panel section (PLAN §7.2). Chromium-only —
// when neither observer is supported we say so plainly rather than imply the main
// thread was never blocked (which would be a false "all good").

function topScripts(scripts: ScriptAttribution[]): ScriptAttribution[] {
  return [...scripts]
    .filter((s) => s.sourceURL || s.sourceFunctionName)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 3);
}

function scriptLabel(s: ScriptAttribution): string {
  const fn = s.sourceFunctionName || '(anonymous)';
  const src = s.sourceURL ? new URL(s.sourceURL, location.href).pathname.split('/').pop() : '';
  return src ? `${fn} · ${src}` : fn;
}

/** One script URL's total contribution across every long frame in the load. */
interface ScriptOffender {
  sourceURL: string;
  totalDuration: number;
  totalLayout: number;
  occurrences: number;
}

/**
 * The per-frame table only shows the top 3 scripts of each frame, so a script
 * that is a little slow in many frames never surfaces. Aggregate the same script
 * URL across all frames to expose the real worst offenders for the whole load.
 */
function aggregateOffenders(frames: LongFrameEntry[]): ScriptOffender[] {
  const byUrl = new Map<string, ScriptOffender>();
  for (const frame of frames) {
    for (const s of frame.scripts) {
      if (!s.sourceURL) continue; // No URL to aggregate on — skip.
      const cur = byUrl.get(s.sourceURL) ?? {
        sourceURL: s.sourceURL,
        totalDuration: 0,
        totalLayout: 0,
        occurrences: 0,
      };
      cur.totalDuration += s.duration;
      cur.totalLayout += s.forcedStyleAndLayoutDuration;
      cur.occurrences += 1;
      byUrl.set(s.sourceURL, cur);
    }
  }
  return [...byUrl.values()].sort((a, b) => b.totalDuration - a.totalDuration);
}

function offenderName(sourceURL: string): string {
  try {
    const u = new URL(sourceURL, location.href);
    const tail = u.pathname.split('/').filter(Boolean).pop();
    return tail ? `${u.hostname}/${tail}` : u.hostname;
  } catch {
    return sourceURL;
  }
}

export function LongFramesSection({ summary }: { summary: LongFrameSummary }) {
  const t = useT();
  if (!summary.loafSupported && !summary.longTaskSupported) {
    return (
      <section className="loaf" aria-label={t('mainThreadBlocking')}>
        <h3 className="loaf__title">{t('mainThreadBlocking')}</h3>
        <p className="note">{t('lfUnsupported')}</p>
      </section>
    );
  }

  // Proper-noun API tokens — the source name is a fact, not translated prose.
  const source = summary.loafSupported ? 'Long Animation Frames' : 'Long Tasks';
  const kind = summary.loafSupported ? t('viKindAnimFrames') : t('viKindTasks');
  const frames = summary.frames;
  const offenders = aggregateOffenders(frames).slice(0, 10);

  return (
    <section className="loaf" aria-label={t('mainThreadBlocking')} aria-live="polite">
      <h3 className="loaf__title">{t('mainThreadBlocking')}</h3>
      <div className="loaf__summary">
        <div className="stat">
          <div className="stat__value mono">{Math.round(summary.totalBlockingDuration)} ms</div>
          <div className="stat__label">{t('lfTotalBlocking')}</div>
        </div>
        <div className="stat">
          <div className="stat__value mono">{frames.length}</div>
          <div className="stat__label">{summary.loafSupported ? t('lfLongFrames') : t('lfLongTasks')}</div>
        </div>
      </div>

      {frames.length === 0 ? (
        <p className="note">{t('lfNoFrames', { kind, source })}</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="net loaf__table">
              <thead>
                <tr>
                  <th className="num">{t('lfColStart')}</th>
                  <th className="num">{t('lfColDuration')}</th>
                  <th className="num">{t('lfColBlocking')}</th>
                  <th>{t('lfColTopScripts')}</th>
                </tr>
              </thead>
              <tbody>
                {frames.slice(0, 20).map((f, i) => {
                  const scripts = topScripts(f.scripts);
                  return (
                    <tr key={`${f.startTime}|${i}`}>
                      <td className="num mono">{Math.round(f.startTime)} ms</td>
                      <td className="num mono">{Math.round(f.duration)} ms</td>
                      <td className="num mono">{Math.round(f.blockingDuration)} ms</td>
                      <td>
                        {scripts.length === 0 ? (
                          <span className="note">{t('lfNoScriptAttr')}</span>
                        ) : (
                          <ul className="loaf__scripts">
                            {scripts.map((s, j) => (
                              <li key={j} className="mono" title={s.sourceURL || undefined}>
                                {scriptLabel(s)} — {Math.round(s.duration)} ms
                                {s.forcedStyleAndLayoutDuration > 0
                                  ? t('lfLayoutSuffix', {
                                      ms: Math.round(s.forcedStyleAndLayoutDuration),
                                    })
                                  : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="note">{t('lfSourceNote', { source })}</p>

          {offenders.length > 0 && (
            <>
              <h4 className="loaf__subtitle">{t('lfWorstOffenders')}</h4>
              <div className="table-scroll">
                <table className="net loaf__table">
                  <caption className="net__caption">{t('lfOffendersCaption')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('lfColScript')}</th>
                      <th scope="col" className="num">{t('lfColFrames')}</th>
                      <th scope="col" className="num">{t('lfColTotal')}</th>
                      <th scope="col" className="num">{t('lfColLayout')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offenders.map((o) => (
                      <tr key={o.sourceURL}>
                        <td className="mono url" title={o.sourceURL}>{offenderName(o.sourceURL)}</td>
                        <td className="num mono">{o.occurrences}</td>
                        <td className="num mono">{Math.round(o.totalDuration)} ms</td>
                        <td className="num mono">
                          {o.totalLayout > 0 ? `${Math.round(o.totalLayout)} ms` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
