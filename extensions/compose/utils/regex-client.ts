import { mockAsync, todoLogic } from '@blur/ui';
import { MOCK_REGEX_MATCHES } from './mock';

// Main-thread side of the regex worker (design §2.5, §5.3, §8.1). 🔴 STUBBED.
//
// Owns the worker lifecycle: one in-flight request (id-gated), a `regexTimeoutMs`
// timer, and terminate+respawn on timeout. The real worker lives in
// utils/regex.worker.ts.

export interface RegexMatchSummary {
  matchCount: number;
  groups: string[];
  preview: { line: number; from: string; to: string }[];
}

export type RegexOutcome =
  | { status: 'ok'; result: RegexMatchSummary }
  | { status: 'invalid'; message: string; original: string }
  | { status: 'timeout'; timeoutMs: number };

/**
 * TODO_LOGIC (compose): create the Worker (`new Worker(new URL('./regex.worker.ts',
 * import.meta.url), { type: 'module' })`), post {id, pattern,
 * flags, text}, arm setTimeout(timeoutMs) → worker.terminate()+respawn, resolve
 * on the matching-id reply, ignore stale ids.
 */
export function runRegex(
  _pattern: string,
  _flags: string,
  _text: string,
  _timeoutMs: number,
): Promise<RegexOutcome> {
  throw todoLogic('regex-client: worker lifecycle + timeout + id gating');
}

/**
 * Scaffold stand-in: fabricated match summary via `mockAsync` so the drawer can
 * exercise its spinner/results states. Pass a `simulate` to preview the invalid
 * and timeout states (design §5.3, §5.4).
 */
export function runRegexMock(
  simulate: 'ok' | 'invalid' | 'timeout' = 'ok',
  timeoutMs = 500,
): Promise<RegexOutcome> {
  if (simulate === 'invalid') {
    return mockAsync({
      status: 'invalid',
      message: 'Неверный шаблон: не закрыта скобка «(» (позиция 1)',
      original: 'Invalid regular expression: /(\\d{4}/: Unterminated group',
    } as RegexOutcome);
  }
  if (simulate === 'timeout') {
    return mockAsync({ status: 'timeout', timeoutMs } as RegexOutcome, 700);
  }
  return mockAsync({
    status: 'ok',
    result: {
      matchCount: MOCK_REGEX_MATCHES.length,
      groups: ['год', 'месяц', 'день'],
      preview: MOCK_REGEX_MATCHES,
    },
  } as RegexOutcome);
}
