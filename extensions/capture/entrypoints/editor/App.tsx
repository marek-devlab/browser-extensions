import { useCallback, useEffect, useState } from 'react';
import { Callout, ThemeToggle, type Theme } from '@blur/ui';
import { getClip } from '../../utils/db';
import { usePrefs } from '../../utils/use-prefs';
import { useCaptureTheme } from '../../utils/use-theme';
import type { Clip } from '../../utils/types';
import { Library } from './Library';
import { ClipEditor } from './ClipEditor';
import { ExportDialog } from './ExportDialog';
import { Screenshot } from './Screenshot';
import { Settings } from './Settings';

// STUDIO — the full-tab surface (design capture.md §1.1, §2.6). The one place
// that survives focus loss and can hold a timeline, a preview, redaction tools
// and an encoder. Library · Editor · Export · Settings, plus the screenshot
// editor. No feature has an entry point of its own (design §1.1).
//
// Routing is the hash, so the background can deep-link a fresh artifact:
//   #/library · #/settings · #/clip/<id> · #/shot/<id>

type Tab = 'library' | 'editor' | 'export' | 'screenshot' | 'settings';

function parseHash(): { tab: Tab; id?: string } {
  const h = globalThis.location.hash.replace(/^#\/?/, '');
  if (h.startsWith('settings')) return { tab: 'settings' };
  if (h.startsWith('clip/')) return { tab: 'editor', id: h.slice('clip/'.length) };
  if (h.startsWith('shot/')) return { tab: 'screenshot', id: h.slice('shot/'.length) };
  return { tab: 'library' };
}

export function App() {
  const { theme, setTheme } = useCaptureTheme();
  const { prefs, update } = usePrefs();
  const [route, setRoute] = useState(parseHash);
  const [clip, setClip] = useState<Clip | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    globalThis.addEventListener('hashchange', onHash);
    return () => globalThis.removeEventListener('hashchange', onHash);
  }, []);

  // Load whatever the hash points at. A hash pointing at a deleted clip shows an
  // honest "not found" — never an empty editor pretending to hold something.
  useEffect(() => {
    if (!route.id) return;
    let alive = true;
    void getClip(route.id).then((c) => {
      if (!alive) return;
      setClip(c ?? null);
      setMissing(!c);
    });
    return () => {
      alive = false;
    };
  }, [route.id]);

  const open = useCallback((c: Clip) => {
    setClip(c);
    setMissing(false);
    globalThis.location.hash = c.kind === 'screenshot' ? `#/shot/${c.id}` : `#/clip/${c.id}`;
  }, []);

  const go = (tab: Tab) => {
    if (tab === 'settings') globalThis.location.hash = '#/settings';
    else if (tab === 'library') globalThis.location.hash = '#/library';
    else setRoute((r) => ({ ...r, tab }));
  };

  const editorTabActive = route.tab === 'editor' || route.tab === 'screenshot';

  return (
    <div className="studio">
      <header className="studio-head">
        <h1>
          <span className="rec-dot" aria-hidden="true" /> Capture Studio
        </h1>
        <nav className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={route.tab === 'library'}
            className={route.tab === 'library' ? 'tab tab--on' : 'tab'}
            onClick={() => go('library')}
          >
            Библиотека
          </button>
          {clip && (
            <button
              type="button"
              role="tab"
              aria-selected={editorTabActive}
              className={editorTabActive ? 'tab tab--on' : 'tab'}
              onClick={() => go(clip.kind === 'screenshot' ? 'screenshot' : 'editor')}
            >
              Редактор
            </button>
          )}
          {clip?.kind === 'video' && (
            <button
              type="button"
              role="tab"
              aria-selected={route.tab === 'export'}
              className={route.tab === 'export' ? 'tab tab--on' : 'tab'}
              onClick={() => go('export')}
            >
              Экспорт
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={route.tab === 'settings'}
            className={route.tab === 'settings' ? 'tab tab--on' : 'tab'}
            onClick={() => go('settings')}
          >
            Настройки
          </button>
        </nav>
        {theme && <ThemeToggle theme={theme} onChange={(t: Theme) => setTheme(t)} />}
      </header>

      {/* One-time PROMINENT IN-UI DISCLOSURE (design §9.1, PLAN-2 §9 — mandatory
          from 2026-08-01, and mandatory in the INTERFACE, not just the listing). */}
      {!prefs.disclosureAccepted && (
        <Callout tone="info" title="Что записывается и где это лежит">
          Capture Studio записывает видео и звук выбранной вкладки (и микрофон — только если
          вы его включили) и хранит записи локально, в профиле браузера (IndexedDB). Ничего
          никуда не отправляется: у расширения нет ни одного сетевого запроса — это запрещено
          его собственным CSP (<code>connect-src &apos;none&apos;</code>). Удаление
          расширения удалит и записи.{' '}
          <button
            type="button"
            className="ui-btn ui-btn--sm"
            onClick={() => update({ disclosureAccepted: true })}
          >
            Понятно
          </button>
        </Callout>
      )}

      <main className="studio-body">
        {missing && route.id && (
          <Callout tone="warn" title="Запись не найдена">
            Её удалили, или данные не сохранились. Откройте библиотеку.
          </Callout>
        )}
        {route.tab === 'library' && <Library onOpen={open} />}
        {route.tab === 'editor' && clip && <ClipEditor clip={clip} onExport={() => go('export')} />}
        {route.tab === 'export' && clip && (
          <ExportDialog clip={clip} onClose={() => go('library')} onTrim={() => go('editor')} />
        )}
        {route.tab === 'screenshot' && clip && <Screenshot clip={clip} onClose={() => go('library')} />}
        {route.tab === 'settings' && <Settings />}
      </main>
    </div>
  );
}
