# netblock — фаза 4 (финальный adversarial-аудит + фиксы): план

> 2026-09-15. Один аудитор, после фаз 1–3 (всё зелёное). Цель владельца — пройти CWS/AMO с первой попытки. Прочитано целиком: `IMPLEMENTATION.md`, аудит `docs/audit/2026-09-15-netblock.md`, планы 03-*, `STORE.md`/`PRIVACY.md` (Request Blocker), дизайн §6/7/8/11, весь `extensions/netblock/{wxt.config.ts,entrypoints/**,utils/**}`, `packages/netcore/src/*`, собранные манифесты и бандлы (`grep` по `eval(`/`new Function`/`getResponseBody`/`declarativeNetRequestFeedback`/`onRuleMatchedDebug`/`Runtime.`/`DOM.`/`Network.` — 0 везде; CDP-строки только `Fetch.enable/disable/continueRequest/failRequest/fulfillRequest/requestPaused`, `Page.enable/frameNavigated/getFrameTree`).

## 0. Проверенные источники (2024+)

| Факт | Источник |
|---|---|
| Жёлтый инфобар закрывается через 5 с после последнего detach (`kAutoCloseDelay = base::Seconds(5)`) — копия `nlDialogSee` верна | https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/debugger/extension_dev_tools_infobar_delegate.h (main, 2026-09-15) |
| `browser_action.default_icon` optional; MDN не описывает fallback на `icons` | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_action |
| `MessageSender.url` есть у страниц расширения, `sender.tab` — у content script'ов; без `externally_connectable` веб-страницы слать `runtime.sendMessage` не могут | https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender (2026) |
| «behaviour must match descriptions» (listing honesty) | https://developer.chrome.com/blog/cws-policy-updates-2024 (2024-07-10) |
| `tabs.onUpdated`: `changeInfo.status` приходит всегда, `url`/`title` — только при host-доступе | https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onUpdated (2026) |

## 1. Находки (ранжировано; file:line — снимок до правок)

### 🔴 Блокеры магазина — не найдено
Политики (single purpose, permissions, remote code, CSP `connect-src 'none'`, лог только в `session`, маска креденшлов, `getResponseBody` отсутствует) подтверждены кодом и бандлом. Ниже — дефекты корректности/безопасности и ложь в копии, которые чиню все.

### 🟡 Should-fix (всё чинится в этой фазе)

