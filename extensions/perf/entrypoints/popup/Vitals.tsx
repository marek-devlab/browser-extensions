import type { VitalRating, WebVital } from '@blur/core';
import { formatVital, VITAL_THRESHOLDS } from '@blur/core';
import type {
  LongFrameSummary,
  PageTiming,
  PerfWebVital,
  VitalDetail,
} from '../../utils/perf-types';
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

/** Spelled-out name + one plain sentence about what the metric actually measures. */
const EXPLAINER: Record<WebVital['name'], { full: string; what: string }> = {
  LCP: {
    full: 'Largest Contentful Paint',
    what:
      'How long until the biggest thing on screen — usually the hero image or headline — actually appeared. It is the reader’s sense of "the page loaded".',
  },
  INP: {
    full: 'Interaction to Next Paint',
    what:
      'When you click, tap or type, how long the page takes to show a response. It measures the slowest interaction of the visit, so it captures the moment the page felt sluggish.',
  },
  CLS: {
    full: 'Cumulative Layout Shift',
    what:
      'How much the page jumped around while loading — content moving under your finger just as you go to click it. It is a score, not a time; 0 means nothing moved.',
  },
  FCP: {
    full: 'First Contentful Paint',
    what:
      'How long until the very first text or image appeared, i.e. when the page stopped being blank.',
  },
  TTFB: {
    full: 'Time to First Byte',
    what:
      'How long the server took to send the first byte of the page. Everything else waits on this, so it is the floor under every other timing here.',
  },
};

