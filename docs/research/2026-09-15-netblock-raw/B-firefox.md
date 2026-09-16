# Отчёт B: Firefox MV3/MV2 + Android (15.09.2026)

## 1. Blocking webRequest
- Сохранён в MV3, не планируется к удалению (Mozilla 2025-02-25; 2024-05-14). Firefox 149–153 без ограничений; 153 — `documentId` в webRequest.
- Permissions: `webRequest` + host; `webRequestBlocking`; MV3 для filterResponseData — `webRequestFilterResponse` (110+). Все — OptionalPermissionNoPrompt (могут быть optional, без промпта). Warning даёт только `<all_urls>` («Access your data for all websites») и `declarativeNetRequest` («Block content on any page»).
- BlockingResponse: `cancel` — onBeforeRequest, onBeforeSendHeaders, **onHeadersReceived**, onAuthRequired; `redirectUrl` — onBeforeRequest, **onHeadersReceived**. **Блок по statusCode в onHeadersReceived подтверждён** (WebRequest.sys.mjs applyChanges; uBO так делает для header=). **Изменить статус-код нельзя**; подмена ответа: redirectUrl на data:/moz-extension (web_accessible_resources) или тело через StreamFilter (статус остаётся).
- Async: blocking-листенер может вернуть Promise (52+) — можно читать storage.session внутри. Незавершённый Promise удерживает event page.
- Ограничения: redirect только с http/https; activeTab не даёт webRequest (bug 1617479); нет `extraHeaders`; нет `initiator` (есть originUrl/documentUrl/thirdParty).
- DNR имеет приоритет над webRequest (handleRequest до applyChanges); удалённые DNR-заголовки не видны webRequest.
- StreamFilter: Firefox-only; активный фильтр держит event page.

## 2. Host permissions MV3
- 127+: host_permissions в install prompt, выдаются при установке, но отзываемы → проверять `permissions.contains`. Новые хосты при апдейте не промптятся (bug 1893232 NEW). `optional_host_permissions` — 128+. Если filter.urls не пересекается с выданными — только лог ошибки, события не приходят. `gecko.id` обязателен в MV3.

## 3. DNR в Firefox (113+)
- `declarativeNetRequest` — с промптом, НЕ может быть optional; `WithHostAccess` — без промпта, тоже не optional.
- Условия: urlFilter, regexFilter (JS RegExp, не RE2!), isUrlFilterCaseSensitive, initiatorDomains, requestDomains, resourceTypes, requestMethods, domainType, tabIds (session). **responseHeaders НЕ реализованы** (bug 1877486 NEW, 2025-03-11).
- ResourceType: + beacon, imageset, json (138+), xslt, web_manifest, speculative, xml_dtd, object_subrequest; нет webbundle/webtransport.
- Лимиты (ExtensionDNRLimits.sys.mjs): static min 30000; rulesets 100 / enabled **20**; disabled static 5000; dynamic **5000** (bug 1894119); session 5000; regex 1000. Раздельные dynamic/session с 128.
- Отладка: **нет onRuleMatchedDebug (bug 1745773 ASSIGNED), нет getMatchedRules (bug 1745765 ASSIGNED)**; testMatchOutcome/isRegexSupported только за префом `extensions.dnr.feedback`.
- Приоритет рулсетов: session > dynamic > static. Нет DOM-collapse.

## 4. Event page
- **Нет background.service_worker** (bug 1573659 meta NEW). MV3 — non-persistent `background.scripts`; указывать оба ключа (scripts + service_worker); 121+ фон стартует даже при service_worker в манифесте.
- Idle 30 с (`extensions.background.idle.timeout`, 100 мс–5 мин); события сбрасывают таймер (117.0.1, bug 1851373).
- Удерживают: DevTools, native ports, незавершённые Promise из листенеров, StreamFilter. Message-порты — нет.
- Listeners синхронно на верхнем уровне; webRequest — ExtensionAPIPersistent, blocking-листенер будит event page, запрос ждёт; при раннем старте «primed» только blocking, non-blocking пропускают запросы до старта.
- storage.session 115+, 10 МБ (enforce с 137), нет setAccessLevel. После краха event page не перезапускается до следующего события.

## 5. Android
- webRequest blocking, filterResponseData, DNR — поддерживаются. uBO: android min 115.
- `gecko_android: {}` обязателен. Только event pages.
- Host permissions: нет UI для pending grant (bug 1820867 NEW) и управления (bug 1812125 REOPENED); Extension Workshop рекомендует MV2 для Android.
- UI: popup — как пункт меню; options_ui во вкладке; НЕТ menus/contextMenus, sidebarAction, devtools, windows, commands, omnibox, storage.managed.
- data_collection_permissions на Android — 142+.

