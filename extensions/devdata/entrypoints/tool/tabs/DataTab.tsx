import { useCallback, useMemo, useState } from 'react';
import { Badge, Button, Callout, MockBadge, Spinner } from '@blur/ui';
import { convert, inspectValue, parseDocument } from '../../../utils/format';
import { MOCK_CONVERSION, MOCK_PARSE_ERROR, MOCK_PARSED_DOC } from '../../../utils/mock-data';
import { FORMAT_LABELS, type ConversionResult, type Format, type ParsedDoc, type TreeRow } from '../../../utils/types';
import type { DevdataPrefs, FormatPref } from '../../../utils/storage';

// The Data tab — the core workspace (design §2.3, §2.4). Format is a PROPERTY of
// the document (a chip with autodetect + manual override), not a tab, so the six
// formats don't explode into 24 tab-states (design §1.3). Conversion is an
// ACTION over the document, shown as a split view (§2.5), not a separate screen.
//
// The parse/convert/inspect logic is STUBBED (utils/format.ts → mock data +
// todoLogic). To keep every designed STATE reachable and visible in the scaffold,
// a clearly-labelled state preview switches between empty/loading/ok/error/
// degraded — the states are real UI; only the data is mock.

type ViewState = 'empty' | 'loading' | 'ok' | 'error' | 'degraded';

const STATE_LABELS: { id: ViewState; label: string }[] = [
  { id: 'empty', label: 'Пусто' },
  { id: 'loading', label: 'Загрузка' },
  { id: 'ok', label: 'Документ' },
  { id: 'error', label: 'Ошибка' },
  { id: 'degraded', label: 'Большой (50 МБ)' },
];

const FORMAT_OPTIONS: FormatPref[] = ['auto', 'json', 'json5', 'jsonc', 'yaml', 'xml', 'csv'];

