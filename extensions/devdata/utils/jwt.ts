// JWT decode + signature verification.
//
// SECURITY INVARIANTS (design §7.2) — these are architectural, not reminders:
//   - This module HOLDS NOTHING. The token, the HS256 secret and the public key
//     arrive as arguments and leave as return values. There is no module state,
//     no cache, no "recent tokens", and — crucially — no storage item anywhere
//     in this extension that could receive them.
//   - Verification is 100% local: `jose` runs on WebCrypto, in this tab. There
//     is no `fetch` in this extension at all, so a JWKS URL cannot be resolved
//     even by accident. The token never leaves the browser.
//   - Decode is `atob` + `JSON.parse` — no library, no Worker, instant.

import type { Locale } from '@blur/ui';
import { atobUrl } from './core/detect';
import { tAt, type MsgKey } from './i18n';
import type { JwtClaim, JwtDecoded, JwtVerifyResult } from './types';

export class JwtError extends Error {}

/**
 * Hard cap on token length before we touch it. `decodeJwt` runs on every
 * keystroke; a JWT is a compact credential (a large one is a few KB), so a
 * multi-MB paste is never a token — parsing it would just freeze the field.
 * Refuse cleanly instead. (Distinct from detect.ts's much larger heuristic cap,
 * which decides whether text *inside a document* looks token-shaped.)
 */
export const MAX_JWT_LEN = 8192;

/** Decode header + payload. Partial success is shown partially (design §4.4). */
export function decodeJwt(token: string, locale: Locale): JwtDecoded {
  const t = token.trim();
  if (t.length > MAX_JWT_LEN) {
    throw new JwtError(
      tAt(locale, 'jwt.decodeTooLong', { len: t.length, max: MAX_JWT_LEN }),
    );
  }
  const parts = t.split('.');
  if (parts.length !== 3) {
    throw new JwtError(tAt(locale, 'jwt.notThreeParts', { count: parts.length }));
  }
  const [h, p, s] = parts as [string, string, string];

  const hStart = 0;
  const hEnd = h.length;
  const pStart = hEnd + 1;
  const pEnd = pStart + p.length;
  const sStart = pEnd + 1;
  const sEnd = sStart + s.length;

  let header: Record<string, unknown> | null = null;
  let headerText = '';
  const problems: string[] = [];

  try {
    const raw = atobUrl(h);
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(tAt(locale, 'jwt.headerNotObject'));
    }
    header = parsed as Record<string, unknown>;
    headerText = JSON.stringify(header, null, 2);
  } catch (err) {
    throw new JwtError(
      tAt(locale, 'jwt.headerCorrupt', { message: (err as Error).message }),
    );
  }

  // A JWT payload does not have to be JSON (RFC 7519 §7.2 allows any content).
  // When it isn't, we show the raw payload and keep the (valid!) header — an
  // all-or-nothing blank screen would be wrong here.
  let payload: Record<string, unknown> | null = null;
  let payloadText = '';
  let payloadIsJson = false;
  try {
    const raw = atobUrl(p);
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
        payloadText = JSON.stringify(payload, null, 2);
        payloadIsJson = true;
      } else {
        payloadText = raw;
        problems.push(tAt(locale, 'jwt.payloadNotObject'));
      }
    } catch {
      payloadText = raw;
      problems.push(tAt(locale, 'jwt.payloadNotJsonProblem'));
    }
  } catch (err) {
    payloadText = '';
    problems.push(
      tAt(locale, 'jwt.payloadNotBase64', { message: (err as Error).message }),
    );
  }

  const alg = typeof header.alg === 'string' ? header.alg : '';
  const algNone = alg.toLowerCase() === 'none';
  const symmetric = /^HS\d+$/i.test(alg);

  if (s === '' && !algNone) {
    problems.push(tAt(locale, 'jwt.emptySignature'));
  }

  return {
    header,
    payload,
    headerText,
    payloadText,
    payloadIsJson,
    alg: alg === '' ? '—' : alg,
    algNone,
    symmetric,
    claims: payload ? readClaims(payload, locale) : [],
    segments: {
      header: [hStart, hEnd],
      payload: [pStart, pEnd],
      signature: [sStart, sEnd],
    },
    problems,
  };
}

const CLAIM_LABEL_KEYS: Record<string, MsgKey> = {
  iss: 'jwt.claim.iss',
  sub: 'jwt.claim.sub',
  aud: 'jwt.claim.aud',
  exp: 'jwt.claim.exp',
  nbf: 'jwt.claim.nbf',
  iat: 'jwt.claim.iat',
  jti: 'jwt.claim.jti',
};

function claimLabel(name: string, locale: Locale): string {
  const key = CLAIM_LABEL_KEYS[name];
  return key ? tAt(locale, key) : name;
}

const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat']);

