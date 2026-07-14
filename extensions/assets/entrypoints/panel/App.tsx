import { useEffect, useMemo, useState } from 'react';
import { browser } from '#imports';
import { Callout, MockBadge, mockAsync } from '@blur/ui';
import type { ResourceCardModel } from '../../utils/assets-types';
import {
  MOCK_SCENARIOS,
  mockRedirectChain,
  mockInitiatorStack,
} from '../../utils/mock-data';
import { formatWeight } from '../../utils/format';

// DevTools panel — 🥉 the upgrade surface (design §2.5). It shows ONLY what a
// content script cannot: request INITIATORS (which script, which line), redirect
// chains, exact MIME and HTTP status. It deliberately does NOT duplicate the popup.
//
// 🔴 What is NOT here, ever (design §2.5, §13 №4): waterfall, timing breakdown
// (DNS/TCP/TTFB), byte sums, a "Vitals" tab. All of that is the `perf` extension.
// If a reviewer opens both panels and can't tell them apart, we failed the
// separability test (design §8.1).
//
// ⚠️ CAVEAT baked into the architecture (design §1.4, §4.6): this panel CANNOT use
// scripting.executeScript — activeTab is not granted from a click inside a DevTools
// panel (the `seo` rake, PLAN §18a), and there is no persistent content script to
// message. Its picker path must go through `devtools.inspectedWindow.eval()`, which
// runs our code in the inspected page with no permission and outside the page CSP.
// The eval call below is REAL and demonstrates that path; the resource data is
// mocked (TODO_LOGIC), matched against DevTools HAR when the real logic lands.

export function App() {
  const [hostname, setHostname] = useState('');
  const [stale, setStale] = useState(false);
  const [filter, setFilter] = useState('');
  const [scenario, setScenario] = useState(MOCK_SCENARIOS[0]!.id);
  const [resource, setResource] = useState<ResourceCardModel | null>(null);
  const [picking, setPicking] = useState(false);

  // REAL inspectedWindow.eval — the ONLY code-in-page path available to a panel
  // (design §4.6). Harmless read of location.hostname, mirroring perf/panel.
  useEffect(() => {
    browser.devtools.inspectedWindow.eval('location.hostname', (result: unknown) => {
      if (typeof result === 'string') setHostname(result);
    });
  }, []);

  // REAL staleness handling: the HAR log is only valid for the current document.
  // On navigation we clear it and show the "page reloaded" notice (the house
  // "page went stale" pattern, blur commit 7304d8f; design §5.6).
  useEffect(() => {
    const onNav = (): void => {
      setStale(true);
      setResource(null);
    };
    browser.devtools.network.onNavigated.addListener(onNav);
    return () => browser.devtools.network.onNavigated.removeListener(onNav);
  }, []);

  // "Pick element" — would inject the picker via inspectedWindow.eval and receive
  // the result over runtime messaging (design §4.6). STUB: load the selected mock
  // scenario so every resource layout + honest state is reviewable in the panel.
  function pick(): void {
    setPicking(true);
    const build = MOCK_SCENARIOS.find((s) => s.id === scenario)?.build ?? MOCK_SCENARIOS[0]!.build;
    void mockAsync(build(), 300).then((r) => {
      setResource(r);
      setPicking(false);
      setStale(false);
    });
  }

  function reload(): void {
    browser.devtools.inspectedWindow.reload({});
    setStale(false);
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <button type="button" className="primary" onClick={pick} disabled={picking}>
          🎯 {picking ? 'Waiting for a pick…' : 'Point to an element on the page'}
        </button>
        <select value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Mock scenario">
          {MOCK_SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <input
          type="search"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter resources"
        />
      </div>

      {hostname && <p className="host">Inspecting <code>{hostname}</code></p>}

      <Callout tone="warn" title="The panel only sees requests made AFTER it opened">
        Reload the page (Ctrl+R) to capture everything. <button type="button" className="linkish" onClick={reload}>Reload</button>
      </Callout>

      {stale && (
        <Callout tone="poor" title="Page reloaded">
          The request list was cleared. Pick an element again after the page settles.
        </Callout>
      )}

      {resource === null ? (
        <p className="empty">Pick an element to see its initiator, redirect chain, exact MIME and status — the data that exists only in DevTools.</p>
      ) : (
        <ResourceDetail resource={resource} />
      )}
    </div>
  );
}

function ResourceDetail({ resource }: { resource: ResourceCardModel }) {
  const redirects = useMemo(() => mockRedirectChain(), []);
  const initiators = useMemo(() => mockInitiatorStack(), []);
  const name = resource.currentSrc.split('/').pop() || resource.elementLabel;

  return (
    <section className="detail" aria-live="polite">
      {resource.mock && <MockBadge />}

      <div className="card">
        <div className="card__head">
          <strong>{name}</strong>
        </div>
        <div className="url">{resource.currentSrc || '(no URL)'}</div>
        <dl className="props">
          <dt>MIME</dt><dd>{resource.mime.value} <span className="hint">ⓘ from the response, exact</span></dd>
          <dt>Status</dt><dd>200 <span className="hint">ⓘ exact (HAR)</span></dd>
          <dt>Weight</dt><dd>{formatWeight({ kind: 'measured', bytes: 188416 })} <span className="hint">ⓘ _transferSize, bytes on the wire</span></dd>
        </dl>
      </div>

      <div className="card">
        <div className="card__head"><strong>Redirect chain — {redirects.length} steps</strong></div>
        <ol className="chain">
          {redirects.map((r, i) => (
            <li key={i}>
              <span className={`status s${Math.floor(r.status / 100)}`}>{r.status}</span>
              <code className="url">{r.url}</code>
              {r.note && <span className="hint">↓ {r.note}</span>}
            </li>
          ))}
        </ol>
        <p className="hint">ⓘ Steps 1–2 are not in Resource Timing at all: it only shows the final URL.</p>
      </div>

      <div className="card">
        <div className="card__head"><strong>Who called this request</strong></div>
        <ol className="chain">
          {initiators.map((s, i) => (
            <li key={i}>
              <code>{s.location}</code>
              {s.note && <span className="hint">↑ {s.note}</span>}
            </li>
          ))}
        </ol>
        <p className="hint">ⓘ This is <code>_initiator</code> from the HAR. Outside DevTools these lines do not exist — no extension API returns them (design §7 №2).</p>
      </div>
    </section>
  );
}
