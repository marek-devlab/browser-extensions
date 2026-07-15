import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { browser } from '#imports';
import { LanguageSwitcher, LocaleProvider } from '@blur/ui';
import type { AdBlockLevel, AdBlockSettings } from '@blur/core';
import { publicUrl } from '../../utils/public-url';
import { adBlockPresetForLevel } from '@blur/core';
import { useSettings } from '../../utils/use-settings';
import { useStorageItem } from '../../utils/use-storage-item';
import { useHostAccess } from '../../utils/use-host-access';
import {
  statsItem,
  customFiltersItem,
  installDateItem,
  rulesetStatusItem,
  RULESET_STATUS_OK,
} from '../../utils/storage';
import type { RulesetStatus } from '../../utils/storage';
import type { CustomFilters } from '../../utils/adblock-types';
import {
  ALL_SITES,
  addFilter,
  removeFilter,
  entriesFor,
  parseCosmeticFilters,
  mergeParsed,
  toFilterText,
} from '../../utils/custom-filters';
// `parseBackup` is imported from its own PURE module, not re-exported through
// `backup.ts` — one auto-importable source per symbol, or WXT's auto-import
// scanner sees the same name exported from two modules and warns on build.
import { exportBackup, applyBackup } from '../../utils/backup';
import { parseBackup } from '../../utils/backup-parse';
import { useAdblockLocale } from '../../utils/use-locale';
import { useT, useDegradedNotice, levelLabel, levelDesc, type MsgKey } from '../../utils/i18n';

// Shape of the generated public/rules/manifest.json (see scripts/build-rulesets.mjs).
interface ManifestList {
  id: string;
  title: string;
  ruleCount: number;
  regexCount: number;
  license: string;
  enabledAt: string[];
}
interface RulesetManifest {
  buildDate: string;
  lists: ManifestList[];
}

function useManifest(): { lists: ManifestList[]; loaded: boolean } {
  const [lists, setLists] = useState<ManifestList[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void fetch(publicUrl('/rules/manifest.json'))
      .then((r) => r.json() as Promise<RulesetManifest>)
      .then((m) => setLists(m.lists))
      .catch(() => setLists([]))
      .finally(() => setLoaded(true));
  }, []);
  return { lists, loaded };
}

type Tab = 'blocking' | 'lists' | 'trackers' | 'sites' | 'filters' | 'backup' | 'about';

const TABS: { id: Tab; labelKey: MsgKey }[] = [
  { id: 'blocking', labelKey: 'tabBlocking' },
  { id: 'lists', labelKey: 'tabLists' },
  { id: 'trackers', labelKey: 'tabTrackers' },
  { id: 'sites', labelKey: 'tabSites' },
  { id: 'filters', labelKey: 'tabFilters' },
  { id: 'backup', labelKey: 'tabBackup' },
  { id: 'about', labelKey: 'tabAbout' },
];

const ADBLOCK_ORDER: AdBlockLevel[] = ['off', 'standard', 'aggressive'];

/**
 * Normalize free-form input into a bare hostname so a pasted
 * `https://example.com/path` becomes `example.com` (otherwise it never matches a
 * real host). Returns null for anything unparseable.
 */