## 6. AMO 2025–2026
- data_collection_permissions обязательны для новых с 2025-11-03; для всех — 1H 2026 (анонс фактического включения не найден). Firefox 140/142. websiteContent включает «request and response information»; browsingActivity — URL/домены. Локальная обработка — не сбор. uBO: required ["none"].
- Add-on Policies (2026-04-30): минимум permissions; no remote code; **нельзя ослаблять CSP** (modifyHeaders!); обфускация запрещена; исходники при бандлинге (README, lockfiles, Ubuntu 24.04.4 / Node 24.14.0 / npm 11.9.0, ≤200 МБ); npm-скрипт `build-for-amo` рекомендован (2026-07-23).
- Официального чек-листа для перехватчиков нет; объяснять permissions в описании.

## 7. Практика
- uBO Firefox — MV2, `webRequest`+`webRequestBlocking`+`<all_urls>`; `header=` → `{cancel:true}` из onHeadersReceived (не main_frame); по статусу фильтра нет; `replace=` через filterResponseData; `method=`.
- Requestly Firefox — MV3 event page, self-hosted XPI (не AMO); `webRequest` без blocking (наблюдение), DNR session/dynamic, статус — через page-script XHR/fetch patch; «не видно в DevTools».
- AMO: Header Editor 5.2.12 (webRequest+Blocking+DNR), tweak 8.7.2 (page-level), Request Interceptor 4.0 (webRequestBlocking).

## Матрица (Firefox)
| Критерий | webRequest blocking | DNR |
|---|---|---|
| Тип, URL, домен, метод, инициатор | да | да |
| Код ответа → cancel | **да** (onHeadersReceived) | нет |
| Подмена ответа при 500 | частично (redirectUrl data:/StreamFilter тело) | нет |
| Request/response headers условие | да | нет |
| 3-й запрос / B после A / один раз | **да** (счётчик в storage.session, async-листенер) | нет |
| Per-tab | да | да (session) |
| Без host permissions | нет | частично (block) |
| Android | да | да |

## Отличия от Chrome для общего кода
1. Две стратегии: webRequest-engine (FF, все критерии) и DNR-engine (Chrome).
2. Фон: event page vs SW; оба ключа в манифесте.
3. details: нет initiator/extraHeaders; documentId с 153.
4. Async blocking — Promise в FF.
5. StreamFilter — FF only.
6. DNR: нет responseHeaders, нет feedback API, regex — JS, лимиты 5000/5000/1000/20, DNR-permission не optional.
7. Host permissions отзываемы; апдейт не промптит; activeTab ≠ webRequest; Android без UI.
8. gecko.id, gecko_android {}, data_collection_permissions.
9. Redirect только с http/https; на data: можно.
10. DNR приоритетнее webRequest.
11. storage.session 115+, 10 МБ, нет setAccessLevel.
12. Android UI: нет menus/sidebar/devtools/windows/commands.

## Источники
- https://blog.mozilla.org/en/firefox/firefox-manifest-v3-adblockers/ (2025-02-25); https://blog.mozilla.org/addons/2024/05/14/manifest-v3-updates/
- https://blog.mozilla.org/addons/2026/04/23/webextensions-api-changes-firefox-149-152/; https://blog.mozilla.org/addons/2026/07/23/firefox-153-webextensions-api-updates/
- https://searchfox.org/mozilla-central/source/toolkit/components/extensions/parent/ext-webRequest.js; …/webrequest/WebRequest.sys.mjs; …/schemas/web_request.json; …/schemas/declarative_net_request.json; …/ExtensionDNRLimits.sys.mjs; …/ExtensionDNR.sys.mjs; …/parent/ext-backgroundPage.js
- MDN: webRequest, BlockingResponse, onHeadersReceived, filterResponseData, StreamFilter, optional_permissions, host_permissions, background, Background_scripts, browser_specific_settings, declarativeNetRequest, RuleCondition, Chrome_incompatibilities
- Bugzilla: 1877486, 1745773, 1745765, 1573659, 1851373, 1893232, 1766026, 1820867, 1812125, 1617479, 1894119, 1821033, 1915688, 1889897
- https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/; …/develop/firefox-builtin-data-consent/; …/publish/add-on-policies/ (2026-04-30); …/publish/source-code-submission/; …/develop/developing-extensions-for-firefox-for-android/; …/develop/differences-between-desktop-and-android-extensions/; …/develop/request-the-right-permissions/
- https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/
- https://github.com/gorhill/uBlock/blob/master/platform/firefox/manifest.json; …/src/js/traffic.js; https://github.com/gorhill/uBlock/wiki/Static-filter-syntax
- https://interceptor-docs.requestly.com/http-rules/rule-types/modify-response-body
