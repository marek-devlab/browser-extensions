import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Callout, LocaleProvider, ThemeToggle, seedLocale } from '@blur/ui';
import { EngineBadge } from '../../utils/engine-badge';
import { honestyKey, useT, type MsgKey, type TFn } from '../../utils/i18n';
import { sendQuery } from '../../utils/messaging';
import { usePrefs, type PrefsApi } from '../../utils/prefs';
import type { TabRuleStatus, TabSummary } from '../../utils/protocol';
import { ruleDisplayName } from '../../utils/rule-summary';
import type { Rule } from '../../utils/rule-types';
import { LOCALE_CACHE_KEY } from '../../utils/storage';

// The popup (design §1.2, §2.1–§2.3, §2.7): a ~5-second launcher for THIS
// tab. It is the only surface that runs inside a user gesture, so the host
// permission request lives here — `permissions.request({origins})` for
// "Enable on <host>" — called SYNCHRONOUSLY in the click handler (an `await`
// before the call drops the user-action status; MDN "User actions", 2026-03).
//
// Network-level mode: `debugger` is an install-time permission of the Chrome
// build (wxt.config.ts — Chromium refuses it as optional), so there is no
// browser prompt to go through; `permissions.request` would resolve true
// without asking and only fake a gate. The REAL gate is the consent
// `<dialog>` (design §2.7) plus a `permissions.contains` check that tells the
// truth when a policy or a future build withholds the permission. The block
// is rendered ONLY when the background reports the engine (`networkLevelAvailable`).

const POLL_MS = 1000;

async function currentTabId(): Promise<number | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

function useTabSummary(): { summary: TabSummary | null; tabId: number | null; refresh: () => Promise<void>; error: string | null } {
  const [summary, setSummary] = useState<TabSummary | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      if (idRef.current === null) {
        idRef.current = await currentTabId();
        setTabId(idRef.current);
      }
      if (idRef.current === null) return;
      const s = await sendQuery({ type: 'getTabSummary', tabId: idRef.current });
      if (s && 'rules' in s) {
        // The restart notice is one-shot on the background side; keep it
        // visible for the life of this popup instead of one poll tick.
        setSummary((prev) => (prev?.countersResetNotice ? { ...s, countersResetNotice: true } : s));
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { summary, tabId, refresh, error };
}

/** `2/3` for stateful rules, `≈41` for DNR, plain hits for `every`, `—`
 *  without site access — the counters need `webRequest` observation on the
 *  origin, which only host access gives (§4.2, §6.9): never a fabricated 0.
 *  A rule that has not matched yet on this tab shows `0` (`≈0` for DNR). */
function counterText(r: TabRuleStatus, siteEnabled: boolean): string {
  if (!siteEnabled) return '—';
  const c = r.counter ?? { seen: 0, hits: 0 };
  const s = r.rule.state;
  const target =
    s.kind === 'times' ? s.n : s.kind === 'nth' ? s.n : s.kind === 'once' ? 1 : s.kind === 'skipFirst' && s.times !== undefined ? s.skip + s.times : null;
  const shown = s.kind === 'nth' || s.kind === 'skipFirst' ? c.seen : c.hits;
  const base = target !== null ? `${Math.min(shown, target)}/${target}` : s.kind === 'probability' ? `${c.hits}/${c.seen}` : String(c.hits);
  return r.approx ? `≈${base}` : base;
}

function reasonText(t: TFn, r: TabRuleStatus): string {
  switch (r.reason) {
    case undefined:
      return '';
    case 'siteNotEnabled':
      return t('reasonSiteNotEnabled');
    case 'paused':
      return t('reasonPaused');
    case 'disabled':
      return t('reasonDisabled');
    case 'groupDisabled':
      return t('reasonGroupDisabled');
    case 'needsNetworkLevel':
    case 'nlUnavailableBuild':
      return t('puNeedsNl');
    default:
      return t(honestyKey(r.reason));
  }
}

function RuleRow({ r, siteEnabled, onReset }: { r: TabRuleStatus; siteEnabled: boolean; onReset: (rule: Rule) => void }) {
  const t = useT();
  const name = ruleDisplayName(t, r.rule);
  const stateful = r.rule.state.kind !== 'every';
  return (
    <li className={`prow${r.active ? '' : ' prow--inactive'}`} data-rule-id={r.rule.id} data-active={r.active}>
      <span className="prow__glyph" aria-hidden="true">
        {r.active ? '●' : '○'}
      </span>
      <span className="prow__name" title={name}>
        {name}
      </span>
      <EngineBadge engine={r.engine} degraded={!!r.degraded} inactive={!r.active} />
      {r.active ? (
        <span className="prow__count mono" title={r.approx ? t(honestyKey('dnrCountApprox')) : undefined}>
          {counterText(r, siteEnabled)}
          {stateful && siteEnabled ? (
            <button type="button" className="prow__reset" aria-label={t('puResetCounter', { name })} title={t('puResetCounter', { name })} onClick={() => onReset(r.rule)}>
              ↻
            </button>
          ) : null}
        </span>
      ) : (
        <span className="prow__why fine">{reasonText(t, r)}</span>
      )}
    </li>
  );
}

function NlConsentDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="consent" aria-labelledby="nl-title" onClose={onCancel} data-testid="nl-consent">
      <h2 id="nl-title">{t('nlDialogTitle')}</h2>
      <p>{t('nlDialogIntro')}</p>
      <ul>
        <li>{t('nlDialogB1')}</li>
        <li>{t('nlDialogB2')}</li>
        <li>{t('nlDialogB3')}</li>
      </ul>
      <p>{t('nlDialogSee')}</p>
      <p>{t('nlDialogBreak')}</p>
      <p>{t(honestyKey('nlSlowsTab'))}</p>
      <p>
        <strong>{t('nlDialogScope')}</strong>
      </p>
      <div className="consent__actions">
        <Button onClick={onCancel}>{t('cancel')}</Button>
        {/* This click IS the consent; `permissions.contains` verifies the install-time grant. */}
        <Button variant="primary" onClick={onConfirm}>
          {t('nlDialogEnable')}
        </Button>
      </div>
    </dialog>
  );
}

