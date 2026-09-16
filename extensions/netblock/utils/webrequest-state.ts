import { emptySnapshot, type StateSnapshot } from './state';
import { mergeDeltas, type StateDelta } from './webrequest-eval';

// The Firefox engine's in-memory mirror of `session:state` (design §8 "Firefox:
// blocking-листенер ждёт storage.session", plan 02-webrequest.md §1.4).
//
// Why an overlay and not a plain copy: the engine decides SYNCHRONOUSLY from
// memory (a blocking listener that awaits storage adds ≈25 ms per request,
// spike S2) and writes through afterwards. Between the decision and the
// acknowledged write, storage — and therefore any change notification — is
// behind. If the mirror were simply overwritten by every notification, the
// echo of write #1 would reset counters advanced by decision #2. So:
//
//   effective = base (last snapshot known to be in storage)
//             + pending (this engine's deltas not yet acknowledged, in order)
//
// A background reset (navigation, manual, tab closed) replaces `base`; an
// in-flight delta for the same key still overlays it until its write is
// acknowledged — that write resurrects one key. The window is one storage
// round-trip (milliseconds); the plan accepts and documents it.
//
// Cold start: the first stateful decision waits for the storage read at most
// `timeoutMs` (200 ms, design §8). On timeout the base becomes an empty
// snapshot, the request proceeds (fail-open) and the engine reports an
// `error` event once. A late read is still adopted as `base` — the overlay
// keeps the decisions made meanwhile.
//
// Pure: storage and the clock are injected so Node tests can simulate a slow
// or hanging read.

export interface StateStore {
  read(): Promise<StateSnapshot>;
  /** RMW under the shared lock; resolves to the stored result. */
  write(mutate: (cur: StateSnapshot) => StateSnapshot): Promise<StateSnapshot>;
}

export interface StateCacheOptions {
  timeoutMs: number;
  /** Injected for tests; defaults to `setTimeout`. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** Called on a cold-read timeout or a failed write. */
  onError?: (message: string) => void;
}

/** How long an acknowledged counter guards against stale echoes. */
const RECENT_TTL_MS = 10_000;

export class StateCache {
  private base: StateSnapshot | null = null;
  private readonly pending: StateDelta[][] = [];
  /** Last acknowledged `seen` per key we wrote recently (see setBase). */
  private readonly recent = new Map<string, { seen: number; at: number }>();
  private hydration: Promise<void> | null = null;
  /** True once the cold read timed out (diagnostics; tests). */
  coldTimedOut = false;

  private readonly store: StateStore;
  private readonly opts: StateCacheOptions;

  // No TS parameter properties: Node's type stripping (the e2e tests) has no
  // transform for them.
  constructor(store: StateStore, opts: StateCacheOptions) {
    this.store = store;
    this.opts = opts;
  }

  /** Is a stateful decision possible without waiting? */
  get warm(): boolean {
    return this.base !== null;
  }

  /**
   * Resolve once `base` is usable: the real snapshot, or an empty one after
   * `timeoutMs`. Never rejects. Concurrent callers share one read.
   */
  ready(): Promise<void> {
    if (this.base !== null) return Promise.resolve();
    if (this.hydration) return this.hydration;
    const st = this.opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    const ct = this.opts.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    const read = this.store
      .read()
      .then((snap) => {
        // Adopt even when late: the overlay protects decisions made meanwhile.
        this.base = snap ?? emptySnapshot();
      })
      .catch((err: unknown) => {
        this.opts.onError?.(`state read failed: ${err instanceof Error ? err.message : String(err)}`);
        if (this.base === null) this.base = emptySnapshot();
      });
    this.hydration = new Promise<void>((resolve) => {
      let done = false;
      const timer = st(() => {
        if (done) return;
        done = true;
        if (this.base === null) {
          this.base = emptySnapshot();
          this.coldTimedOut = true;
          this.opts.onError?.(`state cache cold read timed out after ${this.opts.timeoutMs} ms; counters start from zero`);
        }
        resolve();
      }, this.opts.timeoutMs);
      void read.then(() => {
        if (done) return;
        done = true;
        ct(timer);
        resolve();
      });
    });
    return this.hydration;
  }

  /** The snapshot to decide against: base + pending overlay. */
  snapshot(): StateSnapshot {
    const base = this.base ?? emptySnapshot();
    if (this.pending.length === 0) return base;
    let snap = base;
    for (const deltas of this.pending) snap = mergeDeltas(snap, deltas);
    return snap;
  }

  /**
   * A storage change notification (`stateItem.watch`): a background reset, or
   * the echo of one of our own writes. Echoes arrive in storage order but
   * AFTER the write promise resolved, so an echo can be older than `base` —
   * adopting it would roll a counter back for one notification. A counter
   * this engine acknowledged at `seen = n` is therefore never replaced by a
   * notification carrying `seen < n`; a notification WITHOUT the key (a reset
   * deleted it) is always adopted. Pending deltas stay on top regardless.
   */
  setBase(snap: StateSnapshot): void {
    const cutoff = Date.now() - RECENT_TTL_MS;
    for (const [key, r] of this.recent) {
      if (r.at < cutoff) {
        this.recent.delete(key);
        continue;
      }
      const c = snap.counters[key];
      if (c && c.seen < r.seen) return;
    }
    this.base = snap;
  }

  /**
   * Record a decision's deltas and write them through. Fire-and-forget for
   * the caller: the returned promise never rejects, errors go to `onError`.
   */
  commit(deltas: StateDelta[]): Promise<void> {
    if (deltas.length === 0) return Promise.resolve();
    this.pending.push(deltas);
    return this.store
      .write((cur) => mergeDeltas(cur, deltas))
      .then((stored) => {
        const at = Date.now();
        for (const d of deltas) this.recent.set(d.key, { seen: stored.counters[d.key]?.seen ?? d.counter.seen, at });
        this.base = stored;
      })
      .catch((err: unknown) => {
        // Storage is behind, memory is not: fold the delta into `base` so the
        // engine keeps counting consistently until the next successful write.
        this.base = mergeDeltas(this.base ?? emptySnapshot(), deltas);
        this.opts.onError?.(`state write failed: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        const i = this.pending.indexOf(deltas);
        if (i !== -1) this.pending.splice(i, 1);
      });
  }

  /** Forget everything (dispose). */
  reset(): void {
    this.base = null;
    this.pending.length = 0;
    this.recent.clear();
    this.hydration = null;
    this.coldTimedOut = false;
  }
}
