import { browser } from '#imports';

// T1/T2 · NETWORK HALF — REAL (design §0, §4.2, §4.3, §9, §10).
//
// 🔴 THE PRIVACY BOUNDARY LIVES HERE, AND IT IS ARCHITECTURAL, NOT A PROMISE:
//   1. These two functions are the ONLY code in the extension that can touch the
//      network, and the manifest CSP `connect-src` (wxt.config.ts) allows exactly
//      the two hosts they name. Anything else fails at the platform level.
//   2. They RETURN values. They never write them anywhere. There is no background
//      service worker, no storage key and no cache that could hold an IP — the
//      caller drops the result into React state in the popup/report document and
//      it dies with that document (utils/storage.ts has no slot for it).
//   3. Nothing is hashed, derived, correlated or counted. No analytics.
//
// SECURITY (design §9, §10): every response is UNTRUSTED input.
//   - `AbortSignal.timeout(8000)` on both fetches — no request can hang forever.
//   - A hard byte cap while streaming the body — a hostile/huge response cannot
//     exhaust memory before we even parse it.
//   - Whitelist parsing: only known keys are read, each value is charset-checked
//     and clamped to 256 chars. Unknown/extra/missing keys are ignored, never
//     spread into state (no `Object.assign`, no `...json`).
//   - `credentials: 'omit'` (no cookie may ride along), `referrerPolicy:
//     'no-referrer'`, `cache: 'no-store'`, `redirect: 'error'`.
//   - Values are rendered as React text nodes; there is no `innerHTML` anywhere.
//   - Every failure resolves to a typed `NetOutcome`, so there is no unhandled
//     rejection and every error has a visible UI state.

/** Cloudflare's diagnostic trace: no key, HTTPS, `Access-Control-Allow-Origin: *`.
 *  ⚠️ It yields ip / loc / colo / tls / http / warp / uag — and NO ISP, NO ASN and
 *  NO city. We never claim otherwise (design §7). */
export const TRACE_URL = 'https://one.one.one.one/cdn-cgi/trace';

/** ⚠️ The ISP lookup is pinned to the ipinfo.io ORIGIN ITSELF (not a subdomain), so
 *  the URL we fetch, the CSP `connect-src` entry and the optional host permission
 *  are one and the same host — an auditor can check all three line up. */
export const IPINFO_URL = 'https://ipinfo.io/json';
export const IPINFO_ORIGINS = ['https://ipinfo.io/*'];

const TIMEOUT_MS = 8_000;
/** Hard cap on any response body. The trace is ~200 B and ipinfo's JSON is < 1 KB;
 *  16 KB is generous and still bounds a hostile response. */
const MAX_BYTES = 16 * 1024;
/** 🔴 Per-value clamp (design §9). */
const MAX_FIELD = 256;

/* --------------------------------------------------------------------------- */
/* Result shapes — every field is independently optional so the parser can       */
/* DEGRADE PER FIELD if Cloudflare ever changes the format (design §10). Only    */
/* `ip` is load-bearing: without it we show the "could not get IP" state.        */
/* --------------------------------------------------------------------------- */

export interface TraceResult {
  ip: string;
  ipVersion: 'IPv4' | 'IPv6';
  /** ISO-3166 alpha-2 country code — the ONLY geo fact Cloudflare gives us. */
  countryCode: string | null;
  /** Cloudflare PoP (⚠️ their datacentre, NOT the user's city). */
  colo: string | null;
  tls: string | null;
  http: string | null;
  warp: string | null;
  /** UA as the server saw it — compared against `navigator.userAgent` to reveal a
   *  proxy/extension rewriting it (design §2.3). */
  uag: string | null;
}

export interface IspResult {
  /** ISP / AS name, parsed out of ipinfo's `org` ("AS16019 Vodafone Czech ..."). */
  isp: string | null;
  asn: string | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
  hostname: string | null;
}

export type NetFailure = {
  ok: false;
  kind: 'timeout' | 'offline' | 'rate-limited' | 'unauthorized' | 'malformed' | 'error';
  message: string;
  retryAfterSec?: number;
};

export type NetOutcome<T> = { ok: true; value: T } | NetFailure;

/* --------------------------------------------------------------------------- */
/* Untrusted-input plumbing                                                      */
/* --------------------------------------------------------------------------- */

