// 🔴 REAL LOGIC (not a stub). Filename sanitizer + template expansion.
//
// Small, security-relevant, platform-independent → implemented for real (the
// brief permits it). The design (§8.2) requires ALL of these steps, in order,
// because we DISPLAY the resulting name in the preview dialog and must show
// exactly what will be written — we cannot lean on the browser's own `download`
// sanitization, which differs between Chrome and Firefox.

/** Placeholder set the template understands (design §2.5). */
export interface FilenameFields {
  host: string;
  title: string;
  caption: string;
  date: string;
  time: string;
  index: string;
  rows: string;
  cols: string;
}

const RESERVED_WINDOWS = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

// Bidi control chars (U+202A–202E embeddings/overrides, U+2066–2069 isolates,
// U+200E/200F marks). Escaped so no invisible characters live in the source.
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;
// C0/C1 control chars (U+0000–U+001F, U+007F).
const CONTROL = /[\u0000-\u001F\u007F]/g;

// Minimal ICAO-style Cyrillic transliteration (design §2.5). 🔴 A full
// transliterator belongs to `compose` (PLAN-2 §6.6) — this is only enough to keep
// a filename portable, not a feature with its own entry point.
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia',
};

function transliterate(input: string): string {
  let out = '';
  for (const ch of input) {
    const lower = ch.toLowerCase();
    const mapped = TRANSLIT[lower];
    if (mapped === undefined) {
      out += ch;
    } else {
      // Preserve capitalization roughly.
      out += ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
    }
  }
  return out;
}

/** Expand `{host}-{caption}-{date}` etc. against the given fields. */
export function expandTemplate(template: string, fields: FilenameFields): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const value = (fields as unknown as Record<string, string | undefined>)[key];
    return value ?? '';
  });
}

/**
 * Sanitize a base filename (WITHOUT extension). Steps mirror design §8.2 exactly.
 * The extension is added by the caller from the FORMAT — 🔴 never taken from user
 * input.
 */
export function sanitizeBaseName(input: string, translit = true): string {
  let s = input;

  // 2. Strip bidi control chars (🔴 RTL-override is a real exe-masquerade vector).
  s = s.replace(BIDI, '');
  // 3. Strip C0/C1 control chars.
  s = s.replace(CONTROL, '');
  // 4. Replace path/reserved separators; collapse `..` traversal explicitly.
  s = s.replace(/[<>:"/\\|?*]/g, '-').replace(/\.\.+/g, '_');
  // 5. NFC normalize, optional translit.
  s = s.normalize('NFC');
  if (translit) s = transliterate(s);
  // Collapse whitespace runs to single hyphens for a tidy filename.
  s = s.replace(/\s+/g, '-').replace(/-+/g, '-');
  // 7. Trailing dots/spaces (Windows silently trims → mismatch with what we show).
  s = s.replace(/[. ]+$/g, '').replace(/^-+|-+$/g, '');
  // 6. Reserved Windows device names (incl. with a would-be extension, any case).
  const stem = s.split('.')[0]?.toUpperCase() ?? '';
  if (RESERVED_WINDOWS.has(stem)) s = `_${s}`;
  // 8. Clamp base to 80 chars (bytes matter on FS; Cyrillic is 2 bytes in UTF-8,
  //    and the browser may append a "(1)" suffix — design §8.2).
  if (s.length > 80) s = s.slice(0, 80).replace(/-+$/g, '');
  // 9. Empty after everything → a safe default.
  if (s === '') s = 'export';
  return s;
}

/** Build the full displayed filename: sanitized base + our extension. */
export function buildFilename(
  template: string,
  fields: FilenameFields,
  ext: string,
  translit = true,
): string {
  const base = sanitizeBaseName(expandTemplate(template, fields), translit);
  return `${base}.${ext}`;
}
