import type { Entry } from 'har-format';
import type { NetworkEntry, PageInsight, ResourceKind } from '@blur/core';
import type { TimedNetworkEntry } from './perf-types';
import { buildInsight } from './resource-timing';
import { isThirdParty } from './registrable-domain';

// DevTools network capture (PLAN.md §8). `onRequestFinished` and `getHAR()`
// deliver HAR entries; read real bytes from `response._transferSize` (Chrome),
// falling back to `response.bodySize`. This only sees traffic while DevTools is
// open, and requests made before the panel opened may be missing — the UI says
// so and byteSource is `devtools-har`.

const HAR_KIND: Record<string, ResourceKind> = {
  document: 'document',
  script: 'script',
  stylesheet: 'stylesheet',
  image: 'image',
  media: 'media',
  font: 'font',
  xhr: 'xhr',
  fetch: 'xhr',
};

function harKind(entry: Entry): ResourceKind {
  const rt = entry._resourceType;
  if (rt && HAR_KIND[rt]) return HAR_KIND[rt];
  const mime = entry.response.content.mimeType ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('font/') || mime.includes('font')) return 'font';
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'media';
  if (mime.includes('javascript')) return 'script';
  if (mime.includes('css')) return 'stylesheet';
  if (mime.includes('html')) return 'document';
  return 'other';
}

/**
 * Real transferred bytes for a HAR entry, or null when genuinely unknown.
 * `_transferSize` is Chrome's authoritative wire size. A value of -1 (or a
 * missing field with bodySize -1) means "not available" → null, never 0.
 */
function harTransferSize(entry: Entry): number | null {
  const t = entry.response._transferSize;
  if (typeof t === 'number' && t >= 0) return t;
  if (t === null) return null;
  const body = entry.response.bodySize;
  if (typeof body === 'number' && body >= 0) return body;
  return null;
}

/**
 * True when this entry's size came from the `bodySize` fallback rather than the
 * authoritative `_transferSize` (the Firefox case). `bodySize` is the uncompressed
 * body and excludes headers, so any total including it is approximate, not exact —
 * the UI must say so rather than present it as measured wire bytes.
 */
export function harEntryUsesApproximateSize(entry: Entry): boolean {
  const t = entry.response._transferSize;
  if (typeof t === 'number' && t >= 0) return false;
  if (t === null) return false;
  const body = entry.response.bodySize;
  return typeof body === 'number' && body >= 0;
}

export function harEntryToNetworkEntry(
  entry: Entry,
  pageHostname: string,
): TimedNetworkEntry {
  const url = entry.request.url;
  // Absolute wall-clock start (epoch ms). The panel normalises by subtracting the
  // minimum across the shown set, so the waterfall shows offsets regardless of the
  // source's zero point. NaN (bad/missing timestamp) degrades to 0.
  const started = Date.parse(entry.startedDateTime);
  return {
    url,
    kind: harKind(entry),
    duration: entry.time,
    startTime: Number.isFinite(started) ? started : 0,
    transferSize: harTransferSize(entry),
    thirdParty: isThirdParty(url, pageHostname),
    blocked: false,
  };
}

export function buildHarInsight(
  entries: NetworkEntry[],
  hostname: string,
): PageInsight {
  return { ...buildInsight(entries, hostname), byteSource: 'devtools-har' };
}
