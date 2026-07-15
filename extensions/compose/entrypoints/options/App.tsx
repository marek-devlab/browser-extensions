import { useRef, useState } from 'react';
import { Button, Callout, SectionHeading, ThemeToggle } from '@blur/ui';
import { usePrefs } from '../../utils/use-prefs';
import { TARGETS } from '../../utils/targets';
import { TRANSLIT_STANDARDS } from '../../utils/translit';
import {
  activeDraftIdItem,
  draftsItem,
  historyItem,
  templatesItem,
  recentEmojiItem,
} from '../../utils/storage';
import { BUILTIN_TEMPLATES } from '../../utils/templates';
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

export function App() {
  const { settings, update, theme, setTheme } = usePrefs();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  if (!settings) return <div className="opt-loading">Загрузка…</div>;
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
      setStatus(`Экспортировано черновиков: ${drafts.length}.`);
    } catch (e) {
      setStatus(`Не удалось экспортировать: ${msg(e)}`);
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
        setStatus('Это не файл экспорта Markdown Workbench.');
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
      setStatus(`Импортировано черновиков: ${incoming.length}. Существующие не тронуты.`);
    } catch (e) {
      setStatus(`Не удалось импортировать: ${msg(e)}`);
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
      setStatus('Все черновики и снимки удалены.');
      setConfirmClear(false);
    } catch (e) {
      setStatus(`Не удалось очистить: ${msg(e)}`);
    }
  };

  return (
    <main className="opt">
      <h1>Markdown Workbench — Настройки</h1>

      <section>
        <SectionHeading>Внешний вид</SectionHeading>
        <div className="opt-row">
          <span>Тема</span>
          <ThemeToggle theme={theme ?? s.theme} onChange={setTheme} />
        </div>
        <div className="opt-row">
          <span>Размер шрифта</span>
          <select value={s.fontSize} onChange={(e) => set('fontSize', Number(e.target.value))}>
            {[12, 13, 14, 15, 16, 18].map((n) => (
              <option key={n} value={n}>{n} px</option>
            ))}
          </select>
        </div>
        <label className="opt-row">
          <span>Моноширинный редактор</span>
          <input type="checkbox" checked={s.monospace} onChange={(e) => set('monospace', e.target.checked)} />
        </label>
        <div className="opt-row">
          <span>Раскладка</span>
          <select value={s.layout} onChange={(e) => set('layout', e.target.value as Settings['layout'])}>
            <option value="auto">Авто по ширине</option>
            <option value="tabs">Всегда табы</option>
            <option value="split">Всегда split</option>
          </select>
        </div>
      </section>

      <section>
        <SectionHeading>Черновик</SectionHeading>
        <div className="opt-row">
          <span>Целевая площадка по умолчанию</span>
          <select
            value={s.defaultTarget}
            onChange={(e) => set('defaultTarget', e.target.value as Settings['defaultTarget'])}
          >
            {TARGETS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <label className="opt-row">
          <span>Автосохранение</span>
          <input type="checkbox" checked={s.autosave} onChange={(e) => set('autosave', e.target.checked)} />
        </label>
        <div className="opt-row">
          <span>Интервал автосохранения</span>
          <select value={s.autosaveDelay} onChange={(e) => set('autosaveDelay', Number(e.target.value))}>
            {[300, 800, 2000].map((n) => (
              <option key={n} value={n}>{n} мс</option>
            ))}
          </select>
        </div>
        <div className="opt-row">
          <span>Снимков на черновик</span>
          <select value={s.historyLimit} onChange={(e) => set('historyLimit', Number(e.target.value))}>
            {[10, 30, 100].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <label className="opt-row">
          <span>Мягкий перенос строк</span>
          <input type="checkbox" checked={s.softWrap} onChange={(e) => set('softWrap', e.target.checked)} />
        </label>
        <label className="opt-row">
          <span>Проверка орфографии (нативная)</span>
          <input type="checkbox" checked={s.spellcheck} onChange={(e) => set('spellcheck', e.target.checked)} />
        </label>
        <Callout tone="info">
          Это встроенная проверка браузера. Своих словарей мы не грузим и в сеть не ходим.
        </Callout>
        <div className="opt-row">
          <span>Выделение из контекстного меню добавлять</span>
          <select
            value={s.contextMenuMode}
            onChange={(e) => set('contextMenuMode', e.target.value as Settings['contextMenuMode'])}
          >
            <option value="plain">как текст</option>
            <option value="quote">как цитату</option>
          </select>
        </div>
      </section>

      <section>
        <SectionHeading>Превью</SectionHeading>
        <label className="opt-row">
          <span>Показывать превью</span>
          <input type="checkbox" checked={s.showPreview} onChange={(e) => set('showPreview', e.target.checked)} />
        </label>
        <label className="opt-row">
          <span>Предупреждать, если санитайзер что-то удалил</span>
          <input
            type="checkbox"
            checked={s.warnOnSanitize}
            onChange={(e) => set('warnOnSanitize', e.target.checked)}
          />
        </label>
        <Callout tone="info">
          Превью близко к GitHub, но не идентично: у площадок свои санитайзеры и расширения.
          🔴 Выключение предупреждения НЕ отключает санитайзер — он не отключается вообще.
        </Callout>
      </section>

      <section>
        <SectionHeading>Транслитерация</SectionHeading>
        <div className="opt-row">
          <span>Стандарт по умолчанию</span>
          <select
            value={s.translitStandard}
            onChange={(e) => set('translitStandard', e.target.value as Settings['translitStandard'])}
          >
            {TRANSLIT_STANDARDS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="opt-row">
          <span>Slug: разделитель</span>
          <select
            value={s.slugSeparator}
            onChange={(e) => set('slugSeparator', e.target.value as Settings['slugSeparator'])}
          >
            <option value="-">-</option>
            <option value="_">_</option>
          </select>
        </div>
        <label className="opt-row">
          <span>Slug строчными</span>
          <input type="checkbox" checked={s.slugLowercase} onChange={(e) => set('slugLowercase', e.target.checked)} />
        </label>
        <label className="opt-row">
          <span>Обрезать slug до (лимит имени ветки — 63)</span>
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
        <SectionHeading>Найти и заменить</SectionHeading>
        <div className="opt-row">
          <span>Таймаут regex</span>
          <select value={s.regexTimeoutMs} onChange={(e) => set('regexTimeoutMs', Number(e.target.value))}>
            {[200, 500, 1000, 2000].map((n) => (
              <option key={n} value={n}>{n} мс</option>
            ))}
          </select>
        </div>
        <Callout tone="info">
          Поиск выполняется в отдельном потоке и принудительно прерывается по таймауту — поэтому
          даже «взрывной» шаблон вроде (a+)+ не может подвесить редактор. Больше таймаут — дольше
          ждём, но не виснем.
        </Callout>
        <div className="opt-row">
          <span>Флаги по умолчанию</span>
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
        <SectionHeading>Счётчик</SectionHeading>
        <div className="opt-row">
          <span>Показывать в строке</span>
          <span className="opt-flags">
            {(
              [
                ['graphemes', 'графемы'],
                ['words', 'слова'],
                ['bytes', 'байты'],
                ['utf16', 'UTF-16'],
                ['lines', 'строки'],
                ['reading', 'время чтения'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={s.counterFields[key] ?? false}
                  onChange={(e) => set('counterFields', { ...s.counterFields, [key]: e.target.checked })}
                />{' '}
                {label}
              </label>
            ))}
          </span>
        </div>
        <div className="opt-row">
          <span>Лимиты</span>
          <span className="opt-flags">
            {(
              [
                ['commit', 'commit 50/72'],
                ['branch', 'ветка 63'],
                ['x', 'X 280'],
                ['meta', 'meta 160'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={s.counterLimits[key] ?? false}
                  onChange={(e) => set('counterLimits', { ...s.counterLimits, [key]: e.target.checked })}
                />{' '}
                {label}
              </label>
            ))}
          </span>
        </div>
        <label className="opt-row">
          <span>Показывать только лимиты выбранной площадки</span>
          <input
            type="checkbox"
            checked={s.limitsFollowTarget}
            onChange={(e) => set('limitsFollowTarget', e.target.checked)}
          />
        </label>
      </section>

      <section>
        <SectionHeading>Данные</SectionHeading>
        <div className="opt-actions">
          <Button onClick={() => void exportAll()}>Экспорт всех черновиков (.json)</Button>
          <Button onClick={() => fileRef.current?.click()}>Импорт</Button>
          {confirmClear ? (
            <>
              <Button variant="primary" onClick={() => void clearAll()}>
                Да, удалить всё
              </Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                Отмена
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmClear(true)}>
              Очистить всё
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
        <Callout tone="info" title="100% локально">
          Ваш текст остаётся в браузере. Расширение не имеет доступа к сети: ни одного сетевого
          запроса, ни аналитики, ни облачной синхронизации, ни ИИ-сервисов. Черновики лежат в
          `storage.local` этого браузера; перенос между устройствами — только через «Экспорт» и
          «Импорт».
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
