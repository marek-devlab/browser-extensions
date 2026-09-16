# netblock — фаза 2, движок `debugger` (Chrome, CDP `Fetch` — «Network-level mode», NL): план

> 2026-09-15. Контракт — [`01-foundation.md`](01-foundation.md) §3; спека — [`docs/design/netblock.md`](../../design/netblock.md) §0, §2.3, §2.7, §4.3, §5.5, §6 (4, 5), §7.2, §8, §10.1, §11; Research §2.3; спайки S1/S1c/S4/S6 — [`e2e/netblock-spikes/REPORT.md`](../../../e2e/netblock-spikes/REPORT.md). Файлы: `utils/debugger-eval.ts` (чистое), `utils/engines/debugger.ts` (склейка), hook-строки в `background.ts`, `wxt.config.ts`, `scripts/check-guards.mjs`.

## 0. Проверенные источники (2024+)

| Факт | Источник | Дата |
|---|---|---|
| `Fetch.enable({patterns?, handleAuthRequests?})`: «If not set, all requests will be affected»; `RequestPattern.urlPattern` — «Wildcards (`*` → zero or more, `?` → exactly one) are allowed. Escape character is backslash. Omitting is equivalent to `"*"`»; `resourceType` — «only requests for matching resource types»; `requestStage` — «Default is Request» | `browser_protocol.json` (tot, `chromedevtools.github.io/devtools-protocol/tot/Fetch`) | 2026-09-15 |
| `Fetch.requestPaused {requestId, request, frameId, resourceType, responseErrorReason?, responseStatusCode?, responseStatusText?, responseHeaders?, networkId?, redirectedRequestId?}`: «the request is at the response stage if either of these fields [responseErrorReason/responseStatusCode] is present and in the request stage otherwise»; редиректы приходят как обычные ответы (3xx + `location`) | там же | — |
| `failRequest {requestId, errorReason: Network.ErrorReason}`; `fulfillRequest {requestId, responseCode, responseHeaders?: HeaderEntry[], body?: base64, responsePhrase?}` — «If absent [body] … empty body will be used if … request stage»; `continueRequest {requestId, …}` — стабильный, `continueResponse` — **experimental** (используем только `continueRequest` на обеих стадиях); `getResponseBody` — не вызываем (§7.2) | там же | — |
| `Network.ErrorReason` (14): `Failed, Aborted, TimedOut, AccessDenied, ConnectionClosed, ConnectionReset, ConnectionRefused, ConnectionAborted, ConnectionFailed, NameNotResolved, InternetDisconnected, AddressUnreachable, BlockedByClient, BlockedByResponse`; наш `FAILURE_REASONS` — подмножество, передаётся дословно | там же | — |
| `chrome.debugger`: promise-API (`attach/detach/sendCommand/getTargets`, Chrome 96+); `onDetach` reasons `target_closed` / `canceled_by_user`; нельзя attach к `chrome://`, Chrome Web Store, другим расширениям; enterprise `ExtensionSettings`/DLP блокируют attach; манифест: `"permissions": ["debugger"]` | https://developer.chrome.com/docs/extensions/reference/api/debugger | 2026-09-11 |
| `debugger` — в списке «cannot be specified as optional» (вместе с `declarativeNetRequest`); `permissions.request`: «must either be defined in `optional_permissions` … or be required permissions that were withheld by the user» | https://developer.chrome.com/docs/extensions/reference/api/permissions | 2026-09-11 |
| Предупреждения `debugger` при установке: «Access the page debugger backend» **и** «Read and change all your data on all websites» (`kFlagImpliesFullURLAccess`) | https://developer.chrome.com/docs/extensions/reference/permissions-list | 2026-09-09 |
| CWS Purple Potassium: «Request access to the narrowest permissions necessary … If more than one permission could be used to implement a feature, you must request those with the least access» → обоснование в поле Permission justification: ни один другой API не даёт реальный код ответа/тип сетевой ошибки для всех типов ресурсов | https://developer.chrome.com/docs/webstore/troubleshooting | 2026-07-20 |
| Playwright — сам CDP-клиент, но `chrome.debugger.attach` из расширения работает (S1/S6); DevTools не детачит (S1/S1c); `Fetch` **не видит WebSocket** (S4); `attachCdp` живьём: `onDetach('target_closed')`, идемпотентный `detach()` (S6) | `e2e/netblock-spikes/REPORT.md` | 2026-09-15 |

## 1. Решения

