# netblock — фаза 3 (интеграция + сквозной QA): план

> 2026-09-15. Фазы 1–2 — [`01-foundation.md`](01-foundation.md), `02-*.md`; спека — [`docs/design/netblock.md`](../../design/netblock.md) §4 (потоки = приёмочные сценарии), §8 (отказоустойчивость). Файлы: `background.ts`, `relay.content.ts`, `utils/engines/page.ts`, `utils/dnr-counters.ts`, `utils/log.ts`, `utils/protocol.ts`, `utils/rule-presets.ts`, popup/tool, `e2e/netblock/{helpers.ts,integration.spec.ts,ui.spec.ts,webrequest.live.mjs}`.

## 0. Проверенные источники (2024+)

| Факт | Источник | Дата |
|---|---|---|
| Playwright: MV3-расширение грузится только в `launchPersistentContext` с `channel: 'chromium'` + `--load-extension`; SW — `context.serviceWorkers()[0]` или `waitForEvent('serviceworker')`; id = `sw.url().split('/')[2]`; popup/tool открываются по `chrome-extension://<id>/…` | https://playwright.dev/docs/chrome-extensions | © 2026 |
| Остановить SW из теста: `const cdp = await context.newCDPSession(page)`; `ServiceWorker.enable` → `ServiceWorker.stopAllWorkers`; после остановки Playwright может как переиспользовать объект `Worker`, так и породить новый `serviceworker`-event — ждать надо оба варианта (опрос `context.serviceWorkers()`) | https://github.com/microsoft/playwright/issues/39075 | 2026-02-01 |
| SW гибнет через 30 с простоя; событие/вызов API сбрасывают таймер; **активная `chrome.debugger`-сессия держит SW живым (Chrome 118+)** → в NL-режиме воркер не засыпает | https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle | 2023-05-02 |
| `permissions.request` — только внутри user gesture (нативный промпт браузера, автоматизации недоступен); `contains` — проверка факта; повторный `request` уже выданного — без промпта | https://developer.chrome.com/docs/extensions/reference/api/permissions | 2026-09-11 |
| `webRequest.details.initiator` (Chrome 63+) — origin инициатора (`https://a.com`, `null` для opaque); события приходят только при host-доступе к URL **и к инициатору** | https://developer.chrome.com/docs/extensions/reference/api/webRequest | 2026-09-11 |
| Спайки/live фазы 2: промпт `permissions.request` под Playwright виснет → тестовая копия манифеста с `host_permissions` на фикстурный origin (production-путь от `permissions.getAll()` дальше не меняется) | `e2e/netblock/page.live.mjs`, `dnr.live.mjs` | 2026-09-15 |

## 1. Дефекты интеграции и решения

| # | Дефект | Решение |
|---|---|---|
| a | `relay:click` никто не шлёт → dnr `window(trigger:'click')` не открывается | `page:rules` получает флаг `wantsClicks` (= в `byEngine.dnr` есть `window/click`); relay вешает capture+passive click-листенер **только** при флаге (снимает при его исчезновении), троттлинг 250 мс, `relay:click` fire-and-forget. На сайтах без таких правил — ни одного листенера |
| b | `caps.page` в background игнорирует `prefs.pageEngineEnabled` | `caps.page = prefs.pageEngineEnabled` при init и в `prefsItem.watch` (+`applyAll()` при смене): компиляция, регистрация page-скриптов и `getCaps` — один источник. UI больше не AND-ит pref сам; `useBuildCaps` перечитывает `getCaps` по push `rules:applied` |
| c | «Создать правило из запроса» не знает домен страницы | `LogEntry.initiatorHost?` (только host): Chrome-наблюдение — `hostOf(initiator)`; page — `location.hostname` фрейма (relay кладёт `host` в `relay:event`); debugger — host top-документа сессии; Firefox — `hostOf(originUrl ?? documentUrl)`. `ruleFromLogEntry` → `pageDomains: [initiatorHost]` (не для «Заблокировать URL») |
| c′ | §4.1 шаг 2 («в логе появляется `POST /api/checkout 200`») на Chrome не выполнялся: `dnr-counters` писал только ≈-блоки | Наблюдение на выданных origin пишет строки `passed`(+status)/`error` для `tabId ≥ 0` (спека §2.5 «источник строк»); вкладки под NL пропускаются (там всё логирует debugger). Итог для page-`status`: две строки — `503 ✱` (приложение) и `200` (сеть) — намеренно, легенда объясняет |
| d | Popup: `permissions.request({permissions:['debugger']})` при baseline-разрешении — `true` без промпта, «ворота» фиктивные | `permissions.contains` + существующий `<dialog>` §2.7 как единственные ворота; блок §2.3 «Перехвачено N · применено M» из `TabSummary.nl` |
| e | Сырые строки причин в UI | ключи `nlReason.handlerErrors`, `logError.watchdog` (EN/RU/ET); маппинг в toast `nl:detached` и в колонке статуса лога |
| f | Одна RMW `session:log` на строку (Android/webRequest, теперь и Chrome-наблюдение) | Буфер в background: `enqueueLog` → flush по таймеру 250 мс / при > 50 строк / перед `getLogPage` / в `clearLog` (буфер сбрасывается) / `runtime.onSuspend` (best effort). Один `withLock(LOG_LOCK)` RMW на пачку, `pushLog` по строке внутри (контракт кольца сохранён), push `log:append` пачкой; курсор `afterId` не меняется |
| g | `activeTab`: page-движок брал `tabs.query({active, lastFocusedWindow})` — «активная вкладка последнего окна», остальные — «активная вкладка каждого окна» | page: `tabs.get(tabId).active` → `activeTabId = tabId` иначе `undefined`. `pageDomains` — везде `matchesSuffix` на `hostname` без порта (dnr — `initiatorDomains` браузера; проверено, что схема нормализует домены в lower-case). Различие debugger (host top-документа, не фрейма) задокументировано |
| h | Порядок старта, очистка вкладок, рестарт SW | `ready` уже гарантирует `apply()` до первого сообщения ✔; `tabs.onRemoved` покрывает все движки ✔; поведение при рестарте SW описано per-engine в IMPLEMENTATION.md; `onSuspend` только сбрасывает лог |

