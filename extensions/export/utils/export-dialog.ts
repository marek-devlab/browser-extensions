// The export dialog — the core screen (design §2.3), mounted ON THE PAGE inside
// the closed shadow root, because that is where the bytes are born (design §0).
//
// PRODUCT RULE (design §6.8): **the preview IS the specification.** If the preview
// shows `78.42`, the file contains `78.42`. The "сырые байты" tab shows the ACTUAL
// output of `buildCsv` — BOM, quotes, apostrophe-escape and all. A divergence
// between preview and file is a release blocker, not a cosmetic bug.
//
// 🔴 Zero innerHTML: every string from the page enters via `textContent`.

import {
  BOM,
  MIME,
  buildCsv,
  buildCsvParts,
  countGuarded,
  isFormulaRisk,
  resolveDelimiter,
  type CsvOptions,
} from './csv-guard';
import { buildFilename } from './filename';
import { saveBlob, saveTextParts, type SaveResult } from './file-writer';
import { buildMatrix, headersFrom, parseLocaleNumber, pageDecimalSeparator } from './table-extract';
import {
  button,
  destroyOverlay,
  el,
  getHost,
  showToast,
  trapKeys,
  type OverlayTheme,
} from './overlay';
import {
  awaitXlsxWriter,
  sanitizeSheetName,
  uniqueSheetNames,
  type XlsxCell,
  type XlsxSheet,
} from './xlsx-bridge';
import type { BgRequest, BgResponse } from './messages';
import {
  CELLS_WARN,
  CELLS_XLSX_MAX,
  PREVIEW_ROWS,
  XLSX_MAX_ROWS,
  type Cell,
  type ExportPrefs,
  type ExtractOptions,
  type TableColumn,
  type TableFormat,
  type TableModel,
} from './types';

export interface DialogDeps {
  prefs: ExportPrefs;
  ask: (req: BgRequest) => Promise<BgResponse>;
  extractOptions: ExtractOptions;
}

interface Picked {
  model: TableModel;
  element: HTMLTableElement;
}

/* ====================================================================== *
 * Matrix → rows of strings (the single source of truth for every format)
 * ====================================================================== */

function rowsFromMatrix(
  matrix: Cell[][],
  headerRows: number,
  columns: TableColumn[],
  headersFirst: boolean,
): string[][] {
  const keep = columns.map((c, i) => ({ c, i })).filter(({ c }) => c.included).map(({ i }) => i);
  const body = matrix.slice(headerRows).map((row) => keep.map((i) => row[i]?.value ?? ''));
  if (!headersFirst) return body;
  return [keep.map((i) => columns[i]!.header), ...body];
}

/** GFM table (design §6.3: the caption becomes a bold line ABOVE the table). */
function rowsToMarkdown(rows: string[][], caption: string | null): string {
  if (rows.length === 0) return '';
  // Page text is untrusted: a cell reading `**x**` or `` `code` `` must render as
  // literal text, not inline Markdown. Escape the same set as selection-md's
  // escapeMd (which includes `|`), then map hard newlines to <br> for the table.
  const esc = (s: string): string =>
    s.replace(/([\\`*_[\]#>|])/g, '\\$1').replace(/\n/g, '<br>');
  const head = rows[0]!.map(esc);
  const lines = [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${r.map(esc).join(' | ')} |`),
  ];
  return (caption ? `**${caption}**\n\n` : '') + lines.join('\n') + '\n';
}

/** `.txt` is TSV (design §2.3) — tabs inside a cell would break it, so they go. */
function rowsToTsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\r\n');
}

/* ====================================================================== *
 * The dialog
 * ====================================================================== */

