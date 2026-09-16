import { browser } from '#imports';
import type { NetworkEntry, PageInsight, ResourceKind } from '@blur/core';
import { attachCdp, errorMessage } from '@blur/netcore';
import { buildInsight } from './resource-timing';
import { isThirdParty } from './registrable-domain';
import type { MeasureResult } from './protocol';

// Opt-in exact wire bytes (PLAN.md §8), Chrome only.
//   - Chrome: chrome.debugger + CDP `Network.loadingFinished.encodedDataLength`,
//     the only way to get true bytes for cross-origin resources with no
//     Timing-Allow-Origin. Shows a non-dismissable banner. The trigger lives in
//     the POPUP (which needs no DevTools) — verified on Chromium 153 that an open
//     DevTools window does NOT block or detach an extension session
//     (e2e/netblock-spikes/REPORT.md S1), but the popup is still the right home:
//     it is the user gesture that grants the optional `debugger` permission.
//     Session plumbing (attach, per-tab event routing, detach-in-finally, error
//     text) is the shared `@blur/netcore` `attachCdp`.
//   - Firefox: has no chrome.debugger (bugzilla 1323098), and — verified against
//     MDN — `webRequest.onCompleted` exposes no response-size field. There is
//     therefore NO banner-free exact path on Firefox; it honestly falls back to
//     Resource Timing. We never present ~0 bytes for a multi-MB page as "exact".
//
// The `debugger` permission is requested from the popup (a user gesture); this
// background-side code assumes it is already granted.

const CDP_KIND: Record<string, ResourceKind> = {
  Document: 'document',
  Script: 'script',
  Stylesheet: 'stylesheet',
  Image: 'image',
  Font: 'font',
  Media: 'media',
  XHR: 'xhr',
  Fetch: 'xhr',
};

function toExactInsight(entries: NetworkEntry[], hostname: string): PageInsight {
  // Reuse the Resource-Timing roll-up, then correct the source: every byte here
  // was measured, so nothing is unmeasured.
  return {
    ...buildInsight(entries, hostname),
    byteSource: 'cdp-debugger',
    unmeasuredRequests: 0,
  };
}

export function measureExactBytes(
  tabId: number,
  hostname: string,
): Promise<MeasureResult> {
  if (import.meta.env.FIREFOX) {
    // No debugger API and no webRequest size field on Firefox — refuse rather than
    // report a fabricated total. The UI never offers this trigger on Firefox, but
    // guard the message path too.
    return Promise.resolve({
      ok: false,
      error:
        'Exact byte measurement is not available in this browser. Firefox has no debugger API and its network events report no response size, so only Resource-Timing bytes (a lower bound) can be shown.',
    });
  }
  return measureWithCdp(tabId, hostname);
}

/* ---------------------------- Chrome: CDP ------------------------------ */

async function measureWithCdp(
  tabId: number,
  hostname: string,
): Promise<MeasureResult> {
  const meta = new Map<string, { url: string; type: string }>();
  const bytes = new Map<string, number>();
  let resolveLoad: (() => void) | null = null;

  const attached = await attachCdp(browser.debugger, tabId, {
    onEvent: (method, p) => {
      if (method === 'Network.responseReceived') {
        const response =
          typeof p.response === 'object' && p.response !== null
            ? (p.response as Record<string, unknown>)
            : null;
        meta.set(String(p.requestId), {
          url: response && typeof response.url === 'string' ? response.url : '',
          type: typeof p.type === 'string' ? p.type : 'Other',
        });
      } else if (method === 'Network.loadingFinished') {
        const id = String(p.requestId);
        const len = typeof p.encodedDataLength === 'number' ? p.encodedDataLength : 0;
        bytes.set(id, (bytes.get(id) ?? 0) + len);
      } else if (method === 'Page.loadEventFired') {
        resolveLoad?.();
      }
    },
    // The user pressed Cancel on the infobar, the tab closed, or policy cut us
    // off: stop waiting and report what was captured so far (or the honest
    // "nothing captured" below), never a fabricated total.
    onDetach: () => resolveLoad?.(),
  });
  if (!attached.ok) {
    return {
      ok: false,
      error:
        attached.error ||
        'Could not attach the debugger to this tab. Close other debugging tools attached to it and try again.',
    };
  }
  const session = attached.session;

  try {
    await session.send('Network.enable');
    await session.send('Page.enable');

    // Arm the load signal BEFORE issuing the reload (bug 1b). A fast or cached
    // load can fire Page.loadEventFired during the awaits below; if resolveLoad
    // were still null then, the handler would no-op and we'd always sit out the
    // full 20 s fallback. Constructing the promise here assigns resolveLoad
    // synchronously, so the handler can resolve the instant the load fires.
    const loadPromise = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });

    // encodedDataLength only accrues for requests seen after enable, so reload to
    // capture the whole page from the first byte. ignoreCache bypasses the HTTP
    // cache (bug 1c) so every resource is re-fetched and its real wire size is
    // counted — otherwise cache-served resources report ~0 encodedDataLength and
    // the "exact page weight" total would silently omit them.
    await session.send('Page.reload', { ignoreCache: true });

    await Promise.race([
      loadPromise,
      new Promise<void>((resolve) => globalThis.setTimeout(resolve, 20_000)),
    ]);
    // Let trailing loadingFinished events settle after the load event.
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 1_500));

    const entries: NetworkEntry[] = [];
    for (const [id, size] of bytes) {
      const info = meta.get(id);
      const url = info?.url ?? '';
      entries.push({
        url,
        kind: (info && CDP_KIND[info.type]) ?? 'other',
        duration: 0,
        transferSize: size,
        thirdParty: url ? isThirdParty(url, hostname) : false,
        blocked: false,
      });
    }
    if (entries.length === 0) {
      // Attached but captured nothing — do not present an empty page as "exact 0 B".
      return {
        ok: false,
        error:
          'No network activity was captured. The page may have failed to reload — try again.',
      };
    }
    return {
      ok: true,
      insight: toExactInsight(entries, hostname),
      entries,
      mechanism: 'cdp-debugger',
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) || 'CDP measurement failed.' };
  } finally {
    await session.detach();
  }
}
