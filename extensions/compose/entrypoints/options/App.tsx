import { Button, Callout, SectionHeading, ThemeToggle } from '@blur/ui';
import { usePrefs } from '../../utils/use-prefs';
import { TARGETS } from '../../utils/targets';
import { TRANSLIT_STANDARDS } from '../../utils/translit';
import type { Settings } from '../../utils/types';

// Options surface (design §2.11). REAL: every control persists to `sync:settings`
// via usePrefs and is read back by the editor surfaces. No mocks needed here —
// this screen has no fabricated output (so no <MockBadge>). Data operations
// (export/import/clear) are STUBBED buttons.

export function App() {
  const { settings, update, theme, setTheme } = usePrefs();
  if (!settings) return <div className="opt-loading">Загрузка…</div>;
  const s = settings;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => update({ [k]: v } as Partial<Settings>);

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
            {[12, 13, 14, 15, 16, 18].map((n) => <option key={n} value={n}>{n} px</option>)}
          </select>
        </div>
        <label className="opt-row"><span>Моноширинный редактор</span>
          <input type="checkbox" checked={s.monospace} onChange={(e) => set('monospace', e.target.checked)} /></label>
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
          <select value={s.defaultTarget} onChange={(e) => set('defaultTarget', e.target.value as Settings['defaultTarget'])}>
            {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <label className="opt-row"><span>Автосохранение</span>
          <input type="checkbox" checked={s.autosave} onChange={(e) => set('autosave', e.target.checked)} /></label>
        <div className="opt-row">
          <span>Интервал автосохранения</span>
          <select value={s.autosaveDelay} onChange={(e) => set('autosaveDelay', Number(e.target.value))}>
            {[300, 800, 2000].map((n) => <option key={n} value={n}>{n} мс</option>)}
          </select>
        </div>
        <div className="opt-row">
          <span>Снимков на черновик</span>
          <select value={s.historyLimit} onChange={(e) => set('historyLimit', Number(e.target.value))}>
            {[10, 30, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <label className="opt-row"><span>Мягкий перенос строк</span>
          <input type="checkbox" checked={s.softWrap} onChange={(e) => set('softWrap', e.target.checked)} /></label>
        <label className="opt-row"><span>Проверка орфографии (нативная)</span>
          <input type="checkbox" checked={s.spellcheck} onChange={(e) => set('spellcheck', e.target.checked)} /></label>
      </section>

      <section>
        <SectionHeading>Превью</SectionHeading>
        <label className="opt-row"><span>Показывать превью</span>
          <input type="checkbox" checked={s.showPreview} onChange={(e) => set('showPreview', e.target.checked)} /></label>
        <label className="opt-row"><span>Предупреждать, если санитайзер что-то удалил</span>
          <input type="checkbox" checked={s.warnOnSanitize} onChange={(e) => set('warnOnSanitize', e.target.checked)} /></label>
        <Callout tone="info">Превью близко к GitHub, но не идентично: у площадок свои санитайзеры и расширения. Выключение предупреждения НЕ отключает санитайзер (design §7.3).</Callout>
      </section>

      <section>
        <SectionHeading>Транслитерация</SectionHeading>
        <div className="opt-row">
          <span>Стандарт по умолчанию</span>
          <select value={s.translitStandard} onChange={(e) => set('translitStandard', e.target.value as Settings['translitStandard'])}>
            {TRANSLIT_STANDARDS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div className="opt-row">
          <span>Slug: разделитель</span>
          <select value={s.slugSeparator} onChange={(e) => set('slugSeparator', e.target.value as Settings['slugSeparator'])}>
            <option value="-">-</option><option value="_">_</option>
          </select>
        </div>
        <label className="opt-row"><span>Slug строчными</span>
          <input type="checkbox" checked={s.slugLowercase} onChange={(e) => set('slugLowercase', e.target.checked)} /></label>
        <label className="opt-row"><span>Обрезать slug до</span>
          <input type="number" min={20} max={120} value={s.slugMaxLen} onChange={(e) => set('slugMaxLen', Number(e.target.value))} /></label>
      </section>

      <section>
        <SectionHeading>Найти и заменить</SectionHeading>
        <div className="opt-row">
          <span>Таймаут regex</span>
          <select value={s.regexTimeoutMs} onChange={(e) => set('regexTimeoutMs', Number(e.target.value))}>
            {[200, 500, 1000, 2000].map((n) => <option key={n} value={n}>{n} мс</option>)}
          </select>
        </div>
        <div className="opt-row">
          <span>Флаги по умолчанию</span>
          <span className="opt-flags">
            {['g', 'i', 'm', 's', 'u', 'v'].map((f) => (
              <label key={f}>
                <input type="checkbox" checked={s.regexFlags.includes(f)}
                  onChange={(e) => set('regexFlags', e.target.checked ? s.regexFlags + f : s.regexFlags.replace(f, ''))} /> {f}
              </label>
            ))}
          </span>
        </div>
      </section>

      <section>
        <SectionHeading>Данные</SectionHeading>
        <div className="opt-actions">
          <Button>Экспорт всех черновиков</Button>
          <Button>Импорт</Button>
          <Button variant="ghost">Очистить всё</Button>
        </div>
        <Callout tone="info" title="100% локально">
          Ваш текст остаётся в браузере. Расширение не имеет доступа к сети: ни одного сетевого
          запроса, ни аналитики, ни облачной синхронизации, ни ИИ-сервисов (design §7.4).
        </Callout>
      </section>
    </main>
  );
}
