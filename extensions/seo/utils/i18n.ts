import { createTranslator, useLocale, type Catalog, type Locale } from '@blur/ui';
import { useCallback } from 'react';

// Runtime UI catalog for the SEO & Accessibility Auditor. English is BOTH the
// source of truth and the default (see @blur/ui's DEFAULT_LOCALE); `ru` and `et`
// are complete mirrors, enforced at compile time by `Catalog<MsgKey>` (a missing
// key fails `tsc`).
//
// 🔴 What is deliberately NOT translated (facts, not prose):
//   - Technical tokens embedded in strings: HTML tags (<title>, <h1>, <html lang>),
//     property names (og:image, twitter:image, X-Robots-Tag), file names
//     (robots.txt, sitemap.xml, /favicon.ico), CSS/markup snippets
//     (width=device-width, user-scalable=no, alt=""), JSON-LD, DPR, numbers, px.
//   - axe-core's OWN violation text (help, ids) — it comes from the library.
//   - structured-data @type tokens (Article/Product/…), storage keys, comments,
//     console text, the exported-document section headers.
// Everything a human READS in the popup and DevTools panel goes through here, so
// switching the locale re-renders every surface. The SEO check prose (checks.ts /
// indexability.ts) is translated at REPORT-BUILD time in the content script via
// `tAt`, so a report is stamped in the locale that was active when it was scanned.

/** A translator bound to a locale — the shape produced by both `useT()` (React)
 *  and the content-script closure over `tAt`. Pure helpers (checks.ts,
 *  indexability.ts) take this as a param so they never import React and stay
 *  browser-free / unit-testable. */
export type TFn = (key: MsgKey, vars?: Record<string, string | number>) => string;

