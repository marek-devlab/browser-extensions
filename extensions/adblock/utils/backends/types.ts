import type { AdBlockLevel, CountAccuracy } from '@blur/core';

/** Network/tracker counts for one tab, tagged with how trustworthy they are. */
export interface TabCounts {
  network: number;
  trackers: number;
  accuracy: CountAccuracy;
  /**
   * Blocks grouped by filter list (ruleset id) for this tab, so the popup can
   * show which lists the site's traffic matched. Absent when unmeasured.
   */
  byList?: Record<string, number>;
}

/** A tab's counts plus its id — used to fold ALL tabs' blocks into the aggregate. */
export interface TabCountEntry extends TabCounts {
  tabId: number;
}

/**
 * One interface, two build-time implementations (PLAN.md §4.2):
 * `DnrBackend` (Chromium/Safari, declarative) and `WebRequestBackend` (Firefox,
 * per-request JS). The concrete class is chosen via `import.meta.env.FIREFOX` so
 * the other is tree-shaken and its permissions never ship.
 */
export interface BlockingBackend {
  start(level: AdBlockLevel): Promise<void>;
  setLevel(level: AdBlockLevel): Promise<void>;
  allowlistSite(hostname: string): Promise<void>;
  removeAllowlist(hostname: string): Promise<void>;
  getTabCounts(tabId: number): Promise<TabCounts>;
  /**
   * Every tab's counts. Firefox's blocking webRequest accrues an exact per-tab
   * tally as requests are cancelled; folding ALL of them into the aggregate on
   * the flush tick is the only way tabs the popup never opened still count
   * (the Chromium DnrBackend can't measure off-tab, so it returns []).
   */
  getAllTabCounts(): Promise<TabCountEntry[]>;
  /** Drop a tab's per-request counters when it navigates away or closes. */
  resetTab(tabId: number): void;
  stop(): Promise<void>;
}

/** Static ruleset ids declared in the manifest, toggled per strictness level. */
export const RULESET_IDS = {
  easylist: 'easylist',
  easyprivacy: 'easyprivacy',
  annoyances: 'annoyances',
} as const;

export type RulesetId = (typeof RULESET_IDS)[keyof typeof RULESET_IDS];

/**
 * Tracking parameters stripped from URLs (PLAN.md §10). Applied as a single DNR
 * `redirect` rule using `transform.queryTransform.removeParams` on Chromium, and
 * folded into the Firefox matcher's allow path (it never blocks navigations).
 */
export const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'msclkid',
  'yclid',
] as const;
