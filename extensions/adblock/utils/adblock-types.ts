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
 * The user's own cosmetic selectors, keyed by host. The special key `'*'` means
 * "all sites" (a generic user rule). Values are raw CSS selectors that the
 * content script feeds to the same DomRuleEngine as `display:none` rules.
 */
export type CustomFilters = Record<string, string[]>;

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
