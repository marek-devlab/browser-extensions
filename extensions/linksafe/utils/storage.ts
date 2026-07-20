import { storage } from '#imports';
import type { Locale } from '@blur/ui';

// Storage layout — 🔴 PREFERENCES + a user-curated ALLOWLIST only (PLAN.md §12.3).
// Everything lives in `storage.local` (never `sync`). Nothing here is data ABOUT the
// user's browsing: it is a theme choice and a list of domains the user EXPLICITLY
// trusted to auto-resolve (a consent list, not history). There is deliberately no
// place to record visited URLs, resolved destinations, click history, or any
// identifier — the local-by-default guarantee (§12.3) is architectural: the popup
// and injected overlay hold analysis in memory and it dies with the surface.

export type Theme = 'auto' | 'light' | 'dark';

export interface LinksafePrefs {
  theme: Theme;
}

/** Closed key set, enforced against `LinksafePrefs` by `_keysAreClosed` below so a
 *  new field cannot be added silently (the same speed-bump the family uses). */
export const PREFS_KEYS = ['theme'] as const satisfies readonly (keyof LinksafePrefs)[];

export const DEFAULT_PREFS: LinksafePrefs = {
  theme: 'auto',
};

/** Cap on the auto-resolve allowlist. It is a short list of trusted shortener
 *  domains, not a dataset — a bound keeps a corrupt/hand-edited entry sane. */
export const MAX_TRUSTED = 100;

/** Runtime UI language. Kept in its OWN item (outside the prefs schema) so it can be
 *  seeded/read independently. Default is English, independent of browser locale. */
export const localeItem = storage.defineItem<Locale>('local:locale', { fallback: 'en' });

export const prefsItem = storage.defineItem<LinksafePrefs>('local:prefs', {
  fallback: DEFAULT_PREFS,
  version: 1,
  migrations: {
    // Populate as the prefs schema changes. A migration must NEVER introduce a key
    // that records browsing/identity.
  },
});

/** The "always resolve" allowlist: eTLD+1 domains the user chose to resolve without
 *  being asked each time (PLAN.md §12.3). Just registrable-domain strings. */
export const trustedDomainsItem = storage.defineItem<string[]>('local:trustedDomains', {
  fallback: [],
});

export function normalizePrefs(raw: unknown): LinksafePrefs {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const theme: Theme =
    r.theme === 'light' || r.theme === 'dark' || r.theme === 'auto'
      ? r.theme
      : DEFAULT_PREFS.theme;
  return { theme };
}

/** Defensive read: coerce to a lowercased, de-duplicated, capped list of plausible
 *  domain strings. An unknown/corrupt value can never reach the resolve path. */
export function normalizeTrusted(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const host = entry.trim().toLowerCase();
    // A registrable domain: at least one dot, only host-legal characters.
    if (!/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(host)) continue;
    seen.add(host);
    if (seen.size >= MAX_TRUSTED) break;
  }
  return [...seen];
}

export async function getTrustedDomains(): Promise<string[]> {
  return normalizeTrusted(await trustedDomainsItem.getValue().catch(() => []));
}

export async function isTrustedDomain(domain: string | null): Promise<boolean> {
  if (!domain) return false;
  const list = await getTrustedDomains();
  return list.includes(domain.toLowerCase());
}

export async function addTrustedDomain(domain: string): Promise<string[]> {
  const list = await getTrustedDomains();
  const next = normalizeTrusted([...list, domain]);
  await trustedDomainsItem.setValue(next).catch(() => undefined);
  return next;
}

export async function removeTrustedDomain(domain: string): Promise<string[]> {
  const list = await getTrustedDomains();
  const next = list.filter((d) => d !== domain.toLowerCase());
  await trustedDomainsItem.setValue(next).catch(() => undefined);
  return next;
}

/* --------------------------------------------------------------------------- */
/* Compile-time schema guard (runs in `npm run compile`, no runtime cost).       */
/* --------------------------------------------------------------------------- */

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/** `PREFS_KEYS` must equal `keyof LinksafePrefs` exactly. */
const _keysAreClosed: Exact<(typeof PREFS_KEYS)[number], keyof LinksafePrefs> = true;

/** Denylist of well-known browsing/identifier field names — adding any stops the
 *  build. The total backstop is `_keysAreClosed`; this catches the obvious. */
type ForbiddenKey =
  | 'history'
  | 'visited'
  | 'urls'
  | 'clicks'
  | 'resolved'
  | 'lastUrl'
  | 'installId'
  | 'clientId'
  | 'userId'
  | 'analyticsOptIn';

const _noBrowsingInSchema: Extract<keyof LinksafePrefs, ForbiddenKey> extends never
  ? true
  : never = true;

export const SCHEMA_GUARDS = { _keysAreClosed, _noBrowsingInSchema } as const;
