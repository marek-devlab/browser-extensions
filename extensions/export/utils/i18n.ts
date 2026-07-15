import { createTranslator, useLocale, type Catalog, type Locale } from '@blur/ui';
import { useCallback } from 'react';

// Runtime i18n for Page Content Exporter. English is the default; the switcher on
// the options page moves the whole UI to RU or ET at runtime (see @blur/ui/i18n).
//
// `en` below is BOTH the default catalog AND the single source of truth for the key
// set: `messages: Catalog<MsgKey>` types ru/et as `Record<MsgKey, string>`, so the
// build FAILS the moment either locale is missing a key. That is the completeness
// net — there is no way to ship a half-translated surface.
//
// Rules honoured here: only user-facing PRESENTATION strings live in this catalog.
// Storage keys, console logs, CSS, file-format tokens (`.xlsx`, `CRLF`, `UTF-8`,
// product names) and code comments are NOT translated. A handful of inline
// `<code>`/`<strong>` spans from the original Russian markup are folded into plain
// sentences so each language reads naturally (word order differs per language).

const en = {
  /* ---- shared across surfaces ---- */
  cancel: 'Cancel',
  close: 'Close',
  saveStarted: 'Save started: {filename}',
  fileDidntAppear: "File didn't appear?",
  saveViaTab: 'Save via the extension tab',
  firstLines: 'First lines of the file',
  warnMerged: '⚠ merged cells',
  warnNested: '⚠ nested tables',
  warnLayout: '⚠ looks like layout, not data',
  warnVirtualized: '⚠ rows may load on scroll',

  /* ---- popup ---- */
  scanError: 'Could not read the page. Reload it and try again.',
  popupTitle: 'Content Export',
  reading: 'Reading the page…',
  nothingTitle: 'Nothing to export on this page',
  nothingHint:
    'Select text{action}, or open a page with a table. Tables the page draws without a <table> tag (div “tables”, Canvas) are invisible to us — that is an honest limitation, not a bug.',
  actionRightClick: ' and right-click',
  actionOpenMenu: ' and open this menu again',
  selectionHeading: 'Selection',
  selectionLine: '{chars} characters, {paragraphs} {unit}',
  paragraphOne: 'paragraph',
  paragraphOther: 'paragraphs',
  copyAsMd: 'Copy as MD',
  tables: 'Tables',
  noTablesInline:
    'No <table> tags on the page. Data drawn with div or Canvas is invisible to us.',
  untitled: 'untitled',
  pickOnPage: 'Pick on the page',
  allTables: 'All tables',
  images: 'Images',
  largerThan200: 'larger than 200×200: {n}',
  pickImageOnPage: 'Pick an image on the page',
  noCtxImagesNote:
    'This device has no context menu — every image action (copy URL, open, save) is available here.',
  crossOriginTitle: '⚠ {n} embedded frame(s) (iframe) from another domain',
  crossOriginBody:
    'Their content cannot be read — that would need access to other sites, which we do not ask for. Open the frame as a normal page and it will all work.',
  closedShadowTitle: '⚠ {n} component(s) with hidden (closed) content',
  closedShadowBody:
    'Closed shadow DOM is unreachable for anyone, including us. It is a platform limitation, and we name it.',
  footer: 'Nothing goes to the network. The file is built in your browser.',

  /* ---- options ---- */
  optionsTitle: 'Content Export — settings',
  language: 'Language',
  tabText: 'Text',
  tabFilenames: 'Filenames',
  tabAbout: 'About',
  groupDefaultFormat: 'Default format',
  calloutXlsxSafer:
    '.xlsx is safer: Excel does not execute formulas from text cells, and number and date types are preserved exactly.',
  csvDelimiter: 'Delimiter',
  delimiterAuto: 'Auto (by locale)',
  delimiterSemicolonExcel: '; (Excel, RU locale)',
  csvEncoding: 'Encoding',
  utf8NoBom: 'UTF-8 without BOM',
  csvEol: 'Line ending',
  csvGuard: 'Dangerous cells',
  guardEscape: 'Escape (recommended)',
  guardKeep: 'Keep as is',
  guardWarn: 'Warn only',
  sepLine: 'Add a “sep=” line',
  groupTableSemantics: 'Table semantics',
  legendMergedCells: 'Merged cells',
  mergedDuplicate: 'Duplicate the value',
  mergedEmpty: 'Leave empty',
  linksInCells: 'Links in cells',
  linksText: 'Text only',
  linksTextUrl: 'Text (URL)',
  linksUrl: 'URL only',
  parseNumbers: 'Recognize “1 234.56” as a number',
  calloutAmbiguousNumbers:
    'Ambiguous numbers (“1,234” — is that 1234 or 1.234?) stay as text. Guessing wrong here costs more than not guessing: a silently corrupted report is worse than a text cell.',
  parseDates: 'Recognize dates (05.06 → 5 June)',
  visibleRowsOnly: 'Visible rows only (skip display:none)',
  alwaysPreview: 'Always show a preview before saving',
  legendDefaultTextFormat: 'Default text format',
  calloutTextMenuOrder:
    'This does not change the order of menu items — both formats are always shown.',
  groupFilenameTemplate: 'Filename template',
  templateLabel: 'Template',
  availableTokens: 'Available: {tokens}',
  example: 'Example:',
  exampleHost: 'example.com',
  exampleTitle: 'Central Bank',
  exampleCaption: 'Exchange rates',
  translitFilename: 'Transliterate Cyrillic in the filename',
  calloutFilenameSafetyTitle: 'Name safety',
  calloutFilenameSafetyBody:
    'Forbidden characters, RTL spoofing and names like CON/PRN are neutralized automatically (utils/filename — real logic).',
  groupHowItWorks: 'How it works',
  aboutHow1:
    'Select text → right-click → “Save page content”. Or open this extension from the toolbar: it shows what is on the page — selection, tables, images — and everything runs from there too.',
  aboutHow2:
    'On a phone (Firefox for Android) there is no context menu — every action is available from the extension window.',
  groupPermissions: 'Permissions',
  aboutPerm1:
    'The extension has no permanent access to any site: the page is read only at the moment of your gesture. That is why installation shows no “read and change all your data on all websites” line.',
  aboutPermImagesTitle: 'Saving images from other domains.',
  aboutPermImagesBody:
    'The browser ignores the download attribute for cross-origin domains: instead of saving, it would navigate to the link. We do not do that. If the image server allows CORS, we read it and save it ourselves. If not, we honestly refuse and offer to open the image. The “Manage downloads” permission lifts this limit but adds a line to the install warnings — so it is optional and off by default.',
  statusLabel: 'Status:',
  statusGranted: 'permission granted',
  statusNotGranted: 'not granted',
  requestPermission: 'Request permission',
  revokePermission: 'Revoke permission',
  groupSecurity: 'Security',
  calloutZeroNetworkTitle: 'Zero network, zero telemetry',
  calloutZeroNetworkBody:
    'The file is built locally in the browser. The only network request the extension can make at all is loading the very image you asked to save. No analytics, no remote code.',
  calloutCsvFormulaTitle: 'Formulas in .csv',
  calloutCsvFormulaBody:
    'A cell starting with =, +, - or @ is executed by Excel as a formula — and the data comes from an arbitrary web page. By default we put an apostrophe before such a cell. Valid numbers (-5) are left alone. The .xlsx format does not have this problem at all: there a formula is a separate file element, and a text cell will never become one. That is why .xlsx is the default format.',
  calloutFilenamesTitle: 'Filenames',
  calloutFilenamesBody:
    'RTL spoofing (report‮exe.xslx), path traversal (../), reserved Windows names (CON, PRN) and control characters are neutralized before writing. The file extension is always set by us — from the chosen format, never from your input.',

  /* ---- save.html ---- */
  saveErrorManual:
    'This page opens by itself when a site forbids saving files. There is no reason to open it manually.',
  saveErrorNoData: 'No data to save was found (or the file has already been saved).',
  saveTitle: 'Saving a file',
  savePreparing: 'Preparing the file…',
  saveWhyTitle: 'Why this tab opened',
  saveWhyBody:
    'The site you are exporting from forbids saving files with its security policy (CSP sandbox). That policy does not apply here — the file will be built on the extension’s own page.',
  saveButton: 'Save file',
  saveSavedBody:
    'The file went to the browser’s downloads. We do not ask for the “Manage downloads” permission, so we do not know exactly where it landed or whether the write finished — and we will not make that up. You can close the tab.',
  closeTab: 'Close tab',
  bytesB: 'B',
  bytesKb: 'KB',
  bytesMb: 'MB',

  /* ---- export dialog ---- */
  exportTableTitle: 'Export table',
  dlgTitleMulti: 'Export: {n} tables',
  dlgRowsCols: '{rows} rows × {cols} columns',
  fieldFormat: 'Format',
  fileFormatAria: 'File format',
  recommendedSuffix: ' (recommended)',
  noteXlsx:
    'In .xlsx a formula is a separate file element, so a text cell can never become a formula. And number types are preserved exactly.',
  noteCsv:
    'In .csv there are no types: Excel will guess again on its own and may turn “05.06” into a date and “0012345” into “12345”. If you need precision, use .xlsx.',
  fieldFilename: 'Filename',
  guardWarnEscape:
    '⚠ {n} cell(s) start with “=”, “+”, “−” or “@” — they will be written as text (protection against formula execution in Excel). Valid numbers like “−5” are left alone.',
  guardWarnWarn:
    '⚠ {n} potentially dangerous cell(s). “Warn only” mode: confirm the save below.',
  guardWarnKeep:
    '⚠ {n} cell(s) may be executed by Excel as a formula. You chose “keep as is”.',
  noteMerged:
    '⚠ Merged cells ({n}): the value is {mode}. The merge itself is not carried into the file — only the values.',
  mergedModeDuplicate: 'duplicated into every position',
  mergedModeFirst: 'left only in the first',
  noteNested:
    '⚠ Nested tables ({n}): they do not fit into a flat file. Their content is flattened into the cell text. If you need the nested one specifically, pick it separately in the table list.',
  noteVirtualized:
    '⚠ The table seems to load rows on scroll. There are currently {rows} rows on the page — possibly not all. Scroll the table to the end and try again.',
  noteBigTable:
    '⚠ Large table ({cells} cells). Building will take a few seconds; the preview shows the first {rows} rows.',
  refuseRows:
    '🔴 {rows} rows — that is more than the Excel format’s own limit ({max}). This is an Excel limitation, not ours. Export as .csv.',
  refuseCells:
    '🔴 Too large for .xlsx ({cells} cells > {max}): the whole workbook is held in memory and the tab may crash. Export as .csv — it is built in parts.',
  tabTable: 'Table',
  tabRawCsv: 'Raw bytes',
  tabRawText: 'File text',
  previewCaption: 'What goes into the file — first {shown} rows of {total}',
  includeColumnAria: 'Include column {header}',
  columnTypeAria: 'Column type {header}',
  typeText: 'Text',
  typeNumber: 'Number',
  rawXlsxNote:
    'The .xlsx format is binary. Cells are written with types: text stays text and cannot become a formula.',
  optionsSummary: 'File options',
  delimiterAutoResolved: 'Auto ({delim})',
  noteBom:
    'Without a BOM, Excel shows Cyrillic as “ÐšÑƒÑ€Ñ”. We do not offer Windows-1251: the browser can only encode to UTF-8.',
  eolCrlf: 'CRLF (Windows/Excel)',
  sepLineLong: 'Add a “sep=” line — helps Excel, breaks pandas and Google Sheets',
  noteCaptionCsv:
    'The title “{caption}” will not make it into .csv — CSV cannot do headers above the header row (any parser breaks on it). It will go into the filename.',
  fieldFirstRow: 'First row',
  firstRowHeaders: 'headers',
  firstRowData: 'ordinary data',
  summaryLine: '{rows} rows × {cols} columns → {filename}',
  building: 'Building…',
  ackFormula:
    'I understand: the file may execute a formula when opened in Excel',
  xlsxLoadFail: 'Failed to load the .xlsx module: ',
  xlsxLoadFail2:
    'The .xlsx module did not load (the page may restrict script execution). Export as .csv.',
  sheetDefault: 'Table {n}',
  checkboxYes: 'yes',
  checkboxNo: 'no',
  columnFallback: 'Column {n}',
  saveFailed:
    'Could not save the file ({reason}). This page may forbid downloads.',
  fallbackXlsxWarn:
    '.xlsx cannot be rebuilt via the extension tab — saving as .csv. The data is the same; Excel will detect the types itself.',
  fallbackFail: 'Did not work: {error}',

  /* ---- picker ---- */
  selectAll: 'Select all',
  exportSelected: 'Export selected',
  pickHintMulti: 'Space — toggle · A — all · Enter — export · Esc — cancel',
  pickHintSingle:
    'Tab / ↑↓ — next · 1–9 — by number · Enter — select · Esc — cancel',
  pickCounter: 'Selected {n} of {total}. ',
  pickDesc: '{i} of {total}: {label}. {warnings}',

  /* ---- engine (on-page, non-React) ---- */
  bgNoResponse: 'The background script did not respond',
  selectionGone: 'The selection is gone. Select the text again.',
  filenamePageFallback: 'page',
  pageBlocksDownloads:
    'The page forbids downloads. You can save via the extension tab.',
  copiedMd: 'Copied as Markdown.',
  imgUrlUnsupported: 'This image address is not supported.',
  copiedUrlSrcset:
    'Copied the URL the browser actually loaded (a variant from srcset).',
  copiedImgUrl: 'Image URL copied.',
  noImagesFound: 'No suitable images found (we only show 64×64 and larger).',
  pickImageTitle: 'Pick an image',
  noTablesFound:
    'No tables found. We only read the <table> tag: if a table is drawn with div or Canvas, we do not see it.',
  candTableLabel: '{rows} × {cols}',
  pickTablesTitle: 'Pick tables',
  pickTableTitle: 'Pick a table',
  imgRefusal:
    'The browser will not let us save an image from the {host} domain: for other domains the download attribute is ignored, and instead of saving it would navigate to the link. We do not do that. This server did not allow CORS either.',
  otherSite: 'another site',
  openImage: 'Open the image',
  enablePermission: 'Enable permission…',
  imageWord: 'Image',
  copyUrl: 'Copy URL',
  openInNewTab: 'Open in a new tab',
  saveDots: 'Save…',
  clipboardFailTitle: 'Could not write to the clipboard',
  clipboardFailBody:
    'Copy manually: Ctrl+C (⌘+C). The text is already selected.',

  /* ---- background (context menus + privileged errors) ---- */
  menuRoot: 'Save page content',
  menuSelMd: 'Save selection as .md',
  menuSelTxt: 'Save selection as .txt',
  menuSelCopyMd: 'Copy as Markdown',
  menuTableItem: 'Export table…',
  menuImgCopyUrl: 'Copy image URL',
  menuImgOpenTab: 'Open image in a new tab',
  menuImgSave: 'Save image…',
  menuTableAll: 'Export all tables…',
  menuSettings: 'Export settings…',
  downloadsNotGranted: 'The “Manage downloads” permission is not granted',
  unsafeUrl: 'Unsafe address',
  downloadsApiUnavailable: 'The downloads API is unavailable',
  noTab: 'No tab',
  fileTooBig: 'The file is too large for this method (>8 MB)',

  /* ---- inject (popup error states) ---- */
  injectNoScriptApi: 'The browser will not let us inject a script into this page.',
  injectNoActiveTab: 'No active tab',
  injectRestrictedPage:
    'Extensions cannot work on this page (a browser system page, the add-on store or a PDF).',
  injectNoResponse: 'The page did not respond. Reload it and try again.',
} as const;