export async function openExportDialog(picked: Picked[], deps: DialogDeps): Promise<void> {
  const { prefs } = deps;
  const multi = picked.length > 1;
  const primary = picked[0]!;

  const h = getHost(prefs.theme as OverlayTheme);
  h.ui.replaceChildren();

  let format: TableFormat = prefs.defaultTableFormat;
  // 🔴 Auto-detected, not assumed: a table with no <thead>/<th> header row has NO
  // headers, and writing its first data row as a header would silently eat a row
  // (design §6.2 rule 4).
  let headersFirst = primary.model.hasHeaders;
  let columns: TableColumn[] = primary.model.columns.map((c) => ({ ...c }));
  let tab: 'table' | 'raw' = 'table';
  let filenameBase = '';
  let guard = prefs.csvFormulaGuard;
  let delimiter = prefs.csvDelimiter;
  let encoding = prefs.csvEncoding;
  let eol = prefs.csvEol;
  let sepLine = prefs.csvSepLine;
  let acknowledgedUnsafe = false;
  let busy = false;

  const locale = document.documentElement.lang || navigator.language || 'ru-RU';

  const totalCells = picked.reduce((n, p) => n + p.model.cells, 0);

  const panel = el('div', 'bx-panel bx-panel--center');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Экспорт таблицы');
  h.ui.append(panel);

  const release = trapKeys(panel, { onEscape: close });

  function close(): void {
    release();
    destroyOverlay();
  }

  function csvOpts(): CsvOptions {
    return { delimiter, encoding, eol, formulaGuard: guard, sepLine, locale };
  }

  /** Preview rows only — never the full matrix (design §5.3: rendering 60 000
   *  cells would kill the tab). */
  function previewRows(): string[][] {
    const keep = columns.map((c, i) => ({ c, i })).filter(({ c }) => c.included).map(({ i }) => i);
    const body = primary.model.preview
      .slice(0, PREVIEW_ROWS)
      .map((row) => keep.map((i) => row[i]?.value ?? ''));
    return headersFirst ? [keep.map((i) => columns[i]!.header), ...body] : body;
  }

  function currentFilename(): string {
    const now = new Date();
    const auto = buildFilename(
      prefs.filenameTemplate,
      {
        host: location.hostname,
        title: document.title,
        caption: primary.model.caption ?? '',
        date: now.toISOString().slice(0, 10),
        time: `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`,
        index: '1',
        rows: String(primary.model.rows),
        cols: String(columns.filter((c) => c.included).length),
      },
      format,
      prefs.filenameTranslit,
    );
    if (!filenameBase) return auto;
    // 🔴 The extension always comes from the FORMAT, never from user input (§8.2).
    return buildFilename('{caption}', { ...EMPTY_FIELDS, caption: filenameBase }, format, prefs.filenameTranslit);
  }

  /* -------------------------------------------------------------- */

  function render(): void {
    panel.replaceChildren();

    /* --- header --- */
    const head = el('div');
    head.append(el('h2', 'bx-h', multi ? `Экспорт: ${picked.length} таблицы` : 'Экспорт таблицы'));
    head.append(
      el(
        'p',
        'bx-sub',
        `${primary.model.caption ? `«${primary.model.caption}» · ` : ''}${primary.model.rows} строк × ${
          columns.filter((c) => c.included).length
        } колонок · ${location.hostname}`,
      ),
    );
    panel.append(head);

    /* --- format --- */
    const fmt = el('div', 'bx-field');
    fmt.append(el('span', undefined, 'Формат'));
    const fmtGroup = el('div', 'bx-row');
    fmtGroup.setAttribute('role', 'radiogroup');
    fmtGroup.setAttribute('aria-label', 'Формат файла');
    for (const f of ['xlsx', 'csv', 'md', 'txt'] as TableFormat[]) {
      const lab = el('label', 'bx-check');
      const input = el('input');
      input.type = 'radio';
      input.name = 'bx-format';
      input.checked = format === f;
      input.addEventListener('change', () => {
        format = f;
        render();
      });
      lab.append(input, el('span', undefined, `.${f}${f === 'xlsx' ? ' (рекомендуется)' : ''}`));
      fmtGroup.append(lab);
    }
    fmt.append(fmtGroup);
    panel.append(fmt);

    // 🔴 Say WHY xlsx is the default — it is a safety property, not a feature.
    if (format === 'xlsx') {
      panel.append(
        el(
          'p',
          'bx-note bx-note--info',
          'В .xlsx формула — отдельный элемент файла, поэтому текстовая ячейка никогда не станет формулой. И типы чисел сохраняются точно.',
        ),
      );
    }
    if (format === 'csv') {
      panel.append(
        el(
          'p',
          'bx-note bx-note--info',
          'В .csv типов нет: Excel заново решит сам и может превратить «05.06» в дату, а «0012345» в «12345». Нужна точность — берите .xlsx.',
        ),
      );
    }

    /* --- filename --- */
    const nameField = el('label', 'bx-field');
    nameField.append(el('span', undefined, 'Имя файла'));
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.value = filenameBase || currentFilename().replace(/\.[^.]+$/, '');
    nameInput.setAttribute('data-autofocus', '');
    nameInput.addEventListener('input', () => {
      filenameBase = nameInput.value;
      updateSummary();
    });
    nameField.append(nameInput);
    panel.append(nameField);

    /* --- notices (always TEXT, never colour alone — design §10.1) --- */
    const rows = previewRows();
    const guarded = countGuarded(rows);
    if (guarded > 0 && format === 'csv') {
      panel.append(
        el(
          'p',
          'bx-note bx-note--warn',
          guard === 'escape'
            ? `⚠ ${guarded} ячейка(и) начинается с «=», «+», «−» или «@» — будет записана как текст (защита от исполнения формул в Excel). Валидные числа вроде «−5» не трогаем.`
            : guard === 'warn'
              ? `⚠ ${guarded} потенциально опасная ячейка. Режим «только предупредить»: подтвердите сохранение внизу.`
              : `⚠ ${guarded} ячейка(и) может быть исполнена Excel как формула. Вы выбрали «оставить как есть».`,
        ),
      );
    }
    if (primary.model.hasMergedCells > 0) {
      panel.append(
        el(
          'p',
          'bx-note bx-note--warn',
          `⚠ Объединённые ячейки (${primary.model.hasMergedCells}): значение ${
            prefs.mergedCells === 'duplicate' ? 'продублировано в каждую позицию' : 'оставлено только в первой'
          }. Само объединение в файл не переносится — только значения.`,
        ),
      );
    }
    if (primary.model.hasNestedTables > 0) {
      panel.append(
        el(
          'p',
          'bx-note bx-note--warn',
          `⚠ Вложенные таблицы (${primary.model.hasNestedTables}): в плоский файл они не помещаются. Их содержимое сплющено в текст ячейки. Нужна именно вложенная — выберите её отдельно в списке таблиц.`,
        ),
      );
    }
    if (primary.model.virtualized) {
      panel.append(
        el(
          'p',
          'bx-note bx-note--warn',
          `⚠ Похоже, таблица подгружает строки при прокрутке. Сейчас в странице ${primary.model.rows} строк — возможно, это не все. Прокрутите таблицу до конца и повторите.`,
        ),
      );
    }
    if (totalCells > CELLS_WARN && totalCells <= CELLS_XLSX_MAX) {
      panel.append(
        el(
          'p',
          'bx-note bx-note--warn',
          `⚠ Большая таблица (${totalCells.toLocaleString('ru-RU')} ячеек). Сборка займёт несколько секунд; превью показывает первые ${PREVIEW_ROWS} строк.`,
        ),
      );
    }
    const xlsxRefused =
      format === 'xlsx' && (totalCells > CELLS_XLSX_MAX || primary.model.rows > XLSX_MAX_ROWS);
    if (xlsxRefused) {
      panel.append(
        el(
          'p',
          'bx-note bx-note--err',
          primary.model.rows > XLSX_MAX_ROWS
            ? `🔴 ${primary.model.rows.toLocaleString('ru-RU')} строк — это больше предела самого формата Excel (${XLSX_MAX_ROWS.toLocaleString('ru-RU')}). Это ограничение Excel, не наше. Экспортируйте как .csv.`
            : `🔴 Слишком большая для .xlsx (${totalCells.toLocaleString('ru-RU')} ячеек > ${CELLS_XLSX_MAX.toLocaleString('ru-RU')}): книга целиком держится в памяти и вкладка может упасть. Экспортируйте как .csv — он собирается по частям.`,
        ),
      );
    }

    /* --- tabs --- */
    const tabs = el('div', 'bx-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [id, label] of [
      ['table', 'Таблица'],
      ['raw', format === 'csv' ? 'Сырые байты' : 'Текст файла'],
    ] as const) {
      const b = button(label, () => {
        tab = id;
        render();
      }, 'bx-tab');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(tab === id));
      tabs.append(b);
    }
    panel.append(tabs);

    if (tab === 'table') panel.append(buildPreviewTable(rows));
    else panel.append(buildRawPreview(rows));

    /* --- per-format file options --- */
    panel.append(buildOptions());

    /* --- footer --- */
    const foot = el('div', 'bx-foot');
    const summary = el('span', 'bx-summary');
    summary.id = 'bx-summary';
    foot.append(summary);
    foot.append(button('Отмена', close, 'bx-btn--ghost'));
    const save = button(
      busy ? 'Собираю…' : multi ? 'Сохранить файл' : 'Сохранить файл',
      () => void doSave(),
      'bx-btn--primary',
    );
    save.disabled = busy || xlsxRefused || (guard === 'warn' && guarded > 0 && !acknowledgedUnsafe);
    foot.append(save);
    panel.append(foot);

    if (guard === 'warn' && guarded > 0 && !acknowledgedUnsafe) {
      const ack = el('label', 'bx-check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => {
        acknowledgedUnsafe = cb.checked;
        render();
      });
      ack.append(cb, el('span', undefined, 'Я понимаю: файл может исполнить формулу при открытии в Excel'));
      panel.append(ack);
    }

    updateSummary();
    panel.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }

  function updateSummary(): void {
    const s = panel.querySelector('#bx-summary');
    if (!s) return;
    const cols = columns.filter((c) => c.included).length;
    s.textContent = `${primary.model.rows} строк × ${cols} колонок → ${currentFilename()}`;
  }

  /* --- preview table (a REAL <table> with scope, design §10.1) --- */
  function buildPreviewTable(rows: string[][]): HTMLElement {
    const wrap = el('div', 'bx-tablewrap');
    const table = el('table', 'bx-table');
    const cap = el('caption', undefined, `Что попадёт в файл — первые ${Math.max(0, rows.length - (headersFirst ? 1 : 0))} строк из ${primary.model.rows}`);
    table.append(cap);

    const thead = el('thead');
    const htr = el('tr');
    columns.forEach((col, i) => {
      const th = el('th');
      th.scope = 'col';
      const lab = el('label', 'bx-check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = col.included;
      cb.setAttribute('aria-label', `Включить колонку ${col.header}`);
      cb.addEventListener('change', () => {
        columns = columns.map((c, j) => (j === i ? { ...c, included: cb.checked } : c));
        render();
      });
      lab.append(cb, el('span', undefined, col.header));
      th.append(lab);

      // Column type is an .xlsx concept only — CSV has no types (design §6.5).
      const sel = el('select');
      sel.setAttribute('aria-label', `Тип колонки ${col.header}`);
      sel.disabled = format !== 'xlsx' || !col.included;
      for (const [v, l] of [
        ['text', 'Текст'],
        ['number', 'Число'],
      ] as const) {
        const o = el('option', undefined, l);
        o.value = v;
        if (col.type === v) o.selected = true;
        sel.append(o);
      }
      sel.addEventListener('change', () => {
        columns = columns.map((c, j) =>
          j === i ? { ...c, type: sel.value as TableColumn['type'] } : c,
        );
      });
      th.append(sel);
      htr.append(th);
    });
    thead.append(htr);
    table.append(thead);

    const tbody = el('tbody');
    const body = headersFirst ? rows.slice(1) : rows;
    const keepIdx = columns.map((c, i) => ({ c, i })).filter(({ c }) => c.included).map(({ i }) => i);
    body.forEach((row, r) => {
      const tr = el('tr');
      row.forEach((value, c) => {
        const risk = format === 'csv' && guard !== 'keep' && isFormulaRisk(value);
        const td = el('td', risk ? 'risk' : undefined);
        const srcCell = primary.model.preview[r]?.[keepIdx[c] ?? c];
        const marks = `${srcCell?.merged ? '⇱ ' : ''}${srcCell?.nested ? '⊞ ' : ''}`;
        td.textContent = `${marks}${value}${risk ? ' ⚠' : ''}`;
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(tbody);
    wrap.append(table);
    return wrap;
  }

  /** The bytes, honestly (design §6.8 / §2.3). Shows the BOM as `<BOM>` so it is
   *  visible rather than invisible. */
  function buildRawPreview(rows: string[][]): HTMLElement {
    const text =
      format === 'csv'
        ? buildCsv(rows.slice(0, PREVIEW_ROWS + 1), csvOpts())
        : format === 'md'
          ? rowsToMarkdown(rows.slice(0, PREVIEW_ROWS + 1), primary.model.caption)
          : format === 'txt'
            ? rowsToTsv(rows.slice(0, PREVIEW_ROWS + 1))
            : 'Формат .xlsx — двоичный. Ячейки записываются с типами: текст остаётся текстом, формулой стать не может.';
    const pre = el('pre', 'bx-raw', text.replace(BOM, '<BOM>').split(/\r?\n/).slice(0, PREVIEW_ROWS).join('\n'));
    pre.setAttribute('aria-label', 'Первые строки файла');
    return pre;
  }

  function buildOptions(): HTMLElement {
    const box = el('details', 'bx-opts');
    box.open = true;
    box.append(el('summary', undefined, 'Параметры файла'));

    if (format === 'csv') {
      box.append(
        selectField('Разделитель', delimiter, [
          ['auto', `Авто (${resolveDelimiter('auto', locale)})`],
          [';', '; (Excel, ру-локаль)'],
          [',', ','],
          ['\t', 'Tab'],
          ['|', '|'],
        ], (v) => {
          delimiter = v as typeof delimiter;
          render();
        }),
      );
      box.append(
        selectField('Кодировка', encoding, [
          ['utf8-bom', 'UTF-8 + BOM'],
          ['utf8', 'UTF-8 без BOM'],
        ], (v) => {
          encoding = v as typeof encoding;
          render();
        }),
      );
      box.append(
        el(
          'p',
          'bx-note bx-note--info',
          'Без BOM Excel покажет кириллицу как «ÐšÑƒÑ€Ñ». Windows-1251 не предлагаем: браузер умеет кодировать только в UTF-8.',
        ),
      );
      box.append(
        selectField('Конец строки', eol, [
          ['crlf', 'CRLF (Windows/Excel)'],
          ['lf', 'LF'],
        ], (v) => {
          eol = v as typeof eol;
          render();
        }),
      );
      box.append(
        selectField('Опасные ячейки', guard, [
          ['escape', 'Экранировать (рекомендуется)'],
          ['keep', 'Оставить как есть'],
          ['warn', 'Только предупредить'],
        ], (v) => {
          guard = v as typeof guard;
          acknowledgedUnsafe = false;
          render();
        }),
      );
      const sep = el('label', 'bx-check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = sepLine;
      cb.addEventListener('change', () => {
        sepLine = cb.checked;
        render();
      });
      sep.append(cb, el('span', undefined, 'Добавить строку «sep=» — помогает Excel, ломает pandas и Google Sheets'));
      box.append(sep);
      if (primary.model.caption) {
        box.append(
          el(
            'p',
            'bx-note bx-note--info',
            `Название «${primary.model.caption}» в .csv не попадёт — CSV не умеет заголовки над шапкой (любой парсер на этом ломается). Оно попадёт в имя файла.`,
          ),
        );
      }
    } else {
      const hdr = el('div', 'bx-field');
      hdr.append(el('span', undefined, 'Первая строка'));
      const grp = el('div', 'bx-row');
      for (const [v, l] of [
        [true, 'заголовки'],
        [false, 'обычные данные'],
      ] as const) {
        const lab = el('label', 'bx-check');
        const r = el('input');
        r.type = 'radio';
        r.name = 'bx-headers';
        r.checked = headersFirst === v;
        r.addEventListener('change', () => {
          headersFirst = v;
          render();
        });
        lab.append(r, el('span', undefined, l));
        grp.append(lab);
      }
      hdr.append(grp);
      box.append(hdr);
    }
    return box;
  }

  function selectField(
    label: string,
    value: string,
    options: readonly (readonly [string, string])[],
    onChange: (v: string) => void,
  ): HTMLElement {
    const field = el('label', 'bx-field');
    field.append(el('span', undefined, label));
    const sel = el('select');
    for (const [v, l] of options) {
      const o = el('option', undefined, l);
      o.value = v;
      if (v === value) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    field.append(sel);
    return field;
  }

  /* ================================================================== *
   * Save
   * ================================================================== */

  async function doSave(): Promise<void> {
    if (busy) return;
    busy = true;
    render();
    const filename = currentFilename();

    try {
      const sheets: XlsxSheet[] = [];
      const allRows: string[][][] = [];

      // Full matrices are built ONLY now — chunked, so a 60k-cell table does not
      // freeze the page (design §9.1), and abortable on pagehide (§5.11).
      for (const p of picked) {
        const matrix = await buildMatrix(p.element, deps.extractOptions);
        const width = matrix.cells[0]?.length ?? 0;
        let cols: TableColumn[];
        if (p === primary) {
          // `columns` was derived from the PREVIEW matrix, which only rendered the
          // first ~PREVIEW_ROWS. A table that grows WIDER below that window would
          // otherwise have its extra columns silently dropped here — append the
          // missing ones as default (included) columns so no data is lost.
          const extra = headersFrom(matrix, width)
            .slice(columns.length)
            .map<TableColumn>((header) => ({ header, type: 'text', included: true }));
          cols = extra.length ? [...columns, ...extra] : columns;
        } else {
          cols = headersFrom(matrix, width).map<TableColumn>((header) => ({
            header,
            type: 'text',
            included: true,
          }));
        }
        const rows = rowsFromMatrix(matrix.cells, matrix.headerRows, cols, headersFirst);
        allRows.push(rows);
        sheets.push({
          name: sanitizeSheetName(p.model.caption ?? '', `Таблица ${sheets.length + 1}`),
          rows: toXlsxRows(rows, cols, headersFirst),
        });
      }

      let result: SaveResult;

      if (format === 'xlsx') {
        // Second injection, and ONLY now (design §0).
        const injected = await deps.ask({ type: 'injectXlsx' });
        if (!injected.ok) throw new Error('Не удалось загрузить модуль .xlsx: ' + injected.error);
        const writer = await awaitXlsxWriter();
        if (!writer) {
          throw new Error(
            'Модуль .xlsx не загрузился (возможно, страница ограничивает выполнение скриптов). Экспортируйте как .csv.',
          );
        }
        const named = uniqueSheetNames(sheets.map((s) => s.name));
        const blob = await writer.write(sheets.map((s, i) => ({ ...s, name: named[i]! })));
        result = saveBlob(blob, filename);
      } else if (format === 'csv') {
        if (multi) {
          // ⚠️ CSV has no sheets: N tables → N files, and the browser WILL ask
          // about multiple downloads. We say so before, not after (design §4.4).
          let last: SaveResult = { ok: false, reason: 'blocked' };
          for (let i = 0; i < allRows.length; i++) {
            const parts = buildCsvParts(allRows[i]!, csvOpts());
            last = saveTextParts(parts, filename.replace(/\.csv$/, `-${i + 1}.csv`), MIME.csv!);
            await new Promise((r) => setTimeout(r, 250));
          }
          result = last;
        } else {
          result = saveTextParts(buildCsvParts(allRows[0]!, csvOpts()), filename, MIME.csv!);
        }
      } else if (format === 'md') {
        const text = allRows
          .map((rows, i) => rowsToMarkdown(rows, picked[i]!.model.caption))
          .join('\n\n');
        result = saveTextParts([text], filename, MIME.md!);
      } else {
        result = saveTextParts([allRows.map(rowsToTsv).join('\r\n\r\n')], filename, MIME.txt!);
      }

      if (result.ok) {
        close();
        // 🔴 A FACT, not a celebration (design §7.8): without the `downloads`
        // permission we genuinely do not know where the file landed, or whether the
        // page's CSP dropped it. So we offer the escape hatch every time.
        showToast(`Сохранение запущено: ${result.filename}`, {
          theme: prefs.theme as OverlayTheme,
          actions: [
            {
              label: 'Файл не появился?',
              onClick: () => {
                void fallbackSave(filename);
              },
            },
          ],
        });
      } else {
        busy = false;
        render();
        showToast(
          `Не удалось сохранить файл (${result.reason}). Эта страница может запрещать загрузки.`,
          {
            tone: 'error',
            theme: prefs.theme as OverlayTheme,
            actions: [
              { label: 'Сохранить через вкладку расширения', onClick: () => void fallbackSave(filename) },
            ],
          },
        );
      }
    } catch (e) {
      busy = false;
      render();
      // Every export path is try/caught and reports a REAL message (brief).
      showToast(e instanceof Error ? e.message : String(e), {
        tone: 'error',
        theme: prefs.theme as OverlayTheme,
      });
    }
  }

  /**
   * §5.5 — the page forbids downloads (CSP `sandbox` without `allow-downloads`),
   * and there is no reliable way to detect that from here (design §13.4). So the
   * escape hatch is always offered: stash the bytes in `storage.session` and finish
   * the save on OUR OWN extension page, where OUR CSP applies.
   */
  async function fallbackSave(filename: string): Promise<void> {
    try {
      const matrix = await buildMatrix(primary.element, deps.extractOptions);
      const rows = rowsFromMatrix(matrix.cells, matrix.headerRows, columns, headersFirst);
      const isCsv = format === 'csv' || format === 'xlsx';
      const name = isCsv ? filename.replace(/\.[^.]+$/, '.csv') : filename;
      const text =
        format === 'md'
          ? rowsToMarkdown(rows, primary.model.caption)
          : format === 'txt'
            ? rowsToTsv(rows)
            : buildCsv(rows, csvOpts());
      const mime = format === 'md' ? MIME.md! : format === 'txt' ? MIME.txt! : MIME.csv!;
      if (format === 'xlsx') {
        showToast(
          '.xlsx через вкладку расширения не пересобрать — сохраняю как .csv. Данные те же, типы Excel определит сам.',
          { tone: 'warn', theme: prefs.theme as OverlayTheme },
        );
      }
      const res = await deps.ask({ type: 'stashAndSave', filename: name, text, mime });
      if (!res.ok) {
        showToast(`Не получилось: ${res.error}`, { tone: 'error', theme: prefs.theme as OverlayTheme });
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), {
        tone: 'error',
        theme: prefs.theme as OverlayTheme,
      });
    }
  }

  /** String rows → TYPED xlsx cells. Numbers only where the user (or the
   *  conservative auto-detect) said "number", and only when they really parse. */
  function toXlsxRows(rows: string[][], cols: TableColumn[], hasHeader: boolean): XlsxCell[][] {
    const dec = pageDecimalSeparator(document);
    const keep = cols.filter((c) => c.included);
    return rows.map((row, r) =>
      row.map<XlsxCell>((value, c) => {
        if (hasHeader && r === 0) return { value, type: 'text' };
        if (!prefs.parseNumbers || keep[c]?.type !== 'number') return { value, type: 'text' };
        const n = parseLocaleNumber(value, dec);
        return n === null ? { value, type: 'text' } : { value: n, type: 'number' };
      }),
    );
  }

  render();
}

const EMPTY_FIELDS = {
  host: '',
  title: '',
  caption: '',
  date: '',
  time: '',
  index: '',
  rows: '',
  cols: '',
};
