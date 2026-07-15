import { useEffect, useState } from 'react';
import { browser } from '#imports';
import type { NetworkEntry, PageInsight, ResourceKind } from '@blur/core';
import { formatBytes } from '@blur/core';
import {
  LanguageSwitcher,
  LocaleProvider,
  useLocaleController,
  type Locale,
} from '@blur/ui';
import type { MeasureResult } from '../../utils/protocol';
import type { LongFrameSummary, PageTiming, PerfWebVital } from '../../utils/perf-types';
import { getRegistrableDomain } from '../../utils/registrable-domain';
import { lastReportItem, localeItem } from '../../utils/storage';
import { useT, type TFn } from '../../utils/i18n';
import { VitalsSection } from './Vitals';

// The popup works WITHOUT DevTools open, so it shows what is available cross-origin
// and accurately: request count, type breakdown, third-party domains, and
// Resource-Timing-grade bytes with an honest caveat (PLAN.md §8). It is ALSO the
// home of the opt-in exact-byte measurement (Chrome): the debugger cannot attach
// while DevTools is open, and the DevTools panel always has DevTools open, so the
// trigger has to live somewhere DevTools need not be — the popup.

function useActiveTab(): { tabId: number | null; hostname: string } {
  const [state, setState] = useState<{ tabId: number | null; hostname: string }>({
    tabId: null,
    hostname: '',
  });
  useEffect(() => {
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.id) return;
      let hostname = '';
      try {
        if (tab.url) hostname = new URL(tab.url).hostname;
      } catch {
        // Non-web tab — leave blank.
      }
      setState({ tabId: tab.id, hostname });
    });
  }, []);
  return state;
}

/** Root: wires the persisted locale to React and provides it to the whole popup
 *  before any translated string renders (the seed is synchronous, so no flash). */
export function Root() {
  const { locale, setLocale } = useLocaleController({
    key: 'blur-perf:locale',
    read: () => localeItem.getValue(),
    write: (next) => localeItem.setValue(next),
  });
  return (
    <LocaleProvider locale={locale}>
      <App locale={locale} setLocale={setLocale} />
    </LocaleProvider>
  );
}

/** The interface-language control, shown at the foot of the popup in both the
 *  empty and populated states. */
function LanguageSettings({
  locale,
  setLocale,
  t,
}: {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFn;
}) {
  return (
    <section className="settings">
      <h2>{t('language')}</h2>
      <LanguageSwitcher
        locale={locale}
        onChange={setLocale}
        label={t('interfaceLanguage')}
      />
    </section>
  );
}

