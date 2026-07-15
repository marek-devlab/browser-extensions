import { useCallback, useEffect, useState } from 'react';
import { ThemeToggle } from '@blur/ui';
import { usePrefs } from '../../utils/prefs';
import { useDocument } from '../../utils/document';
import { useHashRoute, type ToolRoute } from '../../utils/router';
import { DataTab } from './tabs/DataTab';
import { JwtTab } from './tabs/JwtTab';
import { SchemaTab } from './tabs/SchemaTab';
import { SettingsTab } from './tabs/SettingsTab';

// The single tool page. ONE React app, ONE router — the tabs are projections of
// the same state, never separate entry points (design §1.1). The browser's
// "Options" item lands here on `#/settings` (wxt.config.ts), so Settings is a
// tab, not a second page.
//
// Diff is intentionally ABSENT (design §1.3): a v2 tab, not a disabled one.
//
// The DOCUMENT lives here, not in the Data tab, because the Schema tab validates
// it — but the JWT tab is deliberately cut off from it: the token has its own,
// non-persisted state inside JwtTab and can never reach `local:document` (§7.2).

const TABS: { id: ToolRoute; label: string }[] = [
  { id: 'data', label: 'Данные' },
  { id: 'jwt', label: 'JWT' },
  { id: 'schema', label: 'Схема' },
  { id: 'settings', label: 'Настройки' },
];

export function App() {
  const prefsApi = usePrefs();
  const { prefs, update } = prefsApi;
  const doc = useDocument(prefs);

  const fallback: ToolRoute = prefs?.defaultTab ?? 'data';
  const [route, navigate] = useHashRoute(fallback);
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const [revealPath, setRevealPath] = useState<string | null>(null);

  // 1/2/3/4 switch tabs when focus is not in a text field (design §9.3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      const idx = ['1', '2', '3', '4'].indexOf(e.key);
      const tab = TABS[idx];
      if (idx >= 0 && tab) navigate(tab.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // Paste anywhere on the Data tab loads a document (design §4.1).
  useEffect(() => {
    if (route !== 'data') return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text.trim() === '') return;
      e.preventDefault();
      doc.load(text);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [route, doc]);

  const openJwt = useCallback(
    (token: string) => {
      setJwtToken(token);
      navigate('jwt');
    },
    [navigate],
  );

  const openData = useCallback(
    (path?: string) => {
      setRevealPath(path ?? null);
      navigate('data');
    },
    [navigate],
  );

  return (
    <div className="tool">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            ▣
          </span>
          <h1>Data Format Toolkit</h1>
        </div>

        <nav className="tabs" role="tablist" aria-label="Инструмент">
          {TABS.map((t) => {
            const active = route === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                // aria-controls only on the ACTIVE tab (a fix carried over from
                // `blur`, design §9.3).
                aria-controls={active ? `panel-${t.id}` : undefined}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className={active ? 'tab tab--active' : 'tab'}
                onClick={() => navigate(t.id)}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        <ThemeToggle theme={prefs?.theme ?? 'auto'} onChange={(theme) => update({ theme })} />
      </header>

      <main
        className="panel"
        role="tabpanel"
        id={`panel-${route}`}
        aria-labelledby={`tab-${route}`}
      >
        {route === 'data' && (
          <DataTab prefs={prefs} doc={doc} onOpenJwt={openJwt} revealPath={revealPath} />
        )}
        {/* The JWT tab is mounted only while it is the route: leaving it drops
            the token, the secret and the key from memory. */}
        {route === 'jwt' && <JwtTab initialToken={jwtToken} />}
        {route === 'schema' && <SchemaTab prefs={prefs} doc={doc} onOpenData={openData} />}
        {route === 'settings' && <SettingsTab {...prefsApi} />}
      </main>
    </div>
  );
}
