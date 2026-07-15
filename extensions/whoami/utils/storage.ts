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
// The guard is a TYPE-LEVEL assertion at the bottom of this file, so it runs in
// `npm run compile` (and therefore in CI) with no test runner. Two distinct
// checks, with DIFFERENT strengths — be precise about which is which:
//   * `_keysAreClosed` is TOTAL: `SETTINGS_KEYS` must equal `keyof WhoamiSettings`
//     exactly, so ANY new field (whatever its name) fails the build unless it is
//     also listed in SETTINGS_KEYS — a deliberate speed bump on every schema add.
//   * `_noIdentifiersInSchema` is a DENYLIST: it stops the specific well-known
//     identifier names below (`lastIp`, `fingerprintHash`, `installId`, …). It
//     canNOT catch a novel name like `visitorId` — types can't judge "is this
//     identifier-shaped". The total check is the real backstop; the denylist just
//     turns the obvious mistakes into loud ones. So the true guarantee is
//     "no field is added silently", not "no identifier can ever be named".

export type Theme = 'auto' | 'light' | 'dark';
export type Units = 'GB' | 'GiB';
export type CopyFormat = 'md' | 'json' | 'kv';
/** ⚠️ `ipapi` is deliberately ABSENT (it was in the scaffold): its free tier's
 *  commercial-use terms are unresolved (TODO.md §H, design §14.1), and a host we
 *  cannot legally call must not appear in the CSP, the manifest or this union.
 *  ipinfo.io (user's own token) or nothing. */
export type IspProvider = 'ipinfo' | 'off';
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
 * The canonical, CLOSED set of setting keys. Enforced against `WhoamiSettings`
 * by the `_keysAreClosed` compile-time assertion at the bottom of this file
 * (there is no test runner in this project). Keep in lockstep with the interface.
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

/**
 * Defensive read: `storage.local` can be corrupt, hand-edited, or hold values from
 * an older build (e.g. `ispProvider: 'ipapi'`, which no longer exists). Every field
 * is validated against its own union and falls back to the default — an unknown
 * value can never reach the UI or, worse, the fetch layer.
 */
export function normalizeSettings(raw: unknown): WhoamiSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const one = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

  const settings: WhoamiSettings = {
    theme: one(r.theme, ['auto', 'light', 'dark'] as const, DEFAULT_SETTINGS.theme),
    units: one(r.units, ['GB', 'GiB'] as const, DEFAULT_SETTINGS.units),
    copyFormat: one(r.copyFormat, ['md', 'json', 'kv'] as const, DEFAULT_SETTINGS.copyFormat),
    allowCloudflare: bool(r.allowCloudflare, DEFAULT_SETTINGS.allowCloudflare),
    cfConsent: one(r.cfConsent, ['unset', 'granted', 'never'] as const, DEFAULT_SETTINGS.cfConsent),
    autoFetchIp: bool(r.autoFetchIp, DEFAULT_SETTINGS.autoFetchIp),
    ispProvider: one(r.ispProvider, ['ipinfo', 'off'] as const, DEFAULT_SETTINGS.ispProvider),
    ipinfoToken: typeof r.ipinfoToken === 'string' ? r.ipinfoToken.slice(0, 128) : '',
    ispConsent: one(r.ispConsent, ['unset', 'granted', 'never'] as const, DEFAULT_SETTINGS.ispConsent),
    showUnavailable: bool(r.showUnavailable, DEFAULT_SETTINGS.showUnavailable),
  };

  // 🔴 Auto-fetch is only reachable AFTER an explicit Cloudflare consent. Enforced
  // on read as well as in the UI, so a hand-edited storage entry cannot turn the
  // popup into something that phones home on open (which would also invalidate the
  // AMO `required: ['none']` claim — design §6.3).
  if (settings.cfConsent !== 'granted') settings.autoFetchIp = false;
  return settings;
}

/* --------------------------------------------------------------------------- */
/* 🔴 §5.3 AS A COMPILE-TIME CHECK, not a code-review hope. Both assertions run   */
/* in `npm run compile`; neither costs a byte at runtime.                        */
/* --------------------------------------------------------------------------- */

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/** `SETTINGS_KEYS` must list exactly the keys of `WhoamiSettings` — no more, no
 *  fewer. Adding a field without listing it here fails the typecheck. */
const _keysAreClosed: Exact<(typeof SETTINGS_KEYS)[number], keyof WhoamiSettings> = true;

/** 🔴 Denylist of well-known identifier names. Adding any of these to the schema
 *  stops the build. This is a backstop for the obvious mistakes — the TOTAL
 *  guarantee (no field added silently, whatever its name) is `_keysAreClosed`. */
type ForbiddenKey =
  | 'lastIp'
  | 'ip'
  | 'ipHistory'
  | 'country'
  | 'countryCode'
  | 'asn'
  | 'isp'
  | 'city'
  | 'fingerprint'
  | 'fingerprintHash'
  | 'installId'
  | 'clientId'
  | 'userId'
  | 'analyticsOptIn';

const _noIdentifiersInSchema: Extract<keyof WhoamiSettings, ForbiddenKey> extends never
  ? true
  : never = true;

// Referenced so the assertions are not elided as unused by a future lint config.
export const SCHEMA_GUARDS = { _keysAreClosed, _noIdentifiersInSchema } as const;
