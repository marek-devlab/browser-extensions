import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { browser } from '#imports';
import { LocaleProvider } from '@blur/ui';
import type {
  AdBlockLevel,
  AdBlockSettings,
  AdBlockTabStats,
  AggregateStats,
} from '@blur/core';
import { adBlockPresetForLevel } from '@blur/core';
import { useSettings } from '../../utils/use-settings';
import { useStorageItem } from '../../utils/use-storage-item';
import { useHostAccess } from '../../utils/use-host-access';
import {
  siteConfigsItem,
  customFiltersItem,
  pauseUntilItem,
  installDateItem,
  rulesetStatusItem,
  RULESET_STATUS_OK,
} from '../../utils/storage';
import type { RulesetStatus } from '../../utils/storage';
import type { AdBlockSiteConfigX, CustomFilters } from '../../utils/adblock-types';
import {
  ALL_SITES,
  hiddenElementsFor,
  removeFilter,
  removeSiteFilters,
} from '../../utils/custom-filters';
import type { HiddenElement } from '../../utils/custom-filters';
import { getDnrTabCounts } from '../../utils/matched-rules';
import { formatCount } from '../../utils/format-count';
import { useAdblockLocale } from '../../utils/use-locale';
import { useT, useDegradedNotice, levelLabel, levelDesc, type TFn, type MsgKey } from '../../utils/i18n';

const PAUSE_MINUTES = 10;

const ADBLOCK_ORDER: AdBlockLevel[] = ['off', 'standard', 'aggressive'];

// Translation keys for the per-list breakdown ("which lists this site's traffic
// hits"). Keyed by the ruleset ids the backends report in byList.
const LIST_LABEL_KEY: Record<string, MsgKey> = {
  easylist: 'listAds',
  easyprivacy: 'listTrackers',
  annoyances: 'listAnnoyances',
};
const LIST_ORDER = ['easylist', 'easyprivacy', 'annoyances'];

type TrackerToggleKey = keyof Pick<
  AdBlockSettings,
  'blockTrackers' | 'stripTrackingParams' | 'blockAnnoyances'
>;

const TRACKER_TOGGLES: {
  key: TrackerToggleKey;
  labelKey: MsgKey;
}[] = [
  { key: 'blockTrackers', labelKey: 'blockTrackers' },
  { key: 'stripTrackingParams', labelKey: 'stripParams' },
  // Names the NETWORK annoyances ruleset specifically: on-page clutter hiding
  // (cookie banners, pop-ups) is cosmetic filtering governed by the Aggressive
  // strictness level, not by this toggle — see the note below (§ honesty).
  { key: 'blockAnnoyances', labelKey: 'blockAnnoyanceReq' },
];

/**
 * Per-tab figures for the popup. `networkBlocked`/`trackersBlocked` are nullable:
 * `null` means "could not be measured" (Chromium's DNR read hit its quota / had
 * no data), which the UI shows as "—" — never a fabricated 0. `cosmeticHidden` is
 * exact on every browser. `null` `stats` altogether means "not measured yet".
 */
interface PopupStats {
  cosmeticHidden: number;
  networkBlocked: number | null;
  trackersBlocked: number | null;
  /** Applies to the network/tracker figures only. */
  approximate: boolean;
}

function useActiveTab(): { hostname: string; tabId: number } {
  const [state, setState] = useState<{ hostname: string; tabId: number }>({
    hostname: '',
    tabId: -1,
  });
  useEffect(() => {
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (!tab) return;
        const tabId = tab.id ?? -1;
        let hostname = '';
        try {
          if (tab.url) hostname = new URL(tab.url).hostname;
        } catch {
          // Non-web tabs (chrome://, about:) have no parseable host — leave ''.
        }
        setState({ hostname, tabId });
      });
  }, []);
  return state;
}

export function App(): JSX.Element {
  // Read the persisted UI language and provide it to the whole popup tree so
  // every `useT()` renders in the chosen locale.
  const { locale } = useAdblockLocale();
  return (
    <LocaleProvider locale={locale}>
      <PopupBody />
    </LocaleProvider>
  );
}

