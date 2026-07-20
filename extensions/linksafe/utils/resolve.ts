import { browser } from '#imports';

// ADVANCED, OPT-IN, NETWORK path (PLAN.md §12.2 / §12.3). Everything else in this
// extension is 100% local; this is the ONE place a request leaves the browser, and
// it happens only after an explicit gesture + disclosure in the popup.
//
// 🔴 Why this is dangerous and why the UI says so: a shortener/tracking URL often
// carries a one-time token (unsubscribe, password-reset, per-recipient id). Fetching
// it BURNS the token and de-anonymises the click — the exact harm we protect against.
// So the request is never made silently.
//
// ⚠️ Honest limits, surfaced verbatim in the UI (i18n `resolveNote`):
//   - `fetch(url, { redirect: 'follow' })` exposes ONLY the final `response.url`.
//     Intermediate hops are invisible; `redirect: 'manual'` yields an opaque
//     response whose `Location` cannot be read. Hop-by-hop with statuses needs
//     `webRequest` — out of MVP scope.
//   - The result is "the destination the server reports for this one unauthenticated
//     request", not a guarantee; JS/meta-refresh redirects are not followed.

export type ResolveOutcome =
  | { ok: true; finalUrl: string }
  | { ok: false; reason: 'permission' | 'unsupported' | 'network'; error?: string };

/** Build the host permission pattern (`https://host/*`) for a URL, or null. */
function originPatternFor(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

/** Do we already hold host access for this URL (so we can skip the prompt for a
 *  trusted / already-granted domain)? Never throws. */
export async function hasHostPermission(url: string): Promise<boolean> {
  const origin = originPatternFor(url);
  if (!origin || !browser.permissions?.contains) return false;
  try {
    return await browser.permissions.contains({ origins: [origin] });
  } catch {
    return false;
  }
}

/**
 * Request host access for this URL. MUST be called synchronously first inside the
 * user gesture (Firefox is strict about this — see whoami/utils/network.ts). Returns
 * false on denial or when the platform has no `permissions.request` (Safari/iOS →
 * resolve is dropped, §12.6).
 */
export async function requestHostPermission(url: string): Promise<boolean> {
  const origin = originPatternFor(url);
  if (!origin || !browser.permissions?.request) return false;
  try {
    return await browser.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

/**
 * ONE `fetch` with `redirect: 'follow'`, reading only the final URL. Cookies are
 * omitted (`credentials: 'omit'`) so the request is as anonymous as a URL with an
 * embedded token can be. Never throws — failures come back as an outcome.
 */
export async function fetchFinalUrl(url: string): Promise<ResolveOutcome> {
  if (typeof fetch !== 'function') return { ok: false, reason: 'unsupported' };
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
    });
    // Consume nothing: we only care about the final URL, not the body.
    return { ok: true, finalUrl: res.url || url };
  } catch (error) {
    return { ok: false, reason: 'network', error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Full resolve for one gesture. `requestHostPermission` is the FIRST awaited call so
 * Firefox still sees the user gesture (whoami/utils/network.ts §14.2); for an
 * already-granted host the browser resolves it true WITHOUT re-prompting, so this is
 * also the fast path for a trusted / previously-granted domain. Returns
 * `{ ok:false, reason:'permission' }` if access is refused.
 */
export async function resolveDestination(url: string): Promise<ResolveOutcome> {
  const granted = await requestHostPermission(url);
  if (!granted) return { ok: false, reason: 'permission' };
  return fetchFinalUrl(url);
}
