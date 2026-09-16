import type { EngineId } from './engine-select';
import type { ResourceKind } from './rule-types';

// The extension's own request log (design §2.5, §7.2). Lives in RAM (tool
// page) + `session:log` — NEVER `storage.local`: URLs of visited pages are
// browsing activity and do not go to disk. Pure module: no browser imports.
//
// Marks are the honesty glyphs of design §9.2 — text + glyph, never colour
// alone:  ✱ response replaced on the client (DevTools shows the real one)
//         ≈ approximate (DNR counter — whose rule blocked it is unknowable)
//         ○ a rule matched but is inactive (needs an engine this tab lacks)
//         ↓ the rule ran in a weaker form (Firefox wr↓: fail/status → cancel)

export type LogMark = 'clientSide' | 'approx' | 'inactive' | 'degraded';

/** Reason strings THIS extension writes into `error` / detach reasons (as
 *  opposed to the browser's own, which are shown verbatim). One place, so the
 *  engines and the UI's translation table cannot drift apart. */
export const OWN_REASON = {
  /** debugger engine: three consecutive handler failures → self-detach. */
  handlerErrors: 'handler errors (3 in a row)',
  /** debugger engine: the watchdog continued a request paused > 20 s. */
  watchdog: 'released hung request (watchdog)',
} as const;

export const MARK_GLYPH: Record<LogMark, string> = {
  clientSide: '✱',
  approx: '≈',
  inactive: '○',
  degraded: '↓',
};

export type LogOutcome =
  | 'passed' // completed normally
  | 'blocked'
  | 'failed' // failed with a network error (ours or real)
  | 'delayed'
  | 'status' // status replaced by a rule
  | 'error'; // real network error, no rule involved

export interface LogEntry {
  /** Monotonic per buffer; the tool page uses it as the React key + cursor. */
  id: number;
  /** Epoch ms. */
  time: number;
  tabId: number;
  method: string;
  url: string;
  type: ResourceKind;
  /** HTTP status when known (real or substituted). */
  status?: number;
  outcome: LogOutcome;
  /** Browser error string (`net::ERR_BLOCKED_BY_CLIENT`, CDP reason…). */
  error?: string;
  ruleId?: string;
  engine?: EngineId;
  marks: LogMark[];
  /** Response headers, already masked. Only when the engine saw them. */
  headers?: Record<string, string>;
  /** Delay applied, ms. */
  delayMs?: number;
  /** Host (never a path, never a port) of the document that made the request
   *  — DNR's initiator / Firefox `originUrl` / the page's `location.hostname`.
   *  "Create rule from request" pre-fills `pageDomains` with it. */
  initiatorHost?: string;
}

/** Input to `pushLog` — the buffer assigns `id`. */
export type LogInput = Omit<LogEntry, 'id'>;

export interface LogBuffer {
  entries: LogEntry[];
  /** Max entries (prefs: 500 / 2000 / 5000). */
  capacity: number;
  /** Approximate serialised size of `entries`, bytes. */
  bytes: number;
  /** Entries dropped since the last clear — the UI shows "evicted N". */
  evicted: number;
  nextId: number;
}

/** `session:log` hard ceiling (design §3, §5.8): storage.session is 10 MB
 *  and the counters share it. */
export const MAX_LOG_BYTES = 4 * 1024 * 1024;

export const LOG_SIZES = [500, 2000, 5000] as const;
export type LogSize = (typeof LOG_SIZES)[number];

export function createLog(capacity: number): LogBuffer {
  return { entries: [], capacity, bytes: 0, evicted: 0, nextId: 1 };
}

/* ------------------------------- masking -------------------------------- */

/** Always masked, no option (design §7.2): credentials never reach the log. */
const MASKED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);
export const MASK = '•••';

export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const name = k.toLowerCase();
    out[name] = MASKED_HEADERS.has(name) ? MASK : v;
  }
  return out;
}

/** `?query` and `#fragment` removed — secrets ride in query strings. */
export function stripQuery(url: string): string {
  const i = url.indexOf('?');
  const j = url.indexOf('#');
  const cut = Math.min(i === -1 ? url.length : i, j === -1 ? url.length : j);
  return url.slice(0, cut);
}

