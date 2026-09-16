import type { TFn } from './i18n';
import type { Rule } from './rule-types';

// One-line human summary of a rule for list rows and the popup: what it
// matches, when it fires, what it does. Engine badges, HTTP methods, status
// codes and CDP reasons stay untranslated (i18n.ts header).

export function summarizeCondition(t: TFn, rule: Rule): string {
  const c = rule.condition;
  const parts: string[] = [];
  if (c.methods?.length) parts.push(c.methods.join('/'));
  parts.push(c.url?.value ? `${c.url.op === 'equals' ? '=' : c.url.op === 'regex' ? '~' : ''}${c.url.value}` : t('sumAnyUrl'));
  if (c.resourceTypes?.length && !(c.resourceTypes.length === 1 && c.resourceTypes[0] === 'xhr')) {
    parts.push(c.resourceTypes.join(','));
  }
  if (c.responseStatus) parts.push(`← ${c.responseStatus}`);
  return parts.join(' ');
}

export function summarizeState(t: TFn, rule: Rule): string | null {
  const s = rule.state;
  switch (s.kind) {
    case 'every':
      return null;
    case 'once':
      return t('sumOnce');
    case 'times':
      return t('sumTimes', { n: s.n });
    case 'nth':
      return s.every ? t('sumNthEvery', { n: s.n, suffix: ordinalSuffix(s.n) }) : t('sumNth', { n: s.n, suffix: ordinalSuffix(s.n) });
    case 'skipFirst':
      return t('sumSkip', { n: s.skip });
    case 'probability':
      return t('sumProb', { p: s.percent });
    case 'window':
      return t('sumWindow', { s: s.seconds });
    case 'afterRule':
      return t('sumAfter');
  }
}

export function summarizeAction(t: TFn, rule: Rule): string {
  const a = rule.action;
  switch (a.type) {
    case 'block':
      return t('sumBlock');
    case 'fail':
      return t('sumFail', { reason: a.reason });
    case 'delay':
      return t('sumDelay', { ms: a.ms });
    case 'status':
      return t('sumStatus', { code: a.code });
  }
}

export function summarizeRule(t: TFn, rule: Rule): string {
  const state = summarizeState(t, rule);
  return [summarizeCondition(t, rule), state, '→ ' + summarizeAction(t, rule)].filter(Boolean).join(' · ');
}

export function ruleDisplayName(t: TFn, rule: Rule): string {
  return rule.name.trim() || t('untitledRule');
}

/** English ordinal suffix (1st, 2nd, 3rd, 4th, 11th–13th). The RU/ET strings
 *  carry their own ordinal marker and simply do not use `{suffix}`. */
export function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}
