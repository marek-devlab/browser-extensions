# Отчёт C: обзор инструментов (модель правил и UX)

Дата: 15.09.2026.

## 1. Сравнение
| Инструмент | Условия | Действия | Механизм MV3 | Permissions | Лицензия | Активность |
|---|---|---|---|---|---|---|
| Requestly | URL/Host/Path × Equals/Contains/Wildcard/Regex; pageDomains, method, resourceType, requestPayload (JSON key) | Cancel, Redirect, Replace, QueryParam, Headers, UA, Script, Delay, Modify Request Body, Modify Response (static/JS, status, serveWithoutRequest), Map Local/Remote | DNR dynamic+session; webRequest только наблюдение; MAIN-world patch fetch/XHR | DNR, webRequest, scripting, tabs, webNavigation, storage, unlimitedStorage, proxy, browsingData, contextMenus, sidePanel + `<all_urls>` | AGPLv3 (кроме ee/) | v26.7.27 (2026-07-27), 300k |
| Tweak | substring/regex URL; method; partial payload | Mock (status, body, headers, delay, streaming delay, JS hook paid); Modify (paid); Headers-only (DNR, scope tab/global) | page-level fetch/XHR по play/pause на вкладке; headers — DNR | tabs + all sites | закрытый; free ≤12 правил | 9.0.0 (2026-09-03), 80k |
| Netify | URL wildcard, resourceTypes[], methods[] | Breakpoint, Mutation (endpoint/method/headers/body; response delay/statusCode/headers/body), LocalResponse, Failure (14 CDP errorReason), Script (sandbox) | chrome.debugger → Fetch.enable с паттернами и requestStage; first-match | debugger, tabs, contextMenus, storage (БЕЗ host_permissions) | BSD-2 | 0.6.0 (2025-11-22) |
| ModHeader | URL regex incl/excl, resourceType, tab/group/window/domain | headers, cookie, CSP, redirect, dynamic values, профили | DNR | all data | закрытый | **удалён из Edge 2026-07-03 и CWS 2026-07-10** — скрытый SDK телеметрии в 7.0.18 |
| Resource Override / open-resource-override-mv3 | wildcard/regex + exclusions, resourceTypes, priority | URL→URL/file, inject JS/CSS, headers; MV3-форк: «Immediate mock» (DNR redirect на data:, 307) и «After response» (fetch/XHR) | DNR + MAIN-world | — | MIT | форк 2025-08-26 |
| Mokku | path-to-regexp URL (`:id`), method, GraphQL | JSON body/status/delay/headers, JS-функция; проекты; import/export | DevTools panel + inject только на localhost по умолчанию | — | закрыт (исходники убраны) | 2.4.1 (2025-12-29) |
| ajax-tools | regex URL + method; DNR: initiatorDomains, resourceTypes | подмена ответа (JSON/JS с originalResponse), URL/headers/body; группы | XHR/fetch override + DNR; DevTools панель | — | MIT | 2026-08-26 |
| Header Editor | all/regex/prefix/domain/url + exclude | cancel, redirect, headers, custom function (FF) | Chrome DNR «lite»; Firefox webRequest «full» | — | GPL-2.0+ | 2026-09-07 |
| Request Control (FF) | scheme/host/path, incl/excl, types | filter, redirect, secure, block, whitelist | webRequest.onBeforeRequest | — | MPL-2.0 | 2024–2025 |
| uBO Lite | ABP-синтаксис → static DNR | block/allow/redirect/modifyHeaders | полностью декларативный; per-site режимы; Developer mode → custom DNR | без broad при установке | GPL-3.0 | 2026-09-14 |
| AdGuard MV3 | $domain,$to,$method,$header(limited),$third-party,$important,@@,$badfilter,$denyallow | block,$removeheader,$removeparam,$csp,$permissions; НЕ $redirect/$replace | DNR через tsurlfilter; dynamic ≤5000, regex ≤1000 | — | GPL-3.0 | 2026-09 |
| Chrome DevTools «Request conditions» (Chrome 145, doc 2026-01-07) | URLPattern + `*` | Block, Throttle (профили, packet loss), Override content/headers (`.headers`, applyTo) | first-match, реордер; **выключается при закрытии DevTools**; статус переопределить нельзя | — | — | — |
| Firefox DevTools | substring block; `:block/:unblock` | Block (с 2024 блокирует запрос), throttling, Network Override (FF 137, файл, без статуса/headers/delay, не персистентен) | — | — | — | 2025-03-31 |
| Charles / Proxyman / mitmproxy | Location/wildcard/regex; mitmproxy flow-filter `~c 500 ~s ~q ~u ~m ~h ~b` | Rewrite/Breakpoint/Map Local/Block; Proxyman scripting onRequest/onResponse + **SharedState**; mitmproxy block_list `/filter/status` (444 = drop) | desktop proxy | — | — | — |

