import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from '#imports';
import { Button, Callout, EmptyState, Spinner, LocaleProvider } from '@blur/ui';
import {
  findHarEntry,
  harMime,
  harWeight,
  initiatorStack,
  redirectChainFor,
  type HarEntry,
  type HarLog,
} from '../../utils/har';
import { pickerSource, POLL_SOURCE, STOP_SOURCE, type PanelPick } from '../../utils/panel-picker';
import { formatWeight } from '../../utils/format';
import { usePrefs, useAssetsLocale } from '../../utils/use-prefs';
import { useT, type TFn } from '../../utils/i18n';

// DevTools panel — 🥉 the UPGRADE surface (design §2.5). It shows ONLY what a page
// can never see: the request INITIATOR (which script, which line), the REDIRECT
// CHAIN, the exact MIME and status, and the real cross-origin transfer size.
//
// 🔴 What is NOT here, ever (design §2.5, §8.1, §13 №4): a waterfall, a time axis, a
// DNS/TCP/TTFB breakdown, a byte sum, a "Vitals" tab. All of that is the `perf`
// extension. The separability test: hide both panels' titles and a stranger must
// tell them apart in three seconds.
//
// ⚠️ ARCHITECTURAL CAVEAT (design §1.4, §4.6): this panel CANNOT use
// scripting.executeScript — a click inside a DevTools panel does not grant
// `activeTab`, and there is no persistent content script to message. Its only path
// into the page is `devtools.inspectedWindow.eval()`, which needs no permission and
// is not subject to the page's CSP. The picked value comes back through a page
// global, so it is UNTRUSTED page data (see utils/panel-picker.ts) and is rendered
// as text only.
//
// ⚠️ The panel is a STRICT ENHANCEMENT. Firefox for Android has no DevTools at all,
// so nothing the card shows may depend on this file existing.

export function App() {
  const { locale } = useAssetsLocale();
  return (
    <LocaleProvider locale={locale}>
      <PanelBody />
    </LocaleProvider>
  );
}

function PanelBody() {
  const t = useT();
  const { prefs } = usePrefs();
  const [hostname, setHostname] = useState('');
  const [stale, setStale] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<PanelPick | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [harCount, setHarCount] = useState(0);
  const har = useRef<HarEntry[]>([]);

  useEffect(() => {
    browser.devtools.inspectedWindow.eval('location.hostname', (result: unknown) => {
      if (typeof result === 'string') setHostname(result);
    });
  }, []);

  // REAL HAR capture: backfill whatever DevTools already holds, then keep appending.
  // ⚠️ getHAR only sees requests made since DevTools opened — hence the reload banner.
  useEffect(() => {
    browser.devtools.network.getHAR((log: HarLog) => {
      har.current = [...(log.entries ?? [])];
      setHarCount(har.current.length);
    });
    const onFinished = (entry: HarEntry): void => {
      har.current.push(entry);
      setHarCount(har.current.length);
    };
    browser.devtools.network.onRequestFinished.addListener(onFinished);
    return () => browser.devtools.network.onRequestFinished.removeListener(onFinished);
  }, []);

  // The HAR log is only valid for the CURRENT document. On navigation we drop it and
  // say so — a stale request list that silently describes the previous page is worse
  // than none (the house "page went stale" pattern; design §5.6).
  useEffect(() => {
    const onNav = (): void => {
      har.current = [];
      setHarCount(0);
      setPick(null);
      setStale(true);
      setPicking(false);
      browser.devtools.inspectedWindow.eval(STOP_SOURCE);
    };
    browser.devtools.network.onNavigated.addListener(onNav);
    return () => browser.devtools.network.onNavigated.removeListener(onNav);
  }, []);

  // `inspectedWindow.eval` cannot await a user's click, so the picker parks its
  // result on a page global and we poll for it. The poll is bounded and always
  // cleaned up — the page is never left with a live picker we forgot about.
  const startPick = useCallback(() => {
    setError(null);
    setPick(null);
    setPicking(true);
    browser.devtools.inspectedWindow.eval(pickerSource(t('pnlPickerTip')), (_r: unknown, ex?: { isError?: boolean; value?: unknown }) => {
      if (ex?.isError) {
        setPicking(false);
        setError(t('pnlCantPickErr'));
      }
    });
  }, [t]);

  useEffect(() => {
    if (!picking) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      browser.devtools.inspectedWindow.eval(POLL_SOURCE, (result: unknown) => {
        if (stopped || result === null || result === undefined) return;
        const value = result as PanelPick;
        stopped = true;
        setPicking(false);
        if (value.cancelled) return;
        setPick(value);
      });
    }, 200);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      browser.devtools.inspectedWindow.eval(STOP_SOURCE);
    };
  }, [picking]);

  const url = typeof pick?.url === 'string' ? pick.url : '';
  const entry = useMemo(() => (url ? findHarEntry(url, har.current) : null), [url, harCount]);
  const redirects = useMemo(() => (url ? redirectChainFor(url, har.current) : []), [url, harCount]);
  const initiators = useMemo(() => initiatorStack(entry), [entry]);

  const filtered = useMemo(() => {
    if (filter.trim() === '') return [];
    const needle = filter.toLowerCase();
    return har.current.filter((e) => e.request.url.toLowerCase().includes(needle)).slice(0, 50);
  }, [filter, harCount]);

  return (
    <div className="panel">
      <div className="toolbar">
        <Button variant="primary" onClick={startPick} disabled={picking}>
          🎯 {picking ? t('pnlPicking') : t('pnlPick')}
        </Button>
        <input
          type="search"
          placeholder={t('pnlFindReq')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t('pnlFindReq')}
        />
        {picking && <Spinner label={t('pnlWaitingPick')} />}
      </div>

      {hostname && (
        <p className="host">
          {t('pnlInspecting')} <code>{hostname}</code> ·{' '}
          {t(harCount === 1 ? 'pnlReqCapturedOne' : 'pnlReqCapturedOther', { count: harCount })}
        </p>
      )}

      <Callout tone="warn" title={t('pnlCapAfterTitle')}>
        {t('pnlCapAfterBody')}
        <Button variant="ghost" onClick={() => { browser.devtools.inspectedWindow.reload({}); setStale(false); }}>
          {t('reloadPage')}
        </Button>
      </Callout>

      {stale && (
        <Callout tone="poor" title={t('pnlNavTitle')}>
          {t('pnlNavBody')}
        </Callout>
      )}

      {error && <Callout tone="poor" title={t('pnlCantPickTitle')}>{error}</Callout>}

      {pick === null ? (
        <EmptyState
          title={t('pnlEmptyTitle')}
          hint={t('pnlEmptyHint')}
        />
      ) : (
        <ResourceDetail
          t={t}
          pick={pick}
          entry={entry}
          redirects={redirects}
          initiators={initiators}
          units={prefs.units}
        />
      )}

      {filtered.length > 0 && (
        <section className="detail">
          <div className="card">
            <div className="card__head"><strong>{t('pnlMatching', { filter })}</strong></div>
            <ol className="chain">
              {filtered.map((e, i) => (
                <li key={`${e.request.url}-${i}`}>
                  <span className={`status s${Math.floor(e.response.status / 100)}`}>{e.response.status}</span>
                  <code className="url">{e.request.url}</code>
                  <span className="hint">{e.response.content?.mimeType ?? '—'}</span>
                </li>
              ))}
            </ol>
            {/* 🔴 Per-row reading only. No bulk copy, no select-all, no checkboxes —
                a list of media URLs you can lift in one action is a harvester, and
                that is the category boundary (design §2.7, §13 №3). */}
          </div>
        </section>
      )}
    </div>
  );
}

