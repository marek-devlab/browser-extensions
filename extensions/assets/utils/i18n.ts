import { createTranslator, useLocale, type Catalog, type Locale } from '@blur/ui';
import { useCallback } from 'react';

// Runtime UI catalog for the Asset Inspector. English is the source of truth AND
// the default (see @blur/ui's DEFAULT_LOCALE); `ru` and `et` are complete mirrors.
//
// 🔴 What is deliberately NOT translated (design + house rules):
//   - MIME / format tokens (image/png, video/mp4, .m4v), initiatorType words,
//     media-error codes (MEDIA_ERR_*), CSS property text, selectors, URLs, numbers,
//     units (B/KB/MB/px) — those are FACTS about the page, not our prose.
//   - Console text, storage keys, comments.
// Everything a human READS in the UI does go through here, so switching the locale
// re-renders every surface (popup, options, DevTools panel, and the injected card).

/** A translator bound to a locale — the shape produced by both `useT()` (React) and
 *  the content-script closure over `tAt`. Pure helpers take this as a param so they
 *  never import React (keeps the content-script bundle lean). */
export type TFn = (key: MsgKey, vars?: Record<string, string | number>) => string;

const en = {
  /* ---- shared ---- */
  loading: 'Loading…',
  cancel: 'Cancel',
  reloadPage: 'Reload the page',
  settings: 'Settings',
  element: 'element',
  currentSrc: 'currentSrc',
  frames: 'Frames',
  weightLabel: 'Weight',
  statusLabel: 'Status',
  mimeLabel: 'MIME',
  naturalSizeLabel: 'Natural size',

  /* ---- language switcher (options) ---- */
  language: 'Language',
  interfaceLanguage: 'Interface language',

  /* ---- options page ---- */
  optTitle: 'Asset Inspector — Settings',
  secAppearance: 'Appearance',
  fldTheme: 'Theme',
  fldSizeUnits: 'Size units',
  unit1024: 'KB/MB (1024)',
  unit1000: 'kB/MB (1000)',
  secPicker: 'Picker',
  fldShortcut: 'Shortcut',
  changeInBrowser: 'Change in the browser ↗',
  tglBreadcrumbs: 'Show ancestor breadcrumbs',
  tglAutoResource: 'Auto-select nearest resource (R automatically)',
  tglPreview: 'Canvas preview',
  tglPreviewHint:
    'The preview is drawn from the already-loaded element. We never request the shown URL again.',
  secCard: 'Card',
  fldOverweight: 'Overweight threshold',
  optDontShow: 'don’t show',
  tglSrcsetExpanded: 'Expand the srcset table by default',
  fldShowRequests: 'Show requests',
  scopeRelated: 'related to the element',
  scopeAll: 'all page requests',
  secHints: 'Hints',
  tglHints: '“How to get the missing data” hints',
  btnShowHints: 'Show all hints again',
  secData: 'Data',
  fldBufferSize: 'Request buffer size',
  dataWarning:
    '⚠️ Applied on the next page load. Requests the browser already dropped cannot be recovered.',
  optFooter:
    'The extension stores nothing about the pages you visit and sends no data anywhere. The URLs it shows, it does not request.',

  /* ---- popup ---- */
  pupTitle: 'Asset Inspector',
  pupPick: 'Point to an element',
  pupPickAria: 'Point to an element on this page and inspect where it came from',
  pupCantRun: 'The inspector can’t run on this page.',
  pupRightClickPre: 'Or right-click an image / video / audio → ',
  whatIsThis: 'What is this element?',
  pupRightClickPost: ' (where the browser offers a context menu).',
  pupOnPage: 'What is on this page',
  pupCounting: 'Counting…',
  pupReqRecorded: 'Requests recorded',
  pupImages: 'Images',
  pupMediaElements: 'Media elements',
  pupBufOverflowTitle: 'The request buffer overflowed',
  pupBufNearTitle: 'The request buffer is nearly full',
  pupBufBody:
    'Recorded {recorded} of {limit}. Past the cap the browser stops recording new requests — it drops the new ones, it does not evict the old ones, so the late requests on this page go missing. Reload the page and the inspector raises the cap; what was already dropped cannot come back.',
  settingsArrow: 'Settings →',

  /* ---- devtools panel ---- */
  pnlPick: 'Point to an element on the page',
  pnlPicking: 'Click an element on the page…',
  pnlFindReq: 'Find a captured request…',
  pnlWaitingPick: 'Waiting for a pick',
  pnlInspecting: 'Inspecting',
  pnlReqCapturedOne: '{count} request captured',
  pnlReqCapturedOther: '{count} requests captured',
  pnlCapAfterTitle: 'The panel only sees requests made AFTER DevTools opened',
  pnlCapAfterBody:
    'Reload the page to capture everything — the initiator and the redirect chain exist nowhere else.',
  pnlNavTitle: 'The page navigated',
  pnlNavBody:
    'The captured request list was cleared — it described the previous document. Pick an element again once the new page has settled.',
  pnlCantPickTitle: 'Cannot run the picker here',
  pnlCantPickErr:
    'This page cannot be scripted from the panel (a browser-internal page, or its CSP blocks eval).',
  pnlEmptyTitle: 'Pick an element',
  pnlEmptyHint:
    'The panel shows what a page can never see about a resource: which script requested it, the redirect chain it travelled, its exact MIME type and HTTP status.',
  pnlMatching: 'Captured requests matching “{filter}”',
  pnlPickerTip: 'Asset Inspector: click an element · Esc to cancel',
  mimeExact: 'ⓘ from the response — exact',
  mimeNoRecord: 'ⓘ DevTools has no record of this request',
  statusNoRecord: 'no record — reload the page with DevTools open',
  weightWire: 'ⓘ bytes on the wire (_transferSize)',
  noResourceUrlParen: '(this element has no resource URL)',
  redirectChain: 'Redirect chain',
  redirectStepOne: '{n} step',
  redirectStepOther: '{n} steps',
  redirectNoRecordPanel:
    'No record for this URL yet. DevTools only captures requests made after it opened — reload the page.',
  redirectNonePanel: 'No redirect: the browser fetched this URL directly.',
  redirectFinalOnly:
    'ⓘ The intermediate hops are not in Resource Timing at all — it reports only the final URL. This chain exists nowhere but here.',
  whoRequested: 'Who requested it',
  noInitiatorPanel:
    'No initiator recorded for this URL. Reload the page with DevTools open — the initiator is captured at request time, not afterwards.',
  initiatorHarNote:
    'ⓘ This is _initiator from the HAR. Outside DevTools these lines do not exist — no extension API returns them, which is why the card says “type only”.',

  /* ---- injected card: picker chrome ---- */
  pointAtElement: 'Point at an element',
  pickerKeys:
    '↑ parent · ↓ child · ← → siblings · [ ] stack · R nearest resource · Enter select · Esc cancel',
  inspectThisElement: 'Inspect this element',
  cancelPickerAria: 'Cancel the element picker',
  // Picker overlay chrome built inside utils/element-picker.ts.
  pickerActive: 'Element picker active. Move the pointer or press arrow keys.',
  pickTagResource: ' · resource',
  pickTagStack: ' · {i} of {total} under cursor',
  pickAnnounce: '{label}, {w} × {h}, {resource}{stack}',
  pickHasResource: 'has a resource',
  pickNoResource: 'no resource',
  pickStackSuffix: ', {i} of {total} under the cursor',

  /* ---- injected card: chrome ---- */
  cardTitle: 'Asset Inspector',
  cardAria: 'Asset Inspector — resource card',
  collapseCard: 'Collapse the card',
  closeInspector: 'Close the inspector',
  staleTitle: '⚠️ The element was removed from the page.',
  staleBody: 'Everything below is a snapshot taken when you picked it.',
  couldNotRead: 'This element could not be read.',
  inspectAnother: 'Inspect another element',
  copyAsJson: 'Copy as JSON',
  copy: 'Copy',
  copied: 'Copied ✓',
  copyFailed: 'Copy failed',
  openNewTab: 'Open in a new tab ↗',
  previewAria: 'Preview drawn from the element already on the page',
  previewNoFrame: 'no frame',
  previewProtected: 'frame unavailable: protected content',

  /* ---- identity line ---- */
  kindImage: 'Image',
  kindVideo: 'Video',
  kindAudio: 'Audio',
  kindFrame: 'Frame',
  kindCssBg: 'CSS background image',
  kindNone: 'No resource',
  mimeByExt: '{mime} (by file extension)',
  declaredSuffix: '{type} — declared by the markup, not verified',
  didNotLoad: 'did not load',

  /* ---- URL section ---- */
  secUrl: 'URL',
  noUrl: '(no URL)',
  urlActual:
    'This is what the browser ACTUALLY loaded (currentSrc) — not what the markup asked for.',
  markupAsked: 'The markup asked for: {src}',

  /* ---- callouts ---- */
  resNotLoad: 'This resource did NOT load.',
  resNotLoadCode: 'This resource did NOT load ({code}).',
  blobTitle: 'blob: is not a file.',
  blobBody:
    'It is a pointer to data held in this tab’s memory. Nothing exists at that address — not on a server, not on disk.',
  bufIncompleteTitle: 'The request list may be incomplete.',
  bufFull:
    'The request buffer is FULL ({recorded} of {limit}). The browser has stopped recording — it drops NEW requests, it does not evict old ones, so the late ones on this page are simply missing. Reloading raises the cap for the next load; it cannot bring back what was already dropped.',
  bufNear:
    'Recorded {recorded} of {limit} requests. Past the cap the browser stops recording new ones.',

  /* ---- overweight ---- */
  secOverweight: 'Overweight',
  overweightHeader: '⚠️ OVERWEIGHT {ratio}×',
  barNatural: 'natural',
  barNeeded: 'needed (DPR {dpr})',
  barDisplayed: 'displayed',
  overweightWasted:
    '{percent} of the pixels are wasted at the current window size. {why}',
  whyNoSizes:
    'There is no `sizes` attribute, so the browser assumed the image fills the viewport (100vw) and picked the biggest candidate. That is the most common cause.',
  whyGeneric:
    'Usually one of two things: srcset has no candidate of a fitting size, or `sizes` told the browser the wrong slot width.',

  /* ---- srcset ---- */
  srcsetDisagreeTitle: '⚠️ The browser loaded something other than the rule predicts.',
  srcsetDisagreeBody:
    'The ✔ row is the FACT (currentSrc). Our recomputation is below it as an explanation — a candidate already in the cache, a reduced-data mode, or rounding can all override the rule.',
  viewportDpr: 'Viewport {vw} css-px · DPR {dpr}',
  sizesNotSet: 'sizes: not set → the browser treats the slot as 100vw',
  sizesSet: 'sizes: {sizes} → slot {slot}',
  slotNotComputable: 'not computable',
  slotCssPx: '{n} css-px',
  srcsetDivides:
    'The browser divides each w-descriptor by the slot width and takes the SMALLEST candidate whose density reaches the DPR ({dpr}).',
  srcsetModelHint:
    'Only ✔ CHOSEN is a fact — it comes from currentSrc. The densities and the “why” column are our reconstruction of the specification, and the browser is allowed to differ from it.',
  srcsetSummaryOne: 'What the browser chose from srcset — {n} candidate',
  srcsetSummaryOther: 'What the browser chose from srcset — {n} candidates',
  srcsetStage1Caption: 'Stage 1 — which <source> of the <picture> won',
  colType: 'type',
  colMedia: 'media',
  colVerdict: 'Verdict',
  srcWon: '✔ WON',
  srcMediaNoMatch: '✘ media did not match',
  srcNotReached: '✘ not reached / format not taken',
  srcsetStage2Caption: 'Stage 2 — candidates, and why each won or lost (DPR {dpr})',
  colCandidate: 'Candidate',
  colDescriptor: 'Descriptor',
  colDensity: 'Density',
  candChosen: '✔ CHOSEN',
  candModelWould: '● our model would pick this',
  candReason: '✘ {reason}',
  reasonSlotUnknown: 'slot width unknown — density not computable',
  reasonFirstAboveDpr: 'first density ≥ DPR {dpr}',
  reasonBelowDpr: '× {density} < DPR {dpr}',
  reasonLargerThanNeeded: '× {density} — larger than needed',

  /* ---- properties ---- */
  secProperties: 'Properties',
  propType: 'Type',
  mimeGuessedHint:
    '  ⓘ guessed from the file extension — the exact MIME is only in the DevTools panel',
  propDeclaredFormat: 'Declared format',
  declaredClaimedHint: '{type} ⓘ claimed by the markup, not verified',
  propDisplayed: 'Displayed',
  displayedValue: '{disp} css-px · DPR {dpr} → {dev} device px',
  propDuration: 'Duration',
  framesValue: '{rendered} rendered · {dropped} dropped ⓘ getVideoPlaybackQuality()',
  weightReasonHint: '  ⓘ {reason}',
  taoHint:
    'The server did not send a `Timing-Allow-Origin` header, so the browser hides the size and the timings of that other origin from this page. The exact size is visible in the DevTools panel (HAR `_transferSize`).',
  propHttpStatus: 'HTTP status',
  statusNotMeasured: 'not measured ⓘ cross-origin without Timing-Allow-Origin',
  propAttributes: 'Attributes',
  propAlt: 'alt',
  altEmpty: '(empty — decorative)',
  altValue: '«{alt}»',
  propSelector: 'Selector',

  /* ---- requests ---- */
  secRequests: 'Requests that loaded it',
  secRequestsHeuristic: 'Requests that loaded it — heuristic',
  noReqRecord:
    'No request record found for this URL. It can mean: the page called performance.clearResourceTimings() (SPA frameworks do); the buffer filled up and the browser stopped recording; or it came from the cache before the buffer was raised.',
  reqCountOne: '{count} request',
  reqCountOther: '{count} requests',
  reqCrossOrigin: 'cross-origin',
  reqSameOrigin: 'same origin',
  reqRow: '{kind} · {count} · {origin}',
  initiatorTypeLine:
    'initiator type: {type} — which script, at which line, is not available outside DevTools',
  initiatorHint:
    'A page can only see the initiator TYPE (img / css / script / fetch). The actual script and line live in the HAR `_initiator`, which no extension API exposes. Open DevTools → the “Assets” panel → reload the page.',
  requestsHeuristicNote:
    '⚠️ Matched by request type and host, not by fact. With two players on one page these cannot be told apart. Exact attribution exists only in the DevTools panel.',

  /* ---- redirects ---- */
  secRedirects: 'Redirects',
  redirectOccurred:
    'There WAS a redirect (the timings say so). The intermediate URLs are not in Resource Timing at all — only the DevTools panel has them.',
  redirectNone: 'No redirect.',
  redirectUnknown:
    'Unknown — this is a cross-origin resource without Timing-Allow-Origin, so the browser will not even tell the page whether a redirect happened. The chain is visible in the DevTools panel.',
  redirectHint:
    'Resource Timing only ever reports the FINAL URL. The DevTools HAR keeps the 30x records and the `redirectURL` of each hop — that is why the chain is a panel feature.',

  /* ---- MSE / DRM ---- */
  mseNoUrlTitle: 'This video has NO direct URL.',
  mseNoUrlBody:
    'The player assembles it in memory from thousands of small segments (Media Source Extensions). There is no single file to point at — that is how adaptive streaming works, and it is a property of the platform, not a limit of this inspector.',
  mseNone: '(none)',
  mseMechanism: 'Mechanism',
  mseMechanismValue: 'Media Source Extensions (MSE)',
  mseResolution: 'Resolution',
  mseResolutionValue: '{dim} — the current quality; the player changes it on the fly',
  mseFramesValue: '{rendered} rendered · {dropped} dropped',
  secSource: 'Source',
  secProtection: 'Content protection',
  drmActive: 'DRM detected: EME is active (video.mediaKeys is set).',
  drmNone: 'No EME detected on this element.',
  drmExplain:
    'Decryption happens inside the browser’s own content decryption module — a binary component. No extension, and no other JavaScript, ever sees decrypted frames. We do not print the name of the protection system: learning it would require running a script on every site before the player starts, and we do not ask for that permission.',
  secWhyWorks: 'Why it works this way',
  mseWhyExplain:
    'Streaming means thousands of small segments instead of one file, so quality can adapt to the network in real time. The manifest may appear in the request list below as a fact about the page — this inspector never opens it and never parses it.',

  /* ---- iframe ---- */
  iframeNoLookTitle: 'We do not look inside this frame.',
  iframeNoLookBody:
    'It is loaded from {host}, while the page is {page}. The browser isolates origins from each other: neither an extension nor the page’s own scripts can see inside. That is protection, not breakage.',
  iframeAnotherOrigin: 'another origin',
  iframeSameTitle: 'Same-origin frame.',
  iframeSameBody:
    'This frame shares the page’s origin. Re-run the picker inside it to inspect its elements.',
  secWhatYouCanDo: 'What you can do',
  iframeWhatDo:
    'Open the frame URL in a new tab (the button above). There it becomes an ordinary page, and the inspector works exactly as it does everywhere else.',

  /* ---- no resource / data ---- */
  noLoadedResTitle: 'This element has NO loaded resource.',
  noLoadedResBody: 'It is painted by CSS: {rule} — code in a stylesheet, not a file.',
  aStyleRule: 'a style rule',
  nestedResHint:
    'There IS a resource on a nested element: {label}. Press R in the picker to jump to the nearest one.',
  closedShadowTitle: 'This element renders content we cannot reach.',
  closedShadowBody:
    'It is a custom element with nothing in its light DOM, which means its content lives in a CLOSED shadow root. The browser hides those from every script — this extension included. That is the site’s decision, not a limitation of the inspector.',
  dataEmbeddedTitle: 'The bytes are embedded in the page.',
  dataEmbeddedBody:
    'A data: URI carries its own content — no network request was ever made for it, so it does not appear in the request list, and it never will.',
  dataPrefix: 'Prefix',
  dataLength: 'Length',
  dataLengthValue: '{n} characters',
  dataHead: 'Head',
  secEmbeddedData: 'Embedded data',

  /* ---- hints ([?] popover) ---- */
  hintQ: '[?]',
  hintWhyMissing: 'Why is this value missing?',
  hintDontShow: 'Don’t show these hints again',

  /* ---- model strings (built in the pure helpers) ---- */
  weightCache: '0 B (served from cache)',
  weightNotMeasured: 'not measured',
  weightNoRecord: 'no request record found',
  durationUnknown: 'unknown',
  weightUnmeasuredReason:
    'cross-origin without Timing-Allow-Origin — the browser hides the size of other origins from the page',
  mseMimeVideo: 'video (MSE stream)',
  mseMimeAudio: 'audio (MSE stream)',
  blobMime: 'in-memory buffer (blob:)',
  openReasonNoUrl: 'this element has no resource URL',
  openReasonBlob:
    'blob: is a pointer to this tab’s memory — there is nothing at that address to open',
  openReasonData: 'the browser blocks top-level navigation to data: URIs',
  openReasonHttpOnly: 'only http and https URLs can be opened',
  mseOpenReason:
    'blob: points at buffers in this tab’s memory — there is no file at that address, on disk or on a server',
  cssNoBackground: 'no painted background — this element is structure, not a resource',
  failServerAnswered: 'The server answered {status}.',
  failImageGeneric:
    'The image did not load. The browser does not tell a page WHY a cross-origin resource failed (404 / CORS / CSP / mixed content all look the same from here). The DevTools panel — Console + Network — will name it.',
  mediaErrNoDetail: 'The browser reported no further detail.',
  couldNotReadEl: 'could not read this element',
  couldNotReadElName: 'could not read this element: {name}',
  attrPresent: '(present)',
} as const;

