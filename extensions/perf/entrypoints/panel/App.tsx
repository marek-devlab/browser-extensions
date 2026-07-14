import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from '#imports';
import type { Entry, Log } from 'har-format';
import type {
  PageInsight,
  VitalRating,
  WebVital,
} from '@blur/core';
import { formatBytes, formatVital, rateVital, VITAL_THRESHOLDS } from '@blur/core';
import type { ByteMechanism } from '../../utils/protocol';
import type { LongFrameSummary, TimedNetworkEntry } from '../../utils/perf-types';
import { emptyLongFrameSummary } from '../../utils/perf-types';
import {
  buildHarInsight,
  harEntryToNetworkEntry,
  harEntryUsesApproximateSize,
} from '../../utils/har';
import {
  copyText,
  downloadText,
  entriesToCsv,
  toJson,
  vitalsToCsv,
  type ExportPayload,
} from '../../utils/export';
import { AuditPanel } from './AuditPanel';
import { Waterfall } from './Waterfall';
import { LongFramesSection } from './LongFrames';

// Live DevTools panel. Vitals and Resource-Timing insight come from the
// background (fed by the content scripts); the DevTools HAR feed upgrades byte
// accuracy, and every tier is labelled honestly (PLAN.md §8). Exact banner-based
// byte measurement lives in the POPUP, not here: the debugger cannot attach while
// DevTools is open, and this panel guarantees DevTools is open.

type TabId = 'vitals' | 'network' | 'audit';

const TABS: { id: TabId; label: string }[] = [
  { id: 'vitals', label: 'Vitals' },
  { id: 'network', label: 'Network' },
  { id: 'audit', label: 'Audit (PSI)' },
];

const inspectedTabId = browser.devtools.inspectedWindow.tabId;

