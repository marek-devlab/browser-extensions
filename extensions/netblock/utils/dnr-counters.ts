import { browser } from '#imports';
import { hostOf } from '@blur/netcore';
import type { CompiledRuleSet } from './engine-select';
import type { DnrEngine } from './engines/dnr';
import { requestMatchesRule } from './engines/dnr-translate';
import type { LogInput } from './log';
import { fromDnrType } from './resource-types';

// The ≈ counter for DNR rules (design §4.2, §6.1, §6.9). Chrome never tells a
// packaged extension which rule blocked a request (`onRuleMatchedDebug` is
// unpacked-only, `getMatchedRules` is gesture-quota'd), so the only production
// signal is `webRequest.onErrorOccurred` with `net::ERR_BLOCKED_BY_CLIENT` —
// which also fires for another extension's block, hence "approximately".
//
// Site access: webRequest events are dispatched ONLY for URLs the extension
// has host permission for (the `<all_urls>` filter is a filter, not a grant),
// which includes an `activeTab` grant for the popup's tab. So on a site the
// user has not enabled, nothing arrives and the UI shows "—", never "0"
// (§6.9). Registering once, synchronously, with `<all_urls>` is deliberate:
// a listener added after an async `permissions.getAll()` would not be among
// the ones Chrome replays to wake a stopped service worker.
//
// This module also feeds the reactive rules: an observed request that matches
// rule A is a `matched` event, which the background turns into the engine's
// `matched` trigger ("B after A", `skipFirst`).
//
// And it is the Chrome LOG SOURCE for granted sites (design §2.5 "источник
// строк"): every completed / failed page request becomes one `passed` /
// `error` row, with the initiator's host so "create rule from request" can
// pre-fill the page domain (§4.1 step 3). Two honest consequences:
//   - a page-engine `status` substitution shows up twice — `503 ✱` (what the
//     app saw) and the real `200` (what the network saw). That is the design's
//     "сеть vs приложение" pair, not a bug; the ✱ legend explains it;
//   - a tab under Network-level mode is skipped here (`isObservedElsewhere`):
//     the debugger engine logs every request of that tab itself.
// Rows are batched by the background (one storage write per ~250 ms).

export const BLOCKED_BY_CLIENT = 'net::ERR_BLOCKED_BY_CLIENT';

interface RequestDetails {
  url: string;
  method: string;
  type: string;
  tabId: number;
  initiator?: string;
  error?: string;
  /** `onCompleted` only. */
  statusCode?: number;
}

export interface ObserveOptions {
  /** The compiled set, read per event (the background swaps it on every apply). */
  getSet: () => CompiledRuleSet;
  /** A tab whose requests another engine already logs (NL mode) — no plain rows for it. */
  isObservedElsewhere?: (tabId: number) => boolean;
}

const WEB_URL = /^https?:/i;

/**
 * Subscribe; returns the unsubscribe. `getSet` is read per event (the
 * background swaps the compiled set on every apply).
 */
export function startDnrCounters(engine: DnrEngine, opts: ObserveOptions): () => void {
  const { getSet, isObservedElsewhere } = opts;
  type Listener = (details: RequestDetails) => void;
  interface WrEvent {
    addListener(cb: Listener, filter: { urls: string[] }): void;
    removeListener(cb: Listener): void;
  }
  const wr = (browser as unknown as { webRequest?: { onErrorOccurred?: WrEvent; onCompleted?: WrEvent } }).webRequest;
  if (!engine.available || !wr?.onErrorOccurred || !wr.onCompleted) return () => undefined;
  const onErrorOccurred = wr.onErrorOccurred;
  const onCompleted = wr.onCompleted;

  function observe(d: RequestDetails): void {
    const set = getSet();
    const dnr = set.byEngine.dnr;
    const all = Object.values(set.byEngine).flat();
    const req = { url: d.url, method: d.method, kind: fromDnrType(d.type), initiator: d.initiator };
    const initiatorHost = hostOf(d.initiator);
    let attributed = false;
    for (const { rule } of dnr) {
      if (!requestMatchesRule(rule, req)) continue;
      // First installed rule that covers the tab takes the hit (first match
      // wins in DNR too); the rest merely "matched".
      if (!attributed && d.error === BLOCKED_BY_CLIENT && engine.activeFor(rule.id, d.tabId)) {
        attributed = true;
        engine.report({ type: 'hit', ruleId: rule.id, tabId: d.tabId, url: d.url, approx: true });
        engine.report({
          type: 'log',
          entry: {
            time: Date.now(),
            tabId: d.tabId,
            method: d.method,
            url: d.url,
            type: req.kind,
            outcome: 'blocked',
            error: d.error,
            ruleId: rule.id,
            engine: 'dnr',
            marks: ['approx'],
            ...(initiatorHost ? { initiatorHost } : {}),
          },
        });
        continue;
      }
      // A plain `matched` costs a storage write in the background; emit it only
      // when something depends on it (skipFirst counting, or any "B after A").
      const wanted = rule.state.kind === 'skipFirst' || all.some((c) => c.rule.state.kind === 'afterRule' && c.rule.state.ruleId === rule.id);
      if (wanted) engine.report({ type: 'matched', ruleId: rule.id, tabId: d.tabId, url: d.url });
    }
    if (attributed) return;
    // Plain observation row (design §2.5). Tab-less requests (other extensions,
    // browser plumbing) would only be noise in a per-tab log.
    if (d.tabId < 0 || !WEB_URL.test(d.url) || isObservedElsewhere?.(d.tabId)) return;
    const entry: LogInput = {
      time: Date.now(),
      tabId: d.tabId,
      method: d.method,
      url: d.url,
      type: req.kind,
      outcome: d.error !== undefined ? 'error' : 'passed',
      marks: [],
    };
    if (d.error !== undefined) entry.error = d.error;
    else if (d.statusCode !== undefined) entry.status = d.statusCode;
    if (initiatorHost) entry.initiatorHost = initiatorHost;
    engine.report({ type: 'log', entry });
  }

  const guarded = (d: RequestDetails) => {
    try {
      observe(d);
    } catch (err) {
      engine.report({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };
  const filter = { urls: ['<all_urls>'] };
  onErrorOccurred.addListener(guarded, filter);
  onCompleted.addListener(guarded, filter);
  return () => {
    onErrorOccurred.removeListener(guarded);
    onCompleted.removeListener(guarded);
  };
}
