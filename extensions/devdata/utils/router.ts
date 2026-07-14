import { useEffect, useState } from 'react';

// Tiny hash router for the single tool page. The tool lives at `tool.html` and
// the browser's "Options" menu item points at `tool.html#/settings` (see
// wxt.config.ts `options_ui`), so hash routing is what makes ONE page serve both
// the tool and the options surface without a second entry point (design §1.2).

export type ToolRoute = 'data' | 'jwt' | 'schema' | 'settings';

export const TOOL_ROUTES: ToolRoute[] = ['data', 'jwt', 'schema', 'settings'];

const ROUTE_SET = new Set<ToolRoute>(TOOL_ROUTES);

/** Parse `#/settings` → 'settings'. Unknown/empty hash → null. */
export function parseHash(hash: string): ToolRoute | null {
  const raw = hash.replace(/^#\/?/, '').trim();
  return ROUTE_SET.has(raw as ToolRoute) ? (raw as ToolRoute) : null;
}

/**
 * Read the current route from `location.hash`, following back/forward and the
 * in-app tab clicks (which just set the hash). `fallback` is used when the hash
 * is empty or unknown — the tool page passes the user's `defaultTab` pref here.
 */
export function useHashRoute(fallback: ToolRoute): [ToolRoute, (r: ToolRoute) => void] {
  const [route, setRoute] = useState<ToolRoute>(
    () => parseHash(window.location.hash) ?? fallback,
  );

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash(window.location.hash) ?? fallback);
    };
    window.addEventListener('hashchange', onHashChange);
    // Re-sync once on mount in case the hash changed before listeners attached.
    onHashChange();
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [fallback]);

  const navigate = (r: ToolRoute) => {
    if (window.location.hash !== `#/${r}`) {
      window.location.hash = `#/${r}`;
    }
    setRoute(r);
  };

  return [route, navigate];
}
