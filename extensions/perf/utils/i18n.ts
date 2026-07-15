import { createTranslator, useLocale, type Catalog, type Locale } from '@blur/ui';
import { useCallback } from 'react';

// Runtime UI catalog for "Page Performance & Network". English is the source of
// truth AND the default (see @blur/ui's DEFAULT_LOCALE); `ru` and `et` are complete
// mirrors, and the `Catalog<MsgKey>` typing below fails the build if either is
// missing a key — nothing can ship half-translated.
//
// 🔴 Deliberately NOT translated (facts about the page / house rules):
//   - Metric acronyms (LCP/CLS/INP/FCP/TTFB), resource-kind tokens (document,
//     script, stylesheet, image, font, xhr, media, other), API/proper-noun tokens
//     ("Long Animation Frames", "Long Tasks", "Resource Timing", "PageSpeed
//     Insights", "CrUX", "Chrome UX Report", "HAR", "CDP"), code fragments shown in
//     <code> (Timing-Allow-Origin, storage.local, www.googleapis.com, aspect-ratio,
//     elementtiming, LargestContentfulPaint.entry.element, ?, #, 0), the PSI
//     strategy token (mobile/desktop), URLs, numbers and units (ms, s, B/KB/MB).
//   - Console text, storage keys, CSS class names, comments.
// Everything a human READS goes through here, so switching the locale re-renders
// every surface (popup + DevTools panel).

/** A locale-bound translator, the shape returned by `useT()` (React) and `tAt()`
 *  (imperative, for non-React callers that resolve the locale from storage). */
export type TFn = (key: MsgKey, vars?: Record<string, string | number>) => string;

