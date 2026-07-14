import { useEffect, useState } from 'react';
import { Callout, ThemeToggle, type Theme } from '@blur/ui';
import { MOCK_CLIP } from '../../utils/mock-data';
import { usePrefs } from '../../utils/use-prefs';
import { useCaptureTheme } from '../../utils/use-theme';
import type { Clip } from '../../utils/types';
import { Library } from './Library';
import { ClipEditor } from './ClipEditor';
import { ExportDialog } from './ExportDialog';
import { Screenshot } from './Screenshot';
import { Settings } from './Settings';

// Studio — the full-tab surface (design capture.md §1.1, §2.6). Tabs: Library ·
// Editor · Export · Settings, plus the screenshot editor. This is the ONE place
// that survives focus loss and hosts the timeline, redaction and export.
// Options (options.html) renders <Settings/> directly; the design's preferred
// single-surface variant (options → editor.html#/settings) is noted in
// IMPLEMENTATION.md — here the reusable <Settings/> keeps both honest and DRY.

type Tab = 'library' | 'editor' | 'export' | 'screenshot' | 'settings';

export function App() {
  const { theme, setTheme } = useCaptureTheme();
  const { prefs, update } = usePrefs();
  const [tab, setTab] = useState<Tab>(() =>
    globalThis.location.hash.includes('settings') ? 'settings' : 'library',
  );
  const [clip, setClip] = useState<Clip>(MOCK_CLIP);

  // Support the options deep-link (editor.html#/settings) and back/forward.
  useEffect(() => {
    const onHash = () => {
      if (globalThis.location.hash.includes('settings')) setTab('settings');
    };
    globalThis.addEventListener('hashchange', onHash);
    return () => globalThis.removeEventListener('hashchange', onHash);
  }, []);

  function openClip(c: Clip) {
    setClip(c);
    setTab(c.kind === 'screenshot' ? 'screenshot' : 'editor');
  }

  return (
    <div className="studio">
      <header className="studio-head">
        <h1>
          <span className="rec-dot" aria-hidden="true" /> Capture Studio
        </h1>
        <nav className="tabs" role="tablist">
          {(['library', 'editor', 'export', 'settings'] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? 'tab tab--on' : 'tab'}
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </nav>
        {theme && <ThemeToggle theme={theme} onChange={(t: Theme) => setTheme(t)} />}
      </header>

      {/* One-time prominent in-UI disclosure (design §9.1, PLAN-2 §9): what we
          record and where it lives, shown before the first recording — NOT buried
          in the store listing. Persisted via prefs.disclosureAccepted. */}
      {!prefs.disclosureAccepted && (
        <Callout tone="info" title="Что записывается и где это лежит">
          Capture Studio записывает видео/аудио выбранной вкладки (и микрофон,
          только если вы его включили) и хранит записи локально в профиле браузера
          (IndexedDB). Ничего никуда не отправляется — сети у расширения нет.{' '}
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
        {tab === 'library' && <Library onOpen={openClip} />}
        {tab === 'editor' && (
          <ClipEditor clip={clip} onExport={() => setTab('export')} />
        )}
        {tab === 'export' && <ExportDialog clip={clip} onClose={() => setTab('library')} />}
        {tab === 'screenshot' && <Screenshot onClose={() => setTab('library')} />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  );
}

const TAB_LABEL: Record<Tab, string> = {
  library: 'Библиотека',
  editor: 'Редактор',
  export: 'Экспорт',
  screenshot: 'Скриншот',
  settings: 'Настройки',
};
