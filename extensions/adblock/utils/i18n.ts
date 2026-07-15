import { createTranslator, useLocale, type Catalog, type Locale } from '@blur/ui';
import { useCallback } from 'react';
import { degradedNotice } from './backends/rule-budget';

// Runtime UI catalog for the Ad & Tracker Blocker. English is the source of truth
// AND the default (see @blur/ui's DEFAULT_LOCALE); `ru` and `et` are complete
// mirrors. Switching the locale re-renders every surface (popup, options) and
// re-titles the context menus and re-labels the in-page picker / undo toast.
//
// 🔴 What is deliberately NOT translated (house rules):
//   - Filter-rule data: CSS selectors, list titles from the generated manifest,
//     example hostnames/URLs, API names (declarativeNetRequest…), numbers, §refs.
//   - Storage keys, comments, console text, CSS class names.
// The English `en` values below are copied VERBATIM from the pre-i18n source, so
// the default locale renders byte-identically.

/** A translator bound to a locale — produced by both `useT()` (React) and the
 *  content-script/background closures over `tAt`. */
export type TFn = (key: MsgKey, vars?: Record<string, string | number>) => string;

const en = {
  /* ---- shared / brand ---- */
  appName: 'Ad & Tracker Blocker',
  loading: 'Loading…',
  cancel: 'Cancel',
  grantAccess: 'Grant access',
  addBtn: 'Add',
  removeBtn: 'Remove',
  exportHeading: 'Export',
  periodOnly: '.',

  /* ---- language switcher ---- */
  language: 'Language',
  interfaceLanguage: 'Interface language',

  /* ---- popup: header + site row ---- */
  toggleEverywhere: 'Turn blocking on or off everywhere',
  offEverywhere: 'Turned off everywhere',
  protectionOn: 'Protection on',
  thisPage: 'This page',
  blockingNotHere: "Blocking doesn't run here",
  pausedTurnOnAbove: 'Paused — turn on above',
  blockingOnSite: 'Blocking on this site',
  pausedOnSite: 'Paused on this site',
  enableOnSite: 'Enable on this site',
  enableBlockingOnSite: 'Enable blocking on this site',

  /* ---- popup: per-site tools ---- */
  hideElementsAria: 'Hide page elements on this site',
  hideElementsLabel: 'Hide page elements (cosmetic) on this site',
  blockElementBtn: 'Block an element on this page…',
  pickElementAria: 'Pick an element on this page to block',

  /* ---- popup: hidden-by-you list ---- */
  hiddenByYou: 'Hidden by you on this site',
  hidingOffCaveat: 'Hiding is off on this site right now, so these are not applied.',
  allSitesTag: 'all sites',
  showWhereAria: 'Show where {name} is on the page',
  showBtn: 'Show',
  restoreAria: 'Restore {name}',
  restoreBtn: 'Restore',
  restoreAllAria: 'Restore all {count} elements hidden on {host}',
  restoreAllPre: 'Restore all {count} on ',

  /* ---- popup: stats ---- */
  measuring: 'Measuring… nothing blocked on this page yet.',
  cantRunHere: 'Ad & Tracker Blocker can’t run on this page.',
  statHidden: 'Hidden',
  statBlocked: 'Blocked',
  statTrackers: 'Trackers',
  approxCaveat:
    'Blocked and tracker counts on this browser are a best-effort estimate for this page. The hidden count is exact.',
  filterListsMatched: 'Filter lists matched here',

  /* ---- list display names (popup breakdown + degraded notice) ---- */
  listAds: 'Ads (EasyList)',
  listTrackers: 'Trackers (EasyPrivacy)',
  listAnnoyances: 'Annoyances',

  /* ---- popup: aggregate totals ---- */
  aggFirefox: 'Ads, trackers and elements removed',
  aggChromium: 'Elements hidden',
  exactParen: '(exact)',
  since: 'since {date}',
  today: 'Today',
  week: 'Week',
  total: 'Total',

  /* ---- strictness (shared popup + options) ---- */
  strictness: 'Strictness',
  levelOffLabel: 'Off',
  levelOffDesc: 'No network or cosmetic filtering.',
  levelStandardLabel: 'Standard',
  levelStandardDesc: 'EasyList + EasyPrivacy. Site-specific cosmetic rules only.',
  levelAggressiveLabel: 'Aggressive',
  levelAggressiveDesc:
    'Adds the annoyances list plus generic cosmetic filtering. May break some sites.',
  mayBreakSites: 'may break sites',

  /* ---- trackers & annoyances (popup) ---- */
  trackersAnnoyances: 'Trackers & annoyances',
  blockTrackers: 'Block trackers',
  stripParams: 'Strip tracking parameters',
  blockAnnoyanceReq: 'Block annoyance requests',
  stripNeedsAccess: 'Stripping tracking parameters needs site access to run.',
  annoyanceNotePre:
    '"Block annoyance requests" toggles the network annoyances list only. Hiding leftover on-page clutter (cookie banners, pop-ups) is cosmetic filtering, turned on by the ',
  annoyanceNotePost: ' strictness level above.',

  /* ---- pause row (popup) ---- */
  pausedEverywhereLeft: 'Paused everywhere · {n} min left',
  resumeNow: 'Resume now',
  alreadyOff: 'Blocking is already off everywhere',
  takeBreak: 'Take a break from blocking',
  pauseFor: 'Pause {n} min',
  openSettings: 'Open settings',

  /* ---- options: master ---- */
  masterTitle: 'Ad & tracker blocking',
  masterOn: 'On — filtering runs on every site except those you exclude below.',
  masterOff: 'Off — nothing is blocked or hidden on any site.',

  /* ---- options: tabs ---- */
  tabBlocking: 'Blocking',
  tabLists: 'Filter lists',
  tabTrackers: 'Trackers',
  tabSites: 'Sites',
  tabFilters: 'My filters',
  tabBackup: 'Backup',
  tabAbout: 'About',
  tabsAria: 'Settings sections',
  regionAria: '{name} settings',

  /* ---- options: blocking tab ---- */
  whatEachLevel: 'What each level does',
  explainOff: ' — nothing is blocked or hidden.',
  explainStandard:
    ' — blocks ads and known trackers, and hides ad slots on sites we have specific rules for. Safe on virtually every site.',
  explainAggressive:
    " — also hides common page clutter everywhere (cookie banners, newsletter pop-ups, leftover ad boxes). More thorough, but can occasionally break a site's layout.",
  technicalDetails: 'Technical details',
  techLevel1Pre: 'Each level toggles the bundled static rulesets via ',
  techLevel2a: '"Hiding page clutter" is ',
  emCosmeticFiltering: 'cosmetic filtering',
  techLevel2b: ' — ',
  techLevel2c: ' rules injected by the content script. Only ',
  emGeneric: 'generic',
  techLevel2d:
    ' cosmetic filtering (selectors applied on every site) is enabled at Aggressive; it is what occasionally breaks layouts, so it stays off at Standard.',

  /* ---- options: filter lists tab ---- */
  noRulesetsA: 'No generated rulesets found. Run ',
  noRulesetsB: ' to build them from ',
  listsNote1a: 'Turn individual lists on or off. Picking a strictness level on the ',
  listsNote1b:
    ' tab sets these as a starting point; you can then override any single list here.',
  listsNote2a: 'The ',
  listsNote2b: ' list blocks ',
  emNetworkRequests: 'network requests',
  listsNote2c:
    ' for cookie-consent and newsletter widgets. Hiding leftover on-page clutter (cookie banners, pop-ups) is ',
  emCosmetic: 'cosmetic',
  listsNote2d: ' filtering — governed by the ',
  listsNote2e: ' strictness level on the ',
  listsNote2f:
    ' tab, not by this toggle. Turning this list off still leaves that clutter hidden at Aggressive.',
  strictnessOffNote: 'Strictness is Off, so no list filters right now.',
  blockingOffNote: 'Blocking is turned off everywhere, so no list filters right now.',
  choicesKept: ' Your choices below are kept and apply once it is back on.',
  degradedRetry:
    ' Its switch stays on below, and it is retried automatically — it will start filtering as soon as the budget allows.',
  thOn: 'On',
  thList: 'List',
  thRules: 'Rules',
  thLicense: 'License',
  toggleList: 'Toggle {name}',
  enableList: 'Enable {name}',
  notActiveBudget: ' — not active (no rule budget)',
  peterLoweA: "Peter Lowe's list is free for ",
  emPersonal: 'personal / non-commercial',
  peterLoweB:
    ' use only and needs permission for commercial redistribution, so it is deliberately NOT bundled here.',
  techBudget: 'Technical details (rule budget)',
  budgetAt: 'Rule budget at ',
  budgetOver:
    "Exceeds Chrome's guaranteed 30,000 static rules. The overflow falls back to the shared 300,000 global pool, which is best-effort and can be exhausted by other extensions.",
  budgetNoteA: 'Chrome guarantees ',
  budgetNoteB: ' enabled static rules per extension, plus a ',
  budgetNoteC:
    '-rule pool shared across all installed extensions. A full EasyList + EasyPrivacy set fits inside the per-extension guarantee.',

  /* ---- options: trackers tab ---- */
  blockKnownTrackers: 'Block known trackers',
  stripFromLinks: 'Strip tracking parameters from links',
  paramNeedsAccess: 'Parameter stripping needs site access to run on this browser.',
  trackParamsNoteA: 'Tracking parameters are the extra tags added to links (like ',
  trackParamsNoteB: ' or ',
  trackParamsNoteC:
    ') that let sites follow you between pages. Removing them takes you to the same destination without the tracking tag.',
  trackTechA: 'Parameter stripping is a single DNR ',
  trackTechB: ' rule using ',
  trackTechC: '. Rules that rewrite a URL count as "unsafe" and are capped at ',
  trackTechD: ' across the extension (PLAN.md §4.1).',
  trackTech2A:
    'A future addition: a Privacy Badger–style heuristic that flags a domain as a tracker once it is seen on ≥3 unrelated sites. EFF ported Privacy Badger to MV3 in 2024, learning by observing ',
  trackTech2B: ' and blocking via ',
  emDynamic: 'dynamic',
  trackTech2C: ' DNR rules (PLAN.md §4.3).',

  /* ---- options: sites tab ---- */
  sitesNoteA:
    'Sites listed here are fully excluded — no network or cosmetic filtering runs on them. Paste a full URL or just the hostname; it is normalized to a bare host (e.g. ',
  sitesNoteB: ' → ',
  sitesNoteC: ').',
  placeholderSite: 'example.com or https://example.com/page',
  excludeAria: 'Site to exclude from blocking',
  invalidSite: 'Enter a valid site, e.g. example.com.',
  alreadyExcluded: '{host} is already excluded.',
  noExcluded:
    'No excluded sites yet. Add a hostname above to turn blocking off for that site.',
  removeHost: 'Remove {host}',
  bulkImport: 'Bulk import',
  bulkNote:
    'One site per line (or comma-separated). Full URLs are accepted and normalized to a bare host. Existing entries are skipped.',
  bulkAria: 'Sites to exclude, one per line',
  importSites: 'Import sites',
  nothingToImport: 'Nothing to import.',
  addedSiteOne: 'Added {n} site',
  addedSiteOther: 'Added {n} sites',
  skippedLineOne: '; skipped {n} unparseable line.',
  skippedLineOther: '; skipped {n} unparseable lines.',
  sitesExportAria: 'Excluded sites as text',

  /* ---- options: my filters tab ---- */
  filtersNote1a: 'Your own cosmetic rules hide elements with ',
  filtersNote1b: '. They apply at ',
  emEvery: 'every',
  filtersNote1c:
    ' level (even Standard) because they are your explicit choice — unlike the generic list, which only turns on at Aggressive. Use ',
  boldBlockAnElement: 'Block an element on this page',
  filtersNote1d: ' in the toolbar popup to pick visually.',
  filtersNote2a:
    'To bring one back you do not need this page: right after you hide an element the page itself offers ',
  boldUndo: 'Undo',
  filtersNote2b: ', and the toolbar popup lists everything you have hidden ',
  emOnSiteYouAreOn: 'on the site you are on',
  filtersNote2c: ' with a ',
  boldRestore: 'Restore',
  filtersNote2d: ' button for each. This tab is the full, cross-site list.',
  addRule: 'Add a rule',
  placeholderHost: 'host (blank = all sites)',
  hostAria: 'Host for this cosmetic rule (blank for all sites)',
  placeholderSelector: 'CSS selector, e.g. .promo-box',
  selectorAria: 'CSS selector to hide',
  yourRules: 'Your rules',
  noCustomRules: 'No custom rules yet.',
  allSites: 'All sites',
  removeSelector: 'Remove {selector} from {host}',
  importHeading: 'Import (paste EasyList cosmetic rules)',
  importNoteA: 'One rule per line: ',
  importNoteB: ' (site-specific) or ',
  importNoteC: ' (all sites). ',
  importNoteD:
    'Network rules and extended (non-CSS) syntax are skipped — network blocking is handled by the bundled DNR rulesets, and remote list fetching is out of scope (it needs extra host permissions and review).',
  pasteAria: 'Paste EasyList cosmetic rules',
  importPastedBtn: 'Import pasted rules',
  importedRuleOne: 'Imported {n} cosmetic rule',
  importedRuleOther: 'Imported {n} cosmetic rules',
  skippedRules: '; skipped {n} (network rules and unsupported syntax — see below).',
  filtersExportAria: 'Your cosmetic rules as text',

  /* ---- options: backup ---- */
  backupRestore: 'Backup & restore',
  backupNote:
    'Export your settings, excluded sites, per-site options and custom filters as JSON — or paste a previously exported document and import it.',
  exportBtn: 'Export',
  downloadJson: 'Download .json',
  importBtn: 'Import',
  exportedStatus: 'Exported. Copy the JSON below or download it.',
  backupPlaceholder: 'Exported JSON appears here; paste JSON to import.',
  backupAria: 'Settings backup JSON',
  importedApplied: 'Imported and applied.',
  importFailed: 'Import failed: {msg}',

  /* ---- options: about ---- */
  filterListBuild: 'Filter list build: ',
  countingSince: 'Counting since ',
  privacyNote:
    'Privacy: no browsing data leaves your device. Filtering, counting and allowlisting all happen locally.',
  companionNote:
    'Content blurring and the developer toolkit are separate companion extensions in this suite — each ships on its own to keep every add-on to one narrow purpose (PLAN.md §0).',
  statisticsHeading: 'Statistics',
  resetNote:
    "The lifetime counter (today, this week and total) shown in the toolbar popup. Resetting clears it to zero and can't be undone.",
  confirmReset: 'Confirm reset',
  resetStats: 'Reset statistics',
  statsReset: 'Statistics reset to zero.',

  /* ---- degraded notice (ru/et template; en uses the pure rule-budget copy) ---- */
  andJoin: ' and ',
  degradedTemplate: '',

  /* ---- in-page element picker (content script) ---- */
  pickerInstruction: 'Click an element to block it · press Esc to cancel',
  pickerBlock: 'Block: {selector}',

  /* ---- in-page undo toast (content script) ---- */
  toastHidden: 'Element hidden',
  toastRestored: 'Element restored',
  undoBtn: 'Undo',
  undoAria: 'Undo hiding {desc}',
  thisElement: 'this element',
  dismissBtn: 'Dismiss',

  /* ---- context menus (background) ---- */
  ctxBlockElement: 'Block this element…',
  ctxPauseSite: 'Pause on this site',
} as const;

