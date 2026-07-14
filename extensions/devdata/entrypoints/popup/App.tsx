import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Callout, MockBadge, ThemeToggle } from '@blur/ui';
import { usePrefs } from '../../utils/prefs';
import { usePermissionFact, requestScripting } from '../../utils/permissions';
import { formatActiveTab, type FormatPageResult } from '../../utils/format-page';

// Popup = a ~5-second LAUNCHER, not a workspace (design §1.2, §2.1). Three
// actions + the theme toggle. The real work happens in the full tool tab, which
// survives focus loss; a popup would throw away a parsed 8 MB document the moment
// the user clicks away.
//
// REAL here: theme persistence, reading the activeTab host, the `scripting`
// permission FACT, opening the tool page, the "looks like JSON" heuristic (URL
// suffix only — we cannot read contentType without injecting). STUBBED: the
// actual in-page formatting (formatActiveTab → todoLogic).

interface ActiveTab {
  id: number | null;
  host: string;
  /** URL ends in .json/.geojson — a HINT, never a claim (design §2.2). */
  looksJson: boolean;
  /** chrome://, about:, store pages — injection impossible (design §4.3). */
  restricted: boolean;
}

function classifyUrl(url: string): Pick<ActiveTab, 'host' | 'looksJson' | 'restricted'> {
  try {
    const u = new URL(url);
    const restricted =
      /^(chrome|edge|about|view-source|moz-extension|chrome-extension):/.test(u.protocol) ||
      u.hostname.endsWith('chromewebstore.google.com');
    return {
      host: u.hostname || url,
      looksJson: /\.(json|geojson)$/i.test(u.pathname),
      restricted,
    };
  } catch {
    return { host: url || 'эта вкладка', looksJson: false, restricted: true };
  }
}

export function App() {
  const { prefs, update } = usePrefs();
  const scripting = usePermissionFact('scripting');
  const [tab, setTab] = useState<ActiveTab | null>(null);
  const [pageResult, setPageResult] = useState<FormatPageResult | 'loading' | null>(null);

  useEffect(() => {
    void (async () => {
      const [active] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!active) {
        setTab({ id: null, host: 'эта вкладка', looksJson: false, restricted: true });
        return;
      }
      setTab({ id: active.id ?? null, ...classifyUrl(active.url ?? '') });
    })();
  }, []);

  const openTool = (route: 'data' | 'jwt' | 'schema' | 'settings' = 'data') => {
    void browser.tabs.create({ url: browser.runtime.getURL(`/tool.html#/${route}`) });
    window.close();
  };

  const pasteAndOpen = () => {
    // design §4.1: clipboard read from a popup can fail (no transient
    // activation) — the tool page must never dead-end. For the scaffold we open
    // the tool with a hint; the real read happens on the tool page.
    // TODO_LOGIC: devdata — attempt navigator.clipboard.readText() here and hand
    // the text to the tool; fall back to opening an empty, focused editor (§4.1).
    openTool('data');
  };

  const formatHere = async () => {
    if (tab?.id == null) return;
    // Chrome: request `scripting` permission-only (no host → no scary prompt,
    // design §4.3) when we don't already hold it. Firefox MV2 reports it as held.
    if (scripting === false) {
      const granted = await requestScripting();
      if (!granted) {
        setPageResult({ status: 'denied' });
        return;
      }
    }
    setPageResult('loading');
    const result = await formatActiveTab(tab.id);
    setPageResult(result);
  };

  const canFormatHere = tab !== null && tab.id !== null && !tab.restricted;

  return (
    <div className="popup">
      <header className="head">
        <div className="head__top">
          <h1>Data Format Toolkit</h1>
          <ThemeToggle theme={prefs?.theme ?? 'auto'} onChange={(theme) => update({ theme })} />
        </div>
        <span className="host mono" title={tab?.host ?? ''}>
          {tab?.host ?? 'загрузка…'}
        </span>
      </header>

      <MockBadge />

      {tab?.looksJson && !tab.restricted && (
        <Callout tone="info" title="ⓘ Похоже на JSON-документ">
          Открыть содержимое этой вкладки в инструменте?
          <div className="row row--gap">
            <Button variant="primary" onClick={() => openTool('data')}>
              Открыть
            </Button>
            <Button onClick={() => void formatHere()} disabled={!canFormatHere}>
              Форматировать тут
            </Button>
          </div>
        </Callout>
      )}

      <div className="stack">
        <Button variant="primary" onClick={pasteAndOpen}>
          Вставить из буфера и открыть <kbd>⌘⇧V</kbd>
        </Button>
        <Button onClick={() => openTool('data')}>Открыть инструмент</Button>
      </div>

      <section>
        <h2 className="ui-section-heading">Форматирование страниц</h2>
        <Button onClick={() => void formatHere()} disabled={!canFormatHere}>
          Форматировать JSON на этой вкладке
        </Button>
        <p className="fine">
          {tab?.restricted
            ? 'Браузер не разрешает расширениям работать на этой странице.'
            : 'Разовое действие по клику. Доступ к сайту не выдаётся — только к этой вкладке и только сейчас.'}
        </p>

        <div aria-live="polite">
          {pageResult === 'loading' && <p className="fine">Читаем вкладку…</p>}
          {pageResult !== null && pageResult !== 'loading' && (
            <p className="fine">{describeResult(pageResult)}</p>
          )}
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={prefs?.autoFormat ?? false}
            // Toggling the INTENT here still requires the <all_urls> grant, which
            // is requested behind the consent dialog on the Settings tab (§2.11).
            onChange={() => openTool('settings')}
          />
          <span>
            Форматировать JSON-страницы автоматически
            <span className="fine"> — требует доступа, настраивается в параметрах</span>
          </span>
        </label>
      </section>

      <footer className="foot">100% офлайн · ноль сети · ноль аналитики</footer>
    </div>
  );
}

function describeResult(result: FormatPageResult): string {
  switch (result.status) {
    case 'formatted':
      return 'Готово: вкладка отформатирована (демо).';
    case 'not-json':
      return `На этой странице нет JSON-документа (тип: ${result.contentType}).`;
    case 'restricted':
      return 'Браузер не разрешает расширениям работать на этой странице.';
    case 'denied':
      return 'Доступ не выдан — фича не работает.';
  }
}