function Body({ prefs, update }: PrefsApi) {
  const t = useT();
  const { summary, tabId, refresh, error } = useTabSummary();
  const [live, setLive] = useState<{ text: string; assertive: boolean }>({ text: '', assertive: false });
  const [consent, setConsent] = useState(false);
  const [nlBusy, setNlBusy] = useState(false);

  const say = (key: MsgKey, assertive = false, vars?: Record<string, string | number>) => setLive({ text: t(key, vars), assertive });

  function openTool(): void {
    const hash = tabId !== null ? `#/rules?tab=${tabId}` : '#/rules';
    void browser.tabs.create({ url: browser.runtime.getURL(`/tool.html${hash}`) });
    window.close();
  }

  /** "Enable on <host>" — the request MUST be the first thing in the handler. */
  function enableSite(): void {
    if (!summary) return;
    // Both schemes of this host: one browser prompt, and a site that redirects
    // http → https (or a localhost dev server) is covered either way.
    const origins = [`https://${summary.host}/*`, `http://${summary.host}/*`];
    browser.permissions
      .request({ origins })
      .then(async (granted) => {
        if (!granted) {
          say('puAccessDeclined');
          return;
        }
        await sendQuery({ type: 'siteAccessChanged' });
        await refresh();
      })
      .catch((err: unknown) => setLive({ text: err instanceof Error ? err.message : String(err), assertive: false }));
  }

  /** NL consent confirmed (the dialog IS the gate) — verify the permission, then attach. */
  function enableNetworkLevel(): void {
    setConsent(false);
    if (tabId === null) return;
    setNlBusy(true);
    browser.permissions
      .contains({ permissions: ['debugger'] })
      .then(async (granted) => {
        if (!granted) {
          say('puNlDeclined', true);
          return;
        }
        const r = await sendQuery({ type: 'setNetworkLevel', tabId, enabled: true });
        if (r && 'ok' in r && !r.ok) setLive({ text: r.error, assertive: true });
        await refresh();
      })
      .catch((err: unknown) => setLive({ text: err instanceof Error ? err.message : String(err), assertive: true }))
      .finally(() => setNlBusy(false));
  }

  const showError = (err: unknown): void => setLive({ text: err instanceof Error ? err.message : String(err), assertive: true });

  async function disableNetworkLevel(): Promise<void> {
    if (tabId === null) return;
    setNlBusy(true);
    try {
      await sendQuery({ type: 'setNetworkLevel', tabId, enabled: false });
      await refresh();
    } catch (err) {
      showError(err);
    } finally {
      setNlBusy(false);
    }
  }

  async function togglePause(): Promise<void> {
    if (!summary) return;
    try {
      await sendQuery({ type: 'pauseTab', tabId: summary.tabId, paused: !summary.paused });
      await refresh();
    } catch (err) {
      showError(err);
    }
  }

  const rules = summary?.rules ?? [];
  const activeCount = rules.filter((r) => r.active).length;
  const siteEnabled = summary?.siteEnabled ?? false;

  return (
    <div className="popup">
      <header className="head">
        <div className="head__top">
          <h1>{t('appName')}</h1>
          <ThemeToggle theme={prefs?.theme ?? 'auto'} onChange={(theme) => update({ theme })} />
        </div>
        <div className="head__host">
          <span className="host" data-testid="host">
            {summary?.host || '—'}
          </span>
          {summary && !summary.restricted && siteEnabled ? (
            <span className="host__on" data-testid="site-enabled">
              ✓ {t('puEnabled')}
            </span>
          ) : null}
        </div>
      </header>

      {error ? <Callout tone="poor">{error}</Callout> : null}
      {summary?.countersResetNotice ? (
        <Callout tone="warn">
          <span data-testid="restart-notice">{t('puCountersReset')}</span>
        </Callout>
      ) : null}

      {summary?.restricted ? (
        <Callout>
          <span data-testid="restricted">{t('puRestricted')}</span>
        </Callout>
      ) : null}

      {summary && !summary.restricted && !siteEnabled ? (
        <section className="enable" data-testid="site-off">
          <p className="enable__title">{t('puSiteOff')}</p>
          <Button variant="primary" onClick={enableSite}>
            {t('puEnableOn', { host: summary.host })}
          </Button>
          <p className="fine">{t('puEnableWhy')}</p>
          <p className="fine">{t('puBlockWorksWithout')}</p>
        </section>
      ) : null}

      {summary?.paused ? <Callout tone="warn">{t('puPaused')}</Callout> : null}

      {summary && !summary.restricted ? (
        <section className="rules">
          <h2 className="ui-section-heading rules__head">
            <span>{t('puActiveHere')}</span>
            <span className="mono" data-testid="active-count">
              {activeCount}
            </span>
          </h2>
          {rules.length === 0 ? (
            <p className="fine">{t('puNoRules')}</p>
          ) : (
            <ul className="plist">
              {rules.map((r) => (
                <RuleRow key={r.rule.id} r={r} siteEnabled={siteEnabled} onReset={(rule) => void sendQuery({ type: 'resetCounters', ruleId: rule.id }).then(refresh).catch(showError)} />
              ))}
            </ul>
          )}
          {rules.some((r) => r.approx) ? <p className="fine">{t(honestyKey('dnrCountApprox'))}</p> : null}
        </section>
      ) : null}

      {summary && !summary.restricted && summary.networkLevelAvailable ? (
        <section className="nl" data-testid="nl-block">
          <div className="nl__head">
            <h2 className="ui-section-heading">{t('puNlTitle')}</h2>
            <label className="switch">
              <input
                type="checkbox"
                role="switch"
                checked={summary.networkLevel}
                disabled={nlBusy}
                aria-label={t('puNlToggle')}
                onChange={(e) => (e.target.checked ? setConsent(true) : void disableNetworkLevel())}
              />
              <span className="mono">{summary.networkLevel ? t('on') : t('off')}</span>
            </label>
          </div>
          {summary.networkLevel ? (
            <>
              <p className="fine">{t('puNlBannerIsUs')}</p>
              {/* §2.3: exact numbers — Fetch sees every request of the tab. */}
              <p className="fine mono" data-testid="nl-stats">
                {t('puNlStats', { seen: summary.nl?.intercepted ?? 0, hits: summary.nl?.applied ?? 0 })}
              </p>
            </>
          ) : (
            <>
              <p className="fine">{t('puNlDescription')}</p>
              <p className="fine">{t(honestyKey('nlSlowsTab'))}</p>
            </>
          )}
          <NlConsentDialog open={consent} onCancel={() => setConsent(false)} onConfirm={enableNetworkLevel} />
        </section>
      ) : null}

      <div className="actions">
        {summary && !summary.restricted ? (
          <Button onClick={() => void togglePause()}>{summary.paused ? t('puResumeTab') : t('puPauseTab')}</Button>
        ) : null}
        <Button onClick={openTool} variant={summary?.restricted || !summary ? 'primary' : 'default'}>
          {t('openTool')}
        </Button>
      </div>

      <output className="fine live" aria-live={live.assertive ? 'assertive' : 'polite'} role={live.assertive ? 'alert' : 'status'}>
        {live.text}
      </output>

      <footer className="footer" data-testid="footer">
        {t('offlineFooter')}
      </footer>
    </div>
  );
}

export function App() {
  const api = usePrefs();
  const locale = api.prefs?.locale ?? seedLocale(LOCALE_CACHE_KEY);
  return (
    <LocaleProvider locale={locale}>
      <Body {...api} />
    </LocaleProvider>
  );
}
