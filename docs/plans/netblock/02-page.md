# netblock — фаза 2, движок `page` (Chrome, MAIN-world патч fetch/XHR): план

> 2026-09-15. Контракт — [`01-foundation.md`](01-foundation.md) §3; спека — [`docs/design/netblock.md`](../../design/netblock.md) §3, §4.1, §4.4, §6 (2, 7, 11), §7.3, §8, §10.1; Research §2.4, §4. Файлы движка: `utils/engines/page.ts`, `utils/page-registration.ts`, `entrypoints/netblock-page.content.ts` (MAIN), `entrypoints/relay.content.ts` (ISOLATED), hook-строки в `background.ts`.

## 0. Проверенные источники (2024+)

| Факт | Источник | Дата |
|---|---|---|
| `scripting.registerContentScripts`: `world: 'MAIN'` (Chrome 102+), `runAt` (default `document_idle`), `persistAcrossSessions` («The default is true»), `allFrames`, `matchOriginAsFallback` (119+, about:/data:/blob: фреймы); `updateContentScripts` — «A property is only updated … if it is specified»; `unregisterContentScripts({ids})`, `getRegisteredContentScripts` | https://developer.chrome.com/docs/extensions/reference/api/scripting | 2026-09-11 |
| `permissions.onAdded/onRemoved` несут `{origins?, permissions?}`; `getAll().origins` — match-patterns вида `https://example.com/*`; `request` только из user gesture | https://developer.chrome.com/docs/extensions/reference/api/permissions | 2026-09-11 |
| «When a content script is injected into the main world, the CSP of the page applies»; `document_start` — «before any other DOM is constructed or any other script is run»; MAIN↔ISOLATED — только через общий DOM/`postMessage` | https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts | 2026 |
| ⚠️ Уточнение к ТЗ: MAIN-скрипт **инжектится браузером** (не `<script src>`), поэтому `script-src` страницы его не блокирует, но **CSP страницы действует на его поведение** — никакого `eval`/`new Function` (у нас их и нет) | там же | — |
| MV3 remote code: «You can no longer execute external logic using `executeScript()`, `eval()`, and `new Function()`»; JSON-конфиг грузить можно, исполнять — нет | https://developer.chrome.com/docs/extensions/develop/migrate/improve-security | 2023-03-08 |
| `new Response(body, {status, statusText, headers})`; статус вне 200–599 → `RangeError`; тело при null-body статусе (101, 103, 204, 205, 304) → `TypeError`; `Response.error()` — type `error`, status 0 | https://developer.mozilla.org/en-US/docs/Web/API/Response/Response · https://fetch.spec.whatwg.org/#response-class | 2025-06-23 |
| XHR: request error steps — `readystatechange`(DONE) → `error` → `loadend`, `status` = 0; sync XHR при сетевой ошибке бросает `NetworkError`; `getAllResponseHeaders()` — `name: value` через CRLF, имена в lower-case; `response` для `json` → `null` при ошибке парсинга; `responseText` бросает `InvalidStateError`, если `responseType` не `''`/`'text'` | https://xhr.spec.whatwg.org/ · https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/responseText | 2024-04-04 |
| `tabs.sendMessage(tabId, msg)` без `frameId`/`documentId` доставляется **во все фреймы** вкладки | https://developer.chrome.com/docs/extensions/reference/api/tabs | 2026-09-11 |

**Вне охвата v1 (честно):** `navigator.sendBeacon`, `EventSource`, `WebSocket`, навигации, `<img>/<script>/<link>`, запросы воркеров и запросы, ушедшие до инъекции (§8 «HTML-парсер»). Бейдж `page` говорит `pageOnlyXhr`.

## 1. Жизненный цикл регистрации (`utils/page-registration.ts`)

