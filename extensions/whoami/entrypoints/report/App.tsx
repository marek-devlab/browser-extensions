import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from '#imports';
import { ThemeToggle, Callout } from '@blur/ui';
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
import { ConnectionSection, type ConnectionSnapshot } from '../../utils/connection';
import { reportToMarkdown, reportToJson, downloadText, networkGroup } from '../../utils/export';
import { useSettings, useThemeSetter } from '../../utils/settings';

// FULL REPORT (design §2.6): every field, grouped, with a filter, per-group copy,
// export to .md/.json, and the "N fields unavailable in your browser" counter that
// turns the product's main limitation into an explainable characteristic. Opens in
// its own tab from the popup. Still 🔴 zero network until the user asks.

export function App() {
  const { settings, update } = useSettings();
  const { theme, setTheme } = useThemeSetter(settings, update);
  const [filter, setFilter] = useState('');
  const [async, setAsync] = useState<AsyncDevice | null>(null);

  // 🔴 The network values the user fetched in THIS tab, held in component state so
  // the export can include them. They are not persisted anywhere: reload the tab and
  // they are gone, exactly like in the popup (design §0).
  const [net, setNet] = useState<ConnectionSnapshot>({ trace: null, isp: null });
  const [includeNetwork, setIncludeNetwork] = useState(true);
  const [hideIp, setHideIp] = useState(false);
  const onSnapshot = useCallback((snap: ConnectionSnapshot) => setNet(snap), []);

  const [base] = useState(() => [
    collectBrowser(),
    collectHardware(),
    collectScreen(),
    collectLocale(),
    collectPrivacy(),
  ]);

  useEffect(() => {
    if (!settings) return;
    void collectAsync(settings.units).then(setAsync);
  }, [settings?.units]);

  const groups = useMemo(() => (async ? mergeAsync(base, async) : base), [base, async]);

  const unavailableCount = useMemo(
    () =>
      groups.reduce(
        (n, g) => n + g.fields.filter((f) => f.field.kind === 'unavailable').length,
        0,
      ),
    [groups],
  );

  if (!settings) {
    return (
      <main className="report">
        <p role="status" aria-live="polite">
          <span className="ui-spinner" aria-hidden="true" /> Загрузка…
        </p>
      </main>
    );
  }

  const showUnavailable = settings.showUnavailable;
  const q = filter.trim().toLowerCase();
  const visibleGroups = groups.map((g) => ({
    ...g,
    fields: g.fields.filter((f) => {
      if (!showUnavailable && f.field.kind === 'unavailable') return false;
      if (q && !f.label.toLowerCase().includes(q)) return false;
      return true;
    }),
  }));

  const exportOpts = { includeUnavailable: showUnavailable };
  const hasNet = net.trace !== null || net.isp !== null;
  const netGroup = hasNet && includeNetwork ? networkGroup(net.trace, net.isp, { maskIp: hideIp }) : null;
  // The export is exactly what is on screen, plus the network block IF the user
  // fetched it and left it ticked. Nothing is added behind the user's back.
  const exportGroups = netGroup ? [...groups, netGroup] : groups;

  return (
    <main className="report">
      <header className="report__head">
        <div>
          <h1>Кто я · Полный отчёт</h1>
          <p className="report__sub">
            Собран {new Date().toLocaleString()} локально в вашем браузере. Ничего не отправлено.
          </p>
        </div>
        <div className="report__headctl">
          <ThemeToggle theme={theme} onChange={setTheme} />
          <button
            type="button"
            className="ui-btn ui-btn--sm"
            onClick={() => void browser.runtime.openOptionsPage()}
          >
            ⚙ Настройки
          </button>
        </div>
      </header>

      <div className="report__toolbar">
        <input
          type="search"
          className="report__filter"
          placeholder="Фильтр по полю…"
          value={filter}
          aria-label="Фильтр по названию поля"
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="report__toggle">
          <input
            type="checkbox"
            checked={showUnavailable}
            onChange={(e) => update({ showUnavailable: e.target.checked })}
          />
          Показывать недоступные
        </label>
      </div>

      <div className="report__grid">
        <nav className="report__nav" aria-label="Разделы отчёта">
          <ul>
            {groups.map((g) => (
              <li key={g.id}>
                <a href={`#${g.id}`}>
                  <span>{g.title}</span>
                  <span className="report__navcount mono">{g.fields.length}</span>
                </a>
              </li>
            ))}
          </ul>
          {/* The honest counter (design §2.6): the main limitation, made explainable. */}
          <p className="report__unavail">
            ⓘ {unavailableCount} полей недоступны в вашем браузере — у каждого есть объяснение,
            почему.
          </p>
        </nav>

        <div className="report__body">
          {visibleGroups.map((g) => (
            <section key={g.id} id={g.id} className="report__section">
              <h2>{g.title}</h2>
              <div className="report__fields">
                {g.fields.length === 0 ? (
                  <p className="report__empty">Нет полей по текущему фильтру.</p>
                ) : (
                  g.fields.map((f) => (
                    <FieldRow key={f.label} label={f.label} field={f.field} copyable={f.copyable} />
                  ))
                )}
              </div>
            </section>
          ))}

          <section id="network" className="report__section">
            <h2>Сеть (IP)</h2>
            <ConnectionSection settings={settings} update={update} onSnapshot={onSnapshot} />
          </section>
        </div>
      </div>

      <section className="report__export">
        <h2>Экспорт</h2>
        <div className="report__exportrow">
          <button
            type="button"
            className="ui-btn ui-btn--sm"
            onClick={() => void copy(reportToMarkdown(exportGroups, exportOpts))}
          >
            Скопировать Markdown
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--sm"
            onClick={() => void copy(reportToJson(exportGroups, exportOpts))}
          >
            Скопировать JSON
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--sm"
            onClick={() =>
              downloadText('whoami.md', reportToMarkdown(exportGroups, exportOpts), 'text/markdown')
            }
          >
            Скачать .md
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--sm"
            onClick={() =>
              downloadText('whoami.json', reportToJson(exportGroups, exportOpts), 'application/json')
            }
          >
            Скачать .json
          </button>
        </div>

        {/* 🔴 The IP is in an export only if the user fetched it AND leaves this on.
            "Hide IP" exists because the real use of "copy everything" is a support
            ticket — the one moment you least want to hand over your address. */}
        <div className="report__exportopts">
          <label className={hasNet ? 'report__toggle' : 'report__toggle report__toggle--off'}>
            <input
              type="checkbox"
              checked={hasNet && includeNetwork}
              disabled={!hasNet}
              onChange={(e) => setIncludeNetwork(e.target.checked)}
            />
            Включить сетевые данные (IP, страна, ISP)
            {!hasNet && <small> — нечего включать: сетевой запрос не выполнялся</small>}
          </label>
          <label className={hasNet && includeNetwork ? 'report__toggle' : 'report__toggle report__toggle--off'}>
            <input
              type="checkbox"
              checked={hideIp}
              disabled={!hasNet || !includeNetwork}
              onChange={(e) => setHideIp(e.target.checked)}
            />
            Скрыть IP (заменить на <span dir="ltr">203.0.113.x</span>) — для баг-репортов и поддержки
          </label>
        </div>

        <Callout tone="info">
          Отчёт собирается в этом окне и никуда не отправляется — экспорт делает файл через
          <span dir="ltr"> Blob + &lt;a download&gt;</span>, без разрешения на загрузки. 🔴 Токен
          ipinfo.io в экспорт и в буфер обмена не попадает никогда.
        </Callout>
      </section>
    </main>
  );
}

/** Clipboard write from a user gesture — no `clipboardWrite` permission is needed
 *  from an extension document. A failure is swallowed, never thrown into the void. */
async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard denied (rare, e.g. no focus) — the download buttons still work.
  }
}

function mergeAsync(groups: FieldGroup[], a: AsyncDevice): FieldGroup[] {
  const patch: Record<string, Partial<Record<string, FieldGroup['fields'][number]['field']>>> = {
    browser: { Архитектура: a.architecture, 'Версия ОС': a.osVersion, 'Модель устройства': a.model },
    hardware: { 'Хранилище для сайтов': a.storageQuota },
    privacy: { 'GPU (WebGPU)': a.webgpu },
  };
  return groups.map((g) => {
    const p = patch[g.id];
    if (!p) return g;
    return {
      ...g,
      fields: g.fields.map((f) => (p[f.label] ? { ...f, field: p[f.label]! } : f)),
    };
  });
}
