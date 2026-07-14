/**
 * Shared domain types for all three extensions.
 *
 * They ship separately because the Chrome Web Store requires "a single purpose
 * that is narrow and easy to understand" and forbids "bundles of unrelated
 * functionality". Each extension's purpose fits in one phrase:
 *
 *   blur    — hide unwanted content on web pages
 *   adblock — block ads and trackers
 *   perf    — measure page performance
 *   seo     — audit page markup and accessibility
 *
 * `perf` and `seo` are separate specifically because `perf` needs the
 * `debugger` permission (full CDP access, and a non-dismissable "extension is
 * debugging this browser" banner) to measure real transferred bytes. Shipping
 * that alongside a meta-tag inspector invites the reviewer's obvious question —
 * why does an SEO tool need to debug my browser? `seo` therefore gets by on
 * `activeTab` + `scripting` alone.
 *
 * These types are the shared contract. Nothing here touches browser APIs —
 * `@blur/core` stays pure so it can be imported from background, content
 * scripts, popups and devtools panels alike. (The feature logic that consumes
 * these types is fully implemented in each extension and verified end-to-end.)
 */

/* ================================================================== */
/* Shared                                                             */
/* ================================================================== */

/** Hostnames where an extension disables itself entirely. */
export type Allowlist = string[];

/* ================================================================== */
/* Extension 1 — Blur                                                 */
/* ================================================================== */

/** Each blur target is an independently toggleable feature (PLAN.md §4). */
export interface BlurSettings {
  images: boolean;
  video: boolean;
  /** `<video poster>` and CSS background-image thumbnails. */
  posters: boolean;
  text: boolean;
  /** Gaussian radius in CSS pixels. Keep modest: cost scales with radius x area. */
  radius: number;
  reveal: RevealMode;
  /** Keywords/regex sources for the text blur feature. */
  textPatterns: string[];
}

export type RevealMode = 'hover' | 'click' | 'never';

export interface BlurExtensionSettings {
  enabled: boolean;
  blur: BlurSettings;
  allowlist: Allowlist;
}

/** Per-site override for the blur extension. Absent fields fall back to globals. */
export interface BlurSiteConfig {
  hostname: string;
  enabled?: boolean;
  blur?: Partial<BlurSettings>;
}

/** Counted exactly — the content script knows precisely what it blurred. */
export interface BlurTabStats {
  tabId: number;
  hostname: string;
  imagesBlurred: number;
  videosBlurred: number;
  textMatchesBlurred: number;
}

/* ================================================================== */
/* Extension 2 — AdBlock                                              */
/* ================================================================== */

/**
 * Strictness levels mirror uBlock Origin Lite's Basic/Optimal/Complete model.
 * Only `aggressive` turns on generic cosmetic filtering — that is what breaks
 * sites and costs CPU.
 */
export type AdBlockLevel = 'off' | 'standard' | 'aggressive';

export interface AdBlockSettings {
  /**
   * Strictness preset. Selecting one sets the per-list toggles below to that
   * preset's defaults; the user can then flip individual lists independently
   * (see `adBlockPresetForLevel`). `aggressive` additionally turns on generic
   * cosmetic filtering (the tier that breaks sites), which the level — not any
   * single list toggle — still governs.
   */
  level: AdBlockLevel;
  /** EasyList (the core ad list). Independently toggleable in Filter lists. */
  blockAds: boolean;
  /** EasyPrivacy / AdGuard Tracking Protection rulesets. */
  blockTrackers: boolean;
  /** Strip utm_*, fbclid, gclid via DNR removeParams (an "unsafe" rule: 5k cap). */
  stripTrackingParams: boolean;
  /** Annoyance lists: cookie banners, newsletter modals. On at `aggressive`. */
  blockAnnoyances: boolean;
}

export interface AdBlockExtensionSettings {
  enabled: boolean;
  adblock: AdBlockSettings;
  allowlist: Allowlist;
}

export interface AdBlockSiteConfig {
  hostname: string;
  enabled?: boolean;
  adblock?: Partial<AdBlockSettings>;
}

/**
 * Counting accuracy differs per browser (PLAN.md §6).
 *
 * - Firefox: exact, via blocking webRequest, which Mozilla kept in MV3.
 * - Chromium/Safari: `onRuleMatchedDebug` is dev-mode only, and
 *   `getMatchedRules()` is capped at 20 calls / 10 min with a 5-minute recency
 *   window. So network counts are approximate and on-demand only; cosmetic
 *   element hides are the only thing we count exactly.
 *
 * The UI must never present an approximate number as if it were exact.
 */
export type CountAccuracy = 'exact' | 'approximate';

export interface AdBlockTabStats {
  tabId: number;
  hostname: string;
  /** Elements hidden by cosmetic filtering. Counted exactly, everywhere. */
  cosmeticHidden: number;
  /** Network requests blocked. See CountAccuracy. */
  networkBlocked: number;
  trackersBlocked: number;
  accuracy: CountAccuracy;
}

