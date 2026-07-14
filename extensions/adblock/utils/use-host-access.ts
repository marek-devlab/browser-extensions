import { useEffect, useState } from 'react';
import { hasHostAccess, requestHostAccess, watchHostAccess } from './permissions';

/**
 * React state for the runtime `<all_urls>` host grant (Chromium). Firefox holds
 * it as an install-time permission, so `hasHostAccess` is always true there and
 * this hook simply never shows the "grant needed" affordance. `request()` must be
 * called from a user gesture (it is, from the toggle/button click handlers).
 */
export function useHostAccess(): { granted: boolean; request: () => Promise<boolean> } {
  // Assume granted until the async check resolves so Firefox (and an
  // already-granted Chrome) never flash a spurious "needs access" note.
  const [granted, setGranted] = useState(true);

  useEffect(() => {
    let active = true;
    const refresh = (): void => {
      void hasHostAccess().then((g) => {
        if (active) setGranted(g);
      });
    };
    refresh();
    const unwatch = watchHostAccess(refresh);
    return () => {
      active = false;
      unwatch();
    };
  }, []);

  async function request(): Promise<boolean> {
    const ok = await requestHostAccess();
    if (ok) setGranted(true);
    return ok;
  }

  return { granted, request };
}
