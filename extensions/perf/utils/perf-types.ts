import type { NetworkEntry } from '@blur/core';

// Perf-extension-local types. `@blur/core` is READ-ONLY (its NetworkEntry/PageInsight
// are the shared contract), so anything new this extension needs is defined here and
// kept structurally compatible with the core types where they overlap.

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
