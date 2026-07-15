import type {
  ResourceCardModel,
  MimeInfo,
  BufferState,
  LoadFailure,
  RequestGroup,
} from './assets-types';
import { computeSelector, elementLabel } from './element-picker';
import {
  findEntry,
  guessMime,
  groupByHost,
  isCrossOrigin,
  mediaFeedRequests,
  normalizeUrl,
  redirectStateOf,
  resourceEntries,
  responseStatusOf,
  weightOf,
} from './resource-timing';
import { analyzePictureSources, analyzeSrcset, parseSrcset, resolveSlotWidth } from './srcset';
import type { OverweightThreshold, RequestScope } from './storage';
import type { TFn } from './i18n';

/**
 * 🔴 THE READER. Everything the card shows comes from here, and it makes ZERO
 * network requests — that is the invariant the whole product category rests on
 * (design §0 И1). It reads:
 *
 *   - the DOM the browser already resolved: `currentSrc` (the FACT of what was
 *     loaded), `srcset` / `sizes` / `naturalWidth` / `getBoundingClientRect()` /
 *     `devicePixelRatio` / `loading` / `decoding` / `fetchpriority` / `alt` /
 *     `getComputedStyle()`;
 *   - `performance.getEntriesByType('resource')`, matched to that URL by
 *     NORMALISED URL, for initiatorType, transfer size (null-preserving) and status.
 *
 * It never calls `fetch`, never assigns an `img.src`, never sends a HEAD request to
 * learn a MIME type, and never opens a manifest. "Is this resource alive?" is
 * answered from the DOM (`complete && naturalWidth === 0`), which is free, works
 * cross-origin, and costs zero requests.
 */

export interface InspectOptions {
  overweightThreshold: OverweightThreshold;
  buffer: BufferState;
  /** `related` = only the request matched to this element; `all` = the whole
   *  Resource Timing buffer, grouped by host (design §2.8/§3). */
  requestScope: RequestScope;
  /** Our closed shadow root — where the hidden `sizes` measuring probe lives. */
  measureIn: ShadowRoot | Element;
  /** Locale-bound translator. The card is rebuilt on every pick, so the model's own
   *  prose (failure messages, "open disabled" reasons, MSE MIME labels…) is produced
   *  already-localized. Optional so the reader stays usable without i18n wired. */
  t?: TFn;
}

export function readResourceMetadata(el: Element, o: InspectOptions): ResourceCardModel {
  if (el instanceof HTMLImageElement) return readImage(el, o);
  if (el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) return readMedia(el, o);
  if (el instanceof HTMLIFrameElement) return readIframe(el, o);
  return readGeneric(el, o);
}

/* ------------------------------------------------------------------ */
/* <img>                                                               */
/* ------------------------------------------------------------------ */

function readImage(img: HTMLImageElement, o: InspectOptions): ResourceCardModel {
  // currentSrc is THE fact: what the browser actually loaded, after srcset, after
  // <picture>, after content negotiation. `src` is only what the markup asked for.
  const currentSrc = img.currentSrc || img.src || '';
  const markupSrc = img.getAttribute('src') ? normalizeUrl(img.getAttribute('src') as string) : undefined;
  const entries = resourceEntries();
  const entry = findEntry(currentSrc, entries);

  const dpr = window.devicePixelRatio || 1;
  const rect = img.getBoundingClientRect();
  const natural = { w: img.naturalWidth, h: img.naturalHeight };
  const displayed = { w: Math.round(rect.width), h: Math.round(rect.height), dpr };

  // srcset — only when there is something to explain (design §6.3).
  const srcsetAttr = img.getAttribute('srcset') ?? pictureSrcset(img);
  let srcset = null;
  if (srcsetAttr) {
    const sizesAttr = img.getAttribute('sizes');
    const candidates = parseSrcset(srcsetAttr).map((c) => ({ ...c, url: normalizeUrl(c.url) }));
    const slot = resolveSlotWidth(sizesAttr, img, o.measureIn);
    srcset = analyzeSrcset(
      candidates,
      slot,
      dpr,
      currentSrc,
      sizesAttr,
      analyzePictureSources(img, currentSrc),
      o.t,
    );
  }

  const failure = imageFailure(img, currentSrc, o.t);
  const base = commonFields(img, currentSrc, entry, entries, o);

  return {
    ...base,
    kind: 'image',
    variant: variantFor(currentSrc, failure !== null, 'image'),
    markupSrc: markupSrc && markupSrc !== normalizeUrl(currentSrc) ? markupSrc : undefined,
    mime: mimeFor(currentSrc),
    naturalSize: natural.w > 0 ? natural : undefined,
    displayedSize: displayed,
    overweight: overweightOf(natural.w, rect.width, dpr, o.overweightThreshold),
    srcset,
    attributes: attributesOf(img, ['loading', 'decoding', 'fetchpriority', 'sizes'], o.t),
    alt: img.hasAttribute('alt') ? img.alt : undefined,
    failure: failure ?? undefined,
    dataUri: currentSrc.startsWith('data:') ? dataUriOf(currentSrc) : undefined,
  };
}