function readClaims(payload: Record<string, unknown>, locale: Locale): JwtClaim[] {
  const now = Date.now();
  const out: JwtClaim[] = [];

  for (const name of ['iat', 'nbf', 'exp', 'iss', 'sub', 'aud', 'jti']) {
    const value = payload[name];
    if (value === undefined) {
      out.push({
        name,
        label: claimLabel(name, locale),
        value: '—',
        note: null,
        status: 'info',
      });
      continue;
    }

    if (TIME_CLAIMS.has(name)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        out.push({
          name,
          label: claimLabel(name, locale),
          value: String(value),
          note: tAt(locale, 'jwt.claimNotNumber'),
          status: 'warn',
        });
        continue;
      }
      const ms = value * 1000;
      const iso = new Date(ms).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
      let note: string | null = null;
      let status: JwtClaim['status'] = 'info';
      if (name === 'exp') {
        if (ms < now) {
          note = tAt(locale, 'jwt.expired', { span: humanSpan(now - ms, locale) });
          status = 'poor';
        } else {
          note = tAt(locale, 'jwt.validFor', { span: humanSpan(ms - now, locale) });
          status = 'ok';
        }
      } else if (name === 'nbf') {
        if (ms > now) {
          note = tAt(locale, 'jwt.notYetValid', { span: humanSpan(ms - now, locale) });
          status = 'poor';
        } else {
          note = tAt(locale, 'jwt.activeSince', { span: humanSpan(now - ms, locale) });
          status = 'ok';
        }
      } else {
        note = tAt(locale, ms <= now ? 'jwt.spanAgo' : 'jwt.spanAhead', {
          span: humanSpan(Math.abs(now - ms), locale),
        });
        if (ms > now + 60_000) {
          note = tAt(locale, 'jwt.issuedFuture', { span: humanSpan(ms - now, locale) });
          status = 'warn';
        }
      }
      out.push({ name, label: claimLabel(name, locale), value: iso, note, status });
      continue;
    }

    out.push({
      name,
      label: claimLabel(name, locale),
      value: Array.isArray(value) ? value.join(', ') : String(value),
      note: null,
      status: 'ok',
    });
  }

  // Everything else the token carries, verbatim.
  for (const [key, value] of Object.entries(payload)) {
    if (CLAIM_LABEL_KEYS[key] !== undefined) continue;
    out.push({
      name: key,
      label: tAt(locale, 'jwt.claim.custom'),
      value:
        typeof value === 'object' && value !== null
          ? JSON.stringify(value)
          : String(value),
      note: null,
      status: 'info',
    });
  }

  return out;
}

function humanSpan(ms: number, locale: Locale): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return tAt(locale, 'jwt.spanDH', { d, h });
  if (h > 0) return tAt(locale, 'jwt.spanHM', { h, m });
  if (m > 0) return tAt(locale, 'jwt.spanM', { m });
  return tAt(locale, 'jwt.spanS', { s });
}

/* ------------------------------ verification ------------------------------ */

export interface VerifyInput {
  token: string;
  alg: string;
  /** HS*: the shared secret. Otherwise: a public key as JWK (JSON) or PEM. */
  keyMaterial: string;
  /** HS* only: the secret is base64-encoded rather than raw bytes. */
  secretIsBase64: boolean;
  /** UI language for the human-readable result detail. */
  locale: Locale;
}

/**
 * Verify the signature locally with WebCrypto (via `jose`, lazily imported —
 * design §10.3). Nothing is sent anywhere; there is no network in this
 * extension.
 *
 * ⚠️ "Invalid" NEVER claims "forged": a wrong key and a tampered token are
 * cryptographically indistinguishable, and pretending otherwise would be a lie
 * (design §2.7).
 */
export async function verifyJwt(input: VerifyInput): Promise<JwtVerifyResult> {
  const { token, alg, keyMaterial, secretIsBase64, locale } = input;

  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return { status: 'error', detail: tAt(locale, 'jwt.verifyNoWebCrypto') };
  }
  if (alg.toLowerCase() === 'none') {
    return { status: 'error', detail: tAt(locale, 'jwt.verifyAlgNone') };
  }
  if (keyMaterial.trim() === '') {
    return {
      status: 'error',
      detail: tAt(locale, /^HS/i.test(alg) ? 'jwt.verifyPasteSecret' : 'jwt.verifyPasteKey'),
    };
  }

  const jose = await import('jose');

  let key: CryptoKey | Uint8Array;
  try {
    key = await importKey(jose, alg, keyMaterial, secretIsBase64, locale);
  } catch (err) {
    return {
      status: 'error',
      detail: tAt(locale, 'jwt.keyNotRecognized', { message: (err as Error).message }),
    };
  }

  try {
    await jose.compactVerify(token.trim(), key as CryptoKey, {
      algorithms: [alg],
    });
    return { status: 'valid', detail: tAt(locale, 'jwt.verifyValidDetail') };
  } catch (err) {
    const message = (err as Error).message ?? '';
    // A key of the wrong TYPE for the algorithm is a different problem from a
    // bad signature — say which, instead of a flat "verification failed".
    if (/alg|algorithm|key.*(type|usage)|unsupported/i.test(message)) {
      return {
        status: 'error',
        detail: tAt(locale, 'jwt.algMismatch', { alg, message }),
      };
    }
    return { status: 'invalid', detail: tAt(locale, 'jwt.verifyInvalidDetail') };
  }
}

type Jose = typeof import('jose');

async function importKey(
  jose: Jose,
  alg: string,
  material: string,
  secretIsBase64: boolean,
  locale: Locale,
): Promise<CryptoKey | Uint8Array> {
  const text = material.trim();

  if (/^HS\d+$/i.test(alg)) {
    if (!secretIsBase64) return new TextEncoder().encode(text);
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  if (text.startsWith('{')) {
    const jwk: unknown = JSON.parse(text);
    if (
      typeof jwk === 'object' &&
      jwk !== null &&
      typeof (jwk as { d?: unknown }).d === 'string'
    ) {
      throw new Error(tAt(locale, 'jwt.privateJwk'));
    }
    return (await jose.importJWK(jwk as import('jose').JWK, alg)) as CryptoKey;
  }

  if (text.includes('BEGIN PRIVATE KEY') || text.includes('BEGIN RSA PRIVATE KEY')) {
    throw new Error(tAt(locale, 'jwt.privatePem'));
  }
  if (text.includes('BEGIN CERTIFICATE')) {
    return (await jose.importX509(text, alg)) as CryptoKey;
  }
  if (text.includes('BEGIN PUBLIC KEY')) {
    return (await jose.importSPKI(text, alg)) as CryptoKey;
  }

  throw new Error(tAt(locale, 'jwt.notJwkOrPem'));
}
