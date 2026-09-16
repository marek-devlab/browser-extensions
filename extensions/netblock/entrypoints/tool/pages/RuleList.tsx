import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { EngineBadge } from '../../../utils/engine-badge';
import type { EngineId } from '../../../utils/engine-select';
import { honestyKey, useT, type MsgKey } from '../../../utils/i18n';
import type { RulesApplied } from '../../../utils/protocol';
import { ruleDisplayName, summarizeRule } from '../../../utils/rule-summary';
import { LIMITS, type Rule, type RuleGroup, type RulesDocument } from '../../../utils/rule-types';
import { ruleErrorOf, type RulesStore } from '../../../utils/use-rules';
import { newRuleId } from '../../../utils/rule-presets';

// The left pane of design §2.4: groups with toggles, rules in priority order,
// drag reorder WITH a keyboard equivalent (§9.3: `role="listbox"`, ↑↓ focus,
// Space toggle, Enter open, Alt+↑↓ reorder). Visual order == priority order:
// the flattened list of sections IS the id list sent to `reorderRules`, so
// what the user sees is what first-match evaluates.

export type RuleStatus =
  | { kind: 'active'; engine: EngineId; degraded: boolean }
  | { kind: 'inactive'; engine: EngineId | null; reasonKey: MsgKey }
  | { kind: 'applying' }
  | { kind: 'error'; message: string };

export function statusOf(rule: Rule, applied: RulesApplied | null, pending: ReadonlySet<string>): RuleStatus {
  if (pending.has(rule.id)) return { kind: 'applying' };
  const err = ruleErrorOf(applied, rule.id);
  if (err) return { kind: 'error', message: err };
  const c = applied?.compiled.find((x) => x.rule.id === rule.id);
  if (c) return { kind: 'active', engine: c.engine, degraded: !!c.degraded };
  const i = applied?.inactive.find((x) => x.rule.id === rule.id);
  if (i) {
    const reasonKey: MsgKey =
      i.reason === 'disabled' ? 'reasonDisabled' : i.reason === 'groupDisabled' ? 'reasonGroupDisabled' : honestyKey(i.reason);
    return { kind: 'inactive', engine: i.engine, reasonKey };
  }
  return { kind: 'applying' };
}

interface Section {
  group: RuleGroup | null;
  rules: Rule[];
}

/** Groups by `order`, rules by priority inside each; ungrouped last. */
export function sectionsOf(doc: RulesDocument): Section[] {
  const ordered = [...doc.rules].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  const groups = [...doc.groups].sort((a, b) => a.order - b.order);
  const known = new Set(groups.map((g) => g.id));
  const out: Section[] = groups.map((group) => ({ group, rules: ordered.filter((r) => r.groupId === group.id) }));
  out.push({ group: null, rules: ordered.filter((r) => r.groupId === undefined || !known.has(r.groupId)) });
  return out;
}