| # | Где | Сценарий отказа | Фикс |
|---|---|---|---|
| 🟡-1 | `entrypoints/background.ts:392-475` (`saveRule`/`deleteRule`/`saveGroup`/`reorderRules`/`importRules`), `utils/rule-schema.ts:590-614` | Кросс-правильные инварианты (`afterRule` → существующее правило, `groupId` → существующая группа, ≤ 200 regex, ≤ 2000 правил, ≤ 2 МБ) проверяются ТОЛЬКО при загрузке документа. Удалили правило A, на которое ссылается B (`afterRule`) → B живёт до перезапуска SW (~30 с простоя), потом `validateRulesDocument` молча выбрасывает B из памяти, а `updateRules` (RMW по сырому storage) возвращает его обратно — правило «мигает». `saveGroup` вообще не валидирует объект (`msg.group` пишется как есть). Ошибки валидации storage никуда не показываются (комментарий в `init()` обещает обратное) | Новый чистый модуль `utils/rules-commit.ts`: `planRulesCommit(raw, mutate)` — старт от валидной проекции storage, мутация, полная валидация результата + лимит байт; при ошибке ничего не пишется, ошибки уходят в UI. `deleteRule` отказывает, если есть зависимые `afterRule` (сообщение с именем). Редактор показывает отказ удаления. Ошибки storage → `applied.errors`. Node-тесты |
| 🟡-2 | `utils/engines/page.ts:153-194` (`onRelayEvents`) | Враждебная страница на включённом сайте читает nonce из DOM и шлёт через relay произвольные `relay:event`: `hit` с любым `key`/`counter` (неограниченный рост `session:state` → квота 10 МБ → отказ записи счётчиков всех движков), `log` с URL любой длины/чужими `ruleId`. Дизайн §7.3 допускает «портит свои счётчики», но не DoS хранилища | `sanitizePageEvents()` (чистая, в `page-core.ts`): ≤ 500 событий на пачку; `ruleId` ∈ текущие page-правила; `key` = `countKeyOf`-форма этого правила, ≤ 4 КБ; счётчик — целые ≥ 0, `hits ≤ seen`; `outcome` из перечисления; `status` 100–999; `delayMs ≤ LIMITS.delayMs`; URL/ошибка усечены. Node-тесты |
| 🟡-3 | `entrypoints/background.ts:361-382` (`runtime.onMessage`) | Привилегированные сообщения (`saveRule`, `importRules`, `setNetworkLevel`…) принимаются от любого отправителя; сегодня путь эксплуатации закрыт (нет `externally_connectable`, relay шлёт только `relay:*`), но проверки отправителя нет вообще — ревьюер, читающий код, спросит | `isPrivilegedSender(sender, base)` в `protocol.ts` (чистая, тест): `sender.id === runtime.id` и `sender.url` начинается с `runtime.getURL('/')`; иначе `{ok:false, error}`; `relay:*` — только от вкладок |
| 🟡-4 | `utils/debugger-eval.ts:250-263` (`fulfillHeaders`) | `status` с `text/html`-телом (≥ 400, `nosniff`) на запросе типа `Document` → HTML пользователя рендерится в origin сайта со скриптами. Это правило самого пользователя (как DevTools overrides), но дизайн §7.1 хотел «не быть инструментом инъекции HTML в чужой origin» — `nosniff` навигацию не останавливает | Заголовок `Content-Security-Policy: sandbox` на КАЖДОМ синтетическом ответе: документ рендерится (страница ошибки видна), скрипты/формы/same-origin — нет; для fetch/XHR CSP-заголовок ответа игнорируется. Тест |
| 🟡-5 | `utils/i18n.ts` EN `:59-62,84-86,50-51,301,344`; RU/ET зеркала; `entrypoints/tool/pages/SettingsPage.tsx:259-282` | Ложь в копии (ревьюер читает UI): «workers» в NL-описании и диалоге (Fetch воркеры не видит); `puNlUnavailable` «does not ask for it at install» — неправда для этого манифеста; `nlDialogBreak` «fall back to the regular engines» — dbg-правила становятся неактивными, а не перекладываются; `puBlockWorksWithout` слишком широко (Block с `nth`/`once`/`probability` идёт на page-движок = нужен доступ); `settingsPageEngineHint` «fall back to inactive» — на деле требуют NL; `engineDebuggerLong` «every resource type» (не WebSocket). Мёртвая кнопка «Revoke» (`permissions.remove` на обязательном разрешении → reject, «Uncaught (in promise)») | Переписать строки в трёх локалях; убрать `stRevoke`/`stNlGranted`/`stNlNotGranted`, добавить честную строку «granted at install, cannot be optional, attaches only per tab». Тест: ни одной строки NL с «worker» в трёх локалях |
| 🟡-6 | `STORE.md:605,661,757`; `PRIVACY.md:757`; `IMPLEMENTATION.md:280`; `STORE.md:727` | «no listener exists on an idle install» — ложь: `utils/engines/webrequest.ts:173-187` регистрирует НЕблокирующие `onCompleted`/`onErrorOccurred` при первом `apply()` (это источник лога, дизайн §2.5 — так и задумано, но копия обещает иное); «for every resource type» (WebSocket и 7 типов вне Fetch-фильтра); «the package contains no URL of a marek-devlab server» — в манифесте есть `homepage_url: https://github.com/marek-devlab/browser-extensions` (никогда не запрашивается) | Точная копия: «blocking listeners only while rules exist; a non-blocking observer feeds the request log»; «for every resource type the debugging protocol can pause (not WebSocket)»; «the only marek-devlab URL is the manifest `homepage_url`, never fetched» |
| 🟡-7 | `entrypoints/background.ts:318` (`tabs.onUpdated`: `!tab.url → return`) | Без host-доступа Chrome прячет `tab.url`, а `status: 'loading'` приходит. Значит `resetOn: 'navigation'` и `window(trigger:'navigation')` НЕ срабатывают на вкладках без доступа — ровно сценарий NL-режима (dbg-правила не требуют доступа): счётчик `nth: 3` переживает перезагрузку страницы | Не требовать `tab.url`; `url: tab.url ?? ''`. Live-проверка в `debugger.live.mjs`: `timeout|t<tab>` исчезает после `page.reload()` |
| 🟡-8 | `background.ts:213` (`void onEngineEvent`), `:273-286` (IIFE без catch), `:318-336`, `:620-636` (`prefs.watch`), `:141` (`ready` без catch); `popup/App.tsx:221-236`; `SettingsPage.tsx:245-249` | Отказ записи `session:state`/`session:log` (квота) → необработанные rejection'ы в SW/попапе (шум в консоли, который ревьюер увидит); `init()` без catch → любой сбой storage навсегда ломает все ответы | `.catch` с записью в `applyErrors` (виден в UI); `ready` не реджектится |

