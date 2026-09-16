import type { CompiledRuleSet, EngineId, HonestyKey } from '../engine-select';
import type { LogInput } from '../log';
import type { Rule } from '../rule-types';

// THE ENGINE CONTRACT (docs/plans/netblock/01-foundation.md §3). Four
// implementations, one interface: `dnr`, `page`, `debugger` (Chrome) and
// `webrequest` (Firefox). The background orchestrates them and never reaches
// into a browser API that belongs to an engine.
//
// Rules of the contract:
//   - `apply()` is IDEMPOTENT and TOTAL for its engine: it replaces whatever
//     the engine had with `set.byEngine[id]`. Calling it twice with the same
//     set is a no-op; calling it with an empty list removes everything.
//   - FAIL-OPEN (design §8): an engine that cannot apply a rule reports an
//     `error` event and leaves the request path untouched. It never blocks by
//     accident and never leaves a request hanging — release in `finally`.
//   - `pauseTab`/`resumeTab` are per-tab kill switches (design §3 "Пауза").
//   - `dispose()` undoes everything (detach, unregister, remove rules) and is
//     safe to call twice; the background calls it from `finally` paths.
//   - Events are the ONLY way an engine talks back: the background owns the
//     log, the counters (`session:state`) and the UI notifications.

export type { EngineId };

export type EngineEvent =
  /** A request the engine saw — becomes a log row. */
  | { type: 'log'; entry: LogInput }
  /** A rule applied (exact engines) or probably applied (`approx`). */
  | {
      type: 'hit';
      ruleId: string;
      tabId: number;
      url: string;
      approx: boolean;
      /** The engine ran the rule in a weaker form (Firefox `wr↓`: fail/status → cancel). */
      degraded?: HonestyKey;
    }
  /** A rule's condition matched — feeds `afterRule` even when not applied. */
  | { type: 'matched'; ruleId: string; tabId: number; url: string }
  /** Something went wrong; `ruleId` when attributable. Browser's own words in
   *  `message`; `hint` is our translation key (`dnrError.<hint>`, design §5.7). */
  | { type: 'error'; message: string; ruleId?: string; tabId?: number; hint?: string }
  /** debugger engine only: the browser ended the session (Cancel, tab closed, policy). */
  | { type: 'detached'; tabId: number; reason: string };

export type EngineEventListener = (event: EngineEvent) => void;

export interface Engine {
  readonly id: EngineId;
  /** The API and permission exist in THIS build/browser. A stub says false. */
  readonly available: boolean;
  /** Can this engine run the rule at all? (= selectEngine(...).engine === id) */
  supports(rule: Rule): boolean;
  /** Replace this engine's active rule set. */
  apply(set: CompiledRuleSet): Promise<void>;
  /** Stop acting on `tabId` (rules stay compiled). */
  pauseTab(tabId: number): Promise<void>;
  resumeTab(tabId: number): Promise<void>;
  /** Undo everything. Idempotent. */
  dispose(): Promise<void>;
  /** Subscribe; returns the unsubscribe function. */
  onEvent(listener: EngineEventListener): () => void;
}

/** Shared event fan-out for the engine implementations. */
export class EngineEvents {
  private readonly listeners = new Set<EngineEventListener>();
  emit(event: EngineEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // A listener bug must not take the engine down with it.
      }
    }
  }
  subscribe(listener: EngineEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