function normalizeHost(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const host = new URL(withScheme).hostname.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

// Chrome GUARANTEES 30,000 enabled static rules per extension (PLAN.md §4.1).
// There is also a 300,000-rule GLOBAL pool shared across all installed
// extensions — best-effort, not guaranteed — but the budget we design against
// is the per-extension guarantee.
const GUARANTEED_STATIC_RULES = 30_000;

function ruleBudgetAt(lists: ManifestList[], level: AdBlockLevel): number {
  return lists
    .filter((l) => l.enabledAt.includes(level))
    .reduce((sum, l) => sum + l.ruleCount, 0);
}

export function App(): JSX.Element {
  // Owns the persisted UI language (with setLocale for the switcher) and provides
  // it to the whole options tree.
  const { locale, setLocale } = useAdblockLocale();
  return (
    <LocaleProvider locale={locale}>
      <OptionsBody locale={locale} setLocale={setLocale} />
    </LocaleProvider>
  );
}

function OptionsBody({
  locale,
  setLocale,
}: {
  locale: ReturnType<typeof useAdblockLocale>['locale'];
  setLocale: ReturnType<typeof useAdblockLocale>['setLocale'];
}): JSX.Element {
  const t = useT();
  const { settings, update, loaded } = useSettings();
  const [tab, setTab] = useState<Tab>('blocking');
  const { granted: hostGranted, request: requestHost } = useHostAccess();

  if (!loaded) return <main className="options">{t('loading')}</main>;

  const level = settings.adblock.level;

  // Strip-params needs a host grant on Chromium (its redirect rule only fires
  // with host access). Enabling it there prompts; the caveat reflects a decline.
  function setStripParams(checked: boolean): void {
    if (checked && !import.meta.env.FIREFOX && !hostGranted) void requestHost();
    update({ adblock: { ...settings.adblock, stripTrackingParams: checked } });
  }
  const stripParamsPending =
    settings.adblock.stripTrackingParams && !import.meta.env.FIREFOX && !hostGranted;

  const currentTabLabel = t(TABS.find((tt) => tt.id === tab)?.labelKey ?? 'tabBlocking');

  return (
    <main className="options">
      <h1>{t('appName')}</h1>

      <div className="master">
        <div>
          <div className="master-title">{t('masterTitle')}</div>
          <div className="note">
            {settings.enabled ? t('masterOn') : t('masterOff')}
          </div>
        </div>
        <label className="switch" title={t('toggleEverywhere')}>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={() => update({ enabled: !settings.enabled })}
            aria-label={t('toggleEverywhere')}
          />
          <span className="slider" />
        </label>
      </div>

      <div className="lang-row">
        <h2 className="lang-heading">{t('language')}</h2>
        <LanguageSwitcher locale={locale} onChange={setLocale} label={t('interfaceLanguage')} />
      </div>

      <TabBar tabs={TABS} current={tab} onSelect={setTab} />

      <div
        id="settings-panel"
        role="region"
        aria-label={t('regionAria', { name: currentTabLabel })}
      >
      {tab === 'blocking' && (
        <section className="panel">
          <div className="levels">
            {ADBLOCK_ORDER.map((lvl) => (
              <label
                key={lvl}
                className={[
                  'level',
                  level === lvl ? 'on' : '',
                  lvl === 'aggressive' ? 'warn' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <input
                  type="radio"
                  name="adblock"
                  checked={level === lvl}
                  onChange={() =>
                    update({
                      adblock: {
                        ...settings.adblock,
                        level: lvl,
                        ...adBlockPresetForLevel(lvl),
                      },
                    })
                  }
                  aria-label={levelLabel(t, lvl)}
                />
                <span className="level-label">
                  {levelLabel(t, lvl)}
                  {lvl === 'aggressive' && (
                    <span className="badge-warn">{t('mayBreakSites')}</span>
                  )}
                </span>
                <span className="level-desc">{levelDesc(t, lvl)}</span>
              </label>
            ))}
          </div>

          <h3>{t('whatEachLevel')}</h3>
          <ul className="explain">
            <li>
              <b>{t('levelOffLabel')}</b>{t('explainOff')}
            </li>
            <li>
              <b>{t('levelStandardLabel')}</b>{t('explainStandard')}
            </li>
            <li>
              <b>{t('levelAggressiveLabel')}</b>{t('explainAggressive')}
            </li>
          </ul>

          <details className="advanced">
            <summary>{t('technicalDetails')}</summary>
            <ul className="explain">
              <li>
                {t('techLevel1Pre')}
                <code>declarativeNetRequest.updateEnabledRulesets()</code>
                {t('periodOnly')}
              </li>
              <li>
                {t('techLevel2a')}
                <em>{t('emCosmeticFiltering')}</em>
                {t('techLevel2b')}
                <code>display:none</code>
                {t('techLevel2c')}
                <em>{t('emGeneric')}</em>
                {t('techLevel2d')}
              </li>
            </ul>
          </details>
        </section>
      )}

      {tab === 'lists' && (
        <ListsPanel
          level={level}
          adblock={settings.adblock}
          enabled={settings.enabled}
          onToggleList={(key, checked) =>
            update({ adblock: { ...settings.adblock, [key]: checked } })
          }
        />
      )}

      {tab === 'trackers' && (
        <section className="panel">
          <label className="chip">
            <input
              type="checkbox"
              checked={settings.adblock.blockTrackers}
              onChange={(e) =>
                update({
                  adblock: {
                    ...settings.adblock,
                    blockTrackers: e.target.checked,
                  },
                })
              }
              aria-label={t('blockKnownTrackers')}
            />
            {t('blockKnownTrackers')}
          </label>
          <label className="chip">
            <input
              type="checkbox"
              checked={settings.adblock.stripTrackingParams}
              onChange={(e) => setStripParams(e.target.checked)}
              aria-label={t('stripFromLinks')}
            />
            {t('stripFromLinks')}
          </label>
          {stripParamsPending && (
            <p className="note status-err" role="alert">
              <span aria-hidden="true">⚠ </span>
              {t('paramNeedsAccess')}{' '}
              <button type="button" className="linkish" onClick={() => void requestHost()}>
                {t('grantAccess')}
              </button>
            </p>
          )}
          <p className="note">
            {t('trackParamsNoteA')}
            <code>?utm_source=…</code>
            {t('trackParamsNoteB')}
            <code>fbclid</code>
            {t('trackParamsNoteC')}
          </p>

          <details className="advanced">
            <summary>{t('technicalDetails')}</summary>
            <p className="note">
              {t('trackTechA')}
              <code>redirect</code>
              {t('trackTechB')}
              <code>transform.queryTransform.removeParams</code>
              {t('trackTechC')}
              <b>5,000</b>
              {t('trackTechD')}
            </p>
            <p className="note">
              {t('trackTech2A')}
              <code>webRequest</code>
              {t('trackTech2B')}
              <em>{t('emDynamic')}</em>
              {t('trackTech2C')}
            </p>
          </details>
        </section>
      )}

      {tab === 'sites' && (
        <SitesPanel
          allowlist={settings.allowlist}
          onChange={(allowlist) => update({ allowlist })}
        />
      )}

      {tab === 'filters' && <FiltersPanel />}

      {tab === 'backup' && (
        <section className="panel">
          <BackupPanel />
        </section>
      )}

      {tab === 'about' && <AboutPanel />}
      </div>
    </main>
  );
}

/**
 * Accessible tab bar. These stay real `<button>`s (role=button), NOT role="tab":
 * the e2e harness locates tabs via `getByRole('button', { name })` and `e2e/` is
 * read-only. A `role="toolbar"` of buttons with roving tabindex + arrow / Home /
 * End keys, each wired to the panel via `aria-controls` and marked with
 * `aria-current`, is a valid, fully keyboard-navigable pattern that preserves the
 * locator. It renders identically to the Content Blur tablist.
 */
function TabBar({
  tabs,
  current,
  onSelect,
}: {
  tabs: { id: Tab; labelKey: MsgKey }[];
  current: Tab;
  onSelect: (id: Tab) => void;
}): JSX.Element {
  const t = useT();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: ReactKeyboardEvent<HTMLDivElement>): void {
    const i = tabs.findIndex((tt) => tt.id === current);
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabs.length - 1;
    if (j < 0) return;
    e.preventDefault();
    const target = tabs[j];
    if (!target) return;
    onSelect(target.id);
    refs.current[j]?.focus();
  }
  return (
    <div
      className="tabs"
      role="toolbar"
      aria-label={t('tabsAria')}
      aria-orientation="horizontal"
      onKeyDown={onKey}
    >
      {tabs.map((tab, idx) => (
        <button
          key={tab.id}
          type="button"
          id={`tab-${tab.id}`}
          aria-controls="settings-panel"
          aria-current={current === tab.id ? 'page' : undefined}
          tabIndex={current === tab.id ? 0 : -1}
          ref={(el) => {
            refs.current[idx] = el;
          }}
          className={current === tab.id ? 'tab on' : 'tab'}
          onClick={() => onSelect(tab.id)}
        >
          {t(tab.labelKey)}
        </button>
      ))}
    </div>
  );
}

/** Which settings toggle governs each bundled list. */
const LIST_TOGGLE_KEY: Record<
  string,
  keyof Pick<AdBlockSettings, 'blockAds' | 'blockTrackers' | 'blockAnnoyances'>
> = {
  easylist: 'blockAds',
  easyprivacy: 'blockTrackers',
  annoyances: 'blockAnnoyances',
};

function ListsPanel({
  level,
  adblock,
  enabled,
  onToggleList,
}: {
  level: AdBlockLevel;
  adblock: AdBlockSettings;
  enabled: boolean;
  onToggleList: (
    key: keyof Pick<AdBlockSettings, 'blockAds' | 'blockTrackers' | 'blockAnnoyances'>,
    checked: boolean,
  ) => void;
}): JSX.Element {
  const t = useT();
  const degradedNotice = useDegradedNotice();
  const { lists, loaded } = useManifest();
  const used = useMemo(() => ruleBudgetAt(lists, level), [lists, level]);
  const over = used > GUARANTEED_STATIC_RULES;
  const pct = Math.min(100, (used / GUARANTEED_STATIC_RULES) * 100);
  // A list only actually filters when the extension is on and not at level "off".
  const masterOn = enabled && level !== 'off';
  // Chromium only: a list is switched ON here but the browser refused to enable it
  // (shared static-rule budget exhausted). Reported by the DNR backend.
  const { value: rulesetStatus } = useStorageItem<RulesetStatus>(
    rulesetStatusItem,
    RULESET_STATUS_OK,
  );
  const degraded = !import.meta.env.FIREFOX && rulesetStatus.degraded;

  return (
    <section className="panel">
      {loaded && lists.length === 0 && (
        <p className="caveat">
          {t('noRulesetsA')}
          <code>npm run build:rules</code>
          {t('noRulesetsB')}
          <code>@adguard/dnr-rulesets</code>
          {t('periodOnly')}
        </p>
      )}
      <p className="note">
        {t('listsNote1a')}
        <b>{t('tabBlocking')}</b>
        {t('listsNote1b')}
      </p>
      <p className="note">
        {t('listsNote2a')}
        <b>{t('listAnnoyances')}</b>
        {t('listsNote2b')}
        <em>{t('emNetworkRequests')}</em>
        {t('listsNote2c')}
        <em>{t('emCosmetic')}</em>
        {t('listsNote2d')}
        <b>{t('levelAggressiveLabel')}</b>
        {t('listsNote2e')}
        <b>{t('tabBlocking')}</b>
        {t('listsNote2f')}
      </p>
      {!masterOn && (
        <p className="caveat">
          <span aria-hidden="true">⚠ </span>
          {enabled ? t('strictnessOffNote') : t('blockingOffNote')}
          {t('choicesKept')}
        </p>
      )}
      {degraded && (
        <p className="caveat" role="alert">
          <span aria-hidden="true">⚠ </span>
          {degradedNotice(rulesetStatus.dropped)}
          {t('degradedRetry')}
        </p>
      )}
      <table className="lists">
        <thead>
          <tr>
            <th>{t('thOn')}</th>
            <th>{t('thList')}</th>
            <th className="num-col">{t('thRules')}</th>
            <th>{t('thLicense')}</th>
          </tr>
        </thead>
        <tbody>
          {lists.map((l) => {
            const key = LIST_TOGGLE_KEY[l.id];
            const on = key ? adblock[key] : l.enabledAt.includes(level);
            // Switched on, but the browser could not fit it — so it is NOT active.
            const blocked = degraded && rulesetStatus.dropped.includes(l.id);
            return (
              <tr key={l.id} className={masterOn && on && !blocked ? 'active-row' : ''}>
                <td>
                  {key ? (
                    <label className="switch switch--sm" title={t('toggleList', { name: l.title })}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => onToggleList(key, e.target.checked)}
                        aria-label={t('enableList', { name: l.title })}
                      />
                      <span className="slider" />
                    </label>
                  ) : (
                    <span className="sub">{l.enabledAt.join(', ')}</span>
                  )}
                </td>
                <td>
                  {l.title}
                  {blocked && <span className="sub">{t('notActiveBudget')}</span>}
                </td>
                <td className="num-col">{l.ruleCount.toLocaleString()}</td>
                <td>{l.license}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="note">
        {t('peterLoweA')}
        <em>{t('emPersonal')}</em>
        {t('peterLoweB')}
      </p>

      {/* The rule-budget meter is developer-facing noise for a normal user, so it
          lives behind a disclosure rather than in the default view. */}
      <details className="advanced">
        <summary>{t('techBudget')}</summary>
        <div className="budget">
          <div className="budget-head">
            <span>
              {t('budgetAt')}<b>{levelLabel(t, level)}</b>
            </span>
            <span className={over ? 'over' : ''}>
              {used.toLocaleString()} / {GUARANTEED_STATIC_RULES.toLocaleString()}
            </span>
          </div>
          <div className="meter">
            <div
              className={`meter-fill ${over ? 'over' : ''}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {over && (
            <p className="caveat">
              <span aria-hidden="true">⚠ </span>
              {t('budgetOver')}
            </p>
          )}
        </div>
        <p className="note">
          {t('budgetNoteA')}
          <b>30,000</b>
          {t('budgetNoteB')}
          <b>300,000</b>
          {t('budgetNoteC')}
        </p>
      </details>
    </section>
  );
}

function SitesPanel({
  allowlist,
  onChange,
}: {
  allowlist: string[];
  onChange: (next: string[]) => void;
}): JSX.Element {
  const t = useT();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bulk, setBulk] = useState('');
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);

  function add(): void {
    const host = normalizeHost(draft);
    if (!host) {
      setError(t('invalidSite'));
      return;
    }
    if (allowlist.includes(host)) {
      setError(t('alreadyExcluded', { host }));
      return;
    }
    setError(null);
    onChange([...allowlist, host]);
    setDraft('');
  }

  // Bulk import: one host (or URL) per line or comma-separated. Each is normalized
  // to a bare host and merged into the allowlist, deduped; unparseable lines are
  // reported as skipped. Mirrors the "My filters" paste-import flow.
  function importBulk(): void {
    const tokens = bulk.split(/[\s,]+/).filter(Boolean);
    if (tokens.length === 0) {
      setBulkStatus(t('nothingToImport'));
      return;
    }
    const next = new Set(allowlist);
    let added = 0;
    let skipped = 0;
    for (const token of tokens) {
      const host = normalizeHost(token);
      if (!host) {
        skipped += 1;
        continue;
      }
      if (!next.has(host)) {
        next.add(host);
        added += 1;
      }
    }
    onChange([...next]);
    setBulk('');
    const addedMsg = t(added === 1 ? 'addedSiteOne' : 'addedSiteOther', { n: added });
    const skippedMsg =
      skipped > 0 ? t(skipped === 1 ? 'skippedLineOne' : 'skippedLineOther', { n: skipped }) : t('periodOnly');
    setBulkStatus(addedMsg + skippedMsg);
  }

  return (
    <section className="panel">
      <p className="note">
        {t('sitesNoteA')}
        <code>https://example.com/page</code>
        {t('sitesNoteB')}
        <code>example.com</code>
        {t('sitesNoteC')}
      </p>
      <div className="field">
        <input
          type="text"
          placeholder={t('placeholderSite')}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          aria-label={t('excludeAria')}
        />
        <button type="button" onClick={add}>
          {t('addBtn')}
        </button>
      </div>
      {error && (
        <p className="note status-err" role="alert">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
      {allowlist.length === 0 ? (
        <p className="note empty-hint">{t('noExcluded')}</p>
      ) : (
        <ul className="allowlist">
          {allowlist.map((host) => (
            <li key={host}>
              <span>{host}</span>
              <button
                type="button"
                onClick={() => onChange(allowlist.filter((h) => h !== host))}
                aria-label={t('removeHost', { host })}
              >
                {t('removeBtn')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>{t('bulkImport')}</h3>
      <p className="note">{t('bulkNote')}</p>
      <textarea
        className="filter-paste"
        rows={4}
        placeholder={'example.com\nnews.example.org'}
        value={bulk}
        onChange={(e) => {
          setBulk(e.target.value);
          if (bulkStatus) setBulkStatus(null);
        }}
        aria-label={t('bulkAria')}
      />
      <div className="field">
        <button type="button" onClick={importBulk}>
          {t('importSites')}
        </button>
      </div>
      {bulkStatus && (
        <p className="note" role="status" aria-live="polite">
          {bulkStatus}
        </p>
      )}

      <h3>{t('exportHeading')}</h3>
      <textarea
        className="filter-paste"
        rows={4}
        readOnly
        value={allowlist.join('\n')}
        aria-label={t('sitesExportAria')}
        onFocus={(e) => e.currentTarget.select()}
      />
    </section>
  );
}

// Custom cosmetic-filter management (features §2 and §6): list/add/remove the
// user's own per-site selectors, plus paste-import EasyList `##selector` lines
// and text export.
function FiltersPanel(): JSX.Element {
  const t = useT();
  const { value: filters, update, loaded } = useStorageItem<CustomFilters>(
    customFiltersItem,
    {},
  );
  const [host, setHost] = useState('');
  const [selector, setSelector] = useState('');
  const [paste, setPaste] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const hosts = Object.keys(filters).sort((a, b) =>
    a === ALL_SITES ? -1 : b === ALL_SITES ? 1 : a.localeCompare(b),
  );

  function addOne(): void {
    const sel = selector.trim();
    if (!sel) return;
    update(addFilter(filters, host.trim().toLowerCase(), sel));
    setSelector('');
    setStatus(null);
  }

  function importPasted(): void {
    const { filters: parsed, skipped } = parseCosmeticFilters(paste);
    if (parsed.length === 0 && skipped.length === 0) {
      setStatus(t('nothingToImport'));
      return;
    }
    update(mergeParsed(filters, parsed));
    setPaste('');
    const importedMsg = t(parsed.length === 1 ? 'importedRuleOne' : 'importedRuleOther', {
      n: parsed.length,
    });
    const skippedMsg =
      skipped.length > 0 ? t('skippedRules', { n: skipped.length }) : t('periodOnly');
    setStatus(importedMsg + skippedMsg);
  }

  if (!loaded) return <section className="panel">{t('loading')}</section>;

  return (
    <section className="panel">
      <p className="note">
        {t('filtersNote1a')}
        <code>display:none</code>
        {t('filtersNote1b')}
        <em>{t('emEvery')}</em>
        {t('filtersNote1c')}
        <b>{t('boldBlockAnElement')}</b>
        {t('filtersNote1d')}
      </p>
      <p className="note">
        {t('filtersNote2a')}
        <b>{t('boldUndo')}</b>
        {t('filtersNote2b')}
        <em>{t('emOnSiteYouAreOn')}</em>
        {t('filtersNote2c')}
        <b>{t('boldRestore')}</b>
        {t('filtersNote2d')}
      </p>

      <h3>{t('addRule')}</h3>
      <div className="field filter-add">
        <input
          type="text"
          placeholder={t('placeholderHost')}
          value={host}
          onChange={(e) => setHost(e.target.value)}
          aria-label={t('hostAria')}
        />
        <input
          type="text"
          placeholder={t('placeholderSelector')}
          value={selector}
          onChange={(e) => setSelector(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addOne()}
          aria-label={t('selectorAria')}
        />
        <button type="button" onClick={addOne}>
          {t('addBtn')}
        </button>
      </div>

      <h3>{t('yourRules')}</h3>
      {hosts.length === 0 ? (
        <p className="note empty-hint">{t('noCustomRules')}</p>
      ) : (
        <ul className="filter-list">
          {hosts.map((h) => (
            <li key={h} className="filter-host">
              <div className="filter-host-name">{h === ALL_SITES ? t('allSites') : h}</div>
              <ul>
                {/* Rules picked with the element picker carry the human label
                    captured at pick time; ones typed here or pasted have none and
                    degrade to the selector alone — exactly the old rendering. */}
                {entriesFor(filters, h).map((entry) => (
                  <li key={entry.selector} className="filter-row">
                    <span className="filter-what">
                      {entry.label && <span className="filter-label">{entry.label}</span>}
                      <code>{entry.selector}</code>
                    </span>
                    <button
                      type="button"
                      onClick={() => update(removeFilter(filters, h, entry.selector))}
                      aria-label={t('removeSelector', { selector: entry.selector, host: h })}
                    >
                      {t('removeBtn')}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <h3>{t('importHeading')}</h3>
      <p className="note">
        {t('importNoteA')}
        <code>example.com##.ad-box</code>
        {t('importNoteB')}
        <code>##.global-ad</code>
        {t('importNoteC')}
        {t('importNoteD')}
      </p>
      <textarea
        className="filter-paste"
        rows={4}
        placeholder="example.com##.sponsored"
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        aria-label={t('pasteAria')}
      />
      <div className="field">
        <button type="button" onClick={importPasted}>
          {t('importPastedBtn')}
        </button>
      </div>
      {status && (
        <p className="note" role="status" aria-live="polite">
          {status}
        </p>
      )}

      <h3>{t('exportHeading')}</h3>
      <textarea
        className="filter-paste"
        rows={4}
        readOnly
        value={toFilterText(filters)}
        aria-label={t('filtersExportAria')}
        onFocus={(e) => e.currentTarget.select()}
      />
    </section>
  );
}

// Full settings/allowlist/filters backup as JSON (feature §4).
function BackupPanel(): JSX.Element {
  const t = useT();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function doExport(): Promise<void> {
    const backup = await exportBackup();
    setText(JSON.stringify(backup, null, 2));
    setStatus(t('exportedStatus'));
    setError(null);
  }

  function download(): void {
    const blob = new Blob([text || '{}'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'adblock-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doImport(): Promise<void> {
    try {
      const backup = parseBackup(text);
      await applyBackup(backup);
      setStatus(t('importedApplied'));
      setError(null);
    } catch (err) {
      // Invalid/garbage JSON surfaces a friendly message, never a crash.
      setError(t('importFailed', { msg: err instanceof Error ? err.message : String(err) }));
      setStatus(null);
    }
  }

  return (
    <div className="backup">
      <h3>{t('backupRestore')}</h3>
      <p className="note">{t('backupNote')}</p>
      <div className="field">
        <button type="button" onClick={() => void doExport()}>
          {t('exportBtn')}
        </button>
        <button type="button" onClick={download} disabled={!text}>
          {t('downloadJson')}
        </button>
        <button type="button" onClick={() => void doImport()} disabled={!text.trim()}>
          {t('importBtn')}
        </button>
      </div>
      <textarea
        className="filter-paste"
        rows={8}
        placeholder={t('backupPlaceholder')}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        aria-label={t('backupAria')}
      />
      {status && (
        <p className="note status-ok" role="status">
          <span aria-hidden="true">✓ </span>
          {status}
        </p>
      )}
      {error && (
        <p className="note status-err" role="alert">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
    </div>
  );
}

function AboutPanel(): JSX.Element {
  const t = useT();
  const [version, setVersion] = useState('—');
  const [installDate, setInstallDate] = useState('');
  useEffect(() => {
    void statsItem.getValue().then((s) => setVersion(s.filterListVersion));
    void installDateItem.getValue().then(setInstallDate);
  }, []);
  return (
    <section className="panel">
      <p>
        {t('filterListBuild')}<b>{version}</b>
      </p>
      {installDate && (
        <p className="note">
          {t('countingSince')}<b>{installDate}</b>{t('periodOnly')}
        </p>
      )}
      <p className="note">{t('privacyNote')}</p>
      <p className="note">{t('companionNote')}</p>
      <ResetStatsControl />
      <BackupPanel />
    </section>
  );
}

// Resets the lifetime aggregate (today / week / total) shown in the toolbar
// popup — the only counter that is otherwise never clearable from the UI. Uses a
// two-step in-page confirm (not a blocking `window.confirm`) so the destructive
// action always takes a deliberate second click.
function ResetStatsControl(): JSX.Element {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  async function reset(): Promise<void> {
    await browser.runtime.sendMessage({ type: 'resetStats' }).catch(() => {});
    setConfirming(false);
    setDone(true);
  }

  return (
    <div className="reset-stats">
      <h3>{t('statisticsHeading')}</h3>
      <p className="note">{t('resetNote')}</p>
      {confirming ? (
        <div className="field">
          <button type="button" className="linkish" onClick={() => void reset()}>
            {t('confirmReset')}
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            {t('cancel')}
          </button>
        </div>
      ) : (
        <div className="field">
          <button
            type="button"
            onClick={() => {
              setDone(false);
              setConfirming(true);
            }}
          >
            {t('resetStats')}
          </button>
        </div>
      )}
      {done && (
        <p className="note status-ok" role="status">
          <span aria-hidden="true">✓ </span>
          {t('statsReset')}
        </p>
      )}
    </div>
  );
}