### 🟢 Заметки (< 15 строк — правлю; иначе → `TODO.md` №16 «Остаток»)

- 🟢-1 Устаревшие комментарии/мёртвый код: `engine-select.ts:13` («NOT in the v1 build»), `background.ts:43-44` («engines are stubs»), `:186` `TODO(phase-2)`, `netblock-page.content.ts:571-573` (`void origGetAllResponseHeaders`). Правлю.
- 🟢-2 Firefox `browser_action` без `default_icon` (WXT не переносит `action.default_icon` в MV2; так у всех расширений монорепо; Firefox берёт `icons` как fallback — `ext-browserAction.js`). Не netblock-специфично → TODO.
- 🟢-3 `matchesUrlCondition` для `regex` компилирует `RegExp` и гоняет `checkRegexSafety` на КАЖДЫЙ запрос в blocking-листенере Firefox — корректно (гард есть везде: page/webrequest/debugger/dnr-counters/testUrl), но лишняя работа → TODO (кэш скомпилированных regex в netcore).
- 🟢-4 `relay:click` и MAIN-`click` не проверяют `isTrusted`: страница может программно открыть свои `window(click)`-окна (в т.ч. глобальные). Осознанно: программные клики — часть автотестов; остаток документирован.
- 🟢-5 `Access-Control-Allow-Origin` + `Allow-Credentials` на синтетическом ответе: ответ наш, серверных данных нет — не CORS-обход. Оставляю, комментарий уже есть.
- 🟢-6 Мёртвый Chrome-код в Firefox-пакете, persistent background на Firefox — известно (аудит 🟢-1/🟢-4), TODO.
- 🟢-7 `nlDialogSee` «about 5 s» — подтверждено источником (§0) ✓. `wxt.config.ts` header, `README.md` расширения — честны ✓.

## 2. Порядок работ

1. `utils/rules-commit.ts` + `background.ts` (🟡-1, 🟡-3, 🟡-7, 🟡-8) + `RuleEditor.tsx` (показ отказа удаления) + `App.tsx`/`SettingsPage.tsx` catch.
2. `page-core.ts` `sanitizePageEvents` + `engines/page.ts` (🟡-2).
3. `debugger-eval.ts` CSP `sandbox` (🟡-4).
4. `i18n.ts` ×3 локали + `SettingsPage.tsx` (🟡-5).
5. Тесты: `logic.test.mjs` (commit-план, sender, i18n), `page.test.mjs` (sanitize), `debugger.test.mjs` (CSP), `debugger.live.mjs` (reload → reset).
6. Документы: STORE/PRIVACY/README/IMPLEMENTATION/аудит «Post-fix status», TODO №16.
7. Полная верификация (typecheck, оба билда, guards, Node-цепочка, Playwright 21, четыре live-сьюта, grep бандла).

## 3. Итог (после правок, 2026-09-15)

Все 🟡 закрыты, 🟢-1 закрыт, 🟢-2/3/4/6 → `TODO.md` №16 «Остаток». Верификация: typecheck ✔, Chrome + Firefox ✔, guards ✔ (4 манифеста); Node: logic 46 · dnr 24 · page 27 · webrequest 20 · debugger 25 · netcore 17; Playwright 21/21; live: dnr 15/15 · page 28/28 · debugger 34/34 · Firefox 20/20. Бандл Chrome: `eval(`/`new Function`/`getResponseBody`/`declarativeNetRequestFeedback`/`onRuleMatchedDebug`/`Runtime.`/`DOM.`/`Network.enable` — 0. Статус по каждой находке — «Post-fix status» в `docs/audit/2026-09-15-netblock.md`.
