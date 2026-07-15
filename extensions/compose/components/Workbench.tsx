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
import { TARGETS } from '../utils/targets';
import { BUILTIN_TEMPLATES } from '../utils/templates';
import { useT, type MsgKey } from '../utils/i18n';
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

/** Combo → description key for the F1 cheatsheet. Combos are literal. */
const SHORTCUTS: [string, MsgKey][] = [
  ['Ctrl+B / Ctrl+I / Ctrl+E', 'sc_format'],
  ['Ctrl+Shift+C', 'sc_task'],
  ['Ctrl+Shift+D', 'sc_details'],
  ['Ctrl+Shift+T', 'sc_table'],
  ['Ctrl+K', 'sc_link'],
  ['Ctrl+Shift+J', 'sc_emoji'],
  ['Ctrl+F / Ctrl+H', 'sc_find'],
  ['Ctrl+Shift+L', 'sc_translit'],
  ['Ctrl+Shift+K', 'sc_stats'],
  ['Ctrl+Shift+P', 'sc_preview'],
  ['Ctrl+Enter', 'sc_copy_target'],
  ['Ctrl+Shift+Enter', 'sc_copy_html'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'sc_undo'],
  ['F1', 'sc_help'],
];

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
  const t = useT();
  const targetLabel = useCallback((id: Target) => t(`target_${id}` as MsgKey), [t]);
  const copyVerb = useCallback((id: Target) => t(`copy_${id}` as MsgKey), [t]);
  const fmtMB = useCallback(
    (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} ${t('unit_mb')}`,
    [t],
  );

  const draft = useDraft(settings.autosaveDelay, settings.autosave, settings.historyLimit, t);
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
    const timer = setTimeout(() => {
      try {
        setDegradations(convert(deferredBody, target, { t }).degradations);
      } catch {
        // A parser failure must not block copying — the copy path reports it.
        setDegradations([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [deferredBody, target, t]);

  /* ── copy (design §4.1, §5.6, §6.2) ────────────────────────────────────*/

  const build = useCallback(
    async (tgt: Target): Promise<ConversionResult> => {
      // Jira/Telegram don't know `:tada:` — resolve shortcodes to characters, but
      // only pull the (lazy, heavy) emoji chunk when the draft actually has one.
      let shortcodeToEmoji: ((s: string) => string | null) | undefined;
      if ((tgt === 'jira' || tgt === 'telegram') && SHORTCODE_RE.test(body)) {
        try {
          const index = await loadEmoji();
          shortcodeToEmoji = (code) => index.byShortcode.get(code) ?? null;
        } catch {
          // Data unavailable → leave the shortcodes as typed rather than guess.
        }
      }
      return convert(body, tgt, { shortcodeToEmoji, t });
    },
    [body, t],
  );

  const performCopy = useCallback(
    async (tgt: Target, asHtml: boolean) => {
      try {
        const result = await build(asHtml ? 'html' : tgt);
        const outcome = await copyToClipboard(result.text, result.html);
        if (outcome.ok) {
          const bytes = new TextEncoder().encode(result.text).length;
          setToast(
            asHtml
              ? t('toast_copied_html', { bytes })
              : t('toast_copied_target', { label: targetLabel(tgt), bytes }) +
                  (result.degradations.length
                    ? t('toast_copied_simplified', { list: result.degradations.join('; ') })
                    : ''),
          );
          return;
        }
        // 🔴 Never fail silently: show the text and let the user copy it by hand.
        setCopyError(outcome.error);
        setManualText(result.text);
        manualRef.current?.showModal();
        requestAnimationFrame(() => manualTextRef.current?.select());
      } catch (e) {
        setToast(t('toast_convert_failed', { error: e instanceof Error ? e.message : String(e) }));
      }
    },
    [build, t, targetLabel],
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
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  /* ── toolbar / templates / environment ─────────────────────────────────*/

  const applyAction = (id: ActionId) => editorRef.current?.applyAction(id);

  const onTemplate = (tpl: Template, mode: 'append' | 'replace') => {
    if (mode === 'replace') {
      // §5.2 — a destructive op on a non-empty draft asks first, and says HOW
      // MUCH text it is about to overwrite.
      if (!empty) {
        setPendingTemplate(tpl);
        replaceRef.current?.showModal();
        return;
      }
      void applyDestructive(tpl.body, t('snap_before_template'));
      return;
    }
    const sep = body === '' || body.endsWith('\n') ? '' : '\n\n';
    editorRef.current?.replaceRange(body.length, body.length, sep + tpl.body);
  };

  const onEnvironment = async () => {
    try {
      const tab = await requestActiveTabInfo();
      const facts = await collectEnv({
        includeFullUA: settings.envIncludeFullUA,
        url: tab?.url,
        window: t('env_screen_window'),
      });
      setEnv(facts);
      envRef.current?.showModal();
    } catch (e) {
      setToast(t('toast_env_failed', { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const insertEnv = () => {
    if (!env) return;
    const at = selection.end || body.length;
    editorRef.current?.replaceRange(at, at, '\n' + envToMarkdown(env, t) + '\n');
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
        if (isNarrow) setNarrowTab((tab) => (tab === 'editor' ? 'preview' : 'editor'));
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

  if (drafts === null) return <div className="cw-loading">{t('loading')}</div>;

  const showPreview = settings.showPreview && !empty;

  return (
    <div ref={containerRef} className="cw-root" data-surface={surface}>
      {/* Header (design §2.1/§2.2) */}
      <header className="cw-header">
        <label className="cw-header__draft">
          <span aria-hidden="true">✎</span>
          <select
            aria-label={t('draft_aria')}
            value={active?.id ?? ''}
            onChange={(e) => selectDraft(e.target.value)}
          >
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title || t('draft_untitled')}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="cw-tool cw-tool--inline"
          title={t('new_draft_title')}
          aria-label={t('new_draft_title')}
          onClick={() => newDraft({ target: settings.defaultTarget })}
        >
          ＋
        </button>

        <label className="cw-header__target">
          {t('target_label')}
          <select
            aria-label={t('target_aria')}
            value={target}
            onChange={(e) => setTarget(e.target.value as Target)}
          >
            {TARGETS.map((tg) => (
              <option key={tg.id} value={tg.id}>
                {targetLabel(tg.id)}
              </option>
            ))}
          </select>
        </label>

        <span className="cw-header__spacer" />

        <span className="cw-save" role="status" aria-live="polite">
          {saveState === 'saving'
            ? t('save_saving')
            : saveState === 'saved'
              ? t('save_saved') +
                (savedAt
                  ? ' ' + new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '')
              : saveState === 'error'
                ? t('save_error')
                : ''}
        </span>

        <button
          type="button"
          className="cw-tool cw-tool--inline"
          title={t('history_title_btn')}
          aria-label={t('history_aria')}
          onClick={() => historyRef.current?.showModal()}
        >
          ⟲
        </button>
        {surface === 'panel' && (
          <button
            type="button"
            className="cw-tool cw-tool--inline"
            title={t('open_tab_title')}
            aria-label={t('open_tab_title')}
            onClick={() => void openWorkbenchTab()}
          >
            ⛶
          </button>
        )}
        <button
          type="button"
          className="cw-tool cw-tool--inline"
          title={t('shortcuts_title')}
          aria-label={t('shortcuts_aria')}
          onClick={() => helpRef.current?.showModal()}
        >
          ?
        </button>
        <ThemeToggle theme={theme ?? settings.theme} onChange={setTheme} />
      </header>

      {/* §8.2 — the write failed. The text is NOT lost; say what to do. */}
      {saveError && (
        <Callout tone="poor" title={t('save_fail_title')}>
          {saveError}{' '}
          <button type="button" className="cw-linklike" onClick={() => historyRef.current?.showModal()}>
            {t('save_fail_action')}
          </button>
        </Callout>
      )}

      {/* §8.3 — an unsaved buffer survived; the user decides, not us. */}
      {recovery && (
        <Callout tone="warn" title={t('recovery_title')}>
          <p>
            {t('recovery_body', {
              time: new Date(recovery.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              n: countText(recovery.body).graphemes,
            })}
          </p>
          <div className="cw-actions">
            <Button variant="primary" onClick={acceptRecovery}>{t('btn_recover')}</Button>
            <Button onClick={dismissRecovery}>{t('btn_keep_current')}</Button>
          </div>
        </Callout>
      )}

      {usage && usage.ratio > 0.8 && (
        <Callout tone="warn" title={t('storage_full_title')}>
          {t('storage_full_body', { used: fmtMB(usage.bytes), quota: fmtMB(usage.quota) })}{' '}
          <button type="button" className="cw-linklike" onClick={() => historyRef.current?.showModal()}>
            {t('storage_history_export')}
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
        <div className="cw-viewtabs" role="tablist" aria-label={t('viewtabs_aria')}>
          {(['editor', 'preview'] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              type="button"
              aria-selected={narrowTab === tab}
              className={narrowTab === tab ? 'cw-tab cw-tab--active' : 'cw-tab'}
              onClick={() => setNarrowTab(tab)}
            >
              {tab === 'editor' ? t('view_editor') : t('view_preview')}
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
                title={t('empty_title')}
                hint={t('empty_hint')}
                action={
                  <div className="cw-actions">
                    <Button
                      variant="primary"
                      onClick={() => onTemplate(templates[0] ?? BUILTIN_TEMPLATES[0], 'append')}
                    >
                      {t('empty_take_template')}
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
          {copyVerb(target)}
        </Button>
        <Button disabled={empty} onClick={copyAsHtml} ariaLabel={t('copy_html_aria')}>
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
        <h2 id="cw-compat-title">{t('compat_title', { label: targetLabel(target) })}</h2>
        <p>{t('compat_body')}</p>
        <ul className="cw-deg-list">
          {degradations.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p className="cw-hint">{t('compat_note')}</p>
        <div className="cw-actions">
          <Button
            variant="primary"
            onClick={() => {
              compatRef.current?.close();
              void performCopy(target, false);
            }}
          >
            {t('btn_copy_anyway')}
          </Button>
          <Button onClick={() => compatRef.current?.close()}>{t('btn_change_platform')}</Button>
        </div>
      </dialog>

      {/* ── §2.9 environment preview ───────────────────────────────────────*/}
      <dialog ref={envRef} className="cw-dialog" aria-labelledby="cw-env-title">
        <h2 id="cw-env-title">{t('env_title')}</h2>
        {env ? (
          <>
            <pre className="mono cw-env-preview">{envToMarkdown(env, t)}</pre>
            <label className="cw-check">
              <input
                type="checkbox"
                checked={settings.envIncludeFullUA}
                onChange={(e) => {
                  updateSettings({ envIncludeFullUA: e.target.checked });
                  void collectEnv({
                    includeFullUA: e.target.checked,
                    url: env.url,
                    window: t('env_screen_window'),
                  })
                    .then(setEnv)
                    .catch(() => {});
                }}
              />{' '}
              {t('env_full_ua')}
            </label>
            {!env.url && <p className="cw-hint">{t('env_no_url')}</p>}
            <p className="cw-hint">{t('env_nothing_sent')}</p>
          </>
        ) : (
          <p>{t('env_collecting')}</p>
        )}
        <div className="cw-actions">
          <Button variant="primary" onClick={insertEnv}>{t('btn_insert')}</Button>
          <Button onClick={() => envRef.current?.close()}>{t('cancel')}</Button>
        </div>
      </dialog>

      {/* ── §5.6 clipboard refused — manual copy ───────────────────────────*/}
      <dialog ref={manualRef} className="cw-dialog" aria-labelledby="cw-manual-title">
        <h2 id="cw-manual-title">{t('manual_title')}</h2>
        <p>{t('manual_body')}</p>
        {copyError && <p className="cw-hint mono">{t(copyError as MsgKey)}</p>}
        <textarea
          ref={manualTextRef}
          className="cw-input mono cw-manual-text"
          readOnly
          value={manualText}
          aria-label={t('manual_text_aria')}
        />
        <div className="cw-actions">
          <Button
            variant="primary"
            onClick={() => {
              manualRef.current?.close();
              void performCopy(target, false);
            }}
          >
            {t('btn_retry_copy')}
          </Button>
          <Button onClick={() => manualTextRef.current?.select()}>{t('btn_select_all')}</Button>
          <Button onClick={() => manualRef.current?.close()}>{t('close')}</Button>
        </div>
      </dialog>

      {/* ── §9.1 shortcut cheatsheet ───────────────────────────────────────*/}
      <dialog ref={helpRef} className="cw-dialog" aria-labelledby="cw-help-title">
        <h2 id="cw-help-title">{t('help_title')}</h2>
        <table className="cw-stats__table">
          <tbody>
            {SHORTCUTS.map(([combo, key]) => (
              <tr key={combo}>
                <td className="mono">{combo}</td>
                <td>{t(key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cw-hint">{t('help_tab_note')}</p>
        <div className="cw-actions">
          <Button onClick={() => helpRef.current?.close()}>{t('close')}</Button>
        </div>
      </dialog>

      {/* ── §5.2 destructive confirmation ──────────────────────────────────*/}
      <dialog ref={replaceRef} className="cw-dialog" aria-labelledby="cw-replace-title">
        <h2 id="cw-replace-title">{t('replace_title')}</h2>
        <p>{t('replace_body', { n: counts.graphemes })}</p>
        <div className="cw-actions">
          <Button
            variant="primary"
            onClick={() => {
              if (pendingTemplate) void applyDestructive(pendingTemplate.body, t('snap_before_template'));
              setPendingTemplate(null);
              replaceRef.current?.close();
            }}
          >
            {t('btn_replace')}
          </Button>
          <Button
            onClick={() => {
              setPendingTemplate(null);
              replaceRef.current?.close();
            }}
          >
            {t('cancel')}
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
        onRestore={(bodyText) => void applyDestructive(bodyText, t('snap_before_restore'))}
        onRefreshUsage={draft.refreshUsage}
      />
    </div>
  );
}
