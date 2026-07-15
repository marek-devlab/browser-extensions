// 🔴 BLOCKER #1 — the cross-origin `<a download>` ladder, and the Blob-URL
// lifecycle. Everything here runs inside the injected `engine.js` (page context).
//
// WHY THIS FILE EXISTS AT ALL, in one sentence:
//
//   `<a download>` SILENTLY IGNORES the `download` attribute when `href` points at
//   a CROSS-ORIGIN URL — the browser NAVIGATES there instead of saving.
//
// That is a spec rule (HTML §4.6.6 "download": the attribute is only honoured for
// same-origin URLs and `blob:`/`data:`), not a bug, and it is the exact hole a
// naive implementation falls into: the user clicks "save this image", their page
// navigates away, and no file is written. So:
//
//   1. same-origin URL              → `<a download>` works                   ✅
//   2. cross-origin WITH CORS       → fetch → Blob → blob: URL → `<a download>` ✅
//      (a `blob:` URL is same-origin with the page, so the attribute is honoured)
//   3. cross-origin WITHOUT CORS    → 🔴 HONEST REFUSAL. Offer (a) open the image in
//      a tab, (b) turn on the OPTIONAL `downloads` permission, which is the only
//      API that can save a cross-origin URL. We never navigate the page by accident
//      and we never claim a file was written.
//
// Bytes WE generate (csv/md/txt/xlsx) are always `blob:` URLs of the page's own
// origin, so they take rung 1 unconditionally. Only remote IMAGES can reach rung 3.

import { sanitizeBaseName } from './filename';
import type { BgRequest, BgResponse } from './messages';

/* ====================================================================== *
 * Blob-URL lifecycle (design §9.4)
 * ====================================================================== */

const liveUrls = new Set<string>();
let pagehideHooked = false;

function hookPagehide(): void {
  if (pagehideHooked) return;
  pagehideHooked = true;
  // §5.11 — user navigated away mid-save: revoke everything, save nothing.
  addEventListener(
    'pagehide',
    () => {
      for (const url of liveUrls) URL.revokeObjectURL(url);
      liveUrls.clear();
    },
    { once: true },
  );
}

/**
 * 🔴 NEVER revoke right after `.click()`: in Firefox the download may not have
 * started yet and is silently cancelled. 60 s is the compromise that works in
 * practice (design §9.4). `pagehide` revokes anything still outstanding, so a user
 * who clicks Export thirty times does not leak thirty URLs.
 */
function trackUrl(url: string): void {
  hookPagehide();
  liveUrls.add(url);
  setTimeout(() => {
    if (liveUrls.delete(url)) URL.revokeObjectURL(url);
  }, 60_000);
}

/* ====================================================================== *
 * Results
 * ====================================================================== */

export type SaveFailure =
  | 'no-cors' // §5.9 rung 3: cross-origin, no CORS → cannot be saved without `downloads`
  | 'fetch-failed' // network/CORS threw
  | 'blocked' // §5.5 page CSP sandbox forbids downloads
  | 'bad-url' // 🔴 javascript:/file:/blob: from page content — refused outright
  | 'too-large'
  | 'clipboard-failed';

export type SaveResult =
  | { ok: true; filename: string; bytes: number }
  | { ok: false; reason: SaveFailure; detail?: string };

/* ====================================================================== *
 * URL hygiene (design §8.4)
 * ====================================================================== */

/** 🔴 The ONLY schemes we will ever fetch or hand to `tabs.create`. A page can put
 *  anything in an `img[src]`; `javascript:` and `file:` are not negotiable. */
export function isSafeAssetUrl(raw: string): boolean {
  try {
    const u = new URL(raw, location.href);
    if (u.protocol === 'http:' || u.protocol === 'https:') return true;
    // A `data:` IMAGE is inert and is what `srcUrl` gives for inline images.
    if (u.protocol === 'data:') return /^data:image\//i.test(raw);
    return false;
  } catch {
    return false;
  }
}

function isSameOrigin(raw: string): boolean {
  try {
    const u = new URL(raw, location.href);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return true;
    return u.origin === location.origin;
  } catch {
    return false;
  }
}

/* ====================================================================== *
 * The anchor
 * ====================================================================== */

/**
 * Click a detached `<a download>`. Returns false only if the DOM refused us.
 *
 * ⚠️ We CANNOT reliably detect a page-CSP-sandboxed document silently dropping the
 * download (design §13.4 is explicit that the "wait 1.5s and guess" heuristic is
 * not a real signal). So we do not pretend to: the toast always offers the
 * "save through the extension's own tab" escape hatch (§5.5), and the toast says
 * "Сохранение запущено", never "Файл сохранён" (design §7.8).
 */
