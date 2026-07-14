import type { DomRule } from '@blur/core';
import type { CustomFilters, ParsedCosmeticFilter } from './adblock-types';

/** The "all sites" key for a generic (non-site-specific) user cosmetic rule. */
export const ALL_SITES = '*';

/**
 * True if a stored custom-filter key applies to `hostname`. `'*'` is generic;
 * a bare host matches itself and its subdomains.
 */
export function keyAppliesTo(key: string, hostname: string): boolean {
  if (key === ALL_SITES) return true;
  return hostname === key || hostname.endsWith(`.${key}`);
}

/**
 * Build `DomRule[]` (action `hide`) from the user's custom filters that apply to
 * `hostname`. Generic (`'*'`) rules carry no `hostnames`; site rules are scoped
 * to their host so the engine's stylesheet and our counting agree.
 */
export function customRulesForHost(filters: CustomFilters, hostname: string): DomRule[] {
  const out: DomRule[] = [];
  for (const [key, selectors] of Object.entries(filters)) {
    if (!keyAppliesTo(key, hostname)) continue;
    for (const selector of selectors) {
      out.push(
        key === ALL_SITES
          ? { selector, action: 'hide' }
          : { selector, action: 'hide', hostnames: [key] },
      );
    }
  }
  return out;
}

/** Immutably add a selector under `host` (deduped). Returns a new object. */
export function addFilter(filters: CustomFilters, host: string, selector: string): CustomFilters {
  const key = host || ALL_SITES;
  const sel = selector.trim();
  if (!sel) return filters;
  const existing = filters[key] ?? [];
  if (existing.includes(sel)) return filters;
  return { ...filters, [key]: [...existing, sel] };
}

/** Immutably remove one selector under `host`; drops the key if it empties. */
export function removeFilter(filters: CustomFilters, host: string, selector: string): CustomFilters {
  const existing = filters[host];
  if (!existing) return filters;
  const next = existing.filter((s) => s !== selector);
  const copy = { ...filters };
  if (next.length === 0) delete copy[host];
  else copy[host] = next;
  return copy;
}

/**
 * Parse EasyList-syntax cosmetic filters (feature §6). Supports:
 *   ##selector            → generic hide (all sites)
 *   host.com##selector    → site-specific hide
 *   host1,host2##selector → multiple hosts
 * Network rules (lines without `##`) and cosmetic EXCEPTIONS (`#@#`) are ignored
 * with the reason returned, so the UI can report what it skipped. Blank lines and
 * `!` comments are skipped silently.
 */
export function parseCosmeticFilters(text: string): {
  filters: ParsedCosmeticFilter[];
  skipped: { line: string; reason: string }[];
} {
  const filters: ParsedCosmeticFilter[] = [];
  const skipped: { line: string; reason: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    if (line.includes('#@#')) {
      skipped.push({ line, reason: 'cosmetic exception (#@#) not supported' });
      continue;
    }
    const idx = line.indexOf('##');
    if (idx === -1) {
      skipped.push({ line, reason: 'not a cosmetic rule (no ##) — network rules use DNR' });
      continue;
    }
    const hostPart = line.slice(0, idx);
    const selector = line.slice(idx + 2).trim();
    if (!selector) {
      skipped.push({ line, reason: 'empty selector' });
      continue;
    }
    // AdGuard extended-syntax cosmetics (`:has-text`, `:contains`, `:style` …)
    // are not plain CSS and would throw in querySelector — skip them.
    if (/:-abp-|:has-text|:contains\(|:style\(|:matches-css|:xpath\(/.test(selector)) {
      skipped.push({ line, reason: 'extended (non-CSS) cosmetic syntax not supported' });
      continue;
    }
    const hosts = hostPart ? hostPart.split(',').map((h) => h.trim()).filter(Boolean) : [ALL_SITES];
    for (const host of hosts) filters.push({ host, selector });
  }
  return { filters, skipped };
}

/** Merge parsed filters into an existing map (immutably). */
export function mergeParsed(
  filters: CustomFilters,
  parsed: ParsedCosmeticFilter[],
): CustomFilters {
  let next = filters;
  for (const { host, selector } of parsed) next = addFilter(next, host, selector);
  return next;
}

/** Serialize custom filters back to EasyList cosmetic text (for export/edit). */
export function toFilterText(filters: CustomFilters): string {
  const lines: string[] = [];
  for (const [host, selectors] of Object.entries(filters)) {
    for (const selector of selectors) {
      lines.push(host === ALL_SITES ? `##${selector}` : `${host}##${selector}`);
    }
  }
  return lines.join('\n');
}
