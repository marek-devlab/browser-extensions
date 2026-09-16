import { defineContentScript } from '#imports';
import { PAGE_BRIDGE_TAG, PAGE_NONCE_ATTR, isPageBridgeMessage, type PageEvent } from '../utils/protocol';
import type { Action } from '../utils/rule-types';
import {
  PageMirror,
  interceptFetch,
  isNullBodyStatus,
  syntheticHeaders,
  type Outcome,
  type PageRequest,
} from '../utils/page-core';

// MAIN-world page engine: the fetch/XHR interceptor (design §7.3, §6.2,
// Research §2.4; plan docs/plans/netblock/02-page.md). Chrome only — registered
// at runtime by utils/page-registration.ts on the origins the user granted,
// never from the manifest.
//
// 🔴 SECURITY INVARIANTS (design §7.3):
//   - STATIC file from the bundle. No `eval`, no `new Function`, no rule text
//     is ever executed — rules arrive as DATA over postMessage and are matched
//     by the pure functions in utils/page-core.ts.
//   - The page's CSP applies to this world (Chrome docs): nothing here needs
//     an exemption because nothing here evaluates code.
//   - Originals of `fetch` / `XMLHttpRequest` stay in this closure; `toString`
//     is NOT faked (detectability is stated honestly in the listing).
//   - FAIL-OPEN on every path: anything that throws inside OUR code falls
//     through to the original call. Only the ACTION itself (TypeError, the
//     XHR `error` event, the delay) reaches the page.
//   - Nothing is persisted from here; the only output is postMessage to the
//     ISOLATED relay, guarded by `event.source === window` + the per-load nonce.
//
// Why the file is named `netblock-page` and not `page`: WXT names the output
// IIFE after the entrypoint (`var page = …`) and that `var` lands in the page's
// global scope; a page with a top-level `const page` would then fail with a
// SyntaxError. `netblockPage` is not a name anyone else declares.

const REGISTERED_FLAG = '__blurNetblockPageEngine__';

/* ------------------------------- XHR state ------------------------------ */

type ReplayKind = 'load' | 'error' | 'abort' | 'timeout';

interface XhrState {
  req: PageRequest;
  async: boolean;
  /** Real request in flight; decide once headers arrive at rule `index`. */
  pendingIndex?: number;
  /** Rule that applied and how to present the response. */
  mode?: 'substitute' | 'fail' | 'delay';
  status?: Extract<Action, { type: 'status' }>;
  delayMs?: number;
  ruleId?: string;
  /** Delay-before-send timer (for `abort()` while waiting). */
  delayTimer?: ReturnType<typeof setTimeout>;
  /** Events suppressed during a response-stage delay, replayed afterwards. */
  replay?: ReplayKind;
  /** True while WE dispatch synthetic events (our first listeners let them through). */
  synthetic: boolean;
  /** Overrides installed on the instance (removed on re-`open()`). */
  overridden: string[];
  /** Whether the app-visible decision is settled (overrides applied). */
  settled: boolean;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  allFrames: true,
  // Not in the manifest. Registered at runtime, only with the user's grant.
  registration: 'runtime',

