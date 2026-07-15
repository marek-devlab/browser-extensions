import type { RequestGroup, RedirectState, WeightState, BufferState } from './assets-types';

/**
 * Resource Timing correlation. The only request source available to a content
 * script — 🔴 no `webRequest`, no `chrome.debugger`, and nothing is ever fetched
 * to enrich it (design §0 И1, §13 №5, №6).
 *
 * `resolveTransferSize` is **copied from `extensions/perf/utils/resource-timing.ts`**
 * (TODO §J: reuse, don't rewrite; the extensions are separate WXT apps and it is
 * not exported from a shared package). It is the single most important correctness
 * detail in the family (PLAN.md §8) and must stay bit-identical in both places.
 */

/**
 * 🔴 `transferSize` is 0 for cross-origin resources without `Timing-Allow-Origin` —
 * that is UNKNOWABLE, modelled as `null` and carried as null all the way to the
 * DOM ("not measured"), never collapsed into a 0. But `transferSize === 0` with a
 * non-zero `decodedBodySize` is a genuine cache hit: 0 bytes really did cross the
 * wire. Never conflate the two (design §7 №1, §5.4).
 */
export function resolveTransferSize(e: PerformanceResourceTiming): number | null {
  if (e.transferSize > 0) return e.transferSize;
  if (e.transferSize === 0 && e.decodedBodySize > 0) return 0; // served from cache
  return null; // cross-origin without Timing-Allow-Origin: unmeasurable
}

/** `resolveTransferSize` + the not-in-buffer case → the honest `WeightState`. */
export function weightOf(entry: PerformanceResourceTiming | null): WeightState {
  if (!entry) return { kind: 'not-in-buffer' };
  const bytes = resolveTransferSize(entry);
  if (bytes === null) {
    return {
      kind: 'unmeasured',
      reason: 'cross-origin without Timing-Allow-Origin — the browser hides the size of other origins from the page',
    };
  }
  if (bytes === 0) return { kind: 'cache', bytes: 0 };
  return { kind: 'measured', bytes };
}

/**
 * Normalise a URL for matching. Both sides of the comparison must go through this
 * (design §4.1): a relative `src` must match the absolute `entry.name`, and the
 * hash is not part of a request.
 */
