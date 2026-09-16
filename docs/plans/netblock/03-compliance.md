# netblock — фаза 3 (store compliance + документация): план и матрица политик

> 2026-09-15. Код фаз 1–2 зелёный; эта фаза пишет только документы: `PRIVACY.md`, `STORE.md`, `TODO.md`, `PLAN.md` IV, `README.md`, `extensions/netblock/README.md`, аудит [`docs/audit/2026-09-15-netblock.md`](../../audit/2026-09-15-netblock.md). Дефекты кода — в аудите (§d), не чинятся здесь. Цель владельца №1: **пройти ревью CWS и AMO**.

## 0. Проверенные источники (все 2024+; цитаты дословно в аудите и STORE.md)

| Факт | Источник | Дата |
|---|---|---|
| Single Purpose: «narrow and easy to understand»; несколько функций одной темы допустимы (FAQ) | https://developer.chrome.com/docs/webstore/program-policies/policies · https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq | 2025-05-22 · 2024-07-10 |
| Use of Permissions: «narrowest permissions necessary… If more than one permission could be used… least access» → Purple Potassium («requesting a permission but not using it / not required») | https://developer.chrome.com/docs/webstore/program-policies/policies · https://developer.chrome.com/docs/webstore/troubleshooting | 2025-05-22 · 2026-07-20 |
| MV3: «full functionality… discernible from its submitted code»; remote execution только через Debugger API и User Scripts API (Blue Argon) | https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements | 2024-04-03 |
| Limited Use 2026: сбор «strictly necessary», prominent disclosure всего сбора, enforcement 2026-08-01 | https://developer.chrome.com/blog/cws-policy-updates-2026 | 2026-07-01 |
| Одна апелляция на нарушение | https://developer.chrome.com/blog/cws-policy-updates-2025 | 2025-01-22 |
| Листинг: поведение должно совпадать с описанием («behavior… matches the descriptions») | https://developer.chrome.com/blog/cws-policy-updates-2024 | 2024-07-10 |
| Privacy policy обязательна даже при локальном хранении (FAQ Q14); browsing activity = «domains or URLs the browser interacts with» | https://developer.chrome.com/docs/webstore/program-policies/user-data-faq | действующая редакция |
| Предупреждения: `debugger` → «Access the page debugger backend» + «Read and change all your data on all websites»; `declarativeNetRequest` → «Block content on any page»; `declarativeNetRequestFeedback` → «Read your browsing history»; `storage/activeTab/alarms/scripting/webRequest` — нет | https://developer.chrome.com/docs/extensions/reference/permissions-list | 2026-09-09 |
| `debugger`, `declarativeNetRequest`, `devtools`, `geolocation`, `mdns`, `proxy`, `tts`, `ttsEngine`, `wallpaper` — «cannot be specified as optional» | https://developer.chrome.com/docs/extensions/reference/api/permissions | 2026-09-11 |
| `{kDebugger, "debugger", kFlagImpliesFullURLAccess \| kFlagCannotBeOptional \| kFlagRequiresManagementUIWarning}` | https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/permissions/chrome_api_permissions.cc | main, 2026-09-15 |
| Chrome 155: `debugger.attach()` отклоняется при enterprise blocked hosts / DLP — «Always handle attach rejections» | https://developer.chrome.com/blog/debugger-enterprise-policy-restrictions | 2026-09-08 |
| Листинг: summary ≤ 132 символа; скриншоты 1280×800 или 640×400, ≥ 1 (лучше 5); промо 440×280, marquee 1400×560 | https://developer.chrome.com/docs/webstore/best-listing | 2024-08-02 |
| Privacy practices: single purpose, justification на каждое разрешение (лимит символов не документирован; принято ≤ 1000), remote code Yes/No, data usage чекбоксы, privacy policy URL | https://developer.chrome.com/docs/webstore/cws-dashboard-privacy | действующая редакция |
| AMO 3.1: исходники при бандлере/минификаторе, воспроизводимая сборка; 4: только необходимые разрешения, no remote code, не ослаблять CSP/security headers, «avoid redundant code»; 6.2.1: `data_collection_permissions` в манифесте | https://extensionworkshop.com/documentation/publish/add-on-policies/ | 2026-04-30 (в силе с 2025-08-04) |
| Окружение ревьюера AMO: Ubuntu 24.04.4 ARM64, Node 24.14.0, npm 11.9.0; lockfile обязателен; diff должен быть пустым | https://extensionworkshop.com/documentation/publish/source-code-submission/ | ред. 2026-03 |
| Data consent: обязателен для новых с 2025-11-03; «transmission» = данные, покидающие браузер; `none` — самостоятельное значение; desktop 140+, Android 142+ | https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/ · https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/ | 2026-03-12 · 2025-10-23 |
| Firefox-предупреждения: `<all_urls>` → «Access your data for all websites»; `webRequest`, `webRequestBlocking`, `storage`, `alarms`, `activeTab` — без промпта | `toolkit/locales/en-US/toolkit/global/extensions.ftl` (mozilla-firefox main) · https://extensionworkshop.com/documentation/develop/request-the-right-permissions/ | 2026-09-15 · подтв. |
| Firefox продолжает поддерживать blocking webRequest и MV2 | https://blog.mozilla.org/en/firefox/firefox-manifest-v3-adblockers/ · https://blog.mozilla.org/addons/2024/03/13/manifest-v3-manifest-v2-march-2024-update/ | 2025-02-25 · 2024-03-13 |
| Android: `gecko_android: {}` для листинга; event pages рекомендованы; нет devtools/menus | https://extensionworkshop.com/documentation/develop/differences-between-desktop-and-android-extensions/ · MDN `browser_specific_settings` | 2024-01-17 · 2026-04-20 |
| addons-linter: `UNSAFE_VAR_ASSIGNMENT` (React), CSP с `script-src 'self'` проходит, `connect-src` не инспектируется; `NONE_DATA_COLLECTION_IS_EXCLUSIVE` | https://github.com/mozilla/addons-linter/blob/master/docs/rules.md | master, 2026-09-15 |

