import { storage } from '#imports';
import type { AdBlockExtensionSettings, AggregateStats } from '@blur/core';
import { DEFAULT_ADBLOCK_SETTINGS, adBlockPresetForLevel } from '@blur/core';
import type { AdBlockSiteConfigX, CustomFilters } from './adblock-types';

// Real zero-state for a fresh install. Every counter starts at 0 — the UI must
// never show fabricated totals. `accuracy` is 'exact' because only exactly-known
// increments (cosmetic hides everywhere, plus exact webRequest blocks on Firefox)
// are ever accrued into the aggregate; approximate DNR figures are per-tab and
// on-demand only, never cumulative. `filterListVersion` is '—' ("unknown") only
// until the background stamps the real bundled build date read from the generated
// `public/rules/manifest.json`; the UI shows the dash rather than inventing a date.
const AGGREGATE_FALLBACK: AggregateStats = {
  today: 0,
  week: 0,
  total: 0,
  accuracy: 'exact',
  filterListVersion: '—',
};

// Storage layout (PLAN.md §13). The sync/local split is a HARD requirement,
// never the reverse:
//   - `sync`  : lightweight settings only. Quotas FAIL HARD on exceed —
//               102,400 bytes total / 8,192 bytes per item / 512 items. Settings
//               fit comfortably; statistics never would.
//   - `local` : statistics and custom rules. 10 MB, no per-item cap.
//
// Statistics MUST NOT go in sync — a growing counter would eventually blow the
// 8 KB per-item ceiling and the write would throw, silently losing settings too.
//
// `version` + `migrations` are declared from day one so the schema can evolve
// without wiping user data on update.

export const settingsItem = storage.defineItem<AdBlockExtensionSettings>(
  'sync:settings',
  {
    fallback: DEFAULT_ADBLOCK_SETTINGS,
    version: 2,
    migrations: {
      // v2 added `blockAds` (EasyList as an independently toggleable list) and
      // decoupled the per-list toggles from the strictness level. In v1 the
      // annoyances list was derived from `level === 'aggressive' || blockAnnoyances`,
      // so an aggressive user with stored `blockAnnoyances=false` still got
      // annoyance blocking — which the decouple would silently drop. Apply the
      // level's preset as a FLOOR so no list a user was already getting is lost:
      // OR each toggle with the preset (and default the absent `blockAds` field
      // ON via the preset for any level that includes it).
      2: (old: AdBlockExtensionSettings) => {
        const preset = adBlockPresetForLevel(old.adblock.level);
        return {
          ...old,
          adblock: {
            ...old.adblock,
            blockAds: old.adblock.blockAds ?? preset.blockAds,
            blockTrackers: old.adblock.blockTrackers || preset.blockTrackers,
            blockAnnoyances: old.adblock.blockAnnoyances || preset.blockAnnoyances,
          },
        };
      },
    },
  },
);

export const siteConfigsItem = storage.defineItem<
  Record<string, AdBlockSiteConfigX>
>('local:siteConfigs', {
  fallback: {},
  version: 1,
  migrations: {},
});

// The user's own cosmetic selectors (element picker, pasted filters), keyed by
// host (`'*'` = all sites). Lives in `local` (10 MB, no per-item cap) alongside
// site configs — never `sync`, whose 8 KB per-item ceiling a growing selector
// list could blow.
export const customFiltersItem = storage.defineItem<CustomFilters>(
  'local:customFilters',
  {
    fallback: {},
    version: 1,
    migrations: {},
  },
);

export const statsItem = storage.defineItem<AggregateStats>('local:stats', {
  fallback: AGGREGATE_FALLBACK,
  version: 1,
  migrations: {},
});

/**
 * Day/week bucket keys, so cumulative counters roll over on date change without
 * losing the running total. Kept beside `statsItem` (which matches the read-only
 * `AggregateStats` shape and has no room for these keys).
 */
export interface StatsMeta {
  dayKey: string;
  weekKey: string;
}

export const statsMetaItem = storage.defineItem<StatsMeta>('local:statsMeta', {
  fallback: { dayKey: '', weekKey: '' },
  version: 1,
  migrations: {},
});

/**
 * Stable host → DNR dynamic-rule-id map for per-site allowlist rules. A bare hash
 * of the hostname can collide (two hosts → one id), so one would silently
 * overwrite the other's `allowAllRequests` rule. Keeping the assignments here lets
 * `DnrBackend` probe for a free id on collision and remove the exact rule later.
 * `local` (not `sync`): it is derived state, never user-authored settings.
 */
export const allowlistRuleIdsItem = storage.defineItem<Record<string, number>>(
  'local:allowlistRuleIds',
  { fallback: {}, version: 1, migrations: {} },
);

/**
 * Whether the Chromium DNR backend had to enable FEWER static rulesets than the
 * user's settings asked for, because Chrome's static-rule budget could not fit
 * them (see backends/rule-budget.ts). Written by `DnrBackend.reconcile` on every
 * reconcile — including back to a clean state — and read by the popup/options so
 * the UI can say so instead of silently claiming a level it did not get.
 *
 * `local` (not `sync`): it describes THIS machine's browser budget, which is a
 * property of the other extensions installed here, not a user preference. Syncing
 * it would carry a false warning onto a healthy machine.
 *
 * Always `{ degraded: false }` on Firefox — the webRequest backend has no such
 * limit and never writes this.
 */
export interface RulesetStatus {
  degraded: boolean;
  /** Ruleset ids the user enabled that could NOT be applied. */
  dropped: string[];
  /** Machine-readable cause; '' when not degraded. */
  degradedReason: '' | 'static-rule-budget';
}

export const RULESET_STATUS_OK: RulesetStatus = {
  degraded: false,
  dropped: [],
  degradedReason: '',
};

export const rulesetStatusItem = storage.defineItem<RulesetStatus>(
  'local:rulesetStatus',
  { fallback: RULESET_STATUS_OK, version: 1, migrations: {} },
);

/**
 * Epoch ms until which blocking is temporarily paused everywhere (feature:
 * "pause for 10 minutes"). `0` means not paused. The background owns the `alarms`
 * timer that flips `settings.enabled` back on; this survives a service-worker
 * teardown so the popup can still render the countdown.
 */
export const pauseUntilItem = storage.defineItem<number>('local:pauseUntil', {
  fallback: 0,
  version: 1,
  migrations: {},
});

/**
 * The master `enabled` state captured just before a temporary pause began, so
 * auto-resume restores EXACTLY that — it must never force blocking back on when
 * the user had turned it off. Paired with `pauseUntilItem`; only meaningful while
 * a pause is active.
 */
export const pausePrevEnabledItem = storage.defineItem<boolean>(
  'local:pausePrevEnabled',
  { fallback: true, version: 1, migrations: {} },
);

/** ISO date the extension was installed, stamped once on `onInstalled`, so the
 *  lifetime total can be labelled "since <date>". Empty until first stamped. */
export const installDateItem = storage.defineItem<string>('local:installDate', {
  fallback: '',
  version: 1,
  migrations: {},
});
