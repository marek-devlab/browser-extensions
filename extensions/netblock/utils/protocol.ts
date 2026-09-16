import type { CompiledRule, EngineCaps, EngineDecision, EngineId, HonestyKey, InactiveRule, Platform } from './engine-select';
import type { LogEntry } from './log';
import type { RuleError } from './rule-schema';
import type { ResourceKind, Rule, RuleGroup, RulesDocument } from './rule-types';
import type { Counter, StateSnapshot } from './state';

// Typed messages between the UI surfaces (popup, tool page) and the
// background, plus the two content-script bridges. Same style as
// perf/utils/protocol.ts: plain `browser.runtime.sendMessage`, one responder
// per `type`, no messaging library. Pure types + guards — no browser imports.
//
// Every request has a `type`; the background answers with the matching
// `Reply`. Push messages (background → open UI pages) use `runtime.sendMessage`
// too and are ignored when no page is open.

/* ------------------------------ UI → background ----------------------------- */

export interface TabRuleStatus {
  rule: Rule;
  engine: EngineId | null;
  active: boolean;
  /** Why it is inactive on this tab, when it is. */
  reason?: InactiveRule['reason'] | 'siteNotEnabled' | 'paused';
  degraded?: HonestyKey;
  notes: HonestyKey[];
  /** Counter for this tab's key, when the rule is stateful. */
  counter?: Counter;
  /** DNR counter is approximate (≈). */
  approx: boolean;
}

export interface TabSummary {
  tabId: number;
  /** Host from the tab URL; '' when unknown or restricted. */
  host: string;
  restricted: boolean;
  /** Chrome: `permissions.contains({origins})`; Firefox: always true. */
  siteEnabled: boolean;
  paused: boolean;
  /** Network-level mode: attached to this tab (= `nl.attached`). */
  networkLevel: boolean;
  /** `chrome.debugger` present (Chrome build with the install-time permission). */
  networkLevelAvailable: boolean;
  /** NL details for the popup (design §2.3): exact counters + why it ended (design §5.5). */
  nl?: {
    attached: boolean;
    /** Requests paused by `Fetch` on this tab during the current session. */
    intercepted: number;
    /** Rules applied (exact). */
    applied: number;
    /** Browser's own reason (`canceled_by_user`, `target_closed`, …) or ours. */
    lastDetachReason?: string;
  };
  rules: TabRuleStatus[];
  /** One-shot: counters were reset because the browser restarted (design §5.6). */
  countersResetNotice: boolean;
}

export interface PermissionStatus {
  /** Origins with host access (Chrome); `['<all_urls>']` on Firefox. */
  origins: string[];
  debugger: boolean;
  debuggerAvailable: boolean;
  /** `RuleConditionKeys` contains RESPONSE_HEADERS. */
  dnrResponseHeaders: boolean;
}

export interface LogPage {
  entries: LogEntry[];
  /** Highest id in the buffer — pass back as `afterId`. */
  latestId: number;
  evicted: number;
  total: number;
}

/** What this build can do — the tool page feeds it to `selectEngine` so the
 *  editor's live engine badge (design §2.4) uses the SAME decision table as
 *  the background. */
export interface CapsReply {
  platform: Platform;
  caps: EngineCaps;
  /** Extension version (manifest) — HAR `creator.version`. */
  version: string;
}

export interface TestUrlResult {
  matches: { rule: Rule; decision: EngineDecision }[];
  /** First match in priority order, if any. */
  first?: { rule: Rule; decision: EngineDecision };
}

