import { useMemo, useState, type ReactNode } from 'react';
import { Callout, MockBadge } from '@blur/ui';
import type {
  CsvDelimiter,
  CsvEncoding,
  CsvEol,
  ExportPrefs,
  FormulaGuard,
  TableFormat,
  TableModel,
} from './types';
import { buildCsv, countGuarded, isFormulaRisk } from './csv-guard';
import { buildFilename } from './filename';

// THE CORE SCREEN (design §2.3). Rendered on the MOCK table for the scaffold, but
// every control is real and the "raw bytes" tab shows the ACTUAL CSV that
// utils/csv-guard would write (BOM, quoting, apostrophe-escape) — "the preview IS
// the spec" (design §6.8). What is still mocked: the table data itself, and the
// final Save (utils/file-writer is a stub). Column include/type and filename are
// NOT persisted (design §3) — they are decisions about THIS table.
//
// House rules honoured: real <table>/<select>/<input> with <label>s (not divs);
// warnings carry TEXT; zero innerHTML; focus-visible from tokens.css.

type Tab = 'table' | 'raw';

export function PreviewDialog({
  table: initialTable,
  prefs,
  onClose,
}: {
  table: TableModel;
  prefs: ExportPrefs;
  onClose?: () => void;
}) {
  const [format, setFormat] = useState<TableFormat>(prefs.defaultTableFormat);
  const [columns, setColumns] = useState(initialTable.columns);
  const [tab, setTab] = useState<Tab>('table');
  const [headersFirst, setHeadersFirst] = useState(true);

  // CSV knobs seeded from prefs (editable per-export; not persisted here).
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(prefs.csvDelimiter);
  const [encoding, setEncoding] = useState<CsvEncoding>(prefs.csvEncoding);
  const [eol, setEol] = useState<CsvEol>(prefs.csvEol);
  const [guard, setGuard] = useState<FormulaGuard>(prefs.csvFormulaGuard);
  const [sepLine, setSepLine] = useState(prefs.csvSepLine);

  const table = initialTable;
  const includedIdx = columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.included)
    .map(({ i }) => i);

  // Raw string rows (header + body), included columns only — REAL transform.
  const rows = useMemo(() => {
    const header = includedIdx.map((i) => columns[i]!.header);
    const body = table.preview.map((row) => includedIdx.map((i) => row[i]?.value ?? ''));
    return headersFirst ? [header, ...body] : body;
  }, [columns, table, headersFirst, includedIdx.join(',')]);

  const guardedCount = countGuarded(rows);

  // The ACTUAL bytes that would be written (design §6.8) — locale from the page.
  const rawText = useMemo(
    () =>
      buildCsv(rows, {
        delimiter,
        encoding,
        eol,
        formulaGuard: guard,
        sepLine,
        locale: 'ru-RU',
      }),
    [rows, delimiter, encoding, eol, guard, sepLine],
  );

  const filename = buildFilename(
    prefs.filenameTemplate,
    {
      host: 'cbr.ru',
      title: 'ЦБ РФ',
      caption: table.caption ?? '',
      date: '2026-07-14',
      time: '1200',
      index: '1',
      rows: String(table.rows),
      cols: String(includedIdx.length),
    },
    format,
    prefs.filenameTranslit,
  );

  const rawLines = rawText.split(/\r\n|\n/).slice(0, 20);

  return (
    <div className="pv" role="dialog" aria-modal="true" aria-label="Экспорт таблицы">
      <MockBadge />

      <header className="pv__head">
        <div>
          <h1 className="pv__title">Экспорт таблицы</h1>
          <p className="pv__sub mono">
            «{table.caption ?? 'без названия'}» · {table.rows} строк × {includedIdx.length} колонок · cbr.ru
          </p>
        </div>
        {onClose && (
          <button className="pv__close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        )}
      </header>

      {/* Format + filename */}
      <section className="pv__row">
        <fieldset className="pv__fmt">
          <legend>Формат</legend>
          {(['csv', 'xlsx', 'md', 'txt'] as TableFormat[]).map((f) => (
            <label key={f} className="pv__radio">
              <input
                type="radio"
                name="format"
                checked={format === f}
                onChange={() => setFormat(f)}
              />
              .{f}
              {f === 'xlsx' && <span className="pv__hint"> (безопаснее)</span>}
            </label>
          ))}
        </fieldset>
        <label className="pv__file">
          <span>Имя файла</span>
          <span className="pv__filename mono">{filename}</span>
          <span className="pv__hint">↳ шаблон: {prefs.filenameTemplate}</span>
        </label>
      </section>

      {/* Tabs: table | raw bytes */}
      <div className="pv__tabs" role="tablist" aria-label="Что попадёт в файл">
        <button
          role="tab"
          aria-selected={tab === 'table'}
          className={tab === 'table' ? 'pv__tab pv__tab--on' : 'pv__tab'}
          onClick={() => setTab('table')}
        >
          Таблица
        </button>
        <button
          role="tab"
          aria-selected={tab === 'raw'}
          className={tab === 'raw' ? 'pv__tab pv__tab--on' : 'pv__tab'}
          onClick={() => setTab('raw')}
        >
          Сырые байты
        </button>
      </div>

      {tab === 'table' ? (
        <div className="pv__tablewrap">
          <table className="pv__table">
            <caption className="pv__caption">Первые {table.preview.length} строк</caption>
            <thead>
              <tr>
                {columns.map((col, i) => (
                  <th key={i} scope="col">
                    <label className="pv__col">
                      <input
                        type="checkbox"
                        checked={col.included}
                        onChange={() =>
                          setColumns((cs) =>
                            cs.map((c, j) => (j === i ? { ...c, included: !c.included } : c)),
                          )
                        }
                        aria-label={`Включить колонку ${col.header}`}
                      />
                      {col.header}
                    </label>
                    <select
                      className="pv__type"
                      value={col.type}
                      disabled={!col.included || format !== 'xlsx'}
                      onChange={(e) =>
                        setColumns((cs) =>
                          cs.map((c, j) =>
                            j === i ? { ...c, type: e.target.value as typeof c.type } : c,
                          ),
                        )
                      }
                      aria-label={`Тип колонки ${col.header}`}
                    >
                      <option value="text">Текст</option>
                      <option value="number">Число</option>
                      <option value="date">Дата</option>
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.preview.map((row, r) => (
                <tr key={r}>
                  {columns.map((col, c) => {
                    if (!col.included) return null;
                    const cell = row[c];
                    const risk = cell ? isFormulaRisk(cell.value) : false;
                    return (
                      <td key={c} className={risk ? 'pv__cell pv__cell--risk' : 'pv__cell'}>
                        {cell?.merged && <span className="pv__mark" title="из объединённой ячейки">⇱ </span>}
                        {cell?.value ?? ''}
                        {risk && <span className="pv__mark" title="будет экранировано"> ⚠</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className="pv__more" colSpan={includedIdx.length}>
                  …ещё {Math.max(0, table.rows - table.preview.length)} строк
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="pv__raw mono" aria-label="Первые 20 строк файла">
          {rawLines.join('\n')}
        </pre>
      )}

      {/* Formula guard + merged-cell notices — always shown, never colour-only */}
      {guardedCount > 0 && (
        <Callout tone="warn" title={`⚠ ${guardedCount} ячейка(и) начинается с «=» — будет записана как текст`}>
          Защита от исполнения формул (CSV-инъекция). В .xlsx этой проблемы нет.
        </Callout>
      )}
      {table.hasMergedCells > 0 && (
        <Callout tone="warn" title={`⚠ Объединённые ячейки (${table.hasMergedCells})`}>
          Значение продублировано в каждую позицию. Само объединение в файл не переносится.
        </Callout>
      )}

      {/* Per-format file options */}
      <details className="pv__opts" open>
        <summary>Параметры файла</summary>
        {format === 'csv' ? (
          <div className="pv__optsbody">
            <Field label="Разделитель">
              <select value={delimiter} onChange={(e) => setDelimiter(e.target.value as CsvDelimiter)}>
                <option value="auto">Авто (по локали)</option>
                <option value=";">; (Excel, ру)</option>
                <option value=",">,</option>
                <option value="\t">Tab</option>
                <option value="|">|</option>
              </select>
            </Field>
            <Field label="Кодировка">
              <select value={encoding} onChange={(e) => setEncoding(e.target.value as CsvEncoding)}>
                <option value="utf8-bom">UTF-8 + BOM</option>
                <option value="utf8">UTF-8 без BOM</option>
              </select>
            </Field>
            <Field label="Конец строки">
              <select value={eol} onChange={(e) => setEol(e.target.value as CsvEol)}>
                <option value="crlf">CRLF (Windows/Excel)</option>
                <option value="lf">LF</option>
              </select>
            </Field>
            <Field label="Опасные ячейки">
              <select value={guard} onChange={(e) => setGuard(e.target.value as FormulaGuard)}>
                <option value="escape">Экранировать</option>
                <option value="keep">Оставить как есть</option>
                <option value="warn">Только предупредить</option>
              </select>
            </Field>
            <label className="pv__check">
              <input type="checkbox" checked={sepLine} onChange={() => setSepLine((v) => !v)} />
              Добавить строку «sep=» (помогает Excel, ломает pandas/Sheets)
            </label>
          </div>
        ) : (
          <div className="pv__optsbody">
            <fieldset className="pv__fmt">
              <legend>Первая строка</legend>
              <label className="pv__radio">
                <input type="radio" checked={headersFirst} onChange={() => setHeadersFirst(true)} />
                заголовки
              </label>
              <label className="pv__radio">
                <input type="radio" checked={!headersFirst} onChange={() => setHeadersFirst(false)} />
                обычные данные
              </label>
            </fieldset>
          </div>
        )}
      </details>

      <footer className="pv__foot">
        <span className="pv__summary mono">
          {includedIdx.length} колонок → {filename}
        </span>
        <div className="pv__actions">
          {onClose && (
            <button className="pv__btn" onClick={onClose}>
              Отмена
            </button>
          )}
          <button className="pv__btn pv__btn--primary" onClick={() => {}} disabled aria-disabled>
            Сохранить файл (демо)
          </button>
        </div>
      </footer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="pv__field">
      <span>{label}</span>
      {children}
    </label>
  );
}
