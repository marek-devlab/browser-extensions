import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Callout, ThemeToggle } from '@blur/ui';
import { usePrefs } from '../../utils/prefs';
import { usePermissionFact, requestScripting } from '../../utils/permissions';
import { formatActiveTab, type FormatPageResult } from '../../utils/format-page';
import { putHandoff } from '../../utils/handoff';

// The popup is a ~5-second LAUNCHER, not a workspace (design §1.2, §2.1). The
// real work happens in the full tool tab, which survives focus loss — a popup
// would throw away a parsed 8 MB document the moment the user clicked away.
//
// What the toolbar click buys us: `activeTab`. That is the ONLY gesture that
// grants the current tab, which is why "format this tab" lives here.

interface ActiveTab {
  id: number | null;
  host: string;
  /** URL ends in .json/.geojson — a HINT, never a claim (design §2.2). */
  looksJson: boolean;
  /** chrome://, about:, store pages — injection is impossible (design §4.3). */
  restricted: boolean;
}

function classifyUrl(url: string): Omit<ActiveTab, 'id'> {
  try {
    const u = new URL(url);
    const restricted =
      /^(chrome|edge|about|view-source|moz-extension|chrome-extension|resource):/.test(
        u.protocol,
      ) || u.hostname.endsWith('chromewebstore.google.com');
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
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [active] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!active) {
          setTab({ id: null, host: 'эта вкладка', looksJson: false, restricted: true });
          return;
        }
        setTab({ id: active.id ?? null, ...classifyUrl(active.url ?? '') });
      } catch {
        setTab({ id: null, host: 'эта вкладка', looksJson: false, restricted: true });
      }
    })();
  }, []);

  const openTool = (route: 'data' | 'jwt' | 'schema' | 'settings' = 'data') => {
    browser.tabs
      .create({ url: browser.runtime.getURL(`/tool.html#/${route}`) })
      .catch(() => undefined)
      .finally(() => window.close());
  };

  const pasteAndOpen = async () => {
    // `readText()` from a popup can fail (no transient activation, or the user
    // denied clipboard-read). That must never be a dead end: we open the tool
    // anyway and tell the user to press ⌘/Ctrl+V there (design §4.1).
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim() === '') {
        setPasteNote('Буфер обмена пуст. Откройте инструмент и вставьте текст туда (⌘/Ctrl+V).');
        return;
      }
      // A clipboard JWT is refused by putHandoff (credentials never touch
      // storage) — we land on the JWT tab and the user pastes it there.
      const outcome = await putHandoff(text, 'clipboard');
      openTool(outcome === 'jwt-skipped' ? 'jwt' : 'data');
    } catch {
      setPasteNote(
        'Браузер не дал прочитать буфер обмена из попапа. Открываем инструмент — нажмите там ⌘/Ctrl+V.',
      );
      setTimeout(() => openTool('data'), 900);
    }
  };

  const formatHere = async () => {
    if (tab?.id == null) return;
    // Chrome MV3: `scripting` is a PERMISSION-only request — no host is asked
    // for, so there is no "read your data on all sites" prompt (design §4.3).
    // Firefox MV2 does not need it at all and reports it as held.
    if (scripting === false) {
      const granted = await requestScripting();
      if (!granted) {
        setPageResult({ status: 'denied' });
        return;
      }
    }
    setPageResult('loading');
    setPageResult(await formatActiveTab(tab.id));
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

      {tab?.looksJson && !tab.restricted && (
        <Callout tone="info" title="ⓘ Похоже на JSON-документ">
          {/* "Похоже", not "это": without injecting a script we cannot read
              document.contentType, and pretending otherwise would be a lie (§2.2). */}
          Судим только по адресу — тип документа отсюда не виден.
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
        <Button variant="primary" onClick={() => void pasteAndOpen()}>
          Вставить из буфера и открыть
        </Button>
        <Button onClick={() => openTool('data')}>Открыть инструмент</Button>
      </div>

      {pasteNote !== null && (
        <p className="fine" role="status" aria-live="polite">
          {pasteNote}
        </p>
      )}

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

        <button type="button" className="linkish" onClick={() => openTool('settings')}>
          Авто-формат JSON-страниц — в настройках
          <span className="fine"> (требует доступа ко всем сайтам)</span>
        </button>
      </section>

      <footer className="foot">100% офлайн · ноль сети · ноль аналитики</footer>
    </div>
  );
}

function describeResult(result: FormatPageResult): string {
  switch (result.status) {
    case 'formatted':
      return 'Готово: вкладка отформатирована. Кнопка ✕ на странице вернёт исходный документ.';
    case 'not-json':
      return `На этой странице нет JSON-документа (тип: ${result.contentType}). Скопируйте нужный фрагмент и вставьте в инструмент.`;
    case 'restricted':
      return 'Браузер не разрешает расширениям работать на этой странице.';
    case 'denied':
      return 'Доступ не выдан — фича не работает. Всё остальное работает как работало.';
    case 'error':
      return `Не удалось отформатировать: ${result.message}`;
  }
}
