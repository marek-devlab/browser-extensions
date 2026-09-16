# netblock — фаза 1 (фундамент): план

> 2026-09-15. Спека — [`docs/design/netblock.md`](../../design/netblock.md) (v1.1), факты — [`docs/research/2026-09-15-netblock.md`](../../research/2026-09-15-netblock.md), спайки — [`e2e/netblock-spikes/REPORT.md`](../../../e2e/netblock-spikes/REPORT.md). Этот файл — что именно строит фаза 1 и на каком основании; код фазы 2 (движки, UI) пишут другие агенты по контракту из §3.

## 0. Проверенные источники (все 2024+)

| Факт | Источник | Дата |
|---|---|---|
| CWS: single purpose «narrow and easy to understand»; «request the narrowest permissions necessary»; privacy policy + prominent disclosure; «full functionality … discernible from its submitted code» | https://developer.chrome.com/docs/webstore/program-policies/policies | 2025-05-22 |
| Single purpose = narrow focus area; несколько функций одной темы допустимы | https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq | 2024-07-10 |
| DNR: `tabIds` — только session-правила; `responseHeaders` — Chrome 128+, block «still runs — page receives a blocked response»; `RuleConditionKeys` — 145+; session ≤ 5 000, regex ≤ 1 000 | https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest | 2026-09-11 |
| `storage.session` 10 МБ (Chrome 112+), `setAccessLevel` default `TRUSTED_CONTEXTS`; sync 8 192 Б/элемент, 102 400 Б всего; local 10 МБ | https://developer.chrome.com/docs/extensions/reference/api/storage | 2026-09-11 |
| ⚠️ **`debugger` не может быть optional**: справочник `permissions` — список «cannot be optional» включает `debugger` и `declarativeNetRequest` | https://developer.chrome.com/docs/extensions/reference/api/permissions | 2026-09-11 |
| То же в коде: `{kDebugger, "debugger", kFlagImpliesFullURLAccess \| kFlagCannotBeOptional \| kFlagRequiresManagementUIWarning}` (main и тег 128.0.6613.1); парсер даёт install warning «Permission '*' cannot be listed as optional. This permission will be omitted.» и вырезает ключ | https://raw.githubusercontent.com/chromium/chromium/main/chrome/common/extensions/permissions/chrome_api_permissions.cc · `extensions/common/manifest_handlers/permissions_parser.cc` · `extensions/common/manifest_constants.h` | main, 2026-09-15 |
| `debugger`: `onDetach` reasons `target_closed` / `canceled_by_user` | https://developer.chrome.com/docs/extensions/reference/api/debugger | 2026-09-11 |
| webRequest MV3: `ResourceType` (main_frame … webbundle, other); `onCompleted.statusCode`, `onErrorOccurred.error`; `webRequestBlocking` только policy-installed | https://developer.chrome.com/docs/extensions/reference/api/webRequest | 2026-09-11 |
| Firefox `ResourceType`: + `beacon`, `imageset`, `json`, `object_subrequest`, `speculative`, `web_manifest`, `xml_dtd`, `xslt` | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/ResourceType | 2026-08-21 |
| CDP `Network.ErrorReason` (14 значений), `Fetch.RequestStage` Request/Response, `failRequest`/`fulfillRequest`/`continueRequest` | https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json | tot, 2026-09-15 |
| WXT `storage.defineItem`: `fallback`/`init`/`version`/`migrations`; миграции при инициализации item'а, `getValue/setValue` их ждут; версия в `key$`; areas `local:/session:/sync:/managed:` | https://wxt.dev/storage.html | 0.20 |
| WXT: `manifest: ({browser, manifestVersion, mode}) => …`, MV3→MV2 автоконверсия; host_permissions для MV2+MV3 — «only include the required … for each version» | https://wxt.dev/guide/essentials/config/manifest.html | 0.20 |
| Web Locks доступен в workers (`WorkerNavigator.locks`), secure context, Baseline с 2022-03 | https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API | 2026 |
| Firefox `data_collection_permissions` обязателен для новых с 2025-11-03; `required: ['none']` — самостоятельное значение; desktop 140+, Android 142+ | https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/ | 2026-03-12 |

