import { browser } from '#imports';
import type { AdBlockLevel } from '@blur/core';
import { settingsItem } from '../storage';
import type { BlockingBackend, RulesetId, TabCountEntry, TabCounts } from './types';
import { RULESET_IDS, TRACKING_PARAMS } from './types';
import {
  decideRequest,
  hostOf,
  matchesSuffix,
  parseRule,
  stripTrackingParams,
} from './webrequest-match';

/** Per-tab block tally split by filter list, so the popup can attribute blocks. */
interface PerListCounts {
  easylist: number;
  easyprivacy: number;
  annoyances: number;
}

type Details = Browser.webRequest.OnBeforeRequestDetails;
type BlockingResponse = Browser.webRequest.BlockingResponse;

/**
 * Firefox backend. Mozilla kept BLOCKING `webRequest` in MV3, so this both blocks
 * AND counts EXACTLY (PLAN.md §4.2) — no approximation anywhere.
 *
 * ⚠️ Matcher choice (documented in IMPLEMENTATION.md): `@adguard/tsurlfilter`'s
 * `Engine` is confirmed in node_modules but needs the RAW filter text, which we
 * do not bundle (we ship DNR JSON). So this builds a hostname-set matcher from
 * the SAME DNR JSON — self-contained, offline, and exact-counting.
 *
 * CORRECTNESS OVER COVERAGE (better to under-block than blank a page):
 *   - Only rules anchored to a WHOLE host (`||host^`) are representable. A rule
 *     with a path (`||host/ads^`) or wildcard (`||host/*`) is SKIPPED, never
 *     collapsed to a bare-domain block — collapsing it would cancel every request
 *     to that host, not just the intended path.
 *   - `@@` exception rules (DNR `action.type: 'allow'` / `allowAllRequests`) are
 *     honored: a host with an exception is never blocked.
 *   - `main_frame` navigations are NEVER cancelled, so a bad rule can never blank
 *     the page the user is trying to load.
 *
 * DELIBERATELY NOT MODELLED: AdGuard's `$third-party` / first-party party
 * distinction (it lives in DNR `condition.domainType`, not the `urlFilter`). A
 * flat hostname set cannot represent it, so a `$third-party`-only rule is applied
 * to matching hosts regardless of party. In practice these are ad/tracker hosts
 * that are undesirable first-party too, and `main_frame` is already protected.
 */
export class WebRequestBackend implements BlockingBackend {
  #adDomains = new Set<string>();
  #trackerDomains = new Set<string>();
  #annoyanceDomains = new Set<string>();
  /** Hosts with an `@@` exception rule — never blocked, whichever list matched. */
  #exceptions = new Set<string>();

  #active = new Set<string>();
  #trackersActive = new Set<string>();
  // Kept separate from #active (which unions both for the block decision) so a
  // cancelled request can be attributed to the list it came from for the popup's
  // per-list breakdown.
  #adsActive = new Set<string>();
  #annoyActive = new Set<string>();
  #allowlist = new Set<string>();
  #stripParams = false;
  #counts = new Map<number, PerListCounts>();
  #loaded = false;