/** Control characters (C0 + DEL) — stripped from every value that came off the
 *  wire, so nothing can smuggle a newline/NUL into a row, a copy or an export. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Strip control characters, trim, clamp. Applied to EVERY value from the network
 *  before it can reach the UI. */
function clean(raw: string): string {
  return raw.replace(CONTROL_CHARS, '').trim().slice(0, MAX_FIELD);
}

/** Clamp a LOCAL string exactly the way values off the wire are clamped, so a
 *  comparison against a network value is like-for-like. 🔴 Used to compare
 *  `navigator.userAgent` with the server-clamped `uag`: a legitimate UA longer than
 *  256 chars is truncated on the wire and must not read as a spoof (design §2.3). */
export function clampField(raw: string): string {
  return clean(raw);
}

/** Keep a value only if it matches the shape we expect; otherwise treat it as
 *  absent. 🔴 A field we cannot validate becomes `null` (→ an EXPLAINED chip in the
 *  UI), never a half-trusted string. */
function guard(value: string | undefined, re: RegExp): string | null {
  if (value === undefined) return null;
  const v = clean(value);
  return v !== '' && re.test(v) ? v : null;
}

const RE_IP = /^[0-9a-f:.]{3,45}$/i;
const RE_IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const RE_IPV6 = /^[0-9a-f:]{2,45}$/i;
const RE_COUNTRY = /^[A-Z]{2}$/;
const RE_COLO = /^[A-Z]{3,5}$/;
/** Printable ASCII, bounded — for `tls` / `http`. */
const RE_TOKEN = /^[ -~]{1,64}$/;
const RE_WARP = /^(on|off|plus)$/;
const RE_HOSTNAME = /^[a-z0-9.\-_]{1,253}$/i;
/** Place names may be non-ASCII; control chars are already stripped by `clean`. */
const RE_PLACE = /^[^\u0000-\u001f]{1,64}$/;

function ipVersionOf(ip: string): 'IPv4' | 'IPv6' | null {
  if (RE_IPV4.test(ip)) {
    return ip.split('.').every((o) => Number(o) <= 255) ? 'IPv4' : null;
  }
  return ip.includes(':') && RE_IPV6.test(ip) ? 'IPv6' : null;
}

/**
 * Read a response body with a HARD BYTE CAP, cancelling the stream the moment it
 * goes over. A `Content-Length` that already exceeds the cap is rejected without
 * reading a byte.
 */
async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new RangeError('response too large');

  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new RangeError('response too large');
    return text;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new RangeError('response too large');
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/** The security options are identical for both calls and are NOT optional
 *  (design §9): a cookie riding along would make "one anonymous request" false. */
function requestInit(external?: AbortSignal, accept?: string): RequestInit {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  // `AbortSignal.any` is widely available; where it is missing, the timeout alone
  // still bounds the request (and a torn-down document aborts the rest for free).
  const signal =
    external && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([timeout, external])
      : timeout;
  return {
    method: 'GET',
    signal,
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'error',
    ...(accept ? { headers: { Accept: accept } } : {}),
  };
}

/** Map a thrown fetch/parse error onto a typed, user-visible failure. 🔴 Never
 *  leaks a stack trace or an "Error 0" into the UI (design §5). */
function toFailure(err: unknown, what: string): NetFailure {
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError') {
    return { ok: false, kind: 'timeout', message: `${what} не ответил за 8 секунд.` };
  }
  if (name === 'AbortError') {
    return { ok: false, kind: 'error', message: 'Запрос отменён.' };
  }
  if (err instanceof RangeError) {
    return {
      ok: false,
      kind: 'malformed',
      message: `${what} вернул слишком большой ответ — он отброшен.`,
    };
  }
  return {
    ok: false,
    kind: 'error',
    message: `Не удалось связаться с ${what}. Возможно, нет интернета или запрос блокируется.`,
  };
}

function retryAfterOf(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs > 0 && secs < 86_400) return Math.ceil(secs);
  const at = Date.parse(raw);
  if (Number.isFinite(at)) {
    const delta = Math.ceil((at - Date.now()) / 1000);
    if (delta > 0 && delta < 86_400) return delta;
  }
  return undefined;
}

/* --------------------------------------------------------------------------- */
/* T1 · Cloudflare trace — IP + country. No key, no host permission needed        */
/* (ACAO: *). Gated by the always-on inline disclosure + an explicit click.       */
/* --------------------------------------------------------------------------- */