## 1. Решения

1. **⚠️ Отклонение от спеки §0/§3: `debugger` — в baseline `permissions` Chrome-манифеста (решение владельца, 2026-09-15; заменяет вариант фазы 1 «без `debugger`»).** Спека требовала `optional_permissions: ['debugger']`; проверенный факт — Chrome вырезает его с install warning (`kFlagCannotBeOptional`), а `permissions.request({permissions:['debugger']})` после этого отклоняется. Из двух честных вариантов (baseline — прецедент CWS Network Overrides API; или без `debugger` в v1) владелец выбрал **baseline**: без него у инструмента нет «реального кода ответа / реального типа сетевой ошибки» ни для одного типа ресурса, кроме xhr-имитации. Спека §11 («постоянно включённый NL на всех вкладках») соблюдена по существу: **ничего не attach'ится без явного включения на вкладке** из popup (диалог §2.7), detach на выключение / закрытие вкладки / Cancel в баннере / политику / 3 ошибки обработчика. Цена — предупреждение при установке «Access the page debugger backend» + «Read and change all your data on all websites». Обоснование для ревьюера — в заголовке `wxt.config.ts`; allowlist гварда — `BASELINE_DEBUGGER_ALLOWED.netblock`. Деградации фазы 1 (`nlUnavailableBuild`, `failReasonImitated` при `caps.debugger === false`) сохранены для сборок без разрешения. План движка — [`02-debugger.md`](02-debugger.md). ⚠️ Побочно: у `perf` та же латентная проблема (`optional_permissions: ['debugger']` — вырезается Chrome, живой смоук B не пройден по TODO) — не трогаем, только сообщаем.
2. **CSP `connect-src 'none'`**, а не «без connect-src» (спека §7.5): как в `capture`/`compose` — механический ноль сети сильнее отсутствия директивы. Гвард считает `'none'` соответствующим; любая другая `connect-src` — нарушение вне allowlist (`whoami`).
3. **Валидатор импорта — ручной** (как `adblock/backup-parse.ts`), без valibot: строгие ключи, запрет `__proto__`/`constructor`/`prototype`, лимиты §5.8/§7.1, regex через `checkRegexSafety` из `@blur/netcore`. Ошибки — с индексом правила и путём поля.
4. **Модули `utils/*` — чистые** (без `#imports`), кроме `storage.ts`; Node-тесты грузят реальные `.ts` через `module.registerHooks` (резолв `@blur/netcore` → `packages/netcore/src/index.ts`, дописывание `.ts` к относительным путям — index.ts пакета импортирует без расширений).
5. **Имена типов ресурсов — наши** (`xhr`, `script`, …, `other`), маппинг в DNR/Firefox/CDP внутри `resource-types.ts`; `ping`/`beacon` → `other`.
6. **Счётчики — чистая функция `decide()`** над снимком; PRNG mulberry32, состояние PRNG хранится в счётчике (seed ⊕ FNV-1a(ключ)), поэтому «тот же seed + тот же порядок = та же последовательность».
7. **Иконка** — `BRAND.netblock` + `markNetblock` в `scripts/lib/draw.mjs` (единственный генератор в репо); графитовый оттенок (нейтральный серый, не сине-серый `linksafe`), силуэт «линия с разрывом» (единственный разрыв в наборе).
8. **`activeTab` добавлен в baseline обоих таргетов** (без предупреждения): §0 спеки его не перечисляет, но §1.2/§10.2 опираются на него («host из activeTab»), а без него popup не узнаёт host вкладки и не может сформировать `permissions.request({origins})`. Отклонение от таблицы §0, не от замысла.
9. Firefox: `optional_permissions` не объявляем (host `<all_urls>` install-time как у `adblock`); `strict_min_version: '140.0'` — минимум для `data_collection_permissions`; `page.content.ts` на Firefox не регистрируется (page-движок Chrome-only).

## 2. Файлы и ответственность

