import { useEffect, useState } from 'react';
import { browser } from '#imports';
import type { NetworkEntry, PageInsight, ResourceKind, VitalRating, WebVital } from '@blur/core';
import { formatBytes, formatVital, rateVital, VITAL_THRESHOLDS } from '@blur/core';
import type { MeasureResult } from '../../utils/protocol';
import { getRegistrableDomain } from '../../utils/registrable-domain';
import { lastReportItem } from '../../utils/storage';

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

export function App() {
  const { tabId, hostname } = useActiveTab();
  const [insight, setInsight] = useState<PageInsight | null>(null);
  const [entries, setEntries] = useState<NetworkEntry[]>([]);
  const [vitals, setVitals] = useState<WebVital[]>([]);
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
        const [i, v, e] = (await Promise.all([
          browser.runtime.sendMessage({ type: 'getPageInsight', tabId }),
          browser.runtime.sendMessage({ type: 'getWebVitals', tabId }),
          browser.runtime.sendMessage({ type: 'getNetworkEntries', tabId }),
        ])) as [PageInsight | null, WebVital[], NetworkEntry[]];
        if (!active) return;
        if (i) setInsight(i);
        if (v) setVitals(v);
        if (e) setEntries(e);
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
        setMeasureError(
          'The debugger permission was declined. Exact byte measurement needs it.',
        );
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
      setMeasureError(err instanceof Error ? err.message : 'Measurement failed.');
    } finally {
      setMeasuring(false);
    }
  }

  if (!insight && !exact) {
    return (
      <div className="popup">
        <header className="head">
          <h1>Page Insight</h1>
          <span className="host mono">{hostname}</span>
        </header>
        <p className="caveat" role="status" aria-live="polite">
          No measurements yet for this tab. Reload the page to collect Web Vitals
          and resource timing from the first byte.
        </p>
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

  const order: WebVital['name'][] = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'];
  const sortedVitals = [...vitals].sort(
    (a, b) => order.indexOf(a.name) - order.indexOf(b.name),
  );

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
        <h1>Page Insight</h1>
        <span className="host mono">{shown.hostname || hostname}</span>
      </header>

      <div className="content" role="status" aria-live="polite">
        <div className="stats">
          <div className="stat">
            <div className="stat__value mono">{shown.requestCount}</div>
            <div className="stat__label">requests</div>
          </div>
          <div className={exactMode ? 'stat stat--exact' : 'stat'}>
            <div className="stat__value mono">{formatBytes(shown.measuredBytes)}</div>
            <div className="stat__label">{exactMode ? 'exact bytes (cold load)' : 'measured bytes'}</div>
          </div>
          {hasUnmeasured && (
            <div className="stat stat--warn">
              <div className="stat__value mono">{shown.unmeasuredRequests}</div>
              <div className="stat__label">unmeasured</div>
            </div>
          )}
        </div>

        {exactMode ? (
          <p className="caveat caveat--ok">
            Exact page weight measured over a cache-bypassing reload with the
            debugger — every request re-fetched from the network and counted,
            including third-party resources.
          </p>
        ) : hasUnmeasured ? (
          <div className="caveat">
            Some third-party resources don't report their size, so this total is a
            lower bound — {shown.unmeasuredRequests} request
            {shown.unmeasuredRequests === 1 ? '' : 's'} could not be measured (they
            are left out, not counted as zero).
            <details className="caveat__more">
              <summary>Why?</summary>
              Cross-origin resources served without a{' '}
              <code>Timing-Allow-Origin</code> response header hide their transfer
              size from the page's Resource Timing data.
            </details>
          </div>
        ) : (
          <p className="caveat">
            Every request on this page reported its size, so this total is complete.
          </p>
        )}
      </div>

      {!exactMode && (
        <section className="measure">
          <h2>Exact byte weight</h2>
          {import.meta.env.FIREFOX ? (
            <p className="caveat">
              Banner-free exact byte measurement isn't available in this browser, so
              the total above (from Resource Timing) is the best estimate here.
            </p>
          ) : (
            <>
              <button
                className="btn"
                disabled={measuring}
                onClick={() => setConfirming(true)}
              >
                {measuring ? 'Measuring…' : 'Measure exact bytes'}
              </button>
              {confirming && (
                <ConsentDialog onCancel={() => setConfirming(false)} onConfirm={measure} />
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
        <h2>By type</h2>
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
                      title={`${b.unmeasured} request${b.unmeasured === 1 ? '' : 's'} of this type reported no size`}
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
          <h2>Third-party domains</h2>
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
                        title={`${s.unmeasured} request${s.unmeasured === 1 ? '' : 's'} from this domain reported no size`}
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
        <h2>Compare loads</h2>
        <button className="btn" aria-label="Save this load as a snapshot" onClick={() => void saveSnapshot()}>
          Save snapshot
        </button>
        {comparable && snapshot && (
          <div className="compare__diff" role="status" aria-live="polite">
            <Delta label="Requests" from={snapshot.requestCount} to={shown.requestCount} />
            {bytesComparable ? (
              <Delta label="Bytes" from={snapshot.measuredBytes} to={shown.measuredBytes} bytes />
            ) : (
              <p className="caveat">
                Byte totals aren't compared: the snapshot and this load used
                different measurement methods, so a diff wouldn't be like-for-like.
              </p>
            )}
            <Delta label="Unmeasured" from={snapshot.unmeasuredRequests} to={shown.unmeasuredRequests} invert />
          </div>
        )}
        {snapshot && !comparable && (
          <p className="caveat">
            Saved snapshot is for <span className="mono">{snapshot.hostname}</span>; reload
            that page to compare.
          </p>
        )}
      </section>

      <section>
        <h2>Vitals</h2>
        {sortedVitals.length === 0 ? (
          <p className="caveat">Vitals arrive as the page settles — LCP and CLS finalise on interaction or when the tab is hidden.</p>
        ) : (
          <ul className="vitals">
            {sortedVitals.map((v) => {
              const rating = rateVital(v.name, v.value);
              return (
                <li key={v.name} className={`vital rating--${rating}`}>
                  <span className="vital__name">{v.name}</span>
                  <span className="vital__value mono">{formatVital(v)}</span>
                  {/* Rating in text too — never conveyed by the border colour alone. */}
                  <span className="vital__rating">{ratingLabel(rating)}</span>
                  {/* Good/poor cutoffs give the raw value context. */}
                  <span className="vital__thresh mono">
                    ≤{formatThreshold(v.name, VITAL_THRESHOLDS[v.name].good)} · &gt;
                    {formatThreshold(v.name, VITAL_THRESHOLDS[v.name].poor)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="foot">
        Open the Performance panel (F12) for the full request table.
      </footer>
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

function ratingLabel(rating: VitalRating): string {
  if (rating === 'good') return 'Good';
  if (rating === 'needs-improvement') return 'Needs improvement';
  return 'Poor';
}

/** Format a Core Web Vitals threshold in the metric's own unit. */
function formatThreshold(name: WebVital['name'], v: number): string {
  if (name === 'CLS') return v.toFixed(2);
  if (v >= 1000) return `${(v / 1000).toFixed(1)}s`;
  return `${v}ms`;
}

function ConsentDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="confirm" role="alertdialog" aria-label="Confirm exact-byte measurement">
      <p className="confirm__body">
        Measuring exact bytes attaches Chrome's debugger to this tab and{' '}
        <strong>reloads the page bypassing the cache</strong> so every request is
        re-fetched from the network and counted from the first byte. Chrome shows a
        non-dismissable <strong>“extension is debugging this browser”</strong> banner
        while it runs. Only one debugger can attach at a time, so{' '}
        <strong>close this tab's DevTools</strong> if it's open.
      </p>
      <div className="confirm__actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn--primary" onClick={onConfirm}>
          Attach debugger &amp; measure
        </button>
      </div>
    </div>
  );
}
