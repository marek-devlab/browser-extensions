import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Callout, EmptyState, ThemeToggle, type Theme } from '@blur/ui';
import { Toolbar } from './Toolbar';
import { EditorPane, type EditorHandle } from './EditorPane';
import { PreviewPane } from './PreviewPane';
import { CounterStrip } from './CounterStrip';
import { ToolDrawer, type DrawerTab } from './ToolDrawer';
import { EmojiPicker } from './EmojiPicker';
import { HistoryDialog } from './HistoryDialog';
import { useDraft } from './useDraft';
import { countText } from '../utils/counter';
import { convert, type ConversionResult } from '../utils/convert';
import { copyToClipboard } from '../utils/clipboard';
import { loadEmoji } from '../utils/emoji';
import { collectEnv, envToMarkdown, type EnvFacts } from '../utils/environment';
import { openWorkbenchTab, requestActiveTabInfo } from '../utils/surface';
import { templatesItem } from '../utils/storage';
import { TARGETS, targetInfo } from '../utils/targets';
import { BUILTIN_TEMPLATES } from '../utils/templates';
import type { Settings, Target, Template } from '../utils/types';
import type { ActionId } from '../utils/editor-actions';
import type { RegexMatch } from '../utils/regex-client';

// ⚠️ S1 (side panel / sidebar) and S2 (full-page Workbench) are ONE component
// (design §1.2, §5.8). The only difference is the width of the container: under
// ~560px it shows Editor|Preview TABS, above it a split. A ResizeObserver picks
// the layout because it changes the DOM and the aria roles — the CSS side of the
// same breakpoint is a @container query (a panel is not the viewport).
//
// S2 also carries a second job: it is the ONLY editor surface that exists on
// Firefox for Android, which has no sidebar at all (see utils/surface.ts).

const SPLIT_THRESHOLD = 560;
const HUGE_CHARS = 200_000;
const SHORTCODE_RE = /:[a-z0-9_+-]+:/i;

