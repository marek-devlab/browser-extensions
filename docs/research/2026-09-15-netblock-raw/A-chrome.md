# Отчёт A: Chrome/Chromium MV3 (состояние на 15.09.2026)

## 1. DNR
### 1.1 RuleCondition (ref 2026-09-11 + declarative_net_request.webidl main)
| Поле | С версии |
|---|---|
| urlFilter (`*`,`|`,`||`,`^`; ASCII/punycode) | 84 |
| regexFilter (RE2, ≤2 KB compiled, без lookahead/backrefs) | 84 |
| isUrlFilterCaseSensitive (default false с 118) | 84 |
| resourceTypes/excluded: main_frame, sub_frame, stylesheet, script, image, font, object, xmlhttprequest (fetch тоже), ping, csp_report, media, websocket, webtransport, webbundle, other | 84 |
| requestMethods/excluded: connect, delete, get, head, options, patch, post, put, other (requestMethods исключает не-HTTP, напр. ws) | 91 |
| initiatorDomains/excluded, requestDomains/excluded | 101 |
| topDomains/excludedTopDomains (top-level frame) | **145** |
| domainType firstParty/thirdParty | 84 |
| tabIds/excludedTabIds (TAB_ID_NONE=-1) — **только session** | 92 |
| responseHeaders/excludedResponseHeaders (HeaderInfo{header,values?,excludedValues?}; `*`,`?`, case-insens.) | **128** |
- Chrome 145: enum `RuleConditionKeys` для feature detection (WECG #638).
- BCD: responseHeaders — только Chrome 128+ (Firefox нет, Safari нет webkit.org/b/275158); tabIds — Chrome 92 / Firefox 113 / Safari нет.

### 1.2 Actions
block, redirect (url/extensionPath/transform/regexSubstitution), allow, upgradeScheme, modifyHeaders, allowAllRequests (main_frame/sub_frame). Safe: block/allow/allowAllRequests/upgradeScheme; unsafe: redirect/modifyHeaders (нужны host perms или declarativeNetRequestWithHostAccess); block — без host perms.

### 1.3 Стадии оценки и responseHeaders
1. Before request — priority; при равном allow/allowAllRequests > block > upgradeScheme > redirect. Правила с responseHeaders и modifyHeaders сюда не входят.
2. Before request headers sent — modifyHeaders request.
3. Once a response is received — правила с responseHeaders. Цитата: «A block or redirect rule with a response headers condition will still run – but cannot actually block or redirect the request. In the case of a block rule, this is handled by the page which made the request receiving a blocked response and Chrome terminating the request early.» → «полублок»: сервер запрос получил, страница ответ не получит.
- WECG #460 (2023-10 → 2024-07-30, implemented chrome). Chrome 121–127: условие игнорировалось → блокировало всё (issue 347186592) → `minimum_chrome_version: 128`.

### 1.4 По статус-коду — НЕВОЗМОЖНО
Нет поля; `request_params.cc` HasHeaderValue/MatchesHeaderConditions через HttpResponseHeaders::HasHeader/EnumerateHeader — статусная строка не заголовок, `:status` не виден. Предложений в WECG нет. Обход: только косвенно по заголовку (content-type, x-error).

### 1.5 Лимиты
MAX_NUMBER_OF_DYNAMIC_RULES 30 000 (121+); UNSAFE_DYNAMIC 5 000 (120+); SESSION 5 000 (120+); UNSAFE_SESSION 5 000; REGEX_RULES 1 000 на тип; STATIC_RULESETS 100 / ENABLED 50; GUARANTEED_MINIMUM_STATIC 30 000 + пул 300 000; DISABLED_STATIC 5 000 (WECG #972 open); GETMATCHEDRULES 20/10 мин. Изменений квот 2024–2026 нет. Session — in memory, очищаются при рестарте браузера/обновлении; dynamic — персистентны; оба переживают остановку SW. Chrome 128: правила отключённого расширения не считаются в глобальном лимите.

### 1.6 Отладка
- onRuleMatchedDebug — только unpacked + declarativeNetRequestFeedback.
- declarativeNetRequestFeedback — «ignored for extensions installed from the Chrome Web Store», warning «Read your browsing history».
- getMatchedRules(filter) — с Feedback ИЛИ с activeTab для filter.tabId; ~5 мин истории; квота 20/10 мин — единственный продакшен-способ.
- testMatchOutcome — 103+, только unpacked; 129 принимает responseHeaders; 145 — topUrl.
- Невалидные статические правила в упакованном — молча игнорируются.

### 1.7 Прочее
- DNR не действует на ответы из onfetch SW страницы; действует на fetch изнутри SW.
- DNR блокирует запросы других расширений; обход excludedTabIds:[-1] (WECG #369).
- modifyHeaders не переживает серверный редирект (WECG #694); порядок с webRequest.onBeforeSendHeaders несогласован (#1004).
- Порядок при равном action/priority не стандартизирован — задавать priority явно.

## 2. webRequest MV3 (ref 2026-09-11)
- webRequestBlocking — только policy-installed; остальное без изменений (наблюдение): onBeforeRequest (requestBody), onBeforeSendHeaders/onSendHeaders, onHeadersReceived (statusCode, responseHeaders), onResponseStarted, onBeforeRedirect, onCompleted (statusCode), onErrorOccurred (net::ERR_BLOCKED_BY_CLIENT). Последним всегда onCompleted или onErrorOccurred.
- Нужны host permissions на URL и на инициатора (72+). WebSocket — только хендшейк.
- Enterprise force-installed сохраняют blocking (Patrick Kettner, 2025-02-21). MV2: Chrome 138 последняя; 2026-08-31 удалены из CWS.

### 2.1 webRequest → session DNR
Официальный паттерн «Adapt rules based on observed requests… blocked in the future». Латентность updateSessionRules не документирована.
| Сценарий | Реализуемо | Примечание |
|---|---|---|
| 3-й запрос | частично | наблюдаемый не блокируется; параллельные проскакивают |
| B после A | частично | onCompleted(A, statusCode) → правило на B; гонка при параллельных |
| Один раз | частично | детект по onErrorOccurred ERR_BLOCKED_BY_CLIENT (не отличить своё/чужое); параллельные копии заблокируются все |
| По 500 | нет для текущего | только «после первого 500 — следующие» |

## 3. chrome.debugger (ref 2026-09-11, debugger_api.cc, browser_protocol.json)
### 3.1 Возможности
- Домены Fetch и Network. Fetch.enable({patterns:[{urlPattern,resourceType,requestStage}]}) → Fetch.requestPaused (request, resourceType, frameId; на Response — responseStatusCode/StatusText/Headers/ErrorReason). failRequest / fulfillRequest / continueRequest / continueResponse (experimental). getResponseBody — только на Response.
- Единственный механизм: блок/подмена по статусу, детерминированный порядок, матчинг по request headers/postData.
- Network.setBlockedURLs — experimental.
- 125+: flat sessions, Target.setAutoAttach для OOPIF/воркеров.
- **118+: debugger-сессия держит SW живым** (IncrementServiceWorkerKeepaliveCount).
### 3.2 Ограничения
- Инфобар глобальный (BrowserInfoBarManager::ShowGlobally), скрывается через 5 с после detach (kAutoCloseDelay); «Cancel» → onDetach canceled_by_user. Подавление: `--silent-debugger-extension-api` или policy-install (crbug 41302695).
- «Another debugger is already attached» — только если ЭТО ЖЕ расширение уже attached (FindClientHost по extension_id+agent_host); DevToolsAgentHostImpl поддерживает несколько сессий → документация («DevTools invoked → detach») расходится с кодом — **проверить эмпирически**; взаимодействие с DevTools overrides не описано.
- Нельзя chrome://, CWS, чужие расширения; enterprise runtime_blocked_hosts/DLP.
- Paused запрос висит, если SW упал → до detach.
- WebSocket-хендшейк Fetch-доменом, по-видимому, не перехватывается (в devtools_url_loader_interceptor.cc/fetch_handler.cc упоминаний нет) — не подтверждено.
- Warning: «Access the page debugger backend» + «Read and change all your data on all websites».
### 3.3 CWS и debugger
Запрета нет; примеры: Claude in Chrome, Leapwork, Voice In; open-source MV3 пример подмены статуса — HunterGan/request_override (Fetch + fallback patch fetch/XHR). Requestly debugger не использует (DNR + MAIN-world patch).

## 4. SW lifecycle
30 с idle; >5 мин операция; fetch >30 с. Продлевают: WebSocket (116), long-lived messaging (114), connectNative (105), offscreen (109), **debugger (118)**. storage.session ~10 MB (112+), local 10 MB (114+), alarms ≥30 с (120). Listeners — синхронно на верхнем уровне.

## 5. Изменения 2025–2026
- Chrome 145: topDomains, RuleConditionKeys, testMatchOutcome.topUrl (WECG #762, Privacy Badger).
- 148: browser.* namespace, structured clone messaging. 149/150/153: promise DevTools API, alarms имена, browser.publicSuffix. Квоты не менялись.
- В обсуждении (WECG, supportive, не реализовано): #964 requestHeaders condition (gorhill 2026-03), #783 skipRules (AdGuard 2025-03), #986 ResourceType text module, #972 disabled static лимит, #770 URL normalization. Статус-код — предложений нет.
- chromestatus extension API не отслеживает.

## 6. Матрица
| Критерий | DNR | webRequest+DNR | debugger |
|---|---|---|---|
| Тип ресурса | да | да | да (WS — не подтверждено) |
| URL substring/glob | да | да | да |
| URL regex | частично (RE2, лимиты) | частично | да |
| Домен/инициатор/top | да (topDomains 145) | да | да |
| Метод | да | да | да |
| Request headers | нет (#964) | частично (будущие) | да + postData |
| Response headers | частично (128+, полублок) | частично (будущие) | да |
| Статус-код | **нет** | нет (только следующие) | **да** |
| N-й запрос | нет | частично (гонки) | да |
| B после A | нет | частично | да |
| Один раз | нет | частично | да |
| Подмена тела/статуса | нет (redirect data:) | нет | да |
| Работает при спящем SW | да | правила да, логика после пробуждения | нет |
| Видно пользователю | нет | нет | инфобар |

## 7. Риски
1. Статус-код — только debugger или MAIN-world patch.
2. responseHeaders+block — полублок; min_chrome_version 128; feature-detect через RuleConditionKeys.
3. Последовательности на DNR — best effort.
4. Инфобар + canceled_by_user → обрабатывать onDetach, деградировать до DNR.
5. Документация vs код по DevTools-конфликту — тестировать.
6. Feedback/onRuleMatchedDebug — только unpacked; продакшен — getMatchedRules+activeTab или onErrorOccurred.
7. Session-правила исчезают при рестарте/обновлении; tabIds чистить при закрытии вкладки.
8. Regex-лимиты; urlFilter ASCII; невалидные правила молча игнорируются.
9. DNR не видит onfetch SW; блокирует другие расширения; modifyHeaders теряется на редиректе.
10. SW: состояние только в storage; debugger — легальный keepalive.
11. Кроссбраузерность: responseHeaders только Chromium; tabIds нет в Safari; topDomains 145+; debugger Chromium-only.

Не подтверждено: дата релиза Chrome 145; WS в Fetch; DevTools+attach одновременно; латентность updateSessionRules.

## Источники
- https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest (2026-09-11)
- https://raw.githubusercontent.com/chromium/chromium/main/extensions/common/api/declarative_net_request.webidl
- https://raw.githubusercontent.com/chromium/chromium/main/extensions/browser/api/declarative_net_request/request_params.cc
- https://developer.chrome.com/docs/extensions/reference/api/webRequest (2026-09-11)
- https://developer.chrome.com/docs/extensions/reference/api/debugger (2026-09-11)
- https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/extensions/api/debugger/debugger_api.cc
- https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json
- https://developer.chrome.com/docs/extensions/reference/permissions-list (2026-09-09)
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://developer.chrome.com/docs/extensions/whats-new (2026-07-23)
- https://developer.chrome.com/docs/extensions/develop/concepts/content-filtering (2024-05-30)
- https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline (2026-07-08)
- https://groups.google.com/a/chromium.org/g/chromium-extensions/c/v_qI4WfpIn8/m/oL5vJjOgAgAJ (2025-02-21)
- WECG #460, #762, #638, #964, #783, #694, #369, #972, #986, #1004
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest/HeaderInfo
- https://github.com/uBlockOrigin/uBOL-home/wiki/Frequently-asked-questions-(FAQ)
- https://github.com/HunterGan/request_override; https://github.com/requestly/modify-headers-manifest-v3
