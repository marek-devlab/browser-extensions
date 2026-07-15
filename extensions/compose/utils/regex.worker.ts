// Regex matching Web Worker (design §2.5, §8.1).
//
// Lives in utils/ (NOT entrypoints/) so WXT doesn't classify it as an extension
// entrypoint; Vite bundles it when it is instantiated with
// `new Worker(new URL('./regex.worker.ts', import.meta.url), { type: 'module' })`.
//
// 🔴 WHY A WORKER: `new RegExp(userInput)` is NEVER run on the main thread — not
// even to check validity. A pathological pattern (nested quantifiers → ReDoS)
// can hang for hours; the ONLY way to interrupt a running regex is
// `worker.terminate()`. The main thread arms a `regexTimeoutMs` timer and kills
// + respawns this worker on timeout (design §5.3).
//
// 🔴 The worker has NO storage access and NO chrome.* — it is a pure function
// "text + pattern → ranges". Compromising it yields nothing.
//
// Protocol: main → RegexRequest; worker → RegexResponse. Only the latest `id` is
// honoured by the client (keystroke gating).

export interface RegexRequest {
  id: number;
  pattern: string;
  flags: string;
  text: string;
  /** Replacement template ($1, $&, $<name>) — expanded HERE, see below. */
  replacement: string;
  /** When false the pattern is escaped and matched literally (the "Regex" box). */
  regex: boolean;
}

export interface RegexMatch {
  start: number;
  end: number;
  groups: string[];
  /** The expanded replacement for THIS match. */
  replaced: string;
}

export type RegexResponse =
  | {
      id: number;
      ok: true;
      matches: RegexMatch[];
      groupNames: string[];
      /** true when the hard cap stopped the scan (design §5.5). */
      truncated: boolean;
    }
  | { id: number; ok: false; error: string };

/** Hard cap: a pattern like `.*` on a 400 KB draft must not build a 10⁶-entry
 *  array and blow memory in the worker. */
const MATCH_CAP = 5000;

function escapeLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Expand a `$…` replacement template against a match. Written by hand rather
 * than calling `String.replace(re, tpl)` because that would RE-RUN the user's
 * regex — a second chance to hang, and the whole point is that the pattern is
 * executed exactly once, under the timeout.
 */
function expand(tpl: string, m: RegExpMatchArray): string {
  return tpl.replace(/\$(\$|&|<([^>]*)>|\d{1,2})/g, (_whole, token: string, name?: string) => {
    if (token === '$') return '$';
    if (token === '&') return m[0];
    if (name !== undefined) return m.groups?.[name] ?? '';
    const n = Number(token);
    return m[n] ?? '';
  });
}

self.addEventListener('message', (ev: MessageEvent<RegexRequest>) => {
  const req = ev.data;
  const post = (r: RegexResponse) => (self as unknown as Worker).postMessage(r);

  try {
    const source = req.regex ? req.pattern : escapeLiteral(req.pattern);
    // Iteration needs `g`; if the user did not ask for it we still compile with
    // it and keep only the first match, so "replace" means "replace once".
    const wantsAll = req.flags.includes('g');
    const flags = wantsAll ? req.flags : req.flags + 'g';

    // 🔴 The one and only `new RegExp(userInput)` in the codebase, and it is in
    // a terminable thread. Compilation itself can throw (SyntaxError) — that is
    // reported as a message, never as an uncaught error.
    const re = new RegExp(source, flags);

    const matches: RegexMatch[] = [];
    let groupNames: string[] = [];
    let truncated = false;
    let last = -1;

    for (const m of req.text.matchAll(re)) {
      const start = m.index ?? 0;
      // A zero-length match at the same index would spin forever in a manual
      // loop; matchAll advances lastIndex itself, but guard anyway.
      if (m[0].length === 0 && start === last) break;
      last = start;
      if (groupNames.length === 0 && m.groups) groupNames = Object.keys(m.groups);
      matches.push({
        start,
        end: start + m[0].length,
        groups: m.slice(1).map((g) => g ?? ''),
        replaced: expand(req.replacement, m),
      });
      if (!wantsAll) break;
      if (matches.length >= MATCH_CAP) {
        truncated = true;
        break;
      }
    }

    post({ id: req.id, ok: true, matches, groupNames, truncated });
  } catch (e) {
    post({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
