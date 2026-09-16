# netblock — фаза 2, движок `webrequest` (Firefox, desktop + Android): план

> 2026-09-15. Контракт — [`01-foundation.md`](01-foundation.md) §3; спека — [`docs/design/netblock.md`](../../design/netblock.md) §0/§3/§5.4/§6.6/§8; спайк S2 — [`e2e/netblock-spikes/REPORT.md`](../../../e2e/netblock-spikes/REPORT.md). Firefox — один движок на все правила (`engine-select.ts` → `firefoxAuto`).

## 0. Проверенные источники (все 2024+)

| Факт | Источник | Дата |
|---|---|---|
| Blocking-листенер `onBeforeRequest` может вернуть **Promise** → `BlockingResponse` (Firefox 52+); `cancel`, `redirectUrl`; `tabId === -1` = «не связан с вкладкой»; `originUrl` = ресурс-инициатор, `documentUrl` = документ, в который грузится ресурс; `onBeforeRequest` с blocking — **до DNS и speculative connect** | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onBeforeRequest | 2026-08-04 |
| `onHeadersReceived`: Promise поддерживается; `details.statusCode`, `statusLine`; `responseHeaders` только с `'responseHeaders'` в extraInfoSpec | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onHeadersReceived | 2026-07-08 |
| `BlockingResponse.cancel` допустим в `onBeforeRequest`, `onBeforeSendHeaders`, **`onHeadersReceived`**, `onAuthRequired`; `redirectUrl` — в `onBeforeRequest`/`onHeadersReceived` (мы **не** используем); `responseHeaders` — только `onHeadersReceived` (мы **не** мутируем) | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/BlockingResponse | 2026-08-27 |
| `RequestFilter`: `urls` (обязателен, match patterns, только http/https/ws), `types` (опционально; без него — все типы), `tabId`, `windowId`, `incognito` | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/RequestFilter | 2025-07-17 |
| Firefox `ResourceType`: `beacon`, `imageset`, `json`, `object_subrequest`, `speculative`, `web_manifest`, `xml_dtd`, `xslt` (+ общие) — маппинг уже в `resource-types.ts` | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/ResourceType | 2026-08-21 |
| Event page: листенеры регистрируются **синхронно на верхнем уровне**; порты не держат страницу; открытый view держит; `persistent: false` в MV2 поддержан. ⚠️ Наша сборка MV2 без `persistent` → **persistent background** (см. §1.4) | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts | 2026-07-27 |
| `storage.session`: в памяти, 10 МБ, `storage.session.onChanged` есть (WXT `watch` на нём) | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session | 2025-08-01 |
| Web Locks: Baseline 2022, окна + воркеры (background page Firefox = окно) | https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API (см. 01-foundation §0) | 2026 |
| AMO: только необходимые разрешения (с обоснованием), никакого удалённого кода, минификация ок/обфускация нет, исходники прилагаются; про blocking webRequest отдельного запрета нет | https://extensionworkshop.com/documentation/publish/add-on-policies/ | 2026-04-30 |
| Android: ОС убивает простаивающие процессы — расширение должно **восстанавливаться** после kill; `storage.session` есть; popup = оверлей из меню «Дополнения»; `tabs` без zoom/move | https://extensionworkshop.com/documentation/develop/differences-between-desktop-and-android-extensions/ | 2024-01-17 |
| Firefox факты из Research §2.6: blocking webRequest **не** на deprecation path, `cancel` в `onHeadersReceived` работает (S2), async-листенер ≈ +25 мс, `redirectUrl`→`data:` всегда 200, Android поддерживает blocking webRequest | `docs/research/2026-09-15-netblock.md`, `e2e/netblock-spikes/results-firefox.json` | 2026-09-15 |

## 1. Дизайн

### 1.1 Листенеры (все регистрируются в `apply()`, снимаются в `dispose()`, идемпотентно)
| Событие | Фильтр | extraInfoSpec | Зачем |
|---|---|---|---|
| `onBeforeRequest` | `{ urls: ['<all_urls>'], types? }` | `['blocking']` | **request-stage** правила: без `responseStatus`/`responseHeaders` → `block`/`fail`/`status`(↓cancel)/`delay` |
| `onHeadersReceived` | то же | `['blocking']` (+ `'responseHeaders'` только если есть правило с условием по заголовку) | **response-stage** правила: `statusMatches(details.statusCode)`, заголовки → `cancel`/`delay` |
| `onCompleted` / `onErrorOccurred` | `{ urls: ['<all_urls>'] }` | — | строка лога (метод/URL/тип/статус) + закрытие «висящих» задержек |

