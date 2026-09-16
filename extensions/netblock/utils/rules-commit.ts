import { serializeRulesDocument, utf8Length, validateRulesDocument, type RuleError } from './rule-schema';
import { LIMITS, type Rule, type RulesDocument } from './rule-types';

// Every mutation of the rules document goes through ONE plan (design §7.1
// "storage is untrusted", §5.8 limits). Why a whole-document step and not
// per-rule validation: the cross-rule invariants — `afterRule` points at an
// existing rule, `groupId` at an existing group, ≤ LIMITS.regexRules regex
// rules, ≤ LIMITS.rulesHard rules, ≤ LIMITS.rulesBytes serialised — are
// checked by `validateRulesDocument`, which the background also runs on every
// worker start. A document that passes here therefore loads back identically;
// one that would not is refused BEFORE it is written, instead of silently
// losing rules at the next restart. Pure: Node-tested in e2e/netblock/logic.test.mjs.

export type CommitPlan =
  | { ok: true; doc: RulesDocument; changed: boolean; storageErrors: RuleError[] }
  | { ok: false; errors: RuleError[] };

/**
 * Start from the VALID projection of what storage holds (invalid entries are
 * reported as `storageErrors`, never applied), apply `mutate`, validate the
 * result. `changed` is false when the candidate serialises identically to the
 * raw input — the caller can skip the write.
 */
export function planRulesCommit(raw: unknown, mutate: (doc: RulesDocument) => RulesDocument): CommitPlan {
  const current = validateRulesDocument(raw);
  const candidate = mutate(current.doc);
  const v = validateRulesDocument(candidate);
  if (!v.ok) return { ok: false, errors: v.errors };
  const text = serializeRulesDocument(v.doc);
  if (utf8Length(text) > LIMITS.rulesBytes) {
    return {
      ok: false,
      errors: [{ index: null, where: 'document', path: '', message: `rules document larger than ${LIMITS.rulesBytes} bytes` }],
    };
  }
  let changed = true;
  try {
    changed = text !== JSON.stringify(raw, null, 2);
  } catch {
    // Unserialisable input (never from storage) — treat as changed.
  }
  return { ok: true, doc: v.doc, changed, storageErrors: current.errors };
}

/** Rules whose `afterRule` points at `ruleId` — they would become invalid if it were deleted. */
export function dependantsOf(doc: RulesDocument, ruleId: string): Rule[] {
  return doc.rules.filter((r) => r.state.kind === 'afterRule' && r.state.ruleId === ruleId);
}

/** The error a `deleteRule` returns when other rules follow the victim (design §3 `afterRule`). */
export function deleteBlockedError(dependants: readonly Rule[]): RuleError {
  const names = dependants.map((r) => `"${r.name || r.id}"`).join(', ');
  return {
    index: null,
    where: 'document',
    path: 'state.ruleId',
    message: `${names} ${dependants.length === 1 ? 'follows' : 'follow'} this rule (After rule) — change or delete ${dependants.length === 1 ? 'it' : 'them'} first`,
  };
}