export type MsgKey = keyof typeof en;

const ru: Record<MsgKey, string> = {
  cancel: 'Отмена',
  close: 'Закрыть',
  saveStarted: 'Сохранение запущено: {filename}',
  fileDidntAppear: 'Файл не появился?',
  saveViaTab: 'Сохранить через вкладку расширения',
  firstLines: 'Первые строки файла',
  warnMerged: '⚠ объединённые ячейки',
  warnNested: '⚠ вложенные таблицы',
  warnLayout: '⚠ похоже на вёрстку, а не данные',
  warnVirtualized: '⚠ строки могут подгружаться при прокрутке',

  scanError: 'Не удалось прочитать страницу. Перезагрузите её и попробуйте снова.',
  popupTitle: 'Экспорт контента',
  reading: 'Читаю страницу…',
  nothingTitle: 'На этой странице нечего экспортировать',
  nothingHint:
    'Выделите текст{action}, или откройте страницу с таблицей. Таблицы, которые страница рисует не тегом <table> (div-«таблицы», Canvas), мы не видим — это честное ограничение, а не поломка.',
  actionRightClick: ' и нажмите правой кнопкой',
  actionOpenMenu: ' и откройте это меню снова',
  selectionHeading: 'Выделение',
  selectionLine: '{chars} символов, {paragraphs} {unit}',
  paragraphOne: 'абзац',
  paragraphOther: 'абзаца',
  copyAsMd: 'Копировать как MD',
  tables: 'Таблицы',
  noTablesInline:
    'Тегов <table> на странице нет. Данные, нарисованные через div или Canvas, мы не видим.',
  untitled: 'без названия',
  pickOnPage: 'Выбрать на странице',
  allTables: 'Все таблицы',
  images: 'Картинки',
  largerThan200: 'крупнее 200×200: {n}',
  pickImageOnPage: 'Выбрать картинку на странице',
  noCtxImagesNote:
    'На этом устройстве контекстного меню нет — все действия с картинками (копировать URL, открыть, сохранить) доступны отсюда.',
  crossOriginTitle: '⚠ {n} встроенных фрейма (iframe) с чужого домена',
  crossOriginBody:
    'Их содержимое прочитать нельзя — для этого нужен доступ к чужим сайтам, а мы его не просим. Откройте фрейм как обычную страницу, и всё заработает.',
  closedShadowTitle: '⚠ {n} компонент(а) со скрытым (closed) содержимым',
  closedShadowBody:
    'Closed shadow DOM недостижим ни для кого, включая нас. Это ограничение платформы, и мы его называем.',
  footer: 'Ничего не уходит в сеть. Файл собирается у вас в браузере.',

  optionsTitle: 'Экспорт контента — настройки',
  language: 'Язык',
  tabText: 'Текст',
  tabFilenames: 'Имена файлов',
  tabAbout: 'О расширении',
  groupDefaultFormat: 'Формат по умолчанию',
  calloutXlsxSafer:
    '.xlsx безопаснее: Excel не исполняет формулы из текстовых ячеек, а типы чисел и дат сохраняются точно.',
  csvDelimiter: 'Разделитель',
  delimiterAuto: 'Авто (по локали)',
  delimiterSemicolonExcel: '; (Excel, ру-локаль)',
  csvEncoding: 'Кодировка',
  utf8NoBom: 'UTF-8 без BOM',
  csvEol: 'Конец строки',
  csvGuard: 'Опасные ячейки',
  guardEscape: 'Экранировать (рекомендуется)',
  guardKeep: 'Оставить как есть',
  guardWarn: 'Только предупредить',
  sepLine: 'Добавлять строку «sep=»',
  groupTableSemantics: 'Семантика таблицы',
  legendMergedCells: 'Объединённые ячейки',
  mergedDuplicate: 'Дублировать значение',
  mergedEmpty: 'Оставить пустыми',
  linksInCells: 'Ссылки в ячейках',
  linksText: 'Только текст',
  linksTextUrl: 'Текст (URL)',
  linksUrl: 'Только URL',
  parseNumbers: 'Распознавать «1 234,56» как число',
  calloutAmbiguousNumbers:
    'Неоднозначные числа («1,234» — это 1234 или 1.234?) остаются текстом. Ошибиться здесь дороже, чем не угадать: молча испорченный отчёт хуже, чем ячейка-текст.',
  parseDates: 'Распознавать даты (05.06 → 5 июня)',
  visibleRowsOnly: 'Только видимые строки (пропускать display:none)',
  alwaysPreview: 'Всегда показывать превью перед сохранением',
  legendDefaultTextFormat: 'Формат текста по умолчанию',
  calloutTextMenuOrder:
    'Порядок пунктов меню это не меняет — оба формата всегда видны.',
  groupFilenameTemplate: 'Шаблон имени',
  templateLabel: 'Шаблон',
  availableTokens: 'Доступно: {tokens}',
  example: 'Пример:',
  exampleHost: 'cbr.ru',
  exampleTitle: 'ЦБ РФ',
  exampleCaption: 'Курсы валют',
  translitFilename: 'Транслитерировать кириллицу в имени файла',
  calloutFilenameSafetyTitle: 'Безопасность имён',
  calloutFilenameSafetyBody:
    'Запрещённые символы, RTL-подмена и имена вроде CON/PRN обезвреживаются автоматически (utils/filename — реальная логика).',
  groupHowItWorks: 'Как это работает',
  aboutHow1:
    'Выделите текст → правая кнопка → «Сохранить контент страницы». Или откройте это расширение из панели: там видно, что вообще есть на странице — выделение, таблицы, картинки — и оттуда же всё запускается.',
  aboutHow2:
    'На телефоне (Firefox для Android) контекстного меню нет — все действия доступны из окна расширения.',
  groupPermissions: 'Разрешения',
  aboutPerm1:
    'Расширение не имеет постоянного доступа ни к одному сайту: страница читается только в момент вашего жеста. Поэтому при установке нет строчки «читать и изменять все ваши данные на всех сайтах».',
  aboutPermImagesTitle: 'Сохранение картинок с чужих доменов.',
  aboutPermImagesBody:
    'Атрибут download браузер игнорирует для чужих доменов: вместо сохранения произошёл бы переход по ссылке. Мы этого не делаем. Если сервер картинки разрешает CORS — мы прочитаем её и сохраним сами. Если нет — честно откажем и предложим открыть картинку. Разрешение «Управление загрузками» снимает это ограничение, но добавляет строчку в предупреждения при установке — поэтому оно опциональное и выключено по умолчанию.',
  statusLabel: 'Статус:',
  statusGranted: 'разрешение выдано',
  statusNotGranted: 'не выдано',
  requestPermission: 'Запросить разрешение',
  revokePermission: 'Отозвать разрешение',
  groupSecurity: 'Безопасность',
  calloutZeroNetworkTitle: 'Ноль сети, ноль телеметрии',
  calloutZeroNetworkBody:
    'Файл собирается локально в браузере. Единственный сетевой запрос, который расширение вообще может сделать, — загрузка той самой картинки, которую вы попросили сохранить. Никакой аналитики, никакого удалённого кода.',
  calloutCsvFormulaTitle: 'Формулы в .csv',
  calloutCsvFormulaBody:
    'Ячейка, начинающаяся с =, +, - или @, исполняется Excel как формула — а данные берутся с произвольной веб-страницы. По умолчанию мы ставим перед такой ячейкой апостроф. Валидные числа (-5) не трогаем. Формат .xlsx этой проблемы не имеет вообще: там формула — отдельный элемент файла, и текстовая ячейка ею не станет. Поэтому .xlsx — формат по умолчанию.',
  calloutFilenamesTitle: 'Имена файлов',
  calloutFilenamesBody:
    'RTL-подмена (отчет‮exe.xslx), путь наружу (../), зарезервированные имена Windows (CON, PRN) и управляющие символы обезвреживаются перед записью. Расширение файла всегда ставим мы — из выбранного формата, никогда из вашего ввода.',

  saveErrorManual:
    'Эта страница открывается сама, когда сайт запрещает сохранение файлов. Открывать её вручную незачем.',
  saveErrorNoData: 'Данные для сохранения не найдены (или файл уже сохранён).',
  saveTitle: 'Сохранение файла',
  savePreparing: 'Готовлю файл…',
  saveWhyTitle: 'Почему открылась эта вкладка',
  saveWhyBody:
    'Сайт, с которого вы экспортируете, запрещает сохранение файлов своей политикой безопасности (CSP sandbox). Здесь эта политика не действует — файл соберётся на странице самого расширения.',
  saveButton: 'Сохранить файл',
  saveSavedBody:
    'Файл ушёл в загрузки браузера. Мы не просим разрешение «Управление загрузками», поэтому не знаем, куда именно он лёг и завершилась ли запись, — и не станем это придумывать. Вкладку можно закрыть.',
  closeTab: 'Закрыть вкладку',
  bytesB: 'Б',
  bytesKb: 'КБ',
  bytesMb: 'МБ',

  exportTableTitle: 'Экспорт таблицы',
  dlgTitleMulti: 'Экспорт: {n} таблицы',
  dlgRowsCols: '{rows} строк × {cols} колонок',
  fieldFormat: 'Формат',
  fileFormatAria: 'Формат файла',
  recommendedSuffix: ' (рекомендуется)',
  noteXlsx:
    'В .xlsx формула — отдельный элемент файла, поэтому текстовая ячейка никогда не станет формулой. И типы чисел сохраняются точно.',
  noteCsv:
    'В .csv типов нет: Excel заново решит сам и может превратить «05.06» в дату, а «0012345» в «12345». Нужна точность — берите .xlsx.',
  fieldFilename: 'Имя файла',
  guardWarnEscape:
    '⚠ {n} ячейка(и) начинается с «=», «+», «−» или «@» — будет записана как текст (защита от исполнения формул в Excel). Валидные числа вроде «−5» не трогаем.',
  guardWarnWarn:
    '⚠ {n} потенциально опасная ячейка. Режим «только предупредить»: подтвердите сохранение внизу.',
  guardWarnKeep:
    '⚠ {n} ячейка(и) может быть исполнена Excel как формула. Вы выбрали «оставить как есть».',
  noteMerged:
    '⚠ Объединённые ячейки ({n}): значение {mode}. Само объединение в файл не переносится — только значения.',
  mergedModeDuplicate: 'продублировано в каждую позицию',
  mergedModeFirst: 'оставлено только в первой',
  noteNested:
    '⚠ Вложенные таблицы ({n}): в плоский файл они не помещаются. Их содержимое сплющено в текст ячейки. Нужна именно вложенная — выберите её отдельно в списке таблиц.',
  noteVirtualized:
    '⚠ Похоже, таблица подгружает строки при прокрутке. Сейчас в странице {rows} строк — возможно, это не все. Прокрутите таблицу до конца и повторите.',
  noteBigTable:
    '⚠ Большая таблица ({cells} ячеек). Сборка займёт несколько секунд; превью показывает первые {rows} строк.',
  refuseRows:
    '🔴 {rows} строк — это больше предела самого формата Excel ({max}). Это ограничение Excel, не наше. Экспортируйте как .csv.',
  refuseCells:
    '🔴 Слишком большая для .xlsx ({cells} ячеек > {max}): книга целиком держится в памяти и вкладка может упасть. Экспортируйте как .csv — он собирается по частям.',
  tabTable: 'Таблица',
  tabRawCsv: 'Сырые байты',
  tabRawText: 'Текст файла',
  previewCaption: 'Что попадёт в файл — первые {shown} строк из {total}',
  includeColumnAria: 'Включить колонку {header}',
  columnTypeAria: 'Тип колонки {header}',
  typeText: 'Текст',
  typeNumber: 'Число',
  rawXlsxNote:
    'Формат .xlsx — двоичный. Ячейки записываются с типами: текст остаётся текстом, формулой стать не может.',
  optionsSummary: 'Параметры файла',
  delimiterAutoResolved: 'Авто ({delim})',
  noteBom:
    'Без BOM Excel покажет кириллицу как «ÐšÑƒÑ€Ñ». Windows-1251 не предлагаем: браузер умеет кодировать только в UTF-8.',
  eolCrlf: 'CRLF (Windows/Excel)',
  sepLineLong:
    'Добавить строку «sep=» — помогает Excel, ломает pandas и Google Sheets',
  noteCaptionCsv:
    'Название «{caption}» в .csv не попадёт — CSV не умеет заголовки над шапкой (любой парсер на этом ломается). Оно попадёт в имя файла.',
  fieldFirstRow: 'Первая строка',
  firstRowHeaders: 'заголовки',
  firstRowData: 'обычные данные',
  summaryLine: '{rows} строк × {cols} колонок → {filename}',
  building: 'Собираю…',
  ackFormula:
    'Я понимаю: файл может исполнить формулу при открытии в Excel',
  xlsxLoadFail: 'Не удалось загрузить модуль .xlsx: ',
  xlsxLoadFail2:
    'Модуль .xlsx не загрузился (возможно, страница ограничивает выполнение скриптов). Экспортируйте как .csv.',
  sheetDefault: 'Таблица {n}',
  checkboxYes: 'да',
  checkboxNo: 'нет',
  columnFallback: 'Колонка {n}',
  saveFailed:
    'Не удалось сохранить файл ({reason}). Эта страница может запрещать загрузки.',
  fallbackXlsxWarn:
    '.xlsx через вкладку расширения не пересобрать — сохраняю как .csv. Данные те же, типы Excel определит сам.',
  fallbackFail: 'Не получилось: {error}',

  selectAll: 'Выбрать все',
  exportSelected: 'Экспортировать выбранные',
  pickHintMulti: 'Пробел — отметить · A — все · Enter — экспорт · Esc — отмена',
  pickHintSingle:
    'Tab / ↑↓ — следующая · 1–9 — по номеру · Enter — выбрать · Esc — отмена',
  pickCounter: 'Выбрано {n} из {total}. ',
  pickDesc: '{i} из {total}: {label}. {warnings}',

  bgNoResponse: 'Фоновый скрипт не ответил',
  selectionGone: 'Выделение пропало. Выделите текст ещё раз.',
  filenamePageFallback: 'stranica',
  pageBlocksDownloads:
    'Страница запрещает загрузки. Можно сохранить через вкладку расширения.',
  copiedMd: 'Скопировано как Markdown.',
  imgUrlUnsupported: 'Этот адрес картинки не поддерживается.',
  copiedUrlSrcset:
    'Скопирован URL, который реально загрузил браузер (вариант из srcset).',
  copiedImgUrl: 'URL картинки скопирован.',
  noImagesFound: 'Подходящих картинок не нашлось (мы показываем только от 64×64).',
  pickImageTitle: 'Выберите картинку',
  noTablesFound:
    'Таблиц не нашлось. Мы читаем только тег <table>: если таблица нарисована через div или Canvas, мы её не видим.',
  candTableLabel: '{rows} × {cols}',
  pickTablesTitle: 'Выберите таблицы',
  pickTableTitle: 'Выберите таблицу',
  imgRefusal:
    'Браузер не даёт сохранить картинку с домена {host}: для чужих доменов атрибут download игнорируется, и вместо сохранения произошёл бы переход по ссылке. Мы этого не делаем. CORS этот сервер тоже не разрешил.',
  otherSite: 'другого сайта',
  openImage: 'Открыть картинку',
  enablePermission: 'Включить разрешение…',
  imageWord: 'Картинка',
  copyUrl: 'Копировать URL',
  openInNewTab: 'Открыть в новой вкладке',
  saveDots: 'Сохранить…',
  clipboardFailTitle: 'Не удалось записать в буфер обмена',
  clipboardFailBody: 'Скопируйте вручную: Ctrl+C (⌘+C). Текст уже выделен.',

  menuRoot: 'Сохранить контент страницы',
  menuSelMd: 'Сохранить выделение как .md',
  menuSelTxt: 'Сохранить выделение как .txt',
  menuSelCopyMd: 'Копировать как Markdown',
  menuTableItem: 'Экспортировать таблицу…',
  menuImgCopyUrl: 'Копировать URL картинки',
  menuImgOpenTab: 'Открыть картинку в новой вкладке',
  menuImgSave: 'Сохранить картинку…',
  menuTableAll: 'Экспортировать все таблицы…',
  menuSettings: 'Настройки экспорта…',
  downloadsNotGranted: 'Разрешение «Управление загрузками» не выдано',
  unsafeUrl: 'Небезопасный адрес',
  downloadsApiUnavailable: 'API загрузок недоступно',
  noTab: 'Нет вкладки',
  fileTooBig: 'Файл слишком большой для этого способа (>8 МБ)',

  injectNoScriptApi: 'Браузер не даёт внедрить скрипт на эту страницу.',
  injectNoActiveTab: 'Нет активной вкладки',
  injectRestrictedPage:
    'На этой странице расширения работать не могут (служебная страница браузера, магазин дополнений или PDF).',
  injectNoResponse: 'Страница не ответила. Перезагрузите её и попробуйте снова.',
};

