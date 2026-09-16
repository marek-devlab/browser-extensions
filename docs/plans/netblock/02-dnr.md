# netblock — фаза 2, движок `dnr` (Chrome `declarativeNetRequest`): план

> 2026-09-15. Фундамент — [`01-foundation.md`](01-foundation.md); спека — [`design/netblock.md`](../../design/netblock.md) §0, §3, §5.7, §6, §8, §12.1; факты — [`research`](../../research/2026-09-15-netblock.md) §2.1–2.2, §4; спайки S3/S5 — [`e2e/netblock-spikes/REPORT.md`](../../../e2e/netblock-spikes/REPORT.md).

## 0. Проверенные источники (все 2024+)

| Факт | Источник | Дата |
|---|---|---|
| `MAX_NUMBER_OF_SESSION_RULES` = 5 000, `MAX_NUMBER_OF_DYNAMIC_RULES` = 30 000 (unsafe 5 000), `MAX_NUMBER_OF_REGEX_RULES` = 1 000 на тип (dynamic/session считаются отдельно), regex ≤ 2 КБ после компиляции; `tabIds`/`excludedTabIds` — «Only supported for session-scoped rules»; `requestMethods` — lower-case, «will also exclude non-HTTP(s) requests» (WebSocket); `initiatorDomains` — ASCII/punycode, поддомены совпадают; `urlFilter` omitted = все URL, пустая строка запрещена; `isUrlFilterCaseSensitive` default `false`; `responseHeaders: HeaderInfo{header, values?, excludedValues?}`, `*`/`?` — wildcard, Chrome 128+; «A block … rule with a response headers condition will still run – but cannot actually block»; `updateSessionRules` — «single atomic operation: either all specified rules are added and removed, or an error is returned»; `isRegexSupported({regex,isCaseSensitive}) → {isSupported, reason?: syntaxError\|memoryLimitExceeded}`; `RuleConditionKeys` — Chrome 145+; равный priority: `allow > block > upgradeScheme > redirect`; стадия заголовков: правила, «made redundant by a matching allow … rule», исключаются как и в стадии «before request»; `onRuleMatchedDebug` — «only available for unpacked extensions with declarativeNetRequestFeedback» | https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest | 2026-09-11 |
| `webRequest`: события приходят только при host-permission на URL («along with the necessary host permissions»); `onErrorOccurred.error` — строка вида `net::ERR_BLOCKED_BY_CLIENT`, «not guaranteed to remain backwards compatible»; `details.tabId/url/type/initiator/requestId`; `<all_urls>` в фильтре не обходит host-permission | https://developer.chrome.com/docs/extensions/reference/api/webRequest | 2026-09-11 |
| Тексты ошибок DNR дословно: `Rule with id * does not have a unique ID.`, `Rule with id * cannot have non-ascii characters as part of "*" key.`, `Rule with id * was skipped as the "*" value exceeded the 2KB memory limit when compiled…`, `Rule with id * specifies a value for "*" or "*" key. These are only supported for session-scoped rules.`, `Session rule count exceeded.`, `Session rule count for regex rules exceeded.`, `Rule with id * specifies an incorrect value for the "*" key.` — все начинаются с `Rule with id N` → id парсится и отображается на наше правило | https://chromium.googlesource.com/chromium/src/+/main/extensions/browser/api/declarative_net_request/constants.cc | main, 2026-09-15 |
| `updateSessionRules` откатывает **весь** батч при ошибке одного правила (2 КБ regex) — отсюда retry без виновника | https://groups.google.com/a/chromium.org/g/chromium-extensions/c/FSV6CJ1ZmPY | 2024 |
| Спайк S3: `updateSessionRules` 0.2–0.7 мс; B после A — 40/40 последовательно, 0/5 параллельно; S5: `responseHeaders`+`block` — запрос доходит до сервера, страница получает `TypeError`, `onErrorOccurred` = `net::ERR_BLOCKED_BY_CLIENT` | `e2e/netblock-spikes/REPORT.md` | 2026-09-15 |

## 1. Решения

