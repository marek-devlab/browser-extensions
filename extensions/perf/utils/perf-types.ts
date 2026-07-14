import type { NetworkEntry, WebVital } from '@blur/core';

// Perf-extension-local types. `@blur/core` is READ-ONLY (its NetworkEntry/PageInsight
// are the shared contract), so anything new this extension needs is defined here and
// kept structurally compatible with the core types where they overlap.

/* ------------------------------------------------------------------ */
/* Vitals attribution                                                  */
/* ------------------------------------------------------------------ */

/**
 * The sub-part breakdown the `web-vitals/attribution` build already computes and
 * which we were throwing away — only the bare `attribution` selector string
 * reached `WebVital`. A score alone ("CLS 0.130 — needs improvement") is not
 * actionable; the breakdown says WHICH PHASE (or which element) is at fault, so
 * the UI can name a fix instead of a grade.
 *
 * Every field is exactly what the browser measured. Nothing here is modelled,
 * extrapolated or estimated: a metric the browser never reported is simply absent
 * (`undefined`), never 0.
 *
 * `WebVital` in `@blur/core` is the cross-extension contract and stays untouched;
 * `PerfWebVital` is the structurally-compatible superset this extension puts on
 * the wire. Anything typed `WebVital` (the panel, the exporters, PSI) keeps
 * working unchanged.
 */
export interface VitalDetail {
  /** LCP phases; they sum to the LCP value. The largest one is the thing to fix. */
  lcp?: {
    /** Server response time — the floor under LCP. */
    ttfb: number;
    /** Time from TTFB until the LCP resource STARTED loading (discovery delay). */
    resourceLoadDelay: number;
    /** How long the LCP resource itself took to download. */
    resourceLoadDuration: number;
    /** Time from the resource being available until it was actually painted. */
    elementRenderDelay: number;
    /** URL of the LCP resource, when the LCP element loaded one (images). */
    url?: string;
  };
  /** CLS: the single worst shift in the session window, which dominates the score. */
  cls?: {
    /** Layout-shift score of the largest single shift (not the whole CLS). */
    largestShiftValue: number;
    /** ms from navigation start when that shift happened. */
    largestShiftTime?: number;
    /** 'loading' | 'dom-interactive' | … — when in the load it happened. */
    loadState?: string;
  };
  /** INP: which part of the interaction was slow. */
  inp?: {
    interactionType: 'pointer' | 'keyboard';
    /** Waiting for the main thread before the handler could run. */
    inputDelay: number;
    /** The event handlers themselves. */
    processingDuration: number;
    /** Handler done → next frame on screen. */
    presentationDelay: number;
  };
  /** TTFB phases; they sum to the TTFB value. */
  ttfb?: {
    /** Redirects, service-worker startup, queueing — everything before DNS. */
    waitingDuration: number;
    dnsDuration: number;
    /** TCP + TLS. */
    connectionDuration: number;
    /** Request sent → first byte back. Server think-time lives here. */
    requestDuration: number;
  };
  /** FCP = TTFB + render-blocking time. */
  fcp?: {
    ttfb: number;
    /** First byte → first paint: render-blocking CSS/JS lives in here. */
    firstByteToFCP: number;
  };
}

/**
 * A `WebVital` plus the attribution detail above. A superset, so it is assignable
 * to `WebVital` everywhere the shared contract is expected.
 */
export interface PerfWebVital extends WebVital {
  detail?: VitalDetail;
}

/* ------------------------------------------------------------------ */
/* Navigation timing                                                   */
/* ------------------------------------------------------------------ */

/**
 * Navigation Timing phases for the document itself, in ms. `null` means the
 * browser did not report it — NOT zero. The distinction matters twice here:
 *
 *  - `loadEventEnd` is 0 until the load event has finished, so a page still
 *    loading reports `load: null`, never "0 ms".
 *  - After a CROSS-ORIGIN redirect the browser zeroes every phase before
 *    `responseStart` (it would otherwise leak timing about the other origin).
 *    That is unknowable, not instant, so `redirectMasked` is set and the phases
 *    are `null`.
 *
 * A genuine 0 (DNS reused from cache, connection reused) is reported as 0.
 */
export interface PageTiming {
  redirectCount: number;
  /** Pre-response phases hidden by a cross-origin redirect — see above. */
  redirectMasked: boolean;
  dns: number | null;
  /** TCP connect (includes the TLS handshake below). */
  tcp: number | null;
  tls: number | null;
  /** Request sent → first byte. */
  request: number | null;
  /** First byte → last byte of the document. */
  response: number | null;
  /** ms from navigation start to DOMContentLoaded finishing. */
  domContentLoaded: number | null;
  /** ms from navigation start to the load event finishing. */
  load: number | null;
}

