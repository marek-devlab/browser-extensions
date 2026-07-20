import { createTranslator, useLocale, type Catalog, type Locale } from '@blur/ui';
import { useCallback } from 'react';

// Session Saver string catalog. `en` is the DEFAULT and the single source of truth
// for the key set; `Catalog<MsgKey>` makes TypeScript fail the build if `ru` or `et`
// ever drops a key, so nothing ships half-translated (house pattern from whoami/seo).
//
// 🔴 URLs, domains and technical tokens are never translated. Only user-facing copy
// lives here.

const en = {
  // ---- Shared chrome ----
  loading: 'Loading…',
  appTitle: 'Session Saver',
  /** The empty-state trust line — the product's whole promise in one sentence. */
  localOnly: 'Everything here stays on this device.',
  settings: 'Settings',
  openManager: 'Manage sessions',
  version: 'Version 1.0.0',

  // ---- Popup: saving ----
  saveCurrentWindow: 'Save this window',
  saveAllWindows: 'Save all windows',
  saving: 'Saving…',
  savedToast: 'Saved “{name}”',
  saveEmpty: 'Nothing to save — no ordinary tabs are open.',

  // ---- Popup: session list ----
  recentSessions: 'Saved sessions',
  noSessions: 'No saved sessions yet',
  noSessionsHint: 'Save this window to keep its tabs for later. Everything here stays on this device.',
  restore: 'Restore',
  restoreNewWindow: 'In a new window',
  restoreHere: 'Into this window',
  manageOne: 'Manage',

  // ---- Counts / indicators ----
  tabsCount: '{n} tabs',
  tabsCountOne: '1 tab',
  windowsCount: '{n} windows',
  windowsCountOne: '1 window',
  kindAutosave: 'Auto-saved',
  groupsBadge: '{n} groups',
  containerBadge: 'containers',

  // ---- Crash recovery ----
  crashTitle: 'Recover your last session?',
  crashBody: 'The browser was auto-saving your open tabs. {tabs} across {windows} are ready to restore.',
  crashRestore: 'Restore',
  crashDismiss: 'Dismiss',
  crashSaved: 'Kept as a saved session',
  crashKeep: 'Save it instead',

  // ---- Honest permission microcopy (the `?`) ----
  permWhy: 'Why “Read your browsing history”?',
  permTitle: '“Read your browsing history”',
  permBody:
    'We read your open tabs’ titles and URLs to save them — that is the only reason this permission is requested. Nothing leaves your browser: sessions are stored on this device, with no account, no cloud and no sync.',

  // ---- Manager: layout ----
  managerTitle: 'Session Saver · Manage',
  searchPlaceholder: 'Search tabs by title or URL…',
  searchAria: 'Search saved tabs',
  sessionsHeading: 'Saved sessions',
  emptyManager: 'No saved sessions',
  emptyManagerHint: 'Open the toolbar popup and save a window. Everything here stays on this device.',
  searchNoMatch: 'No tabs match “{q}”.',
  matchesCount: '{n} matching tabs',

  // ---- Manager: per-session actions ----
  rename: 'Rename',
  renameSave: 'Save',
  renameCancel: 'Cancel',
  renameAria: 'Session name',
  del: 'Delete',
  undo: 'Undo',
  deletedToast: 'Deleted “{name}”',
  expand: 'Show tabs',
  collapse: 'Hide tabs',
  openTabAria: 'Open {title} in a new tab',

  // ---- Manager: restore options ----
  restoreOptionsTitle: 'Restore into',
  optNewWindow: 'New window',
  optCurrent: 'Current window',
  restoredToast: 'Restored {tabs} in {windows}',
  restoredWithFails: 'Restored {tabs} in {windows} · {failed} could not be reopened',

  // ---- Manager: export / import ----
  dataTitle: 'Backup',
  exportAll: 'Export all (.json)',
  exportHint: 'A local JSON file, built in this page — no download permission, nothing is uploaded.',
  importFile: 'Import from file…',
  importedToast: 'Imported {imported} · skipped {skipped}',
  importEmpty: 'No sessions found in that file.',

  // ---- Manager: appearance ----
  appearance: 'Appearance',
  theme: 'Theme',
  language: 'Language',
  langSwitcherLabel: 'Interface language',

  // ---- Manager: behaviour ----
  behaviour: 'Behaviour',
  autoSaveLabel: 'Auto-save open tabs for crash recovery',
  autoSaveHint:
    'Keeps a rolling snapshot of your open windows on this device, so a crash or accidental close can be recovered. It is never uploaded.',
  lazyRestoreLabel: 'Restore tabs unloaded (recommended)',
  lazyRestoreHint:
    'Reopened tabs show their title and load only when you click them — so restoring a large session does not freeze the browser or spike memory.',
  dedupeLabel: 'Remove duplicate tabs when saving',
  dedupeHint: 'If the same URL is open twice in one window, only one copy is saved.',
  restoreGroupsLabel: 'Restore tab groups (name & colour)',
  restoreGroupsHint:
    'Recreates Chrome/Firefox tab groups on restore. Asks for the optional “tab groups” permission the first time.',

  // ---- Manager: storage ----
  storageTitle: 'Storage',
  storageUsage: '{used} of about {quota} used',
  upgradeStorage: 'Allow unlimited storage',
  upgradeStorageHint:
    'By default the browser caps local storage at about 10 MB. For very large collections you can grant unlimited local storage (still on this device only).',
  storageUpgraded: 'Unlimited local storage granted.',
  storageUpgradeDenied: 'Permission not granted — the 10 MB cap still applies.',

  // ---- Trust ----
  trustCallout:
    'Local-only by design: there is no account, no server and no sync — nothing to sell, breach or hand over. If it never leaves your device, it cannot be taken from it.',
} as const;

