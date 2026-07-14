import type {
  ResourceCardModel,
  RequestGroup,
  RedirectStep,
} from './assets-types';
import { analyzeSrcset, parseSrcset } from './srcset';

// Realistic mock resources for the scaffold phase (MOCK rules, PLAN.md §15). Every
// object below is FABRICATED — each card that renders one shows a <MockBadge>, and
// the real reader (utils/inspect.ts → readResourceMetadata) throws todoLogic until
// wired. These exist so the full card layout, the honest-limitation ladder, the
// srcset table, the MSE/DRM card and the DevTools panel can be built and reviewed
// against representative data (design §2–§7).
//
// 🔴 Note what is NOT here: no download URL builder, no m3u8/mpd parse output, no
// byte-sum-of-a-stream, no bulk URL list. Mocking those would scaffold the exact
// features the product must never have (design §13).

const IMAGE_SRCSET =
  'https://cdn.example.com/img/hero-480.avif 480w, ' +
  'https://cdn.example.com/img/hero-960.avif 960w, ' +
  'https://cdn.example.com/img/hero-1440.avif 1440w, ' +
  'https://cdn.example.com/img/hero-2400.avif 2400w';

/** The signature srcset image card (design §2.2). currentSrc = the FACT. */
export function mockImageResource(): ResourceCardModel {
  const currentSrc = 'https://cdn.example.com/img/hero-1440.avif?v=8f21c';
  const candidates = parseSrcset(IMAGE_SRCSET);
  const srcset = analyzeSrcset(candidates, /* slot */ 720, /* dpr */ 1.5, currentSrc, '(min-width: 900px) 50vw, 100vw');
  return {
    kind: 'image',
    variant: 'image',
    elementLabel: '<img class="hero">',
    currentSrc,
    urlOpenable: true,
    mime: { value: 'image/avif', certainty: 'guessed-extension' },
    naturalSize: { w: 1440, h: 960 },
    displayedSize: { w: 480, h: 320, dpr: 1.5 },
    overweight: { ratio: 2.0, naturalWidth: 1440, neededWidth: 720, displayedWidth: 480, severity: 'warn' },
    srcset,
    attributes: { loading: 'lazy', decoding: 'async', fetchpriority: '—' },
    alt: 'Mountain panorama',
    weight: { kind: 'unmeasured', reason: 'cross-origin without Timing-Allow-Origin' },
    initiator: { type: 'img', scriptKnown: false },
    requests: [
      { host: 'cdn.example.com', kind: 'img', count: 1, sampleUrl: currentSrc, crossOrigin: true },
    ],
    requestsHeuristic: false,
    redirects: { kind: 'unknown' },
    mock: true,
  };
}

/** The MSE/DRM honest card — YouTube-style player (design §2.3). */
export function mockMseResource(): ResourceCardModel {
  return {
    kind: 'video',
    variant: 'mse',
    elementLabel: '<video> inside #shadow-root ytd-player',
    currentSrc: 'blob:https://www.youtube.com/6c4e0b6a-4b2e-4f0a-9d3a-2b1c8e5f7a90',
    urlOpenable: false,
    openDisabledReason: 'blob: points at in-memory buffers — there is nothing to open',
    mime: { value: 'video (MSE stream)', certainty: 'unknown' },
    weight: { kind: 'not-in-buffer' },
    initiator: { type: 'media', scriptKnown: false },
    requestsHeuristic: true,
    requests: [
      { host: 'rr3---sn-4g5e6nz7.googlevideo.com', kind: 'media', count: 287, sampleUrl: 'https://rr3---sn-4g5e6nz7.googlevideo.com/videoplayback?expire=…&itag=248', crossOrigin: true },
      { host: 'manifest.googlevideo.com', kind: 'fetch', count: 2, sampleUrl: 'https://manifest.googlevideo.com/api/manifest/dash/…', crossOrigin: true },
      { host: 'www.youtube.com', kind: 'fetch', count: 4, sampleUrl: 'https://www.youtube.com/api/…/license', crossOrigin: false },
    ],
    redirects: { kind: 'unknown' },
    mse: {
      blobUrl: 'blob:https://www.youtube.com/6c4e0b6a-…',
      mechanism: 'MSE',
      resolution: { w: 1920, h: 1080 },
      frames: { rendered: 4812, dropped: 3 },
      drmActive: true,
    },
    mock: true,
  };
}

/** Cross-origin iframe — the "honest failure" screen (design §4.8). */
export function mockIframeResource(): ResourceCardModel {
  return {
    kind: 'iframe',
    variant: 'iframe-cross-origin',
    elementLabel: '<iframe> · different origin',
    currentSrc: 'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0',
    urlOpenable: true,
    mime: { value: 'text/html', certainty: 'unknown' },
    weight: { kind: 'not-in-buffer' },
    initiator: { type: 'iframe', scriptKnown: false },
    requests: [],
    requestsHeuristic: false,
    redirects: { kind: 'unknown' },
    iframe: {
      src: 'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0',
      size: { w: 560, h: 315 },
      attributes: { allow: 'autoplay; encrypted-media', loading: 'lazy', sandbox: '—' },
    },
    mock: true,
  };
}

