import { useEffect, useMemo, useRef, useState } from 'react';
import { checkRegexSafety } from '@blur/netcore';
import { EngineBadge, HonestyNotes } from '../../../utils/engine-badge';
import { selectEngine, type EngineCaps, type Platform } from '../../../utils/engine-select';
import { translateEngineError } from '../../../utils/error-translate';
import { honestyKey, useT, type MsgKey, type TFn } from '../../../utils/i18n';
import { sendQuery } from '../../../utils/messaging';
import type { TestUrlResult } from '../../../utils/protocol';
import { cloneRule, newSeed, rulesEqual } from '../../../utils/rule-presets';
import { utf8Length, validateRule, type RuleError } from '../../../utils/rule-schema';
import { ruleDisplayName } from '../../../utils/rule-summary';
import {
  BODY_CONTENT_TYPES,
  FAILURE_REASONS,
  HEADER_OPS,
  HTTP_METHODS,
  LIMITS,
  RESOURCE_KINDS,
  STATUS_CODE_MAX,
  STATUS_CODE_MIN,
  type Action,
  type BodyContentType,
  type FailureReason,
  type EnginePreference,
  type HeaderCondition,
  type HttpMethod,
  type ResourceKind,
  type Rule,
  type State,
  type UrlOp,
} from '../../../utils/rule-types';
import { ruleErrorOf, type RulesStore } from '../../../utils/use-rules';

// The editor of design §2.4 — a FORM, not a text syntax, because the form is
// what lets the engine badge change under the user's hands: every edit reruns
// `selectEngine()` (the same decision table the background compiles with) and
// prints the honesty lines for the chosen engine. That live badge is the main
// teaching element of the whole tool.
//
// Save = validate locally (field errors) → `saveRule` → the background answers
// with `applied` → only then "Rule applied" (design §5.2). A browser rejection
// (§5.7) is shown verbatim plus our translation; nothing is disabled silently.

const URL_OPS: { op: UrlOp; key: MsgKey }[] = [
  { op: 'contains', key: 'edOpContains' },
  { op: 'equals', key: 'edOpEquals' },
  { op: 'wildcard', key: 'edOpWildcard' },
  { op: 'regex', key: 'edOpRegex' },
];

const ENGINE_PREFS: EnginePreference[] = ['auto', 'dnr', 'page', 'debugger', 'webrequest'];

