/**
 * Task scheduling helpers.
 *
 * `scheduler.postTask()` and `scheduler.yield()` ship in Chrome/Edge 129+ and
 * Firefox 142+, but Safari implements neither, so every call site needs a
 * fallback. `yield()` is preferred over `setTimeout(0)` because it resumes the
 * continuation ahead of other queued tasks rather than behind them.
 */

interface SchedulerLike {
  postTask?: (cb: () => void, opts?: { priority?: string }) => Promise<unknown>;
  yield?: () => Promise<void>;
}

function getScheduler(): SchedulerLike | undefined {
  return (globalThis as { scheduler?: SchedulerLike }).scheduler;
}

/** Hand control back to the event loop so input stays responsive. */
export async function yieldToMain(): Promise<void> {
  const s = getScheduler();
  if (s?.yield) return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Run low-priority work once the browser is idle-ish. */
export function scheduleTask(callback: () => void): void {
  const s = getScheduler();
  if (s?.postTask) {
    void s.postTask(callback, { priority: 'user-visible' });
    return;
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => callback(), { timeout: 500 });
    return;
  }
  setTimeout(callback, 0);
}

/**
 * Drain a queue in chunks, yielding between them. Anything that walks a large
 * DOM must go through this: a synchronous sweep of a big page is a long task.
 */
export async function processInChunks<T>(
  items: readonly T[],
  chunkSize: number,
  process: (item: T) => void,
): Promise<void> {
  // A zero or negative chunk size makes `(i + 1) % size` never hit 0, so the
  // loop would run synchronously to the end — the exact long task this exists
  // to prevent. Clamp to at least 1.
  const size = Math.max(1, Math.floor(chunkSize) || 1);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item !== undefined) process(item);
    if ((i + 1) % size === 0 && i + 1 < items.length) {
      await yieldToMain();
    }
  }
}
