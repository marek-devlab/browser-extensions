import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Callout,
  LanguageSwitcher,
  LocaleProvider,
  SectionHeading,
  ThemeToggle,
  useLocaleController,
} from '@blur/ui';
import { usePrefs } from '../../utils/use-prefs';
import { TARGETS } from '../../utils/targets';
import { TRANSLIT_STANDARDS } from '../../utils/translit';
import {
  activeDraftIdItem,
  draftsItem,
  historyItem,
  localeItem,
  templatesItem,
  recentEmojiItem,
} from '../../utils/storage';
import { BUILTIN_TEMPLATES } from '../../utils/templates';
import { useT, type MsgKey } from '../../utils/i18n';
import type { Draft, Settings, Snapshot } from '../../utils/types';

// Options (design §2.11). Every control persists to `local:settings` (design
// §1.4 — nothing this extension owns goes to `sync:`) and is read back by the
// editor surfaces.
//
// Export / Import / Clear are REAL and are the ONLY cross-device story we offer:
// there is no cloud sync of drafts, by design (design §11). Export uses a Blob +
// `<a download>` — no `downloads` permission.

interface Backup {
  kind: 'markdown-workbench';
  version: 1;
  exportedAt: number;
  drafts: Draft[];
  history: Snapshot[];
  settings: Settings;
}

/** Wrapper: owns the runtime locale and provides it to the settings body. */
export function App() {
  const { locale, setLocale } = useLocaleController({
    key: 'blur-compose:locale',
    read: () => localeItem.getValue(),
    write: (l) => localeItem.setValue(l),
  });
  return (
    <LocaleProvider locale={locale}>
      <OptionsBody locale={locale} setLocale={setLocale} />
    </LocaleProvider>
  );
}

