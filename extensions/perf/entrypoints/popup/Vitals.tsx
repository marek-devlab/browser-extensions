import type { VitalRating, WebVital } from '@blur/core';
import { formatVital, VITAL_THRESHOLDS } from '@blur/core';
import type {
  LongFrameSummary,
  PageTiming,
  PerfWebVital,
  VitalDetail,
} from '../../utils/perf-types';
import { useT, type MsgKey, type TFn } from '../../utils/i18n';
import './vitals.css';

// The Vitals section of the popup, rebuilt around one question: "what do I DO
// about this number?"
//
// The old section showed four acronyms, a value, a grade and a threshold. Three
// things were wrong with it, and each is fixed here:
//
//   1. "LCP" / "CLS" / "TTFB" mean nothing to most people. Every metric now has a
//      spelled-out name and one plain sentence saying what it measures, one tap
//      away (the row expands) so the collapsed list stays as short as before.
//
//   2. A grade is not a fix. `web-vitals/attribution` was ALREADY telling us the
//      element that shifted, the phase of LCP that dominated, and which part of
//      an interaction was slow — and the extension threw all of it away. Now, for
//      any metric that is not `good`, the row carries a "What to fix" line that
//      names the culprit the browser actually reported and the concrete action
//      for that specific cause.
//
//   3. The honesty rule from the byte accounting applies here too. We only ever
//      say what was measured: if the browser gave no attribution target we say so
//      rather than guess an element, and a metric that has not happened yet (INP
//      before the first interaction) is shown as "not measured yet", never as 0.

const ORDER: WebVital['name'][] = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'];

/** Spelled-out metric name — the acronym never appears without its expansion. */
const FULL_KEY: Record<WebVital['name'], MsgKey> = {
  LCP: 'viFullLCP',
  INP: 'viFullINP',
  CLS: 'viFullCLS',
  FCP: 'viFullFCP',
  TTFB: 'viFullTTFB',
};

/** One plain sentence about what the metric actually measures. */
const WHAT_KEY: Record<WebVital['name'], MsgKey> = {
  LCP: 'viWhatLCP',
  INP: 'viWhatINP',
  CLS: 'viWhatCLS',
  FCP: 'viWhatFCP',
  TTFB: 'viWhatTTFB',
};

function ratingLabel(t: TFn, rating: VitalRating): string {
  if (rating === 'good') return t('ratingGood');
  if (rating === 'needs-improvement') return t('ratingNi');
  return t('ratingPoor');
}

function ms(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
}

/** Format a Core Web Vitals threshold in the metric's own unit. */
function formatThreshold(name: WebVital['name'], v: number): string {
  if (name === 'CLS') return v.toFixed(2);
  if (v >= 1000) return `${(v / 1000).toFixed(1)} s`;
  return `${v} ms`;
}

/* ------------------------------------------------------------------ */
/* Phase breakdowns                                                    */
/* ------------------------------------------------------------------ */

interface Phase {
  labelKey: MsgKey;
  value: number;
  /** The fix to apply when THIS phase is the dominant one. */
  fixKey: MsgKey;
}

/**
 * The sub-parts of a metric, largest last-resort first. Returns [] when the
 * browser reported no breakdown — we then say nothing rather than invent one.
 */
function phasesOf(v: PerfWebVital): Phase[] {
  const d: VitalDetail | undefined = v.detail;
  if (!d) return [];
  if (d.lcp) {
    return [
      { labelKey: 'viLblServerResponse', value: d.lcp.ttfb, fixKey: 'viFixLcpServer' },
      { labelKey: 'viLblResourceDiscovery', value: d.lcp.resourceLoadDelay, fixKey: 'viFixLcpDiscovery' },
      { labelKey: 'viLblResourceDownload', value: d.lcp.resourceLoadDuration, fixKey: 'viFixLcpDownload' },
      { labelKey: 'viLblRenderDelay', value: d.lcp.elementRenderDelay, fixKey: 'viFixLcpRender' },
    ];
  }
  if (d.ttfb) {
    return [
      { labelKey: 'viLblWaiting', value: d.ttfb.waitingDuration, fixKey: 'viFixTtfbWaiting' },
      { labelKey: 'viLblDnsLookup', value: d.ttfb.dnsDuration, fixKey: 'viFixTtfbDns' },
      { labelKey: 'viLblConnection', value: d.ttfb.connectionDuration, fixKey: 'viFixTtfbConnection' },
      { labelKey: 'viLblServerProcessing', value: d.ttfb.requestDuration, fixKey: 'viFixTtfbServer' },
    ];
  }
  if (d.fcp) {
    return [
      { labelKey: 'viLblServerResponse', value: d.fcp.ttfb, fixKey: 'viFixFcpServer' },
      { labelKey: 'viLblRenderBlocking', value: d.fcp.firstByteToFCP, fixKey: 'viFixFcpRenderBlocking' },
    ];
  }
  if (d.inp) {
    return [
      { labelKey: 'viLblInputDelay', value: d.inp.inputDelay, fixKey: 'viFixInpInput' },
      { labelKey: 'viLblEventHandlers', value: d.inp.processingDuration, fixKey: 'viFixInpHandlers' },
      { labelKey: 'viLblPresentationDelay', value: d.inp.presentationDelay, fixKey: 'viFixInpPresentation' },
    ];
  }
  return [];
}

