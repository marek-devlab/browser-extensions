import type { CompiledRule, CompiledRuleSet } from '../engine-select';
import { selectEngine, type EngineCaps } from '../engine-select';
import type { Rule } from '../rule-types';
import {
  applyPlan,
  coversTab,
  decodeRuleId,
  desiredRules,
  emptyReactiveState,
  hintForDnrError,
  nextExpiry,
  parseRuleIdFromError,
  planSessionUpdate,
  pruneReactive,
  reactiveStep,
  recoverReactive,
  translateUrl,
  type DnrErrorHint,
  type DnrRule,
  type DnrTrigger,
  type ReactiveState,
  type SessionPlan,
} from './dnr-translate';
import { EngineEvents, type Engine, type EngineEvent, type EngineEventListener } from './types';

// L1 — `declarativeNetRequest` (Chrome). The browser-facing half: everything
// that decides WHAT to install is pure and lives in dnr-translate.ts; this
// file only owns the browser calls, the serialisation of mutations and the
// in-memory mirror of our session rules. Plan: docs/plans/netblock/02-dnr.md.
// No `#imports` here: utils/engines/index.ts is loaded by the Node logic
// tests, so browser APIs are read lazily from `globalThis.chrome`.
//
// Why SESSION rules for every scope (plan §1.1): one ruleset, one atomic
// `updateSessionRules` per reconcile, `tabIds` allowed (dynamic rules refuse
// them), and — the fail-open argument — session rules die with the browser and
// with an extension update, so a stale block can never outlive the code that
// installed it. Dynamic rules would persist through both.
//
// Why a mirror instead of `getSessionRules()` on every change: the mirror is
// exactly what the last successful atomic update left behind, so a diff
// against it is correct; the browser is re-read only after a failure and on
// the first apply after a worker restart (recovery, plan §1.9).

/** Extra surface the background wires with one line per event source. */
export interface DnrEngine extends Engine {
  /** Feed a trigger (matched/navigation/click/manual/tab events/reset/tick). */
  onTrigger(trigger: DnrTrigger): Promise<void>;
  /** Is `ruleId` currently installed as a block rule that covers `tabId`? */
  activeFor(ruleId: string, tabId: number): boolean;
  /** Let a helper (dnr-counters.ts) emit through this engine's event bus. */
  report(event: EngineEvent): void;
}

interface DnrApi {
  getSessionRules(): Promise<DnrRule[]>;
  updateSessionRules(o: { removeRuleIds?: number[]; addRules?: DnrRule[] }): Promise<void>;
  isRegexSupported?: (o: { regex: string; isCaseSensitive?: boolean }) => Promise<{ isSupported: boolean; reason?: string }>;
}

interface TabsApi {
  query(q: Record<string, never>): Promise<{ id?: number; active?: boolean; windowId?: number }[]>;
}

/** The DNR + tabs namespaces of whichever global exists here (Chrome: `chrome`). */
function apis(): { dnr: DnrApi; tabs: TabsApi } | null {
  const g = globalThis as { chrome?: { declarativeNetRequest?: DnrApi; tabs?: TabsApi }; browser?: { declarativeNetRequest?: DnrApi; tabs?: TabsApi } };
  const ns = g.chrome?.declarativeNetRequest ? g.chrome : g.browser?.declarativeNetRequest ? g.browser : undefined;
  return ns?.declarativeNetRequest && ns.tabs ? { dnr: ns.declarativeNetRequest, tabs: ns.tabs } : null;
}

/** Bounded retry when the browser rejects a batch because of one rule. */
const MAX_COMMIT_RETRIES = 8;

