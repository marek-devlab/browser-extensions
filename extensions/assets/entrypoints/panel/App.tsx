import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from '#imports';
import { Button, Callout, EmptyState, Spinner } from '@blur/ui';
import {
  findHarEntry,
  harMime,
  harWeight,
  initiatorStack,
  redirectChainFor,
  type HarEntry,
  type HarLog,
} from '../../utils/har';
import { PICKER_SOURCE, POLL_SOURCE, STOP_SOURCE, type PanelPick } from '../../utils/panel-picker';
import { formatWeight } from '../../utils/format';
import { usePrefs } from '../../utils/use-prefs';

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
    browser.devtools.inspectedWindow.eval(PICKER_SOURCE, (_r: unknown, ex?: { isError?: boolean; value?: unknown }) => {
      if (ex?.isError) {
        setPicking(false);
        setError('This page cannot be scripted from the panel (a browser-internal page, or its CSP blocks eval).');
      }
    });
  }, []);

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
          🎯 {picking ? 'Click an element on the page…' : 'Point to an element on the page'}
        </Button>
        <input
          type="search"
          placeholder="Find a captured request…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Find a captured request"
        />
        {picking && <Spinner label="Waiting for a pick" />}
      </div>

      {hostname && (
        <p className="host">
          Inspecting <code>{hostname}</code> · {harCount} request{harCount === 1 ? '' : 's'} captured
        </p>
      )}

      <Callout tone="warn" title="The panel only sees requests made AFTER DevTools opened">
        Reload the page to capture everything — the initiator and the redirect chain exist nowhere else.
        <Button variant="ghost" onClick={() => { browser.devtools.inspectedWindow.reload({}); setStale(false); }}>
          Reload the page
        </Button>
      </Callout>

      {stale && (
        <Callout tone="poor" title="The page navigated">
          The captured request list was cleared — it described the previous document. Pick an element
          again once the new page has settled.
        </Callout>
      )}

      {error && <Callout tone="poor" title="Cannot run the picker here">{error}</Callout>}

      {pick === null ? (
        <EmptyState
          title="Pick an element"
          hint="The panel shows what a page can never see about a resource: which script requested it, the redirect chain it travelled, its exact MIME type and HTTP status."
        />
      ) : (
        <ResourceDetail
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
            <div className="card__head"><strong>Captured requests matching “{filter}”</strong></div>
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
  pick,
  entry,
  redirects,
  initiators,
  units,
}: {
  pick: PanelPick;
  entry: HarEntry | null;
  redirects: ReturnType<typeof redirectChainFor>;
  initiators: ReturnType<typeof initiatorStack>;
  units: 1024 | 1000;
}) {
  // Everything below is page-controlled text. React escapes it; no dangerouslySet…
  // anywhere in this extension, and no href is built from it (design §9.1).
  const url = typeof pick.url === 'string' ? pick.url : '';
  const label = typeof pick.label === 'string' ? pick.label : 'element';
  const mime = harMime(entry);
  const weight = harWeight(entry);

  return (
    <section className="detail" aria-live="polite">
      <div className="card">
        <div className="card__head">
          <strong>{label}</strong>
        </div>
        <div className="url">{url || '(this element has no resource URL)'}</div>
        <dl className="props">
          <dt>MIME</dt>
          <dd>
            {mime.value}{' '}
            <span className="hint">
              {mime.certainty === 'exact' ? 'ⓘ from the response — exact' : 'ⓘ DevTools has no record of this request'}
            </span>
          </dd>
          <dt>Status</dt>
          <dd>{entry ? entry.response.status : 'no record — reload the page with DevTools open'}</dd>
          <dt>Weight</dt>
          <dd>
            {formatWeight(weight, units)}{' '}
            {weight.kind === 'measured' && <span className="hint">ⓘ bytes on the wire (_transferSize)</span>}
          </dd>
          {pick.natural && (
            <>
              <dt>Natural size</dt>
              <dd>{pick.natural[0]} × {pick.natural[1]}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="card">
        <div className="card__head">
          <strong>Redirect chain{redirects.length > 0 ? ` — ${redirects.length} step${redirects.length === 1 ? '' : 's'}` : ''}</strong>
        </div>
        {redirects.length === 0 ? (
          <p className="hint">
            No record for this URL yet. DevTools only captures requests made after it opened — reload
            the page.
          </p>
        ) : redirects.length === 1 ? (
          <p className="hint">No redirect: the browser fetched this URL directly.</p>
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
        <p className="hint">
          ⓘ The intermediate hops are not in Resource Timing at all — it reports only the final URL.
          This chain exists nowhere but here.
        </p>
      </div>

      <div className="card">
        <div className="card__head"><strong>Who requested it</strong></div>
        {initiators.length === 0 ? (
          <p className="hint">
            No initiator recorded for this URL. Reload the page with DevTools open — the initiator is
            captured at request time, not afterwards.
          </p>
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
        <p className="hint">
          ⓘ This is <code>_initiator</code> from the HAR. Outside DevTools these lines do not exist —
          no extension API returns them, which is why the card says “type only”.
        </p>
      </div>
    </section>
  );
}
