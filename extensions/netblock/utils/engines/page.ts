import type { CompiledRuleSet } from '../engine-select';
import { selectEngine, type EngineCaps } from '../engine-select';
import type { LogInput } from '../log';
import { mergeSnapshot, sanitizePageEvents } from '../page-core';
import { browserApi, reconcileRegistration, unregisterAll, type RegistrationApi } from '../page-registration';
import type { PageEvent, RelayCommand, RelayMessage } from '../protocol';
import type { Rule } from '../rule-types';
import type { Counter, StateSnapshot } from '../state';
import { EngineEvents, type Engine, type EngineEventListener } from './types';

// L2 — MAIN-world fetch/XHR patch (Chrome). Background-side half of the page
// engine (plan docs/plans/netblock/02-page.md). The in-page half is
// entrypoints/netblock-page.content.ts, the bridge is relay.content.ts.
//
// Division of labour (design §8, plan §4):
//   - this engine REGISTERS the scripts (only on granted origins), PUSHES the
//     compiled xhr rules + the counter snapshot to every live relay, and turns
//     relay reports into engine events (`log` rows with the ✱ mark, `hit`);
//   - the page decides synchronously from its mirror;
//   - the background stays the source of truth: it merges every reported
//     counter into `session:state` ("larger `seen` wins", `mergeSnapshot`) via
//     `deps.mergeState`, and this engine fans the delta out to the other tabs.
//
// No `#imports` here: utils/engines/index.ts is loaded by the Node logic
// tests. Browser APIs are read lazily from `globalThis.chrome`.

/** What the background lends the engine (storage stays the background's). */
export interface PageEngineDeps {
  /** Current counters, read under the state lock (queues behind resets). */
  getSnapshot(): Promise<StateSnapshot>;
  /** Merge a page-reported delta into `session:state`. */
  mergeState(counters: Record<string, Counter>, matched: Record<string, number>): Promise<void>;
  isPaused(tabId: number): boolean;
}

/** The engine plus the page-specific entry points the background hooks up. */
export interface PageEngine extends Engine {
  configure(deps: PageEngineDeps): void;
  /** Route a `relay:*` message; the return value is the reply (`page:rules` for `relay:ready`). */
  handleRelay(message: RelayMessage, sender: { tab?: { id?: number } }): Promise<RelayCommand | undefined>;
  /** Tell every live mirror to drop counters (all, or one rule's). */
  resetCounters(ruleId?: string): Promise<void>;
}

/** Structural subset of the Chrome APIs this engine touches. */
interface PageApi extends RegistrationApi {
  tabs?: {
    query(info: { active?: boolean; lastFocusedWindow?: boolean }): Promise<{ id?: number }[]>;
    get(tabId: number): Promise<{ id?: number; active?: boolean }>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
    onActivated?: { addListener(cb: (info: { tabId: number }) => void): void };
  };
  permissions?: RegistrationApi['permissions'] & {
    onAdded?: { addListener(cb: () => void): void };
    onRemoved?: { addListener(cb: () => void): void };
  };
}