/** Read the phases off the document's own navigation entry, honestly. */
export function toPageTiming(e: PerformanceNavigationTiming): PageTiming {
  // A cross-origin redirect zeroes everything before responseStart. The tell is a
  // redirect having happened while the request phase reports no time at all —
  // a same-origin redirect leaves these populated.
  const redirectMasked = e.redirectCount > 0 && e.requestStart === 0;
  const phase = (a: number, b: number): number | null =>
    redirectMasked || a === 0 || b === 0 ? null : Math.max(0, b - a);

  return {
    redirectCount: e.redirectCount,
    redirectMasked,
    // domainLookupStart === domainLookupEnd is a legitimate 0 (DNS already known),
    // so DNS/TCP are computed even when the delta is zero — only a mask nulls them.
    dns: redirectMasked ? null : Math.max(0, e.domainLookupEnd - e.domainLookupStart),
    tcp: redirectMasked ? null : Math.max(0, e.connectEnd - e.connectStart),
    // secureConnectionStart is 0 on a plain-HTTP connection: no TLS, not "0 ms of TLS".
    tls:
      redirectMasked || e.secureConnectionStart === 0
        ? null
        : Math.max(0, e.connectEnd - e.secureConnectionStart),
    request: phase(e.requestStart, e.responseStart),
    response: phase(e.responseStart, e.responseEnd),
    // These are offsets from navigation start, and are 0 until the event fires.
    domContentLoaded: e.domContentLoadedEventEnd > 0 ? e.domContentLoadedEventEnd : null,
    load: e.loadEventEnd > 0 ? e.loadEventEnd : null,
  };
}

/**
 * A NetworkEntry plus the resource's start offset on the performance timeline, so
 * the panel can draw a waterfall. `startTime` is ms from navigation start. It is 0
 * when the source (e.g. a DevTools HAR entry from before capture began) can't place
 * the request on the timeline — the waterfall degrades to duration-only bars then.
 */
export interface TimedNetworkEntry extends NetworkEntry {
  startTime: number;
}

/** One script's contribution to a long frame / long task (LoAF attribution). */
export interface ScriptAttribution {
  sourceURL: string;
  sourceFunctionName: string;
  duration: number;
  /** ms this script spent in forced synchronous style/layout ("layout thrashing"). */
  forcedStyleAndLayoutDuration: number;
}

export interface LongFrameEntry {
  /** `loaf` = Long Animation Frame (Chrome 123+); `longtask` = the older Long Tasks API. */
  kind: 'loaf' | 'longtask';
  /** ms from navigation start. */
  startTime: number;
  /** Total frame/task duration in ms. */
  duration: number;
  /**
   * ms the main thread was blocked. For LoAF this is the real `blockingDuration`;
   * for a Long Task it is the portion over the 50ms threshold (duration - 50).
   */
  blockingDuration: number;
  scripts: ScriptAttribution[];
}

/**
 * Main-thread blocking summary. Chromium-only: `loafSupported`/`longTaskSupported`
 * report what the browser actually offers so the panel can degrade cleanly (say
 * "not available in this browser") rather than imply zero blocking.
 */
export interface LongFrameSummary {
  loafSupported: boolean;
  longTaskSupported: boolean;
  /** Sum of `blockingDuration` across `frames`. */
  totalBlockingDuration: number;
  frames: LongFrameEntry[];
}

export function emptyLongFrameSummary(): LongFrameSummary {
  return {
    loafSupported: false,
    longTaskSupported: false,
    totalBlockingDuration: 0,
    frames: [],
  };
}

/** One CrUX field metric (real-user p75 over the trailing 28-day window). */
export interface CruxFieldMetric {
  name: 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB';
  /** p75 value: ms for timing metrics, unitless score for CLS. */
  p75: number;
  unit: 'ms' | 'score';
  /** CrUX's own bucket for the p75, mapped to our rating vocabulary. */
  rating: 'good' | 'needs-improvement' | 'poor';
}

/** CrUX field data for the exact URL and for the whole origin. */
export interface CruxField {
  /** Page-level (URL) field data; empty when CrUX has no page-level sample. */
  url: CruxFieldMetric[];
  /** Origin-level field data; empty when absent. */
  origin: CruxFieldMetric[];
}
