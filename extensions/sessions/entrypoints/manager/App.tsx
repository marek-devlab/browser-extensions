import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Callout,
  LanguageSwitcher,
  LocaleProvider,
  ThemeToggle,
  type Locale,
} from '@blur/ui';
import { useSettings, useSessionsLocale, useThemeSetter } from '../../utils/settings';
import { useT, type TT } from '../../utils/i18n';
import { restoreSession, type RestoreMode } from '../../utils/restore';
import {
  deleteSession,
  estimateUsage,
  readIndex,
  readSession,
  renameSession,
  saveSession,
} from '../../utils/storage';
import { sessionBytes, tabCount, type SavedSession, type SavedTab } from '../../utils/model';
import { hasPermission, requestPermission } from '../../utils/permissions';
import { buildExport, downloadText, exportFilename, importFromText, readFileAsText } from '../../utils/transfer';
import { formatBytes, tabsLabel, windowsLabel } from '../../utils/format';

// FULL MANAGER (design §14): search across saved tabs, rename, delete with UNDO,
// per-session size/tab indicators, restore options, local export/import, the
// behaviour + appearance settings, and the storage/quota upgrade. Opens in its own
// tab from the popup. 🔴 Still local-only — the trust callout says so explicitly.

export function App() {
  const { locale, setLocale } = useSessionsLocale();
  return (
    <LocaleProvider locale={locale}>
      <ManagerApp locale={locale} setLocale={setLocale} />
    </LocaleProvider>
  );
}

interface UndoState {
  session: SavedSession;
  timer: ReturnType<typeof setTimeout>;
}