/** The whitelist. Cloudflare sends ~16 keys (fl, ts, sni, kex, gateway, rbi, …);
 *  we read these seven and drop everything else on the floor. */
const TRACE_KEYS = new Set(['ip', 'loc', 'colo', 'tls', 'http', 'warp', 'uag']);

/** Parse the `key=value\n` text body. 🔴 Whitelist-only, charset-checked, clamped.
 *  Unknown keys are ignored and a MISSING key degrades that one field (design §10)
 *  — the endpoint has no SLA, so the parser must survive it changing shape. */
export function parseTrace(text: string): TraceResult | null {
  const raw = new Map<string, string>();
  for (const line of text.split('\n').slice(0, 64)) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!TRACE_KEYS.has(key) || raw.has(key)) continue;
    raw.set(key, line.slice(eq + 1));
  }

  const ip = guard(raw.get('ip'), RE_IP);
  const version = ip ? ipVersionOf(ip) : null;
  // 🔴 Without a well-formed IP there is no result at all: we show the honest
  // "could not get your IP" state (design §2.3c) rather than invent one.
  if (!ip || !version) return null;

  const uag = raw.get('uag');
  return {
    ip,
    ipVersion: version,
    countryCode: guard(raw.get('loc'), RE_COUNTRY),
    colo: guard(raw.get('colo'), RE_COLO),
    tls: guard(raw.get('tls'), RE_TOKEN),
    http: guard(raw.get('http'), RE_TOKEN),
    warp: guard(raw.get('warp'), RE_WARP),
    uag: uag ? clean(uag) || null : null,
  };
}

export async function fetchTrace(signal?: AbortSignal): Promise<NetOutcome<TraceResult>> {
  // ⚠️ `onLine === false` means "no network interface" — a reliable NO. We use it
  // only to avoid calling into the void; `true` proves nothing (design §4.6).
  if (!navigator.onLine) {
    return {
      ok: false,
      kind: 'offline',
      message: 'Нет подключения к сети. IP можно узнать только у внешнего сервера.',
    };
  }
  try {
    const res = await fetch(TRACE_URL, requestInit(signal, 'text/plain'));
    if (!res.ok) {
      return {
        ok: false,
        kind: res.status === 429 ? 'rate-limited' : 'error',
        message: `Cloudflare ответил кодом ${res.status}.`,
        retryAfterSec: retryAfterOf(res),
      };
    }
    const parsed = parseTrace(await readCapped(res));
    if (!parsed) {
      return {
        ok: false,
        kind: 'malformed',
        message: 'Cloudflare ответил в неожиданном формате — IP в ответе не найден.',
      };
    }
    return { ok: true, value: parsed };
  } catch (err) {
    return toFailure(err, 'Cloudflare');
  }
}

/* --------------------------------------------------------------------------- */
/* T2 · ipinfo.io — ISP / ASN. 🔴 Strictly opt-in: the caller shows the modal      */
/* disclosure and calls `requestIspPermission()` from the SAME user gesture       */
/* BEFORE this ever runs (design §4.3).                                          */
/* --------------------------------------------------------------------------- */

/** Read one string field out of untrusted JSON. 🔴 We never spread the parsed
 *  object into state; we pick, type-check, then clamp. */
function pick(json: unknown, key: string): string | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  const v = (json as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

export function parseIpinfo(json: unknown): IspResult | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;

  // ipinfo packs the AS number and the ISP name into one string: "AS16019 Vodafone…".
  const org = pick(json, 'org');
  let asn: string | null = null;
  let isp: string | null = null;
  if (org) {
    const m = /^(AS\d{1,10})\s+(.+)$/.exec(clean(org));
    if (m) {
      asn = m[1]!;
      isp = clean(m[2]!) || null;
    } else {
      isp = clean(org) || null;
    }
  }

  const result: IspResult = {
    isp,
    asn,
    countryCode: guard(pick(json, 'country'), RE_COUNTRY),
    city: guard(pick(json, 'city'), RE_PLACE),
    region: guard(pick(json, 'region'), RE_PLACE),
    hostname: guard(pick(json, 'hostname'), RE_HOSTNAME),
  };
  // Nothing usable came back → treat it as malformed rather than render a row of
  // chips that pretend a successful lookup happened.
  return Object.values(result).some((v) => v !== null) ? result : null;
}

