import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { browser } from '#imports';
import type { AdBlockLevel, AdBlockSettings } from '@blur/core';
import { publicUrl } from '../../utils/public-url';
import { ADBLOCK_LEVELS, adBlockPresetForLevel } from '@blur/core';
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
import { degradedNotice } from '../../utils/backends/rule-budget';
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

const TABS: { id: Tab; label: string }[] = [
  { id: 'blocking', label: 'Blocking' },
  { id: 'lists', label: 'Filter lists' },
  { id: 'trackers', label: 'Trackers' },
  { id: 'sites', label: 'Sites' },
  { id: 'filters', label: 'My filters' },
  { id: 'backup', label: 'Backup' },
  { id: 'about', label: 'About' },
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
  const { settings, update, loaded } = useSettings();
  const [tab, setTab] = useState<Tab>('blocking');
  const { granted: hostGranted, request: requestHost } = useHostAccess();

  if (!loaded) return <main className="options">Loading…</main>;

  const level = settings.adblock.level;

  // Strip-params needs a host grant on Chromium (its redirect rule only fires
  // with host access). Enabling it there prompts; the caveat reflects a decline.
  function setStripParams(checked: boolean): void {
    if (checked && !import.meta.env.FIREFOX && !hostGranted) void requestHost();
    update({ adblock: { ...settings.adblock, stripTrackingParams: checked } });
  }
  const stripParamsPending =
    settings.adblock.stripTrackingParams && !import.meta.env.FIREFOX && !hostGranted;

  return (
    <main className="options">
      <h1>Ad &amp; Tracker Blocker</h1>

      <div className="master">
        <div>
          <div className="master-title">Ad &amp; tracker blocking</div>
          <div className="note">
            {settings.enabled
              ? 'On — filtering runs on every site except those you exclude below.'
              : 'Off — nothing is blocked or hidden on any site.'}
          </div>
        </div>
        <label className="switch" title="Turn blocking on or off everywhere">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={() => update({ enabled: !settings.enabled })}
            aria-label="Turn blocking on or off everywhere"
          />
          <span className="slider" />
        </label>
      </div>

      <TabBar tabs={TABS} current={tab} onSelect={setTab} />

      <div
        id="settings-panel"
        role="region"
        aria-label={`${TABS.find((t) => t.id === tab)?.label ?? ''} settings`}
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
                  aria-label={ADBLOCK_LEVELS[lvl].label}
                />
                <span className="level-label">
                  {ADBLOCK_LEVELS[lvl].label}
                  {lvl === 'aggressive' && (
                    <span className="badge-warn">may break sites</span>
                  )}
                </span>
                <span className="level-desc">
                  {ADBLOCK_LEVELS[lvl].description}
                </span>
              </label>
            ))}
          </div>

          <h3>What each level does</h3>
          <ul className="explain">
            <li>
              <b>Off</b> — nothing is blocked or hidden.
            </li>
            <li>
              <b>Standard</b> — blocks ads and known trackers, and hides ad slots
              on sites we have specific rules for. Safe on virtually every site.
            </li>
            <li>
              <b>Aggressive</b> — also hides common page clutter everywhere (cookie
              banners, newsletter pop-ups, leftover ad boxes). More thorough, but
              can occasionally break a site's layout.
            </li>
          </ul>

          <details className="advanced">
            <summary>Technical details</summary>
            <ul className="explain">
              <li>
                Each level toggles the bundled static rulesets via{' '}
                <code>declarativeNetRequest.updateEnabledRulesets()</code>.
              </li>
              <li>
                "Hiding page clutter" is <em>cosmetic filtering</em> —{' '}
                <code>display:none</code> rules injected by the content script.
                Only <em>generic</em> cosmetic filtering (selectors applied on
                every site) is enabled at Aggressive; it is what occasionally
                breaks layouts, so it stays off at Standard.
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
              aria-label="Block known trackers"
            />
            Block known trackers
          </label>
          <label className="chip">
            <input
              type="checkbox"
              checked={settings.adblock.stripTrackingParams}
              onChange={(e) => setStripParams(e.target.checked)}
              aria-label="Strip tracking parameters from links"
            />
            Strip tracking parameters from links
          </label>
          {stripParamsPending && (
            <p className="note status-err" role="alert">
              <span aria-hidden="true">⚠ </span>
              Parameter stripping needs site access to run on this browser.{' '}
              <button type="button" className="linkish" onClick={() => void requestHost()}>
                Grant access
              </button>
            </p>
          )}
          <p className="note">
            Tracking parameters are the extra tags added to links (like{' '}
            <code>?utm_source=…</code> or <code>fbclid</code>) that let sites
            follow you between pages. Removing them takes you to the same
            destination without the tracking tag.
          </p>

          <details className="advanced">
            <summary>Technical details</summary>
            <p className="note">
              Parameter stripping is a single DNR <code>redirect</code> rule using{' '}
              <code>transform.queryTransform.removeParams</code>. Rules that
              rewrite a URL count as "unsafe" and are capped at <b>5,000</b> across
              the extension (PLAN.md §4.1).
            </p>
            <p className="note">
              A future addition: a Privacy Badger–style heuristic that flags a
              domain as a tracker once it is seen on ≥3 unrelated sites. EFF ported
              Privacy Badger to MV3 in 2024, learning by observing{' '}
              <code>webRequest</code> and blocking via <em>dynamic</em> DNR rules
              (PLAN.md §4.3).
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
  tabs: { id: Tab; label: string }[];
  current: Tab;
  onSelect: (id: Tab) => void;
}): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: ReactKeyboardEvent<HTMLDivElement>): void {
    const i = tabs.findIndex((t) => t.id === current);
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
      aria-label="Settings sections"
      aria-orientation="horizontal"
      onKeyDown={onKey}
    >
      {tabs.map((t, idx) => (
        <button
          key={t.id}
          type="button"
          id={`tab-${t.id}`}
          aria-controls="settings-panel"
          aria-current={current === t.id ? 'page' : undefined}
          tabIndex={current === t.id ? 0 : -1}
          ref={(el) => {
            refs.current[idx] = el;
          }}
          className={current === t.id ? 'tab on' : 'tab'}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
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
          No generated rulesets found. Run <code>npm run build:rules</code> to build them from{' '}
          <code>@adguard/dnr-rulesets</code>.
        </p>
      )}
      <p className="note">
        Turn individual lists on or off. Picking a strictness level on the{' '}
        <b>Blocking</b> tab sets these as a starting point; you can then override
        any single list here.
      </p>
      <p className="note">
        The <b>Annoyances</b> list blocks <em>network requests</em> for
        cookie-consent and newsletter widgets. Hiding leftover on-page clutter
        (cookie banners, pop-ups) is <em>cosmetic</em> filtering — governed by the{' '}
        <b>Aggressive</b> strictness level on the <b>Blocking</b> tab, not by this
        toggle. Turning this list off still leaves that clutter hidden at
        Aggressive.
      </p>
      {!masterOn && (
        <p className="caveat">
          <span aria-hidden="true">⚠ </span>
          {enabled
            ? 'Strictness is Off, so no list filters right now.'
            : 'Blocking is turned off everywhere, so no list filters right now.'}{' '}
          Your choices below are kept and apply once it is back on.
        </p>
      )}
      {degraded && (
        <p className="caveat" role="alert">
          <span aria-hidden="true">⚠ </span>
          {degradedNotice(rulesetStatus.dropped)} Its switch stays on below, and it
          is retried automatically — it will start filtering as soon as the budget
          allows.
        </p>
      )}
      <table className="lists">
        <thead>
          <tr>
            <th>On</th>
            <th>List</th>
            <th className="num-col">Rules</th>
            <th>License</th>
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
                    <label className="switch switch--sm" title={`Toggle ${l.title}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => onToggleList(key, e.target.checked)}
                        aria-label={`Enable ${l.title}`}
                      />
                      <span className="slider" />
                    </label>
                  ) : (
                    <span className="sub">{l.enabledAt.join(', ')}</span>
                  )}
                </td>
                <td>
                  {l.title}
                  {blocked && (
                    <span className="sub"> — not active (no rule budget)</span>
                  )}
                </td>
                <td className="num-col">{l.ruleCount.toLocaleString()}</td>
                <td>{l.license}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="note">
        Peter Lowe's list is free for <em>personal / non-commercial</em> use only
        and needs permission for commercial redistribution, so it is deliberately
        NOT bundled here.
      </p>

      {/* The rule-budget meter is developer-facing noise for a normal user, so it
          lives behind a disclosure rather than in the default view. */}
      <details className="advanced">
        <summary>Technical details (rule budget)</summary>
        <div className="budget">
          <div className="budget-head">
            <span>
              Rule budget at <b>{ADBLOCK_LEVELS[level].label}</b>
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
              Exceeds Chrome's guaranteed 30,000 static rules. The overflow falls
              back to the shared 300,000 global pool, which is best-effort and can
              be exhausted by other extensions.
            </p>
          )}
        </div>
        <p className="note">
          Chrome guarantees <b>30,000</b> enabled static rules per extension, plus a{' '}
          <b>300,000</b>-rule pool shared across all installed extensions. A full
          EasyList + EasyPrivacy set fits inside the per-extension guarantee.
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
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bulk, setBulk] = useState('');
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);

  function add(): void {
    const host = normalizeHost(draft);
    if (!host) {
      setError('Enter a valid site, e.g. example.com.');
      return;
    }
    if (allowlist.includes(host)) {
      setError(`${host} is already excluded.`);
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
      setBulkStatus('Nothing to import.');
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
    setBulkStatus(
      `Added ${added} site${added === 1 ? '' : 's'}` +
        (skipped > 0 ? `; skipped ${skipped} unparseable line${skipped === 1 ? '' : 's'}.` : '.'),
    );
  }

  return (
    <section className="panel">
      <p className="note">
        Sites listed here are fully excluded — no network or cosmetic filtering
        runs on them. Paste a full URL or just the hostname; it is normalized to a
        bare host (e.g. <code>https://example.com/page</code> → <code>example.com</code>).
      </p>
      <div className="field">
        <input
          type="text"
          placeholder="example.com or https://example.com/page"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          aria-label="Site to exclude from blocking"
        />
        <button type="button" onClick={add}>
          Add
        </button>
      </div>
      {error && (
        <p className="note status-err" role="alert">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
      {allowlist.length === 0 ? (
        <p className="note empty-hint">
          No excluded sites yet. Add a hostname above to turn blocking off for
          that site.
        </p>
      ) : (
        <ul className="allowlist">
          {allowlist.map((host) => (
            <li key={host}>
              <span>{host}</span>
              <button
                type="button"
                onClick={() => onChange(allowlist.filter((h) => h !== host))}
                aria-label={`Remove ${host}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>Bulk import</h3>
      <p className="note">
        One site per line (or comma-separated). Full URLs are accepted and
        normalized to a bare host. Existing entries are skipped.
      </p>
      <textarea
        className="filter-paste"
        rows={4}
        placeholder={'example.com\nnews.example.org'}
        value={bulk}
        onChange={(e) => {
          setBulk(e.target.value);
          if (bulkStatus) setBulkStatus(null);
        }}
        aria-label="Sites to exclude, one per line"
      />
      <div className="field">
        <button type="button" onClick={importBulk}>
          Import sites
        </button>
      </div>
      {bulkStatus && (
        <p className="note" role="status" aria-live="polite">
          {bulkStatus}
        </p>
      )}

      <h3>Export</h3>
      <textarea
        className="filter-paste"
        rows={4}
        readOnly
        value={allowlist.join('\n')}
        aria-label="Excluded sites as text"
        onFocus={(e) => e.currentTarget.select()}
      />
    </section>
  );
}

// Custom cosmetic-filter management (features §2 and §6): list/add/remove the
// user's own per-site selectors, plus paste-import EasyList `##selector` lines
// and text export.
function FiltersPanel(): JSX.Element {
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
      setStatus('Nothing to import.');
      return;
    }
    update(mergeParsed(filters, parsed));
    setPaste('');
    setStatus(
      `Imported ${parsed.length} cosmetic rule${parsed.length === 1 ? '' : 's'}` +
        (skipped.length > 0
          ? `; skipped ${skipped.length} (network rules and unsupported syntax — see below).`
          : '.'),
    );
  }

  if (!loaded) return <section className="panel">Loading…</section>;

  return (
    <section className="panel">
      <p className="note">
        Your own cosmetic rules hide elements with <code>display:none</code>. They
        apply at <em>every</em> level (even Standard) because they are your explicit
        choice — unlike the generic list, which only turns on at Aggressive. Use{' '}
        <b>Block an element on this page</b> in the toolbar popup to pick visually.
      </p>
      <p className="note">
        To bring one back you do not need this page: right after you hide an
        element the page itself offers <b>Undo</b>, and the toolbar popup lists
        everything you have hidden <em>on the site you are on</em> with a{' '}
        <b>Restore</b> button for each. This tab is the full, cross-site list.
      </p>

      <h3>Add a rule</h3>
      <div className="field filter-add">
        <input
          type="text"
          placeholder="host (blank = all sites)"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          aria-label="Host for this cosmetic rule (blank for all sites)"
        />
        <input
          type="text"
          placeholder="CSS selector, e.g. .promo-box"
          value={selector}
          onChange={(e) => setSelector(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addOne()}
          aria-label="CSS selector to hide"
        />
        <button type="button" onClick={addOne}>
          Add
        </button>
      </div>

      <h3>Your rules</h3>
      {hosts.length === 0 ? (
        <p className="note empty-hint">No custom rules yet.</p>
      ) : (
        <ul className="filter-list">
          {hosts.map((h) => (
            <li key={h} className="filter-host">
              <div className="filter-host-name">{h === ALL_SITES ? 'All sites' : h}</div>
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
                      aria-label={`Remove ${entry.selector} from ${h}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <h3>Import (paste EasyList cosmetic rules)</h3>
      <p className="note">
        One rule per line: <code>example.com##.ad-box</code> (site-specific) or{' '}
        <code>##.global-ad</code> (all sites). Network rules and extended
        (non-CSS) syntax are skipped — network blocking is handled by the bundled
        DNR rulesets, and remote list fetching is out of scope (it needs extra host
        permissions and review).
      </p>
      <textarea
        className="filter-paste"
        rows={4}
        placeholder="example.com##.sponsored"
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        aria-label="Paste EasyList cosmetic rules"
      />
      <div className="field">
        <button type="button" onClick={importPasted}>
          Import pasted rules
        </button>
      </div>
      {status && (
        <p className="note" role="status" aria-live="polite">
          {status}
        </p>
      )}

      <h3>Export</h3>
      <textarea
        className="filter-paste"
        rows={4}
        readOnly
        value={toFilterText(filters)}
        aria-label="Your cosmetic rules as text"
        onFocus={(e) => e.currentTarget.select()}
      />
    </section>
  );
}

// Full settings/allowlist/filters backup as JSON (feature §4).
function BackupPanel(): JSX.Element {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function doExport(): Promise<void> {
    const backup = await exportBackup();
    setText(JSON.stringify(backup, null, 2));
    setStatus('Exported. Copy the JSON below or download it.');
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
      setStatus('Imported and applied.');
      setError(null);
    } catch (err) {
      // Invalid/garbage JSON surfaces a friendly message, never a crash.
      setError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      setStatus(null);
    }
  }

  return (
    <div className="backup">
      <h3>Backup &amp; restore</h3>
      <p className="note">
        Export your settings, excluded sites, per-site options and custom filters
        as JSON — or paste a previously exported document and import it.
      </p>
      <div className="field">
        <button type="button" onClick={() => void doExport()}>
          Export
        </button>
        <button type="button" onClick={download} disabled={!text}>
          Download .json
        </button>
        <button type="button" onClick={() => void doImport()} disabled={!text.trim()}>
          Import
        </button>
      </div>
      <textarea
        className="filter-paste"
        rows={8}
        placeholder="Exported JSON appears here; paste JSON to import."
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        aria-label="Settings backup JSON"
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
  const [version, setVersion] = useState('—');
  const [installDate, setInstallDate] = useState('');
  useEffect(() => {
    void statsItem.getValue().then((s) => setVersion(s.filterListVersion));
    void installDateItem.getValue().then(setInstallDate);
  }, []);
  return (
    <section className="panel">
      <p>
        Filter list build: <b>{version}</b>
      </p>
      {installDate && (
        <p className="note">
          Counting since <b>{installDate}</b>.
        </p>
      )}
      <p className="note">
        Privacy: no browsing data leaves your device. Filtering, counting and
        allowlisting all happen locally.
      </p>
      <p className="note">
        Content blurring and the developer toolkit are separate companion
        extensions in this suite — each ships on its own to keep every add-on to
        one narrow purpose (PLAN.md §0).
      </p>
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
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  async function reset(): Promise<void> {
    await browser.runtime.sendMessage({ type: 'resetStats' }).catch(() => {});
    setConfirming(false);
    setDone(true);
  }

  return (
    <div className="reset-stats">
      <h3>Statistics</h3>
      <p className="note">
        The lifetime counter (today, this week and total) shown in the toolbar
        popup. Resetting clears it to zero and can't be undone.
      </p>
      {confirming ? (
        <div className="field">
          <button type="button" className="linkish" onClick={() => void reset()}>
            Confirm reset
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Cancel
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
            Reset statistics
          </button>
        </div>
      )}
      {done && (
        <p className="note status-ok" role="status">
          <span aria-hidden="true">✓ </span>
          Statistics reset to zero.
        </p>
      )}
    </div>
  );
}