- Два скрипта, id `netblock-relay` (ISOLATED, `content-scripts/relay.js`) и `netblock-page` (MAIN, `content-scripts/netblock-page.js`), оба `runAt: 'document_start'`, `allFrames: true`, `persistAcrossSessions: true`, `matchOriginAsFallback: true` (повтор без ключа, если старый Chrome его отвергает). Relay регистрируется **первым** — nonce должен лежать в DOM до MAIN.
- `reconcileRegistration(enabled)`: `matches` = `permissions.getAll().origins`, отфильтрованные до `http(s)`/`*://`/`<all_urls>` (`file://`, `chrome://` — вон). Пусто или `enabled=false` → `unregisterContentScripts` обоих. Иначе: уже зарегистрированы с тем же набором → no-op; зарегистрированы с другим → `updateContentScripts({id, matches})`; нет → `registerContentScripts`. Идемпотентно, все ошибки → `error`-событие движка, никогда не бросает наружу.
- Вызовы: `engine.apply()` (старт SW, каждая перекомпиляция), `permissions.onAdded/onRemoved` (подписка внутри движка, лениво через `globalThis.chrome`), `siteAccessChanged` из popup (background → `applyAll()` → `apply()`). `dispose()` → `unregister` обоих.
- ⚠️ Отклонение от ТЗ: MAIN-entrypoint переименован в `netblock-page.content.ts`. WXT именует IIFE по имени entrypoint'а: `page.content.ts` → `var page = …` в **глобале страницы**; страница с top-level `const page` после этого падает с `SyntaxError` (var-имя в глобальной среде). `netblockPage` — коллизия практически исключена. `relay` (ISOLATED) оставлен.
- Firefox: `createEngines('firefox')` движок не создаёт; `available = !!chrome.scripting`; ни одна ветка не вызывает `registerContentScripts` без API.

## 2. Мост и модель угроз

```
background ──tabs.sendMessage(RelayCommand)──▶ relay (ISOLATED) ──postMessage{tag,nonce,command}──▶ MAIN
background ◀──runtime.sendMessage(RelayMessage)── relay ◀──postMessage{tag,nonce,events}────────── MAIN
```
- Nonce: `crypto.randomUUID()` в relay, кладётся в `data-blur-netblock-nonce` на `<html>`; MAIN читает лениво. Обе стороны: `event.source === window`, `event.origin === location.origin`, `tag`, `nonce`. Остаточный риск (как у `perf`): сама страница видит nonce и может слать поддельные `events` — последствия ограничены счётчиками/логом её же вкладки; **в `local` из страницы ничего не пишется** (лог — `session`, счётчики — `session`).
- Команды: `page:rules {rules, paused, state, tabId, activeTabId}` (ответ на `relay:ready` и push при каждом `apply`), `page:state {counters, matched}` (дельта из других вкладок), `page:pause {paused}`, `page:reset {ruleId?}`. События: `hit {ruleId, url, key, counter, applied}`, `log {method, url, status?, outcome, ruleId, delayMs?, error?}`, `window {ruleId, key, counter}` (клик-триггер открыт локально).
- Relay держит очередь неподтверждённых событий: `sendMessage` отклонён (SW не проснулся / контекст инвалидирован) → события остаются, повтор на следующем событии и по таймеру 2 с (§8 «досылает дельту»).
- Правила — **данные**: MAIN получает `Rule[]` и матчит их `matchesUrlCondition`/`matchesSuffix` (`@blur/netcore`, чистые), `statusMatches`, `decide` — те же функции, что в background (проверено: ни один из них не импортирует `#imports`).

## 3. Патч fetch/XHR

Общий порядок для запроса (`xhr`-тип, не на паузе): правила в порядке приоритета; статические условия (url/method/type/pageDomain/scope). Правило **без** условий ответа — `decide()` сразу; **с** условиями (`responseStatus`/`responseHeaders`) — реальный запрос выполняется **один раз лениво**, проверяется статус/заголовки (для fetch — CORS-видимые), затем `decide()`. Первое правило, у которого `apply === true`, побеждает; несработавшее (`nth` не тот) пропускает запрос дальше по списку. `every`-правило считает `seen`, но не хранит `hits`-историю в UI.

