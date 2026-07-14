import { useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { browser } from '#imports';
import type { BlurSettings, BlurTabStats, RevealMode } from '@blur/core';
import { isAllowlisted, resolveBlurSettings } from '@blur/core';
import { useSettings } from '../../utils/use-settings';
import { useStorageItem } from '../../utils/use-storage-item';
import { siteConfigsItem } from '../../utils/storage';
import {
  BLUR_PRESETS,
  presetForRadius,
  setSiteOverride,
  clearSiteOverride,
  hasSiteOverride,
  type PresetName,
  type BlurOverrideKey,
} from '../../utils/features';

function emptyStats(tabId: number, hostname: string): BlurTabStats {
  return { tabId, hostname, imagesBlurred: 0, videosBlurred: 0, textMatchesBlurred: 0 };
}

const BLUR_TARGETS: { key: BlurOverrideKey; label: string }[] = [
  { key: 'images', label: 'Images' },
  { key: 'video', label: 'Video' },
  { key: 'posters', label: 'Thumbnails & posters' },
  { key: 'text', label: 'Text' },
];

const REVEAL_MODES: { value: RevealMode; label: string }[] = [
  { value: 'hover', label: 'On hover' },
  { value: 'click', label: 'On click' },
  { value: 'never', label: 'Never' },
];

type Scope = 'global' | 'site';

function useActiveTab(): { hostname: string; tabId: number } {
  const [state, setState] = useState({ hostname: '', tabId: -1 });
  useEffect(() => {
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab) return;
      const tabId = tab.id ?? -1;
      let hostname = '';
      try {
        if (tab.url) hostname = new URL(tab.url).hostname;
      } catch {
        // Non-web tabs (chrome://, about:) have no parseable host.
      }
      setState({ hostname, tabId });
    });
  }, []);
  return state;
}