const en = {
  /* ---- shared ---- */
  loading: 'Loading…',
  na: 'n/a',
  ratingGood: 'Good',
  ratingNi: 'Needs improvement',
  ratingPoor: 'Poor',
  threshGood: 'Good ≤ {v}',
  threshPoor: 'Poor > {v}',

  /* ---- language switcher ---- */
  language: 'Language',
  interfaceLanguage: 'Interface language',

  /* ================================================================ */
  /* Popup — Page Insight                                             */
  /* ================================================================ */
  puTitle: 'Page Insight',
  puNoMeasure:
    'No measurements yet for this tab. Reload the page to collect Web Vitals and resource timing from the first byte.',
  puRequests: 'requests',
  puExactBytesLabel: 'exact bytes (cold load)',
  puMeasuredBytesLabel: 'measured bytes',
  puUnmeasured: 'unmeasured',
  puExactCaveat:
    'Exact page weight measured over a cache-bypassing reload with the debugger — every request re-fetched from the network and counted, including third-party resources.',
  // Lower-bound caveat (before the "Why?" disclosure). {count} interpolated.
  puLowerBoundOne:
    "Some third-party resources don't report their size, so this total is a lower bound — {count} request could not be measured (they are left out, not counted as zero).",
  puLowerBoundOther:
    "Some third-party resources don't report their size, so this total is a lower bound — {count} requests could not be measured (they are left out, not counted as zero).",
  puWhy: 'Why?',
  puTaoPre: 'Cross-origin resources served without a ',
  puTaoPost:
    " response header hide their transfer size from the page's Resource Timing data.",
  puComplete: 'Every request on this page reported its size, so this total is complete.',
  puExactByteWeight: 'Exact byte weight',
  puFfMeasure:
    "Banner-free exact byte measurement isn't available in this browser, so the total above (from Resource Timing) is the best estimate here.",
  puMeasuring: 'Measuring…',
  puMeasureBtn: 'Measure exact bytes',
  puErrDebuggerDeclined:
    'The debugger permission was declined. Exact byte measurement needs it.',
  puErrMeasureFailed: 'Measurement failed.',
  puByType: 'By type',
  puByTypePartialOne: '{count} request of this type reported no size',
  puByTypePartialOther: '{count} requests of this type reported no size',
  puThirdPartyDomains: 'Third-party domains',
  puTpPartialOne: '{count} request from this domain reported no size',
  puTpPartialOther: '{count} requests from this domain reported no size',
  puCompareLoads: 'Compare loads',
  puSaveAria: 'Save this load as a snapshot',
  puSaveSnapshot: 'Save snapshot',
  puDeltaRequests: 'Requests',
  puDeltaBytes: 'Bytes',
  puDeltaUnmeasured: 'Unmeasured',
  puBytesNotCompared:
    "Byte totals aren't compared: the snapshot and this load used different measurement methods, so a diff wouldn't be like-for-like.",
  puSnapshotForPre: 'Saved snapshot is for ',
  puSnapshotForPost: '; reload that page to compare.',
  puFooter: 'Open the Performance panel (F12) for the full request table.',
  puConsentAria: 'Confirm exact-byte measurement',
  puConsent1: "Measuring exact bytes attaches Chrome's debugger to this tab and ",
  puConsentReloadStrong: 'reloads the page bypassing the cache',
  puConsent2:
    ' so every request is re-fetched from the network and counted from the first byte. Chrome shows a non-dismissable ',
  puConsentBannerStrong: '“extension is debugging this browser”',
  puConsent3: ' banner while it runs. Only one debugger can attach at a time, so ',
  puConsentCloseStrong: "close this tab's DevTools",
  puConsent4: " if it's open.",
  puCancel: 'Cancel',
  puAttachMeasure: 'Attach debugger & measure',

  /* ---- popup: Vitals section (Vitals.tsx) ---- */
  viVitals: 'Vitals',
  viEmpty:
    'Vitals arrive as the page settles — LCP and CLS finalise on interaction or when the tab is hidden.',
  viTapHint: 'Tap a metric to see what it means.',
  // Spelled-out metric names.
  viFullLCP: 'Largest Contentful Paint',
  viFullINP: 'Interaction to Next Paint',
  viFullCLS: 'Cumulative Layout Shift',
  viFullFCP: 'First Contentful Paint',
  viFullTTFB: 'Time to First Byte',
  // One plain sentence per metric.
  viWhatLCP:
    'How long until the biggest thing on screen — usually the hero image or headline — actually appeared. It is the reader’s sense of "the page loaded".',
  viWhatINP:
    'When you click, tap or type, how long the page takes to show a response. It measures the slowest interaction of the visit, so it captures the moment the page felt sluggish.',
  viWhatCLS:
    'How much the page jumped around while loading — content moving under your finger just as you go to click it. It is a score, not a time; 0 means nothing moved.',
  viWhatFCP:
    'How long until the very first text or image appeared, i.e. when the page stopped being blank.',
  viWhatTTFB:
    'How long the server took to send the first byte of the page. Everything else waits on this, so it is the floor under every other timing here.',
  // Phase labels.
  viLblServerResponse: 'Server response',
  viLblResourceDiscovery: 'Resource discovery',
  viLblResourceDownload: 'Resource download',
  viLblRenderDelay: 'Render delay',
  viLblWaiting: 'Waiting (redirects, queue)',
  viLblDnsLookup: 'DNS lookup',
  viLblConnection: 'Connection (TCP + TLS)',
  viLblServerProcessing: 'Server processing',
  viLblRenderBlocking: 'Render-blocking',
  viLblInputDelay: 'Input delay',
  viLblEventHandlers: 'Event handlers',
  viLblPresentationDelay: 'Presentation delay',
  // Phase fixes.
  viFixLcpServer:
    'Most of the wait is the server itself. Speed up the response, remove redirects, or cache the HTML at the edge.',
  viFixLcpDiscovery:
    'The browser found this resource late. Reference it in the initial HTML (not from JS/CSS) or add a `<link rel="preload">` so the download starts sooner.',
  viFixLcpDownload:
    'The image itself is slow to download. Compress it, serve AVIF/WebP, and stop shipping a picture larger than it is displayed.',
  viFixLcpRender:
    'The content was ready but the browser could not paint it. Render-blocking CSS/JS, a font swap, or a busy main thread is holding the frame back.',
  viFixTtfbWaiting:
    'Time is going on redirects, service-worker startup or request queueing before the request is even sent. Cut redirect hops.',
  viFixTtfbDns:
    'DNS resolution dominates. `dns-prefetch`/`preconnect` to this origin, or use a faster DNS provider.',
  viFixTtfbConnection:
    'Setting up the connection dominates. Enable HTTP/2 or HTTP/3, keep connections alive, and `preconnect` to the origin.',
  viFixTtfbServer:
    'The server is thinking for too long. Cache the response, or profile the backend for the slow query.',
  viFixFcpServer:
    'The first paint is waiting on the server. Fix TTFB first — nothing can paint before the bytes arrive.',
  viFixFcpRenderBlocking:
    'The HTML arrived quickly but nothing painted. Render-blocking CSS/JS in the `<head>` is the usual cause — inline the critical CSS and defer the rest.',
  viFixInpInput:
    'The main thread was already busy when you interacted, so the handler could not even start. Break up long tasks and defer non-urgent work.',
  viFixInpHandlers:
    'The event handlers themselves are slow. Do the minimum needed to update the UI, and move the rest into a `requestIdleCallback` or a worker.',
  viFixInpPresentation:
    'The handler finished quickly but the next frame took a long time to paint — usually a large style/layout recalculation.',
  // "What to fix" block.
  viWhatToFix: 'What to fix',
  viClsMoved: 'The biggest jump moved this element',
  viClsParen: '{shift} of the {total} total{at}',
  viClsAt: ', at {time}',
  viClsPushed1: 'It was pushed by something ',
  viClsAboveIt: 'above it',
  viClsPushed2:
    ' that arrived late and took up space it had not reserved — typically an image or iframe with no ',
  viClsPushed3: ', or a banner, ad or cookie bar injected after first paint.',
  viClsGive1: 'Give that late content explicit dimensions (or an ',
  viClsGive2:
    '), and reserve its slot up front instead of letting it shove the page down.',
  viClsNoTarget:
    'The browser recorded the shift but not the element responsible — it was removed from the page before the measurement was finalised. Reload and watch for content that appears late.',
  viNoBreakdown:
    'This browser reported the score but no breakdown of what caused it, so there is nothing specific to point at here.',
  viBiggestSlicePre: 'Biggest slice: ',
  viBiggestSliceMid: ', {worst} of {total}.',
  viLargestElement: 'Largest element:',
  viSlowestInteraction: 'Slowest interaction was on:',
  viLargestShift: 'Largest single shift: {value} at {time}',
  viInpFf:
    'Not available in this browser: INP needs the Event Timing API, which is Chromium-only. It is not zero — it is unmeasurable here.',
  viInpNotYet:
    'Not measured yet — INP only exists once you have clicked, tapped or typed on the page. Interact with it and this fills in.',
  // Load timeline.
  viLoadTimeline: 'Load timeline',
  viHintLoad: 'load {t}',
  viHintDom: 'DOM {t}',
  viHintMeasuring: 'measuring…',
  viTimelineIntro:
    'Where the time went before the page finished. Every number is read from the browser’s own Navigation Timing; a dash means the browser did not report it, which is not the same as zero.',
  viTimeDns: 'DNS lookup',
  viTimeConnect: 'Connect (TCP)',
  viTimeTls: 'TLS handshake',
  viTimeRequest: 'Request → first byte',
  viTimeResponse: 'Response download',
  viTimeDcl: 'DOMContentLoaded',
  viTimeLoad: 'Load event',
  viRedirectMasked:
    'This page was reached through a cross-origin redirect, so the browser hides the phases before the response — they are unknowable here, not zero.',
  viRedirectsOne:
    '{count} redirect happened before this page — each one is a full round trip added to TTFB.',
  viRedirectsOther:
    '{count} redirects happened before this page — each one is a full round trip added to TTFB.',
  viNoTls: 'No TLS handshake — this page was served over plain HTTP.',
  // Main-thread blocking (popup).
  viBlockingUnsupported:
    'Long Animation Frames and the Long Tasks API are Chromium-only and this browser has neither, so main-thread blocking cannot be measured here. That is not a zero — it is unknown.',
  viBlockingIntro:
    'Time the main thread spent stuck in long tasks (over 50 ms), unable to respond to a click. This is what makes INP bad — and unlike INP it is measured whether or not anyone interacted.',
  viRespNoFrames:
    'No long {kind} recorded — the main thread stayed responsive.',
  viLongFramesNoBlockOne:
    '{count} long frame recorded, but none of them blocked the main thread — nothing here is holding up interaction.',
  viLongFramesNoBlockOther:
    '{count} long frames recorded, but none of them blocked the main thread — nothing here is holding up interaction.',
  viLongFramesNoScriptOne:
    '{count} long frame, but the browser attributed no script to them (usually cross-origin scripts, which are not attributable).',
  viLongFramesNoScriptOther:
    '{count} long frames, but the browser attributed no script to them (usually cross-origin scripts, which are not attributable).',
  viScriptsResponsible: 'Scripts responsible, by total time on the main thread:',
  // Shared kind words for the "No long …" sentences.
  viKindAnimFrames: 'animation frames',
  viKindTasks: 'tasks',
  // Shared main-thread-blocking heading.
  mainThreadBlocking: 'Main-thread blocking',

  /* ================================================================ */
  /* DevTools panel                                                   */
  /* ================================================================ */
  pnPanelsAria: 'Performance panels',
  tabVitals: 'Vitals',
  tabNetwork: 'Network',
  tabAudit: 'Audit (PSI)',

  /* ---- panel: Vitals tab ---- */
  pnWaitingMetrics:
    'Waiting for metrics. LCP and CLS finalise on the first interaction or when the page is hidden, so interact with the page or switch tabs to see their final values.',
  pnAttributionTitle: 'Element that caused this metric',
  pnElementTiming1:
    'Element Timing cannot measure arbitrary elements on pages you do not control: the ',
  pnElementTiming2:
    ' attribute does not work retroactively (W3C spec), so once an element has painted, setting it has no effect. We surface the LCP element via ',
  pnElementTiming3:
    ' instead. FCP and TTFB are timing-only and carry no element.',

  /* ---- panel: Network tab ---- */
  nwLblMeasured: 'Measured bytes',
  nwLblDevtools: 'DevTools bytes',
  nwLblExact: 'Exact bytes (debugger)',
  nwLblDevtoolsApprox: 'DevTools bytes (approx.)',
  nwWaiting: 'Waiting for network activity. Reload the page to capture it all.',
  nwStatRequests: 'Requests',
  nwStatUnmeasured: 'Unmeasured',
  nwCaveatRt:
    'Some resources don’t report their size, so this total is a lower bound, not the full page weight.',
  nwCaveatHarApprox:
    'These byte totals are approximate: this browser reports an uncompressed body size that excludes headers, not the exact bytes on the wire. Only requests seen while DevTools was open are included — reload to capture everything.',
  nwCaveatHar:
    'DevTools byte totals are accurate, but only requests seen while DevTools was open are included — reload the page to capture everything from the first byte.',
  nwCaveatCdp:
    'Exact wire bytes, counted even for cross-origin resources. The debugging banner is shown while attached.',
  nwUnmeasuredSuffixOne:
    ' request reported no size, so they are missing from the total above — left out, never counted as zero.',
  nwUnmeasuredSuffixOther:
    ' requests reported no size, so they are missing from the total above — left out, never counted as zero.',
  nwUnmeasuredRtPre: ' For exact page weight including these, use ',
  nwMeasureExactBytesStrong: 'Measure exact bytes',
  nwUnmeasuredRtPost: ' in the toolbar popup.',
  nwUnmeasuredHar:
    ' Reload with DevTools already open to capture their sizes from the first byte.',
  nwExactHintFf:
    'This browser has no banner-free exact-byte path, so DevTools HAR bytes above are the most accurate total available here.',
  nwExactHint:
    'For exact wire bytes counted even for cross-origin resources, open the extension popup and choose “Measure exact bytes” — it reloads the tab under the debugger, which cannot run while DevTools is open.',
  nwCaptionOne: 'Network requests — {count} row, {label}.',
  nwCaptionOther: 'Network requests — {count} rows, {label}.',
  nwColUrl: 'URL',
  nwColKind: 'Kind',
  nwColDuration: 'Duration',
  nwColSize: 'Size',
  nwColThirdParty: '3rd party',
  nwUnmeasuredCellTitle:
    "No size reported — a cross-origin resource that doesn't expose its size to the page.",
  nwYes: 'yes',
  nwNo: 'no',
  nwDashMeans:
    " means the size is unknowable: the resource didn't report one, so it is shown as blank, never as ",
  // Export controls.
  exportLabel: 'Export',
  exportCopyJson: 'Copy JSON',
  exportCopyJsonAria: 'Copy as JSON',
  exportJson: 'JSON',
  exportJsonAria: 'Download as JSON',
  exportCopyCsv: 'Copy CSV',
  exportCopyCsvAria: 'Copy as CSV',
  exportCsv: 'CSV',
  exportCsvAria: 'Download as CSV',
  exportCopiedJson: 'JSON copied to clipboard',
  exportCopiedCsv: 'CSV copied to clipboard',
  exportCopyFailed: 'Copy failed',

  /* ---- panel: Audit (PSI) tab ---- */
  auIntro1:
    "PageSpeed Insights runs Lighthouse on Google's servers and returns lab + field data. Lighthouse itself cannot be bundled (Node app; MV3 bans remote code), so this is the realistic path. ",
  auIntroStrong:
    'Running an audit sends the URL below — including any query string — to Google.',
  auIntro2: ' Public URLs only — localhost and pages behind auth are unreachable.',
  auApiKeyLabel: 'Google API key (optional, recommended)',
  auApiKeyHint1: 'Stored in ',
  auApiKeyHint2: ', never synced. Limits without a key: ~25,000/day, 400 per 100 s.',
  auUrlLabel: 'URL to audit (editable — sent to Google)',
  auUrlHint1: 'Defaults to the inspected page. ',
  auUrlHintStrong: 'The exact address you run is sent to Google as-is',
  auUrlHint2: ' — anything after ',
  auUrlHint3: ' or ',
  auUrlHint4:
    ' (session tokens, password-reset links, search queries) goes too. Edit it before auditing if it holds a secret.',
  auHasParams:
    'This address has query or fragment parameters that may contain private data. They will be sent to Google unless you remove them. ',
  auDomainPathOnly: 'Domain and path only',
  auDevice: 'Device',
  auMobile: 'Mobile',
  auDesktop: 'Desktop',
  auErrHostAccess: 'Host access to googleapis.com was not granted.',
  auErrPsiFailed: 'PSI request failed.',
  auDisclosureAria: 'PSI disclosure',
  auDiscTitle: 'This audit sends the URL to Google',
  auDisc2a: 'To run PageSpeed Insights, the extension sends the ',
  auDisc2bStrong:
    'full address of this page, including the query parameters after “?”',
  auDisc2c: ", to Google's PageSpeed Insights API (",
  auDisc2d: '). Google loads and measures the page and returns the results.',
  auDisc3a:
    '⚠️ Query parameters may contain private data — session tokens, password-reset links, search queries. ',
  auDisc3bStrong: 'Review and, if needed, edit the address above before running.',
  auDisc3c: ' Remove every parameter with the “Domain and path only” button.',
  auDisc4a:
    'Sent only when you explicitly run an audit. The address passed to Google is handled under ',
  auDisc4Link: "Google's privacy policy",
  auDisc4b:
    '. Fully local metrics (Web Vitals, resource timing, exact bytes) send nothing.',
  auAccept: 'I understand — send the address to Google',
  auAuditing: 'Auditing…',
  auRunAudit: 'Run PageSpeed audit',
  auAccepted: 'PSI disclosure accepted. ',
  auRevoke: 'Revoke consent',
  auScoreUnavailable: 'Performance score unavailable',
  auScore: 'Performance score',
  auLabData: 'Lab data via PSI, strategy: {strategy}.',
  auFieldUrl: 'Field data — this URL (CrUX, real users, p75)',
  auFieldOrigin: 'Field data — whole origin (CrUX, real users, p75)',
  auNoCrux:
    "No CrUX field data: this page/origin doesn't have enough real-user samples in the Chrome UX Report. Lab data above still applies.",

  /* ---- panel: Waterfall ---- */
  wfAria: 'Resource load waterfall',
  wfCaptionPre:
    "Waterfall — each bar is a request's start offset and duration",
  wfFirstOf: ' (first {max} of {total})',
  wfCaptionPost: '. Total window {ms} ms.',
  wfKinds: 'Resource kinds',
  wfBarTitle: '{kind} · start {start} ms · {dur} ms',

  /* ---- panel: Long frames ---- */
  lfUnsupported:
    "Long Animation Frames and the Long Tasks API are Chromium-only, and this browser exposes neither — so per-frame blocking can't be measured here. Core Web Vitals above still reflect the user experience.",
  lfTotalBlocking: 'total blocking',
  lfLongFrames: 'long frames',
  lfLongTasks: 'long tasks',
  lfNoFrames: 'No long {kind} (over 50 ms) recorded yet. Source: {source}.',
  lfColStart: 'Start',
  lfColDuration: 'Duration',
  lfColBlocking: 'Blocking',
  lfColTopScripts: 'Top scripts',
  lfNoScriptAttr: 'no script attribution',
  lfLayoutSuffix: ' (+{ms} ms layout)',
  lfSourceNote:
    'Source: {source}. Blocking is the main-thread time that could delay interaction. Script attribution shows the longest scripts in each frame.',
  lfWorstOffenders: 'Worst offenders (by script, across all frames)',
  lfOffendersCaption:
    'Scripts ranked by total time across every long frame this load.',
  lfColScript: 'Script',
  lfColFrames: 'Frames',
  lfColTotal: 'Total',
  lfColLayout: 'Layout',
} as const;

