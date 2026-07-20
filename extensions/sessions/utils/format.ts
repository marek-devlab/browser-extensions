import type { TT } from './i18n';

// Small presentation helpers shared by the popup and the manager. Pure formatting;
// no browser/storage.

/** Human-readable byte size (1.2 MB / 340 KB). Locale-neutral units on purpose. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function tabsLabel(t: TT, n: number): string {
  return n === 1 ? t('tabsCountOne') : t('tabsCount', { n });
}

export function windowsLabel(t: TT, n: number): string {
  return n === 1 ? t('windowsCountOne') : t('windowsCount', { n });
}

/** A relative-ish timestamp for a saved session ("just now", else local date). */
export function formatWhen(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'now';
  const d = new Date(ms);
  return d.toLocaleString();
}