## 2. Детали
- Requestly types: Redirect, Cancel, Replace, Headers, UserAgent, Script, QueryParam, Response, Request, Delay. `UrlSource{key,operator,value,filters[]}`, `RuleSourceFilter{pageDomains,requestMethod,resourceType,requestPayload{key,operator,value}}`. Wildcard → $1..$n. Response rule `{statusCode?, type static|code, value}` + serveWithoutRequest; code-mode получает method,url,requestHeaders,requestData,responseType,response,responseJSON — **статус оригинала не передаётся** (пробел). Delay: cap 5000/10000 мс; для не-AJAX — DNR redirect на `https://app.requestly.io/delay/<ms>/<url>` (утечка URL вендору). Группы, pin, «Test This Rule» с session recording, импорт из Charles/ModHeader/HeaderEditor/RO/HAR. Известно: модификации Response не видны в DevTools.
- Netify: `Rule{id,label,active,filter{url,resourceTypes,methods},action}`; `FetchRuleStore.getRequestPatterns()` → Fetch.enable только нужные стадии; `selectRules` — первое активное; Response-скрипт получает statusCode/headers/body; лог `NetworkLogEntry{requestId,resourceType,method,url,responseStatusCode,responseError,modification{ruleId,type,stage}}`; скрипты в sandbox.html.
- uBOL: per-site режимы Basic (без host perms) / Optimal / Complete; недоступно в MV3: dynamic filtering, фильтрация по заголовкам ответа, большинство regex, CNAME.
- AdGuard MV3: `$important` > `@@` > basic; при переполнении Allowlist → User rules → Custom; лог «предположительно сработавшее» (точный — только unpacked).

## 3. Матрица возможностей по механизмам
| Возможность | DNR | webRequest (obs) | Page patch | debugger Fetch |
|---|---|---|---|---|
| Block/redirect/headers | да, все типы | нет | только fetch/XHR | да |
| Метод/resourceType/initiator/tab | да (tabIds — session) | да | метод/URL | да |
| По response headers | да Chrome 128+ | видно, не блокирует | да | да |
| По статусу ответа | нет | видно, реакция на следующий | да | да |
| Mock body/status | redirect на data: (всегда 200) | нет | да | да |
| Fail с типом ошибки | нет (ERR_BLOCKED_BY_CLIENT) | нет | TypeError, тип не выбрать | 14 причин |
| Delay | нет | нет | да | да |
| Throttle | нет | нет | приблизительно | Network.emulateNetworkConditions (вкладка) |
| Breakpoint | нет | нет | можно | да |
| Счётчики | нет (session rules из SW → гонка) | счётчик в SW | точно | точно |
| DevTools Network | корректно | — | расходится | корректно |
| Лимиты | dynamic 30k safe/5k unsafe, session 5k, regex 1k, RE2, правило ≤2 КБ | — | — | — |
- UX-API: `declarativeNetRequest.setExtensionActionOptions({displayActionCountAsBadgeText})` — бейдж без доп. permissions; `testMatchOutcome` (103+) и `onRuleMatchedDebug` — только unpacked → для «Test URL» нужен собственный JS-матчер (Requestly `ruleMatcher.ts`, Netify `transformUrlPatterToRegexp`).

## 4. Сложные критерии
- По статусу: Netify (Fetch Response stage), Requestly code-mode (статус не в аргументах), ajax-tools (originalResponse), ORO-mv3 «After response»; DNR 128+ — заголовки, не статус; реактивный DNR-паттерн (Requestly handleCSPError.ts): onErrorOccurred/onHeadersReceived → updateSessionRules с tabIds — семантика «после X — последующие», задержка в один запрос.
- Последовательности/счётчики: **готовых нет ни в одном расширении**. Prior art: MSW `{once:true}`; Playwright `page.route(url, handler, {times:N})`, `route.fetch()+fulfill`, `route.abort(errorCode)`; Dev Proxy `nth`; MockServer chaos (errorProbability, succeedFirst, failRequestCount, outageAfterMillis, outageDurationMillis, seed, latency, retryAfter); WireMock scenarios (state machine); Proxyman SharedState.

## 5. UX-паттерны
1. Группы/профили, toggle на правило и группу, pin, bulk, порядок = приоритет (drag/стрелки).
2. «Создать правило из запроса» (контекстное меню в логе/DevTools), импорт cURL.
3. Индикация: бейдж-счётчик, счётчик у правила с tooltip времени, лог с полем modification{ruleId,stage}, состояние иконки.
4. Честное предупреждение о расхождении с DevTools при page-level.
5. Тест правила: «Test this rule», «URL tester».
6. Scope: Active tab / Global / tab group; per-site режим.
7. Least-privilege: инъекция только на localhost/по включению, optional host permissions, ноль телеметрии.