function dominant(phases: Phase[]): Phase | null {
  let best: Phase | null = null;
  for (const p of phases) {
    if (p.value > 0 && (!best || p.value > best.value)) best = p;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* "What to fix" — only ever states what the browser actually reported  */
/* ------------------------------------------------------------------ */

function Fix({ v }: { v: PerfWebVital }) {
  const t = useT();
  const target = v.attribution;

  // CLS is the one metric whose fix is about an ELEMENT rather than a phase.
  //
  // Precision matters in the wording here. The browser reports the element that
  // MOVED — which is generally NOT the element at fault: an image that loads
  // without a reserved height stays put and shoves the paragraph below it down, so
  // the browser names the paragraph. Claiming "this element is the problem, give it
  // a height" would be a confident lie about data we did not measure. We say what
  // was measured (this moved, by this much, at this moment) and describe the class
  // of cause honestly, pointing the user at the thing that appeared ABOVE it.
  if (v.name === 'CLS') {
    const shift = v.detail?.cls;
    return (
      <div className="v__fix">
        <span className="v__fix-title">{t('viWhatToFix')}</span>
        {target ? (
          <>
            <p className="v__fix-text">
              {t('viClsMoved')}
              {shift
                ? ` (${t('viClsParen', {
                    shift: shift.largestShiftValue.toFixed(3),
                    total: v.value.toFixed(3),
                    at:
                      shift.largestShiftTime !== undefined
                        ? t('viClsAt', { time: ms(shift.largestShiftTime) })
                        : '',
                  })})`
                : ''}
              :
            </p>
            <code className="v__target" title={target}>
              {target}
            </code>
            <p className="v__fix-text">
              {t('viClsPushed1')}
              <strong>{t('viClsAboveIt')}</strong>
              {t('viClsPushed2')}
              <code>width</code>/<code>height</code>
              {t('viClsPushed3')}
            </p>
            <p className="v__fix-text">
              {t('viClsGive1')}
              <code>aspect-ratio</code>
              {t('viClsGive2')}
            </p>
          </>
        ) : (
          <p className="v__fix-text">{t('viClsNoTarget')}</p>
        )}
      </div>
    );
  }

  const phases = phasesOf(v);
  const worst = dominant(phases);
  if (!worst) {
    return (
      <div className="v__fix">
        <span className="v__fix-title">{t('viWhatToFix')}</span>
        <p className="v__fix-text">{t('viNoBreakdown')}</p>
      </div>
    );
  }

  return (
    <div className="v__fix">
      <span className="v__fix-title">{t('viWhatToFix')}</span>
      <p className="v__fix-text">
        {t('viBiggestSlicePre')}
        <strong>{t(worst.labelKey)}</strong>
        {t('viBiggestSliceMid', { worst: ms(worst.value), total: ms(v.value) })}
      </p>
      {target && (
        <>
          <p className="v__fix-text">
            {v.name === 'LCP' ? t('viLargestElement') : t('viSlowestInteraction')}
          </p>
          <code className="v__target" title={target}>
            {target}
          </code>
        </>
      )}
      <p className="v__fix-text">{t(worst.fixKey)}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function PhaseBars({ phases, total }: { phases: Phase[]; total: number }) {
  const t = useT();
  if (phases.length === 0 || total <= 0) return null;
  return (
    <ul className="phases">
      {phases.map((p) => (
        <li key={p.labelKey} className="phase">
          <span className="phase__label">{t(p.labelKey)}</span>
          <span className="phase__bar" aria-hidden="true">
            <span
              className="phase__fill"
              style={{ inlineSize: `${Math.min(100, (p.value / total) * 100)}%` }}
            />
          </span>
          <span className="phase__value mono">{ms(p.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function VitalRow({ v }: { v: PerfWebVital }) {
  const t = useT();
  const th = VITAL_THRESHOLDS[v.name];
  const phases = phasesOf(v);
  const bad = v.rating !== 'good';

  return (
    <li className={`v rating--${v.rating}`}>
      <details className="v__details">
        <summary className="v__summary">
          <span className="v__head">
            <span className="v__abbr">{v.name}</span>
            <span className="v__full">{t(FULL_KEY[v.name])}</span>
          </span>
          <span className="v__nums">
            <span className="v__value mono">{formatVital(v)}</span>
            {/* Rating in text, never conveyed by the border colour alone. */}
            <span className="v__rating">{ratingLabel(t, v.rating)}</span>
          </span>
        </summary>
        <div className="v__body">
          <p className="v__what">{t(WHAT_KEY[v.name])}</p>
          <p className="v__thresh mono">
            {t('threshGood', { v: formatThreshold(v.name, th.good) })} ·{' '}
            {t('threshPoor', { v: formatThreshold(v.name, th.poor) })}
          </p>
          {v.name === 'CLS' ? (
            v.detail?.cls && v.detail.cls.largestShiftTime !== undefined ? (
              <p className="v__thresh mono">
                {t('viLargestShift', {
                  value: v.detail.cls.largestShiftValue.toFixed(3),
                  time: ms(v.detail.cls.largestShiftTime),
                })}
              </p>
            ) : null
          ) : (
            <PhaseBars phases={phases} total={v.value} />
          )}
          {v.name === 'LCP' && v.detail?.lcp?.url && (
            <p className="v__res mono" title={v.detail.lcp.url}>
              {v.detail.lcp.url}
            </p>
          )}
        </div>
      </details>
      {/* A bad score is only useful with the cause attached, so the fix is shown
          without needing to expand anything. */}
      {bad && <Fix v={v} />}
    </li>
  );
}

/** INP has no value until someone actually interacts. Say that, rather than 0. */
function MissingInp() {
  const t = useT();
  return (
    <li className="v v--missing">
      <div className="v__summary v__summary--static">
        <span className="v__head">
          <span className="v__abbr">INP</span>
          <span className="v__full">{t(FULL_KEY.INP)}</span>
        </span>
        <span className="v__nums">
          <span className="v__value mono">—</span>
        </span>
      </div>
      <p className="v__what v__what--pad">
        {import.meta.env.FIREFOX ? t('viInpFf') : t('viInpNotYet')}
      </p>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Navigation timing + main-thread blocking                            */
/* ------------------------------------------------------------------ */

function TimingRow({ label, value }: { label: string; value: number | null }) {
  return (
    <li className="trow">
      <span className="trow__label">{label}</span>
      <span className="trow__value mono">{value === null ? '—' : ms(value)}</span>
    </li>
  );
}

function LoadTimeline({ timing }: { timing: PageTiming }) {
  const t = useT();
  return (
    <details className="block">
      <summary className="block__summary">
        {t('viLoadTimeline')}
        <span className="block__hint mono">
          {timing.load !== null
            ? t('viHintLoad', { t: ms(timing.load) })
            : timing.domContentLoaded !== null
              ? t('viHintDom', { t: ms(timing.domContentLoaded) })
              : t('viHintMeasuring')}
        </span>
      </summary>
      <div className="block__body">
        <p className="v__what">{t('viTimelineIntro')}</p>
        <ul className="trows">
          <TimingRow label={t('viTimeDns')} value={timing.dns} />
          <TimingRow label={t('viTimeConnect')} value={timing.tcp} />
          <TimingRow label={t('viTimeTls')} value={timing.tls} />
          <TimingRow label={t('viTimeRequest')} value={timing.request} />
          <TimingRow label={t('viTimeResponse')} value={timing.response} />
          <TimingRow label={t('viTimeDcl')} value={timing.domContentLoaded} />
          <TimingRow label={t('viTimeLoad')} value={timing.load} />
        </ul>
        {timing.redirectMasked ? (
          <p className="v__what">{t('viRedirectMasked')}</p>
        ) : timing.redirectCount > 0 ? (
          <p className="v__what">
            {t(timing.redirectCount === 1 ? 'viRedirectsOne' : 'viRedirectsOther', {
              count: timing.redirectCount,
            })}
          </p>
        ) : null}
        {timing.tls === null && !timing.redirectMasked && (
          <p className="v__what">{t('viNoTls')}</p>
        )}
      </div>
    </details>
  );
}

/** Total blocking time — the main-thread cost that makes a page feel unresponsive. */
function Blocking({ summary }: { summary: LongFrameSummary }) {
  const t = useT();
  const supported = summary.loafSupported || summary.longTaskSupported;
  if (!supported) {
    return (
      <details className="block">
        <summary className="block__summary">
          {t('mainThreadBlocking')}
          <span className="block__hint mono">{t('na')}</span>
        </summary>
        <div className="block__body">
          <p className="v__what">{t('viBlockingUnsupported')}</p>
        </div>
      </details>
    );
  }

  const total = Math.round(summary.totalBlockingDuration);
  // The same script can be slow in many frames; roll up by URL so one line names
  // the real offender rather than the worst single frame.
  const byUrl = new Map<string, number>();
  for (const f of summary.frames) {
    for (const s of f.scripts) {
      if (!s.sourceURL) continue;
      byUrl.set(s.sourceURL, (byUrl.get(s.sourceURL) ?? 0) + s.duration);
    }
  }
  const worst = [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <details className="block">
      <summary className="block__summary">
        {t('mainThreadBlocking')}
        <span className={total > 200 ? 'block__hint mono block__hint--warn' : 'block__hint mono'}>
          {total} ms
        </span>
      </summary>
      <div className="block__body">
        <p className="v__what">{t('viBlockingIntro')}</p>
        {summary.frames.length === 0 ? (
          <p className="v__what">
            {t('viRespNoFrames', {
              kind: summary.loafSupported ? t('viKindAnimFrames') : t('viKindTasks'),
            })}
          </p>
        ) : total === 0 ? (
          /* Long frames can exist with ZERO blocking duration (a frame that ran
             long but never held up an interaction). Listing the scripts in those
             frames under "responsible" would pin a cost on them that the browser
             did not measure. */
          <p className="v__what">
            {t(
              summary.frames.length === 1 ? 'viLongFramesNoBlockOne' : 'viLongFramesNoBlockOther',
              { count: summary.frames.length },
            )}
          </p>
        ) : worst.length === 0 ? (
          <p className="v__what">
            {t(
              summary.frames.length === 1 ? 'viLongFramesNoScriptOne' : 'viLongFramesNoScriptOther',
              { count: summary.frames.length },
            )}
          </p>
        ) : (
          <>
            <p className="v__what">{t('viScriptsResponsible')}</p>
            <ul className="trows">
              {worst.map(([url, dur]) => (
                <li key={url} className="trow">
                  <span className="trow__label mono trow__label--url" title={url}>
                    {shortUrl(url)}
                  </span>
                  <span className="trow__value mono">{ms(dur)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const tail = u.pathname.split('/').filter(Boolean).pop();
    return tail ? `${u.hostname}/${tail}` : u.hostname;
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------------ */

export function VitalsSection({
  vitals,
  timing,
  longFrames,
}: {
  vitals: PerfWebVital[];
  timing: PageTiming | null;
  longFrames: LongFrameSummary | null;
}) {
  const t = useT();
  const sorted = [...vitals].sort(
    (a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name),
  );
  const hasInp = sorted.some((v) => v.name === 'INP');
  // Show the INP placeholder only once the page has actually reported something,
  // otherwise the empty state below covers it.
  const showInpPlaceholder = sorted.length > 0 && !hasInp;

  return (
    <section className="vitals-section" aria-label="Web Vitals">
      <h2>{t('viVitals')}</h2>
      {sorted.length === 0 ? (
        <p className="caveat">{t('viEmpty')}</p>
      ) : (
        <>
          <p className="vitals-hint">{t('viTapHint')}</p>
          <ul className="vlist">
            {sorted.map((v) => (
              <VitalRow key={v.name} v={v} />
            ))}
            {showInpPlaceholder && <MissingInp />}
          </ul>
        </>
      )}

      {timing && <LoadTimeline timing={timing} />}
      {longFrames && <Blocking summary={longFrames} />}
    </section>
  );
}