| Action | fetch | XHR (async) | XHR (sync) |
|---|---|---|---|
| `block` | реальный запрос не уходит; `reject(new TypeError('Failed to fetch'))` | без `send`; `readystatechange`(4, status 0) → `error` → `loadend` | `throw DOMException('NetworkError')` |
| `fail(reason)` | как `block`; лог `failed`, `error: reason`, бейдж `page↓` (`failReasonImitated`) | как `block` | как `block` |
| `delay ms` | `await sleep(ms, signal)` — abort отменяет (reject `signal.reason`), затем оригинальный `fetch` | `setTimeout` → оригинальный `send`; `abort()` в ожидании → `abort`+`loadend` | задержка невозможна (нельзя блокировать поток) → пропуск, лог `passed`+`error` |
| `status code, body` | реальный запрос **уходит** (DevTools покажет его — §6.2), затем `new Response(body, {status, headers:{'content-type', 'x-content-type-options':'nosniff'}})`; `url` = URL запроса; null-body статусы → без тела; 1xx → `RangeError` невозможен → fail-open (реальный ответ + `error`) | реальный `send`; на **первом** `readystatechange ≥ 2` (наш listener зарегистрирован в конструкторе-наследнике, раньше любых listener'ов страницы) — `defineProperty` на инстансе: `status`, `statusText`, `response` (по `responseType`: text/json/arraybuffer/blob; `document` → `null`), `responseText` (`InvalidStateError` при чужом `responseType`), `getAllResponseHeaders`, `getResponseHeader`; при сетевой ошибке реального запроса — `stopImmediatePropagation` на `error`, синтетический `load` | то же после возврата `send` |
| условие ответа + `block/fail` | реальный ответ отброшен (`body.cancel()`), `TypeError` | подавляем `load`, синтетический `error`, `status`=0 | `NetworkError` |

Инварианты: всё в `try/catch`, любая ошибка патча → оригинальный вызов (fail-open); `Request` как input — `url`/`method`/`signal` берутся из него; относительные URL — `new URL(x, location.href)`; `input`/`init` передаются в оригинал без копирования (тело-стрим не трогаем); `toString` не подделываем; тела чужих ответов не читаем. `XMLHttpRequest` заменяется подклассом (`class extends Orig`), чтобы наш listener был первым; `prototype`-патчи страницы (Sentry и т.п.) продолжают работать.

## 4. Счётчики: кто источник истины

- **Background — источник истины** (`session:state` под Web Lock); **страница — зеркало**, чтобы решение было синхронным и точным даже при спящем SW. Зеркало инициализируется снимком из `page:rules` (background читает его под `STATE_LOCK`, чтобы встать в очередь после `resetForNavigation` из `tabs.onUpdated`). В top-фрейме MAIN дополнительно сам применяет `resetForNavigation` + `openWindow(navigation)` для своей вкладки — закрывает гонку «ready раньше onUpdated», идемпотентно с background.
- Каждый матч → `decide()` в зеркале → событие `hit` с `key` и итоговым `counter`. Background: `counters[key] = counter`, если `counter.seen ≥ старый.seen` (иначе устаревшее — игнор), `matched[ruleId] = now`. Дельта для `countKey ≠ 'rule+tab'` рассылается остальным вкладкам как `page:state`; зеркало принимает по тому же правилу «больше `seen` побеждает».
- Конфликт двух вкладок с `countKey: 'rule'` (обе решили по устаревшему зеркалу) — честно неизбежен без синхронного общего состояния; итог — «больше seen побеждает», расхождение ≤ количества параллельных вкладок; спека §6.11 и так обещает воспроизводимость только «при том же порядке».
- `resetCounters` → background чистит `session:state` **и** шлёт `page:reset {ruleId?}`; `pauseTab` → `page:pause`. Клик-триггер `window` открывается **локально** в MAIN (иначе fetch сразу после клика не увидит окно) и досылается как `window`-событие. `probability`: PRNG-состояние живёт в счётчике → тот же seed + тот же порядок = та же последовательность и после перезагрузки (`resetOn: navigation` сбрасывает `rng`).

## 5. Лог

Только применённые правила (`block/fail/delay/status`) → `log`-событие → background `pushLog` с `engine: 'page'`, `type: 'xhr'`, `marks: ['clientSide']` (✱), `tabId` из `sender.tab.id`. Строка «реальный ответ» для того же запроса при `status` придёт от webRequest-наблюдения (агент dnr) — две строки честно показывают «сеть vs приложение».

## 6. Риски

- Порядок инъекции ISOLATED/MAIN при runtime-регистрации не документирован → nonce читается лениво в момент post'а; регистрируем relay первым.
- `getAll().origins` может содержать `<all_urls>` (если пользователь выдал «на всех сайтах») — допустимый `matches`.
- Страницы, сравнивающие `fetch.toString()` с `[native code]`, увидят патч — заявлено в листинге (§7.3).
- XHR `progress`/`loaded` при подмене показывают реальные байты — не маскируем.
- Live-тест выдаёт origin через `permissions.request` из popup под жестом Playwright (`page.click`) — если конкретная сборка Chromium не считает это жестом, тест пишет `SKIP` с причиной, а не падает молча.