## 6. Рекомендуемая модель правила (набросок)
```jsonc
{
  "id": "r_8f1c", "name": "…", "enabled": true, "group": "checkout-chaos",
  "priority": 100, "stopProcessing": true,
  "scope": { "tabs": "active"|"all"|[123], "pageDomains": [], "excludePageDomains": [] },
  "match": {
    "url": { "key": "url"|"host"|"path", "op": "contains"|"equals"|"wildcard"|"regex"|"urlpattern", "value": "…" },
    "urlExclude": [], "methods": ["POST"], "resourceTypes": ["xmlhttprequest"],
    "requestHeaders": [{ "name","op","value" }], "requestBody": { "path","op","value" },
    "response": { "status": { "op": "in", "value": ["5xx", 429] }, "headers": [], "body": {} }
  },
  "state": {
    "key": "rule"|"url"|"tab"|"rule+tab", "resetOn": "navigation"|"session"|"manual",
    "once": false, "times": 3, "nth": { "n": 3, "every": false },
    "skipFirst": 5, "thenFail": 10, "probability": { "p": 0.3, "seed": 42 },
    "window": { "afterMs": 5000, "forMs": 10000 },
    "scenario": { "name", "requires", "sets" }, "afterRule": "r_login_ok"
  },
  "action": { "type": "block"|"fail"|"redirect"|"headers"|"mock"|"modifyResponse"|"delay"|"throttle"|"breakpoint"|"script", … },
  "engine": "auto"|"dnr"|"page"|"debugger"
}
```
engine=auto: block/redirect/headers без response/state → DNR; response.headers без статуса → DNR ≥128; response.status/body, mock, delay, state → page (xhr/fetch) или debugger (не-AJAX, fail.reason, throttle, breakpoint).

## 7. Что НЕ копировать
- Скрытая телеметрия/закрытый код (ModHeader).
- Delay через сервер вендора (Requestly).
- Молчаливое расхождение DevTools ↔ приложение.
- Статический список без runtime-редактирования (uBOL).
- Текстовый синтаксис фильтров как основной UI (AdGuard/uBO) — только импорт.
- Только debugger как единственный engine (Netify).
- Content script на всех страницах в document_start всегда (Requestly).
- Зависимость от открытого DevTools (Chrome Request conditions).
- `new Function` для пользовательских скриптов в контексте расширения (ajax-tools).
- Лимит правил во free-плане, привязка к веб-аккаунту.
- Отсутствие статуса оригинала в JS-хуке (Tweak, Requestly).

## 8. Источники
- https://github.com/requestly/interceptor (`browser-extension/mv3/claude.md`, `common/src/types.ts`, `page-scripts/ajaxRequestInterceptor/fetch.js`, `service-worker/services/requestProcessor/handleCSPError.ts`, `resources/static-rules/delayRules.json`); https://interceptor-docs.requestly.com/http-rules/rule-types
- https://tweak-extension.com/docs/intro, /docs/rule/mock-vs-modify, /docs/rule/modify-headers, /docs/rule/javascript-snippet
- https://github.com/vladlavrik/netify (`src/interfaces/rule.ts`, `src/services/devtools/fetch/FetchDevtools.ts`, `FetchRuleStore.ts`)
- https://www.scworld.com/brief/malicious-modheader-extension-pulled-from-chrome-and-edge-stores; https://github.com/alinemone/modheader
- https://github.com/kylepaulsen/ResourceOverride/tree/mv3; https://github.com/attroaso/open-resource-override-mv3
- https://github.com/mukuljainx/Mokku; https://github.com/PengChen96/ajax-tools; https://github.com/FirefoxBar/HeaderEditor; https://github.com/tumpio/requestcontrol
- https://github.com/uBlockOrigin/uBOL-home/wiki/Frequently-asked-questions-(FAQ); https://adguard.com/kb/adguard-browser-extension/mv3-version/; https://github.com/AdguardTeam/tsurlfilter
- https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
- https://developer.chrome.com/docs/devtools/request-conditions (2026-01-07); https://developer.chrome.com/blog/throttle-individual-network-requests; https://developer.chrome.com/docs/devtools/overrides
- https://fxdx.dev/network-override-in-firefox-devtools/ (2025-03-31); https://bugzilla.mozilla.org/show_bug.cgi?id=1756770
- https://www.charlesproxy.com/documentation/tools/rewrite/; https://docs.proxyman.com/scripting/script; mitmproxy `docs/src/content/concepts/filters.md`
- https://mswjs.io/docs/api/http/; https://playwright.dev/docs/api/class-page#page-route; https://learn.microsoft.com/en-us/microsoft-cloud/dev/dev-proxy/how-to/mock-nth-request (2026-09-14); https://www.mock-server.com/mock_server/chaos_testing.html; https://wiremock.org/docs/stateful-behaviour/
