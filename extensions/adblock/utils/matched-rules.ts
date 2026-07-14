import { browser } from '#imports';
import { RULESET_IDS } from './backends/types';

/** Per-tab DNR counts. `null` means "could not be measured", never "zero". */
export interface DnrTabCounts {
  network: number | null;
  trackers: number | null;
  /**
   * Blocks on this tab grouped by the filter list (static ruleset) that matched,
   * so the popup can show "which lists this site's traffic hits". `null` when the
   * counts could not be read at all (same reason as `network`/`trackers`).
   */
  byList: Record<string, number> | null;
}

/**
 * Read approximate per-tab network/tracker counts from DNR on Chromium.
 *
 * `getMatchedRules()` is capped at 20 calls / 10 min and only returns the last 5
 * minutes of matches. Chrome documents an exemption for calls made "in response
 * to a user gesture", and the popup opening is a gesture — but this runs from an
 * async effect after mount, NOT synchronously on the click callstack, so the
 * exemption is NOT guaranteed to apply and the quota can still be hit. It also
 * relies on the `activeTab` grant. We therefore treat a throw as "unavailable"
 * and return `null`, so the UI can show "—" rather than a misleading `~0`. This
 * is why the popup calls it (best-effort, on open) and the background never does.
 *
 * Trackers vs ads are split by originating ruleset: matches from `easyprivacy`
 * count as trackers, everything else as generic network blocks.
 *
 * ⚠️ DYNAMIC rules are EXCLUDED. `getMatchedRules` reports every matched rule,
 * including our own dynamic strip-params `redirect`, per-site `allowAllRequests`
 * and any `modifyHeaders` rule — none of which are a BLOCK, so bucketing them as
 * tracker/network inflated the "~N Blocked" figure with phantom matches. Only the
 * bundled static rulesets (all block rules) are counted. `MatchedRule` exposes no
 * action type, so we filter by ruleset: static-block vs the reserved dynamic /
 * session rulesets.
 */
const DYNAMIC_RULESET_ID = '_dynamic';
const SESSION_RULESET_ID = '_session';

export async function getDnrTabCounts(tabId: number): Promise<DnrTabCounts> {
  try {
    const { rulesMatchedInfo } = await browser.declarativeNetRequest.getMatchedRules({ tabId });
    let network = 0;
    let trackers = 0;
    const byList: Record<string, number> = {};
    for (const info of rulesMatchedInfo) {
      const rulesetId = info.rule.rulesetId;
      // Dynamic/session rules are our redirect/allow/header rules, never blocks.
      if (rulesetId === DYNAMIC_RULESET_ID || rulesetId === SESSION_RULESET_ID) continue;
      if (rulesetId === RULESET_IDS.easyprivacy) trackers += 1;
      else network += 1;
      byList[rulesetId] = (byList[rulesetId] ?? 0) + 1;
    }
    return { network, trackers, byList };
  } catch {
    // Quota exhausted, no activeTab grant, or an internal page — report nothing
    // (null) rather than a wrong number.
    return { network: null, trackers: null, byList: null };
  }
}
