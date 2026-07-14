import { storage } from '#imports';

// Storage layout — 🔴 PREFERENCES ONLY (design §0, §3, §6.2).
//
// Everything here lives in `storage.local` (never `sync`): the ipinfo token in
// `sync` would propagate a secret across every device the user owns, and the
// blur `sync` 8 KB quota already bit us once (PLAN.md §18a). None of this is data
// ABOUT the user — it is theme, units, a provider choice, a token the user typed,
// and three boolean/enum CONSENT flags. Storing consent booleans is fine; storing
// the ANSWER is not.
//
// 🔴 THE SCHEMA PHYSICALLY HAS NO PLACE FOR AN IP. There is no `lastIp`, no
// `ipHistory`, no `country`, no `asn`, no `fingerprintHash`, no `installId`, no
// `analyticsOptIn` — and there never will be. The IP/country/ISP the network half
// fetches lives in React state in the popup/report document and dies with it (no
// background SW → nowhere to write it). That is what makes "IP is never persisted"
// architecturally true rather than a promise (design §5.3).
//
// TODO(test): `utils/settings.spec.ts` must assert `Object.keys(defaults)` deep-
// equals `SETTINGS_KEYS` below, so the suite FAILS the moment anyone adds a key
// like `lastIp`. That turns §5.3 into a CI check instead of a code-review hope.

export type Theme = 'auto' | 'light' | 'dark';
export type Units = 'GB' | 'GiB';
export type CopyFormat = 'md' | 'json' | 'kv';
export type IspProvider = 'ipinfo' | 'ipapi' | 'off';
/** Consent is a boolean-ish flag, NOT data. `granted` skips re-prompting;
 *  `never` hides the button for good; `unset` is the untouched default. */
export type Consent = 'unset' | 'granted' | 'never';

export interface WhoamiSettings {
  /** Appearance. */
  theme: Theme;
  units: Units;
  copyFormat: CopyFormat;
  /** Show the "Show my IP" button at all (the button, NOT an automatic request). */
  allowCloudflare: boolean;
  /** Consent for the Cloudflare trace call. Set by the first click, never in a form. */
  cfConsent: Consent;
  /** 🔴 Fetch the IP automatically on popup open. Defaults false — this default is
   *  literally what keeps AMO `data_collection_permissions.required` at `['none']`
   *  (design §6.3). Only reachable once `cfConsent === 'granted'`. */
  autoFetchIp: boolean;
  /** Which third party answers ISP/ASN; `off` hides the ISP button entirely. */
  ispProvider: IspProvider;
  /** ipinfo.io token. 🔴 local only, never sync, never included in any export/copy. */
  ipinfoToken: string;
  /** Consent for the ISP lookup. Set in the `<dialog>`, reconciled against the
   *  browser's own `permissions.contains()` on every mount (browser = source of truth). */
  ispConsent: Consent;
  /** Report-page toggle. 🔴 `false` HIDES an unavailable row — it never renders it as "—". */
  showUnavailable: boolean;
}

/**
 * The canonical, CLOSED set of setting keys. Referenced by the unit test that
 * guards §5.3 (see TODO above). Keep in lockstep with `WhoamiSettings`.
 */
export const SETTINGS_KEYS = [
  'theme',
  'units',
  'copyFormat',
  'allowCloudflare',
  'cfConsent',
  'autoFetchIp',
  'ispProvider',
  'ipinfoToken',
  'ispConsent',
  'showUnavailable',
] as const satisfies readonly (keyof WhoamiSettings)[];

export const DEFAULT_SETTINGS: WhoamiSettings = {
  theme: 'auto',
  units: 'GB',
  copyFormat: 'md',
  allowCloudflare: true,
  cfConsent: 'unset',
  autoFetchIp: false,
  ispProvider: 'ipinfo',
  ipinfoToken: '',
  ispConsent: 'unset',
  showUnavailable: true,
};

export const settingsItem = storage.defineItem<WhoamiSettings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
  version: 1,
  migrations: {
    // Populate as the prefs schema changes, e.g. `2: (old) => ({ ...old })`.
    // 🔴 A migration must NEVER introduce a key that holds an IP/identifier.
  },
});