function num(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function fieldErrors(errors: RuleError[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of errors) if (!m.has(e.path)) m.set(e.path, e.message);
  return m;
}

export function RuleEditor({
  initial,
  isNew,
  store,
  platform,
  caps,
  origins,
  tabId,
  onSaved,
  onDeleted,
  onBack,
}: {
  initial: Rule;
  isNew: boolean;
  store: RulesStore;
  platform: Platform;
  caps: EngineCaps;
  /** Origins with host access (Chrome); null while unknown. */
  origins: string[] | null;
  tabId?: number;
  onSaved: (id: string) => void;
  onDeleted: () => void;
  onBack?: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Rule>(() => cloneRule(initial));
  const [saved, setSaved] = useState<Rule>(() => cloneRule(initial));
  const [errors, setErrors] = useState<RuleError[]>([]);
  const [live, setLive] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [test, setTest] = useState<{ url: string; result: TestUrlResult | null }>({ url: '', result: null });
  const formRef = useRef<HTMLFormElement>(null);

  // The stored rule changed underneath (another surface saved it, or the list
  // toggled it): reset the form — but only on a MATERIAL change. A store reload
  // that yields an equal object (after our own save, or after a sibling rule
  // was toggled) must not wipe in-progress edits. Switching rules remounts the
  // editor (`key={rule.id}`), so this only sees same-id updates.
  useEffect(() => {
    if (rulesEqual(initial, saved)) return;
    setDraft(cloneRule(initial));
    setSaved(cloneRule(initial));
    setErrors([]);
    setLive('');
    setConfirmDelete(false);
    // `saved` is intentionally not a dependency: it is the comparison baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const pending = store.pending.has(draft.id);
  const dirty = isNew || !rulesEqual(draft, saved);
  // `caps` come from the background's `getCaps` and already honour the
  // page-engine pref — the same object `compileRules` used, so this badge and
  // the list badge cannot disagree.
  const decision = useMemo(() => selectEngine(draft, platform, caps), [draft, platform, caps]);
  const engineError = ruleErrorOf(store.applied, draft.id);
  const errs = fieldErrors(errors);
  const bodyBytes = draft.action.type === 'status' && draft.action.body ? utf8Length(draft.action.body) : 0;
  const bodyTooLarge = bodyBytes > LIMITS.bodyBytes;
  const regexSafety = draft.condition.url?.op === 'regex' && draft.condition.url.value ? checkRegexSafety(draft.condition.url.value) : { ok: true as const };
  const status2xx = draft.action.type === 'status' && draft.action.code < 400;

  function patch(fn: (d: Rule) => void): void {
    setDraft((d) => {
      const next = cloneRule(d);
      fn(next);
      return next;
    });
  }

  async function save(): Promise<void> {
    const v = validateRule(draft);
    if (!v.rule) {
      setErrors(v.errors);
      setLive('');
      return;
    }
    setErrors([]);
    setLive(t('edSaving'));
    const r = await store.saveRule(v.rule);
    if (r.ok) {
      setSaved(cloneRule(v.rule));
      setLive(t('edSaved'));
      onSaved(v.rule.id);
    } else {
      setErrors(r.errors);
      setLive('');
    }
  }

  // Ctrl/⌘+S saves (design §9.3).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  async function runTest(): Promise<void> {
    const url = test.url.trim();
    if (!url) return;
    const c = draft.condition;
    const msg: Parameters<typeof sendQuery<'testUrl'>>[0] = { type: 'testUrl', url };
    if (c.methods?.[0]) msg.method = c.methods[0];
    if (c.resourceTypes?.[0]) msg.resourceType = c.resourceTypes[0];
    if (c.pageDomains?.[0]) msg.pageDomain = c.pageDomains[0];
    if (tabId !== undefined) msg.tabId = tabId;
    const result = await sendQuery(msg);
    setTest({ url, result: result && 'matches' in result ? result : null });
  }

  const name = ruleDisplayName(t, draft);
  const showNoAccessNote = platform === 'chrome' && decision.engine === 'page' && origins !== null && origins.length === 0;
  const showSomeAccessNote = platform === 'chrome' && decision.engine === 'page' && origins !== null && origins.length > 0;

  return (
    <form
      ref={formRef}
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      aria-label={name}
    >
      <div className="editor__head">
        {onBack ? (
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onBack}>
            ← {t('tabRules')}
          </button>
        ) : null}
        <input
          className="editor__name"
          value={draft.name}
          maxLength={LIMITS.nameLength}
          placeholder={t('edNamePlaceholder')}
          aria-label={t('edName')}
          aria-invalid={errs.has('name') || undefined}
          onChange={(e) => patch((d) => (d.name = e.target.value))}
        />
        <label className="check">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => patch((d) => (d.enabled = e.target.checked))} />
          {t('edEnabled')}
        </label>
      </div>

      {/* ---- live engine badge + honesty (design §2.4, §6) ---- */}
      <div className="editor__engine" data-testid="engine-line">
        <span className="editor__engine-label">{t('edEngine')}:</span>
        <EngineBadge engine={decision.engine} degraded={!!decision.degraded} inactive={!!decision.unsupported} />
        <label className="field">
          <span className="sr-only">{t('edEnginePref')}</span>
          <select
            value={draft.engine ?? 'auto'}
            aria-label={t('edEnginePref')}
            onChange={(e) => patch((d) => (d.engine = e.target.value as EnginePreference))}
          >
            {ENGINE_PREFS.filter((p) => p === 'auto' || (platform === 'firefox' ? p === 'webrequest' : p !== 'webrequest')).map((p) => (
              <option key={p} value={p}>
                {p === 'auto' ? t('edAuto') : p}
              </option>
            ))}
          </select>
        </label>
      </div>
      <HonestyNotes keys={[...decision.reasons, ...(decision.degraded ? [decision.degraded] : [])]} className="editor__honesty" />

      {decision.unsupported ? (
        <div className="ui-callout ui-callout--warn card-unsupported" role="note" data-testid="unsupported-card">
          <p className="ui-callout__title">
            ○ {t('edEngineUnavailableTitle')}
          </p>
          <div className="ui-callout__body">
            <p>{t(honestyKey(decision.unsupported))}</p>
            {draft.action.type !== 'block' ? (
              <button type="button" className="ui-btn ui-btn--sm" onClick={() => patch((d) => (d.action = { type: 'block' }))}>
                {t('edReplaceWithBlock')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showNoAccessNote ? <p className="fine warn">{t('edNoSiteAccess')}</p> : null}
      {showSomeAccessNote ? <p className="fine">{t('edNoSiteAccessSome', { list: origins!.join(', ') })}</p> : null}

      {/* ---- §5.7: browser rejection, verbatim + translation ---- */}
      {engineError ? (
        <div className="ui-callout ui-callout--poor" role="alert">
          <p className="ui-callout__title">⚠ {t('errBrowserSaid')}</p>
          <div className="ui-callout__body">
            <code className="mono">{engineError}</code>
            <p>{t(translateEngineError(engineError))}</p>
          </div>
        </div>
      ) : null}

      {/* ================= CONDITION ================= */}
      <fieldset className="section">
        <legend className="ui-section-heading">{t('edSectionCondition')}</legend>
        <div className="row row--gap">
          <label className="field">
            {t('edUrl')}
            <select
              value={draft.condition.url?.op ?? 'contains'}
              aria-label={t('edUrl')}
              onChange={(e) => patch((d) => (d.condition.url = { ...(d.condition.url ?? { value: '' }), op: e.target.value as UrlOp }))}
            >
              {URL_OPS.map((o) => (
                <option key={o.op} value={o.op}>
                  {t(o.key)}
                </option>
              ))}
            </select>
          </label>
          <input
            className="grow mono"
            data-testid="url-value"
            value={draft.condition.url?.value ?? ''}
            placeholder={t('edUrlPlaceholder')}
            aria-label={t('edUrl')}
            aria-invalid={errs.has('condition.url.value') || !regexSafety.ok || undefined}
            aria-describedby="url-hint"
            maxLength={LIMITS.urlValueLength}
            onChange={(e) => patch((d) => (d.condition.url = { ...(d.condition.url ?? { op: 'contains' }), value: e.target.value }))}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={draft.condition.url?.caseSensitive ?? false}
              onChange={(e) => patch((d) => (d.condition.url = { ...(d.condition.url ?? { op: 'contains', value: '' }), caseSensitive: e.target.checked || undefined }))}
            />
            {t('edCaseSensitive')}
          </label>
        </div>
        <p id="url-hint" className="fine">
          {errs.get('condition.url.value') ?? errs.get('condition.url') ?? (!regexSafety.ok ? regexSafety.reason : draft.condition.url?.op === 'wildcard' ? t('edWildcardHint') : '')}
        </p>

        <div className="row row--gap">
          <span className="field">{t('edMethod')}</span>
          <div className="chips" role="group" aria-label={t('edMethod')}>
            {HTTP_METHODS.map((m) => {
              const on = draft.condition.methods?.includes(m) ?? false;
              return (
                <button
                  key={m}
                  type="button"
                  className={`chip${on ? ' chip--active' : ''}`}
                  aria-pressed={on}
                  onClick={() =>
                    patch((d) => {
                      const set = new Set<HttpMethod>(d.condition.methods ?? []);
                      if (set.has(m)) set.delete(m);
                      else set.add(m);
                      d.condition.methods = set.size ? HTTP_METHODS.filter((x) => set.has(x)) : undefined;
                    })
                  }
                >
                  {m}
                </button>
              );
            })}
            <span className="fine">{draft.condition.methods?.length ? '' : t('edAnyMethod')}</span>
          </div>
        </div>

        <div className="row row--gap">
          <span className="field">{t('edType')}</span>
          <div className="chips" role="group" aria-label={t('edType')}>
            {RESOURCE_KINDS.map((k) => {
              const on = draft.condition.resourceTypes?.includes(k) ?? false;
              return (
                <button
                  key={k}
                  type="button"
                  className={`chip${on ? ' chip--active' : ''}`}
                  aria-pressed={on}
                  data-testid={`type-${k}`}
                  onClick={() =>
                    patch((d) => {
                      const set = new Set<ResourceKind>(d.condition.resourceTypes ?? []);
                      if (set.has(k)) set.delete(k);
                      else set.add(k);
                      d.condition.resourceTypes = set.size ? RESOURCE_KINDS.filter((x) => set.has(x)) : undefined;
                    })
                  }
                >
                  {k === 'xhr' ? 'xhr/fetch' : k}
                </button>
              );
            })}
            <span className="fine">{draft.condition.resourceTypes?.length ? '' : t('edTypeAll')}</span>
          </div>
        </div>

        <label className="field field--block">
          {t('edPageDomain')}
          <input
            className="mono"
            value={(draft.condition.pageDomains ?? []).join(', ')}
            placeholder="shop.example.com"
            aria-invalid={errs.has('condition.pageDomains') || undefined}
            onChange={(e) =>
              patch((d) => {
                const list = e.target.value
                  .split(',')
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean)
                  .slice(0, LIMITS.pageDomains);
                d.condition.pageDomains = list.length ? list : undefined;
              })
            }
          />
          <span className="fine">{errs.get('condition.pageDomains') ?? t('edPageDomainHint')}</span>
        </label>

        <details className="response" open={!!draft.condition.responseStatus || !!draft.condition.responseHeaders?.length}>
          <summary>{t('edResponse')}</summary>
          <label className="field field--block">
            {t('edResponseStatus')}
            <input
              className="mono"
              data-testid="response-status"
              value={draft.condition.responseStatus ?? ''}
              placeholder="5xx"
              maxLength={LIMITS.statusPatternLength}
              aria-invalid={errs.has('condition.responseStatus') || undefined}
              onChange={(e) => patch((d) => (d.condition.responseStatus = e.target.value.trim() ? e.target.value : undefined))}
            />
            <span className="fine">{errs.get('condition.responseStatus') ?? t('edResponseStatusHint')}</span>
          </label>
          <div className="headers">
            <span className="field">{t('edResponseHeaders')}</span>
            {(draft.condition.responseHeaders ?? []).map((h, i) => (
              <div key={i} className="row row--gap">
                <input
                  className="mono"
                  value={h.name}
                  placeholder="content-type"
                  aria-label={t('edHeaderName')}
                  maxLength={LIMITS.headerNameLength}
                  onChange={(e) => patch((d) => (d.condition.responseHeaders![i]!.name = e.target.value))}
                />
                <select
                  value={h.op}
                  aria-label={t('edHeaderName')}
                  onChange={(e) => patch((d) => (d.condition.responseHeaders![i]!.op = e.target.value as HeaderCondition['op']))}
                >
                  {HEADER_OPS.map((op) => (
                    <option key={op} value={op}>
                      {t(op === 'exists' ? 'edHeaderExists' : op === 'equals' ? 'edHeaderEquals' : 'edHeaderContains')}
                    </option>
                  ))}
                </select>
                {h.op !== 'exists' ? (
                  <input
                    className="mono grow"
                    value={h.value ?? ''}
                    aria-label={t('edHeaderValue')}
                    maxLength={LIMITS.headerValueLength}
                    onChange={(e) => patch((d) => (d.condition.responseHeaders![i]!.value = e.target.value))}
                  />
                ) : null}
                <button
                  type="button"
                  className="ui-btn ui-btn--sm ui-btn--ghost"
                  onClick={() =>
                    patch((d) => {
                      d.condition.responseHeaders!.splice(i, 1);
                      if (d.condition.responseHeaders!.length === 0) d.condition.responseHeaders = undefined;
                    })
                  }
                >
                  {t('edRemove')}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="ui-btn ui-btn--sm"
              disabled={(draft.condition.responseHeaders?.length ?? 0) >= LIMITS.headerConditions}
              onClick={() => patch((d) => (d.condition.responseHeaders = [...(d.condition.responseHeaders ?? []), { name: '', op: 'exists' }]))}
            >
              {t('edAddHeader')}
            </button>
            {errs.has('condition.responseHeaders') ? <p className="fine warn">{errs.get('condition.responseHeaders')}</p> : null}
            {platform === 'chrome' && !caps.dnrResponseHeaders && (draft.condition.responseHeaders?.length ?? 0) > 0 ? (
              <p className="fine">{t(honestyKey('dnrHeadersUnsupported'))}</p>
            ) : null}
            {(draft.condition.responseHeaders?.length ?? 0) > 0 ? <p className="fine">{t(honestyKey('dnrHeadersHalfBlock'))}</p> : null}
          </div>
        </details>
      </fieldset>

      {/* ================= STATE ================= */}
      <fieldset className="section">
        <legend className="ui-section-heading">{t('edSectionState')}</legend>
        <StateFields t={t} state={draft.state} rules={store.doc?.rules.filter((r) => r.id !== draft.id) ?? []} errs={errs} onChange={(s) => patch((d) => (d.state = s))} />
        <div className="row row--gap">
          <label className="field">
            {t('edCountKey')}
            <select value={draft.countKey} onChange={(e) => patch((d) => (d.countKey = e.target.value as Rule['countKey']))}>
              <option value="rule">{t('edCountRule')}</option>
              <option value="rule+tab">{t('edCountRuleTab')}</option>
              <option value="url">{t('edCountUrl')}</option>
            </select>
          </label>
          <label className="field">
            {t('edResetOn')}
            <select value={draft.resetOn} onChange={(e) => patch((d) => (d.resetOn = e.target.value as Rule['resetOn']))}>
              <option value="navigation">{t('edResetNavigation')}</option>
              <option value="session">{t('edResetSession')}</option>
              <option value="manual">{t('edResetManual')}</option>
            </select>
          </label>
          {!isNew && draft.state.kind !== 'every' ? (
            <button
              type="button"
              className="ui-btn ui-btn--sm"
              onClick={() => void sendQuery({ type: 'resetCounters', ruleId: draft.id }).then(() => setLive(t('edCountersReset')))}
            >
              {t('edResetCounters')}
            </button>
          ) : null}
        </div>
        <p className="fine">{t('edCounterHint')}</p>
      </fieldset>

      {/* ================= ACTION ================= */}
      <fieldset className="section">
        <legend className="ui-section-heading">{t('edSectionAction')}</legend>
        <ActionFields t={t} action={draft.action} errs={errs} onChange={(a) => patch((d) => (d.action = a))} />
        {bodyTooLarge ? (
          <p className="fine warn" role="alert">
            {t('edBodyTooLarge', { size: Math.ceil(bodyBytes / 1024) })}
          </p>
        ) : null}
        {draft.action.type === 'status' && draft.action.contentType === 'text/html' ? <p className="fine">{t('edBodyHtmlNote')}</p> : null}
        {status2xx ? (
          <p className="fine warn" data-testid="hint-2xx">
            {t(honestyKey('status2xxIsMock'))}
          </p>
        ) : null}
        {platform === 'firefox' && draft.action.type === 'fail' ? <p className="fine">{t(honestyKey('ffFailCancel'))}</p> : null}
        {platform === 'firefox' && draft.action.type === 'status' ? <p className="fine">{t(honestyKey('ffStatusCancel'))}</p> : null}
      </fieldset>

      {/* ================= SCOPE ================= */}
      <fieldset className="section">
        <legend className="ui-section-heading">{t('edSectionScope')}</legend>
        <div className="row row--gap" role="radiogroup" aria-label={t('edSectionScope')}>
          <label className="check">
            <input type="radio" name="scope" checked={draft.scope === 'all'} onChange={() => patch((d) => (d.scope = 'all'))} />
            {t('edScopeAll')}
          </label>
          <label className="check">
            <input type="radio" name="scope" checked={draft.scope === 'activeTab'} onChange={() => patch((d) => (d.scope = 'activeTab'))} />
            {t('edScopeActive')}
          </label>
        </div>
      </fieldset>

      {/* ================= TEST URL ================= */}
      <fieldset className="section">
        <legend className="ui-section-heading">{t('edSectionTest')}</legend>
        <div className="row row--gap">
          <input
            className="grow mono"
            type="url"
            value={test.url}
            placeholder={t('edTestPlaceholder')}
            aria-label={t('edSectionTest')}
            onChange={(e) => setTest({ url: e.target.value, result: null })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void runTest();
              }
            }}
          />
          <button type="button" className="ui-btn ui-btn--sm" onClick={() => void runTest()}>
            {t('edTest')}
          </button>
        </div>
        {dirty ? <p className="fine">{t('edTestUnsaved')}</p> : null}
        {test.result ? (
          <p className="fine mono" data-testid="test-result">
            {!test.result.first
              ? t('edTestNoMatch')
              : test.result.first.rule.id === draft.id
                ? t('edTestMatch', { engine: test.result.first.decision.engine ?? t('engineNone') })
                : t('edTestMatchOther', {
                    name: ruleDisplayName(t, test.result.first.rule),
                    engine: test.result.first.decision.engine ?? t('engineNone'),
                  })}
          </p>
        ) : null}
      </fieldset>

      {/* ================= FOOTER ================= */}
      {errors.length > 0 ? (
        <div className="ui-callout ui-callout--poor" role="alert">
          <p className="ui-callout__title">{t('edSaveRejected')}</p>
          <ul className="ui-callout__body">
            {errors.map((e, i) => (
              <li key={i}>
                <code className="mono">{e.path || e.where}</code> — {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="editor__foot">
        <output className="fine editor__live" aria-live="polite" data-testid="live">
          {live}
        </output>
        <span className="fine">{dirty && !pending ? t('edUnsaved') + ' · ' : ''}{t('edShortcut')}</span>
        <span className="grow" />
        {!isNew ? (
          confirmDelete ? (
            <>
              <span className="fine">{t('edDeleteConfirm', { name })}</span>
              <button type="button" className="ui-btn ui-btn--sm" onClick={() => setConfirmDelete(false)}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className="ui-btn ui-btn--sm btn-danger"
                onClick={() =>
                  void store.deleteRule(draft.id).then((r) => {
                    // Refused (another rule follows this one): show why, stay here.
                    if (r.ok) onDeleted();
                    else {
                      setErrors(r.errors);
                      setConfirmDelete(false);
                    }
                  })
                }
              >
                {t('delete')}
              </button>
            </>
          ) : (
            <button type="button" className="ui-btn ui-btn--ghost" onClick={() => setConfirmDelete(true)}>
              {t('delete')}
            </button>
          )
        ) : null}
        <button type="submit" className="ui-btn ui-btn--primary" disabled={pending || bodyTooLarge} data-testid="save-rule">
          {pending ? t('edSaving') : t('save')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------- STATE ---------------------------------- */

function StateFields({
  t,
  state,
  rules,
  errs,
  onChange,
}: {
  t: TFn;
  state: State;
  rules: Rule[];
  errs: Map<string, string>;
  onChange: (s: State) => void;
}) {
  const k = state.kind;
  const radio = (kind: State['kind'], make: () => State) => (
    <input type="radio" name="state" checked={k === kind} data-testid={`state-${kind}`} onChange={() => onChange(make())} />
  );
  return (
    <div className="state" role="radiogroup" aria-label={t('edSectionState')}>
      <label className="check">
        {radio('every', () => ({ kind: 'every' }))}
        {t('edStateEvery')}
      </label>
      <label className="check">
        {radio('once', () => ({ kind: 'once' }))}
        {t('edStateOnce')}
      </label>
      <label className="check">
        {radio('times', () => ({ kind: 'times', n: 3 }))}
        {t('edStateTimes')}
        <input type="number" min={1} max={LIMITS.counter} value={k === 'times' ? state.n : 3} disabled={k !== 'times'} onChange={(e) => onChange({ kind: 'times', n: num(e.target.value, 1) })} />
        {t('edTimesSuffix')}
      </label>
      <label className="check">
        {radio('nth', () => ({ kind: 'nth', n: 3 }))}
        {t('edStateNth')}
        <input
          type="number"
          min={1}
          max={LIMITS.counter}
          data-testid="nth-n"
          value={k === 'nth' ? state.n : 3}
          disabled={k !== 'nth'}
          onChange={(e) => onChange({ kind: 'nth', n: num(e.target.value, 1), ...(k === 'nth' && state.every ? { every: true } : {}) })}
        />
        <input
          type="checkbox"
          checked={k === 'nth' && !!state.every}
          disabled={k !== 'nth'}
          aria-label={t('edStateNthEvery')}
          onChange={(e) => onChange({ kind: 'nth', n: k === 'nth' ? state.n : 3, ...(e.target.checked ? { every: true } : {}) })}
        />
        {t('edStateNthEvery')}
      </label>
      <label className="check">
        {radio('skipFirst', () => ({ kind: 'skipFirst', skip: 2 }))}
        {t('edStateSkipFirst')}
        <input
          type="number"
          min={0}
          max={LIMITS.counter}
          value={k === 'skipFirst' ? state.skip : 2}
          disabled={k !== 'skipFirst'}
          onChange={(e) => onChange({ kind: 'skipFirst', skip: num(e.target.value, 0), ...(k === 'skipFirst' && state.times !== undefined ? { times: state.times } : {}) })}
        />
        {t('edStateSkipThen')}
        <input
          type="number"
          min={1}
          max={LIMITS.counter}
          value={k === 'skipFirst' && state.times !== undefined ? state.times : ''}
          disabled={k !== 'skipFirst'}
          aria-label={t('edStateSkipForever')}
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange({ kind: 'skipFirst', skip: k === 'skipFirst' ? state.skip : 2, ...(v ? { times: num(v, 1) } : {}) });
          }}
        />
        {t('edStateSkipForever')}
      </label>
      <label className="check">
        {radio('probability', () => ({ kind: 'probability', percent: 30, seed: newSeed() }))}
        {t('edStateProbability')}
        <input
          type="number"
          min={0}
          max={100}
          value={k === 'probability' ? state.percent : 30}
          disabled={k !== 'probability'}
          onChange={(e) => onChange({ kind: 'probability', percent: Math.min(100, Math.max(0, num(e.target.value, 30))), seed: k === 'probability' ? state.seed : newSeed() })}
        />
        % · {t('edSeed')}
        <input
          type="number"
          min={0}
          className="seed"
          value={k === 'probability' ? state.seed : ''}
          disabled={k !== 'probability'}
          aria-label={t('edSeed')}
          onChange={(e) => onChange({ kind: 'probability', percent: k === 'probability' ? state.percent : 30, seed: Math.max(0, num(e.target.value, 0)) })}
        />
      </label>
      {k === 'probability' ? <p className="fine state__note">{t(honestyKey('seedSameOrder'))}</p> : null}
      <label className="check">
        {radio('window', () => ({ kind: 'window', trigger: 'click', seconds: 30 }))}
        {t('edStateWindow')}
        <select
          value={k === 'window' ? state.trigger : 'click'}
          disabled={k !== 'window'}
          aria-label={t('edStateWindow')}
          onChange={(e) => onChange({ kind: 'window', trigger: e.target.value as 'navigation' | 'click' | 'manual', seconds: k === 'window' ? state.seconds : 30 })}
        >
          <option value="navigation">{t('edTriggerNavigation')}</option>
          <option value="click">{t('edTriggerClick')}</option>
          <option value="manual">{t('edTriggerManual')}</option>
        </select>
        {t('edWindowFor')}
        <input
          type="number"
          min={1}
          max={LIMITS.windowSeconds}
          value={k === 'window' ? state.seconds : 30}
          disabled={k !== 'window'}
          onChange={(e) => onChange({ kind: 'window', trigger: k === 'window' ? state.trigger : 'click', seconds: num(e.target.value, 30) })}
        />
        {t('edSeconds')}
      </label>
      <label className="check">
        {radio('afterRule', () => ({ kind: 'afterRule', ruleId: rules[0]?.id ?? '' }))}
        {t('edStateAfterRule')}
        <select
          value={k === 'afterRule' ? state.ruleId : ''}
          disabled={k !== 'afterRule'}
          aria-label={t('edStateAfterRule')}
          aria-invalid={errs.has('state.ruleId') || undefined}
          onChange={(e) => onChange({ kind: 'afterRule', ruleId: e.target.value })}
        >
          <option value="">{t('edPickRule')}</option>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {ruleDisplayName(t, r)}
            </option>
          ))}
        </select>
      </label>
      {errs.has('state.ruleId') || errs.has('state') ? <p className="fine warn">{errs.get('state.ruleId') ?? errs.get('state')}</p> : null}
    </div>
  );
}

/* ------------------------------- ACTION --------------------------------- */

function ActionFields({ t, action, errs, onChange }: { t: TFn; action: Action; errs: Map<string, string>; onChange: (a: Action) => void }) {
  const k = action.type;
  const radio = (type: Action['type'], make: () => Action) => (
    <input type="radio" name="action" checked={k === type} data-testid={`action-${type}`} onChange={() => onChange(make())} />
  );
  return (
    <div className="action" role="radiogroup" aria-label={t('edSectionAction')}>
      <label className="check">
        {radio('block', () => ({ type: 'block' }))}
        {t('edActionBlock')}
      </label>
      <label className="check">
        {radio('fail', () => ({ type: 'fail', reason: 'Failed' }))}
        {t('edActionFail')}
        <select value={k === 'fail' ? action.reason : 'Failed'} disabled={k !== 'fail'} aria-label={t('edActionFail')} onChange={(e) => onChange({ type: 'fail', reason: e.target.value as FailureReason })}>
          {FAILURE_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        {radio('delay', () => ({ type: 'delay', ms: 3000 }))}
        {t('edActionDelay')}
        <input
          type="number"
          min={0}
          max={LIMITS.delayMs}
          value={k === 'delay' ? action.ms : 3000}
          disabled={k !== 'delay'}
          aria-invalid={errs.has('action.ms') || undefined}
          onChange={(e) => onChange({ type: 'delay', ms: Math.min(LIMITS.delayMs, Math.max(0, num(e.target.value, 3000))) })}
        />
        {t('edMs')}
      </label>
      <label className="check">
        {radio('status', () => ({ type: 'status', code: 503 }))}
        {t('edActionStatus')}
        <input
          type="number"
          min={STATUS_CODE_MIN}
          max={STATUS_CODE_MAX}
          data-testid="status-code"
          value={k === 'status' ? action.code : 503}
          disabled={k !== 'status'}
          aria-label={t('edStatusCode')}
          aria-invalid={errs.has('action.code') || undefined}
          onChange={(e) => onChange({ ...(k === 'status' ? action : { type: 'status' as const, code: 503 }), code: num(e.target.value, 503) })}
        />
      </label>
      {k === 'status' ? (
        <div className="body">
          <label className="check">
            <input
              type="checkbox"
              checked={action.body !== undefined}
              onChange={(e) => {
                if (e.target.checked) onChange({ ...action, body: action.body ?? '{"error":"chaos"}', contentType: action.contentType ?? 'application/json' });
                else onChange({ type: 'status', code: action.code });
              }}
            />
            {t('edWithBody')}
          </label>
          {action.body !== undefined ? (
            <>
              <label className="field">
                {t('edBodyType')}
                <select value={action.contentType ?? 'application/json'} onChange={(e) => onChange({ ...action, contentType: e.target.value as BodyContentType })}>
                  {BODY_CONTENT_TYPES.map((ct) => (
                    <option key={ct} value={ct}>
                      {ct}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                className="mono body__text"
                rows={5}
                value={action.body}
                aria-label={t('edWithBody')}
                aria-invalid={errs.has('action.body') || errs.has('action.contentType') || undefined}
                onChange={(e) => onChange({ ...action, body: e.target.value })}
              />
              {errs.has('action.body') || errs.has('action.contentType') ? <p className="fine warn">{errs.get('action.body') ?? errs.get('action.contentType')}</p> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
