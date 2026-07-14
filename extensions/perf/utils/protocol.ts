import type { NetworkEntry, PageInsight, WebVital } from '@blur/core';
import type { LongFrameSummary, TimedNetworkEntry } from './perf-types';

// One responder per message type (PLAN.md §13). Split into what the relay content
// script pushes and what the popup/panel query — the union is what background
// listens for. The PerfProtocol interface in @blur/core is the documentary
// contract; the wire messages are richer so byte measurement can report failure.

export type RelayMessage =
  | { type: 'perf:navigated' }
  | { type: 'perf:vital'; vital: WebVital }
  | { type: 'perf:insight'; insight: PageInsight; entries: TimedNetworkEntry[] }
  | { type: 'perf:longframes'; summary: LongFrameSummary };

export type QueryMessage =
  | { type: 'getWebVitals'; tabId: number }
  | { type: 'getPageInsight'; tabId: number }
  | { type: 'getNetworkEntries'; tabId: number }
  | { type: 'getLongFrames'; tabId: number }
  | { type: 'measureExactBytes'; tabId: number };

export type PerfMessage = RelayMessage | QueryMessage;

/**
 * How a byte total was obtained. The UI reads this to word caveats honestly —
 * never presenting DevTools HAR bytes as CDP, or CDP as Resource Timing. There is
 * deliberately no Firefox `webRequest` member: `webRequest.onCompleted` exposes no
 * response-size field (verified against MDN), so Firefox has no banner-free exact
 * path and falls back to Resource Timing.
 */
export type ByteMechanism = 'resource-timing' | 'devtools-har' | 'cdp-debugger';

/** Result of an opt-in exact-byte measurement. Carries success or a reason. The
 * per-request `entries` ride along so the popup can break bytes down by type and
 * by third-party domain, not just show the roll-up totals. */
export type MeasureResult =
  | { ok: true; insight: PageInsight; entries: NetworkEntry[]; mechanism: ByteMechanism }
  | { ok: false; error: string };

/** MAIN-world → ISOLATED-world bridge for vitals (MAIN cannot use runtime APIs). */
export const VITAL_BRIDGE_TAG = '__blur_perf_vital__' as const;

/** DOM attribute the ISOLATED relay uses to hand its per-load nonce to MAIN. */
export const VITAL_NONCE_ATTR = 'data-blur-perf-nonce' as const;

export interface VitalBridgeMessage {
  tag: typeof VITAL_BRIDGE_TAG;
  /**
   * Per-load nonce minted by the relay; MAIN echoes it so the relay can reject
   * forged posts from other frames. NOTE the residual risk: MAIN shares its JS
   * context with the page, so a determined same-page script can still read the
   * nonce from the DOM. This raises the bar against cross-frame forgery; it does
   * not make same-page vitals unforgeable (that is impossible without core changes
   * to move vitals collection out of the MAIN world).
   */
  nonce: string;
  vital: WebVital;
}

export function isVitalBridgeMessage(data: unknown): data is VitalBridgeMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { tag?: unknown; nonce?: unknown };
  return d.tag === VITAL_BRIDGE_TAG && typeof d.nonce === 'string';
}

/** MAIN→ISOLATED bridge tag for the Long Animation Frame / Long Task summary. */
export const LOAF_BRIDGE_TAG = '__blur_perf_loaf__' as const;

export interface LongFrameBridgeMessage {
  tag: typeof LOAF_BRIDGE_TAG;
  /** Same per-load nonce as the vitals bridge; forged cross-frame posts are dropped. */
  nonce: string;
  summary: LongFrameSummary;
}

export function isLongFrameBridgeMessage(data: unknown): data is LongFrameBridgeMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { tag?: unknown; nonce?: unknown };
  return d.tag === LOAF_BRIDGE_TAG && typeof d.nonce === 'string';
}
