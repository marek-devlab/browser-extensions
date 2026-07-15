import type { DomRule } from '@blur/core';
import type {
  CustomFilterEntry,
  CustomFilters,
  ParsedCosmeticFilter,
  StoredFilter,
} from './adblock-types';

/** The "all sites" key for a generic (non-site-specific) user cosmetic rule. */
export const ALL_SITES = '*';

/**
 * Guard against CSS injection through an untrusted cosmetic selector. The engine
 * interpolates every stored selector RAW into `${sel} { display: none !important }`
 * (see @blur/core buildStylesheet), so a payload like `x} input[value^=a]{…}`
 * closes our rule early and injects an attacker-controlled one — a form-value
 * exfiltration vector on EVERY page. Two checks, since neither alone suffices:
 *   - a character denylist for `{`, `}`, `@`, `<` and the CSS comment-closer (the
 *     break-out characters; none is valid in a plain selector). `querySelector`
 *     accepts some of these payloads, so this is mandatory.
 *   - `document.querySelector(sel)` in try/catch — a syntactically invalid
 *     selector throws and is dropped (skipped when there's no DOM, e.g. Node
 *     unit tests, where the denylist still applies).
 * Callers drop an unsafe selector INDIVIDUALLY, so one bad rule never poisons the
 * whole stylesheet. (Kept in-file rather than a shared module so the pure parser
 * stays resolvable by the Node logic test — no cross-module value import.)
 */
