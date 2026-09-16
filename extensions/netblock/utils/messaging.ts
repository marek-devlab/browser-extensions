import { useEffect } from 'react';
import { browser } from 'wxt/browser';
import type { PushMessage, QueryMessage, QueryType, ReplyFor } from './protocol';

// The ONE way a UI surface talks to the background (design §1.2: data comes
// only through utils/protocol.ts). A thin typed wrapper over
// `runtime.sendMessage` — no messaging library, same as perf.
//
// The background answers a thrown handler with `{ ok: false, error }`; callers
// that care check `ok`. A closed/absent background rejects — surfaced as an
// Error so the UI can show it, never swallowed into a fake success.

export function sendQuery<T extends QueryType>(msg: Extract<QueryMessage, { type: T }>): Promise<ReplyFor<T>> {
  return browser.runtime.sendMessage(msg) as Promise<ReplyFor<T>>;
}

function isPushMessage(data: unknown): data is PushMessage {
  if (typeof data !== 'object' || data === null) return false;
  const t = (data as { type?: unknown }).type;
  return t === 'log:append' || t === 'rules:applied' || t === 'nl:detached';
}

/** Subscribe to background → UI pushes. Returns the unsubscribe function. */
export function onPushMessage(cb: (m: PushMessage) => void): () => void {
  const listener = (raw: unknown): undefined => {
    if (isPushMessage(raw)) cb(raw);
    return undefined;
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}

/** React binding for `onPushMessage`; `cb` is read through a ref-free closure,
 *  so pass a stable callback (useCallback) or accept re-subscription. */
export function usePushMessages(cb: (m: PushMessage) => void): void {
  useEffect(() => onPushMessage(cb), [cb]);
}
