import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

// Permission FACTS, read from the browser — never from a stored flag.
//
// The design's hardest honesty rule (§3, §8, §2.11): the auto-format toggle has
// TWO different "on" states — the stored INTENT (`prefs.autoFormat`) and the
// actual grant (`permissions.contains`). They diverge across devices (sync
// carries the intent, permissions don't). The UI must show the FACT. This module
// reads the fact and re-reads it on `permissions.onAdded/onRemoved`, so a grant
// revoked from chrome://extensions immediately flips the UI to "off" instead of
// lying "on" while the feature is dead.
//
// These helpers are REAL (they genuinely call `browser.permissions`). What is
// stubbed elsewhere is what we DO with a grant (registering the content script,
// running the in-page formatter) — see utils/format-page.ts.

/**
 * Does the extension currently hold the optional `scripting` permission?
 *
 * ⚠️ Firefox MV2 has no `scripting` API and no `scripting` permission:
 * `tabs.executeScript` runs straight from `activeTab`. Asking for it there would
 * throw (unknown permission) and the popup button would sit disabled forever
 * with a lie under it. So on MV2 the honest answer is "yes, we can already do
 * this" — because we can.
 */
export async function hasScripting(): Promise<boolean> {
  if (!('scripting' in browser)) return true; // Firefox MV2: activeTab is enough
  try {
    return await browser.permissions.contains({ permissions: ['scripting'] });
  } catch {
    return false;
  }
}

/** Does the extension currently hold `<all_urls>` host access (auto-format)? */
export async function hasAllUrls(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: ['<all_urls>'] });
  } catch {
    return false;
  }
}

/** Request `scripting` (permission-only — no host, so no scary prompt). */
export async function requestScripting(): Promise<boolean> {
  if (!('scripting' in browser)) return true; // nothing to ask for on MV2
  try {
    return await browser.permissions.request({ permissions: ['scripting'] });
  } catch {
    return false;
  }
}

/** Request `<all_urls>` host access for the auto-formatter (shows the browser's
 *  broad-access prompt — only ever called from behind the consent dialog). */
export async function requestAllUrls(): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: ['<all_urls>'] });
  } catch {
    return false;
  }
}

export async function revokeAllUrls(): Promise<boolean> {
  try {
    return await browser.permissions.remove({ origins: ['<all_urls>'] });
  } catch {
    return false;
  }
}

/**
 * Live view of a permission fact. Returns `null` until the first check resolves
 * (so the UI can disable the control rather than assume "off"), then re-reads on
 * every add/remove so external revokes flip the UI immediately.
 */
export function usePermissionFact(kind: 'scripting' | 'allUrls'): boolean | null {
  const [granted, setGranted] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    const check = kind === 'scripting' ? hasScripting : hasAllUrls;
    void check().then(setGranted);
  }, [kind]);

  useEffect(() => {
    refresh();
    // `permissions.onAdded` / `onRemoved` fire for grants/revocations made
    // anywhere — including chrome://extensions. Without this, the UI would keep
    // showing "granted" after an external revoke (design §8).
    const perms = browser.permissions;
    perms.onAdded?.addListener(refresh);
    perms.onRemoved?.addListener(refresh);
    return () => {
      perms.onAdded?.removeListener(refresh);
      perms.onRemoved?.removeListener(refresh);
    };
  }, [refresh]);

  return granted;
}
