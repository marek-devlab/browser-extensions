/**
 * PURE request-matching logic for the Firefox `WebRequestBackend`, with NO
 * browser/`#imports` dependencies so it can be unit tested directly in Node.
 *
 * This is the "correctness over coverage" core (IMPLEMENTATION.md): decide whether
 * one request should be cancelled, honoring the over-block fixes:
 *   - `main_frame` navigations are NEVER cancelled (a bad rule can't blank a page),
 *   - `@@` exception hosts win over any block,
 *   - only whole-host `||host^` rules are representable; path/wildcard rules are
 *     skipped rather than widened to a bare-domain block.
 */

/**
 * Strip the given tracking params from `rawUrl`, returning the cleaned URL, or
 * `null` if nothing changed. Returning `null` on no-op is the redirect-LOOP
 * guard: the Firefox `onBeforeRequest` listener only issues a `{redirectUrl}`
 * when the URL actually changed, and the redirected request carries none of the
 * params, so it strips to `null` the second time and never bounces. `params` is
 * injected (rather than imported) to keep this module free of relative imports so
 * it stays directly Node-loadable for the pure logic tests; the caller passes the
 * shared `TRACKING_PARAMS`, so both engines strip the same set.
 */
export function stripTrackingParams(rawUrl: string, params: readonly string[]): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.search === '') return null;
  let changed = false;
  for (const param of params) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      changed = true;
    }
  }
  return changed ? url.toString() : null;
}

/** True if `host` equals or is a subdomain of any domain in the set. */
export function matchesSuffix(host: string, domains: Set<string>): boolean {
  let h: string = host;
  while (h.length > 0) {
    if (domains.has(h)) return true;
    const dot = h.indexOf('.');
    if (dot === -1) break;
    h = h.slice(dot + 1);
  }
  return false;
}

export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Extract a whole-host block/exception target from one DNR rule, or `undefined`
 * if the rule is not representable as a bare-domain match. Only `||host^`-anchored
 * rules qualify; a urlFilter continuing past the host with a path (`/`), wildcard
 * (`*`), or query (`?`) is skipped rather than widened to a domain block.
 */
export function parseRule(rule: unknown): { domain: string; allow: boolean } | undefined {
  if (typeof rule !== 'object' || rule === null) return undefined;
  const r = rule as { action?: { type?: unknown }; condition?: { urlFilter?: unknown } };
  const type = r.action?.type;
  const allow = type === 'allow' || type === 'allowAllRequests';
  if (type !== 'block' && !allow) return undefined;

  const filter = r.condition?.urlFilter;
  if (typeof filter !== 'string' || !filter.startsWith('||')) return undefined;
  const rest = filter.slice(2);
  const end = rest.search(/[/^*|?]/);
  if (end !== -1) {
    const term = rest[end];
    if (term === '/' || term === '*' || term === '?') return undefined;
  }
  const domain = end === -1 ? rest : rest.slice(0, end);
  if (!domain.includes('.') || domain.includes(' ')) return undefined;
  return { domain, allow };
}

export interface RequestInfo {
  type: string;
  url: string;
  initiator?: string;
  tabId: number;
}

export interface MatchSets {
  /** Hosts with an `@@` exception — never blocked. */
  exceptions: Set<string>;
  /** Active tracker hosts (EasyPrivacy). */
  trackers: Set<string>;
  /** Active ad/annoyance hosts. */
  ads: Set<string>;
  /** Returns true if the PAGE host is fully allowlisted. */
  isAllowlisted: (host: string) => boolean;
}

export type Decision = { cancel: false } | { cancel: true; kind: 'network' | 'trackers' };

/**
 * The single decision the `onBeforeRequest` listener makes for one request.
 * Returns whether to cancel and, if so, which counter to bump.
 */
export function decideRequest(details: RequestInfo, sets: MatchSets): Decision {
  if (details.tabId < 0) return { cancel: false };
  // NEVER cancel the top-level navigation — blocking `main_frame` would blank the
  // very page the user asked for.
  if (details.type === 'main_frame') return { cancel: false };

  const pageHost = hostOf(details.initiator) ?? hostOf(details.url);
  if (pageHost && sets.isAllowlisted(pageHost)) return { cancel: false };

  const reqHost = hostOf(details.url);
  if (!reqHost) return { cancel: false };

  // Honor `@@` exception rules before any block rule.
  if (matchesSuffix(reqHost, sets.exceptions)) return { cancel: false };

  if (matchesSuffix(reqHost, sets.trackers)) return { cancel: true, kind: 'trackers' };
  if (matchesSuffix(reqHost, sets.ads)) return { cancel: true, kind: 'network' };
  return { cancel: false };
}