export function DataTab({
  prefs,
  update,
}: {
  prefs: DevdataPrefs | null;
  update: (patch: Partial<DevdataPrefs>) => void;
}) {
  const [state, setState] = useState<ViewState>('ok');
  const [doc] = useState<ParsedDoc>(MOCK_PARSED_DOC);
  const [selected, setSelected] = useState<string>('$.users[1].id');
  const [conversion, setConversion] = useState<ConversionResult | null>(null);
  const [busy, setBusy] = useState(false);

  const loadExample = useCallback(async (_fmt: Format) => {
    setState('loading');
    setBusy(true);
    // Exercises the >150ms loading state against mock data (design §5.1).
    await parseDocument('{ /* example */ }', 'auto');
    setBusy(false);
    setState('ok');
  }, []);

  const runConvert = useCallback(async (to: Format) => {
    setBusy(true);
    const result = await convert(doc, to);
    setConversion(result);
    setBusy(false);
  }, [doc]);

  const inspected = useMemo(() => inspectValue(selected), [selected]);

  return (
    <div className="data">
      <MockBadge />

      {/* Scaffold-only: preview each designed state. Not a shipped control. */}
      <div className="statepick" role="group" aria-label="Предпросмотр состояний (каркас)">
        <span className="statepick__label">Состояние (демо):</span>
        {STATE_LABELS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={state === s.id ? 'chip chip--active' : 'chip'}
            aria-pressed={state === s.id}
            onClick={() => {
              setConversion(null);
              setState(s.id);
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {state === 'empty' && <EmptyState onExample={loadExample} />}
      {state === 'loading' && <LoadingState />}
      {state === 'error' && <ErrorState />}
      {(state === 'ok' || state === 'degraded') && (
        <>
          <Toolbar
            doc={doc}
            prefs={prefs}
            update={update}
            busy={busy}
            onConvert={runConvert}
            degraded={state === 'degraded'}
          />
          {state === 'degraded' && <DegradedNotice />}
          {conversion ? (
            <ConversionView result={conversion} onBack={() => setConversion(null)} />
          ) : (
            <Workspace
              doc={doc}
              selected={selected}
              onSelect={setSelected}
              inspected={inspected}
              wrap={prefs?.wrap ?? true}
              lineNumbers={prefs?.lineNumbers ?? true}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- States ---------------- */

function EmptyState({ onExample }: { onExample: (f: Format) => void }) {
  return (
    <div className="empty">
      <div className="dropzone">
        <p className="dropzone__title">Перетащите файл сюда или вставьте текст (⌘V)</p>
        <Button variant="primary">Выбрать файл…</Button>
        <p className="dropzone__formats mono">JSON · JSON5 · JSONC · YAML · XML · CSV · JWT</p>
      </div>
      <p className="empty__note">
        Формат определяется сам. До 50 МБ. Всё считается локально: ни один байт не покидает браузер.
      </p>
      <div className="row row--gap">
        <span className="empty__examplelabel">Примеры:</span>
        <button className="chip" type="button" onClick={() => onExample('json')}>JSON</button>
        <button className="chip" type="button" onClick={() => onExample('yaml')}>YAML</button>
        <button className="chip" type="button" onClick={() => onExample('jwt')}>JWT</button>
      </div>
    </div>
  );
}

function LoadingState() {
  // Progress is by BYTES READ, never a fabricated parse percentage (design §5.1).
  return (
    <div className="loading" role="status" aria-live="polite">
      <Spinner label="Разбираем 47 МБ…" />
      <div className="progress" aria-hidden="true">
        <div className="progress__bar" style={{ width: '48%' }} />
      </div>
      <p className="fine">прочитано 22 МБ из 47 МБ</p>
      <Button>Отменить</Button>
    </div>
  );
}

function ErrorState() {
  // The malformed-JSON error with a source POSITION and fix buttons (design §5.4).
  const e = MOCK_PARSE_ERROR;
  return (
    <div className="parse-error">
      <p className="parse-error__status" role="alert">
        <Badge severity="poor">Ошибка разбора</Badge> строка {e.line}, столбец {e.column}
      </p>
      <pre className="mono errbox">{`  13   "meta": {
  14     "version": "1.0",,
                          ^
                          └─ строка ${e.line}, столбец ${e.column}
  15   }`}</pre>
      <p className="parse-error__msg">✗ {e.message}</p>
      <p className="fine">Похоже на лишнюю запятую. Варианты:</p>
      <div className="row row--gap">
        {e.suggestions.map((s) => (
          <Button key={s}>{s}</Button>
        ))}
      </div>
      <Callout tone="info">
        Позиция берётся из <span className="mono">jsonc-parser</span> (стабильные оффсеты),
        а не из текста SyntaxError движка. Часть до ошибки показана деревом ниже.
      </Callout>
    </div>
  );
}

function DegradedNotice() {
  return (
    <Callout tone="warn" title="⚠ Большой документ: 47 МБ, 1 240 118 строк">
      Дерево и подсветка работают только по видимой части. Отключено: поиск по всему документу (v1),
      сортировка ключей. Beautify создаст ещё одну копию в памяти — может не хватить.
    </Callout>
  );
}

/* ---------------- Toolbar ---------------- */

function Toolbar({
  doc,
  prefs,
  update,
  busy,
  onConvert,
  degraded,
}: {
  doc: ParsedDoc;
  prefs: DevdataPrefs | null;
  update: (patch: Partial<DevdataPrefs>) => void;
  busy: boolean;
  onConvert: (f: Format) => void;
  degraded: boolean;
}) {
  const [convertOpen, setConvertOpen] = useState(false);
  return (
    <div className="toolbar">
      <div className="toolbar__row">
        <label className="field">
          Формат:
          <select
            value={prefs?.defaultFormat === 'auto' ? doc.format : (prefs?.defaultFormat ?? doc.format)}
            onChange={(e) => update({ defaultFormat: e.target.value as FormatPref })}
          >
            {FORMAT_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f === 'auto' ? 'Авто' : FORMAT_LABELS[f as Format]}
              </option>
            ))}
          </select>
        </label>
        {doc.autodetected && <span className="fine">авто</span>}
        <span className="stats mono">
          {fmtBytes(doc.bytes)} · {doc.lines.toLocaleString('ru')} строк · {doc.nodes.toLocaleString('ru')} узлов
        </span>
        <span className="grow" />
        {doc.valid ? (
          <Badge severity="ok">✓ Валиден</Badge>
        ) : (
          <Badge severity="poor">✗ Невалиден</Badge>
        )}
      </div>

      <div className="toolbar__row">
        <div className="segmented" role="group" aria-label="Вид">
          <button type="button" className="seg seg--active">Дерево</button>
          <button type="button" className="seg">Текст</button>
          <button type="button" className="seg" disabled={degraded} title={degraded ? 'Недоступно на большом документе' : undefined}>Оба</button>
        </div>
        <Button disabled={busy}>Beautify</Button>
        <Button disabled={busy}>Minify</Button>
        <label className="field">
          отступ:
          <select value={prefs?.indent ?? '2'} onChange={(e) => update({ indent: e.target.value as DevdataPrefs['indent'] })}>
            <option value="2">2</option>
            <option value="4">4</option>
            <option value="tab">Tab</option>
            <option value="min">Minified</option>
          </select>
        </label>
        <label className="check check--inline" title="Влияет только на вывод — дерево всегда в исходном порядке (design §3)">
          <input
            type="checkbox"
            checked={prefs?.sortKeys ?? false}
            disabled={degraded}
            onChange={(e) => update({ sortKeys: e.target.checked })}
          />
          Сорт. ключей
        </label>
        <span className="grow" />
        <div className="convert">
          <Button onClick={() => setConvertOpen((v) => !v)} disabled={busy}>
            Конвертировать в ▾
          </Button>
          {convertOpen && (
            <ul className="menu" role="menu">
              {(['yaml', 'xml', 'csv', 'json5'] as Format[]).map((f) => (
                <li key={f} role="none">
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setConvertOpen(false);
                      onConvert(f);
                    }}
                  >
                    {FORMAT_LABELS[f]}
                    {f === 'csv' && <span className="fine"> (плоский)</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button disabled={busy}>Копировать</Button>
        <Button disabled={busy}>Скачать</Button>
      </div>
    </div>
  );
}

/* ---------------- Workspace (tree + text + inspector) ---------------- */

function Workspace({
  doc,
  selected,
  onSelect,
  inspected,
  wrap,
  lineNumbers,
}: {
  doc: ParsedDoc;
  selected: string;
  onSelect: (path: string) => void;
  inspected: ReturnType<typeof inspectValue>;
  wrap: boolean;
  lineNumbers: boolean;
}) {
  return (
    <div className="workspace">
      <section className="pane pane--tree" aria-label="Дерево">
        <h2 className="ui-section-heading">Дерево</h2>
        {/* One tab stop for the whole tree (roving tabindex, design §9.3). */}
        <div className="tree" role="tree" aria-label="Структура документа" tabIndex={0}>
          {doc.rows.map((row) => (
            <TreeRowView
              key={row.id}
              row={row}
              selected={row.path === selected}
              onSelect={() => onSelect(row.path)}
            />
          ))}
        </div>
        <p className="fine">↑↓ навигация · → раскрыть · виртуализировано (окно ~100 строк)</p>
      </section>

      <section className="pane pane--text" aria-label="Текст">
        <div className="pane__head">
          <h2 className="ui-section-heading">Текст</h2>
          <input className="search" type="search" placeholder="🔍 Поиск в документе" aria-label="Поиск" />
        </div>
        {/* Flat <pre> — syntax colouring will come from the Highlight API over
            Ranges, NEVER generated <span> HTML (design §7.3). */}
        <pre className={wrap ? 'code code--wrap mono' : 'code mono'}>
          {doc.textLines.map((line, i) => (
            <span className="code__line" key={i}>
              {lineNumbers && <span className="code__gutter" aria-hidden="true">{i + 1}</span>}
              <span className="code__text">{line}</span>
            </span>
          ))}
        </pre>
      </section>

      <section className="inspector" aria-label="Значение">
        <div className="inspector__head">
          <h2 className="ui-section-heading">Значение</h2>
          <code className="mono">{inspected.path}</code>
          <span className="grow" />
          <Button>Копировать</Button>
        </div>
        <p className="inspector__value mono">{inspected.raw}</p>
        {inspected.precisionNote && (
          <p className="inspector__note">
            <Badge severity="warn">⚠</Badge> {inspected.precisionNote}
          </p>
        )}
      </section>
    </div>
  );
}

const KIND_MARK: Record<TreeRow['kind'], string> = {
  object: '{}',
  array: '[]',
  string: '"',
  number: '#',
  bool: 'T/F',
  null: '∅',
};

function TreeRowView({
  row,
  selected,
  onSelect,
}: {
  row: TreeRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.expandable ? true : undefined}
      aria-selected={selected}
      className={selected ? 'trow trow--sel' : 'trow'}
      style={{ paddingLeft: `${row.depth * 16 + 4}px` }}
      onClick={onSelect}
    >
      <span className="trow__caret" aria-hidden="true">{row.expandable ? '▾' : '·'}</span>
      <span className="trow__mark mono" aria-hidden="true">{KIND_MARK[row.kind]}</span>
      {row.key !== null && <span className="trow__key">{row.key}</span>}
      <span className="trow__preview mono">{row.preview}</span>
      {row.count !== null && <span className="trow__count mono">{row.count}</span>}
    </div>
  );
}

/* ---------------- Conversion split view ---------------- */

function ConversionView({ result, onBack }: { result: ConversionResult; onBack: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const warns = result.warnings.length > 0 ? result.warnings : MOCK_CONVERSION.warnings;
  return (
    <div className="conversion">
      <div className="conversion__head">
        <strong>{FORMAT_LABELS[result.from]} → {FORMAT_LABELS[result.to]}</strong>
        <span className="grow" />
        <Button onClick={onBack}>← Назад к {FORMAT_LABELS[result.from]}</Button>
        <Button variant="primary">Сделать {FORMAT_LABELS[result.to]} документом</Button>
      </div>
      <div className="conversion__panes">
        <pre className="code mono">{MOCK_PARSED_DOC.textLines.join('\n')}</pre>
        <pre className="code mono">{result.text}</pre>
      </div>
      {/* The lossy-conversion warning panel is MANDATORY (design §2.5). */}
      <div className="warns">
        <button type="button" className="warns__head" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          <Badge severity="warn">⚠ {warns.length} предупреждения преобразования</Badge>
          <span className="fine">{expanded ? 'Свернуть' : 'Развернуть'}</span>
        </button>
        {expanded && (
          <ul className="warns__list">
            {warns.map((w, i) => (
              <li key={i} className={`warns__item warns__item--${w.severity}`}>{w.message}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}
