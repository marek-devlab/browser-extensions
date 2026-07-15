import { Fragment, useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { BlurSettings, BlurSiteConfig, MaskStyle, RevealMode } from '@blur/core';
import { clampMaskOpacity, safeMaskColor, solidMaskFilter } from '@blur/core';
import { useSettings } from '../../utils/use-settings';
import { useStorageItem } from '../../utils/use-storage-item';
import { siteConfigsItem, imageSourceRulesItem, extensionPrefsItem } from '../../utils/storage';
import { validateTextPattern } from '../../utils/text-blur';
import { useT, type MsgKey } from '../../utils/i18n';
import { useLocale, LanguageSwitcher, type TFunction } from '@blur/ui';
import { useSetLocale } from '../../utils/use-locale';
import {
  BLUR_PRESETS,
  presetForRadius,
  setSiteOverride,
  clearSiteOverride,
  hasSiteOverride,
  serializeBackup,
  parseBackup,
  mergeKeywords,
  parseKeywordFile,
  type PresetName,
  type BlurOverrideKey,
} from '../../utils/features';

/** The `t` returned by `useT`, threaded into the module-level helpers below. */
type T = TFunction<MsgKey>;

/** Blur-strength preset name → translation key for its label. */
const PRESET_KEYS: Record<PresetName, MsgKey> = {
  light: 'preset_light',
  medium: 'preset_medium',
  heavy: 'preset_heavy',
};

type Tab = 'blur' | 'text' | 'sites' | 'images' | 'links' | 'backup' | 'about';

const TABS: { id: Tab; labelKey: MsgKey }[] = [
  { id: 'blur', labelKey: 'tab_blur' },
  { id: 'text', labelKey: 'tab_text' },
  { id: 'sites', labelKey: 'tab_sites' },
  { id: 'images', labelKey: 'tab_images' },
  { id: 'links', labelKey: 'tab_links' },
  { id: 'backup', labelKey: 'tab_backup' },
  { id: 'about', labelKey: 'tab_about' },
];

const BLUR_TARGETS: { key: BlurOverrideKey; labelKey: MsgKey }[] = [
  { key: 'images', labelKey: 'target_images' },
  { key: 'video', labelKey: 'target_video' },
  { key: 'posters', labelKey: 'target_posters' },
  { key: 'text', labelKey: 'target_text' },
];

const REVEAL_MODES: { value: RevealMode; labelKey: MsgKey }[] = [
  { value: 'hover', labelKey: 'reveal_hover' },
  { value: 'click', labelKey: 'reveal_click' },
  { value: 'never', labelKey: 'reveal_never' },
];

const MASK_STYLES: { value: MaskStyle; labelKey: MsgKey; hintKey: MsgKey }[] = [
  {
    value: 'blur',
    labelKey: 'mask_blur',
    hintKey: 'opt_mask_blur_hint',
  },
  {
    value: 'solid',
    labelKey: 'opt_mask_solid',
    hintKey: 'opt_mask_solid_hint',
  },
];

/** Ready-made fills, so the common choices are one tap away on a phone. */
const MASK_SWATCHES: { color: string; labelKey: MsgKey }[] = [
  { color: '#1f2430', labelKey: 'swatch_slate' },
  { color: '#000000', labelKey: 'swatch_black' },
  { color: '#6b7280', labelKey: 'swatch_grey' },
  { color: '#f2f3f5', labelKey: 'swatch_paper' },
];

/**
 * The stand-in "photo" the mask preview obscures. Inline SVG, so the preview
 * needs no network and no bundled asset — and it is a real replaced `<img>`, the
 * element class the solid mask exists to cover.
 */
const SAMPLE_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='120'>" +
    "<defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'>" +
    "<stop offset='0' stop-color='#2b5cff'/><stop offset='1' stop-color='#9ad7ff'/>" +
    '</linearGradient></defs>' +
    "<rect width='320' height='120' fill='url(#s)'/>" +
    "<circle cx='252' cy='30' r='15' fill='#ffe08a'/>" +
    "<path d='M0 120 L70 50 L124 96 L176 38 L252 120 Z' fill='#1d3b2a'/>" +
    "<path d='M118 120 L200 60 L288 120 Z' fill='#2f6b4a'/>" +
    "</svg>",
)}`;

/** The exact CSS `filter` the engine would apply for these settings. */
function maskFilterFor(blur: {
  maskStyle: MaskStyle;
  maskColor: string;
  maskOpacity: number;
  radius: number;
}): string {
  // solidMaskFilter is the SAME function the content script's stylesheet uses, so
  // the preview cannot drift from what the page actually paints.
  return blur.maskStyle === 'solid'
    ? solidMaskFilter(blur.maskColor, blur.maskOpacity)
    : `blur(${blur.radius}px)`;
}

/* ---------------------------------------------------------------------- */
/* Per-site override markers                                               */
/* ---------------------------------------------------------------------- */

/**
 * `resolveBlurSettings` merges a site's `blur` OVER the global one, so any field a
 * site overrides is a field the global controls on the Blur tab can no longer move
 * on that site. Options had the same blind spot the popup had: the per-site rows
 * rendered the MERGED values, so an inherited toggle and an overriding one looked
 * identical, and nothing on the Blur tab hinted that some sites ignore it.
 */
const FIELD_LABELS: Partial<Record<keyof BlurSettings, MsgKey>> = {
  images: 'field_images',
  video: 'field_video',
  posters: 'field_posters',
  text: 'field_text',
  maskStyle: 'field_maskStyle',
  radius: 'field_radius',
  maskOpacity: 'field_maskOpacity',
  maskColor: 'field_maskColor',
  reveal: 'field_reveal',
  rehideOnBlur: 'field_rehideOnBlur',
  showLabels: 'field_showLabels',
  textPatterns: 'field_textPatterns',
};

function describeBlurValue(field: keyof BlurSettings, v: unknown, t: T): string {
  switch (field) {
    case 'maskStyle':
      return v === 'solid' ? t('opt_value_solid') : t('value_blur');
    case 'radius':
      return `${String(v)}px`;
    case 'maskOpacity':
      return `${Math.round(clampMaskOpacity(Number(v)) * 100)}%`;
    case 'maskColor':
      return safeMaskColor(v);
    case 'reveal': {
      const mode = REVEAL_MODES.find((m) => m.value === v);
      return mode ? t(mode.labelKey) : String(v);
    }
    case 'textPatterns': {
      const n = Array.isArray(v) ? v.length : 0;
      return t(n === 1 ? 'patterns_one' : 'patterns_other', { n });
    }
    default:
      return v ? t('value_on') : t('value_off');
  }
}

/** The fields a site config actually pins, in a stable, human order. */
function overriddenFields(config: BlurSiteConfig | undefined): (keyof BlurSettings)[] {
  const own = config?.blur ?? {};
  return (Object.keys(FIELD_LABELS) as (keyof BlurSettings)[]).filter(
    (k) => own[k] !== undefined,
  );
}

/**
 * One overriding field inside a per-site row: what it pins, what global says, and
 * a per-field way back to global — the counterpart of "Reset to global", which
 * drops the row entirely.
 */
function OverrideMark({
  label,
  globalValue,
  host,
  onInherit,
}: {
  label: string;
  globalValue: string;
  host: string;
  onInherit: () => void;
}): JSX.Element {
  const t = useT();
  return (
    <p className="ovr ovr-inherit">
      <span className="ovr-icon" aria-hidden="true">
        ↳
      </span>
      <span className="ovr-txt">
        <strong>{label}</strong>
        {t('ovr_overrides_global_pre')}
        <strong>{globalValue}</strong>
        {t('ovr_overrides_global_post')}
      </span>
      <button
        type="button"
        className="ovr-btn"
        aria-label={t('ovr_use_global_aria', { label, host })}
        onClick={onInherit}
      >
        {t('ovr_use_global')}
      </button>
    </p>
  );
}

/**
 * Normalize free-form user input into a bare hostname. A pasted
 * `https://example.com/path` must become `example.com`, or the entry never
 * matches a real hostname. Returns null for anything unparseable.
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