export function App({
  locale,
  setLocale,
}: {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}) {
  const t = useT();
  const { tabId, hostname } = useActiveTab();
  const [insight, setInsight] = useState<PageInsight | null>(null);
  const [entries, setEntries] = useState<NetworkEntry[]>([]);
  const [vitals, setVitals] = useState<PerfWebVital[]>([]);
  const [timing, setTiming] = useState<PageTiming | null>(null);
  const [longFrames, setLongFrames] = useState<LongFrameSummary | null>(null);
  const [exact, setExact] = useState<PageInsight | null>(null);
  const [exactEntries, setExactEntries] = useState<NetworkEntry[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measureError, setMeasureError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PageInsight | null>(null);

  useEffect(() => {
    void lastReportItem.getValue().then(setSnapshot);
  }, []);

  useEffect(() => {
    if (tabId === null) return;
    let active = true;
    async function load() {
      try {
        const [i, v, e, t, lf] = (await Promise.all([
          browser.runtime.sendMessage({ type: 'getPageInsight', tabId }),
          browser.runtime.sendMessage({ type: 'getWebVitals', tabId }),
          browser.runtime.sendMessage({ type: 'getNetworkEntries', tabId }),
          browser.runtime.sendMessage({ type: 'getPageTiming', tabId }),
          browser.runtime.sendMessage({ type: 'getLongFrames', tabId }),
        ])) as [
          PageInsight | null,
          PerfWebVital[],
          NetworkEntry[],
          PageTiming | null,
          LongFrameSummary | null,
        ];
        if (!active) return;
        if (i) setInsight(i);
        if (v) setVitals(v);
        if (e) setEntries(e);
        // `null` is a real answer here (the page has not reported timing yet), so
        // it is stored as-is rather than skipped like the truthy guards above.
        setTiming(t);
        if (lf) setLongFrames(lf);
      } catch {
        // Background asleep — leave the last snapshot.
      }
    }
    void load();
    const id = globalThis.setInterval(load, 1500);
    return () => {
      active = false;
      globalThis.clearInterval(id);
    };
  }, [tabId]);

  async function measure() {
    if (tabId === null) return;
    setConfirming(false);
    setMeasureError(null);
    setMeasuring(true);
    try {
      const granted = await browser.permissions.request({ permissions: ['debugger'] });
      if (!granted) {
        setMeasureError(t('puErrDebuggerDeclined'));
        return;
      }
      const result = (await browser.runtime.sendMessage({
        type: 'measureExactBytes',
        tabId,
      })) as MeasureResult;
      if (result.ok) {
        setExact(result.insight);
        setExactEntries(result.entries);
      } else {
        setMeasureError(result.error);
      }
    } catch (err) {
      setMeasureError(err instanceof Error ? err.message : t('puErrMeasureFailed'));
    } finally {
      setMeasuring(false);
    }
  }

  if (!insight && !exact) {
    return (
      <div className="popup">
        <header className="head">
          <h1>{t('puTitle')}</h1>
          {/* The hostname ellipsizes when it is too long for the header, so the
              full value has to stay reachable on hover. */}
          <span className="host mono" title={hostname}>
            {hostname}
          </span>
        </header>
        <p className="caveat" role="status" aria-live="polite">
          {t('puNoMeasure')}
        </p>
        <LanguageSettings locale={locale} setLocale={setLocale} t={t} />
      </div>
    );
  }

  // Prefer an exact measurement once made; it sets unmeasuredRequests to 0.
  const shown = exact ?? (insight as PageInsight);
  const exactMode = shown.byteSource === 'cdp-debugger';
  const hasUnmeasured = shown.unmeasuredRequests > 0;

  // Per-request data backing the current view: the CDP entries once an exact
  // measurement is made, otherwise the Resource-Timing entries.
  const shownEntries: NetworkEntry[] = exact ? exactEntries : entries;

  // Bytes (and unmeasured counts) per resource kind, so "By type" reports weight,
  // not just request counts. Counts still come from shown.byKind so the list is
  // correct even before entries arrive.
  const kindBytes = new Map<ResourceKind, { bytes: number; unmeasured: number }>();
  for (const e of shownEntries) {
    const cur = kindBytes.get(e.kind) ?? { bytes: 0, unmeasured: 0 };
    if (e.transferSize === null) cur.unmeasured += 1;
    else cur.bytes += e.transferSize;
    kindBytes.set(e.kind, cur);
  }

  const kinds = (Object.entries(shown.byKind) as [ResourceKind, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  // Third-party traffic grouped by registrable domain: requests + bytes per party,
  // not a bare domain list. Falls back to the insight's domain list when no
  // per-request data is available (e.g. a cold snapshot).
  const tpGroups = new Map<string, { requests: number; bytes: number; unmeasured: number }>();
  for (const e of shownEntries) {
    if (!e.thirdParty) continue;
    let domain: string;
    try {
      domain = getRegistrableDomain(new URL(e.url).hostname);
    } catch {
      continue;
    }
    const cur = tpGroups.get(domain) ?? { requests: 0, bytes: 0, unmeasured: 0 };
    cur.requests += 1;
    if (e.transferSize === null) cur.unmeasured += 1;
    else cur.bytes += e.transferSize;
    tpGroups.set(domain, cur);
  }
  const thirdParties = [...tpGroups.entries()].sort((a, b) => b[1].bytes - a[1].bytes);

  async function saveSnapshot() {
    await lastReportItem.setValue(shown);
    setSnapshot(shown);
  }
  // Only compare snapshots of the same page — cross-host diffs are meaningless.
  const comparable = snapshot !== null && snapshot.hostname === shown.hostname;
  // Bytes are only comparable when both loads used the SAME byte source: an exact
  // cold-load total (cdp-debugger, cache-bypassed, counts unmeasured resources) vs
  // a Resource-Timing lower bound is not a like-for-like diff, and showing it as a
  // delta reads as a bogus regression. Request/unmeasured counts stay comparable.
  const bytesComparable = comparable && snapshot!.byteSource === shown.byteSource;

  return (
    <div className="popup">
      <header className="head">
        <h1>{t('puTitle')}</h1>
        {/* Ellipsized when long — `title` keeps the full hostname reachable. */}
        <span className="host mono" title={shown.hostname || hostname}>
          {shown.hostname || hostname}
        </span>
      </header>

      <div className="content" role="status" aria-live="polite">
        <div className="stats">
          <div className="stat">
            <div className="stat__value mono">{shown.requestCount}</div>
            <div className="stat__label">{t('puRequests')}</div>
          </div>
          <div className={exactMode ? 'stat stat--exact' : 'stat'}>
            <div className="stat__value mono">{formatBytes(shown.measuredBytes)}</div>
            <div className="stat__label">
              {exactMode ? t('puExactBytesLabel') : t('puMeasuredBytesLabel')}
            </div>
          </div>
          {hasUnmeasured && (
            <div className="stat stat--warn">
              <div className="stat__value mono">{shown.unmeasuredRequests}</div>
              <div className="stat__label">{t('puUnmeasured')}</div>
            </div>
          )}
        </div>

        {exactMode ? (
          <p className="caveat caveat--ok">{t('puExactCaveat')}</p>
        ) : hasUnmeasured ? (
          <div className="caveat">
            {t(
              shown.unmeasuredRequests === 1 ? 'puLowerBoundOne' : 'puLowerBoundOther',
              { count: shown.unmeasuredRequests },
            )}
            <details className="caveat__more">
              <summary>{t('puWhy')}</summary>
              {t('puTaoPre')}
              <code>Timing-Allow-Origin</code>
              {t('puTaoPost')}
            </details>
          </div>
        ) : (
          <p className="caveat">{t('puComplete')}</p>
        )}
      </div>

      {!exactMode && (
        <section className="measure">
          <h2>{t('puExactByteWeight')}</h2>
          {import.meta.env.FIREFOX ? (
            <p className="caveat">{t('puFfMeasure')}</p>
          ) : (
            <>
              <button
                className="btn"
                disabled={measuring}
                onClick={() => setConfirming(true)}
              >
                {measuring ? t('puMeasuring') : t('puMeasureBtn')}
              </button>
              {confirming && (
                <ConsentDialog onCancel={() => setConfirming(false)} onConfirm={measure} t={t} />
              )}
              {measureError && (
                <p className="caveat" role="alert">
                  {measureError}
                </p>
              )}
            </>
          )}
        </section>
      )}

      <section>
        <h2>{t('puByType')}</h2>
        <ul className="breakdown">
          {kinds.map(([kind, n]) => {
            const b = kindBytes.get(kind);
            return (
              <li key={kind}>
                <span className="breakdown__kind">{kind}</span>
                <span className="breakdown__bytes mono">
                  {b && (b.bytes > 0 || b.unmeasured === 0) ? formatBytes(b.bytes) : '—'}
                  {b && b.unmeasured > 0 && (
                    <span
                      className="breakdown__partial"
                      title={t(
                        b.unmeasured === 1 ? 'puByTypePartialOne' : 'puByTypePartialOther',
                        { count: b.unmeasured },
                      )}
                    >
                      {' '}+{b.unmeasured}
                    </span>
                  )}
                </span>
                <span className="breakdown__n mono">
                  {n}×
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {shown.thirdPartyDomains.length > 0 && (
        <section>
          <h2>{t('puThirdPartyDomains')}</h2>
          {thirdParties.length > 0 ? (
            <ul className="breakdown">
              {thirdParties.map(([domain, s]) => (
                <li key={domain}>
                  <span className="breakdown__kind mono" title={domain}>{domain}</span>
                  <span className="breakdown__bytes mono">
                    {s.bytes > 0 || s.unmeasured === 0 ? formatBytes(s.bytes) : '—'}
                    {s.unmeasured > 0 && (
                      <span
                        className="breakdown__partial"
                        title={t(
                          s.unmeasured === 1 ? 'puTpPartialOne' : 'puTpPartialOther',
                          { count: s.unmeasured },
                        )}
                      >
                        {' '}+{s.unmeasured}
                      </span>
                    )}
                  </span>
                  <span className="breakdown__n mono">{s.requests}×</span>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="domains">
              {shown.thirdPartyDomains.map((d) => (
                <li key={d} className="mono">{d}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="compare">
        <h2>{t('puCompareLoads')}</h2>
        <button className="btn" aria-label={t('puSaveAria')} onClick={() => void saveSnapshot()}>
          {t('puSaveSnapshot')}
        </button>
        {comparable && snapshot && (
          <div className="compare__diff" role="status" aria-live="polite">
            <Delta label={t('puDeltaRequests')} from={snapshot.requestCount} to={shown.requestCount} />
            {bytesComparable ? (
              <Delta label={t('puDeltaBytes')} from={snapshot.measuredBytes} to={shown.measuredBytes} bytes />
            ) : (
              <p className="caveat">{t('puBytesNotCompared')}</p>
            )}
            <Delta label={t('puDeltaUnmeasured')} from={snapshot.unmeasuredRequests} to={shown.unmeasuredRequests} invert />
          </div>
        )}
        {snapshot && !comparable && (
          <p className="caveat">
            {t('puSnapshotForPre')}<span className="mono">{snapshot.hostname}</span>{t('puSnapshotForPost')}
          </p>
        )}
      </section>

      {/* Vitals live in their own component: each metric is spelled out in plain
          language, and a score that is not `good` carries the attribution the
          browser gave us (the element that shifted, the phase that dominated) plus
          the fix for that specific cause. */}
      <VitalsSection vitals={vitals} timing={timing} longFrames={longFrames} />

      <footer className="foot">{t('puFooter')}</footer>

      <LanguageSettings locale={locale} setLocale={setLocale} t={t} />
    </div>
  );
}

/** One before→after metric with a signed delta. `invert` flips good/bad colour
 *  (fewer unmeasured is better); `bytes` formats as a byte size. */
function Delta({
  label,
  from,
  to,
  bytes,
  invert,
}: {
  label: string;
  from: number;
  to: number;
  bytes?: boolean;
  invert?: boolean;
}) {
  const diff = to - from;
  const fmt = (n: number) => (bytes ? formatBytes(n) : String(n));
  const signStr = diff > 0 ? '+' : diff < 0 ? '−' : '';
  const magnitude = bytes ? formatBytes(Math.abs(diff)) : String(Math.abs(diff));
  // "up" = the number grew. Colour it bad unless `invert` (e.g. fewer unmeasured is good).
  const tone = diff === 0 ? 'flat' : (diff > 0) !== !!invert ? 'up' : 'down';
  return (
    <div className={`delta delta--${tone}`}>
      <span className="delta__label">{label}</span>
      <span className="delta__values mono">
        {fmt(from)} → {fmt(to)}
      </span>
      <span className="delta__diff mono">
        {diff === 0 ? '±0' : `${signStr}${magnitude}`}
      </span>
    </div>
  );
}

function ConsentDialog({
  onCancel,
  onConfirm,
  t,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  t: TFn;
}) {
  return (
    <div className="confirm" role="alertdialog" aria-label={t('puConsentAria')}>
      <p className="confirm__body">
        {t('puConsent1')}
        <strong>{t('puConsentReloadStrong')}</strong>
        {t('puConsent2')}
        <strong>{t('puConsentBannerStrong')}</strong>
        {t('puConsent3')}
        <strong>{t('puConsentCloseStrong')}</strong>
        {t('puConsent4')}
      </p>
      <div className="confirm__actions">
        <button className="btn" onClick={onCancel}>{t('puCancel')}</button>
        <button className="btn btn--primary" onClick={onConfirm}>
          {t('puAttachMeasure')}
        </button>
      </div>
    </div>
  );
}