`types` = объединение `toFirefoxTypes(rule.condition.resourceTypes)`; если хоть одно правило без типов — фильтр без `types`. Нет правил → blocking-листенеры **не регистрируются** (ноль стоимости; Android). Перерегистрация только при смене фильтра (remove + add).

### 1.2 Конвейер матчинга — чистая функция `evaluateRequest(details, stage, rules, snapshot, ctx)` (`utils/webrequest-eval.ts`)
1. `isPageTraffic`: только `http(s)`/`ws(s)`; `tabId ≥ 0` **или** (`tabId === -1` и `originUrl` — http(s), т.е. service worker); всё с `originUrl` `moz-extension:`/`about:`/`chrome:` — мимо (чужие расширения и сам браузер не ломаем).
2. Пауза вкладки (`ctx.pausedTabs`) → пропуск, событий нет.
3. Правила своей стадии в порядке `priority` (уже отсортированы `compileRules`). Условие: URL (`matchesUrlCondition`, netcore) · `methods` · `resourceTypes` через `fromFirefoxType(details.type)` · `pageDomains` — `matchesSuffix(host(originUrl ?? documentUrl))` · `scope: activeTab` → `details.tabId ∈ ctx.activeTabs` (активная вкладка каждого окна, `tabs.onActivated`) · на response-stage ещё `statusMatches` + заголовки (`exists`/`equals`/`contains`, имя и значение без учёта регистра).
4. Совпало → `decide()` (`state.ts`) по снимку; **применилось** → действие, стоп (first-match); **не применилось** → правило прозрачно, идём дальше (счётчик `seen` его уже вырос — «сколько раз видело»).
5. Результат: `{ kind: 'pass' | 'apply', deltas[], hit?: { rule, action, response, degraded? } }`. `deltas` — изменённые ключи счётчиков (для write-through), не весь снимок.

Стадии независимы: request-stage правила отрабатывают **до сети**, response-stage — по пришедшему ответу; строгий кросс-стадийный приоритет невозможен без потери `delay`/`block` до сети — задокументировано.

### 1.3 Действия → `BlockingResponse`
| Действие | Ответ | Флаг |
|---|---|---|
| `block` | `{ cancel: true }` — синхронно | — |
| `fail(reason)` | `{ cancel: true }` | `degraded: 'ffFailCancel'` (`wr↓`) |
| `status` | `{ cancel: true }` (S2: `redirectUrl` — всегда 200, бесполезно для ≥ 400; `redirectUrl` не используем вовсе) | `degraded: 'ffStatusCancel'` (`wr↓`) |
| `delay ms` | `Promise` → `{}` через `ms` (≤ 60 000, `LIMITS`); `onErrorOccurred`/`dispose()` резолвят раньше | — |

Синхронный возврат везде, где нет `delay` и кэш тёплый — иначе +≈25 мс на запрос (S2).

### 1.4 Состояние: кэш в памяти + write-through (`utils/webrequest-state.ts`, чистый класс `StateCache`)
- `base` — последний известный `session:state`; `pending` — упорядоченные дельты, ещё не подтверждённые записью. Эффективный снимок = `base` + overlay `pending` → эхо собственной записи (или reset из background) **не откатывает** уже принятые решения.
- **Холодный старт**: первый запрос после старта (один раз за жизнь persistent-страницы) ждёт `Promise.race([stateItem.getValue(), 200 мс])`; таймаут → `base = ∅`, событие `error` («state cache cold read timed out»), запрос **не задерживается дольше 200 мс** (fail-open по §8). Поздно пришедший снимок принимается как `base` (overlay защищает).
- Write-through: `updateState(cur => merge(cur, delta))` под `netblock-state` (Web Lock, `storage.ts`) — fire-and-forget после решения, ошибки → `error`-событие; результат записи → `base`, дельта снимается из `pending`.
- Сбросы background'а (`resetForNavigation`, `resetCounters`, `forgetTab`, `openWindow`) приходят через `stateItem.watch` → `base = next`. Эхо собственной записи, пришедшее позже её `resolve`, могло бы откатить счётчик на одно уведомление — поэтому уведомление с `seen` меньше последнего подтверждённого для этого ключа (≤ 10 с) игнорируется; уведомление **без** ключа (reset удалил его) принимается всегда. Правок `background.ts` не требуется. Окно гонки — латентность одной записи (мс): reset, наложившийся на in-flight дельту, воскресит один ключ. Приемлемо, задокументировано.
- Сборка Firefox MV2 без `persistent` → background **persistent**: холодное чтение — один раз за жизнь процесса. Если когда-то перейдём на event page — листенеры надо регистрировать синхронно на верхнем уровне (MDN), а не в `apply()`; отмечено в IMPLEMENTATION.md.
- Модуль движка **не импортирует** `#imports`/`../storage` статически (Node-тесты грузят `engines/index.ts`); `browser` берётся из `globalThis`, `../storage` — динамическим `import()` при первом `apply()` (Vite инлайнит его в IIFE).

