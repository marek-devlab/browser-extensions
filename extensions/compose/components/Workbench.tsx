import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyState, MockBadge, ThemeToggle, type Theme } from '@blur/ui';
import { Toolbar } from './Toolbar';
import { EditorPane, type EditorHandle } from './EditorPane';
import { PreviewPane } from './PreviewPane';
import { CounterStrip } from './CounterStrip';
import { ToolDrawer } from './ToolDrawer';
import { EmojiPicker } from './EmojiPicker';
import { useDraft } from './useDraft';
import { countText } from '../utils/counter';
import { mockDegradations } from '../utils/convert';
import { TARGETS, targetInfo } from '../utils/targets';
import { BUILTIN_TEMPLATES } from '../utils/mock';
import type { Settings, Target } from '../utils/types';
import type { ActionId } from '../utils/editor-actions';

// ⚠️ S1 (side panel) and S2 (full-page Workbench) are ONE component (design §1.2,
// §5.8). The only difference is the container width: below ~560px it shows tabs
// (Editor | Preview); at/above it shows a split. We detect this with a
// ResizeObserver on the container (the panel is not the viewport, so @media is
// wrong; container-type drives the CSS, and this measures the same box for the
// tabs-vs-split RENDER decision).

const SPLIT_THRESHOLD = 560;

export function Workbench({
  surface,
  settings,
  theme,
  setTheme,
}: {
  surface: 'panel' | 'workbench';
  settings: Settings;
  theme: Theme | null;
  setTheme: (t: Theme) => void;
}) {
  const { drafts, active, saveState, setBody, setTarget, selectDraft, newDraft } = useDraft(
    settings.autosaveDelay,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const [width, setWidth] = useState(surface === 'workbench' ? 1200 : 360);
  const [narrowTab, setNarrowTab] = useState<'editor' | 'preview'>('editor');
  const [drawerOpen, setDrawerOpen] = useState(surface === 'workbench');

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const forcedLayout = settings.layout;
  const isSplit =
    forcedLayout === 'split' || (forcedLayout === 'auto' && width >= SPLIT_THRESHOLD);
  const isNarrow = !isSplit;

  const counts = useMemo(() => countText(active?.body ?? ''), [active?.body]);
  const degradations = active ? mockDegradations(active.target) : [];
  const empty = (active?.body ?? '').trim() === '';

  const applyAction = (id: ActionId) => editorRef.current?.applyAction(id);
  const openEmoji = (anchor: HTMLElement) => {
    const pop = document.getElementById('cw-emoji');
    // Popover API: anchor is the toolbar button; fallback pins to panel edge.
    (pop as unknown as { showPopover?: () => void })?.showPopover?.();
    void anchor;
  };

  if (drafts === null) {
    return <div className="cw-loading">Загрузка…</div>;
  }

  return (
    <div ref={containerRef} className="cw-root" data-surface={surface}>
      <MockBadge />

      {/* Header (design §2.1/§2.2) */}
      <header className="cw-header">
        <label className="cw-header__draft">
          ✎
          <select
            aria-label="Черновик"
            value={active?.id ?? ''}
            onChange={(e) => selectDraft(e.target.value)}
          >
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>{d.title || '(без имени)'}</option>
            ))}
          </select>
          <button type="button" className="cw-tool cw-tool--inline" title="Новый черновик" aria-label="Новый черновик" onClick={newDraft}>＋</button>
        </label>

        <label className="cw-header__target">
          Куда:
          <select aria-label="Целевая площадка" value={active?.target ?? 'github'} onChange={(e) => setTarget(e.target.value as Target)}>
            {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>

        <span className="cw-header__spacer" />
        <span className="cw-save" role="status" aria-live="polite">
          {saveState === 'saving' ? '● Сохраняется…' : saveState === 'saved' ? '✓ Сохранено' : saveState === 'error' ? '⚠️ Не сохранено' : ''}
        </span>
        <button type="button" className="cw-tool cw-tool--inline" title="История черновиков" aria-label="История">⟲</button>
        {surface === 'panel' && (
          <button type="button" className="cw-tool cw-tool--inline" title="Открыть во вкладке" aria-label="Открыть во вкладке" onClick={() => void openWorkbenchTab()}>⛶</button>
        )}
        <ThemeToggle theme={theme ?? settings.theme} onChange={setTheme} />
      </header>

      <Toolbar onAction={applyAction} onEmoji={openEmoji} narrow={isNarrow} />

      {/* Narrow: Editor|Preview tabs. Wide/S2: split. (design §5.8) */}
      {isNarrow && settings.showPreview && !empty && (
        <div className="cw-viewtabs" role="tablist" aria-label="Редактор и превью">
          {(['editor', 'preview'] as const).map((t) => (
            <button key={t} role="tab" type="button" aria-selected={narrowTab === t}
              className={narrowTab === t ? 'cw-tab cw-tab--active' : 'cw-tab'}
              onClick={() => setNarrowTab(t)}>
              {t === 'editor' ? 'Редактор' : 'Превью'}
            </button>
          ))}
        </div>
      )}

      <main className={isSplit && settings.showPreview && !empty ? 'cw-panes cw-panes--split' : 'cw-panes'}>
        {empty ? (
          <EmptyState
            title="Пустой черновик"
            hint="Начните печатать, или выделите текст на странице → ПКМ → «Добавить в черновик»."
            action={
              <div className="cw-actions">
                <Button onClick={() => setBody(BUILTIN_TEMPLATES[0].body)}>📋 Взять шаблон баг-репорта</Button>
                <Button variant="ghost">⧉ Вставить из буфера</Button>
              </div>
            }
          />
        ) : (
          <>
            {(isSplit || narrowTab === 'editor') && (
              <EditorPane
                body={active?.body ?? ''}
                onChange={setBody}
                monospace={settings.monospace}
                softWrap={settings.softWrap}
                spellcheck={settings.spellcheck}
                fontSize={settings.fontSize}
                handleRef={editorRef}
              />
            )}
            {settings.showPreview && (isSplit || narrowTab === 'preview') && (
              <PreviewPane body={active?.body ?? ''} />
            )}
          </>
        )}
      </main>

      {drawerOpen && !empty && <ToolDrawer counts={counts} selectionCounts={null} settings={settings} />}

      <CounterStrip
        counts={counts}
        target={active?.target ?? 'github'}
        degradations={degradations}
        expanded={drawerOpen}
        onToggle={() => setDrawerOpen((v) => !v)}
      />

      {/* Copy bar (design §4.1). Conversion on copy is STUBBED (utils/convert.ts). */}
      <footer className="cw-copybar">
        <Button variant="primary" disabled={empty}>{targetInfo(active?.target ?? 'github').copyVerb}</Button>
        {!isNarrow && <Button disabled={empty}>⧉ Копировать как HTML</Button>}
      </footer>

      <EmojiPicker
        target={active?.target ?? 'github'}
        insertMode={settings.emojiInsertMode}
        onInsert={(v) => editorRef.current?.insertText(v)}
      />
    </div>
  );
}

async function openWorkbenchTab() {
  // Open S2 (full-page Workbench) in a tab — the "escape hatch" if the panel
  // misbehaves on a given build (design §1.2). Uses the extension URL directly.
  try {
    const { browser } = await import('wxt/browser');
    await browser.tabs.create({ url: browser.runtime.getURL('/workbench.html') });
  } catch {
    // ignore in the scaffold
  }
}