1. **Все правила — session, dynamic не используем** (отклонение от спеки §4.2 «`updateDynamicRules` (все вкладки)»). Почему: (а) один атомарный reconcile в одном ruleset'е — `tabIds` (scope `activeTab`, пауза) допустимы только в session; (б) fail-open: session-правила гибнут с браузером и с обновлением расширения — «залипший» блок не переживёт рестарт, dynamic пережил бы даже смену схемы; (в) лимита 5 000 хватает: hard-cap 2 000 правил + реактивные экземпляры; (г) счётчики и так сбрасываются при рестарте (§6.7) — окно «до init SW» после старта браузера честно попадает в тот же notice. Цена: после старта браузера правила scope `all` появляются, когда SW отработал `init()` (миллисекунды; `runtime.onStartup` будит SW).
2. **Id детерминированы от позиции**: `id = 1 + index·128 + slot`, `index` — позиция правила в `compiled.byEngine.dnr` (порядок = priority, `index < 4096`), `slot 0` — stateless-правило, `slot 1..127` — реактивные экземпляры (по вкладке / по URL). Пауза: `id = 2^29 + slot` (allow), slot — позиция вкладки в отсортированном списке пауз, сама вкладка — в `tabIds`. ⚠️ Live-тест показал: id вкладок в Chromium 153 ≈ 2·10⁹, а id правила — 32-битный int, поэтому **ничего не выводится из tabId арифметически**. Диапазоны не пересекаются; всё, что вне них в `getSessionRules()`, — не наше и не трогается.
3. **Priority** = `N − index` (первое правило — выше; DNR не гарантирует порядок при равном priority, Research §2.1). Пауза — `allow` с priority `1 000 000`: по справочнику allow побеждает block при равном priority, а «made redundant by a matching allow» действует и на стадии заголовков → одно allow-правило на вкладку снимает и `responseHeaders`-блоки (live-тест d). ⚠️ Замер `testMatchOutcome` на Chromium 153: allow с priority `2^29`/`2^30` **проигрывает** block с priority 1 (`2^20` и `2·10⁹` выигрывают) — внутри priority упаковывается с битами действия; большие значения не использовать.
4. **Пауза = одно `allow` session-правило на вкладку** (`tabIds:[tab]`, без `urlFilter`), а не `excludedTabIds` на каждом правиле: O(1) вместо переписывания всего набора, нет конфликта «includes and excludes the same tab ID» для activeTab-правил.
5. **Scope `activeTab`** = активная вкладка каждого окна (`tabs.query({active:true})` на старте + `tabs.onActivated`); правило переезжает вместе с активацией (`tabIds: [...active]`). `tabs`-permission не нужен: `onActivated` даёт `tabId/windowId` и так.
6. **Reconcile — чистая функция** `planSessionUpdate(desired, current)`: правила сравниваются по id и каноническому JSON; неизменные не трогаются, изменённые — удаляются и добавляются одним `updateSessionRules({removeRuleIds, addRules})`. Повторный `apply` с тем же набором — пустой план (идемпотентность проверяется в Node-тесте).
7. **Ошибки (§5.7)**: regex сначала через `isRegexSupported` (причина браузера дословно: `syntaxError`/`memoryLimitExceeded`); reject `updateSessionRules` → парсим `Rule with id N` → событие `error {ruleId, message (дословно), hint}` для виновника, батч повторяется без него (≤ 8 итераций); если id не распознан — общая ошибка, план не применяется. Правило никогда не выключается молча.
8. **Реактивные правила** (`afterRule`, `window`, `skipFirst`) — session-правила ставятся/снимаются по триггерам из background (`engine.onTrigger`). Ключ счёта: `rule+tab` → экземпляр с `tabIds:[tab]`; `rule` → глобальный; `url` → экземпляр `urlFilter: "|<url без query>"` (если URL содержит `*`, `|`, `^` — деградирует до глобального). Триггеры: `matched` (любой движок: `hit`/`matched` события, включая ≈ из счётчиков), `navigation`, `click` (relay, page-агент), `manual` (popup), `tabActivated`, `tabRemoved`, `reset`, `tick` (watchdog 30 с). Честность: `reactiveParallelSlip` уже добавляется в `engine-select` ✔; плюс сетевые триггеры (`afterRule`, `skipFirst`) требуют `webRequest` на выданных origin — без доступа к сайту такие правила не взводятся (background помечает их `siteNotEnabled`).
9. **Восстановление после рестарта SW**: состояние реактивных экземпляров — сами session-правила (переживают остановку SW). На первом `apply` движок читает `getSessionRules()`: `afterRule`/`skipFirst`-экземпляры с совпадающим содержимым считаются взведёнными; `window` — снимаются (время истечения неизвестно → fail-open, окно закрывается раньше, а не позже); экземпляры с `tabIds` мёртвых вкладок — снимаются.
10. **Счётчики ≈** (`utils/dnr-counters.ts`): `webRequest.onErrorOccurred` + `onCompleted` на `permissions.getAll().origins` (переподписка на `permissions.onAdded/onRemoved`); URL/метод/тип/initiator сверяются нашим матчером; `ERR_BLOCKED_BY_CLIENT` + правило сейчас установлено для этой вкладки → `hit {approx:true}` (первое совпавшее — first-match-wins), остальные совпадения → `matched`. Без доступа — событий нет, UI показывает «—» (§6.9).
11. `webRequest.onCompleted`/`onErrorOccurred` нужны для `afterRule`/`skipFirst` даже когда правило A — не DNR: события `hit`/`matched` других движков тоже идут в `onTrigger` через один hook в `onEngineEvent`.

## 2. Таблица трансляции (наше → DNR)

