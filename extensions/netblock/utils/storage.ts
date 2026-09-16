import { storage } from '#imports';
import type { Locale, Theme } from '@blur/ui';
import { EMPTY_RULES_DOCUMENT, type RulesDocument } from './rule-types';
import { emptySnapshot, type StateSnapshot } from './state';
import { createLog, type LogBuffer, type LogSize } from './log';

// Storage layout (design §0 "Персист", §3 column "Хранение"). The area split is
// a HARD rule, never the reverse:
//   - `local`   : the rules. ≤ 2 MB serialised. NOT `sync` — one rule with a
//                 64 KB response body blows sync's 8 192-byte per-item cap and
//                 the write throws, taking the other prefs with it (§3 ⚠️).
//   - `sync`    : ~200 bytes of UI prefs. Fits with huge margin.
//   - `session` : counters, paused tabs, NL-attached tabs and the request LOG.
//                 storage.session is RAM (10 MB, Chrome 112+/Firefox 115+):
//                 survives a service-worker restart, dies with the browser —
//                 exactly the lifetime the log must have. 🔴 The log NEVER goes
//                 to `local`: URLs of visited pages are browsing activity and
//                 do not belong on disk (design §7.2).
//
// `version` + `migrations` are declared from day one so the rule schema can
// evolve without wiping user data on update (WXT runs migrations when the item
// is initialised; getValue/setValue await them).

export const rulesItem = storage.defineItem<RulesDocument>('local:rules', {
  fallback: EMPTY_RULES_DOCUMENT,
  version: 1,
  migrations: {},
});

export interface Prefs {
  theme: Theme;
  locale: Locale;
  /** Ring-buffer capacity (500 / 2000 / 5000). */
  logSize: LogSize;
  /** Mask `?query` in the log — secrets ride in query strings. */
  logStripQuery: boolean;
  /** Re-attach Network-level mode after a reload of the same tab. */
  nlSticky: boolean;
  /** Allow the MAIN-world page engine on enabled sites (Chrome). */
  pageEngineEnabled: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'auto',
  locale: 'en',
  logSize: 2000,
  logStripQuery: false,
  nlSticky: false,
  pageEngineEnabled: true,
};

export const prefsItem = storage.defineItem<Prefs>('sync:prefs', {
  fallback: DEFAULT_PREFS,
  version: 1,
  migrations: {},
});

/** The localStorage seed keys for the anti-FOUC theme/locale stamps
 *  (`seedTheme` / `seedLocale` in every main.tsx before createRoot). */
export const THEME_CACHE_KEY = 'blur-netblock:theme';
export const LOCALE_CACHE_KEY = 'blur-netblock:locale';

/** Counters + `afterRule` marks. Written ONLY under `withLock(STATE_LOCK)`. */
export const stateItem = storage.defineItem<StateSnapshot>('session:state', {
  fallback: emptySnapshot(),
});

/** The request log ring buffer (design §2.5). ≤ 4 MB — see log.ts. */
export const logItem = storage.defineItem<LogBuffer>('session:log', {
  fallback: createLog(DEFAULT_PREFS.logSize),
});

/** Tabs on which every rule is suspended ("Pause on this tab"). */
export const pausedTabsItem = storage.defineItem<number[]>('session:pausedTabs', {
  fallback: [],
});

/** Tabs with Network-level mode attached — so a restarted service worker can
 *  reconcile against `debugger.getTargets()` instead of forgetting them. */
export const nlTabsItem = storage.defineItem<number[]>('session:nlTabs', {
  fallback: [],
});

/** Stamped by the background on `runtime.onStartup` so the popup can show
 *  "Counters were reset after a browser restart" once (design §5.6). */
export const restartNoticeItem = storage.defineItem<boolean>('session:restartNotice', {
  fallback: false,
});

/* -------------------------------- locking ------------------------------- */

export const STATE_LOCK = 'netblock-state';
export const RULES_LOCK = 'netblock-rules';
/** `session:log` RMWs (batched appends, clear, resize) — background only. */
export const LOG_LOCK = 'netblock-log';

/**
 * Serialise a read-modify-write across EVERY extension context: the service
 * worker's `onCompleted`/`onErrorOccurred` handlers, the popup's reset button
 * and the tool page all touch `session:state`. A per-document queue only
 * orders writes inside one document; two contexts each doing get→modify→set
 * still interleave and lose an increment (design §8 "Два одновременных
 * onCompleted"). The Web Locks API is shared process-wide for the extension
 * origin — it is available in the MV3 service worker (WorkerNavigator.locks)
 * and in extension pages — so holding one named lock makes those RMWs
 * mutually exclusive. Where `navigator.locks` is missing (very old engines)
 * fall back to an in-context promise chain, which at least orders writes
 * within the one context that lacks it.
 */
const queues = new Map<string, Promise<unknown>>();

export function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks?.request) return locks.request(name, fn);
  const prev = queues.get(name) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(
    name,
    next.catch(() => undefined),
  );
  return next;
}

/** RMW on the counters snapshot under the state lock. */
export function updateState(mutate: (snap: StateSnapshot) => StateSnapshot): Promise<StateSnapshot> {
  return withLock(STATE_LOCK, async () => {
    const cur = await stateItem.getValue();
    const next = mutate(cur);
    if (next !== cur) await stateItem.setValue(next);
    return next;
  });
}

/** RMW on the rules document under the rules lock. */
export function updateRules(mutate: (doc: RulesDocument) => RulesDocument): Promise<RulesDocument> {
  return withLock(RULES_LOCK, async () => {
    const cur = await rulesItem.getValue();
    const next = mutate(cur);
    if (next !== cur) await rulesItem.setValue(next);
    return next;
  });
}