export type MsgKey = keyof typeof en;

const ru: Record<MsgKey, string> = {
  loading: 'Загрузка…',
  na: 'н/д',
  ratingGood: 'Хорошо',
  ratingNi: 'Требует улучшения',
  ratingPoor: 'Плохо',
  threshGood: 'Хорошо ≤ {v}',
  threshPoor: 'Плохо > {v}',

  language: 'Язык',
  interfaceLanguage: 'Язык интерфейса',

  puTitle: 'Обзор страницы',
  puNoMeasure:
    'Для этой вкладки пока нет измерений. Перезагрузите страницу, чтобы собрать Web Vitals и тайминги ресурсов с первого байта.',
  puRequests: 'запросов',
  puExactBytesLabel: 'точные байты (холодная загрузка)',
  puMeasuredBytesLabel: 'измеренные байты',
  puUnmeasured: 'не измерено',
  puExactCaveat:
    'Точный вес страницы измерен при перезагрузке в обход кэша с помощью отладчика — каждый запрос заново загружен из сети и учтён, включая сторонние ресурсы.',
  puLowerBoundOne:
    'Некоторые сторонние ресурсы не сообщают свой размер, поэтому этот итог — нижняя граница: {count} запрос не удалось измерить (он исключён, а не учтён как ноль).',
  puLowerBoundOther:
    'Некоторые сторонние ресурсы не сообщают свой размер, поэтому этот итог — нижняя граница: {count} запросов не удалось измерить (они исключены, а не учтены как ноль).',
  puWhy: 'Почему?',
  puTaoPre: 'Межисточниковые ресурсы, отданные без заголовка ',
  puTaoPost:
    ', скрывают свой размер передачи от данных Resource Timing страницы.',
  puComplete: 'Каждый запрос на этой странице сообщил свой размер, поэтому итог полный.',
  puExactByteWeight: 'Точный вес в байтах',
  puFfMeasure:
    'Измерение точного веса в байтах без баннера в этом браузере недоступно, поэтому итог выше (из Resource Timing) — лучшая оценка здесь.',
  puMeasuring: 'Измерение…',
  puMeasureBtn: 'Измерить точные байты',
  puErrDebuggerDeclined:
    'В разрешении отладчика отказано. Для измерения точных байтов оно необходимо.',
  puErrMeasureFailed: 'Измерение не удалось.',
  puByType: 'По типу',
  puByTypePartialOne: '{count} запрос этого типа не сообщил размер',
  puByTypePartialOther: '{count} запросов этого типа не сообщили размер',
  puThirdPartyDomains: 'Сторонние домены',
  puTpPartialOne: '{count} запрос с этого домена не сообщил размер',
  puTpPartialOther: '{count} запросов с этого домена не сообщили размер',
  puCompareLoads: 'Сравнить загрузки',
  puSaveAria: 'Сохранить эту загрузку как снимок',
  puSaveSnapshot: 'Сохранить снимок',
  puDeltaRequests: 'Запросы',
  puDeltaBytes: 'Байты',
  puDeltaUnmeasured: 'Не измерено',
  puBytesNotCompared:
    'Итоги в байтах не сравниваются: снимок и эта загрузка использовали разные методы измерения, поэтому разница была бы несопоставимой.',
  puSnapshotForPre: 'Сохранённый снимок для ',
  puSnapshotForPost: '; перезагрузите ту страницу для сравнения.',
  puFooter: 'Откройте панель Performance (F12), чтобы увидеть полную таблицу запросов.',
  puConsentAria: 'Подтвердите измерение точных байтов',
  puConsent1: 'Измерение точных байтов подключает отладчик Chrome к этой вкладке и ',
  puConsentReloadStrong: 'перезагружает страницу в обход кэша',
  puConsent2:
    ', поэтому каждый запрос заново загружается из сети и учитывается с первого байта. Chrome показывает несбрасываемый баннер ',
  puConsentBannerStrong: '«расширение отлаживает этот браузер»',
  puConsent3: ' во время работы. Одновременно может подключиться только один отладчик, поэтому ',
  puConsentCloseStrong: 'закройте DevTools этой вкладки',
  puConsent4: ', если они открыты.',
  puCancel: 'Отмена',
  puAttachMeasure: 'Подключить отладчик и измерить',

  viVitals: 'Vitals',
  viEmpty:
    'Vitals появляются по мере стабилизации страницы — LCP и CLS фиксируются при взаимодействии или когда вкладка скрыта.',
  viTapHint: 'Нажмите на метрику, чтобы узнать, что она означает.',
  viFullLCP: 'Largest Contentful Paint',
  viFullINP: 'Interaction to Next Paint',
  viFullCLS: 'Cumulative Layout Shift',
  viFullFCP: 'First Contentful Paint',
  viFullTTFB: 'Time to First Byte',
  viWhatLCP:
    'Сколько времени прошло, пока не появился самый крупный элемент на экране — обычно главное изображение или заголовок. Это ощущение читателя, что «страница загрузилась».',
  viWhatINP:
    'Когда вы щёлкаете, касаетесь или печатаете, сколько времени страница показывает отклик. Измеряется самое медленное взаимодействие визита, поэтому фиксируется момент, когда страница ощущалась вялой.',
  viWhatCLS:
    'Насколько страница прыгала при загрузке — содержимое смещалось под вашим пальцем как раз когда вы собирались нажать. Это оценка, а не время; 0 означает, что ничего не сместилось.',
  viWhatFCP:
    'Сколько времени прошло, пока не появился самый первый текст или изображение, т. е. когда страница перестала быть пустой.',
  viWhatTTFB:
    'Сколько времени сервер потратил на отправку первого байта страницы. Всё остальное ждёт этого, поэтому это нижняя граница под всеми остальными таймингами здесь.',
  viLblServerResponse: 'Ответ сервера',
  viLblResourceDiscovery: 'Обнаружение ресурса',
  viLblResourceDownload: 'Загрузка ресурса',
  viLblRenderDelay: 'Задержка отрисовки',
  viLblWaiting: 'Ожидание (редиректы, очередь)',
  viLblDnsLookup: 'DNS-запрос',
  viLblConnection: 'Соединение (TCP + TLS)',
  viLblServerProcessing: 'Обработка на сервере',
  viLblRenderBlocking: 'Блокировка отрисовки',
  viLblInputDelay: 'Задержка ввода',
  viLblEventHandlers: 'Обработчики событий',
  viLblPresentationDelay: 'Задержка представления',
  viFixLcpServer:
    'Большая часть ожидания — сам сервер. Ускорьте ответ, уберите редиректы или кэшируйте HTML на границе сети.',
  viFixLcpDiscovery:
    'Браузер поздно обнаружил этот ресурс. Сошлитесь на него в исходном HTML (не из JS/CSS) или добавьте `<link rel="preload">`, чтобы загрузка началась раньше.',
  viFixLcpDownload:
    'Само изображение медленно загружается. Сожмите его, отдавайте AVIF/WebP и перестаньте отправлять картинку крупнее, чем она отображается.',
  viFixLcpRender:
    'Содержимое было готово, но браузер не смог его отрисовать. Блокирующие отрисовку CSS/JS, подмена шрифта или занятый главный поток держат кадр.',
  viFixTtfbWaiting:
    'Время уходит на редиректы, запуск service worker или очередь запросов ещё до отправки запроса. Сократите число редиректов.',
  viFixTtfbDns:
    'Преобладает разрешение DNS. Используйте `dns-prefetch`/`preconnect` к этому источнику или более быстрый DNS-провайдер.',
  viFixTtfbConnection:
    'Преобладает установка соединения. Включите HTTP/2 или HTTP/3, держите соединения открытыми и используйте `preconnect` к источнику.',
  viFixTtfbServer:
    'Сервер думает слишком долго. Кэшируйте ответ или профилируйте бэкенд на предмет медленного запроса.',
  viFixFcpServer:
    'Первая отрисовка ждёт сервер. Сначала исправьте TTFB — ничего не отрисуется, пока не придут байты.',
  viFixFcpRenderBlocking:
    'HTML пришёл быстро, но ничего не отрисовалось. Обычная причина — блокирующие отрисовку CSS/JS в `<head>`: встройте критический CSS и отложите остальное.',
  viFixInpInput:
    'Главный поток уже был занят, когда вы взаимодействовали, поэтому обработчик даже не смог начаться. Разбейте длинные задачи и отложите несрочную работу.',
  viFixInpHandlers:
    'Сами обработчики событий медленные. Делайте минимум для обновления UI, а остальное перенесите в `requestIdleCallback` или в воркер.',
  viFixInpPresentation:
    'Обработчик завершился быстро, но следующий кадр долго отрисовывался — обычно из-за крупного пересчёта стилей/раскладки.',
  viWhatToFix: 'Что исправить',
  viClsMoved: 'Самый большой сдвиг переместил этот элемент',
  viClsParen: '{shift} из {total} всего{at}',
  viClsAt: ', в {time}',
  viClsPushed1: 'Его вытолкнуло что-то ',
  viClsAboveIt: 'над ним',
  viClsPushed2:
    ', что появилось поздно и заняло место, которое не было зарезервировано — обычно изображение или iframe без ',
  viClsPushed3: ', либо баннер, реклама или cookie-панель, вставленные после первой отрисовки.',
  viClsGive1: 'Задайте этому позднему содержимому явные размеры (или ',
  viClsGive2:
    ') и зарезервируйте его место заранее, вместо того чтобы позволять ему сдвигать страницу.',
  viClsNoTarget:
    'Браузер зафиксировал сдвиг, но не элемент-виновник — он был удалён со страницы до завершения измерения. Перезагрузите и следите за содержимым, которое появляется поздно.',
  viNoBreakdown:
    'Этот браузер сообщил оценку, но без разбивки причин, поэтому указать что-то конкретное здесь не на что.',
  viBiggestSlicePre: 'Наибольшая доля: ',
  viBiggestSliceMid: ', {worst} из {total}.',
  viLargestElement: 'Крупнейший элемент:',
  viSlowestInteraction: 'Самое медленное взаимодействие было на:',
  viLargestShift: 'Наибольший одиночный сдвиг: {value} в {time}',
  viInpFf:
    'Недоступно в этом браузере: INP требует Event Timing API, который есть только в Chromium. Это не ноль — здесь его невозможно измерить.',
  viInpNotYet:
    'Пока не измерено — INP появляется только после того, как вы щёлкнули, коснулись или напечатали на странице. Повзаимодействуйте с ней, и значение заполнится.',
  viLoadTimeline: 'Хронология загрузки',
  viHintLoad: 'load {t}',
  viHintDom: 'DOM {t}',
  viHintMeasuring: 'измерение…',
  viTimelineIntro:
    'Куда ушло время до завершения страницы. Каждое число прочитано из собственного Navigation Timing браузера; прочерк означает, что браузер его не сообщил, а это не то же самое, что ноль.',
  viTimeDns: 'DNS-запрос',
  viTimeConnect: 'Соединение (TCP)',
  viTimeTls: 'Рукопожатие TLS',
  viTimeRequest: 'Запрос → первый байт',
  viTimeResponse: 'Загрузка ответа',
  viTimeDcl: 'DOMContentLoaded',
  viTimeLoad: 'Событие load',
  viRedirectMasked:
    'Эта страница была достигнута через межисточниковый редирект, поэтому браузер скрывает фазы до ответа — они здесь неизвестны, а не нулевые.',
  viRedirectsOne:
    '{count} редирект произошёл перед этой страницей — каждый добавляет полный круговой путь к TTFB.',
  viRedirectsOther:
    '{count} редиректов произошло перед этой страницей — каждый добавляет полный круговой путь к TTFB.',
  viNoTls: 'Рукопожатия TLS нет — эта страница отдавалась по обычному HTTP.',
  viBlockingUnsupported:
    'Long Animation Frames и Long Tasks API есть только в Chromium, а в этом браузере нет ни того, ни другого, поэтому блокировку главного потока здесь измерить нельзя. Это не ноль — это неизвестно.',
  viBlockingIntro:
    'Время, которое главный поток провёл в длинных задачах (более 50 мс), не в состоянии ответить на клик. Именно это ухудшает INP — и, в отличие от INP, измеряется независимо от того, взаимодействовал ли кто-нибудь.',
  viRespNoFrames:
    'Длинные {kind} не зафиксированы — главный поток оставался отзывчивым.',
  viLongFramesNoBlockOne:
    'Зафиксирован {count} длинный кадр, но ни один из них не блокировал главный поток — здесь ничто не задерживает взаимодействие.',
  viLongFramesNoBlockOther:
    'Зафиксировано длинных кадров: {count}, но ни один из них не блокировал главный поток — здесь ничто не задерживает взаимодействие.',
  viLongFramesNoScriptOne:
    '{count} длинный кадр, но браузер не привязал к ним ни одного скрипта (обычно межисточниковые скрипты, которые не атрибутируются).',
  viLongFramesNoScriptOther:
    'Длинных кадров: {count}, но браузер не привязал к ним ни одного скрипта (обычно межисточниковые скрипты, которые не атрибутируются).',
  viScriptsResponsible: 'Ответственные скрипты, по суммарному времени в главном потоке:',
  viKindAnimFrames: 'кадры анимации',
  viKindTasks: 'задачи',
  mainThreadBlocking: 'Блокировка главного потока',

  pnPanelsAria: 'Панели производительности',
  tabVitals: 'Vitals',
  tabNetwork: 'Сеть',
  tabAudit: 'Аудит (PSI)',

  pnWaitingMetrics:
    'Ожидание метрик. LCP и CLS фиксируются при первом взаимодействии или когда страница скрыта, поэтому повзаимодействуйте со страницей или переключите вкладки, чтобы увидеть их итоговые значения.',
  pnAttributionTitle: 'Элемент, вызвавший эту метрику',
  pnElementTiming1:
    'Element Timing не может измерять произвольные элементы на страницах, которые вы не контролируете: атрибут ',
  pnElementTiming2:
    ' не работает задним числом (спецификация W3C), поэтому после того как элемент отрисовался, его установка не даёт эффекта. Вместо этого мы показываем элемент LCP через ',
  pnElementTiming3:
    '. FCP и TTFB — только тайминги и элемента не несут.',

  nwLblMeasured: 'Измеренные байты',
  nwLblDevtools: 'Байты DevTools',
  nwLblExact: 'Точные байты (отладчик)',
  nwLblDevtoolsApprox: 'Байты DevTools (прибл.)',
  nwWaiting: 'Ожидание сетевой активности. Перезагрузите страницу, чтобы захватить всё.',
  nwStatRequests: 'Запросы',
  nwStatUnmeasured: 'Не измерено',
  nwCaveatRt:
    'Некоторые ресурсы не сообщают свой размер, поэтому этот итог — нижняя граница, а не полный вес страницы.',
  nwCaveatHarApprox:
    'Эти итоги в байтах приблизительны: этот браузер сообщает несжатый размер тела без заголовков, а не точные байты по сети. Включены только запросы, замеченные при открытых DevTools — перезагрузите, чтобы захватить всё.',
  nwCaveatHar:
    'Итоги в байтах из DevTools точны, но включены только запросы, замеченные при открытых DevTools — перезагрузите страницу, чтобы захватить всё с первого байта.',
  nwCaveatCdp:
    'Точные байты по сети, учтённые даже для межисточниковых ресурсов. Пока отладчик подключён, показывается баннер отладки.',
  nwUnmeasuredSuffixOne:
    ' запрос не сообщил размер, поэтому он отсутствует в итоге выше — исключён, но никогда не учтён как ноль.',
  nwUnmeasuredSuffixOther:
    ' запросов не сообщили размер, поэтому они отсутствуют в итоге выше — исключены, но никогда не учтены как ноль.',
  nwUnmeasuredRtPre: ' Чтобы получить точный вес страницы с их учётом, используйте ',
  nwMeasureExactBytesStrong: 'Измерить точные байты',
  nwUnmeasuredRtPost: ' во всплывающем окне на панели инструментов.',
  nwUnmeasuredHar:
    ' Перезагрузите с уже открытыми DevTools, чтобы захватить их размеры с первого байта.',
  nwExactHintFf:
    'В этом браузере нет пути к точным байтам без баннера, поэтому байты DevTools HAR выше — самый точный доступный здесь итог.',
  nwExactHint:
    'Чтобы получить точные байты по сети, учтённые даже для межисточниковых ресурсов, откройте всплывающее окно расширения и выберите «Измерить точные байты» — оно перезагрузит вкладку под отладчиком, который не может работать при открытых DevTools.',
  nwCaptionOne: 'Сетевые запросы — {count} строка, {label}.',
  nwCaptionOther: 'Сетевые запросы — строк: {count}, {label}.',
  nwColUrl: 'URL',
  nwColKind: 'Тип',
  nwColDuration: 'Длительность',
  nwColSize: 'Размер',
  nwColThirdParty: 'Сторонний',
  nwUnmeasuredCellTitle:
    'Размер не сообщён — межисточниковый ресурс, не раскрывающий свой размер странице.',
  nwYes: 'да',
  nwNo: 'нет',
  nwDashMeans:
    ' означает, что размер неизвестен: ресурс его не сообщил, поэтому он показан пустым, но никогда как ',
  exportLabel: 'Экспорт',
  exportCopyJson: 'Копировать JSON',
  exportCopyJsonAria: 'Копировать как JSON',
  exportJson: 'JSON',
  exportJsonAria: 'Скачать как JSON',
  exportCopyCsv: 'Копировать CSV',
  exportCopyCsvAria: 'Копировать как CSV',
  exportCsv: 'CSV',
  exportCsvAria: 'Скачать как CSV',
  exportCopiedJson: 'JSON скопирован в буфер обмена',
  exportCopiedCsv: 'CSV скопирован в буфер обмена',
  exportCopyFailed: 'Не удалось скопировать',

  auIntro1:
    'PageSpeed Insights запускает Lighthouse на серверах Google и возвращает лабораторные и полевые данные. Сам Lighthouse встроить нельзя (приложение на Node; MV3 запрещает удалённый код), поэтому это реалистичный путь. ',
  auIntroStrong:
    'Запуск аудита отправляет URL ниже — включая любую строку запроса — в Google.',
  auIntro2: ' Только публичные URL — localhost и страницы за авторизацией недоступны.',
  auApiKeyLabel: 'Ключ Google API (необязательно, рекомендуется)',
  auApiKeyHint1: 'Хранится в ',
  auApiKeyHint2: ', никогда не синхронизируется. Лимиты без ключа: ~25 000/день, 400 за 100 с.',
  auUrlLabel: 'URL для аудита (можно менять — отправляется в Google)',
  auUrlHint1: 'По умолчанию — проверяемая страница. ',
  auUrlHintStrong: 'Точный адрес, который вы запускаете, отправляется в Google как есть',
  auUrlHint2: ' — всё после ',
  auUrlHint3: ' или ',
  auUrlHint4:
    ' (токены сессии, ссылки для сброса пароля, поисковые запросы) уходит тоже. Отредактируйте адрес перед аудитом, если в нём есть секрет.',
  auHasParams:
    'В этом адресе есть параметры запроса или фрагмента, которые могут содержать личные данные. Они будут отправлены в Google, если вы их не удалите. ',
  auDomainPathOnly: 'Только домен и путь',
  auDevice: 'Устройство',
  auMobile: 'Мобильное',
  auDesktop: 'Настольное',
  auErrHostAccess: 'Доступ к хосту googleapis.com не предоставлен.',
  auErrPsiFailed: 'Запрос PSI не удался.',
  auDisclosureAria: 'Раскрытие PSI',
  auDiscTitle: 'Этот аудит отправляет URL в Google',
  auDisc2a: 'Чтобы запустить PageSpeed Insights, расширение отправляет ',
  auDisc2bStrong:
    'полный адрес этой страницы, включая параметры запроса после «?»',
  auDisc2c: ' в API PageSpeed Insights от Google (',
  auDisc2d: '). Google загружает и измеряет страницу и возвращает результаты.',
  auDisc3a:
    '⚠️ Параметры запроса могут содержать личные данные — токены сессии, ссылки для сброса пароля, поисковые запросы. ',
  auDisc3bStrong: 'Просмотрите и, при необходимости, отредактируйте адрес выше перед запуском.',
  auDisc3c: ' Удалите каждый параметр кнопкой «Только домен и путь».',
  auDisc4a:
    'Отправляется только когда вы явно запускаете аудит. Адрес, переданный в Google, обрабатывается согласно ',
  auDisc4Link: 'политике конфиденциальности Google',
  auDisc4b:
    '. Полностью локальные метрики (Web Vitals, тайминги ресурсов, точные байты) не отправляют ничего.',
  auAccept: 'Понимаю — отправить адрес в Google',
  auAuditing: 'Аудит…',
  auRunAudit: 'Запустить аудит PageSpeed',
  auAccepted: 'Раскрытие PSI принято. ',
  auRevoke: 'Отозвать согласие',
  auScoreUnavailable: 'Оценка производительности недоступна',
  auScore: 'Оценка производительности',
  auLabData: 'Лабораторные данные через PSI, стратегия: {strategy}.',
  auFieldUrl: 'Полевые данные — этот URL (CrUX, реальные пользователи, p75)',
  auFieldOrigin: 'Полевые данные — весь источник (CrUX, реальные пользователи, p75)',
  auNoCrux:
    'Полевых данных CrUX нет: у этой страницы/источника недостаточно выборок реальных пользователей в Chrome UX Report. Лабораторные данные выше всё ещё применимы.',

  wfAria: 'Водопад загрузки ресурсов',
  wfCaptionPre:
    'Водопад — каждая полоса это смещение старта и длительность запроса',
  wfFirstOf: ' (первые {max} из {total})',
  wfCaptionPost: '. Общее окно {ms} мс.',
  wfKinds: 'Типы ресурсов',
  wfBarTitle: '{kind} · старт {start} мс · {dur} мс',

  lfUnsupported:
    'Long Animation Frames и Long Tasks API есть только в Chromium, а этот браузер не предоставляет ни того, ни другого — поэтому поблочную блокировку здесь измерить нельзя. Core Web Vitals выше по-прежнему отражают опыт пользователя.',
  lfTotalBlocking: 'всего блокировки',
  lfLongFrames: 'длинных кадров',
  lfLongTasks: 'длинных задач',
  lfNoFrames: 'Длинные {kind} (более 50 мс) пока не зафиксированы. Источник: {source}.',
  lfColStart: 'Старт',
  lfColDuration: 'Длительность',
  lfColBlocking: 'Блокировка',
  lfColTopScripts: 'Основные скрипты',
  lfNoScriptAttr: 'нет атрибуции скрипта',
  lfLayoutSuffix: ' (+{ms} мс раскладка)',
  lfSourceNote:
    'Источник: {source}. Блокировка — это время главного потока, которое может задержать взаимодействие. Атрибуция скриптов показывает самые долгие скрипты в каждом кадре.',
  lfWorstOffenders: 'Худшие виновники (по скрипту, по всем кадрам)',
  lfOffendersCaption:
    'Скрипты, ранжированные по суммарному времени по всем длинным кадрам этой загрузки.',
  lfColScript: 'Скрипт',
  lfColFrames: 'Кадры',
  lfColTotal: 'Всего',
  lfColLayout: 'Раскладка',
};

