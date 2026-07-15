import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { Callout, ThemeToggle } from '@blur/ui';
import { DEFAULT_PREFS, prefsItem } from '../../utils/storage';
import type { ExportPrefs } from '../../utils/types';
import { useExportTheme } from '../../utils/theme';
import { buildFilename } from '../../utils/filename';

// Options — the persisted defaults (design §2.5 / §3). Persistence is REAL: every
// control writes through `prefsItem` (sync storage). Column include/type and the
// per-export filename are NOT here — they are per-table decisions (design §3).
//
// The filename example updates live through the REAL sanitizer (utils/filename),
// so the "reserved names / RTL / traversal are neutralized" claim is demonstrable.

type TabId = 'tables' | 'text' | 'filenames' | 'about';

function usePrefs(): {
  prefs: ExportPrefs | null;
  update: (patch: Partial<ExportPrefs>) => void;
} {
  const [prefs, setPrefs] = useState<ExportPrefs | null>(null);
  useEffect(() => {
    void prefsItem.getValue().then(setPrefs);
  }, []);
  const update = useCallback((patch: Partial<ExportPrefs>) => {
    setPrefs((prev) => {
      const next = { ...(prev ?? DEFAULT_PREFS), ...patch };
      void prefsItem.setValue(next);
      return next;
    });
  }, []);
  return { prefs, update };
}

