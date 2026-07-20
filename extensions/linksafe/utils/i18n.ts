import { createTranslator, useLocale, type Catalog, type Locale } from '@blur/ui';
import { useCallback } from 'react';

// Link Inspector string catalog. `en` is the DEFAULT and the single source of truth
// for the key set; `messages: Catalog<MsgKey>` makes TypeScript fail the build if
// `ru` or `et` drops a key, so nothing ships half-translated.
//
// 🔴 What is NEVER translated (facts / technical tokens, per PLAN.md §12 & house
// rule): URLs, domains and hostnames, URL schemes (http, https, javascript:, data:),
// punycode/`xn--`, tracking-parameter names (utm_source, gclid…), and the alphabet/
// script name interpolated into `sig_confusable`/`sig_mixedScript` ({script}), which
// is a proper-noun-ish token produced by the pure analyzer. Everything a human READS
// goes through here. Signals are emitted as CODES by utils/analyze.ts (browser-free)
// and turned into these plain-language lines at the UI edge, so the wording stays
// honest ("looks like … but uses Cyrillic letters", never "phishing").

/** A translator bound to a locale — produced by `useT()` (React) and by the
 *  content-script / background closure over `tAt`. */
export type TT = (key: MsgKey, vars?: Record<string, string | number>) => string;

const en = {
  // ---- popup chrome ----
  appTitle: 'Link Inspector',
  loading: 'Loading…',
  language: 'Language',
  interfaceLanguage: 'Interface language',
  settings: 'Settings',
  localBadge: '100% local by default',
  aboutLine:
    'Heuristics run locally in your browser — nothing is sent. Resolving a shortener is network and opt-in per link.',

  // ---- scan ----
  scanTitle: 'This page',
  scanPage: 'Scan links on this page',
  rescan: 'Re-scan',
  scanHint: 'Highlights outbound links and flags look-alike domains, mismatches and unsafe schemes.',
  cannotScan: 'This page can’t be scanned (a browser or web-store page).',
  noActiveTab: 'No active tab.',
  scanDone: 'Scanned {total} links · {risky} flagged.',

  // ---- manual inspector ----
  inspectTitle: 'Inspect a link',
  inspectPlaceholder: 'Paste a link to inspect…',
  inspectBtn: 'Inspect',
  inspectInvalid: 'That is not a valid link.',
  goesTo: 'Goes to',
  realDomain: 'Real domain',
  noWebDestination: 'No web destination',
  decodedFrom: 'Decoded from {ascii}',

  // ---- risk labels ----
  riskOk: 'Looks OK',
  riskWarn: 'Be careful',
  riskPoor: 'High risk',
  riskOkNote: 'No local warning signs.',

  // ---- signals (plain-language reason lines) ----
  sig_dangerousScheme: 'Runs a {scheme} action instead of opening a web page.',
  sig_credentials: 'The part before “@” ({userinfo}) is ignored — the real site is {host}.',
  sig_confusable: 'Looks like “{lookalike}” but uses {script} letters — a possible look-alike domain.',
  sig_mixedScript: 'The domain mixes letters from more than one alphabet.',
  sig_mismatch: 'The text says “{textDomain}” but the link goes to {hrefDomain}.',
  sig_punycode: 'Punycode domain — its real (decoded) name is {unicode}.',
  sig_ipHost: 'A raw IP address ({host}), not a domain name.',
  sig_insecure: 'Unencrypted http:// — traffic can be read or altered in transit.',
  sig_shortener: '{host} is a link shortener — the real destination is hidden until you visit.',
  sig_tracking: 'Has {n} tracking parameter(s) that can identify you.',

  // ---- copy actions ----
  copyLink: 'Copy link',
  copyClean: 'Copy clean link',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  nothingToClean: 'No tracking parameters to remove.',

  // ---- resolve (advanced, network, opt-in) ----
  resolveBtn: 'Resolve destination',
  resolveHeading: 'Resolve destination (network)',
  resolveDisclosure:
    'This contacts {host} and reveals that you clicked this link. Any one-time or tracking token in the URL is sent and may be used up. The result is the destination the server reports for this one request — not a guarantee.',
  resolveConfirm: 'Contact {host}',
  resolveCancel: 'Cancel',
  resolving: 'Contacting {host}…',
  resolvedTo: 'Server-reported destination',
  resolveNote:
    'This is the final URL of a single request (redirect: follow). It cannot show intermediate hops or JavaScript / meta-refresh redirects.',
  resolveFailed: 'Could not resolve: {error}.',
  resolvePermissionDenied: 'Permission to contact the site was not granted.',
  resolveUnsupported: 'Network resolve is not available on this platform.',
  alwaysResolve: 'Always resolve links on {host} without asking',

  // ---- trusted / auto-resolve list ----
  trustedTitle: 'Auto-resolve list',
  trustedHint: 'Shorteners on this list are resolved without asking each time.',
  trustedEmpty: 'Empty — add a domain when you resolve a shortener.',
  trustedRemove: 'Remove {host}',
  clearAll: 'Clear list',

  // ---- context menu (background) ----
  ctxWhereGoes: 'Where does this link go?',
  ctxCopyClean: 'Copy clean link',

  // ---- injected overlay ----
  ov_title: 'Link Inspector',
  ov_scanning: 'Scanning links…',
  ov_close: 'Close',
  ov_none: 'No outbound links found on this page.',
  ov_onlyRisky: 'Only flagged',
  ov_showAll: 'Show all',
  ov_hoverHint: 'Hover a highlighted link for details.',
  ov_tapHint: 'Tap a highlighted link for details.',
  ov_realDest: 'Real destination',
  ov_moreSignals: '+{n} more',
  ov_flaggedCount: '{risky} of {total} links flagged',
  ov_openReport: 'Open Link Inspector',
} as const;