export type QueryMessage =
  | { type: 'getTabSummary'; tabId: number }
  | { type: 'listRules' }
  | { type: 'saveRule'; rule: Rule }
  | { type: 'deleteRule'; ruleId: string }
  | { type: 'saveGroup'; group: RuleGroup }
  | { type: 'deleteGroup'; groupId: string }
  /** Full ordered id list → priorities are recomputed (design §3 "Порядок"). */
  | { type: 'reorderRules'; ruleIds: string[] }
  | { type: 'resetCounters'; ruleId?: string }
  | { type: 'pauseTab'; tabId: number; paused: boolean }
  | { type: 'setNetworkLevel'; tabId: number; enabled: boolean }
  | { type: 'getLogPage'; afterId: number; tabId?: number; limit?: number }
  | { type: 'clearLog' }
  | {
      type: 'testUrl';
      url: string;
      method?: string;
      tabId?: number;
      /** Optional filters (design §2.4 "Проверить"): the rule's resource-type
       *  and page-domain conditions are honoured when these are given. */
      resourceType?: ResourceKind;
      pageDomain?: string;
    }
  | { type: 'exportRules' }
  /** Validated on the background side too — the UI's preview is not trusted. */
  | { type: 'importRules'; text: string; mode: 'replace' | 'merge' }
  | { type: 'deleteAllRules' }
  | { type: 'getPermissionStatus' }
  /** Platform + engine caps for the editor's live badge (UI agent). */
  | { type: 'getCaps' }
  /** After the popup's `permissions.request` (must happen in the popup — user gesture). */
  | { type: 'siteAccessChanged' }
  /** A `window` rule's manual trigger from the popup. */
  | { type: 'openWindowTrigger'; ruleId: string; tabId?: number };

export type QueryType = QueryMessage['type'];

export interface RulesApplied {
  compiled: CompiledRule[];
  inactive: InactiveRule[];
  /** Per-rule engine errors from the last apply (browser's words). `hint` is
   *  the i18n key suffix for our translation (`dnrError.<hint>`, design §5.7). */
  errors: { ruleId?: string; message: string; hint?: string }[];
}

export type ReplyFor<T extends QueryType> = T extends 'getTabSummary'
  ? TabSummary
  : T extends 'listRules'
    ? RulesDocument & { applied: RulesApplied }
    : T extends 'saveRule' | 'deleteRule' | 'saveGroup' | 'deleteGroup' | 'reorderRules' | 'deleteAllRules'
      ? { ok: true; applied: RulesApplied } | { ok: false; errors: RuleError[] }
      : T extends 'resetCounters' | 'pauseTab' | 'clearLog' | 'siteAccessChanged' | 'openWindowTrigger'
        ? { ok: true }
        : T extends 'setNetworkLevel'
          ? { ok: true } | { ok: false; error: string }
          : T extends 'getLogPage'
            ? LogPage
            : T extends 'testUrl'
              ? TestUrlResult
              : T extends 'exportRules'
                ? { text: string }
                : T extends 'importRules'
                  ? { ok: boolean; imported: number; errors: RuleError[] }
                  : T extends 'getPermissionStatus'
                    ? PermissionStatus
                    : T extends 'getCaps'
                      ? CapsReply
                      : never;

/* ---------------------------- background → UI ---------------------------- */

export type PushMessage =
  | { type: 'log:append'; entries: LogEntry[] }
  | { type: 'rules:applied'; applied: RulesApplied }
  /** Network-level mode ended by the browser — toast with the reason (design §5.5). */
  | { type: 'nl:detached'; tabId: number; reason: string };

/* ---------------------- content scripts ↔ background --------------------- */

/** ISOLATED relay → background. */
export type RelayMessage =
  | { type: 'relay:ready'; url: string }
  /** MAIN-world engine reports (hit/log deltas) forwarded verbatim. `host` is
   *  the reporting frame's `location.hostname` (log rows' `initiatorHost`). */
  | { type: 'relay:event'; events: PageEvent[]; host?: string }
  /** A click happened — trigger for DNR `window` rules with `trigger: 'click'`.
   *  Sent only while `page:rules.wantsClicks` is true, throttled to 4/s. */
  | { type: 'relay:click' };

/**
 * background → ISOLATED relay (then to MAIN via postMessage). `page:rules` is
 * also the REPLY to `relay:ready`, so a freshly injected document gets its
 * rules and its counter mirror in one round trip. `state` is the background's
 * snapshot (the source of truth); the page keeps a mirror so decisions are
 * synchronous even while the service worker sleeps (design §8).
 */