  #listener = (details: Details): BlockingResponse | undefined => {
    // Strip tracking params BEFORE any block decision. Firefox kept blocking
    // webRequest, so — unlike Chromium's declarative redirect rule — we do it
    // imperatively here: on a frame navigation whose page isn't allowlisted,
    // rewrite the URL and redirect. `stripTrackingParams` returns null when
    // nothing changed, which both skips no-op redirects and guards the loop.
    if (this.#stripParams && (details.type === 'main_frame' || details.type === 'sub_frame')) {
      const pageHost = hostOf(details.initiator) ?? hostOf(details.url);
      if (!(pageHost && this.#isAllowlisted(pageHost))) {
        const redirectUrl = stripTrackingParams(details.url, TRACKING_PARAMS);
        if (redirectUrl) return { redirectUrl };
      }
    }

    const decision = decideRequest(
      {
        type: details.type,
        url: details.url,
        initiator: details.initiator,
        tabId: details.tabId,
      },
      {
        exceptions: this.#exceptions,
        trackers: this.#trackersActive,
        ads: this.#active,
        isAllowlisted: (host) => this.#isAllowlisted(host),
      },
    );
    if (!decision.cancel) return undefined;
    // Attribute the block to a specific list for the breakdown. decideRequest
    // only says network-vs-tracker; a network block is easylist unless the host
    // is (only) in the active annoyances set.
    const reqHost = hostOf(details.url);
    const list: RulesetId =
      decision.kind === 'trackers'
        ? 'easyprivacy'
        : reqHost && matchesSuffix(reqHost, this.#annoyActive) && !matchesSuffix(reqHost, this.#adsActive)
          ? 'annoyances'
          : 'easylist';
    this.#bump(details.tabId, list);
    return { cancel: true };
  };

  async start(level: AdBlockLevel): Promise<void> {
    await this.#load();
    if (!browser.webRequest.onBeforeRequest.hasListener(this.#listener)) {
      browser.webRequest.onBeforeRequest.addListener(
        this.#listener,
        { urls: ['<all_urls>'] },
        ['blocking'],
      );
    }
    await this.setLevel(level);
    const allow = (await settingsItem.getValue()).allowlist;
    this.#allowlist = new Set(allow);
  }

  async setLevel(level: AdBlockLevel): Promise<void> {
    const settings = (await settingsItem.getValue()).adblock;
    const on = level !== 'off';
    // Each list is gated on its own toggle (the level is only a preset that sets
    // them). Ads and annoyances are tracked separately for the per-list breakdown
    // and unioned into #active for the actual block decision.
    this.#adsActive = new Set(on && settings.blockAds ? this.#adDomains : []);
    this.#annoyActive = new Set(on && settings.blockAnnoyances ? this.#annoyanceDomains : []);
    this.#trackersActive = new Set(on && settings.blockTrackers ? this.#trackerDomains : []);
    this.#active = new Set([...this.#adsActive, ...this.#annoyActive]);
    this.#stripParams = on && settings.stripTrackingParams;
  }

  async allowlistSite(hostname: string): Promise<void> {
    this.#allowlist.add(hostname);
  }

  async removeAllowlist(hostname: string): Promise<void> {
    this.#allowlist.delete(hostname);
  }

  async getTabCounts(tabId: number): Promise<TabCounts> {
    return this.#toCounts(this.#counts.get(tabId));
  }

  async getAllTabCounts(): Promise<TabCountEntry[]> {
    const out: TabCountEntry[] = [];
    for (const [tabId, c] of this.#counts) {
      out.push({ tabId, ...this.#toCounts(c) });
    }
    return out;
  }

  /** Collapse a per-list tally into the network/tracker + byList shape. */
  #toCounts(c: PerListCounts | undefined): TabCounts {
    const easylist = c?.easylist ?? 0;
    const easyprivacy = c?.easyprivacy ?? 0;
    const annoyances = c?.annoyances ?? 0;
    return {
      // "Network" is every non-tracker block (ads + annoyances); trackers are split
      // out for the headline stat. The full per-list split rides in byList.
      network: easylist + annoyances,
      trackers: easyprivacy,
      accuracy: 'exact',
      byList: {
        [RULESET_IDS.easylist]: easylist,
        [RULESET_IDS.easyprivacy]: easyprivacy,
        [RULESET_IDS.annoyances]: annoyances,
      },
    };
  }

  async stop(): Promise<void> {
    if (browser.webRequest.onBeforeRequest.hasListener(this.#listener)) {
      browser.webRequest.onBeforeRequest.removeListener(this.#listener);
    }
    this.#counts.clear();
  }

  /** Drop a tab's counters when it navigates away or closes. */
  resetTab(tabId: number): void {
    this.#counts.delete(tabId);
  }

  #isAllowlisted(host: string): boolean {
    for (const entry of this.#allowlist) {
      if (host === entry || host.endsWith(`.${entry}`)) return true;
    }
    return false;
  }

  #bump(tabId: number, list: RulesetId): void {
    const c = this.#counts.get(tabId) ?? { easylist: 0, easyprivacy: 0, annoyances: 0 };
    c[list] += 1;
    this.#counts.set(tabId, c);
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    const [easylist, easyprivacy, annoyances] = await Promise.all([
      loadRuleset('/rules/easylist.json'),
      loadRuleset('/rules/easyprivacy.json'),
      loadRuleset('/rules/annoyances.json'),
    ]);
    this.#adDomains = easylist.block;
    this.#trackerDomains = easyprivacy.block;
    this.#annoyanceDomains = annoyances.block;
    this.#exceptions = new Set([
      ...easylist.allow,
      ...easyprivacy.allow,
      ...annoyances.allow,
    ]);
    this.#loaded = true;
  }
}

type RulesetPath =
  | '/rules/easylist.json'
  | '/rules/easyprivacy.json'
  | '/rules/annoyances.json';

interface RulesetDomains {
  /** Hosts from whole-domain `block` rules. */
  block: Set<string>;
  /** Hosts from whole-domain `@@` exception (`allow`/`allowAllRequests`) rules. */
  allow: Set<string>;
}

/** Split a bundled DNR ruleset into whole-domain block and exception host sets. */
async function loadRuleset(path: RulesetPath): Promise<RulesetDomains> {
  const block = new Set<string>();
  const allow = new Set<string>();
  try {
    const url = browser.runtime.getURL(path);
    const res = await fetch(url);
    const rules: unknown = await res.json();
    if (!Array.isArray(rules)) return { block, allow };
    for (const rule of rules) {
      const parsed = parseRule(rule);
      if (!parsed) continue;
      (parsed.allow ? allow : block).add(parsed.domain);
    }
  } catch {
    // A missing/placeholder ruleset just yields an empty matcher for that list.
  }
  return { block, allow };
}
