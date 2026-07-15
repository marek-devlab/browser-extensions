import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Spinner } from '@blur/ui';
import {
  applyReplacements,
  disposeRegex,
  runRegex,
  type RegexMatch,
  type RegexOutcome,
} from '../utils/regex-client';
import {
  DEFAULT_SLUG_OPTIONS,
  TRANSLIT_STANDARDS,
  TRANSLIT_SAMPLE,
  transliterate,
  translitExample,
  type SlugOptions,
} from '../utils/translit';
import { LIMITS, targetInfo } from '../utils/targets';
import { countText, type Counts } from '../utils/counter';
import type { Settings, Target, TranslitStandard } from '../utils/types';

// The ToolDrawer (design §1.3, §2.5–2.7). ONE drawer, three tabs, always ABOVE
// the draft that is open right now.
//
// 🔴 SINGLE PURPOSE LIVES OR DIES HERE. None of these three has an icon, a popup,
// a command or a context-menu item of its own — the drawer cannot even be opened
// without the editor, and every tab reads and writes THE CURRENT DRAFT and
// nothing else. There is no "paste text here to test your regex" box: the input
// field IS the editor. That is the whole difference between us and regex101 in a
// wrapper (design §1.1, §1.3).

export type DrawerTab = 'find' | 'translit' | 'stats';

const TABS: { id: DrawerTab; label: string; glyph: string }[] = [
  { id: 'find', label: 'Найти и заменить', glyph: '🔎' },
  { id: 'translit', label: 'Транслитерация', glyph: '⇄' },
  { id: 'stats', label: 'Статистика', glyph: '📊' },
];

export interface DrawerProps {
  tab: DrawerTab;
  onTab: (t: DrawerTab) => void;
  body: string;
  selection: { start: number; end: number };
  counts: Counts;
  settings: Settings;
  target: Target;
  /** Highlighted matches, lifted so EditorPane can paint them. */
  onMatches: (m: RegexMatch[], current: number) => void;
  onScrollTo: (offset: number) => void;
  /** One undo transaction: Replace All / translit apply. */
  onReplaceAll: (body: string, label: string) => void;
  onReplaceRange: (start: number, end: number, value: string) => void;
}

