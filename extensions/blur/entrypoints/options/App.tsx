import { Fragment, useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { BlurSettings, BlurSiteConfig, MaskStyle, RevealMode } from '@blur/core';
import { clampMaskOpacity, safeMaskColor, solidMaskFilter } from '@blur/core';
import { useSettings } from '../../utils/use-settings';
import { useStorageItem } from '../../utils/use-storage-item';
import { siteConfigsItem, imageSourceRulesItem, extensionPrefsItem } from '../../utils/storage';
import { validateTextPattern } from '../../utils/text-blur';
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

type Tab = 'blur' | 'text' | 'sites' | 'images' | 'links' | 'backup' | 'about';

const TABS: { id: Tab; label: string }[] = [
  { id: 'blur', label: 'Blur' },
  { id: 'text', label: 'Text patterns' },
  { id: 'sites', label: 'Sites' },
  { id: 'images', label: 'Image sources' },
  { id: 'links', label: 'Links' },
  { id: 'backup', label: 'Backup' },
  { id: 'about', label: 'About' },
];

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

const MASK_STYLES: { value: MaskStyle; label: string; hint: string }[] = [
  {
    value: 'blur',
    label: 'Blur',
    hint: 'Softens the content. Shape and colour still read through — you can tell a photo from a video.',
  },
  {
    value: 'solid',
    label: 'Solid colour',
    hint: 'Paints an opaque rectangle over the content. Nothing about it survives, and it costs less to render than blur.',
  },
];

/** Ready-made fills, so the common choices are one tap away on a phone. */
const MASK_SWATCHES: { color: string; label: string }[] = [
  { color: '#1f2430', label: 'Slate (default)' },
  { color: '#000000', label: 'Black' },
  { color: '#6b7280', label: 'Grey' },
  { color: '#f2f3f5', label: 'Paper' },
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

function describeBlurValue(field: keyof BlurSettings, v: unknown): string {
  switch (field) {
    case 'maskStyle':
      return v === 'solid' ? 'Solid colour' : 'Blur';
    case 'radius':
      return `${String(v)}px`;
    case 'maskOpacity':
      return `${Math.round(clampMaskOpacity(Number(v)) * 100)}%`;
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
  return (
    <p className="ovr ovr-inherit">
      <span className="ovr-icon" aria-hidden="true">
        ↳
      </span>
      <span className="ovr-txt">
        <strong>{label}</strong> overrides global (<strong>{globalValue}</strong>).
      </span>
      <button
        type="button"
        className="ovr-btn"
        aria-label={`Use the global ${label} setting on ${host}`}
        onClick={onInherit}
      >
        Use global
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
  const { settings, update, loaded, error } = useSettings();
  const [tab, setTab] = useState<Tab>('blur');

  if (!loaded) return <main className="options">Loading…</main>;

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
        <h1>Content Blur</h1>
        <label className="master-toggle">
          <span>{settings.enabled ? 'Enabled' : 'Disabled'}</span>
          <span className="switch">
            <input
              type="checkbox"
              aria-label="Enable Content Blur globally"
              checked={settings.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            <span className="slider" />
          </span>
        </label>
      </header>
      {!settings.enabled && (
        <p className="note" role="status">
          Content Blur is turned off everywhere. Turn it back on to blur content and edit the
          settings below.
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
    <div className="tabs" role="tablist" aria-label="Settings sections" onKeyDown={onKey}>
      {tabs.map((t, idx) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={current === t.id}
          aria-controls={current === t.id ? `panel-${t.id}` : undefined}
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

/* ---------------------------- Blur panel ------------------------------ */

function PresetRow({
  radius,
  onPreset,
}: {
  radius: number;
  onPreset: (name: PresetName) => void;
}): JSX.Element {
  const active = presetForRadius(radius);
  return (
    <div className="field">
      <span id="opt-preset-label">Blur strength</span>
      <div className="presets" role="group" aria-labelledby="opt-preset-label">
        {(Object.keys(BLUR_PRESETS) as PresetName[]).map((name) => (
          <button
            key={name}
            type="button"
            className={active === name ? 'seg on' : 'seg'}
            aria-pressed={active === name}
            onClick={() => onPreset(name)}
          >
            {BLUR_PRESETS[name].label} ({BLUR_PRESETS[name].radius}px)
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
        <figcaption>Original</figcaption>
      </figure>
      <figure className="preview-fig">
        <div className="preview-frame">
          <img src={SAMPLE_IMAGE} alt="Preview of an image with your mask applied" style={{ filter }} />
          {blur.showLabels && <span className="preview-chip">JPEG · 1200×800</span>}
        </div>
        <figcaption>
          {blur.maskStyle === 'solid'
            ? `Solid ${blur.maskColor} · ${Math.round(blur.maskOpacity * 100)}%`
            : `Blur ${radius}px`}
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
  const solid = blur.maskStyle === 'solid';
  const style = MASK_STYLES.find((m) => m.value === blur.maskStyle);
  const opacityPct = Math.round(clampMaskOpacity(blur.maskOpacity) * 100);
  return (
    <div className="subpanel">
      <h2>How content is hidden</h2>
      <div className="field">
        <span id="opt-mask-label">Mask style</span>
        <div className="mask-styles" role="group" aria-labelledby="opt-mask-label">
          {MASK_STYLES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={blur.maskStyle === m.value ? 'seg on' : 'seg'}
              aria-pressed={blur.maskStyle === m.value}
              onClick={() => setBlur({ maskStyle: m.value })}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {style && <p className="note">{style.hint}</p>}

      <MaskPreview blur={blur} radius={radius} />

      <div className="subordinate">
        {solid ? (
          <>
            <div className="field">
              <span id="opt-swatch-label">Fill colour</span>
              <div className="swatches" role="group" aria-labelledby="opt-swatch-label">
                {MASK_SWATCHES.map((s) => (
                  <button
                    key={s.color}
                    type="button"
                    className={safeMaskColor(blur.maskColor) === s.color ? 'swatch on' : 'swatch'}
                    style={{ background: s.color }}
                    title={s.label}
                    aria-label={s.label}
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
                  aria-label="Custom fill colour"
                  value={safeMaskColor(blur.maskColor)}
                  onChange={(e) => setBlur({ maskColor: e.target.value })}
                />
                <code className="swatch-hex">{safeMaskColor(blur.maskColor)}</code>
              </div>
            </div>
            <label className="field">
              <span>Fill opacity: {opacityPct}%</span>
              <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={opacityPct}
                aria-label="Fill opacity, as a percentage"
                onChange={(e) => setBlur({ maskOpacity: clampMaskOpacity(Number(e.target.value) / 100) })}
              />
            </label>
            <p className="note">
              This does <strong>not</strong> let the hidden content show through. Below 100% you see
              the <strong>page's own background</strong> through the fill — never the image or video,
              which is never drawn at all. Lower it only to make the mask blend into a page.
            </p>
          </>
        ) : (
          <>
            <PresetRow radius={radius} onPreset={(name) => onRadius(BLUR_PRESETS[name].radius)} />
            <label className="field">
              <span>Radius: {radius}px</span>
              <input
                type="range"
                min={4}
                max={40}
                value={radius}
                aria-label="Blur radius in pixels"
                onChange={(e) => onRadius(Number(e.target.value))}
              />
            </label>
            <p className="note">
              A blur is a visual softening, not a guarantee: a heavily blurred picture can still be
              recognisable. Choose <strong>Solid colour</strong> when it must not be readable at all.
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
        {hosts.length === 1 ? '1 site overrides' : `${hosts.length} sites override`} some of
        these settings and will not follow changes made here: {shown.join(', ')}
        {hosts.length > shown.length ? ` and ${hosts.length - shown.length} more` : ''}.
      </span>
      <button type="button" className="ovr-btn" onClick={onManageSites}>
        Review per-site overrides
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
        {BLUR_TARGETS.map(({ key, label }) => (
          <label key={key} className="chip">
            <input
              type="checkbox"
              aria-label={`Blur ${label.toLowerCase()}`}
              checked={settings.blur[key]}
              onChange={(e) => setBlur({ [key]: e.target.checked } as Partial<BlurSettings>)}
            />
            {label}
          </label>
        ))}
      </div>
      {settings.blur.text && (
        <p className="note">
          Accessibility: blurred text stays in the DOM and the accessibility tree, so screen readers
          still read it aloud and it remains findable via Ctrl+F.
        </p>
      )}

      <MaskSection
        blur={settings.blur}
        radius={radius}
        onRadius={onRadiusChange}
        setBlur={setBlur}
      />

      <div className="subpanel">
        <h2>Revealing</h2>
        <label className="field">
          <span>Show blurred content</span>
          <select value={settings.blur.reveal} onChange={(e) => setBlur({ reveal: e.target.value as RevealMode })}>
            {REVEAL_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {settings.blur.reveal === 'hover' && (
          <p className="note">
            On touch devices nothing can hover, so <strong>On hover</strong> automatically becomes
            tap-to-reveal there — hidden content is never a dead end on a phone.
          </p>
        )}
        <RevealTimeoutField />
        <label className="field">
          <span>
            Re-hide when I switch away
            <span className="sub-line">
              Instantly hides everything you revealed as soon as the tab is in the background or the
              window loses focus — for when you are screen-sharing, or someone walks up.
            </span>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              aria-label="Re-hide revealed content when the tab or window loses focus"
              checked={settings.blur.rehideOnBlur}
              onChange={(e) => setBlur({ rehideOnBlur: e.target.checked })}
            />
            <span className="slider" />
          </span>
        </label>
      </div>

      <div className="subpanel">
        <h2>Labels</h2>
        <label className="field">
          <span>
            Label what is hidden
            <span className="sub-line">
              Puts a small chip on each masked element naming what is underneath — "JPEG · 1200×800",
              "MP4 · 0:42" — so you can tell items apart without revealing them.
            </span>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              aria-label="Show a label chip on each masked element"
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
  const { value: prefs, setValue } = useStorageItem(extensionPrefsItem);
  const options = [0, 3, 5, 10, 30, 60];
  return (
    <label className="field">
      <span>Re-hide revealed content after</span>
      <select
        value={prefs.revealTimeoutSec}
        aria-label="Automatically re-hide revealed content after this many seconds"
        onChange={(e) => setValue({ ...prefs, revealTimeoutSec: Number(e.target.value) })}
      >
        {options.map((sec) => (
          <option key={sec} value={sec}>
            {sec === 0 ? 'Never (until I leave)' : `${sec} seconds`}
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
      setError('That pattern is already in the list.');
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
      setStatus('Nothing new to add — those keywords were already in the list.');
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
      setError('None of those were valid patterns.');
      return;
    }
    setError(null);
    setStatus(
      `Added ${kept.length - entries.length} keyword${kept.length - entries.length === 1 ? '' : 's'}` +
        (skipped > 0 ? `, skipped ${skipped} invalid.` : '.'),
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
    setStatus(`Exported ${entries.length} keyword${entries.length === 1 ? '' : 's'}.`);
    setError(null);
  }

  async function importFile(file: File): Promise<void> {
    try {
      const parsed = parseKeywordFile(await file.text());
      if (parsed.length === 0) {
        setError('That file had no keywords.');
        setStatus(null);
        return;
      }
      addMany(parsed.join('\n'));
    } catch {
      setError('Could not read that file.');
      setStatus(null);
    }
  }

  return (
    <section className="panel">
      <p className="note">
        Add words or phrases to blur wherever they appear on a page. Use{' '}
        <code>/pattern/flags</code> for a regular expression — for example{' '}
        <code>/spoiler/i</code> to match any capitalization.
      </p>
      <p className="note">
        Accessibility: blurred text stays in the DOM and the accessibility tree, so screen readers still read it
        aloud, and it is still copyable and findable via Ctrl+F. CSS blur obscures content visually — it is not a
        way to truly hide it.
      </p>
      <details className="advanced">
        <summary>Technical details</summary>
        <p className="note">
          Plain keywords are compiled into a single alternation regex and matched in one pass.
          Beyond ~1–2k terms this would move to an Aho-Corasick automaton — one linear scan
          regardless of term count.
        </p>
      </details>
      <div className="field">
        <input
          type="text"
          aria-label="Add a text pattern"
          placeholder="keyword or /regex/i"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" onClick={add}>
          Add
        </button>
      </div>

      <div className="subpanel">
        <h2>Add many at once</h2>
        <p className="note">One keyword or <code>/regex/</code> per line.</p>
        <textarea
          aria-label="Add multiple keywords, one per line"
          placeholder={'spoiler\nseason finale\n/leak(ed)?/i'}
          value={bulk}
          onChange={(e) => {
            setBulk(e.target.value);
            if (error) setError(null);
          }}
        />
        <div className="field wrap">
          <button type="button" onClick={addBulk}>
            Add all
          </button>
          <button type="button" onClick={() => exportList('txt')} disabled={entries.length === 0}>
            Export .txt
          </button>
          <button type="button" onClick={() => exportList('json')} disabled={entries.length === 0}>
            Export .json
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            Import file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.json,text/plain,application/json"
            aria-label="Import a keyword file"
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
            <button type="button" aria-label={`Remove pattern ${term}`} onClick={() => onChange(entries.filter((t) => t !== term))}>
              Remove
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
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add(): void {
    const host = normalizeHost(draft);
    if (!host) {
      setError('Enter a valid site, e.g. example.com.');
      return;
    }
    if (allowlist.includes(host)) {
      setError(`${host} is already on the list.`);
      return;
    }
    setError(null);
    onChange([...allowlist, host]);
    setDraft('');
  }

  return (
    <section className="panel">
      <p className="note">Sites on the allowlist are fully excluded — the extension does nothing on them.</p>
      <div className="field">
        <input
          type="text"
          aria-label="Add a site to the allowlist"
          placeholder="example.com or https://example.com/page"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
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
      <ul className="allowlist">
        {allowlist.map((host) => (
          <li key={host}>
            <span>{host}</span>
            <button type="button" aria-label={`Remove ${host} from allowlist`} onClick={() => onChange(allowlist.filter((h) => h !== host))}>
              Remove
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
  const { settings } = useSettings();
  const { value: configs, setValue: setConfigs } = useStorageItem(siteConfigsItem);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const hosts = Object.keys(configs).filter((h) => configs[h]?.blur || configs[h]?.enabled !== undefined);

  function add(): void {
    const host = normalizeHost(draft);
    if (!host) {
      setError('Enter a valid site, e.g. example.com.');
      return;
    }
    if (hosts.includes(host)) {
      setError(`${host} already has overrides.`);
      return;
    }
    // Seed with the current global values so the toggles start meaningful.
    setError(null);
    setConfigs(setSiteOverride(configs, host, { blur: { images: settings.blur.images } }));
    setDraft('');
  }

  return (
    <div className="subpanel">
      <h2>Per-site overrides</h2>
      <p className="note">
        Choose exactly which categories blur, and how strongly, on a specific site. A site's
        overrides <strong>beat your global settings</strong> there — so a marked control below is
        one the Blur tab can no longer move on that site. Marked settings are the site's own;
        everything else follows global. Use <strong>Use global</strong> to give a single setting
        back, or <strong>Reset to global</strong> to clear the site entirely. This needs no extra
        browser permission.
      </p>
      <div className="field">
        <input
          type="text"
          aria-label="Add a site override"
          placeholder="example.com"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" onClick={add}>
          Add override
        </button>
      </div>
      {error && (
        <p className="note status-err" role="alert">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
      {hosts.length === 0 && <p className="note">No per-site overrides yet.</p>}
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
    return (
      <OverrideMark
        label={FIELD_LABELS[field] ?? field}
        globalValue={describeBlurValue(field, globalBlur[field])}
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
              ? 'Follows global for everything.'
              : `Overrides ${owned.length} setting${owned.length === 1 ? '' : 's'}: ${owned
                  .map((k) => FIELD_LABELS[k] ?? k)
                  .join(', ')}. Everything else follows global.`}
          </span>
        </span>
        <button
          type="button"
          aria-label={`Clear ${host}'s overrides and use global settings there`}
          onClick={onRemove}
        >
          Reset to global
        </button>
      </div>
      <div className="toggles">
        {BLUR_TARGETS.map(({ key, label }) => (
          <label key={key} className={own[key] !== undefined ? 'chip flagged-own' : 'chip'}>
            <input
              type="checkbox"
              aria-label={`Blur ${label.toLowerCase()} on ${host}`}
              checked={effective[key]}
              onChange={(e) => onChange({ blur: { [key]: e.target.checked } as Partial<BlurSettings> })}
            />
            {label}
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
        <span id={`ov-mask-${host}`}>Mask style</span>
        <div className="mask-styles" role="group" aria-labelledby={`ov-mask-${host}`}>
          {MASK_STYLES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={effective.maskStyle === m.value ? 'seg on' : 'seg'}
              aria-pressed={effective.maskStyle === m.value}
              aria-label={`${m.label} mask on ${host}`}
              onClick={() => onChange({ blur: { maskStyle: m.value } })}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {mark('maskStyle')}
      <div className="subordinate">
        {solid ? (
          <p className="note">
            Filled with{' '}
            <span
              className="swatch-dot"
              style={{ background: safeMaskColor(effective.maskColor) }}
              aria-hidden="true"
            />{' '}
            <code>{safeMaskColor(effective.maskColor)}</code> at{' '}
            {Math.round(clampMaskOpacity(effective.maskOpacity) * 100)}%. Colour and opacity are
            global — change them under <strong>Blur</strong>.
          </p>
        ) : (
          <>
            <label className="field">
              <span>Radius: {effective.radius}px</span>
              <input
                type="range"
                min={4}
                max={40}
                value={effective.radius}
                aria-label={`Blur radius on ${host}`}
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
  const { value: rules, setValue } = useStorageItem(imageSourceRulesItem);
  const { value: prefs, setValue: setPrefs } = useStorageItem(extensionPrefsItem);
  return (
    <section className="panel">
      <p className="note">
        Match by any part of an image URL (usually a domain). <strong>Never blur</strong> keeps images
        from these sources sharp even when Images is on; <strong>Always blur</strong> blurs them even
        when Images is off. Matching is a plain substring of the <code>src</code>.
      </p>
      <DomainList
        title="Never blur images from"
        values={rules.never}
        onChange={(never) => setValue({ ...rules, never })}
      />
      <DomainList
        title="Always blur images from"
        values={rules.always}
        onChange={(always) => setValue({ ...rules, always })}
      />
      <div className="subpanel">
        <h2>Minimum image size</h2>
        <p className="note">
          Skip blurring tiny images — favicons, icons and 1px tracking pixels — so only real pictures
          are blurred. An image is left sharp when it is smaller than this in both width and height.
        </p>
        <label className="field">
          <span>Don't blur images under</span>
          <input
            type="number"
            min={0}
            max={512}
            step={1}
            value={prefs.minImagePx}
            aria-label="Minimum image size in pixels"
            onChange={(e) =>
              setPrefs({
                ...prefs,
                minImagePx: Math.max(0, Math.min(512, Math.floor(Number(e.target.value) || 0))),
              })
            }
          />
          <span>px</span>
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
  const { value: prefs, setValue } = useStorageItem(extensionPrefsItem);
  return (
    <section className="panel">
      <p className="note">
        Blur links whose address contains one of these domains — for example to soften results from a
        site you'd rather not see in search pages or feeds. Matching is a plain substring of the link's{' '}
        <code>href</code>. This uses only the existing blur engine and needs no extra permission.
      </p>
      <DomainList
        title="Blur links pointing at"
        values={prefs.linkDomains}
        onChange={(linkDomains) => setValue({ ...prefs, linkDomains })}
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
          placeholder="cdn.example.com"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" onClick={add}>
          Add
        </button>
      </div>
      <ul className="allowlist">
        {values.map((v) => (
          <li key={v}>
            <span>{v}</span>
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------- Backup panel --------------------------- */

function BackupPanel(): JSX.Element {
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
    setStatus('Settings exported.');
    setError(null);
  }

  async function importFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const parsed = parseBackup(text);
      // Importing REPLACES current settings, per-site overrides and image rules —
      // a destructive action, so confirm before overwriting the user's config.
      const ok = window.confirm(
        'Import will replace your current settings, per-site overrides and image-source rules. Continue?',
      );
      if (!ok) {
        setStatus(null);
        setError(null);
        return;
      }
      update(parsed.settings);
      setSiteConfigs(parsed.siteConfigs);
      setImageRules(parsed.imageSourceRules);
      setStatus('Settings imported.');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
      setStatus(null);
    }
  }

  return (
    <section className="panel">
      <p className="note">
        Export all settings, per-site overrides, text patterns and image-source rules to a JSON file,
        or import them back on another machine. Everything stays on your device.
      </p>
      <div className="field">
        <button type="button" onClick={exportJson}>
          Export to JSON
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Import from JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label="Import settings file"
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
  return (
    <section className="panel">
      <p className="note">
        Privacy: no browsing data leaves your device. Page scanning, blurring and counting all happen locally.
      </p>
      <p className="note">
        Keyboard shortcuts (rebind at <code>chrome://extensions/shortcuts</code>): Alt+Shift+B toggles the
        extension globally, Alt+Shift+R reveals everything on the page, and Alt+Shift+P is a panic toggle that
        blurs all media instantly.
      </p>
      <p className="note">
        This extension only blurs content. Ad blocking lives in a separate companion extension, so each add-on
        keeps a single, narrow purpose.
      </p>
    </section>
  );
}
