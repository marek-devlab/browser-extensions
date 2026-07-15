import { storage } from '#imports';
import type { Theme, Locale } from '@blur/ui';

// Storage layout (design §3, §9.3). TWO hard rules:
//
//   1. Everything is in `storage.local`, NOTHING in `sync`. The house rule
//      (PLAN §18a): the sync per-item quota (8,192 bytes) fails SILENTLY, and
//      there is no cross-device value in an "overweight threshold". One storage
//      class = one class of bugs.
//   2. 🔴 NOTHING about visited pages or inspected resources is ever persisted —
//      no history, no "recent", no card cache (design §13 №10). Only UI prefs and
//      the card's dragged coordinates. That is what keeps the privacy policy one
//      line long and dodges the 2026-08-01 prominent-disclosure obligations.
//
// `version` is declared from day one so the schema can evolve without wiping user
// prefs on update.

export type OverweightThreshold = 1.5 | 2 | 3 | 4 | 'off';
export type Units = 1024 | 1000;
export type RequestScope = 'related' | 'all';
export type BufferSize = 250 | 500 | 1500 | 5000;

export interface AssetsPrefs {
  /** data-theme + color-scheme. In the overlay: stamped on the shadow host. */
  theme: Theme;
  /** Weight/size unit base. Half of all devs have an allergy to the other one. */
  units: Units;
  /** Ancestor breadcrumb bar in the picker. */
  showBreadcrumbs: boolean;
  /** On a wrapper div, auto-highlight the nested img/video (the `R` key, always). */
  autoJumpToResource: boolean;
  /** Draw the canvas thumbnail. Off for those who don't want content in screenshots. */
  preview: boolean;
  /** ratio × below which the overweight section is hidden entirely (design §2.4). */
  overweightThreshold: OverweightThreshold;
  /** Expand the full srcset table by default (layout devs turn this on forever). */
  srcsetExpanded: boolean;
  /** `related` = only requests matched to the element; `all` = the whole buffer. */
  requestScope: RequestScope;
  /** Master switch for the [?] "how to get the missing data" popovers (§1.3). */
  hints: boolean;
  /** Ids of dismissed hint popovers — "show all again" clears this (§1.3). */
  hintsDismissed: string[];
  /**
   * performance.setResourceTimingBufferSize() applied on injection. Effect is on
   * the NEXT page load only; the browser discards LATE requests past the cap and
   * setResourceTimingBufferSize does not resurrect them (design §10.5).
   */
  bufferSize: BufferSize;
  /** Default sub-view for the DevTools panel. */
  panelDefault: 'resource' | 'requests';
}

export const DEFAULT_PREFS: AssetsPrefs = {
  theme: 'auto',
  units: 1024,
  showBreadcrumbs: true,
  autoJumpToResource: false,
  preview: true,
  overweightThreshold: 2,
  srcsetExpanded: false,
  requestScope: 'related',
  hints: true,
  hintsDismissed: [],
  bufferSize: 1500,
  panelDefault: 'resource',
};

export const assetsPrefsItem = storage.defineItem<AssetsPrefs>('local:prefs', {
  fallback: DEFAULT_PREFS,
  version: 1,
  migrations: {},
});

/**
 * Where the user dragged the resource-card overlay. 🔴 COORDINATES ONLY — never a
 * URL, never anything identifying the page (design §3, §9.3). null = centred.
 */
export const cardPositionItem = storage.defineItem<{ x: number; y: number } | null>(
  'local:cardPosition',
  {
    fallback: null,
    version: 1,
    migrations: {},
  },
);

/**
 * The user's chosen UI language. Independent of the browser's own UI locale and of
 * the theme; defaults to English on a fresh install (the switcher lives on the
 * options page). Read synchronously-seeded by @blur/ui's useLocaleController on the
 * React surfaces, and read directly (`await localeItem.getValue()`) when the
 * non-React inspector card and the background context menu are built.
 */
export const localeItem = storage.defineItem<Locale>('local:locale', {
  fallback: 'en',
});
