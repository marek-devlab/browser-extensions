import type { MsgKey } from './i18n';

// Design §5.7: an engine error is shown with the browser's message VERBATIM
// plus our translation of what it means. The mapping is a substring heuristic
// over Chrome's/Firefox's known wordings; anything unrecognised gets only the
// verbatim text and a generic line — never a confident wrong translation.

export function translateEngineError(message: string): MsgKey {
  const m = message.toLowerCase();
  if (m.includes('regex') || m.includes('regular expression') || m.includes('re2')) return 'errRegex';
  if (m.includes('max_number_of') || m.includes('rule limit') || m.includes('too many rules') || m.includes('exceeds')) {
    return 'errRuleLimit';
  }
  return 'errUnknown';
}
