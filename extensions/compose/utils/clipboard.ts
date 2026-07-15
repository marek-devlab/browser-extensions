// Clipboard writing (design §5.6, §6.2). The `clipboardWrite` permission exists
// for exactly this file.
//
// 🔴 "Copy as HTML" is ONE `ClipboardItem` carrying BOTH `text/html` and
// `text/plain` (design §6.2): pasting into Google Docs / Confluence / an email
// keeps the formatting, pasting into a plain <textarea> yields the clean
// Markdown source. Two separate writes would clobber each other.
//
// ⚠️ `navigator.clipboard.write()` rejects more often than people expect: no
// user activation, or the document is not focused — which is the NORMAL state of
// a side panel a moment after you click elsewhere. So the failure path is a real
// path, not a theoretical one:
//   1. navigator.clipboard.write (rich)  →
//   2. navigator.clipboard.writeText     →
//   3. hidden <textarea> + document.execCommand('copy')  (deprecated, still the
//      most permissive)  →
//   4. give up HONESTLY and let the UI show the manual-copy panel.
// 🔴 Silently doing nothing is forbidden — the user would walk away and paste
// emptiness.

export type CopyOutcome =
  | { ok: true; via: 'clipboard-item' | 'write-text' | 'exec-command' }
  | { ok: false; error: string };

export async function copyToClipboard(text: string, html?: string): Promise<CopyOutcome> {
  const canRich =
    html !== undefined &&
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function';

  if (canRich) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return { ok: true, via: 'clipboard-item' };
    } catch {
      // Fall through — Firefox may reject rich items in some builds.
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, via: 'write-text' };
  } catch (e) {
    const fallback = execCommandCopy(text);
    if (fallback) return { ok: true, via: 'exec-command' };
    return {
      // A raw browser message passes through the UI translator unchanged; our
      // own fallback is an i18n key ('clipboard_denied').
      ok: false,
      error: e instanceof Error ? e.message : 'clipboard_denied',
    };
  }
}

/**
 * The last-resort path. Deprecated, synchronous, and it still works when the
 * async API refuses. Uses a detached <textarea> + `execCommand`, never
 * `innerHTML` and never `eval` (design §7.1).
 */
function execCommandCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