const SELECTOR_BREAKOUT = /[{}@<]|\*\//;
export function isSafeCosmeticSelector(selector: string): boolean {
  const sel = selector.trim();
  if (!sel) return false;
  if (SELECTOR_BREAKOUT.test(sel)) return false;
  if (typeof document !== 'undefined') {
    try {
      document.querySelector(sel);
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * True if a stored custom-filter key applies to `hostname`. `'*'` is generic;
 * a bare host matches itself and its subdomains.
 */
export function keyAppliesTo(key: string, hostname: string): boolean {
  if (key === ALL_SITES) return true;
  return hostname === key || hostname.endsWith(`.${key}`);
}

/* ---------------------------------------------------------------------------
 * Reading the two stored shapes.
 *
 * Every read goes through these, so a pre-existing v1 filter (a bare selector
 * string, no label) is never a special case anywhere else in the codebase: it
 * simply arrives as an entry with `label: undefined` and the UI degrades to
 * showing the raw selector — the old behaviour, exactly.
 * ------------------------------------------------------------------------- */

/** The CSS selector of a stored rule, whichever shape it is in. */
export function entrySelector(stored: StoredFilter): string {
  return typeof stored === 'string' ? stored : stored.selector;
}

/** Normalize a stored rule (legacy string OR labelled object) to an entry. */
export function toEntry(stored: StoredFilter): CustomFilterEntry {
  return typeof stored === 'string' ? { selector: stored } : stored;
}

/** Every rule stored under exactly `host`, normalized. */
export function entriesFor(filters: CustomFilters, host: string): CustomFilterEntry[] {
  return (filters[host] ?? []).map(toEntry);
}

/** A rule that is hiding something on the current page, plus the key it lives under. */
export interface HiddenElement extends CustomFilterEntry {
  /** The storage key: a hostname, or `'*'` for a rule that applies to all sites. */
  host: string;
}

/**
 * Everything the user's own filters are currently hiding on `hostname` — the
 * data behind the popup's "Hidden on this site" list. Newest first: the thing you
 * just blocked (and most likely regret) is at the top.
 */
export function hiddenElementsFor(filters: CustomFilters, hostname: string): HiddenElement[] {
  const out: HiddenElement[] = [];
  for (const [key, stored] of Object.entries(filters)) {
    if (!keyAppliesTo(key, hostname)) continue;
    for (const s of stored) out.push({ host: key, ...toEntry(s) });
  }
  // Legacy entries have no `added` and sort last — they are also the oldest.
  return out.sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
}

/**
 * "Restore everything on this site": drop every SITE-SCOPED key that applies to
 * `hostname`. Generic (`'*'`) rules are deliberately left alone — they were never
 * about this site, and silently deleting a cross-site rule from a per-site escape
 * hatch would be a nasty surprise. The popup restores those one by one instead,
 * with each shown as "all sites".
 */
export function removeSiteFilters(filters: CustomFilters, hostname: string): CustomFilters {
  const copy = { ...filters };
  for (const key of Object.keys(filters)) {
    if (key !== ALL_SITES && keyAppliesTo(key, hostname)) delete copy[key];
  }
  return copy;
}

/**
 * Build `DomRule[]` (action `hide`) from the user's custom filters that apply to
 * `hostname`. Generic (`'*'`) rules carry no `hostnames`; site rules are scoped
 * to their host so the engine's stylesheet and our counting agree.
 */
export function customRulesForHost(filters: CustomFilters, hostname: string): DomRule[] {
  const out: DomRule[] = [];
  for (const [key, stored] of Object.entries(filters)) {
    if (!keyAppliesTo(key, hostname)) continue;
    for (const entry of stored) {
      const selector = entrySelector(entry);
      out.push(
        key === ALL_SITES
          ? { selector, action: 'hide' }
          : { selector, action: 'hide', hostnames: [key] },
      );
    }
  }
  return out;
}

/**
 * Immutably add a selector under `host` (deduped by selector, across both stored
 * shapes). Returns a new object.
 *
 * `meta.label` is the human description captured by the element picker. Rules
 * added WITHOUT one (typed into Options, pasted EasyList text, imported backup)
 * are stored as bare selector strings — byte-identical to the v1 format — so the
 * stored document only grows the new shape where there is genuinely something
 * extra to say.
 */
export function addFilter(
  filters: CustomFilters,
  host: string,
  selector: string,
  meta: { label?: string; added?: number } = {},
): CustomFilters {
  const key = host || ALL_SITES;
  const sel = selector.trim();
  if (!sel) return filters;
  // Drop a selector that could break out of the `{ display:none }` rule it will
  // be interpolated into (CSS-injection / form-value exfiltration). See
  // cosmetic-safety.ts — every write funnels through addFilter.
  if (!isSafeCosmeticSelector(sel)) return filters;
  const existing = filters[key] ?? [];
  if (existing.some((e) => entrySelector(e) === sel)) return filters;
  const label = meta.label?.trim();
  const entry: StoredFilter = label
    ? { selector: sel, label, added: meta.added ?? Date.now() }
    : sel;
  return { ...filters, [key]: [...existing, entry] };
}

/**
 * Immutably remove one selector under `host`; drops the key if it empties. This
 * is the single "restore" primitive: the toast's Undo, the popup's per-item
 * Restore and the Options list's Remove all funnel through it, and the content
 * script's storage watcher re-applies, un-hiding the element in every open tab.
 */
export function removeFilter(filters: CustomFilters, host: string, selector: string): CustomFilters {
  const existing = filters[host];
  if (!existing) return filters;
  const next = existing.filter((e) => entrySelector(e) !== selector);
  if (next.length === existing.length) return filters;
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
    // A selector carrying `{`/`}`/`@`/`<` can break out of the injected rule and
    // exfiltrate form values (see cosmetic-safety.ts). Drop it with a reason.
    if (!isSafeCosmeticSelector(selector)) {
      skipped.push({ line, reason: 'unsafe selector (would break out of the CSS rule)' });
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

/**
 * Serialize custom filters back to EasyList cosmetic text (for export/edit). The
 * label is intentionally NOT serialized: this is interchange format that other
 * blockers must be able to read, and a rule's identity is its selector.
 */
export function toFilterText(filters: CustomFilters): string {
  const lines: string[] = [];
  for (const [host, stored] of Object.entries(filters)) {
    for (const entry of stored) {
      const selector = entrySelector(entry);
      lines.push(host === ALL_SITES ? `##${selector}` : `${host}##${selector}`);
    }
  }
  return lines.join('\n');
}
