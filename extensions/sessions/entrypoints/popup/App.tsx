import { useCallback, useEffect, useState } from 'react';
import { browser } from '#imports';
import { LocaleProvider, ThemeToggle } from '@blur/ui';
import { useSettings, useSessionsLocale, useThemeSetter } from '../../utils/settings';
import { useT, type TT } from '../../utils/i18n';
import { captureAllWindows, captureCurrentWindow } from '../../utils/capture';
import { restoreSession } from '../../utils/restore';
import {
  clearAutosave,
  readAutosave,
  readIndex,
  readSession,
  saveSession,
} from '../../utils/storage';
import { newSessionId, tabCount, type SavedSession, type SessionMeta } from '../../utils/model';
import { formatBytes, tabsLabel, windowsLabel } from '../../utils/format';

// PRIMARY surface: save the current window / all windows, see saved sessions, and
// recover the auto-saved session after a crash. Everything heavier (search, rename,
// delete/undo, export/import, settings) lives in the full manager page. 🔴 The empty
// state states the whole promise: "Everything here stays on this device."

export function App() {
  const { locale } = useSessionsLocale();
  return (
    <LocaleProvider locale={locale}>
      <PopupApp />
    </LocaleProvider>
  );
}

function PopupApp() {
  const t = useT();
  const { settings, update } = useSettings();
  const { theme, setTheme } = useThemeSetter(settings, update);

  const [list, setList] = useState<SessionMeta[] | null>(null);
  const [autosave, setAutosave] = useState<SavedSession | null>(null);
  const [autosaveDismissed, setAutosaveDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [index, auto] = await Promise.all([readIndex(), readAutosave()]);
    setList(index.order);
    setAutosave(auto && tabCount(auto) > 0 ? auto : null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const save = useCallback(
    async (scope: 'current' | 'all') => {
      setBusy(true);
      try {
        const dedupe = settings?.dedupeOnSave ?? true;
        const session =
          scope === 'current'
            ? await captureCurrentWindow({ dedupe })
            : await captureAllWindows({ dedupe });
        if (!session) {
          flash(t('saveEmpty'));
          return;
        }
        await saveSession(session);
        flash(t('savedToast', { name: session.name }));
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [settings?.dedupeOnSave, t, flash, refresh],
  );

  const doRestore = useCallback(
    async (id: string, mode: 'newWindow' | 'current') => {
      const session = id === 'autosave' ? autosave : await readSession(id);
      if (!session) return;
      setBusy(true);
      try {
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
      } finally {
        setBusy(false);
      }
    },
    [autosave, settings?.lazyRestore, settings?.restoreGroups, t, flash],
  );

  const keepAutosave = useCallback(async () => {
    if (!autosave) return;
    const copy: SavedSession = {
      ...autosave,
      id: newSessionId(),
      kind: 'manual',
      updatedAt: Date.now(),
    };
    await saveSession(copy);
    flash(t('savedToast', { name: copy.name }));
    await refresh();
  }, [autosave, t, flash, refresh]);

  const openManager = useCallback(() => {
    void browser.tabs.create({ url: browser.runtime.getURL('/manager.html') });
  }, []);

  if (!settings || list === null) {
    return (
      <div className="pop">
        <p className="pop__loading" role="status" aria-live="polite">
          <span className="ui-spinner" aria-hidden="true" /> {t('loading')}
        </p>
      </div>
    );
  }

  const showCrash = autosave && !autosaveDismissed;

  return (
    <div className="pop">
      <header className="pop__head">
        <h1>{t('appTitle')}</h1>
        <ThemeToggle theme={theme} onChange={setTheme} />
      </header>

      <div className="pop__actions">
        <button type="button" className="ui-btn ui-btn--primary" disabled={busy} onClick={() => void save('current')}>
          {busy ? t('saving') : t('saveCurrentWindow')}
        </button>
        <button type="button" className="ui-btn" disabled={busy} onClick={() => void save('all')}>
          {t('saveAllWindows')}
        </button>
      </div>

      {toast && (
        <p className="pop__toast" role="status" aria-live="polite">
          {toast}
        </p>
      )}

      {showCrash && autosave && (
        <section className="pop__crash" role="region" aria-label={t('crashTitle')}>
          <p className="pop__crashtitle">{t('crashTitle')}</p>
          <p className="pop__crashbody">
            {t('crashBody', {
              tabs: tabsLabel(t, tabCount(autosave)),
              windows: windowsLabel(t, autosave.windows.length),
            })}
          </p>
          <div className="pop__crashrow">
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--primary"
              disabled={busy}
              onClick={() => void doRestore('autosave', 'newWindow')}
            >
              {t('crashRestore')}
            </button>
            <button type="button" className="ui-btn ui-btn--sm" disabled={busy} onClick={() => void keepAutosave()}>
              {t('crashKeep')}
            </button>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setAutosaveDismissed(true)}>
              {t('crashDismiss')}
            </button>
          </div>
        </section>
      )}

      <PermissionNote t={t} />

      {list.length === 0 ? (
        <div className="ui-empty pop__empty">
          <p className="ui-empty__title">{t('noSessions')}</p>
          <p className="ui-empty__hint">{t('noSessionsHint')}</p>
        </div>
      ) : (
        <section className="pop__list" aria-label={t('recentSessions')}>
          <h2 className="pop__listhead">{t('recentSessions')}</h2>
          {list.slice(0, 8).map((m) => (
            <SessionRow key={m.id} meta={m} busy={busy} t={t} onRestore={doRestore} />
          ))}
        </section>
      )}

      <footer className="pop__foot">
        <button type="button" className="ui-btn ui-btn--sm" onClick={openManager}>
          {t('openManager')}
        </button>
        <span className="pop__footnote">{t('localOnly')}</span>
      </footer>
    </div>
  );
}

function SessionRow({
  meta,
  busy,
  t,
  onRestore,
}: {
  meta: SessionMeta;
  busy: boolean;
  t: TT;
  onRestore: (id: string, mode: 'newWindow' | 'current') => void;
}) {
  return (
    <div className="srow">
      <div className="srow__info">
        <span className="srow__name">{meta.name}</span>
        <span className="srow__meta">
          {tabsLabel(t, meta.tabCount)}
          {meta.windowCount > 1 ? ` · ${windowsLabel(t, meta.windowCount)}` : ''}
          {` · ${formatBytes(meta.bytes)}`}
          {meta.kind === 'autosave' ? ` · ${t('kindAutosave')}` : ''}
        </span>
      </div>
      <div className="srow__actions">
        <button
          type="button"
          className="ui-btn ui-btn--sm"
          disabled={busy}
          title={t('restoreNewWindow')}
          onClick={() => onRestore(meta.id, 'newWindow')}
        >
          {t('restore')}
        </button>
        <button
          type="button"
          className="ui-btn ui-btn--ghost ui-btn--sm"
          disabled={busy}
          title={t('restoreHere')}
          onClick={() => onRestore(meta.id, 'current')}
        >
          +
        </button>
      </div>
    </div>
  );
}

/** The honest permission microcopy behind a `?` (design §14.1) — uses the native
 *  Popover API, same as whoami's explainers. */
function PermissionNote({ t }: { t: TT }) {
  return (
    <p className="pop__perm">
      <button type="button" className="linkbtn" popoverTarget="perm-why">
        {t('permWhy')}
      </button>
      <span id="perm-why" popover="auto" className="pop__popover" role="note">
        <span className="pop__popovertitle">{t('permTitle')}</span>
        <span className="pop__popoverbody">{t('permBody')}</span>
      </span>
    </p>
  );
}
