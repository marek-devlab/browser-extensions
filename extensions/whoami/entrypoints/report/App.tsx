import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from '#imports';
import { Callout, LocaleProvider, ThemeToggle, useLocale } from '@blur/ui';
import {
  collectBrowser,
  collectHardware,
  collectScreen,
  collectLocale,
  collectPrivacy,
  collectAsync,
  type FieldGroup,
  type AsyncDevice,
} from '../../utils/device';
import { FieldRow } from '../../utils/field';
import { ConnectionSection, type ConnectionSnapshot } from '../../utils/connection';
import { reportToMarkdown, reportToJson, downloadText, networkGroup } from '../../utils/export';
import { useSettings, useThemeSetter, useWhoamiLocale } from '../../utils/settings';
import { useT } from '../../utils/i18n';

// FULL REPORT (design §2.6): every field, grouped, with a filter, per-group copy,
// export to .md/.json, and the "N fields unavailable in your browser" counter that
// turns the product's main limitation into an explainable characteristic. Opens in
// its own tab from the popup. Still 🔴 zero network until the user asks.

export function App() {
  const { locale } = useWhoamiLocale();
  return (
    <LocaleProvider locale={locale}>
      <ReportApp />
    </LocaleProvider>
  );
}

function ReportApp() {
  const t = useT();
  const locale = useLocale();
  const { settings, update } = useSettings();
  const { theme, setTheme } = useThemeSetter(settings, update);
  const [filter, setFilter] = useState('');
  const [asyncDev, setAsync] = useState<AsyncDevice | null>(null);

  // 🔴 The network values the user fetched in THIS tab, held in component state so
  // the export can include them. They are not persisted anywhere: reload the tab and
  // they are gone, exactly like in the popup (design §0).
  const [net, setNet] = useState<ConnectionSnapshot>({ trace: null, isp: null });
  const [includeNetwork, setIncludeNetwork] = useState(true);
  const [hideIp, setHideIp] = useState(false);
  const onSnapshot = useCallback((snap: ConnectionSnapshot) => setNet(snap), []);

  const base = useMemo(
    () => [
      collectBrowser(t),
      collectHardware(t),
      collectScreen(t),
      collectLocale(t),
      collectPrivacy(t),
    ],
    [t],
  );

  useEffect(() => {
    if (!settings) return;
    void collectAsync(settings.units, t).then(setAsync);
  }, [settings?.units, t]);

  const groups = useMemo(() => (asyncDev ? mergeAsync(base, asyncDev) : base), [base, asyncDev]);

  const unavailableCount = useMemo(
    () =>
      groups.reduce(
        (n, g) => n + g.fields.filter((f) => f.field.kind === 'unavailable').length,
        0,
      ),
    [groups],
  );

  if (!settings) {
    return (
      <main className="report">
        <p role="status" aria-live="polite">
          <span className="ui-spinner" aria-hidden="true" /> {t('loading')}
        </p>
      </main>
    );
  }

  const showUnavailable = settings.showUnavailable;
  const q = filter.trim().toLowerCase();
  const visibleGroups = groups.map((g) => ({
    ...g,
    fields: g.fields.filter((f) => {
      if (!showUnavailable && f.field.kind === 'unavailable') return false;
      if (q && !t(f.key).toLowerCase().includes(q)) return false;
      return true;
    }),
  }));

  const exportOpts = { includeUnavailable: showUnavailable };
  const hasNet = net.trace !== null || net.isp !== null;
  const netGroup = hasNet && includeNetwork ? networkGroup(net.trace, net.isp, locale, { maskIp: hideIp }) : null;
  // The export is exactly what is on screen, plus the network block IF the user
  // fetched it and left it ticked. Nothing is added behind the user's back.
  const exportGroups = netGroup ? [...groups, netGroup] : groups;

  return (
    <main className="report">
      <header className="report__head">
        <div>
          <h1>{t('rep_title')}</h1>
          <p className="report__sub">{t('rep_sub', { when: new Date().toLocaleString() })}</p>
        </div>
        <div className="report__headctl">
          <ThemeToggle theme={theme} onChange={setTheme} />
          <button
            type="button"
            className="ui-btn ui-btn--sm"
            onClick={() => void browser.runtime.openOptionsPage()}
          >
            ⚙ {t('settings')}
          </button>
        </div>
      </header>

      <div className="report__toolbar">
        <input
          type="search"
          className="report__filter"
          placeholder={t('rep_filterPlaceholder')}
          value={filter}
          aria-label={t('rep_filterAria')}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="report__toggle">
          <input
            type="checkbox"
            checked={showUnavailable}
            onChange={(e) => update({ showUnavailable: e.target.checked })}
          />
          {t('rep_showUnavailable')}
        </label>
      </div>

      <div className="report__grid">
        <nav className="report__nav" aria-label={t('rep_navAria')}>
          <ul>
            {groups.map((g) => (
              <li key={g.id}>
                <a href={`#${g.id}`}>
                  <span>{t(g.titleKey)}</span>
                  <span className="report__navcount mono">{g.fields.length}</span>
                </a>
              </li>
            ))}
          </ul>
          {/* The honest counter (design §2.6): the main limitation, made explainable. */}
          <p className="report__unavail">{t('rep_unavailCounter', { n: unavailableCount })}</p>
        </nav>

        <div className="report__body">
          {visibleGroups.map((g) => (
            <section key={g.id} id={g.id} className="report__section">
              <h2>{t(g.titleKey)}</h2>
              <div className="report__fields">
                {g.fields.length === 0 ? (
                  <p className="report__empty">{t('rep_empty')}</p>
                ) : (
                  g.fields.map((f) => (
                    <FieldRow key={f.key} label={t(f.key)} field={f.field} copyable={f.copyable} />
                  ))
                )}
              </div>
            </section>
          ))}

          <section id="network" className="report__section">
            <h2>{t('rep_networkTitle')}</h2>
            <ConnectionSection settings={settings} update={update} onSnapshot={onSnapshot} />
          </section>
        </div>
      </div>

      <section className="report__export">
        <h2>{t('rep_exportTitle')}</h2>
        <div className="report__exportrow">
          <button
            type="button"
            className="ui-btn ui-btn--sm"
            onClick={() => void copy(reportToMarkdown(exportGroups, t, exportOpts))}
          >
            {t('rep_copyMd')}
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--sm"
            onClick={() => void copy(reportToJson(exportGroups, t, exportOpts))}
          >
            {t('rep_copyJson')}
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--sm"
            onClick={() =>
              downloadText('whoami.md', reportToMarkdown(exportGroups, t, exportOpts), 'text/markdown')
            }
          >
            {t('rep_downloadMd')}
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--sm"
            onClick={() =>
              downloadText('whoami.json', reportToJson(exportGroups, t, exportOpts), 'application/json')
            }
          >
            {t('rep_downloadJson')}
          </button>
        </div>

        {/* 🔴 The IP is in an export only if the user fetched it AND leaves this on.
            "Hide IP" exists because the real use of "copy everything" is a support
            ticket — the one moment you least want to hand over your address. */}
        <div className="report__exportopts">
          <label className={hasNet ? 'report__toggle' : 'report__toggle report__toggle--off'}>
            <input
              type="checkbox"
              checked={hasNet && includeNetwork}
              disabled={!hasNet}
              onChange={(e) => setIncludeNetwork(e.target.checked)}
            />
            {t('rep_includeNetwork')}
            {!hasNet && <small>{t('rep_includeNetworkNone')}</small>}
          </label>
          <label className={hasNet && includeNetwork ? 'report__toggle' : 'report__toggle report__toggle--off'}>
            <input
              type="checkbox"
              checked={hideIp}
              disabled={!hasNet || !includeNetwork}
              onChange={(e) => setHideIp(e.target.checked)}
            />
            {t('rep_hideIp', { sample: '203.0.113.x' })}
          </label>
        </div>

        <Callout tone="info">{t('rep_exportCallout')}</Callout>
      </section>
    </main>
  );
}

/** Clipboard write from a user gesture — no `clipboardWrite` permission is needed
 *  from an extension document. A failure is swallowed, never thrown into the void. */
async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard denied (rare, e.g. no focus) — the download buttons still work.
  }
}

function mergeAsync(groups: FieldGroup[], a: AsyncDevice): FieldGroup[] {
  const patch: Record<string, Partial<Record<string, FieldGroup['fields'][number]['field']>>> = {
    browser: { lbl_architecture: a.architecture, lbl_osVersion: a.osVersion, lbl_deviceModel: a.model },
    hardware: { lbl_siteStorage: a.storageQuota },
    privacy: { lbl_gpuWebgpu: a.webgpu },
  };
  return groups.map((g) => {
    const p = patch[g.id];
    if (!p) return g;
    return {
      ...g,
      fields: g.fields.map((f) => (p[f.key] ? { ...f, field: p[f.key]! } : f)),
    };
  });
}