export type MsgKey = keyof typeof en;

const ru: Record<MsgKey, string> = {
  appName: 'Блокировщик рекламы и трекеров',
  loading: 'Загрузка…',
  cancel: 'Отмена',
  grantAccess: 'Предоставить доступ',
  addBtn: 'Добавить',
  removeBtn: 'Удалить',
  exportHeading: 'Экспорт',
  periodOnly: '.',

  language: 'Язык',
  interfaceLanguage: 'Язык интерфейса',

  toggleEverywhere: 'Включить или выключить блокировку везде',
  offEverywhere: 'Выключено везде',
  protectionOn: 'Защита включена',
  thisPage: 'Эта страница',
  blockingNotHere: 'Здесь блокировка не работает',
  pausedTurnOnAbove: 'Приостановлено — включите выше',
  blockingOnSite: 'Блокировка на этом сайте',
  pausedOnSite: 'Приостановлено на этом сайте',
  enableOnSite: 'Включить на этом сайте',
  enableBlockingOnSite: 'Включить блокировку на этом сайте',

  hideElementsAria: 'Скрывать элементы страницы на этом сайте',
  hideElementsLabel: 'Скрывать элементы страницы (косметика) на этом сайте',
  blockElementBtn: 'Заблокировать элемент на этой странице…',
  pickElementAria: 'Выбрать элемент на этой странице для блокировки',

  hiddenByYou: 'Скрыто вами на этом сайте',
  hidingOffCaveat: 'Скрытие сейчас выключено на этом сайте, поэтому это не применяется.',
  allSitesTag: 'все сайты',
  showWhereAria: 'Показать, где на странице находится {name}',
  showBtn: 'Показать',
  restoreAria: 'Восстановить {name}',
  restoreBtn: 'Восстановить',
  restoreAllAria: 'Восстановить все скрытые элементы ({count}) на {host}',
  restoreAllPre: 'Восстановить все ({count}) на ',

  measuring: 'Измерение… на этой странице пока ничего не заблокировано.',
  cantRunHere: 'Блокировщик рекламы и трекеров не может работать на этой странице.',
  statHidden: 'Скрыто',
  statBlocked: 'Заблокировано',
  statTrackers: 'Трекеры',
  approxCaveat:
    'Счётчики заблокированного и трекеров в этом браузере — приблизительная оценка для этой страницы. Счётчик скрытого точный.',
  filterListsMatched: 'Списки фильтров, сработавшие здесь',

  listAds: 'Реклама (EasyList)',
  listTrackers: 'Трекеры (EasyPrivacy)',
  listAnnoyances: 'Раздражители',

  aggFirefox: 'Реклама, трекеры и удалённые элементы',
  aggChromium: 'Скрыто элементов',
  exactParen: '(точно)',
  since: 'с {date}',
  today: 'Сегодня',
  week: 'Неделя',
  total: 'Всего',

  strictness: 'Строгость',
  levelOffLabel: 'Выключено',
  levelOffDesc: 'Ни сетевой, ни косметической фильтрации.',
  levelStandardLabel: 'Стандартная',
  levelStandardDesc: 'EasyList + EasyPrivacy. Только косметические правила для конкретных сайтов.',
  levelAggressiveLabel: 'Агрессивная',
  levelAggressiveDesc:
    'Добавляет список раздражителей и общую косметическую фильтрацию. Может ломать некоторые сайты.',
  mayBreakSites: 'может ломать сайты',

  trackersAnnoyances: 'Трекеры и раздражители',
  blockTrackers: 'Блокировать трекеры',
  stripParams: 'Убирать параметры отслеживания',
  blockAnnoyanceReq: 'Блокировать запросы раздражителей',
  stripNeedsAccess: 'Для удаления параметров отслеживания нужен доступ к сайту.',
  annoyanceNotePre:
    '«Блокировать запросы раздражителей» переключает только сетевой список раздражителей. Скрытие оставшегося на странице мусора (баннеры о cookie, всплывающие окна) — это косметическая фильтрация, включаемая уровнем строгости ',
  annoyanceNotePost: ' выше.',

  pausedEverywhereLeft: 'Приостановлено везде · осталось {n} мин',
  resumeNow: 'Возобновить сейчас',
  alreadyOff: 'Блокировка уже выключена везде',
  takeBreak: 'Сделать перерыв в блокировке',
  pauseFor: 'Пауза {n} мин',
  openSettings: 'Открыть настройки',

  masterTitle: 'Блокировка рекламы и трекеров',
  masterOn: 'Включено — фильтрация работает на каждом сайте, кроме исключённых ниже.',
  masterOff: 'Выключено — ничего не блокируется и не скрывается ни на одном сайте.',

  tabBlocking: 'Блокировка',
  tabLists: 'Списки фильтров',
  tabTrackers: 'Трекеры',
  tabSites: 'Сайты',
  tabFilters: 'Мои фильтры',
  tabBackup: 'Резервная копия',
  tabAbout: 'О расширении',
  tabsAria: 'Разделы настроек',
  regionAria: 'Настройки: {name}',

  whatEachLevel: 'Что делает каждый уровень',
  explainOff: ' — ничего не блокируется и не скрывается.',
  explainStandard:
    ' — блокирует рекламу и известные трекеры и скрывает рекламные блоки на сайтах, для которых у нас есть специальные правила. Безопасно почти на любом сайте.',
  explainAggressive:
    ' — также скрывает распространённый мусор на страницах повсюду (баннеры о cookie, всплывающие окна подписки, оставшиеся рекламные блоки). Тщательнее, но иногда может ломать вёрстку сайта.',
  technicalDetails: 'Технические подробности',
  techLevel1Pre: 'Каждый уровень переключает встроенные статические наборы правил через ',
  techLevel2a: '«Скрытие мусора на странице» — это ',
  emCosmeticFiltering: 'косметическая фильтрация',
  techLevel2b: ' — ',
  techLevel2c: ' правила, внедряемые контент-скриптом. Только ',
  emGeneric: 'общая',
  techLevel2d:
    ' косметическая фильтрация (селекторы, применяемые на каждом сайте) включается на уровне «Агрессивная»; именно она иногда ломает вёрстку, поэтому на «Стандартной» она выключена.',

  noRulesetsA: 'Сгенерированные наборы правил не найдены. Запустите ',
  noRulesetsB: ', чтобы собрать их из ',
  listsNote1a: 'Включайте или выключайте отдельные списки. Выбор уровня строгости на вкладке ',
  listsNote1b:
    ' задаёт их как отправную точку; затем любой отдельный список можно переопределить здесь.',
  listsNote2a: 'Список ',
  listsNote2b: ' блокирует ',
  emNetworkRequests: 'сетевые запросы',
  listsNote2c:
    ' виджетов согласия на cookie и подписки. Скрытие оставшегося на странице мусора (баннеры о cookie, всплывающие окна) — это ',
  emCosmetic: 'косметическая',
  listsNote2d: ' фильтрация — управляемая уровнем строгости ',
  listsNote2e: ' на вкладке ',
  listsNote2f:
    ', а не этим переключателем. Выключение этого списка всё равно оставляет этот мусор скрытым на «Агрессивной».',
  strictnessOffNote: 'Строгость «Выключено», поэтому сейчас ни один список не фильтрует.',
  blockingOffNote: 'Блокировка выключена везде, поэтому сейчас ни один список не фильтрует.',
  choicesKept: ' Ваш выбор ниже сохраняется и применится, как только всё снова включится.',
  degradedRetry:
    ' Его переключатель остаётся включённым ниже, и он повторяется автоматически — он начнёт фильтровать, как только позволит бюджет.',
  thOn: 'Вкл',
  thList: 'Список',
  thRules: 'Правил',
  thLicense: 'Лицензия',
  toggleList: 'Переключить {name}',
  enableList: 'Включить {name}',
  notActiveBudget: ' — не активно (нет бюджета правил)',
  peterLoweA: 'Список Peter Lowe бесплатен только для ',
  emPersonal: 'личного / некоммерческого',
  peterLoweB:
    ' использования и требует разрешения для коммерческого распространения, поэтому он намеренно НЕ включён сюда.',
  techBudget: 'Технические подробности (бюджет правил)',
  budgetAt: 'Бюджет правил при уровне ',
  budgetOver:
    'Превышает гарантированные Chrome 30 000 статических правил. Излишек берётся из общего пула на 300 000 правил, который предоставляется по возможности и может быть исчерпан другими расширениями.',
  budgetNoteA: 'Chrome гарантирует ',
  budgetNoteB: ' включённых статических правил на расширение плюс пул на ',
  budgetNoteC:
    ' правил, общий для всех установленных расширений. Полный набор EasyList + EasyPrivacy умещается в гарантию для одного расширения.',

  blockKnownTrackers: 'Блокировать известные трекеры',
  stripFromLinks: 'Убирать параметры отслеживания из ссылок',
  paramNeedsAccess: 'Для удаления параметров нужен доступ к сайту в этом браузере.',
  trackParamsNoteA: 'Параметры отслеживания — это дополнительные метки, добавляемые к ссылкам (например, ',
  trackParamsNoteB: ' или ',
  trackParamsNoteC:
    '), которые позволяют сайтам следить за вами при переходах между страницами. Их удаление приводит вас к тому же месту назначения без метки отслеживания.',
  trackTechA: 'Удаление параметров — это единственное DNR-правило ',
  trackTechB: ', использующее ',
  trackTechC: '. Правила, переписывающие URL, считаются «небезопасными» и ограничены ',
  trackTechD: ' на всё расширение (PLAN.md §4.1).',
  trackTech2A:
    'Возможное дополнение в будущем: эвристика в духе Privacy Badger, помечающая домен как трекер, когда он замечен на ≥3 несвязанных сайтах. EFF перенесла Privacy Badger на MV3 в 2024 году: она обучается, наблюдая ',
  trackTech2B: ', и блокирует через ',
  emDynamic: 'динамические',
  trackTech2C: ' DNR-правила (PLAN.md §4.3).',

  sitesNoteA:
    'Перечисленные здесь сайты полностью исключены — на них не работает ни сетевая, ни косметическая фильтрация. Вставьте полный URL или просто имя хоста; оно нормализуется до чистого хоста (например, ',
  sitesNoteB: ' → ',
  sitesNoteC: ').',
  placeholderSite: 'example.com или https://example.com/page',
  excludeAria: 'Сайт для исключения из блокировки',
  invalidSite: 'Введите корректный сайт, например example.com.',
  alreadyExcluded: '{host} уже исключён.',
  noExcluded:
    'Исключённых сайтов пока нет. Добавьте имя хоста выше, чтобы выключить блокировку для этого сайта.',
  removeHost: 'Удалить {host}',
  bulkImport: 'Массовый импорт',
  bulkNote:
    'По одному сайту в строке (или через запятую). Полные URL принимаются и нормализуются до чистого хоста. Существующие записи пропускаются.',
  bulkAria: 'Сайты для исключения, по одному в строке',
  importSites: 'Импортировать сайты',
  nothingToImport: 'Нечего импортировать.',
  addedSiteOne: 'Добавлен {n} сайт',
  addedSiteOther: 'Добавлено сайтов: {n}',
  skippedLineOne: '; пропущена {n} нераспознанная строка.',
  skippedLineOther: '; пропущено нераспознанных строк: {n}.',
  sitesExportAria: 'Исключённые сайты как текст',

  filtersNote1a: 'Ваши собственные косметические правила скрывают элементы через ',
  filtersNote1b: '. Они применяются на ',
  emEvery: 'каждом',
  filtersNote1c:
    ' уровне (даже на «Стандартной»), потому что это ваш явный выбор — в отличие от общего списка, который включается только на «Агрессивной». Используйте ',
  boldBlockAnElement: 'Заблокировать элемент на этой странице',
  filtersNote1d: ' во всплывающем окне на панели, чтобы выбрать визуально.',
  filtersNote2a:
    'Чтобы вернуть элемент, эта страница не нужна: сразу после того как вы скроете элемент, страница сама предлагает ',
  boldUndo: 'Отменить',
  filtersNote2b: ', а всплывающее окно на панели перечисляет всё, что вы скрыли ',
  emOnSiteYouAreOn: 'на сайте, где вы находитесь',
  filtersNote2c: ', с кнопкой ',
  boldRestore: 'Восстановить',
  filtersNote2d: ' для каждого. Эта вкладка — полный список по всем сайтам.',
  addRule: 'Добавить правило',
  placeholderHost: 'хост (пусто = все сайты)',
  hostAria: 'Хост для этого косметического правила (пусто для всех сайтов)',
  placeholderSelector: 'CSS-селектор, например .promo-box',
  selectorAria: 'CSS-селектор для скрытия',
  yourRules: 'Ваши правила',
  noCustomRules: 'Пользовательских правил пока нет.',
  allSites: 'Все сайты',
  removeSelector: 'Удалить {selector} из {host}',
  importHeading: 'Импорт (вставьте косметические правила EasyList)',
  importNoteA: 'По одному правилу в строке: ',
  importNoteB: ' (для конкретного сайта) или ',
  importNoteC: ' (все сайты). ',
  importNoteD:
    'Сетевые правила и расширенный (не-CSS) синтаксис пропускаются — сетевая блокировка обеспечивается встроенными наборами DNR-правил, а загрузка удалённых списков вне рамок (для неё нужны дополнительные разрешения на хосты и проверка).',
  pasteAria: 'Вставьте косметические правила EasyList',
  importPastedBtn: 'Импортировать вставленные правила',
  importedRuleOne: 'Импортировано {n} косметическое правило',
  importedRuleOther: 'Импортировано косметических правил: {n}',
  skippedRules: '; пропущено {n} (сетевые правила и неподдерживаемый синтаксис — см. ниже).',
  filtersExportAria: 'Ваши косметические правила как текст',

  backupRestore: 'Резервное копирование и восстановление',
  backupNote:
    'Экспортируйте свои настройки, исключённые сайты, параметры для отдельных сайтов и пользовательские фильтры в JSON — или вставьте ранее экспортированный документ и импортируйте его.',
  exportBtn: 'Экспорт',
  downloadJson: 'Скачать .json',
  importBtn: 'Импорт',
  exportedStatus: 'Экспортировано. Скопируйте JSON ниже или скачайте его.',
  backupPlaceholder: 'Здесь появится экспортированный JSON; вставьте JSON для импорта.',
  backupAria: 'JSON резервной копии настроек',
  importedApplied: 'Импортировано и применено.',
  importFailed: 'Импорт не удался: {msg}',

  filterListBuild: 'Сборка списка фильтров: ',
  countingSince: 'Подсчёт с ',
  privacyNote:
    'Конфиденциальность: никакие данные о просмотре не покидают ваше устройство. Фильтрация, подсчёт и списки исключений происходят локально.',
  companionNote:
    'Размытие контента и набор инструментов разработчика — это отдельные сопутствующие расширения в этом наборе; каждое поставляется само по себе, чтобы каждое дополнение служило одной узкой цели (PLAN.md §0).',
  statisticsHeading: 'Статистика',
  resetNote:
    'Пожизненный счётчик (сегодня, за неделю и всего), показываемый во всплывающем окне на панели. Сброс обнуляет его, и это нельзя отменить.',
  confirmReset: 'Подтвердить сброс',
  resetStats: 'Сбросить статистику',
  statsReset: 'Статистика обнулена.',

  andJoin: ' и ',
  degradedTemplate:
    'Не удалось включить: {names}. Бюджет фильтрующих правил этого браузера общий с другими вашими расширениями и сейчас заполнен. Остальные ваши списки продолжают блокировать в обычном режиме. Освободить бюджет поможет удаление другого блокировщика контента.',

  pickerInstruction: 'Щёлкните по элементу, чтобы заблокировать его · нажмите Esc для отмены',
  pickerBlock: 'Блокировать: {selector}',

  toastHidden: 'Элемент скрыт',
  toastRestored: 'Элемент восстановлен',
  undoBtn: 'Отменить',
  undoAria: 'Отменить скрытие: {desc}',
  thisElement: 'этот элемент',
  dismissBtn: 'Закрыть',

  ctxBlockElement: 'Заблокировать этот элемент…',
  ctxPauseSite: 'Приостановить на этом сайте',
};