export function RuleList({
  store,
  selectedId,
  onOpen,
  onNew,
}: {
  store: RulesStore;
  selectedId?: string;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const t = useT();
  const { doc, applied, pending } = store;
  const [filter, setFilter] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => (doc ? sectionsOf(doc) : []), [doc]);
  const flat = useMemo(() => sections.flatMap((s) => s.rules), [sections]);
  const q = filter.trim().toLowerCase();
  const visible = (r: Rule) => !q || ruleDisplayName(t, r).toLowerCase().includes(q) || summarizeRule(t, r).toLowerCase().includes(q);
  const flatVisible = useMemo(() => flat.filter(visible), [flat, q, t]); // eslint-disable-line react-hooks/exhaustive-deps

  // Roving tabindex: the focused option (or the selected one) is the tab stop.
  const activeId = focusId && flat.some((r) => r.id === focusId) ? focusId : (selectedId ?? flatVisible[0]?.id ?? null);

  useEffect(() => {
    if (!focusId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-rule-id="${CSS.escape(focusId)}"]`);
    el?.focus();
  }, [focusId, flat]);

  if (!doc) return <p className="fine">{t('loading')}</p>;

  /** New flattened id order after moving `id` to before `beforeId` (or to the end of `groupId`'s section). */
  async function moveTo(id: string, target: { beforeId?: string; groupId?: string | null }): Promise<void> {
    const rule = doc!.rules.find((r) => r.id === id);
    if (!rule) return;
    let ids = flat.map((r) => r.id).filter((x) => x !== id);
    let groupId: string | undefined = rule.groupId;
    if (target.beforeId !== undefined) {
      const before = doc!.rules.find((r) => r.id === target.beforeId);
      if (!before || before.id === id) return;
      groupId = before.groupId;
      const idx = ids.indexOf(before.id);
      ids.splice(idx, 0, id);
    } else {
      groupId = target.groupId ?? undefined;
      const section = sections.find((s) => (s.group?.id ?? null) === (target.groupId ?? null));
      const last = section?.rules.filter((r) => r.id !== id).at(-1);
      if (last) {
        ids.splice(ids.indexOf(last.id) + 1, 0, id);
      } else {
        // Empty section: place after the previous section's last rule.
        const sIdx = sections.findIndex((s) => (s.group?.id ?? null) === (target.groupId ?? null));
        let pos = 0;
        for (let i = 0; i < sIdx; i++) pos += sections[i]!.rules.filter((r) => r.id !== id).length;
        ids.splice(pos, 0, id);
      }
    }
    if (groupId !== rule.groupId) {
      const next: Rule = { ...rule };
      if (groupId === undefined) delete next.groupId;
      else next.groupId = groupId;
      const r = await store.saveRule(next);
      if (!r.ok) return;
    }
    ids = Array.from(new Set(ids));
    await store.reorderRules(ids);
    setFocusId(id);
  }

  async function moveBy(id: string, delta: -1 | 1): Promise<void> {
    const idx = flat.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const target = idx + delta;
    if (delta === -1) {
      if (target < 0) return;
      await moveTo(id, { beforeId: flat[target]!.id });
    } else {
      if (target >= flat.length) {
        // Already last overall — nothing below.
        return;
      }
      const after = flat[target]!;
      const afterNext = flat[target + 1];
      if (afterNext) await moveTo(id, { beforeId: afterNext.id });
      else await moveTo(id, { groupId: after.groupId ?? null });
    }
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-rule-id]')?.dataset.ruleId;
    if (!id) return;
    const idx = flatVisible.findIndex((r) => r.id === id);
    if (idx === -1) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      void moveBy(id, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusId(flatVisible[Math.min(idx + 1, flatVisible.length - 1)]!.id);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusId(flatVisible[Math.max(idx - 1, 0)]!.id);
        break;
      case 'Home':
        e.preventDefault();
        setFocusId(flatVisible[0]!.id);
        break;
      case 'End':
        e.preventDefault();
        setFocusId(flatVisible[flatVisible.length - 1]!.id);
        break;
      case ' ': {
        e.preventDefault();
        const rule = flat[flat.findIndex((r) => r.id === id)]!;
        void store.saveRule({ ...rule, enabled: !rule.enabled });
        break;
      }
      case 'Enter':
        e.preventDefault();
        onOpen(id);
        break;
    }
  }

  function onDrop(e: DragEvent, target: { beforeId?: string; groupId?: string | null }): void {
    e.preventDefault();
    const id = dragId ?? e.dataTransfer.getData('text/plain');
    setDragId(null);
    if (id) void moveTo(id, target);
  }

  const count = doc.rules.length;
  const overSoft = count >= LIMITS.rulesSoft;
  const overHard = count >= LIMITS.rulesHard;

  return (
    <div className="rlist">
      <div className="rlist__bar">
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={onNew} disabled={overHard} data-testid="add-rule">
          {t('rlAddRule')}
        </button>
        <button
          type="button"
          className="ui-btn ui-btn--sm"
          disabled={doc.groups.length >= LIMITS.groups}
          onClick={() => {
            const id = newRuleId();
            void store.saveGroup({ id, name: t('rlNewGroup'), enabled: true, order: doc.groups.length }).then(() => setEditingGroup(id));
          }}
        >
          {t('rlAddGroup')}
        </button>
        <input
          type="search"
          className="rlist__filter"
          placeholder={t('rlFilter')}
          aria-label={t('rlFilter')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {overHard ? (
        <p className="fine warn" role="alert">
          {t('rlHardCap', { max: LIMITS.rulesHard })}
        </p>
      ) : overSoft ? (
        <p className="fine warn">{t('rlSoftCap', { n: count, max: LIMITS.rulesSoft })}</p>
      ) : null}

      <div
        ref={listRef}
        className="rlist__list"
        role="listbox"
        aria-label={t('rlListAria')}
        aria-activedescendant={activeId ? `rule-${activeId}` : undefined}
        onKeyDown={onKey}
      >
        {sections.map((s) => {
          const rows = s.rules.filter(visible);
          if (s.group === null && rows.length === 0 && q) return null;
          const gid = s.group?.id ?? null;
          return (
            <div
              key={gid ?? '__none'}
              className="rgroup"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                // A drop on the group body (not a row) appends to this section.
                if ((e.target as HTMLElement).closest('[data-rule-id]')) return;
                onDrop(e, { groupId: gid });
              }}
            >
              <div className="rgroup__head" role="presentation">
                <span className="rgroup__caret" aria-hidden="true">
                  ▾
                </span>
                {s.group && editingGroup === s.group.id ? (
                  <input
                    className="rgroup__name-input"
                    aria-label={t('rlGroupName')}
                    defaultValue={s.group.name}
                    autoFocus
                    onBlur={(e) => {
                      const name = e.target.value.trim().slice(0, LIMITS.nameLength);
                      setEditingGroup(null);
                      if (name && name !== s.group!.name) void store.saveGroup({ ...s.group!, name });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setEditingGroup(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="rgroup__name"
                    onClick={() => s.group && setEditingGroup(s.group.id)}
                    disabled={!s.group}
                    title={s.group ? t('rlGroupName') : undefined}
                  >
                    {s.group ? s.group.name : t('rlNoGroup')}
                  </button>
                )}
                {s.group ? (
                  <>
                    <label className="rgroup__toggle">
                      <input
                        type="checkbox"
                        checked={s.group.enabled}
                        aria-label={t('rlToggleGroup', { name: s.group.name })}
                        onChange={(e) => void store.saveGroup({ ...s.group!, enabled: e.target.checked })}
                      />
                    </label>
                    <button
                      type="button"
                      className="rgroup__del"
                      aria-label={t('rlDeleteGroup', { name: s.group.name })}
                      title={t('rlDeleteGroup', { name: s.group.name })}
                      onClick={() => void store.deleteGroup(s.group!.id)}
                    >
                      ✕
                    </button>
                  </>
                ) : null}
              </div>
              {rows.map((rule) => {
                const st = statusOf(rule, applied, pending);
                const name = ruleDisplayName(t, rule);
                const selected = rule.id === selectedId;
                const inactive = st.kind === 'inactive';
                return (
                  <div
                    key={rule.id}
                    id={`rule-${rule.id}`}
                    data-rule-id={rule.id}
                    data-status={st.kind}
                    data-engine={st.kind === 'active' || st.kind === 'inactive' ? (st.engine ?? 'none') : undefined}
                    role="option"
                    aria-selected={selected}
                    aria-describedby={inactive ? `rule-why-${rule.id}` : undefined}
                    tabIndex={activeId === rule.id ? 0 : -1}
                    className={`rrow${selected ? ' rrow--selected' : ''}${inactive ? ' rrow--inactive' : ''}${dragId === rule.id ? ' rrow--dragging' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      setDragId(rule.id);
                      e.dataTransfer.setData('text/plain', rule.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDragId(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.stopPropagation();
                      onDrop(e, { beforeId: rule.id });
                    }}
                    onClick={() => {
                      setFocusId(rule.id);
                      onOpen(rule.id);
                    }}
                    onFocus={() => setFocusId(rule.id)}
                  >
                    <span className="rrow__grip" aria-hidden="true">
                      ≡
                    </span>
                    <span className="rrow__glyph" aria-hidden="true">
                      {st.kind === 'active' ? '●' : st.kind === 'applying' ? '◌' : st.kind === 'error' ? '⚠' : '○'}
                    </span>
                    <span className="rrow__main">
                      <span className="rrow__name">{name}</span>
                      <span className="rrow__sum fine">{summarizeRule(t, rule)}</span>
                      {st.kind === 'inactive' ? (
                        <span id={`rule-why-${rule.id}`} className="rrow__why fine">
                          {t('rlInactive')} · {t(st.reasonKey)}
                        </span>
                      ) : st.kind === 'applying' ? (
                        <span className="rrow__why fine">{t('rlApplying')}</span>
                      ) : st.kind === 'error' ? (
                        <span className="rrow__why fine warn">
                          {t('rlError')} · {st.message}
                        </span>
                      ) : null}
                    </span>
                    <span className="rrow__badge">
                      {st.kind === 'active' ? (
                        <EngineBadge engine={st.engine} degraded={st.degraded} />
                      ) : st.kind === 'inactive' ? (
                        <EngineBadge engine={st.engine} inactive />
                      ) : null}
                    </span>
                    <input
                      type="checkbox"
                      className="rrow__toggle"
                      checked={rule.enabled}
                      aria-label={t('rlToggleRule', { name })}
                      tabIndex={-1}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => void store.saveRule({ ...rule, enabled: e.target.checked })}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
        {q && flatVisible.length === 0 ? <p className="fine">{t('rlFilterEmpty')}</p> : null}
      </div>

      <p className="fine rlist__hint">{t('rlOrderHint')}</p>
      <p className="fine rlist__hint">{t('rlKeyboardHint')}</p>
      <p className="fine rlist__hint">{t('rlRulesAreData')}</p>
    </div>
  );
}