export type MsgKey = keyof typeof en;

const ru: Record<MsgKey, string> = {
  appTitle: 'Инспектор ссылок',
  loading: 'Загрузка…',
  language: 'Язык',
  interfaceLanguage: 'Язык интерфейса',
  settings: 'Настройки',
  localBadge: '100% локально по умолчанию',
  aboutLine:
    'Эвристики работают локально в браузере — ничего не отправляется. Раскрытие сокращённой ссылки — это сеть и включается вручную для каждой ссылки.',

  scanTitle: 'Эта страница',
  scanPage: 'Проверить ссылки на этой странице',
  rescan: 'Пересканировать',
  scanHint: 'Подсвечивает внешние ссылки и отмечает похожие домены, несоответствия и небезопасные схемы.',
  cannotScan: 'Эту страницу нельзя просканировать (страница браузера или магазина).',
  noActiveTab: 'Нет активной вкладки.',
  scanDone: 'Проверено ссылок: {total} · отмечено: {risky}.',

  inspectTitle: 'Проверить ссылку',
  inspectPlaceholder: 'Вставьте ссылку для проверки…',
  inspectBtn: 'Проверить',
  inspectInvalid: 'Это недействительная ссылка.',
  goesTo: 'Ведёт на',
  realDomain: 'Настоящий домен',
  noWebDestination: 'Нет веб-адреса',
  decodedFrom: 'Раскодировано из {ascii}',

  riskOk: 'Выглядит нормально',
  riskWarn: 'Будьте внимательны',
  riskPoor: 'Высокий риск',
  riskOkNote: 'Локальных признаков опасности нет.',

  sig_dangerousScheme: 'Выполняет действие {scheme} вместо открытия веб-страницы.',
  sig_credentials: 'Часть до «@» ({userinfo}) игнорируется — настоящий сайт: {host}.',
  sig_confusable: 'Похоже на «{lookalike}», но использует буквы алфавита {script} — возможный домен-двойник.',
  sig_mixedScript: 'Домен смешивает буквы из нескольких алфавитов.',
  sig_mismatch: 'В тексте указано «{textDomain}», но ссылка ведёт на {hrefDomain}.',
  sig_punycode: 'Домен в Punycode — его настоящее (раскодированное) имя: {unicode}.',
  sig_ipHost: 'Прямой IP-адрес ({host}), а не доменное имя.',
  sig_insecure: 'Незашифрованный http:// — трафик можно прочитать или изменить в пути.',
  sig_shortener: '{host} — сокращатель ссылок; настоящий адрес скрыт до перехода.',
  sig_tracking: 'Содержит отслеживающих параметров: {n} — они могут вас идентифицировать.',

  copyLink: 'Скопировать ссылку',
  copyClean: 'Скопировать чистую ссылку',
  copied: 'Скопировано',
  copyFailed: 'Не удалось скопировать',
  nothingToClean: 'Нет отслеживающих параметров для удаления.',

  resolveBtn: 'Раскрыть адрес назначения',
  resolveHeading: 'Раскрыть адрес назначения (сеть)',
  resolveDisclosure:
    'Это обратится к {host} и раскроет, что вы перешли по ссылке. Любой одноразовый или отслеживающий токен в адресе будет отправлен и может быть израсходован. Результат — адрес, который сервер сообщает для этого одного запроса, а не гарантия.',
  resolveConfirm: 'Обратиться к {host}',
  resolveCancel: 'Отмена',
  resolving: 'Обращение к {host}…',
  resolvedTo: 'Адрес по данным сервера',
  resolveNote:
    'Это конечный URL одного запроса (redirect: follow). Он не показывает промежуточные переходы или редиректы через JavaScript / meta-refresh.',
  resolveFailed: 'Не удалось раскрыть: {error}.',
  resolvePermissionDenied: 'Разрешение на обращение к сайту не выдано.',
  resolveUnsupported: 'Сетевое раскрытие недоступно на этой платформе.',
  alwaysResolve: 'Всегда раскрывать ссылки на {host} без запроса',

  trustedTitle: 'Список авто-раскрытия',
  trustedHint: 'Сокращатели из этого списка раскрываются без запроса каждый раз.',
  trustedEmpty: 'Пусто — добавьте домен, когда будете раскрывать сокращённую ссылку.',
  trustedRemove: 'Удалить {host}',
  clearAll: 'Очистить список',

  ctxWhereGoes: 'Куда ведёт эта ссылка?',
  ctxCopyClean: 'Скопировать чистую ссылку',

  ov_title: 'Инспектор ссылок',
  ov_scanning: 'Сканирование ссылок…',
  ov_close: 'Закрыть',
  ov_none: 'Внешних ссылок на этой странице не найдено.',
  ov_onlyRisky: 'Только отмеченные',
  ov_showAll: 'Показать все',
  ov_hoverHint: 'Наведите на подсвеченную ссылку для деталей.',
  ov_tapHint: 'Нажмите на подсвеченную ссылку для деталей.',
  ov_realDest: 'Настоящий адрес',
  ov_moreSignals: '+{n} ещё',
  ov_flaggedCount: 'отмечено {risky} из {total} ссылок',
  ov_openReport: 'Открыть Инспектор ссылок',
};