export type RelayCommand =
  | {
      type: 'page:rules';
      rules: Rule[];
      paused: boolean;
      state: StateSnapshot;
      tabId: number;
      /** For `scope: 'activeTab'` rules: this tab's id when it is the active
       *  tab of ITS window (the same reading dnr/webrequest/debugger take);
       *  absent otherwise → such rules stay idle. */
      activeTabId?: number;
      /** Some DNR rule uses `window(trigger: 'click')` — the relay should
       *  forward clicks (`relay:click`). False/absent = no click listener at all. */
      wantsClicks?: boolean;
    }
  /** Counter delta from ANOTHER tab (cross-tab `countKey`s); "larger `seen` wins". */
  | { type: 'page:state'; counters: Record<string, Counter>; matched: Record<string, number> }
  | { type: 'page:pause'; paused: boolean }
  | { type: 'page:reset'; ruleId?: string };

/** MAIN → relay → background. `hit` is emitted on EVERY match (applied or not)
 *  with the mirror's counter after `decide()`; `window` when a click trigger
 *  opened a window locally; `log` only when an action was applied (✱ rows). */
export type PageEvent =
  | { kind: 'hit'; ruleId: string; url: string; key: string; counter: Counter; applied: boolean }
  | { kind: 'window'; ruleId: string; key: string; counter: Counter }
  | {
      kind: 'log';
      method: string;
      url: string;
      status?: number;
      outcome: LogEntry['outcome'];
      ruleId?: string;
      delayMs?: number;
      /** Imitated failure reason or the reason the action could not be applied. */
      error?: string;
    };

export type NetblockMessage = QueryMessage | RelayMessage;

/* ------------------------- MAIN ↔ ISOLATED bridge ------------------------ */

/** DOM attribute the ISOLATED relay uses to hand its per-load nonce to MAIN
 *  (same pattern as perf: cross-frame forgery is rejected, same-page is not —
 *  and that residual risk is documented, design §7.3). */
export const PAGE_NONCE_ATTR = 'data-blur-netblock-nonce' as const;
export const PAGE_BRIDGE_TAG = '__blur_netblock__' as const;

export interface PageBridgeMessage {
  tag: typeof PAGE_BRIDGE_TAG;
  nonce: string;
  /** MAIN → relay: events; relay → MAIN: a command. */
  events?: PageEvent[];
  command?: RelayCommand;
}

export function isPageBridgeMessage(data: unknown): data is PageBridgeMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { tag?: unknown; nonce?: unknown };
  return d.tag === PAGE_BRIDGE_TAG && typeof d.nonce === 'string';
}

export function isQueryMessage(data: unknown): data is QueryMessage {
  return typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string'
    && !String((data as { type: string }).type).startsWith('relay:');
}

/** background → relay commands (delivered with `tabs.sendMessage`). */
export function isRelayCommand(data: unknown): data is RelayCommand {
  return typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string'
    && String((data as { type: string }).type).startsWith('page:');
}

export function isRelayMessage(data: unknown): data is RelayMessage {
  return typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string'
    && String((data as { type: string }).type).startsWith('relay:');
}

/* ------------------------------ sender checks ---------------------------- */

/** The subset of `runtime.MessageSender` the background inspects. */
export interface SenderView {
  id?: string;
  url?: string;
  tab?: { id?: number };
}

/**
 * May this sender issue a privileged query (`saveRule`, `importRules`,
 * `setNetworkLevel`, …)? Only the extension's OWN pages (popup, tool page —
 * `sender.url` under the extension origin) may; a content script reports the
 * web page's URL and is limited to `relay:*`. Web pages cannot reach
 * `runtime.onMessage` at all (no `externally_connectable`), so this is
 * defence in depth, not the only gate. `extensionBase` = `runtime.getURL('/')`.
 */
export function isPrivilegedSender(sender: SenderView, extensionId: string, extensionBase: string): boolean {
  if (sender.id !== extensionId) return false;
  return typeof sender.url === 'string' && extensionBase.length > 0 && sender.url.startsWith(extensionBase);
}

/** Relay messages come from the ISOLATED content script in a tab — never from an extension page. */
export function isRelaySender(sender: SenderView, extensionId: string): boolean {
  return sender.id === extensionId && sender.tab?.id !== undefined;
}