const en = {
  /* ---- language switcher + theme toggle ---- */
  language: 'Language',
  interfaceLanguage: 'Interface language',
  colourTheme: 'Colour theme',
  themeAuto: 'Auto',
  themeLight: 'Light',
  themeDark: 'Dark',

  /* ---- shared ---- */
  readingPage: 'Reading the page…',
  runAxeAria: 'Run the axe-core accessibility audit on this page',
  copyJson: 'Copy JSON',
  copyMarkdown: 'Copy Markdown',
  copyJsonAria: 'Copy report as JSON to the clipboard',
  copyMarkdownAria: 'Copy report as Markdown to the clipboard',
  couldNotCopy: 'Could not copy to the clipboard.',
  accessibility: 'Accessibility',
  metaH: 'Meta',
  missing: 'Missing',
  running: 'Running…',
  violationsH: 'Violations',
  noActiveTab: 'No active tab.',

  /* ---- popup ---- */
  appTitleShort: 'SEO & A11y',
  thisPage: 'this page',
  a11yRunHint: 'Run axe-core against this page to list violations by impact.',
  auditingAxe: 'Auditing with axe-core…',
  runAccessibilityAudit: 'Run accessibility audit',
  exportH: 'Export',
  copiedAs: 'Copied as {fmt}.',
  popupFooter:
    'Tap any number above to see what it is made of. Open the SEO & A11y panel (F12 → "SEO & A11y") for the full report.',
  presTitle: 'Title',
  presDescription: 'Description',
  presCanonical: 'Canonical',
  presMissing: 'missing',
  tileSeoErrors: 'SEO errors',
  tileSeoWarnings: 'SEO warnings',
  tileImgsNoAlt: 'Imgs no alt',
  tileWords: 'Words',
  tileIntLinks: 'Int links',
  tileExtLinks: 'Ext links',
  emptyErrors: 'Nothing failed outright on this page.',
  emptyWarnings: 'No warnings — every check is at best practice.',
  markerWarning: 'Warning',
  markerError: 'Error',
  tileViolations: 'Violations',
  tilePasses: 'Passes',
  tileIncomplete: 'Incomplete',
  drillNoViolations: 'axe-core found no violations on this page.',

  /* ---- panel ---- */
  tabSeo: 'SEO',
  reportSections: 'Report sections',
  reScanPage: 'Re-scan page',
  reScanAria: 'Re-scan the current page for SEO markup',
  seoScanComplete: 'SEO scan complete.',
  titleBadge: '{n} chars · target 30–60',
  descBadge: '{n} chars · target 120–160',
  metaCanonical: 'Canonical',
  metaRobots: 'Robots',
  serpPreviewH: 'Google result preview',
  hreflangH: 'hreflang',
  thLang: 'lang',
  thHref: 'href',
  headingOutlineH: 'Heading outline',
  copyHeadings: 'Copy headings',
  noHeadings: 'No headings found on this page.',
  skippedLevel: 'skipped level',
  statWords: 'Words',
  statInternalLinks: 'Internal links',
  statExternalLinks: 'External links',
  statImagesNoAlt: 'Images without alt',
  statSdBlocks: 'Structured data blocks',
  thinContent: 'Very little visible text; thin content ranks poorly.',
  extLinksHint:
    '{nofollow} nofollow · {sponsored} sponsored · {ugc} ugc (user-generated content)',
  noSdHint: 'No JSON-LD or microdata found. Rich results are unavailable without it.',
  socialPreviewH: 'Social preview',
  noOgImageLabel: 'no og:image',
  untitled: 'Untitled',
  noDescription: 'No description',
  summaryDefault: 'summary (default)',
  ogTypeSuffix: ' · og:type {type}',
  swNo: 'No ',
  swFb: ' — Facebook and LinkedIn (which read ',
  swBlankPreview: ') will show a blank preview. The image above is the ',
  swOnlyTwitter: ', which only X/Twitter uses.',
  swWithNo: 'With no ',
  swRenderBlank:
    ', this link preview will render blank when the page is shared on social platforms.',
  serpUntitled: 'Untitled page',
  serpNoDesc: 'No meta description — Google will synthesise a snippet.',
  serpMeterTitle: 'Title',
  serpMeterDesc: 'Description',
  serpWarnTitle: 'Title is {px}px, over the ~{max}px Google shows — it will be cut off. ',
  serpWarnDesc: 'Description is {px}px, over the ~{max}px shown — the tail is dropped.',
  sdH: 'Structured data',
  sdUntyped: '(untyped)',
  sdRequiredPresent: 'required properties present',
  sdMissingList: 'missing: {list}',
  checksH: 'Checks',
  copyChecks: 'Copy checks',
  copyAriaSuffix: '{label} to the clipboard',
  copiedShort: 'Copied',
  copiedReportAs: 'Copied report as {fmt}.',
  runAudit: 'Run audit',
  axeNote1: 'The audit bundles ',
  axeNote2:
    ' (MPL-2.0), which runs entirely in the browser — never fetched at runtime, since MV3 bans remote code. It is a separate chunk, injected into the page on demand only when you press the button, so it never loads on normal browsing.',
  auditingPage: 'Auditing the page with axe-core…',
  a11yCompleteOne: 'Accessibility audit complete: {n} violation found.',
  a11yCompleteOther: 'Accessibility audit complete: {n} violations found.',
  noViolationsDetected: 'No violations detected by axe-core.',

  /* ---- report vocabulary (report-ui.tsx) ---- */
  sevOk: 'Pass',
  sevWarning: 'Warning',
  sevError: 'Error',
  impCritical:
    'Blocks people with disabilities from using this content at all. Fix first.',
  impSerious: 'A severe barrier: many people will be blocked or badly slowed down.',
  impModerate: 'Frustrating, but most people can still work around it.',
  impMinor: 'A small annoyance affecting few people. Fix once the rest is done.',
  termViolations:
    'Accessibility rules this page BROKE. Each one names what is wrong and which elements are at fault.',
  termPasses:
    'Rules that ran and found nothing wrong. This counts RULES, not elements — a high number is normal and is not a score.',
  termIncomplete:
    'axe-core could not decide automatically and needs a human to look. Typically text over an image or a video, where contrast cannot be computed. Not necessarily a problem — just unproven.',
  termErrors:
    'Checks that failed outright — these actively cost you search visibility.',
  termWarnings:
    'Checks that passed but are below best practice. Worth fixing, not urgent.',
  termImagesWithoutAlt:
    'Images with no alt attribute. Screen readers announce nothing for them, and search engines cannot read them. alt="" is fine for purely decorative images.',
  impactCritical: 'critical',
  impactSerious: 'serious',
  impactModerate: 'moderate',
  impactMinor: 'minor',
  violElementsOne: '{count} element affected',
  violElementsOther: '{count} elements affected',
  violMoreOne: '+ {n} more element',
  violMoreOther: '+ {n} more elements',
  howToFix: '{id} — how to fix',

  /* ---- SEO checks (checks.ts) ---- */
  chkTitleLength: 'Title length',
  chkMetaDescription: 'Meta description',
  chkLanguage: 'Language',
  chkCanonicalUrl: 'Canonical URL',
  chkIndexability: 'Indexability',
  chkHeadingHierarchy: 'Heading hierarchy',
  chkImageAlt: 'Image alt text',
  chkSdValidity: 'Structured data validity',
  chkStructuredData: 'Structured data',
  chkSocialPreviewImage: 'Social preview image',
  chkSdCompleteness: 'Structured data completeness',
  chkMobileViewport: 'Mobile viewport',
  chkTapTargetSize: 'Tap target size',
  dTitleMissing: 'No <title>; the tab and search snippet have no headline.',
  dTitleShort: '{n} characters — below the 30–60 target.',
  dTitleLong: '{n} characters — above the 30–60 target; search engines truncate it.',
  dTitleOk: '{n} characters, within 30–60.',
  dDescMissing: 'Missing entirely; search engines will synthesise a snippet.',
  dDescShort:
    '{n} characters — below the 120–160 target; add detail to earn a fuller snippet.',
  dDescLong: '{n} characters — above the 120–160 target; search engines truncate it.',
  dDescOk: '{n} characters, within 120–160.',
  dLangMissing:
    'No <html lang>; assistive tech and search engines cannot detect the page language.',
  dLangOk: 'Declared as <html lang="{lang}">.',
  dCanonicalConflict:
    '{n} conflicting <link rel="canonical"> elements; search engines may ignore all of them.',
  dCanonicalMissing: 'No rel="canonical"; duplicate URLs may split ranking signals.',
  dCanonicalMatch: 'Matches the current URL.',
  dCanonicalElsewhere: 'Points elsewhere ({url}); this URL defers to it.',
  dIndexNoindex:
    'A robots directive (noindex/none, via robots or googlebot meta) excludes this page from search.',
  dIndexOk: 'No noindex directive; the page is indexable.',
  dHeadingNoH1: 'No <h1> found; the page has no top-level heading.',
  dHeadingMultiH1: '{n} <h1> elements; a page should have exactly one.',
  dHeadingSkipped: '{n} heading level jump(s); an outline should not skip levels.',
  dHeadingOk: 'One <h1> and no skipped levels.',
  dImgAltMissing:
    '{n} image(s) have no alt attribute (alt="" for decorative images is fine).',
  dImgAltOk: 'Every <img> has an alt attribute.',
  dSdParse: '{n} JSON-LD block(s) contain invalid JSON and will be ignored.',
  dSdNone: 'No JSON-LD or microdata found; rich results are unavailable.',
  dSdBlocks: '{n} block(s) found.',
  dOgImageMissing: 'og:image is missing; link previews will be blank when shared.',
  dOgImageOk: 'og:image is set.',
  dSdRequired: 'Required propert{plural} missing: {detail}.',
  dSdMissingItem: '{types} missing {props}',
  dViewportMissing:
    'No <meta name="viewport">; the page will not adapt to mobile screens.',
  dViewportNoDeviceWidth:
    'Viewport is set but lacks width=device-width; mobile layout may be wrong.',
  dViewportBlocksZoom:
    'Viewport disables zoom (user-scalable=no / maximum-scale=1); this fails accessibility.',
  dViewportOk: 'Responsive viewport with width=device-width.',
  dTapTargets:
    '{n} interactive element(s) render below the 24px tap-target floor; they are hard to tap on mobile.',

  /* ---- indexability checks (indexability.ts) ---- */
  idxRobotsLabel: 'robots.txt',
  idxSitemapLabel: 'sitemap.xml',
  idxFaviconLabel: 'Favicon',
  idxXRobotsLabel: 'X-Robots-Tag header',
  dRobotsCouldNotFetch: 'Could not fetch /robots.txt (network error or blocked).',
  dRobotsNone: 'No robots.txt found; crawlers get no crawl directives or sitemap hint.',
  dRobotsBlocksAll:
    'robots.txt blocks all crawlers from the whole site ("User-agent: *" + "Disallow: /").',
  dRobotsFound: 'robots.txt found',
  dRobotsSitemapYes: ' and it references a Sitemap.',
  dRobotsSitemapNo: ' (no Sitemap directive).',
  dSitemapOffOrigin:
    'robots.txt declares a Sitemap at {url} (off-origin; not verified here).',
  dSitemapCouldNotFetch: 'Could not fetch {url} (network error or blocked).',
  dSitemapServedRobots: 'A sitemap is served at {url} (declared in robots.txt).',
  dSitemapServedPlain: 'A sitemap is served at {url}.',
  dSitemapInvalidRobots:
    'robots.txt declares a Sitemap at {url}, but it did not return a valid sitemap.',
  dSitemapNone:
    'No valid /sitemap.xml at the default location, and robots.txt declares none (it may live elsewhere).',
  dFaviconDeclared: 'A favicon is declared via <link rel="icon">.',
  dFaviconMissing:
    'No <link rel="icon"> and no /favicon.ico; browsers and search results fall back to a generic icon.',
  dFaviconIco: 'No <link rel="icon">, but a favicon is served at /favicon.ico.',
  dFaviconUnknown:
    'No <link rel="icon"> declared (relying on a conventional /favicon.ico, not verified here).',
  dXRobotsNoindex:
    'Response header "X-Robots-Tag: {header}" contains noindex — this page is excluded from search.',
  dXRobotsScoped:
    'Response header "X-Robots-Tag: {header}" carries a bot-scoped noindex; it may exclude some crawlers (best-effort — read from a separate HEAD request).',
  dXRobotsPresent: 'Response header present: "X-Robots-Tag: {header}" (no noindex).',

  /* ---- background / content-script error states (shown in state--error) ---- */
  errAuditFailed: 'The accessibility audit failed.',
  errAuditTimedOut: 'The accessibility audit timed out.',
  errNoResult: 'The page did not return a result.',
  errCannotAudit:
    'This page cannot be audited, or it needs a reload for the auditor to attach.',
  errCannotAuditBrowser:
    'This page cannot be audited (browser or store pages are off-limits), or it needs a reload.',
} as const;