1. **`debugger` — в baseline `permissions` Chrome-манифеста** (решение владельца; заменяет отклонение №1 фазы 1). Firefox — без изменений. Guard: `BASELINE_DEBUGGER_ALLOWED.netblock` с причиной. Спека §11 («постоянно включённый NL на всех вкладках») соблюдена: **ничего не attach'ится без явного включения на вкладке** из popup (диалог §2.7); detach при выключении, закрытии вкладки, ошибках, `dispose()`.
2. **`available = !!chrome.debugger`** — API существует ⇔ разрешение есть (синхронно, без `permissions.contains`); `caps.debugger = apis.debugger` → таблица `engine-select` даёт `debugger` для non-xhr + fail/delay/status, `fail(reason)` на xhr, «код ответа» на non-xhr, `document`. Деградация для сборок без разрешения (`nlUnavailableBuild`, `failReasonImitated`) сохранена.
3. **Модуль движка чистый**: ни `#imports`, ни `globalThis.chrome`, ни строки `.debugger.` — API (`DebuggerApi` из `@blur/netcore`, `tabs`), state-store, `nlTabs`, prefs и `isPaused` инжектятся через `configure(deps)` из background под `if (!import.meta.env.FIREFOX)` → Firefox-бандл без ссылок на `.debugger.`; Node-тесты — с фейковым CDP.
4. **Сессия = `attachCdp`** (`@blur/netcore`): per-tab роутинг событий, `onDetach(reason)`, идемпотентный `detach()`, текст ошибки браузера дословно (`{ok:false, error}` → toast §5.5). Версия протокола `1.3`.
5. **Состояние** — `StateCache` из `webrequest-state.ts` (base + overlay, 200 мс холодное чтение, write-through через `updateState` под Web Lock): тот же путь, что page/webrequest; background остаётся источником истины, сбросы приходят через `stateItem.watch`.

## 2. Жизненный цикл

- `enableTab(tabId)`: уже attached → `{ok:true}`; `attachCdp` → ошибка дословно; `Page.getFrameTree` → host вкладки (для `pageDomains`; `tabs.get().url` без host-доступа пуст — проверено live) + `Page.enable` → `Page.frameNavigated` (main frame) держит host актуальным; `Fetch.enable(patterns)` (или `Fetch.disable`, если правил нет — пустой `patterns` **нельзя**: «If not set, all requests will be affected»); `nlTabs += tabId`. Ошибка после attach → detach в `catch`.
- ⚠️ `debugger.getTargets().attached` — «attached кем угодно» (под Playwright всегда `true`, DevTools тоже): для reconcile и для тестов не годится; истина — наша `Map` сессий, а live-доказательство detach — `sendCommand` бросает «Debugger is not attached».
- `disableTab(tabId)`: отпустить все pending (`continueRequest`), `Fetch.disable` (best effort), `detach()`, `nlTabs -= tabId`. Без события `detached` (это пользователь).
- `onDetach(reason)` от браузера (`canceled_by_user`, `target_closed`, политика): отпустить pending (команды уже невалидны — глушим), удалить сессию, событие `detached {tabId, reason}` → background чистит `nlTabs`, push `nl:detached` (toast).
- `apply(set)`: слайс `byEngine.debugger` → паттерны; для каждой attached-вкладки `Fetch.enable` с новыми паттернами (повторный `enable` заменяет набор), ключ-кэш на вкладку → идемпотентно.
- `tabs.onRemoved` → background вызывает `disableTab` (плюс `onDetach('target_closed')` — идемпотентно). `dispose()` → detach всех в `finally`.
- **Startup reconcile** (первый `apply` после рестарта SW): id из `session:nlTabs`, не имеющие сессии в памяти, — «сироты» (сессия умерла вместе с воркером; `getTargets().attached` не отличает наш attach от чужого). `nlSticky=false` → удалить из `nlTabs`; `nlSticky=true` → `enableTab` заново. Плюс `tabs.onUpdated(loading)` при `nlSticky`: вкладка в `nlTabs`, не attached, последний detach не `canceled_by_user` → re-attach.
- Обработчик `Fetch.requestPaused` держит SW живым (Research §2.3, Chrome 118+) — зеркало счётчиков тёплое всю сессию.

## 3. Паттерны `Fetch.enable` из правил (`fetchPatternsFor`)

