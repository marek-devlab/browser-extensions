import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry } from './log';
import { sendQuery, usePushMessages } from './messaging';
import type { PushMessage } from './protocol';

// Live feed of the request log for the tool page (design §2.5). Two sources,
// deduplicated by entry id:
//   1. `log:append` pushes from the background — immediate;
//   2. `getLogPage` with the `afterId` cursor, polled every second while the
//      page is visible — the catch-up path, because a push sent while the
//      service worker was mid-restart (or the page hidden) is simply lost.
// "Pause" freezes the visible list: pushes and polls keep the buffer in sync
// underneath and the list catches up on resume — pausing never loses rows.

const POLL_MS = 1000;
/** RAM cap on the page — the background's ring buffer already caps storage. */
const PAGE_CAP = 5000;

export interface LogFeed {
  entries: LogEntry[];
  evicted: number;
  total: number;
  paused: boolean;
  setPaused: (p: boolean) => void;
  clear: () => Promise<void>;
  /** Cleared flag for the aria-live line; resets on the next append. */
  cleared: boolean;
  error: string | null;
}

export function useLogFeed(enabled = true): LogFeed {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [evicted, setEvicted] = useState(0);
  const [total, setTotal] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef(0);
  const frozen = useRef<LogEntry[]>([]);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const append = useCallback((fresh: LogEntry[]) => {
    if (fresh.length === 0) return;
    const merge = (prev: LogEntry[]): LogEntry[] => {
      const seen = new Set(prev.map((e) => e.id));
      const add = fresh.filter((e) => !seen.has(e.id));
      if (add.length === 0) return prev;
      const next = [...prev, ...add].sort((a, b) => a.id - b.id);
      return next.length > PAGE_CAP ? next.slice(next.length - PAGE_CAP) : next;
    };
    for (const e of fresh) if (e.id > cursor.current) cursor.current = e.id;
    if (pausedRef.current) {
      frozen.current = merge(frozen.current);
    } else {
      setEntries((prev) => {
        const next = merge(prev);
        frozen.current = next;
        return next;
      });
    }
    setCleared(false);
  }, []);

  const poll = useCallback(async () => {
    try {
      const page = await sendQuery({ type: 'getLogPage', afterId: cursor.current, limit: 500 });
      if (!page || !('entries' in page)) return;
      if (page.latestId < cursor.current) {
        // The buffer was cleared elsewhere (ids restart at 1): resync from scratch.
        cursor.current = 0;
        frozen.current = [];
        setEntries([]);
        if (page.latestId > 0) {
          void poll();
          return;
        }
      }
      setEvicted(page.evicted);
      setTotal(page.total);
      append(page.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [append]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) {
        void poll();
        timer = setInterval(() => void poll(), POLL_MS);
      }
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => (enabled && document.visibilityState === 'visible' ? start() : stop());
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [poll, enabled]);

  const onPush = useCallback(
    (m: PushMessage) => {
      if (m.type === 'log:append') append(m.entries);
    },
    [append],
  );
  usePushMessages(onPush);

  const setPausedAndFlush = useCallback((p: boolean) => {
    setPaused(p);
    pausedRef.current = p;
    if (!p) setEntries(frozen.current);
  }, []);

  const clear = useCallback(async () => {
    await sendQuery({ type: 'clearLog' });
    frozen.current = [];
    setEntries([]);
    setTotal(0);
    setEvicted(0);
    setCleared(true);
  }, []);

  return { entries, evicted, total, paused, setPaused: setPausedAndFlush, clear, cleared, error };
}
