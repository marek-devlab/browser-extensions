import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from '#imports';
import type { Entry, Log } from 'har-format';
import type {
  PageInsight,
  VitalRating,
  WebVital,
} from '@blur/core';
import { formatBytes, formatVital, rateVital, VITAL_THRESHOLDS } from '@blur/core';
import {
  LanguageSwitcher,
  LocaleProvider,
  useLocaleController,
  type Locale,
} from '@blur/ui';
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
import { localeItem } from '../../utils/storage';
import { useT, type MsgKey, type TFn } from '../../utils/i18n';
import { AuditPanel } from './AuditPanel';
import { Waterfall } from './Waterfall';
import { LongFramesSection } from './LongFrames';

// Live DevTools panel. Vitals and Resource-Timing insight come from the
// background (fed by the content scripts); the DevTools HAR feed upgrades byte
// accuracy, and every tier is labelled honestly (PLAN.md §8). Exact banner-based
// byte measurement lives in the POPUP, not here: the debugger cannot attach while
// DevTools is open, and this panel guarantees DevTools is open.

type TabId = 'vitals' | 'network' | 'audit';

const TABS: { id: TabId; labelKey: MsgKey }[] = [
  { id: 'vitals', labelKey: 'tabVitals' },
  { id: 'network', labelKey: 'tabNetwork' },
  { id: 'audit', labelKey: 'tabAudit' },
];

const inspectedTabId = browser.devtools.inspectedWindow.tabId;

/** Root: wires the persisted locale to React and provides it to the whole panel
 *  before any translated string renders (the seed is synchronous, so no flash). */
export function App() {
  const { locale, setLocale } = useLocaleController({
    key: 'blur-perf:locale',
    read: () => localeItem.getValue(),
    write: (next) => localeItem.setValue(next),
  });
  return (
    <LocaleProvider locale={locale}>
      <Panel locale={locale} setLocale={setLocale} />
    </LocaleProvider>
  );
}

