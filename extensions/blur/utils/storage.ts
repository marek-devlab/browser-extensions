import { storage } from '#imports';
import type { BlurExtensionSettings, BlurSiteConfig } from '@blur/core';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';
import type { Locale } from '@blur/ui';

// Storage layout (PLAN.md §13).
//   - `local` : 10 MB, no per-item or write-rate cap.
//   - `sync`  : 8,192 bytes PER ITEM — a HARD failure on exceed, not a truncation.
//
// `settings` lives in `local`, NOT `sync` (C1): it embeds two growable lists —
// `allowlist` and `blur.textPatterns`. A user with a long keyword or site list
// blows the 8 KB per-item sync cap, `setValue` rejects, and the data is silently
// lost while the UI still shows it "saved". Local has no such cap, so the whole
// settings object goes there alongside the already-local per-site config. The
// modest loss (settings no longer sync across devices) is worth never dropping a
// user's lists; Backup export/import covers cross-device transfer.
//
// `version` + `migrations` are required from day one so the schema can evolve
// without wiping user data on update.

/**
 * Serialize a read-modify-write across EVERY extension context — the background
 * service worker (toggleSite / command / context-menu RMWs) and the popup /
 * options documents. A per-document write queue only orders writes within one
 * document; two contexts each doing get→modify→set can still interleave and
 * clobber a field. The Web Locks API is shared process-wide for the extension
 * origin, so holding one named lock makes those RMWs mutually exclusive. Falls
 * back to running directly where `navigator.locks` is unavailable.
 *
 * The lock is keyed by NAME so each storage item gets its own critical section:
 * settings share `SETTINGS_LOCK`, while `siteConfigs` / `extensionPrefs` /
 * `imageSourceRules` are serialized under their storage key (`item.key`) by
 * `useStorageItem` and by the background writers that touch the same item.
 */
export function withStorageLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks?.request) return fn();
  return locks.request(name, fn);
}

const SETTINGS_LOCK = 'blur-settings';

export function withSettingsLock<T>(fn: () => Promise<T>): Promise<T> {
  return withStorageLock(SETTINGS_LOCK, fn);
}

export const settingsItem = storage.defineItem<BlurExtensionSettings>('local:settings', {
  fallback: DEFAULT_BLUR_SETTINGS,
  version: 1,
  migrations: {
    // Populate as the settings schema changes, e.g. `2: (old) => ({ ...old })`.
  },
});

export const siteConfigsItem = storage.defineItem<Record<string, BlurSiteConfig>>(
  'local:siteConfigs',
  {
    fallback: {},
    version: 1,
    migrations: {},
  },
);

// Panic toggle (keyboard shortcut) snapshot. When panic is active this holds the
// settings to restore; `null` means panic is not active. Local (not sync) so the
// transient state never burns the sync write-rate quota. Typed here — not in the
// READ-ONLY core — because it is an implementation detail of this extension.
export const panicSnapshotItem = storage.defineItem<BlurExtensionSettings | null>(
  'local:panicSnapshot',
  {
    fallback: null,
    version: 1,
    migrations: {},
  },
);

/**
 * Per-domain image source rules (feature 6). `never` = image URLs containing any
 * of these domain substrings are never blurred; `always` = they are blurred even
 * when the Images category is off. Kept out of the sync `BlurSettings` (and out
 * of core) so it stays local and does not require a core type change.
 */
export interface ImageSourceRules {
  never: string[];
  always: string[];
}

export const imageSourceRulesItem = storage.defineItem<ImageSourceRules>(
  'local:imageSourceRules',
  {
    fallback: { never: [], always: [] },
    version: 1,
    migrations: {},
  },
);

/**
 * Extension-only preferences that have no home in the READ-ONLY core
 * `BlurSettings`. Local (never sync) so a growable domain list never risks the
 * 8 KB per-item sync cap.
 *  - `revealTimeoutSec`: after a click / "reveal all", auto re-hide after N
 *    seconds. 0 disables the timer (reveal stays until navigation).
 *  - `minImagePx`: skip blurring images whose rendered box is below this many
 *    CSS px in BOTH axes, so favicons and 1px tracking pixels stay sharp. 0 off.
 *  - `linkDomains`: blur links (SERP result cards etc.) whose `href` contains any
 *    of these domain substrings.
 */
export interface ExtensionPrefs {
  revealTimeoutSec: number;
  minImagePx: number;
  linkDomains: string[];
}

export const extensionPrefsItem = storage.defineItem<ExtensionPrefs>(
  'local:extensionPrefs',
  {
    fallback: { revealTimeoutSec: 0, minImagePx: 0, linkDomains: [] },
    version: 1,
    migrations: {},
  },
);

/**
 * The user's chosen UI language — an in-settings switch, NOT `chrome.i18n` (which
 * is locked to the browser UI language and can't be flipped at runtime; see
 * @blur/ui/i18n). Local, defaults to English on a fresh install regardless of the
 * browser locale. Read by every React root via `useLocaleController` and by the
 * background context-menu titles via `localeItem.getValue()` / `.watch()`.
 */
export const localeItem = storage.defineItem<Locale>('local:locale', {
  fallback: 'en',
  version: 1,
  migrations: {},
});

/** Synchronous localStorage seed key for the locale, so the first paint is
 *  already in the chosen language. Same naming scheme as the theme seeds used
 *  elsewhere in the family: 'blur-<ext>:locale'. */
export const LOCALE_SEED_KEY = 'blur-blur:locale';