function ManagerApp({ locale, setLocale }: { locale: Locale; setLocale: (l: Locale) => void }) {
  const t = useT();
  const { settings, update } = useSettings();
  const { theme, setTheme } = useThemeSetter(settings, update);

  const [sessions, setSessions] = useState<SavedSession[] | null>(null);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [usage, setUsage] = useState<{ bytes: number; quota: number } | null>(null);
  const [unlimited, setUnlimited] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const index = await readIndex();
    const loaded: SavedSession[] = [];
    for (const meta of index.order) {
      const s = await readSession(meta.id); // quarantines corrupt keys internally
      if (s) loaded.push(s);
    }
    setSessions(loaded);
    setUsage(await estimateUsage());
  }, []);

  useEffect(() => {
    void reload();
    void hasPermission('unlimitedStorage').then(setUnlimited);
  }, [reload]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  const onRestore = useCallback(
    async (session: SavedSession, mode: RestoreMode) => {
      const res = await restoreSession(session, {
        mode,
        lazy: settings?.lazyRestore ?? true,
        restoreGroups: settings?.restoreGroups ?? true,
      });
      const tabs = tabsLabel(t, res.tabsRestored);
      const wins = windowsLabel(t, res.windowsRestored);
      flash(
        res.tabsFailed > 0
          ? t('restoredWithFails', { tabs, windows: wins, failed: res.tabsFailed })
          : t('restoredToast', { tabs, windows: wins }),
      );
    },
    [settings?.lazyRestore, settings?.restoreGroups, t, flash],
  );

  const onRename = useCallback(
    async (id: string, name: string) => {
      await renameSession(id, name);
      await reload();
    },
    [reload],
  );

  const onDelete = useCallback(
    (session: SavedSession) => {
      // Optimistically drop it from the list and storage, but keep a copy for UNDO.
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== session.id) : prev));
      void deleteSession(session.id);
      if (undo) clearTimeout(undo.timer);
      const timer = setTimeout(() => setUndo(null), 6000);
      setUndo({ session, timer });
      flash(t('deletedToast', { name: session.name }));
    },
    [undo, t, flash],
  );

  const onUndo = useCallback(async () => {
    if (!undo) return;
    clearTimeout(undo.timer);
    await saveSession(undo.session);
    setUndo(null);
    await reload();
  }, [undo, reload]);

  const onExport = useCallback(async () => {
    const json = await buildExport();
    downloadText(exportFilename(), json, 'application/json');
  }, []);

  const onImportFile = useCallback(
    async (file: File) => {
      const text = await readFileAsText(file);
      const res = await importFromText(text);
      if (res.imported === 0 && res.skipped === 0) flash(t('importEmpty'));
      else flash(t('importedToast', { imported: res.imported, skipped: res.skipped }));
      await reload();
    },
    [t, flash, reload],
  );

  const onUpgradeStorage = useCallback(async () => {
    const ok = await requestPermission('unlimitedStorage');
    setUnlimited(ok);
    flash(ok ? t('storageUpgraded') : t('storageUpgradeDenied'));
  }, [t, flash]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!sessions) return [];
    if (!q) return sessions.map((s) => ({ session: s, matches: null as SavedTab[] | null }));
    const out: { session: SavedSession; matches: SavedTab[] }[] = [];
    for (const s of sessions) {
      const matches: SavedTab[] = [];
      for (const w of s.windows) {
        for (const tab of w.tabs) {
          if (tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q)) {
            matches.push(tab);
          }
        }
      }
      if (matches.length) out.push({ session: s, matches });
    }
    return out;
  }, [sessions, q]);

  if (!settings || sessions === null) {
    return (
      <main className="mgr">
        <p role="status" aria-live="polite">
          <span className="ui-spinner" aria-hidden="true" /> {t('loading')}
        </p>
      </main>
    );
  }

  return (
    <main className="mgr">
      <header className="mgr__head">
        <h1>{t('managerTitle')}</h1>
        <div className="mgr__headctl">
          <ThemeToggle theme={theme} onChange={setTheme} />
        </div>
      </header>

      <Callout tone="info">{t('trustCallout')}</Callout>

      {toast && (
        <div className="mgr__toast" role="status" aria-live="polite">
          <span>{toast}</span>
          {undo && (
            <button type="button" className="ui-btn ui-btn--sm" onClick={() => void onUndo()}>
              {t('undo')}
            </button>
          )}
        </div>
      )}

      <div className="mgr__toolbar">
        <input
          type="search"
          className="mgr__search"
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchAria')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <section className="mgr__sessions" aria-label={t('sessionsHeading')}>
        {filtered.length === 0 ? (
          q ? (
            <p className="mgr__empty">{t('searchNoMatch', { q: query })}</p>
          ) : (
            <div className="ui-empty">
              <p className="ui-empty__title">{t('emptyManager')}</p>
              <p className="ui-empty__hint">{t('emptyManagerHint')}</p>
            </div>
          )
        ) : (
          filtered.map(({ session, matches }) => (
            <SessionCard
              key={session.id}
              session={session}
              matches={matches}
              t={t}
              onRestore={onRestore}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))
        )}
      </section>

      <section className="mgr__panel">
        <h2>{t('dataTitle')}</h2>
        <div className="mgr__row">
          <button type="button" className="ui-btn ui-btn--sm" onClick={() => void onExport()}>
            {t('exportAll')}
          </button>
          <button type="button" className="ui-btn ui-btn--sm" onClick={() => fileRef.current?.click()}>
            {t('importFile')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImportFile(file);
              e.target.value = '';
            }}
          />
        </div>
        <p className="mgr__hint">{t('exportHint')}</p>
      </section>

      <section className="mgr__panel">
        <h2>{t('appearance')}</h2>
        <Row label={t('theme')}>
          <ThemeToggle theme={theme} onChange={setTheme} />
        </Row>
        <Row label={t('language')}>
          <LanguageSwitcher locale={locale} onChange={setLocale} label={t('langSwitcherLabel')} />
        </Row>
      </section>

      <section className="mgr__panel">
        <h2>{t('behaviour')}</h2>
        <Toggle
          checked={settings.autoSaveEnabled}
          label={t('autoSaveLabel')}
          hint={t('autoSaveHint')}
          onChange={(v) => update({ autoSaveEnabled: v })}
        />
        <Toggle
          checked={settings.lazyRestore}
          label={t('lazyRestoreLabel')}
          hint={t('lazyRestoreHint')}
          onChange={(v) => update({ lazyRestore: v })}
        />
        <Toggle
          checked={settings.dedupeOnSave}
          label={t('dedupeLabel')}
          hint={t('dedupeHint')}
          onChange={(v) => update({ dedupeOnSave: v })}
        />
        <Toggle
          checked={settings.restoreGroups}
          label={t('restoreGroupsLabel')}
          hint={t('restoreGroupsHint')}
          onChange={(v) => update({ restoreGroups: v })}
        />
      </section>

      <section className="mgr__panel">
        <h2>{t('storageTitle')}</h2>
        {usage && (
          <p className="mgr__hint">
            {t('storageUsage', { used: formatBytes(usage.bytes), quota: formatBytes(usage.quota) })}
          </p>
        )}
        {!unlimited && (
          <>
            <button type="button" className="ui-btn ui-btn--sm" onClick={() => void onUpgradeStorage()}>
              {t('upgradeStorage')}
            </button>
            <p className="mgr__hint">{t('upgradeStorageHint')}</p>
          </>
        )}
        <p className="mgr__version">{t('version')}</p>
      </section>
    </main>
  );
}

