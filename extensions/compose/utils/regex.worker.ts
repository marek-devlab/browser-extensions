// Regex matching Web Worker (design §2.5, §8.1). 🔴 STUBBED.
//
// Lives in utils/ (NOT entrypoints/) so WXT doesn't try to classify it as an
// extension entrypoint; it is bundled by Vite when instantiated with
// `new Worker(new URL('./regex.worker.ts', import.meta.url), { type: 'module' })`.
//
// 🔴 WHY A WORKER: `new RegExp(userInput)` is NEVER run on the main thread —
// not even to check validity. A pathological pattern (nested quantifiers, ReDoS)
// can hang forever; the only way to interrupt it is `worker.terminate()`. The
// main thread arms a `regexTimeoutMs` timer and kills + respawns the worker on
// timeout (design §5.3). The worker has NO storage access — it is a pure
// function "text + pattern → ranges", so compromising it yields nothing.
//
// Protocol: main → { id, pattern, flags, text }; worker → { id, matches } |
//           { id, error }. Only the latest `id` is honoured (keystroke gating).

export interface RegexRequest {
  id: number;
  pattern: string;
  flags: string;
  text: string;
}

export type RegexResponse =
  | { id: number; matches: [number, number, string[]][] }
  | { id: number; error: string };

// TODO_LOGIC (compose): compile `new RegExp(pattern, flags)` inside this worker,
// catch SyntaxError and post it back as { error } (validation happens HERE, not
// on the main thread — design §8.1), iterate matches with a hard match cap, and
// post [start, end, groups][]. Runs in the worker so the main-thread timeout can
// terminate a runaway match.
self.addEventListener('message', (ev: MessageEvent<RegexRequest>) => {
  const { id } = ev.data;
  // Scaffold: no real matching yet. Reply with an explicit not-implemented error
  // so a wired-but-empty path fails loudly instead of pretending to find nothing.
  const response: RegexResponse = {
    id,
    error: 'TODO_LOGIC: not implemented — regex-worker: compile + match with cap',
  };
  (self as unknown as Worker).postMessage(response);
});