  main() {
    const w = window as Window & { [REGISTERED_FLAG]?: boolean };
    if (w[REGISTERED_FLAG]) return;
    w[REGISTERED_FLAG] = true;

    /* ------------------------------ bridge ------------------------------ */

    // The relay minted the nonce before us (registered ISOLATED first); read it
    // lazily anyway — it is only needed once a request happens, well after both
    // document_start scripts ran.
    const nonce = (): string => document.documentElement.getAttribute(PAGE_NONCE_ATTR) ?? '';

    let queue: PageEvent[] = [];
    let flushScheduled = false;
    function emit(events: PageEvent[]): void {
      if (!events.length) return;
      queue.push(...events);
      if (flushScheduled) return;
      flushScheduled = true;
      // Batch per task: a burst of requests becomes one postMessage.
      queueMicrotask(() => {
        flushScheduled = false;
        const batch = queue;
        queue = [];
        try {
          // `'/'` = this document's own origin — also valid for opaque origins,
          // where `location.origin` is the string "null" and would throw.
          window.postMessage({ tag: PAGE_BRIDGE_TAG, nonce: nonce(), events: batch }, '/');
        } catch {
          // A bridge failure never reaches page code; the event is lost, the
          // decision already happened (fail-open for the page, not for the log).
        }
      });
    }

    const mirror = new PageMirror(location.hostname);
    let rulesArrived = false;

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data: unknown = event.data;
      if (!isPageBridgeMessage(data) || data.nonce !== nonce() || !data.command) return;
      try {
        // A fresh top-level document is a navigation: apply the navigation
        // resets locally so the first request already sees them (plan §4).
        const topLevel = !rulesArrived && window === window.top;
        mirror.command(data.command, Date.now(), topLevel);
        if (data.command.type === 'page:rules') rulesArrived = true;
      } catch {
        // A malformed command is ignored; the mirror keeps its last good state.
      }
    });

    // `window` rules with a click trigger open synchronously here: a fetch
    // fired from the same click handler must already see the window open.
    document.addEventListener(
      'click',
      () => {
        try {
          emit(mirror.click(Date.now(), location.href));
        } catch {
          // never into page code
        }
      },
      { capture: true, passive: true },
    );

    /* ------------------------------- fetch ------------------------------ */

    const origFetch = window.fetch;
    const sleep = (ms: number, signal: AbortSignal | undefined): Promise<void> =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        function onAbort(): void {
          clearTimeout(t);
          reject((signal as { reason?: unknown } | undefined)?.reason ?? new DOMException('The user aborted a request.', 'AbortError'));
        }
        signal?.addEventListener('abort', onAbort, { once: true });
      });

    const fetchDeps = { origFetch: origFetch.bind(window), now: Date.now, emit, baseUrl: () => location.href, sleep };

    function patchedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      try {
        if (!mirror.ready || mirror.paused || mirror.rules.length === 0) return origFetch.call(window, input, init);
        return interceptFetch(mirror, fetchDeps, input, init);
      } catch {
        return origFetch.call(window, input, init);
      }
    }
    try {
      window.fetch = patchedFetch;
    } catch {
      // Frozen `fetch` (some hardened pages): the XHR half still works.
    }

    /* -------------------------------- XHR ------------------------------- */

    const OrigXHR = window.XMLHttpRequest;
    const P = OrigXHR.prototype;
    const origOpen = P.open;
    const origSend = P.send;
    const origAbort = P.abort;
    const origAddEventListener = P.addEventListener;
    const origDispatchEvent = P.dispatchEvent;
    const origGetResponseHeader = P.getResponseHeader;
    const desc = (name: string): PropertyDescriptor | undefined => Object.getOwnPropertyDescriptor(P, name);
    const readyStateGet = desc('readyState')?.get;
    const statusGet = desc('status')?.get;
    const responseTypeGet = desc('responseType')?.get;

    const states = new WeakMap<XMLHttpRequest, XhrState>();

    function invalidState(kind: string): DOMException {
      return new DOMException(
        `Failed to read the 'responseText' property from 'XMLHttpRequest': The value is only accessible if the object's 'responseType' is '' or 'text' (was '${kind}').`,
        'InvalidStateError',
      );
    }

    function override(xhr: XMLHttpRequest, st: XhrState, name: string, get: () => unknown): void {
      try {
        Object.defineProperty(xhr, name, { get, configurable: true, enumerable: true });
        st.overridden.push(name);
      } catch {
        // A frozen instance: the app sees the real value for this one field.
      }
    }

    function clearOverrides(xhr: XMLHttpRequest, st: XhrState): void {
      for (const name of st.overridden) {
        try {
          delete (xhr as unknown as Record<string, unknown>)[name];
        } catch {
          // ignore
        }
      }
      st.overridden = [];
    }

    /** Present a network error: status 0, empty response (xhr spec "request error steps"). */
    function applyErrorOverrides(xhr: XMLHttpRequest, st: XhrState): void {
      override(xhr, st, 'status', () => 0);
      override(xhr, st, 'statusText', () => '');
      override(xhr, st, 'responseURL', () => '');
      override(xhr, st, 'response', () => {
        const t = responseTypeGet ? (responseTypeGet.call(xhr) as string) : '';
        return t === '' || t === 'text' ? '' : null;
      });
      override(xhr, st, 'responseText', () => {
        const t = responseTypeGet ? (responseTypeGet.call(xhr) as string) : '';
        if (t !== '' && t !== 'text') throw invalidState(t);
        return '';
      });
      override(xhr, st, 'getAllResponseHeaders', () => () => '');
      override(xhr, st, 'getResponseHeader', () => () => null);
    }

    /** Present a substituted status + body, honouring `responseType`. */
    function applyStatusOverrides(xhr: XMLHttpRequest, st: XhrState, action: Extract<Action, { type: 'status' }>): void {
      const headers = syntheticHeaders(action);
      const body = action.body !== undefined && !isNullBodyStatus(action.code) ? action.body : '';
      const contentType = headers['content-type']!;
      let cached: { kind: string; value: unknown } | undefined;
      const responseFor = (kind: string): unknown => {
        if (cached && cached.kind === kind) return cached.value;
        let value: unknown;
        switch (kind) {
          case '':
          case 'text':
            value = body;
            break;
          case 'json':
            try {
              value = body.length ? JSON.parse(body) : null;
            } catch {
              value = null;
            }
            break;
          case 'arraybuffer':
            value = new TextEncoder().encode(body).buffer;
            break;
          case 'blob':
            value = new Blob([body], { type: contentType });
            break;
          case 'document':
            try {
              const mime = contentType.startsWith('text/html') ? 'text/html' : contentType.startsWith('application/xml') ? 'application/xml' : null;
              value = mime ? new DOMParser().parseFromString(body, mime) : null;
            } catch {
              value = null;
            }
            break;
          default:
            value = null;
        }
        cached = { kind, value };
        return value;
      };
      // Before HEADERS_RECEIVED the real object reports 0 / '' — so do we.
      const headersIn = (): boolean => (readyStateGet ? (readyStateGet.call(xhr) as number) : xhr.readyState) >= 2;
      override(xhr, st, 'status', () => (headersIn() ? action.code : 0));
      override(xhr, st, 'statusText', () => '');
      override(xhr, st, 'response', () => {
        const t = responseTypeGet ? (responseTypeGet.call(xhr) as string) : '';
        if (!headersIn()) return t === '' || t === 'text' ? '' : null;
        return responseFor(t);
      });
      override(xhr, st, 'responseText', () => {
        const t = responseTypeGet ? (responseTypeGet.call(xhr) as string) : '';
        if (t !== '' && t !== 'text') throw invalidState(t);
        return headersIn() ? body : '';
      });
      const headerLines = Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join('');
      override(xhr, st, 'getAllResponseHeaders', () => () => headerLines);
      override(xhr, st, 'getResponseHeader', () => (name: string) => {
        const key = String(name).toLowerCase();
        return Object.prototype.hasOwnProperty.call(headers, key) ? headers[key]! : null;
      });
    }

    function dispatchSynthetic(xhr: XMLHttpRequest, st: XhrState, events: Event[]): void {
      st.synthetic = true;
      try {
        for (const e of events) origDispatchEvent.call(xhr, e);
      } finally {
        st.synthetic = false;
      }
    }

    const progress = (type: string): ProgressEvent => new ProgressEvent(type, { lengthComputable: false, loaded: 0, total: 0 });

    /** Async network-error sequence for a request that never went out. */
    function failAsync(xhr: XMLHttpRequest, st: XhrState): void {
      setTimeout(() => {
        if (states.get(xhr) !== st) return; // re-opened meanwhile
        override(xhr, st, 'readyState', () => 4);
        applyErrorOverrides(xhr, st);
        st.settled = true;
        dispatchSynthetic(xhr, st, [new Event('readystatechange'), progress('error'), progress('loadend')]);
      }, 0);
    }

    function logFor(st: XhrState, action: Action): PageEvent {
      const base = { kind: 'log' as const, method: st.req.method, url: st.req.url, ruleId: st.ruleId };
      switch (action.type) {
        case 'block':
          return { ...base, outcome: 'blocked' };
        case 'fail':
          return { ...base, outcome: 'failed', error: action.reason };
        case 'delay':
          return { ...base, outcome: 'delayed', delayMs: action.ms };
        case 'status':
          return { ...base, outcome: 'status', status: action.code };
      }
    }

    /** Settle an `apply` outcome for the response stage (headers already here). */
    function settleAtResponse(xhr: XMLHttpRequest, st: XhrState, out: Extract<Outcome, { kind: 'apply' }>): void {
      st.ruleId = out.rule.id;
      switch (out.action.type) {
        case 'block':
        case 'fail':
          st.mode = 'fail';
          applyErrorOverrides(xhr, st);
          break;
        case 'status':
          st.mode = 'substitute';
          st.status = out.action;
          applyStatusOverrides(xhr, st, out.action);
          break;
        case 'delay':
          st.mode = 'delay';
          st.delayMs = out.action.ms;
          break;
      }
      st.settled = true;
      emit([logFor(st, out.action)]);
    }

    // Our listeners are registered in the constructor of the subclass, i.e.
    // BEFORE any listener the page adds — so `stopImmediatePropagation()` here
    // hides a real event from the page and a synthetic one can replace it.
    function onReadyStateChange(this: XMLHttpRequest, e: Event): void {
      const st = states.get(this);
      if (!st || st.synthetic) return;
      try {
        const rs = readyStateGet ? (readyStateGet.call(this) as number) : this.readyState;
        if (rs < 2) return;
        if (st.pendingIndex !== undefined && !st.settled) {
          const index = st.pendingIndex;
          st.pendingIndex = undefined;
          const status = statusGet ? (statusGet.call(this) as number) : this.status;
          const out = mirror.decide(st.req, Date.now(), index, {
            status,
            header: (name) => {
              try {
                return origGetResponseHeader.call(this, name);
              } catch {
                return null;
              }
            },
          });
          if (out) {
            emit(out.events);
            if (out.kind === 'apply') settleAtResponse(this, st, out);
          }
          st.settled = true;
        }
        if (st.mode === 'fail' && rs < 4) e.stopImmediatePropagation();
        if (st.mode === 'delay') {
          // Hold everything until the real request is over; replay after the delay.
          e.stopImmediatePropagation();
        }
      } catch {
        // fail-open: the real event reaches the page untouched
      }
    }

    function onProgressLike(this: XMLHttpRequest, e: Event): void {
      const st = states.get(this);
      if (!st || st.synthetic) return;
      try {
        if (st.mode === 'fail' || st.mode === 'delay') e.stopImmediatePropagation();
      } catch {
        // ignore
      }
    }

    function onTerminal(this: XMLHttpRequest, e: Event): void {
      // load | error | abort | timeout of the REAL request.
      const st = states.get(this);
      if (!st || st.synthetic) return;
      try {
        const type = e.type as ReplayKind;
        if (st.mode === 'fail') {
          e.stopImmediatePropagation();
          if (type === 'load') dispatchSynthetic(this, st, [progress('error')]);
          // A real error/abort/timeout already reads as a failure — pass as is.
          else dispatchSynthetic(this, st, [progress(type)]);
        } else if (st.mode === 'substitute') {
          if (type === 'error') {
            // The real request failed but the rule promised a status: the app
            // must see a completed response.
            e.stopImmediatePropagation();
            dispatchSynthetic(this, st, [progress('load')]);
          }
        } else if (st.mode === 'delay') {
          e.stopImmediatePropagation();
          st.replay = type;
        }
      } catch {
        // ignore
      }
    }

    function onLoadEnd(this: XMLHttpRequest, e: Event): void {
      const st = states.get(this);
      if (!st || st.synthetic) return;
      try {
        if (st.mode !== 'delay') return;
        e.stopImmediatePropagation();
        const replay = st.replay ?? 'load';
        const ms = st.delayMs ?? 0;
        setTimeout(() => {
          if (states.get(this) !== st) return;
          dispatchSynthetic(this, st, [new Event('readystatechange'), progress(replay), progress('loadend')]);
        }, ms);
      } catch {
        // ignore
      }
    }

    class NetblockXMLHttpRequest extends OrigXHR {
      constructor() {
        super();
        // First in line for every event — see onReadyStateChange.
        origAddEventListener.call(this, 'readystatechange', onReadyStateChange);
        origAddEventListener.call(this, 'progress', onProgressLike);
        origAddEventListener.call(this, 'loadstart', onProgressLike);
        for (const t of ['load', 'error', 'abort', 'timeout']) origAddEventListener.call(this, t, onTerminal);
        origAddEventListener.call(this, 'loadend', onLoadEnd);
      }
    }

    const NP = NetblockXMLHttpRequest.prototype;

    const NPX = NP as unknown as { open: unknown; send: unknown; abort: unknown };

    NPX.open = function open(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]): void {
      try {
        const prev = states.get(this);
        if (prev) {
          if (prev.delayTimer !== undefined) clearTimeout(prev.delayTimer);
          clearOverrides(this, prev);
        }
        let abs: string;
        try {
          abs = new URL(String(url), location.href).href;
        } catch {
          abs = String(url);
        }
        states.set(this, {
          req: { url: abs, method: String(method).toUpperCase() },
          async: rest.length === 0 || rest[0] !== false,
          synthetic: false,
          overridden: [],
          settled: false,
        });
      } catch {
        states.delete(this);
      }
      return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
    };

    NPX.send = function send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
      const st = states.get(this);
      let out: Outcome | null = null;
      try {
        if (!st || !mirror.ready || mirror.paused || mirror.rules.length === 0) return origSend.call(this, body);
        out = mirror.decide(st.req, Date.now());
        if (out) emit(out.events);
      } catch {
        return origSend.call(this, body);
      }
      if (!out || out.kind === 'pass') return origSend.call(this, body);
      if (out.kind === 'needResponse') {
        st.pendingIndex = out.index;
        return origSend.call(this, body);
      }
      st.ruleId = out.rule.id;
      const action = out.action;
      switch (action.type) {
        case 'block':
        case 'fail':
          emit([logFor(st, action)]);
          if (!st.async) {
            // xhr spec: a synchronous request error throws.
            st.settled = true;
            throw new DOMException('A network error occurred.', 'NetworkError');
          }
          failAsync(this, st);
          return;
        case 'delay':
          if (!st.async) {
            // Cannot block the thread — the request goes out on time (fail-open).
            emit([{ kind: 'log', method: st.req.method, url: st.req.url, outcome: 'passed', ruleId: st.ruleId, error: 'delay skipped: synchronous XHR' }]);
            return origSend.call(this, body);
          }
          emit([logFor(st, action)]);
          st.delayTimer = setTimeout(() => {
            st.delayTimer = undefined;
            if (states.get(this) !== st) return;
            try {
              origSend.call(this, body);
            } catch {
              failAsync(this, st);
            }
          }, action.ms);
          return;
        case 'status':
          // The real request goes out (design §6.2); the app sees ours from
          // the first readystatechange ≥ HEADERS_RECEIVED on.
          st.mode = 'substitute';
          st.status = action;
          st.settled = true;
          applyStatusOverrides(this, st, action);
          emit([logFor(st, action)]);
          return origSend.call(this, body);
      }
    };

    NPX.abort = function abort(this: XMLHttpRequest): void {
      const st = states.get(this);
      if (st?.delayTimer !== undefined) {
        // Aborted while we were holding the request: nothing went out, so the
        // native abort() has nothing to cancel — present the abort ourselves.
        clearTimeout(st.delayTimer);
        st.delayTimer = undefined;
        override(this, st, 'readyState', () => 4);
        applyErrorOverrides(this, st);
        dispatchSynthetic(this, st, [new Event('readystatechange'), progress('abort'), progress('loadend')]);
      }
      return origAbort.call(this);
    };

    try {
      window.XMLHttpRequest = NetblockXMLHttpRequest as unknown as typeof XMLHttpRequest;
    } catch {
      // Frozen binding — fetch half still works.
    }
  },
});