const et: Record<MsgKey, string> = {
  loading: 'Laadimine…',
  na: 'pole',
  ratingGood: 'Hea',
  ratingNi: 'Vajab parandamist',
  ratingPoor: 'Halb',
  threshGood: 'Hea ≤ {v}',
  threshPoor: 'Halb > {v}',

  language: 'Keel',
  interfaceLanguage: 'Liidese keel',

  puTitle: 'Lehe ülevaade',
  puNoMeasure:
    'Selle kaardi jaoks pole veel mõõtmisi. Laadi leht uuesti, et koguda Web Vitals ja ressursside ajastus esimesest baidist alates.',
  puRequests: 'päringut',
  puExactBytesLabel: 'täpsed baidid (külm laadimine)',
  puMeasuredBytesLabel: 'mõõdetud baidid',
  puUnmeasured: 'mõõtmata',
  puExactCaveat:
    'Lehe täpne kaal on mõõdetud vahemälust möödamineval taaslaadimisel silumisliidesega — iga päring laaditi võrgust uuesti ja loeti kokku, sealhulgas kolmandate osapoolte ressursid.',
  puLowerBoundOne:
    'Mõned kolmandate osapoolte ressursid ei teata oma suurust, seega see kokkuvõte on alampiir — {count} päringut ei õnnestunud mõõta (see jäetakse välja, mitte ei loeta nulliks).',
  puLowerBoundOther:
    'Mõned kolmandate osapoolte ressursid ei teata oma suurust, seega see kokkuvõte on alampiir — {count} päringut ei õnnestunud mõõta (need jäetakse välja, mitte ei loeta nulliks).',
  puWhy: 'Miks?',
  puTaoPre: 'Eri päritolu ressursid, mis on antud ilma ',
  puTaoPost:
    ' vastusepäiseta, peidavad oma ülekandesuuruse lehe Resource Timingu andmete eest.',
  puComplete: 'Iga päring sellel lehel teatas oma suuruse, seega on kokkuvõte täielik.',
  puExactByteWeight: 'Täpne baidikaal',
  puFfMeasure:
    'Bännerivaba täpse baidikaalu mõõtmine pole selles brauseris saadaval, seega ülal olev kokkuvõte (Resource Timingust) on parim hinnang siin.',
  puMeasuring: 'Mõõtmine…',
  puMeasureBtn: 'Mõõda täpsed baidid',
  puErrDebuggerDeclined:
    'Silumisliidese luba lükati tagasi. Täpne baidimõõtmine vajab seda.',
  puErrMeasureFailed: 'Mõõtmine ebaõnnestus.',
  puByType: 'Tüübi järgi',
  puByTypePartialOne: '{count} seda tüüpi päring ei teatanud suurust',
  puByTypePartialOther: '{count} seda tüüpi päringut ei teatanud suurust',
  puThirdPartyDomains: 'Kolmandate osapoolte domeenid',
  puTpPartialOne: '{count} päring sellelt domeenilt ei teatanud suurust',
  puTpPartialOther: '{count} päringut sellelt domeenilt ei teatanud suurust',
  puCompareLoads: 'Võrdle laadimisi',
  puSaveAria: 'Salvesta see laadimine hetktõmmisena',
  puSaveSnapshot: 'Salvesta hetktõmmis',
  puDeltaRequests: 'Päringud',
  puDeltaBytes: 'Baidid',
  puDeltaUnmeasured: 'Mõõtmata',
  puBytesNotCompared:
    'Baidikokkuvõtteid ei võrrelda: hetktõmmis ja see laadimine kasutasid erinevaid mõõtmismeetodeid, seega poleks vahe võrreldav.',
  puSnapshotForPre: 'Salvestatud hetktõmmis on lehe kohta: ',
  puSnapshotForPost: '; võrdlemiseks laadi see leht uuesti.',
  puFooter: 'Ava Performance-paneel (F12), et näha täielikku päringutabelit.',
  puConsentAria: 'Kinnita täpne baidimõõtmine',
  puConsent1: 'Täpne baidimõõtmine ühendab Chrome’i silumisliidese selle kaardiga ja ',
  puConsentReloadStrong: 'laadib lehe uuesti vahemälust mööda minnes',
  puConsent2:
    ', nii et iga päring laaditakse võrgust uuesti ja loetakse kokku esimesest baidist. Chrome näitab töö ajal mittesuletavat ',
  puConsentBannerStrong: '„laiendus silub seda brauserit“',
  puConsent3: ' bännerit. Korraga saab ühenduda ainult üks silumisliides, seega ',
  puConsentCloseStrong: 'sulge selle kaardi DevTools',
  puConsent4: ', kui see on avatud.',
  puCancel: 'Tühista',
  puAttachMeasure: 'Ühenda silumisliides ja mõõda',

  viVitals: 'Vitals',
  viEmpty:
    'Vitals ilmuvad leht rahunedes — LCP ja CLS fikseeruvad suhtlusel või kui kaart on peidetud.',
  viTapHint: 'Puuduta mõõdikut, et näha, mida see tähendab.',
  viFullLCP: 'Largest Contentful Paint',
  viFullINP: 'Interaction to Next Paint',
  viFullCLS: 'Cumulative Layout Shift',
  viFullFCP: 'First Contentful Paint',
  viFullTTFB: 'Time to First Byte',
  viWhatLCP:
    'Kui kaua läks, kuni ekraani suurim asi — tavaliselt kangelaspilt või pealkiri — päriselt ilmus. See on lugeja tunne, et „leht laadis“.',
  viWhatINP:
    'Kui klõpsad, puudutad või kirjutad, kui kaua leht vastuse näitamiseks võtab. See mõõdab külastuse aeglaseimat suhtlust, seega tabab hetke, mil leht tundus loid.',
  viWhatCLS:
    'Kui palju leht laadimise ajal hüppas — sisu liikus su sõrme all just siis, kui läksid klõpsama. See on skoor, mitte aeg; 0 tähendab, et miski ei liikunud.',
  viWhatFCP:
    'Kui kaua läks, kuni ilmus kõige esimene tekst või pilt, st kui leht lakkas olemast tühi.',
  viWhatTTFB:
    'Kui kaua server lehe esimese baidi saatmiseks võttis. Kõik muu ootab seda, seega on see põrand kõigi teiste ajastuste all siin.',
  viLblServerResponse: 'Serveri vastus',
  viLblResourceDiscovery: 'Ressursi avastamine',
  viLblResourceDownload: 'Ressursi allalaadimine',
  viLblRenderDelay: 'Renderdusviivitus',
  viLblWaiting: 'Ootamine (ümbersuunamised, järjekord)',
  viLblDnsLookup: 'DNS-päring',
  viLblConnection: 'Ühendus (TCP + TLS)',
  viLblServerProcessing: 'Serveripoolne töötlus',
  viLblRenderBlocking: 'Renderdust blokeeriv',
  viLblInputDelay: 'Sisestusviivitus',
  viLblEventHandlers: 'Sündmusekäsitlejad',
  viLblPresentationDelay: 'Esitusviivitus',
  viFixLcpServer:
    'Enamik ootamisest on server ise. Kiirenda vastust, eemalda ümbersuunamised või vahemälusta HTML servas.',
  viFixLcpDiscovery:
    'Brauser avastas selle ressursi hilja. Viita sellele algses HTML-is (mitte JS/CSS-ist) või lisa `<link rel="preload">`, et allalaadimine algaks varem.',
  viFixLcpDownload:
    'Pilt ise laadib aeglaselt. Suru see kokku, serveeri AVIF/WebP ja lõpeta kuvatust suurema pildi saatmine.',
  viFixLcpRender:
    'Sisu oli valmis, kuid brauser ei suutnud seda joonistada. Renderdust blokeeriv CSS/JS, fondivahetus või hõivatud põhilõim hoiab kaadrit tagasi.',
  viFixTtfbWaiting:
    'Aeg kulub ümbersuunamistele, service workeri käivitusele või päringute järjekorrale juba enne päringu saatmist. Vähenda ümbersuunamiste hüppeid.',
  viFixTtfbDns:
    'Domineerib DNS-i lahendamine. Kasuta `dns-prefetch`/`preconnect` selle päritolu suunas või kiiremat DNS-pakkujat.',
  viFixTtfbConnection:
    'Domineerib ühenduse loomine. Luba HTTP/2 või HTTP/3, hoia ühendused elus ja kasuta `preconnect` päritolu suunas.',
  viFixTtfbServer:
    'Server mõtleb liiga kaua. Vahemälusta vastus või profileeri taustsüsteemi aeglase päringu suhtes.',
  viFixFcpServer:
    'Esimene joonistus ootab serverit. Paranda kõigepealt TTFB — miski ei joonistu enne baitide saabumist.',
  viFixFcpRenderBlocking:
    'HTML saabus kiiresti, kuid midagi ei joonistunud. Tavaline põhjus on renderdust blokeeriv CSS/JS `<head>`-is — põimi kriitiline CSS ja lükka ülejäänu edasi.',
  viFixInpInput:
    'Põhilõim oli suheldes juba hõivatud, seega käsitleja ei saanud isegi alustada. Tükelda pikad ülesanded ja lükka mittekiireloomuline töö edasi.',
  viFixInpHandlers:
    'Sündmusekäsitlejad ise on aeglased. Tee UI uuendamiseks miinimum ja vii ülejäänu `requestIdleCallback`-i või töölõime.',
  viFixInpPresentation:
    'Käsitleja lõpetas kiiresti, kuid järgmine kaader joonistus kaua — tavaliselt suur stiili/paigutuse ümberarvutus.',
  viWhatToFix: 'Mida parandada',
  viClsMoved: 'Suurim hüpe liigutas seda elementi',
  viClsParen: '{shift} kogu {total}-st{at}',
  viClsAt: ', ajal {time}',
  viClsPushed1: 'Seda lükkas midagi ',
  viClsAboveIt: 'selle kohal',
  viClsPushed2:
    ', mis saabus hilja ja võttis ruumi, mida polnud reserveeritud — tavaliselt pilt või iframe ilma ',
  viClsPushed3: ', või pärast esimest joonistust sisestatud bänner, reklaam või küpsiseriba.',
  viClsGive1: 'Anna sellele hilisele sisule selged mõõtmed (või ',
  viClsGive2:
    ') ja reserveeri selle koht ette, selle asemel et lasta sel lehte allapoole lükata.',
  viClsNoTarget:
    'Brauser salvestas nihke, kuid mitte vastutava elemendi — see eemaldati lehelt enne mõõtmise lõplikustumist. Laadi uuesti ja jälgi sisu, mis ilmub hilja.',
  viNoBreakdown:
    'See brauser teatas skoori, kuid ei jaganud selle põhjuseid, seega pole siin midagi konkreetset, millele osutada.',
  viBiggestSlicePre: 'Suurim osa: ',
  viBiggestSliceMid: ', {worst} / {total}.',
  viLargestElement: 'Suurim element:',
  viSlowestInteraction: 'Aeglaseim suhtlus oli elemendil:',
  viLargestShift: 'Suurim üksiknihe: {value} ajal {time}',
  viInpFf:
    'Selles brauseris pole saadaval: INP vajab Event Timing API-t, mis on ainult Chromiumis. See pole null — seda pole siin võimalik mõõta.',
  viInpNotYet:
    'Veel mõõtmata — INP tekib alles siis, kui oled lehel klõpsanud, puudutanud või kirjutanud. Suhtle sellega ja see täitub.',
  viLoadTimeline: 'Laadimise ajajoon',
  viHintLoad: 'load {t}',
  viHintDom: 'DOM {t}',
  viHintMeasuring: 'mõõtmine…',
  viTimelineIntro:
    'Kuhu aeg enne lehe valmimist kulus. Iga number on loetud brauseri enda Navigation Timingust; kriips tähendab, et brauser ei teatanud seda, mis pole sama mis null.',
  viTimeDns: 'DNS-päring',
  viTimeConnect: 'Ühendus (TCP)',
  viTimeTls: 'TLS-i käepigistus',
  viTimeRequest: 'Päring → esimene bait',
  viTimeResponse: 'Vastuse allalaadimine',
  viTimeDcl: 'DOMContentLoaded',
  viTimeLoad: 'Load-sündmus',
  viRedirectMasked:
    'See leht saavutati eri päritolu ümbersuunamise kaudu, seega brauser peidab enne vastust olevad faasid — need on siin teadmata, mitte null.',
  viRedirectsOne:
    '{count} ümbersuunamine toimus enne seda lehte — igaüks lisab TTFB-le täisedasi-tagasi teekonna.',
  viRedirectsOther:
    '{count} ümbersuunamist toimus enne seda lehte — igaüks lisab TTFB-le täisedasi-tagasi teekonna.',
  viNoTls: 'TLS-i käepigistust pole — see leht serveeriti tavalise HTTP kaudu.',
  viBlockingUnsupported:
    'Long Animation Frames ja Long Tasks API on ainult Chromiumis ning sellel brauseril pole kumbagi, seega põhilõime blokeeringut ei saa siin mõõta. See pole null — see on teadmata.',
  viBlockingIntro:
    'Aeg, mille põhilõim veetis pikkades ülesannetes (üle 50 ms) kinni, klõpsule vastamata. Just see teeb INP-i halvaks — ja erinevalt INP-ist mõõdetakse seda olenemata sellest, kas keegi suhtles.',
  viRespNoFrames:
    'Pikki {kind} ei salvestatud — põhilõim jäi reageerivaks.',
  viLongFramesNoBlockOne:
    'Salvestati {count} pikk kaader, kuid ükski neist ei blokeerinud põhilõime — siin ei hoia miski suhtlust tagasi.',
  viLongFramesNoBlockOther:
    'Salvestati {count} pikka kaadrit, kuid ükski neist ei blokeerinud põhilõime — siin ei hoia miski suhtlust tagasi.',
  viLongFramesNoScriptOne:
    '{count} pikk kaader, kuid brauser ei omistanud neile ühtki skripti (tavaliselt eri päritolu skriptid, mida ei saa omistada).',
  viLongFramesNoScriptOther:
    '{count} pikka kaadrit, kuid brauser ei omistanud neile ühtki skripti (tavaliselt eri päritolu skriptid, mida ei saa omistada).',
  viScriptsResponsible: 'Vastutavad skriptid, põhilõimes veedetud koguaja järgi:',
  viKindAnimFrames: 'animatsioonikaadrit',
  viKindTasks: 'ülesannet',
  mainThreadBlocking: 'Põhilõime blokeering',

  pnPanelsAria: 'Jõudluspaneelid',
  tabVitals: 'Vitals',
  tabNetwork: 'Võrk',
  tabAudit: 'Audit (PSI)',

  pnWaitingMetrics:
    'Ootan mõõdikuid. LCP ja CLS fikseeruvad esimesel suhtlusel või kui leht on peidetud, seega suhtle lehega või vaheta kaarte, et näha nende lõppväärtusi.',
  pnAttributionTitle: 'Element, mis selle mõõdiku põhjustas',
  pnElementTiming1:
    'Element Timing ei saa mõõta suvalisi elemente lehtedel, mida sa ei kontrolli: atribuut ',
  pnElementTiming2:
    ' ei tööta tagasiulatuvalt (W3C spetsifikatsioon), seega kui element on juba joonistunud, ei anna selle määramine mingit mõju. Selle asemel toome LCP elemendi esile ',
  pnElementTiming3:
    ' kaudu. FCP ja TTFB on ainult ajastus ega kanna elementi.',

  nwLblMeasured: 'Mõõdetud baidid',
  nwLblDevtools: 'DevToolsi baidid',
  nwLblExact: 'Täpsed baidid (silur)',
  nwLblDevtoolsApprox: 'DevToolsi baidid (ligikaudu)',
  nwWaiting: 'Ootan võrguaktiivsust. Laadi leht uuesti, et see kõik jäädvustada.',
  nwStatRequests: 'Päringud',
  nwStatUnmeasured: 'Mõõtmata',
  nwCaveatRt:
    'Mõned ressursid ei teata oma suurust, seega see kokkuvõte on alampiir, mitte lehe täiskaal.',
  nwCaveatHarApprox:
    'Need baidikokkuvõtted on ligikaudsed: see brauser teatab pakkimata keha suuruse, mis välistab päised, mitte täpseid baite juhtme peal. Kaasatud on ainult päringud, mida nähti DevToolsi avatuna — laadi uuesti, et kõik jäädvustada.',
  nwCaveatHar:
    'DevToolsi baidikokkuvõtted on täpsed, kuid kaasatud on ainult päringud, mida nähti DevToolsi avatuna — laadi leht uuesti, et kõik esimesest baidist jäädvustada.',
  nwCaveatCdp:
    'Täpsed baidid juhtme peal, loetud isegi eri päritolu ressursside puhul. Ühenduse ajal näidatakse silumisbännerit.',
  nwUnmeasuredSuffixOne:
    ' päring ei teatanud suurust, seega puudub see ülal olevast kokkuvõttest — välja jäetud, mitte kunagi nulliks loetud.',
  nwUnmeasuredSuffixOther:
    ' päringut ei teatanud suurust, seega puuduvad need ülal olevast kokkuvõttest — välja jäetud, mitte kunagi nulliks loetud.',
  nwUnmeasuredRtPre: ' Nende arvestamisega lehe täpse kaalu saamiseks kasuta ',
  nwMeasureExactBytesStrong: 'Mõõda täpsed baidid',
  nwUnmeasuredRtPost: ' tööriistariba hüpikaknas.',
  nwUnmeasuredHar:
    ' Laadi uuesti juba avatud DevToolsiga, et jäädvustada nende suurused esimesest baidist.',
  nwExactHintFf:
    'Sellel brauseril pole bännerivaba täpsete baitide teed, seega ülal olevad DevTools HAR baidid on kõige täpsem siin saadaolev kokkuvõte.',
  nwExactHint:
    'Täpsete baitide saamiseks juhtme peal, loetud isegi eri päritolu ressursside puhul, ava laienduse hüpikaken ja vali „Mõõda täpsed baidid“ — see laadib kaardi uuesti siluri all, mis ei saa töötada DevToolsi avatuna.',
  nwCaptionOne: 'Võrgupäringud — {count} rida, {label}.',
  nwCaptionOther: 'Võrgupäringud — {count} rida, {label}.',
  nwColUrl: 'URL',
  nwColKind: 'Tüüp',
  nwColDuration: 'Kestus',
  nwColSize: 'Suurus',
  nwColThirdParty: 'Kolmas osapool',
  nwUnmeasuredCellTitle:
    'Suurust ei teatatud — eri päritolu ressurss, mis ei avalikusta oma suurust lehele.',
  nwYes: 'jah',
  nwNo: 'ei',
  nwDashMeans:
    ' tähendab, et suurus on teadmata: ressurss ei teatanud seda, seega kuvatakse see tühjana, mitte kunagi kui ',
  exportLabel: 'Eksport',
  exportCopyJson: 'Kopeeri JSON',
  exportCopyJsonAria: 'Kopeeri JSON-ina',
  exportJson: 'JSON',
  exportJsonAria: 'Laadi alla JSON-ina',
  exportCopyCsv: 'Kopeeri CSV',
  exportCopyCsvAria: 'Kopeeri CSV-na',
  exportCsv: 'CSV',
  exportCsvAria: 'Laadi alla CSV-na',
  exportCopiedJson: 'JSON kopeeriti lõikelauale',
  exportCopiedCsv: 'CSV kopeeriti lõikelauale',
  exportCopyFailed: 'Kopeerimine ebaõnnestus',

  auIntro1:
    'PageSpeed Insights käivitab Lighthouse’i Google’i serverites ja tagastab labori- ja väliandmed. Lighthouse’i ennast ei saa komplekti panna (Node’i rakendus; MV3 keelab kaugkoodi), seega on see realistlik tee. ',
  auIntroStrong:
    'Auditi käivitamine saadab alloleva URL-i — sealhulgas mis tahes päringustringi — Google’ile.',
  auIntro2: ' Ainult avalikud URL-id — localhost ja autentimise taga olevad lehed on kättesaamatud.',
  auApiKeyLabel: 'Google API võti (valikuline, soovitatav)',
  auApiKeyHint1: 'Salvestatud kohta ',
  auApiKeyHint2: ', ei sünkroonita kunagi. Piirangud ilma võtmeta: ~25 000/päevas, 400 iga 100 s kohta.',
  auUrlLabel: 'Auditeeritav URL (muudetav — saadetakse Google’ile)',
  auUrlHint1: 'Vaikimisi uuritav leht. ',
  auUrlHintStrong: 'Täpne aadress, mille käivitad, saadetakse Google’ile muutmata kujul',
  auUrlHint2: ' — kõik pärast ',
  auUrlHint3: ' või ',
  auUrlHint4:
    ' (seansi märgid, parooli lähtestamise lingid, otsingupäringud) läheb samuti. Muuda seda enne auditit, kui see sisaldab saladust.',
  auHasParams:
    'Sellel aadressil on päringu- või fragmendiparameetrid, mis võivad sisaldada privaatandmeid. Need saadetakse Google’ile, kui sa neid ei eemalda. ',
  auDomainPathOnly: 'Ainult domeen ja tee',
  auDevice: 'Seade',
  auMobile: 'Mobiil',
  auDesktop: 'Lauaarvuti',
  auErrHostAccess: 'Juurdepääsu hostile googleapis.com ei antud.',
  auErrPsiFailed: 'PSI päring ebaõnnestus.',
  auDisclosureAria: 'PSI avalikustus',
  auDiscTitle: 'See audit saadab URL-i Google’ile',
  auDisc2a: 'PageSpeed Insightsi käivitamiseks saadab laiendus ',
  auDisc2bStrong:
    'selle lehe täisaadressi, sealhulgas päringuparameetrid pärast „?“',
  auDisc2c: ' Google’i PageSpeed Insightsi API-le (',
  auDisc2d: '). Google laadib ja mõõdab lehe ning tagastab tulemused.',
  auDisc3a:
    '⚠️ Päringuparameetrid võivad sisaldada privaatandmeid — seansi märgid, parooli lähtestamise lingid, otsingupäringud. ',
  auDisc3bStrong: 'Vaata üle ja vajadusel muuda ülal olevat aadressi enne käivitamist.',
  auDisc3c: ' Eemalda iga parameeter nupuga „Ainult domeen ja tee“.',
  auDisc4a:
    'Saadetakse ainult siis, kui käivitad auditi selgesõnaliselt. Google’ile edastatud aadressi käsitletakse ',
  auDisc4Link: 'Google’i privaatsuspoliitika',
  auDisc4b:
    ' alusel. Täielikult kohalikud mõõdikud (Web Vitals, ressursside ajastus, täpsed baidid) ei saada midagi.',
  auAccept: 'Saan aru — saada aadress Google’ile',
  auAuditing: 'Auditeerimine…',
  auRunAudit: 'Käivita PageSpeed audit',
  auAccepted: 'PSI avalikustus vastu võetud. ',
  auRevoke: 'Tühista nõusolek',
  auScoreUnavailable: 'Jõudlusskoor pole saadaval',
  auScore: 'Jõudlusskoor',
  auLabData: 'Laboriandmed PSI kaudu, strateegia: {strategy}.',
  auFieldUrl: 'Väliandmed — see URL (CrUX, päris kasutajad, p75)',
  auFieldOrigin: 'Väliandmed — kogu päritolu (CrUX, päris kasutajad, p75)',
  auNoCrux:
    'CrUX-i väliandmeid pole: sellel lehel/päritolul pole Chrome UX Reportis piisavalt päris kasutajate valimeid. Ülal olevad laboriandmed kehtivad endiselt.',

  wfAria: 'Ressursside laadimise juga',
  wfCaptionPre:
    'Juga — iga riba on päringu alguse nihe ja kestus',
  wfFirstOf: ' (esimesed {max} / {total}-st)',
  wfCaptionPost: '. Kogu aken {ms} ms.',
  wfKinds: 'Ressursside tüübid',
  wfBarTitle: '{kind} · algus {start} ms · {dur} ms',

  lfUnsupported:
    'Long Animation Frames ja Long Tasks API on ainult Chromiumis ning see brauser ei paku kumbagi — seega kaadripõhist blokeeringut ei saa siin mõõta. Ülal olevad Core Web Vitals peegeldavad endiselt kasutajakogemust.',
  lfTotalBlocking: 'blokeeringut kokku',
  lfLongFrames: 'pikka kaadrit',
  lfLongTasks: 'pikka ülesannet',
  lfNoFrames: 'Pikki {kind} (üle 50 ms) pole veel salvestatud. Allikas: {source}.',
  lfColStart: 'Algus',
  lfColDuration: 'Kestus',
  lfColBlocking: 'Blokeering',
  lfColTopScripts: 'Peamised skriptid',
  lfNoScriptAttr: 'skriptiomistust pole',
  lfLayoutSuffix: ' (+{ms} ms paigutus)',
  lfSourceNote:
    'Allikas: {source}. Blokeering on põhilõime aeg, mis võib suhtlust edasi lükata. Skriptiomistus näitab iga kaadri pikimaid skripte.',
  lfWorstOffenders: 'Halvimad süüdlased (skripti järgi, üle kõigi kaadrite)',
  lfOffendersCaption:
    'Skriptid järjestatud koguaja järgi üle iga selle laadimise pika kaadri.',
  lfColScript: 'Skript',
  lfColFrames: 'Kaadrid',
  lfColTotal: 'Kokku',
  lfColLayout: 'Paigutus',
};

const messages: Catalog<MsgKey> = { en, ru, et };

const translate = createTranslator<MsgKey>(messages);

/** Hook: a locale-bound `t()` for React surfaces (popup + panel). */
export function useT(): TFn {
  const locale = useLocale();
  return useCallback(
    (key: MsgKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
}

/** Imperative translator for non-React callers that resolve the locale from
 *  storage (e.g. background context menus, were any added). */
export function tAt(locale: Locale, key: MsgKey, vars?: Record<string, string | number>): string {
  return translate(locale, key, vars);
}
