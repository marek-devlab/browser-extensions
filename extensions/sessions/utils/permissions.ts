import { browser } from '#imports';

// Optional-permission helpers (PLAN.md §14.2). The baseline install shows exactly
// ONE warning ("Read your browsing history", from `tabs`). Everything else is
// OPTIONAL and requested only on a user gesture, so a user who never touches groups
// or containers is never asked for them.
//
// `permissions.request` MUST be called synchronously from a user gesture — callers
// pass these straight through from an onClick.

type OptionalPerm = 'tabGroups' | 'sessions' | 'cookies' | 'unlimitedStorage';

export async function hasPermission(name: OptionalPerm): Promise<boolean> {
  try {
    return await browser.permissions.contains({ permissions: [name] });
  } catch {
    return false;
  }
}

/** Request an optional permission from a gesture. Resolves to whether it is now
 *  held (true if it was already granted). Never throws — a rejected/denied request
 *  simply returns false and the caller degrades gracefully. */
export async function requestPermission(name: OptionalPerm): Promise<boolean> {
  try {
    if (await browser.permissions.contains({ permissions: [name] })) return true;
    return await browser.permissions.request({ permissions: [name] });
  } catch {
    return false;
  }
}

/** Runtime feature-detection for the tab-groups API. Present on Chrome 137+ and
 *  Firefox 138+ (full `update` only on FF139+ — the caller try/catches update). */
export function tabGroupsSupported(): boolean {
  return typeof browser.tabGroups !== 'undefined' && typeof browser.tabGroups.update === 'function';
}