export function createPageEngine(caps: EngineCaps, hasApi: boolean): PageEngine {
  const events = new EngineEvents();
  const api = (): PageApi | undefined => (hasApi ? (browserApi() as PageApi | undefined) : undefined);

  let rules: Rule[] = [];
  /** A DNR `window(trigger:'click')` rule exists → relays forward clicks (defect a). */
  let wantsClicks = false;
  let applied = false;
  let deps: PageEngineDeps | undefined;

  const err = (message: string, extra: { ruleId?: string; tabId?: number } = {}): void =>
    events.emit({ type: 'error', message, ...extra });

  /* ------------------------------ messaging ------------------------------ */

  /** `scope: 'activeTab'` = the active tab of EACH window (dnr/webrequest/
   *  debugger read it the same way): the tab's own `active` flag, not the
   *  last-focused window's tab, which would idle a rule in a second window. */
  async function activeTabIdFor(tabId: number): Promise<number | undefined> {
    try {
      const tab = await api()?.tabs?.get(tabId);
      return tab?.active ? tabId : undefined;
    } catch {
      return undefined;
    }
  }

  async function rulesCommand(tabId: number): Promise<RelayCommand> {
    const state = deps ? await deps.getSnapshot() : { counters: {}, matched: {} };
    const cmd: RelayCommand = {
      type: 'page:rules',
      rules,
      paused: deps?.isPaused(tabId) ?? false,
      state,
      tabId,
    };
    const active = await activeTabIdFor(tabId);
    if (active !== undefined) cmd.activeTabId = active;
    if (wantsClicks) cmd.wantsClicks = true;
    return cmd;
  }

  /** Deliver to one tab (all frames). "Receiving end does not exist" is the
   *  normal case for tabs without the relay — silent. */
  async function sendTo(tabId: number, command: RelayCommand): Promise<void> {
    try {
      await api()?.tabs?.sendMessage(tabId, command);
    } catch {
      // no relay in this tab
    }
  }

  async function broadcast(make: (tabId: number) => Promise<RelayCommand> | RelayCommand, except?: number): Promise<void> {
    const tabs = api()?.tabs;
    if (!tabs) return;
    let list: { id?: number }[] = [];
    try {
      list = await tabs.query({});
    } catch {
      return;
    }
    await Promise.all(
      list.map(async (t) => {
        if (t.id === undefined || t.id === except) return;
        await sendTo(t.id, await make(t.id));
      }),
    );
  }

  /* ----------------------------- registration ---------------------------- */

  async function reconcile(): Promise<void> {
    const a = api();
    if (!a) return;
    try {
      await reconcileRegistration(a, caps.page);
    } catch (e) {
      err(`page engine: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Grant/revoke from the popup or from chrome://extensions → re-register.
  // Registered synchronously at construction (MV3: listeners must be added in
  // the first turn of the service worker).
  const a0 = api();
  a0?.permissions?.onAdded?.addListener(() => void reconcile().then(() => broadcast(rulesCommand)));
  a0?.permissions?.onRemoved?.addListener(() => void reconcile());
  // `scope: 'activeTab'` rules follow the active tab.
  a0?.tabs?.onActivated?.addListener(() => {
    if (applied && rules.some((r) => r.scope === 'activeTab')) void broadcast(rulesCommand);
  });

  /* -------------------------------- events ------------------------------- */

  function onRelayEvents(tabId: number, list: PageEvent[], host: string | undefined): { counters: Record<string, Counter>; matched: Record<string, number>; crossTab: boolean } {
    const now = Date.now();
    const counters: Record<string, Counter> = {};
    const matched: Record<string, number> = {};
    let crossTab = false;
    for (const ev of list) {
      switch (ev.kind) {
        case 'hit': {
          counters[ev.key] = ev.counter;
          matched[ev.ruleId] = now;
          if (rules.find((r) => r.id === ev.ruleId)?.countKey !== 'rule+tab') crossTab = true;
          if (ev.applied) events.emit({ type: 'hit', ruleId: ev.ruleId, tabId, url: ev.url, approx: false });
          break;
        }
        case 'window':
          counters[ev.key] = ev.counter;
          if (rules.find((r) => r.id === ev.ruleId)?.countKey !== 'rule+tab') crossTab = true;
          break;
        case 'log': {
          const entry: LogInput = {
            time: now,
            tabId,
            method: ev.method,
            url: ev.url,
            type: 'xhr',
            outcome: ev.outcome,
            ruleId: ev.ruleId,
            engine: 'page',
            // ✱ — the response was replaced on the client; DevTools shows the real one.
            marks: ['clientSide'],
          };
          if (host) entry.initiatorHost = host;
          if (ev.status !== undefined) entry.status = ev.status;
          if (ev.error !== undefined) entry.error = ev.error;
          if (ev.delayMs !== undefined) entry.delayMs = ev.delayMs;
          events.emit({ type: 'log', entry });
          break;
        }
      }
    }
    return { counters, matched, crossTab };
  }

  /* -------------------------------- engine ------------------------------- */

  return {
    id: 'page',
    available: hasApi,
    supports(rule: Rule): boolean {
      return selectEngine(rule, 'chrome', caps).engine === 'page';
    },

    configure(d: PageEngineDeps): void {
      deps = d;
    },

    async apply(set: CompiledRuleSet): Promise<void> {
      rules = set.byEngine.page.map((c) => c.rule);
      // The relay is the only party that can see a page click; the DNR engine
      // is the one that needs it. Tell the relays whether anyone is listening.
      wantsClicks = set.byEngine.dnr.some((c) => c.rule.state.kind === 'window' && c.rule.state.trigger === 'click');
      applied = true;
      if (!hasApi) return;
      await reconcile();
      await broadcast(rulesCommand);
    },

    async pauseTab(tabId: number): Promise<void> {
      await sendTo(tabId, { type: 'page:pause', paused: true });
    },
    async resumeTab(tabId: number): Promise<void> {
      await sendTo(tabId, { type: 'page:pause', paused: false });
    },

    async resetCounters(ruleId?: string): Promise<void> {
      await broadcast(() => ({ type: 'page:reset', ...(ruleId !== undefined ? { ruleId } : {}) }));
    },

    async handleRelay(message, sender): Promise<RelayCommand | undefined> {
      const tabId = sender.tab?.id;
      // Reports without a tab (an extension page?) are not ours to count.
      if (tabId === undefined) return undefined;
      switch (message.type) {
        case 'relay:ready':
          return rulesCommand(tabId);
        case 'relay:event': {
          // The page can read the relay's nonce (same JS context), so its
          // reports are untrusted input: keep only well-formed events about
          // rules this engine gave THIS tab (page-core `sanitizePageEvents`).
          const events = sanitizePageEvents(message.events, rules, tabId);
          if (events.length === 0) return undefined;
          const host = typeof message.host === 'string' ? message.host.slice(0, 253) : undefined;
          const { counters, matched, crossTab } = onRelayEvents(tabId, events, host);
          if (Object.keys(counters).length === 0 && Object.keys(matched).length === 0) return undefined;
          try {
            await deps?.mergeState(counters, matched);
          } catch (e) {
            err(`page engine: state merge failed: ${e instanceof Error ? e.message : String(e)}`, { tabId });
          }
          // Cross-tab keys (`rule`, `url`) must reach the other mirrors too.
          if (crossTab) void broadcast(() => ({ type: 'page:state', counters, matched }), tabId);
          return undefined;
        }
        case 'relay:click':
          // Page-engine click windows open in the page itself (plan §4); the
          // background routes this to the DNR engine's `click` trigger.
          return undefined;
      }
    },

    async dispose(): Promise<void> {
      rules = [];
      const a = api();
      if (a) await unregisterAll(a);
    },

    onEvent(listener: EngineEventListener): () => void {
      return events.subscribe(listener);
    },
  };
}

/** Re-exported for the background's `mergeState` implementation. */
export { mergeSnapshot };