function ResourceDetail({
  t,
  pick,
  entry,
  redirects,
  initiators,
  units,
}: {
  t: TFn;
  pick: PanelPick;
  entry: HarEntry | null;
  redirects: ReturnType<typeof redirectChainFor>;
  initiators: ReturnType<typeof initiatorStack>;
  units: 1024 | 1000;
}) {
  // Everything below is page-controlled text. React escapes it; no dangerouslySet…
  // anywhere in this extension, and no href is built from it (design §9.1).
  const url = typeof pick.url === 'string' ? pick.url : '';
  const label = typeof pick.label === 'string' ? pick.label : t('element');
  const mime = harMime(entry);
  const weight = harWeight(entry);

  return (
    <section className="detail" aria-live="polite">
      <div className="card">
        <div className="card__head">
          <strong>{label}</strong>
        </div>
        <div className="url">{url || t('noResourceUrlParen')}</div>
        <dl className="props">
          <dt>{t('mimeLabel')}</dt>
          <dd>
            {mime.value}{' '}
            <span className="hint">
              {mime.certainty === 'exact' ? t('mimeExact') : t('mimeNoRecord')}
            </span>
          </dd>
          <dt>{t('statusLabel')}</dt>
          <dd>{entry ? entry.response.status : t('statusNoRecord')}</dd>
          <dt>{t('weightLabel')}</dt>
          <dd>
            {formatWeight(weight, units, t)}{' '}
            {weight.kind === 'measured' && <span className="hint">{t('weightWire')}</span>}
          </dd>
          {pick.natural && (
            <>
              <dt>{t('naturalSizeLabel')}</dt>
              <dd>{pick.natural[0]} × {pick.natural[1]}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="card">
        <div className="card__head">
          <strong>
            {t('redirectChain')}
            {redirects.length > 0
              ? ` — ${t(redirects.length === 1 ? 'redirectStepOne' : 'redirectStepOther', { n: redirects.length })}`
              : ''}
          </strong>
        </div>
        {redirects.length === 0 ? (
          <p className="hint">{t('redirectNoRecordPanel')}</p>
        ) : redirects.length === 1 ? (
          <p className="hint">{t('redirectNonePanel')}</p>
        ) : (
          <ol className="chain">
            {redirects.map((r, i) => (
              <li key={`${r.url}-${i}`}>
                <span className={`status s${Math.floor(r.status / 100)}`}>{r.status}</span>
                <code className="url">{r.url}</code>
                {r.note && <span className="hint">↓ {r.note}</span>}
              </li>
            ))}
          </ol>
        )}
        <p className="hint">{t('redirectFinalOnly')}</p>
      </div>

      <div className="card">
        <div className="card__head"><strong>{t('whoRequested')}</strong></div>
        {initiators.length === 0 ? (
          <p className="hint">{t('noInitiatorPanel')}</p>
        ) : (
          <ol className="chain">
            {initiators.map((s, i) => (
              <li key={`${s.location}-${i}`}>
                <code>{s.location}</code>
                {s.note && <span className="hint">↑ {s.note}</span>}
              </li>
            ))}
          </ol>
        )}
        <p className="hint">{t('initiatorHarNote')}</p>
      </div>
    </section>
  );
}