const et: Record<MsgKey, string> = {
  appName: 'Reklaami- ja jälgijablokeerija',
  loading: 'Laadimine…',
  cancel: 'Tühista',
  grantAccess: 'Anna juurdepääs',
  addBtn: 'Lisa',
  removeBtn: 'Eemalda',
  exportHeading: 'Ekspordi',
  periodOnly: '.',

  language: 'Keel',
  interfaceLanguage: 'Liidese keel',

  toggleEverywhere: 'Lülita blokeerimine kõikjal sisse või välja',
  offEverywhere: 'Kõikjal välja lülitatud',
  protectionOn: 'Kaitse sees',
  thisPage: 'See leht',
  blockingNotHere: 'Siin blokeerimine ei tööta',
  pausedTurnOnAbove: 'Peatatud — lülita ülal sisse',
  blockingOnSite: 'Blokeerimine sellel saidil',
  pausedOnSite: 'Sellel saidil peatatud',
  enableOnSite: 'Luba sellel saidil',
  enableBlockingOnSite: 'Luba blokeerimine sellel saidil',

  hideElementsAria: 'Peida lehe elemendid sellel saidil',
  hideElementsLabel: 'Peida lehe elemendid (kosmeetiline) sellel saidil',
  blockElementBtn: 'Blokeeri element sellel lehel…',
  pickElementAria: 'Vali sellel lehel element blokeerimiseks',

  hiddenByYou: 'Sinu peidetud sellel saidil',
  hidingOffCaveat: 'Peitmine on sellel saidil praegu välja lülitatud, seega neid ei rakendata.',
  allSitesTag: 'kõik saidid',
  showWhereAria: 'Näita, kus {name} lehel asub',
  showBtn: 'Näita',
  restoreAria: 'Taasta {name}',
  restoreBtn: 'Taasta',
  restoreAllAria: 'Taasta kõik {count} saidil {host} peidetud elementi',
  restoreAllPre: 'Taasta kõik {count} saidil ',

  measuring: 'Mõõtmine… sellel lehel pole veel midagi blokeeritud.',
  cantRunHere: 'Reklaami- ja jälgijablokeerija ei saa sellel lehel töötada.',
  statHidden: 'Peidetud',
  statBlocked: 'Blokeeritud',
  statTrackers: 'Jälgijad',
  approxCaveat:
    'Blokeeritute ja jälgijate arv on selles brauseris parim võimalik hinnang selle lehe kohta. Peidetute arv on täpne.',
  filterListsMatched: 'Siin sobitunud filtriloendid',

  listAds: 'Reklaamid (EasyList)',
  listTrackers: 'Jälgijad (EasyPrivacy)',
  listAnnoyances: 'Tüütused',

  aggFirefox: 'Eemaldatud reklaamid, jälgijad ja elemendid',
  aggChromium: 'Peidetud elemente',
  exactParen: '(täpne)',
  since: 'alates {date}',
  today: 'Täna',
  week: 'Nädal',
  total: 'Kokku',

  strictness: 'Rangus',
  levelOffLabel: 'Väljas',
  levelOffDesc: 'Ei võrgu- ega kosmeetilist filtreerimist.',
  levelStandardLabel: 'Standardne',
  levelStandardDesc: 'EasyList + EasyPrivacy. Ainult saidipõhised kosmeetilised reeglid.',
  levelAggressiveLabel: 'Agressiivne',
  levelAggressiveDesc:
    'Lisab tüütuste loendi ja üldise kosmeetilise filtreerimise. Võib mõne saidi rikkuda.',
  mayBreakSites: 'võib saite rikkuda',

  trackersAnnoyances: 'Jälgijad ja tüütused',
  blockTrackers: 'Blokeeri jälgijad',
  stripParams: 'Eemalda jälgimisparameetrid',
  blockAnnoyanceReq: 'Blokeeri tüütuste päringud',
  stripNeedsAccess: 'Jälgimisparameetrite eemaldamiseks on vaja juurdepääsu saidile.',
  annoyanceNotePre:
    '„Blokeeri tüütuste päringud“ lülitab ainult võrgutüütuste loendit. Lehele jäänud segaduse (küpsiseribad, hüpikaknad) peitmine on kosmeetiline filtreerimine, mille lülitab sisse rangusaste ',
  annoyanceNotePost: ' ülal.',

  pausedEverywhereLeft: 'Kõikjal peatatud · jäänud {n} min',
  resumeNow: 'Jätka kohe',
  alreadyOff: 'Blokeerimine on juba kõikjal väljas',
  takeBreak: 'Tee blokeerimisest paus',
  pauseFor: 'Paus {n} min',
  openSettings: 'Ava seaded',

  masterTitle: 'Reklaami- ja jälgijablokeerimine',
  masterOn: 'Sees — filtreerimine töötab igal saidil peale allpool väljajäetute.',
  masterOff: 'Väljas — ühelgi saidil ei blokeerita ega peideta midagi.',

  tabBlocking: 'Blokeerimine',
  tabLists: 'Filtriloendid',
  tabTrackers: 'Jälgijad',
  tabSites: 'Saidid',
  tabFilters: 'Minu filtrid',
  tabBackup: 'Varukoopia',
  tabAbout: 'Teave',
  tabsAria: 'Seadete jaotised',
  regionAria: '{name} seaded',

  whatEachLevel: 'Mida iga tase teeb',
  explainOff: ' — midagi ei blokeerita ega peideta.',
  explainStandard:
    ' — blokeerib reklaamid ja teadaolevad jälgijad ning peidab reklaamipesad saitidel, mille jaoks meil on kindlad reeglid. Ohutu peaaegu igal saidil.',
  explainAggressive:
    ' — peidab ka levinud lehesegaduse kõikjal (küpsiseribad, uudiskirja hüpikaknad, üle jäänud reklaamikastid). Põhjalikum, kuid võib aeg-ajalt saidi paigutuse rikkuda.',
  technicalDetails: 'Tehnilised üksikasjad',
  techLevel1Pre: 'Iga tase lülitab kaasapandud staatilisi reeglikomplekte käsuga ',
  techLevel2a: '„Lehesegaduse peitmine“ on ',
  emCosmeticFiltering: 'kosmeetiline filtreerimine',
  techLevel2b: ' — ',
  techLevel2c: ' reeglid, mille sisestab sisuskript. Ainult ',
  emGeneric: 'üldine',
  techLevel2d:
    ' kosmeetiline filtreerimine (igal saidil rakendatavad selektorid) on lubatud tasemel „Agressiivne“; just see rikub aeg-ajalt paigutust, seega tasemel „Standardne“ on see väljas.',

  noRulesetsA: 'Genereeritud reeglikomplekte ei leitud. Käivita ',
  noRulesetsB: ', et ehitada need allikast ',
  listsNote1a: 'Lülita üksikuid loendeid sisse või välja. Rangusastme valimine vahekaardil ',
  listsNote1b:
    ' seab need lähtepunktiks; seejärel saad iga üksiku loendi siin üle kirjutada.',
  listsNote2a: 'Loend ',
  listsNote2b: ' blokeerib ',
  emNetworkRequests: 'võrgupäringud',
  listsNote2c:
    ' küpsisenõusoleku ja uudiskirja vidinate jaoks. Lehele jäänud segaduse (küpsiseribad, hüpikaknad) peitmine on ',
  emCosmetic: 'kosmeetiline',
  listsNote2d: ' filtreerimine — mida juhib rangusaste ',
  listsNote2e: ' vahekaardil ',
  listsNote2f:
    ', mitte see lüliti. Selle loendi väljalülitamine jätab tasemel „Agressiivne“ segaduse ikkagi peidetuks.',
  strictnessOffNote: 'Rangus on „Väljas“, seega praegu ükski loend ei filtreeri.',
  blockingOffNote: 'Blokeerimine on kõikjal väljas, seega praegu ükski loend ei filtreeri.',
  choicesKept: ' Sinu allolevad valikud säilivad ja rakenduvad kohe, kui see uuesti sees on.',
  degradedRetry:
    ' Selle lüliti jääb allpool sisse ja seda proovitakse automaatselt uuesti — see hakkab filtreerima kohe, kui eelarve lubab.',
  thOn: 'Sees',
  thList: 'Loend',
  thRules: 'Reegleid',
  thLicense: 'Litsents',
  toggleList: 'Lülita {name}',
  enableList: 'Luba {name}',
  notActiveBudget: ' — pole aktiivne (reeglieelarvet pole)',
  peterLoweA: 'Peter Lowe loend on tasuta ainult ',
  emPersonal: 'isiklikuks / mitteäriliseks',
  peterLoweB:
    ' kasutuseks ja äriliseks levitamiseks on vaja luba, seega pole see siia meelega kaasa pandud.',
  techBudget: 'Tehnilised üksikasjad (reeglieelarve)',
  budgetAt: 'Reeglieelarve tasemel ',
  budgetOver:
    'Ületab Chrome’i garanteeritud 30 000 staatilist reeglit. Ülejääk võetakse jagatud 300 000 reegli globaalsest kogumist, mis on parim võimalik ja mille teised laiendused võivad ammendada.',
  budgetNoteA: 'Chrome garanteerib ',
  budgetNoteB: ' lubatud staatilist reeglit laienduse kohta pluss ',
  budgetNoteC:
    ' reegli kogumi, mis on jagatud kõigi paigaldatud laiendustega. Täielik EasyList + EasyPrivacy komplekt mahub ühe laienduse garantii sisse.',

  blockKnownTrackers: 'Blokeeri teadaolevad jälgijad',
  stripFromLinks: 'Eemalda linkidelt jälgimisparameetrid',
  paramNeedsAccess: 'Parameetrite eemaldamiseks on selles brauseris vaja juurdepääsu saidile.',
  trackParamsNoteA: 'Jälgimisparameetrid on linkidele lisatud lisasildid (nagu ',
  trackParamsNoteB: ' või ',
  trackParamsNoteC:
    '), mis lasevad saitidel sind lehtede vahel jälgida. Nende eemaldamine viib sind samasse sihtkohta ilma jälgimissildita.',
  trackTechA: 'Parameetrite eemaldamine on üksainus DNR-i ',
  trackTechB: ' reegel, mis kasutab ',
  trackTechC: '. URL-i ümberkirjutavad reeglid loetakse „ebaturvalisteks“ ja need on piiratud ',
  trackTechD: ' peale kogu laienduse ulatuses (PLAN.md §4.1).',
  trackTech2A:
    'Tulevane lisandus: Privacy Badgeri stiilis heuristika, mis märgib domeeni jälgijaks, kui seda nähakse ≥3 mitteseotud saidil. EFF portis Privacy Badgeri 2024. aastal MV3-le: see õpib, jälgides ',
  trackTech2B: ', ja blokeerib ',
  emDynamic: 'dünaamiliste',
  trackTech2C: ' DNR-reeglite kaudu (PLAN.md §4.3).',

  sitesNoteA:
    'Siin loetletud saidid on täielikult välja jäetud — neil ei tööta ei võrgu- ega kosmeetiline filtreerimine. Kleebi täielik URL või lihtsalt hostinimi; see normaliseeritakse puhtaks hostiks (nt ',
  sitesNoteB: ' → ',
  sitesNoteC: ').',
  placeholderSite: 'example.com või https://example.com/page',
  excludeAria: 'Sait, mis blokeerimisest välja jätta',
  invalidSite: 'Sisesta kehtiv sait, nt example.com.',
  alreadyExcluded: '{host} on juba välja jäetud.',
  noExcluded:
    'Väljajäetud saite pole veel. Lisa ülal hostinimi, et selle saidi blokeerimine välja lülitada.',
  removeHost: 'Eemalda {host}',
  bulkImport: 'Hulgiimport',
  bulkNote:
    'Üks sait real (või komadega eraldatud). Täielikud URL-id võetakse vastu ja normaliseeritakse puhtaks hostiks. Olemasolevad kirjed jäetakse vahele.',
  bulkAria: 'Väljajäetavad saidid, üks real',
  importSites: 'Impordi saidid',
  nothingToImport: 'Pole midagi importida.',
  addedSiteOne: 'Lisatud {n} sait',
  addedSiteOther: 'Lisatud {n} saiti',
  skippedLineOne: '; vahele jäeti {n} loetamatu rida.',
  skippedLineOther: '; vahele jäeti {n} loetamatut rida.',
  sitesExportAria: 'Väljajäetud saidid tekstina',

  filtersNote1a: 'Sinu enda kosmeetilised reeglid peidavad elemente käsuga ',
  filtersNote1b: '. Need rakenduvad ',
  emEvery: 'igal',
  filtersNote1c:
    ' tasemel (isegi „Standardsel“), sest need on sinu selge valik — erinevalt üldloendist, mis lülitub sisse ainult „Agressiivsel“. Kasuta ',
  boldBlockAnElement: 'Blokeeri element sellel lehel',
  filtersNote1d: ' tööriistariba hüpikaknas, et visuaalselt valida.',
  filtersNote2a:
    'Ühe tagasitoomiseks pole seda lehte vaja: kohe pärast elemendi peitmist pakub leht ise ',
  boldUndo: 'Võta tagasi',
  filtersNote2b: ', ja tööriistariba hüpikaken loetleb kõik, mille oled peitnud ',
  emOnSiteYouAreOn: 'saidil, kus sa oled',
  filtersNote2c: ', igaühe juures nupp ',
  boldRestore: 'Taasta',
  filtersNote2d: '. See vahekaart on täielik, saitideülene loend.',
  addRule: 'Lisa reegel',
  placeholderHost: 'host (tühi = kõik saidid)',
  hostAria: 'Selle kosmeetilise reegli host (tühi = kõik saidid)',
  placeholderSelector: 'CSS-selektor, nt .promo-box',
  selectorAria: 'Peidetav CSS-selektor',
  yourRules: 'Sinu reeglid',
  noCustomRules: 'Kohandatud reegleid pole veel.',
  allSites: 'Kõik saidid',
  removeSelector: 'Eemalda {selector} saidilt {host}',
  importHeading: 'Import (kleebi EasyListi kosmeetilised reeglid)',
  importNoteA: 'Üks reegel real: ',
  importNoteB: ' (saidipõhine) või ',
  importNoteC: ' (kõik saidid). ',
  importNoteD:
    'Võrgureeglid ja laiendatud (mitte-CSS) süntaks jäetakse vahele — võrgublokeerimist teevad kaasapandud DNR-reeglikomplektid ja kaugloendite tõmbamine on ulatusest väljas (see vajab lisahosti õigusi ja ülevaatust).',
  pasteAria: 'Kleebi EasyListi kosmeetilised reeglid',
  importPastedBtn: 'Impordi kleebitud reeglid',
  importedRuleOne: 'Imporditud {n} kosmeetiline reegel',
  importedRuleOther: 'Imporditud {n} kosmeetilist reeglit',
  skippedRules: '; vahele jäeti {n} (võrgureeglid ja mittetoetatud süntaks — vt allpool).',
  filtersExportAria: 'Sinu kosmeetilised reeglid tekstina',

  backupRestore: 'Varundamine ja taastamine',
  backupNote:
    'Ekspordi oma seaded, väljajäetud saidid, saidipõhised valikud ja kohandatud filtrid JSON-ina — või kleebi varem eksporditud dokument ja impordi see.',
  exportBtn: 'Ekspordi',
  downloadJson: 'Laadi alla .json',
  importBtn: 'Impordi',
  exportedStatus: 'Eksporditud. Kopeeri allolev JSON või laadi see alla.',
  backupPlaceholder: 'Siia ilmub eksporditud JSON; importimiseks kleebi JSON.',
  backupAria: 'Seadete varukoopia JSON',
  importedApplied: 'Imporditud ja rakendatud.',
  importFailed: 'Import ebaõnnestus: {msg}',

  filterListBuild: 'Filtriloendi järk: ',
  countingSince: 'Loendamine alates ',
  privacyNote:
    'Privaatsus: mingeid sirvimisandmeid ei lahku sinu seadmest. Filtreerimine, loendamine ja lubatud loendid toimuvad kõik kohapeal.',
  companionNote:
    'Sisu hägustamine ja arendaja tööriistakomplekt on selle komplekti eraldi kaaslaslaiendused — igaüks tarnitakse omaette, et hoida iga lisandus ühe kitsa eesmärgi juures (PLAN.md §0).',
  statisticsHeading: 'Statistika',
  resetNote:
    'Kogu eluaja loendur (täna, sel nädalal ja kokku), mida näidatakse tööriistariba hüpikaknas. Lähtestamine nullib selle ja seda ei saa tagasi võtta.',
  confirmReset: 'Kinnita lähtestamine',
  resetStats: 'Lähtesta statistika',
  statsReset: 'Statistika nullitud.',

  andJoin: ' ja ',
  degradedTemplate:
    'Ei õnnestunud sisse lülitada: {names}. Selle brauseri filtreerimisreeglite eelarve on jagatud sinu teiste laiendustega ja on praegu täis. Sinu ülejäänud loendid blokeerivad edasi tavapäraselt. Eelarve vabastab mõne teise sisublokeerija eemaldamine.',

  pickerInstruction: 'Klõpsa elemendil, et see blokeerida · vajuta Esc tühistamiseks',
  pickerBlock: 'Blokeeri: {selector}',

  toastHidden: 'Element peidetud',
  toastRestored: 'Element taastatud',
  undoBtn: 'Võta tagasi',
  undoAria: 'Võta tagasi peitmine: {desc}',
  thisElement: 'see element',
  dismissBtn: 'Sulge',

  ctxBlockElement: 'Blokeeri see element…',
  ctxPauseSite: 'Peata sellel saidil',
};