function PopupBody(): JSX.Element {
  const t = useT();
  const degradedNotice = useDegradedNotice();
  const { settings, update, loaded } = useSettings();
  const { hostname, tabId } = useActiveTab();
  const { value: siteConfigs, update: setSiteConfigs } = useStorageItem<
    Record<string, AdBlockSiteConfigX>
  >(siteConfigsItem, {});
  const [stats, setStats] = useState<PopupStats | null>(null);
  const [byList, setByList] = useState<Record<string, number> | null>(null);
  const [aggregate, setAggregate] = useState<AggregateStats | null>(null);
  const { granted: hostGranted, request: requestHost } = useHostAccess();
  const { value: pausedUntil } = useStorageItem<number>(pauseUntilItem, 0);
  // Chromium only: whether the DNR backend had to leave a list the user enabled
  // switched OFF because the browser's shared static-rule budget is full. Firefox's
  // webRequest backend has no such limit and never writes this, so the notice is
  // compiled out of that build entirely.
  const { value: rulesetStatus } = useStorageItem<RulesetStatus>(
    rulesetStatusItem,
    RULESET_STATUS_OK,
  );
  const [installDate, setInstallDate] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // What the cumulative total actually counts differs by engine, so the label must
  // too (§ honesty): Chromium's aggregate only ever accrues exact cosmetic hides
  // (its network figures are approximate + on-demand, never cumulative), whereas
  // Firefox's blocking webRequest folds exact network + tracker blocks in as well.
  const aggregateLabel = t(import.meta.env.FIREFOX ? 'aggFirefox' : 'aggChromium');

  useEffect(() => {
    void installDateItem.getValue().then(setInstallDate);
  }, []);

  const paused = pausedUntil > now;
  // Tick once a second while paused so the countdown stays live.
  useEffect(() => {
    if (!paused) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [paused]);

  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: 'getAggregateStats' })
      .then((s: AggregateStats | undefined) => {
        if (s) setAggregate(s);
      })
      .catch(() => {
        // Leave null — never fabricate a total when the background is unreachable.
      });
  }, []);

  useEffect(() => {
    // Only web pages have a host we can measure; chrome://, about:, the New Tab
    // page etc. get a real empty state, not invented numbers.
    if (tabId < 0 || !hostname) {
      setStats(null);
      setByList(null);
      return;
    }
    let active = true;
    void (async () => {
      let cosmeticHidden = 0;
      let networkBlocked: number | null = 0;
      let trackersBlocked: number | null = 0;
      let approximate = !import.meta.env.FIREFOX;
      let lists: Record<string, number> | null = null;
      try {
        const s = (await browser.runtime.sendMessage({ type: 'getTabStats', tabId })) as
          | AdBlockTabStats
          | undefined;
        if (s) {
          cosmeticHidden = s.cosmeticHidden;
          networkBlocked = s.networkBlocked;
          trackersBlocked = s.trackersBlocked;
          approximate = s.accuracy === 'approximate';
        }
      } catch {
        // Background unreachable — cosmetic stays 0; network/tracker fetched below.
      }
      // On Chromium, network/tracker counts come from getMatchedRules(), which is
      // best-effort inside the popup gesture and returns null when unavailable
      // (quota/no data) — shown as "—", never ~0. Firefox counts exactly and
      // takes the values above.
      if (!import.meta.env.FIREFOX) {
        // A single getMatchedRules read yields the totals AND the per-list split,
        // so we never spend the 20-calls/10-min quota twice.
        const counts = await getDnrTabCounts(tabId);
        networkBlocked = counts.network;
        trackersBlocked = counts.trackers;
        approximate = true;
        lists = counts.byList;
      } else {
        // Firefox counts every request exactly; the per-list tally is off-quota.
        try {
          lists = (await browser.runtime.sendMessage({ type: 'getTabLists', tabId })) as Record<
            string,
            number
          >;
        } catch {
          lists = null;
        }
      }
      if (active) {
        setStats({ cosmeticHidden, networkBlocked, trackersBlocked, approximate });
        setByList(lists);
      }
    })();
    return () => {
      active = false;
    };
  }, [tabId, hostname]);

  const onWebPage = Boolean(hostname);
  const siteAllowlisted = settings.allowlist.includes(hostname);
  const globallyOff = !settings.enabled;
  const siteEnabled = settings.enabled && onWebPage && !siteAllowlisted;

  function toggleGlobal(): void {
    update({ enabled: !settings.enabled });
  }

  function toggleSite(): void {
    if (!onWebPage) return;
    const allow = new Set(settings.allowlist);
    if (allow.has(hostname)) allow.delete(hostname);
    else allow.add(hostname);
    update({ allowlist: [...allow] });
  }

  // Selecting a level applies its preset to the per-list toggles (the user can
  // then override individual lists in Options → Filter lists).
  function setLevel(level: AdBlockLevel): void {
    update({
      adblock: { ...settings.adblock, level, ...adBlockPresetForLevel(level) },
    });
  }

  function setAdblock(patch: Partial<AdBlockSettings>): void {
    update({ adblock: { ...settings.adblock, ...patch } });
  }

  // A tracker/annoyance toggle. Strip-tracking-params needs host access on
  // Chromium (its redirect rule only fires with a granted host), so enabling it
  // there prompts for the grant. The preference is stored regardless; a caveat
  // below reflects the pending state if the grant is declined.
  function toggleTracker(key: TrackerToggleKey, checked: boolean): void {
    if (key === 'stripTrackingParams' && checked && !import.meta.env.FIREFOX && !hostGranted) {
      void requestHost();
    }
    setAdblock({ [key]: checked } as Partial<AdBlockSettings>);
  }

  // Strip-params is enabled but can't act until the host grant lands (Chromium).
  const stripParamsPending =
    settings.adblock.stripTrackingParams && !import.meta.env.FIREFOX && !hostGranted;

  function pauseEverywhere(): void {
    void browser.runtime.sendMessage({ type: 'pauseFor', minutes: PAUSE_MINUTES });
  }

  function resumeNow(): void {
    void browser.runtime.sendMessage({ type: 'resumeNow' });
  }

  const pauseMinutesLeft = paused ? Math.ceil((pausedUntil - now) / 60_000) : 0;

  const cosmeticDisabled = siteConfigs[hostname]?.disableCosmetic === true;

  // Per-site "disable cosmetic filtering only" (feature §3) — distinct from the
  // full allowlist: network/DNR blocking keeps running, only element hiding stops.
  function toggleCosmetic(): void {
    if (!onWebPage) return;
    const prev = siteConfigs[hostname] ?? { hostname };
    setSiteConfigs({
      ...siteConfigs,
      [hostname]: { ...prev, hostname, disableCosmetic: !cosmeticDisabled },
    });
  }

  // Element picker (feature §1): tell the active tab's content script to start
  // picking, then close the popup so the user can click the page.
  function pickElement(): void {
    if (tabId < 0) return;
    void browser.tabs.sendMessage(tabId, { type: 'startPicker' }).catch(() => {
      // No content script here (e.g. a chrome:// page) — nothing to pick.
    });
    window.close();
  }

  /* ---- Deferred undo: what YOUR filters are hiding on THIS site ----
     The in-page toast covers "I just blocked the wrong thing". This covers the
     other half: "I blocked something here last week and now the page looks
     wrong." The popup is the surface the user already opens per-site, so the
     answer belongs here rather than three clicks deep in Options. */
  const { value: customFilters, update: setCustomFilters } = useStorageItem<CustomFilters>(
    customFiltersItem,
    {},
  );
  const hidden = onWebPage ? hiddenElementsFor(customFilters, hostname) : [];

  // Restoring is just removing the rule: the content script's storage watcher
  // re-applies in every open tab, so the element reappears live — no reload.
  function restoreOne(entry: HiddenElement): void {
    setCustomFilters(removeFilter(customFilters, entry.host, entry.selector));
  }

  function restoreAllHere(): void {
    setCustomFilters(removeSiteFilters(customFilters, hostname));
  }

  // Flash the element in the page behind the popup. An ENHANCEMENT, never the
  // only way to identify an entry — the stored label does that, and on Firefox
  // for Android the popup covers the whole screen so nothing would be visible.
  function peek(selector: string): void {
    if (tabId < 0) return;
    void browser.tabs.sendMessage(tabId, { type: 'peekElement', selector }).catch(() => {});
  }

  const siteScopedCount = hidden.filter((e) => e.host !== ALL_SITES).length;

  if (!loaded) return <main className="popup">{t('loading')}</main>;

  return (
    <main className="popup">
      <header className="row header">
        <div>
          <div className="host">{t('appName')}</div>
          <div className="sub">
            {globallyOff ? t('offEverywhere') : t('protectionOn')}
          </div>
        </div>
        <label className="switch" title={t('toggleEverywhere')}>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={toggleGlobal}
            aria-label={t('toggleEverywhere')}
          />
          <span className="slider" />
        </label>
      </header>

      <section className="row site-row">
        <div>
          {/* Ellipsized when long — `title` keeps the full hostname reachable. */}
          <div className="host" title={onWebPage ? hostname : undefined}>
            {onWebPage ? hostname : t('thisPage')}
          </div>
          <div className="sub">
            {!onWebPage
              ? t('blockingNotHere')
              : globallyOff
                ? t('pausedTurnOnAbove')
                : siteEnabled
                  ? t('blockingOnSite')
                  : t('pausedOnSite')}
          </div>
        </div>
        <label className="switch" title={t('enableOnSite')}>
          <input
            type="checkbox"
            checked={siteEnabled}
            disabled={!onWebPage || globallyOff}
            onChange={toggleSite}
            aria-label={t('enableBlockingOnSite')}
          />
          <span className="slider" />
        </label>
      </section>

      {onWebPage && siteEnabled && (
        <section className="group site-tools">
          <label className="chip">
            <input
              type="checkbox"
              checked={!cosmeticDisabled}
              onChange={toggleCosmetic}
              aria-label={t('hideElementsAria')}
            />
            {t('hideElementsLabel')}
          </label>
          <button
            type="button"
            className="pick-btn"
            onClick={pickElement}
            aria-label={t('pickElementAria')}
          >
            {t('blockElementBtn')}
          </button>
        </section>
      )}

      {onWebPage && hidden.length > 0 && (
        <section className="group hidden-block">
          <h2>{t('hiddenByYou')}</h2>
          {/* Honesty: the rules are still stored, but nothing is being hidden right
              now — don't let the list imply otherwise. Restoring still works. */}
          {(!siteEnabled || cosmeticDisabled) && (
            <p className="caveat">{t('hidingOffCaveat')}</p>
          )}
          <ul className="hidden-list">
            {hidden.map((entry) => {
              const name = entry.label ?? entry.selector;
              return (
                <li
                  key={`${entry.host} ${entry.selector}`}
                  className="hidden-item"
                  // Hover is a convenience only; the Show button below is the
                  // real, touch- and keyboard-reachable affordance.
                  onMouseEnter={() => peek(entry.selector)}
                >
                  <div className="hidden-desc">
                    <span className="hidden-name" title={entry.selector}>
                      {name}
                    </span>
                    <span className="hidden-meta">
                      {entry.host === ALL_SITES && (
                        <span className="hidden-tag">{t('allSitesTag')}</span>
                      )}
                      {/* Un-labelled (pre-existing, pasted or hand-typed) rules
                          have nothing better to show than the selector, so it is
                          already the name — don't repeat it underneath. */}
                      {entry.label && <code>{entry.selector}</code>}
                    </span>
                  </div>
                  <div className="hidden-actions">
                    <button
                      type="button"
                      className="peek-btn"
                      onClick={() => peek(entry.selector)}
                      onFocus={() => peek(entry.selector)}
                      aria-label={t('showWhereAria', { name })}
                    >
                      {t('showBtn')}
                    </button>
                    <button
                      type="button"
                      className="restore-btn"
                      onClick={() => restoreOne(entry)}
                      aria-label={t('restoreAria', { name })}
                    >
                      {t('restoreBtn')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {siteScopedCount > 1 && (
            <button
              type="button"
              className="restore-all-btn"
              onClick={restoreAllHere}
              aria-label={t('restoreAllAria', { count: siteScopedCount, host: hostname })}
            >
              {t('restoreAllPre', { count: siteScopedCount })}
              {hostname}
            </button>
          )}
        </section>
      )}

      {stats === null ? (
        <p className="empty" role="status">
          {onWebPage ? t('measuring') : t('cantRunHere')}
        </p>
      ) : (
        <>
          <section className="stats" aria-live="polite">
            <div className="stat">
              {/* Cosmetic hides are EXACT everywhere — never prefixed with ~. */}
              <span className="num">{stats.cosmeticHidden}</span>
              <span className="lbl">{t('statHidden')}</span>
            </div>
            <div className="stat">
              <span className="num">
                <Count value={stats.networkBlocked} approximate={stats.approximate} />
              </span>
              <span className="lbl">{t('statBlocked')}</span>
            </div>
            <div className="stat">
              <span className="num">
                <Count value={stats.trackersBlocked} approximate={stats.approximate} />
              </span>
              <span className="lbl">{t('statTrackers')}</span>
            </div>
          </section>

          {stats.approximate && <p className="caveat">{t('approxCaveat')}</p>}

          <ListBreakdown byList={byList} approximate={stats.approximate} t={t} />
        </>
      )}

      {aggregate && (
        <section className="totals-block" aria-live="polite">
          <div className="totals-label">
            {aggregateLabel} {t('exactParen')}
            {installDate && <span className="since"> · {t('since', { date: installDate })}</span>}
          </div>
          <div className="totals">
            <span>
              {t('today')} <b>{aggregate.today.toLocaleString()}</b>
            </span>
            <span>
              {t('week')} <b>{aggregate.week.toLocaleString()}</b>
            </span>
            <span>
              {t('total')} <b>{aggregate.total.toLocaleString()}</b>
            </span>
          </div>
        </section>
      )}

      <section className="group">
        <h2>{t('strictness')}</h2>
        <div className="levels">
          {ADBLOCK_ORDER.map((level) => (
            <label
              key={level}
              className={[
                'level',
                settings.adblock.level === level ? 'on' : '',
                level === 'aggressive' ? 'warn' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <input
                type="radio"
                name="adblock"
                checked={settings.adblock.level === level}
                onChange={() => setLevel(level)}
                aria-label={levelLabel(t, level)}
              />
              <span className="level-label">
                {levelLabel(t, level)}
                {level === 'aggressive' && (
                  <span className="badge-warn">{t('mayBreakSites')}</span>
                )}
              </span>
              <span className="level-desc">{levelDesc(t, level)}</span>
            </label>
          ))}
        </div>
        {/* Honesty: the level says "Aggressive" but the browser could not fit every
            list it turns on, so say which one is actually off. Same `.caveat` style
            as the other in-popup qualifiers. */}
        {!import.meta.env.FIREFOX && rulesetStatus.degraded && (
          <p className="caveat" role="alert">
            <span aria-hidden="true">⚠ </span>
            {degradedNotice(rulesetStatus.dropped)}
          </p>
        )}
      </section>

      <section className="group">
        <h2>{t('trackersAnnoyances')}</h2>
        <div className="toggles">
          {TRACKER_TOGGLES.map(({ key, labelKey }) => (
            <label key={key} className="chip">
              <input
                type="checkbox"
                checked={settings.adblock[key]}
                onChange={(e) => toggleTracker(key, e.target.checked)}
                aria-label={t(labelKey)}
              />
              {t(labelKey)}
            </label>
          ))}
        </div>
        {stripParamsPending && (
          <p className="caveat">
            <span aria-hidden="true">⚠ </span>
            {t('stripNeedsAccess')}{' '}
            <button type="button" className="linkish" onClick={() => void requestHost()}>
              {t('grantAccess')}
            </button>
          </p>
        )}
        <p className="caveat">
          {t('annoyanceNotePre')}
          <b>{t('levelAggressiveLabel')}</b>
          {t('annoyanceNotePost')}
        </p>
      </section>

      {paused ? (
        <section className="row pause-row" role="status">
          <div className="sub">{t('pausedEverywhereLeft', { n: pauseMinutesLeft })}</div>
          <button type="button" className="pause-btn" onClick={resumeNow}>
            {t('resumeNow')}
          </button>
        </section>
      ) : (
        <section className="row pause-row">
          <div className="sub">{globallyOff ? t('alreadyOff') : t('takeBreak')}</div>
          <button
            type="button"
            className="pause-btn"
            onClick={pauseEverywhere}
            disabled={globallyOff}
          >
            {t('pauseFor', { n: PAUSE_MINUTES })}
          </button>
        </section>
      )}

      <footer className="actions">
        <button type="button" onClick={() => void browser.runtime.openOptionsPage()}>
          {t('openSettings')}
        </button>
      </footer>
    </main>
  );
}

// Renders an exact number, "—" when the platform could not measure it (null), or
// a "~"-prefixed estimate when the figure is approximate (Chromium's on-demand
// DNR read — see matched-rules.ts). An approximate value is never shown as exact,
// and an unavailable value is never shown as a fabricated 0.
function Count({
  value,
  approximate,
}: {
  value: number | null;
  approximate: boolean;
}): JSX.Element {
  return <>{formatCount(value, approximate)}</>;
}

// "Which filter lists this site's traffic hits" — a per-list block breakdown for
// the current page. Only lists with at least one block are shown. Counts carry
// the same honesty rules as the headline stats (~ for approximate on Chromium,
// exact on Firefox). Renders nothing when unmeasured or nothing matched.
function ListBreakdown({
  byList,
  approximate,
  t,
}: {
  byList: Record<string, number> | null;
  approximate: boolean;
  t: TFn;
}): JSX.Element | null {
  if (!byList) return null;
  const entries = LIST_ORDER.map((id) => [id, byList[id] ?? 0] as const).filter(
    ([, n]) => n > 0,
  );
  if (entries.length === 0) return null;
  return (
    <section className="list-breakdown" aria-live="polite">
      <h2>{t('filterListsMatched')}</h2>
      <ul>
        {entries.map(([id, n]) => (
          <li key={id}>
            <span className="list-name">{LIST_LABEL_KEY[id] ? t(LIST_LABEL_KEY[id]) : id}</span>
            <span className="list-count">{formatCount(n, approximate)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
