import { useState } from 'react';
import { Badge, Button, MockBadge, Spinner } from '@blur/ui';
import { runRegexMock, type RegexOutcome } from '../utils/regex-client';
import { TRANSLIT_STANDARDS, mockTransliterate } from '../utils/translit';
import { LIMITS } from '../utils/targets';
import type { Counts } from '../utils/counter';
import type { Settings, TranslitStandard } from '../utils/types';

// The ToolDrawer (design §1.3, §2.5–2.7). ONE drawer, three tabs, always ABOVE
// the current draft. It has NO own URL/entrypoint — it can't be opened without
// the editor (design §1.3). All three tabs operate ONLY on the current draft.
// Semantics: role=tablist/tab/tabpanel, arrow-key nav (design §9.2).

type Tab = 'find' | 'translit' | 'stats';

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'find', label: 'Найти и заменить', glyph: '🔎' },
  { id: 'translit', label: 'Транслитерация', glyph: '⇄' },
  { id: 'stats', label: 'Статистика', glyph: '📊' },
];

export function ToolDrawer({
  counts,
  selectionCounts,
  settings,
}: {
  counts: Counts;
  selectionCounts: Counts | null;
  settings: Settings;
}) {
  const [tab, setTab] = useState<Tab>('find');

  const onKeyNav = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === 'ArrowRight') setTab(TABS[(i + 1) % TABS.length].id);
    if (e.key === 'ArrowLeft') setTab(TABS[(i - 1 + TABS.length) % TABS.length].id);
  };

  return (
    <section id="cw-drawer" className="cw-drawer" aria-label="Инструменты редактора">
      <div className="cw-tablist" role="tablist" aria-label="Инструменты" onKeyDown={onKeyNav}>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`cw-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={tab === t.id ? `cw-panel-${t.id}` : undefined}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'cw-tab cw-tab--active' : 'cw-tab'}
            onClick={() => setTab(t.id)}
          >
            {t.glyph} {t.label}
          </button>
        ))}
      </div>

      <div id={`cw-panel-${tab}`} role="tabpanel" aria-labelledby={`cw-tab-${tab}`} className="cw-panel">
        {tab === 'find' && <FindReplace timeoutMs={settings.regexTimeoutMs} defaultFlags={settings.regexFlags} />}
        {tab === 'translit' && <Translit standard={settings.translitStandard} selectionCounts={selectionCounts} />}
        {tab === 'stats' && <Stats counts={counts} selectionCounts={selectionCounts} />}
      </div>
    </section>
  );
}

/* ── Find & Replace (design §2.5) — regex runs in a Worker, STUBBED ─────────*/
function FindReplace({ timeoutMs, defaultFlags }: { timeoutMs: number; defaultFlags: string }) {
  const [outcome, setOutcome] = useState<RegexOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [sim, setSim] = useState<'ok' | 'invalid' | 'timeout'>('ok');

  const run = () => {
    setBusy(true);
    void runRegexMock(sim, timeoutMs).then((o) => {
      setOutcome(o);
      setBusy(false);
    });
  };

  return (
    <div className="cw-find">
      <MockBadge note="Демо-совпадения · regex-воркер ещё не подключён (scaffold)" />
      <label className="cw-field">Найти
        <input className="cw-input mono" defaultValue="(\d{4})-(\d{2})-(\d{2})" aria-label="Шаблон поиска" />
      </label>
      <label className="cw-field">Заменить
        <input className="cw-input mono" defaultValue="$3.$2.$1" aria-label="Замена" />
      </label>
      <div className="cw-flags">
        Флаги:
        {['g', 'i', 'm', 's', 'u', 'v'].map((f) => (
          <label key={f}><input type="checkbox" defaultChecked={defaultFlags.includes(f)} /> {f}</label>
        ))}
      </div>
      {/* Scaffold control to preview the three drawer states (design §5.3, §5.4). */}
      <div className="cw-sim">
        <span className="cw-hint">Демо-состояние:</span>
        {(['ok', 'invalid', 'timeout'] as const).map((s) => (
          <label key={s}><input type="radio" name="cw-sim" checked={sim === s} onChange={() => setSim(s)} /> {s}</label>
        ))}
        <Button onClick={run}>Проверить</Button>
      </div>

      {busy && <Spinner label="Поиск в отдельном потоке…" />}

      {!busy && outcome?.status === 'ok' && (
        <>
          <p role="status"><Badge severity="ok">{outcome.result.matchCount} совпадений</Badge> группы: {outcome.result.groups.join(', ')}</p>
          <p className="cw-hint">Предпросмотр замен (применится {outcome.result.matchCount}):</p>
          <ul className="cw-preview-list mono">
            {outcome.result.preview.map((m, i) => (
              <li key={i}>стр. {m.line} {m.from} → {m.to}</li>
            ))}
          </ul>
          <div className="cw-actions">
            <Button>◀ Пред</Button><Button>След ▶</Button>
            <Button variant="primary">Заменить всё ({outcome.result.matchCount})</Button>
          </div>
        </>
      )}

      {!busy && outcome?.status === 'invalid' && (
        <div role="alert" className="cw-invalid">
          <p>⚠️ {outcome.message}</p>
          <p className="cw-hint">Хотите искать эти символы буквально? Снимите галку «Regex».</p>
          <details><summary>Оригинал ошибки</summary><pre className="mono">{outcome.original}</pre></details>
        </div>
      )}

      {!busy && outcome?.status === 'timeout' && (
        <div role="alert" className="cw-invalid">
          <p>⚠️ Поиск остановлен — {outcome.timeoutMs} мс</p>
          <p className="cw-hint">
            Шаблон слишком долго ищет (вложенные повторы вроде (a+)+). Поиск шёл в отдельном
            потоке и был прерван — редактор не завис, черновик цел.
          </p>
          <div className="cw-actions"><Button>Изменить шаблон</Button><Button onClick={run}>Повторить</Button></div>
        </div>
      )}
    </div>
  );
}

/* ── Transliteration (design §2.6) — 5 tables, STUBBED ─────────────────────*/
function Translit({ standard, selectionCounts }: { standard: TranslitStandard; selectionCounts: Counts | null }) {
  const [sel, setSel] = useState<TranslitStandard>(standard);
  const hasSelection = (selectionCounts?.graphemes ?? 0) > 0;
  return (
    <div className="cw-translit">
      <MockBadge note="Демо-примеры · таблицы транслитерации ещё не подключены (scaffold)" />
      <div className="cw-field">Источник:
        <label><input type="radio" name="cw-src" defaultChecked={hasSelection} /> Выделение ({selectionCounts?.graphemes ?? 0} симв.)</label>
        <label><input type="radio" name="cw-src" defaultChecked={!hasSelection} /> Весь черновик</label>
      </div>
      <fieldset className="cw-std">
        <legend>Стандарт:</legend>
        {TRANSLIT_STANDARDS.map((s) => (
          <label key={s.id} className="cw-std__row">
            <input type="radio" name="cw-std" checked={sel === s.id} onChange={() => setSel(s.id)} />
            <span>{s.label}{s.reversible ? ' (обратимо)' : ''}</span>
            <span className="mono cw-std__ex">{s.example}</span>
          </label>
        ))}
      </fieldset>
      <p className="cw-hint">Результат:</p>
      <div className="cw-result mono">{mockTransliterate(sel)}</div>
      <div className="cw-actions">
        <Button variant="primary">Заменить выделение</Button>
        <Button>Вставить рядом</Button>
        <Button>Копировать</Button>
      </div>
    </div>
  );
}

/* ── Stats (design §2.7) — counts are REAL, limits real vs mocked target ───*/
function Stats({ counts, selectionCounts }: { counts: Counts; selectionCounts: Counts | null }) {
  const rows: [string, number, number | undefined][] = [
    ['Символы (графемы)', counts.graphemes, selectionCounts?.graphemes],
    ['UTF-16 code units', counts.utf16, selectionCounts?.utf16],
    ['Байты (UTF-8)', counts.bytes, selectionCounts?.bytes],
    ['Слова', counts.words, selectionCounts?.words],
    ['Строки', counts.lines, selectionCounts?.lines],
    ['Абзацы', counts.paragraphs, selectionCounts?.paragraphs],
  ];
  return (
    <div className="cw-stats">
      <table className="cw-stats__table">
        <thead><tr><th></th><th>Весь черновик</th><th>Выделение</th></tr></thead>
        <tbody>
          {rows.map(([label, all, selv]) => (
            <tr key={label}><td>{label}</td><td className="mono">{all}</td><td className="mono">{selv ?? '—'}</td></tr>
          ))}
          <tr><td>Время чтения</td><td className="mono">~{counts.readingMinutes} мин</td><td></td></tr>
        </tbody>
      </table>
      <p className="cw-hint">
        ⚠️ «👍» — 1 символ, но 2 UTF-16 и 4 байта. Поэтому чисел несколько, а не одно.
      </p>
      <p className="cw-hint">Лимиты (каждый — в своих единицах):</p>
      <ul className="cw-limits">
        {LIMITS.map((l) => {
          const used = l.unit === 'bytes' ? counts.bytes : l.unit === 'codepoints' ? counts.codepoints : counts.graphemes;
          const over = used > l.max;
          const pct = Math.min(100, Math.round((used / l.max) * 100));
          return (
            <li key={l.id} className="cw-limit">
              <span>{l.label} ({l.max} {l.unit})</span>
              <span className="cw-bar"><span className="cw-bar__fill" style={{ width: `${pct}%` }} /></span>
              <span className="mono">{used}/{l.max} {over ? '✗' : '✓'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