const et: Record<MsgKey, string> = {
  appTitle: 'Lingiinspektor',
  loading: 'Laadimine…',
  language: 'Keel',
  interfaceLanguage: 'Liidese keel',
  settings: 'Seaded',
  localBadge: '100% kohalik vaikimisi',
  aboutLine:
    'Heuristikad töötavad kohalikult teie brauseris — midagi ei saadeta. Lühilingi lahtiharutamine on võrgutegevus ja lülitatakse sisse iga lingi puhul eraldi.',

  scanTitle: 'See leht',
  scanPage: 'Kontrolli selle lehe linke',
  rescan: 'Skanni uuesti',
  scanHint: 'Tõstab esile väljuvad lingid ning märgib sarnanevad domeenid, mittevastavused ja ebaturvalised skeemid.',
  cannotScan: 'Seda lehte ei saa skannida (brauseri või poe leht).',
  noActiveTab: 'Aktiivne kaart puudub.',
  scanDone: 'Skannitud {total} linki · märgitud {risky}.',

  inspectTitle: 'Kontrolli linki',
  inspectPlaceholder: 'Kleebi link kontrollimiseks…',
  inspectBtn: 'Kontrolli',
  inspectInvalid: 'See ei ole kehtiv link.',
  goesTo: 'Viib aadressile',
  realDomain: 'Tegelik domeen',
  noWebDestination: 'Veebiaadress puudub',
  decodedFrom: 'Dekodeeritud aadressist {ascii}',

  riskOk: 'Näib korras',
  riskWarn: 'Ole ettevaatlik',
  riskPoor: 'Kõrge risk',
  riskOkNote: 'Kohalikke ohumärke pole.',

  sig_dangerousScheme: 'Käivitab {scheme}-toimingu veebilehe avamise asemel.',
  sig_credentials: 'Osa enne „@“ ({userinfo}) jäetakse tähelepanuta — tegelik sait on {host}.',
  sig_confusable: 'Sarnaneb domeeniga „{lookalike}“, kuid kasutab {script} tähestiku tähti — võimalik jäljendav domeen.',
  sig_mixedScript: 'Domeen segab mitme tähestiku tähti.',
  sig_mismatch: 'Tekst ütleb „{textDomain}“, kuid link viib aadressile {hrefDomain}.',
  sig_punycode: 'Punycode-domeen — selle tegelik (dekodeeritud) nimi on {unicode}.',
  sig_ipHost: 'Otsene IP-aadress ({host}), mitte domeeninimi.',
  sig_insecure: 'Krüpteerimata http:// — liiklust saab teel lugeda või muuta.',
  sig_shortener: '{host} on lingilühendaja — tegelik sihtaadress on peidus kuni külastamiseni.',
  sig_tracking: 'Sisaldab {n} jälgimisparameetrit, mis võivad teid tuvastada.',

  copyLink: 'Kopeeri link',
  copyClean: 'Kopeeri puhas link',
  copied: 'Kopeeritud',
  copyFailed: 'Kopeerimine ebaõnnestus',
  nothingToClean: 'Eemaldatavaid jälgimisparameetreid pole.',

  resolveBtn: 'Harutada sihtaadress lahti',
  resolveHeading: 'Harutada sihtaadress lahti (võrk)',
  resolveDisclosure:
    'See pöördub aadressi {host} poole ja paljastab, et te klõpsasite lingile. Iga ühekordne või jälgiv märgis aadressis saadetakse ja võidakse ära kulutada. Tulemus on sihtaadress, mille server sellele ühele päringule teatab — mitte garantii.',
  resolveConfirm: 'Pöördu aadressi {host} poole',
  resolveCancel: 'Tühista',
  resolving: 'Pöördumine aadressi {host} poole…',
  resolvedTo: 'Serveri teatatud sihtaadress',
  resolveNote:
    'See on ühe päringu lõplik URL (redirect: follow). See ei näita vahepealseid ümbersuunamisi ega JavaScripti / meta-refresh ümbersuunamisi.',
  resolveFailed: 'Ei õnnestunud lahti harutada: {error}.',
  resolvePermissionDenied: 'Luba saidiga ühenduse loomiseks ei antud.',
  resolveUnsupported: 'Võrgu kaudu lahtiharutamine pole sellel platvormil saadaval.',
  alwaysResolve: 'Haruta alati domeeni {host} lingid lahti ilma küsimata',

  trustedTitle: 'Automaatse lahtiharutamise loend',
  trustedHint: 'Selle loendi lühendajad harutatakse lahti iga kord küsimata.',
  trustedEmpty: 'Tühi — lisage domeen, kui harutate lühilingi lahti.',
  trustedRemove: 'Eemalda {host}',
  clearAll: 'Tühjenda loend',

  ctxWhereGoes: 'Kuhu see link viib?',
  ctxCopyClean: 'Kopeeri puhas link',

  ov_title: 'Lingiinspektor',
  ov_scanning: 'Linkide skannimine…',
  ov_close: 'Sulge',
  ov_none: 'Sellel lehel väljuvaid linke ei leitud.',
  ov_onlyRisky: 'Ainult märgitud',
  ov_showAll: 'Näita kõiki',
  ov_hoverHint: 'Üksikasjade nägemiseks vii kursor esiletõstetud lingile.',
  ov_tapHint: 'Üksikasjade nägemiseks puuduta esiletõstetud linki.',
  ov_realDest: 'Tegelik sihtaadress',
  ov_moreSignals: '+{n} veel',
  ov_flaggedCount: 'märgitud {risky} / {total} lingist',
  ov_openReport: 'Ava Lingiinspektor',
};

const messages: Catalog<MsgKey> = { en, ru, et };

const translate = createTranslator<MsgKey>(messages);

/** React hook: a translator bound to the active locale (from LocaleProvider). */
export function useT(): TT {
  const locale = useLocale();
  return useCallback<TT>((key, vars) => translate(locale, key, vars), [locale]);
}

/** Imperative translator for the non-React content script and background, which
 *  resolve the locale from storage rather than from React context. */
export function tAt(locale: Locale, key: MsgKey, vars?: Record<string, string | number>): string {
  return translate(locale, key, vars);
}

/** The plain-language line for one analyzer signal, given its code + vars. */
export type SignalLineKey = Extract<MsgKey, `sig_${string}`>;