export function createDnrEngine(caps: EngineCaps, hasApi: boolean): DnrEngine {
  const events = new EngineEvents();
  /** Resolved per call: null when the build has no DNR or we are in Node. */
  const api = (): DnrApi | null => (hasApi ? (apis()?.dnr ?? null) : null);

  /* ------------------------------ mirror state ------------------------------ */

  let rules: CompiledRule[] = [];
  /** Rule ids the browser (or our translation) refused in the current set. */
  let refused = new Set<string>();
  let reactive: ReactiveState = emptyReactiveState();
  /** Our session rules as the browser holds them (foreign ids excluded). */
  let installed: DnrRule[] = [];
  let recovered = false;
  /** windowId → active tabId (scope `activeTab`). */
  const activeByWindow = new Map<number, number>();
  const paused = new Set<number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const regexCache = new Map<string, { ok: boolean; reason?: string }>();

  // Every mutation runs on one chain: a trigger arriving while `apply` is in
  // flight must see the new rule set, not race it.
  let chain: Promise<unknown> = Promise.resolve();
  function serial(fn: () => Promise<void>): Promise<void> {
    const run = async () => {
      try {
        await fn();
      } catch (err) {
        // Fail-open: an exception here must not surface as a hung apply.
        events.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    };
    const p = chain.then(run, run);
    chain = p;
    return p;
  }

  function activeTabs(): number[] {
    return [...new Set(activeByWindow.values())].sort((a, b) => a - b);
  }

  /* -------------------------------- recovery -------------------------------- */

  async function recover(): Promise<void> {
    const a = apis();
    if (!hasApi || !a) return;
    const [session, tabs] = await Promise.all([a.dnr.getSessionRules(), a.tabs.query({})]);
    const live = new Set<number>();
    activeByWindow.clear();
    for (const t of tabs) {
      if (t.id === undefined) continue;
      live.add(t.id);
      if (t.active && t.windowId !== undefined) activeByWindow.set(t.windowId, t.id);
    }
    installed = session.filter((r) => decodeRuleId(r.id) !== null);
    // Pause rules survive a worker restart in the browser; re-learn them from
    // there rather than from storage — the browser's view is the truth.
    paused.clear();
    for (const r of installed) {
      const d = decodeRuleId(r.id);
      const tabId = r.condition.tabIds?.[0];
      if (d?.kind === 'pause' && tabId !== undefined && live.has(tabId)) paused.add(tabId);
    }
    reactive = recoverReactive(installed, rules, caps.dnrResponseHeaders, live);
    recovered = true;
  }

  /* ----------------------------- regex pre-check ---------------------------- */

  function regexOf(rule: Rule): { regex: string; cs: boolean } | null {
    if (!rule.condition.url || rule.condition.url.value.length === 0) return null;
    const t = translateUrl(rule.condition.url);
    return t.regexFilter !== undefined ? { regex: t.regexFilter, cs: t.isUrlFilterCaseSensitive === true } : null;
  }

  /** `isRegexSupported` before the batch, so one bad regex never costs a retry round. */
  async function checkRegexes(): Promise<void> {
    const dnr = api();
    if (!dnr?.isRegexSupported) return;
    for (const { rule } of rules) {
      const r = regexOf(rule);
      if (!r) continue;
      const key = `${r.cs ? '1' : '0'}:${r.regex}`;
      let res = regexCache.get(key);
      if (!res) {
        try {
          const out = await dnr.isRegexSupported({ regex: r.regex, isCaseSensitive: r.cs });
          res = { ok: out.isSupported, reason: out.reason };
        } catch (err) {
          res = { ok: false, reason: err instanceof Error ? err.message : String(err) };
        }
        regexCache.set(key, res);
      }
      if (!res.ok) {
        refused.add(rule.id);
        const reason = res.reason ?? 'unsupported';
        emitError(rule.id, `isRegexSupported: ${reason}`, hintForDnrError(reason));
      }
    }
  }

  function emitError(ruleId: string | undefined, message: string, hint: DnrErrorHint): void {
    events.emit({ type: 'error', ruleId, message, hint });
  }

  /* -------------------------------- reconcile ------------------------------- */

  async function reconcile(reportProblems: boolean): Promise<void> {
    if (!api()) return;
    const want = desiredRules({
      rules,
      refused,
      headersSupported: caps.dnrResponseHeaders,
      activeTabs: activeTabs(),
      pausedTabs: [...paused],
      reactive,
    });
    if (reportProblems) {
      for (const p of want.problems) {
        refused.add(p.ruleId);
        emitError(p.ruleId, 'Rule cannot be expressed as a declarativeNetRequest condition.', p.hint);
      }
    }
    const plan = planSessionUpdate(want.rules, installed);
    if (plan.removeRuleIds.length > 0 || plan.addRules.length > 0) await commit(plan);
    schedule();
  }

  /**
   * One atomic update; on rejection blame the rule Chrome names ("Rule with id
   * N …"), report it with the browser's words, drop every DNR rule of that
   * rule and retry — the other rules must still land (design §5.7, §8).
   */
  async function commit(initial: SessionPlan): Promise<void> {
    const dnr = api();
    if (!dnr) return;
    let plan = initial;
    for (let attempt = 0; ; attempt++) {
      try {
        await dnr.updateSessionRules({ removeRuleIds: plan.removeRuleIds, addRules: plan.addRules });
        installed = applyPlan(installed, plan);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const badId = parseRuleIdFromError(message);
        const decoded = badId === null ? null : decodeRuleId(badId);
        const victim = decoded?.kind === 'rule' ? rules[decoded.index]?.rule : undefined;
        if (!victim || attempt >= MAX_COMMIT_RETRIES || !plan.addRules.some((r) => r.id === badId)) {
          emitError(victim?.id, message, hintForDnrError(message));
          // The browser rejected the whole batch: re-learn what it holds.
          installed = (await dnr.getSessionRules().catch(() => [] as DnrRule[])).filter((r) => decodeRuleId(r.id) !== null);
          return;
        }
        refused.add(victim.id);
        emitError(victim.id, message, hintForDnrError(message));
        const index = decoded!.kind === 'rule' ? decoded!.index : -1;
        plan = {
          removeRuleIds: plan.removeRuleIds,
          addRules: plan.addRules.filter((r) => {
            const d = decodeRuleId(r.id);
            return !(d?.kind === 'rule' && d.index === index);
          }),
        };
      }
    }
  }

  /** Timer for the earliest `window` expiry; the watchdog `tick` is the backup. */
  function schedule(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const at = nextExpiry(reactive);
    if (at === undefined) return;
    timer = setTimeout(() => void engine.onTrigger({ type: 'tick' }), Math.max(0, at - Date.now()));
  }

  /* --------------------------------- engine --------------------------------- */

  const engine: DnrEngine = {
    id: 'dnr',
    available: hasApi,
    supports(rule: Rule): boolean {
      return selectEngine(rule, 'chrome', caps).engine === 'dnr';
    },
    apply(set: CompiledRuleSet): Promise<void> {
      if (!api()) return Promise.resolve();
      return serial(async () => {
        rules = set.byEngine.dnr;
        refused = new Set();
        if (!recovered) await recover();
        await checkRegexes();
        reactive = pruneReactive(reactive, rules);
        await reconcile(true);
      });
    },
    pauseTab(tabId: number): Promise<void> {
      if (!api()) return Promise.resolve();
      return serial(async () => {
        paused.add(tabId);
        await reconcile(false);
      });
    },
    resumeTab(tabId: number): Promise<void> {
      if (!api()) return Promise.resolve();
      return serial(async () => {
        if (!paused.delete(tabId)) return;
        await reconcile(false);
      });
    },
    onTrigger(trigger: DnrTrigger): Promise<void> {
      if (!api()) return Promise.resolve();
      return serial(async () => {
        if (!recovered) return; // no apply yet — nothing installed to react with
        if (trigger.type === 'tabActivated') activeByWindow.set(trigger.windowId, trigger.tabId);
        if (trigger.type === 'tabRemoved') {
          for (const [w, id] of activeByWindow) if (id === trigger.tabId) activeByWindow.delete(w);
          paused.delete(trigger.tabId);
        }
        reactive = reactiveStep(reactive, rules, trigger, Date.now());
        await reconcile(false);
      });
    },
    activeFor(ruleId: string, tabId: number): boolean {
      return coversTab(installed, rules, ruleId, tabId);
    },
    report(event: EngineEvent): void {
      events.emit(event);
    },
    dispose(): Promise<void> {
      const dnr = api();
      if (!dnr) return Promise.resolve();
      return serial(async () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        const session = await dnr.getSessionRules().catch(() => [] as DnrRule[]);
        const ours = session.filter((r) => decodeRuleId(r.id) !== null).map((r) => r.id);
        if (ours.length > 0) await dnr.updateSessionRules({ removeRuleIds: ours });
        installed = [];
        reactive = emptyReactiveState();
        paused.clear();
        recovered = false;
      });
    },
    onEvent(listener: EngineEventListener): () => void {
      return events.subscribe(listener);
    },
  };
  return engine;
}

const NOOP_DNR: DnrEngine = {
  id: 'dnr',
  available: false,
  supports: () => false,
  apply: () => Promise.resolve(),
  pauseTab: () => Promise.resolve(),
  resumeTab: () => Promise.resolve(),
  onTrigger: () => Promise.resolve(),
  activeFor: () => false,
  report: () => undefined,
  dispose: () => Promise.resolve(),
  onEvent: () => () => undefined,
};

/** The dnr engine of a set, or a no-op stand-in (Firefox) so hooks stay one-liners. */
export function asDnrEngine(engines: readonly Engine[]): DnrEngine {
  const e = engines.find((x) => x.id === 'dnr');
  return e && 'onTrigger' in e ? (e as DnrEngine) : NOOP_DNR;
}