### 1.5 События (контракт `EngineEvent`)
- `hit { ruleId, tabId, url, approx: false, degraded? }` — при применении; **новое необязательное поле** `degraded?: HonestyKey` (`types.ts`), `wr↓` для UI.
- `log { entry }` — **одна строка на запрос**: для `cancel` — сразу при решении (`blocked`/`failed`+`degraded`), иначе — в `onCompleted` (`passed`/`delayed`+`delayMs`, `status`) / `onErrorOccurred` (`error`, текст ошибки браузера). Новый `LogMark` `'degraded'` (глиф `↓`) в `log.ts`. `logStripQuery` применяет background (`pushLog`). `tabId === -1` строки не логируются (шум ОС/браузера), но правила к SW-трафику применяются.
- `error { message, ruleId? }` — таймаут холодного чтения, отказ записи, отсутствие API.

### 1.6 Пауза / вкладки / сброс
`pauseTab`/`resumeTab` — `Set<number>` в движке (+ гидрация из `session:pausedTabs` при первом `apply()`); `tabs.onRemoved` чистит `activeTabs`/`paused`; `activeTabs` — `tabs.query({active:true})` + `tabs.onActivated` (без разрешения `tabs`). Навигационный сброс счётчиков делает background (`tabs.onUpdated(loading)`) → к нам через `watch`.

## 2. Файлы
| Файл | Ответственность |
|---|---|
| `utils/webrequest-eval.ts` | чистый матчинг + решения + `BlockingResponse`, `typesFilterFor`, `isPageTraffic` |
| `utils/webrequest-state.ts` | чистый `StateCache` (overlay, таймаут, DI хранилища и таймера) |
| `utils/engines/webrequest.ts` | `Engine`: регистрация, glue к `browser.webRequest`/`tabs`, динамический импорт `../storage`, события |
| `utils/engines/types.ts`, `utils/log.ts` | +`degraded?` в `hit`, +`'degraded'` в `LogMark` (аддитивно) |
| `e2e/netblock/webrequest.test.mjs` | Node-тесты по реальным `.ts` (≥ 15 проверок); скрипт `e2e:netblock-webrequest` в цепочке `e2e` |
| `e2e/netblock/webrequest.live.mjs` | живой прогон `.output/firefox-mv2` через `web-ext-run` + Marionette (`--marionette --remote-allow-system-access`): UUID берётся из `WebExtensionPolicy` в chrome-контексте, tool page открывается через `gBrowser.addTab` (WebDriver-навигация на `moz-extension://` запрещена в Firefox ≥ 153 и в BiDi, и в classic), скрипты — в system-sandbox через `window.wrappedJSObject`; правила сеются `importRules`, лог читается `getLogPage`; скрипт `e2e:netblock-webrequest-live` вне цепочки |

## 3. Android
Тот же код: blocking webRequest есть, `tabs.onActivated` есть, `windows` нет (не используем). ОС может убить процесс — кэш восстанавливается из `session:state` при следующем старте (счётчики выживают, пока жив браузер). Стоимость: без правил — ноль blocking-листенеров; строка лога = один RMW `session:log` в background на запрос (контракт фазы 1) — на Android это главный расход; рекомендация владельцу background: батчить `log:append`.

## 4. Риски
- `tabs.onActivated` как источник «активной вкладки» для `scope: activeTab` — интерпретация (в `Rule` нет `tabId`); UI/dnr-агентам нужно то же понимание.
- Гонка reset ↔ in-flight дельта (мс) — воскрешение одного ключа.
- Header-условия: `'responseHeaders'` в extraInfoSpec включается только при их наличии — иначе платим копирование заголовков на каждый ответ.
- Live-тест зависит от установленного Firefox (`SPIKE_FIREFOX`) и Marionette chrome-контекста (`--remote-allow-system-access`, Firefox ≥ 138); pref `extensions.webextensions.uuids` временной установкой web-ext не учитывается — UUID читаем из `WebExtensionPolicy`. Запасной путь: seed `browser-extension-data/<id>/storage.js` в профиле.
