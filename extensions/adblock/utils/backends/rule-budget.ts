import type { RulesetId } from './types';

/**
 * PURE static-rule budget arithmetic for the Chromium DNR backend (PLAN.md §4.1).
 *
 * No `browser` / `#imports` / `@blur/core` runtime dependency, so it can be unit
 * tested in plain Node (see e2e/adblock/logic.test.mjs). `dnr.ts` owns every call
 * into the actual `declarativeNetRequest` API; this module only decides WHICH
 * rulesets fit in a given budget and what to tell the user when some do not.
 *
 * Why this exists: Chrome only GUARANTEES 30,000 enabled static rules per
 * extension. Anything beyond that is drawn from a ~330,000-rule GLOBAL pool
 * SHARED with every other installed extension. Our `aggressive` tier wants
 * easylist (20,000) + easyprivacy (9,000) + annoyances (6,000) = 35,000, which
 * overflows the guarantee by 5,000. On a machine where another DNR extension has
 * drained the shared pool, `updateEnabledRulesets()` REJECTS and NOTHING in the
 * requested set is applied — so without this, selecting "Aggressive" could leave
 * the user with the UI claiming aggressive filtering while less was actually
 * enabled than before. We predict the overflow, degrade deterministically, and
 * say so.
 */

/** Chrome's `declarativeNetRequest.GUARANTEED_MINIMUM_STATIC_RULES`. */
export const GUARANTEED_MINIMUM_STATIC_RULES = 30_000;

/** Chrome's `declarativeNetRequest.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS`. */
export const MAX_NUMBER_OF_ENABLED_STATIC_RULESETS = 50;

/**
 * Rule count of each bundled ruleset, mirroring public/rules/manifest.json (the
 * generator writes both). The background can't await a manifest fetch before its
 * first reconcile, so these are compiled in; `scripts/build-rulesets.mjs` caps
 * each list at exactly these sizes.
 */
export const RULESET_RULE_COUNTS: Record<RulesetId, number> = {
  easylist: 20_000,
  easyprivacy: 9_000,
  annoyances: 6_000,
};

/**
 * Sacrifice order, most important LAST to be dropped. Ads and trackers are the
 * extension's core promise; the annoyances list is the additive extra the
 * aggressive tier layers on, so it is the first thing given up when the browser
 * cannot afford the whole set. This ordering is what makes the degradation
 * DETERMINISTIC — the user always keeps easylist + easyprivacy (29,000 rules,
 * inside the guarantee, so they can never be squeezed out by another extension).
 */
export const RULESET_PRIORITY: RulesetId[] = ['easylist', 'easyprivacy', 'annoyances'];

/** Plain-language names for the degradation notice (matches the popup's labels). */
export const RULESET_TITLES: Record<RulesetId, string> = {
  easylist: 'Ads (EasyList)',
  easyprivacy: 'Trackers (EasyPrivacy)',
  annoyances: 'Annoyances',
};

export interface BudgetPlan {
  /** Rulesets to enable, in priority order — guaranteed to fit the budget. */
  enable: RulesetId[];
  /** Requested rulesets that do NOT fit and must stay off. */
  dropped: RulesetId[];
  /** Rules the full request would have needed. */
  requestedRules: number;
  /** Rules the returned `enable` set actually uses. */
  enabledRules: number;
}

/** Total static rules the given rulesets occupy. Unknown ids count as 0. */
export function ruleCountFor(ids: readonly string[]): number {
  return ids.reduce(
    (sum, id) => sum + (RULESET_RULE_COUNTS[id as RulesetId] ?? 0),
    0,
  );
}

/**
 * The largest prefix of `requested` (in `RULESET_PRIORITY` order) that fits in
 * `budget` static rules and `maxRulesets` enabled rulesets.
 *
 * Greedy in priority order rather than a knapsack: the point is a PREDICTABLE
 * outcome the UI can explain in one sentence ("annoyances couldn't be enabled"),
 * not the theoretically densest packing. `budget` may be `Infinity` when the
 * browser doesn't expose `getAvailableStaticRuleCount()` — then nothing is
 * pre-emptively dropped and `dnr.ts` falls back only on an actual rejection.
 */
export function planRulesets(
  requested: readonly string[],
  budget: number,
  maxRulesets: number = MAX_NUMBER_OF_ENABLED_STATIC_RULESETS,
): BudgetPlan {
  const wanted = RULESET_PRIORITY.filter((id) => requested.includes(id));
  const enable: RulesetId[] = [];
  const dropped: RulesetId[] = [];
  let enabledRules = 0;
  const cap = Math.max(0, budget);
  for (const id of wanted) {
    const cost = RULESET_RULE_COUNTS[id];
    if (enabledRules + cost <= cap && enable.length < maxRulesets) {
      enable.push(id);
      enabledRules += cost;
    } else {
      dropped.push(id);
    }
  }
  return { enable, dropped, requestedRules: ruleCountFor(wanted), enabledRules };
}

/**
 * One plain-language sentence for the popup/options notice. Empty string when
 * nothing was dropped, so the UI can render it conditionally without branching
 * on the reason. Deliberately blames the shared browser budget (the true cause)
 * and states what IS still blocking, so the user is never left guessing.
 */
export function degradedNotice(dropped: readonly string[]): string {
  if (dropped.length === 0) return '';
  const names = dropped.map((id) => RULESET_TITLES[id as RulesetId] ?? id).join(' and ');
  const plural = dropped.length === 1 ? 'list' : 'lists';
  return (
    `The ${names} ${plural} could not be turned on: this browser's filter-rule ` +
    `budget is shared with your other extensions and is currently full. Your ` +
    `remaining lists are still blocking normally. Removing another content ` +
    `blocker frees the budget up.`
  );
}
