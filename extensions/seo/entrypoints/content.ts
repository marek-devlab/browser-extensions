import { defineContentScript } from '#imports';
import { injectScript } from 'wxt/utils/inject-script';
import type { A11yReport } from '@blur/core';
import { assembleSeoReportEx, type SeoReportEx } from '../utils/checks';
import { extractSeoDom } from '../utils/extract-seo';
import { indexabilityChecks } from '../utils/indexability';
import { tAt, type TFn } from '../utils/i18n';
import { localeItem } from '../utils/storage';
import type { ContentRequest, ContentResponse } from '../utils/messages';

// This declared, always-on `document_idle` content script is the extension's ONLY
// page-access surface. Because it is declared with `matches: ['<all_urls>']`, the
// panel/popup can `tabs.sendMessage` it on any page with no `activeTab` gesture
// and no `scripting` inject — which is what makes the DevTools audit actually
// reachable (opening a DevTools panel and clicking inside it never grants
// `activeTab`, so the old `executeScript` path could never run).
//
// Two jobs, both message-driven:
//   - `extractSeo` → read the settled DOM + same-origin indexability probes.
//   - `runA11y`    → inject the axe-core runner ON DEMAND (a separate web-
//                    accessible chunk) and await its result. axe-core is NEVER
//                    part of this always-on script — verify: content.js stays
//                    small and axe lives only in axe-run.js.
//
// `document_idle` (not `document_start`): we want the FINAL DOM. Structured data
// and meta/og tags are frequently injected by frameworks after first paint.

const AUDIT_TIMEOUT_MS = 30_000;

async function buildSeoReport(): Promise<SeoReportEx> {
  // Resolve the user's chosen language so the check prose is stamped in it. This
  // is presentation only — the locale never affects which checks run or their
  // severities; a fresh install falls back to English.
  const locale = await localeItem.getValue();
  const t: TFn = (key, vars) => tAt(locale, key, vars);
  const dom = extractSeoDom();
  const extraChecks = await indexabilityChecks(location.href, dom.favicon !== null, t);
  return assembleSeoReportEx(dom, extraChecks, t);
}

interface A11yResultMessage {
  source: 'blur-seo-a11y';
  nonce: string;
  ok: boolean;
  report?: A11yReport;
  error?: string;
}

function isA11yResult(data: unknown): data is A11yResultMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === 'blur-seo-a11y'
  );
}

// A per-audit correlation token that authenticates the axe runner's reply, so it
// MUST be unguessable: a page that can predict it can forge an a11y result mid-
// audit. `Date.now()` + `Math.random()` are both predictable, so use
// `crypto.getRandomValues` (128 bits) — unlike `crypto.randomUUID`, it is
// available in insecure contexts too, and this script runs on `<all_urls>`
// (including plain http). Verified on receipt in `onMessage` below.
function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Inject the axe runner into the page and resolve with the report it posts back.
//
// The runner runs in the page's MAIN world (axe needs the live document, and a
// 550 kB engine must stay a lazily-fetched, web-accessible chunk rather than
// bloat this always-on `<all_urls>` script — bundling it in-world adds ~0.6 MB to
// every page load). A one-time 128-bit nonce ties the reply to THIS request so a
// page cannot forge a result with a blind `postMessage`.
//
// ⚠️ DEFENCE-IN-DEPTH, NOT AIRTIGHT: a content script cannot hand a secret to a
// MAIN-world script over any channel the page can't also observe — the nonce
// rides the injected `<script>`'s dataset, and a page that synchronously hooks
// DOM insertion (patched `appendChild`, legacy `DOMNodeInserted`) can read it
// before we remove the element. So the nonce stops GENERIC/opportunistic forgery
// (a page blindly spamming `blur-seo-a11y` messages), not a page purpose-built to
// race this exact audit. We shrink that window as far as MAIN-world allows:
//   - `use_dynamic_url` (wxt.config.ts) hides the runner URL, killing the fixed-
//     URL fingerprint probe and a predictable pre-instrumentation target.
//   - `keepInDom: false` removes the `<script>` the instant it finishes executing
//     (the runner reads its nonce synchronously at line 1), so an ASYNC observer
//     (MutationObserver) never sees it — only a synchronous hook can.
// Fully closing it would mean running axe in the ISOLATED world, which with WXT's
// single-IIFE content-script bundling forces axe onto every page (measured +0.6 MB
// on content.js), or a `scripting`-based isolated inject (a permission this
// deliberately reviewable auditor refuses). The residual — a hostile page faking
// ITS OWN audit numbers, with no privilege or cross-origin gain — is not worth
// either cost.
async function runA11y(): Promise<A11yReport> {
  // Resolve the locale once so the two failure messages this owns (a forged/empty
  // reply, and the timeout) are surfaced in the user's language. axe's OWN result
  // text is left untouched. Presentation only — the nonce/timeout logic is intact.
  const locale = await localeItem.getValue();
  const t: TFn = (key, vars) => tAt(locale, key, vars);
  return new Promise<A11yReport>((resolve, reject) => {
    const nonce = makeNonce();
    // Removed from the DOM the moment it finishes executing (`keepInDom: false`),
    // so an async MutationObserver never gets to read the nonce off its dataset.
    // `document.currentScript` is still valid during the runner's synchronous
    // top-level read, which is all it needs.
    let injected: HTMLScriptElement | null = null;

    const cleanup = (): void => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      injected?.remove();
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window) return;
      const data: unknown = event.data;
      if (!isA11yResult(data) || data.nonce !== nonce) return;
      cleanup();
      if (data.ok && data.report != null) resolve(data.report);
      else reject(new Error(data.error ?? t('errAuditFailed')));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(t('errAuditTimedOut')));
    }, AUDIT_TIMEOUT_MS);

    window.addEventListener('message', onMessage);

    void injectScript('/axe-run.js', {
      keepInDom: false,
      modifyScript(script) {
        script.dataset.blurNonce = nonce;
        injected = script;
      },
    }).catch((error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Run `work`, then reply through `sendResponse` with an `Outcome` envelope.
// Returning `true` keeps the message channel open for this async reply — the
// native `chrome.runtime.onMessage` contract. A returned Promise is ignored by
// Chrome, which is why the earlier Promise-returning listener silently dropped
// every response and left the audit dead end to end.
function replyAsync<T>(
  work: () => Promise<T>,
  sendResponse: (response: ContentResponse<T>) => void,
): true {
  work().then(
    (data) => sendResponse({ ok: true, data }),
    (error: unknown) => sendResponse({ ok: false, error: errorMessage(error) }),
  );
  return true;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    browser.runtime.onMessage.addListener(
      (
        message: ContentRequest,
        _sender,
        sendResponse: (response: ContentResponse<unknown>) => void,
      ) => {
        if (message.type === 'extractSeo') {
          return replyAsync(buildSeoReport, sendResponse);
        }
        if (message.type === 'runA11y') {
          return replyAsync(runA11y, sendResponse);
        }
        return undefined;
      },
    );
  },
});