export type MsgKey = keyof typeof en;

const ru: Record<MsgKey, string> = {
  language: 'Язык',
  interfaceLanguage: 'Язык интерфейса',
  colourTheme: 'Цветовая тема',
  themeAuto: 'Авто',
  themeLight: 'Светлая',
  themeDark: 'Тёмная',

  readingPage: 'Чтение страницы…',
  runAxeAria: 'Запустить проверку доступности axe-core на этой странице',
  copyJson: 'Копировать JSON',
  copyMarkdown: 'Копировать Markdown',
  copyJsonAria: 'Скопировать отчёт как JSON в буфер обмена',
  copyMarkdownAria: 'Скопировать отчёт как Markdown в буфер обмена',
  couldNotCopy: 'Не удалось скопировать в буфер обмена.',
  accessibility: 'Доступность',
  metaH: 'Мета',
  missing: 'Отсутствует',
  running: 'Выполняется…',
  violationsH: 'Нарушения',
  noActiveTab: 'Нет активной вкладки.',

  appTitleShort: 'SEO и A11y',
  thisPage: 'эта страница',
  a11yRunHint:
    'Запустите axe-core на этой странице, чтобы перечислить нарушения по уровню важности.',
  auditingAxe: 'Проверка через axe-core…',
  runAccessibilityAudit: 'Запустить проверку доступности',
  exportH: 'Экспорт',
  copiedAs: 'Скопировано как {fmt}.',
  popupFooter:
    'Нажмите любое число выше, чтобы увидеть, из чего оно складывается. Откройте панель SEO и A11y (F12 → «SEO & A11y») для полного отчёта.',
  presTitle: 'Заголовок',
  presDescription: 'Описание',
  presCanonical: 'Canonical',
  presMissing: 'отсутствует',
  tileSeoErrors: 'Ошибки SEO',
  tileSeoWarnings: 'Предупреждения SEO',
  tileImgsNoAlt: 'Без alt',
  tileWords: 'Слова',
  tileIntLinks: 'Внутр. ссылки',
  tileExtLinks: 'Внеш. ссылки',
  emptyErrors: 'Ничего не провалилось на этой странице.',
  emptyWarnings: 'Предупреждений нет — каждая проверка на уровне лучших практик.',
  markerWarning: 'Предупреждение',
  markerError: 'Ошибка',
  tileViolations: 'Нарушения',
  tilePasses: 'Пройдено',
  tileIncomplete: 'Незавершено',
  drillNoViolations: 'axe-core не нашёл нарушений на этой странице.',

  tabSeo: 'SEO',
  reportSections: 'Разделы отчёта',
  reScanPage: 'Пересканировать',
  reScanAria: 'Пересканировать текущую страницу на SEO-разметку',
  seoScanComplete: 'SEO-сканирование завершено.',
  titleBadge: '{n} симв. · цель 30–60',
  descBadge: '{n} симв. · цель 120–160',
  metaCanonical: 'Canonical',
  metaRobots: 'Robots',
  serpPreviewH: 'Предпросмотр результата Google',
  hreflangH: 'hreflang',
  thLang: 'язык',
  thHref: 'href',
  headingOutlineH: 'Структура заголовков',
  copyHeadings: 'Копировать заголовки',
  noHeadings: 'На этой странице заголовков не найдено.',
  skippedLevel: 'пропущен уровень',
  statWords: 'Слова',
  statInternalLinks: 'Внутренние ссылки',
  statExternalLinks: 'Внешние ссылки',
  statImagesNoAlt: 'Изображения без alt',
  statSdBlocks: 'Блоки структурированных данных',
  thinContent: 'Очень мало видимого текста; тонкий контент плохо ранжируется.',
  extLinksHint:
    '{nofollow} nofollow · {sponsored} sponsored · {ugc} ugc (пользовательский контент)',
  noSdHint:
    'JSON-LD или микроразметка не найдены. Без них расширенные результаты недоступны.',
  socialPreviewH: 'Предпросмотр для соцсетей',
  noOgImageLabel: 'нет og:image',
  untitled: 'Без заголовка',
  noDescription: 'Без описания',
  summaryDefault: 'summary (по умолчанию)',
  ogTypeSuffix: ' · og:type {type}',
  swNo: 'Нет ',
  swFb: ' — Facebook и LinkedIn (которые читают ',
  swBlankPreview: ') покажут пустой предпросмотр. Изображение выше — это ',
  swOnlyTwitter: ', который использует только X/Twitter.',
  swWithNo: 'Без ',
  swRenderBlank:
    ' этот предпросмотр ссылки будет пустым при публикации страницы в соцсетях.',
  serpUntitled: 'Страница без заголовка',
  serpNoDesc: 'Нет meta description — Google синтезирует фрагмент.',
  serpMeterTitle: 'Заголовок',
  serpMeterDesc: 'Описание',
  serpWarnTitle:
    'Заголовок {px}px, больше ~{max}px, показываемых Google — он будет обрезан. ',
  serpWarnDesc:
    'Описание {px}px, больше показываемых ~{max}px — хвост отбрасывается.',
  sdH: 'Структурированные данные',
  sdUntyped: '(без типа)',
  sdRequiredPresent: 'обязательные свойства присутствуют',
  sdMissingList: 'отсутствует: {list}',
  checksH: 'Проверки',
  copyChecks: 'Копировать проверки',
  copyAriaSuffix: '{label} в буфер обмена',
  copiedShort: 'Скопировано',
  copiedReportAs: 'Отчёт скопирован как {fmt}.',
  runAudit: 'Запустить проверку',
  axeNote1: 'Проверка включает ',
  axeNote2:
    ' (MPL-2.0), который работает целиком в браузере — никогда не загружается во время выполнения, поскольку MV3 запрещает удалённый код. Это отдельный фрагмент, внедряемый в страницу по требованию только при нажатии кнопки, поэтому при обычном просмотре он не загружается.',
  auditingPage: 'Проверка страницы через axe-core…',
  a11yCompleteOne: 'Проверка доступности завершена: найдено {n} нарушение.',
  a11yCompleteOther: 'Проверка доступности завершена: найдено нарушений: {n}.',
  noViolationsDetected: 'axe-core не обнаружил нарушений.',

  sevOk: 'Пройдено',
  sevWarning: 'Предупреждение',
  sevError: 'Ошибка',
  impCritical:
    'Полностью блокирует использование этого контента людьми с ограниченными возможностями. Исправьте в первую очередь.',
  impSerious:
    'Серьёзный барьер: многие люди будут заблокированы или сильно замедлены.',
  impModerate: 'Раздражает, но большинство людей всё же может это обойти.',
  impMinor:
    'Небольшое неудобство, затрагивающее немногих. Исправьте, когда сделаете остальное.',
  termViolations:
    'Правила доступности, которые эта страница НАРУШИЛА. Каждое называет, что не так и какие элементы виноваты.',
  termPasses:
    'Правила, которые отработали и не нашли проблем. Считаются ПРАВИЛА, а не элементы — высокое число нормально и не является оценкой.',
  termIncomplete:
    'axe-core не смог решить автоматически, и нужен человек. Обычно это текст поверх изображения или видео, где контраст вычислить нельзя. Не обязательно проблема — просто не подтверждено.',
  termErrors:
    'Проверки, которые полностью провалились — они напрямую снижают вашу видимость в поиске.',
  termWarnings:
    'Проверки, которые пройдены, но ниже лучших практик. Стоит исправить, но не срочно.',
  termImagesWithoutAlt:
    'Изображения без атрибута alt. Скринридеры ничего для них не озвучивают, а поисковые системы не могут их прочитать. alt="" подходит для чисто декоративных изображений.',
  impactCritical: 'критический',
  impactSerious: 'серьёзный',
  impactModerate: 'умеренный',
  impactMinor: 'незначительный',
  violElementsOne: 'затронут {count} элемент',
  violElementsOther: 'затронуто элементов: {count}',
  violMoreOne: '+ ещё {n} элемент',
  violMoreOther: '+ ещё элементов: {n}',
  howToFix: '{id} — как исправить',

  chkTitleLength: 'Длина заголовка',
  chkMetaDescription: 'Meta description',
  chkLanguage: 'Язык',
  chkCanonicalUrl: 'Canonical URL',
  chkIndexability: 'Индексируемость',
  chkHeadingHierarchy: 'Иерархия заголовков',
  chkImageAlt: 'Альтернативный текст изображений',
  chkSdValidity: 'Корректность структурированных данных',
  chkStructuredData: 'Структурированные данные',
  chkSocialPreviewImage: 'Изображение для соцсетей',
  chkSdCompleteness: 'Полнота структурированных данных',
  chkMobileViewport: 'Мобильный viewport',
  chkTapTargetSize: 'Размер области нажатия',
  dTitleMissing: 'Нет <title>; у вкладки и поискового фрагмента нет заголовка.',
  dTitleShort: '{n} символов — ниже цели 30–60.',
  dTitleLong: '{n} символов — выше цели 30–60; поисковые системы его обрезают.',
  dTitleOk: '{n} символов, в пределах 30–60.',
  dDescMissing: 'Полностью отсутствует; поисковые системы синтезируют фрагмент.',
  dDescShort:
    '{n} символов — ниже цели 120–160; добавьте деталей, чтобы получить более полный фрагмент.',
  dDescLong: '{n} символов — выше цели 120–160; поисковые системы его обрезают.',
  dDescOk: '{n} символов, в пределах 120–160.',
  dLangMissing:
    'Нет <html lang>; вспомогательные технологии и поисковые системы не могут определить язык страницы.',
  dLangOk: 'Объявлено как <html lang="{lang}">.',
  dCanonicalConflict:
    '{n} конфликтующих элементов <link rel="canonical">; поисковые системы могут проигнорировать их все.',
  dCanonicalMissing:
    'Нет rel="canonical"; дублирующиеся URL могут разделить сигналы ранжирования.',
  dCanonicalMatch: 'Совпадает с текущим URL.',
  dCanonicalElsewhere: 'Указывает в другое место ({url}); этот URL уступает ему.',
  dIndexNoindex:
    'Директива robots (noindex/none, через meta robots или googlebot) исключает эту страницу из поиска.',
  dIndexOk: 'Директивы noindex нет; страница индексируема.',
  dHeadingNoH1: '<h1> не найден; у страницы нет заголовка верхнего уровня.',
  dHeadingMultiH1: '{n} элементов <h1>; на странице должен быть ровно один.',
  dHeadingSkipped:
    '{n} скачков уровня заголовков; структура не должна пропускать уровни.',
  dHeadingOk: 'Один <h1> и без пропущенных уровней.',
  dImgAltMissing:
    '{n} изображений без атрибута alt (alt="" для декоративных изображений допустимо).',
  dImgAltOk: 'У каждого <img> есть атрибут alt.',
  dSdParse: '{n} блоков JSON-LD содержат некорректный JSON и будут проигнорированы.',
  dSdNone:
    'JSON-LD или микроразметка не найдены; расширенные результаты недоступны.',
  dSdBlocks: 'Найдено блоков: {n}.',
  dOgImageMissing:
    'og:image отсутствует; предпросмотры ссылок будут пустыми при публикации.',
  dOgImageOk: 'og:image задан.',
  dSdRequired: 'Отсутствуют обязательные свойства: {detail}.',
  dSdMissingItem: 'у {types} отсутствует {props}',
  dViewportMissing:
    'Нет <meta name="viewport">; страница не адаптируется под мобильные экраны.',
  dViewportNoDeviceWidth:
    'Viewport задан, но без width=device-width; мобильная вёрстка может быть неверной.',
  dViewportBlocksZoom:
    'Viewport отключает масштабирование (user-scalable=no / maximum-scale=1); это нарушает доступность.',
  dViewportOk: 'Адаптивный viewport с width=device-width.',
  dTapTargets:
    '{n} интерактивных элементов меньше порога области нажатия 24px; по ним трудно попасть на мобильном.',

  idxRobotsLabel: 'robots.txt',
  idxSitemapLabel: 'sitemap.xml',
  idxFaviconLabel: 'Favicon',
  idxXRobotsLabel: 'Заголовок X-Robots-Tag',
  dRobotsCouldNotFetch:
    'Не удалось получить /robots.txt (сетевая ошибка или блокировка).',
  dRobotsNone:
    'robots.txt не найден; краулеры не получают директив обхода или подсказки о sitemap.',
  dRobotsBlocksAll:
    'robots.txt блокирует всех краулеров на всём сайте ("User-agent: *" + "Disallow: /").',
  dRobotsFound: 'robots.txt найден',
  dRobotsSitemapYes: ' и он ссылается на Sitemap.',
  dRobotsSitemapNo: ' (директивы Sitemap нет).',
  dSitemapOffOrigin:
    'robots.txt объявляет Sitemap по адресу {url} (другой источник; здесь не проверяется).',
  dSitemapCouldNotFetch: 'Не удалось получить {url} (сетевая ошибка или блокировка).',
  dSitemapServedRobots: 'Sitemap отдаётся по адресу {url} (объявлен в robots.txt).',
  dSitemapServedPlain: 'Sitemap отдаётся по адресу {url}.',
  dSitemapInvalidRobots:
    'robots.txt объявляет Sitemap по адресу {url}, но он не вернул корректный sitemap.',
  dSitemapNone:
    'По умолчанию /sitemap.xml корректного нет, и robots.txt его не объявляет (возможно, он в другом месте).',
  dFaviconDeclared: 'Favicon объявлен через <link rel="icon">.',
  dFaviconMissing:
    'Нет <link rel="icon"> и нет /favicon.ico; браузеры и результаты поиска используют общий значок.',
  dFaviconIco: 'Нет <link rel="icon">, но favicon отдаётся по /favicon.ico.',
  dFaviconUnknown:
    'Нет объявленного <link rel="icon"> (полагается на обычный /favicon.ico, здесь не проверяется).',
  dXRobotsNoindex:
    'Заголовок ответа "X-Robots-Tag: {header}" содержит noindex — эта страница исключена из поиска.',
  dXRobotsScoped:
    'Заголовок ответа "X-Robots-Tag: {header}" несёт noindex для конкретного бота; он может исключить некоторых краулеров (по возможности — прочитано из отдельного запроса HEAD).',
  dXRobotsPresent: 'Заголовок ответа присутствует: "X-Robots-Tag: {header}" (без noindex).',

  errAuditFailed: 'Проверка доступности не удалась.',
  errAuditTimedOut: 'Время проверки доступности истекло.',
  errNoResult: 'Страница не вернула результат.',
  errCannotAudit:
    'Эту страницу нельзя проверить, или требуется перезагрузка, чтобы аудитор подключился.',
  errCannotAuditBrowser:
    'Эту страницу нельзя проверить (внутренние страницы браузера или магазина недоступны), или требуется перезагрузка.',
};

