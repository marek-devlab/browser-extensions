import { defineContentScript } from '#imports';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals/attribution';
import type {
  CLSMetricWithAttribution,
  FCPMetricWithAttribution,
  INPMetricWithAttribution,
  LCPMetricWithAttribution,
  TTFBMetricWithAttribution,
} from 'web-vitals/attribution';
import type { WebVital } from '@blur/core';
import { rateVital } from '@blur/core';
import { LOAF_BRIDGE_TAG, VITAL_BRIDGE_TAG, VITAL_NONCE_ATTR } from '../utils/protocol';
import { LongFrameCollector } from '../utils/long-frames';
import type { LongFrameSummary } from '../utils/perf-types';

// Web Vitals collection. MUST run at document_start in the MAIN world (PLAN.md
// §7.1): LCP/CLS/FCP replay already-fired entries via `buffered:true` from a
// BOUNDED buffer, so at the default document_idle the real LCP is unrecoverable.
//
// The MAIN world has no extension-messaging APIs, so each finalised metric is
// posted to the ISOLATED relay content script via window.postMessage, which
// forwards it to the background (see relay.content.ts).

const REGISTERED_FLAG = '__blurPerfVitalsRegistered__';

function send(vital: WebVital): void {
  // Same-window bridge to the ISOLATED relay. Read the relay's per-load nonce
  // (set on the root element before any vital can fire, well after document_start)
  // and echo it so the relay can reject posts forged by other frames. Target the
  // page origin, not '*', so cross-origin frames never receive this message.
  const nonce = document.documentElement.getAttribute(VITAL_NONCE_ATTR) ?? '';
  window.postMessage({ tag: VITAL_BRIDGE_TAG, nonce, vital }, location.origin);
}

function sendLongFrames(summary: LongFrameSummary): void {
  // Same nonce-guarded bridge as vitals — the ISOLATED relay drops posts whose
  // nonce doesn't match, so another frame can't inject fake blocking data.
  const nonce = document.documentElement.getAttribute(VITAL_NONCE_ATTR) ?? '';
  window.postMessage({ tag: LOAF_BRIDGE_TAG, nonce, summary }, location.origin);
}

function emit(
  name: WebVital['name'],
  value: number,
  unit: WebVital['unit'],
  attribution?: string,
): void {
  send({
    name,
    value,
    unit,
    rating: rateVital(name, value),
    // An empty attribution target means the element was removed from the DOM
    // after it was measured — treat it as no attribution.
    attribution: attribution ? attribution : undefined,
  });
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const w = window as unknown as Record<string, boolean | undefined>;
    // Each onX() opens a PerformanceObserver and must run at most once per load;
    // re-injection into the same MAIN world would double-observe and leak.
    if (w[REGISTERED_FLAG]) return;
    w[REGISTERED_FLAG] = true;

    // `reportAllChanges: true` is REQUIRED for a live panel, and its absence was
    // a real bug. By default web-vitals reports LCP/CLS/INP only once, at the
    // moment the value is FINAL — which the spec defines as the first user
    // interaction or the page being backgrounded/unloaded. That is right for
    // beaconing an analytics endpoint, but wrong here: a user who opens the
    // popup or the DevTools panel and simply LOOKS at a page has neither
    // interacted with it nor hidden it, so LCP — the headline metric of an
    // extension whose stated purpose is measuring Core Web Vitals — would never
    // arrive. With this flag each new candidate is emitted as it is observed.
    //
    // This does not spam state: the background keeps vitals in a
    // Map<name, WebVital> (background.ts), so a later candidate simply
    // overwrites the earlier one, and the writes are already coalesced. The
    // value still converges on exactly the same final number.
    const live = { reportAllChanges: true };

    onLCP(
      (m: LCPMetricWithAttribution) =>
        emit('LCP', m.value, 'ms', m.attribution.target),
      live,
    );
    onINP(
      (m: INPMetricWithAttribution) =>
        emit('INP', m.value, 'ms', m.attribution.interactionTarget),
      live,
    );
    onCLS(
      (m: CLSMetricWithAttribution) =>
        emit('CLS', m.value, 'score', m.attribution.largestShiftTarget),
      live,
    );
    onFCP((m: FCPMetricWithAttribution) => emit('FCP', m.value, 'ms'));
    onTTFB((m: TTFBMetricWithAttribution) => emit('TTFB', m.value, 'ms'));

    // Long Animation Frames / Long Tasks — main-thread blocking with script
    // attribution. Chromium-only; the collector reports support so the panel can
    // degrade cleanly on browsers without it. Only disconnect on a GENUINE terminal
    // unload: a bfcache eviction fires pagehide with persisted=true, and the
    // document can later be restored and reused WITHOUT re-injecting content
    // scripts — stopping there would kill the observers for the rest of the page's
    // life (bug 1i). On a persisted restore, re-start (idempotent via the
    // collector's own guard) so collection resumes if it was ever torn down.
    const loafCollector = new LongFrameCollector(sendLongFrames);
    loafCollector.start();
    window.addEventListener('pagehide', (e) => {
      if (!e.persisted) loafCollector.stop();
    });
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) loafCollector.start();
    });
  },
});