export function App(): JSX.Element {
  const { settings, update, loaded, error } = useSettings();
  const { value: siteConfigs, setValue: setSiteConfigs } = useStorageItem(siteConfigsItem);
  const { hostname, tabId } = useActiveTab();
  const [tabStats, setTabStats] = useState<BlurTabStats>(() => emptyStats(-1, ''));
  const [scope, setScope] = useState<Scope>('global');

  useEffect(() => {
    if (tabId < 0) return;
    void browser.runtime
      .sendMessage({ type: 'getTabStats', tabId })
      .then((stats: BlurTabStats | undefined) => setTabStats(stats ?? emptyStats(tabId, hostname)))
      .catch(() => setTabStats(emptyStats(tabId, hostname)));
  }, [tabId, hostname]);

  const siteConfig = hostname ? siteConfigs[hostname] : undefined;
  // What the current tab actually gets, once global + per-site are merged.
  const effective = resolveBlurSettings(settings, siteConfig).blur;
  const editingSite = scope === 'site' && hostname.length > 0;
  const shown = editingSite ? effective : settings.blur;

  // Radius drags fire continuously; keep the slider responsive locally but
  // debounce the storage write so the content script isn't re-applied per tick.
  const [radius, setRadius] = useState(shown.radius);
  useEffect(() => setRadius(shown.radius), [shown.radius]);
  const radiusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(radiusTimer.current), []);

  // Subdomain-aware: an `example.com` entry also covers `www.example.com`, so the
  // popup reports "Paused" (not "Active") on the subdomain the user allowlisted.
  const siteAllowlisted = isAllowlisted(settings.allowlist, hostname);
  const hasHost = hostname.length > 0;
  const siteEnabled = settings.enabled && !siteAllowlisted;

  // Roving-tabindex + arrow-key navigation for the Global / This site tablist.
  const scopeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  function onScopeKey(e: ReactKeyboardEvent<HTMLDivElement>): void {
    const order: Scope[] = ['global', 'site'];
    let next: Scope | undefined;
    if (e.key === 'ArrowRight' || e.key === 'End') next = 'site';
    else if (e.key === 'ArrowLeft' || e.key === 'Home') next = 'global';
    if (!next) return;
    if (next === 'site' && !hasHost) return; // can't scope to a page with no host
    e.preventDefault();
    setScope(next);
    scopeRefs.current[order.indexOf(next)]?.focus();
  }

  function toggleSite(): void {
    if (!hasHost) return;
    const allow = new Set(settings.allowlist);
    if (allow.has(hostname)) allow.delete(hostname);
    else allow.add(hostname);
    update({ allowlist: [...allow] });
  }

  function setBlurField(patch: Partial<BlurSettings>): void {
    if (editingSite) {
      setSiteConfigs(setSiteOverride(siteConfigs, hostname, { blur: patch }));
    } else {
      // Only the changed fields: `update` deep-merges onto the freshest stored
      // `blur`, so a stale `settings.blur` spread here would clobber a concurrent
      // same-tick edit to another blur field (C4).
      update({ blur: patch });
    }
  }

  function onRadiusChange(next: number): void {
    setRadius(next);
    clearTimeout(radiusTimer.current);
    radiusTimer.current = setTimeout(() => setBlurField({ radius: next }), 200);
  }

  function applyPreset(name: PresetName): void {
    setRadius(BLUR_PRESETS[name].radius);
    setBlurField({ radius: BLUR_PRESETS[name].radius });
  }

  if (!loaded) return <main className="popup">Loading…</main>;

  const activePreset = presetForRadius(radius);

  return (
    <main className="popup">
      <header className="row master">
        <div>
          <div className="host">Content Blur</div>
          <div className="sub">{settings.enabled ? 'Enabled' : 'Disabled everywhere'}</div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            aria-label="Enable Content Blur globally"
            checked={settings.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <span className="slider" />
        </label>
      </header>

      {error && (
        <p className="note status-err" role="alert">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}

      <section className="row site">
        <div>
          <div className="host">{hasHost ? hostname : 'This page'}</div>
          <div className="sub">
            {!settings.enabled
              ? 'Global switch is off'
              : siteEnabled
                ? 'Active on this site'
                : 'Paused on this site'}
          </div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            aria-label={`Blur on ${hasHost ? hostname : 'this site'}`}
            checked={siteEnabled}
            disabled={!settings.enabled || !hasHost}
            onChange={toggleSite}
          />
          <span className="slider" />
        </label>
      </section>

      {hasHost ? (
        // Counts are EXACT (read from the engine's per-label tally), so a real 0
        // is honest and shown as 0 — never faked, never hidden.
        <section className="stats" aria-live="polite">
          <div className="stat">
            <span className="num">{tabStats.imagesBlurred}</span>
            <span className="lbl">Images &amp; thumbnails</span>
          </div>
          <div className="stat">
            <span className="num">{tabStats.videosBlurred}</span>
            <span className="lbl">Videos</span>
          </div>
          <div className="stat">
            <span className="num">{tabStats.textMatchesBlurred}</span>
            <span className="lbl">Text</span>
          </div>
        </section>
      ) : (
        // chrome://, about:, the New Tab page etc. have no host to run on — a real
        // empty state, never a 0/0/0 grid that reads as broken.
        <p className="empty" role="status">
          Content Blur can’t run on this page.
        </p>
      )}

      <section className="group">
        <div className="scope-row">
          <h2>Blur</h2>
          <div
            className="scope"
            role="tablist"
            aria-label="Settings apply to"
            onKeyDown={onScopeKey}
          >
            <button
              type="button"
              role="tab"
              id="scope-tab-global"
              aria-controls="scope-panel"
              ref={(el) => {
                scopeRefs.current[0] = el;
              }}
              aria-selected={scope === 'global'}
              tabIndex={scope === 'global' ? 0 : -1}
              className={scope === 'global' ? 'seg on' : 'seg'}
              onClick={() => setScope('global')}
            >
              Global
            </button>
            <button
              type="button"
              role="tab"
              id="scope-tab-site"
              aria-controls="scope-panel"
              ref={(el) => {
                scopeRefs.current[1] = el;
              }}
              aria-selected={scope === 'site'}
              tabIndex={scope === 'site' ? 0 : -1}
              className={scope === 'site' ? 'seg on' : 'seg'}
              disabled={!hasHost}
              onClick={() => setScope('site')}
            >
              This site
            </button>
          </div>
        </div>

        {/* The scope tablist controls this shared region (its toggles/sliders edit
            either global or per-site values); wire it as the tabpanel the active
            scope tab points at, labelled by that tab, to complete the ARIA
            relationship (#8). */}
        <div
          role="tabpanel"
          id="scope-panel"
          aria-labelledby={scope === 'site' ? 'scope-tab-site' : 'scope-tab-global'}
        >
        {editingSite && (
          <p className="note" role="status">
            Editing overrides for <strong>{hostname}</strong>.
            {hasSiteOverride(siteConfig) && (
              <>
                {' '}
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => setSiteConfigs(clearSiteOverride(siteConfigs, hostname))}
                >
                  Reset to global
                </button>
              </>
            )}
          </p>
        )}

        <div className="toggles">
          {BLUR_TARGETS.map(({ key, label }) => (
            <label key={key} className="chip">
              <input
                type="checkbox"
                aria-label={`Blur ${label.toLowerCase()}${editingSite ? ` on ${hostname}` : ''}`}
                checked={shown[key]}
                onChange={(e) => setBlurField({ [key]: e.target.checked } as Partial<BlurSettings>)}
              />
              {label}
            </label>
          ))}
        </div>
        {shown.text && (
          <p className="note">
            Blurred text stays in the DOM and accessibility tree — screen readers still read it and
            Ctrl+F still finds it. It is softened visually, not hidden.
          </p>
        )}

        <div className="field">
          <span id="preset-label">Blur strength</span>
          <div className="presets" role="group" aria-labelledby="preset-label">
            {(Object.keys(BLUR_PRESETS) as PresetName[]).map((name) => (
              <button
                key={name}
                type="button"
                className={activePreset === name ? 'seg on' : 'seg'}
                aria-pressed={activePreset === name}
                onClick={() => applyPreset(name)}
              >
                {BLUR_PRESETS[name].label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Radius: {radius}px</span>
          <input
            type="range"
            min={4}
            max={40}
            value={radius}
            aria-label="Blur radius in pixels"
            onChange={(e) => onRadiusChange(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span>Show blurred content</span>
          <select
            value={shown.reveal}
            aria-label="When to show blurred content"
            onChange={(e) => setBlurField({ reveal: e.target.value as RevealMode })}
          >
            {REVEAL_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        </div>
      </section>

      <footer className="actions">
        <button
          type="button"
          onClick={() => void browser.runtime.sendMessage({ type: 'revealAll', tabId })}
        >
          Reveal all on this page
        </button>
        <button type="button" onClick={() => void browser.runtime.openOptionsPage()}>
          Open settings
        </button>
      </footer>
    </main>
  );
}