function clickAnchor(href: string, filename: string): boolean {
  try {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    // target must NOT be _blank: with a cross-origin href that would open a tab
    // instead of failing loudly, which is the exact silent-navigation trap.
    document.body?.append(a) ?? document.documentElement.append(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

/** Safe filename → sanitized base + OUR extension. 🔴 The extension is never taken
 *  from user input (design §8.2). Defence in depth: the UI sanitizes too, but this
 *  is the last gate before the byte hits the disk. */
export function safeFilename(base: string, ext: string, translit = true): string {
  return `${sanitizeBaseName(base, translit)}.${ext.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'txt'}`;
}

/* ====================================================================== *
 * Saving bytes WE produced (rung 1, always)
 * ====================================================================== */

/** Blob → file. Our own Blob URL is same-origin with the page → the `download`
 *  attribute is always honoured. */
export function saveBlob(blob: Blob, filename: string): SaveResult {
  const url = URL.createObjectURL(blob);
  trackUrl(url); // 🔴 revoke at 60s + on pagehide — never right after click()
  const clicked = clickAnchor(url, filename);
  if (!clicked) return { ok: false, reason: 'blocked' };
  return { ok: true, filename, bytes: blob.size };
}

/**
 * Text chunks → file. Takes an ARRAY of parts, never one concatenated string:
 * `s += cell` over 60 000 cells is O(n²) (design §9.1).
 */
export function saveTextParts(parts: string[], filename: string, mime: string): SaveResult {
  try {
    return saveBlob(new Blob(parts, { type: mime }), filename);
  } catch (e) {
    return { ok: false, reason: 'too-large', detail: String(e) };
  }
}

/* ====================================================================== *
 * 🔴 Saving an IMAGE — the ladder (design §5.9)
 * ====================================================================== */

export interface ImageSaveOutcome {
  result: SaveResult;
  /** Which rung answered — the UI states this out loud rather than guessing. */
  rung: 'same-origin' | 'cors-fetch' | 'downloads-permission' | 'refused';
  /** Host we could not reach, for the refusal copy. */
  host?: string;
}

export async function saveImage(
  srcUrl: string,
  ask: (req: BgRequest) => Promise<BgResponse>,
  translit = true,
): Promise<ImageSaveOutcome> {
  // 🔴 Rung 0: refuse anything that is not an http(s)/data:image URL.
  if (!isSafeAssetUrl(srcUrl)) {
    return { result: { ok: false, reason: 'bad-url' }, rung: 'refused' };
  }

  const url = new URL(srcUrl, location.href);
  const host = url.hostname;
  const base = sanitizeBaseName(
    decodeURIComponent(url.pathname.split('/').pop() || 'image').replace(/\.[^.]+$/, ''),
    translit,
  );
  const ext = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i.exec(url.pathname)?.[1] ?? 'png';
  const filename = `${base}.${ext.toLowerCase()}`;

  // Rung 1 — same-origin (or data:). `<a download>` is honoured. Done.
  if (isSameOrigin(srcUrl)) {
    const clicked = clickAnchor(srcUrl, filename);
    return {
      result: clicked
        ? { ok: true, filename, bytes: 0 }
        : { ok: false, reason: 'blocked' },
      rung: 'same-origin',
      host,
    };
  }

  // Rung 1.5 — the user already granted the OPTIONAL `downloads` permission: the
  // downloads API is the only thing that can save a cross-origin URL outright, so
  // prefer it over a fetch that may or may not be allowed.
  const perm = await ask({ type: 'hasDownloads' });
  if (perm.ok && perm.granted) {
    const res = await ask({ type: 'downloadUrl', url: url.href, filename });
    if (res.ok) {
      return { result: { ok: true, filename, bytes: 0 }, rung: 'downloads-permission', host };
    }
  }

  // Rung 2 — cross-origin WITH CORS. This is the ONE and ONLY network request this
  // extension ever makes, and it fetches exactly the asset the user just asked to
  // save. `credentials: 'omit'` so we never attach the user's cookies to it.
  try {
    const resp = await fetch(url.href, {
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
    });
    if (resp.ok) {
      const blob = await resp.blob();
      // A blob: URL is same-origin with the page → `download` IS honoured. This is
      // precisely the rung that makes cross-origin saving work at all.
      return { result: saveBlob(blob, filename), rung: 'cors-fetch', host };
    }
  } catch {
    // Opaque / CORS-refused / offline. Fall through to the honest refusal.
  }

  // Rung 3 — 🔴 HONEST REFUSAL. We do NOT click the anchor (that would navigate the
  // user's page away, which is the whole trap). We do NOT claim success.
  return { result: { ok: false, reason: 'no-cors' }, rung: 'refused', host };
}

/* ====================================================================== *
 * Clipboard (design §4.3 / §5.6)
 * ====================================================================== */

/**
 * ⚠️ A context-menu click does NOT give the page transient activation, so
 * `navigator.clipboard.writeText()` usually throws here. `document.execCommand`
 * under the `clipboardWrite` permission is the fallback. If BOTH fail we return
 * false and the caller shows a "copy it yourself" textarea (§5.6) — we never
 * pretend the copy happened.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* no activation / not focused — fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body?.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** The URL the browser ACTUALLY loaded. ⚠️ `info.srcUrl` from the context menu is
 *  the `src` attribute; with `srcset` the browser may have picked a different file,
 *  and handing over a URL that is not on screen would be a lie (design §4.3). */
export function resolveCurrentSrc(srcUrl: string): { url: string; viaSrcset: boolean } {
  for (const img of document.images) {
    if (img.src === srcUrl || img.currentSrc === srcUrl) {
      if (img.currentSrc && img.currentSrc !== srcUrl) {
        return { url: img.currentSrc, viaSrcset: true };
      }
      return { url: srcUrl, viaSrcset: false };
    }
  }
  return { url: srcUrl, viaSrcset: false };
}
