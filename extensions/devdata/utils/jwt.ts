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

import { atobUrl } from './core/detect';
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
export function decodeJwt(token: string): JwtDecoded {
  const t = token.trim();
  if (t.length > MAX_JWT_LEN) {
    throw new JwtError(
      `Слишком длинно для JWT: ${t.length} символов (предел ${MAX_JWT_LEN}). Настоящий токен — это несколько КБ; такая длина означает, что это не JWT.`,
    );
  }
  const parts = t.split('.');
  if (parts.length !== 3) {
    throw new JwtError(
      `Это не похоже на JWT: ожидались 3 части через точку, найдено ${parts.length}.`,
    );
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
      throw new Error('header не является JSON-объектом');
    }
    header = parsed as Record<string, unknown>;
    headerText = JSON.stringify(header, null, 2);
  } catch (err) {
    throw new JwtError(
      `Header повреждён: ${(err as Error).message}. Первый сегмент должен быть base64url-кодированным JSON.`,
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
        problems.push('Payload декодирован, но это не JSON-объект. Показан как есть.');
      }
    } catch {
      payloadText = raw;
      problems.push(
        'Payload декодирован, но это не JSON. Такой токен формально допустим — показан сырой текст.',
      );
    }
  } catch (err) {
    payloadText = '';
    problems.push(
      `Payload не декодируется как base64url: ${(err as Error).message}. Header при этом валиден и показан выше.`,
    );
  }

  const alg = typeof header.alg === 'string' ? header.alg : '';
  const algNone = alg.toLowerCase() === 'none';
  const symmetric = /^HS\d+$/i.test(alg);

  if (s === '' && !algNone) {
    problems.push('Подпись пуста, хотя алгоритм её требует.');
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
    claims: payload ? readClaims(payload) : [],
    segments: {
      header: [hStart, hEnd],
      payload: [pStart, pEnd],
      signature: [sStart, sEnd],
    },
    problems,
  };
}

const CLAIM_LABELS: Record<string, string> = {
  iss: 'Издатель',
  sub: 'Субъект',
  aud: 'Аудитория',
  exp: 'Истекает',
  nbf: 'Действует с',
  iat: 'Выпущен',
  jti: 'ID токена',
};

const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat']);

function readClaims(payload: Record<string, unknown>): JwtClaim[] {
  const now = Date.now();
  const out: JwtClaim[] = [];

  for (const name of ['iat', 'nbf', 'exp', 'iss', 'sub', 'aud', 'jti']) {
    const value = payload[name];
    if (value === undefined) {
      out.push({
        name,
        label: CLAIM_LABELS[name] ?? name,
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
          label: CLAIM_LABELS[name] ?? name,
          value: String(value),
          note: 'Не число — по RFC 7519 это должно быть время в секундах Unix.',
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
          note = `⛔ ПРОСРОЧЕН на ${humanSpan(now - ms)}`;
          status = 'poor';
        } else {
          note = `Действителен ещё ${humanSpan(ms - now)}`;
          status = 'ok';
        }
      } else if (name === 'nbf') {
        if (ms > now) {
          note = `⛔ ЕЩЁ НЕ ДЕЙСТВУЕТ — вступит в силу через ${humanSpan(ms - now)}`;
          status = 'poor';
        } else {
          note = `Действует с ${humanSpan(now - ms)} назад`;
          status = 'ok';
        }
      } else {
        note = `${humanSpan(Math.abs(now - ms))} ${ms <= now ? 'назад' : 'вперёд'}`;
        if (ms > now + 60_000) {
          note = `⚠ Выпущен в будущем (${humanSpan(ms - now)} вперёд)`;
          status = 'warn';
        }
      }
      out.push({ name, label: CLAIM_LABELS[name] ?? name, value: iso, note, status });
      continue;
    }

    out.push({
      name,
      label: CLAIM_LABELS[name] ?? name,
      value: Array.isArray(value) ? value.join(', ') : String(value),
      note: null,
      status: 'ok',
    });
  }

  // Everything else the token carries, verbatim.
  for (const [key, value] of Object.entries(payload)) {
    if (CLAIM_LABELS[key] !== undefined) continue;
    out.push({
      name: key,
      label: '(своя претензия)',
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

function humanSpan(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  if (m > 0) return `${m} мин`;
  return `${s} с`;
}

/* ------------------------------ verification ------------------------------ */

export interface VerifyInput {
  token: string;
  alg: string;
  /** HS*: the shared secret. Otherwise: a public key as JWK (JSON) or PEM. */
  keyMaterial: string;
  /** HS* only: the secret is base64-encoded rather than raw bytes. */
  secretIsBase64: boolean;
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
  const { token, alg, keyMaterial, secretIsBase64 } = input;

  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return {
      status: 'error',
      detail:
        'WebCrypto недоступен в этом контексте, проверить подпись нечем. На странице расширения он должен быть — сообщите об этом как об ошибке.',
    };
  }
  if (alg.toLowerCase() === 'none') {
    return {
      status: 'error',
      detail:
        'Токен заявляет alg: none — подписи нет, проверять нечего. Такой токен может подделать кто угодно.',
    };
  }
  if (keyMaterial.trim() === '') {
    return {
      status: 'error',
      detail: /^HS/i.test(alg)
        ? 'Вставьте общий секрет.'
        : 'Вставьте публичный ключ (JWK или PEM).',
    };
  }

  const jose = await import('jose');

  let key: CryptoKey | Uint8Array;
  try {
    key = await importKey(jose, alg, keyMaterial, secretIsBase64);
  } catch (err) {
    return {
      status: 'error',
      detail: `Ключ не распознан: ${(err as Error).message}. Ожидается JWK (JSON) или PEM (-----BEGIN PUBLIC KEY-----). Приватный ключ вставлять не нужно и не следует.`,
    };
  }

  try {
    await jose.compactVerify(token.trim(), key as CryptoKey, {
      algorithms: [alg],
    });
    return {
      status: 'valid',
      detail:
        'Проверено локально через WebCrypto. Ключ не сохранён, токен никуда не отправлялся.',
    };
  } catch (err) {
    const message = (err as Error).message ?? '';
    // A key of the wrong TYPE for the algorithm is a different problem from a
    // bad signature — say which, instead of a flat "verification failed".
    if (/alg|algorithm|key.*(type|usage)|unsupported/i.test(message)) {
      return {
        status: 'error',
        detail: `Алгоритм ${alg} из header не совпадает с типом вставленного ключа: ${message}`,
      };
    }
    return {
      status: 'invalid',
      detail: 'Проверено локально через WebCrypto.',
    };
  }
}

type Jose = typeof import('jose');

async function importKey(
  jose: Jose,
  alg: string,
  material: string,
  secretIsBase64: boolean,
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
      throw new Error(
        'это ПРИВАТНЫЙ ключ (в JWK есть параметр «d»). Для проверки подписи нужен только публичный',
      );
    }
    return (await jose.importJWK(jwk as import('jose').JWK, alg)) as CryptoKey;
  }

  if (text.includes('BEGIN PRIVATE KEY') || text.includes('BEGIN RSA PRIVATE KEY')) {
    throw new Error(
      'это ПРИВАТНЫЙ ключ. Для проверки подписи нужен публичный — приватный вставлять не следует никуда',
    );
  }
  if (text.includes('BEGIN CERTIFICATE')) {
    return (await jose.importX509(text, alg)) as CryptoKey;
  }
  if (text.includes('BEGIN PUBLIC KEY')) {
    return (await jose.importSPKI(text, alg)) as CryptoKey;
  }

  throw new Error('это не похоже ни на JWK, ни на PEM');
}
