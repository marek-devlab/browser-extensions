import type { AdBlockSiteConfig } from '@blur/core';

/**
 * The extension's own per-site config. `@blur/core`'s `AdBlockSiteConfig` is
 * read-only, so the adblock-specific `disableCosmetic` flag is added here rather
 * than upstream. Stored in `local:siteConfigs`.
 */
export interface AdBlockSiteConfigX extends AdBlockSiteConfig {
  /**
   * Per-site "disable cosmetic filtering only" — distinct from the full
   * allowlist. When true the content script hides nothing, but network/DNR
   * blocking keeps running. Absent/false means cosmetic filtering runs normally.
   */
  disableCosmetic?: boolean;
}

/**
 * One user cosmetic rule, with the human description captured when the element
 * was picked. The selector alone (`div.sc-a1b2c3 > .promo-box:nth-child(3)`) is
 * unrecognisable a day later — which is precisely why nobody ever undid a
 * mis-click. The label is what makes the popup's "Hidden on this site" list
 * readable, and it can only be captured at pick time, while the element still
 * has text and a layout box.
 */
export interface CustomFilterEntry {
  selector: string;
  /** e.g. `Image · 300×250`, `Block “Subscribe now” · 728×90`. See element-label.ts. */
  label?: string;
  /** Epoch ms the rule was added, so the popup can list newest-first. */
  added?: number;
}

/**
 * How ONE rule is stored. The v1 format was a bare selector string; the labelled
 * form is an object. Both are valid and both are read — see custom-filters.ts.
 *
 * SCHEMA COMPATIBILITY (deliberate, not laziness): the new shape is a strict
 * SUPERSET of the old one, so every filter a user already has stays valid v2 data
 * and needs no rewrite — there is no migration step that could drop or corrupt
 * them. Un-labelled rules (typed into Options, pasted from EasyList, restored from
 * an old backup) keep being written as bare strings, so the stored document does
 * not churn either. A rule with no label simply degrades to showing its selector.
 */
export type StoredFilter = string | CustomFilterEntry;

/**
 * The user's own cosmetic selectors, keyed by host. The special key `'*'` means
 * "all sites" (a generic user rule). Values feed the same DomRuleEngine as
 * `display:none` rules.
 */
export type CustomFilters = Record<string, StoredFilter[]>;

/** A single parsed cosmetic filter: host (`'*'` = generic) + CSS selector. */
export interface ParsedCosmeticFilter {
  host: string;
  selector: string;
}

/**
 * The full exportable state (feature §4). Settings + allowlist live in
 * `settingsItem`; per-site configs and custom filters live in local storage.
 */
export interface AdBlockBackup {
  version: 1;
  settings: import('@blur/core').AdBlockExtensionSettings;
  siteConfigs: Record<string, AdBlockSiteConfigX>;
  customFilters: CustomFilters;
}