- Одно правило → `stage` (`Response`, если есть `responseStatus`/`responseHeaders`, иначе `Request`) × набор CDP-типов (`toCdpTypes(resourceTypes)`, пусто → без `resourceType`) × `urlPattern`.
- `urlPattern` — только **предфильтр**; решение всегда принимает JS-матчер (`matchesUrlCondition`, тот же, что у page/webrequest). `base::MatchPattern` в CDP регистрозависим, а наш `contains/equals/wildcard` по умолчанию регистро**не**зависим → сужаем только при `caseSensitive: true` или когда в значении нет ASCII-букв: `contains` → `*<esc>*`, `equals` → `<esc>`, `wildcard` → `<esc \>` (наш `*`/`?` совпадают с CDP), `regex`/без URL → `*`. `esc` экранирует `\`, `*`, `?` бэкслэшем.
- Дедупликация по `(urlPattern, resourceType, stage)`. WebSocket сюда не попадает (`engine-select` отказывает, S4).
- ⚠️ **Фильтр `Fetch.enable` принимает не все `Network.ResourceType`** (замер live, Chromium 149 под Playwright, 2026-09-15): ok — `Document, Stylesheet, Image, Media, Font, Script, XHR, Fetch, EventSource, Ping, CSPViolationReport, Other`; отказ «Unknown resource type in fetch filter» — `TextTrack, Prefetch, WebSocket, Manifest, SignedExchange, Preflight, FedCM`. `FETCH_FILTER_TYPES` в `debugger-eval.ts` отсекает их при выводе паттернов; правило только на такие типы паттерна не получает. Если бы `Preflight` и приходил, он пропускался бы: подмена/отказ OPTIONS даёт странице CORS-`TypeError` вместо заданного статуса.

## 4. Конвейер решения (`evaluatePaused`, чистое)

1. Стадия события по `responseStatusCode`/`responseErrorReason`. Вкладка на паузе → `continue`, без строки лога.
2. Правила слайса в порядке приоритета, только своей стадии; условия: url (JS), метод, тип (`fromCdpType`), `pageDomains` (host вкладки, суффиксно), `scope: 'activeTab'` (активная вкладка окна: `tabs.query({active:true})` + `tabs.onActivated`), на Response — `statusMatches(responseStatusCode)` и заголовки `exists/equals/contains` (case-insensitive).
3. Матч → `decide()`; не применилось → прозрачно (счётчик, следующее правило); применилось → действие. Дельты → `StateCache.commit` (write-through).
4. Действие → CDP (`commandFor`): `block` → `failRequest(BlockedByClient)`; `fail(r)` → `failRequest(r)`; `delay ms` → abort-aware sleep → `continueRequest` (detach/`disableTab`/`dispose` отпускают сразу); `status` → `fulfillRequest {responseCode, responseHeaders: Content-Type (default `text/plain; charset=utf-8`), X-Content-Type-Options: nosniff, Cache-Control: no-store, + Access-Control-Allow-Origin = заголовок `Origin` запроса (иначе кросс-ориджин страница увидит CORS-ошибку, а не наш код), body base64 (UTF-8)}`. На Response-стадии те же команды — реальный ответ отбрасывается (реальные `responseStatusCode`/заголовки видны в решении и в логе).
5. `try/finally`: если к концу обработчика запрос не отпущен (исключение, ошибка команды) → `continueRequest`; ошибка → `error`-событие; счётчик ошибок подряд на вкладку: успех → 0, **3 подряд → detach + `detached {reason:'handler errors (3 in a row)'}`**.
6. `fulfillRequest`/`failRequest` отклонён браузером (например, 1xx) → `continueRequest` (fail-open) + `error`.

## 5. Счётчики, лог, наблюдаемость

- `hit {approx:false}` на каждое применение; `matched` — через `decide()`/`updateState` (как page/webrequest). Popup «Перехвачено / применено» — `stats(tabId)` в памяти → `TabSummary.nl {attached, lastDetachReason?, intercepted, applied}`.
- Строка лога на **каждый** перехваченный запрос (`engine:'debugger'`, тип из `fromCdpType`, без `clientSide`-метки — это сеть): применённое действие → `blocked`/`failed(error: reason)`/`status`/`delayed(+delayMs)`; пропущено → `passed` (на Response — с реальным `status` и маскированными заголовками, только если правило смотрело на заголовки). Чтобы не дублировать строки на Request+Response, `passed` на Request пишется только если ни один Response-паттерн (наш же список) не поймает этот запрос (`willSeeResponse`); `delayed` откладывается до Response, если она будет. Preflight не логируется. Каждая строка — один RMW `session:log` (контракт фазы 1; batching — дело background).
- Watchdog: background-alarm раз в 30 с → `tick(now)`: pending-запросы обработчика старше 20 с → `continueRequest` + `error`-строка «released hung request»; парковки `delay` (до 60 с по `LIMITS`) — отдельный набор с гарантированным таймером, watchdog их не трогает, но добирает те, чей `until` прошёл > 20 с назад (потерянный таймер).

## 6. Риски

- Стоимость: пауза на каждом запросе выбранных типов (Research §2.3: до 17–21× на аплоадах) — только opt-in, только паттерны правил, `*` лишь при регистронезависимом URL (§3).
- `Document` при первом attach к загружающейся вкладке может не прийти (crbug 40811878) — навигационные правила гарантированы со следующей навигации.
- `Fetch` не видит воркеры (v2: `Target.setAutoAttach`) и WebSocket (S4). Честность через `pageOnlyXhr`/`wsOnlyBlock` не меняется.
- `permissions.request({permissions:['debugger']})` в popup: с baseline-разрешением запрос «already granted» — ожидаемо `true` без промпта (проверяется live); UI-агенту рекомендовано заменить на `permissions.contains`.
- Один и тот же `requestId` не приходит дважды в одной стадии; редирект — новый `requestId` с `redirectedRequestId` (лог как отдельный запрос).
