import type { RedirectStep, WeightState, MimeInfo } from './assets-types';

/**
 * DevTools HAR — the ONLY place three facts exist at all (design §1.2, §2.5):
 *   1. the request INITIATOR (which script, at which line) — `_initiator`;
 *   2. the REDIRECT CHAIN (the 30x hops and their `redirectURL`) — Resource Timing
 *      reports only the final URL, so the hops simply do not exist outside DevTools;
 *   3. the EXACT MIME and HTTP status, and the real transferred size cross-origin.
 *
 * This is a strict ENHANCEMENT. ⚠️ Firefox for Android has no DevTools at all, and
 * a desktop user with DevTools closed is the normal case — so nothing in the card
 * depends on any of this. Its absence degrades three lines out of twenty, each of
 * which says why (design §5.5).
 *
 * Minimal local HAR shapes: the `har-format` types are not a dependency of this
 * extension and only these fields are ever read.
 */

// Every field is widened with `| null`: the DevTools HAR typings model "absent" as
// null in places, and the whole point of this file is to survive whatever the
// browser hands over rather than assume a shape.
export interface HarInitiatorFrame {
  functionName?: string | null;
  url?: string | null;
  lineNumber?: number | null;
  columnNumber?: number | null;
}

export interface HarInitiator {
  type?: string | null;
  url?: string | null;
  lineNumber?: number | null;
  stack?: { callFrames?: HarInitiatorFrame[] | null } | null;
}

export interface HarEntry {
  startedDateTime?: string;
  request: { url: string; method?: string };
  response: {
    status: number;
    statusText?: string;
    redirectURL?: string;
    bodySize?: number;
    content?: { mimeType?: string; size?: number };
    _transferSize?: number | null;
  };
  // `null` / `string` are allowed because the DevTools HAR types model "absent" and
  // Firefox's simpler initiator that way. Never narrowed here — narrowed at use.
  _resourceType?: string | null;
  _initiator?: HarInitiator | string | null;
}

export interface HarLog {
  entries: HarEntry[];
}

/** Compare URLs the same way the in-page reader does — hash stripped (design §4.1). */
function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

/** The final (non-redirect) HAR entry for a URL, if DevTools captured it. */
export function findHarEntry(url: string, entries: HarEntry[]): HarEntry | null {
  if (!url) return null;
  const wanted = normalize(url);
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (e && normalize(e.request.url) === wanted) return e;
  }
  return null;
}

/**
 * Walk BACKWARD from the final entry through the 30x records that pointed at it.
 * This is the chain Resource Timing cannot give: it only ever reports the final URL
 * (design §2.5, §5.7).
 */
export function redirectChainFor(url: string, entries: HarEntry[]): RedirectStep[] {
  const final = findHarEntry(url, entries);
  if (!final) return [];
  const chain: RedirectStep[] = [
    { status: final.response.status, url: final.request.url },
  ];
  let target = normalize(final.request.url);
  // Bounded: a redirect loop must never hang the panel.
  for (let hop = 0; hop < 20; hop += 1) {
    const previous = entries.find(
      (e) =>
        e.response.status >= 300 &&
        e.response.status < 400 &&
        e.response.redirectURL !== undefined &&
        e.response.redirectURL !== '' &&
        normalize(new URL(e.response.redirectURL, e.request.url).href) === target,
    );
    if (!previous) break;
    chain.unshift({
      status: previous.response.status,
      url: previous.request.url,
      note: previous.response.redirectURL ? `Location: ${previous.response.redirectURL}` : undefined,
    });
    target = normalize(previous.request.url);
  }
  return chain;
}

/** `_transferSize` is authoritative in Chrome; -1/absent means "not available" →
 *  null, NEVER 0 (the same rule as Resource Timing, design §7 №1). */
export function harWeight(entry: HarEntry | null): WeightState {
  if (!entry) return { kind: 'not-in-buffer' };
  const t = entry.response._transferSize;
  if (typeof t === 'number' && t > 0) return { kind: 'measured', bytes: t };
  if (typeof t === 'number' && t === 0) return { kind: 'cache', bytes: 0 };
  const body = entry.response.bodySize;
  if (typeof body === 'number' && body > 0) return { kind: 'measured', bytes: body };
  return { kind: 'unmeasured', reason: 'DevTools did not report a transfer size for this entry' };
}

/** Exact MIME from the RESPONSE — the one place it is a fact, not an extension guess. */
export function harMime(entry: HarEntry | null): MimeInfo {
  const mime = entry?.response.content?.mimeType;
  if (!mime) return { value: '—', certainty: 'unknown' };
  return { value: mime.split(';')[0] ?? mime, certainty: 'exact' };
}

/** The `_initiator` call stack, flattened for display. Outside DevTools these lines
 *  do not exist — no extension API returns them (design §7 №2). */
export function initiatorStack(entry: HarEntry | null): { location: string; note?: string }[] {
  const raw = entry?._initiator;
  if (!raw) return [];
  // Firefox reports a bare string here; Chrome an object with a call stack. Degrade
  // to whatever the browser actually gave us — never invent the missing frames.
  if (typeof raw === 'string') return [{ location: raw, note: 'as reported by the browser' }];
  const init: HarInitiator = raw;
  const frames = init.stack?.callFrames ?? [];
  if (frames.length === 0) {
    if (init.url) {
      return [
        {
          location: `${init.url}${init.lineNumber != null ? `:${init.lineNumber}` : ''}`,
          note: init.type ?? undefined,
        },
      ];
    }
    return init.type ? [{ location: `type: ${init.type}`, note: 'the parser, not a script' }] : [];
  }
  return frames.slice(0, 8).map((f, i) => ({
    location: `${f.url || '(anonymous)'}:${f.lineNumber ?? '?'}:${f.columnNumber ?? '?'}${
      f.functionName ? ` — ${f.functionName}` : ''
    }`,
    note: i === 0 ? 'the real initiator' : 'called from',
  }));
}
