import { browser } from '#imports';
import { sanitizeFilename } from './format';

// Saving a finished artifact to disk. Two paths, both local, neither touching the
// network (design §9.1 — the CSP forbids it anyway).
//
//   1. File System Access (`showSaveFilePicker`) — Chromium only. The blob is
//      piped into the file, so nothing is duplicated in memory (design §10.3).
//   2. `downloads.download` + `URL.createObjectURL` — the universal path, and the
//      ONLY one on Firefox. ⚠️ The object URL MUST be revoked, or every export
//      leaks its whole payload for the life of the page (PLAN.md (Часть II) §3.1). We revoke
//      on downloads.onChanged, and unconditionally after a timeout in case the
//      event never arrives (a listener that never fires is how leaks ship).

export interface SaveOptions {
  blob: Blob;
  /** WITHOUT extension — it is appended from the mime type. */
  basename: string;
  extension: string;
  askWhereToSave: boolean;
}

export type SaveOutcome = 'saved' | 'cancelled';

export async function saveBlob(opts: SaveOptions): Promise<SaveOutcome> {
  const filename = `${sanitizeFilename(opts.basename)}.${opts.extension}`;

  const picker = (
    globalThis as {
      showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;

  if (opts.askWhereToSave && typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [
          {
            description: opts.extension.toUpperCase(),
            accept: { [opts.blob.type || 'application/octet-stream']: [`.${opts.extension}`] },
          },
        ],
      });
      const writable = await handle.createWritable();
      // Streams from the Blob (which the browser keeps on disk) into the file —
      // no second copy in RAM.
      await opts.blob.stream().pipeTo(writable);
      return 'saved';
    } catch (err) {
      // AbortError = the user closed the picker. That is a cancel, not a failure,
      // and must never be reported as one.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Anything else (e.g. the picker is unavailable in this context) → fall
      // through to downloads.
    }
  }

  const url = URL.createObjectURL(opts.blob);
  let downloadId: number | undefined;
  try {
    downloadId = await browser.downloads.download({
      url,
      filename,
      saveAs: opts.askWhereToSave,
    });
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }

  revokeWhenDone(url, downloadId);
  return 'saved';
}

function revokeWhenDone(url: string, downloadId: number | undefined): void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    URL.revokeObjectURL(url);
    browser.downloads.onChanged.removeListener(listener);
  };
  const listener = (delta: { id: number; state?: { current?: string } }) => {
    if (delta.id !== downloadId) return;
    if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') finish();
  };
  browser.downloads.onChanged.addListener(listener);
  // Belt and braces: if the event never comes (page navigated away, listener
  // dropped), revoke anyway. A leaked object URL pins the entire recording.
  globalThis.setTimeout(finish, 5 * 60_000);
}

export function extensionFor(mimeOrFormat: string): string {
  if (mimeOrFormat.includes('mp4')) return 'mp4';
  if (mimeOrFormat.includes('webm')) return 'webm';
  if (mimeOrFormat.includes('png')) return 'png';
  if (mimeOrFormat.includes('jpeg') || mimeOrFormat.includes('jpg')) return 'jpg';
  if (mimeOrFormat.includes('webp')) return 'webp';
  return 'bin';
}
