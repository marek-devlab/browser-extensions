import { useCallback, useState } from 'react';
import { LocaleProvider, ThemeToggle, seedLocale } from '@blur/ui';
import { translateReason, useT } from '../../utils/i18n';
import { usePushMessages } from '../../utils/messaging';
import { usePrefs, type PrefsApi } from '../../utils/prefs';
import type { LogEntry } from '../../utils/log';
import type { PushMessage } from '../../utils/protocol';
import { newRuleId, ruleFromLogEntry } from '../../utils/rule-presets';
import type { Rule } from '../../utils/rule-types';
import { LOCALE_CACHE_KEY } from '../../utils/storage';
import { useBuildCaps, usePermissionStatus } from '../../utils/use-caps';
import { useLogFeed } from '../../utils/use-log-feed';
import { useRulesStore } from '../../utils/use-rules';
import { LogPage } from './pages/LogPage';
import { RulesPage } from './pages/RulesPage';
import { SettingsPage } from './pages/SettingsPage';
import { navigate, useRoute } from './router';

// The tool page (design §1.2, §1.3): Rules · Log · Settings behind a hash
// router. One store per concern (rules, log feed, prefs, caps, permissions),
// each with a single writer; pages get them as props. Data comes ONLY through
// utils/protocol.ts messages — this page never touches request APIs.

function Body({ prefs }: { prefs: PrefsApi }) {
  const t = useT();
  const route = useRoute();
  const store = useRulesStore();
  const build = useBuildCaps();
  const { status: permissions, refresh: refreshPermissions } = usePermissionStatus();
  const feed = useLogFeed(route.page === 'log');
  const [seed, setSeed] = useState<Rule | null>(null);
  const [nlToast, setNlToast] = useState<{ tabId: number; reason: string } | null>(null);

  const onPush = useCallback((m: PushMessage) => {
    if (m.type === 'nl:detached') setNlToast({ tabId: m.tabId, reason: m.reason });
  }, []);
  usePushMessages(onPush);

  const createFromLog = (entry: LogEntry, blockOnly: boolean) => {
    setSeed(ruleFromLogEntry(entry, newRuleId(), Date.now(), blockOnly));
    navigate({ page: 'rules', ruleId: 'new', tabId: route.tabId });
  };

  const noAccess = build.platform === 'chrome' && permissions !== null && permissions.origins.length === 0;

  return (
    <div className="tool">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            ▣
          </span>
          <h1>{t('appName')}</h1>
        </div>
        <nav className="tabs" aria-label={t('appName')}>
          {(['rules', 'log', 'settings'] as const).map((p) => (
            <a
              key={p}
              href={p === 'rules' ? '#/rules' : `#/${p}`}
              className={route.page === p ? 'tab tab--active' : 'tab'}
              aria-current={route.page === p ? 'page' : undefined}
              data-testid={`nav-${p}`}
            >
              {t(p === 'rules' ? 'tabRules' : p === 'log' ? 'tabLog' : 'tabSettings')}
            </a>
          ))}
        </nav>
        <ThemeToggle theme={prefs.prefs?.theme ?? 'auto'} onChange={(theme) => prefs.update({ theme })} />
      </header>

      {nlToast ? (
        <div className="toast" role="alert" aria-live="assertive">
          <span>{t('nlDetached', { reason: translateReason(t, nlToast.reason) })}</span>
          <button type="button" className="ui-btn ui-btn--sm" onClick={() => setNlToast(null)}>
            {t('close')}
          </button>
        </div>
      ) : null}

      {store.error ? (
        <p className="fine warn panel" role="alert">
          {store.error}
        </p>
      ) : null}

      <main className="panel">
        {route.page === 'rules' ? (
          <RulesPage
            store={store}
            route={route}
            platform={build.platform}
            caps={build.caps}
            origins={permissions?.origins ?? null}
            seed={seed}
            clearSeed={() => setSeed(null)}
          />
        ) : route.page === 'log' ? (
          <LogPage feed={feed} rules={store.doc?.rules ?? []} tabId={route.tabId} noAccess={noAccess} version={build.version} onCreateRule={createFromLog} />
        ) : (
          <SettingsPage prefs={prefs} store={store} permissions={permissions} refreshPermissions={refreshPermissions} platform={build.platform} />
        )}
      </main>

      <footer className="foot fine">{t('offlineFooter')}</footer>
    </div>
  );
}

export function App() {
  const api = usePrefs();
  // Synchronous seed → no English flash before the async pref resolves.
  const locale = api.prefs?.locale ?? seedLocale(LOCALE_CACHE_KEY);
  return (
    <LocaleProvider locale={locale}>
      <Body prefs={api} />
    </LocaleProvider>
  );
}
