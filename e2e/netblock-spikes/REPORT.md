# netblock — pre-design spikes (2026-09-15)

Живые проверки четырёх открытых вопросов из [`docs/research/2026-09-15-netblock.md`](../../docs/research/2026-09-15-netblock.md) §9 и [`docs/design/netblock.md`](../../docs/design/netblock.md) §12 — до первой строки кода расширения. Не тесты продукта; одноразовые расширения в `ext-chrome/` (MV3) и `ext-firefox/` (MV2) — не продукт.

## Как запускать

```
node e2e/netblock-spikes/chrome.spike.mjs        # S1, S3, S4, S5 → results-chrome-<channel>.json
SPIKE_ONLY=s1    node e2e/netblock-spikes/chrome.spike.mjs   # только DevTools-сценарии
SPIKE_ONLY=extra node e2e/netblock-spikes/chrome.spike.mjs   # S1c + S3b
SPIKE_ONLY=netcore node e2e/netblock-spikes/chrome.spike.mjs # S6 — @blur/netcore attachCdp вживую (после `npx esbuild packages/netcore/src/index.ts --bundle --format=esm --outfile=e2e/netblock-spikes/ext-chrome/netcore.bundle.js`)
node e2e/netblock-spikes/firefox.spike.mjs       # S2 → results-firefox.json (через npx web-ext@8)
```

`SPIKE_EXECUTABLE=<путь к chrome.exe>` — любой Chromium-билд. ⚠️ **Брендовый Google Chrome ≥ 137 игнорирует `--load-extension`** — расширение не грузится, `waitForEvent('serviceworker')` таймаутит; нужен Chromium / Chrome for Testing (здесь — Playwright Chromium 1243 = **Chromium 153.0.8010**). Firefox — установленный **155.0**, временная установка через `web-ext run` в свежий профиль. Всё офлайн: `server.mjs` поднимает два origin на 127.0.0.1 (страница + same-origin API; cross-origin API с CORS `*`), WebSocket-хендшейк и коллектор `/result`.

⚠️ Оговорка ко всем Chrome-сценариям: Playwright сам является CDP-клиентом браузера. `chrome.debugger.attach` при этом работает (на это же опирается `e2e/perf`), а DevTools открываются как **настоящий** фронтенд (`devtools://…` targets, проверено через `Target.getTargets`), не как CDP-сессия.

## Результаты

| # | Вопрос | Ответ | Свидетельство |
|---|---|---|---|
| **S1** | `chrome.debugger.attach` при уже открытых DevTools на той же вкладке | **Сосуществуют.** attach `ok`, `Fetch.enable` `ok`, `Fetch.requestPaused` приходит (1/1), `onDetach` — **ни одного события**; `getTargets().attached === true` | `results-chrome-chromium-s1.json` → `S1_devtools.devtoolsOpenThenAttach` при `devtoolsFrontendsOpen: 2` |
| **S1c** | Обратный порядок: attach в `tabs.onCreated` (до commit документа), затем DevTools авто-открываются на загрузке | **Не детачит.** attach `ok`, DevTools открылись (2 фронтенда), `Fetch` работает после, `onDetach` пуст, `attached: true` | `S1c_attachThenDevTools` |
| S1b | attach → `F12` / `Ctrl+Shift+I` через Playwright | Не показательно: клавиши уходят в renderer, DevTools не открылись; записано как «best-effort» | `S1_devtools.attachThenKeyboardDevTools` |
| **S2** | Firefox: `redirectUrl` из blocking `onHeadersReceived` на реальный 500 | **Доходит до страницы — и same-origin, и cross-origin (CORS), и `fetch`, и XHR** — но как **`status: 200`** (`data:` и `moz-extension://` всегда 200). `cancel` → `TypeError: NetworkError` / XHR `status 0`. Async-листенер с `setTimeout(300)` задерживает ответ (≈325 мс) и может отменить после задержки. `details.statusCode === 500` виден в листенере | `results-firefox.json`: 24 кейса `{data, ext, cancel, delay, delaycancel, none} × {same, cross} × {fetch, xhr}` |
| **S3** | Латентность «`onCompleted(/a)` → `updateSessionRules(block /b)` → следующий запрос» | `updateSessionRules` резолвится за **0.2–0.7 мс** (тёплый SW). Последовательный `/b` после `/a` заблокирован **40/40** при паузе 0…200 мс, в т.ч. когда `/b` уходит сразу после **заголовков** `/a` (до чтения тела) — **5/5**. Параллельные `/a ∥ /b` — **0/5** (по построению) | `results-chrome-chromium.json` → `S3_latency`; `-extra.json` → `S3b_latencyParallel` |
| **S4** | Видит ли CDP `Fetch` WebSocket-хендшейк | **Нет.** `Fetch.enable({patterns:['*' Request+Response]})` — `requestPaused` для `/ws` **пуст**, хендшейк дошёл до сервера, `open`. **DNR `resourceTypes:['websocket']` блокирует** (`error`, до сервера не дошло) | `S4_websocket` |
| **S6** | `@blur/netcore` `attachCdp` (реальный модуль, собранный esbuild) против настоящего `chrome.debugger` | attach `ok`, `Fetch.requestPaused` доставлен через `onEvent` (1/1), закрытие вкладки → `onDetach('target_closed')`, `attached=false`, повторный `detach()` — no-op; второй attach и собственный `detach()` чистые | `results-chrome-chromium-netcore.json` |
| **S5** | DNR `responseHeaders` + `block`: что видит страница и `webRequest` | «Полублок» подтверждён: оба запроса **дошли до сервера** (2/2 в журнале), страница получила `TypeError: Failed to fetch` / XHR `error`, `webRequest.onErrorOccurred` дал **`net::ERR_BLOCKED_BY_CLIENT`** — счётчик работает. `RuleConditionKeys` присутствует и содержит `TOP_DOMAINS`/`RESPONSE_HEADERS` (Chromium 153) | `S5_responseHeadersBlock` |