function Panel({
  locale,
  setLocale,
}: {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}) {
  const t = useT();
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
      <nav className="tabs" role="tablist" aria-label={t('pnPanelsAria')}>
        {TABS.map((tb, i) => (
          <button
            key={tb.id}
            id={`tab-${tb.id}`}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            aria-selected={tab === tb.id}
            aria-controls={`panel-${tb.id}`}
            tabIndex={tab === tb.id ? 0 : -1}
            className={tab === tb.id ? 'tab tab--active' : 'tab'}
            onClick={() => setTab(tb.id)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
          >
            {t(tb.labelKey)}
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

      <footer className="panel-foot">
        <span className="panel-foot__label">{t('language')}</span>
        <LanguageSwitcher
          locale={locale}
          onChange={setLocale}
          label={t('interfaceLanguage')}
        />
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vitals                                                             */
/* ------------------------------------------------------------------ */

function VitalsPanel() {
  const t = useT();
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
        <p className="note">{t('pnWaitingMetrics')}</p>
      ) : (
        <div className="cards">
          {sorted.map((v) => {
            const rating = rateVital(v.name, v.value);
            return (
              <article key={v.name} className={`card rating--${rating}`}>
                <header className="card__name">{v.name}</header>
                <div className="card__value mono">{formatVital(v)}</div>
                <div className="card__rating">{ratingLabel(t, rating)}</div>
                {v.attribution && (
                  <div
                    className="card__attribution mono"
                    title={t('pnAttributionTitle')}
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
        {t('pnElementTiming1')}
        <code>elementtiming</code>
        {t('pnElementTiming2')}
        <code>LargestContentfulPaint.entry.element</code>
        {t('pnElementTiming3')}
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

const MECHANISM_LABEL_KEY: Record<ByteMechanism, MsgKey> = {
  'resource-timing': 'nwLblMeasured',
  'devtools-har': 'nwLblDevtools',
  'cdp-debugger': 'nwLblExact',
};

function byteLabel(t: TFn, view: ByteView): string {
  if (view.mechanism === 'devtools-har' && view.approximate) {
    return t('nwLblDevtoolsApprox');
  }
  return t(MECHANISM_LABEL_KEY[view.mechanism]);
}

function NetworkPanel() {
  const t = useT();
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
        <p className="note">{t('nwWaiting')}</p>
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
        <Stat label={t('nwStatRequests')} value={String(view.insight.requestCount)} />
        <Stat label={byteLabel(t, view)} value={formatBytes(view.insight.measuredBytes)} />
        {hasUnmeasured && (
          <Stat
            label={t('nwStatUnmeasured')}
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

      <p className="note">{caveatFor(t, view)}</p>

      {hasUnmeasured && (
        <p className="note">
          <strong>{view.insight.unmeasuredRequests}</strong>
          {t(
            view.insight.unmeasuredRequests === 1
              ? 'nwUnmeasuredSuffixOne'
              : 'nwUnmeasuredSuffixOther',
          )}
          {mech === 'resource-timing' ? (
            <>
              {t('nwUnmeasuredRtPre')}
              <strong>{t('nwMeasureExactBytesStrong')}</strong>
              {t('nwUnmeasuredRtPost')}
            </>
          ) : (
            t('nwUnmeasuredHar')
          )}
        </p>
      )}

      <p className="note exact-hint">
        {import.meta.env.FIREFOX ? t('nwExactHintFf') : t('nwExactHint')}
      </p>

      <Waterfall entries={tableEntries} />

      <div className="table-scroll">
        <table className="net">
          <caption className="net__caption">
            {t(tableEntries.length === 1 ? 'nwCaptionOne' : 'nwCaptionOther', {
              count: tableEntries.length,
              label: byteLabel(t, view).toLowerCase(),
            })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t('nwColUrl')}</th>
              <th scope="col">{t('nwColKind')}</th>
              <th scope="col" className="num">{t('nwColDuration')}</th>
              <th scope="col" className="num">{t('nwColSize')}</th>
              <th scope="col">{t('nwColThirdParty')}</th>
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
                      title={t('nwUnmeasuredCellTitle')}
                    >
                      —
                    </span>
                  ) : (
                    formatBytes(e.transferSize)
                  )}
                </td>
                <td>{e.thirdParty ? t('nwYes') : t('nwNo')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="note">
        <span className="unmeasured">—</span>
        {t('nwDashMeans')}
        <code>0</code>.
      </p>
    </section>
  );
}

function caveatFor(t: TFn, view: ByteView): string {
  switch (view.mechanism) {
    case 'resource-timing':
      return t('nwCaveatRt');
    case 'devtools-har':
      return view.approximate ? t('nwCaveatHarApprox') : t('nwCaveatHar');
    case 'cdp-debugger':
      return t('nwCaveatCdp');
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
  const t = useT();
  const [status, setStatus] = useState('');

  async function copy(kind: 'json' | 'csv') {
    const text = kind === 'json' ? json() : csv();
    const ok = await copyText(text);
    setStatus(
      ok
        ? t(kind === 'json' ? 'exportCopiedJson' : 'exportCopiedCsv')
        : t('exportCopyFailed'),
    );
    globalThis.setTimeout(() => setStatus(''), 2500);
  }

  function save(kind: 'json' | 'csv') {
    const text = kind === 'json' ? json() : csv();
    const mime = kind === 'json' ? 'application/json' : 'text/csv';
    downloadText(`${filenameBase}.${kind}`, mime, text);
  }

  return (
    <div className="export">
      <span className="export__label" aria-hidden="true">{t('exportLabel')}</span>
      <button className="btn btn--sm" disabled={disabled} aria-label={t('exportCopyJsonAria')} onClick={() => void copy('json')}>{t('exportCopyJson')}</button>
      <button className="btn btn--sm" disabled={disabled} aria-label={t('exportJsonAria')} onClick={() => save('json')}>{t('exportJson')}</button>
      <button className="btn btn--sm" disabled={disabled} aria-label={t('exportCopyCsvAria')} onClick={() => void copy('csv')}>{t('exportCopyCsv')}</button>
      <button className="btn btn--sm" disabled={disabled} aria-label={t('exportCsvAria')} onClick={() => save('csv')}>{t('exportCsv')}</button>
      <span className="export__status" role="status" aria-live="polite">{status}</span>
    </div>
  );
}

function ratingLabel(t: TFn, rating: VitalRating): string {
  if (rating === 'good') return t('ratingGood');
  if (rating === 'needs-improvement') return t('ratingNi');
  return t('ratingPoor');
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
  const t = useT();
  const th = VITAL_THRESHOLDS[name];
  // Scale runs 0 → poor × 1.5 so the poor band is always visible; clamp the marker.
  const scaleMax = th.poor * 1.5;
  const pct = Math.max(0, Math.min(100, (value / scaleMax) * 100));
  const goodPct = (th.good / scaleMax) * 100;
  const poorPct = (th.poor / scaleMax) * 100;
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
        <span>{t('threshGood', { v: formatThreshold(name, th.good) })}</span>
        <span>{t('threshPoor', { v: formatThreshold(name, th.poor) })}</span>
      </div>
    </div>
  );
}