## 1. Матрица «политика → соответствие» (кратко; доказательства file:line — аудит §b)

| Политика | CWS | AMO | Статус |
|---|---|---|---|
| Single purpose одной фразой | «Block, fail and delay network requests for frontend resilience testing» | то же | ✅ |
| Минимальные разрешения | 7 install-time, все с обоснованием; `debugger` — единственный путь к реальному статусу/типу ошибки | 6, профиль `adblock` | ✅ / ⚠️ эвристика ревьюера |
| Remote code | нет; правила = данные; Debugger API — санкционированный путь, но мы им код не исполняем | нет | ✅ |
| Сбор данных / disclosure | ноль передачи (`connect-src 'none'`); лог — `session`, маска; in-product тексты | `required: ['none']` | ✅ |
| Privacy policy | `PRIVACY.md` «Request Blocker» (нужен хостинг) | не обязательна, ссылка рекомендована | ✅ текст |
| Честность листинга | копия без слов §11; UI-копия — 3 🟡 (workers, Revoke, «не просим при установке») | то же | 🟡 до сабмита |
| Исходники / сборка | не требуется | обязательны (WXT+Vite) — README с окружением | ⏳ человек |
| Ассеты | промо 440×280 есть; скриншоты — 5 состояний (STORE.md) | скриншоты | ⏳ человек |

## 2. Риски ревью, по убыванию (честная оценка)

1. **`debugger` в baseline у нового издателя** (вероятность замечания ~30 %). Не нарушение политики (optional невозможен; 11 живых прецедентов — §3), но эвристика «слишком много власти» + семь разрешений. Митигация: justification-текст называет API-альтернативы и почему они не работают, opt-in-гейт, список CDP-команд, отсутствие `getResponseBody`; скриншот диалога согласия; при отказе — одна апелляция со ссылкой на `utils/engines/debugger.ts` и прецеденты.
2. **Purple Potassium на `webRequest` или `activeTab`** (~10 %): ревьюер может счесть их избыточными при `debugger`. Митигация: тексты объясняют наблюдение (не blocking) и host popup; `activeTab` реально нужен — `tabs.get().url` скрыт без него даже при `debugger` (live).
3. **Лог = browsing activity** (~5 %): Limited Use допускает для «user-facing feature described prominently» — лог описан в листинге и в UI, `session`-only, не передаётся.
4. **Yellow Zinc (скриншоты/описание не раскрывают функции)** (~5 %): закрывается пятью скриншотами по списку.
5. **AMO**: `<all_urls>` + `webRequestBlocking` — стандартный вопрос, текст готов; мёртвые Chrome-файлы в пакете — «should avoid», объяснено в notes. (~10 % запроса уточнений, отказ маловероятен.)