| Файл | Ответственность |
|---|---|
| `wxt.config.ts` | Манифест на оба таргета, reviewer-facing обоснование, `build:manifestGenerated` — вырезать поднятый `<all_urls>` |
| `entrypoints/background.ts` | Оркестратор: rules → `compileRules` → `engine.apply`; роутер `protocol.ts`; `tabs.onRemoved`/`onUpdated`; alarm-watchdog (стаб); на старте `getSessionRules()` ∖ живые вкладки → `removeRuleIds` |
| `entrypoints/relay.content.ts` / `page.content.ts` | Стабы ISOLATED-релея и MAIN-скрипта, `registration: 'runtime'` (фаза 2: page-агент) |
| `entrypoints/popup/*`, `entrypoints/tool/*` | Минимальные оболочки на `@blur/ui` (фаза 2: UI-агент заменяет `App.tsx`) |
| `utils/rule-types.ts` | Типы правила, списки причин/типов, лимиты |
| `utils/rule-schema.ts` | `validateRulesDocument`, `validateRule`, `parseRulesImport` |
| `utils/resource-types.ts` | наши имена ↔ DNR ↔ Firefox ↔ CDP |
| `utils/status-match.ts` | `parseStatusPattern` → предикат |
| `utils/engine-select.ts` | `selectEngine`, `compileRules` (таблица §0 спеки + деградации) |
| `utils/state.ts` | `countKeyOf`, `decide`, `openWindow`, `markMatched`, `resetForNavigation`, `mulberry32` |
| `utils/storage.ts` | `defineItem`-ы + `withLock` |
| `utils/log.ts` | кольцевой буфер, маскирование, HAR без тел |
| `utils/protocol.ts` | типы сообщений popup/tool ↔ background |
| `utils/i18n.ts` | EN/RU/ET каталог, ключи честности §6 |
| `utils/engines/{types,index,dnr,page,debugger,webrequest}.ts` | контракт + стабы |
| `e2e/netblock/logic.test.mjs` | Node-тесты по реальным `.ts` |

## 3. Контракт `Engine` (фиксируется здесь, реализуется в фазе 2)

```ts
type EngineId = 'dnr' | 'page' | 'debugger' | 'webrequest';
interface Engine {
  readonly id: EngineId;
  readonly available: boolean;                 // есть ли API/разрешение в этой сборке
  supports(rule: Rule): boolean;               // = selectEngine(...).engine === id
  apply(set: CompiledRuleSet): Promise<void>;  // идемпотентно: полная замена своей части
  pauseTab(tabId: number): Promise<void>;      // снять всё для вкладки
  resumeTab(tabId: number): Promise<void>;
  dispose(): Promise<void>;                    // detach/unregister/remove — вызывается в finally
  onEvent(cb: (e: EngineEvent) => void): () => void;  // log | hit | error | detached
}
```
`CompiledRuleSet = { byEngine: Record<EngineId, CompiledRule[]>; inactive: InactiveRule[]; compiledAt }`, `CompiledRule = { rule, engine, notes: HonestyKey[], degraded?: HonestyKey }`. Fail-open: движок, бросивший в `apply`, не блокирует остальные (спека §8).

Протокол (`utils/protocol.ts`): `getTabSummary`, `listRules`, `saveRule`, `deleteRule`, `reorderRules`, `resetCounters`, `pauseTab`, `setNetworkLevel`, `getLogPage`, `clearLog`, `subscribeLog`, `testUrl`, `exportRules`, `importRules`, `getPermissionStatus`, `requestSiteAccess`, `openWindowTrigger`; push от background: `log:append`, `nl:detached`, `rules:applied`.

## 4. Открытые риски

- ~~Решение по `debugger` (baseline vs без)~~ — принято: baseline (§1.1), движок реализован ([`02-debugger.md`](02-debugger.md)).
- `RuleConditionKeys` (145+) — feature-detect в background; в старом Chrome секция «заголовки ответа» disabled с причиной.
- Холодный старт SW для реактивного DNR не измерен (спайк S3 — тёплый SW).
- `perf`: `optional_permissions: ['debugger']` — та же проблема, требует отдельного решения владельца.
