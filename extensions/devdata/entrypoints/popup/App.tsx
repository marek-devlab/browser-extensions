import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  Button,
  Callout,
  LocaleProvider,
  ThemeToggle,
  useLocale,
  useLocaleController,
} from '@blur/ui';
import { usePrefs } from '../../utils/prefs';
import { localeItem } from '../../utils/storage';
import { useT, type MsgKey } from '../../utils/i18n';
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
  /** Empty when unknown (chrome://, error) — the UI shows a "this tab" label. */
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
    return { host: '', looksJson: false, restricted: true };
  }
}

export function App() {
  const { locale, setLocale } = useLocaleController({
    key: 'blur-devdata:locale',
    read: () => localeItem.getValue(),
    write: (l) => localeItem.setValue(l),
  });
  // setLocale is unused in the popup (the switcher lives in the tool's Settings),
  // but the controller still seeds + persists so the popup renders in-language.
  void setLocale;
  return (
    <LocaleProvider locale={locale}>
      <Popup />
    </LocaleProvider>
  );
}

function Popup() {
  const t = useT();
  const locale = useLocale();
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
          setTab({ id: null, host: '', looksJson: false, restricted: true });
          return;
        }
        setTab({ id: active.id ?? null, ...classifyUrl(active.url ?? '') });
      } catch {
        setTab({ id: null, host: '', looksJson: false, restricted: true });
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
        setPasteNote(t('popup.clipboardEmpty'));
        return;
      }
      // A clipboard JWT is refused by putHandoff (credentials never touch
      // storage) — we land on the JWT tab and the user pastes it there.
      const outcome = await putHandoff(text, 'clipboard');
      openTool(outcome === 'jwt-skipped' ? 'jwt' : 'data');
    } catch {
      setPasteNote(t('popup.clipboardDenied'));
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
    setPageResult(await formatActiveTab(tab.id, locale));
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
          {tab === null ? t('popup.loading') : tab.host || t('popup.thisTab')}
        </span>
      </header>

      {tab?.looksJson && !tab.restricted && (
        <Callout tone="info" title={t('popup.looksJsonTitle')}>
          {/* "Looks like", not "is": without injecting a script we cannot read
              document.contentType, and pretending otherwise would be a lie (§2.2). */}
          {t('popup.looksJsonBody')}
          <div className="row row--gap">
            <Button variant="primary" onClick={() => openTool('data')}>
              {t('common.open')}
            </Button>
            <Button onClick={() => void formatHere()} disabled={!canFormatHere}>
              {t('popup.formatHere')}
            </Button>
          </div>
        </Callout>
      )}

      <div className="stack">
        <Button variant="primary" onClick={() => void pasteAndOpen()}>
          {t('popup.pasteAndOpen')}
        </Button>
        <Button onClick={() => openTool('data')}>{t('popup.openTool')}</Button>
      </div>

      {pasteNote !== null && (
        <p className="fine" role="status" aria-live="polite">
          {pasteNote}
        </p>
      )}

      <section>
        <h2 className="ui-section-heading">{t('popup.pageFormatting')}</h2>
        <Button onClick={() => void formatHere()} disabled={!canFormatHere}>
          {t('popup.formatJsonHere')}
        </Button>
        <p className="fine">
          {tab?.restricted ? t('popup.restrictedNote') : t('popup.oneClickNote')}
        </p>

        <div aria-live="polite">
          {pageResult === 'loading' && <p className="fine">{t('popup.readingTab')}</p>}
          {pageResult !== null && pageResult !== 'loading' && (
            <p className="fine">{describeResult(pageResult, t)}</p>
          )}
        </div>

        <button type="button" className="linkish" onClick={() => openTool('settings')}>
          {t('popup.autoFormatLink')}
          <span className="fine">{t('popup.autoFormatLinkNote')}</span>
        </button>
      </section>

      <footer className="foot">{t('popup.footer')}</footer>
    </div>
  );
}

function describeResult(
  result: FormatPageResult,
  t: (k: MsgKey, v?: Record<string, string | number>) => string,
): string {
  switch (result.status) {
    case 'formatted':
      return t('popup.resultFormatted');
    case 'not-json':
      return t('popup.resultNotJson', { type: result.contentType });
    case 'restricted':
      return t('popup.restrictedNote');
    case 'denied':
      return t('popup.resultDenied');
    case 'error':
      return t('popup.resultError', { message: result.message });
  }
}
