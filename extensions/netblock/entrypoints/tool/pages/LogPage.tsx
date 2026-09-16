import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { downloadText, fileStamp } from '../../../utils/download';
import { EngineBadge } from '../../../utils/engine-badge';
import { translateReason, useT } from '../../../utils/i18n';
import { MARK_GLYPH, toHar, type LogEntry } from '../../../utils/log';
import { RESOURCE_KINDS, type ResourceKind, type Rule } from '../../../utils/rule-types';
import { ruleDisplayName } from '../../../utils/rule-summary';
import type { LogFeed } from '../../../utils/use-log-feed';

// Design §2.5: the extension's own request log as a `role="grid"` (§9.3) with
// tab / url / type / "only applied" filters, pause, clear and HAR export
// (Blob + <a download>, no `downloads` permission). Marks are glyphs + the
// legend line, never colour. §5.3: without site access the empty state says
// so instead of showing "0 requests".

const MENU_ACTIONS = ['block', 'rule', 'copy', 'hide'] as const;
type MenuAction = (typeof MENU_ACTIONS)[number];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function timeOf(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

export function LogPage({
  feed,
  rules,
  tabId,
  noAccess,
  version,
  onCreateRule,
}: {
  feed: LogFeed;
  rules: Rule[];
  /** From `?tab=` — the initial tab filter. */
  tabId?: number;
  /** Chrome with no granted origins (design §5.3). */
  noAccess: boolean;
  version: string;
  onCreateRule: (entry: LogEntry, blockOnly: boolean) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<number | 'all'>(tabId ?? 'all');
  const [search, setSearch] = useState('');
  const [type, setType] = useState<ResourceKind | 'all'>('all');
  const [onlyApplied, setOnlyApplied] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    if (tabId !== undefined) setTab(tabId);
  }, [tabId]);

  const ruleName = useMemo(() => new Map(rules.map((r) => [r.id, ruleDisplayName(t, r)])), [rules, t]);
  const tabs = useMemo(() => Array.from(new Set(feed.entries.map((e) => e.tabId))).sort((a, b) => a - b), [feed.entries]);

  const q = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      feed.entries
        .filter((e) => tab === 'all' || e.tabId === tab)
        .filter((e) => type === 'all' || e.type === type)
        .filter((e) => !onlyApplied || (e.ruleId && e.outcome !== 'passed' && e.outcome !== 'error'))
        .filter((e) => !q || e.url.toLowerCase().includes(q))
        .filter((e) => !hidden.has(hostOf(e.url)))
        .slice()
        .reverse(),
    [feed.entries, tab, type, onlyApplied, q, hidden],
  );

  useEffect(() => {
    if (focusId === null) return;
    gridRef.current?.querySelector<HTMLElement>(`[data-log-id="${focusId}"]`)?.focus();
  }, [focusId, rows]);

  const activeId = focusId !== null && rows.some((r) => r.id === focusId) ? focusId : (rows[0]?.id ?? null);

  function act(entry: LogEntry, action: MenuAction): void {
    setMenuFor(null);
    switch (action) {
      case 'block':
        onCreateRule(entry, true);
        break;
      case 'rule':
        onCreateRule(entry, false);
        break;
      case 'copy':
        void navigator.clipboard
          .writeText(entry.url)
          .then(() => {
            setCopied(entry.id);
            setTimeout(() => setCopied(null), 1500);
          })
          .catch(() => undefined);
        break;
      case 'hide':
        setHidden((h) => new Set([...h, hostOf(entry.url)]));
        break;
    }
  }

  function onKey(e: KeyboardEvent<HTMLTableElement>): void {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-log-id]');
    if (!row) return;
    const id = Number(row.dataset.logId);
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusId(rows[Math.min(idx + 1, rows.length - 1)]!.id);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusId(rows[Math.max(idx - 1, 0)]!.id);
        break;
      case 'Home':
        e.preventDefault();
        setFocusId(rows[0]!.id);
        break;
      case 'End':
        e.preventDefault();
        setFocusId(rows[rows.length - 1]!.id);
        break;
      case 'Enter':
      case 'ContextMenu':
        e.preventDefault();
        setMenuFor(menuFor === id ? null : id);
        break;
      case 'Escape':
        setMenuFor(null);
        break;
    }
  }

  function exportHar(): void {
    const har = toHar(rows.slice().reverse(), version || '0');
    downloadText(`request-blocker-${fileStamp()}.har`, JSON.stringify(har, null, 2), 'application/json');
  }

  const statusText = (e: LogEntry): string => {
    switch (e.outcome) {
      case 'blocked':
        return t('lgBlocked');
      case 'failed':
        return e.error ? `${t('lgFailed')} (${e.error})` : t('lgFailed');
      case 'delayed':
        return t('lgDelayed', { ms: e.delayMs ?? 0 });
      case 'error':
        // Our own reasons (watchdog) are translated; the browser's stay verbatim.
        return e.error ? translateReason(t, e.error) : '—';
      default:
        return e.status !== undefined ? String(e.status) : '—';
    }
  };

  return (
    <section className="log">
      <div className="log__bar">
        <label className="field">
          {t('lgTab')}
          <select value={tab === 'all' ? 'all' : String(tab)} onChange={(e) => setTab(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">{t('lgAllTabs')}</option>
            {tabs.map((id) => (
              <option key={id} value={String(id)}>
                #{id}
              </option>
            ))}
            {tab !== 'all' && !tabs.includes(tab) ? <option value={String(tab)}>#{tab}</option> : null}
          </select>
        </label>
        <input type="search" className="log__search mono" placeholder={t('lgSearch')} aria-label={t('lgColUrl')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="field">
          {t('lgType')}
          <select value={type} onChange={(e) => setType(e.target.value as ResourceKind | 'all')}>
            <option value="all">{t('lgTypeAll')}</option>
            {RESOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k === 'xhr' ? 'xhr/fetch' : k}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyApplied} onChange={(e) => setOnlyApplied(e.target.checked)} />
          {t('lgOnlyApplied')}
        </label>
        <span className="grow" />
        <button type="button" className="ui-btn ui-btn--sm" aria-pressed={feed.paused} onClick={() => feed.setPaused(!feed.paused)}>
          {feed.paused ? '▶ ' + t('lgResume') : '⏸ ' + t('lgPause')}
        </button>
        <button type="button" className="ui-btn ui-btn--sm" onClick={() => void feed.clear()}>
          🗑 {t('lgClear')}
        </button>
        <button type="button" className="ui-btn ui-btn--sm" onClick={exportHar} disabled={rows.length === 0} title={t('lgHarHint')}>
          {t('lgHar')}
        </button>
        <span className="fine log__count">
          {t('lgEntries', { n: rows.length })}
          {feed.evicted > 0 ? ` · ${t('lgEvicted', { n: feed.evicted })}` : ''}
        </span>
      </div>

      {hidden.size > 0 ? (
        <p className="fine">
          {t('lgHiddenDomains', { list: [...hidden].join(', ') })}{' '}
          <button type="button" className="linkish" onClick={() => setHidden(new Set())}>
            {t('lgUnhide')}
          </button>
        </p>
      ) : null}

      <output className="sr-only" aria-live="polite">
        {feed.cleared ? t('lgCleared') : ''}
      </output>

      {rows.length === 0 ? (
        <div className="ui-empty">
          <p className="ui-empty__hint" data-testid="log-empty">
            {noAccess ? t('honesty.noLogWithoutAccess') : t('lgEmpty')}
          </p>
        </div>
      ) : (
        <div className="log__scroll">
          <table ref={gridRef} className="grid" role="grid" aria-label={t('lgGridAria')} aria-rowcount={rows.length} onKeyDown={onKey}>
            <thead>
              <tr role="row">
                <th role="columnheader">{t('lgColTime')}</th>
                <th role="columnheader">{t('lgColMethod')}</th>
                <th role="columnheader">{t('lgColUrl')}</th>
                <th role="columnheader">{t('lgColType')}</th>
                <th role="columnheader">{t('lgColStatus')}</th>
                <th role="columnheader">{t('lgColRule')}</th>
                <th role="columnheader">
                  <span className="sr-only">{t('lgColActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr
                  key={e.id}
                  role="row"
                  data-log-id={e.id}
                  data-outcome={e.outcome}
                  tabIndex={activeId === e.id ? 0 : -1}
                  className={menuFor === e.id ? 'grid__row grid__row--menu' : 'grid__row'}
                  onFocus={() => setFocusId(e.id)}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    setMenuFor(e.id);
                  }}
                >
                  <td role="gridcell" className="mono" data-label={t('lgColTime')}>
                    {timeOf(e.time)}
                  </td>
                  <td role="gridcell" className="mono" data-label={t('lgColMethod')}>
                    {e.method}
                  </td>
                  <td role="gridcell" className="mono grid__url" data-label={t('lgColUrl')} title={e.url}>
                    {shortUrl(e.url)}
                  </td>
                  <td role="gridcell" data-label={t('lgColType')}>
                    {e.type}
                  </td>
                  <td role="gridcell" className="mono" data-label={t('lgColStatus')}>
                    {statusText(e)}
                    {e.marks.length ? <span className="grid__marks"> {e.marks.map((m) => MARK_GLYPH[m]).join(' ')}</span> : null}
                  </td>
                  <td role="gridcell" data-label={t('lgColRule')}>
                    {e.ruleId ? (
                      <>
                        {ruleName.get(e.ruleId) ?? e.ruleId} {e.engine ? <EngineBadge engine={e.engine} /> : null}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td role="gridcell" className="grid__actions">
                    <button
                      type="button"
                      className="ui-btn ui-btn--sm ui-btn--ghost"
                      aria-label={t('lgRowMenu')}
                      aria-haspopup="menu"
                      aria-expanded={menuFor === e.id}
                      onClick={() => setMenuFor(menuFor === e.id ? null : e.id)}
                    >
                      ⋯
                    </button>
                    {menuFor === e.id ? (
                      <div className="menu" role="menu" aria-label={t('lgRowMenu')}>
                        <button type="button" role="menuitem" className="menu__item" onClick={() => act(e, 'block')}>
                          {t('lgBlockUrl')}
                        </button>
                        <button type="button" role="menuitem" className="menu__item" onClick={() => act(e, 'rule')}>
                          {t('lgRuleFromRequest')}
                        </button>
                        <button type="button" role="menuitem" className="menu__item" onClick={() => act(e, 'copy')}>
                          {copied === e.id ? t('lgCopied') : t('lgCopyUrl')}
                        </button>
                        <button type="button" role="menuitem" className="menu__item" onClick={() => act(e, 'hide')}>
                          {t('lgHideDomain')} · {hostOf(e.url)}
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="fine">{t('lgMenuHint')}</p>
      <p className="fine" data-testid="log-legend">
        {t('lgLegend')}
      </p>
      {feed.error ? (
        <p className="fine warn" role="alert">
          {feed.error}
        </p>
      ) : null}
    </section>
  );
}
