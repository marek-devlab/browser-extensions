import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { Callout, MockBadge, mockAsync } from '@blur/ui';
import { mockPageCounters, type PageCounters } from '../../utils/mock-data';

// Popup — 🥈 secondary surface (design §2.6). It is NOT where the card lives (the
// popup dies on the first page click, design §0 И3). Its whole job: launch the
// picker, show completeness counters, and link out. The counters are COUNTS, never
// a byte budget (that would be `perf`, design §2.6).

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
        // Non-web tab (chrome://, about:) — leave blank.
      }
      setState({ tabId: tab.id, hostname });
    });
  }, []);
  return state;
}

export function App() {
  const { tabId, hostname } = useActiveTab();
  const [counters, setCounters] = useState<PageCounters | null>(null);

  // Mock counters (TODO_LOGIC: real counts come from the injected inspector reading
  // performance.getEntriesByType('resource') — nothing is fetched or persisted).
  useEffect(() => {
    if (!hostname) { setCounters(null); return; }
    let active = true;
    void mockAsync(mockPageCounters()).then((c) => { if (active) setCounters(c); });
    return () => { active = false; };
  }, [hostname]);

  // The toolbar click that showed this popup granted activeTab; the background
  // injects the overlay, then we close so the user can click the page (design §4.1).
  function pick(): void {
    if (tabId === null) return;
    void browser.runtime.sendMessage({ type: 'assets:openPicker', tabId });
    window.close();
  }

  const onWebPage = Boolean(hostname);
  const bufferNearFull = counters ? counters.requestsRecorded >= 0.85 * counters.bufferLimit : false;

  return (
    <main className="popup">
      <header className="head">
        <h1>Asset Inspector</h1>
      </header>

      <button type="button" className="pick" onClick={pick} disabled={!onWebPage} aria-label="Point to an element on this page and inspect its source">
        <span className="pick__icon" aria-hidden="true">🎯</span>
        <span className="pick__label">Point to an element</span>
        <span className="pick__hint">Alt+Shift+A</span>
      </button>

      {!onWebPage && (
        <p className="muted" role="status">The inspector can’t run on this page.</p>
      )}

      <p className="muted">
        Or: right-click an image / video / audio → <b>“What is this element?”</b>
      </p>

      <section className="counters">
        <h2>What is visible on this page</h2>
        {counters === null ? (
          <p className="muted">{onWebPage ? 'Measuring…' : '—'}</p>
        ) : (
          <>
            <MockBadge />
            <dl className="counter-grid">
              <div><dt>Requests recorded</dt><dd>{counters.requestsRecorded}</dd></div>
              <div><dt>Images</dt><dd>{counters.images}</dd></div>
              <div><dt>Media</dt><dd>{counters.media}</dd></div>
            </dl>
            {bufferNearFull && (
              <Callout tone="warn" title="Request buffer almost full">
                Recorded {counters.requestsRecorded} of {counters.bufferLimit}. The browser will stop
                recording new requests (it drops new ones, it does not evict old ones). Reload the
                page — the inspector raises the limit to 1500.
              </Callout>
            )}
          </>
        )}
      </section>

      <nav className="links">
        <button type="button" className="linkish" onClick={() => void browser.tabs.create({ url: browser.runtime.getURL('/resources.html') })}>
          All resources as a table → <span className="tag">v2</span>
        </button>
        <button type="button" className="linkish" onClick={() => void browser.runtime.openOptionsPage()}>
          Settings →
        </button>
      </nav>
    </main>
  );
}