export interface AggregateStats {
  today: number;
  week: number;
  total: number;
  accuracy: CountAccuracy;
  /** ISO date of the bundled filter list build. */
  filterListVersion: string;
}

/** One bundled DNR static ruleset, toggled by strictness level. */
export interface FilterList {
  id: string;
  title: string;
  /** Approximate DNR rule count — the 30,000 guaranteed budget is per extension. */
  ruleCount: number;
  enabledAt: AdBlockLevel[];
  license: string;
}

/* ================================================================== */
/* Extension 3 — Performance & Network                                */
/* ================================================================== */

export type VitalRating = 'good' | 'needs-improvement' | 'poor';

export interface WebVital {
  name: 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB';
  value: number;
  unit: 'ms' | 'score';
  rating: VitalRating;
  /** From the web-vitals attribution build: the element that caused it. */
  attribution?: string;
}

export type ResourceKind =
  | 'document'
  | 'script'
  | 'stylesheet'
  | 'image'
  | 'font'
  | 'xhr'
  | 'media'
  | 'other';

export interface NetworkEntry {
  url: string;
  kind: ResourceKind;
  duration: number;
  /**
   * Bytes on the wire, or null when unknowable.
   *
   * `PerformanceResourceTiming.transferSize` returns 0 for cross-origin
   * resources without a `Timing-Allow-Origin` header — which is most of them.
   * We model that honestly as `null`, never as `0`.
   */
  transferSize: number | null;
  thirdParty: boolean;
  blocked: boolean;
}

/** Where a byte total came from, so the UI can caveat it correctly (PLAN.md §9). */
export type ByteSource =
  /** Resource Timing. Undercounts cross-origin without Timing-Allow-Origin. */
  | 'resource-timing'
  /** DevTools HAR `_transferSize`. Accurate, requires DevTools open. */
  | 'devtools-har'
  /** CDP `Network.loadingFinished.encodedDataLength`. Accurate, shows a debugger banner. */
  | 'cdp-debugger'
  /**
   * Firefox's `webRequest.onCompleted.responseSize`. Accurate, and unlike the
   * CDP path it costs no debugger banner. Chrome's `webRequest` has no size
   * field at all, so this source only ever exists on Firefox.
   */
  | 'webrequest';

export interface PageInsight {
  hostname: string;
  requestCount: number;
  /** Sum of the bytes we could actually measure. */
  measuredBytes: number;
  /** How many requests reported no size at all. */
  unmeasuredRequests: number;
  byteSource: ByteSource;
  thirdPartyDomains: string[];
  byKind: Record<ResourceKind, number>;
}

/* ================================================================== */
/* Extension 4 — SEO & Accessibility                                  */
/* ================================================================== */

export type SeoSeverity = 'ok' | 'warning' | 'error';

export interface SeoCheck {
  id: string;
  label: string;
  severity: SeoSeverity;
  detail: string;
}

export interface SocialPreview {
  /** Open Graph and Twitter card fields, as authored. */
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  twitterCard: string | null;
}

export interface SeoReport {
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  hreflang: { lang: string; href: string }[];
  headings: { level: number; text: string }[];
  imagesWithoutAlt: number;
  /** Count of JSON-LD / microdata blocks found in the DOM. */
  structuredDataBlocks: number;
  social: SocialPreview;
  checks: SeoCheck[];
}

/** axe-core impact levels, mirrored so core stays dependency-free. */
export type A11yImpact = 'minor' | 'moderate' | 'serious' | 'critical';

export interface A11yViolation {
  id: string;
  impact: A11yImpact;
  help: string;
  /** CSS selectors of the offending nodes. */
  nodes: string[];
  helpUrl: string;
}

export interface A11yReport {
  violations: A11yViolation[];
  passes: number;
  incomplete: number;
}

/* ================================================================== */
/* Messaging protocols — one per extension                            */
/* ================================================================== */

export interface BlurProtocol {
  getSettings(): BlurExtensionSettings;
  setSettings(next: BlurExtensionSettings): void;
  getTabStats(tabId: number): BlurTabStats;
  toggleSite(hostname: string): boolean;
  /** Ask the content script to reveal everything on the page, temporarily. */
  revealAll(tabId: number): void;
}

export interface AdBlockProtocol {
  getSettings(): AdBlockExtensionSettings;
  setSettings(next: AdBlockExtensionSettings): void;
  getTabStats(tabId: number): AdBlockTabStats;
  getAggregateStats(): AggregateStats;
  getFilterLists(): FilterList[];
  toggleSite(hostname: string): boolean;
}

export interface PerfProtocol {
  getWebVitals(tabId: number): WebVital[];
  getPageInsight(tabId: number): PageInsight;
  getNetworkEntries(tabId: number): NetworkEntry[];
  /** Attach the debugger and measure real bytes. Requires explicit user consent. */
  measureExactBytes(tabId: number): PageInsight;
}

export interface SeoProtocol {
  getSeoReport(tabId: number): SeoReport;
  runA11yAudit(tabId: number): A11yReport;
}
