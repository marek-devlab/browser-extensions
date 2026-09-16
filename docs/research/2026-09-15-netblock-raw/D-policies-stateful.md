# Отчёт D: политики сторов и архитектура stateful-правил (MV3)

Дата исследования: 15.09.2026.

## A. Политики сторов

### A.1 Chrome Web Store
- Single purpose (policies 2025-05-22; Quality Guidelines FAQ 2025-01): «narrow focus area» допускает несколько функций внутри темы. Наш кейс — «network request testing/mocking» — narrow focus area. Лог запросов/счётчики/UI правил допустимы; несвязанные фичи — нет.
- Блог 2025-01-22: одна апелляция на нарушение. Блог 2026-07-01 (enforcement 2026-08-01): Limited Use «strictly necessary», prominent disclosure любого сбора данных.
- Violation IDs (troubleshooting): Purple Potassium (лишние permissions), Yellow Magnesium (не работает/не соответствует), Blue Argon (remote code), Red Titanium (обфускация), Purple Lithium/Magnesium (privacy policy / browsing activity), Yellow Zinc (метаданные), Red Argon/Copper/Lithium/Magnesium (single purpose).
- Permissions (ref 2026-09-11): `declarativeNetRequest` даёт block/allow/allowAllRequests БЕЗ host permissions; `declarativeNetRequestWithHostAccess` — без warning, но только на хостах с host permission; `declarativeNetRequestFeedback` — только для unpacked (onRuleMatchedDebug) → в сторе лишний → Purple Potassium. `webRequestBlocking` в MV3 только policy-installed.
- `debugger`: документированное исключение из remote-code запрета. Реальные CWS-расширения с `debugger` (CRX проверены 2026-09-15): Network Overrides API (DevTools) v2.3.0 — `["storage","debugger"]` + `<all_urls>`, Fetch.enable Request+Response, fulfillRequest/failRequest; Claude in Chrome; BrowserStack Toolkit. Requestly v26.7.27 и tweak v9.1.0 НЕ используют debugger — MAIN-world патч fetch/XHR + DNR.
  - Requestly permissions: browsingData, contextMenus, declarativeNetRequest, proxy, scripting, sidePanel, storage, tabs, unlimitedStorage, webNavigation, webRequest + `<all_urls>`.
  - tweak: storage, unlimitedStorage, scripting, declarativeNetRequestWithHostAccess + http(s)://*/*.
  - Resource Override MV3: declarativeNetRequest, scripting, storage, tabs + `<all_urls>`.
- Remote code: regex/DSL/счётчики — данные, ок. Пользовательский JS — только через `chrome.userScripts` (Chrome 138+: пер-расширенный тумблер «Allow User Scripts», по умолчанию выключен для новых установок); eval запрещён CSP; sandbox-страницы без доступа к сети страницы.

### A.2 Firefox AMO
- `data_collection_permissions` обязательны для новых с 2025-11-03 (`"required":["none"]` если ничего), для всех — 1H 2026. Firefox ≥140/142.
- Add-on Policies (2026-04-30): no remote code; минимум permissions; **`userScripts` — только для user script managers** → пользовательский JS в Firefox-сборке недопустим; минификация ок, обфускация нет; исходники при бандлинге (Ubuntu 24.04 / Node 24.14 / npm 11.9).
- Blocking webRequest сохранён в MV3 (2024-03-13); Firefox 127 — host permissions в install prompt, 128 — `optional_host_permissions`. Обоснование `<all_urls>` — в Notes to reviewers.

### A.3 Edge Add-ons (2026-07-24)
- Single purpose, минимум permissions; DNR-правила должны быть «declared within the extension», не импортироваться с сервера без нужды; Notes for certification — шаги теста + демо-страница; апелляции ~3 дня.

## B. Stateful-правила в MV3

### B.1 webRequest (non-blocking) + updateSessionRules
- Session rules — в памяти, переиндексация при каждом update, ≤5000, `tabIds` только для session; `responseHeaders` условие с Chrome 128 (121–127 игнорировалось, crbug 347186592) — только заголовки, НЕ статус-код.
- Задержка: событие → IPC → (холодный старт SW) → updateSessionRules → переиндексация. Порядок относительно следующего запроса не гарантирован. Известная гонка при старте: dynamic rules не применяются к первому запросу после холодного старта (crbug 349653211).
- Requestly так делает (session rule с tabIds по событию page-script). Надёжно для «широких окон» (после N-го → все последующие; 30 с после клика; после 500 в /a → /b в следующих попытках). Ненадёжно для «ровно 3-й» и «B сразу после A».
- Приём: держать блокирующее правило и управлять allow-исключениями — ошибка в сторону блокировки.

### B.2 MAIN-world интерцептор
- `scripting.registerContentScripts({world:'MAIN', runAt:'document_start', allFrames:true})`. CSP страницы применяется (нельзя eval). Так работают Requestly (XHR.prototype patch) и tweak (fetch/XHR, подмена Response со status, delay).
- Покрытие: fetch/XHR (+WebSocket, EventSource, sendBeacon только «сломать»). НЕ ловит: навигации, img/script/link/css/fonts/video, Web/Service Worker запросы, prefetch, iframe-документы, запросы до инъекции.
- Обнаружим сайтом (fetch.toString). Для dev/QA приемлемо.
- Плюс: счётчики/последовательности синхронно в странице — ноль гонок.