export function ToolDrawer(props: DrawerProps) {
  const { tab, onTab } = props;

  const onKeyNav = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === 'ArrowRight') onTab(TABS[(i + 1) % TABS.length].id);
    if (e.key === 'ArrowLeft') onTab(TABS[(i - 1 + TABS.length) % TABS.length].id);
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
            onClick={() => onTab(t.id)}
          >
            {t.glyph} {t.label}
          </button>
        ))}
      </div>

      <div
        id={`cw-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`cw-tab-${tab}`}
        className="cw-panel"
      >
        {tab === 'find' && <FindReplace {...props} />}
        {tab === 'translit' && <Translit {...props} />}
        {tab === 'stats' && <Stats {...props} />}
      </div>
    </section>
  );
}

/* ── Find & Replace (design §2.5, §5.3, §5.4) ──────────────────────────────*/

function FindReplace({
  body,
  settings,
  onMatches,
  onScrollTo,
  onReplaceAll,
}: DrawerProps) {
  const [pattern, setPattern] = useState('');
  const [replacement, setReplacement] = useState('');
  const [useRegex, setUseRegex] = useState(true);
  const [flags, setFlags] = useState(settings.regexFlags);
  const [outcome, setOutcome] = useState<RegexOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(0);
  const [retry, setRetry] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    findRef.current?.focus();
    return () => {
      onMatches([], 0);
      disposeRegex();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search. EVERY compile and match happens in the worker — the main
  // thread never touches `new RegExp` (design §8.1).
  useEffect(() => {
    if (pattern === '') {
      setOutcome(null);
      onMatches([], 0);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      void runRegex(
        { pattern, flags, text: body, replacement, regex: useRegex },
        settings.regexTimeoutMs,
      ).then((o) => {
        setBusy(false);
        setOutcome(o);
        setCurrent(0);
        onMatches(o.status === 'ok' ? o.result.matches : [], 0);
      });
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, replacement, flags, useRegex, body, settings.regexTimeoutMs, retry]);

  const matches = outcome?.status === 'ok' ? outcome.result.matches : [];

  const step = (delta: number) => {
    if (matches.length === 0) return;
    const next = (current + delta + matches.length) % matches.length;
    setCurrent(next);
    onMatches(matches, next);
    onScrollTo(matches[next].start);
  };

  const replaceOne = () => {
    const m = matches[current];
    if (!m) return;
    onReplaceAll(applyReplacements(body, [m]), 'до замены');
  };

  const replaceAll = () => {
    if (matches.length === 0) return;
    onReplaceAll(applyReplacements(body, matches), `до «Заменить всё» (${matches.length})`);
  };

  const lineOf = (offset: number) => body.slice(0, offset).split('\n').length;

  return (
    <div className="cw-find">
      <label className="cw-field">
        Найти
        <input
          ref={findRef}
          className="cw-input mono"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          aria-label="Шаблон поиска"
          aria-invalid={outcome?.status === 'invalid'}
          aria-describedby={outcome?.status === 'invalid' ? 'cw-regex-error' : undefined}
          placeholder={useRegex ? '(\\d{4})-(\\d{2})-(\\d{2})' : 'текст'}
        />
      </label>
      <label className="cw-field">
        Заменить
        <input
          className="cw-input mono"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          aria-label="Замена"
          placeholder="$3.$2.$1"
        />
      </label>

      <div className="cw-flags">
        <label>
          <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} />{' '}
          Regex
        </label>
        {useRegex && (
          <>
            <span>Флаги:</span>
            {['g', 'i', 'm', 's', 'u', 'v'].map((f) => (
              <label key={f}>
                <input
                  type="checkbox"
                  checked={flags.includes(f)}
                  onChange={(e) =>
                    setFlags(e.target.checked ? flags + f : flags.split(f).join(''))
                  }
                />{' '}
                {f}
              </label>
            ))}
          </>
        )}
      </div>

      {busy && <Spinner label="Поиск в отдельном потоке…" />}

      {!busy && outcome?.status === 'ok' && (
        <>
          <p role="status">
            <Badge severity={matches.length > 0 ? 'ok' : 'info'}>
              {matches.length} совпадений
            </Badge>
            {outcome.result.groupNames.length > 0 && (
              <span className="cw-hint"> группы: {outcome.result.groupNames.join(', ')}</span>
            )}
            {outcome.result.truncated && (
              <span className="cw-hint"> · показаны первые 5000 — уточните шаблон</span>
            )}
          </p>

          {matches.length > 0 && replacement !== '' && (
            <>
              <p className="cw-hint">Предпросмотр замен (применится {matches.length}):</p>
              <ul className="cw-preview-list mono">
                {matches.slice(0, 5).map((m, i) => (
                  <li key={i}>
                    стр. {lineOf(m.start)} · {body.slice(m.start, m.end)} → {m.replaced}
                  </li>
                ))}
                {matches.length > 5 && <li>…ещё {matches.length - 5}</li>}
              </ul>
            </>
          )}

          <div className="cw-actions">
            <Button onClick={() => step(-1)} disabled={matches.length === 0}>◀ Пред</Button>
            <Button onClick={() => step(1)} disabled={matches.length === 0}>След ▶</Button>
            <Button onClick={replaceOne} disabled={matches.length === 0}>Заменить</Button>
            <Button variant="primary" onClick={replaceAll} disabled={matches.length === 0}>
              Заменить всё ({matches.length})
            </Button>
          </div>
        </>
      )}

      {!busy && outcome?.status === 'invalid' && (
        <div role="alert" className="cw-invalid" id="cw-regex-error">
          <p>⚠️ {outcome.message}</p>
          <p className="cw-hint">
            Хотите искать эти символы буквально? Снимите галку «Regex».
          </p>
          <details>
            <summary>Оригинал ошибки браузера</summary>
            <pre className="mono">{outcome.original}</pre>
          </details>
        </div>
      )}

      {!busy && outcome?.status === 'timeout' && (
        <div role="alert" className="cw-invalid">
          <p>⚠️ Поиск остановлен — {outcome.timeoutMs} мс</p>
          <p className="cw-hint">
            Этот шаблон слишком долго ищет в вашем тексте. Обычно так ведут себя вложенные
            повторы вроде (a+)+ — они перебирают комбинации экспоненциально. Поиск выполнялся в
            отдельном потоке и был прерван, поэтому редактор не завис и черновик не пострадал.
          </p>
          <ul className="cw-hint">
            <li>убрать вложенный квантификатор: (a+)+ → a+</li>
            <li>уточнить шаблон вместо .*</li>
            <li>увеличить таймаут в настройках (до 2000 мс)</li>
          </ul>
          <div className="cw-actions">
            <Button onClick={() => findRef.current?.focus()}>Изменить шаблон</Button>
            <Button onClick={() => setRetry((n) => n + 1)}>Повторить</Button>
          </div>
        </div>
      )}

      {!busy && outcome?.status === 'error' && (
        <div role="alert" className="cw-invalid">
          <p>⚠️ {outcome.message}</p>
        </div>
      )}
    </div>
  );
}

/* ── Transliteration (design §2.6) ─────────────────────────────────────────*/

function Translit({ body, selection, settings, onReplaceAll, onReplaceRange }: DrawerProps) {
  const [standard, setStandard] = useState<TranslitStandard>(settings.translitStandard);
  const hasSelection = selection.end > selection.start;
  const [scope, setScope] = useState<'selection' | 'draft'>(hasSelection ? 'selection' : 'draft');
  const [copied, setCopied] = useState(false);

  const slug: SlugOptions = {
    ...DEFAULT_SLUG_OPTIONS,
    separator: settings.slugSeparator,
    lowercase: settings.slugLowercase,
    maxLen: settings.slugMaxLen,
  };

  useEffect(() => {
    if (hasSelection) setScope('selection');
  }, [hasSelection]);

  const source =
    scope === 'selection' && hasSelection ? body.slice(selection.start, selection.end) : body;
  const result = useMemo(() => {
    try {
      return transliterate(source, standard, slug);
    } catch {
      return '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, standard, settings.slugSeparator, settings.slugLowercase, settings.slugMaxLen]);

  const sample = hasSelection ? body.slice(selection.start, selection.end) : TRANSLIT_SAMPLE;

  const apply = () => {
    if (scope === 'selection' && hasSelection) {
      onReplaceRange(selection.start, selection.end, result);
    } else {
      onReplaceAll(result, 'до транслитерации всего черновика');
    }
  };

  const insertBeside = () => {
    const at = scope === 'selection' && hasSelection ? selection.end : body.length;
    onReplaceRange(at, at, ` ${result}`);
  };

  return (
    <div className="cw-translit">
      <div className="cw-field">
        Источник:
        <label>
          <input
            type="radio"
            name="cw-src"
            checked={scope === 'selection'}
            disabled={!hasSelection}
            onChange={() => setScope('selection')}
          />{' '}
          Выделение ({countText(body.slice(selection.start, selection.end)).graphemes} симв.)
        </label>
        <label>
          <input
            type="radio"
            name="cw-src"
            checked={scope === 'draft'}
            onChange={() => setScope('draft')}
          />{' '}
          Весь черновик
        </label>
      </div>

      <div className="cw-field">
        Язык:
        <select value={settings.translitLang} disabled aria-label="Язык источника">
          <option value="ru">Русский</option>
        </select>
        <span className="cw-hint">Украинский и белорусский — в следующей версии.</span>
      </div>

      <fieldset className="cw-std">
        <legend>Стандарт (пример — на вашем тексте):</legend>
        {TRANSLIT_STANDARDS.map((s) => (
          <label key={s.id} className="cw-std__row">
            <input
              type="radio"
              name="cw-std"
              checked={standard === s.id}
              onChange={() => setStandard(s.id)}
            />
            <span>
              {s.label}
              {s.reversible ? ' (обратимо)' : ''}
            </span>
            <span className="mono cw-std__ex">{translitExample(s.id, sample, slug)}</span>
          </label>
        ))}
      </fieldset>

      <p className="cw-hint">
        ⓘ Стандарты дают РАЗНЫЙ результат. Паспортный — то, что напишут в загранпаспорте. Slug — то,
        что примет git и якорь в Markdown. Настройки slug (разделитель, длина) — в Настройках.
      </p>

      <p className="cw-hint">Результат:</p>
      <div className="cw-result mono">{result || '—'}</div>

      <div className="cw-actions">
        <Button variant="primary" onClick={apply} disabled={result === ''}>
          {scope === 'selection' && hasSelection ? 'Заменить выделение' : 'Заменить черновик'}
        </Button>
        <Button onClick={insertBeside} disabled={result === ''}>Вставить рядом</Button>
        <Button
          onClick={() => {
            void navigator.clipboard
              .writeText(result)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
          disabled={result === ''}
        >
          {copied ? 'Скопировано' : 'Копировать'}
        </Button>
      </div>
    </div>
  );
}

/* ── Stats (design §2.7) ───────────────────────────────────────────────────*/

function Stats({ body, selection, counts, settings, target }: DrawerProps) {
  const selText = body.slice(selection.start, selection.end);
  const sel = selText ? countText(selText) : null;

  const rows: [string, string, number, number | undefined][] = [
    ['Символы (графемы)', 'то, что видит человек', counts.graphemes, sel?.graphemes],
    ['UTF-16 code units', 'то, что считает JS', counts.utf16, sel?.utf16],
    ['Байты (UTF-8)', 'лимиты БД и HTTP', counts.bytes, sel?.bytes],
    ['Слова', '', counts.words, sel?.words],
    ['Строки', '', counts.lines, sel?.lines],
    ['Абзацы', '', counts.paragraphs, sel?.paragraphs],
  ];

  const longestLine = useMemo(
    () => body.split('\n').reduce((max, l) => Math.max(max, countText(l).graphemes), 0),
    [body],
  );

  const limits = LIMITS.filter((l) => {
    if (settings.limitsFollowTarget) {
      const forTarget: Record<string, string[]> = {
        github: ['commitTitle', 'commitBody', 'branch'],
        gitlab: ['commitTitle', 'commitBody', 'branch'],
      };
      const allowed = forTarget[target];
      if (allowed) return allowed.includes(l.id);
    }
    return settings.counterLimits[limitPrefKey(l.id)] ?? true;
  });

  return (
    <div className="cw-stats">
      <table className="cw-stats__table">
        <thead>
          <tr>
            <th scope="col">Метрика</th>
            <th scope="col">Весь черновик</th>
            <th scope="col">Выделение</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, note, all, s]) => (
            <tr key={label}>
              <td>
                {label}
                {note && <span className="cw-hint"> — {note}</span>}
              </td>
              <td className="mono">{all}</td>
              <td className="mono">{s ?? '—'}</td>
            </tr>
          ))}
          <tr>
            <td>Время чтения</td>
            <td className="mono">~{counts.readingMinutes} мин</td>
            <td />
          </tr>
        </tbody>
      </table>

      <p className="cw-hint">
        ⚠️ «👍» — это 1 символ, но 2 UTF-16 и 4 байта. «🇺🇦» — 1 символ, 4 UTF-16. Поэтому чисел
        несколько, а не одно.
        {counts.approximate && ' В этом браузере нет Intl.Segmenter — графемы посчитаны приблизительно.'}
      </p>

      <p className="cw-hint">Лимиты (каждый — в своих единицах, поэтому «312/280» без единиц было бы враньём):</p>
      <ul className="cw-limits">
        {limits.map((l) => {
          const used =
            l.id === 'commitBody'
              ? longestLine
              : l.unit === 'bytes'
                ? counts.bytes
                : l.unit === 'codepoints'
                  ? counts.codepoints
                  : counts.graphemes;
          const over = used > l.max;
          const pct = Math.min(100, Math.round((used / l.max) * 100));
          return (
            <li key={l.id} className="cw-limit">
              <span>
                {l.label} ({l.max} {UNIT_LABEL[l.unit]})
              </span>
              <span className="cw-bar" aria-hidden="true">
                <span
                  className={over ? 'cw-bar__fill cw-bar__fill--over' : 'cw-bar__fill'}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="mono">
                {used}/{l.max} {over ? '✗ превышен' : '✓'}
              </span>
            </li>
          );
        })}
      </ul>
      {settings.limitsFollowTarget && (
        <p className="cw-hint">Показаны только лимиты площадки «{targetInfo(target).label}».</p>
      )}
    </div>
  );
}

const UNIT_LABEL: Record<string, string> = {
  graphemes: 'графем',
  utf16: 'UTF-16',
  bytes: 'байт',
  codepoints: 'code points',
};

function limitPrefKey(id: string): string {
  if (id === 'commitTitle' || id === 'commitBody') return 'commit';
  if (id === 'branch') return 'branch';
  return id;
}