export type MsgKey = keyof typeof en;

/** A translator bound to a locale — passed to non-React helpers. */
export type TT = (key: MsgKey, vars?: Record<string, string | number>) => string;

const ru: Record<MsgKey, string> = {
  loading: 'Загрузка…',
  appTitle: 'Session Saver',
  localOnly: 'Всё это остаётся на вашем устройстве.',
  settings: 'Настройки',
  openManager: 'Управление сессиями',
  version: 'Версия 1.0.0',

  saveCurrentWindow: 'Сохранить это окно',
  saveAllWindows: 'Сохранить все окна',
  saving: 'Сохранение…',
  savedToast: 'Сохранено «{name}»',
  saveEmpty: 'Нечего сохранять — нет открытых обычных вкладок.',

  recentSessions: 'Сохранённые сессии',
  noSessions: 'Пока нет сохранённых сессий',
  noSessionsHint: 'Сохраните это окно, чтобы вернуться к вкладкам позже. Всё это остаётся на вашем устройстве.',
  restore: 'Восстановить',
  restoreNewWindow: 'В новом окне',
  restoreHere: 'В это окно',
  manageOne: 'Управлять',

  tabsCount: '{n} вкладок',
  tabsCountOne: '1 вкладка',
  windowsCount: '{n} окон',
  windowsCountOne: '1 окно',
  kindAutosave: 'Автосохранение',
  groupsBadge: '{n} групп',
  containerBadge: 'контейнеры',

  crashTitle: 'Восстановить прошлую сессию?',
  crashBody: 'Браузер автоматически сохранял открытые вкладки. Готово к восстановлению: {tabs} в {windows}.',
  crashRestore: 'Восстановить',
  crashDismiss: 'Скрыть',
  crashSaved: 'Сохранено как сессия',
  crashKeep: 'Сохранить как сессию',

  permWhy: 'Почему «Чтение истории браузера»?',
  permTitle: '«Чтение истории браузера»',
  permBody:
    'Мы читаем заголовки и URL открытых вкладок только для того, чтобы их сохранить — это единственная причина этого разрешения. Ничего не покидает браузер: сессии хранятся на этом устройстве, без аккаунта, облака и синхронизации.',

  managerTitle: 'Session Saver · Управление',
  searchPlaceholder: 'Поиск вкладок по заголовку или URL…',
  searchAria: 'Поиск по сохранённым вкладкам',
  sessionsHeading: 'Сохранённые сессии',
  emptyManager: 'Нет сохранённых сессий',
  emptyManagerHint: 'Откройте попап на панели и сохраните окно. Всё это остаётся на вашем устройстве.',
  searchNoMatch: 'Нет вкладок по запросу «{q}».',
  matchesCount: '{n} совпадений',

  rename: 'Переименовать',
  renameSave: 'Сохранить',
  renameCancel: 'Отмена',
  renameAria: 'Название сессии',
  del: 'Удалить',
  undo: 'Отменить',
  deletedToast: 'Удалено «{name}»',
  expand: 'Показать вкладки',
  collapse: 'Скрыть вкладки',
  openTabAria: 'Открыть {title} в новой вкладке',

  restoreOptionsTitle: 'Восстановить в',
  optNewWindow: 'Новое окно',
  optCurrent: 'Текущее окно',
  restoredToast: 'Восстановлено {tabs} в {windows}',
  restoredWithFails: 'Восстановлено {tabs} в {windows} · {failed} не удалось открыть',

  dataTitle: 'Резервная копия',
  exportAll: 'Экспортировать всё (.json)',
  exportHint: 'Локальный JSON-файл, собранный на этой странице — без разрешения на загрузки, ничего не выгружается.',
  importFile: 'Импорт из файла…',
  importedToast: 'Импортировано {imported} · пропущено {skipped}',
  importEmpty: 'В этом файле нет сессий.',

  appearance: 'Внешний вид',
  theme: 'Тема',
  language: 'Язык',
  langSwitcherLabel: 'Язык интерфейса',

  behaviour: 'Поведение',
  autoSaveLabel: 'Автосохранение вкладок для восстановления после сбоя',
  autoSaveHint:
    'Хранит на этом устройстве свежий снимок открытых окон, чтобы сбой или случайное закрытие можно было восстановить. Никогда не выгружается.',
  lazyRestoreLabel: 'Восстанавливать вкладки незагруженными (рекомендуется)',
  lazyRestoreHint:
    'Открытые вкладки показывают заголовок и загружаются только по клику — поэтому восстановление большой сессии не подвешивает браузер и не съедает память.',
  dedupeLabel: 'Удалять дубликаты вкладок при сохранении',
  dedupeHint: 'Если один и тот же URL открыт дважды в одном окне, сохраняется только одна копия.',
  restoreGroupsLabel: 'Восстанавливать группы вкладок (имя и цвет)',
  restoreGroupsHint:
    'Пересоздаёт группы вкладок Chrome/Firefox при восстановлении. В первый раз запрашивает необязательное разрешение «группы вкладок».',

  storageTitle: 'Хранилище',
  storageUsage: 'Использовано {used} из примерно {quota}',
  upgradeStorage: 'Разрешить неограниченное хранилище',
  upgradeStorageHint:
    'По умолчанию браузер ограничивает локальное хранилище примерно 10 МБ. Для очень больших коллекций можно выдать неограниченное локальное хранилище (по-прежнему только на этом устройстве).',
  storageUpgraded: 'Неограниченное локальное хранилище выдано.',
  storageUpgradeDenied: 'Разрешение не выдано — ограничение 10 МБ сохраняется.',

  trustCallout:
    'Только локально по замыслу: нет аккаунта, сервера и синхронизации — нечего продать, взломать или выдать. Если данные не покидают устройство, их нельзя оттуда забрать.',
};