function pictureSrcset(img: HTMLImageElement): string | null {
  const picture = img.parentElement;
  if (!(picture instanceof HTMLPictureElement)) return null;
  // Show the candidates of the source that actually won — the others appear in the
  // stage-1 table with their matchMedia verdicts.
  const current = img.currentSrc;
  for (const source of Array.from(picture.querySelectorAll('source'))) {
    const set = source.getAttribute('srcset');
    if (set && parseSrcset(set).some((c) => normalizeUrl(c.url) === normalizeUrl(current))) return set;
  }
  return picture.querySelector('source')?.getAttribute('srcset') ?? null;
}

/**
 * Did it load? Answered from the DOM, not from the network (design §0 И1, §5.10).
 * 🔴 We do NOT guess the cause: for a cross-origin resource the browser genuinely
 * does not tell the page whether it was a 404, CORS, CSP or mixed content — so we
 * say that, and point at the one place that knows (DevTools).
 */
function imageFailure(img: HTMLImageElement, currentSrc: string, t?: TFn): LoadFailure | null {
  if (currentSrc === '') return null;
  if (!img.complete) return null;
  if (img.naturalWidth > 0) return null;
  const status = responseStatusOf(findEntry(currentSrc));
  if (status !== null && status >= 400) {
    return {
      code: String(status),
      message: t ? t('failServerAnswered', { status }) : `The server answered ${status}.`,
    };
  }
  return {
    code: null,
    message: t
      ? t('failImageGeneric')
      : 'The image did not load. The browser does not tell a page WHY a cross-origin resource failed (404 / CORS / CSP / mixed content all look the same from here). The DevTools panel — Console + Network — will name it.',
  };
}

/* ------------------------------------------------------------------ */
/* <video> / <audio>                                                   */
/* ------------------------------------------------------------------ */