export function Workbench({
  surface,
  settings,
  updateSettings,
  theme,
  setTheme,
}: {
  surface: 'panel' | 'workbench';
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  theme: Theme | null;
  setTheme: (t: Theme) => void;
}) {
  const draft = useDraft(settings.autosaveDelay, settings.autosave, settings.historyLimit);
  const {
    drafts,
    active,
    saveState,
    saveError,
    savedAt,
    usage,
    recovery,
    setBody,
    setTarget,
    selectDraft,
    newDraft,
    deleteDraft,
    applyDestructive,
    acceptRecovery,
    dismissRecovery,
  } = draft;

  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const compatRef = useRef<HTMLDialogElement>(null);
  const envRef = useRef<HTMLDialogElement>(null);
  const manualRef = useRef<HTMLDialogElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const historyRef = useRef<HTMLDialogElement>(null);
  const replaceRef = useRef<HTMLDialogElement>(null);
  const manualTextRef = useRef<HTMLTextAreaElement>(null);

  const [width, setWidth] = useState(surface === 'workbench' ? 1200 : 360);
  const [narrowTab, setNarrowTab] = useState<'editor' | 'preview'>('editor');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('find');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [matches, setMatches] = useState<RegexMatch[]>([]);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [templates, setTemplates] = useState<Template[]>(BUILTIN_TEMPLATES);
  const [degradations, setDegradations] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [env, setEnv] = useState<EnvFacts | null>(null);
  const [manualText, setManualText] = useState('');
  const [copyError, setCopyError] = useState<string | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<Template | null>(null);

  const body = active?.body ?? '';
  const target = active?.target ?? settings.defaultTarget;
  const empty = body.trim() === '';

  useEffect(() => {
    void templatesItem
      .getValue()
      .then(setTemplates)
      .catch(() => setTemplates(BUILTIN_TEMPLATES));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isSplit =
    settings.layout === 'split' ||
    (settings.layout === 'auto' && width >= SPLIT_THRESHOLD);
  const isNarrow = !isSplit;

  // ⚠️ Counting graphemes and running the converter are O(n) over the WHOLE
  // draft. On a 400 KB document, doing either synchronously on every keystroke
  // is the freeze we promised not to ship (design §5.5). `useDeferredValue` lets
  // React keep typing at the front of the queue and recompute the numbers at low
  // priority; the converter is additionally debounced below.
  const deferredBody = useDeferredValue(body);
  const counts = useMemo(() => countText(deferredBody), [deferredBody]);

  /* ── compatibility notes (design §2.8, §6.4) ───────────────────────────*/
  // Debounced: the converter parses the whole draft, and doing that on every
  // keystroke of a 400 KB document is exactly the freeze we promised not to ship.
  useEffect(() => {
    if (deferredBody.length > HUGE_CHARS) {
      setDegradations([]);
      return;
    }
    const t = setTimeout(() => {
      try {
        setDegradations(convert(deferredBody, target).degradations);
      } catch {
        // A parser failure must not block copying — the copy path reports it.
        setDegradations([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [deferredBody, target]);

  /* ── copy (design §4.1, §5.6, §6.2) ────────────────────────────────────*/

  const build = useCallback(
    async (t: Target): Promise<ConversionResult> => {
      // Jira/Telegram don't know `:tada:` — resolve shortcodes to characters, but
      // only pull the (lazy, heavy) emoji chunk when the draft actually has one.
      let shortcodeToEmoji: ((s: string) => string | null) | undefined;
      if ((t === 'jira' || t === 'telegram') && SHORTCODE_RE.test(body)) {
        try {
          const index = await loadEmoji();
          shortcodeToEmoji = (code) => index.byShortcode.get(code) ?? null;
        } catch {
          // Data unavailable → leave the shortcodes as typed rather than guess.
        }
      }
      return convert(body, t, { shortcodeToEmoji });
    },
    [body],
  );

  const performCopy = useCallback(
    async (t: Target, asHtml: boolean) => {
      try {
        const result = await build(asHtml ? 'html' : t);
        const outcome = await copyToClipboard(result.text, result.html);
        if (outcome.ok) {
          const bytes = new TextEncoder().encode(result.text).length;
          setToast(
            asHtml
              ? `Скопировано как HTML — ${bytes} Б. В текстовое поле вставится чистый Markdown.`
              : `Скопировано для ${targetInfo(t).label} — ${bytes} Б.` +
                  (result.degradations.length ? ` Упрощено: ${result.degradations.join('; ')}` : ''),
          );
          return;
        }
        // 🔴 Never fail silently: show the text and let the user copy it by hand.
        setCopyError(outcome.error);
        setManualText(result.text);
        manualRef.current?.showModal();
        requestAnimationFrame(() => manualTextRef.current?.select());
      } catch (e) {
        setToast(`Не удалось преобразовать текст: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [build],
  );

  const copyForTarget = useCallback(() => {
    if (degradations.length > 0) {
      compatRef.current?.showModal();
      return;
    }
    void performCopy(target, false);
  }, [degradations.length, performCopy, target]);

  const copyAsHtml = useCallback(() => void performCopy(target, true), [performCopy, target]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ── toolbar / templates / environment ─────────────────────────────────*/

  const applyAction = (id: ActionId) => editorRef.current?.applyAction(id);

  const onTemplate = (t: Template, mode: 'append' | 'replace') => {
    if (mode === 'replace') {
      // §5.2 — a destructive op on a non-empty draft asks first, and says HOW
      // MUCH text it is about to overwrite.
      if (!empty) {
        setPendingTemplate(t);
        replaceRef.current?.showModal();
        return;
      }
      void applyDestructive(t.body, 'до вставки шаблона');
      return;
    }
    const sep = body === '' || body.endsWith('\n') ? '' : '\n\n';
    editorRef.current?.replaceRange(body.length, body.length, sep + t.body);
  };

  const onEnvironment = async () => {
    try {
      const tab = await requestActiveTabInfo();
      const facts = await collectEnv({ includeFullUA: settings.envIncludeFullUA, url: tab?.url });
      setEnv(facts);
      envRef.current?.showModal();
    } catch (e) {
      setToast(`Не удалось собрать данные окружения: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const insertEnv = () => {
    if (!env) return;
    const at = selection.end || body.length;
    editorRef.current?.replaceRange(at, at, '\n' + envToMarkdown(env) + '\n');
    envRef.current?.close();
  };

  /* ── keyboard (design §9.1) — all shortcuts live INSIDE the document ────*/
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        helpRef.current?.showModal();
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();

      if (k === 'enter') {
        e.preventDefault();
        if (e.shiftKey) copyAsHtml();
        else copyForTarget();
        return;
      }
      if (!e.shiftKey && (k === 'f' || k === 'h')) {
        e.preventDefault();
        setDrawerOpen(true);
        setDrawerTab('find');
        return;
      }
      if (e.shiftKey && k === 'l') {
        e.preventDefault();
        setDrawerOpen(true);
        setDrawerTab('translit');
        return;
      }
      if (e.shiftKey && k === 'k') {
        e.preventDefault();
        setDrawerOpen(true);
        setDrawerTab('stats');
        return;
      }
      if (e.shiftKey && k === 'p') {
        e.preventDefault();
        if (isNarrow) setNarrowTab((t) => (t === 'editor' ? 'preview' : 'editor'));
        else updateSettings({ showPreview: !settings.showPreview });
        return;
      }
      if (e.shiftKey && k === 'j') {
        e.preventDefault();
        document.getElementById('cw-emoji')?.showPopover?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [copyAsHtml, copyForTarget, isNarrow, settings.showPreview, updateSettings]);

  if (drafts === null) return <div className="cw-loading">Загрузка…</div>;

  const showPreview = settings.showPreview && !empty;

  return (
    <div ref={containerRef} className="cw-root" data-surface={surface}>
      {/* Header (design §2.1/§2.2) */}
      <header className="cw-header">
        <label className="cw-header__draft">
          <span aria-hidden="true">✎</span>
          <select
            aria-label="Черновик"
            value={active?.id ?? ''}
            onChange={(e) => selectDraft(e.target.value)}
          >
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title || '(без имени)'}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="cw-tool cw-tool--inline"
          title="Новый черновик"
          aria-label="Новый черновик"
          onClick={() => newDraft({ target: settings.defaultTarget })}
        >
          ＋
        </button>

        <label className="cw-header__target">
          Куда:
          <select
            aria-label="Целевая площадка"
            value={target}
            onChange={(e) => setTarget(e.target.value as Target)}
          >
            {TARGETS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <span className="cw-header__spacer" />

        <span className="cw-save" role="status" aria-live="polite">
          {saveState === 'saving'
            ? '● Сохраняется…'
            : saveState === 'saved'
              ? `✓ Сохранено${savedAt ? ' ' + new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`
              : saveState === 'error'
                ? '⚠️ Не сохранено'
                : ''}
        </span>

        <button
          type="button"
          className="cw-tool cw-tool--inline"
          title="История черновиков и снимков"
          aria-label="История"
          onClick={() => historyRef.current?.showModal()}
        >
          ⟲
        </button>
        {surface === 'panel' && (
          <button
            type="button"
            className="cw-tool cw-tool--inline"
            title="Открыть во вкладке"
            aria-label="Открыть во вкладке"
            onClick={() => void openWorkbenchTab()}
          >
            ⛶
          </button>
        )}
        <button
          type="button"
          className="cw-tool cw-tool--inline"
          title="Горячие клавиши (F1)"
          aria-label="Горячие клавиши"
          onClick={() => helpRef.current?.showModal()}
        >
          ?
        </button>
        <ThemeToggle theme={theme ?? settings.theme} onChange={setTheme} />
      </header>

      {/* §8.2 — the write failed. The text is NOT lost; say what to do. */}
      {saveError && (
        <Callout tone="poor" title="Черновик не сохранён">
          {saveError}{' '}
          <button type="button" className="cw-linklike" onClick={() => historyRef.current?.showModal()}>
            Освободить место / экспортировать
          </button>
        </Callout>
      )}

      {/* §8.3 — an unsaved buffer survived; the user decides, not us. */}
      {recovery && (
        <Callout tone="warn" title="Есть несохранённый текст">
          <p>
            Восстановлен текст от{' '}
            {new Date(recovery.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (
            {countText(recovery.body).graphemes} симв.). Текущая версия сохранится снимком — откат
            возможен.
          </p>
          <div className="cw-actions">
            <Button variant="primary" onClick={acceptRecovery}>Восстановить</Button>
            <Button onClick={dismissRecovery}>Оставить текущий</Button>
          </div>
        </Callout>
      )}

      {usage && usage.ratio > 0.8 && (
        <Callout tone="warn" title="Хранилище почти заполнено">
          Занято {fmtMB(usage.bytes)} из {fmtMB(usage.quota)}. Старые автоснимки будут вытесняться.{' '}
          <button type="button" className="cw-linklike" onClick={() => historyRef.current?.showModal()}>
            История и экспорт
          </button>
        </Callout>
      )}

      <Toolbar
        onAction={applyAction}
        onEmoji={() => document.getElementById('cw-emoji')?.showPopover?.()}
        onTemplate={onTemplate}
        onEnvironment={() => void onEnvironment()}
        templates={templates}
        narrow={isNarrow}
      />

      {isNarrow && showPreview && (
        <div className="cw-viewtabs" role="tablist" aria-label="Редактор и превью">
          {(['editor', 'preview'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={narrowTab === t}
              className={narrowTab === t ? 'cw-tab cw-tab--active' : 'cw-tab'}
              onClick={() => setNarrowTab(t)}
            >
              {t === 'editor' ? 'Редактор' : 'Превью'}
            </button>
          ))}
        </div>
      )}

      {/* The preview is NOT mounted on an empty draft — on a 320px panel that
          would be half a screen of nothing (design §5.1). */}
      <main className={isSplit && showPreview ? 'cw-panes cw-panes--split' : 'cw-panes'}>
        {(isSplit || !showPreview || narrowTab === 'editor') && (
          <div className="cw-editorcol">
            {empty && (
              <EmptyState
                title="Пустой черновик"
                hint="Начните печатать, или выделите текст на странице → ПКМ → «Добавить выделенное в черновик»."
                action={
                  <div className="cw-actions">
                    <Button
                      variant="primary"
                      onClick={() => onTemplate(templates[0] ?? BUILTIN_TEMPLATES[0], 'append')}
                    >
                      📋 Взять шаблон баг-репорта
                    </Button>
                  </div>
                }
              />
            )}
            <EditorPane
              body={body}
              onChange={setBody}
              onSelectionChange={setSelection}
              monospace={settings.monospace}
              softWrap={settings.softWrap}
              spellcheck={settings.spellcheck}
              fontSize={settings.fontSize}
              handleRef={editorRef}
              matches={matches}
              currentMatch={currentMatch}
            />
          </div>
        )}
        {showPreview && (isSplit || narrowTab === 'preview') && (
          <PreviewPane body={body} warnOnSanitize={settings.warnOnSanitize} />
        )}
      </main>

      {drawerOpen && (
        <ToolDrawer
          tab={drawerTab}
          onTab={setDrawerTab}
          body={body}
          selection={selection}
          counts={counts}
          settings={settings}
          target={target}
          onMatches={(m, current) => {
            setMatches(m);
            setCurrentMatch(current);
          }}
          onScrollTo={(offset) => editorRef.current?.scrollTo(offset)}
          onReplaceAll={(next, label) => void applyDestructive(next, label)}
          onReplaceRange={(start, end, value) => editorRef.current?.replaceRange(start, end, value)}
        />
      )}

      <CounterStrip
        counts={counts}
        target={target}
        degradations={degradations}
        expanded={drawerOpen}
        onToggle={() => setDrawerOpen((v) => !v)}
        onCompat={() => compatRef.current?.showModal()}
        fields={settings.counterFields}
      />

      <footer className="cw-copybar">
        <Button variant="primary" disabled={empty} onClick={copyForTarget}>
          {targetInfo(target).copyVerb}
        </Button>
        <Button disabled={empty} onClick={copyAsHtml} ariaLabel="Копировать как HTML">
          ⧉ HTML
        </Button>
      </footer>

      {toast && (
        <div className="cw-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      <EmojiPicker
        target={target}
        insertMode={settings.emojiInsertMode}
        onInsert={(v) => editorRef.current?.insertText(v)}
        onModeChange={(m) => updateSettings({ emojiInsertMode: m })}
      />

      {/* ── §6.4 compatibility dialog — shown BEFORE anything is copied ─────*/}
      <dialog ref={compatRef} className="cw-dialog" aria-labelledby="cw-compat-title">
        <h2 id="cw-compat-title">{targetInfo(target).label} не поддерживает часть вашей разметки</h2>
        <p>Текст не потеряется — он будет упрощён при копировании:</p>
        <ul className="cw-deg-list">
          {degradations.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p className="cw-hint">
          ⓘ Черновик не меняется. Конверсия происходит только в буфере обмена — переключение
          площадки туда-обратно ничего не портит.
        </p>
        <div className="cw-actions">
          <Button
            variant="primary"
            onClick={() => {
              compatRef.current?.close();
              void performCopy(target, false);
            }}
          >
            Копировать всё равно
          </Button>
          <Button onClick={() => compatRef.current?.close()}>Сменить площадку</Button>
        </div>
      </dialog>

      {/* ── §2.9 environment preview ───────────────────────────────────────*/}
      <dialog ref={envRef} className="cw-dialog" aria-labelledby="cw-env-title">
        <h2 id="cw-env-title">Вставить окружение</h2>
        {env ? (
          <>
            <pre className="mono cw-env-preview">{envToMarkdown(env)}</pre>
            <label className="cw-check">
              <input
                type="checkbox"
                checked={settings.envIncludeFullUA}
                onChange={(e) => {
                  updateSettings({ envIncludeFullUA: e.target.checked });
                  void collectEnv({ includeFullUA: e.target.checked, url: env.url })
                    .then(setEnv)
                    .catch(() => {});
                }}
              />{' '}
              Включать полный User-Agent (длинный, в баг-репорте часто не нужен)
            </label>
            {!env.url && (
              <p className="cw-hint">
                URL активной вкладки недоступен: браузер выдаёт доступ к вкладке только по жесту.
                Откройте панель кликом по иконке расширения или добавьте выделение через контекстное
                меню — и URL появится.
              </p>
            )}
            <p className="cw-hint">
              Ничего никуда не отправляется — таблица просто вставляется в ваш черновик.
            </p>
          </>
        ) : (
          <p>Собираем данные…</p>
        )}
        <div className="cw-actions">
          <Button variant="primary" onClick={insertEnv}>Вставить</Button>
          <Button onClick={() => envRef.current?.close()}>Отмена</Button>
        </div>
      </dialog>

      {/* ── §5.6 clipboard refused — manual copy ───────────────────────────*/}
      <dialog ref={manualRef} className="cw-dialog" aria-labelledby="cw-manual-title">
        <h2 id="cw-manual-title">Браузер не дал доступ к буферу обмена</h2>
        <p>
          Обычно это значит, что панель потеряла фокус. Кликните в панель и попробуйте снова — или
          скопируйте вручную: текст ниже уже выделен, нажмите Ctrl+C.
        </p>
        {copyError && <p className="cw-hint mono">{copyError}</p>}
        <textarea
          ref={manualTextRef}
          className="cw-input mono cw-manual-text"
          readOnly
          value={manualText}
          aria-label="Текст для ручного копирования"
        />
        <div className="cw-actions">
          <Button
            variant="primary"
            onClick={() => {
              manualRef.current?.close();
              void performCopy(target, false);
            }}
          >
            Повторить копирование
          </Button>
          <Button onClick={() => manualTextRef.current?.select()}>Выделить всё</Button>
          <Button onClick={() => manualRef.current?.close()}>Закрыть</Button>
        </div>
      </dialog>

      {/* ── §9.1 shortcut cheatsheet ───────────────────────────────────────*/}
      <dialog ref={helpRef} className="cw-dialog" aria-labelledby="cw-help-title">
        <h2 id="cw-help-title">Горячие клавиши</h2>
        <table className="cw-stats__table">
          <tbody>
            {SHORTCUTS.map(([k, v]) => (
              <tr key={k}>
                <td className="mono">{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cw-hint">
          Tab отступает список только когда каретка в списке — иначе Tab уводит фокус (ловушку
          фокуса мы не делаем никогда).
        </p>
        <div className="cw-actions">
          <Button onClick={() => helpRef.current?.close()}>Закрыть</Button>
        </div>
      </dialog>

      {/* ── §5.2 destructive confirmation ──────────────────────────────────*/}
      <dialog ref={replaceRef} className="cw-dialog" aria-labelledby="cw-replace-title">
        <h2 id="cw-replace-title">Заменить черновик шаблоном?</h2>
        <p>
          Будет перезаписано {counts.graphemes} символов текущего черновика. Перед заменой мы
          сделаем снимок — откатить можно через «⟲ История».
        </p>
        <div className="cw-actions">
          <Button
            variant="primary"
            onClick={() => {
              if (pendingTemplate) void applyDestructive(pendingTemplate.body, 'до вставки шаблона');
              setPendingTemplate(null);
              replaceRef.current?.close();
            }}
          >
            Заменить
          </Button>
          <Button
            onClick={() => {
              setPendingTemplate(null);
              replaceRef.current?.close();
            }}
          >
            Отмена
          </Button>
        </div>
      </dialog>

      <HistoryDialog
        dialogRef={historyRef}
        drafts={drafts}
        activeId={active?.id ?? null}
        usage={usage}
        onSelect={selectDraft}
        onDelete={deleteDraft}
        onNew={() => newDraft({ target: settings.defaultTarget })}
        onRestore={(bodyText) => void applyDestructive(bodyText, 'до восстановления снимка')}
        onRefreshUsage={draft.refreshUsage}
      />
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl+B / Ctrl+I / Ctrl+E', 'жирный / курсив / код'],
  ['Ctrl+Shift+C', 'чекбокс - [ ]'],
  ['Ctrl+Shift+D', '<details>'],
  ['Ctrl+Shift+T', 'таблица'],
  ['Ctrl+K', 'ссылка'],
  ['Ctrl+Shift+J', 'эмодзи'],
  ['Ctrl+F / Ctrl+H', 'найти и заменить'],
  ['Ctrl+Shift+L', 'транслитерация'],
  ['Ctrl+Shift+K', 'статистика'],
  ['Ctrl+Shift+P', 'превью вкл/выкл (узкая панель — переключить таб)'],
  ['Ctrl+Enter', 'копировать для площадки'],
  ['Ctrl+Shift+Enter', 'копировать как HTML'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'отмена / возврат'],
  ['F1', 'эта справка'],
];

function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
