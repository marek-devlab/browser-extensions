import { useEffect, useId, useMemo, useState } from 'react';
import { browser } from '#imports';
import { LocaleProvider, ThemeToggle } from '@blur/ui';
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
import { ConnectionSection } from '../../utils/connection';
import { serializeReport } from '../../utils/export';
import { useSettings, useThemeSetter, useWhoamiLocale } from '../../utils/settings';
import { useT } from '../../utils/i18n';
import type { CopyFormat } from '../../utils/storage';

// PRIMARY surface (design §1.1): "who am I, in two scrolls". Device-first, 6
// collapsible tiles, 🔴 ZERO network on open. Every tile is a DISCLOSURE, not a
// dead end — the house pattern inherited verbatim from seo/popup: tapping a header
// reveals the fields it is made of. The full report and options live behind buttons.

export function App() {
  const { locale } = useWhoamiLocale();
  return (
    <LocaleProvider locale={locale}>
      <PopupApp />
    </LocaleProvider>
  );
}

function PopupApp() {
  const t = useT();
  const { settings, update } = useSettings();
  const { theme, setTheme } = useThemeSetter(settings, update);

  // Synchronous device groups — available in the very first paint (design §1.3).
  // Re-derived when the locale changes so baked value strings ("yes"/"no", notes,
  // units) follow the selected language too, not just the labels.
  const groups = useMemo(
    () => ({
      browser: collectBrowser(t),
      hardware: collectHardware(t),
      screen: collectScreen(t),
      locale: collectLocale(t),
      privacy: collectPrivacy(t),
    }),
    [t],
  );

  // Async augmentation (HEV, storage quota, WebGPU): skeleton chips resolve in
  // place, only on the 3 affected fields — no global spinner (design §1.3).
  const [asyncDev, setAsync] = useState<AsyncDevice | null>(null);
  useEffect(() => {
    if (!settings) return;
    void collectAsync(settings.units, t).then(setAsync);
  }, [settings?.units, t]);

  if (!settings) {
    return (
      <div className="popup">
        <p className="loading" role="status" aria-live="polite">
          <span className="ui-spinner" aria-hidden="true" /> {t('loading')}
        </p>
      </div>
    );
  }

  const browser2 = mergeAsync(groups.browser, asyncDev);
  const hardware2 = mergeAsyncHw(groups.hardware, asyncDev);
  const privacy2 = mergeAsyncGpu(groups.privacy, asyncDev);

  return (
    <div className="popup">
      <header className="head">
        <h1>{t('appTitle')}</h1>
        <ThemeToggle theme={theme} onChange={setTheme} />
      </header>

      <Tile group={browser2} icon="🖥" defaultOpen />
      <Tile group={hardware2} icon="⚙" />
      <Tile group={groups.screen} icon="🖵" />
      <Tile group={groups.locale} icon="🌐" />

      {/* Connection tile is special: it owns the real IP flow. Always expanded so
          the reviewer sees the disclosure and the zero-network state immediately. */}
      <section className="tile tile--open">
        <div className="tile__head tile__head--static">
          <span className="tile__icon" aria-hidden="true">📡</span>
          <span className="tile__title">{t('connectionTitle')}</span>
        </div>
        <div className="tile__body">
          <ConnectionSection settings={settings} update={update} />
        </div>
      </section>

      <Tile group={privacy2} icon="🛡" />

      <footer className="foot">
        <button
          type="button"
          className="ui-btn ui-btn--sm"
          onClick={() => void browser.tabs.create({ url: browser.runtime.getURL('/report.html') })}
        >
          {t('fullReport')}
        </button>
        {/* Copy-all in the format chosen in Options (design §2.1). 🔴 Device facts
            only — the popup never lifts the network values out of ConnectionSection,
            so there is nothing here that could carry the IP into the clipboard. */}
        <CopyAllButton
          groups={[browser2, hardware2, groups.screen, groups.locale, privacy2]}
          format={settings.copyFormat}
          includeUnavailable={settings.showUnavailable}
        />
        <button
          type="button"
          className="ui-btn ui-btn--sm"
          onClick={() => void browser.runtime.openOptionsPage()}
          aria-label={t('settings')}
        >
          ⚙ {t('settings')}
        </button>
      </footer>
    </div>
  );
}

/** Copy every device fact on screen in the user's chosen `copyFormat`, with the
 *  same transient acknowledgement as the per-row `CopyIcon`. A real clipboard
 *  failure surfaces (`✕`) rather than faking success. */
function CopyAllButton({
  groups,
  format,
  includeUnavailable,
}: {
  groups: FieldGroup[];
  format: CopyFormat;
  includeUnavailable: boolean;
}) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <button
      type="button"
      className="ui-btn ui-btn--sm"
      aria-live="polite"
      aria-label={t('copyAllAria')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(serializeReport(format, groups, t, { includeUnavailable }));
          setState('ok');
        } catch {
          setState('fail');
        }
        setTimeout(() => setState('idle'), 1500);
      }}
    >
      {state === 'ok' ? `✓ ${t('copied')}` : state === 'fail' ? `✕ ${t('copyError')}` : t('copyAll')}
    </button>
  );
}

/** A collapsible tile = a disclosure (`aria-expanded` + `aria-controls`), keyboard-
 *  and tap-operable (no hover — this ships to Firefox for Android). */
function Tile({
  group,
  icon,
  defaultOpen = false,
}: {
  group: FieldGroup;
  icon: string;
  defaultOpen?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const uid = useId().replace(/:/g, '_');
  return (
    <section className={open ? 'tile tile--open' : 'tile'}>
      <button
        type="button"
        className="tile__head"
        aria-expanded={open}
        aria-controls={open ? `${uid}-body` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="tile__icon" aria-hidden="true">{icon}</span>
        <span className="tile__title">{t(group.titleKey)}</span>
        <span className="tile__caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="tile__body" id={`${uid}-body`} role="region">
          {group.fields.map((f) => (
            <FieldRow key={f.key} label={t(f.key)} field={f.field} copyable={f.copyable} />
          ))}
        </div>
      )}
    </section>
  );
}

/* Merge the async-resolved fields into their groups by stable key. */
function replaceField(group: FieldGroup, key: FieldGroup['fields'][number]['key'], field: FieldGroup['fields'][number]['field']): FieldGroup {
  return {
    ...group,
    fields: group.fields.map((f) => (f.key === key ? { ...f, field } : f)),
  };
}

function mergeAsync(group: FieldGroup, a: AsyncDevice | null): FieldGroup {
  if (!a) return group;
  let g = replaceField(group, 'lbl_architecture', a.architecture);
  g = replaceField(g, 'lbl_osVersion', a.osVersion);
  g = replaceField(g, 'lbl_deviceModel', a.model);
  return g;
}

function mergeAsyncHw(group: FieldGroup, a: AsyncDevice | null): FieldGroup {
  if (!a) return group;
  return replaceField(group, 'lbl_siteStorage', a.storageQuota);
}

function mergeAsyncGpu(group: FieldGroup, a: AsyncDevice | null): FieldGroup {
  if (!a) return group;
  return replaceField(group, 'lbl_gpuWebgpu', a.webgpu);
}