export function normalizeUrl(url: string, base: string = location.href): string {
  try {
    const u = new URL(url, base);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

/** All buffered resource entries. Zero network — this is what the browser recorded. */
export function resourceEntries(): PerformanceResourceTiming[] {
  try {
    return performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  } catch {
    return [];
  }
}

/** The entry for exactly this URL (last one wins: a re-request is the live fact). */
export function findEntry(url: string, entries = resourceEntries()): PerformanceResourceTiming | null {
  if (!url) return null;
  const wanted = normalizeUrl(url);
  let found: PerformanceResourceTiming | null = null;
  for (const e of entries) {
    if (normalizeUrl(e.name) === wanted) found = e;
  }
  return found;
}

/**
 * Redirects, as three genuinely different facts (design §5.7, §7 №3):
 *   - `occurred` : same-origin / TAO exposed the redirect timings → a redirect
 *                  definitely happened, but the intermediate URLs are not in
 *                  Resource Timing at all (only DevTools HAR has them);
 *   - `unknown`  : cross-origin without TAO → the timings are zeroed, so we cannot
 *                  even tell whether there was one. 🔴 Never render that as "no
 *                  redirects";
 *   - `chain`    : only ever produced by the DevTools panel.
 */
export function redirectStateOf(entry: PerformanceResourceTiming | null): RedirectState {
  if (!entry) return { kind: 'unknown' };
  if (entry.redirectStart > 0 || entry.redirectEnd > 0) return { kind: 'occurred' };
  // TAO-exposed (we can see a real size or a real status) and no redirect timings
  // → there genuinely was no redirect. Otherwise we simply cannot know.
  const taoExposed = entry.transferSize > 0 || entry.decodedBodySize > 0 || responseStatusOf(entry) !== null;
  return taoExposed ? { kind: 'none' } : { kind: 'unknown' };
}

/** `responseStatus` is 0 (or absent) for cross-origin without TAO → null, never 200. */
export function responseStatusOf(entry: PerformanceResourceTiming | null): number | null {
  if (!entry) return null;
  const status = (entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus;
  if (typeof status !== 'number' || status === 0) return null;
  return status;
}

/** True when the entry belongs to another origin than the page. */
export function isCrossOrigin(url: string): boolean {
  try {
    return new URL(url, location.href).origin !== location.origin;
  } catch {
    return false;
  }
}

/** Collapse a request list by host BEFORE render — 312 segment rows help nobody,
 *  3 host groups do (design §10.3). */
export function groupByHost(entries: PerformanceResourceTiming[]): RequestGroup[] {
  const map = new Map<string, RequestGroup>();
  for (const e of entries) {
    let host: string;
    try {
      host = new URL(e.name).hostname;
    } catch {
      host = '(unparseable)';
    }
    const existing = map.get(host);
    if (existing) existing.count += 1;
    else {
      map.set(host, {
        host,
        kind: e.initiatorType || 'other',
        count: 1,
        sampleUrl: e.name,
        crossOrigin: isCrossOrigin(e.name),
      });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Requests that plausibly feed an MSE player. 🔴 A HEURISTIC by initiatorType,
 *  and the card says so: two players on one page cannot be told apart, and the
 *  manifest is listed but NEVER opened or parsed (design §2.3, §7 №7, §13 №2). */
export function mediaFeedRequests(entries = resourceEntries()): PerformanceResourceTiming[] {
  const kinds = new Set(['video', 'audio', 'media', 'xmlhttprequest', 'fetch']);
  return entries.filter((e) => kinds.has(e.initiatorType));
}

/**
 * Buffer accounting (design §10.5, §5.11). ⚠️ The spec is the opposite of the
 * naive assumption and of PLAN-2 §4.2: on overflow the browser **drops the NEW
 * entries and keeps the early ones**, then fires `resourcetimingbufferfull`. So
 * requests made *before* the inspector opened are present; it is the LATE ones on
 * a heavy page that vanish. `setResourceTimingBufferSize()` raises the cap for the
 * future — it never resurrects what was already dropped.
 */
export function bufferState(limit: number, overflowed: boolean): BufferState {
  const recorded = resourceEntries().length;
  return {
    recorded,
    limit,
    overflowed,
    nearFull: recorded >= 0.85 * limit,
  };
}

/** Raise the cap as the very first thing we do on injection (design §4.1 step 3). */
export function raiseBuffer(limit: number): void {
  try {
    performance.setResourceTimingBufferSize(limit);
  } catch {
    // Not supported / already larger — harmless, and never worth failing over.
  }
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|webm|ogv|mov|m4v)(\?|$)/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|oga|ogg|flac|wav|opus)(\?|$)/i;

/**
 * MIME guessed from the file extension. 🔴 ALWAYS labelled "by file extension" in
 * the UI — a guess presented as fact is exactly what we criticise other extensions
 * for (design §7 №4). The exact MIME exists only in the DevTools panel (HAR).
 */
export function guessMime(url: string): { value: string; certainty: 'exact' | 'guessed-extension' | 'unknown' } {
  if (url.startsWith('data:')) {
    const head = url.slice(5, url.indexOf(',') === -1 ? 64 : url.indexOf(','));
    const value = head.split(';')[0] || 'unknown';
    // A data: URI states its own type — that IS the fact, not a guess.
    return { value, certainty: 'exact' };
  }
  let path: string;
  try {
    path = new URL(url, location.href).pathname;
  } catch {
    return { value: '—', certainty: 'unknown' };
  }
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (!ext) return { value: '—', certainty: 'unknown' };
  const table: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
    bmp: 'image/bmp', mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
    mov: 'video/quicktime', m4v: 'video/x-m4v', mp3: 'audio/mpeg', m4a: 'audio/mp4',
    aac: 'audio/aac', oga: 'audio/ogg', ogg: 'audio/ogg', flac: 'audio/flac',
    wav: 'audio/wav', opus: 'audio/opus',
  };
  const value = table[ext];
  if (!value) return { value: `.${ext}`, certainty: 'unknown' };
  return { value, certainty: 'guessed-extension' };
}

/** Coarse kind of a URL by extension — only used to label a request row. */
export function looksLike(url: string): 'image' | 'video' | 'audio' | 'other' {
  if (IMAGE_EXT.test(url)) return 'image';
  if (VIDEO_EXT.test(url)) return 'video';
  if (AUDIO_EXT.test(url)) return 'audio';
  return 'other';
}
