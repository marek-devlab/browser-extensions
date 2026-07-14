import { useEffect, useId, useState } from 'react';
import { browser } from '#imports';
import { ThemeToggle } from '@blur/ui';
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
import { useSettings, useThemeSetter } from '../../utils/settings';

// PRIMARY surface (design §1.1): "who am I, in two scrolls". Device-first, 6
// collapsible tiles, 🔴 ZERO network on open. Every tile is a DISCLOSURE, not a
// dead end — the house pattern inherited verbatim from seo/popup: tapping a header
// reveals the fields it is made of. The full report and options live behind buttons.

export function App() {
  const { settings, update } = useSettings();
  const { theme, setTheme } = useThemeSetter(settings, update);

  // Synchronous device groups — available in the very first paint (design §1.3).
  const [groups] = useState(() => ({
    browser: collectBrowser(),
    hardware: collectHardware(),
    screen: collectScreen(),
    locale: collectLocale(),
    privacy: collectPrivacy(),
  }));

  // Async augmentation (HEV, storage quota, WebGPU): skeleton chips resolve in
  // place, only on the 3 affected fields — no global spinner (design §1.3).
  const [async, setAsync] = useState<AsyncDevice | null>(null);
  useEffect(() => {
    if (!settings) return;
    void collectAsync(settings.units).then(setAsync);
  }, [settings?.units]);

  if (!settings) {
    return (
      <div className="popup">
        <p className="loading" role="status" aria-live="polite">
          <span className="ui-spinner" aria-hidden="true" /> Загрузка…
        </p>
      </div>
    );
  }

  const browser2 = mergeAsync(groups.browser, async);
  const hardware2 = mergeAsyncHw(groups.hardware, async);
  const privacy2 = mergeAsyncGpu(groups.privacy, async);

  return (
    <div className="popup">
      <header className="head">
        <h1>Кто я</h1>
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
          <span className="tile__title">Соединение</span>
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
          Полный отчёт
        </button>
        <button
          type="button"
          className="ui-btn ui-btn--sm"
          onClick={() => void browser.runtime.openOptionsPage()}
          aria-label="Настройки"
        >
          ⚙ Настройки
        </button>
      </footer>
    </div>
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
        <span className="tile__title">{group.title}</span>
        <span className="tile__caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="tile__body" id={`${uid}-body`} role="region">
          {group.fields.map((f) => (
            <FieldRow key={f.label} label={f.label} field={f.field} copyable={f.copyable} />
          ))}
        </div>
      )}
    </section>
  );
}

/* Merge the async-resolved fields into their groups by label. */
function replaceField(group: FieldGroup, label: string, field: FieldGroup['fields'][number]['field']): FieldGroup {
  return {
    ...group,
    fields: group.fields.map((f) => (f.label === label ? { ...f, field } : f)),
  };
}

function mergeAsync(group: FieldGroup, a: AsyncDevice | null): FieldGroup {
  if (!a) return group;
  let g = replaceField(group, 'Архитектура', a.architecture);
  g = replaceField(g, 'Версия ОС', a.osVersion);
  g = replaceField(g, 'Модель устройства', a.model);
  return g;
}

function mergeAsyncHw(group: FieldGroup, a: AsyncDevice | null): FieldGroup {
  if (!a) return group;
  return replaceField(group, 'Хранилище для сайтов', a.storageQuota);
}

function mergeAsyncGpu(group: FieldGroup, a: AsyncDevice | null): FieldGroup {
  if (!a) return group;
  return replaceField(group, 'GPU (WebGPU)', a.webgpu);
}
