import { Fragment, useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { browser } from '#imports';
import type { BlurSettings, BlurTabStats, MaskStyle, RevealMode } from '@blur/core';
import { clampMaskOpacity, isAllowlisted, resolveBlurSettings, safeMaskColor } from '@blur/core';
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

/**
 * Mask style is what people flip situationally ("I'm on the train — make it
 * solid"), and it is per-site scoped like every other control here. Whichever
 * style is selected gets its own editable strength row below, so neither style
 * is a second-class citizen that has to send the user to Settings to be tuned.
 */
const MASK_STYLES: { value: MaskStyle; label: string }[] = [
  { value: 'blur', label: 'Blur' },
  { value: 'solid', label: 'Solid' },
];

/**
 * Quick stops for the solid fill, the analogue of the Light/Medium/Heavy blur
 * presets — but deliberately labelled by their PERCENTAGE, not by words like
 * "Light"/"Heavy". Those words would imply the fill hides the content more or
 * less thoroughly, and it does not: `feFlood` discards the source graphic at
 * every opacity, so 60% hides exactly as much as 100% does. The only thing that
 * changes is how much of the PAGE's background shows through the fill. A number
 * cannot tell that lie; a word would.
 */
const OPACITY_PRESETS: { pct: number; hint: string }[] = [
  { pct: 60, hint: 'blends into the page background' },
  { pct: 80, hint: 'mostly opaque' },
  { pct: 100, hint: 'fully opaque' },
];

/** Ready-made fills, matching the Settings swatches so the two agree. */
const MASK_SWATCHES: { color: string; label: string }[] = [
  { color: '#1f2430', label: 'Slate (default)' },
  { color: '#000000', label: 'Black' },
  { color: '#6b7280', label: 'Grey' },
  { color: '#f2f3f5', label: 'Paper' },
];

/** Stored 0.5–1 float -> the whole percent the slider and presets speak in. */
function toPct(v: number): number {
  return Math.round(clampMaskOpacity(v) * 100);
}

/* ---------------------------------------------------------------------- */
/* Per-site override markers                                               */
/* ---------------------------------------------------------------------- */

/**
 * A per-site override SHADOWS the global value (`resolveBlurSettings` merges
 * `site.blur` OVER `blur`). That precedence is right; its INVISIBILITY was not.
 * The user sits on the Global tab, sees "Solid" selected, flips it, and the page
 * keeps doing what an override they made weeks ago says — so the feature reads as
 * broken.
 *
 * The fix is per-control, not a banner: a generic "this site has overrides" strip
 * does not tell you WHICH switch you are about to waste your time on. Every field
 * the popup can edit therefore names itself, its site value and a one-tap way back
 * to global — and renders NOTHING at all in the common no-override case.
 */
const FIELD_LABELS: Partial<Record<keyof BlurSettings, string>> = {
  images: 'Images',
  video: 'Video',
  posters: 'Thumbnails & posters',
  text: 'Text',
  maskStyle: 'Mask style',
  radius: 'Blur radius',
  maskOpacity: 'Fill opacity',
  maskColor: 'Fill colour',
  reveal: 'Show blurred content',
  rehideOnBlur: 'Re-hide when I switch away',
  showLabels: 'Labels',
  textPatterns: 'Text patterns',
};

/** Say what a stored value IS, in the words the control beside it uses. */
function describeBlurValue(field: keyof BlurSettings, v: unknown): string {
  switch (field) {
    case 'maskStyle':
      return v === 'solid' ? 'Solid' : 'Blur';
    case 'radius':
      return `${String(v)}px`;
    case 'maskOpacity':
      return `${toPct(Number(v))}%`;
    case 'maskColor':
      return safeMaskColor(v);
    case 'reveal':
      return REVEAL_MODES.find((m) => m.value === v)?.label ?? String(v);
    case 'textPatterns':
      return `${Array.isArray(v) ? v.length : 0} pattern${Array.isArray(v) && v.length === 1 ? '' : 's'}`;
    default:
      return v ? 'On' : 'Off';
  }
}

/** "Video", "Video and Mask style", "Video, Mask style and Blur radius". */
function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The marker itself. Two voices, because the two scopes ask different questions:
 *
 *  - `mode="global"` — "you are editing a control this site ignores". Amber, names
 *    the field and the value the site actually uses. This is the bug being fixed.
 *  - `mode="site"` — "this field is yours, the rest follow global". Quiet, and the
 *    inherit button is the per-field way back out.
 *
 * The action is a real button with a 28px hit box and permanent underline: Firefox
 * for Android has no hover, so nothing here may depend on one.
 */
function OverrideMark({
  label,
  hostname,
  siteValue,
  globalValue,
  mode,
  onInherit,
}: {
  label: string;
  hostname: string;
  siteValue: string;
  globalValue: string;
  mode: 'global' | 'site';
  onInherit: () => void;
}): JSX.Element {
  return (
    <p className={mode === 'site' ? 'ovr ovr-inherit' : 'ovr'}>
      <span className="ovr-icon" aria-hidden="true">
        {mode === 'site' ? '↳' : '⚠'}
      </span>
      <span className="ovr-txt">
        {mode === 'site' ? (
          <>
            <strong>{label}</strong> overrides global (<strong>{globalValue}</strong>).
          </>
        ) : (
          <>
            <strong>{label}</strong> is overridden on this site — {hostname} uses{' '}
            <strong>{siteValue}</strong>.
          </>
        )}
      </span>
      <button
        type="button"
        className="ovr-btn"
        aria-label={`Use the global ${label} setting on ${hostname}`}
        onClick={onInherit}
      >
        Use global
      </button>
    </p>
  );
}

type Scope = 'global' | 'site';

/** What the page's content script says it is ACTUALLY enforcing right now. */
interface AppliedInfo {
  active: boolean;
  maskStyle: MaskStyle;
  radius: number;
  reveal: RevealMode;
}

/**
 * Ask the page what it is really doing — and treat silence as the answer.
 *
 * A content script injected BEFORE an extension update is orphaned: it keeps the
 * stylesheet it already adopted, so the page still looks masked, but it receives
 * no storage events and no messages. The popup, always freshly loaded, cheerfully
 * shows the new settings while the page ignores every one of them. The user flips
 * "Solid", nothing happens, and there is nothing anywhere to explain why — it just
 * reads as a broken feature. (This is a browser constraint; the dead script cannot
 * fix itself. But the popup can notice.)
 *
 * `tabs.sendMessage` to a tab with no live listener REJECTS. So:
 *   - an answer  -> the script is alive, and tells us what it is enforcing;
 *   - a rejection -> the script is stale, and the page needs a reload.
 *
 * `null` = still asking. `'stale'` = no one answered.
 */
function useAppliedInfo(tabId: number): AppliedInfo | 'stale' | null {
  const [info, setInfo] = useState<AppliedInfo | 'stale' | null>(null);
  useEffect(() => {
    if (tabId < 0) return;
    let cancelled = false;
    void browser.tabs
      .sendMessage(tabId, { type: 'whatIsApplied' })
      .then((res: unknown) => {
        if (cancelled) return;
        setInfo(res && typeof res === 'object' ? (res as AppliedInfo) : 'stale');
      })
      .catch(() => {
        // "Receiving end does not exist" — no live content script in this tab.
        // Also the honest answer for chrome:// pages and the store, where the
        // extension legitimately does not run; the banner is only shown when the
        // settings say we SHOULD be masking, so those stay quiet.
        if (!cancelled) setInfo('stale');
      });
    return () => {
      cancelled = true;
    };
  }, [tabId]);
  return info;
}

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
  const appliedInfo = useAppliedInfo(tabId);
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

  // The solid fill's two knobs get the same treatment: a colour picker drag and
  // an opacity drag both fire per-tick, so hold them locally and debounce the
  // write exactly as the radius slider does.
  const [opacityPct, setOpacityPct] = useState(() => toPct(shown.maskOpacity));
  useEffect(() => setOpacityPct(toPct(shown.maskOpacity)), [shown.maskOpacity]);
  const opacityTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(opacityTimer.current), []);

  const [maskColor, setMaskColor] = useState(() => safeMaskColor(shown.maskColor));
  useEffect(() => setMaskColor(safeMaskColor(shown.maskColor)), [shown.maskColor]);
  const colorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(colorTimer.current), []);

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
    // Mirror `isAllowlisted` (used for the toggle's ON/OFF state), which is
    // subdomain-aware: an `example.com` entry also covers `www.example.com`. An
    // exact `Set.has`/`delete` here would leave the covering parent in place, so
    // un-pausing a subdomain would silently fail and stack up a garbage entry.
    if (siteAllowlisted) {
      // Currently paused — un-pause by dropping EVERY entry that covers this host
      // (the exact host and any parent domain allowlisting it).
      update({
        allowlist: settings.allowlist.filter(
          (h) => !(hostname === h || hostname.endsWith(`.${h}`)),
        ),
      });
    } else {
      update({ allowlist: [...settings.allowlist, hostname] });
    }
  }

  /* --- per-site override plumbing ------------------------------------- */

  /**
   * What this host pins, NAMED — not counted. A count would be a fresh little lie
   * whenever an override has no control on screen to mark (a `radius` override is
   * invisible while the Solid mask is selected, since the radius slider isn't
   * rendered), leaving "3 settings" above two markers. Naming them is honest in
   * every case and is what the user needs anyway.
   */
  const ownFieldLabels = [
    ...(siteConfig?.enabled !== undefined ? ['Blur on this site'] : []),
    ...(Object.keys(FIELD_LABELS) as (keyof BlurSettings)[])
      .filter((k) => siteConfig?.blur?.[k] !== undefined)
      .map((k) => FIELD_LABELS[k] ?? k),
  ];
  const siteHasOverride = hasSiteOverride(siteConfig);

  /**
   * Drop ONE field's override. `setSiteOverride` deletes keys set back to
   * `undefined` and removes the whole site entry once nothing is left, so a
   * per-field "Use global" is also the last-one-out cleanup — no orphan entries.
   */
  function inheritBlurField(field: keyof BlurSettings): void {
    setSiteConfigs((prev) =>
      setSiteOverride(prev, hostname, {
        blur: { [field]: undefined } as Partial<BlurSettings>,
      }),
    );
  }

  function clearSite(): void {
    setSiteConfigs((prev) => clearSiteOverride(prev, hostname));
  }

  /** Marker for one blur field, or nothing at all when the site doesn't override it. */
  function mark(field: keyof BlurSettings, mode: Scope = scope): JSX.Element | null {
    const siteValue = siteConfig?.blur?.[field];
    if (!hasHost || siteValue === undefined) return null;
    return (
      <OverrideMark
        label={FIELD_LABELS[field] ?? field}
        hostname={hostname}
        siteValue={describeBlurValue(field, siteValue)}
        globalValue={describeBlurValue(field, settings.blur[field])}
        mode={mode === 'site' ? 'site' : 'global'}
        onInherit={() => inheritBlurField(field)}
      />
    );
  }

  function setBlurField(patch: Partial<BlurSettings>): void {
    if (editingSite) {
      setSiteConfigs((prev) => setSiteOverride(prev, hostname, { blur: patch }));
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
    clearTimeout(radiusTimer.current);
    setRadius(BLUR_PRESETS[name].radius);
    setBlurField({ radius: BLUR_PRESETS[name].radius });
  }

  function onOpacityChange(pct: number): void {
    setOpacityPct(pct);
    clearTimeout(opacityTimer.current);
    // clampMaskOpacity is the gate the filter itself trusts, so the value that
    // reaches storage is always one it accepts — never the raw slider number.
    opacityTimer.current = setTimeout(
      () => setBlurField({ maskOpacity: clampMaskOpacity(pct / 100) }),
      200,
    );
  }

  function applyOpacityPreset(pct: number): void {
    // Cancel any in-flight slider write, or a debounced tick from a drag the user
    // just abandoned would land after the preset and undo it.
    clearTimeout(opacityTimer.current);
    setOpacityPct(pct);
    setBlurField({ maskOpacity: clampMaskOpacity(pct / 100) });
  }

  function onColorChange(next: string): void {
    setMaskColor(next);
    clearTimeout(colorTimer.current);
    // safeMaskColor is belt-and-braces: <input type="color"> can only ever emit
    // #rrggbb, and that is precisely why it (and the fixed swatches) are the only
    // ways to set this value — it lands in an SVG data-URI filter.
    colorTimer.current = setTimeout(() => setBlurField({ maskColor: safeMaskColor(next) }), 200);
  }

  function applySwatch(color: string): void {
    clearTimeout(colorTimer.current);
    setMaskColor(color);
    setBlurField({ maskColor: color });
  }

  if (!loaded) return <main className="popup">Loading…</main>;

  const activePreset = presetForRadius(radius);
  const solidMask = shown.maskStyle === 'solid';

  // Would we expect this page to be masked at all? Only complain about a stale
  // script when the answer is yes — otherwise a chrome:// tab or an allowlisted
  // site would nag for no reason.
  const shouldBeMasking =
    settings.enabled &&
    hostname.length > 0 &&
    !isAllowlisted(settings.allowlist, hostname) &&
    (effective.images || effective.video || effective.posters || effective.text);

  const staleScript = appliedInfo === 'stale' && shouldBeMasking;
  // The script is alive but enforcing a DIFFERENT mask than the settings say. This
  // should be impossible once reconciliation lands, so if it ever shows, it is a
  // real bug — not a stale page — and saying "reload" would be a lie.
  const maskMismatch =
    appliedInfo !== null &&
    appliedInfo !== 'stale' &&
    appliedInfo.active &&
    appliedInfo.maskStyle !== effective.maskStyle;

  return (
    <main className="popup">
      {staleScript && (
        <div className="stale" role="alert">
          <strong>This page is out of date.</strong> It was loaded before the extension
          was updated, so it kept the old settings and ignores changes made here —
          including the mask style. Reload the page to fix it.
          <button
            type="button"
            className="stale-btn"
            onClick={() => {
              void browser.tabs.reload(tabId).then(() => window.close());
            }}
          >
            Reload this page
          </button>
        </div>
      )}
      {maskMismatch && !staleScript && (
        <div className="stale" role="alert">
          <strong>The page is showing {appliedInfo.maskStyle === 'solid' ? 'a solid mask' : 'blur'}</strong>{' '}
          but your settings say{' '}
          {effective.maskStyle === 'solid' ? 'solid' : 'blur'}. Reload the page; if it
          persists, this is a bug worth reporting.
          <button
            type="button"
            className="stale-btn"
            onClick={() => {
              void browser.tabs.reload(tabId).then(() => window.close());
            }}
          >
            Reload this page
          </button>
        </div>
      )}
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

      {/* An `enabled` override (a backup import can carry one) silently decides
          whether the engine runs here, and the switch above — which reads the
          ALLOWLIST — would cheerfully claim "Active on this site" while it does
          not. Same class of lie as the mask-style one, so it gets the same
          marker rather than being left as the one invisible case. */}
      {hasHost && siteConfig?.enabled !== undefined && (
        <OverrideMark
          label="Blur on this site"
          hostname={hostname}
          siteValue={siteConfig.enabled ? 'On' : 'Off'}
          globalValue={settings.enabled ? 'On' : 'Off'}
          mode="global"
          onInherit={() =>
            setSiteConfigs((prev) => setSiteOverride(prev, hostname, { enabled: undefined }))
          }
        />
      )}

      {hasHost ? (
        // Counts come from the engine's per-label tally (never faked, and a real 0
        // is shown as 0). They can run slightly high when the min-image-size gate
        // is on: an image tallied before the gate marks it small un-blurs live but
        // is not subtracted — so this is an honest count, not an exact one.
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
        {/* The one-click way out, and the only thing here that costs vertical space
            — so it exists ONLY when an override actually does. No override (the
            common case) means not a pixel of this section renders. */}
        {!editingSite && siteHasOverride && (
          <p className="ovr ovr-sum" role="status">
            <span className="ovr-icon" aria-hidden="true">
              ⚠
            </span>
            <span className="ovr-txt">
              <strong>{hostname}</strong> has its own{' '}
              <strong>{formatList(ownFieldLabels)}</strong>. Changes on this tab won’t reach
              it.
            </span>
            <button
              type="button"
              className="ovr-btn"
              aria-label={`Clear this site's overrides and use global settings on ${hostname}`}
              onClick={clearSite}
            >
              Use global settings on this site
            </button>
          </p>
        )}

        {editingSite && (
          <p className="note" role="status">
            Editing overrides for <strong>{hostname}</strong>. Marked settings are this
            site’s own; everything else follows global.
            {siteHasOverride && (
              <>
                {' '}
                <button type="button" className="linkbtn" onClick={clearSite}>
                  Clear this site’s overrides
                </button>
              </>
            )}
          </p>
        )}

        <div className="toggles">
          {BLUR_TARGETS.map(({ key, label }) => (
            // The four categories share one wrapping row, so — unlike every other
            // control here — a marker underneath cannot sit against the control it
            // is about. The chip therefore carries the flag itself and the marker
            // below names the category, so the two are unmistakably one statement.
            <label
              key={key}
              className={
                hasHost && siteConfig?.blur?.[key] !== undefined
                  ? editingSite
                    ? 'chip flagged-own'
                    : 'chip flagged'
                  : 'chip'
              }
            >
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
        {BLUR_TARGETS.map(({ key }) => (
          <Fragment key={key}>{mark(key)}</Fragment>
        ))}
        {shown.text && (
          <p className="note">
            Blurred text stays in the DOM and accessibility tree — screen readers still read it and
            Ctrl+F still finds it. It is softened visually, not hidden.
          </p>
        )}

        <div className="field">
          <span id="mask-label">Mask style</span>
          <div className="mask-styles" role="group" aria-labelledby="mask-label">
            {MASK_STYLES.map((m) => (
              <button
                key={m.value}
                type="button"
                className={shown.maskStyle === m.value ? 'seg on' : 'seg'}
                aria-pressed={shown.maskStyle === m.value}
                aria-label={`${m.label} mask${editingSite ? ` on ${hostname}` : ''}`}
                onClick={() => setBlurField({ maskStyle: m.value })}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {/* The reported bug, exactly: "Solid" is highlighted above, the site says
            Blur, and the page obeys the site. Now it says so. */}
        {mark('maskStyle')}

        {/* Strictly the controls the CHOSEN style uses — a radius slider under a
            solid fill would move nothing, a colour swatch under a blur would tint
            nothing — but each style gets a full, editable strength row of the same
            shape: presets + a slider. Solid is not a downgrade you have to leave
            the popup to configure. */}
        {solidMask ? (
          <>
            <div className="field">
              <span id="opacity-label">Fill opacity</span>
              <div className="presets" role="group" aria-labelledby="opacity-label">
                {OPACITY_PRESETS.map((p) => (
                  <button
                    key={p.pct}
                    type="button"
                    className={opacityPct === p.pct ? 'seg on' : 'seg'}
                    aria-pressed={opacityPct === p.pct}
                    aria-label={`Fill opacity ${p.pct}% — ${p.hint}`}
                    onClick={() => applyOpacityPreset(p.pct)}
                  >
                    {p.pct}%
                  </button>
                ))}
              </div>
            </div>

            <label className="field">
              <span>Opacity: {opacityPct}%</span>
              <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={opacityPct}
                aria-label={`Fill opacity, as a percentage${editingSite ? ` on ${hostname}` : ''}`}
                onChange={(e) => onOpacityChange(Number(e.target.value))}
              />
            </label>
            {mark('maskOpacity')}

            <div className="field">
              <span id="fill-colour-label">Fill colour</span>
              <div className="swatches" role="group" aria-labelledby="fill-colour-label">
                {MASK_SWATCHES.map((s) => (
                  <button
                    key={s.color}
                    type="button"
                    className={maskColor === s.color ? 'swatch on' : 'swatch'}
                    style={{ background: s.color }}
                    title={s.label}
                    aria-label={s.label}
                    aria-pressed={maskColor === s.color}
                    onClick={() => applySwatch(s.color)}
                  />
                ))}
                {/* The native picker IS the sanitizer: it can only ever produce
                    `#rrggbb`, the one form isSafeMaskColor lets into the SVG filter.
                    No free-text hex field, here or anywhere. */}
                <input
                  type="color"
                  className="swatch-input"
                  aria-label="Custom fill colour"
                  value={maskColor}
                  onChange={(e) => onColorChange(e.target.value)}
                />
              </div>
            </div>
            {mark('maskColor')}

            <p className="note">
              Opacity does <strong>not</strong> uncover the content. Below 100% you see the{' '}
              <strong>page’s own background</strong> through the fill — never the image or video,
              which is never drawn at all.
            </p>
          </>
        ) : (
          <>
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
            {mark('radius')}
          </>
        )}
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
        {mark('reveal')}
        {shown.reveal === 'hover' && (
          <p className="note">On touch devices, hover becomes tap-to-reveal.</p>
        )}
        </div>
      </section>

      {/* Global, and deliberately OUTSIDE the scope panel: "re-hide when I switch
          away" is a privacy stance, not a per-site look, and the moment you want it
          (a screen-share is starting) is exactly when the popup is open. */}
      <section className="group">
        <label className="field rehide">
          <span>
            Re-hide when I switch away
            <span className="sub">Applies everywhere</span>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              aria-label="Re-hide revealed content when the tab or window loses focus"
              checked={settings.blur.rehideOnBlur}
              onChange={(e) => update({ blur: { rehideOnBlur: e.target.checked } })}
            />
            <span className="slider" />
          </span>
        </label>
        {/* This switch always writes GLOBAL, whichever scope tab is open — so its
            marker always speaks in the global voice, and "Applies everywhere"
            above it stops being a half-truth on an overriding site. */}
        {mark('rehideOnBlur', 'global')}
      </section>

      <footer className="actions actions--reveal">
        {/* Reveal used to be a one-way door: the only way to put a revealed page
            back was a full reload — absurd for an extension whose job is keeping
            content off the screen, since the moment you most need to re-hide is
            the moment reloading is slowest. The two actions are peers, and the
            same Alt+Shift+R shortcut now toggles between them. */}
        <button
          type="button"
          onClick={() => void browser.runtime.sendMessage({ type: 'revealAll', tabId })}
        >
          Reveal all
        </button>
        <button
          type="button"
          onClick={() => void browser.runtime.sendMessage({ type: 'hideAll', tabId })}
        >
          Hide all again
        </button>
      </footer>
      <footer className="actions">
        <button type="button" onClick={() => void browser.runtime.openOptionsPage()}>
          Open settings
        </button>
      </footer>
    </main>
  );
}
