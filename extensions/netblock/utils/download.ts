// File export without the `downloads` permission (design §2.5, same ladder as
// `export`): a Blob from a same-origin (blob:) URL + `<a download>` goes
// through the browser's normal download dialog. The object URL is revoked on
// the next tick — Firefox needs the anchor's click to have been dispatched
// before the URL disappears.

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `2026-09-15T12-04-11` — filesystem-safe timestamp for export names. */
export function fileStamp(now = new Date()): string {
  return now.toISOString().slice(0, 19).replace(/:/g, '-');
}
