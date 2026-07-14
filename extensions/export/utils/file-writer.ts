// STUB — real byte generation + the cross-origin download ladder are not
// implemented in the scaffold. Real CSV escaping (utils/csv-guard.ts) and
// filename sanitization (utils/filename.ts) ARE real and feed into here.
//
// All of this runs inside the injected `engine.js`/`xlsx.js` (page context), NEVER
// in the service worker: the SW has no `URL.createObjectURL` and dies after ~30s
// (design §0/§9.2). Bytes are born and revoked in the content script.

import { mockAsync, todoLogic } from '@blur/ui';
import type { TableFormat } from './types';

export type WriteResult =
  | { ok: true; filename: string; bytes: number }
  | { ok: false; reason: DownloadFailure };

/** The honest failure modes the preview/toast must surface (design §5 / §7). */
export type DownloadFailure =
  | 'csp-blocked' // §5.5 page CSP sandbox forbids downloads → offer save.html route
  | 'cross-origin-image' // §5.9 <a download> ignores download attr cross-origin
  | 'clipboard-failed' // §5.6 writeText/execCommand both failed
  | 'too-large'; // §9.1 > 200k cells → refuse xlsx, offer CSV

/**
 * Turn already-built text (CSV/MD/TXT) into a file via Blob + <a download>.
 * STUB → returns a mock success. The REAL ladder (design §5.9), a WIRING task:
 *   1. same-origin           → `<a download>` works;
 *   2. CORS-enabled resource → `fetch(url)` → Blob → `<a download>`;
 *   3. otherwise             → honest refusal (return cross-origin-image).
 * Plus: create the Blob-URL, click a detached <a>, and revoke via setTimeout(60s)
 * AND on `pagehide` (🔴 never revoke right after click — Firefox race, §9.4).
 */
export function saveTextFile(
  text: string,
  filename: string,
): Promise<WriteResult> {
  // TODO_LOGIC: real Blob + <a download> + revoke ladder (design §5.9 / §9.4).
  void text;
  return mockAsync({ ok: true, filename, bytes: text.length }, 400);
}

/**
 * Build .xlsx bytes with write-excel-file (injected as the SECOND file, xlsx.js,
 * only when .xlsx is chosen — design §0). STUB.
 */
export function saveXlsxFile(
  _rows: unknown,
  _filename: string,
): never {
  // TODO_LOGIC: write-excel-file → Blob → <a download>. Typed cells (formula-immune,
  // design §8.3). Refuse > 200k cells / > 1,048,576 rows (design §9.1).
  throw todoLogic('export: xlsx bytes via write-excel-file (second injection)');
}

/** Copy an image URL to the clipboard. STUB (real: currentSrc for srcset, §4.3). */
export function copyImageUrl(_srcUrl: string): never {
  // TODO_LOGIC: clipboard writeText with execCommand fallback (design §4.3 / §5.6).
  throw todoLogic('export: copy image URL (currentSrc for srcset)');
}

/** Human label for a format, for filenames/toasts. */
export function extensionFor(format: TableFormat): string {
  return format; // csv | xlsx | md | txt — the extension IS the format id.
}