/**
 * The real ISP lookup. `token` is the USER'S OWN ipinfo token — a bundled one would
 * be public in the bundle and burned within a week (design §14.1). An empty token is
 * a first-class state, not an error: we say "add it in Settings" and make NO request.
 */
export async function fetchIsp(token: string, signal?: AbortSignal): Promise<NetOutcome<IspResult>> {
  if (!navigator.onLine) {
    return { ok: false, kind: 'offline', message: 'Нет подключения к сети.' };
  }
  const trimmed = token.trim();
  if (trimmed === '') {
    return {
      ok: false,
      kind: 'unauthorized',
      message: 'Нужен ваш токен ipinfo.io — добавьте его в Настройках. Запрос не отправлялся.',
    };
  }
  try {
    const url = `${IPINFO_URL}?token=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, requestInit(signal, 'application/json'));

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        kind: 'unauthorized',
        // 🔴 Never silently fall back to another service — that would be an
        // undisclosed request to a recipient the user never agreed to (design §10).
        message: 'Токен не принят ipinfo.io. Проверьте его в Настройках.',
      };
    }
    if (res.status === 429) {
      return {
        ok: false,
        kind: 'rate-limited',
        message: 'Лимит запросов к ipinfo.io исчерпан.',
        retryAfterSec: retryAfterOf(res),
      };
    }
    if (!res.ok) {
      return { ok: false, kind: 'error', message: `ipinfo.io ответил кодом ${res.status}.` };
    }

    const text = await readCapped(res);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, kind: 'malformed', message: 'ipinfo.io вернул не JSON.' };
    }
    const parsed = parseIpinfo(json);
    if (!parsed) {
      return {
        ok: false,
        kind: 'malformed',
        message: 'Ответ ipinfo.io не содержит ожидаемых полей.',
      };
    }
    return { ok: true, value: parsed };
  } catch (err) {
    return toFailure(err, 'ipinfo.io');
  }
}

/* --------------------------------------------------------------------------- */
/* Host permission — the SECOND, un-fakeable disclosure and the native revoke     */
/* path (design §0.1). ⚠️ Both hosts send ACAO:*, so the fetch would technically   */
/* pass CORS without it; we ask anyway, on exactly ONE domain — never <all_urls>. */
/* --------------------------------------------------------------------------- */

/**
 * 🔴 Must be the FIRST call inside the gesture handler: any `await` before it eats
 * the user activation and Firefox throws "may only be called from a user input
 * handler" (design §4.3).
 */
export async function requestIspPermission(): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: IPINFO_ORIGINS });
  } catch {
    return false;
  }
}

/** The BROWSER is the source of truth for consent, not our flag (design §6.2): the
 *  user may have unticked the host access in chrome://extensions. Called on every
 *  mount, so our flag is rolled back to `unset` when that happens. */
export async function hasIspPermission(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: IPINFO_ORIGINS });
  } catch {
    return false;
  }
}

/** A REAL revoke (Options → «Отозвать», design §3 #12): it drops the host
 *  permission itself, not just a boolean. The caller also resets `ispConsent` to
 *  `unset`, so the disclosure dialog is shown again from scratch next time. */
export async function revokeIspPermission(): Promise<void> {
  try {
    await browser.permissions.remove({ origins: IPINFO_ORIGINS });
  } catch {
    // Nothing held, or the browser refuses — a no-op is the correct outcome.
  }
}

/* --------------------------------------------------------------------------- */
/* Presentation helpers                                                          */
/* --------------------------------------------------------------------------- */

/** Country name from an ISO code via `Intl.DisplayNames` — no bundled table, no
 *  network. Falls back to the bare code (which we render regardless). */
export function countryName(code: string): string | null {
  try {
    const dn = new Intl.DisplayNames([navigator.language, 'ru', 'en'], { type: 'region' });
    const name = dn.of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

/** Regional-indicator flag. 🔴 The country CODE is always rendered next to it —
 *  Windows draws no flag emoji, so the flag is a bonus, never the carrier of the
 *  meaning (design §9). */
export function flag(countryCode: string): string {
  if (!RE_COUNTRY.test(countryCode)) return '';
  const A = 0x1f1e6;
  return String.fromCodePoint(
    A + countryCode.charCodeAt(0) - 65,
    A + countryCode.charCodeAt(1) - 65,
  );
}
