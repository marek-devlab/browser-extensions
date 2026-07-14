import { browser } from '#imports';

/**
 * Runtime host-permission handling for Chromium (PLAN.md §14).
 *
 * `optional_host_permissions: ['<all_urls>']` is declared in the manifest but is
 * NOT granted at install time. Two dynamic-rule features genuinely need host
 * access to act:
 *   - the strip-tracking-params `redirect` rule (redirect is an "unsafe" DNR
 *     action that only fires on requests the extension has host access to), and
 *   - (defensively) any future header-modifying rule.
 *
 * The per-site `allowAllRequests` allowlist rule does NOT need a host grant — an
 * `allow`/`allowAllRequests` action is honored declaratively without one — so
 * pausing a site keeps working before any permission is requested (verified by
 * the e2e allowlist tests). On Firefox `<all_urls>` is an install-time grant, so
 * `contains` is always true and nothing is ever prompted.
 *
 * A permission REQUEST must originate from a user gesture, so it lives in the
 * popup/options click handlers; the background only ever READS the grant.
 */
const ALL_URLS: Browser.permissions.Permissions = { origins: ['<all_urls>'] };

export async function hasHostAccess(): Promise<boolean> {
  try {
    return await browser.permissions.contains(ALL_URLS);
  } catch {
    return false;
  }
}

/** Prompt for `<all_urls>`. MUST be called synchronously from a user gesture. */
export async function requestHostAccess(): Promise<boolean> {
  try {
    return await browser.permissions.request(ALL_URLS);
  } catch {
    return false;
  }
}

/** Re-run `cb` whenever host permissions are granted or revoked. */
export function watchHostAccess(cb: () => void): () => void {
  const added = browser.permissions.onAdded;
  const removed = browser.permissions.onRemoved;
  const handler = (): void => cb();
  added?.addListener(handler);
  removed?.addListener(handler);
  return () => {
    added?.removeListener(handler);
    removed?.removeListener(handler);
  };
}
