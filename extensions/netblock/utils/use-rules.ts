import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sendQuery, usePushMessages } from './messaging';
import type { PushMessage, RulesApplied } from './protocol';
import type { RuleError } from './rule-schema';
import type { Rule, RuleGroup, RulesDocument } from './rule-types';

// ONE hook, ONE writer for the rules document on the tool page (the same
// single-writer discipline as usePrefs). Every mutation goes to the background
// (`saveRule`, `deleteRule`, …) which validates, stores under the rules lock,
// recompiles and applies to the engines; the reply carries `applied`, and only
// THEN does the UI show the rule as applied (design §5.2 — until the browser
// confirms, it is "applying…", never "enabled").
//
// `applied` is also refreshed from the `rules:applied` push, so engine errors
// reported later (a DNR reject after the fact, §5.7) reach the list.

export type SaveOutcome = { ok: true } | { ok: false; errors: RuleError[] };

export interface RulesStore {
  doc: RulesDocument | null;
  applied: RulesApplied | null;
  /** Rule ids with a mutation in flight. */
  pending: ReadonlySet<string>;
  /** Transport-level failure (background unreachable). */
  error: string | null;
  reload: () => Promise<void>;
  saveRule: (rule: Rule) => Promise<SaveOutcome>;
  deleteRule: (ruleId: string) => Promise<SaveOutcome>;
  saveGroup: (group: RuleGroup) => Promise<SaveOutcome>;
  deleteGroup: (groupId: string) => Promise<SaveOutcome>;
  reorderRules: (ruleIds: string[]) => Promise<SaveOutcome>;
  deleteAllRules: () => Promise<SaveOutcome>;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useRulesStore(): RulesStore {
  const [doc, setDoc] = useState<RulesDocument | null>(null);
  const [applied, setApplied] = useState<RulesApplied | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const r = await sendQuery({ type: 'listRules' });
      if (!alive.current) return;
      setDoc({ version: r.version, rules: r.rules, groups: r.groups });
      setApplied(r.applied);
      setError(null);
    } catch (err) {
      if (alive.current) setError(describe(err));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  const onPush = useCallback((m: PushMessage) => {
    if (m.type === 'rules:applied') setApplied(m.applied);
  }, []);
  usePushMessages(onPush);

  /** Run a mutation; mark `ids` pending until the background answers. */
  const mutate = useCallback(
    async (ids: string[], run: () => Promise<{ ok: true; applied: RulesApplied } | { ok: false; errors: RuleError[] }>): Promise<SaveOutcome> => {
      setPending((p) => new Set([...p, ...ids]));
      try {
        const r = await run();
        if (!alive.current) return r.ok ? { ok: true } : r;
        if (r.ok) {
          setApplied(r.applied);
          // The document itself is re-read: the background is the source of
          // truth for priorities, ids and validation-normalised fields.
          await reload();
          return { ok: true };
        }
        return { ok: false, errors: r.errors };
      } catch (err) {
        const message = describe(err);
        if (alive.current) setError(message);
        return { ok: false, errors: [{ index: null, where: 'document', path: '', message }] };
      } finally {
        if (alive.current) {
          setPending((p) => {
            const next = new Set(p);
            for (const id of ids) next.delete(id);
            return next;
          });
        }
      }
    },
    [reload],
  );

  const api = useMemo<Omit<RulesStore, 'doc' | 'applied' | 'pending' | 'error'>>(
    () => ({
      reload,
      saveRule: (rule) => mutate([rule.id], () => sendQuery({ type: 'saveRule', rule })),
      deleteRule: (ruleId) => mutate([ruleId], () => sendQuery({ type: 'deleteRule', ruleId })),
      saveGroup: (group) => mutate([], () => sendQuery({ type: 'saveGroup', group })),
      deleteGroup: (groupId) => mutate([], () => sendQuery({ type: 'deleteGroup', groupId })),
      reorderRules: (ruleIds) => mutate(ruleIds, () => sendQuery({ type: 'reorderRules', ruleIds })),
      deleteAllRules: () => mutate([], () => sendQuery({ type: 'deleteAllRules' })),
    }),
    [mutate, reload],
  );

  return { doc, applied, pending, error, ...api };
}

/** Engine error attributed to a rule, if the last apply reported one (§5.7). */
export function ruleErrorOf(applied: RulesApplied | null, ruleId: string): string | undefined {
  return applied?.errors.find((e) => e.ruleId === ruleId)?.message;
}
