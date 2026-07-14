import type { MaskedMediaInfo } from '@blur/core';

/**
 * Work out WHAT is hidden under a mask, so the label chip can say so.
 *
 * The point of the feature: an opaque mask is safe but blind — you cannot tell a
 * spoiler screenshot from your own avatar, so you end up revealing things just to
 * find out what they are, which is the exact thing the extension exists to avoid.
 * A chip reading "JPEG · 1200×800" lets you decide without looking.
 *
 * Everything here is derived from the DOM and the URL only. Nothing is fetched,
 * and no pixel of the masked media is ever read.
 */

/** Extensions we can name confidently, mapped to how a human would say it. */
const FORMAT_BY_EXT: Record<string, string> = {
  jpg: 'JPEG',
  jpeg: 'JPEG',
  png: 'PNG',
  gif: 'GIF',
  webp: 'WEBP',
  avif: 'AVIF',
  svg: 'SVG',
  bmp: 'BMP',
  ico: 'ICO',
  heic: 'HEIC',
  mp4: 'MP4',
  m4v: 'MP4',
  webm: 'WEBM',
  ogv: 'OGV',
  mov: 'MOV',
  mkv: 'MKV',
  avi: 'AVI',
  m3u8: 'HLS',
  mpd: 'DASH',
};

/**
 * Pull a file extension out of a URL.
 *
 * Deliberately tolerant of the shapes real media URLs take:
 *  - query strings and fragments (`/a.jpg?w=800&s=…`) — stripped before matching;
 *  - CDN paths with dots in a directory (`/v1.2/img/x.webp`) — only the LAST
 *    segment is considered;
 *  - `data:` URIs, which carry no filename at all — the MIME subtype is the
 *    format, so `data:image/png;base64,…` still yields PNG;
 *  - `blob:` and MSE/`srcObject` streams, which carry no format information
 *    whatsoever. Guessing there would be a lie, so we return null and the caller
 *    falls back to the element kind ("VIDEO").
 */
export function formatFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  const dataMatch = /^data:([a-z]+)\/([a-z0-9.+-]+)/i.exec(url);
  if (dataMatch) {
    const subtype = dataMatch[2]!.toLowerCase();
    // `image/svg+xml` -> SVG, `image/jpeg` -> JPEG.
    const base = subtype.split('+')[0]!;
    return FORMAT_BY_EXT[base] ?? base.toUpperCase();
  }

  // A blob:/mediasource URL is opaque by design — no honest format to report.
  if (/^(blob:|mediasource:)/i.test(url)) return null;

  const path = url.split(/[?#]/, 1)[0] ?? '';
  const last = path.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot < 0 || dot === last.length - 1) return null;
  const ext = last.slice(dot + 1).toLowerCase();
  return FORMAT_BY_EXT[ext] ?? null;
}

/** `url("https://x/y.png")` / `url(y.png)` -> the inner URL. */
export function urlFromCssBackground(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /url\((['"]?)(.*?)\1\)/i.exec(value);
  return m?.[2] ?? null;
}

/** `137` -> `2:17`. Durations are shown because a 3-second GIF-alike and a
 * 40-minute video are very different things to un-hide in public. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Describe a masked element. Pure apart from reading the element's own
 * properties — no network, no canvas, no pixel access.
 */
export function describeElement(el: Element): MaskedMediaInfo {
  if (el instanceof HTMLImageElement) {
    return {
      kind: 'image',
      // `currentSrc` is what the browser ACTUALLY chose from a srcset/<picture>;
      // `src` may name a format the browser never fetched (the classic case: a
      // <picture> serving AVIF while src= still points at the JPEG fallback).
      format: formatFromUrl(el.currentSrc || el.src) ?? 'IMAGE',
      width: el.naturalWidth || null,
      height: el.naturalHeight || null,
      durationSec: null,
    };
  }

  if (el instanceof HTMLVideoElement) {
    const src = el.currentSrc || el.src || el.querySelector('source')?.getAttribute('src');
    return {
      kind: 'video',
      // A streamed video (MSE/blob:) has no knowable container; say VIDEO rather
      // than invent one.
      format: formatFromUrl(src) ?? 'VIDEO',
      width: el.videoWidth || null,
      height: el.videoHeight || null,
      durationSec: Number.isFinite(el.duration) ? el.duration : null,
    };
  }

  // Anything else matched by a rule is masked because of a CSS background image
  // (posters/thumbnails) or because it is a text match.
  const bg =
    el instanceof HTMLElement
      ? urlFromCssBackground(getComputedStyle(el).backgroundImage)
      : null;
  if (bg) {
    return {
      kind: 'background',
      format: formatFromUrl(bg) ?? 'IMAGE',
      width: null,
      height: null,
      durationSec: null,
    };
  }

  return { kind: 'text', format: 'TEXT', width: null, height: null, durationSec: null };
}

/** The one-line chip text: "JPEG · 1200×800", "MP4 · 0:42", "TEXT". */
export function labelFor(info: MaskedMediaInfo): string {
  const parts: string[] = [info.format];
  if (info.width && info.height) parts.push(`${info.width}×${info.height}`);
  const dur = formatDuration(info.durationSec);
  if (dur) parts.push(dur);
  return parts.join(' · ');
}