function SessionCard({
  session,
  matches,
  t,
  onRestore,
  onRename,
  onDelete,
}: {
  session: SavedSession;
  matches: SavedTab[] | null;
  t: TT;
  onRestore: (s: SavedSession, mode: RestoreMode) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (s: SavedSession) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(session.name);

  const groups = session.windows.reduce((n, w) => n + (w.groups?.length ?? 0), 0);
  const hasContainers = session.windows.some((w) => w.tabs.some((tb) => tb.cookieStoreId));
  const bytes = sessionBytes(session);
  const tabsToShow = matches ?? session.windows.flatMap((w) => w.tabs);

  return (
    <article className="card">
      <div className="card__head">
        <div className="card__title">
          {editing ? (
            <span className="card__rename">
              <input
                className="card__renameinput"
                aria-label={t('renameAria')}
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onRename(session.id, name);
                    setEditing(false);
                  } else if (e.key === 'Escape') {
                    setName(session.name);
                    setEditing(false);
                  }
                }}
              />
              <button
                type="button"
                className="ui-btn ui-btn--sm"
                onClick={() => {
                  onRename(session.id, name);
                  setEditing(false);
                }}
              >
                {t('renameSave')}
              </button>
              <button
                type="button"
                className="ui-btn ui-btn--ghost ui-btn--sm"
                onClick={() => {
                  setName(session.name);
                  setEditing(false);
                }}
              >
                {t('renameCancel')}
              </button>
            </span>
          ) : (
            <button type="button" className="card__name" onClick={() => setEditing(true)} title={t('rename')}>
              {session.name}
            </button>
          )}
        </div>
        <div className="card__meta">
          <span>{tabsLabel(t, tabCount(session))}</span>
          {session.windows.length > 1 && <span>{windowsLabel(t, session.windows.length)}</span>}
          <span>{formatBytes(bytes)}</span>
          {session.kind === 'autosave' && <span className="ui-badge ui-badge--info">{t('kindAutosave')}</span>}
          {groups > 0 && <span className="ui-badge ui-badge--info">{t('groupsBadge', { n: groups })}</span>}
          {hasContainers && <span className="ui-badge ui-badge--info">{t('containerBadge')}</span>}
        </div>
      </div>

      <div className="card__actions">
        <span className="card__restore">
          <span className="card__restorelabel">{t('restoreOptionsTitle')}:</span>
          <button type="button" className="ui-btn ui-btn--sm ui-btn--primary" onClick={() => onRestore(session, 'newWindow')}>
            {t('optNewWindow')}
          </button>
          <button type="button" className="ui-btn ui-btn--sm" onClick={() => onRestore(session, 'current')}>
            {t('optCurrent')}
          </button>
        </span>
        <span className="card__manage">
          {!editing && (
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setEditing(true)}>
              {t('rename')}
            </button>
          )}
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('collapse') : t('expand')}
          </button>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm card__del" onClick={() => onDelete(session)}>
            {t('del')}
          </button>
        </span>
      </div>

      {matches && <p className="card__matches">{t('matchesCount', { n: matches.length })}</p>}

      {(expanded || matches) && (
        <ul className="card__tabs">
          {tabsToShow.slice(0, matches ? 50 : 200).map((tab, i) => (
            <li key={`${tab.url}-${i}`} className="card__tab">
              {tab.favIconUrl && (
                <img className="card__favicon" src={tab.favIconUrl} alt="" width={16} height={16} loading="lazy" />
              )}
              <a
                className="card__tablink"
                href={tab.url}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={t('openTabAria', { title: tab.title })}
              >
                <span className="card__tabtitle">{tab.title || tab.url}</span>
                <span className="card__taburl">{tab.url}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mgr__setrow">
      <span className="mgr__setlabel">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="mgr__toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        <small>{hint}</small>
      </span>
    </label>
  );
}