export function App() {
  const [tab, setTab] = useState<TabId>('vitals');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onTabKeyDown(e: React.KeyboardEvent, index: number) {
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    const nextTab = TABS[next];
    if (!nextTab) return;
    setTab(nextTab.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="panel">
      <nav className="tabs" role="tablist" aria-label="Performance panels">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'tab tab--active' : 'tab'}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div
        className="tab-body"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'vitals' && <VitalsPanel />}
        {tab === 'network' && <NetworkPanel />}
        {tab === 'audit' && <AuditPanel />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vitals                                                             */
/* ------------------------------------------------------------------ */

function VitalsPanel() {
  const [vitals, setVitals] = useState<WebVital[]>([]);
  const [longFrames, setLongFrames] = useState<LongFrameSummary>(emptyLongFrameSummary());

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const [v, lf] = (await Promise.all([
          browser.runtime.sendMessage({ type: 'getWebVitals', tabId: inspectedTabId }),
          browser.runtime.sendMessage({ type: 'getLongFrames', tabId: inspectedTabId }),
        ])) as [WebVital[] | undefined, LongFrameSummary | undefined];
        if (!active) return;
        if (v) setVitals(v);
        if (lf) setLongFrames(lf);
      } catch {
        // Background asleep between metrics — keep the last values.
      }
    }
    void poll();
    const id = globalThis.setInterval(poll, 1500);
    return () => {
      active = false;
      globalThis.clearInterval(id);
    };
  }, []);

  const order: WebVital['name'][] = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'];
  const sorted = [...vitals].sort(
    (a, b) => order.indexOf(a.name) - order.indexOf(b.name),
  );

  return (
    <section aria-live="polite">
      <div className="export-bar">
        <ExportButtons
          filenameBase="web-vitals"
          json={() => toJson({
            hostname: '',
            exportedAt: new Date().toISOString(),
            insight: null,
            vitals: sorted,
            longFrames,
            entries: [],
          })}
          csv={() => vitalsToCsv(sorted)}
          disabled={sorted.length === 0}
        />
      </div>
      {sorted.length === 0 ? (
        <p className="note">
          Waiting for metrics. LCP and CLS finalise on the first interaction or
          when the page is hidden, so interact with the page or switch tabs to
          see their final values.
        </p>
      ) : (
        <div className="cards">
          {sorted.map((v) => {
            const rating = rateVital(v.name, v.value);
            return (
              <article key={v.name} className={`card rating--${rating}`}>
                <header className="card__name">{v.name}</header>
                <div className="card__value mono">{formatVital(v)}</div>
                <div className="card__rating">{ratingLabel(rating)}</div>
                {v.attribution && (
                  <div
                    className="card__attribution mono"
                    title="Element that caused this metric"
                  >
                    {v.attribution}
                  </div>
                )}
                <ThresholdScale name={v.name} value={v.value} />
              </article>
            );
          })}
        </div>
      )}

      <p className="note">
        Element Timing cannot measure arbitrary elements on pages you do not
        control: the <code>elementtiming</code> attribute does not work
        retroactively (W3C spec), so once an element has painted, setting it has
        no effect. We surface the LCP element via{' '}
        <code>LargestContentfulPaint.entry.element</code> instead. FCP and TTFB
        are timing-only and carry no element.
      </p>

      <LongFramesSection summary={longFrames} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Network                                                            */
/* ------------------------------------------------------------------ */

interface ByteView {
  insight: PageInsight;
  entries: TimedNetworkEntry[];
  mechanism: ByteMechanism;
  /** devtools-har only: some sizes came from the bodySize fallback (Firefox). */
  approximate?: boolean;
}

const MECHANISM_LABEL: Record<ByteMechanism, string> = {
  'resource-timing': 'Measured bytes',
  'devtools-har': 'DevTools bytes',
  'cdp-debugger': 'Exact bytes (debugger)',
};

function byteLabel(view: ByteView): string {
  if (view.mechanism === 'devtools-har' && view.approximate) {
    return 'DevTools bytes (approx.)';
  }
  return MECHANISM_LABEL[view.mechanism];
}

function NetworkPanel() {
  const [rt, setRt] = useState<ByteView | null>(null);
  const [har, setHar] = useState<ByteView | null>(null);
  const [hostname, setHostname] = useState('');
  const harEntries = useRef<Entry[]>([]);

  // Resolve the inspected page hostname once, for third-party detection in HAR.
  useEffect(() => {
    browser.devtools.inspectedWindow.eval(
      'location.hostname',
      (result: unknown) => {
        if (typeof result === 'string') setHostname(result);
      },
    );
  }, []);

  // Resource-Timing insight from the background (works without DevTools APIs).
  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const [insight, entries] = (await Promise.all([
          browser.runtime.sendMessage({ type: 'getPageInsight', tabId: inspectedTabId }),
          browser.runtime.sendMessage({ type: 'getNetworkEntries', tabId: inspectedTabId }),
        ])) as [PageInsight | null, TimedNetworkEntry[]];
        if (active && insight) {
          setRt({ insight, entries: entries ?? [], mechanism: 'resource-timing' });
        }
      } catch {
        // ignore transient background sleep
      }
    }
    void poll();
    const id = globalThis.setInterval(poll, 1500);
    return () => {
      active = false;
      globalThis.clearInterval(id);
    };
  }, []);

  const rebuildHar = useCallback(
    (host: string) => {
      if (harEntries.current.length === 0) return;
      const raw = harEntries.current;
      const entries = raw.map((e) => harEntryToNetworkEntry(e, host));
      setHar({
        insight: buildHarInsight(entries, host),
        entries,
        mechanism: 'devtools-har',
        approximate: raw.some(harEntryUsesApproximateSize),
      });
    },
    [],
  );

  // DevTools HAR: backfill on open + live onRequestFinished.
  useEffect(() => {
    browser.devtools.network.getHAR((log: Log) => {
      harEntries.current = [...log.entries];
      rebuildHar(hostname);
    });
    const onFinished = (req: Entry) => {
      harEntries.current.push(req);
      rebuildHar(hostname);
    };
    browser.devtools.network.onRequestFinished.addListener(onFinished);
    return () => browser.devtools.network.onRequestFinished.removeListener(onFinished);
  }, [hostname, rebuildHar]);

  // Prefer DevTools HAR only when it is at least as COMPLETE as Resource Timing.
  // HAR becomes non-null on the first captured entry, but getHAR only sees requests
  // since DevTools opened — opened after load, it may hold a handful of late beacons
  // while Resource Timing holds the full set. Switching to HAR then would collapse
  // the table/summary/export to those few rows (bug 1j), so fall back to RT until
  // HAR has caught up. ONE source still drives the whole view — summary, table,
  // waterfall, CSV and JSON — so nothing can disagree (bug 1d).
  const view = har && (!rt || har.entries.length >= rt.entries.length) ? har : rt;
  const tableEntries = view?.entries ?? [];

  if (!view) {
    return (
      <section>
        <p className="note">Waiting for network activity. Reload the page to capture it all.</p>
      </section>
    );
  }

  const mech = view.mechanism;
  // Both Resource Timing (cross-origin without Timing-Allow-Origin) AND DevTools
  // HAR (a null _transferSize) can leave requests unmeasured — they are excluded
  // from measuredBytes either way, so the stat + caveat must surface for both
  // sources, not only resource-timing (bug 1k).
  const hasUnmeasured = view.insight.unmeasuredRequests > 0;

  const exportPayload = (): ExportPayload => ({
    hostname: view.insight.hostname || hostname,
    exportedAt: new Date().toISOString(),
    insight: view.insight,
    vitals: [],
    longFrames: null,
    entries: tableEntries,
  });

  return (
    <section aria-live="polite">
      <div className="summary-bar">
        <Stat label="Requests" value={String(view.insight.requestCount)} />
        <Stat label={byteLabel(view)} value={formatBytes(view.insight.measuredBytes)} />
        {hasUnmeasured && (
          <Stat
            label="Unmeasured"
            value={String(view.insight.unmeasuredRequests)}
            emphasis
          />
        )}
        <div className="export-bar">
          <ExportButtons
            filenameBase="network"
            json={() => toJson(exportPayload())}
            csv={() => entriesToCsv(tableEntries)}
            disabled={tableEntries.length === 0}
          />
        </div>
      </div>

      <p className="note">{caveatFor(view)}</p>

      {hasUnmeasured && (
        <p className="note">
          <strong>{view.insight.unmeasuredRequests}</strong> request
          {view.insight.unmeasuredRequests === 1 ? '' : 's'} reported no size, so
          they are missing from the total above — left out, never counted as zero.
          {mech === 'resource-timing' ? (
            <>
              {' '}For exact page weight including these, use{' '}
              <strong>Measure exact bytes</strong> in the toolbar popup.
            </>
          ) : (
            <>
              {' '}Reload with DevTools already open to capture their sizes from the
              first byte.
            </>
          )}
        </p>
      )}

      <p className="note exact-hint">
        {import.meta.env.FIREFOX
          ? 'This browser has no banner-free exact-byte path, so DevTools HAR bytes above are the most accurate total available here.'
          : 'For exact wire bytes counted even for cross-origin resources, open the extension popup and choose “Measure exact bytes” — it reloads the tab under the debugger, which cannot run while DevTools is open.'}
      </p>

      <Waterfall entries={tableEntries} />

      <div className="table-scroll">
        <table className="net">
          <caption className="net__caption">
            Network requests — {tableEntries.length} row
            {tableEntries.length === 1 ? '' : 's'}, {byteLabel(view).toLowerCase()}.
          </caption>
          <thead>
            <tr>
              <th scope="col">URL</th>
              <th scope="col">Kind</th>
              <th scope="col" className="num">Duration</th>
              <th scope="col" className="num">Size</th>
              <th scope="col">3rd&nbsp;party</th>
            </tr>
          </thead>
          <tbody>
            {tableEntries.map((e, i) => (
              <tr key={`${e.url}|${i}`}>
                <td className="mono url" title={e.url}>{e.url}</td>
                <td>{e.kind}</td>
                <td className="num mono">{Math.round(e.duration)} ms</td>
                <td className="num mono">
                  {e.transferSize === null ? (
                    <span
                      className="unmeasured"
                      title="No size reported — a cross-origin resource that doesn't expose its size to the page."
                    >
                      —
                    </span>
                  ) : (
                    formatBytes(e.transferSize)
                  )}
                </td>
                <td>{e.thirdParty ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="note">
        <span className="unmeasured">—</span> means the size is unknowable: the
        resource didn't report one, so it is shown as blank, never as{' '}
        <code>0</code>.
      </p>
    </section>
  );
}

function caveatFor(view: ByteView): string {
  switch (view.mechanism) {
    case 'resource-timing':
      return 'Some resources don’t report their size, so this total is a lower bound, not the full page weight.';
    case 'devtools-har':
      return view.approximate
        ? 'These byte totals are approximate: this browser reports an uncompressed body size that excludes headers, not the exact bytes on the wire. Only requests seen while DevTools was open are included — reload to capture everything.'
        : 'DevTools byte totals are accurate, but only requests seen while DevTools was open are included — reload the page to capture everything from the first byte.';
    case 'cdp-debugger':
      return 'Exact wire bytes, counted even for cross-origin resources. The debugging banner is shown while attached.';
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className={emphasis ? 'stat stat--emphasis' : 'stat'}>
      <div className="stat__value mono">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

/** Copy/download buttons for JSON and CSV. Builders are lazy so nothing is
 *  serialised until the user acts. Announces the copy result via aria-live. */
function ExportButtons({
  filenameBase,
  json,
  csv,
  disabled,
}: {
  filenameBase: string;
  json: () => string;
  csv: () => string;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState('');

  async function copy(kind: 'json' | 'csv') {
    const text = kind === 'json' ? json() : csv();
    const ok = await copyText(text);
    setStatus(ok ? `${kind.toUpperCase()} copied to clipboard` : 'Copy failed');
    globalThis.setTimeout(() => setStatus(''), 2500);
  }

  function save(kind: 'json' | 'csv') {
    const text = kind === 'json' ? json() : csv();
    const mime = kind === 'json' ? 'application/json' : 'text/csv';
    downloadText(`${filenameBase}.${kind}`, mime, text);
  }

  return (
    <div className="export">
      <span className="export__label" aria-hidden="true">Export</span>
      <button className="btn btn--sm" disabled={disabled} aria-label="Copy as JSON" onClick={() => void copy('json')}>Copy JSON</button>
      <button className="btn btn--sm" disabled={disabled} aria-label="Download as JSON" onClick={() => save('json')}>JSON</button>
      <button className="btn btn--sm" disabled={disabled} aria-label="Copy as CSV" onClick={() => void copy('csv')}>Copy CSV</button>
      <button className="btn btn--sm" disabled={disabled} aria-label="Download as CSV" onClick={() => save('csv')}>CSV</button>
      <span className="export__status" role="status" aria-live="polite">{status}</span>
    </div>
  );
}

function ratingLabel(rating: VitalRating): string {
  if (rating === 'good') return 'Good';
  if (rating === 'needs-improvement') return 'Needs improvement';
  return 'Poor';
}

/** Format a threshold value in the metric's own unit (score / ms / s). */
function formatThreshold(name: WebVital['name'], v: number): string {
  if (name === 'CLS') return v.toFixed(2);
  if (v >= 1000) return `${(v / 1000).toFixed(1)} s`;
  return `${v} ms`;
}

/**
 * A mini good / needs-improvement / poor scale under a vital card, with the
 * current value marked. Gives the raw number context — a "1.2 s LCP" means little
 * without the 2.5 s / 4 s cutoffs beside it. Cutoffs come from the shared core
 * VITAL_THRESHOLDS so the panel and the rating logic can never disagree.
 */
function ThresholdScale({ name, value }: { name: WebVital['name']; value: number }) {
  const t = VITAL_THRESHOLDS[name];
  // Scale runs 0 → poor × 1.5 so the poor band is always visible; clamp the marker.
  const scaleMax = t.poor * 1.5;
  const pct = Math.max(0, Math.min(100, (value / scaleMax) * 100));
  const goodPct = (t.good / scaleMax) * 100;
  const poorPct = (t.poor / scaleMax) * 100;
  return (
    <div className="thresh">
      <div className="thresh__scale" aria-hidden="true">
        <span className="thresh__band thresh__band--good" style={{ inlineSize: `${goodPct}%` }} />
        <span
          className="thresh__band thresh__band--ni"
          style={{ inlineSize: `${poorPct - goodPct}%` }}
        />
        <span
          className="thresh__band thresh__band--poor"
          style={{ inlineSize: `${100 - poorPct}%` }}
        />
        <span className="thresh__marker" style={{ insetInlineStart: `${pct}%` }} />
      </div>
      <div className="thresh__labels">
        <span>Good ≤ {formatThreshold(name, t.good)}</span>
        <span>Poor &gt; {formatThreshold(name, t.poor)}</span>
      </div>
    </div>
  );
}
