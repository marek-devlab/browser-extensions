import { useEffect } from 'react';
import { ThemeToggle } from '@blur/ui';
import { usePrefs } from '../../utils/prefs';
import { useHashRoute, type ToolRoute } from '../../utils/router';
import { DataTab } from './tabs/DataTab';
import { JwtTab } from './tabs/JwtTab';
import { SchemaTab } from './tabs/SchemaTab';
import { SettingsTab } from './tabs/SettingsTab';

// The single tool page. ONE React app, ONE router — the tabs are projections of
// the same store, never separate entry points (design §1.1). The browser's
// "Options" menu item lands here on `#/settings` (wxt.config.ts), so Settings is
// a tab, not a second page.
//
// Diff is intentionally ABSENT (design §1.3): a v2 tab, not a disabled one.

const TABS: { id: ToolRoute; label: string }[] = [
  { id: 'data', label: 'Данные' },
  { id: 'jwt', label: 'JWT' },
  { id: 'schema', label: 'Схема' },
  { id: 'settings', label: 'Настройки' },
];

export function App() {
  const { prefs, update, ready } = usePrefs();
  // The user's default tab seeds the route when the hash is empty (design §3).
  const fallback: ToolRoute = prefs?.defaultTab ?? 'data';
  const [route, navigate] = useHashRoute(fallback);

  // Keyboard: 1/2/3/4 switch tabs when focus is not in a text field (design §9.3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const idx = ['1', '2', '3', '4'].indexOf(e.key);
      if (idx >= 0 && TABS[idx]) navigate(TABS[idx].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

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
                // aria-controls only on the ACTIVE tab — a fix carried over from
                // the `blur` extension (design §9.3).
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

        <ThemeToggle
          theme={prefs?.theme ?? 'auto'}
          onChange={(theme) => update({ theme })}
        />
      </header>

      <main
        className="panel"
        role="tabpanel"
        id={`panel-${route}`}
        aria-labelledby={`tab-${route}`}
      >
        {route === 'data' && <DataTab prefs={prefs} update={update} />}
        {route === 'jwt' && <JwtTab />}
        {route === 'schema' && <SchemaTab prefs={prefs} />}
        {route === 'settings' && (
          <SettingsTab prefs={prefs} update={update} ready={ready} />
        )}
      </main>
    </div>
  );
}