const messages: Catalog<MsgKey> = { en, ru, et };

const translate = createTranslator<MsgKey>(messages);

/** Hook: a locale-bound `t()` for React surfaces (popup / options). */
export function useT(): TFn {
  const locale = useLocale();
  return useCallback(
    (key: MsgKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
}

/** Imperative translator for the non-React content script (picker / undo toast)
 *  and the background context menus, which resolve the locale from storage. */
export function tAt(locale: Locale, key: MsgKey, vars?: Record<string, string | number>): string {
  return translate(locale, key, vars);
}

/** The strictness level's translated label / description (source: ADBLOCK_LEVELS,
 *  copied verbatim into `en`). */
export function levelLabel(t: TFn, level: string): string {
  return t(
    level === 'off' ? 'levelOffLabel' : level === 'standard' ? 'levelStandardLabel' : 'levelAggressiveLabel',
  );
}
export function levelDesc(t: TFn, level: string): string {
  return t(
    level === 'off' ? 'levelOffDesc' : level === 'standard' ? 'levelStandardDesc' : 'levelAggressiveDesc',
  );
}

const LIST_NAME_KEY: Record<string, MsgKey> = {
  easylist: 'listAds',
  easyprivacy: 'listTrackers',
  annoyances: 'listAnnoyances',
};

/**
 * The deterministic static-rule-budget degradation notice, localized. English is
 * byte-identical to the pure `degradedNotice` (which the adblock logic test pins),
 * so we defer to it for `en`; ru/et use a template with the translated list names.
 */
export function degradedNoticeAt(locale: Locale, dropped: readonly string[]): string {
  if (locale === 'en') return degradedNotice(dropped);
  if (dropped.length === 0) return '';
  const names = dropped
    .map((id) => translate(locale, LIST_NAME_KEY[id] ?? 'listAnnoyances'))
    .join(translate(locale, 'andJoin'));
  return translate(locale, 'degradedTemplate', { names });
}

/** Hook form of `degradedNoticeAt`, bound to the active React-tree locale. */
export function useDegradedNotice(): (dropped: readonly string[]) => string {
  const locale = useLocale();
  return useCallback((dropped: readonly string[]) => degradedNoticeAt(locale, dropped), [locale]);
}