⚠️ Секция `S1_devtools` внутри `results-chrome-chromium.json` — из первого полного прогона **до** починки флага (`devtools: true` в Playwright deprecated и DevTools не открывал); авторитетный S1 — `results-chrome-chromium-s1.json`, где присутствие DevTools доказано (`devtoolsFrontendsOpen: 2`).

Не измерено: холодный старт SW (Playwright держит SW живым); взаимодействие с DevTools «Request conditions» одновременно с нашим `Fetch.enable` (нужен ручной прогон).

## Что это меняет в дизайне

1. **§1.2 / §5.5** — конфликт `debugger` ↔ DevTools на Chromium 153 **не воспроизводится** ни в одном порядке. Справочник (`onDetach` «when Chrome DevTools is being invoked») устарел относительно кода `DevToolsAgentHostImpl`. Обработчик `onDetach` остаётся ради `canceled_by_user`/`target_closed`/enterprise, текст «откроете DevTools — режим отключится» из §2.7 **убрать**. DevTools-панель больше не заблокирована этим вопросом (остаются причины: Android, жизнь только при открытом DevTools).
2. **§5.4 / §12.2** — Firefox: действие `status` реализуется как **подмена тела с кодом 200** (`redirectUrl` → `data:`), кросс-ориджин включительно. Для кодов ≥ 400 это бесполезно → в Firefox `status` деградирует до `cancel` (бейдж `wr↓`, текст «Firefox не позволяет изменить код ответа; запрос отменён»). `delay` — штатно через Promise в blocking-листенере.
3. **§12.1** — реактивный DNR (Chrome L1) **годится для stateful-правил с последовательной зависимостью**: `afterRule` («B после A»), `window`, `skipFirst → thenFail` («после N-го — блокировать»). Граница — параллельные запросы (0/5), о чём говорит подпись «≈ параллельные запросы могут проскочить». Точные `nth`/`once`/`times` остаются в `page`/`dbg` (нужно снять правило ровно после одного срабатывания — `onErrorOccurred` даёт это с задержкой, параллельные копии заблокируются все).
4. **§10.1 / матрица Research §1** — в `dbg`-движке `resourceTypes: websocket` **недоступен**; WebSocket блокируется только DNR (`block`) — UI при выборе `websocket` + `fail/delay/status` говорит «для WebSocket доступно только «Блокировать»».
5. **§6.3** — «полублок» `responseHeaders` подтверждён; счётчик по `ERR_BLOCKED_BY_CLIENT` работает и для этого случая.
6. **TODO «Открытые вопросы»** — `RuleConditionKeys.TOP_DOMAINS` есть в Chromium 153; версию 145 это не подтверждает, но feature-detect работает.