function readMedia(media: HTMLVideoElement | HTMLAudioElement, o: InspectOptions): ResourceCardModel {
  const currentSrc = media.currentSrc || '';
  const isVideo = media instanceof HTMLVideoElement;
  const videoWidth = isVideo ? media.videoWidth : 0;
  const entries = resourceEntries();
  const entry = findEntry(currentSrc, entries);
  const base = commonFields(media, currentSrc, entry, entries, o);

  // The MSE fork (design §4.3): a blob: currentSrc, or no currentSrc at all while
  // frames are clearly being painted, means the player is assembling the stream
  // from in-memory segments. There IS no file URL — and we explain that instead of
  // pretending otherwise.
  const isMse = currentSrc.startsWith('blob:') || (currentSrc === '' && videoWidth > 0);
  if (isMse) {
    // 🔴 The requests are a HEURISTIC (type + host), and the card says so. The DASH/
    // HLS manifest may appear in this list as a fact about the page — it is never
    // opened, fetched or parsed (design §13 №2).
    const feed = mediaFeedRequests(entries);
    return {
      ...base,
      kind: isVideo ? 'video' : 'audio',
      variant: 'mse',
      mime: {
        value: o.t
          ? o.t(isVideo ? 'mseMimeVideo' : 'mseMimeAudio')
          : isVideo ? 'video (MSE stream)' : 'audio (MSE stream)',
        certainty: 'unknown',
      },
      urlOpenable: false,
      openDisabledReason: o.t
        ? o.t('mseOpenReason')
        : 'blob: points at buffers in this tab’s memory — there is no file at that address, on disk or on a server',
      weight: { kind: 'not-in-buffer' },
      requests: groupByHost(feed),
      requestsHeuristic: true,
      mse: {
        blobUrl: currentSrc,
        mechanism: 'MSE',
        resolution: isVideo && videoWidth > 0 ? { w: videoWidth, h: media.videoHeight } : undefined,
        frames: isVideo ? playbackQuality(media) : undefined,
        // EME active — the FACT. 🔴 Never the system name: to learn it you must hook
        // requestMediaKeySystemAccess() before the player starts, which needs a
        // script on every site. We do not ask for that permission (design §2.3).
        drmActive: media.mediaKeys != null,
      },
    };
  }

  const declared = declaredTypeOf(media);
  const rect = media.getBoundingClientRect();
  return {
    ...base,
    kind: isVideo ? 'video' : 'audio',
    variant: variantFor(currentSrc, mediaFailure(media) !== null, 'progressive-video'),
    mime: mimeFor(currentSrc, o.t),
    // 🔴 Only ever what the AUTHOR declared, marked as a claim. We never print
    // "H.264" from a guess (design §7 №5).
    declaredType: declared ?? undefined,
    naturalSize: isVideo && videoWidth > 0 ? { w: videoWidth, h: media.videoHeight } : undefined,
    displayedSize: { w: Math.round(rect.width), h: Math.round(rect.height), dpr: window.devicePixelRatio || 1 },
    attributes: attributesOf(media, ['preload', 'autoplay', 'loop', 'muted', 'controls', 'poster', 'crossorigin'], o.t),
    failure: mediaFailure(media, o.t) ?? undefined,
    video: {
      resolution: isVideo && videoWidth > 0 ? { w: videoWidth, h: media.videoHeight } : undefined,
      duration: Number.isFinite(media.duration) ? media.duration : null,
      frames: isVideo ? playbackQuality(media) : undefined,
    },
    dataUri: currentSrc.startsWith('data:') ? dataUriOf(currentSrc) : undefined,
  };
}

function playbackQuality(video: HTMLVideoElement): { rendered: number; dropped: number } | undefined {
  try {
    const q = video.getVideoPlaybackQuality?.();
    if (!q) return undefined;
    return { rendered: q.totalVideoFrames, dropped: q.droppedVideoFrames };
  } catch {
    return undefined;
  }
}

/** `<source type="video/mp4; codecs=avc1.42E01E">` — a CLAIM by the author. */
function declaredTypeOf(media: HTMLMediaElement): string | null {
  const own = media.getAttribute('type');
  if (own) return own;
  for (const source of Array.from(media.querySelectorAll('source'))) {
    const type = source.getAttribute('type');
    if (!type) continue;
    const src = source.getAttribute('src');
    if (!src || normalizeUrl(src) === normalizeUrl(media.currentSrc)) return type;
  }
  return null;
}

function mediaFailure(media: HTMLMediaElement, t?: TFn): LoadFailure | null {
  const err = media.error;
  if (!err) return null;
  // MEDIA_ERR_* are spec constant names, not prose — kept verbatim in every locale.
  const codes: Record<number, string> = {
    1: 'MEDIA_ERR_ABORTED',
    2: 'MEDIA_ERR_NETWORK',
    3: 'MEDIA_ERR_DECODE',
    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
  };
  return {
    code: codes[err.code] ?? `code ${err.code}`,
    message: err.message || (t ? t('mediaErrNoDetail') : 'The browser reported no further detail.'),
  };
}

/* ------------------------------------------------------------------ */
/* <iframe>                                                            */
/* ------------------------------------------------------------------ */