Итог: CWS с первой попытки ~65–75 %, после апелляции ~90 %; AMO ~90 %.

## 3. Прецеденты (CRX с update-эндпоинта Google, проверено 2026-09-15; листинги живые)

| Расширение | CWS | `permissions` (baseline) | Обновлён / польз. |
|---|---|---|---|
| Netify (CDP Fetch-прокси) | https://chromewebstore.google.com/detail/mdafhjaillpdogjdigdkmnoddeoegblj | `["debugger","tabs","contextMenus","storage"]`, без host | 2025-11-18 / 6 000; исходники https://github.com/vladlavrik/netify |
| Network Overrides API (DevTools) | https://chromewebstore.google.com/detail/holdjgmcnpelgclhopiejilhhkfcmpba | `["storage","debugger"]` + `<all_urls>`; в описании — «debugger: required to intercept and fulfill requests through the CDP» | **2026-09-05** / 73 |
| Playwright Extension (Microsoft) | https://chromewebstore.google.com/detail/mmlmfjhmonkocbjadbfplnigmagldckm | `["debugger","activeTab","tabs","tabGroups"]` + `<all_urls>`; https://github.com/microsoft/playwright/blob/main/packages/extension/manifest.json | 2026-09-01 / 100 000 |
| Automa | https://chromewebstore.google.com/detail/infppggnoaenmfagbfknfkancpbljcca | baseline `debugger` (+ `webNavigation`, `scripting`…), https://github.com/AutomaApp/automa/blob/main/src/manifest.chrome.json | 2026-07-23 / 200 000 |
| axe DevTools (Deque) | https://chromewebstore.google.com/detail/lhdoppojpmngadmnindnejefpokejbdd | `["tabs","debugger","storage","unlimitedStorage"]` | 2026-09-09 / 400 000 |
| Claude in Chrome (Anthropic) | https://chromewebstore.google.com/detail/fcoeoabgfenejglbffodgkkbkcdhcgfn | baseline `debugger` среди 16 | 2026-09-12 / 16 M |
| Browser MCP · Ui.Vision RPA · Katalon Recorder · Adobe Experience Platform Debugger · NiM | см. аудит-исследование | baseline `debugger` | 2025–2026 |

Контрпримеры (без `debugger`): Requestly (DNR + `proxy` + `webRequest`), tweak (page-патч + DNR), Mokku. Единственный публичный отказ, связанный с `debugger`: NiM, Purple Potassium «permission not used», 2024-06-07 — снят апелляцией с демонстрацией кода (https://blog.june07.com/chrome-web-store-rejection-notification-purple-potassium/). Ни одного найденного отказа/удаления за сам факт `debugger` в baseline (2024–2026: chromium-extensions, SO, GitHub).

## 4. Что нужно для сабмита (человеческие шаги, по порядку)

1. Закрыть 🟡-1…3 аудита (копия «workers», кнопка Revoke, «не просим при установке») — кодовый агент.
2. Ручной headed-смоук (`docs/netblock-headed-smoke.md`): промпт per-site, жёлтый баннер + Cancel, DevTools Request conditions ∥ NL, Android.
3. Скриншоты (5 состояний из STORE.md), взгляд на иконку/промо-тайл.
4. Хостинг `PRIVACY.md` на `https://github.com/marek-devlab/browser-extensions/blob/main/PRIVACY.md`; аккаунты CWS/AMO.
5. CWS: `npm run build:netblock` → zip; Privacy practices — тексты из STORE.md (8 justification'ов ≤ 1000 симв., remote code = No, data usage = ничего, 3 сертификации), категория Developer Tools, summary 115 симв., описание из STORE.md.
6. AMO: `wxt zip -b firefox` + sources ZIP (без `node_modules`/`.output`, с `package-lock.json`) + README (Ubuntu 24.04.4 ARM64 / Node 24.14.0 / npm 11.9.0; `npm ci` → `npm run build:firefox --workspace @blur/netblock`), notes to reviewers из STORE.md; прогнать `addons-linter` на zip.
7. Edge Add-ons (тот же zip; notes for certification с демо-страницей 500/задержек), Opera.