const et: Record<MsgKey, string> = {
  cancel: 'Tühista',
  close: 'Sulge',
  saveStarted: 'Salvestamine alustatud: {filename}',
  fileDidntAppear: 'Faili ei tekkinud?',
  saveViaTab: 'Salvesta laienduse vahelehe kaudu',
  firstLines: 'Faili esimesed read',
  warnMerged: '⚠ ühendatud lahtrid',
  warnNested: '⚠ pesastatud tabelid',
  warnLayout: '⚠ näib paigutus, mitte andmed',
  warnVirtualized: '⚠ read võivad laadida kerimisel',

  scanError: 'Lehte ei õnnestunud lugeda. Laadi see uuesti ja proovi uuesti.',
  popupTitle: 'Sisu eksport',
  reading: 'Loen lehte…',
  nothingTitle: 'Sellel lehel pole midagi eksportida',
  nothingHint:
    'Vali tekst{action} või ava tabeliga leht. Tabeleid, mille leht joonistab ilma <table> sildita (div-„tabelid“, Canvas), me ei näe — see on aus piirang, mitte viga.',
  actionRightClick: ' ja tee paremklõps',
  actionOpenMenu: ' ja ava see menüü uuesti',
  selectionHeading: 'Valik',
  selectionLine: '{chars} märki, {paragraphs} {unit}',
  paragraphOne: 'lõik',
  paragraphOther: 'lõiku',
  copyAsMd: 'Kopeeri MD-na',
  tables: 'Tabelid',
  noTablesInline:
    '<table> silte sellel lehel pole. div-i või Canvas-e abil joonistatud andmeid me ei näe.',
  untitled: 'nimeta',
  pickOnPage: 'Vali lehel',
  allTables: 'Kõik tabelid',
  images: 'Pildid',
  largerThan200: 'suuremad kui 200×200: {n}',
  pickImageOnPage: 'Vali lehel pilt',
  noCtxImagesNote:
    'Sellel seadmel pole kontekstimenüüd — kõik pilditoimingud (kopeeri URL, ava, salvesta) on siin saadaval.',
  crossOriginTitle: '⚠ {n} manustatud raami (iframe) võõralt domeenilt',
  crossOriginBody:
    'Nende sisu ei saa lugeda — selleks oleks vaja juurdepääsu võõrastele saitidele, mida me ei küsi. Ava raam tavalise lehena ja kõik toimib.',
  closedShadowTitle: '⚠ {n} komponent(i) peidetud (closed) sisuga',
  closedShadowBody:
    'Closed shadow DOM on kättesaamatu kõigile, sealhulgas meile. See on platvormi piirang ja me nimetame seda.',
  footer: 'Midagi ei saadeta võrku. Fail koostatakse sinu brauseris.',

  optionsTitle: 'Sisu eksport — seaded',
  language: 'Keel',
  tabText: 'Tekst',
  tabFilenames: 'Failinimed',
  tabAbout: 'Laiendusest',
  groupDefaultFormat: 'Vaikevorming',
  calloutXlsxSafer:
    '.xlsx on turvalisem: Excel ei käivita valemeid tekstilahtritest ning arvu- ja kuupäevatüübid säilivad täpselt.',
  csvDelimiter: 'Eraldaja',
  delimiterAuto: 'Automaatne (lokaadi järgi)',
  delimiterSemicolonExcel: '; (Excel, RU lokaat)',
  csvEncoding: 'Kodeering',
  utf8NoBom: 'UTF-8 ilma BOM-ita',
  csvEol: 'Reavahetus',
  csvGuard: 'Ohtlikud lahtrid',
  guardEscape: 'Varjesta (soovitatav)',
  guardKeep: 'Jäta muutmata',
  guardWarn: 'Ainult hoiata',
  sepLine: 'Lisa „sep=“ rida',
  groupTableSemantics: 'Tabeli semantika',
  legendMergedCells: 'Ühendatud lahtrid',
  mergedDuplicate: 'Dubleeri väärtus',
  mergedEmpty: 'Jäta tühjaks',
  linksInCells: 'Lingid lahtrites',
  linksText: 'Ainult tekst',
  linksTextUrl: 'Tekst (URL)',
  linksUrl: 'Ainult URL',
  parseNumbers: 'Tuvasta „1 234,56“ arvuna',
  calloutAmbiguousNumbers:
    'Mitmetähenduslikud arvud („1,234“ — kas see on 1234 või 1.234?) jäävad tekstiks. Siin eksida on kulukam kui mitte arvata: vaikselt rikutud aruanne on halvem kui tekstilahter.',
  parseDates: 'Tuvasta kuupäevad (05.06 → 5. juuni)',
  visibleRowsOnly: 'Ainult nähtavad read (jäta display:none vahele)',
  alwaysPreview: 'Näita alati enne salvestamist eelvaadet',
  legendDefaultTextFormat: 'Teksti vaikevorming',
  calloutTextMenuOrder:
    'See ei muuda menüü kirjete järjekorda — mõlemad vormingud on alati nähtaval.',
  groupFilenameTemplate: 'Failinime mall',
  templateLabel: 'Mall',
  availableTokens: 'Saadaval: {tokens}',
  example: 'Näide:',
  exampleHost: 'example.com',
  exampleTitle: 'Keskpank',
  exampleCaption: 'Valuutakursid',
  translitFilename: 'Transliteeri kürillitsa failinimes',
  calloutFilenameSafetyTitle: 'Nimede turvalisus',
  calloutFilenameSafetyBody:
    'Keelatud märgid, RTL-pettus ja nimed nagu CON/PRN neutraliseeritakse automaatselt (utils/filename — päris loogika).',
  groupHowItWorks: 'Kuidas see töötab',
  aboutHow1:
    'Vali tekst → paremklõps → „Salvesta lehe sisu“. Või ava see laiendus tööriistaribalt: seal on näha, mis lehel üldse on — valik, tabelid, pildid — ja sealtsamast käivitub kõik.',
  aboutHow2:
    'Telefonis (Firefox for Android) kontekstimenüüd pole — kõik toimingud on saadaval laienduse aknast.',
  groupPermissions: 'Õigused',
  aboutPerm1:
    'Laiendusel pole ühelegi saidile püsivat juurdepääsu: lehte loetakse ainult sinu žesti hetkel. Seetõttu pole paigaldamisel rida „loe ja muuda kõiki oma andmeid kõigil veebisaitidel“.',
  aboutPermImagesTitle: 'Piltide salvestamine võõrastelt domeenidelt.',
  aboutPermImagesBody:
    'Brauser eirab download-atribuuti võõraste domeenide puhul: salvestamise asemel toimuks lingile liikumine. Meie seda ei tee. Kui pildiserver lubab CORS-i — loeme selle ja salvestame ise. Kui ei — keeldume ausalt ja pakume pildi avamist. Õigus „Halda allalaadimisi“ eemaldab selle piirangu, kuid lisab paigaldusel hoiatusreale rea — seepärast on see valikuline ja vaikimisi väljas.',
  statusLabel: 'Olek:',
  statusGranted: 'õigus antud',
  statusNotGranted: 'pole antud',
  requestPermission: 'Küsi õigust',
  revokePermission: 'Tühista õigus',
  groupSecurity: 'Turvalisus',
  calloutZeroNetworkTitle: 'Null võrku, null telemeetriat',
  calloutZeroNetworkBody:
    'Fail koostatakse brauseris lokaalselt. Ainus võrgupäring, mille laiendus üldse teha saab, on selle sama pildi laadimine, mille salvestamist küsisid. Mingit analüütikat, mingit kaugkoodi.',
  calloutCsvFormulaTitle: 'Valemid .csv-s',
  calloutCsvFormulaBody:
    'Lahtri, mis algab märgiga =, +, - või @, käivitab Excel valemina — ja andmed pärinevad suvaliselt veebilehelt. Vaikimisi paneme sellise lahtri ette ülakoma. Kehtivaid arve (-5) ei puutu. Vormingul .xlsx seda probleemi üldse pole: seal on valem eraldi failielement ja tekstilahter ei muutu kunagi valemiks. Seepärast ongi .xlsx vaikevorming.',
  calloutFilenamesTitle: 'Failinimed',
  calloutFilenamesBody:
    'RTL-pettus (aruanne‮exe.xslx), tee väljapoole (../), Windowsi reserveeritud nimed (CON, PRN) ja juhtmärgid neutraliseeritakse enne kirjutamist. Faililaiendi paneme alati meie — valitud vormingust, mitte kunagi sinu sisendist.',

  saveErrorManual:
    'See leht avaneb ise, kui sait keelab failide salvestamise. Käsitsi seda avada pole mõtet.',
  saveErrorNoData: 'Salvestatavaid andmeid ei leitud (või fail on juba salvestatud).',
  saveTitle: 'Faili salvestamine',
  savePreparing: 'Valmistan faili ette…',
  saveWhyTitle: 'Miks see vaheleht avanes',
  saveWhyBody:
    'Sait, kust ekspordid, keelab failide salvestamise oma turvapoliitikaga (CSP sandbox). Siin see poliitika ei kehti — fail koostatakse laienduse enda lehel.',
  saveButton: 'Salvesta fail',
  saveSavedBody:
    'Fail läks brauseri allalaadimistesse. Me ei küsi õigust „Halda allalaadimisi“, seega me ei tea täpselt, kuhu see jõudis ega kas kirjutamine lõppes — ja me ei hakka seda välja mõtlema. Vahelehe võib sulgeda.',
  closeTab: 'Sulge vaheleht',
  bytesB: 'B',
  bytesKb: 'KB',
  bytesMb: 'MB',

  exportTableTitle: 'Ekspordi tabel',
  dlgTitleMulti: 'Eksport: {n} tabelit',
  dlgRowsCols: '{rows} rida × {cols} veergu',
  fieldFormat: 'Vorming',
  fileFormatAria: 'Faili vorming',
  recommendedSuffix: ' (soovitatav)',
  noteXlsx:
    'Vormingus .xlsx on valem eraldi failielement, seega tekstilahter ei saa kunagi valemiks muutuda. Ja arvutüübid säilivad täpselt.',
  noteCsv:
    'Vormingus .csv tüüpe pole: Excel otsustab uuesti ise ja võib muuta „05.06“ kuupäevaks ja „0012345“ „12345“-ks. Kui vajad täpsust, vali .xlsx.',
  fieldFilename: 'Failinimi',
  guardWarnEscape:
    '⚠ {n} lahtrit algab märgiga „=“, „+“, „−“ või „@“ — need kirjutatakse tekstina (kaitse valemite käivitamise vastu Excelis). Kehtivaid arve nagu „−5“ ei puutu.',
  guardWarnWarn:
    '⚠ {n} potentsiaalselt ohtlikku lahtrit. Režiim „ainult hoiata“: kinnita salvestamine allpool.',
  guardWarnKeep:
    '⚠ {n} lahtrit võib Excel valemina käivitada. Valisid „jäta muutmata“.',
  noteMerged:
    '⚠ Ühendatud lahtrid ({n}): väärtus on {mode}. Ühendust ennast faili ei kanta — ainult väärtused.',
  mergedModeDuplicate: 'dubleeritud igasse positsiooni',
  mergedModeFirst: 'jäetud ainult esimesse',
  noteNested:
    '⚠ Pesastatud tabelid ({n}): lamedasse faili need ei mahu. Nende sisu on lamestatud lahtri tekstiks. Kui vajad just pesastatut, vali see eraldi tabelite loendist.',
  noteVirtualized:
    '⚠ Tundub, et tabel laadib ridu kerimisel. Praegu on lehel {rows} rida — võib-olla mitte kõik. Keri tabel lõpuni ja proovi uuesti.',
  noteBigTable:
    '⚠ Suur tabel ({cells} lahtrit). Koostamine võtab paar sekundit; eelvaade näitab esimesi {rows} rida.',
  refuseRows:
    '🔴 {rows} rida — see on rohkem kui Exceli vormingu enda piir ({max}). See on Exceli piirang, mitte meie oma. Ekspordi .csv-na.',
  refuseCells:
    '🔴 .xlsx jaoks liiga suur ({cells} lahtrit > {max}): kogu töövihik hoitakse mälus ja vaheleht võib kokku jooksta. Ekspordi .csv-na — see koostatakse osade kaupa.',
  tabTable: 'Tabel',
  tabRawCsv: 'Toorbaidid',
  tabRawText: 'Faili tekst',
  previewCaption: 'Mis läheb faili — esimesed {shown} rida {total}-st',
  includeColumnAria: 'Kaasa veerg {header}',
  columnTypeAria: 'Veeru tüüp {header}',
  typeText: 'Tekst',
  typeNumber: 'Arv',
  rawXlsxNote:
    'Vorming .xlsx on binaarne. Lahtrid kirjutatakse tüüpidega: tekst jääb tekstiks ega saa valemiks muutuda.',
  optionsSummary: 'Faili valikud',
  delimiterAutoResolved: 'Automaatne ({delim})',
  noteBom:
    'Ilma BOM-ita näitab Excel kürillitsat kui „ÐšÑƒÑ€Ñ“. Windows-1251 me ei paku: brauser oskab kodeerida ainult UTF-8-sse.',
  eolCrlf: 'CRLF (Windows/Excel)',
  sepLineLong:
    'Lisa „sep=“ rida — aitab Excelit, lõhub pandas ja Google Sheets',
  noteCaptionCsv:
    'Pealkiri „{caption}“ .csv-sse ei jõua — CSV ei oska päiseid päiserea kohal (iga parser jookseb selle peal kokku). See läheb failinimesse.',
  fieldFirstRow: 'Esimene rida',
  firstRowHeaders: 'päised',
  firstRowData: 'tavalised andmed',
  summaryLine: '{rows} rida × {cols} veergu → {filename}',
  building: 'Koostan…',
  ackFormula: 'Ma saan aru: fail võib Excelis avamisel valemi käivitada',
  xlsxLoadFail: '.xlsx mooduli laadimine ebaõnnestus: ',
  xlsxLoadFail2:
    '.xlsx moodul ei laadinud (leht võib skriptide käivitamist piirata). Ekspordi .csv-na.',
  sheetDefault: 'Tabel {n}',
  checkboxYes: 'jah',
  checkboxNo: 'ei',
  columnFallback: 'Veerg {n}',
  saveFailed:
    'Faili ei õnnestunud salvestada ({reason}). See leht võib allalaadimisi keelata.',
  fallbackXlsxWarn:
    '.xlsx-i ei saa laienduse vahelehe kaudu uuesti koostada — salvestan .csv-na. Andmed on samad; Excel tuvastab tüübid ise.',
  fallbackFail: 'Ei õnnestunud: {error}',

  selectAll: 'Vali kõik',
  exportSelected: 'Ekspordi valitud',
  pickHintMulti: 'Tühik — märgi · A — kõik · Enter — ekspordi · Esc — tühista',
  pickHintSingle:
    'Tab / ↑↓ — järgmine · 1–9 — numbri järgi · Enter — vali · Esc — tühista',
  pickCounter: 'Valitud {n} / {total}. ',
  pickDesc: '{i} / {total}: {label}. {warnings}',

  bgNoResponse: 'Taustaskript ei vastanud',
  selectionGone: 'Valik on kadunud. Vali tekst uuesti.',
  filenamePageFallback: 'leht',
  pageBlocksDownloads:
    'Leht keelab allalaadimised. Salvestada saab laienduse vahelehe kaudu.',
  copiedMd: 'Kopeeritud Markdownina.',
  imgUrlUnsupported: 'See pildiaadress pole toetatud.',
  copiedUrlSrcset:
    'Kopeeriti URL, mille brauser tegelikult laadis (variant srcset-ist).',
  copiedImgUrl: 'Pildi URL kopeeritud.',
  noImagesFound: 'Sobivaid pilte ei leitud (näitame ainult alates 64×64).',
  pickImageTitle: 'Vali pilt',
  noTablesFound:
    'Tabeleid ei leitud. Loeme ainult <table> silti: kui tabel on joonistatud div-i või Canvas-e abil, me seda ei näe.',
  candTableLabel: '{rows} × {cols}',
  pickTablesTitle: 'Vali tabelid',
  pickTableTitle: 'Vali tabel',
  imgRefusal:
    'Brauser ei luba meil salvestada pilti domeenilt {host}: võõraste domeenide puhul download-atribuuti eiratakse ja salvestamise asemel toimuks lingile liikumine. Meie seda ei tee. Ka CORS-i see server ei lubanud.',
  otherSite: 'teiselt saidilt',
  openImage: 'Ava pilt',
  enablePermission: 'Luba õigus…',
  imageWord: 'Pilt',
  copyUrl: 'Kopeeri URL',
  openInNewTab: 'Ava uuel vahelehel',
  saveDots: 'Salvesta…',
  clipboardFailTitle: 'Lõikelauale kirjutamine ebaõnnestus',
  clipboardFailBody: 'Kopeeri käsitsi: Ctrl+C (⌘+C). Tekst on juba valitud.',

  menuRoot: 'Salvesta lehe sisu',
  menuSelMd: 'Salvesta valik .md-na',
  menuSelTxt: 'Salvesta valik .txt-na',
  menuSelCopyMd: 'Kopeeri Markdownina',
  menuTableItem: 'Ekspordi tabel…',
  menuImgCopyUrl: 'Kopeeri pildi URL',
  menuImgOpenTab: 'Ava pilt uuel vahelehel',
  menuImgSave: 'Salvesta pilt…',
  menuTableAll: 'Ekspordi kõik tabelid…',
  menuSettings: 'Ekspordi seaded…',
  downloadsNotGranted: 'Õigust „Halda allalaadimisi“ pole antud',
  unsafeUrl: 'Ebaturvaline aadress',
  downloadsApiUnavailable: 'Allalaadimiste API pole saadaval',
  noTab: 'Vahelehte pole',
  fileTooBig: 'Fail on selle meetodi jaoks liiga suur (>8 MB)',

  injectNoScriptApi: 'Brauser ei luba meil sellele lehele skripti sisestada.',
  injectNoActiveTab: 'Aktiivset vahelehte pole',
  injectRestrictedPage:
    'Laiendused ei saa sellel lehel töötada (brauseri süsteemileht, lisandite pood või PDF).',
  injectNoResponse: 'Leht ei vastanud. Laadi see uuesti ja proovi uuesti.',
};

const messages: Catalog<MsgKey> = { en, ru, et };

const translate = createTranslator<MsgKey>(messages);

/** React hook: `const t = useT(); t('key', { name: 'x' })`. */
export function useT() {
  const locale = useLocale();
  return useCallback(
    (k: MsgKey, v?: Record<string, string | number>) => translate(locale, k, v),
    [locale],
  );
}

/** Non-React translator for the on-page DOM builders and the background. */
export function tAt(
  locale: Locale,
  k: MsgKey,
  v?: Record<string, string | number>,
): string {
  return translate(locale, k, v);
}

/** BCP-47 tag for `Number.toLocaleString` so grouped counts match the UI language. */
export function localeTag(locale: Locale): string {
  return locale === 'ru' ? 'ru-RU' : locale === 'et' ? 'et-EE' : 'en-US';
}
