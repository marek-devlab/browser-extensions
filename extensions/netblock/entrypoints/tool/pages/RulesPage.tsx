import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@blur/ui';
import type { EngineCaps, Platform } from '../../../utils/engine-select';
import { useT } from '../../../utils/i18n';
import { PRESET_IDS, newRuleId, presetRule, type PresetId } from '../../../utils/rule-presets';
import { defaultRule, type Rule } from '../../../utils/rule-types';
import type { RulesStore } from '../../../utils/use-rules';
import { navigate, type Route } from '../router';
import { RuleEditor } from './RuleEditor';
import { RuleList } from './RuleList';

// Design §2.4 split view + §5.1 empty state + §2.9 narrow layout. The editor's
// `initial` rule comes from the store (existing id), from a preset (`?preset=`)
// or from a seed handed in by the log page ("create rule from request"). A
// preset or seed only PRE-FILLS; nothing exists until Save.

const PRESET_NAME = { blockDomain: 'presetBlockDomainName', nth503: 'presetNth503Name', flaky: 'presetFlakyName' } as const;
const PRESET_LABEL = { blockDomain: 'presetBlockDomain', nth503: 'presetNth503', flaky: 'presetFlaky' } as const;

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 719px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 719px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function RulesPage({
  store,
  route,
  platform,
  caps,
  origins,
  seed,
  clearSeed,
}: {
  store: RulesStore;
  route: Route;
  platform: Platform;
  /** Effective caps from the background (`getCaps`) — already reflect the
   *  "allow the page engine" pref, so the live badge and the compiled list agree. */
  caps: EngineCaps;
  origins: string[] | null;
  /** A rule pre-filled by the log page; consumed once. */
  seed: Rule | null;
  clearSeed: () => void;
}) {
  const t = useT();
  const narrow = useNarrow();
  const { doc } = store;
  const [draftNew, setDraftNew] = useState<Rule | null>(null);

  const isNew = route.ruleId === 'new';
  const presetId = PRESET_IDS.includes(route.preset as PresetId) ? (route.preset as PresetId) : null;

  // Build the blank/preset/seeded rule ONCE per visit to `#/rules/new`.
  useEffect(() => {
    if (!isNew) {
      setDraftNew(null);
      return;
    }
    if (seed) {
      setDraftNew(seed);
      clearSeed();
      return;
    }
    setDraftNew((cur) => {
      if (cur && !presetId) return cur;
      const id = newRuleId();
      const now = Date.now();
      return presetId ? presetRule(presetId, id, now, t(PRESET_NAME[presetId])) : defaultRule(id, now);
    });
    // `t` is stable per locale; a locale switch mid-edit keeps the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, presetId, seed]);

  const selected = useMemo(() => (route.ruleId && !isNew ? doc?.rules.find((r) => r.id === route.ruleId) : undefined), [route.ruleId, isNew, doc]);
  const editing: Rule | null = isNew ? draftNew : (selected ?? null);

  const openRule = (id: string) => navigate({ ...route, ruleId: id, preset: undefined });
  const openNew = () => navigate({ page: 'rules', ruleId: 'new', tabId: route.tabId });
  const closeEditor = () => navigate({ page: 'rules', tabId: route.tabId });

  if (!doc) return <p className="fine">{t('loading')}</p>;

  if (doc.rules.length === 0 && !isNew) {
    return (
      <EmptyState
        title={t('toolEmptyTitle')}
        hint={
          <>
            <span className="schema mono" aria-hidden="true">
              {t('toolEmptySchema')}
            </span>
            <br />
            {t('toolEmptyBody')}
          </>
        }
        action={
          <div className="presets" data-testid="presets">
            {PRESET_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className="ui-btn"
                data-testid={`preset-${id}`}
                onClick={() => navigate({ page: 'rules', ruleId: 'new', preset: id, tabId: route.tabId })}
              >
                {t(PRESET_LABEL[id])}
              </button>
            ))}
            <button type="button" className="ui-btn ui-btn--primary" onClick={openNew} data-testid="add-rule">
              {t('rlAddRule')}
            </button>
            <p className="fine">{t('presetOpensEditor')}</p>
            <p className="fine">{t('rlRulesAreData')}</p>
          </div>
        }
      />
    );
  }

  const editor = editing ? (
    <RuleEditor
      key={editing.id}
      initial={editing}
      isNew={isNew}
      store={store}
      platform={platform}
      caps={caps}
      origins={origins}
      tabId={route.tabId}
      // The draft keeps its id, so `#/rules/new` → `#/rules/<id>` keeps the
      // editor mounted (same `key`) and the "Rule applied." live message
      // survives the route change; `draftNew` is cleared by the effect above.
      onSaved={openRule}
      onDeleted={closeEditor}
      onBack={narrow ? closeEditor : undefined}
    />
  ) : (
    <div className="editor editor--empty fine">{t('rlOrderHint')}</div>
  );

  if (narrow) {
    return <div className="split split--narrow">{editing ? editor : <RuleList store={store} selectedId={route.ruleId} onOpen={openRule} onNew={openNew} />}</div>;
  }

  return (
    <div className="split">
      <RuleList store={store} selectedId={route.ruleId} onOpen={openRule} onNew={openNew} />
      {editor}
    </div>
  );
}
