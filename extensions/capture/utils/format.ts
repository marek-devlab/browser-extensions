// Small, REAL formatting + safety helpers (no mock, no todoLogic). Filename
// sanitisation in particular is a genuine security surface (design §9.4), so it
// is implemented for real even in the scaffold.

/** Human byte size. Uses base-1024 with a single decimal, localise-friendly. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} Б`;
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

/** `mm:ss` or `h:mm:ss` from milliseconds. The recorder window's live timer. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/** C0 control chars (\x00-\x1F) + DEL (\x7F). Escape sequences only — no literal
 *  control bytes in the source. Stripped from filenames before download. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

/**
 * Sanitise a user filename BEFORE downloads.download (design §9.4). The template
 * is user-controlled, so this is a real injection surface:
 *   - strip path traversal (../ ..\ leading / \) and drive/ADS colons;
 *   - strip control chars and the Windows-illegal set <>:"/\|?*;
 *   - prefix reserved device names (CON, NUL, COM1…) with `_`;
 *   - clamp to 255 BYTES in UTF-8 (not chars).
 * `downloads.download` also rejects absolute paths, but relying on that alone is
 * a bad habit (design §9.4).
 */
export function sanitizeFilename(name: string): string {
  let out = name
    .replace(CONTROL_CHARS, '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\.{2,}/g, '.') // collapse .. runs so no traversal survives
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();

  const base = out.split('.')[0]?.toUpperCase() ?? '';
  if (WINDOWS_RESERVED.has(base)) out = `_${out}`;

  // Clamp to 255 UTF-8 bytes.
  const enc = new TextEncoder();
  while (enc.encode(out).length > 255) out = out.slice(0, -1);

  return out || 'capture';
}

/** Expand a filename template. `{host}` MUST come from URL(tab.url).hostname, not
 *  document.title (page-controlled — design §9.4). Result is then sanitised. */
export function expandTemplate(
  template: string,
  vars: { host: string; date: string; time: string },
): string {
  const raw = template
    .replaceAll('{host}', vars.host)
    .replaceAll('{date}', vars.date)
    .replaceAll('{time}', vars.time);
  return sanitizeFilename(raw);
}