export function App(): JSX.Element {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const { settings, update, loaded, error } = useSettings();
  const [tab, setTab] = useState<Tab>('blur');

  if (!loaded) return <main className="options">{t('loading')}</main>;

  function setBlur(patch: Partial<BlurSettings>): void {
    // Pass ONLY the changed fields: `update` deep-merges `patch.blur` onto the
    // freshest stored `blur`, so spreading a stale `settings.blur` snapshot here
    // (which would clobber a same-tick edit to another field) is both unnecessary
    // and wrong (C4).
    update({ blur: patch });
  }

  return (
    <main className="options">
      <header className="masthead">
        <h1>{t('app_name')}</h1>
        <label className="master-toggle">
          <span>{settings.enabled ? t('status_enabled') : t('status_disabled')}</span>
          <span className="switch">
            <input
              type="checkbox"
              aria-label={t('aria_enable_global')}
              checked={settings.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            <span className="slider" />
          </span>
        </label>
      </header>
      <section className="lang-row">
        <h2 className="lang-heading">{t('language')}</h2>
        <LanguageSwitcher locale={locale} onChange={setLocale} label={t('language')} />
      </section>
      {!settings.enabled && (
        <p className="note" role="status">
          {t('note_disabled_all')}
        </p>
      )}
      {error && (
        <p className="note status-err" role="alert">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}

      <TabBar tabs={TABS} current={tab} onSelect={setTab} />

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'blur' && (
          <BlurPanel settings={settings} setBlur={setBlur} onManageSites={() => setTab('sites')} />
        )}

        {tab === 'text' && (
          <TextPatternsPanel
            patterns={settings.blur.textPatterns}
            onChange={(textPatterns) => setBlur({ textPatterns })}
          />
        )}

        {tab === 'sites' && (
          <SitesPanel
            allowlist={settings.allowlist}
            onChange={(allowlist) => update({ allowlist })}
          />
        )}

        {tab === 'images' && <ImageSourcesPanel />}

        {tab === 'links' && <LinksPanel />}

        {tab === 'backup' && <BackupPanel />}

        {tab === 'about' && <AboutPanel />}
      </div>
    </main>
  );
}

/**
 * Accessible tab bar (WAI-ARIA tabs pattern): a real `role="tablist"` of
 * `role="tab"` buttons with roving tabindex, arrow / Home / End navigation, and
 * the active tab wired to its panel via `aria-controls` (the panel points back
 * with `aria-labelledby`). Only the ACTIVE panel is in the DOM, so `aria-controls`
 * is set solely on the selected tab — an inactive tab pointing at a `panel-*` id
 * that does not exist would be a broken reference (#8). Previously plain buttons
 * with no keyboard semantics.
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
    <div className="tabs" role="tablist" aria-label={t('aria_tabs')} onKeyDown={onKey}>
      {tabs.map((tabItem, idx) => (
        <button
          key={tabItem.id}
          type="button"
          role="tab"
          id={`tab-${tabItem.id}`}
          aria-selected={current === tabItem.id}
          aria-controls={current === tabItem.id ? `panel-${tabItem.id}` : undefined}
          tabIndex={current === tabItem.id ? 0 : -1}
          ref={(el) => {
            refs.current[idx] = el;
          }}
          className={current === tabItem.id ? 'tab on' : 'tab'}
          onClick={() => onSelect(tabItem.id)}
        >
          {t(tabItem.labelKey)}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------- Blur panel ------------------------------ */

function PresetRow({
  radius,
  onPreset,
}: {
  radius: number;
  onPreset: (name: PresetName) => void;
}): JSX.Element {
  const t = useT();
  const active = presetForRadius(radius);
  return (
    <div className="field">
      <span id="opt-preset-label">{t('field_blur_strength')}</span>
      <div className="presets" role="group" aria-labelledby="opt-preset-label">
        {(Object.keys(BLUR_PRESETS) as PresetName[]).map((name) => (
          <button
            key={name}
            type="button"
            className={active === name ? 'seg on' : 'seg'}
            aria-pressed={active === name}
            onClick={() => onPreset(name)}
          >
            {t(PRESET_KEYS[name])} ({BLUR_PRESETS[name].radius}px)
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Side-by-side "before / after": the same sample image, unmasked and with the
 * user's live mask settings applied. "Solid, #1f2430, 80%" means nothing in the
 * abstract; this shows it.
 *
 * The masked frame's background is the page background (`--bg`) on purpose: at an
 * opacity below 100% that is exactly, and only, what shows through the fill.
 */
function MaskPreview({
  blur,
  radius,
}: {
  blur: BlurSettings;
  radius: number;
}): JSX.Element {
  const t = useT();
  const filter = maskFilterFor({
    maskStyle: blur.maskStyle,
    maskColor: blur.maskColor,
    maskOpacity: blur.maskOpacity,
    radius,
  });
  return (
    <div className="mask-preview">
      <figure className="preview-fig">
        <div className="preview-frame">
          <img src={SAMPLE_IMAGE} alt="" />
        </div>
        <figcaption>{t('cap_original')}</figcaption>
      </figure>
      <figure className="preview-fig">
        <div className="preview-frame">
          <img src={SAMPLE_IMAGE} alt={t('alt_preview')} style={{ filter }} />
          {blur.showLabels && <span className="preview-chip">JPEG · 1200×800</span>}
        </div>
        <figcaption>
          {blur.maskStyle === 'solid'
            ? t('cap_solid', {
                color: blur.maskColor,
                pct: Math.round(blur.maskOpacity * 100),
              })
            : t('cap_blur', { r: radius })}
        </figcaption>
      </figure>
    </div>
  );
}

/**
 * Masking. The style is the primary choice and everything below it depends on it,
 * so the dependent controls are rendered as a subordinate block and only the ones
 * that DO something for the selected style are on screen. A radius slider under a
 * solid mask, or a colour picker under a blur, would be a control that silently
 * does nothing.
 */
function MaskSection({
  blur,
  radius,
  onRadius,
  setBlur,
}: {
  blur: BlurSettings;
  radius: number;
  onRadius: (next: number) => void;
  setBlur: (patch: Partial<BlurSettings>) => void;
}): JSX.Element {
  const t = useT();
  const solid = blur.maskStyle === 'solid';
  const style = MASK_STYLES.find((m) => m.value === blur.maskStyle);
  const opacityPct = Math.round(clampMaskOpacity(blur.maskOpacity) * 100);
  return (
    <div className="subpanel">
      <h2>{t('heading_how_hidden')}</h2>
      <div className="field">
        <span id="opt-mask-label">{t('field_maskStyle')}</span>
        <div className="mask-styles" role="group" aria-labelledby="opt-mask-label">
          {MASK_STYLES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={blur.maskStyle === m.value ? 'seg on' : 'seg'}
              aria-pressed={blur.maskStyle === m.value}
              onClick={() => setBlur({ maskStyle: m.value })}
            >
              {t(m.labelKey)}
            </button>
          ))}
        </div>
      </div>
      {style && <p className="note">{t(style.hintKey)}</p>}

      <MaskPreview blur={blur} radius={radius} />

      <div className="subordinate">
        {solid ? (
          <>
            <div className="field">
              <span id="opt-swatch-label">{t('field_maskColor')}</span>
              <div className="swatches" role="group" aria-labelledby="opt-swatch-label">
                {MASK_SWATCHES.map((s) => (
                  <button
                    key={s.color}
                    type="button"
                    className={safeMaskColor(blur.maskColor) === s.color ? 'swatch on' : 'swatch'}
                    style={{ background: s.color }}
                    title={t(s.labelKey)}
                    aria-label={t(s.labelKey)}
                    aria-pressed={safeMaskColor(blur.maskColor) === s.color}
                    onClick={() => setBlur({ maskColor: s.color })}
                  />
                ))}
                {/* A native colour input is also the sanitizer: it can only ever
                    produce `#rrggbb`, which is the one form the SVG filter accepts
                    (see isSafeMaskColor). No free-text hex field, ever. */}
                <input
                  type="color"
                  className="swatch-input"
                  aria-label={t('aria_custom_fill')}
                  value={safeMaskColor(blur.maskColor)}
                  onChange={(e) => setBlur({ maskColor: e.target.value })}
                />
                <code className="swatch-hex">{safeMaskColor(blur.maskColor)}</code>
              </div>
            </div>
            <label className="field">
              <span>{t('opt_opacity_label', { pct: opacityPct })}</span>
              <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={opacityPct}
                aria-label={t('aria_opacity_range')}
                onChange={(e) => setBlur({ maskOpacity: clampMaskOpacity(Number(e.target.value) / 100) })}
              />
            </label>
            <p className="note">
              {t('opt_note_opacity_1')}
              <strong>{t('note_opacity_not')}</strong>
              {t('opt_note_opacity_2')}
              <strong>{t('opt_note_opacity_bg')}</strong>
              {t('opt_note_opacity_3')}
            </p>
          </>
        ) : (
          <>
            <PresetRow radius={radius} onPreset={(name) => onRadius(BLUR_PRESETS[name].radius)} />
            <label className="field">
              <span>{t('radius_label', { r: radius })}</span>
              <input
                type="range"
                min={4}
                max={40}
                value={radius}
                aria-label={t('aria_radius')}
                onChange={(e) => onRadius(Number(e.target.value))}
              />
            </label>
            <p className="note">
              {t('opt_note_blur_1')}
              <strong>{t('opt_value_solid')}</strong>
              {t('opt_note_blur_2')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Every control on this tab is GLOBAL, and a site with an override quietly ignores
 * the ones it overrides. Options has no "current tab" to speak of, so it cannot
 * mark individual controls the way the popup does — but it can refuse to let the
 * user believe the values here are the last word everywhere. Renders nothing when
 * no site overrides anything, which is the common case.
 */
function GlobalOverridesNotice({ onManageSites }: { onManageSites: () => void }): JSX.Element | null {
  const t = useT();
  const { value: configs } = useStorageItem(siteConfigsItem);
  const hosts = Object.keys(configs).filter((h) => hasSiteOverride(configs[h]));
  if (hosts.length === 0) return null;
  const shown = hosts.slice(0, 4);
  return (
    <p className="ovr" role="status">
      <span className="ovr-icon" aria-hidden="true">
        ⚠
      </span>
      <span className="ovr-txt">
        {hosts.length === 1 ? t('ovr_notice_one') : t('ovr_notice_many', { n: hosts.length })}
        {t('ovr_notice_body', { hosts: shown.join(', ') })}
        {hosts.length > shown.length ? t('ovr_notice_more', { n: hosts.length - shown.length }) : ''}.
      </span>
      <button type="button" className="ovr-btn" onClick={onManageSites}>
        {t('btn_review_overrides')}
      </button>
    </p>
  );
}

function BlurPanel({
  settings,
  setBlur,
  onManageSites,
}: {
  settings: { blur: BlurSettings };
  setBlur: (patch: Partial<BlurSettings>) => void;
  onManageSites: () => void;
}): JSX.Element {
  const t = useT();
  const [radius, setRadius] = useState(settings.blur.radius);
  useEffect(() => setRadius(settings.blur.radius), [settings.blur.radius]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function onRadiusChange(next: number): void {
    setRadius(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setBlur({ radius: next }), 200);
  }

  return (
    <section className="panel">
      <GlobalOverridesNotice onManageSites={onManageSites} />
      <div className="toggles">
        {BLUR_TARGETS.map(({ key, labelKey }) => (
          <label key={key} className="chip">
            <input
              type="checkbox"
              aria-label={t('aria_blur_category', { category: t(labelKey).toLowerCase() })}
              checked={settings.blur[key]}
              onChange={(e) => setBlur({ [key]: e.target.checked } as Partial<BlurSettings>)}
            />
            {t(labelKey)}
          </label>
        ))}
      </div>
      {settings.blur.text && (
        <p className="note">{t('opt_note_text_a11y')}</p>
      )}

      <MaskSection
        blur={settings.blur}
        radius={radius}
        onRadius={onRadiusChange}
        setBlur={setBlur}
      />

      <div className="subpanel">
        <h2>{t('heading_revealing')}</h2>
        <label className="field">
          <span>{t('field_reveal')}</span>
          <select value={settings.blur.reveal} onChange={(e) => setBlur({ reveal: e.target.value as RevealMode })}>
            {REVEAL_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {t(m.labelKey)}
              </option>
            ))}
          </select>
        </label>
        {settings.blur.reveal === 'hover' && (
          <p className="note">
            {t('opt_note_hover_1')}
            <strong>{t('reveal_hover')}</strong>
            {t('opt_note_hover_2')}
          </p>
        )}
        <RevealTimeoutField />
        <label className="field">
          <span>
            {t('field_rehideOnBlur')}
            <span className="sub-line">{t('opt_rehide_desc')}</span>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              aria-label={t('aria_rehide')}
              checked={settings.blur.rehideOnBlur}
              onChange={(e) => setBlur({ rehideOnBlur: e.target.checked })}
            />
            <span className="slider" />
          </span>
        </label>
      </div>

      <div className="subpanel">
        <h2>{t('heading_labels')}</h2>
        <label className="field">
          <span>
            {t('opt_label_what')}
            <span className="sub-line">{t('opt_labels_desc')}</span>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              aria-label={t('aria_show_labels')}
              checked={settings.blur.showLabels}
              onChange={(e) => setBlur({ showLabels: e.target.checked })}
            />
            <span className="slider" />
          </span>
        </label>
      </div>
    </section>
  );
}

/**
 * Reveal-timeout: after a click / "reveal all", auto re-hide the content again
 * after N seconds. Lives in `extensionPrefs` (extension-only, not in core's
 * `BlurSettings`). 0 keeps content revealed until navigation.
 */
function RevealTimeoutField(): JSX.Element {
  const t = useT();
  const { value: prefs, setValue } = useStorageItem(extensionPrefsItem);
  const options = [0, 3, 5, 10, 30, 60];
  return (
    <label className="field">
      <span>{t('opt_rehide_after')}</span>
      <select
        value={prefs.revealTimeoutSec}
        aria-label={t('aria_rehide_after')}
        onChange={(e) => setValue({ ...prefs, revealTimeoutSec: Number(e.target.value) })}
      >
        {options.map((sec) => (
          <option key={sec} value={sec}>
            {sec === 0 ? t('opt_never_leave') : t('opt_seconds', { n: sec })}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ------------------------- Text patterns panel ------------------------ */

function TextPatternsPanel({
  patterns,
  onChange,
}: {
  patterns: string[];
  onChange: (next: string[]) => void;
}): JSX.Element {
  const t = useT();
  const [draft, setDraft] = useState('');
  const [bulk, setBulk] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const entries = patterns;

  function add(): void {
    const term = draft.trim();
    if (!term) return;
    if (entries.includes(term)) {
      setError(t('err_pattern_dup'));
      return;
    }
    const invalid = validateTextPattern(term);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setStatus(null);
    onChange([...entries, term]);
    setDraft('');
  }

  /**
   * Add many keywords at once from the textarea or an imported file. Each line is
   * validated with the SAME rules the content script uses, so a bad regex in a
   * pasted block is skipped and reported rather than silently killing text blur.
   */
  function addMany(raw: string): void {
    const { next: candidates, added } = mergeKeywords(entries, raw);
    if (added === 0) {
      setError(null);
      setStatus(t('status_nothing_new'));
      return;
    }
    const kept: string[] = [...entries];
    let skipped = 0;
    for (const term of candidates.slice(entries.length)) {
      if (validateTextPattern(term)) skipped++;
      else kept.push(term);
    }
    if (kept.length === entries.length) {
      setStatus(null);
      setError(t('err_none_valid'));
      return;
    }
    setError(null);
    const addedCount = kept.length - entries.length;
    setStatus(
      t(addedCount === 1 ? 'status_added_one' : 'status_added_other', { n: addedCount }) +
        (skipped > 0 ? t('status_skipped', { n: skipped }) : '.'),
    );
    onChange(kept);
  }

  function addBulk(): void {
    if (!bulk.trim()) return;
    addMany(bulk);
    setBulk('');
  }

  function exportList(kind: 'txt' | 'json'): void {
    const body =
      kind === 'json' ? JSON.stringify(entries, null, 2) : entries.join('\n');
    const type = kind === 'json' ? 'application/json' : 'text/plain';
    const blob = new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `content-blur-keywords-${new Date().toISOString().slice(0, 10)}.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(
      t(entries.length === 1 ? 'status_exported_one' : 'status_exported_other', {
        n: entries.length,
      }),
    );
    setError(null);
  }

  async function importFile(file: File): Promise<void> {
    try {
      const parsed = parseKeywordFile(await file.text());
      if (parsed.length === 0) {
        setError(t('err_no_keywords'));
        setStatus(null);
        return;
      }
      addMany(parsed.join('\n'));
    } catch {
      setError(t('err_cant_read'));
      setStatus(null);
    }
  }

  return (
    <section className="panel">
      <p className="note">
        {t('tp_note1_1')}
        <code>/pattern/flags</code>
        {t('tp_note1_2')}
        <code>/spoiler/i</code>
        {t('tp_note1_3')}
      </p>
      <p className="note">{t('tp_note_a11y')}</p>
      <details className="advanced">
        <summary>{t('tp_tech_summary')}</summary>
        <p className="note">{t('tp_tech_body')}</p>
      </details>
      <div className="field">
        <input
          type="text"
          aria-label={t('aria_add_pattern')}
          placeholder={t('ph_pattern')}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" onClick={add}>
          {t('btn_add')}
        </button>
      </div>

      <div className="subpanel">
        <h2>{t('tp_add_many')}</h2>
        <p className="note">
          {t('tp_one_per_1')}
          <code>/regex/</code>
          {t('tp_one_per_2')}
        </p>
        <textarea
          aria-label={t('aria_add_multi')}
          placeholder={t('ph_bulk')}
          value={bulk}
          onChange={(e) => {
            setBulk(e.target.value);
            if (error) setError(null);
          }}
        />
        <div className="field wrap">
          <button type="button" onClick={addBulk}>
            {t('btn_add_all')}
          </button>
          <button type="button" onClick={() => exportList('txt')} disabled={entries.length === 0}>
            {t('btn_export_txt')}
          </button>
          <button type="button" onClick={() => exportList('json')} disabled={entries.length === 0}>
            {t('btn_export_json')}
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            {t('btn_import_file')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.json,text/plain,application/json"
            aria-label={t('aria_import_keywords')}
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

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
      <ul className="allowlist">
        {entries.map((term) => (
          <li key={term}>
            <span>{term}</span>
            <button
              type="button"
              aria-label={t('aria_remove_pattern', { term })}
              onClick={() => onChange(entries.filter((x) => x !== term))}
            >
              {t('btn_remove')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ----------------------------- Sites panel ---------------------------- */

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

  function add(): void {
    const host = normalizeHost(draft);
    if (!host) {
      setError(t('err_valid_site'));
      return;
    }
    if (allowlist.includes(host)) {
      setError(t('err_host_listed', { host }));
      return;
    }
    setError(null);
    onChange([...allowlist, host]);
    setDraft('');
  }

  return (
    <section className="panel">
      <p className="note">{t('sites_note')}</p>
      <div className="field">
        <input
          type="text"
          aria-label={t('aria_add_site')}
          placeholder={t('ph_site')}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" onClick={add}>
          {t('btn_add')}
        </button>
      </div>
      {error && (
        <p className="note status-err" role="alert">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
      <ul className="allowlist">
        {allowlist.map((host) => (
          <li key={host}>
            <span>{host}</span>
            <button
              type="button"
              aria-label={t('aria_remove_site', { host })}
              onClick={() => onChange(allowlist.filter((h) => h !== host))}
            >
              {t('btn_remove')}
            </button>
          </li>
        ))}
      </ul>

      <SiteOverridesPanel />
    </section>
  );
}

/** Per-site category/radius overrides (feature 1). Distinct from the allowlist. */
function SiteOverridesPanel(): JSX.Element {
  const t = useT();
  const { settings } = useSettings();
  const { value: configs, setValue: setConfigs } = useStorageItem(siteConfigsItem);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const hosts = Object.keys(configs).filter((h) => configs[h]?.blur || configs[h]?.enabled !== undefined);

  function add(): void {
    const host = normalizeHost(draft);
    if (!host) {
      setError(t('err_valid_site'));
      return;
    }
    if (hosts.includes(host)) {
      setError(t('err_host_overrides', { host }));
      return;
    }
    // Seed with the current global values so the toggles start meaningful.
    setError(null);
    setConfigs((prev) => setSiteOverride(prev, host, { blur: { images: settings.blur.images } }));
    setDraft('');
  }

  return (
    <div className="subpanel">
      <h2>{t('heading_per_site')}</h2>
      <p className="note">
        {t('ov_help_1')}
        <strong>{t('ov_help_strong1')}</strong>
        {t('ov_help_2')}
        <strong>{t('ovr_use_global')}</strong>
        {t('ov_help_3')}
        <strong>{t('btn_reset_global')}</strong>
        {t('ov_help_4')}
      </p>
      <div className="field">
        <input
          type="text"
          aria-label={t('aria_add_override')}
          placeholder={t('ph_example')}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" onClick={add}>
          {t('btn_add_override')}
        </button>
      </div>
      {error && (
        <p className="note status-err" role="alert">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
      {hosts.length === 0 && <p className="note">{t('ov_none')}</p>}
      {hosts.map((host) => (
        <SiteOverrideRow
          key={host}
          host={host}
          config={configs[host]}
          globalBlur={settings.blur}
          onChange={(patch) => setConfigs(setSiteOverride(configs, host, patch))}
          onRemove={() => setConfigs(clearSiteOverride(configs, host))}
        />
      ))}
    </div>
  );
}

function SiteOverrideRow({
  host,
  config,
  globalBlur,
  onChange,
  onRemove,
}: {
  host: string;
  config: BlurSiteConfig | undefined;
  globalBlur: BlurSettings;
  onChange: (patch: { enabled?: boolean | undefined; blur?: Partial<BlurSettings> }) => void;
  onRemove: () => void;
}): JSX.Element {
  const t = useT();
  const effective = { ...globalBlur, ...config?.blur };
  const solid = effective.maskStyle === 'solid';
  const own = config?.blur ?? {};
  const owned = overriddenFields(config);

  /** Give one field back to global. An empty config removes the row's entry. */
  function inherit(field: keyof BlurSettings): void {
    onChange({ blur: { [field]: undefined } as Partial<BlurSettings> });
  }

  /** Marker for a field this site actually pins — nothing for an inherited one. */
  function mark(field: keyof BlurSettings): JSX.Element | null {
    if (own[field] === undefined) return null;
    const labelKey = FIELD_LABELS[field];
    return (
      <OverrideMark
        label={labelKey ? t(labelKey) : field}
        globalValue={describeBlurValue(field, globalBlur[field], t)}
        host={host}
        onInherit={() => inherit(field)}
      />
    );
  }

  return (
    <div className="override-row">
      <div className="override-head">
        <span className="override-title">
          <strong>{host}</strong>
          {/* Merged values are what the site GETS, so the toggles below must show
              them — which means an inherited toggle and an overriding one look
              identical. This line, and the marks under each control, are what tell
              them apart. */}
          <span className="sub-line">
            {owned.length === 0
              ? t('ov_follows_all')
              : t(owned.length === 1 ? 'ov_overrides_one' : 'ov_overrides_other', {
                  n: owned.length,
                  list: owned
                    .map((k) => {
                      const key = FIELD_LABELS[k];
                      return key ? t(key) : k;
                    })
                    .join(', '),
                })}
          </span>
        </span>
        <button
          type="button"
          aria-label={t('aria_reset_override', { host })}
          onClick={onRemove}
        >
          {t('btn_reset_global')}
        </button>
      </div>
      <div className="toggles">
        {BLUR_TARGETS.map(({ key, labelKey }) => (
          <label key={key} className={own[key] !== undefined ? 'chip flagged-own' : 'chip'}>
            <input
              type="checkbox"
              aria-label={t('aria_blur_category_site', {
                category: t(labelKey).toLowerCase(),
                host,
              })}
              checked={effective[key]}
              onChange={(e) => onChange({ blur: { [key]: e.target.checked } as Partial<BlurSettings> })}
            />
            {t(labelKey)}
          </label>
        ))}
      </div>
      {BLUR_TARGETS.map(({ key }) => (
        <Fragment key={key}>{mark(key)}</Fragment>
      ))}
      {/* Mask STYLE is per-site: "solid on the work intranet, blur everywhere else"
          is the whole reason overrides exist. The fill COLOUR and OPACITY are not —
          they are one global look, and per-site copies of them would be four more
          controls per row for no real use. The note below says so rather than
          leaving a colour control here that quietly edits the global value. */}
      <div className="field">
        <span id={`ov-mask-${host}`}>{t('field_maskStyle')}</span>
        <div className="mask-styles" role="group" aria-labelledby={`ov-mask-${host}`}>
          {MASK_STYLES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={effective.maskStyle === m.value ? 'seg on' : 'seg'}
              aria-pressed={effective.maskStyle === m.value}
              aria-label={t('aria_mask_site', { style: t(m.labelKey), host })}
              onClick={() => onChange({ blur: { maskStyle: m.value } })}
            >
              {t(m.labelKey)}
            </button>
          ))}
        </div>
      </div>
      {mark('maskStyle')}
      <div className="subordinate">
        {solid ? (
          <p className="note">
            {t('ov_filled_1')}
            <span
              className="swatch-dot"
              style={{ background: safeMaskColor(effective.maskColor) }}
              aria-hidden="true"
            />{' '}
            <code>{safeMaskColor(effective.maskColor)}</code>
            {t('ov_filled_2', {
              pct: Math.round(clampMaskOpacity(effective.maskOpacity) * 100),
            })}
            <strong>{t('value_blur')}</strong>
            {t('ov_filled_3')}
          </p>
        ) : (
          <>
            <label className="field">
              <span>{t('radius_label', { r: effective.radius })}</span>
              <input
                type="range"
                min={4}
                max={40}
                value={effective.radius}
                aria-label={t('aria_radius_site', { host })}
                onChange={(e) => onChange({ blur: { radius: Number(e.target.value) } })}
              />
            </label>
            {mark('radius')}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------- Image sources panel ------------------------ */

function ImageSourcesPanel(): JSX.Element {
  const t = useT();
  const { value: rules, setValue } = useStorageItem(imageSourceRulesItem);
  const { value: prefs, setValue: setPrefs } = useStorageItem(extensionPrefsItem);
  return (
    <section className="panel">
      <p className="note">
        {t('img_note_1')}
        <strong>{t('img_note_never')}</strong>
        {t('img_note_2')}
        <strong>{t('img_note_always')}</strong>
        {t('img_note_3')}
        <code>src</code>
        {t('img_note_4')}
      </p>
      <DomainList
        title={t('img_never_title')}
        values={rules.never}
        onChange={(never) => setValue((prev) => ({ ...prev, never }))}
      />
      <DomainList
        title={t('img_always_title')}
        values={rules.always}
        onChange={(always) => setValue((prev) => ({ ...prev, always }))}
      />
      <div className="subpanel">
        <h2>{t('heading_min_size')}</h2>
        <p className="note">{t('min_size_note')}</p>
        <label className="field">
          <span>{t('min_size_label')}</span>
          <input
            type="number"
            min={0}
            max={512}
            step={1}
            value={prefs.minImagePx}
            aria-label={t('aria_min_size')}
            onChange={(e) =>
              setPrefs((prev) => ({
                ...prev,
                minImagePx: Math.max(0, Math.min(512, Math.floor(Number(e.target.value) || 0))),
              }))
            }
          />
          <span>{t('unit_px')}</span>
        </label>
      </div>
    </section>
  );
}

/* ------------------------------ Links panel --------------------------- */

/**
 * SERP / domain link hiding: blur links (search-result cards, feed items) whose
 * URL points at a listed domain, using only the existing blur engine — no new
 * permission.
 */
function LinksPanel(): JSX.Element {
  const t = useT();
  const { value: prefs, setValue } = useStorageItem(extensionPrefsItem);
  return (
    <section className="panel">
      <p className="note">
        {t('links_note_1')}
        <code>href</code>
        {t('links_note_2')}
      </p>
      <DomainList
        title={t('links_title')}
        values={prefs.linkDomains}
        onChange={(linkDomains) => setValue((prev) => ({ ...prev, linkDomains }))}
      />
    </section>
  );
}

function DomainList({
  title,
  values,
  onChange,
}: {
  title: string;
  values: string[];
  onChange: (next: string[]) => void;
}): JSX.Element {
  const t = useT();
  const [draft, setDraft] = useState('');
  function add(): void {
    const v = draft.trim().toLowerCase();
    if (!v || values.includes(v)) {
      setDraft('');
      return;
    }
    onChange([...values, v]);
    setDraft('');
  }
  return (
    <div className="subpanel">
      <h2>{title}</h2>
      <div className="field">
        <input
          type="text"
          aria-label={title}
          placeholder={t('ph_cdn')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" onClick={add}>
          {t('btn_add')}
        </button>
      </div>
      <ul className="allowlist">
        {values.map((v) => (
          <li key={v}>
            <span>{v}</span>
            <button
              type="button"
              aria-label={t('aria_remove', { v })}
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              {t('btn_remove')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------- Backup panel --------------------------- */

function BackupPanel(): JSX.Element {
  const t = useT();
  const { settings, update } = useSettings();
  const { value: siteConfigs, setValue: setSiteConfigs } = useStorageItem(siteConfigsItem);
  const { value: imageRules, setValue: setImageRules } = useStorageItem(imageSourceRulesItem);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function exportJson(): void {
    const json = serializeBackup(settings, siteConfigs, imageRules);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `content-blur-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(t('status_exported_settings'));
    setError(null);
  }

  async function importFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const parsed = parseBackup(text);
      // Importing REPLACES current settings, per-site overrides and image rules —
      // a destructive action, so confirm before overwriting the user's config.
      const ok = window.confirm(t('confirm_import'));
      if (!ok) {
        setStatus(null);
        setError(null);
        return;
      }
      update(parsed.settings);
      setSiteConfigs(parsed.siteConfigs);
      setImageRules(parsed.imageSourceRules);
      setStatus(t('status_imported'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('err_import_failed'));
      setStatus(null);
    }
  }

  return (
    <section className="panel">
      <p className="note">{t('backup_note')}</p>
      <div className="field">
        <button type="button" onClick={exportJson}>
          {t('btn_export_json_full')}
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          {t('btn_import_json')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label={t('aria_import_settings')}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = '';
          }}
        />
      </div>
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
    </section>
  );
}

/* ----------------------------- About panel ---------------------------- */

function AboutPanel(): JSX.Element {
  const t = useT();
  return (
    <section className="panel">
      <p className="note">{t('about_privacy')}</p>
      <p className="note">
        {t('about_shortcuts_1')}
        <code>chrome://extensions/shortcuts</code>
        {t('about_shortcuts_2')}
      </p>
      <p className="note">{t('about_scope')}</p>
    </section>
  );
}
