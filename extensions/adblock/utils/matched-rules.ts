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
 * ⚠️ NON-BLOCK matches are EXCLUDED — the counter must reflect genuine BLOCKS
 * only (never lie in the UI). `getMatchedRules` reports EVERY matched rule and
 * exposes no action type, so two filters are applied:
 *   - Dynamic/session rulesets are ours (strip-params `redirect`, per-site
 *     `allowAllRequests`) and never blocks — skipped by ruleset id.
 *   - Static `allow`/`allowAllRequests` EXCEPTIONS live in the SAME bundled
 *     ruleset as the blocks (easylist alone has ~3,000), so ruleset id can't tell
 *     them apart. The build script (build-rulesets.mjs) therefore assigns every
 *     non-block rule an id >= NON_BLOCK_RULE_ID_BASE and every block a lower id,
 *     so a matched exception is skipped by its rule id. An `allow` MATCH is a
 *     request let THROUGH — the opposite of a block — and previously inflated the
 *     figure. (Requires a rebuilt ruleset; older bundles fall back to counting
 *     everything, i.e. the prior behaviour, never worse.)
 */
const DYNAMIC_RULESET_ID = '_dynamic';
const SESSION_RULESET_ID = '_session';

/** Mirrors `NON_BLOCK_RULE_ID_BASE` in scripts/build-rulesets.mjs. */
const NON_BLOCK_RULE_ID_BASE = 1_000_000;

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
      // Static allow/allowAllRequests exceptions carry a high id (see above) — a
      // match on one is a PASS, not a block, so it must not count.
      if (info.rule.ruleId >= NON_BLOCK_RULE_ID_BASE) continue;
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