function readIframe(frame: HTMLIFrameElement, o: InspectOptions): ResourceCardModel {
  const src = frame.src || frame.getAttribute('src') || '';
  const entries = resourceEntries();
  const entry = findEntry(src, entries);
  const rect = frame.getBoundingClientRect();

  // Degrade honestly, never throw: reading contentDocument across origins throws a
  // SecurityError, and that throw IS the answer (design §4.8).
  let sameOrigin = false;
  try {
    sameOrigin = frame.contentDocument !== null;
  } catch {
    sameOrigin = false;
  }

  const base = commonFields(frame, src, entry, entries, o);
  return {
    ...base,
    kind: 'iframe',
    variant: sameOrigin ? 'iframe-same-origin' : 'iframe-cross-origin',
    mime: { value: 'text/html', certainty: 'unknown' },
    displayedSize: { w: Math.round(rect.width), h: Math.round(rect.height), dpr: window.devicePixelRatio || 1 },
    attributes: attributesOf(frame, ['allow', 'loading', 'sandbox', 'referrerpolicy', 'allowfullscreen'], o.t),
    iframe: {
      src,
      size: { w: Math.round(rect.width), h: Math.round(rect.height) },
      attributes: attributesOf(frame, ['allow', 'loading', 'sandbox'], o.t),
      sameOrigin,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Anything else: CSS background, or genuinely no resource             */
/* ------------------------------------------------------------------ */

function readGeneric(el: Element, o: InspectOptions): ResourceCardModel {
  const style = safeComputedStyle(el);
  const bgUrl = style ? firstUrlIn(style.backgroundImage) : null;
  const entries = resourceEntries();
  const rect = el.getBoundingClientRect();

  if (bgUrl) {
    const url = normalizeUrl(bgUrl);
    const entry = findEntry(url, entries);
    const base = commonFields(el, url, entry, entries, o);
    return {
      ...base,
      kind: 'css-background',
      variant: variantFor(url, false, 'image'),
      mime: mimeFor(url, o.t),
      displayedSize: { w: Math.round(rect.width), h: Math.round(rect.height), dpr: window.devicePixelRatio || 1 },
      attributes: style
        ? { 'background-size': style.backgroundSize, 'background-position': style.backgroundPosition }
        : undefined,
      dataUri: url.startsWith('data:') ? dataUriOf(url) : undefined,
    };
  }

  const base = commonFields(el, '', null, entries, o);
  const nested = nestedResourceHint(el);
  return {
    ...base,
    kind: 'none',
    variant: 'no-resource',
    mime: { value: '—', certainty: 'unknown' },
    urlOpenable: false,
    openDisabledReason: o.t ? o.t('openReasonNoUrl') : 'this element has no resource URL',
    cssRule: style ? cssPaintDescription(style, o.t) : undefined,
    nestedHint: nested ?? undefined,
    // A custom element with no light-DOM children that still paints is the classic
    // closed-shadow-root case. We state the CONDITION, not a conclusion (§4.7).
    closedShadow:
      el.tagName.includes('-') && el.shadowRoot === null && el.childElementCount === 0 && rect.height > 0,
  };
}

function nestedResourceHint(el: Element): string | null {
  const inner = el.querySelector('img, video, audio, iframe');
  return inner ? elementLabel(inner) : null;
}

function cssPaintDescription(style: CSSStyleDeclaration, t?: TFn): string {
  // The first two branches are CSS declarations (code) — kept verbatim. Only the
  // "structure, not a resource" fallback is prose, so only it is translated.
  if (style.backgroundImage !== 'none') return `background-image: ${style.backgroundImage}`;
  if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') return `background-color: ${style.backgroundColor}`;
  return t ? t('cssNoBackground') : 'no painted background — this element is structure, not a resource';
}

function firstUrlIn(backgroundImage: string): string | null {
  if (!backgroundImage || backgroundImage === 'none') return null;
  const m = /url\((['"]?)(.*?)\1\)/.exec(backgroundImage);
  return m?.[2] ?? null;
}

function safeComputedStyle(el: Element): CSSStyleDeclaration | null {
  try {
    return getComputedStyle(el);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

function commonFields(
  el: Element,
  url: string,
  entry: PerformanceResourceTiming | null,
  entries: PerformanceResourceTiming[],
  o: InspectOptions,
): ResourceCardModel {
  // `all` = the whole timing buffer (design §2.8/§3); `related` = just this
  // element's own request, if we matched one.
  const requests: RequestGroup[] =
    o.requestScope === 'all' ? groupByHost(entries) : entry ? groupByHost([entry]) : [];
  return {
    kind: 'none',
    variant: 'no-resource',
    elementLabel: elementLabel(el),
    selector: computeSelector(el),
    currentSrc: url,
    urlOpenable: isOpenable(url),
    openDisabledReason: openDisabledReason(url, o.t),
    mime: mimeFor(url, o.t),
    weight: weightOf(entry, o.t),
    // 🔴 The initiator TYPE is all a page can ever see. WHICH SCRIPT, at which line,
    // exists only in the DevTools HAR — no extension API returns it (design §7 №2).
    initiator: { type: entry?.initiatorType || '—', scriptKnown: false },
    status: responseStatusOf(entry),
    requests,
    requestsHeuristic: false,
    redirects: redirectStateOf(entry),
    buffer: o.buffer,
  };
}

function mimeFor(url: string, t?: TFn): MimeInfo {
  if (!url) return { value: '—', certainty: 'unknown' };
  if (url.startsWith('blob:')) {
    return { value: t ? t('blobMime') : 'in-memory buffer (blob:)', certainty: 'unknown' };
  }
  return guessMime(url);
}

/** 🔴 Only http/https may ever reach an `href`. A `javascript:` URL inside a
 *  `srcset` would otherwise be code execution in our own overlay (design §9.1). */
export function isOpenable(url: string): boolean {
  if (!url) return false;
  try {
    const proto = new URL(url, location.href).protocol;
    return proto === 'http:' || proto === 'https:';
  } catch {
    return false;
  }
}

function openDisabledReason(url: string, t?: TFn): string | undefined {
  if (!url) return t ? t('openReasonNoUrl') : 'this element has no resource URL';
  if (url.startsWith('blob:')) {
    return t ? t('openReasonBlob') : 'blob: is a pointer to this tab’s memory — there is nothing at that address to open';
  }
  if (url.startsWith('data:')) {
    return t ? t('openReasonData') : 'the browser blocks top-level navigation to data: URIs';
  }
  if (isOpenable(url)) return undefined;
  return t ? t('openReasonHttpOnly') : 'only http and https URLs can be opened';
}

function dataUriOf(url: string): { prefix: string; length: number; head: string } {
  const comma = url.indexOf(',');
  const prefix = comma === -1 ? url.slice(0, 64) : url.slice(0, comma + 1);
  return { prefix, length: url.length, head: url.slice(prefix.length, prefix.length + 200) };
}

function variantFor(
  url: string,
  failed: boolean,
  fallback: 'image' | 'progressive-video',
): ResourceCardModel['variant'] {
  if (failed) return 'failed';
  if (url.startsWith('data:')) return 'data';
  if (url.startsWith('blob:')) return 'blob';
  if (url === '') return 'no-resource';
  return fallback;
}

function attributesOf(el: Element, names: string[], t?: TFn): Record<string, string> {
  const out: Record<string, string> = {};
  const present = t ? t('attrPresent') : '(present)';
  for (const name of names) {
    const value = el.getAttribute(name);
    if (value !== null) out[name] = value === '' ? present : value;
  }
  return out;
}

/** natural / (css × DPR) — the ONLY verdict this product renders. In PIXELS: we do
 *  not know the bytes (§7 №1), and a byte budget would be `perf` (§8). */
function overweightOf(
  naturalWidth: number,
  cssWidth: number,
  dpr: number,
  threshold: OverweightThreshold,
): ResourceCardModel['overweight'] {
  if (threshold === 'off') return null;
  if (naturalWidth <= 0 || cssWidth <= 0) return null;
  const needed = cssWidth * dpr;
  const ratio = naturalWidth / needed;
  if (ratio < threshold) return null;
  return {
    ratio,
    naturalWidth,
    neededWidth: Math.round(needed),
    displayedWidth: Math.round(cssWidth),
    severity: ratio >= threshold * 2 ? 'poor' : 'warn',
  };
}
