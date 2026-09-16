# Browser extension suite

Пятнадцать независимых расширений с общим ядром и общим дизайн-пакетом (№15 `proof` отложен, поэтому в дереве — четырнадцать плюс №16 Request Blocker). Монорепо на npm workspaces, сборка — [WXT](https://wxt.dev).

> **Стадия:** первые четыре (blur, adblock, perf, seo) — код готов, версия 1.0.0, проверены вживую. Вторая волна из шести (devdata, export, assets, whoami, capture, compose) — предметная логика реализована из моков, typecheck 11/11 воркспейсов чист, сборка Chrome+Firefox для всех шести проходит, независимый аудит по каждому — в [`docs/audit/`](./docs/audit/). Третья волна (convert, linksafe, vision, sessions) — MVP, зелёная сборка. **№16 Request Blocker (`netblock`) построен 2026-09-15**: четыре движка, popup + tool page, Node- и live-тесты зелёные; пре-сабмит аудит — [`docs/audit/2026-09-15-netblock.md`](./docs/audit/2026-09-15-netblock.md). Осталось то, что скриптом не сделать: **скриншоты для листингов** — их должен снять человек из настоящего браузера (см. [`STORE.md`](./STORE.md)).
>
> Издатель — marek-devlab (`<name>@marek-devlab.github.io`). Мобильный таргет — **Firefox for Android** (Chrome на Android расширения не поддерживает вообще); `capture` десктоп-only и честно об этом заявляет.

## Документы

| Файл | Что внутри |
|---|---|
| [`TODO.md`](./TODO.md) | **Единый бэклог.** Что осталось по всем десяти. Начинать отсюда |
| [`PLAN.md`](./PLAN.md) | Research и архитектура всех десяти расширений (Часть I — blur, adblock, perf, seo; Часть II — capture, devdata, export, assets, whoami, compose) |
| [`STORE.md`](./STORE.md) | Чеклист публикации, тексты листингов, обоснования разрешений |
| [`PRIVACY.md`](./PRIVACY.md) | Privacy policy |
| [`docs/design/`](./docs/design/) | Полные UX/UI-макеты шести новых расширений (по файлу на каждое) |
| [`e2e/netblock-spikes/`](./e2e/netblock-spikes/REPORT.md) | Живые спайки платформы для №16 (Chromium 153 / Firefox 155): `debugger` ↔ DevTools, Firefox `redirectUrl`, латентность `updateSessionRules`, CDP Fetch ↔ WebSocket, `responseHeaders`+`block`, `@blur/netcore` вживую |
| [`docs/research/`](./docs/research/) | Deep-research по новым расширениям с первоисточниками 2024–2026 (сейчас: №16 [`netblock`](./docs/research/2026-09-15-netblock.md) — Request Blocker; дизайн — [`docs/design/netblock.md`](./docs/design/netblock.md)) |
| [`docs/audit/`](./docs/audit/) | Аудит всех десяти (2026-07-14): безопасность, отказоустойчивость, готовность к стору; пре-сабмит аудит №16 ([`2026-09-15-netblock.md`](./docs/audit/2026-09-15-netblock.md)) |
| [`docs/plans/netblock/`](./docs/plans/netblock/) | Планы фаз №16 с проверенными источниками (фундамент, четыре движка, UI, [store-compliance](./docs/plans/netblock/03-compliance.md)) |

## Почему десять, а не одно

Chrome Web Store требует «a single purpose that is narrow and easy to understand» и прямо запрещает «bundles of unrelated functionality». Тест ревьюера: помещается ли цель в одну фразу. Каждое расширение — отдельный продукт с отдельным манифестом; общий у них только код-фундамент (`@blur/core`, `@blur/ui`, `@blur/netcore` — сетевые кирпичи без browser-импортов: URL-матчер с семантикой DNR `urlFilter` и обёртка `chrome.debugger`, см. [`packages/netcore/README.md`](./packages/netcore/README.md)), не точка входа.

**Первая волна (v1.0.0, все с контент-скриптом `<all_urls>` → install-time доступ ко всем сайтам):**

| Расширение | Цель | Ключевые разрешения (из собранного манифеста) |
|---|---|---|
| [`extensions/blur`](./extensions/blur) | Скрыть нежелательный контент на странице | `storage`, `activeTab`, `scripting`, `contextMenus`; контент-скрипт `<all_urls>` (`document_start`) |
| [`extensions/adblock`](./extensions/adblock) | Блокировать рекламу и трекеры | `storage`, `activeTab`, `scripting`, `alarms`, `contextMenus` + `declarativeNetRequest`, `declarativeNetRequestWithHostAccess` и `optional_host_permissions: <all_urls>` (Chrome) / `webRequest`, `webRequestBlocking` и `<all_urls>` install-time (Firefox); контент-скрипт `<all_urls>` (`document_start`) |
| [`extensions/perf`](./extensions/perf) | Измерить производительность страницы | `storage`, `activeTab`, `scripting`, `devtools_page`; opt-in `debugger` (только Chrome) и `https://www.googleapis.com/*`; два контент-скрипта `<all_urls>` (`document_start`, сборщик в MAIN-мире + relay) |
| [`extensions/seo`](./extensions/seo) | Проверить разметку и доступность | **только** `storage` + `devtools_page` и `web_accessible_resources: axe-run.js`; контент-скрипт `<all_urls>` (`document_idle`) — ни `activeTab`, ни `scripting` |

**Вторая волна — сознательно спроектирована так, что ни у одного нет install-time `<all_urls>`** (ни у кого в baseline его нет — проверено на собранных манифестах скриптом `npm run guards`):

| Расширение | Цель | Ключевые разрешения (из собранного манифеста) |
|---|---|---|
| [`extensions/devdata`](./extensions/devdata) | Смотреть и конвертировать структурированные данные | `storage`, `contextMenus`, `activeTab`; `optional: scripting` + `optional_host: <all_urls>` (авто-формат JSON-страниц по тумблеру). Ноль сети |
| [`extensions/export`](./extensions/export) | Сохранить контент страницы в файл | `contextMenus`, `activeTab`, `scripting`, `storage`, `clipboardWrite`; `optional: downloads` (по требованию). `downloads` в baseline **нет** — сохранение через Blob + `<a download>` |
| [`extensions/assets`](./extensions/assets) | Показать, откуда взялся элемент страницы | `activeTab`, `scripting`, `storage`, `contextMenus`, `devtools_page`. Инспектор, не загрузчик: ни `downloads`, ни `webRequest`, ни `fetch` медиа |
| [`extensions/whoami`](./extensions/whoami) | Показать моё соединение и устройство | **только** `storage`; `optional_host: https://ipinfo.io/*` (ISP/ASN по клику). Без background SW. CSP `connect-src`: Cloudflare trace + ipinfo.io |
| [`extensions/capture`](./extensions/capture) | Записать вкладку и экспортировать медиа | `storage`, `unlimitedStorage`, `downloads`, `activeTab`, `tabCapture`, `offscreen`; `optional: desktopCapture` (Chrome). Firefox — без `tabCapture`/`offscreen`. CSP `connect-src 'none'`. Десктоп-only |
| [`extensions/compose`](./extensions/compose) | Написать и отформатировать текст перед вставкой | `storage`, `contextMenus`, `clipboardWrite`, `activeTab` + `sidePanel` (Chrome) / `sidebar_action` (Firefox). CSP `connect-src 'none'`. Превью: markdown-it → DOMPurify → closed Shadow DOM |

**№16 — построен 2026-09-15 (движки `dnr`/`page`/`debugger` для Chrome, `webrequest` для Firefox, popup + tool page; дизайн — [`docs/design/netblock.md`](./docs/design/netblock.md), планы — [`docs/plans/netblock/`](./docs/plans/netblock/), заметки по реализации — [`extensions/netblock/IMPLEMENTATION.md`](./extensions/netblock/IMPLEMENTATION.md)):**

| Расширение | Цель | Ключевые разрешения (из собранного манифеста) |
|---|---|---|
| [`extensions/netblock`](./extensions/netblock) | Блокировать, фейлить и задерживать сетевые запросы для тестирования отказоустойчивости фронтенда | Chrome: `storage`, `activeTab`, `alarms`, `scripting`, `webRequest` (только наблюдение), `declarativeNetRequest`, **`debugger`** (install-time — Chromium не позволяет объявить его optional, `kFlagCannotBeOptional`; Network-level mode **opt-in на вкладку** через диалог согласия в popup, ничего не attach'ится само; решение владельца 2026-09-15); `optional_host: <all_urls>` (по кнопке «Включить на этом сайте», per-site). Предупреждения при установке: «Read and change all your data on all websites» + «Access the page debugger backend» (от `debugger`) + «Block content on any page» (от DNR). Firefox: `storage`, `activeTab`, `alarms`, `webRequest`, `webRequestBlocking`, `<all_urls>` install-time (как у `adblock`), без `debugger`. CSP `connect-src 'none'`, ноль сети. Гварды: нет `declarativeNetRequestFeedback`, `debugger` в baseline только по allowlist (`netblock`), нет сетевого `connect-src` |

**Важно и без прикрас: все четыре объявляют статический контент-скрипт с `matches: ["<all_urls>"]`**, то есть у всех четырёх при установке появляется предупреждение «читать и изменять все ваши данные на всех сайтах» — постоянный доступ, а не запрашиваемый на лету. Каждому он нужен по делу: `blur` обязан размыть контент **до первой отрисовки** (`document_start`), `adblock` прячет рекламные элементы (`display: none`) там, где сеть уже не поможет, `perf` регистрирует `PerformanceObserver` до старта отрисовки (иначе LCP/FCP уже упущены), `seo` читает разметку страницы. Но **доступ — это не сбор данных**: наружу ничего не уходит, единственное исключение — opt-in PageSpeed Insights в `perf` (см. ниже). Firefox-сборки объявляют `data_collection_permissions`: `none` у `blur`/`adblock`/`seo`, у `perf` — `required: none`, `optional: websiteActivity`.

`optional_host_permissions` есть только у `adblock` и только на Chrome: DNR считает `redirect`/`modifyHeaders` «unsafe»-действиями и применяет их лишь к origin'ам с **выданным** host-разрешением — паттерн `matches` контент-скрипта эту проверку не проходит, поэтому без него не сработала бы вырезка трекинг-параметров из URL. У `blur` этот ключ **удалён** (был мёртвым: `permissions.request()` никогда не вызывался). WXT не переносит этот MV3-ключ в MV2-сборку, поэтому на Firefox `adblock` берёт `<all_urls>` install-time.

`debugger` живёт в двух расширениях, и в обоих он — часть основной работы: `perf` (точные переданные байты через CDP) и `netblock` (Network-level mode: реальный код ответа / реальный тип сетевой ошибки через CDP `Fetch` — ни один другой API этого не умеет). Он даёт полный доступ к трафику и показывает пользователю неубираемый баннер «расширение отлаживает этот браузер», поэтому в остальных расширениях его быть не может. ⚠️ `perf` объявляет его в `optional_permissions` — Chromium такое **молча вырезает** (`kFlagCannotBeOptional`), так что exact-bytes-путь `perf` в текущем виде не работает (см. `TODO.md`); `netblock` держит его install-time и включает только по явному переключателю на вкладке.

## Структура

```
packages/core/       типы, дефолты настроек, DomRuleEngine (без браузерных API)
packages/ui/         дизайн-токены, тема, примитивы (используют все шесть новых)
extensions/blur/     №1  ─┐
extensions/adblock/  №2   │ первая волна
extensions/perf/     №3   │ (v1.0.0)
extensions/seo/      №4  ─┘
extensions/devdata/  №6  ─┐
extensions/export/   №7   │
extensions/assets/   №8   │ вторая волна
extensions/whoami/   №9   │
extensions/capture/  №5   │
extensions/compose/  №10 ─┘
extensions/convert/  №11 ─┐
extensions/linksafe/ №12  │ третья волна
extensions/vision/   №13  │
extensions/sessions/ №14 ─┘
extensions/netblock/ №16  — Request Blocker (№15 proof отложен)
packages/netcore/    URL-матчер с семантикой DNR + обёртка CDP-сессии (без browser-импортов)
```

`@blur/core` не импортирует браузерные API — он остаётся чистым, чтобы его можно было использовать одинаково из background, контент-скриптов, popup и DevTools-панелей. `DomRuleEngine` переиспользуется расширениями `blur` и `adblock`: механизм поиска элементов один, действие разное (`filter: blur()` против `display: none`). `@blur/ui` — канонические дизайн-токены, тема (`useThemeController`/`ThemeToggle`) и примитивы; вторая волна собрана на нём (первые четыре пока держат свою копию токенов — миграция в бэклоге).

## Механические гарантии

`npm run guards` (`scripts/check-guards.mjs`, без зависимостей) прогоняет по всему дереву три проверки, каждая из которых закрывает класс ошибки, уже ловившийся здесь руками и невидимый на ревью до релиза:

1. **XSS-синки** — запрет `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`dangerouslySetInnerHTML`/`document.write`/`eval`/`new Function` в исходниках (недоверенный контент страниц и пользовательские документы попадают в привилегированные страницы с `chrome.*`). Дизайн `compose` просил ESLint-правило; `typescript-eslint` не поддерживает TypeScript 7 — поэтому запрет живёт здесь.
2. **Remote code** — CDN-URL (unpkg/jsdelivr/cdnjs) в бандле = мгновенный reject в CWS.
3. **`<all_urls>` в собранном манифесте** — WXT поднимает `matches` рантайм-регистрируемого контент-скрипта в install-time `host_permissions`, даже если тот не в `content_scripts`. Конфиг выглядит чистым, а манифест просит доступ ко всем сайтам. Проверять надо **собранный** манифест, а не конфиг.

## Запуск

```sh
npm install          # заодно выполнит `wxt prepare` в каждом воркспейсе

npm run dev:blur     # Chrome — первая волна
npm run dev:adblock
npm run dev:perf
npm run dev:seo

npm run dev:devdata  # вторая волна
npm run dev:export
npm run dev:assets
npm run dev:whoami
npm run dev:capture
npm run dev:compose

npm run dev:netblock # №16 Request Blocker (и dev:netblock:firefox)

npm run dev:blur:firefox   # то же под Firefox (у каждого есть :firefox-вариант)
```

`wxt prepare` генерирует `.wxt/` с типами и `#imports` — до первого `npm install` типы не резолвятся и `npm run typecheck` не пройдёт.

Сборка и упаковка:

```sh
npm run build            # все расширения
npm run build:perf       # одно
npm run zip              # + sources ZIP для AMO и Opera, автоматически
```

## Целевые браузеры

Три сборки покрывают восемь браузеров:

- `-b chrome` → Chrome, Edge, Brave, Vivaldi, Opera, Yandex
- `-b firefox` → Firefox desktop и Firefox for Android
- `-b safari` → Safari (плюс отдельный Xcode-пайплайн)

Подробности, включая почему на Firefox адблок и счётчик работают **точнее**, чем на десктопном Chrome, — в [`PLAN.md`](./PLAN.md) §2 и §12.

## Бюджет статических правил (Chrome, `adblock`)

Chrome гарантирует расширению только **30 000** включённых статических DNR-правил; всё сверх берётся из глобального пула, **общего с другими расширениями пользователя**. Уровню `aggressive` нужно 35 000 (easylist 20k + easyprivacy 9k + annoyances 6k). Поэтому `adblock` заранее считает бюджет и **предсказуемо деградирует**: оставляет easylist + easyprivacy (29 000 — внутри гарантии) и не включает annoyances, честно сообщая об этом в popup и на странице настроек, вместо того чтобы молча врать в UI. Код — `extensions/adblock/utils/backends/rule-budget.ts`. На Firefox бюджета нет.

## Приватность

Ни одно расширение не отправляет данные о посещаемых страницах наружу — при том что все четыре имеют постоянный доступ ко всем сайтам через контент-скрипт (см. выше: доступ ≠ сбор). Единственное исключение — опциональный PageSpeed Insights аудит в `perf`, который передаёт Google URL проверяемой страницы; он раскрыт в [`PRIVACY.md`](./PRIVACY.md) и объявлен в Firefox как `optional: ["websiteActivity"]`.

## Лицензии

Код marek-devlab — MIT ([`LICENSE`](./LICENSE)). Стороннее — под своими лицензиями: React (MIT), `web-vitals` (Apache-2.0), axe-core (MPL-2.0), фильтр-листы `adblock` — это **данные** под GPL-3.0 / CC-BY-SA 3.0. Полные тексты: [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md); копия едет внутри каждого пакета (`extensions/<name>/public/THIRD-PARTY-NOTICES.md`), атрибуция фильтров — `extensions/adblock/public/rules/ATTRIBUTION.md`.
