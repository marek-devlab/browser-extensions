import { MOCK, mockAsync, todoLogic } from '@blur/ui';
import { browser } from '#imports';

// T1/T2 · NETWORK HALF — 🔴 MOCKED (design §0, MOCK RULES). The disclosure flow,
// the permission opt-in, the timeouts and every rendered state are REAL; only the
// two actual fetches are stubbed. Every stub carries a `todoLogic(...)` marker so
// `grep TODO_LOGIC` lists the exact backlog:
//   - `whoami: cloudflare trace`  → one.one.one.one/cdn-cgi/trace (IP + country)
//   - `whoami: ipinfo lookup`     → ipinfo.io / ipapi.co (ISP + ASN)
//
// 🔴 None of these results are ever persisted. They resolve into React state in the
// popup/report document and die with it — there is no background SW and no storage
// key to hold them (utils/storage.ts). Closing the popup discards them.
//
// When the real logic lands, each function will `fetch(..., { signal:
// AbortSignal.timeout(8000), cache: 'no-store', credentials: 'omit',
// referrerPolicy: 'no-referrer' })`, whitelist-parse the response (design §9), and
// clamp each value to 256 chars. The `if (!MOCK) throw todoLogic(...)` guard below
// marks exactly where that goes.

export interface TraceResult {
  ip: string;
  ipVersion: 'IPv4' | 'IPv6';
  countryCode: string;
  countryName: string;
  colo: string;
  tls: string;
  http: string;
  warp: string;
  /** UA as the server saw it — compared against navigator.userAgent (design §2.3). */
  uag: string;
}

export interface IspResult {
  isp: string;
  asn: string;
  domain: string;
  continent: string;
}

/** Loading/timeout/rate-limit are exercised against the mock via `mockAsync` so the
 *  real UI states are reachable in the scaffold (design MOCK RULES). */
export type NetOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; kind: 'timeout' | 'offline' | 'rate-limited' | 'unauthorized' | 'error'; message: string; retryAfterSec?: number };

const MOCK_TRACE: TraceResult = {
  ip: '203.0.113.42',
  ipVersion: 'IPv4',
  countryCode: 'CZ',
  countryName: 'Чехия',
  colo: 'PRG',
  tls: 'TLSv1.3',
  http: 'HTTP/3',
  warp: 'off',
  uag: navigator.userAgent,
};

const MOCK_ISP: IspResult = {
  isp: 'Vodafone Czech Republic a.s.',
  asn: 'AS16019',
  domain: 'vodafone.cz',
  continent: 'Европа',
};

/**
 * T1 · Cloudflare trace — IP + country. 🔴 MOCK. In production this parses the
 * `key=value` text body, taking only the whitelisted keys (ip, loc, colo, tls,
 * http, warp, uag). Returns the mock after a realistic delay so the loading state
 * renders.
 */
export async function fetchTrace(): Promise<NetOutcome<TraceResult>> {
  if (!navigator.onLine) {
    return { ok: false, kind: 'offline', message: 'Нет подключения. IP можно узнать только у внешнего сервера.' };
  }
  if (!MOCK) {
    // Real path lands here: fetch one.one.one.one/cdn-cgi/trace with the security
    // options above, whitelist-parse, clamp values.
    throw todoLogic('whoami: cloudflare trace');
  }
  return { ok: true, value: await mockAsync(MOCK_TRACE, 600) };
}

/**
 * T2 · ISP / ASN lookup — 🔴 MOCK. In production this fetches the configured
 * provider (ipinfo.io with the user's token, or keyless ipapi.co), gated by the
 * `<dialog>` + `permissions.request()` flow the CALLER runs first. Provider/token
 * are threaded in so the wiring is visible; the mock ignores them.
 */
export async function fetchIsp(
  provider: 'ipinfo' | 'ipapi',
  token: string,
): Promise<NetOutcome<IspResult>> {
  if (!navigator.onLine) {
    return { ok: false, kind: 'offline', message: 'Нет подключения к сети.' };
  }
  if (provider === 'ipinfo' && token.trim() === '') {
    return { ok: false, kind: 'unauthorized', message: 'Нужен токен ipinfo.io — добавьте его в Настройках.' };
  }
  if (!MOCK) {
    throw todoLogic('whoami: ipinfo lookup');
  }
  return { ok: true, value: await mockAsync(MOCK_ISP, 700) };
}

/**
 * The REAL permission opt-in. Requested from the SAME user gesture that submits the
 * disclosure `<dialog>` — 🔴 called BEFORE any `await` in the handler, or Firefox
 * drops the user-activation (design §4.3). Even though the fetch is mocked, the
 * native prompt + revoke path is wired for real. ipapi.co is keyless (ACAO:*) so it
 * needs no host permission; only ipinfo is gated here.
 */
export async function requestIspPermission(provider: 'ipinfo' | 'ipapi'): Promise<boolean> {
  if (provider === 'ipapi') return true;
  try {
    return await browser.permissions.request({ origins: ['https://ipinfo.io/*'] });
  } catch {
    return false;
  }
}

/** Source of truth for ISP consent is the browser, not our flag (design §6.2): the
 *  user may have revoked the host permission in chrome://extensions. Call on every
 *  mount to reconcile. */
export async function hasIspPermission(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: ['https://ipinfo.io/*'] });
  } catch {
    return false;
  }
}

/** Drop the ISP host permission (the "Revoke" button in Options, design §3 #12). */
export async function revokeIspPermission(): Promise<void> {
  try {
    await browser.permissions.remove({ origins: ['https://ipinfo.io/*'] });
  } catch {
    // Nothing held — a no-op is fine.
  }
}

/** Regional-indicator flag with a guaranteed text fallback. 🔴 Country CODE is
 *  always shown (Windows draws no flag emoji); the flag is a bonus (design §9). */
export function flag(countryCode: string): string {
  if (countryCode.length !== 2) return '';
  const A = 0x1f1e6;
  return String.fromCodePoint(
    A + countryCode.toUpperCase().charCodeAt(0) - 65,
    A + countryCode.toUpperCase().charCodeAt(1) - 65,
  );
}
