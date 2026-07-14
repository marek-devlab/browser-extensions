import type { NetworkEntry, PageInsight, ResourceKind } from '@blur/core';
import type { TimedNetworkEntry } from './perf-types';
import { getRegistrableDomain, isThirdParty } from './registrable-domain';

const EMPTY_BY_KIND: Record<ResourceKind, number> = {
  document: 0,
  script: 0,
  stylesheet: 0,
  image: 0,
  font: 0,
  xhr: 0,
  media: 0,
  other: 0,
};

const FONT_EXT = /\.(woff2?|ttf|otf|eot)(\?|$)/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)(\?|$)/i;
const CSS_EXT = /\.css(\?|$)/i;

/** `PerformanceResourceTiming.initiatorType` → our coarse `ResourceKind`. */
export function mapInitiatorType(initiatorType: string, url: string): ResourceKind {
  switch (initiatorType) {
    case 'navigation':
      return 'document';
    case 'script':
      return 'script';
    case 'img':
    case 'image':
    case 'imageset':
      return 'image';
    case 'video':
    case 'audio':
      return 'media';
    case 'xmlhttprequest':
    case 'fetch':
    case 'beacon':
      return 'xhr';
    case 'link':
    case 'css':
      // `link`/`css` cover stylesheets, fonts and CSS-referenced images. The
      // initiator alone is ambiguous, so disambiguate by extension.
      if (FONT_EXT.test(url)) return 'font';
      if (IMAGE_EXT.test(url)) return 'image';
      if (CSS_EXT.test(url)) return 'stylesheet';
      return initiatorType === 'css' ? 'image' : 'stylesheet';
    default:
      if (FONT_EXT.test(url)) return 'font';
      if (IMAGE_EXT.test(url)) return 'image';
      return 'other';
  }
}

/**
 * The single most important correctness detail (PLAN.md §8). `transferSize`,
 * `encodedBodySize` and `decodedBodySize` are all 0 for cross-origin resources
 * without a `Timing-Allow-Origin` header — that is UNKNOWABLE, modelled as
 * `null`. But `transferSize === 0` with a non-zero `decodedBodySize` is a genuine
 * cache hit: 0 bytes really did cross the wire. Never conflate the two.
 */
export function resolveTransferSize(e: PerformanceResourceTiming): number | null {
  if (e.transferSize > 0) return e.transferSize;
  if (e.transferSize === 0 && e.decodedBodySize > 0) return 0; // served from cache
  return null; // cross-origin without Timing-Allow-Origin: unmeasurable
}

export function toNetworkEntry(
  e: PerformanceResourceTiming,
  pageHostname: string,
): TimedNetworkEntry {
  return {
    url: e.name,
    kind: mapInitiatorType(e.initiatorType, e.name),
    duration: e.duration,
    // Offset on the performance timeline (navigation start = 0), for the waterfall.
    startTime: e.startTime,
    transferSize: resolveTransferSize(e),
    thirdParty: isThirdParty(e.name, pageHostname),
    // Resource Timing cannot see requests the browser never issued, so a blocked
    // request simply never appears here — it is never reported as blocked.
    blocked: false,
  };
}

export function buildInsight(
  entries: NetworkEntry[],
  hostname: string,
): PageInsight {
  const byKind: Record<ResourceKind, number> = { ...EMPTY_BY_KIND };
  const thirdPartyDomains = new Set<string>();
  let measuredBytes = 0;
  let unmeasuredRequests = 0;

  for (const entry of entries) {
    byKind[entry.kind] += 1;
    if (entry.transferSize === null) unmeasuredRequests += 1;
    else measuredBytes += entry.transferSize;
    if (entry.thirdParty) {
      try {
        thirdPartyDomains.add(getRegistrableDomain(new URL(entry.url).hostname));
      } catch {
        // Unparseable URL — skip from the domain roll-up only.
      }
    }
  }

  return {
    hostname,
    requestCount: entries.length,
    measuredBytes,
    unmeasuredRequests,
    byteSource: 'resource-timing',
    thirdPartyDomains: [...thirdPartyDomains].sort(),
    byKind,
  };
}

/**
 * Collects the buffered Resource Timing entries plus a live observer. Emits a
 * fresh `{ insight, entries }` (debounced) whenever new resources arrive.
 */
export class ResourceTimingCollector {
  private readonly seen = new Set<string>();
  private readonly entries: TimedNetworkEntry[] = [];
  private observer: PerformanceObserver | null = null;
  private flushHandle: ReturnType<typeof setTimeout> | null = null;
  /** Guards against a second observer when start() is called again (bfcache restore). */
  private started = false;

  constructor(
    private readonly hostname: string,
    private readonly onUpdate: (insight: PageInsight, entries: TimedNetworkEntry[]) => void,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    const nav = performance.getEntriesByType('navigation');
    this.ingest(nav as PerformanceResourceTiming[]);
    this.ingest(performance.getEntriesByType('resource') as PerformanceResourceTiming[]);

    this.observer = new PerformanceObserver((list) => {
      this.ingest(list.getEntries() as PerformanceResourceTiming[]);
    });
    // buffered:true replays entries dispatched before observe() — deduped below.
    this.observer.observe({ type: 'resource', buffered: true });
    this.scheduleFlush();
  }

  stop(): void {
    this.started = false;
    this.observer?.disconnect();
    this.observer = null;
  }

  private ingest(list: PerformanceResourceTiming[]): void {
    let added = false;
    for (const e of list) {
      const key = `${e.entryType}|${e.name}|${e.startTime}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.entries.push(toNetworkEntry(e, this.hostname));
      added = true;
    }
    if (added) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushHandle !== null) return;
    this.flushHandle = globalThis.setTimeout(() => {
      this.flushHandle = null;
      this.onUpdate(buildInsight(this.entries, this.hostname), [...this.entries]);
    }, 200);
  }
}
