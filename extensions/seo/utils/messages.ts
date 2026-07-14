import { browser } from 'wxt/browser';
import type { A11yReport } from '@blur/core';
import type { SeoReportEx } from './checks';

// Messaging contract between the UI (popup / DevTools panel) and the background
// router. `SeoProtocol` (in @blur/core) defines the logical operations; because a
// real audit can fail on a restricted page, the wire responses wrap the result so
// the UI can surface the failure instead of swallowing it.

export type SeoRequest =
  | { type: 'getSeoReport'; tabId: number }
  | { type: 'runA11yAudit'; tabId: number };

export type Outcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type SeoReportOutcome = Outcome<SeoReportEx>;
export type A11yReportOutcome = Outcome<A11yReport>;

// Messages the background sends INTO the content script, and the envelope the
// content script sends back. The content script replies via `sendResponse`
// (not by returning a Promise): WXT's `browser` is the NATIVE `chrome` API,
// where an async `onMessage` reply REQUIRES `return true` + `sendResponse` —
// a returned Promise is silently dropped. The envelope also carries the real
// failure text (e.g. an axe timeout) across the boundary instead of losing it.
export type ContentRequest = { type: 'extractSeo' } | { type: 'runA11y' };
export type ContentResponse<T> = Outcome<T>;

export function requestSeoReport(tabId: number): Promise<SeoReportOutcome> {
  return browser.runtime.sendMessage({
    type: 'getSeoReport',
    tabId,
  } satisfies SeoRequest);
}

export function requestA11yAudit(tabId: number): Promise<A11yReportOutcome> {
  return browser.runtime.sendMessage({
    type: 'runA11yAudit',
    tabId,
  } satisfies SeoRequest);
}

/** Resolve the id of the tab the user is acting on, or null if none is active. */
export async function activeTabId(): Promise<number | null> {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  return tab?.id ?? null;
}