/* ------------------------------ ring buffer ----------------------------- */

function sizeOf(e: LogEntry): number {
  // JSON length is a fine proxy for the storage.session footprint.
  return JSON.stringify(e).length;
}

/**
 * Append, evicting from the front until both the entry cap and the byte cap
 * hold. Returns a NEW buffer (the tool page keeps it in React state).
 * `stripQueryOpt` applies the Settings toggle; header masking is unconditional.
 */
export function pushLog(buf: LogBuffer, input: LogInput, stripQueryOpt = false): LogBuffer {
  const entry: LogEntry = {
    ...input,
    id: buf.nextId,
    url: stripQueryOpt ? stripQuery(input.url) : input.url,
    marks: [...input.marks],
  };
  if (input.headers) entry.headers = maskHeaders(input.headers);
  const size = sizeOf(entry);
  const entries = [...buf.entries, entry];
  let bytes = buf.bytes + size;
  let evicted = buf.evicted;
  let start = 0;
  while (entries.length - start > buf.capacity || (bytes > MAX_LOG_BYTES && entries.length - start > 1)) {
    bytes -= sizeOf(entries[start]!);
    start++;
    evicted++;
  }
  return {
    entries: start > 0 ? entries.slice(start) : entries,
    capacity: buf.capacity,
    bytes,
    evicted,
    nextId: buf.nextId + 1,
  };
}

/** Change capacity (Settings); evicts immediately if shrinking. */
export function resizeLog(buf: LogBuffer, capacity: number): LogBuffer {
  if (buf.entries.length <= capacity) return { ...buf, capacity };
  const drop = buf.entries.length - capacity;
  const kept = buf.entries.slice(drop);
  return {
    entries: kept,
    capacity,
    bytes: kept.reduce((n, e) => n + sizeOf(e), 0),
    evicted: buf.evicted + drop,
    nextId: buf.nextId,
  };
}

export function clearLog(buf: LogBuffer): LogBuffer {
  return createLog(buf.capacity);
}

/** Entries with `id > afterId` — the tool page's incremental fetch cursor. */
export function logSince(buf: LogBuffer, afterId: number, limit = 500): LogEntry[] {
  const out: LogEntry[] = [];
  for (let i = buf.entries.length - 1; i >= 0 && out.length < limit; i--) {
    const e = buf.entries[i]!;
    if (e.id <= afterId) break;
    out.push(e);
  }
  return out.reverse();
}

/* ---------------------------------- HAR --------------------------------- */

/**
 * HAR 1.2 without bodies (design §2.5): the tool never reads response bodies
 * (§7.2), so `content.size` is -1 and there is no `text`. Headers are the
 * already-masked ones. Timings are not measured by this extension — HAR
 * requires the fields, so they are -1 ("does not apply"), never fabricated.
 */
export function toHar(entries: readonly LogEntry[], creatorVersion: string): unknown {
  return {
    log: {
      version: '1.2',
      creator: { name: 'Request Blocker', version: creatorVersion },
      entries: entries.map((e) => ({
        startedDateTime: new Date(e.time).toISOString(),
        time: e.delayMs ?? -1,
        request: {
          method: e.method,
          url: e.url,
          httpVersion: '',
          cookies: [],
          headers: [],
          queryString: [],
          headersSize: -1,
          bodySize: -1,
        },
        response: {
          status: e.status ?? 0,
          statusText: '',
          httpVersion: '',
          cookies: [],
          headers: Object.entries(e.headers ?? {}).map(([name, value]) => ({ name, value })),
          content: { size: -1, mimeType: '' },
          redirectURL: '',
          headersSize: -1,
          bodySize: -1,
          ...(e.error ? { _error: e.error } : {}),
        },
        cache: {},
        timings: { send: -1, wait: -1, receive: -1 },
        _resourceType: e.type,
        _outcome: e.outcome,
        ...(e.ruleId ? { _ruleId: e.ruleId } : {}),
        ...(e.engine ? { _engine: e.engine } : {}),
        _marks: e.marks.map((m) => MARK_GLYPH[m]),
      })),
    },
  };
}