const et: Record<MsgKey, string> = {
  loading: 'Laadimine…',
  appTitle: 'Session Saver',
  localOnly: 'Kõik siin jääb sellesse seadmesse.',
  settings: 'Seaded',
  openManager: 'Halda seansse',
  version: 'Versioon 1.0.0',

  saveCurrentWindow: 'Salvesta see aken',
  saveAllWindows: 'Salvesta kõik aknad',
  saving: 'Salvestamine…',
  savedToast: 'Salvestatud „{name}“',
  saveEmpty: 'Pole midagi salvestada — ühtki tavalist vahekaarti pole avatud.',

  recentSessions: 'Salvestatud seansid',
  noSessions: 'Salvestatud seansse veel pole',
  noSessionsHint: 'Salvesta see aken, et vahekaardid hiljem alles oleksid. Kõik siin jääb sellesse seadmesse.',
  restore: 'Taasta',
  restoreNewWindow: 'Uues aknas',
  restoreHere: 'Sellesse aknasse',
  manageOne: 'Halda',

  tabsCount: '{n} vahekaarti',
  tabsCountOne: '1 vahekaart',
  windowsCount: '{n} akent',
  windowsCountOne: '1 aken',
  kindAutosave: 'Automaatselt salvestatud',
  groupsBadge: '{n} rühma',
  containerBadge: 'konteinerid',

  crashTitle: 'Taastada eelmine seanss?',
  crashBody: 'Brauser salvestas avatud vahekaarte automaatselt. Taastamiseks valmis: {tabs} {windows}.',
  crashRestore: 'Taasta',
  crashDismiss: 'Peida',
  crashSaved: 'Salvestatud seansina',
  crashKeep: 'Salvesta seansina',

  permWhy: 'Miks „Loe sirvimisajalugu“?',
  permTitle: '„Loe sirvimisajalugu“',
  permBody:
    'Loeme avatud vahekaartide pealkirju ja URL-e ainult selleks, et need salvestada — see on selle loa ainus põhjus. Miski ei lahku brauserist: seansid on selles seadmes, ilma kontota, pilveta ja sünkroonimiseta.',

  managerTitle: 'Session Saver · Haldus',
  searchPlaceholder: 'Otsi vahekaarte pealkirja või URL-i järgi…',
  searchAria: 'Otsi salvestatud vahekaarte',
  sessionsHeading: 'Salvestatud seansid',
  emptyManager: 'Salvestatud seansse pole',
  emptyManagerHint: 'Ava tööriistariba hüpik ja salvesta aken. Kõik siin jääb sellesse seadmesse.',
  searchNoMatch: 'Päringule „{q}“ ei vasta ükski vahekaart.',
  matchesCount: '{n} vastavat vahekaarti',

  rename: 'Nimeta ümber',
  renameSave: 'Salvesta',
  renameCancel: 'Tühista',
  renameAria: 'Seansi nimi',
  del: 'Kustuta',
  undo: 'Võta tagasi',
  deletedToast: 'Kustutatud „{name}“',
  expand: 'Näita vahekaarte',
  collapse: 'Peida vahekaardid',
  openTabAria: 'Ava {title} uues vahekaardis',

  restoreOptionsTitle: 'Taasta kohta',
  optNewWindow: 'Uus aken',
  optCurrent: 'Praegune aken',
  restoredToast: 'Taastatud {tabs} {windows}',
  restoredWithFails: 'Taastatud {tabs} {windows} · {failed} ei õnnestunud avada',

  dataTitle: 'Varukoopia',
  exportAll: 'Ekspordi kõik (.json)',
  exportHint: 'Kohalik JSON-fail, koostatud sellel lehel — ilma allalaadimisloata, midagi ei laadita üles.',
  importFile: 'Impordi failist…',
  importedToast: 'Imporditud {imported} · vahele jäetud {skipped}',
  importEmpty: 'Sellest failist ei leitud seansse.',

  appearance: 'Välimus',
  theme: 'Teema',
  language: 'Keel',
  langSwitcherLabel: 'Liidese keel',

  behaviour: 'Käitumine',
  autoSaveLabel: 'Salvesta avatud vahekaardid krahhist taastumiseks',
  autoSaveHint:
    'Hoiab selles seadmes avatud akende värsket hetktõmmist, et krahhi või kogemata sulgemise saaks taastada. Seda ei laadita kunagi üles.',
  lazyRestoreLabel: 'Taasta vahekaardid laadimata (soovitatav)',
  lazyRestoreHint:
    'Taasavatud vahekaardid näitavad pealkirja ja laadivad alles klõpsates — nii ei külmuta suure seansi taastamine brauserit ega söö mälu.',
  dedupeLabel: 'Eemalda salvestamisel korduvad vahekaardid',
  dedupeHint: 'Kui sama URL on ühes aknas kaks korda avatud, salvestatakse ainult üks koopia.',
  restoreGroupsLabel: 'Taasta vahekaardirühmad (nimi ja värv)',
  restoreGroupsHint:
    'Loob taastamisel Chrome’i/Firefoxi vahekaardirühmad uuesti. Küsib esimesel korral valikulist „vahekaardirühmade“ luba.',

  storageTitle: 'Salvestusruum',
  storageUsage: 'Kasutusel {used} umbes {quota}-st',
  upgradeStorage: 'Luba piiramatu salvestusruum',
  upgradeStorageHint:
    'Vaikimisi piirab brauser kohalikku salvestusruumi umbes 10 MB-ga. Väga suurte kogude jaoks saad anda piiramatu kohaliku salvestusruumi (endiselt ainult selles seadmes).',
  storageUpgraded: 'Piiramatu kohalik salvestusruum antud.',
  storageUpgradeDenied: 'Luba ei antud — 10 MB piir kehtib endiselt.',

  trustCallout:
    'Kavakohaselt ainult kohalik: pole kontot, serverit ega sünkroonimist — pole midagi müüa, häkkida ega välja anda. Kui andmed seadmest ei lahku, ei saa neid sealt ka võtta.',
};

const messages: Catalog<MsgKey> = { en, ru, et };

const translate = createTranslator<MsgKey>(messages);

/** React hook: a translator bound to the active locale (from LocaleProvider). */
export function useT(): TT {
  const locale = useLocale();
  return useCallback<TT>((key, vars) => translate(locale, key, vars), [locale]);
}

/** Raw translator for non-React / passed-down use. */
export function tAt(locale: Locale, key: MsgKey, vars?: Record<string, string | number>): string {
  return translate(locale, key, vars);
}
