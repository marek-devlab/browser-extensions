import { defineBackground } from '#imports';
import { lastReportItem } from '../utils/storage';
import type {
  A11yReportOutcome,
  ContentRequest,
  ContentResponse,
  SeoReportOutcome,
  SeoRequest,
} from '../utils/messages';
import type { A11yReport } from '@blur/core';
import type { SeoReportEx } from '../utils/checks';

// `SeoProtocol` router. BOTH operations run through the always-on, declared
// `<all_urls>` content script via `browser.tabs.sendMessage`:
//
//   - SEO report:   the content script reads the settled DOM and same-origin
//                   indexability signals and returns a `SeoReportEx`.
//   - A11y audit:   the content script loads axe-core on demand (dynamic import)
//                   and runs `axe.run(document)`, returning a serialisable report.
//
// A declared content script can be messaged with NO `activeTab` gesture and NO
// `scripting` inject — which is exactly why the DevTools panel's audit button
// works (opening a panel and clicking inside it never grants `activeTab`). The
// background is a thin relay; axe-core is never imported here.

// Message the declared content script and unwrap its `Outcome` envelope. The
// content script replies via `sendResponse`; an `undefined` reply means the
// listener never answered (wrong/old content script), surfaced as an error.
async function askContent<T>(
  tabId: number,
  request: ContentRequest,
): Promise<ContentResponse<T>> {
  const response = (await browser.tabs.sendMessage(tabId, request)) as
    | ContentResponse<T>
    | undefined;
  if (response == null) {
    return { ok: false, error: 'The page did not return a result.' };
  }
  return response;
}

async function getSeoReport(tabId: number): Promise<SeoReportOutcome> {
  try {
    const outcome = await askContent<SeoReportEx>(tabId, { type: 'extractSeo' });
    if (!outcome.ok) return outcome;
    await lastReportItem.setValue(outcome.data);
    return outcome;
  } catch (error) {
    // A rejected sendMessage means the content script is not present — a
    // restricted page (chrome://, the Web Store) or one loaded before the
    // extension was installed and not yet reloaded.
    return {
      ok: false,
      error: describe(
        error,
        'This page cannot be audited, or it needs a reload for the auditor to attach.',
      ),
    };
  }
}

async function runA11yAudit(tabId: number): Promise<A11yReportOutcome> {
  try {
    return await askContent<A11yReport>(tabId, { type: 'runA11y' });
  } catch (error) {
    return {
      ok: false,
      error: describe(
        error,
        'This page cannot be audited, or it needs a reload for the auditor to attach.',
      ),
    };
  }
}

function describe(error: unknown, fallback?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /chrome:\/\/|edge:\/\/|about:|cannot be scripted|showing error page|receiving end does not exist|could not establish connection/i.test(
      message,
    )
  ) {
    return (
      fallback ??
      'This page cannot be audited (browser or store pages are off-limits), or it needs a reload.'
    );
  }
  return fallback ?? message;
}

export default defineBackground(() => {
  // Native `chrome.runtime.onMessage` (and Firefox) IGNORE a returned Promise:
  // an async reply MUST go through `sendResponse` with the listener returning
  // `true` to keep the channel open — the same contract every other extension in
  // this repo (perf/adblock/blur) and the content script below already use. The
  // earlier `return getSeoReport(...)` returned a Promise, which native Chrome
  // dropped, so the popup/panel `sendMessage` never resolved and both hung.
  // `getSeoReport`/`runA11yAudit` resolve to an `Outcome` and never reject, so
  // `.then(sendResponse)` is safe without a `.catch`.
  browser.runtime.onMessage.addListener(
    (
      message: SeoRequest,
      _sender,
      sendResponse: (response: SeoReportOutcome | A11yReportOutcome) => void,
    ) => {
      switch (message.type) {
        case 'getSeoReport':
          void getSeoReport(message.tabId).then(sendResponse);
          return true;
        case 'runA11yAudit':
          void runA11yAudit(message.tabId).then(sendResponse);
          return true;
        default:
          return undefined;
      }
    },
  );
});
