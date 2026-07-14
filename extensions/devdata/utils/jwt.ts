import { MOCK, mockAsync, todoLogic } from '@blur/ui';
import { MOCK_JWT_DECODED } from './mock-data';
import type { JwtDecoded, JwtVerifyResult } from './types';

// JWT decode + verify — STUBBED on mocks for the scaffold phase.
//
// SECURITY INVARIANTS that survive into the real logic (design §7.2):
//   - The token, the HS256 secret and the public key live ONLY in React state
//     (RAM). They are never persisted, never written to `local:document`, never
//     logged. This module takes them as arguments and returns — it holds nothing.
//   - Decode is `atob` + JSON.parse (~20 lines, no library, no Worker) and runs
//     synchronously as the user types (design §4.4).
//   - Verify is EXPLICIT (button only) and lazy-loads `jose` (design §10.3) which
//     uses WebCrypto — 100% offline, no JWKS fetch, ever (design §7.4, §11).

/** Decode a JWT's header + payload without verifying the signature. Stubbed. */
export function decodeJwt(token: string): JwtDecoded {
  if (!MOCK) {
    // TODO_LOGIC: devdata — split on '.', base64url-decode each segment, JSON.parse
    // header+payload. Handle PARTIAL success (valid header, non-JSON payload →
    // show header + raw payload, design §4.4), wrong segment count, non-base64url
    // segment (report WHICH), and `alg: "none"` (red block, design §4.4).
    throw todoLogic('devdata: decode JWT');
  }
  void token;
  return MOCK_JWT_DECODED;
}

/**
 * Verify a JWT signature locally via WebCrypto (`jose`). Stubbed.
 * `keyMaterial` is a public key (JWK/PEM) for RS/ES, or the shared secret for
 * HS256 — held in RAM by the caller and passed in per-click, never stored.
 */
export async function verifyJwt(
  token: string,
  keyMaterial: string,
): Promise<JwtVerifyResult> {
  if (!MOCK) {
    // TODO_LOGIC: devdata — lazy `await import('jose')`, verify with WebCrypto.
    // "signature invalid" must NOT claim "forged" — forgery vs. wrong-key is
    // cryptographically indistinguishable (design §2.7). Detect alg/key-type
    // mismatch and say so plainly (design §4.4).
    throw todoLogic('devdata: verify JWT signature');
  }
  void token;
  if (keyMaterial.trim() === '') {
    const r: JwtVerifyResult = { status: 'error', detail: 'Вставьте публичный ключ или секрет.' };
    return mockAsync(r, 200);
  }
  const r: JwtVerifyResult = {
    status: 'valid',
    detail: 'Проверено локально через WebCrypto. Ключ не сохранён.',
  };
  return mockAsync(r, 600);
}
