import { useEffect, useState } from 'react';

// Hash router (design §1.3): `#/rules`, `#/rules/new`, `#/rules/:id`, `#/log`,
// `#/settings`. `?tab=<id>` after the path pre-filters the log and is what the
// popup's "Open the tool" passes. `options_ui` lands on `#/settings` (manifest).
// Deliberately tiny: no library, no history API — the hash IS the state, so a
// reload or a bookmark restores the view.

export type Page = 'rules' | 'log' | 'settings';

export interface Route {
  page: Page;
  /** `#/rules/:id`; `'new'` for the blank editor. */
  ruleId?: string;
  /** `?tab=` */
  tabId?: number;
  /** `?preset=` — empty-state preset to pre-fill the editor with. */
  preset?: string;
}

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = h.split('?', 2);
  const segs = (pathPart ?? '').split('/').filter(Boolean);
  const q = new URLSearchParams(queryPart ?? '');
  const tabRaw = q.get('tab');
  const tabId = tabRaw !== null && /^\d+$/.test(tabRaw) ? Number(tabRaw) : undefined;
  const preset = q.get('preset') ?? undefined;
  const page: Page = segs[0] === 'log' ? 'log' : segs[0] === 'settings' ? 'settings' : 'rules';
  const route: Route = { page };
  if (tabId !== undefined) route.tabId = tabId;
  if (preset) route.preset = preset;
  if (page === 'rules' && segs[1]) route.ruleId = decodeURIComponent(segs[1]);
  return route;
}

export function hashFor(route: Route): string {
  let path = `#/${route.page}`;
  if (route.page === 'rules' && route.ruleId) path += `/${encodeURIComponent(route.ruleId)}`;
  const q = new URLSearchParams();
  if (route.tabId !== undefined) q.set('tab', String(route.tabId));
  if (route.preset) q.set('preset', route.preset);
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

export function navigate(route: Route): void {
  const next = hashFor(route);
  if (location.hash !== next) location.hash = next;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
