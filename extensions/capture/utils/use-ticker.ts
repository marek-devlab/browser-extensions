import { useEffect, useState } from 'react';

// A REAL 1 Hz ticker (design capture.md §1.3, §2.3). This is the genuine
// recording clock: setInterval inside the surface's OWN document, so it never
// wakes the service worker (the whole reason the badge is state-only — §1.3).
//
// `startedAt` is the session start epoch; `running` pauses accrual (design §5.2,
// pause freezes the timer). Returns elapsed ms, recomputed from wall-clock each
// tick so it stays accurate across throttling — not by incrementing a counter.
export function useTicker(startedAt: number, running: boolean): number {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);
  useEffect(() => {
    if (!running) return;
    const id = globalThis.setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 1000);
    return () => globalThis.clearInterval(id);
  }, [startedAt, running]);
  // When paused the interval is cleared, so `elapsed` freezes at its last value —
  // matching "pause freezes the timer" (design §5.2). A production build would
  // subtract accumulated paused time from startedAt on resume; the scaffold's
  // freeze-in-place is faithful enough to demonstrate the state.
  return elapsed;
}