### B.3 chrome.debugger + Fetch domain
- Полный контроль: Request+Response stage, `responseStatusCode`, failRequest/fulfillRequest/continueRequest; воркеры через `Target.setAutoAttach`.
- Издержки: инфобар во всех окнах (с 2023-10-09 закрывается только после detach всех таргетов + 5 с; скрыть — только `--silent-debugger-extension-api` или force-install; crbug 40815062 открыт); DevTools на вкладке → detach `canceled_by_user`, нужен re-attach; `Fetch.requestPaused` не приходит для Document при первом attach (crbug 40811878); overhead — CDP attach снижает throughput fetch-аплоадов в 17–21× (замер 2026-09-12); enterprise-политики блокируют attach.
- Практика: attach только на выбранную вкладку по кнопке, узкие паттерны, объяснение баннера в UI.

### B.4 Состояние при рестарте SW
- SW: 30 с простоя, 5 мин на событие; alarms ≥30 с (Chrome 120+). `storage.session` 10 MB (Chrome 112+), переживает рестарт SW, не рестарт браузера; нет атомарного инкремента.
- Паттерны: in-memory Map + write-through в storage.session; init до первого события (listeners синхронно на верхнем уровне); мутации через промис-очередь или `navigator.locks`; детерминированные rule id + сверка `getSessionRules()`; таймеры через alarms/expiresAt, короткие точные окна — в content script.

### B.5 Рекомендация: три уровня, один формат правила
1. DNR session rules с tabIds — stateless + широкие окна; без host permissions.
2. MAIN-world интерцептор — точные последовательности/счётчики для XHR/fetch, клиентская подмена статуса/тела/задержки; optional_host_permissions + «Enable on this site».
3. debugger+Fetch — opt-in «Network-level mode» на вкладку: реальный статус, навигации, статика, воркеры.
Пользовательский JS — только userScripts в Chrome, в Firefox отключить.

### Матрица критерий → механизм
| Критерий | Механизм | Ограничения |
|---|---|---|
| URL/regex, метод, тип, домен | DNR session/dynamic | RE2, ≤1000 regex, ≤5000 session |
| Заголовки ответа | DNR responseHeaders (Chrome 128+) | не статус |
| 3-й запрос (XHR/fetch) | MAIN-world счётчик | не img/script/worker |
| 3-й запрос (навигация/статика) | debugger Fetch | баннер, DevTools-конфликт |
| B после успешного A | MAIN-world флаг; fallback onCompleted→session rule | fallback гонка |
| Один раз | MAIN-world; или DNR block + снять после onErrorOccurred | «минимум один раз» |
| 30 с после клика | content script → session rule + expiresAt/alarms | ок |
| Если предыдущий ответ 500 | onHeadersReceived.statusCode → session rule (со следующего); точно — Fetch/MAIN-world | DNR не матчит статус |
| Подмена статуса на клиенте | MAIN-world new Response | виден реальный ответ в Network |
| Реальный статус на сети | Fetch.fulfillRequest/failRequest | только debugger |
| Пользовательский JS | userScripts (Chrome 138+) | Firefox — нельзя |

Артефакты: CRX-пакеты в `C:\Users\HProfits\AppData\Local\Temp\crx\`.

## Ключевые ссылки
- https://developer.chrome.com/docs/webstore/program-policies/policies (2025-05-22)
- https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq
- https://developer.chrome.com/blog/cws-policy-updates-2025 (2025-01-22), /cws-policy-updates-2026 (2026-07-01)
- https://developer.chrome.com/docs/webstore/troubleshooting
- https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest (2026-09-11)
- https://developer.chrome.com/docs/extensions/reference/api/debugger (2026-09-11)
- https://developer.chrome.com/blog/chrome-userscript (2025-05-29)
- https://chromewebstore.google.com/detail/network-overrides-api-dev/holdjgmcnpelgclhopiejilhhkfcmpba
- https://chromewebstore.google.com/detail/requestly-intercept-modif/mdnleldcmiljblolnjhpnblkcekpdkpa
- https://chromewebstore.google.com/detail/tweak-mock-and-modify-htt/feahianecghpnipmhphmfgmpdodhcapi
- https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/
- https://extensionworkshop.com/documentation/publish/add-on-policies/ (2026-04-30)
- https://blog.mozilla.org/addons/2024/03/13/manifest-v3-manifest-v2-march-2024-update/
- https://blog.mozilla.org/addons/2024/05/14/manifest-v3-updates/
- https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies (2026-07-24)
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/extensions/browser/api/declarative_net_request/README.md
- https://groups.google.com/a/chromium.org/g/chromium-extensions/c/_4T8sxCStkU (crbug 349653211)
- https://github.com/w3c/webextensions/issues/783, /694
- https://chromedevtools.github.io/devtools-protocol/tot/Fetch/
- https://issues.chromium.org/issues/40815062, /40811878, /40141220
- https://daily.dev/posts/the-bug-was-in-my-benchmark-attaching-a-debugger-to-chromium-throttles-fetch-uploads-20x-igiwe4bwc (2026-09-12)
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://developer.chrome.com/docs/extensions/reference/api/storage (2026-09-11)