export type MsgKey = keyof typeof en;

const ru: Record<MsgKey, string> = {
  loading: 'Загрузка…',
  cancel: 'Отмена',
  reloadPage: 'Перезагрузить страницу',
  settings: 'Настройки',
  element: 'элемент',
  currentSrc: 'currentSrc',
  frames: 'Кадры',
  weightLabel: 'Вес',
  statusLabel: 'Статус',
  mimeLabel: 'MIME',
  naturalSizeLabel: 'Собственный размер',

  language: 'Язык',
  interfaceLanguage: 'Язык интерфейса',

  optTitle: 'Asset Inspector — Настройки',
  secAppearance: 'Внешний вид',
  fldTheme: 'Тема',
  fldSizeUnits: 'Единицы размера',
  unit1024: 'КБ/МБ (1024)',
  unit1000: 'кБ/МБ (1000)',
  secPicker: 'Указатель',
  fldShortcut: 'Горячая клавиша',
  changeInBrowser: 'Изменить в браузере ↗',
  tglBreadcrumbs: 'Показывать цепочку предков',
  tglAutoResource: 'Автоматически выбирать ближайший ресурс (R автоматически)',
  tglPreview: 'Предпросмотр на canvas',
  tglPreviewHint:
    'Предпросмотр рисуется из уже загруженного элемента. Мы никогда не запрашиваем показанный URL повторно.',
  secCard: 'Карточка',
  fldOverweight: 'Порог перевеса',
  optDontShow: 'не показывать',
  tglSrcsetExpanded: 'Разворачивать таблицу srcset по умолчанию',
  fldShowRequests: 'Показывать запросы',
  scopeRelated: 'связанные с элементом',
  scopeAll: 'все запросы страницы',
  secHints: 'Подсказки',
  tglHints: 'Подсказки «как получить недостающие данные»',
  btnShowHints: 'Снова показывать все подсказки',
  secData: 'Данные',
  fldBufferSize: 'Размер буфера запросов',
  dataWarning:
    '⚠️ Применяется при следующей загрузке страницы. Запросы, уже отброшенные браузером, восстановить нельзя.',
  optFooter:
    'Расширение ничего не хранит о посещаемых вами страницах и никуда не отправляет данные. Показываемые URL оно не запрашивает.',

  pupTitle: 'Asset Inspector',
  pupPick: 'Указать на элемент',
  pupPickAria: 'Укажите на элемент этой страницы и посмотрите, откуда он взялся',
  pupCantRun: 'На этой странице инспектор работать не может.',
  pupRightClickPre: 'Или щёлкните правой кнопкой по изображению / видео / аудио → ',
  whatIsThis: 'Что это за элемент?',
  pupRightClickPost: ' (там, где браузер предлагает контекстное меню).',
  pupOnPage: 'Что есть на этой странице',
  pupCounting: 'Подсчёт…',
  pupReqRecorded: 'Записано запросов',
  pupImages: 'Изображения',
  pupMediaElements: 'Медиаэлементы',
  pupBufOverflowTitle: 'Буфер запросов переполнился',
  pupBufNearTitle: 'Буфер запросов почти заполнен',
  pupBufBody:
    'Записано {recorded} из {limit}. После достижения предела браузер перестаёт записывать новые запросы — он отбрасывает новые, а не вытесняет старые, поэтому поздние запросы этой страницы теряются. Перезагрузите страницу, и инспектор поднимет предел; уже отброшенное не вернуть.',
  settingsArrow: 'Настройки →',

  pnlPick: 'Указать на элемент на странице',
  pnlPicking: 'Щёлкните по элементу на странице…',
  pnlFindReq: 'Найти захваченный запрос…',
  pnlWaitingPick: 'Ожидание выбора',
  pnlInspecting: 'Инспектируется',
  pnlReqCapturedOne: 'захвачен {count} запрос',
  pnlReqCapturedOther: 'захвачено запросов: {count}',
  pnlCapAfterTitle: 'Панель видит только запросы, сделанные ПОСЛЕ открытия DevTools',
  pnlCapAfterBody:
    'Перезагрузите страницу, чтобы захватить всё — инициатор и цепочка редиректов больше нигде не существуют.',
  pnlNavTitle: 'Страница перешла на другую',
  pnlNavBody:
    'Список захваченных запросов очищен — он описывал предыдущий документ. Выберите элемент снова, когда новая страница устоится.',
  pnlCantPickTitle: 'Здесь указатель запустить нельзя',
  pnlCantPickErr:
    'Эту страницу нельзя выполнить из панели (внутренняя страница браузера или её CSP блокирует eval).',
  pnlEmptyTitle: 'Выберите элемент',
  pnlEmptyHint:
    'Панель показывает то, что страница увидеть не может: какой скрипт запросил ресурс, по какой цепочке редиректов он прошёл, его точный MIME-тип и HTTP-статус.',
  pnlMatching: 'Захваченные запросы, содержащие «{filter}»',
  pnlPickerTip: 'Asset Inspector: щёлкните по элементу · Esc для отмены',
  mimeExact: 'ⓘ из ответа — точно',
  mimeNoRecord: 'ⓘ у DevTools нет записи об этом запросе',
  statusNoRecord: 'нет записи — перезагрузите страницу с открытым DevTools',
  weightWire: 'ⓘ байты по сети (_transferSize)',
  noResourceUrlParen: '(у этого элемента нет URL ресурса)',
  redirectChain: 'Цепочка редиректов',
  redirectStepOne: '{n} шаг',
  redirectStepOther: 'шагов: {n}',
  redirectNoRecordPanel:
    'По этому URL пока нет записи. DevTools захватывает только запросы, сделанные после его открытия — перезагрузите страницу.',
  redirectNonePanel: 'Без редиректа: браузер загрузил этот URL напрямую.',
  redirectFinalOnly:
    'ⓘ Промежуточных переходов вообще нет в Resource Timing — он сообщает только конечный URL. Эта цепочка существует только здесь.',
  whoRequested: 'Кто это запросил',
  noInitiatorPanel:
    'По этому URL инициатор не записан. Перезагрузите страницу с открытым DevTools — инициатор захватывается в момент запроса, а не позже.',
  initiatorHarNote:
    'ⓘ Это _initiator из HAR. Вне DevTools этих строк не существует — их не возвращает ни один API расширений, поэтому в карточке сказано «только тип».',

  pointAtElement: 'Наведите на элемент',
  pickerKeys:
    '↑ родитель · ↓ потомок · ← → соседи · [ ] стек · R ближайший ресурс · Enter выбрать · Esc отмена',
  inspectThisElement: 'Инспектировать этот элемент',
  cancelPickerAria: 'Отменить выбор элемента',
  pickerActive: 'Выбор элемента активен. Двигайте указатель или нажимайте клавиши-стрелки.',
  pickTagResource: ' · ресурс',
  pickTagStack: ' · {i} из {total} под курсором',
  pickAnnounce: '{label}, {w} × {h}, {resource}{stack}',
  pickHasResource: 'есть ресурс',
  pickNoResource: 'нет ресурса',
  pickStackSuffix: ', {i} из {total} под курсором',

  cardTitle: 'Asset Inspector',
  cardAria: 'Asset Inspector — карточка ресурса',
  collapseCard: 'Свернуть карточку',
  closeInspector: 'Закрыть инспектор',
  staleTitle: '⚠️ Элемент удалён со страницы.',
  staleBody: 'Всё ниже — снимок, сделанный в момент выбора.',
  couldNotRead: 'Этот элемент прочитать не удалось.',
  inspectAnother: 'Инспектировать другой элемент',
  copyAsJson: 'Скопировать как JSON',
  copy: 'Копировать',
  copied: 'Скопировано ✓',
  copyFailed: 'Не удалось скопировать',
  openNewTab: 'Открыть в новой вкладке ↗',
  previewAria: 'Предпросмотр, нарисованный из элемента, уже находящегося на странице',
  previewNoFrame: 'нет кадра',
  previewProtected: 'кадр недоступен: защищённый контент',

  kindImage: 'Изображение',
  kindVideo: 'Видео',
  kindAudio: 'Аудио',
  kindFrame: 'Фрейм',
  kindCssBg: 'Фоновое изображение CSS',
  kindNone: 'Нет ресурса',
  mimeByExt: '{mime} (по расширению файла)',
  declaredSuffix: '{type} — заявлено разметкой, не проверено',
  didNotLoad: 'не загрузилось',

  secUrl: 'URL',
  noUrl: '(нет URL)',
  urlActual:
    'Это то, что браузер ФАКТИЧЕСКИ загрузил (currentSrc), а не то, что просила разметка.',
  markupAsked: 'Разметка просила: {src}',

  resNotLoad: 'Этот ресурс НЕ загрузился.',
  resNotLoadCode: 'Этот ресурс НЕ загрузился ({code}).',
  blobTitle: 'blob: — это не файл.',
  blobBody:
    'Это указатель на данные в памяти этой вкладки. По этому адресу ничего не существует — ни на сервере, ни на диске.',
  bufIncompleteTitle: 'Список запросов может быть неполным.',
  bufFull:
    'Буфер запросов ЗАПОЛНЕН ({recorded} из {limit}). Браузер перестал записывать — он отбрасывает НОВЫЕ запросы, а не вытесняет старые, поэтому поздние на этой странице просто отсутствуют. Перезагрузка поднимет предел для следующей загрузки, но не вернёт уже отброшенное.',
  bufNear:
    'Записано {recorded} из {limit} запросов. После достижения предела браузер перестаёт записывать новые.',

  secOverweight: 'Перевес',
  overweightHeader: '⚠️ ПЕРЕВЕС {ratio}×',
  barNatural: 'собственный',
  barNeeded: 'нужно (DPR {dpr})',
  barDisplayed: 'отображается',
  overweightWasted:
    '{percent} пикселей тратится впустую при текущем размере окна. {why}',
  whyNoSizes:
    'Нет атрибута `sizes`, поэтому браузер решил, что изображение занимает всю ширину окна (100vw), и выбрал самый крупный вариант. Это самая частая причина.',
  whyGeneric:
    'Обычно одно из двух: в srcset нет варианта подходящего размера, или `sizes` сообщил браузеру неверную ширину слота.',

  srcsetDisagreeTitle: '⚠️ Браузер загрузил не то, что предсказывает правило.',
  srcsetDisagreeBody:
    'Строка ✔ — это ФАКТ (currentSrc). Наш пересчёт ниже приведён как объяснение — вариант, уже находящийся в кэше, режим экономии данных или округление могут переопределить правило.',
  viewportDpr: 'Окно {vw} css-px · DPR {dpr}',
  sizesNotSet: 'sizes: не задан → браузер считает слот равным 100vw',
  sizesSet: 'sizes: {sizes} → слот {slot}',
  slotNotComputable: 'невозможно вычислить',
  slotCssPx: '{n} css-px',
  srcsetDivides:
    'Браузер делит каждый w-дескриптор на ширину слота и берёт НАИМЕНЬШИЙ вариант, чья плотность достигает DPR ({dpr}).',
  srcsetModelHint:
    'Только ✔ ВЫБРАН — факт, он берётся из currentSrc. Плотности и колонка «почему» — наша реконструкция спецификации, и браузер вправе от неё отличаться.',
  srcsetSummaryOne: 'Что браузер выбрал из srcset — {n} вариант',
  srcsetSummaryOther: 'Что браузер выбрал из srcset — вариантов: {n}',
  srcsetStage1Caption: 'Этап 1 — какой <source> из <picture> победил',
  colType: 'тип',
  colMedia: 'media',
  colVerdict: 'Вердикт',
  srcWon: '✔ ПОБЕДИЛ',
  srcMediaNoMatch: '✘ media не совпало',
  srcNotReached: '✘ не достигнут / формат не взят',
  srcsetStage2Caption: 'Этап 2 — варианты и почему каждый победил или проиграл (DPR {dpr})',
  colCandidate: 'Вариант',
  colDescriptor: 'Дескриптор',
  colDensity: 'Плотность',
  candChosen: '✔ ВЫБРАН',
  candModelWould: '● наша модель выбрала бы этот',
  candReason: '✘ {reason}',
  reasonSlotUnknown: 'ширина слота неизвестна — плотность не вычислить',
  reasonFirstAboveDpr: 'первая плотность ≥ DPR {dpr}',
  reasonBelowDpr: '× {density} < DPR {dpr}',
  reasonLargerThanNeeded: '× {density} — больше, чем нужно',

  secProperties: 'Свойства',
  propType: 'Тип',
  mimeGuessedHint:
    '  ⓘ угадано по расширению файла — точный MIME есть только в панели DevTools',
  propDeclaredFormat: 'Заявленный формат',
  declaredClaimedHint: '{type} ⓘ заявлено разметкой, не проверено',
  propDisplayed: 'Отображается',
  displayedValue: '{disp} css-px · DPR {dpr} → {dev} device px',
  propDuration: 'Длительность',
  framesValue: '{rendered} отрисовано · {dropped} пропущено ⓘ getVideoPlaybackQuality()',
  weightReasonHint: '  ⓘ {reason}',
  taoHint:
    'Сервер не прислал заголовок `Timing-Allow-Origin`, поэтому браузер скрывает от страницы размер и тайминги этого чужого источника. Точный размер виден в панели DevTools (HAR `_transferSize`).',
  propHttpStatus: 'HTTP-статус',
  statusNotMeasured: 'не измерено ⓘ межисточниковый без Timing-Allow-Origin',
  propAttributes: 'Атрибуты',
  propAlt: 'alt',
  altEmpty: '(пусто — декоративное)',
  altValue: '«{alt}»',
  propSelector: 'Селектор',

  secRequests: 'Запросы, которые его загрузили',
  secRequestsHeuristic: 'Запросы, которые его загрузили — эвристика',
  noReqRecord:
    'По этому URL запись запроса не найдена. Это может значить: страница вызвала performance.clearResourceTimings() (SPA-фреймворки так делают); буфер заполнился и браузер перестал записывать; или ресурс пришёл из кэша до того, как буфер был увеличен.',
  reqCountOne: '{count} запрос',
  reqCountOther: 'запросов: {count}',
  reqCrossOrigin: 'межисточниковый',
  reqSameOrigin: 'тот же источник',
  reqRow: '{kind} · {count} · {origin}',
  initiatorTypeLine:
    'тип инициатора: {type} — какой скрипт и на какой строке, вне DevTools недоступно',
  initiatorHint:
    'Страница видит только ТИП инициатора (img / css / script / fetch). Сам скрипт и строка живут в HAR `_initiator`, который не отдаёт ни один API расширений. Откройте DevTools → панель «Assets» → перезагрузите страницу.',
  requestsHeuristicNote:
    '⚠️ Сопоставлено по типу запроса и хосту, а не по факту. Если на странице два плеера, их не различить. Точная привязка есть только в панели DevTools.',

  secRedirects: 'Редиректы',
  redirectOccurred:
    'Редирект БЫЛ (об этом говорят тайминги). Промежуточных URL вообще нет в Resource Timing — они есть только в панели DevTools.',
  redirectNone: 'Без редиректа.',
  redirectUnknown:
    'Неизвестно — это межисточниковый ресурс без Timing-Allow-Origin, поэтому браузер даже не сообщает странице, был ли редирект. Цепочка видна в панели DevTools.',
  redirectHint:
    'Resource Timing всегда сообщает только КОНЕЧНЫЙ URL. HAR в DevTools хранит записи 30x и `redirectURL` каждого перехода — поэтому цепочка есть только в панели.',

  mseNoUrlTitle: 'У этого видео НЕТ прямого URL.',
  mseNoUrlBody:
    'Плеер собирает его в памяти из тысяч мелких сегментов (Media Source Extensions). Указать на один файл нельзя — так работает адаптивная потоковая передача, и это свойство платформы, а не ограничение инспектора.',
  mseNone: '(нет)',
  mseMechanism: 'Механизм',
  mseMechanismValue: 'Media Source Extensions (MSE)',
  mseResolution: 'Разрешение',
  mseResolutionValue: '{dim} — текущее качество; плеер меняет его на лету',
  mseFramesValue: '{rendered} отрисовано · {dropped} пропущено',
  secSource: 'Источник',
  secProtection: 'Защита контента',
  drmActive: 'Обнаружен DRM: EME активен (video.mediaKeys установлен).',
  drmNone: 'EME на этом элементе не обнаружен.',
  drmExplain:
    'Расшифровка происходит внутри собственного модуля расшифровки браузера — бинарного компонента. Ни расширение, ни другой JavaScript никогда не видят расшифрованные кадры. Мы не печатаем название системы защиты: чтобы его узнать, нужно запускать скрипт на каждом сайте до старта плеера, а такого разрешения мы не просим.',
  secWhyWorks: 'Почему это так работает',
  mseWhyExplain:
    'Потоковая передача — это тысячи мелких сегментов вместо одного файла, чтобы качество подстраивалось под сеть в реальном времени. Манифест может появиться в списке запросов ниже как факт о странице — этот инспектор его никогда не открывает и не разбирает.',

  iframeNoLookTitle: 'Мы не заглядываем внутрь этого фрейма.',
  iframeNoLookBody:
    'Он загружен с {host}, тогда как страница — {page}. Браузер изолирует источники друг от друга: ни расширение, ни собственные скрипты страницы не видят внутрь. Это защита, а не поломка.',
  iframeAnotherOrigin: 'другого источника',
  iframeSameTitle: 'Фрейм того же источника.',
  iframeSameBody:
    'Этот фрейм разделяет источник страницы. Запустите указатель внутри него, чтобы инспектировать его элементы.',
  secWhatYouCanDo: 'Что можно сделать',
  iframeWhatDo:
    'Откройте URL фрейма в новой вкладке (кнопка выше). Там он становится обычной страницей, и инспектор работает точно так же, как везде.',

  noLoadedResTitle: 'У этого элемента НЕТ загруженного ресурса.',
  noLoadedResBody: 'Он нарисован CSS: {rule} — код в таблице стилей, а не файл.',
  aStyleRule: 'правило стиля',
  nestedResHint:
    'Ресурс ЕСТЬ на вложенном элементе: {label}. Нажмите R в указателе, чтобы перейти к ближайшему.',
  closedShadowTitle: 'Этот элемент отображает контент, до которого мы не можем добраться.',
  closedShadowBody:
    'Это пользовательский элемент без содержимого в light DOM, а значит его контент живёт в ЗАКРЫТОМ shadow root. Браузер скрывает такие от любого скрипта — включая это расширение. Это решение сайта, а не ограничение инспектора.',
  dataEmbeddedTitle: 'Байты встроены в страницу.',
  dataEmbeddedBody:
    'URI data: несёт собственное содержимое — сетевой запрос за ним никогда не делался, поэтому в списке запросов его нет и не будет.',
  dataPrefix: 'Префикс',
  dataLength: 'Длина',
  dataLengthValue: '{n} символов',
  dataHead: 'Начало',
  secEmbeddedData: 'Встроенные данные',

  hintQ: '[?]',
  hintWhyMissing: 'Почему это значение отсутствует?',
  hintDontShow: 'Больше не показывать эти подсказки',

  weightCache: '0 Б (из кэша)',
  weightNotMeasured: 'не измерено',
  weightNoRecord: 'запись запроса не найдена',
  durationUnknown: 'неизвестно',
  weightUnmeasuredReason:
    'межисточниковый без Timing-Allow-Origin — браузер скрывает от страницы размер чужих источников',
  mseMimeVideo: 'видео (поток MSE)',
  mseMimeAudio: 'аудио (поток MSE)',
  blobMime: 'буфер в памяти (blob:)',
  openReasonNoUrl: 'у этого элемента нет URL ресурса',
  openReasonBlob:
    'blob: — указатель на память этой вкладки; по этому адресу нечего открывать',
  openReasonData: 'браузер блокирует переход на верхнем уровне к URI data:',
  openReasonHttpOnly: 'открывать можно только URL http и https',
  mseOpenReason:
    'blob: указывает на буферы в памяти этой вкладки — по этому адресу нет файла ни на диске, ни на сервере',
  cssNoBackground: 'нет нарисованного фона — этот элемент это структура, а не ресурс',
  failServerAnswered: 'Сервер ответил {status}.',
  failImageGeneric:
    'Изображение не загрузилось. Браузер не сообщает странице, ПОЧЕМУ межисточниковый ресурс не удался (404 / CORS / CSP / смешанный контент отсюда выглядят одинаково). Панель DevTools — Консоль и Сеть — назовёт причину.',
  mediaErrNoDetail: 'Браузер не сообщил дальнейших подробностей.',
  couldNotReadEl: 'не удалось прочитать этот элемент',
  couldNotReadElName: 'не удалось прочитать этот элемент: {name}',
  attrPresent: '(есть)',
};

