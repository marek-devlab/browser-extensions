import { browser } from '#imports';
import type { NetworkEntry, PageInsight, ResourceKind } from '@blur/core';
import { buildInsight } from './resource-timing';
import { isThirdParty } from './registrable-domain';
import type { MeasureResult } from './protocol';

// Opt-in exact wire bytes (PLAN.md §8), Chrome only.
//   - Chrome: chrome.debugger + CDP `Network.loadingFinished.encodedDataLength`,
//     the only way to get true bytes for cross-origin resources with no
//     Timing-Allow-Origin. Shows a non-dismissable banner; only one debugger
//     client per tab, so the trigger lives in the POPUP (which needs no DevTools),
//     never the DevTools panel (whose own attach would conflict).
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
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
  const target = { tabId };
  try {
    await browser.debugger.attach(target, '1.3');
  } catch (err) {
    // The most common failure: DevTools is already attached to this tab. Running
    // from the popup avoids that, but the user may still have DevTools open.
    return {
      ok: false,
      error:
        errorMessage(err) ||
        'Could not attach the debugger. Close the DevTools window for this tab (only one debugger may attach at a time) and try again.',
    };
  }

  const meta = new Map<string, { url: string; type: string }>();
  const bytes = new Map<string, number>();
  let resolveLoad: (() => void) | null = null;

  const onEvent = (
    source: { tabId?: number },
    method: string,
    params?: object,
  ): void => {
    if (source.tabId !== tabId) return;
    const p = asRecord(params);
    if (!p) return;
    if (method === 'Network.responseReceived') {
      const response = asRecord(p.response);
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
  };

  const onDetach = (source: { tabId?: number }): void => {
    if (source.tabId === tabId) resolveLoad?.();
  };

  browser.debugger.onEvent.addListener(onEvent);
  browser.debugger.onDetach.addListener(onDetach);

  try {
    await browser.debugger.sendCommand(target, 'Network.enable');
    await browser.debugger.sendCommand(target, 'Page.enable');

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
    await browser.debugger.sendCommand(target, 'Page.reload', { ignoreCache: true });

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
    browser.debugger.onEvent.removeListener(onEvent);
    browser.debugger.onDetach.removeListener(onDetach);
    await browser.debugger.detach(target).catch(() => undefined);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  const rec = asRecord(err);
  if (rec && typeof rec.message === 'string') return rec.message;
  return '';
}