const et: Record<MsgKey, string> = {
  language: 'Keel',
  interfaceLanguage: 'Liidese keel',
  colourTheme: 'Värviteema',
  themeAuto: 'Auto',
  themeLight: 'Hele',
  themeDark: 'Tume',

  readingPage: 'Lehe lugemine…',
  runAxeAria: 'Käivita sellel lehel axe-core ligipääsetavuse audit',
  copyJson: 'Kopeeri JSON',
  copyMarkdown: 'Kopeeri Markdown',
  copyJsonAria: 'Kopeeri raport JSON-ina lõikelauale',
  copyMarkdownAria: 'Kopeeri raport Markdownina lõikelauale',
  couldNotCopy: 'Lõikelauale kopeerimine ebaõnnestus.',
  accessibility: 'Ligipääsetavus',
  metaH: 'Meta',
  missing: 'Puudub',
  running: 'Töötab…',
  violationsH: 'Rikkumised',
  noActiveTab: 'Aktiivset kaarti pole.',

  appTitleShort: 'SEO ja A11y',
  thisPage: 'see leht',
  a11yRunHint:
    'Käivita sellel lehel axe-core, et loetleda rikkumised mõju järgi.',
  auditingAxe: 'Auditeerimine axe-core abil…',
  runAccessibilityAudit: 'Käivita ligipääsetavuse audit',
  exportH: 'Eksport',
  copiedAs: 'Kopeeritud kui {fmt}.',
  popupFooter:
    'Puuduta ülal mis tahes arvu, et näha, millest see koosneb. Ava SEO ja A11y paneel (F12 → „SEO & A11y“) täisraporti jaoks.',
  presTitle: 'Pealkiri',
  presDescription: 'Kirjeldus',
  presCanonical: 'Canonical',
  presMissing: 'puudub',
  tileSeoErrors: 'SEO vead',
  tileSeoWarnings: 'SEO hoiatused',
  tileImgsNoAlt: 'Ilma altita',
  tileWords: 'Sõnad',
  tileIntLinks: 'Sisel. lingid',
  tileExtLinks: 'Välis. lingid',
  emptyErrors: 'Sellel lehel ei kukkunud midagi otseselt läbi.',
  emptyWarnings: 'Hoiatusi pole — iga kontroll on parima tava tasemel.',
  markerWarning: 'Hoiatus',
  markerError: 'Viga',
  tileViolations: 'Rikkumised',
  tilePasses: 'Läbitud',
  tileIncomplete: 'Lõpetamata',
  drillNoViolations: 'axe-core ei leidnud sellel lehel rikkumisi.',

  tabSeo: 'SEO',
  reportSections: 'Raporti jaotised',
  reScanPage: 'Skanni uuesti',
  reScanAria: 'Skanni praegust lehte SEO-märgistuse osas uuesti',
  seoScanComplete: 'SEO skannimine on valmis.',
  titleBadge: '{n} tähem. · siht 30–60',
  descBadge: '{n} tähem. · siht 120–160',
  metaCanonical: 'Canonical',
  metaRobots: 'Robots',
  serpPreviewH: 'Google tulemuse eelvaade',
  hreflangH: 'hreflang',
  thLang: 'keel',
  thHref: 'href',
  headingOutlineH: 'Pealkirjade struktuur',
  copyHeadings: 'Kopeeri pealkirjad',
  noHeadings: 'Sellel lehel ei leitud pealkirju.',
  skippedLevel: 'vahele jäetud tase',
  statWords: 'Sõnad',
  statInternalLinks: 'Sisemised lingid',
  statExternalLinks: 'Välised lingid',
  statImagesNoAlt: 'Pildid ilma altita',
  statSdBlocks: 'Struktuurandmete plokid',
  thinContent: 'Väga vähe nähtavat teksti; õhuke sisu reastub halvasti.',
  extLinksHint:
    '{nofollow} nofollow · {sponsored} sponsored · {ugc} ugc (kasutaja loodud sisu)',
  noSdHint:
    'JSON-LD-d ega mikroandmeid ei leitud. Ilma nendeta pole rikkalikud tulemused saadaval.',
  socialPreviewH: 'Sotsiaalmeedia eelvaade',
  noOgImageLabel: 'og:image puudub',
  untitled: 'Pealkirjata',
  noDescription: 'Kirjeldust pole',
  summaryDefault: 'summary (vaikimisi)',
  ogTypeSuffix: ' · og:type {type}',
  swNo: 'Puudub ',
  swFb: ' — Facebook ja LinkedIn (mis loevad ',
  swBlankPreview: ') näitavad tühja eelvaadet. Ülal olev pilt on ',
  swOnlyTwitter: ', mida kasutab ainult X/Twitter.',
  swWithNo: 'Kuna puudub ',
  swRenderBlank:
    ', kuvatakse see lingi eelvaade tühjalt, kui lehte sotsiaalplatvormidel jagatakse.',
  serpUntitled: 'Pealkirjata leht',
  serpNoDesc: 'Meta-kirjeldus puudub — Google sünteesib katkendi.',
  serpMeterTitle: 'Pealkiri',
  serpMeterDesc: 'Kirjeldus',
  serpWarnTitle:
    'Pealkiri on {px}px, üle ~{max}px, mida Google näitab — see lõigatakse ära. ',
  serpWarnDesc:
    'Kirjeldus on {px}px, üle näidatava ~{max}px — saba jäetakse ära.',
  sdH: 'Struktuurandmed',
  sdUntyped: '(tüübita)',
  sdRequiredPresent: 'kohustuslikud omadused olemas',
  sdMissingList: 'puudub: {list}',
  checksH: 'Kontrollid',
  copyChecks: 'Kopeeri kontrollid',
  copyAriaSuffix: '{label} lõikelauale',
  copiedShort: 'Kopeeritud',
  copiedReportAs: 'Raport kopeeritud kui {fmt}.',
  runAudit: 'Käivita audit',
  axeNote1: 'Audit sisaldab ',
  axeNote2:
    ' (MPL-2.0), mis töötab täielikult brauseris — seda ei laadita kunagi käitusajal, kuna MV3 keelab kaugkoodi. See on eraldi tükk, mis süstitakse lehele nõudmisel ainult siis, kui vajutad nuppu, seega tavalisel sirvimisel seda ei laadita.',
  auditingPage: 'Lehe auditeerimine axe-core abil…',
  a11yCompleteOne: 'Ligipääsetavuse audit valmis: leiti {n} rikkumine.',
  a11yCompleteOther: 'Ligipääsetavuse audit valmis: leiti {n} rikkumist.',
  noViolationsDetected: 'axe-core ei tuvastanud rikkumisi.',

  sevOk: 'Läbitud',
  sevWarning: 'Hoiatus',
  sevError: 'Viga',
  impCritical:
    'Takistab puuetega inimestel seda sisu üldse kasutamast. Paranda esimesena.',
  impSerious: 'Tõsine takistus: paljud jäävad blokeerituks või tugevalt aeglustatuks.',
  impModerate: 'Häiriv, kuid enamik saab sellest siiski mööda.',
  impMinor: 'Väike ebamugavus, mis puudutab väheseid. Paranda, kui ülejäänu on tehtud.',
  termViolations:
    'Ligipääsetavuse reeglid, mida see leht RIKKUS. Igaüks nimetab, mis on valesti ja millised elemendid on süüdi.',
  termPasses:
    'Reeglid, mis jooksid ja ei leidnud midagi valesti. See loeb REEGLEID, mitte elemente — kõrge arv on tavaline ega ole hinne.',
  termIncomplete:
    'axe-core ei suutnud automaatselt otsustada ja vajab inimese pilku. Tavaliselt tekst pildi või video peal, kus kontrasti ei saa arvutada. Mitte tingimata probleem — lihtsalt tõestamata.',
  termErrors:
    'Kontrollid, mis kukkusid otseselt läbi — need maksavad sulle aktiivselt otsingunähtavust.',
  termWarnings:
    'Kontrollid, mis läbisid, kuid on alla parima tava. Väärt parandamist, mitte kiireloomuline.',
  termImagesWithoutAlt:
    'Pildid ilma alt-atribuudita. Ekraanilugejad ei teata nende kohta midagi ja otsingumootorid ei saa neid lugeda. alt="" sobib puhtalt dekoratiivsetele piltidele.',
  impactCritical: 'kriitiline',
  impactSerious: 'tõsine',
  impactModerate: 'mõõdukas',
  impactMinor: 'väike',
  violElementsOne: 'mõjutatud {count} element',
  violElementsOther: 'mõjutatud {count} elementi',
  violMoreOne: '+ veel {n} element',
  violMoreOther: '+ veel {n} elementi',
  howToFix: '{id} — kuidas parandada',

  chkTitleLength: 'Pealkirja pikkus',
  chkMetaDescription: 'Meta description',
  chkLanguage: 'Keel',
  chkCanonicalUrl: 'Canonical URL',
  chkIndexability: 'Indekseeritavus',
  chkHeadingHierarchy: 'Pealkirjade hierarhia',
  chkImageAlt: 'Piltide alt-tekst',
  chkSdValidity: 'Struktuurandmete korrektsus',
  chkStructuredData: 'Struktuurandmed',
  chkSocialPreviewImage: 'Sotsiaalmeedia eelvaate pilt',
  chkSdCompleteness: 'Struktuurandmete terviklikkus',
  chkMobileViewport: 'Mobiilne viewport',
  chkTapTargetSize: 'Puuteala suurus',
  dTitleMissing: '<title> puudub; kaardil ja otsingukatkendil pole pealkirja.',
  dTitleShort: '{n} tähemärki — alla sihi 30–60.',
  dTitleLong: '{n} tähemärki — üle sihi 30–60; otsingumootorid lõikavad selle ära.',
  dTitleOk: '{n} tähemärki, vahemikus 30–60.',
  dDescMissing: 'Täielikult puudu; otsingumootorid sünteesivad katkendi.',
  dDescShort:
    '{n} tähemärki — alla sihi 120–160; lisa detaili, et teenida täielikum katkend.',
  dDescLong: '{n} tähemärki — üle sihi 120–160; otsingumootorid lõikavad selle ära.',
  dDescOk: '{n} tähemärki, vahemikus 120–160.',
  dLangMissing:
    '<html lang> puudub; abitehnoloogia ja otsingumootorid ei suuda lehe keelt tuvastada.',
  dLangOk: 'Deklareeritud kui <html lang="{lang}">.',
  dCanonicalConflict:
    '{n} vastuolulist <link rel="canonical"> elementi; otsingumootorid võivad need kõik eirata.',
  dCanonicalMissing:
    'rel="canonical" puudub; duplikaat-URL-id võivad reastussignaalid laiali jagada.',
  dCanonicalMatch: 'Ühtib praeguse URL-iga.',
  dCanonicalElsewhere: 'Osutab mujale ({url}); see URL loovutab sellele.',
  dIndexNoindex:
    'robots-direktiiv (noindex/none, meta robots või googlebot kaudu) välistab selle lehe otsingust.',
  dIndexOk: 'noindex-direktiivi pole; leht on indekseeritav.',
  dHeadingNoH1: '<h1> ei leitud; lehel pole ülataseme pealkirja.',
  dHeadingMultiH1: '{n} <h1> elementi; lehel peaks olema täpselt üks.',
  dHeadingSkipped:
    '{n} pealkirjataseme hüpet; struktuur ei tohiks tasemeid vahele jätta.',
  dHeadingOk: 'Üks <h1> ja ühtegi vahele jäetud taset pole.',
  dImgAltMissing:
    '{n} pildil pole alt-atribuuti (alt="" dekoratiivsete piltide puhul sobib).',
  dImgAltOk: 'Igal <img>-il on alt-atribuut.',
  dSdParse: '{n} JSON-LD plokki sisaldavad vigast JSON-i ja jäetakse arvestamata.',
  dSdNone:
    'JSON-LD-d ega mikroandmeid ei leitud; rikkalikud tulemused pole saadaval.',
  dSdBlocks: 'Leitud plokke: {n}.',
  dOgImageMissing:
    'og:image puudub; lingi eelvaated on jagamisel tühjad.',
  dOgImageOk: 'og:image on määratud.',
  dSdRequired: 'Puuduvad kohustuslikud omadused: {detail}.',
  dSdMissingItem: '{types} juures puudub {props}',
  dViewportMissing:
    '<meta name="viewport"> puudub; leht ei kohandu mobiiliekraanidele.',
  dViewportNoDeviceWidth:
    'Viewport on määratud, kuid ilma width=device-width; mobiilipaigutus võib olla vale.',
  dViewportBlocksZoom:
    'Viewport keelab suumimise (user-scalable=no / maximum-scale=1); see rikub ligipääsetavust.',
  dViewportOk: 'Reageeriv viewport koos width=device-width.',
  dTapTargets:
    '{n} interaktiivset elementi renderdub alla 24px puuteala läve; neid on mobiilis raske puudutada.',

  idxRobotsLabel: 'robots.txt',
  idxSitemapLabel: 'sitemap.xml',
  idxFaviconLabel: 'Favicon',
  idxXRobotsLabel: 'X-Robots-Tag päis',
  dRobotsCouldNotFetch:
    '/robots.txt hankimine ebaõnnestus (võrguviga või blokeeritud).',
  dRobotsNone:
    'robots.txt-i ei leitud; roomajad ei saa roomamisdirektiive ega sitemap-vihjet.',
  dRobotsBlocksAll:
    'robots.txt blokeerib kõik roomajad kogu saidil ("User-agent: *" + "Disallow: /").',
  dRobotsFound: 'robots.txt leitud',
  dRobotsSitemapYes: ' ja see viitab Sitemapile.',
  dRobotsSitemapNo: ' (Sitemap-direktiivi pole).',
  dSitemapOffOrigin:
    'robots.txt deklareerib Sitemapi aadressil {url} (teine päritolu; siin ei kontrollita).',
  dSitemapCouldNotFetch: '{url} hankimine ebaõnnestus (võrguviga või blokeeritud).',
  dSitemapServedRobots: 'Sitemap serveeritakse aadressil {url} (deklareeritud robots.txt-is).',
  dSitemapServedPlain: 'Sitemap serveeritakse aadressil {url}.',
  dSitemapInvalidRobots:
    'robots.txt deklareerib Sitemapi aadressil {url}, kuid see ei tagastanud kehtivat sitemapi.',
  dSitemapNone:
    'Vaikeasukohas /sitemap.xml kehtivat pole ja robots.txt ei deklareeri ühtegi (see võib olla mujal).',
  dFaviconDeclared: 'Favicon on deklareeritud <link rel="icon"> kaudu.',
  dFaviconMissing:
    'Ei <link rel="icon"> ega /favicon.ico; brauserid ja otsingutulemused kasutavad üldist ikooni.',
  dFaviconIco: 'Ei <link rel="icon">, kuid favicon serveeritakse aadressil /favicon.ico.',
  dFaviconUnknown:
    'Deklareeritud <link rel="icon"> puudub (tugineb tavapärasele /favicon.ico-le, siin ei kontrollita).',
  dXRobotsNoindex:
    'Vastuse päis "X-Robots-Tag: {header}" sisaldab noindex-i — see leht on otsingust välistatud.',
  dXRobotsScoped:
    'Vastuse päis "X-Robots-Tag: {header}" kannab botile suunatud noindex-i; see võib mõned roomajad välistada (parim jõupingutus — loetud eraldi HEAD-päringust).',
  dXRobotsPresent: 'Vastuse päis olemas: "X-Robots-Tag: {header}" (ilma noindexita).',

  errAuditFailed: 'Ligipääsetavuse audit ebaõnnestus.',
  errAuditTimedOut: 'Ligipääsetavuse auditi aeg lõppes.',
  errNoResult: 'Leht ei tagastanud tulemust.',
  errCannotAudit:
    'Seda lehte ei saa auditeerida või on vaja uuesti laadida, et audiitor ühenduks.',
  errCannotAuditBrowser:
    'Seda lehte ei saa auditeerida (brauseri või poe sisemised lehed on välistatud) või on vaja uuesti laadida.',
};

const messages: Catalog<MsgKey> = { en, ru, et };

const translate = createTranslator<MsgKey>(messages);

/** Hook: a locale-bound `t()` for the React surfaces (popup / DevTools panel). */
export function useT(): TFn {
  const locale = useLocale();
  return useCallback(
    (key: MsgKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
}

/** Imperative translator for the non-React content script, which resolves the
 *  locale from storage rather than from React context, so a scanned report's
 *  check prose is stamped in the user's language. */
export function tAt(
  locale: Locale,
  key: MsgKey,
  vars?: Record<string, string | number>,
): string {
  return translate(locale, key, vars);
}
