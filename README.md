# Browser extension suite

Четыре независимых расширения с общим ядром. Монорепо на npm workspaces, сборка — [WXT](https://wxt.dev).

> **Стадия: код готов, версия 1.0.0.** Предметная логика реализована и проверена вживую (e2e в headed-браузере), не мокирована. Расширения готовятся к публикации в Chrome Web Store и Firefox AMO (издатель — Blockaly, `<name>@blockaly.com`). Осталось нечто, что скриптом не сделать: **скриншоты для листингов** — их должен снять человек из настоящего браузера (см. [`STORE.md`](./STORE.md)).

## Почему четыре, а не одно

Chrome Web Store требует «a single purpose that is narrow and easy to understand» и прямо запрещает «bundles of unrelated functionality». Тест ревьюера: помещается ли цель в одну фразу.

| Расширение | Цель | Ключевые разрешения (из собранного манифеста) |
|---|---|---|
| [`extensions/blur`](./extensions/blur) | Скрыть нежелательный контент на странице | `storage`, `activeTab`, `scripting`, `contextMenus`; контент-скрипт `<all_urls>` (`document_start`) |
| [`extensions/adblock`](./extensions/adblock) | Блокировать рекламу и трекеры | `storage`, `activeTab`, `scripting`, `alarms`, `contextMenus` + `declarativeNetRequest`, `declarativeNetRequestWithHostAccess` и `optional_host_permissions: <all_urls>` (Chrome) / `webRequest`, `webRequestBlocking` и `<all_urls>` install-time (Firefox); контент-скрипт `<all_urls>` (`document_start`) |
| [`extensions/perf`](./extensions/perf) | Измерить производительность страницы | `storage`, `activeTab`, `scripting`, `devtools_page`; opt-in `debugger` (только Chrome) и `https://www.googleapis.com/*`; два контент-скрипта `<all_urls>` (`document_start`, сборщик в MAIN-мире + relay) |
| [`extensions/seo`](./extensions/seo) | Проверить разметку и доступность | **только** `storage` + `devtools_page` и `web_accessible_resources: axe-run.js`; контент-скрипт `<all_urls>` (`document_idle`) — ни `activeTab`, ни `scripting` |

**Важно и без прикрас: все четыре объявляют статический контент-скрипт с `matches: ["<all_urls>"]`**, то есть у всех четырёх при установке появляется предупреждение «читать и изменять все ваши данные на всех сайтах» — постоянный доступ, а не запрашиваемый на лету. Каждому он нужен по делу: `blur` обязан размыть контент **до первой отрисовки** (`document_start`), `adblock` прячет рекламные элементы (`display: none`) там, где сеть уже не поможет, `perf` регистрирует `PerformanceObserver` до старта отрисовки (иначе LCP/FCP уже упущены), `seo` читает разметку страницы. Но **доступ — это не сбор данных**: наружу ничего не уходит, единственное исключение — opt-in PageSpeed Insights в `perf` (см. ниже). Firefox-сборки объявляют `data_collection_permissions`: `none` у `blur`/`adblock`/`seo`, у `perf` — `required: none`, `optional: websiteActivity`.

`optional_host_permissions` есть только у `adblock` и только на Chrome: DNR считает `redirect`/`modifyHeaders` «unsafe»-действиями и применяет их лишь к origin'ам с **выданным** host-разрешением — паттерн `matches` контент-скрипта эту проверку не проходит, поэтому без него не сработала бы вырезка трекинг-параметров из URL. У `blur` этот ключ **удалён** (был мёртвым: `permissions.request()` никогда не вызывался). WXT не переносит этот MV3-ключ в MV2-сборку, поэтому на Firefox `adblock` берёт `<all_urls>` install-time.

`debugger` живёт только в `perf` — там точное измерение переданных байтов через CDP и есть основная работа. Он даёт полный доступ к трафику и показывает пользователю неубираемый баннер «расширение отлаживает этот браузер», поэтому в остальных расширениях его быть не может. Он opt-in и запрашивается по жесту пользователя.

## Структура

```
packages/core/       типы, дефолты настроек, DomRuleEngine
extensions/blur/     №1
extensions/adblock/  №2
extensions/perf/     №3
extensions/seo/      №4
```

`@blur/core` не импортирует браузерные API — он остаётся чистым, чтобы его можно было использовать одинаково из background, контент-скриптов, popup и DevTools-панелей. `DomRuleEngine` переиспользуется расширениями `blur` и `adblock`: механизм поиска элементов один, действие разное (`filter: blur()` против `display: none`).

## Запуск

```sh
npm install          # заодно выполнит `wxt prepare` в каждом воркспейсе

npm run dev:blur     # Chrome
npm run dev:adblock
npm run dev:perf
npm run dev:seo

npm run dev:blur:firefox   # то же под Firefox
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

Код Blockaly — MIT ([`LICENSE`](./LICENSE)). Стороннее — под своими лицензиями: React (MIT), `web-vitals` (Apache-2.0), axe-core (MPL-2.0), фильтр-листы `adblock` — это **данные** под GPL-3.0 / CC-BY-SA 3.0. Полные тексты: [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md); копия едет внутри каждого пакета (`extensions/<name>/public/THIRD-PARTY-NOTICES.md`), атрибуция фильтров — `extensions/adblock/public/rules/ATTRIBUTION.md`.