export function App() {
  const { theme, setTheme } = useExportTheme();
  const { prefs, update } = usePrefs();
  const [tab, setTab] = useState<TabId>('tables');
  const [downloadsGranted, setDownloadsGranted] = useState<boolean | null>(null);

  useEffect(() => {
    void browser.permissions
      ?.contains({ permissions: ['downloads'] })
      .then(setDownloadsGranted);
  }, []);

  if (!prefs) return <div className="opt" />;

  // `permissions.request` MUST be called from an extension page inside a user
  // gesture — a content script cannot do it. That is why the engine's honest
  // refusal (design §5.9) links HERE instead of prompting on the page.
  const requestDownloads = async () => {
    if (downloadsGranted) {
      await browser.permissions?.remove({ permissions: ['downloads'] });
      setDownloadsGranted(false);
      return;
    }
    const granted = await browser.permissions?.request({ permissions: ['downloads'] });
    setDownloadsGranted(!!granted);
  };

  return (
    <div className="opt">
      <header className="opt__head">
        <h1>Экспорт контента — настройки</h1>
        <ThemeToggle theme={theme ?? 'auto'} onChange={setTheme} />
      </header>

      <nav className="opt__tabs" role="tablist">
        {(
          [
            ['tables', 'Таблицы'],
            ['text', 'Текст'],
            ['filenames', 'Имена файлов'],
            ['about', 'О расширении'],
          ] as [TabId, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'opt__tab opt__tab--on' : 'opt__tab'}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'tables' && (
        <>
          <Group title="Формат по умолчанию">
            <RadioRow
              legend="Таблицы"
              value={prefs.defaultTableFormat}
              options={[
                ['xlsx', '.xlsx'],
                ['csv', '.csv'],
                ['md', '.md'],
              ]}
              onChange={(v) => update({ defaultTableFormat: v as ExportPrefs['defaultTableFormat'] })}
            />
            <Callout tone="info">
              .xlsx безопаснее: Excel не исполняет формулы из текстовых ячеек, а типы
              чисел и дат сохраняются точно.
            </Callout>
          </Group>

          <Group title="CSV">
            <SelectRow
              label="Разделитель"
              value={prefs.csvDelimiter}
              options={[
                ['auto', 'Авто (по локали)'],
                [';', '; (Excel, ру)'],
                [',', ','],
                ['\t', 'Tab'],
                ['|', '|'],
              ]}
              onChange={(v) => update({ csvDelimiter: v as ExportPrefs['csvDelimiter'] })}
            />
            <SelectRow
              label="Кодировка"
              value={prefs.csvEncoding}
              options={[
                ['utf8-bom', 'UTF-8 + BOM'],
                ['utf8', 'UTF-8 без BOM'],
              ]}
              onChange={(v) => update({ csvEncoding: v as ExportPrefs['csvEncoding'] })}
            />
            <SelectRow
              label="Конец строки"
              value={prefs.csvEol}
              options={[
                ['crlf', 'CRLF'],
                ['lf', 'LF'],
              ]}
              onChange={(v) => update({ csvEol: v as ExportPrefs['csvEol'] })}
            />
            <SelectRow
              label="Опасные ячейки"
              value={prefs.csvFormulaGuard}
              options={[
                ['escape', 'Экранировать (рекомендуется)'],
                ['keep', 'Оставить как есть'],
                ['warn', 'Только предупредить'],
              ]}
              onChange={(v) => update({ csvFormulaGuard: v as ExportPrefs['csvFormulaGuard'] })}
            />
            <CheckRow
              label="Добавлять строку «sep=»"
              checked={prefs.csvSepLine}
              onChange={(v) => update({ csvSepLine: v })}
            />
          </Group>

          <Group title="Семантика таблицы">
            <RadioRow
              legend="Объединённые ячейки"
              value={prefs.mergedCells}
              options={[
                ['duplicate', 'Дублировать значение'],
                ['empty', 'Оставить пустыми'],
              ]}
              onChange={(v) => update({ mergedCells: v as ExportPrefs['mergedCells'] })}
            />
            <SelectRow
              label="Ссылки в ячейках"
              value={prefs.linksInCells}
              options={[
                ['text', 'Только текст'],
                ['text-url', 'Текст (URL)'],
                ['url', 'Только URL'],
              ]}
              onChange={(v) => update({ linksInCells: v as ExportPrefs['linksInCells'] })}
            />
            <CheckRow
              label="Распознавать «1 234,56» как число"
              checked={prefs.parseNumbers}
              onChange={(v) => update({ parseNumbers: v })}
            />
            <Callout tone="info">
              Неоднозначные числа («1,234» — это 1234 или 1.234?) остаются текстом. Ошибиться
              здесь дороже, чем не угадать: молча испорченный отчёт хуже, чем ячейка-текст.
            </Callout>
            <CheckRow
              label="Распознавать даты (05.06 → 5 июня)"
              checked={prefs.parseDates}
              onChange={(v) => update({ parseDates: v })}
            />
            <CheckRow
              label="Только видимые строки (пропускать display:none)"
              checked={prefs.visibleRowsOnly}
              onChange={(v) => update({ visibleRowsOnly: v })}
            />
            <CheckRow
              label="Всегда показывать превью перед сохранением"
              checked={prefs.alwaysPreview}
              onChange={(v) => update({ alwaysPreview: v })}
            />
          </Group>
        </>
      )}

      {tab === 'text' && (
        <Group title="Текст">
          <RadioRow
            legend="Формат текста по умолчанию"
            value={prefs.defaultTextFormat}
            options={[
              ['md', '.md'],
              ['txt', '.txt'],
            ]}
            onChange={(v) => update({ defaultTextFormat: v as ExportPrefs['defaultTextFormat'] })}
          />
          <Callout tone="info">
            Порядок пунктов меню это не меняет — оба формата всегда видны.
          </Callout>
        </Group>
      )}

      {tab === 'filenames' && (
        <Group title="Шаблон имени">
          <label className="opt__field opt__field--stack">
            <span>Шаблон</span>
            <input
              type="text"
              value={prefs.filenameTemplate}
              onChange={(e) => update({ filenameTemplate: e.target.value })}
            />
          </label>
          <p className="opt__hint">
            Доступно: {'{host} {title} {caption} {date} {time} {index} {rows} {cols}'}
          </p>
          <p className="opt__hint mono">
            Пример:{' '}
            {buildFilename(
              prefs.filenameTemplate,
              {
                host: 'cbr.ru',
                title: 'ЦБ РФ',
                caption: 'Курсы валют',
                date: '2026-07-14',
                time: '1200',
                index: '1',
                rows: '12',
                cols: '4',
              },
              'xlsx',
              prefs.filenameTranslit,
            )}
          </p>
          <CheckRow
            label="Транслитерировать кириллицу в имени файла"
            checked={prefs.filenameTranslit}
            onChange={(v) => update({ filenameTranslit: v })}
          />
          <Callout tone="warn" title="Безопасность имён">
            Запрещённые символы, RTL-подмена и имена вроде CON/PRN обезвреживаются
            автоматически (utils/filename — реальная логика).
          </Callout>
        </Group>
      )}

      {tab === 'about' && (
        <>
          <Group title="Как это работает">
            <p className="opt__hint">
              Выделите текст → правая кнопка → «Сохранить контент страницы». Или откройте
              это расширение из панели: там видно, что вообще есть на странице — выделение,
              таблицы, картинки — и оттуда же всё запускается.
            </p>
            <p className="opt__hint">
              На телефоне (Firefox для Android) контекстного меню нет — все действия
              доступны из окна расширения.
            </p>
          </Group>

          <Group title="Разрешения">
            <p className="opt__hint">
              Расширение не имеет постоянного доступа ни к одному сайту: страница читается
              только в момент вашего жеста. Поэтому при установке нет строчки «читать и
              изменять все ваши данные на всех сайтах».
            </p>
            <p className="opt__hint">
              <strong>Сохранение картинок с чужих доменов.</strong> Атрибут{' '}
              <code>download</code> браузер игнорирует для чужих доменов: вместо сохранения
              произошёл бы переход по ссылке. Мы этого не делаем. Если сервер картинки
              разрешает CORS — мы прочитаем её и сохраним сами. Если нет — честно откажем и
              предложим открыть картинку. Разрешение «Управление загрузками» снимает это
              ограничение, но добавляет строчку в предупреждения при установке — поэтому
              оно опциональное и выключено по умолчанию.
            </p>
            <p className="line">
              Статус:{' '}
              {downloadsGranted === null
                ? '…'
                : downloadsGranted
                  ? 'разрешение выдано'
                  : 'не выдано'}
            </p>
            <div className="btnrow">
              <button className="opt__btn" onClick={() => void requestDownloads()}>
                {downloadsGranted ? 'Отозвать разрешение' : 'Запросить разрешение'}
              </button>
            </div>
          </Group>

          <Group title="Безопасность">
            <Callout tone="info" title="Ноль сети, ноль телеметрии">
              Файл собирается локально в браузере. Единственный сетевой запрос, который
              расширение вообще может сделать, — загрузка той самой картинки, которую вы
              попросили сохранить. Никакой аналитики, никакого удалённого кода.
            </Callout>
            <Callout tone="warn" title="Формулы в .csv">
              Ячейка, начинающаяся с <code>=</code>, <code>+</code>, <code>-</code> или{' '}
              <code>@</code>, исполняется Excel как формула — а данные берутся с
              произвольной веб-страницы. По умолчанию мы ставим перед такой ячейкой
              апостроф. Валидные числа (<code>-5</code>) не трогаем. Формат{' '}
              <strong>.xlsx этой проблемы не имеет вообще</strong>: там формула — отдельный
              элемент файла, и текстовая ячейка ею не станет. Поэтому .xlsx — формат по
              умолчанию.
            </Callout>
            <Callout tone="info" title="Имена файлов">
              RTL-подмена (<code>отчет‮exe.xslx</code>), путь наружу (<code>../</code>),
              зарезервированные имена Windows (<code>CON</code>, <code>PRN</code>) и
              управляющие символы обезвреживаются перед записью. Расширение файла всегда
              ставим мы — из выбранного формата, никогда из вашего ввода.
            </Callout>
          </Group>
        </>
      )}
    </div>
  );
}

/* ---- small presentational helpers -------------------------------- */

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="opt__group">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function RadioRow({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="opt__radios">
      <legend>{legend}</legend>
      {options.map(([v, label]) => (
        <label key={v} className="opt__radio">
          <input type="radio" checked={value === v} onChange={() => onChange(v)} />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="opt__field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="opt__check">
      <input type="checkbox" checked={checked} onChange={() => onChange(!checked)} />
      {label}
    </label>
  );
}