## 2. Матрица сценариев (`e2e/netblock/integration.spec.ts`)

Chromium (Playwright), офлайн, фикстура `e2e/netblock-spikes/server.mjs` (origin A — страница, B — «CDN»); тестовая копия манифеста с `host_permissions: ['http://127.0.0.1/*']` (оба порта); `http://localhost:<port>` — тот же сервер **без** доступа. Popup — настоящий (`chrome.action.openPopup()` из SW → `context.waitForEvent('page')`); запасной путь — `popup.html` вкладкой (только для restricted-проверок).

| Поток | Движок | Проверка через UI / фикстуру |
|---|---|---|
| §4.1 checkout nth:3 → 503 | page | лог `#/log?tab=` показывает `POST /api/checkout 200` (наблюдение); ⋯ → «Создать правило из запроса» → URL equals без query, POST, xhr, **домен 127.0.0.1**; nth:3 + status 503 → бейдж `page`; сервер получил 3, страница 200/200/503; popup `2/3 ↻` → `3/3`; строки `503 ✱` и `200` |
| §4.2 CDN images | dnr | wildcard `*/api/cdn*` + image + block → `dnr`; `<img>` → сервер B не видел; popup `≈1`; вкладка `localhost` → `—` + «Включить на localhost» |
| §4.3 real 500 → fail | debugger | правило неактивно (`○ needs Network-level mode`, редактор — `needsNetworkLevel`); тумблер → `<dialog>` с текстом про баннер → «Включить» → активно; fetch `?status=500` → TypeError; popup «Intercepted N · rules applied M»; выкл → реальный 500; закрыть вкладку → `session:nlTabs = []` |
| §4.4 flaky 30 % seed 42 | page | последовательность delayed/passed одинакова после двух reload; бейдж `page` в списке |
| §4.5 импорт/экспорт | — | 3 валидных + 2 битых (неизвестный ключ, `__proto__`) → таблица с индексами «rule 4/5», «Import valid (3)» → +3; экспорт (download) → `importRules` без ошибок |
| Реактивное B-after-A | dnr | последовательно: B проходит, A блок, B блок; в редакторе B — `reactiveParallelSlip` |
| Пауза на вкладке | все | кнопка popup → dnr-блок и page-status проходят; «Продолжить» → снова применяются |
| §8 рестарт SW | dnr + state | `ServiceWorker.stopAllWorkers`; проснувшийся SW: счётчики из `session:state`, dnr-правила блокируют, allow-паузы мёртвых вкладок сняты |
| Консоль | — | 0 ошибок на popup/tool/фикстуре за весь прогон |
| Firefox (`webrequest.live.mjs`) | webrequest | tool page: у правила `status` бейдж `wr↓` (`data-degraded`) |

## 3. Риски

- `chrome.action.openPopup()` под Playwright: если окно не в фокусе — отказ; popup закрывается при потере фокуса → helper переоткрывает. Если API недоступен в канале — сценарии popup деградируют до `popup.html`-вкладки и помечаются SKIP с причиной (не молча).
- Остановка SW через CDP при подключённом Playwright-инспекторе: если `stopAllWorkers` не срабатывает — ручной чек-лист `docs/netblock-headed-smoke.md`.
- Наблюдение webRequest на Chrome добавляет строку на каждый запрос выданных сайтов — цена одной RMW на пачку (f), объём ограничен кольцом; строки вкладок под NL не дублируются.
- Дельта до 250 мс лога теряется при внезапной смерти SW (`onSuspend` best effort) — лог и так session-only.
- Firefox live зависит от установленного Firefox + Marionette (как в фазе 2).