function OptionsBody({
  locale,
  setLocale,
}: {
  locale: Parameters<typeof LanguageSwitcher>[0]['locale'];
  setLocale: (l: Parameters<typeof LanguageSwitcher>[0]['locale']) => void;
}) {
  const t = useT();
  const { settings, update, theme, setTheme } = usePrefs();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    document.title = t('opt_title');
  }, [t]);

  if (!settings) return <div className="opt-loading">{t('loading')}</div>;
  const s = settings;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    update({ [k]: v } as Partial<Settings>);

  const exportAll = async () => {
    try {
      const [drafts, history] = await Promise.all([draftsItem.getValue(), historyItem.getValue()]);
      const backup: Backup = {
        kind: 'markdown-workbench',
        version: 1,
        exportedAt: Date.now(),
        drafts,
        history,
        settings: s,
      };
      download(
        new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
        `markdown-workbench-${new Date().toISOString().slice(0, 10)}.json`,
      );
      setStatus(t('status_exported', { n: drafts.length }));
    } catch (e) {
      setStatus(t('status_export_failed', { error: msg(e) }));
    }
  };

  const importFile = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        (parsed as Backup).kind !== 'markdown-workbench' ||
        !Array.isArray((parsed as Backup).drafts)
      ) {
        setStatus(t('status_not_backup'));
        return;
      }
      const backup = parsed as Backup;
      const existing = await draftsItem.getValue();
      // Import ADDS — it never overwrites what is already there.
      const incoming = backup.drafts.map((d) => ({
        ...d,
        id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      }));
      await draftsItem.setValue([...incoming, ...existing]);
      setStatus(t('status_imported', { n: incoming.length }));
    } catch (e) {
      setStatus(t('status_import_failed', { error: msg(e) }));
    }
  };

  const clearAll = async () => {
    try {
      await Promise.all([
        draftsItem.setValue([]),
        historyItem.setValue([]),
        activeDraftIdItem.setValue(null),
        templatesItem.setValue(BUILTIN_TEMPLATES),
        recentEmojiItem.setValue([]),
      ]);
      setStatus(t('status_cleared'));
      setConfirmClear(false);
    } catch (e) {
      setStatus(t('status_clear_failed', { error: msg(e) }));
    }
  };

  return (
    <main className="opt">
      <h1>{t('opt_title')}</h1>

      <section>
        <SectionHeading>{t('sec_appearance')}</SectionHeading>
        <div className="opt-row">
          <span>{t('opt_theme')}</span>
          <ThemeToggle theme={theme ?? s.theme} onChange={setTheme} />
        </div>
        <div className="opt-row">
          <span>{t('language')}</span>
          <LanguageSwitcher locale={locale} onChange={setLocale} label={t('language')} />
        </div>
        <div className="opt-row">
          <span>{t('opt_font_size')}</span>
          <select value={s.fontSize} onChange={(e) => set('fontSize', Number(e.target.value))}>
            {[12, 13, 14, 15, 16, 18].map((n) => (
              <option key={n} value={n}>{n} px</option>
            ))}
          </select>
        </div>
        <label className="opt-row">
          <span>{t('opt_monospace')}</span>
          <input type="checkbox" checked={s.monospace} onChange={(e) => set('monospace', e.target.checked)} />
        </label>
        <div className="opt-row">
          <span>{t('opt_layout')}</span>
          <select value={s.layout} onChange={(e) => set('layout', e.target.value as Settings['layout'])}>
            <option value="auto">{t('layout_auto')}</option>
            <option value="tabs">{t('layout_tabs')}</option>
            <option value="split">{t('layout_split')}</option>
          </select>
        </div>
      </section>

      <section>
        <SectionHeading>{t('sec_draft')}</SectionHeading>
        <div className="opt-row">
          <span>{t('opt_default_target')}</span>
          <select
            value={s.defaultTarget}
            onChange={(e) => set('defaultTarget', e.target.value as Settings['defaultTarget'])}
          >
            {TARGETS.map((tg) => (
              <option key={tg.id} value={tg.id}>{t(`target_${tg.id}` as MsgKey)}</option>
            ))}
          </select>
        </div>
        <label className="opt-row">
          <span>{t('opt_autosave')}</span>
          <input type="checkbox" checked={s.autosave} onChange={(e) => set('autosave', e.target.checked)} />
        </label>
        <div className="opt-row">
          <span>{t('opt_autosave_delay')}</span>
          <select value={s.autosaveDelay} onChange={(e) => set('autosaveDelay', Number(e.target.value))}>
            {[300, 800, 2000].map((n) => (
              <option key={n} value={n}>{n} {t('unit_ms')}</option>
            ))}
          </select>
        </div>
        <div className="opt-row">
          <span>{t('opt_history_limit')}</span>
          <select value={s.historyLimit} onChange={(e) => set('historyLimit', Number(e.target.value))}>
            {[10, 30, 100].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <label className="opt-row">
          <span>{t('opt_soft_wrap')}</span>
          <input type="checkbox" checked={s.softWrap} onChange={(e) => set('softWrap', e.target.checked)} />
        </label>
        <label className="opt-row">
          <span>{t('opt_spellcheck')}</span>
          <input type="checkbox" checked={s.spellcheck} onChange={(e) => set('spellcheck', e.target.checked)} />
        </label>
        <Callout tone="info">{t('opt_spellcheck_note')}</Callout>
        <div className="opt-row">
          <span>{t('opt_ctx_menu')}</span>
          <select
            value={s.contextMenuMode}
            onChange={(e) => set('contextMenuMode', e.target.value as Settings['contextMenuMode'])}
          >
            <option value="plain">{t('ctx_plain')}</option>
            <option value="quote">{t('ctx_quote')}</option>
          </select>
        </div>
      </section>

      <section>
        <SectionHeading>{t('sec_preview')}</SectionHeading>
        <label className="opt-row">
          <span>{t('opt_show_preview')}</span>
          <input type="checkbox" checked={s.showPreview} onChange={(e) => set('showPreview', e.target.checked)} />
        </label>
        <label className="opt-row">
          <span>{t('opt_warn_sanitize')}</span>
          <input
            type="checkbox"
            checked={s.warnOnSanitize}
            onChange={(e) => set('warnOnSanitize', e.target.checked)}
          />
        </label>
        <Callout tone="info">{t('opt_preview_note')}</Callout>
      </section>

      <section>
        <SectionHeading>{t('sec_translit')}</SectionHeading>
        <div className="opt-row">
          <span>{t('opt_default_std')}</span>
          <select
            value={s.translitStandard}
            onChange={(e) => set('translitStandard', e.target.value as Settings['translitStandard'])}
          >
            {TRANSLIT_STANDARDS.map((std) => (
              <option key={std.id} value={std.id}>
                {t(`translit_${std.id.replace('-', '')}_label` as MsgKey)}
              </option>
            ))}
          </select>
        </div>
        <div className="opt-row">
          <span>{t('opt_slug_sep')}</span>
          <select
            value={s.slugSeparator}
            onChange={(e) => set('slugSeparator', e.target.value as Settings['slugSeparator'])}
          >
            <option value="-">-</option>
            <option value="_">_</option>
          </select>
        </div>
        <label className="opt-row">
          <span>{t('opt_slug_lower')}</span>
          <input type="checkbox" checked={s.slugLowercase} onChange={(e) => set('slugLowercase', e.target.checked)} />
        </label>
        <label className="opt-row">
          <span>{t('opt_slug_maxlen')}</span>
          <input
            type="number"
            min={20}
            max={120}
            value={s.slugMaxLen}
            onChange={(e) => set('slugMaxLen', Number(e.target.value))}
          />
        </label>
      </section>

      <section>
        <SectionHeading>{t('sec_find')}</SectionHeading>
        <div className="opt-row">
          <span>{t('opt_regex_timeout')}</span>
          <select value={s.regexTimeoutMs} onChange={(e) => set('regexTimeoutMs', Number(e.target.value))}>
            {[200, 500, 1000, 2000].map((n) => (
              <option key={n} value={n}>{n} {t('unit_ms')}</option>
            ))}
          </select>
        </div>
        <Callout tone="info">{t('opt_regex_note')}</Callout>
        <div className="opt-row">
          <span>{t('opt_default_flags')}</span>
          <span className="opt-flags">
            {['g', 'i', 'm', 's', 'u', 'v'].map((f) => (
              <label key={f}>
                <input
                  type="checkbox"
                  checked={s.regexFlags.includes(f)}
                  onChange={(e) =>
                    set('regexFlags', e.target.checked ? s.regexFlags + f : s.regexFlags.split(f).join(''))
                  }
                />{' '}
                {f}
              </label>
            ))}
          </span>
        </div>
      </section>

      <section>
        <SectionHeading>{t('sec_counter')}</SectionHeading>
        <div className="opt-row">
          <span>{t('opt_show_in_strip')}</span>
          <span className="opt-flags">
            {(
              [
                ['graphemes', 'cf_graphemes'],
                ['words', 'cf_words'],
                ['bytes', 'cf_bytes'],
                ['utf16', 'cf_utf16'],
                ['lines', 'cf_lines'],
                ['reading', 'cf_reading'],
              ] as const
            ).map(([key, labelKey]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={s.counterFields[key] ?? false}
                  onChange={(e) => set('counterFields', { ...s.counterFields, [key]: e.target.checked })}
                />{' '}
                {t(labelKey)}
              </label>
            ))}
          </span>
        </div>
        <div className="opt-row">
          <span>{t('opt_limits')}</span>
          <span className="opt-flags">
            {(
              [
                ['commit', 'cl_commit'],
                ['branch', 'cl_branch'],
                ['x', 'cl_x'],
                ['meta', 'cl_meta'],
              ] as const
            ).map(([key, labelKey]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={s.counterLimits[key] ?? false}
                  onChange={(e) => set('counterLimits', { ...s.counterLimits, [key]: e.target.checked })}
                />{' '}
                {t(labelKey)}
              </label>
            ))}
          </span>
        </div>
        <label className="opt-row">
          <span>{t('opt_limits_follow')}</span>
          <input
            type="checkbox"
            checked={s.limitsFollowTarget}
            onChange={(e) => set('limitsFollowTarget', e.target.checked)}
          />
        </label>
      </section>

      <section>
        <SectionHeading>{t('sec_data')}</SectionHeading>
        <div className="opt-actions">
          <Button onClick={() => void exportAll()}>{t('btn_export_all')}</Button>
          <Button onClick={() => fileRef.current?.click()}>{t('btn_import')}</Button>
          {confirmClear ? (
            <>
              <Button variant="primary" onClick={() => void clearAll()}>
                {t('btn_clear_yes')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                {t('cancel')}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmClear(true)}>
              {t('btn_clear_all')}
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="opt-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = '';
          }}
        />
        {status && (
          <p role="status" aria-live="polite" className="opt-status">
            {status}
          </p>
        )}
        <Callout tone="info" title={t('opt_local_title')}>
          {t('opt_local_note')}
        </Callout>
      </section>
    </main>
  );
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
