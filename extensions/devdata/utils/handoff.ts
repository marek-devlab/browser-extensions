import { storage } from '#imports';
import { looksLikeJwt } from './core/detect';

// Handing text to the tool page from another surface (context menu, popup
// clipboard read). It is a ONE-SHOT: the tool reads it and immediately deletes
// it (design §1.2, §4.1).
//
// `storage.session` — not `local` — because a handoff is transient by nature and
// must not survive a browser restart to reappear in someone's editor later. It
// also never touches disk.
//
// 🔴 A JWT NEVER transits this channel. `storage.session` is extension storage
// (it survives service-worker recycling and is readable from any extension
// context), which is NOT the "RAM only" the token invariant promises (design §3,
// §7.2). So `putHandoff` DETECTS a JWT and refuses to store it: it returns
// `jwt-skipped`, and the caller opens the JWT tab so the user pastes the token
// there, where it lives only in component state. The HS256 secret and keys never
// reach any handoff at all — they exist only inside the JWT tab.

export interface Handoff {
  text: string;
  /** Where it came from — the tool page says so instead of pretending. */
  origin: 'selection' | 'clipboard';
  at: number;
}

const MAX_HANDOFF_BYTES = 2_000_000;

export const handoffItem = storage.defineItem<Handoff | null>('session:handoff', {
  fallback: null,
});

export type HandoffOutcome = 'stored' | 'jwt-skipped' | 'empty' | 'failed';

export async function putHandoff(
  text: string,
  origin: Handoff['origin'],
): Promise<HandoffOutcome> {
  const trimmed = text.trim();
  if (trimmed === '') return 'empty';
  // 🔴 A JWT is a credential and must never touch storage. Refuse to store it;
  // the caller routes to the JWT tab instead (the token then lives only in RAM).
  if (looksLikeJwt(trimmed)) return 'jwt-skipped';
  // storage.session has a modest quota; a huge selection is not worth losing the
  // handoff over — truncate and let the tool tell the user.
  const clipped =
    text.length > MAX_HANDOFF_BYTES ? text.slice(0, MAX_HANDOFF_BYTES) : text;
  try {
    await handoffItem.setValue({ text: clipped, origin, at: Date.now() });
    return 'stored';
  } catch {
    // Quota or an unavailable session area: the tool still opens, just empty.
    // Never let a failed handoff block opening the tool.
    return 'failed';
  }
}

/** Read and CLEAR. Returns null when there is nothing waiting. */
export async function takeHandoff(): Promise<Handoff | null> {
  try {
    const value = await handoffItem.getValue();
    if (value) await handoffItem.removeValue();
    // Stale handoffs (a tab opened much later) would be surprising — drop them.
    if (value && Date.now() - value.at > 60_000) return null;
    return value;
  } catch {
    return null;
  }
}