| Наше | DNR |
|---|---|
| `action: block` | `action: {type:'block'}` |
| `url.op: contains v` | `urlFilter: v`; если `v` содержит `*`/`\|`/`^` → `regexFilter: escape(v)` |
| `url.op: equals v` | `urlFilter: "\|v\|"`; спецсимволы → `regexFilter: ^escape(v)$` |
| `url.op: wildcard g` | `urlFilter: "\|g\|"` (`*` как есть); при `?`/`^`/`\|` → `regexFilter: ^glob→re$` |
| `url.op: regex r` | `regexFilter: r` (после `isRegexSupported`) |
| `caseSensitive: true` | `isUrlFilterCaseSensitive: true` |
| не-ASCII в `value` | правило не отправляется, `error {hint:'nonAscii'}` |
| `methods` | `requestMethods` lower-case (websocket-only правило — без `requestMethods`, иначе никогда не совпадёт) |
| `resourceTypes` | `toDnrTypes()`; пусто → ключ опущен (все типы) |
| `pageDomains` | `initiatorDomains` (punycode через `URL`) |
| `responseHeaders[{name,op,value}]` | `exists → {header}`; `equals → {header, values:[v]}`; `contains → {header, values:["*v*"]}`; только при `caps.dnrResponseHeaders` |
| `scope: activeTab` | `tabIds: [активные вкладки]`; нет активных → правило не ставится |
| `scope: all` | без `tabIds` |
| порядок | `priority = N − index` |
| `state: every` | slot 0 сразу |
| `state: afterRule/window/skipFirst` | slot 0 не ставится; экземпляры в slot 1..127 по триггерам (§1.8) |

## 3. Алгоритм `apply(set)`

1. `rules = set.byEngine.dnr`; для regex-правил — `isRegexSupported` (кэш по паттерну); неподдерживаемые → `error`, исключаются.
2. Первый вызов после старта — `recover(getSessionRules())` (§1.9), `activeTabs` из `tabs.query`.
3. `desired = translateAll(rules, {activeTabs, paused, reactive})` (чисто) → `plan = planSessionUpdate(desired, current)` (чисто) → `updateSessionRules(plan)`; на reject — §1.7.
4. `current` обновляется из результата плана (не перечитываем `getSessionRules` каждый раз; перечитываем при ошибке).

## 4. Автомат реактивного экземпляра

```
afterRule(B←A):  idle ──matched(A)──▶ armed(slot по ключу) ──reset(B|A) / navigation(resetOn)──▶ idle
window:          idle ──trigger(kind, tab)──▶ open(until=now+s) ──tick/timeout/navigation──▶ idle
skipFirst:       counting(seen<skip) ──matched(B, seen≥skip)──▶ armed ──hits≥times / reset / navigation──▶ counting
```
Ключ экземпляра — `countKeyOf(rule, {tabId,url})`; `navigation(tab)` сбрасывает ключи `|t<tab>` и (для `rule`/`url`) все — как `resetForNavigation`. `tabRemoved` снимает экземпляры вкладки и allow-правило паузы.

## 5. Файлы

| Файл | Что |
|---|---|
| `utils/engines/dnr-translate.ts` | чистое: id-схема, `translateRule`, `planSessionUpdate`, `parseRuleIdFromError`, `hintForDnrError`, реактивный редьюсер `reactiveStep` |
| `utils/engines/dnr.ts` | `Engine` + `onTrigger`, `activeFor`, `report` (браузерные вызовы) |
| `utils/dnr-counters.ts` | ≈ счётчики через `webRequest` на выданных origin |
| `entrypoints/background.ts` | только hook-строки (импорт, `startDnrCounters`, `onTrigger` в 7 местах, `needsSite`) |
| `e2e/netblock/dnr.test.mjs`, `dnr.live.mjs` | Node-тесты чистой части; live через Playwright Chromium |

## 6. Риски

- `allow` и стадия заголовков: справочник говорит «redundant by a matching allow», но не «allow из стадии 1 переносится» — live-тест d проверяет паузу на обычном block; для `responseHeaders`-правил пауза проверяется вручную (в тесте нет — Chromium 153 в Playwright их поддерживает, добавить при необходимости).
- Холодный старт SW не измерен (S3 — тёплый): триггер → `updateSessionRules` может опоздать на первый запрос; подпись `reactiveParallelSlip` покрывает. Live-тест (c): A **заблокирован** → B сразу (0 мс) — 0/3 (отказ страницы и `onErrorOccurred` стартуют одновременно, это фактически «параллельный» случай S3), с паузой 10/30/100 мс — 3/3. Триггер в background вызывается **до** записи в `session:state` (Web Lock RMW стоил бы миллисекунды).
- `contains`/`equals` со спецсимволами уходят в regex-лимит (1 000/тип, наш soft-cap 200): редкий случай, честная ошибка браузера.
- Блокировка запросов **других расширений** (tabId −1) при scope `all`: намеренно не исключаем (`excludedTabIds:[-1]` отрезал бы и service worker страницы, который как раз надо тестировать); документировано в IMPLEMENTATION.md.
- `HeaderInfo.values` не имеют экранирования `*`/`?` — значение заголовка с этими символами матчится как wildcard (документируем в UI-подсказке).
