/**
 * A small, honest wrapper around `chrome.debugger` for ONE tab.
 *
 * Shared by `perf` (exact byte measurement, PLAN.md §8) and `netblock` (the
 * opt-in "Network-level mode" engine, docs/design/netblock.md §4). What it
 * centralises is exactly the part both got subtly wrong on their own:
 *   - events are routed per tab (a second attached tab must not see them),
 *   - `onDetach` is surfaced with the browser's reason string
 *     (`canceled_by_user`, `target_closed`, …) so the UI can say WHY,
 *   - `detach()` is idempotent and safe to call from `finally`,
 *   - errors are normalised to a message string (Chrome throws plain objects).
 *
 * The debugger API is INJECTED (`api`) rather than imported: this package has
 * no browser-API imports (like `@blur/core`), which keeps it loadable in Node
 * for `e2e/netcore/logic.test.mjs` with a fake API. Extensions pass
 * `browser.debugger` from `#imports`.
 *
 * Verified live (e2e/netblock-spikes/REPORT.md, Chromium 153): an open DevTools
 * window on the same tab does NOT prevent attaching and does NOT detach an
 * existing session — the reference's "detached when DevTools is invoked" is
 * stale. The `onDetach` path still matters for the infobar's Cancel button and
 * enterprise policy.
 */

/** Structural subset of `chrome.debugger` that this wrapper needs. */
export interface DebuggerApi {
  attach(target: { tabId: number }, version: string): Promise<void>;
  detach(target: { tabId: number }): Promise<void>;
  sendCommand(
    target: { tabId: number },
    method: string,
    params?: object,
  ): Promise<object | undefined>;
  onEvent: {
    addListener(cb: (source: { tabId?: number }, method: string, params?: object) => void): void;
    removeListener(
      cb: (source: { tabId?: number }, method: string, params?: object) => void,
    ): void;
  };
  onDetach: {
    addListener(cb: (source: { tabId?: number }, reason: string) => void): void;
    removeListener(cb: (source: { tabId?: number }, reason: string) => void): void;
  };
}

export interface CdpSessionOptions {
  /** CDP event for THIS tab. Other tabs' events are filtered out. */
  onEvent?: (method: string, params: Record<string, unknown>) => void;
  /** The browser ended the session: `canceled_by_user` (infobar Cancel), `target_closed`, … */
  onDetach?: (reason: string) => void;
  /** Protocol version; `1.3` is what every current Chromium accepts. */
  version?: string;
}

export interface CdpSession {
  readonly tabId: number;
  /** False after the browser or `detach()` ended the session. */
  readonly attached: boolean;
  send<T extends object = Record<string, unknown>>(method: string, params?: object): Promise<T>;
  /** Idempotent; never throws. Removes the listeners even if the browser already detached. */
  detach(): Promise<void>;
}

export type AttachResult =
  | { ok: true; session: CdpSession }
  | { ok: false; error: string };

/** Chrome rejects with plain objects, strings or Errors — reduce all to a string. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Attach to `tabId`. On failure the message is the browser's own text (e.g.
 * "Cannot access a chrome:// URL", "Host access is restricted by policy") or a
 * generic fallback — callers show it verbatim (house rule: browser's words).
 */
export async function attachCdp(
  api: DebuggerApi,
  tabId: number,
  opts: CdpSessionOptions = {},
): Promise<AttachResult> {
  const target = { tabId };
  try {
    await api.attach(target, opts.version ?? '1.3');
  } catch (err) {
    return {
      ok: false,
      error:
        errorMessage(err) ||
        'Could not attach the debugger to this tab.',
    };
  }

  let attached = true;

  const onEvent = (source: { tabId?: number }, method: string, params?: object): void => {
    if (source.tabId !== tabId) return;
    opts.onEvent?.(method, asRecord(params));
  };
  const onDetach = (source: { tabId?: number }, reason: string): void => {
    if (source.tabId !== tabId) return;
    attached = false;
    api.onEvent.removeListener(onEvent);
    api.onDetach.removeListener(onDetach);
    opts.onDetach?.(reason);
  };
  api.onEvent.addListener(onEvent);
  api.onDetach.addListener(onDetach);

  const session: CdpSession = {
    tabId,
    get attached() {
      return attached;
    },
    async send<T extends object = Record<string, unknown>>(method: string, params?: object) {
      if (!attached) throw new Error('Debugger session is no longer attached.');
      return (await api.sendCommand(target, method, params)) as T;
    },
    async detach() {
      api.onEvent.removeListener(onEvent);
      api.onDetach.removeListener(onDetach);
      if (!attached) return;
      attached = false;
      try {
        await api.detach(target);
      } catch {
        // Already gone (tab closed, user cancelled) — nothing to undo.
      }
    },
  };
  return { ok: true, session };
}
