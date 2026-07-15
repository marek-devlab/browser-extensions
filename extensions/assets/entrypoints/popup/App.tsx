import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { Button, Callout } from '@blur/ui';
import type { PageCounters } from '../../utils/assets-types';

// Popup — 🥈 secondary surface (design §2.6). It is NOT where the card lives: the
// popup dies on the first click on the page, so "open popup → click element → read
// the result in the popup" is physically impossible (design §0 И3). Its whole job:
// launch the picker, show completeness counters, link out.
//
// ⚠️ MOBILE IS LOAD-BEARING: on Firefox for Android there is no right-click and no
// context menu at all, and no DevTools panel. So every entry point the context menu
// offers must ALSO be here — this button is the one guaranteed way in on every
// platform. It is feature parity by construction, not by user-agent sniffing.
//
// 🔴 The numbers here are COUNTS, never a byte budget. "This page weighs 4.2 MB" is
// the `perf` extension's question, and we could not answer it honestly anyway
// (design §2.6, §8).

function useActiveTab(): { tabId: number | null; hostname: string; ready: boolean } {
  const [state, setState] = useState<{ tabId: number | null; hostname: string; ready: boolean }>({
    tabId: null,
    hostname: '',
    ready: false,
  });
  useEffect(() => {
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      let hostname = '';
      try {
        if (tab?.url) hostname = new URL(tab.url).hostname;
      } catch {
        // Non-web tab (chrome://, about:) — leave blank; the button disables itself.
      }
      setState({ tabId: tab?.id ?? null, hostname, ready: true });
    });
  }, []);
  return state;
}

/**
 * Count what the page has, in the page, with ZERO network. `scripting.executeScript`
 * with a `func` runs in our isolated world under the `activeTab` grant the toolbar
 * click just issued — the same grant the inspector uses. Nothing is fetched, nothing
 * is stored, and the counts never leave the popup.
 *
 * ⚠️ Resource Timing's cap defaults to 250 and the browser drops NEW entries once it
 * is reached (it does not evict old ones — design §10.5). If the inspector already
 * ran in this document it published the raised cap on the isolated world's global,
 * so we report the REAL limit instead of guessing.
 */
async function readCounters(tabId: number): Promise<PageCounters | null> {
  try {
    const [result] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => {
        const entries = performance.getEntriesByType('resource');
        const media = document.querySelectorAll('video, audio').length;
        const globals = window as unknown as Record<string, unknown>;
        const raised = globals['__assetsInspectorBufferLimit'];
        // Count <img> only: an <img> nested in a <picture> is one image, not two.
        return {
          requestsRecorded: entries.length,
          images: document.querySelectorAll('img').length,
          media,
          bufferLimit: typeof raised === 'number' ? raised : 250,
          overflowed: globals['__assetsInspectorBufferOverflowed'] === true,
        };
      },
    });
    return (result?.result as PageCounters | undefined) ?? null;
  } catch {
    // A page we may not script (chrome://, the add-ons gallery, a PDF). Not an
    // error — just not a page with resources to count.
    return null;
  }
}

export function App() {
  const { tabId, hostname, ready } = useActiveTab();
  const [counters, setCounters] = useState<PageCounters | null>(null);
  const [countersState, setCountersState] = useState<'loading' | 'done' | 'unavailable'>('loading');

  useEffect(() => {
    if (!ready) return;
    if (tabId === null || !hostname) {
      setCountersState('unavailable');
      return;
    }
    let active = true;
    void readCounters(tabId).then((c) => {
      if (!active) return;
      setCounters(c);
      setCountersState(c ? 'done' : 'unavailable');
    });
    return () => {
      active = false;
    };
  }, [ready, tabId, hostname]);

  // The toolbar click that opened this popup granted activeTab for this tab; the
  // background injects the overlay, and we close so the user can click the page.
  function pick(): void {
    if (tabId === null) return;
    void browser.runtime.sendMessage({ type: 'assets:openPicker', tabId });
    window.close();
  }

  const onWebPage = Boolean(hostname);
  // `overflowed` is the FACT (the inspector saw `resourcetimingbufferfull`); the 85%
  // ratio is the early warning. Either one earns the callout.
  const overflowed = counters?.overflowed === true;
  const nearFull =
    counters !== null && (overflowed || counters.requestsRecorded >= 0.85 * counters.bufferLimit);

  return (
    <main className="popup">
      <header className="head">
        <h1>Asset Inspector</h1>
      </header>

      <button
        type="button"
        className="pick"
        onClick={pick}
        disabled={!onWebPage}
        aria-label="Point to an element on this page and inspect where it came from"
      >
        <span className="pick__icon" aria-hidden="true">🎯</span>
        <span className="pick__label">Point to an element</span>
        <span className="pick__hint">Alt+Shift+A</span>
      </button>

      {ready && !onWebPage && (
        <p className="muted" role="status">The inspector can’t run on this page.</p>
      )}

      <p className="muted">
        Or right-click an image / video / audio → <b>“What is this element?”</b>
        {' '}(where the browser offers a context menu).
      </p>

      <section className="counters">
        <h2>What is on this page</h2>
        {countersState === 'loading' && <p className="muted">Counting…</p>}
        {countersState === 'unavailable' && <p className="muted">—</p>}
        {countersState === 'done' && counters && (
          <>
            <dl className="counter-grid">
              <div><dt>Requests recorded</dt><dd>{counters.requestsRecorded}</dd></div>
              <div><dt>Images</dt><dd>{counters.images}</dd></div>
              <div><dt>Media elements</dt><dd>{counters.media}</dd></div>
            </dl>
            {nearFull && (
              <Callout tone="warn" title={overflowed ? 'The request buffer overflowed' : 'The request buffer is nearly full'}>
                Recorded {counters.requestsRecorded} of {counters.bufferLimit}. Past the cap the browser
                stops recording new requests — it drops the new ones, it does not evict the old ones, so
                the late requests on this page go missing. Reload the page and the inspector raises the
                cap; what was already dropped cannot come back.
                <Button variant="ghost" onClick={() => { if (tabId !== null) void browser.tabs.reload(tabId); }}>
                  Reload the page
                </Button>
              </Callout>
            )}
          </>
        )}
      </section>

      <nav className="links">
        <button type="button" className="linkish" onClick={() => void browser.runtime.openOptionsPage()}>
          Settings →
        </button>
      </nav>
    </main>
  );
}