/** A CSS-drawn element with no loaded resource (design §5.2). */
export function mockNoResource(): ResourceCardModel {
  return {
    kind: 'none',
    variant: 'no-resource',
    elementLabel: '<div class="banner">',
    currentSrc: '',
    urlOpenable: false,
    openDisabledReason: 'no resource URL',
    mime: { value: '—', certainty: 'unknown' },
    weight: { kind: 'not-in-buffer' },
    initiator: { type: '—', scriptKnown: false },
    requests: [],
    requestsHeuristic: false,
    redirects: { kind: 'unknown' },
    cssRule: 'background: linear-gradient(135deg, #4f46e5, #06b6d4)',
    mock: true,
  };
}

/** A data: URI element (design §5.9). Inline bytes — no request was ever made. */
export function mockDataUriResource(): ResourceCardModel {
  return {
    kind: 'image',
    variant: 'data',
    elementLabel: '<img class="icon">',
    currentSrc: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcv…',
    urlOpenable: false,
    openDisabledReason: 'Chrome blocks top-level navigation to data: URIs',
    mime: { value: 'image/svg+xml', certainty: 'exact' },
    weight: { kind: 'not-in-buffer' },
    initiator: { type: '—', scriptKnown: false },
    requests: [],
    requestsHeuristic: false,
    redirects: { kind: 'unknown' },
    dataUri: { prefix: 'data:image/svg+xml;base64,', length: 4208, head: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmci…' },
    mock: true,
  };
}

/** A resource that failed to load (design §5.10). Cause unknown cross-origin. */
export function mockFailedResource(): ResourceCardModel {
  return {
    kind: 'image',
    variant: 'failed',
    elementLabel: '<img class="thumb">',
    currentSrc: 'https://cdn.other.example/thumb/9a8b.jpg',
    urlOpenable: true,
    mime: { value: 'image/jpeg', certainty: 'guessed-extension' },
    weight: { kind: 'not-in-buffer' },
    initiator: { type: 'img', scriptKnown: false },
    requests: [],
    requestsHeuristic: false,
    redirects: { kind: 'unknown' },
    mock: true,
  };
}

/** Every mock resource, labelled — a reviewable gallery of the honest states used
 *  by the DevTools panel scaffold (design §5, §7). All carry mock:true. */
export const MOCK_SCENARIOS: { id: string; label: string; build: () => ResourceCardModel }[] = [
  { id: 'image', label: 'Image · srcset', build: mockImageResource },
  { id: 'mse', label: 'MSE / DRM player', build: mockMseResource },
  { id: 'iframe', label: 'Cross-origin iframe', build: mockIframeResource },
  { id: 'none', label: 'No resource (CSS)', build: mockNoResource },
  { id: 'data', label: 'data: URI', build: mockDataUriResource },
  { id: 'failed', label: 'Failed load (404/CORS)', build: mockFailedResource },
];

/** Full mock redirect chain — only ever available in the DevTools panel (§2.5). */
export function mockRedirectChain(): RedirectStep[] {
  return [
    { status: 301, url: 'https://example.com/img/hero.jpg', note: 'Location: //cdn.example.com/img/hero.jpg' },
    { status: 302, url: 'https://cdn.example.com/img/hero.jpg', note: 'content negotiation → AVIF' },
    { status: 200, url: 'https://cdn.example.com/img/hero-1440.avif?v=8f21c' },
  ];
}

/** Mock HAR initiator stack — exists only in DevTools (design §2.5, §7 №2). */
export function mockInitiatorStack(): { location: string; note?: string }[] {
  return [
    { location: 'lazyload.min.js:214:17', note: 'real initiator' },
    { location: 'app.bundle.js:8801:3', note: 'called from' },
    { location: 'app.bundle.js:12:1', note: 'module evaluation' },
  ];
}

/** Mock rows for the popup's "what is visible on this page" counters (§2.6). */
export interface PageCounters {
  requestsRecorded: number;
  images: number;
  media: number;
  bufferLimit: number;
}
export function mockPageCounters(): PageCounters {
  return { requestsRecorded: 214, images: 58, media: 3, bufferLimit: 250 };
}

/** Mock rows for the v2 "all resources" origin table (design §2.7). */
export interface AllResourcesRow {
  resource: string;
  kind: string;
  initiator: string;
  /** How to locate it on the page. `null` = loaded but element not found. */
  location: { label: string; count: number } | null;
}
export function mockAllResources(): AllResourcesRow[] {
  return [
    { resource: 'hero-1440.avif', kind: 'img', initiator: 'img', location: { label: 'Show element', count: 1 } },
    { resource: 'logo.svg', kind: 'img', initiator: 'css', location: null },
    { resource: 'sprite@2x.png', kind: 'img', initiator: 'css', location: { label: 'Show', count: 12 } },
    { resource: 'avatar-8f2.jpg', kind: 'img', initiator: 'script', location: { label: 'Show element', count: 1 } },
  ];
}

/** Group a flat request list by host (design §10.3). Real helper, used by mocks. */
export function groupByHost(
  reqs: { url: string; kind: string; crossOrigin: boolean }[],
): RequestGroup[] {
  const map = new Map<string, RequestGroup>();
  for (const r of reqs) {
    let host = '';
    try {
      host = new URL(r.url).hostname;
    } catch {
      host = '(unparseable)';
    }
    const existing = map.get(host);
    if (existing) existing.count += 1;
    else map.set(host, { host, kind: r.kind, count: 1, sampleUrl: r.url, crossOrigin: r.crossOrigin });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
