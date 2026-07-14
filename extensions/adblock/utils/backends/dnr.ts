import { browser } from '#imports';
import type { AdBlockLevel } from '@blur/core';
import {
  settingsItem,
  allowlistRuleIdsItem,
  rulesetStatusItem,
  RULESET_STATUS_OK,
} from '../storage';
import type { RulesetStatus } from '../storage';
import { getDnrTabCounts } from '../matched-rules';
import { hasHostAccess } from '../permissions';
import type { BlockingBackend, RulesetId, TabCountEntry, TabCounts } from './types';
import { RULESET_IDS, TRACKING_PARAMS } from './types';
import {
  GUARANTEED_MINIMUM_STATIC_RULES,
  MAX_NUMBER_OF_ENABLED_STATIC_RULESETS,
  RULESET_PRIORITY,
  planRulesets,
  ruleCountFor,
} from './rule-budget';

type DnrRule = Browser.declarativeNetRequest.Rule;

/**
 * Dynamic-rule id space. Chrome requires dynamic rule ids to be unique integers.
 * The single strip-params rule owns a fixed id; per-site allowlist rules get a
 * stable hash of the hostname, kept clear of the reserved id.
 */
const STRIP_PARAMS_RULE_ID = 1;
const ALLOWLIST_ID_MIN = 1_000;
const ALLOWLIST_ID_SPAN = 2_000_000_000;

/** DNR "unsafe" dynamic rules (redirect/modifyHeaders) are capped at 5,000. */
const MAX_UNSAFE_DYNAMIC_RULES = 5_000;

/**
 * Beats any static block rule so an allowlisted site is never filtered.
 *
 * An allow / allowAllRequests rule only wins when its priority is >= the block
 * rule it competes with. The bundled AdGuard rulesets carry block priorities up
 * to ~1.1 million (verified against the generated public/rules/*.json), so the
 * old 1,000,000 ceiling LOST to some static rules and let ads through on
 * allowlisted sites. This sits far above any static priority yet well below the
 * uint32 / 2^31-1 ceiling DNR allows.
 */
const ALLOWLIST_PRIORITY = 2_000_000_000;

/** Seed id for a host, from a DJB2 hash. Collisions are resolved by probing. */
function allowlistRuleIdSeed(hostname: string): number {
  let hash = 5381;
  for (let i = 0; i < hostname.length; i += 1) {
    hash = ((hash << 5) + hash + hostname.charCodeAt(i)) >>> 0;
  }
  return ALLOWLIST_ID_MIN + (hash % ALLOWLIST_ID_SPAN);
}

function allowlistRule(hostname: string, id: number): DnrRule {
  return {
    id,
    priority: ALLOWLIST_PRIORITY,
    action: { type: 'allowAllRequests' },
    // allowAllRequests only matches frame requests; matching the site's own
    // navigation lets every sub-resource in that frame through.
    condition: {
      requestDomains: [hostname],
      resourceTypes: ['main_frame', 'sub_frame'],
    },
  };
}

function stripParamsRule(): DnrRule {
  return {
    id: STRIP_PARAMS_RULE_ID,
    priority: 1,
    // `redirect` with a queryTransform is an "unsafe" action (5,000 dynamic cap).
    action: {
      type: 'redirect',
      redirect: { transform: { queryTransform: { removeParams: [...TRACKING_PARAMS] } } },
    },
    condition: { resourceTypes: ['main_frame', 'sub_frame'] },
  };
}

/**
 * Chromium/Safari backend. Nothing runs per-request: the browser evaluates the
 * bundled static rulesets. `setLevel`/`start` only reconcile which rulesets are
 * enabled and which dynamic rules exist.
 */
export class DnrBackend implements BlockingBackend {
  async start(level: AdBlockLevel): Promise<void> {
    await this.reconcile(level);
  }

  async setLevel(level: AdBlockLevel): Promise<void> {
    await this.reconcile(level);
  }

