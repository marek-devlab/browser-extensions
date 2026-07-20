// Result formatting via `Intl.NumberFormat`, so grouping and the decimal mark
// follow the user's chosen locale. PURE. Symbols are appended by the caller — this
// only shapes the number.

/**
 * Format a converted value with `sigDigits` significant figures. Falls back to
 * scientific notation for the very large / very small, where fixed notation would
 * be an unreadable wall of zeros. `Infinity` (e.g. 0 L/100km) renders as ∞; a
 * non-finite value renders as "—" so a fabricated number never appears.
 */
export function formatNumber(value: number, locale: string, sigDigits: number): string {
  if (value === Infinity || value === -Infinity) return value > 0 ? '∞' : '−∞';
  if (!Number.isFinite(value)) return '—';

  const digits = Math.min(21, Math.max(1, Math.round(sigDigits)));
  const abs = Math.abs(value);
  const scientific = value !== 0 && (abs >= 1e15 || abs < 1e-6);

  try {
    return new Intl.NumberFormat(locale, {
      notation: scientific ? 'scientific' : 'standard',
      maximumSignificantDigits: digits,
    }).format(value);
  } catch {
    return String(value);
  }
}
