import type { RegexMatch, RegexRequest, RegexResponse } from './regex.worker';

// Main-thread side of the regex worker (design §2.5, §5.3, §8.1).
//
// Owns the worker lifecycle: ONE in-flight request (id-gated — a new keystroke
// makes the previous answer stale, it is not awaited), a `regexTimeoutMs` timer,
// and terminate + respawn on timeout:
//
//   main                          worker
//    │ postMessage({id, …})
//    │ setTimeout(TIMEOUT) ─────────┐
//    │                        compile + match (may never return)
//    │ ◀── {id, matches} ───── ok   │
//    │ clearTimeout                 │
//    │                              ▼ timer fired
//    │ worker.terminate()      ✂ thread killed
//    │ worker = spawn()        fresh worker ready for the next request
//
// 🔴 Nothing here ever calls `new RegExp` on the user's pattern — not even to
// validate it. Validation happens in the worker and comes back as a message.

export interface RegexOk {
  matches: RegexMatch[];
  groupNames: string[];
  truncated: boolean;
}

export type RegexOutcome =
  | { status: 'ok'; result: RegexOk }
  | { status: 'invalid'; message: string; original: string }
  | { status: 'timeout'; timeoutMs: number }
  | { status: 'error'; message: string };

let worker: Worker | null = null;
let seq = 0;
let inflight: { id: number; settle: (o: RegexOutcome) => void; timer: number } | null = null;

function spawn(): Worker | null {
  try {
    const w = new Worker(new URL('./regex.worker.ts', import.meta.url), { type: 'module' });
    w.addEventListener('message', (ev: MessageEvent<RegexResponse>) => {
      const res = ev.data;
      // id gate: a stale answer (the user typed again) is dropped on the floor.
      if (!inflight || inflight.id !== res.id) return;
      const { settle, timer } = inflight;
      inflight = null;
      clearTimeout(timer);
      if (res.ok) {
        settle({
          status: 'ok',
          result: { matches: res.matches, groupNames: res.groupNames, truncated: res.truncated },
        });
      } else {
        settle({ status: 'invalid', message: humanize(res.error), original: res.error });
      }
    });
    w.addEventListener('error', (ev) => {
      const pending = inflight;
      inflight = null;
      if (pending) {
        clearTimeout(pending.timer);
        pending.settle({ status: 'error', message: ev.message || 'Ошибка воркера' });
      }
      recycle();
    });
    return w;
  } catch {
    return null;
  }
}

function recycle(): void {
  try {
    worker?.terminate();
  } catch {
    /* already dead */
  }
  worker = null;
}

/** Run a pattern against the draft. Resolves — it never rejects, so no caller
 *  can leave an unhandled rejection behind. */
export function runRegex(
  req: Omit<RegexRequest, 'id'>,
  timeoutMs: number,
): Promise<RegexOutcome> {
  return new Promise<RegexOutcome>((resolve) => {
    // Supersede whatever was in flight: its answer no longer matters.
    if (inflight) {
      clearTimeout(inflight.timer);
      inflight = null;
    }

    worker ??= spawn();
    if (!worker) {
      resolve({ status: 'error', message: 'Web Worker недоступен — поиск отключён.' });
      return;
    }

    const id = ++seq;
    const timer = self.setTimeout(() => {
      // 🔴 The pattern is still running INSIDE the worker. Killing the thread is
      // the only way out — and it is why the editor never freezes (design §5.3).
      if (!inflight || inflight.id !== id) return;
      inflight = null;
      recycle();
      worker = spawn();
      resolve({ status: 'timeout', timeoutMs });
    }, timeoutMs);

    inflight = { id, settle: resolve, timer };
    try {
      worker.postMessage({ ...req, id } satisfies RegexRequest);
    } catch (e) {
      clearTimeout(timer);
      inflight = null;
      resolve({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  });
}

/** Tear the worker down when the editor unmounts (panel closed). */
export function disposeRegex(): void {
  if (inflight) {
    clearTimeout(inflight.timer);
    inflight = null;
  }
  recycle();
}

/**
 * Turn the engine's `SyntaxError.message` into something a human can act on —
 * while the ORIGINAL is always shown in a <details> next to it, because a
 * translated-but-wrong message would be lying (design §5.4).
 */
function humanize(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('unterminated group') || m.includes('unmatched'))
    return 'Неверный шаблон: не закрыта скобка «(».';
  if (m.includes('unterminated character class'))
    return 'Неверный шаблон: не закрыта квадратная скобка «[».';
  if (m.includes('nothing to repeat'))
    return 'Неверный шаблон: квантификатор (*, +, ?) стоит не после символа.';
  if (m.includes('invalid group')) return 'Неверный шаблон: некорректная группа.';
  if (m.includes('invalid escape') || m.includes('invalid identity escape'))
    return 'Неверный шаблон: недопустимая escape-последовательность.';
  if (m.includes('invalid flags') || m.includes('invalid regular expression flags'))
    return 'Неверные флаги регулярного выражения.';
  if (m.includes('range out of order')) return 'Неверный шаблон: диапазон в […] задом наперёд.';
  return 'Неверный шаблон регулярного выражения.';
}

/**
 * Apply matches to the text on the MAIN thread — with no regex at all. The
 * worker already returned the exact [start, end) ranges and the expanded
 * replacement for each, so "Replace all" is a splice, and it lands as ONE undo
 * transaction (design §2.5).
 */
export function applyReplacements(text: string, matches: RegexMatch[]): string {
  let out = '';
  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) continue; // overlapping — should not happen, be safe
    out += text.slice(cursor, m.start) + m.replaced;
    cursor = m.end;
  }
  return out + text.slice(cursor);
}

export type { RegexMatch };