  /**
   * Reconcile enabled rulesets and the strip-params dynamic rule from the current
   * settings. Ruleset enablement honours both the level and the fine-grained
   * toggles; annoyances stay off unless explicitly enabled or the level is
   * aggressive (generic-cosmetic tier).
   */
  private async reconcile(level: AdBlockLevel): Promise<void> {
    const settings = (await settingsItem.getValue()).adblock;
    const on = level !== 'off';

    // Each list is gated on its own toggle (independently switchable in the
    // Filter lists tab). The level is only a preset that sets those toggles;
    // it no longer force-enables annoyances, so a user can run aggressive
    // generic-cosmetic without the annoyances network list, or vice versa.
    const want = {
      [RULESET_IDS.easylist]: on && settings.blockAds,
      [RULESET_IDS.easyprivacy]: on && settings.blockTrackers,
      [RULESET_IDS.annoyances]: on && settings.blockAnnoyances,
    };
    const requested = (Object.keys(want) as RulesetId[]).filter((id) => want[id]);
    await this.applyRulesets(requested);

    // The strip-params rule is a `redirect` — an "unsafe" DNR action that only
    // fires on requests the extension has HOST ACCESS to. Without the (optional,
    // runtime-granted) `<all_urls>` permission it would silently do nothing, so we
    // gate it on the grant. The UI requests the permission when the toggle is
    // enabled and surfaces the pending state; `permissions.onAdded` in the
    // background re-runs this reconcile once granted.
    const stripping = on && settings.stripTrackingParams && (await hasHostAccess());
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [STRIP_PARAMS_RULE_ID],
      addRules: stripping ? [stripParamsRule()] : [],
    });
    await this.assertUnsafeBudget();
  }

  /**
   * Enable exactly the rulesets the settings ask for — or, when Chrome's static
   * rule budget can't fit them, the largest priority-ordered subset that DOES fit
   * — and record which lists (if any) had to be left off.
   *
   * Two layers, because the budget is only partly knowable up front:
   *  1. PREDICT. `getAvailableStaticRuleCount()` reports how many more static
   *     rules this extension may enable right now (the rest of its 30,000
   *     guarantee, plus whatever is left of the ~330,000 pool SHARED with every
   *     other installed extension). Adding back the rules currently enabled gives
   *     the true ceiling for the new set, so an over-budget request is trimmed
   *     BEFORE it is attempted.
   *  2. FALL BACK. The pool is global and racy — another extension can take the
   *     last of it between our read and our write — and older browsers may not
   *     expose the count at all. So an actual rejection is caught and retried
   *     with the lowest-priority ruleset dropped, until it applies. Without this,
   *     `updateEnabledRulesets` rejecting means NONE of the requested rulesets are
   *     applied, and the UI would still be showing "Aggressive".
   *
   * The result is deterministic: annoyances (6,000) is sacrificed first, leaving
   * easylist + easyprivacy (29,000) — which fits inside the per-extension
   * guarantee and therefore can never be squeezed out by another extension.
   */
  private async applyRulesets(requested: RulesetId[]): Promise<void> {
    const all: string[] = Object.values(RULESET_IDS);
    const budget = await this.staticRuleBudget();
    const plan = planRulesets(requested, budget, await this.maxEnabledRulesets());

    let candidate = plan.enable;
    const dropped = [...plan.dropped];
    let failure: unknown = null;

    // Retry-shrink loop. Bounded by the ruleset count (3), and the empty set is
    // always attempted last — disabling everything must succeed.
    for (;;) {
      try {
        await browser.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: candidate,
          disableRulesetIds: all.filter((id) => !candidate.includes(id as RulesetId)),
        });
        failure = null;
        break;
      } catch (err) {
        failure = err;
        if (candidate.length === 0) break;
        // Sacrifice the lowest-priority ruleset still in the set and retry.
        const victim = candidate[candidate.length - 1] as RulesetId;
        candidate = candidate.slice(0, -1);
        dropped.push(victim);
      }
    }

    if (dropped.length > 0) {
      console.warn(
        `[adblock] Static-rule budget exhausted — left ${dropped.join(', ')} disabled. ` +
          `Requested ${ruleCountFor(requested).toLocaleString()} rules; ` +
          `budget ${Number.isFinite(budget) ? budget.toLocaleString() : 'unknown'} ` +
          `(Chrome guarantees ${GUARANTEED_MINIMUM_STATIC_RULES.toLocaleString()} and shares the rest).`,
        failure ?? '',
      );
    }

    // Ordered by RULESET_PRIORITY so the stored value is stable regardless of the
    // order rulesets were sacrificed in — the UI reads it directly.
    const next: RulesetStatus = {
      degraded: dropped.length > 0,
      dropped: RULESET_PRIORITY.filter((id) => dropped.includes(id)),
      degradedReason: dropped.length > 0 ? 'static-rule-budget' : '',
    };
    const prev = await rulesetStatusItem.getValue();
    // Only write on a real change: this item is `watch`ed by the popup/options,
    // and reconcile runs on every settings change.
    if (
      prev.degraded !== next.degraded ||
      prev.degradedReason !== next.degradedReason ||
      prev.dropped.join(',') !== next.dropped.join(',')
    ) {
      await rulesetStatusItem.setValue(next);
    }
  }

  /**
   * How many static rules this extension may have enabled in total, right now.
   * `Infinity` when the browser doesn't expose the count (then nothing is dropped
   * pre-emptively and only a real rejection degrades us — see `applyRulesets`).
   */
  private async staticRuleBudget(): Promise<number> {
    const dnr = browser.declarativeNetRequest as typeof browser.declarativeNetRequest & {
      getAvailableStaticRuleCount?: () => Promise<number>;
      GUARANTEED_MINIMUM_STATIC_RULES?: number;
    };
    if (typeof dnr.getAvailableStaticRuleCount !== 'function') return Number.POSITIVE_INFINITY;
    try {
      const [available, enabled] = await Promise.all([
        dnr.getAvailableStaticRuleCount(),
        browser.declarativeNetRequest.getEnabledRulesets(),
      ]);
      // `available` is the HEADROOM on top of what is already enabled, so the
      // ceiling for a fresh set is headroom + what those enabled rulesets cost.
      const ceiling = available + ruleCountFor(enabled);
      // Chrome guarantees the minimum unconditionally; never predict below it.
      const guaranteed = dnr.GUARANTEED_MINIMUM_STATIC_RULES ?? GUARANTEED_MINIMUM_STATIC_RULES;
      return Math.max(ceiling, guaranteed);
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  private async maxEnabledRulesets(): Promise<number> {
    const dnr = browser.declarativeNetRequest as typeof browser.declarativeNetRequest & {
      MAX_NUMBER_OF_ENABLED_STATIC_RULESETS?: number;
    };
    return dnr.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS ?? MAX_NUMBER_OF_ENABLED_STATIC_RULESETS;
  }

  async allowlistSite(hostname: string): Promise<void> {
    const id = await this.#idForHost(hostname);
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [id],
      addRules: [allowlistRule(hostname, id)],
    });
  }

  async removeAllowlist(hostname: string): Promise<void> {
    const map = await allowlistRuleIdsItem.getValue();
    const id = map[hostname];
    if (id === undefined) return;
    await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [id] });
    const { [hostname]: _drop, ...rest } = map;
    await allowlistRuleIdsItem.setValue(rest);
  }

  /**
   * A collision-free dynamic-rule id for `hostname`, persisted so removal targets
   * the exact rule. Reuses an existing assignment; otherwise linear-probes from
   * the hostname's hash seed past any id already in use (and the reserved
   * strip-params id) so two hosts can never overwrite each other's rule.
   */
  async #idForHost(hostname: string): Promise<number> {
    const map = await allowlistRuleIdsItem.getValue();
    const existing = map[hostname];
    if (existing !== undefined) return existing;
    const used = new Set<number>(Object.values(map));
    used.add(STRIP_PARAMS_RULE_ID);
    let id = allowlistRuleIdSeed(hostname);
    while (used.has(id)) {
      id = id >= ALLOWLIST_ID_MIN + ALLOWLIST_ID_SPAN - 1 ? ALLOWLIST_ID_MIN : id + 1;
    }
    await allowlistRuleIdsItem.setValue({ ...map, [hostname]: id });
    return id;
  }

  async getTabCounts(tabId: number): Promise<TabCounts> {
    // Interface compliance. On Chromium the real caller is the POPUP (a user
    // gesture); the background must never invoke this — see matched-rules.ts.
    // `null` (unmeasurable) collapses to 0 here since TabCounts is non-nullable.
    const c = await getDnrTabCounts(tabId);
    return {
      network: c.network ?? 0,
      trackers: c.trackers ?? 0,
      accuracy: 'approximate',
      byList: c.byList ?? undefined,
    };
  }

  // Chromium can't measure off-tab (DNR match reads are per-tab, on-demand,
  // gesture/quota-limited), so there are no cumulative counts to fold in.
  async getAllTabCounts(): Promise<TabCountEntry[]> {
    return [];
  }

  // DNR keeps no in-memory per-tab counters (they come from getMatchedRules),
  // so there is nothing to reset — kept for interface parity with Firefox.
  resetTab(_tabId: number): void {}

  async stop(): Promise<void> {
    await browser.declarativeNetRequest.updateEnabledRulesets({
      disableRulesetIds: Object.values(RULESET_IDS),
    });
    const dynamic = await browser.declarativeNetRequest.getDynamicRules();
    if (dynamic.length > 0) {
      await browser.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: dynamic.map((r) => r.id),
      });
    }
    await allowlistRuleIdsItem.setValue({});
    // Nothing is enabled any more, so a stale "couldn't enable annoyances" notice
    // would be a lie — clear it.
    await rulesetStatusItem.setValue(RULESET_STATUS_OK);
  }

  private async assertUnsafeBudget(): Promise<void> {
    const dynamic = await browser.declarativeNetRequest.getDynamicRules();
    const unsafe = dynamic.filter(
      (r) => r.action.type === 'redirect' || r.action.type === 'modifyHeaders',
    ).length;
    if (unsafe > MAX_UNSAFE_DYNAMIC_RULES) {
      throw new Error(
        `Unsafe dynamic rules (${unsafe}) exceed MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES (${MAX_UNSAFE_DYNAMIC_RULES}).`,
      );
    }
  }
}
