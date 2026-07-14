import { defineContentScript, browser } from '#imports';
import type { PageInsight } from '@blur/core';
import { ResourceTimingCollector } from '../utils/resource-timing';
import {
  isLongFrameBridgeMessage,
  isVitalBridgeMessage,
  VITAL_NONCE_ATTR,
} from '../utils/protocol';
import type { PerfMessage } from '../utils/protocol';
import type { TimedNetworkEntry } from '../utils/perf-types';

// ISOLATED-world companion to content.ts. It has both the per-Document
// Performance Timeline and extension messaging, so it does two jobs:
//   1. Collect Resource Timing and push { insight, entries } to the background.
//   2. Relay Web Vitals that the MAIN-world script posts via window.postMessage.
// Runs at document_start so the postMessage listener is installed before any
// vital fires.

function post(message: PerfMessage): void {
  // The background may be asleep; a dropped report is re-sent on the next update.
  void browser.runtime.sendMessage(message).catch(() => undefined);
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'ISOLATED',
  main() {
    // A fresh document — tell the background to drop the previous page's cached
    // vitals for this tab before new ones arrive.
    post({ type: 'perf:navigated' });

    // Mint a per-load nonce and hand it to the MAIN-world vitals script via a root
    // attribute. MAIN echoes it back; posts without it (e.g. forged by another
    // frame) are dropped. See VitalBridgeMessage for the residual same-page risk.
    const nonce = crypto.randomUUID();
    document.documentElement.setAttribute(VITAL_NONCE_ATTR, nonce);

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.origin !== location.origin) return;
      const data: unknown = event.data;
      if (isVitalBridgeMessage(data)) {
        if (data.nonce !== nonce) return;
        post({ type: 'perf:vital', vital: data.vital });
      } else if (isLongFrameBridgeMessage(data)) {
        if (data.nonce !== nonce) return;
        post({ type: 'perf:longframes', summary: data.summary });
      }
    });

    const hostname = location.hostname;
    const collector = new ResourceTimingCollector(
      hostname,
      (insight: PageInsight, entries: TimedNetworkEntry[]) => {
        post({ type: 'perf:insight', insight, entries });
      },
    );
    collector.start();

    // Only tear down the Resource-Timing observer on a genuine terminal unload. A
    // bfcache eviction fires pagehide with persisted=true and the document may be
    // restored and reused without re-injecting this script; stopping there would
    // leave Resource Timing dead after a back/forward restore (bug 1i). Re-start on
    // a persisted restore (idempotent via the collector's guard).
    window.addEventListener('pagehide', (e) => {
      if (!e.persisted) collector.stop();
    });
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) collector.start();
    });
  },
});