const et: Record<MsgKey, string> = {
  loading: 'Laadimine…',
  cancel: 'Tühista',
  reloadPage: 'Laadi leht uuesti',
  settings: 'Seaded',
  element: 'element',
  currentSrc: 'currentSrc',
  frames: 'Kaadrid',
  weightLabel: 'Kaal',
  statusLabel: 'Olek',
  mimeLabel: 'MIME',
  naturalSizeLabel: 'Loomulik suurus',

  language: 'Keel',
  interfaceLanguage: 'Liidese keel',

  optTitle: 'Asset Inspector — Seaded',
  secAppearance: 'Välimus',
  fldTheme: 'Teema',
  fldSizeUnits: 'Suuruse ühikud',
  unit1024: 'KB/MB (1024)',
  unit1000: 'kB/MB (1000)',
  secPicker: 'Valija',
  fldShortcut: 'Kiirklahv',
  changeInBrowser: 'Muuda brauseris ↗',
  tglBreadcrumbs: 'Näita eellaste rada',
  tglAutoResource: 'Vali automaatselt lähim ressurss (R automaatselt)',
  tglPreview: 'Lõuendi eelvaade',
  tglPreviewHint:
    'Eelvaade joonistatakse juba laaditud elemendist. Me ei päri kuvatavat URL-i kunagi uuesti.',
  secCard: 'Kaart',
  fldOverweight: 'Ülekaalu lävi',
  optDontShow: 'ära näita',
  tglSrcsetExpanded: 'Ava srcset-tabel vaikimisi',
  fldShowRequests: 'Näita päringuid',
  scopeRelated: 'elemendiga seotud',
  scopeAll: 'kõik lehe päringud',
  secHints: 'Vihjed',
  tglHints: 'Vihjed „kuidas saada puuduvad andmed“',
  btnShowHints: 'Näita kõiki vihjeid uuesti',
  secData: 'Andmed',
  fldBufferSize: 'Päringupuhvri suurus',
  dataWarning:
    '⚠️ Rakendub järgmisel lehe laadimisel. Päringuid, mille brauser on juba ära visanud, ei saa taastada.',
  optFooter:
    'Laiendus ei salvesta külastatavate lehtede kohta midagi ega saada andmeid kuhugi. URL-e, mida see näitab, ta ei päri.',

  pupTitle: 'Asset Inspector',
  pupPick: 'Osuta elemendile',
  pupPickAria: 'Osuta selle lehe elemendile ja vaata, kust see pärineb',
  pupCantRun: 'Sellel lehel inspektor töötada ei saa.',
  pupRightClickPre: 'Või tee paremklõps pildil / videol / helil → ',
  whatIsThis: 'Mis element see on?',
  pupRightClickPost: ' (seal, kus brauser pakub kontekstimenüüd).',
  pupOnPage: 'Mis sellel lehel on',
  pupCounting: 'Loendamine…',
  pupReqRecorded: 'Salvestatud päringuid',
  pupImages: 'Pildid',
  pupMediaElements: 'Meediaelemendid',
  pupBufOverflowTitle: 'Päringupuhver täitus üle',
  pupBufNearTitle: 'Päringupuhver on peaaegu täis',
  pupBufBody:
    'Salvestatud {recorded} / {limit}. Pärast piiri lõpetab brauser uute päringute salvestamise — ta viskab ära uued, mitte ei tõrju välja vanu, seega selle lehe hilisemad päringud kaovad. Laadi leht uuesti ja inspektor tõstab piiri; juba äravisatut tagasi ei saa.',
  settingsArrow: 'Seaded →',

  pnlPick: 'Osuta lehel elemendile',
  pnlPicking: 'Klõpsa lehel elemendil…',
  pnlFindReq: 'Otsi salvestatud päringut…',
  pnlWaitingPick: 'Ootan valikut',
  pnlInspecting: 'Uuritakse',
  pnlReqCapturedOne: 'salvestatud {count} päring',
  pnlReqCapturedOther: 'salvestatud {count} päringut',
  pnlCapAfterTitle: 'Paneel näeb ainult päringuid, mis tehti PÄRAST DevToolsi avamist',
  pnlCapAfterBody:
    'Laadi leht uuesti, et kõik jäädvustada — algataja ja ümbersuunamiste ahel ei eksisteeri mujal.',
  pnlNavTitle: 'Leht navigeeris edasi',
  pnlNavBody:
    'Salvestatud päringute loend tühjendati — see kirjeldas eelmist dokumenti. Vali element uuesti, kui uus leht on rahunenud.',
  pnlCantPickTitle: 'Siin ei saa valijat käivitada',
  pnlCantPickErr:
    'Seda lehte ei saa paneelist skriptida (brauseri sisemine leht või selle CSP blokeerib evali).',
  pnlEmptyTitle: 'Vali element',
  pnlEmptyHint:
    'Paneel näitab seda, mida leht ressursi kohta kunagi näha ei saa: milline skript selle päris, millist ümbersuunamiste ahelat see läbis, selle täpset MIME-tüüpi ja HTTP-olekut.',
  pnlMatching: 'Salvestatud päringud, mis sisaldavad „{filter}“',
  pnlPickerTip: 'Asset Inspector: klõpsa elemendil · Esc katkestamiseks',
  mimeExact: 'ⓘ vastusest — täpne',
  mimeNoRecord: 'ⓘ DevToolsil pole selle päringu kohta kirjet',
  statusNoRecord: 'kirje puudub — laadi leht uuesti avatud DevToolsiga',
  weightWire: 'ⓘ baite juhtme peal (_transferSize)',
  noResourceUrlParen: '(sellel elemendil pole ressursi URL-i)',
  redirectChain: 'Ümbersuunamiste ahel',
  redirectStepOne: '{n} samm',
  redirectStepOther: '{n} sammu',
  redirectNoRecordPanel:
    'Selle URL-i kohta pole veel kirjet. DevTools jäädvustab ainult päringuid, mis tehti pärast selle avamist — laadi leht uuesti.',
  redirectNonePanel: 'Ümbersuunamiseta: brauser laadis selle URL-i otse.',
  redirectFinalOnly:
    'ⓘ Vahepealseid hüppeid pole Resource Timingus üldse — see teatab ainult lõpliku URL-i. See ahel eksisteerib ainult siin.',
  whoRequested: 'Kes selle päris',
  noInitiatorPanel:
    'Selle URL-i kohta pole algatajat salvestatud. Laadi leht uuesti avatud DevToolsiga — algataja jäädvustatakse päringu hetkel, mitte hiljem.',
  initiatorHarNote:
    'ⓘ See on _initiator HAR-ist. Väljaspool DevToolsi neid ridu ei eksisteeri — ükski laienduse API neid ei tagasta, seepärast ütleb kaart „ainult tüüp“.',

  pointAtElement: 'Osuta elemendile',
  pickerKeys:
    '↑ vanem · ↓ laps · ← → naabrid · [ ] pinu · R lähim ressurss · Enter vali · Esc tühista',
  inspectThisElement: 'Uuri seda elementi',
  cancelPickerAria: 'Tühista elemendivalija',
  pickerActive: 'Elemendivalija on aktiivne. Liiguta osutit või vajuta nooleklahve.',
  pickTagResource: ' · ressurss',
  pickTagStack: ' · {i} / {total} kursori all',
  pickAnnounce: '{label}, {w} × {h}, {resource}{stack}',
  pickHasResource: 'ressurss olemas',
  pickNoResource: 'ressurssi pole',
  pickStackSuffix: ', {i} / {total} kursori all',

  cardTitle: 'Asset Inspector',
  cardAria: 'Asset Inspector — ressursikaart',
  collapseCard: 'Ahenda kaart',
  closeInspector: 'Sulge inspektor',
  staleTitle: '⚠️ Element eemaldati lehelt.',
  staleBody: 'Kõik allpool on hetktõmmis, mis tehti valimise ajal.',
  couldNotRead: 'Seda elementi ei õnnestunud lugeda.',
  inspectAnother: 'Uuri teist elementi',
  copyAsJson: 'Kopeeri JSON-ina',
  copy: 'Kopeeri',
  copied: 'Kopeeritud ✓',
  copyFailed: 'Kopeerimine ebaõnnestus',
  openNewTab: 'Ava uuel kaardil ↗',
  previewAria: 'Eelvaade, mis on joonistatud juba lehel olevast elemendist',
  previewNoFrame: 'kaadrit pole',
  previewProtected: 'kaader pole saadaval: kaitstud sisu',

  kindImage: 'Pilt',
  kindVideo: 'Video',
  kindAudio: 'Heli',
  kindFrame: 'Raam',
  kindCssBg: 'CSS-i taustapilt',
  kindNone: 'Ressurssi pole',
  mimeByExt: '{mime} (faililaiendi järgi)',
  declaredSuffix: '{type} — märgistuse väidetud, kontrollimata',
  didNotLoad: 'ei laadinud',

  secUrl: 'URL',
  noUrl: '(URL puudub)',
  urlActual:
    'See on see, mida brauser TEGELIKULT laadis (currentSrc) — mitte see, mida märgistus küsis.',
  markupAsked: 'Märgistus küsis: {src}',

  resNotLoad: 'See ressurss EI laadinud.',
  resNotLoadCode: 'See ressurss EI laadinud ({code}).',
  blobTitle: 'blob: ei ole fail.',
  blobBody:
    'See on viit andmetele selle kaardi mälus. Sellel aadressil ei eksisteeri midagi — ei serveris ega kettal.',
  bufIncompleteTitle: 'Päringute loend võib olla puudulik.',
  bufFull:
    'Päringupuhver on TÄIS ({recorded} / {limit}). Brauser on salvestamise lõpetanud — ta viskab ära UUED päringud, mitte ei tõrju välja vanu, seega selle lehe hilisemad on lihtsalt puudu. Uuesti laadimine tõstab piiri järgmiseks korraks; juba äravisatut see tagasi ei too.',
  bufNear:
    'Salvestatud {recorded} / {limit} päringut. Pärast piiri lõpetab brauser uute salvestamise.',

  secOverweight: 'Ülekaal',
  overweightHeader: '⚠️ ÜLEKAAL {ratio}×',
  barNatural: 'loomulik',
  barNeeded: 'vajalik (DPR {dpr})',
  barDisplayed: 'kuvatud',
  overweightWasted:
    '{percent} pikslitest läheb praeguse akna suuruse juures raisku. {why}',
  whyNoSizes:
    'Atribuuti `sizes` pole, seega eeldas brauser, et pilt täidab vaateava (100vw), ja valis suurima kandidaadi. See on kõige sagedasem põhjus.',
  whyGeneric:
    'Tavaliselt üks kahest: srcsetil pole sobiva suurusega kandidaati või `sizes` ütles brauserile vale pesa laiuse.',

  srcsetDisagreeTitle: '⚠️ Brauser laadis midagi muud, kui reegel ennustab.',
  srcsetDisagreeBody:
    'Rida ✔ on FAKT (currentSrc). Meie ümberarvutus on selle all seletusena — kandidaat, mis on juba vahemälus, andmesäästurežiim või ümardamine võivad kõik reegli üle kaaluda.',
  viewportDpr: 'Vaateava {vw} css-px · DPR {dpr}',
  sizesNotSet: 'sizes: määramata → brauser käsitleb pesa 100vw-na',
  sizesSet: 'sizes: {sizes} → pesa {slot}',
  slotNotComputable: 'pole arvutatav',
  slotCssPx: '{n} css-px',
  srcsetDivides:
    'Brauser jagab iga w-deskriptori pesa laiusega ja võtab VÄIKSEIMA kandidaadi, mille tihedus ulatub DPR-ini ({dpr}).',
  srcsetModelHint:
    'Ainult ✔ VALITUD on fakt — see tuleb currentSrc-ist. Tihedused ja veerg „miks“ on meie rekonstruktsioon spetsifikatsioonist, ja brauseril on lubatud sellest erineda.',
  srcsetSummaryOne: 'Mida brauser srcsetist valis — {n} kandidaat',
  srcsetSummaryOther: 'Mida brauser srcsetist valis — {n} kandidaati',
  srcsetStage1Caption: 'Etapp 1 — milline <picture> <source> võitis',
  colType: 'tüüp',
  colMedia: 'media',
  colVerdict: 'Otsus',
  srcWon: '✔ VÕITIS',
  srcMediaNoMatch: '✘ media ei sobinud',
  srcNotReached: '✘ ei jõutud / vormingut ei võetud',
  srcsetStage2Caption: 'Etapp 2 — kandidaadid ja miks igaüks võitis või kaotas (DPR {dpr})',
  colCandidate: 'Kandidaat',
  colDescriptor: 'Deskriptor',
  colDensity: 'Tihedus',
  candChosen: '✔ VALITUD',
  candModelWould: '● meie mudel valiks selle',
  candReason: '✘ {reason}',
  reasonSlotUnknown: 'pesa laius teadmata — tihedust ei saa arvutada',
  reasonFirstAboveDpr: 'esimene tihedus ≥ DPR {dpr}',
  reasonBelowDpr: '× {density} < DPR {dpr}',
  reasonLargerThanNeeded: '× {density} — suurem kui vaja',

  secProperties: 'Omadused',
  propType: 'Tüüp',
  mimeGuessedHint:
    '  ⓘ arvatud faililaiendi järgi — täpne MIME on ainult DevToolsi paneelis',
  propDeclaredFormat: 'Väidetud vorming',
  declaredClaimedHint: '{type} ⓘ märgistuse väidetud, kontrollimata',
  propDisplayed: 'Kuvatud',
  displayedValue: '{disp} css-px · DPR {dpr} → {dev} device px',
  propDuration: 'Kestus',
  framesValue: '{rendered} renderdatud · {dropped} kaotatud ⓘ getVideoPlaybackQuality()',
  weightReasonHint: '  ⓘ {reason}',
  taoHint:
    'Server ei saatnud päist `Timing-Allow-Origin`, seega peidab brauser lehe eest selle teise päritolu suuruse ja ajastused. Täpne suurus on nähtav DevToolsi paneelis (HAR `_transferSize`).',
  propHttpStatus: 'HTTP-olek',
  statusNotMeasured: 'mõõtmata ⓘ eri päritolu ilma Timing-Allow-Originita',
  propAttributes: 'Atribuudid',
  propAlt: 'alt',
  altEmpty: '(tühi — dekoratiivne)',
  altValue: '«{alt}»',
  propSelector: 'Selektor',

  secRequests: 'Päringud, mis selle laadisid',
  secRequestsHeuristic: 'Päringud, mis selle laadisid — heuristika',
  noReqRecord:
    'Selle URL-i kohta päringukirjet ei leitud. See võib tähendada: leht kutsus performance.clearResourceTimings() (SPA-raamistikud teevad seda); puhver täitus ja brauser lõpetas salvestamise; või see tuli vahemälust enne, kui puhvrit suurendati.',
  reqCountOne: '{count} päring',
  reqCountOther: '{count} päringut',
  reqCrossOrigin: 'eri päritolu',
  reqSameOrigin: 'sama päritolu',
  reqRow: '{kind} · {count} · {origin}',
  initiatorTypeLine:
    'algataja tüüp: {type} — milline skript, millisel real, pole väljaspool DevToolsi saadaval',
  initiatorHint:
    'Leht näeb ainult algataja TÜÜPI (img / css / script / fetch). Tegelik skript ja rida elavad HAR-i `_initiator`-is, mida ükski laienduse API ei paljasta. Ava DevTools → paneel „Assets“ → laadi leht uuesti.',
  requestsHeuristicNote:
    '⚠️ Sobitatud päringu tüübi ja hosti järgi, mitte fakti järgi. Kui lehel on kaks mängijat, ei saa neid eristada. Täpne omistamine on ainult DevToolsi paneelis.',

  secRedirects: 'Ümbersuunamised',
  redirectOccurred:
    'Ümbersuunamine OLI (ajastused ütlevad nii). Vahepealseid URL-e pole Resource Timingus üldse — need on ainult DevToolsi paneelis.',
  redirectNone: 'Ümbersuunamiseta.',
  redirectUnknown:
    'Teadmata — see on eri päritolu ressurss ilma Timing-Allow-Originita, seega brauser ei ütle lehele isegi seda, kas ümbersuunamine toimus. Ahel on nähtav DevToolsi paneelis.',
  redirectHint:
    'Resource Timing teatab alati ainult LÕPLIKU URL-i. DevToolsi HAR hoiab 30x-kirjeid ja iga hüppe `redirectURL`-i — seepärast on ahel paneeli funktsioon.',

  mseNoUrlTitle: 'Sellel videol POLE otsest URL-i.',
  mseNoUrlBody:
    'Mängija paneb selle mälus kokku tuhandetest väikestest segmentidest (Media Source Extensions). Ühele failile pole võimalik osutada — nii toimib adaptiivne voogedastus, ja see on platvormi omadus, mitte selle inspektori piirang.',
  mseNone: '(puudub)',
  mseMechanism: 'Mehhanism',
  mseMechanismValue: 'Media Source Extensions (MSE)',
  mseResolution: 'Eraldusvõime',
  mseResolutionValue: '{dim} — praegune kvaliteet; mängija muudab seda lennult',
  mseFramesValue: '{rendered} renderdatud · {dropped} kaotatud',
  secSource: 'Allikas',
  secProtection: 'Sisukaitse',
  drmActive: 'DRM tuvastatud: EME on aktiivne (video.mediaKeys on määratud).',
  drmNone: 'Sellel elemendil EME-d ei tuvastatud.',
  drmExplain:
    'Dekrüpteerimine toimub brauseri enda sisu dekrüpteerimise moodulis — binaarkomponendis. Ükski laiendus ega muu JavaScript ei näe kunagi dekrüpteeritud kaadreid. Me ei prindi kaitsesüsteemi nime: selle teadasaamiseks tuleks käivitada skript igal saidil enne mängija käivitumist, ja sellist luba me ei küsi.',
  secWhyWorks: 'Miks see nii toimib',
  mseWhyExplain:
    'Voogedastus tähendab tuhandeid väikeseid segmente ühe faili asemel, et kvaliteet saaks reaalajas võrguga kohaneda. Manifest võib allpool päringute loendis ilmuda faktina lehe kohta — see inspektor ei ava seda kunagi ega parsi.',

  iframeNoLookTitle: 'Me ei vaata selle raami sisse.',
  iframeNoLookBody:
    'See on laaditud allikast {host}, samal ajal kui leht on {page}. Brauser isoleerib päritolud üksteisest: ei laiendus ega lehe enda skriptid näe sisse. See on kaitse, mitte rike.',
  iframeAnotherOrigin: 'teine päritolu',
  iframeSameTitle: 'Sama päritolu raam.',
  iframeSameBody:
    'See raam jagab lehe päritolu. Käivita valija selle sees, et uurida selle elemente.',
  secWhatYouCanDo: 'Mida saad teha',
  iframeWhatDo:
    'Ava raami URL uuel kaardil (nupp ülal). Seal muutub see tavaliseks leheks ja inspektor töötab täpselt nagu igal pool mujal.',

  noLoadedResTitle: 'Sellel elemendil POLE laaditud ressurssi.',
  noLoadedResBody: 'Selle joonistab CSS: {rule} — kood stiililehes, mitte fail.',
  aStyleRule: 'stiilireegel',
  nestedResHint:
    'Sisseehitatud elemendil ON ressurss: {label}. Vajuta valijas R, et hüpata lähimale.',
  closedShadowTitle: 'See element renderdab sisu, milleni me ei ulatu.',
  closedShadowBody:
    'See on kohandatud element, mille light DOM-is pole midagi, mis tähendab, et selle sisu elab SULETUD shadow root-is. Brauser peidab need iga skripti eest — kaasa arvatud see laiendus. See on saidi otsus, mitte inspektori piirang.',
  dataEmbeddedTitle: 'Baidid on lehe sisse põimitud.',
  dataEmbeddedBody:
    'data: URI kannab oma sisu — selle järele ei tehtud kunagi võrgupäringut, seega seda päringute loendis pole ega tulegi.',
  dataPrefix: 'Prefiks',
  dataLength: 'Pikkus',
  dataLengthValue: '{n} märki',
  dataHead: 'Algus',
  secEmbeddedData: 'Põimitud andmed',

  hintQ: '[?]',
  hintWhyMissing: 'Miks see väärtus puudub?',
  hintDontShow: 'Ära näita neid vihjeid enam',

  weightCache: '0 B (vahemälust)',
  weightNotMeasured: 'mõõtmata',
  weightNoRecord: 'päringukirjet ei leitud',
  durationUnknown: 'teadmata',
  weightUnmeasuredReason:
    'eri päritolu ilma Timing-Allow-Originita — brauser peidab lehe eest teiste päritolude suuruse',
  mseMimeVideo: 'video (MSE-voog)',
  mseMimeAudio: 'heli (MSE-voog)',
  blobMime: 'mälupuhver (blob:)',
  openReasonNoUrl: 'sellel elemendil pole ressursi URL-i',
  openReasonBlob:
    'blob: on viit selle kaardi mälule — sellel aadressil pole midagi avada',
  openReasonData: 'brauser blokeerib ülataseme navigeerimise data: URI-dele',
  openReasonHttpOnly: 'avada saab ainult http- ja https-URL-e',
  mseOpenReason:
    'blob: osutab selle kaardi mälus olevatele puhvritele — sellel aadressil pole faili ei kettal ega serveris',
  cssNoBackground: 'joonistatud tausta pole — see element on struktuur, mitte ressurss',
  failServerAnswered: 'Server vastas {status}.',
  failImageGeneric:
    'Pilt ei laadinud. Brauser ei ütle lehele, MIKS eri päritolu ressurss ebaõnnestus (404 / CORS / CSP / segasisu näevad siit välja ühesugused). DevToolsi paneel — Konsool ja Võrk — nimetab selle.',
  mediaErrNoDetail: 'Brauser ei teatanud rohkem üksikasju.',
  couldNotReadEl: 'seda elementi ei õnnestunud lugeda',
  couldNotReadElName: 'seda elementi ei õnnestunud lugeda: {name}',
  attrPresent: '(olemas)',
};

const messages: Catalog<MsgKey> = { en, ru, et };

const translate = createTranslator<MsgKey>(messages);

/** Hook: a locale-bound `t()` for React surfaces (popup / options / panel). */
export function useT(): TFn {
  const locale = useLocale();
  return useCallback(
    (key: MsgKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
}

/** Imperative translator for the non-React content-script card and the background
 *  context menu, which resolve the locale from storage rather than from context. */
export function tAt(locale: Locale, key: MsgKey, vars?: Record<string, string | number>): string {
  return translate(locale, key, vars);
}