function ratingLabel(rating: VitalRating): string {
  if (rating === 'good') return 'Good';
  if (rating === 'needs-improvement') return 'Needs improvement';
  return 'Poor';
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
  label: string;
  value: number;
  /** The fix to apply when THIS phase is the dominant one. */
  fix: string;
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
      {
        label: 'Server response',
        value: d.lcp.ttfb,
        fix: 'Most of the wait is the server itself. Speed up the response, remove redirects, or cache the HTML at the edge.',
      },
      {
        label: 'Resource discovery',
        value: d.lcp.resourceLoadDelay,
        fix: 'The browser found this resource late. Reference it in the initial HTML (not from JS/CSS) or add a `<link rel="preload">` so the download starts sooner.',
      },
      {
        label: 'Resource download',
        value: d.lcp.resourceLoadDuration,
        fix: 'The image itself is slow to download. Compress it, serve AVIF/WebP, and stop shipping a picture larger than it is displayed.',
      },
      {
        label: 'Render delay',
        value: d.lcp.elementRenderDelay,
        fix: 'The content was ready but the browser could not paint it. Render-blocking CSS/JS, a font swap, or a busy main thread is holding the frame back.',
      },
    ];
  }
  if (d.ttfb) {
    return [
      {
        label: 'Waiting (redirects, queue)',
        value: d.ttfb.waitingDuration,
        fix: 'Time is going on redirects, service-worker startup or request queueing before the request is even sent. Cut redirect hops.',
      },
      {
        label: 'DNS lookup',
        value: d.ttfb.dnsDuration,
        fix: 'DNS resolution dominates. `dns-prefetch`/`preconnect` to this origin, or use a faster DNS provider.',
      },
      {
        label: 'Connection (TCP + TLS)',
        value: d.ttfb.connectionDuration,
        fix: 'Setting up the connection dominates. Enable HTTP/2 or HTTP/3, keep connections alive, and `preconnect` to the origin.',
      },
      {
        label: 'Server processing',
        value: d.ttfb.requestDuration,
        fix: 'The server is thinking for too long. Cache the response, or profile the backend for the slow query.',
      },
    ];
  }
  if (d.fcp) {
    return [
      {
        label: 'Server response',
        value: d.fcp.ttfb,
        fix: 'The first paint is waiting on the server. Fix TTFB first — nothing can paint before the bytes arrive.',
      },
      {
        label: 'Render-blocking',
        value: d.fcp.firstByteToFCP,
        fix: 'The HTML arrived quickly but nothing painted. Render-blocking CSS/JS in the `<head>` is the usual cause — inline the critical CSS and defer the rest.',
      },
    ];
  }
  if (d.inp) {
    return [
      {
        label: 'Input delay',
        value: d.inp.inputDelay,
        fix: 'The main thread was already busy when you interacted, so the handler could not even start. Break up long tasks and defer non-urgent work.',
      },
      {
        label: 'Event handlers',
        value: d.inp.processingDuration,
        fix: 'The event handlers themselves are slow. Do the minimum needed to update the UI, and move the rest into a `requestIdleCallback` or a worker.',
      },
      {
        label: 'Presentation delay',
        value: d.inp.presentationDelay,
        fix: 'The handler finished quickly but the next frame took a long time to paint — usually a large style/layout recalculation.',
      },
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
        <span className="v__fix-title">What to fix</span>
        {target ? (
          <>
            <p className="v__fix-text">
              The biggest jump moved this element
              {shift
                ? ` (${shift.largestShiftValue.toFixed(3)} of the ${v.value.toFixed(3)} total${
                    shift.largestShiftTime !== undefined
                      ? `, at ${ms(shift.largestShiftTime)}`
                      : ''
                  })`
                : ''}
              :
            </p>
            <code className="v__target" title={target}>
              {target}
            </code>
            <p className="v__fix-text">
              It was pushed by something <strong>above it</strong> that arrived late
              and took up space it had not reserved — typically an image or iframe
              with no <code>width</code>/<code>height</code>, or a banner, ad or
              cookie bar injected after first paint.
            </p>
            <p className="v__fix-text">
              Give that late content explicit dimensions (or an{' '}
              <code>aspect-ratio</code>), and reserve its slot up front instead of
              letting it shove the page down.
            </p>
          </>
        ) : (
          <p className="v__fix-text">
            The browser recorded the shift but not the element responsible — it was
            removed from the page before the measurement was finalised. Reload and
            watch for content that appears late.
          </p>
        )}
      </div>
    );
  }

  const phases = phasesOf(v);
  const worst = dominant(phases);
  if (!worst) {
    return (
      <div className="v__fix">
        <span className="v__fix-title">What to fix</span>
        <p className="v__fix-text">
          This browser reported the score but no breakdown of what caused it, so
          there is nothing specific to point at here.
        </p>
      </div>
    );
  }

  return (
    <div className="v__fix">
      <span className="v__fix-title">What to fix</span>
      <p className="v__fix-text">
        Biggest slice: <strong>{worst.label}</strong>, {ms(worst.value)} of{' '}
        {ms(v.value)}.
      </p>
      {target && (
        <>
          <p className="v__fix-text">
            {v.name === 'LCP' ? 'Largest element:' : 'Slowest interaction was on:'}
          </p>
          <code className="v__target" title={target}>
            {target}
          </code>
        </>
      )}
      <p className="v__fix-text">{worst.fix}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function PhaseBars({ phases, total }: { phases: Phase[]; total: number }) {
  if (phases.length === 0 || total <= 0) return null;
  return (
    <ul className="phases">
      {phases.map((p) => (
        <li key={p.label} className="phase">
          <span className="phase__label">{p.label}</span>
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
  const t = VITAL_THRESHOLDS[v.name];
  const meta = EXPLAINER[v.name];
  const phases = phasesOf(v);
  const bad = v.rating !== 'good';

  return (
    <li className={`v rating--${v.rating}`}>
      <details className="v__details">
        <summary className="v__summary">
          <span className="v__head">
            <span className="v__abbr">{v.name}</span>
            <span className="v__full">{meta.full}</span>
          </span>
          <span className="v__nums">
            <span className="v__value mono">{formatVital(v)}</span>
            {/* Rating in text, never conveyed by the border colour alone. */}
            <span className="v__rating">{ratingLabel(v.rating)}</span>
          </span>
        </summary>
        <div className="v__body">
          <p className="v__what">{meta.what}</p>
          <p className="v__thresh mono">
            Good ≤ {formatThreshold(v.name, t.good)} · Poor &gt;{' '}
            {formatThreshold(v.name, t.poor)}
          </p>
          {v.name === 'CLS' ? (
            v.detail?.cls && v.detail.cls.largestShiftTime !== undefined ? (
              <p className="v__thresh mono">
                Largest single shift: {v.detail.cls.largestShiftValue.toFixed(3)} at{' '}
                {ms(v.detail.cls.largestShiftTime)}
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
  return (
    <li className="v v--missing">
      <div className="v__summary v__summary--static">
        <span className="v__head">
          <span className="v__abbr">INP</span>
          <span className="v__full">{EXPLAINER.INP.full}</span>
        </span>
        <span className="v__nums">
          <span className="v__value mono">—</span>
        </span>
      </div>
      <p className="v__what v__what--pad">
        {import.meta.env.FIREFOX
          ? 'Not available in this browser: INP needs the Event Timing API, which is Chromium-only. It is not zero — it is unmeasurable here.'
          : 'Not measured yet — INP only exists once you have clicked, tapped or typed on the page. Interact with it and this fills in.'}
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
  return (
    <details className="block">
      <summary className="block__summary">
        Load timeline
        <span className="block__hint mono">
          {timing.load !== null
            ? `load ${ms(timing.load)}`
            : timing.domContentLoaded !== null
              ? `DOM ${ms(timing.domContentLoaded)}`
              : 'measuring…'}
        </span>
      </summary>
      <div className="block__body">
        <p className="v__what">
          Where the time went before the page finished. Every number is read from the
          browser’s own Navigation Timing; a dash means the browser did not report
          it, which is not the same as zero.
        </p>
        <ul className="trows">
          <TimingRow label="DNS lookup" value={timing.dns} />
          <TimingRow label="Connect (TCP)" value={timing.tcp} />
          <TimingRow label="TLS handshake" value={timing.tls} />
          <TimingRow label="Request → first byte" value={timing.request} />
          <TimingRow label="Response download" value={timing.response} />
          <TimingRow label="DOMContentLoaded" value={timing.domContentLoaded} />
          <TimingRow label="Load event" value={timing.load} />
        </ul>
        {timing.redirectMasked ? (
          <p className="v__what">
            This page was reached through a cross-origin redirect, so the browser
            hides the phases before the response — they are unknowable here, not zero.
          </p>
        ) : timing.redirectCount > 0 ? (
          <p className="v__what">
            {timing.redirectCount} redirect{timing.redirectCount === 1 ? '' : 's'}{' '}
            happened before this page — each one is a full round trip added to TTFB.
          </p>
        ) : null}
        {timing.tls === null && !timing.redirectMasked && (
          <p className="v__what">No TLS handshake — this page was served over plain HTTP.</p>
        )}
      </div>
    </details>
  );
}

/** Total blocking time — the main-thread cost that makes a page feel unresponsive. */
function Blocking({ summary }: { summary: LongFrameSummary }) {
  const supported = summary.loafSupported || summary.longTaskSupported;
  if (!supported) {
    return (
      <details className="block">
        <summary className="block__summary">
          Main-thread blocking
          <span className="block__hint mono">n/a</span>
        </summary>
        <div className="block__body">
          <p className="v__what">
            Long Animation Frames and the Long Tasks API are Chromium-only and this
            browser has neither, so main-thread blocking cannot be measured here.
            That is not a zero — it is unknown.
          </p>
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
        Main-thread blocking
        <span className={total > 200 ? 'block__hint mono block__hint--warn' : 'block__hint mono'}>
          {total} ms
        </span>
      </summary>
      <div className="block__body">
        <p className="v__what">
          Time the main thread spent stuck in long tasks (over 50&nbsp;ms), unable to
          respond to a click. This is what makes INP bad — and unlike INP it is
          measured whether or not anyone interacted.
        </p>
        {summary.frames.length === 0 ? (
          <p className="v__what">
            No long {summary.loafSupported ? 'animation frames' : 'tasks'} recorded —
            the main thread stayed responsive.
          </p>
        ) : total === 0 ? (
          /* Long frames can exist with ZERO blocking duration (a frame that ran
             long but never held up an interaction). Listing the scripts in those
             frames under "responsible" would pin a cost on them that the browser
             did not measure. */
          <p className="v__what">
            {summary.frames.length} long frame
            {summary.frames.length === 1 ? '' : 's'} recorded, but none of them
            blocked the main thread — nothing here is holding up interaction.
          </p>
        ) : worst.length === 0 ? (
          <p className="v__what">
            {summary.frames.length} long frame
            {summary.frames.length === 1 ? '' : 's'}, but the browser attributed no
            script to them (usually cross-origin scripts, which are not attributable).
          </p>
        ) : (
          <>
            <p className="v__what">Scripts responsible, by total time on the main thread:</p>
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
  const sorted = [...vitals].sort(
    (a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name),
  );
  const hasInp = sorted.some((v) => v.name === 'INP');
  // Show the INP placeholder only once the page has actually reported something,
  // otherwise the empty state below covers it.
  const showInpPlaceholder = sorted.length > 0 && !hasInp;

  return (
    <section className="vitals-section" aria-label="Web Vitals">
      <h2>Vitals</h2>
      {sorted.length === 0 ? (
        <p className="caveat">
          Vitals arrive as the page settles — LCP and CLS finalise on interaction or
          when the tab is hidden.
        </p>
      ) : (
        <>
          <p className="vitals-hint">Tap a metric to see what it means.</p>
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
