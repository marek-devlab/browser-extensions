# План имплементации: десять расширений

> Набор из **десяти браузерных расширений**, собираемых из одного monorepo (WXT + общее ядро `@blur/core` + `@blur/ui`) в **две волны**: волна 1 — blur, adblock, perf, seo; волна 2 — capture, devdata, export, assets, whoami, compose.
>
> Этот документ — **слой архитектуры и исследования**: «почему» и «как», решения по расхождениям браузеров, сверка фактов с первоисточниками. **Живой статус** — что сделано, что осталось, известные проблемы — живёт в [`TODO.md`](./TODO.md), и именно он единственный источник правды по статусу.
>
> Основано на нескольких раундах deep-research с адверсариальной верификацией; числа сверены с первоисточниками (developer.chrome.com, MDN, W3C, wxt.dev, GitHub) на 2026-07-10 (волна 1) и 2026-07-14 (волна 2).
>
> ⚠️ — факты, опровергшие ранние предположения. Читать внимательно: там ломается «очевидная» архитектура.

---

# ЧАСТЬ I — Волна 1: blur, adblock, perf, seo

## 🔴 0. Главное решение: это ЧЕТЫРЕ расширения, а не одно

Политика Chrome Web Store, [Quality guidelines](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines) (обновлена 22.05.2025), дословно:

> «An extension must have a **single purpose that is narrow and easy to understand**. Don't create an extension that requires users to accept **bundles of unrelated functionality**. If two pieces of functionality are clearly separate, they should be put into two different extensions, and users should have the ability to install and uninstall them separately.»

И в примерах нарушений там же: *«Toolbars that provide a broad array of functionality or entry points into services are better delivered as separate extensions»*.

**Тест ревьюера**: можно ли записать цель расширения одной короткой фразой, и служит ли ей каждая фича и каждое разрешение? Если для объяснения нужно «и» между несвязанными доменами — отказ.

⚠️ **«Выключено по умолчанию» не лечит нарушение single purpose.** Стор оценивает *возможности и заявленную цель*, а не рантайм-дефолты. Код и разрешения всё равно в пакете и всё равно проверяются. Модульность помогает с *минимизацией разрешений*, но не заменяет разделение.

### Разделение

Тест ревьюера — «можно ли записать цель одной фразой». Проверяем каждое:

| # | Расширение | Цель одной фразой | Разрешения | Риск ревью |
|---|---|---|---|---|
| 1 | **Content Blur**<br/>`extensions/blur` | «Скрыть нежелательный контент на странице» | `storage`, `activeTab`, `scripting` | низкий |
| 2 | **Ad & Tracker Blocker**<br/>`extensions/adblock` | «Блокировать рекламу и трекеры» | + `declarativeNetRequest` (Chrome) / `webRequest` (Firefox) | низкий |
| 3 | **Page Performance & Network**<br/>`extensions/perf` | «Измерить производительность страницы» | + `devtools_page`, `debugger` (**opt-in**) | средний |
| 4 | **SEO & Accessibility Auditor**<br/>`extensions/seo` | «Проверить разметку и доступность» | `storage`, `activeTab`, `scripting`, `devtools_page` | минимальный |

Почему **AdGuard** (адблок + трекеры + annoyances + статистика) живёт в сторе одним пакетом: всё сводится к одной фразе. Статистика — отчётность *о той же цели*, не отдельная цель. А вот блюр контента, инспектор трафика по CDP и SEO-аудит — три разные профессии.

⚠️ **`debugger` — причина, по которой perf и seo разделены.** Он даёт полный CDP-доступ: подключиться к любой вкладке, читать и менять весь трафик. Показывает пользователю **неубираемый жёлтый баннер** «расширение отлаживает этот браузер», конфликтует с открытым DevTools (только один клиент за раз). Расширения с `debugger` публикуются — но только когда отладка **и есть** их очевидная цель.

Держать его **исключительно** в №3, где точное измерение байтов по CDP — основная работа, и запрашивать через `optional_permissions` в момент включения фичи. SEO-аудитору хватает `activeTab` + `scripting`, и он проходит ревью тривиально. Инспектор мета-тегов, просящий отладочный доступ к браузеру, — это учебниковый пример рассинхрона разрешений и цели.

**Коды отказов, которые грозили бы одним пакетом:** single purpose (Red-семейство) + **Purple Potassium** (избыточные разрешения). Часто выдают вместе.

**Firefox AMO** — жёсткого правила single purpose **нет**. Требуется: точное соответствие описания функциональности, а «неожиданные» фичи должны быть opt-in и раскрыты в описании. То есть на AMO можно было бы и одним пакетом. Но раз Chrome заставляет разделять — разделяем везде.

> Практически: **общий monorepo, общее ядро `@blur/core`, четыре сборки-таргета.**
>
> ```
> packages/core/          типы, дефолты, DomRuleEngine, мок-данные
> extensions/blur/        №1
> extensions/adblock/     №2
> extensions/perf/        №3
> extensions/seo/         №4
> ```
>
> `DomRuleEngine` переиспользуется расширениями №1 и №2: блюр ставит `filter: blur()`, косметическая фильтрация — `display: none`. Механизм обнаружения элементов один.

---

## 1. Стек — на чём пишем

| Слой | Выбор | Обоснование |
|---|---|---|
| **Фреймворк** | **WXT** `0.20.27` (2026-06-23) | 10.2k★, коммиты недельной давности. Единственный, кто собирает Chrome+Firefox+Safari и MV2+MV3 из одной кодовой базы |
| **Язык** | TypeScript | авто-типы в `.wxt/`, auto-imports |
| **UI popup/options** | React (`@wxt-dev/module-react`) | Preact/Svelte/Vue/Solid тоже первопартийные — выбор не архитектурный |
| **UI в контент-скрипте** | `createShadowRootUi` (WXT) | Shadow DOM изоляция + `isolateEvents` |
| **API браузера** | нативный `browser.*`, **без `webextension-polyfill`** | С Chrome 121 Promise есть почти везде; WXT выкинул полифилл из дефолта в 0.20.0 |
| **Storage** | `wxt/utils/storage` (`defineItem` + `version` + `migrations`) | типобезопасно, миграции схемы нужны с первого дня |
| **Messaging** | `@webext-core/messaging` | типобезопасно, рекомендован WXT. (`webext-bridge` — альтернатива. `trpc-chrome` мёртв) |
| **Фильтр-листы** | `@adguard/tsurlfilter` + `@adguard/dnr-rulesets` | готовый пайплайн EasyList/EasyPrivacy → DNR JSON. Свой парсер не писать |
| **Метрики (B)** | `web-vitals` v5 (GoogleChrome) | активен, attribution-сборка даёт элемент-виновник |
| **A11y-аудит (B)** | `axe-core` (MPL-2.0) | работает в браузере, бандлится, не нарушает no-remote-code |
| **Блюр canvas fallback** | StackBlur.js | ⚠️ `ctx.filter` в Safari отключён — см. §6 |

**Отклонено:** **Plasmo** (заброшен с 2023, сам себя зовёт `alpha`), **CRXJS** (жив, но один manifest-таргет за раз, без кросс-браузерности), **Extension.js** (жив, уже semver-стабилен, но нет Shadow-DOM-хелперов и AMO sources ZIP).

⚠️ **Риск WXT**: всё ещё `0.20.x`, без 1.0 — минорный бамп может ломать API. Пинить версию.

---

## 2. Целевые браузеры — три сборки на восемь браузеров

| Сборка | Покрывает | Manifest | Магазин |
|---|---|---|---|
| `wxt build -b chrome` | Chrome, **Edge, Brave, Vivaldi, Opera, Yandex** | MV3, service worker | Chrome Web Store, Edge Add-ons, Opera Addons |
| `wxt build -b firefox` | Firefox desktop + **Firefox Android** | ⚠️ WXT по умолчанию **MV2** | AMO (нужен sources ZIP → `wxt zip -b firefox`) |
| `wxt build -b safari` | Safari macOS/iOS/iPadOS | ⚠️ по умолчанию **MV2** | App Store, через нативную обёртку |

- **Edge/Brave/Vivaldi/Yandex** — Chromium, ставят Chrome-сборку без изменений.
- **Opera** — Chromium, но свой стор; WXT собирает для него sources ZIP, как для Firefox.
- **Brave** — имеет встроенный блокировщик (Shields). Детектить и предупреждать, а не блокировать в два слоя.
- **Safari** — самый дорогой таргет: Xcode-проект, Apple Developer Program ($99/год), App Store-ревью на каждый апдейт. ⚠️ **Нет блокирующего `webRequest`**, DNR ограничен. Отдельная фаза.

### Фоновый скрипт
- **Chrome**: только `service_worker`. Умирает через **30 сек** простоя (а также если запрос обрабатывается > 5 мин или `fetch` не отвечает > 30 сек).
- **Firefox**: `service_worker` **не поддерживается** (Bugzilla #1573659) — только `background.scripts`. На **Firefox Android** SW нет вовсе → Mozilla рекомендует MV2.
- **Safari**: поддерживает оба.

Пишем один `defineBackground({ main() {} })` — WXT эмитит нужный ключ под каждый таргет.

⚠️ **Порт не держит SW живым сам по себе.** Таймер сбрасывает **активность**: вызовы API, сообщения по порту (Chrome 114+), WebSocket-трафик (116+). Старый трюк «открыл порт — живёт вечно» не работает. Любое состояние в памяти SW может быть потеряно → флашить на `chrome.alarms` (мин. 30 сек) и `runtime.onSuspend`.

---

# РАСШИРЕНИЕ 1 — Content Blur (`extensions/blur`)

## 3. Модуль Blur ⚠️ block-first, а не scan-and-blur

Четыре независимых тоггла: **images / video / posters+thumbnails / text**.

### 3.1 Ключевое решение: «блокируй сразу, показывай потом»

Наивный подход (просканировать DOM в JS и навесить blur) **всегда даёт FOUC** — вспышку незаблюренного контента: JS отрабатывает после отрисовки элемента.

**Правильно**: инжектим статический CSS через `content_scripts` с `run_at: 'document_start'` — **до первой отрисовки**:
```css
img, video, video[poster], [style*="background-image"] {
  filter: blur(20px) !important;
}
```
…и затем **снимаем** блюр с разрешённого. Резкий кадр не отрисовывается никогда. Так делает `nsfw-filter` («all images remain hidden until they are found to be NSFW or not»), так устроена вся косметическая фильтрация uBlock Origin (один инжектированный user stylesheet, а не per-element JS).

Обратная сторона — кратковременный «переблюр» безопасного контента. Для нас приемлемо, потому что блюр **категориальный** (блюрим *все* картинки), а не по классификации каждой. Плюс приём из HaramBlur: CSS-анимация-предохранитель, держащая новый контент заблюренным и авто-снимающая блюр через N секунд.

### 3.2 Производительность CSS blur
- `filter: blur()` GPU-ускорен, но **промоутит элемент в отдельный композитный слой**. Сотни заблюренных картинок = сотни render surfaces → давление на GPU-память, а не только математика блюра.
- `backdrop-filter` структурно **дороже** (рендерит всё позади в отдельную текстуру). Нам не нужен никогда.
- Стоимость ≈ **радиус × площадь**. Радиус фиксированный, умеренный (10–25px), **не** масштабировать от размера. Не анимировать радиус на многих элементах разом.

### 3.3 Сканирование DOM (для того, что CSS-селектором не выразить)
`MutationObserver` **только собирает** узлы, никакой тяжёлой работы в колбэке:
```ts
observer.observe(document.documentElement, {
  childList: true, subtree: true, attributes: true,
  attributeFilter: ['src', 'srcset', 'poster', 'style'], // ⚠️ обязательно сужать
});
```
`attributeFilter` критичен: наблюдение за всеми атрибутами при `subtree: true` срабатывает непрерывно. SPA переиспользуют `<img>` и меняют `src`/`srcset` — ловим и это.

Дренаж батча — `scheduler.postTask()` (Chrome 129+) / `scheduler.yield()` (Chrome 129+, **Firefox 142+**). ⚠️ **Safari не поддерживает ни то, ни другое** → [scheduler-polyfill](https://github.com/GoogleChromeLabs/scheduler-polyfill) или fallback на `requestIdleCallback`.

`IntersectionObserver` с `rootMargin: '200px'` — главная победа по масштабу. Обязательно `io.unobserve(el)` после первого срабатывания, иначе при быстром скролле очередь растёт быстрее, чем JS её разгребает.

### 3.4 Видео ⚠️
**`filter: blur()` на играющем `<video>` не бесплатен.** Обычно Chromium отдаёт декодированные кадры прямо в OS-компоновщик как **hardware overlay**, минуя GPU-композитор. Фильтр применяется в композиторе и требует **readback с GPU** → блюр **выбивает видео с быстрого пути**. Реальная цена по батарее на 4K/60fps.

Всё равно используем CSS-фильтр на весь элемент — это правильный путь, просто держим радиус умеренным. **Canvas-обработка кадров** оправдана только для блюра *части* кадра или ML-классификации; для целого элемента строго дороже. Плюс canvas **не может читать cross-origin кадры** (tainted canvas).

### 3.5 Постеры и `background-image`
Многие превью (YouTube) — `background-image` на `<div>`, а не `<img>`. `getComputedStyle()` на каждом элементе дорого.

1. **CSS, block-first**: `[style*="background-image"]`, `video[poster]` — покрывает inline-style случай без JS.
2. **Пер-сайтовые пакеты селекторов** — для YouTube целимся в `ytd-thumbnail`, `yt-image`, `.ytp-cued-thumbnail-overlay-image`. uBO кэширует вычисленные селекторы по hostname.
3. **`getComputedStyle` только как fallback**, для элементов, уже прошедших фильтр (MutationObserver сообщил об изменении `style`, либо элемент пересёк viewport). Кэшировать.

⚠️ **Shadow DOM**: `querySelectorAll` из контент-скрипта **не пробивает shadow roots**, инжектированный CSS **не стилизует внутри** них. Нужен рекурсивный обход `element.shadowRoot` для **открытых** корней + инжект `<style>` / `adoptedStyleSheets` в каждый. **Закрытые** — недостижимы. YouTube использует открытый shadow DOM → обход обязателен.

⚠️ **iframes**: контент-скрипт видит только верхний фрейм без `all_frames: true`. Для `data:`/`blob:` — плюс `match_origin_as_fallback: true`.

### 3.6 Текст ⚠️
**Поиск**: `TreeWalker` + `NodeFilter.SHOW_TEXT` + `acceptNode`, отсекающий `<script>`, `<style>`, `<textarea>`, `<code>`, `<pre>`, `contenteditable` и свои обработанные узлы. **Собрать совпадения, потом мутировать.**

**Матчинг**: одна скомпилированная альтернация `/\b(w1|w2|…)\b/gi` — до нескольких сотен терминов. Дальше (~1–2k+) — Aho-Corasick / trie.

**Отрисовка**: `color: transparent; text-shadow: 0 0 8px currentColor` **предпочтительнее** `filter: blur()` на span — легче, без промоушена слоя на каждое совпадение.

⚠️ **CSS Custom Highlight API** (`CSS.highlights`, `::highlight()`) — Baseline с ~марта 2026. Позволяет стилизовать диапазоны **без оборачивания в span** (DOM не мутируется). **Но `filter` в `::highlight()` не поддерживается** — только `color`, `background-color`, `text-decoration`, `text-shadow`, `-webkit-text-stroke/fill`. Гауссов блюр через него **невозможен**. Зато `color` + `text-shadow` работают → эффект «прозрачный текст + тень» достижим range-based. Самый чистый подход 2026. Span-обёртка — fallback (у Firefox исторически были пробелы с `text-shadow` в highlight'ах — тестировать).

⚠️ **Доступность**: текст остаётся в DOM и дереве доступности — **скринридеры прочитают заблюренный текст вслух**, он копируется и находится через Ctrl+F. Если цель — реально *скрыть*, а не «визуально смягчить», CSS-блюра недостаточно.

### 3.7 Reveal UX
- **Hover-to-peek**: `:hover` → `filter: blur(0)` с `transition-delay`.
- **Click-to-reveal**: не накрывать медиа перехватывающим оверлеем. Либо слушатель на самом элементе с `{capture:true}` + `stopPropagation()` только на reveal-клике (потом слушатель снимается), либо оверлей с `pointer-events:none` на контейнере и `auto` только на бейдже.
- Свой UI — в Shadow DOM (`createShadowRootUi`, `isolateEvents: true`). ⚠️ WXT сбрасывает стили через `all: initial`, но **не** сбрасывает `font-size` хост-`<html>` → `rem` поедет. Использовать `px`.

---

---

# РАСШИРЕНИЕ 2 — Ad & Tracker Blocker (`extensions/adblock`)

## 4. Блокировка ⚠️ архитектура расходится по браузерам

### 4.1 Chrome MV3: только DNR
Блокирующий `webRequest` удалён. Верифицированные лимиты (Chrome, июль 2026):

| Константа | Значение |
|---|---|
| `GUARANTEED_MINIMUM_STATIC_RULES` | **30 000** на расширение |
| Глобальный общий пул | **300 000** на все расширения |
| Потолок для одинокого блокировщика | **330 000** |
| `MAX_NUMBER_OF_STATIC_RULESETS` | **100** |
| `MAX_NUMBER_OF_ENABLED_STATIC_RULESETS` | **50** |
| `MAX_NUMBER_OF_DYNAMIC_RULES` | **30 000** |
| `MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES` | **5 000** |
| `MAX_NUMBER_OF_SESSION_RULES` | **5 000** |
| `MAX_NUMBER_OF_REGEX_RULES` | **1 000** |

(«Unsafe» = не простой block/allow, т.е. `redirect`, `modifyHeaders`.)

Ориентир: uBlock Origin Lite — **~17 000** правил в Optimal/Complete; со всеми опциональными списками чуть больше 30 000. Полный EasyList+EasyPrivacy **укладывается** в гарантированные 30k.

**`topDomains` / `excludedTopDomains`** в `RuleCondition` теперь есть (Chrome 145+, ⚠️ версию перепроверить) — матчат домен top-level фрейма, т.е. «блокировать X на сайте A, но не на B». В Firefox отсутствуют.

### 4.2 Firefox: блокирующий `webRequest` жив ⚠️
Mozilla **сохранила** блокирующий `webRequest.onBeforeRequest` в MV3 наряду с DNR — поэтому там работает полноценный uBlock Origin, а не uBO Lite.

**Следствие**: на Firefox решаем по каждому запросу в JS → и блокировка точнее, и **счётчик точный**. Два бэкенда за одним интерфейсом:
```
AdBlockEngine
 ├── DnrBackend        (Chrome, Edge, Brave, Vivaldi, Opera, Yandex, Safari)
 └── WebRequestBackend (Firefox — точный подсчёт)
```

### 4.3 Трекеры — это тот же механизм, другой список
Технической разницы между блокировкой рекламы и трекеров почти нет: те же DNR-правила, другой фильтр-лист. Плюс трекер-специфичная гигиена, выразимая декларативно: снятие `Referer`/cookie через `modifyHeaders`.

**Списки и лицензии (важно для коммерческого релиза):**

| Список | Лицензия | Пригодность |
|---|---|---|
| **EasyPrivacy** | GPLv3 / CC-BY-SA | канонический трекер-лист, соблюдать атрибуцию/копилефт |
| **AdGuard Tracking Protection** | GPLv3 | ✅ есть **готовые MV3 DNR rulesets** в `@adguard/dnr-rulesets` — путь наименьшего сопротивления |
| **Disconnect.me** | GPLv3 | основа Firefox Tracking Protection; проверять лицензию конкретного файла |
| **Peter Lowe's list** | ⚠️ бесплатно для личного/некоммерческого; **для коммерции нужно разрешение** | проверить перед релизом |

**Privacy Badger-подход** (эвристика вместо списка): не имеет блоклиста, наблюдает третьесторонние запросы и помечает домен трекером, увидев его на **≥3 несвязанных сайтах**. EFF **завершил MV3-переписывание в 2024**: эвристика учится через наблюдающий `webRequest`, а блокирует через **динамические DNR-правила**. Под MV3 это **выполнимо**, ценой лимитов dynamic rules. Хорошая фича второй очереди.

### 4.4 Обновление фильтр-листов ⚠️ (исправляет v1)
Политика Chrome Web Store запрещает: `<script>` на внешний URL, `eval()` строки из сети, **построение интерпретатора для выполнения удалённых команд, даже полученных как данные**. Явно разрешает: «получение **удалённого конфигурационного файла**… при условии, что вся логика содержится в пакете. Внешние ресурсы не должны содержать логики».

**Вывод**: скачивание JSON с DNR-правилами в рантайме и применение через `updateDynamicRules()` — это **удалённые данные, разрешено**. Правила интерпретирует движок *браузера*. **AdGuard MV3 так и делает.** Реальное ограничение — **не политика, а лимиты dynamic rules**.

Стратегия: базовые списки — **статические rulesets в бандле** (обновление через релиз, CI пересобирает раз в 1–2 недели). Кастомные фильтры + «quick fixes» — **dynamic rules** в рантайме.

### 4.5 Уровни строгости
Механизм — **`updateEnabledRulesets()`** (Chrome 87+): каждый уровень = свой набор включённых rulesets. Плюс **`updateStaticRules()`** (Chrome 111+) для отключения *отдельных правил внутри* ruleset'а (лимит 5 000).

| Уровень | Сетевые rulesets | Косметическая фильтрация |
|---|---|---|
| Выключен | — | — |
| Стандартный | EasyList + EasyPrivacy | только пер-сайтовые селекторы |
| Агрессивный | + Annoyances, региональные | + generic cosmetic filtering |

Из uBOL: **generic cosmetic filtering выключен по умолчанию** и включается только на верхнем уровне — именно он ломает сайты и жрёт CPU.

### 4.6 Общее ядро `DomRuleEngine`
Косметическая фильтрация (скрытие рекламы по CSS-селекторам) — **тот же механизм**, что block-first блюр: инжект стилевого листа + пер-сайтовые селекторы + обход shadow DOM. Строим один core-модуль с двумя потребителями:
- Blur → `filter: blur(Npx)`
- AdBlock cosmetic → `display: none`

---

## 5. Счётчик заблокированного ⚠️ ПЕРЕПРОЕКТИРОВАН

**Ошибка v1**: счётчик на поллинге `getMatchedRules()`. **Так нельзя.**

- **`onRuleMatchedDebug`** — **только unpacked/dev-режим**. В опубликованном расширении не работает.
- **`getMatchedRules()`** — требует `declarativeNetRequestFeedback` **или** `activeTab`; **квота 20 вызовов / 10 минут**; **окно давности 5 минут**.

⚠️ **Непрерывный точный глобальный счётчик на Chrome MV3 построить принципиально невозможно.** Это by design: смысл DNR в том, что расширение не видит отдельные запросы.

| Браузер | Механизм | Точность |
|---|---|---|
| **Firefox** | наблюдающий/блокирующий `webRequest` | **точная**, глобально |
| **Chrome и Chromium-семейство, Safari** | (а) подсчёт скрытых косметическим фильтром элементов — точно для визуальной части; (б) `getMatchedRules()` с `activeTab` **по клику на popup** (жест → квота не тратится) | **приблизительная**, on-demand |

Продуктовые следствия: **badge** показывает счётчик косметически скрытых элементов текущей вкладки (это считаем точно), а не «все заблокированные запросы». **Popup** при открытии дёргает `getMatchedRules()` для активного таба и показывает сетевые блокировки за 5 минут. **Не врать в UI.** Накопительная статистика честно точна только на Firefox.

**Хранение**: держать в памяти SW, батчить инкременты в **один `storage.local.set`**, флашить по `chrome.alarms` (мин. 30 сек) и `runtime.onSuspend`. **Не** писать на каждое событие.

---

---

## 6. Скриншот региона с блюром остального — ОТЛОЖЕНО

> Фича исследована и спроектирована, но **не входит ни в одно из четырёх расширений на текущем этапе**. Ей нужны `downloads` + `clipboardWrite`, а её цель («сделать скриншот») не сводится ни к «скрыть контент», ни к «блокировать рекламу». Варианты на будущее: отдельное пятое расширение, либо аккуратное встраивание в №1 с формулировкой цели «скрыть контент — на странице и на снимке экрана». Ниже — результаты исследования, чтобы не терять их.

### 6.1 Захват
`chrome.tabs.captureVisibleTab(windowId?, {format, quality})` → data URL.
- **Разрешение: `activeTab`** достаточно и **не даёт install-time предупреждения**. Это важно.
- Захватывает **только видимую область**. Кросс-доменные iframe попадают (это пиксельный захват, не чтение DOM).
- ⚠️ **Лимит: 2 захвата в секунду** (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`) — критично для scroll+stitch.
- С `activeTab` можно захватывать даже `chrome://` страницы. Chrome Web Store остаётся заблокирован.
- Firefox: `captureVisibleTab` есть, плюс свой `tabs.captureTab(tabId)` (но требует `<all_urls>`). Safari: есть.

**Full-page скриншот**: первоклассного API **нет** ни в Chrome, ни в Firefox. Либо scroll+stitch (лимит 2/сек, проблемы со sticky-хедерами и lazy-load), либо `chrome.debugger` + CDP `Page.captureScreenshot{captureBeyondViewport:true}` — один вызов, но жёлтый баннер отладки. ⚠️ Для расширения A `debugger` брать нельзя (см. §0) → только scroll+stitch.

### 6.2 ⚠️ devicePixelRatio — классический баг
`captureVisibleTab` возвращает картинку в **физических пикселях** = CSS-пиксели × `devicePixelRatio`. Координаты выделения — в CSS-пикселях. На Retina (DPR=2) вьюпорт 1280 CSS-px даёт картинку 2560 px.

**Фикс**: умножать `x, y, w, h` (и радиус блюра!) на `devicePixelRatio` перед кропом.

Оверлей выделения: `position: fixed; inset: 0; z-index: 2147483647`, координаты через `clientX/clientY` (viewport-relative), **не** `pageX/pageY`. Убирать оверлей *до* захвата, иначе затемнение запечётся в скриншот.

### 6.3 Композитинг
```ts
const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
const c = new OffscreenCanvas(bmp.width, bmp.height);
const ctx = c.getContext('2d');
ctx.filter = `blur(${12 * dpr}px)`;
ctx.drawImage(bmp, 0, 0);            // всё размыто
ctx.filter = 'none';
ctx.drawImage(bmp, sx,sy,sw,sh, sx,sy,sw,sh);  // резкий регион поверх
const blob = await c.convertToBlob({ type: 'image/png' });
```
- **`OffscreenCanvas` и `createImageBitmap` доступны в MV3 service worker** — offscreen-документ для этого **не нужен**. Надёжный путь к data URL: `fetch(dataUrl) → blob → createImageBitmap`.
- ⚠️ **`ctx.filter` в Safari отключён по умолчанию вплоть до Safari 26.x** (caniuse: «disabled by default»). MDN помечает как «Limited availability, not Baseline». **Нужен fallback: StackBlur.js** или `context-filter-polyfill`.
- ⚠️ `chrome.offscreen` **не существует в Firefox** вообще. Хорошо, что он нам не нужен.
- Артефакт: гауссов блюр «затекает» резким контентом на границе. Блюрить слегка расширенную копию или композитить через отдельный canvas.

### 6.4 ⚠️⚠️ Блюр и пикселизация ОБРАТИМЫ — предупреждение продукту
Это не теория. **Unredacter** (Bishop Fox, 2022) брутфорсом восстанавливает пикселизованный текст — пароли, API-ключи. **Depix** делает то же перебором комбинаций блоков. Positive Security обратили пикселизацию в видео. Прямая рекомендация Bishop Fox: *«Never use text pixelation to redact sensitive information»*.

**Следствие для UI**: если фича позиционируется как «скрыть чувствительные данные перед отправкой скриншота» — режим должен быть **сплошная заливка** (`ctx.fillRect`), а не блюр. Блюр оставить как **косметический эффект с явной пометкой, что он не является защитой**.

### 6.5 Экспорт
`chrome.downloads.download({url: dataUrl, filename, saveAs})`. Буфер обмена: `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])` — только secure context, разрешение `clipboardWrite`. ⚠️ У SW нет `navigator.clipboard` → копировать из popup/страницы расширения. ⚠️ **В Safari `clipboardWrite` работает только в контекстах расширения, не в контент-скриптах.**

---

# РАСШИРЕНИЯ 3 и 4 — Perf (`extensions/perf`) и SEO (`extensions/seo`)

## 7. Метрики скорости 🆕

### 7.1 Core Web Vitals — актуальный набор
INP заменил FID **12 марта 2024**. Набор с тех пор не менялся: **LCP, INP, CLS**. Четвёртой метрики не добавилось; «плавность» покрывается диагностическим Long Animation Frames API, но это не Core Web Vital.

| Метрика | Хорошо | Требует улучшения | Плохо |
|---|---|---|---|
| LCP | ≤ 2.5 с | 2.5–4.0 с | > 4.0 с |
| INP | ≤ 200 мс | 200–500 мс | > 500 мс |
| CLS | ≤ 0.1 | 0.1–0.25 | > 0.25 |
| FCP | ≤ 1.8 с | 1.8–3.0 с | > 3.0 с |
| TTFB | ≤ 0.8 с | 0.8–1.8 с | > 1.8 с |

**`web-vitals` v5** (актив, 5.3.x): `onLCP`, `onINP`, `onCLS`, `onFCP`, `onTTFB`. Attribution-сборка (+~1.5 КБ brotli) даёт элемент-виновник, sub-part тайминги и script attribution для INP. ⚠️ Каждый `onX()` вызывать **не более одного раза за загрузку** — каждый создаёт `PerformanceObserver`.

⚠️ **Инжект обязателен на `document_start`, желательно в MAIN world.** Performance Timeline — per-Document, а не per-JS-world, так что изолированный мир видит настоящие записи страницы. Но LCP/CLS/FCP полагаются на `buffered: true` для добора уже случившихся записей, а буфер ограничен. На дефолтном `document_idle` LCP уже произошёл — и можно промахнуться мимо настоящего.

### 7.2 ⚠️ Тайминг отдельных элементов — почти невозможен на чужих страницах
Спека W3C Element Timing прямым текстом:

> «It should be noted that setting the `elementtiming` attribute **does not work retroactively**: once an element has loaded and is rendered, setting the attribute will have no effect.»

**Следствие**: расширение не может измерить рендер произвольных элементов на чужой странице. К моменту, когда контент-скрипт (даже на `document_start`) дотянется до узла, элементы выше сгиба уже отрисованы. Проставленный задним числом атрибут не даёт записей.

Единственный частичный обход — на `document_start` в MAIN world вешать `MutationObserver` и штамповать `elementtiming` на узлы **в момент вставки**, гоняясь с парсером. Ловит часть динамически вставленных элементов, **не ловит** то, что было в исходном HTML. Ненадёжно.

⚠️ Element Timing — **только Chromium**. Firefox и Safari не реализуют.

**Что делать вместо**: `LargestContentfulPaint` **идентифицирует элемент** через `entry.element` (+ `renderTime`, `loadTime`, `size`, `url`). И ⚠️ **хорошая новость: LCP стал Baseline в декабре 2025** — теперь работает в Chrome, Edge, Firefox и Safari, а не только в Chromium. Это практическая замена «когда отрисовался главный элемент».

**Long Animation Frames (LoAF)**: `PerformanceObserver` на `'long-animation-frame'`, Chrome 123+, только Chromium. Даёт `blockingDuration` и массив `scripts[]` с атрибуцией (`sourceURL`, `sourceFunctionName`, `duration`, `forcedStyleAndLayoutDuration`). Преемник Long Tasks, но Long Tasks официально **не** депрекирован.

### 7.3 Тайминги загрузки страницы
`performance.getEntriesByType('navigation')[0]` → `PerformanceNavigationTiming`. Канонический **TTFB** = `responseStart - activationStart` (для prerender), на практике просто `responseStart`. **FCP** — из `paint`-записи `first-contentful-paint`. `web-vitals` учитывает нюанс с активацией сам.

## 8. Вес страницы ⚠️ ТОЧНО — ТОЛЬКО ЦЕНОЙ БАННЕРА

| Способ | Точность (вкл. cross-origin) | Цена | Работает в popup без DevTools? |
|---|---|---|---|
| `chrome.debugger` + CDP `Network.loadingFinished.encodedDataLength` | **полная** | ⚠️ неубираемый баннер «расширение отлаживает браузер»; конфликтует с открытым DevTools | **да** (с баннером) |
| DevTools `getHAR()` → `_transferSize` | полная | нужен открытый DevTools | нет |
| `webRequest` + `Content-Length` | частичная/неточная | низкая | да |
| `PerformanceResourceTiming.transferSize` | **занижает** | нет | да |

Детали:
- ⚠️ `transferSize` (а также `encodedBodySize`, `decodedBodySize`, `responseStart`) = **0 для cross-origin** ресурсов без заголовка **`Timing-Allow-Origin`**. Большинство сторонних хостов его не шлют → сумма систематически занижена. (Нюанс: `transferSize === 0` при ненулевом `decodedBodySize` = попадание в кэш, не обязательно cross-origin.)
- ⚠️ **У Chrome `webRequest.onCompleted` вообще нет поля размера.** `Content-Length` из заголовков отсутствует на chunked/сжатых/HTTP-2/3 ответах и отражает объявленную длину, а не байты на проводе. **У Firefox `onCompleted` даёт `responseSize`** — на Firefox можно точно и тихо.
- **`encodedDataLength` из CDP — реальные байты на проводе**, post-compression, cross-origin без TAO. Единственный точный путь в Chrome.

**Дизайн честной фичи**: в popup показываем **число запросов, разбивку по типу, сторонние домены, тайминги** (всё это доступно кросс-доменно и точно) + «измеренные байты (first-party + TAO)» с явной пометкой. Точный вес — **opt-in режим** с `chrome.debugger` (пользователь соглашается на баннер) **или** DevTools-панель.

## 9. «Проанализировать скорость и качество своих страниц»

⚠️ **Lighthouse встроить нельзя.** Это Node-приложение (`chrome-launcher`, Node fs/streams, драйвит Chrome по CDP). В MV3 не бандлится, а подгрузить в рантайме запрещает no-remote-code.

⚠️ Отдельное расширение Lighthouse **мертво**. **Web Vitals extension от Google — end-of-support 07.01.2025**, слито в DevTools (Chrome 129+ имеет реалтайм-CWV прямо в Performance-панели). Платформа уводит аудит из расширений в DevTools + PSI.

⚠️ **`chrome.devtools.performance`** (Chrome 128) — только события `onProfilingStarted`/`onProfilingStopped`. Программно запустить трейс и получить данные **нельзя**.

**Реалистичная архитектура:**
- **Публичные страницы** → **PageSpeed Insights REST API**: `GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=…&key=…`. Возвращает лабораторные результаты Lighthouse + полевые данные CrUX. Это **fetch данных, не удалённый код** → политику не нарушает. Лимиты ~**25 000 запросов/день**, **400 / 100 сек**; ключ Google Cloud настоятельно рекомендован. ⚠️ Только публичные URL — localhost и страницы за авторизацией недоступны.
- **Локальные метрики** → `web-vitals` v5 в MAIN world на `document_start` + LoAF.
- **Глубокий аудит** → opt-in `chrome.debugger` (CDP network + tracing).
- **A11y** → бандлить `axe-core` (MPL-2.0, работает в браузере).

---

## 10. Что ещё стоит добавить (по аудиториям)

### SEO
- Инспектор мета-тегов: `title`, `description`, `canonical`, `robots`, `hreflang`, OG/Twitter-карточки + превью «как выглядит в соцсетях».
- Структура заголовков `H1–H6` (outline), нарушения иерархии.
- Картинки без `alt`; ссылки: внутренние/внешние, `nofollow`/`sponsored`/`ugc`.
- Валидатор structured data (JSON-LD / microdata) — парсинг прямо из DOM.
- Индексируемость: `meta robots noindex`, заголовок `X-Robots-Tag`, `canonical` vs текущий URL.
- Цепочка редиректов (через наблюдающий `webRequest`).
- `robots.txt` / `sitemap.xml` — требует host permission на fetch.

### Поисковые машины / SERP
- Оверлей метрик прямо в выдаче (CWV, HTTPS, кол-во рекламы на целевой странице).
- **Блокировка доменов из выдачи** в стиле uBlacklist — контент-фильтрация, органично ложится в **расширение A**.
- Подсветка ключевых слов.

### Разработчик
- Определение стека сайта (Wappalyzer-подобное: по DOM, заголовкам, скриптам).
- Инспектор security-заголовков: CSP, HSTS, `X-Frame-Options`, `Permissions-Policy`.
- Просмотр/редактирование cookies и `localStorage`.
- Пипетка цвета, инспектор шрифтов, копирование CSS-селектора/XPath.
- Отключение JS / кэша, подмена user-agent.
- Responsive-превью на разных разрешениях.
- Счётчик ошибок/предупреждений консоли.
- Линейка и сетка-оверлей.

### Обычный пользователь
- **Очистка ссылок от трекинг-параметров** (`utm_*`, `fbclid`, `gclid`) — DNR умеет это декларативно через `redirect` + `transform.queryTransform.removeParams`. ⚠️ Это «unsafe» правило → лимит 5 000. Privacy Badger делает то же.
- Тёмная тема на любом сайте (Dark Reader-подобное).
- Reader mode / убрать лишнее.
- Автозакрытие cookie-баннеров — это фильтр-лист Annoyances, **уже покрыт** уровнем «Агрессивный».
- Focus mode: таймер + блокировка отвлекающих сайтов (DNR).
- Скрыть комментарии/рекомендации на YouTube (пер-сайтовые косметические правила).
- Перевод выделенного текста.

⚠️ **Разложение по расширениям**: SEO, стек, security-заголовки, responsive, консоль → **B**. Очистка ссылок, тёмная тема, focus mode, SERP-блокировка, cookie-баннеры → **A** (все служат цели «контролировать контент»). Не смешивать.

---

## 11. Аудит запрошенных фич — что есть, чего нет

| Запрошено | Статус | Комментарий |
|---|---|---|
| **Отключает трекеры** | ✅ **есть** | EasyPrivacy / AdGuard Tracking Protection через `@adguard/dnr-rulesets`. Тот же механизм, что адблок, другой список. Проверить лицензию Peter Lowe's для коммерции |
| **Время отображения всей страницы** | ✅ **есть** | `PerformanceNavigationTiming` + `web-vitals` v5. Инжект на `document_start`, MAIN world |
| **Время отображения отдельных элементов** | ⚠️ **почти невозможно** | Element Timing требует `elementtiming` **до** первой отрисовки; спека: «does not work retroactively». Только Chromium. Замена: `LCP.entry.element` (кросс-браузерно с дек. 2025) + LoAF |
| **Сколько весит страница** | ⚠️ **точно — только с баннером** | `transferSize` = 0 для cross-origin без TAO; у Chrome `webRequest` нет поля размера. Точно — `chrome.debugger` (баннер) или DevTools HAR. **На Firefox — точно и тихо** (`responseSize`) |
| **Скриншот региона с блюром остального** | 🆕 **добавлено, §6** | `captureVisibleTab` + `activeTab` (без страшных прав). ⚠️ DPR-скейлинг, ⚠️ `ctx.filter` не работает в Safari, ⚠️⚠️ блюр обратим — для редактирования секретов только сплошная заливка |
| **Анализ скорости и качества своих страниц** | 🆕 **добавлено, §9** | Lighthouse встроить нельзя. Реалистично: PageSpeed Insights REST API (публичные URL) + `web-vitals` локально + `axe-core` для a11y |

---

## 12. Мобильные браузеры — что реально работает 📱

**Короткий ответ: на мобильных живёт только расширение A, и только на Firefox for Android.** Расширение B там наполовину мёртво.

### Доступность API

| API / фича | Firefox Android | Safari iOS | Chrome Android |
|---|---|---|---|
| Контент-скрипты, `PerformanceObserver` | ✅ | ✅ | ❌ нет расширений |
| `declarativeNetRequest` | ✅ | ⚠️ частично, меньшие лимиты | ❌ |
| **Блокирующий `webRequest`** | ✅ **есть** | ❌ **убран в MV3** | ❌ |
| `tabs.captureVisibleTab` | ✅ | ✅ | ❌ |
| `downloads` | ✅ | ⚠️ | ❌ |
| DevTools-панели (`devtools_page`) | ✅ (есть аддоны вроде MobiDevTools) | ❌ практически нет | ❌ |
| **`chrome.debugger` / CDP** | ❌ **не существует в Firefox нигде** (bugzilla 1323098, WONTFIX) | ❌ | ❌ |
| `chrome.offscreen` | ❌ **не существует в Firefox** | ❌ | ❌ |
| Background **service worker** | ❌ **нет на Android** → event page / MV2 | ⚠️ | ❌ |

### Что это значит по фичам

| Фича | Firefox Android | Safari iOS |
|---|---|---|
| Блюр (все 4 типа) | ✅ полностью | ✅ полностью |
| Адблок + трекеры | ✅ **лучше, чем на десктопном Chrome** (блокирующий `webRequest`) | ⚠️ только DNR, ограниченно |
| **Точный счётчик заблокированного** | ✅ **да** (`webRequest`) | ❌ приблизительный |
| Скриншот региона + блюр | ✅ (⚠️ `ctx.filter` → на Safari нужен StackBlur) | ⚠️ |
| Core Web Vitals, тайминги | ✅ | ⚠️ (нет Element Timing / LoAF — они Chromium-only) |
| **Точный вес страницы** | ✅ **да!** (`webRequest.onCompleted.responseSize` — у Firefox есть это поле) | ❌ |
| Инспектор трафика на CDP | ❌ **никогда** — `chrome.debugger` в Firefox не существует | ❌ |
| PageSpeed Insights аудит | ✅ (это просто `fetch`) | ✅ |

### Практический вывод
- ⚠️ **`chrome.debugger` не существует в Firefox ни на одной платформе.** Инспектор трафика на CDP **не портируется** — под Firefox его надо переписывать на `webRequest`.
- **Firefox for Android — единственная полноценная мобильная цель.** Экосистема открыта с дек. 2023 (любые расширения с AMO, не курируемый список). Нужен ключ `browser_specific_settings.gecko_android` в манифесте, иначе AMO не пометит расширение как Android-совместимое. Использовать **MV2/event page** — service worker'а там нет.
- Парадокс: **адблок и счётчик на Firefox Android работают лучше, чем на десктопном Chrome**, потому что там жив блокирующий `webRequest`.
- **Chrome for Android** — расширений нет и не планируется.
- ⚠️ **Kiwi Browser заархивирован**, не поддерживается после января 2025. Код ушёл в Edge Canary. Из планов вычеркнуть.
- **Edge Canary (Android)** — установка любых расширений через dev-опции, но только канал Canary; Microsoft пишет «not tested for mobile». Sideload, не канал дистрибуции.
- **Brave / Opera / Cromite (Android)** — сторонние расширения не поддерживаются.
- **Safari iOS** — реалистична только контент-блокировка через DNR. Dev-инструменты не портируются.
- **Samsung Internet** — свой формат, WebExtensions в закрытой бете. Вне scope.

---

## 13. Storage и messaging — верифицированные числа

| Область | Квота | Заметки |
|---|---|---|
| `storage.sync` | **102 400** байт всего; **8 192** байт/элемент; **512** элементов; **1 800** записей/час; **120**/мин | Превышение — **жёсткая ошибка**, не тихое усечение. Только лёгкие настройки |
| `storage.local` | **10 МБ** (было 5 МБ до Chrome 113); снимается пермишеном `unlimitedStorage` | Нет лимитов на элемент и частоту записи |
| `storage.session` | **10 МБ**, в памяти | ⚠️ **Недоступен контент-скриптам по умолчанию** → `setAccessLevel({accessLevel:'TRUSTED_AND_UNTRUSTED_CONTEXTS'})`. Медленный, не буфер для оптимизации |
| `storage.managed` | read-only, из корпоративной политики | enterprise |

Раскладка: `sync` → включённые модули, уровень строгости, UI. `local` → статистика, кэш пер-сайтовых настроек, кастомные правила. `session` → эфемерное per-tab состояние.

**Messaging:**
- ⚠️ С **Chrome 148** можно **возвращать Promise** прямо из `onMessage` — чистая замена трюку `return true` + `sendResponse`. С **Chrome 146** ошибка в листенере **реджектит** Promise отправителя (раньше глоталась). Для старых Chrome оставить `return true` fallback.
- Ошибка *«The message channel closed before a response was received»* = вернули `true`, но `sendResponse` не вызвали (SW усыпили). Один респондер на тип сообщения.

---

## 14. Разрешения и ревью

- **`activeTab` вместо широких `host_permissions`** где возможно. `captureVisibleTab` работает с `activeTab` **без install-time предупреждения** — использовать это.
- Всё необязательное — в **`optional_permissions`**, запрашивать в момент включения фичи. Уменьшает поверхность **Purple Potassium** (избыточные разрешения).
- **Каждое разрешение** требует персонального обоснования в дашборде и должно однозначно привязываться к видимой фиче из листинга.
- ⚠️ **`debugger` — только в расширении B, только opt-in.** Никогда рядом с адблоком: «зачем блокировщику рекламы отлаживать мой браузер?» → отказ.
- **No remote code**: весь JS/WASM в бандле. Удалённые *данные* (фильтр-листы → dynamic rules) разрешены.
- **AMO**: sources ZIP обязателен → `wxt zip -b firefox` делает автоматически. Opera — тоже.
- **Публикация**: `wxt submit` покрывает Chrome Web Store, AMO, Edge Add-ons. Opera Addons и App Store — вручную.
- **Privacy**: аддон сканирует текст страниц, блокирует сеть, считает трафик. Нужна privacy policy и архитектурный инвариант «данные о посещаемых страницах не уходят наружу» — держать в коде, а не в маркетинге. ⚠️ Исключение: PSI API отправляет URL Google — это надо явно раскрыть.

---

## 15. Дорожная карта

**Фаза 0 — фундамент** ✅ *сделано (моки)*
1. ✅ Monorepo (npm workspaces), `packages/core` с типами, дефолтами и мок-данными.
2. ✅ Четыре расширения на WXT + React, полностью замоканные: UI, навигация, персистентность настроек. Логика — стабы с TODO.
3. ⬜ **`DomRuleEngine`** — block-first CSS-инжект на `document_start`, MutationObserver с `attributeFilter` + батчинг через `scheduler`, IntersectionObserver-гейтинг, рекурсивный обход открытых shadow roots. *Фундамент и для блюра (№1), и для косметической фильтрации (№2).*

**Расширение 1 — Blur**
4. Blur MVP — картинки (block-first CSS), пер-сайтовый override.
5. Blur extended — видео, постеры/`background-image` + пер-сайтовые селекторы для YouTube, текст (Custom Highlight API + span-fallback), hover/click-to-reveal в Shadow DOM.

**Расширение 2 — AdBlock**
6. AdBlock core — `@adguard/dnr-rulesets` в CI, статические rulesets в `public/`, `DnrBackend`, три уровня через `updateEnabledRulesets`, косметическая фильтрация поверх `DomRuleEngine`.
7. AdBlock Firefox — `WebRequestBackend` за тем же интерфейсом.
8. Трекеры — EasyPrivacy/AdGuard Tracking rulesets; очистка UTM-параметров через DNR `removeParams`.
9. Stats — точный счётчик на Firefox; косметические скрытия + `getMatchedRules` по жесту на Chrome; батч-флаш по alarms.

**Расширение 3 — Perf**
10. Core Web Vitals — `web-vitals` v5, MAIN world, `document_start`; LCP-элемент; LoAF.
11. Network insight — Resource Timing в popup (с честной пометкой про байты) + DevTools-панель на `onRequestFinished`.
12. Opt-in `chrome.debugger` — точный вес через `encodedDataLength`, с явным предупреждением про баннер и запросом разрешения в рантайме.
13. PSI-аудит — PageSpeed Insights API + раскрытие в privacy policy.

**Расширение 4 — SEO & A11y**
14. SEO-панель — мета-теги, заголовки, hreflang, structured data, alt, соцпревью.
15. A11y — бандл `axe-core` (MPL-2.0), `axe.run()` по кнопке.

**Финал**
16. Cross-browser polish — Chrome/Firefox сборки, тест на Firefox Android (+`gecko_android`, MV2), проверка на Brave (конфликт со Shields), Opera, Vivaldi, Yandex, Edge.
17. Safari — отдельная фаза: `safari-web-extension-converter`, Apple Developer Program, App Store.
18. Store prep — по каждому расширению: аудит разрешений, privacy policy, `wxt zip` + `wxt submit`.

---

## 16. История исправлений

### v1 → v2
| Было | Стало |
|---|---|
| Счётчик через поллинг `getMatchedRules()` | ❌ Невозможно: квота 20/10мин + окно 5 мин |
| «Runtime-фетч фильтров — серая зона» | ✅ Удалённые *данные* разрешены; AdGuard так делает |
| Kiwi Browser как мобильный таргет | ❌ Заархивирован в янв. 2025 |
| Firefox — «просто другой манифест» | ✅ Сохранил **блокирующий `webRequest`** → два бэкенда движка |
| Блюр = сканировать DOM и навесить фильтр | ✅ Block-first CSS на `document_start`, иначе FOUC |
| «Total page weight» через Resource Timing | ❌ `transferSize` = 0 для cross-origin без TAO |
| Блюр видео — «дёшево» | ⚠️ Выбивает видео с hardware-overlay пути |

### v2 → v3
| Было | Стало |
|---|---|
| **Один универсальный аддон** | 🔴 **Два расширения.** Chrome Web Store single purpose policy: «Don't create an extension that requires users to accept bundles of unrelated functionality» |
| «Выключено по умолчанию» решает проблему объёма | ❌ Не лечит single purpose — стор смотрит на возможности и цель |
| (не рассматривалось) | ⚠️ `debugger` — красный флаг ревью + неубираемый баннер. Только в B, только opt-in |
| (не рассматривалось) | ⚠️ Element Timing **не работает ретроактивно** → тайминг произвольных элементов на чужих страницах невозможен |
| (не рассматривалось) | ⚠️ Lighthouse **нельзя** встроить (Node-приложение + no-remote-code). Только PSI API |
| (не рассматривалось) | ⚠️ Блюр/пикселизация **обратимы** (Unredacter, Depix) → для редактирования секретов только сплошная заливка |
| (не рассматривалось) | ⚠️ `ctx.filter` **отключён в Safari** до 26.x → StackBlur fallback |
| (не рассматривалось) | ⚠️ `chrome.debugger` и `chrome.offscreen` **не существуют в Firefox** ни на одной платформе |
| Мобильные — общая прикидка | ✅ Пофичевая матрица §12. На Firefox Android адблок и счётчик **точнее**, чем на десктопном Chrome |

### v3 → v4
| Было | Стало |
|---|---|
| **Два расширения** (Blocker + Web Dev Toolkit) | 🔴 **Четыре.** Блюр и адблок разделены; perf и SEO разделены |
| Блюр и адблок в одном пакете | Разные цели: «скрыть контент» ≠ «блокировать рекламу». Разные разрешения: блюру не нужен `declarativeNetRequest` вообще |
| `debugger` рядом с SEO-аудитом | ⚠️ Учебниковый рассинхрон разрешений и цели. `debugger` изолирован в №3 (perf), где точное измерение байтов по CDP — основная работа. №4 (seo) обходится `activeTab` + `scripting` и проходит ревью тривиально |
| Скриншот региона — часть Blocker | Отложен: цель «сделать скриншот» не сводится к «скрыть контент». Исследование сохранено в §6 |

---

## 18. Статус после аудита и правок (2026-07-10)

Проведён глубокий аудит (6 агентов: корректность ядра+blur, adblock, perf+seo, кросс-браузерность/мобильные, UI/UX, полнота фич). Найденное исправлено веером из 4 агентов + правки ядра вручную. Все 4 расширения проходят typecheck и собираются под Chrome и Firefox.

**Исправлено (критическое):**
- `DomRuleEngine.updateRules()` был no-op (stop → `#running=true` → start, а start выходит по `if(#running)`). Теперь работает.
- `<video poster>` не блюрился при дефолте: компаундный селектор + `[attr]` привязывал атрибут только к последнему элементу. Добавлен `splitSelectorList`.
- Кириллические ключевые слова не матчились (`\b` в JS только ASCII). Перешли на unicode-границы `(?<![\p{L}\p{N}_])…` с флагом `u`.
- adblock показывал выдуманную статистику (48 907) как реальную, и подмешивал мок-allowlist в настройки — все моки удалены из прода, fallback'и обнулены.
- adblock на Firefox не блокировал ничего (нет host-permission). Добавлен `<all_urls>` в MV2 permissions.
- seo-панель: аудит a11y был недостижим (`activeTab` не выдаётся из DevTools-панели). Переведён на `tabs.sendMessage` к уже внедрённому контент-скрипту.
- perf: ложный «точный» путь на Firefox (`responseSize` не существует в `onCompleted`) удалён; CDP-триггер перенесён из DevTools-панели в popup (иначе attach всегда конфликтовал с открытым DevTools).

**Исправлено (важное):** глобальный on/off во всех потребительских расширениях; нормализация allowlist; точный подсчёт по категориям через `EngineStats.byLabel` (без пересканирования DOM); FOUC (синхронный pre-blur до await storage); дебаунс слайдера радиуса; утечки Range/IntersectionObserver; обход shadow-root для динамических поддеревьев; де-жаргонизация UI; тема DevTools-панелей через `themeName`; `aria-label` + `:focus-visible` + `aria-live` везде; severity в SEO не только цветом; контраст бейджей в тёмной теме.

**Добавлены дешёвые фичи (без новых разрешений):** seo — robots.txt/sitemap.xml/`X-Robots-Tag`, анализ ссылок, счётчик слов, экспорт отчёта (JSON/Markdown).

**Осталось до реального прода:**
- Safari не собран ни у кого (нужен `wxt build -b safari` + `safari-web-extension-converter` + Apple Developer Program + App Store-обёртка). Отдельная фаза.
- Firefox `responseSize` спор разрешён: поля нет → точный вес страницы на Firefox недоступен без баннера (как и на Chrome он только через `debugger`).
- Дедупликация дизайн-токенов в общий `@blur/ui` пакет (сейчас два набора: blur+adblock и perf+seo) — не блокер, отложено.

## 18a. Второй раунд аудита и правок (2026-07-11)

Повторный аудит веером из 5 агентов (core + по расширению), правки core вручную + веер из 4 агентов-исправителей (по одному на расширение, изолированы по папкам). Все 4 расширения: typecheck ✅, Chrome build ✅, Firefox build ✅, adblock logic 20/20, unit-специи 13/13. **Впервые проверено в живом браузере** (load-unpacked через Playwright new-headless): попапы и options всех расширений рендерятся в свет+тьму с 0 ошибок консоли.

**Core (общий движок):**
- `hide`-элементы (косметическая фильтрация adblock) не считались вообще: их гейтил IntersectionObserver, а у `display:none` нет бокса → IO не срабатывает никогда. Теперь `hide` считается сразу при обнаружении, IO оставлен только для `blur`.
- Гонка sweep/drain: после `stop()` во время `await` между чанками движок продолжал заполнять `#observed` (утечка IO) и слал stale-статистику. Добавлена перепроверка `#running` внутри чанков.
- `stats.byLabel` отдавался по ссылке (shallow-копия) → снапшот у потребителя мутировал задним числом. Теперь deep-copy.
- MutationObserver не наблюдал за shadow roots → динамический контент внутри них (ленивые превью YouTube) не блюрился/не считался. Один observer теперь наблюдает и запатченные shadow roots.
- `splitSelectorList` был наивным `split(',')` → пользовательские косметические селекторы с `:is()`/`[attr="a,b"]` корёжили стейт-шит. Теперь split учитывает скобки/кавычки.
- `isAllowlisted` матчил точный хост → `www.example.com` не покрывался записью `example.com`. Теперь учитывает поддомены (как и остальной матчинг).
- `blurRadius` NaN/отрицательный давал `blur(NaNpx)` → CSS молча выключал весь блюр. Клампится в 0–100. `processInChunks` при `chunkSize<=0` работал синхронно (long task) — клампится в ≥1. `collectOpenShadowRoots` использует документ корня (WrongDocumentError на adopted-узлах).

**Blur:** sync-квота 8КБ рвала большие списки ключевиков/allowlist с тихой потерей → переезд на `local`; один битый regex ронял весь текст-блюр (union флагов `u`) → фрагменты валидируются под эффективными флагами, битые отбрасываются; highlight-reveal-all саморазблюривался на следующем commit; TreeWalker портил `<title>`/`<option>`; RMW-гонка настроек через очередь записи; «Blur this element» не доставал shadow DOM (`composedPath`); reverse-FOUC на allowlisted/кастомных сайтах (pre-blur из кэша профиля по origin). **Фичи:** bulk-добавление ключевиков + импорт/экспорт, reveal-таймаут, min-size gate (не блюрить фавиконки/1px), скрытие ссылок по домену (SERP). **UI:** де-жаргон, `accent-color`, подтверждение импорта, честный bucket «Images & thumbnails».

**AdBlock:** (Chrome) allowlist «Пауза» и очистка UTM молча не работали — `permissions.request()` не вызывался; добавлен запрос host-доступа для redirect-правила + «Grant access» в UI. (Firefox) агрегат недосчитывал (складывался только для активного таба) → `flushAll()`; per-tab счётчики не сбрасывались (утечка) → `tabs.onRemoved/onUpdated`; strip-params был полным no-op → реальный `redirectUrl`. (Chrome) `getMatchedRules` считал динамические redirect/allow как «блокировки» → только статические block; badge не сбрасывался при навигации; коллизии id allowlist; мастер-выключатель не останавливал сетевой движок. **Фичи:** live-проброс настроек в открытые вкладки, временная пауза (10 мин), счёт «since install», bulk-импорт allowlist. **UI:** честность метрик, переформулирован empty-state, Backup вынесен в отдельный таб.

**Perf:** состояние per-tab жило только в памяти SW → после эвикции (30с) страница «теряла» замеры → зеркалирование в `storage.session`; CDP-гонка load-event давала 20с зависание на каждом замере → промис армится до `Page.reload`; «exact bytes» на тёплом кэше врал (encodedDataLength≈0) → `ignoreCache:true` + честная формулировка; summary и таблица брались из разных источников (HAR vs RT) → единый источник; LoAF-observer не останавливался (bfcache-утечка); PSI null-score рисовался как «0» → «—»; PSI без таймаута → AbortController. **Фичи:** байты по типам, группировка сторонних по регистрируемому домену, пороги CWV в UI, LoAF «worst offenders», переключатель PSI mobile/desktop. **UI:** легенда + тема-переменные waterfall, живой `onThemeChanged`, `<caption>`/`scope`.

**SEO:** (критично) background возвращал Promise из `onMessage` — на нативном Chrome ответ терялся, попап/панель висли → переведён на `sendResponse + return true` (конвенция дома); robots `content="none"` не считался noindex; относительный `og:image` давал битое превью → резолвинг + краулерские фолбэки og→title/description, twitter→og; JSON-LD верхнеуровневый массив пропускался; `Disallow: /` матчился вне группы `User-agent: *`; X-Robots HEAD-рефетч → best-effort с обработкой не-200; canonical http↔https читался как «указывает в другое место». **Фичи:** `<html lang>`, рекомендация длины description (120–160), фавиконка, sitemap из `robots.txt`, поблочное копирование. **UI:** severity текстом (не только цветом), подсказки видимым текстом (а не `title`), рабочий тумблер темы Auto/Light/Dark + `data-theme` в попапе, шапка по URL страницы (а не canonical).

**UI/UX (кросс-срез):** нативные контролы (`<select>`, скроллбары) не следовали тёмной теме → добавлен `color-scheme` во все попапы/options (для `data-theme`-поверхностей — с явными override).

## 18b. AdBlock: поштучные списки + разбивка по спискам (2026-07-11)

По запросу: (а) включать/выключать EasyList и прочие списки поштучно; (б) показывать, в каких списках встречается домен.

- **Поштучные тумблеры списков.** В core добавлен `blockAds` (EasyList как отдельно переключаемый список; миграция настроек v2 включает его для существующих). Вкладка **Filter lists** из read-only-таблицы стала интерактивной: тумблер на каждый список (EasyList/EasyPrivacy/Annoyances). Уровень строгости теперь **пресет** (`adBlockPresetForLevel`): выбор Off/Standard/Aggressive выставляет тумблеры, после чего любой список можно переопределить. Annoyances как сетевой список **декаплён** от уровня aggressive (generic-косметика по-прежнему привязана к уровню в content-скрипте). Оба бэкенда (DNR + Firefox webRequest) уважают per-list булевы.
- **Разбивка «в каких списках домен».** Попап показывает секцию «Filter lists matched here» — сколько заблокировано каждым списком на текущей странице. Chrome: из `rulesetId` в `getMatchedRules` (один вызов — и итоги, и разбивка, чтобы не жечь квоту 20/10мин), приблизительно (`~`). Firefox: точный per-list-счётчик в бэкенде (раздельные наборы ads/annoyances для атрибуции; `decideRequest` не менялся — его покрывают логические тесты 20/20). Честность метрик сохранена: `~` для приблизительного, exact на Firefox.

Проверено: typecheck ✅, Chrome+Firefox build ✅, adblock logic 20/20, live-скриншоты попапа и вкладки Filter lists (свет/тьма, 0 ошибок консоли) — тумблеры рендерятся и переключаются.

## 18c. Третий раунд аудита и правок (2026-07-11)

Свежий адверсариальный переаудит веером из 4 агентов (core+adblock, blur, perf, seo) — специально искали **регрессии от предыдущих раундов**. Core-агент подтвердил: все правки ядра из §18a корректны (hide-подсчёт, shadow-observer, splitSelectorList, clamp'ы, subdomain isAllowlisted). Найденное исправлено веером из 4 агентов-исправителей + core вручную. Все 4: typecheck ✅, Chrome+Firefox build ✅, adblock logic 20/20, unit-специи 13/13, live-попапы 0 ошибок консоли.

**Perf (регрессии от §18a-мирроринга состояния):**
- `getState()` при рехидратации затирал живой push, прилетевший во время `await` (потеря обновления) → перепроверка кэша после await.
- Гонка `forget()`/`perf:navigated` воскрешала LCP старой страницы (remove и get неупорядочены) → in-memory guard forgotten-tabs.
- `stop()` на `pagehide` навсегда отключал observers при bfcache-эвикции (после back/forward LoAF+ResourceTiming мертвы) → стоп только на терминальном unload + рестарт на `pageshow{persisted}`, идемпотентный guard.
- `har ?? rt` схлопывал вид до нескольких запросов, если DevTools открыли после загрузки → HAR берётся только когда не менее полон, чем RT.
- В HAR-режиме неизмеренные запросы молча исчезали из тотала → показ «Unmeasured» для обоих источников.
- `persist()` сериализовал все entries на каждый push (на Firefox storage.local — запись на диск несколько раз/сек) → debounce 600мс. + очистка stale-ключей `perf:tab:*` при старте.
- UI: `color-scheme` в панели (нативные контролы под тему DevTools); метка «exact bytes (cold load)»; Compare не сравнивает байты между разными источниками измерения.

**SEO (в т.ч. регрессия от §18a):**
- ⚠️ `/\b(noindex|none)\b/` ложно матчил `max-image-preview:none` → нормально индексируемая страница помечалась «исключена из поиска» (и в meta, и в X-Robots). Перешли на токенизацию: имя директивы (до `:`) должно быть ровно `noindex`/`none`.
- Соц-превью: `url()` без кавычек ломался на URL с пробелами/скобками → кавычки+эскейп. Sitemap из robots.txt на другом origin давал ложное «не удалось загрузить» → нейтральная заметка без fetch. FOUC темы → синхронный localStorage-сид перед `createRoot`. Canonical со стрипом всего query маскировал реальный mismatch пагинации → стрипаем только tracking-параметры. Фичи: probe `/favicon.ico` перед предупреждением; детект >1 canonical. UI: «Copied…» сбрасывается через 1.5с; уточнён текст соц-превью.

**Blur (в т.ч. отложенный из §18a пункт):**
- ⚠️ subdomain-aware `isAllowlisted` так и не был подключён → allowlist `example.com` не покрывал `www.example.com` (и отравлял pre-blur кэш). Подключён в content/popup/background.
- Инфляция счётчика span-текста (не пруннился при удалении узлов) → `commit()` со сбором живых span'ов. Link-hiding `a[href*="com"]` матчил вообще всё → host-анкеринг `//DOMAIN`/`.DOMAIN`. Nested-blur self-clobber → deep-merge blur-патча + дельта-патчи. image-gate late-load strand → `disposed`-флаг. Кросс-контекстная сериализация записей → `navigator.locks`. UI: `aria-controls` только на активном табе; полноценный tab/tabpanel в попапе. (Shadow-DOM text-blur осознанно отложен — корректная реализация затрагивает reveal/reblur-семантику в обоих стратегиях, полумеры сломали бы reveal.)

**AdBlock (регрессии от §18b-фичи):**
- Firefox-агрегат терял блоки при быстром reload/close (`resetTabState` чистил без фолда) → фолд перед очисткой.
- ⚠️ Миграция v2 теряла блокировку annoyances у aggressive-пользователей (в v1 annoyances выводились из уровня, не из тоггла) → миграция применяет `adBlockPresetForLevel(level)` как флор.
- `getTabLists` тратил DNR-квоту из background на Chromium (латентный footgun) → guard Firefox-only.
- Авто-резюме паузы включало вручную выключенный мастер → запоминаем pre-pause `enabled`, пауза no-op когда уже выключено.
- Core: описание Aggressive упоминало «regional lists», которых нет в бандле → убрано. UI: тумблер «Block annoyance requests» + заметка (сетевой список vs косметика по уровню). Фича: «Reset statistics» в About (двухшаговый confirm).

**Осталось:** Safari; shadow-DOM keyword-blur (отложен); DevTools-панели проверяются только своими e2e (live-скриншот вне DevTools невозможен).

## 18d. Прод-хардненинг (2026-07-11)

Довод до прод-готовности. Впервые прогнаны **все live-e2e** в headed-браузере (реальная загрузка собранных расширений):

| Suite | Результат | Что покрыто |
|---|---|---|
| adblock harness | **10/10** | реальная блокировка сети (net::ERR_BLOCKED_BY_CLIENT), косметика, allowlist, badge, element picker, backup round-trip |
| blur | **21/21** | CSS-блюр, текст/ключевые слова (кириллица+англ), hover/click-reveal, shadow DOM, MutationObserver, allowlist |
| perf | **11/11** | web-vitals, resource timing, честность байтов, PSI-гварды |
| seo | **15/15** | meta/canonical/robots/structured-data/indexability + live axe-core a11y |

**Найдено и исправлено прогоном e2e (не ловилось юнит-тестами):**
- blur harness писал настройки в `chrome.storage.sync`, но `settingsItem` в §18a переехал в `local:` → 4 теста падали. Harness обновлён (это был баг теста, не продукта).
- SEO: рекурсия JSON-LD из §18a добавляла корректные вложенные сущности (author Person) как отдельные блоки → счёт блоков раздувался (2 вместо 1). Теперь вложенные сущности валидируются, но в список попадают только при наличии проблемы (missing required); верхнеуровневые (+@graph) — всегда.

**Прод-ассеты:**
- **Иконки** — 16/32/48/128 px для всех 4 (не было вообще, блокер сабмита). Генератор `scripts/gen-icons.mjs` — без зависимостей (свой PNG-энкодер на `zlib` + CRC32, 4× суперсэмплинг). Каждая on-brand: blur (синие размытые круги), adblock (красный запрет), perf (зелёный спидометр), seo (фиолетовая лупа). Вписаны в манифесты (`icons` + `action.default_icon`), скрипт `npm run icons`.
- **Privacy policy** (`PRIVACY.md`) + **store-листинги/чеклист** (`STORE.md`): пер-расширенческие описания, обоснование каждого разрешения, single-purpose-рационале, требования AMO sources-zip.
- **Submission-zip'ы**: по каждому расширению chrome.zip + firefox.zip + **sources.zip** (12 файлов, `wxt zip`/`zip:firefox`).
- e2e подключены к npm-скриптам (`npm run e2e`, `e2e:blur/adblock/perf/seo/logic`).
- Исправлены неточности в доках (README-разрешения, устаревший «MOCK STAGE» — логика реальна и проверена live).

**Финальные проверки:** typecheck ✅ 0, Chrome build 4/4 ✅, Firefox build 4/4 ✅, adblock logic 20/20, e2e 57/57 (10+21+11+15), live-попапы/иконки 0 ошибок.

**Осталось (внешнее/вне окружения):**
- **Safari** — нужен macOS + Xcode + `safari-web-extension-converter` + Apple Developer Program ($99/год). Непроизводимо на Windows. Web-ext артефакт WXT собрал бы, но нативная обёртка/App Store — отдельная macOS-фаза.
- Реальный сабмит в сторы (нужны dev-аккаунты + человек), скриншоты/промо-тайлы для листингов, замена placeholder-gecko-id `@blur.example` на реальный домен (бизнес-решение).
- shadow-DOM keyword-blur — осознанно отложен.

**Осталось:**
- Safari по-прежнему не собран — отдельная фаза.
- Точность счётчиков блюра для min-size gate и link-hiding марджинально «щедрая»: у core-движка нет per-matched-element хука. Точный счёт потребует core-типа/колбэка — отложено, визуал корректен.
- DevTools-панели (perf/seo) проверены только сборкой/typecheck + их e2e; live-скриншот вне DevTools невозможен (нужен `chrome.devtools.inspectedWindow`). Прогнать их родные headed-e2e (`perf.spec.ts`, `seo.spec.ts`) на машине с headed-Chromium.
- Дедуп дизайн-токенов в `@blur/ui` — по-прежнему отложено.

## 17. Открытые вопросы (проверить перед соответствующей фазой)
- Точная версия Chrome для `topDomains`/`excludedTopDomains` (референс говорит 145+, на What's New не подтвердилось).
- Численные лимиты DNR в Firefox (MDN документирует имена констант, но не значения).
- Лицензия Peter Lowe's list для коммерческого использования — запросить разрешение или исключить.
- Поведение `text-shadow` в `::highlight()` в Firefox — тестировать вживую.
- `captureVisibleTab` на Firefox Android при DPR > 1 — есть баг с iframe (Bugzilla 1751961), проверить.
- Точные коды single-purpose отказов в Red-семействе Google периодически перетасовывает — ориентироваться на суть, не на код.

# ЧАСТЬ II — Волна 2: capture, devdata, export, assets, whoami, compose

> Продолжение Части I. Правила игры оттуда — single purpose, no remote code, минимизация разрешений, monorepo + WXT — остаются в силе и здесь. Основано на трёх research-агентах с проверкой по первоисточникам (developer.chrome.com, MDN/BCD, webstatus.dev, extensionworkshop.com, npm/GitHub, живые curl-пробы API); факты сверены на **2026-07-14**. Актуальный бэклог с чекбоксами — [`TODO.md`](./TODO.md).

---

## 🔴 0. Главное решение: шесть расширений, одна фича вырезана

Запрошено было пять идей. После проверки политик получается **шесть расширений** — и одна из запрошенных фич (скачивание видео) **не публикуется в Chrome Web Store вообще**.

| # | Расширение | Цель одной фразой | Магазины | Риск ревью |
|---|---|---|---|---|
| 5 | **Capture Studio**<br/>`extensions/capture` | «Записать вкладку и экспортировать медиа» | CWS + AMO (урезанный) | средний |
| 6 | **Data Format Toolkit**<br/>`extensions/devdata` | «Смотреть и конвертировать структурированные данные» | CWS + AMO | **минимальный** |
| 7 | **Page Content Exporter**<br/>`extensions/export` | «Сохранить контент страницы в файл» | CWS + AMO | **минимальный** |
| 8 | **Asset Inspector**<br/>`extensions/assets` | «Показать, откуда взялся любой элемент страницы» | CWS + AMO | **минимальный** |
| 9 | **Connection & Device Info**<br/>`extensions/whoami` | «Показать мои соединение и устройство» | CWS + AMO | низкий |
| 10 | **Markdown Workbench**<br/>`extensions/compose` | «Написать и отформатировать текст перед вставкой» | CWS + AMO | низкий |

Почему пять, а не четыре: идея №3 («вытаскивать контент со страницы») **разваливается по риску, а не по смыслу**. Экспорт выделенного текста и таблиц — нулевой риск и ноль install-предупреждений. Скачивание видео — прямое нарушение политики CWS (§4.1).

**Переосмысление №8 (решение от 2026-07-14).** Изначально это был Media Downloader, публикуемый только на AMO. Вместо этого меняем **назначение**: не «скачать медиа», а **«показать, откуда взялся контент»** — прямой URL, полная цепочка редиректов, запросы, которые его породили, кнопка «открыть в новой вкладке». Инспектор **ничего не скачивает и ничего не собирает из сегментов**. Это меняет всё: цель перестаёт быть про загрузку, расширение возвращается в Chrome Web Store, и — неожиданный бонус — ему **не нужны ни `webRequest`, ни `<all_urls>`** (§4.3). Из самого рискованного продукта волны он становится одним из самых безопасных.

---

## 🔴 1. Расширение 5 — Capture Studio (`extensions/capture`)

**Запрошено:** запись видео, скриншоты, конвертация/сжатие до заданного размера и разрешения, наложение текста/watermark.

**Вердикт: делается, но это самое дорогое расширение из пяти, и единой кодовой базы захвата под Chrome и Firefox не будет.**

### 1.1 ⚠️ Захват: два разных пайплайна, а не один

**Chrome (MV3):**
1. Клик по action → SW вызывает `chrome.tabCapture.getMediaStreamId()`. С **Chrome 116+** это можно делать прямо из service worker после user gesture ([screen-capture how-to](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)). Разрешение — `tabCapture`; семантика как у `activeTab`: только активная вкладка и только после инвокации расширения.
2. `streamId` **одноразовый и протухает за секунды**.
3. `MediaRecorder` **недоступен в service worker** (нет DOM). Официальный путь — `chrome.offscreen.createDocument({reasons: ['USER_MEDIA']})`, Chrome 109+ ([offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)). Там `getUserMedia({video: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: id}}})` → `MediaRecorder`.
4. Offscreen-документ **не имеет лимита длительности** (30-секундное автозакрытие есть только у reason `AUDIO_PLAYBACK`). Смерть SW запись **не убивает**. Но одновременно у расширения может быть **только один** offscreen-документ, и всё состояние записи должно жить в нём или в IndexedDB, а не в памяти SW.

**⚠️ Firefox — три отдельных обрыва:**
- **`chrome.offscreen` не существует.** Не нужен: у Firefox MV3 фон — это event page с DOM, `MediaRecorder` работает прямо там.
- **`chrome.tabCapture` не реализован вообще** ([Bugzilla 1391223](https://bugzilla.mozilla.org/show_bug.cgi?id=1391223), открыт с 2017). Замена — `getDisplayMedia()`, но он требует transient user activation → его нельзя дёрнуть из фона. Значит: запись ведётся **со страницы расширения** (`moz-extension://.../recorder.html`) или из sidebar. Popup не годится — он закрывается при потере фокуса и убивает поток вместе с документом.
- ⚠️ **`getDisplayMedia` в Firefox не отдаёт аудио** (`audio: version_added: false` в [BCD](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia#browser_compatibility)). **Запись звука вкладки/системы в Firefox невозможна.** Только микрофон через `getUserMedia`. Это не обходится — это отсутствующая фича платформы.

**Следствие:** общий у двух браузеров только пост-процессинг. Захват — два кода. Firefox-сборка честно объявляет «видео без звука вкладки».

### 1.2 Кодирование: WebCodecs + mediabunny, а НЕ ffmpeg.wasm

**Запись:**
- **Chrome 126+** умеет писать **MP4 напрямую из MediaRecorder** (H.264 `avc1` + AAC), [chromestatus 5163469011943424](https://chromestatus.com/feature/5163469011943424). Chrome ~136 добавил HEVC. То есть в Chrome целевой MP4 получается **без транскодирования вообще** — это главный дешёвый путь.
- ⚠️ **Firefox из MediaRecorder MP4 не пишет** — только WebM (VP8/VP9 + Opus). Значит на Firefox конвертация в MP4 **обязательна**, а не опциональна.

**Транскодирование / ресайз / таргет по размеру:**

| Вариант | Вердикт |
|---|---|
| **WebCodecs + [mediabunny](https://github.com/Vanilagy/mediabunny)** | ✅ **Основной путь.** v1.50.8 (2026-07-09), активно поддерживается, zero-deps, TS, читает/пишет MP4/MOV/WebM/MKV/HLS. Лицензия **MPL-2.0** (слабый копилефт: правки внутри файлов библиотеки надо открывать, линковка — нет) |
| `mp4-muxer` / `webm-muxer` | ❌ **DEPRECATED** тем же автором в пользу mediabunny. В новый проект не брать |
| `ffmpeg.wasm` | ⚠️ Только как тяжёлый фолбэк, см. ниже |

**WebCodecs — реальная матрица (BCD, 2026-07):**

| Класс | Chrome | Firefox | Firefox Android | Safari |
|---|---|---|---|---|
| `VideoEncoder` / `VideoDecoder` | 94 | **130** | ❌ | 16.4 |
| `AudioEncoder` | 94 | **130** | ❌ | 26 |
| `MediaStreamTrackProcessor` | 94 | ❌ **нет** | ❌ | 18 |

⚠️ **`MediaStreamTrackProcessor` (кадры прямо из трека — основа live-оверлея) в Firefox отсутствует.** Кросс-браузерный live-watermark делается через `canvas.captureStream()` (дороже по CPU) либо оверлей накладывается пост-фактум.

⚠️ **H.264-энкод в Firefox VideoEncoder не подтверждён первоисточником.** BCD не детализирует набор кодеков. Обязателен рантайм-проб `VideoEncoder.isConfigSupported({codec: 'avc1.42001f'})` и фолбэк на VP9/WebM. Если проб провалится — MP4 на Firefox потребует именно ffmpeg.wasm, со всеми его проблемами.

**ffmpeg.wasm — что о нём нужно знать до, а не после:**
- ⚠️ Дефолтный `ffmpeg.load()` в доках **тянет ядро с unpkg/jsDelivr**. Это remotely hosted code → **мгновенный reject в CWS и AMO**. CWS дословно относит **WASM** к коду: «anything that is executed by the browser that is loaded from someplace other than the extension's own files. Things like JavaScript and **WASM**» ([remote-hosted-code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)). Забандленный локально WASM — **разрешён**. Значит: `coreURL`/`wasmURL`/`workerURL` обязаны указывать на `chrome.runtime.getURL(...)`.
- SharedArrayBuffer нужен **только multithread-ядру** (`@ffmpeg/core-mt`). Однопоточное `@ffmpeg/core` работает без cross-origin isolation.
- Если всё же понадобится MT: манифест-ключи `cross_origin_embedder_policy` / `cross_origin_opener_policy` существуют и включают COI на страницах расширения (Chrome 93+, [дока](https://developer.chrome.com/docs/extensions/reference/manifest/cross-origin-embedder-policy)). ⚠️ Это **Chrome-only ключи**; в Firefox их нет → там только single-thread.
- CSP: для WASM нужен `"content_security_policy": {"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"}`.
- ⚠️ **Лимит входа 2 ГБ** (ограничение wasm). Длинные 4K-записи не влезут.
- ⚠️ **Лицензия ядра**: обёртка `@ffmpeg/ffmpeg` — MIT, но сам core — это FFmpeg (LGPL, а со сборкой с x264 — **GPL**). Проверить флаги сборки до релиза.
- ⚠️ **AMO потребует исходники WASM и воспроизводимые инструкции сборки** («Mozilla needs to review a copy of the source code before [minification/transpilation]»). Это реальное трение ревью — ещё один аргумент за mediabunny.

**Целевой размер файла** — двухпроходного rate-control в браузере нет. Рабочая техника:
1. `targetVideoBps = (target_bytes × 8 − audio_bps × duration) / duration`, минус ~2–5% на оверхед контейнера.
2. `VideoEncoder.configure({bitrate, bitrateMode: 'constant', width, height, framerate})`; mediabunny Conversion API даёт `width`/`height`/`fit: 'fill' | 'contain' | 'cover'` и `bitrate`, а событие `write` на Target — число записанных байт в реальном времени.
3. ⚠️ Готовой опции «target file size» **нет ни у кого**. Реализуем итеративно: прогон → замер → `newBps = bps × target / actual` → повтор. Это и есть ручной 2-pass.
4. ⚠️ `MediaRecorder.videoBitsPerSecond` — только **пожелание**, браузер вправе отклониться. Значит: **таргетировать размер на этапе пост-конверсии, а не записи.**

### 1.3 Watermark / текст

- **Картинки**: `OffscreenCanvas` + `drawImage` + `fillText` → `convertToBlob({type, quality})`. Ресайз и попадание в размер — итеративным подбором `quality`.
- **Видео, live**: `<video>` из MediaStream → `ctx.drawImage` каждый кадр → `canvas.captureStream()` → MediaRecorder. Кросс-браузерно, но жжёт CPU и режет fps.
- **Видео, пост-обработка**: decode (mediabunny/`VideoDecoder`) → `VideoFrame` → `OffscreenCanvas` + текст → `new VideoFrame(canvas, {timestamp})` → `VideoEncoder` → mux.
- ⚠️ **Каждый `VideoFrame` обязан быть `close()`-нут.** Незакрытые кадры исчерпывают пул буферов декодера/GPU, и пайплайн встаёт намертво. Стандартный паттерн — дропать кадр при `encoder.encodeQueueSize > 2`, следить за `decodeQueueSize`.
- ⚠️ **Tainted canvas**: сам MediaStream канвас не пачкает, но **картинку-логотип для watermark нужно грузить из пакета** (`runtime.getURL`). Внешний URL без CORS сделает канвас tainted, и `convertToBlob()` упадёт.
- Длинную запись держать чанками в IndexedDB, а не массивом Blob в RAM.

### 1.4 Разрешения и стор

Прецедент — **Screenity** (MV3, GPL-3.0, жив в CWS), [манифест](https://raw.githubusercontent.com/alyssaxuu/screenity/master/src/manifest.json): `permissions: identity, activeTab, storage, unlimitedStorage, downloads, tabs, tabCapture, scripting, system.display, power`; `optional_permissions: offscreen, desktopCapture, alarms, clipboardWrite`; `host_permissions: <all_urls>`.

Наш целевой набор — **уже**: `tabCapture`, `offscreen`, `storage`, `unlimitedStorage`, `downloads`, `activeTab`. `desktopCapture` — в `optional_permissions`. Без `<all_urls>`, если не делать оверлей-контролов на самой странице (а лучше не делать — это и есть та ручка, за которую ревьюер тянет).

Single purpose проходит: «скринкаст-рекордер с редактором и экспортом» — валидная focus area. Политика прямо разрешает: «If the extension has a narrow focus area or subject matter, then it can offer various functions related to that focus area» ([quality-guidelines-faq](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq)).

⚠️ **Privacy policy обязателен, даже если всё локально**: «Extensions are required to disclose how they handle user data, **even when data is processed or stored locally** on a user's device and is not transmitted to external servers» ([user-data-faq](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)).

### 1.5 ⚠️ Мобильные — ноль

`getDisplayMedia` на Firefox Android — `version_added: false`. `tabCapture` в Firefox нет нигде. WebCodecs на Firefox Android — нет. `MediaRecorder` есть, но записывать нечего. **Запись экрана в мобильном расширении невозможна.** Chrome Android расширений не поддерживает вовсе.

---

## 2. Расширение 6 — Data Format Toolkit (`extensions/devdata`)

**Запрошено:** beautify любого JSON, декодирование токенов (JWT), конвертация JSON ↔ XML.

**Вердикт: самое лёгкое из пяти. Baseline-сборка проходит ревью с НУЛЁМ install-предупреждений.**

### 2.1 Single purpose — проходит

JSON + XML + YAML + CSV + JWT — это всё «инспекция и преобразование структурированных данных для разработчика». Ключевое слово политики — **unrelated** («bundles of **unrelated** functionality»); примеры нарушений там — «рейтинги товаров + инъекция рекламы», то есть несвязанные домены. Наши форматы — один связный домен.

Практические правила, чтобы не словить отказ:
- Название/описание формулируют **одно** назначение: не «JSON tools + JWT decoder + XML converter», а «Developer data inspector: view, validate and convert structured data».
- Всё в **одном UI** (табы одного инструмента), а не три продукта в общей оболочке.
- ⚠️ **Ничего сетевого.** Ни шортенера, ни «отправить в облако», ни аналитики. Именно в этот момент single purpose и ломается.

### 2.2 ⚠️ Авто-prettify JSON невозможен без broad host permissions

- `document.contentType` (Baseline с 2018) даёт MIME документа — на `document_start` проверяем `application/json` и `+json`. Это штатный способ, так делает [callumlocke/json-formatter](https://github.com/callumlocke/json-formatter) (у него в манифесте `webRequest` + `host_permissions: <all_urls>` + content script на `document_start` + скрипт в `world: MAIN`).
- ⚠️ **`activeTab` не спасает**: он выдаётся **только по явному жесту** — клик по иконке, контекстное меню, горячая клавиша, omnibox. «activeTab does NOT activate automatically on navigation or page load» ([дока](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)).
- ⚠️ **`declarativeContent` задачу не решает**: в MV3 у него только `ShowAction`/`SetIcon`; действие `RequestContentScript` — «still experimental and is not supported on stable builds», а в Firefox — [WONTFIX](https://bugzilla.mozilla.org/show_bug.cgi?id=1323433).
- ⚠️ **У Firefox есть встроенный JSON viewer** (`devtools.jsonview.enabled`, включён по умолчанию), который перехватывает `application/json`. Расширение **не может отключить этот pref программно** — пользователю пришлось бы делать это руками.

**Архитектура — два режима:**
- **Baseline (дефолт)**: popup / side panel / полноэкранная страница инструмента + `activeTab` + контекстное меню «Format JSON on this page». Разрешения: `storage` + `contextMenus` + `activeTab`. **Ноль install-предупреждений**, ревью мгновенное.
- **Опционально**: `optional_host_permissions: ["<all_urls>"]`, запрашиваемые через `permissions.request()` из UI по тумблеру «включить авто-форматирование». Предупреждение видят только те, кто сам согласился. На Firefox честно писать, что мешает встроенный viewer.

### 2.3 ⚠️ JWT — это credential, и рамка продукта решает всё

JWT-токен — это учётные данные. `authenticationInfo` — явная категория данных в дашборде CWS. Пока декодер **чисто локальный**, сбора нет и privacy policy по этой категории не требуется. Как только токен уходит наружу (аналитика, sentry, ваш бэкенд) — это сбор authentication information с обязательным **prominent disclosure внутри UI расширения**: «disclosures in the Chrome Web Store description ... do not satisfy this requirement» ([policies](https://developer.chrome.com/docs/webstore/program-policies/policies)).

Правильная рамка (копируем позиционирование jwt.io: «JWTs are credentials... Be careful where you paste them!»):
> **100% offline. Токен никогда не покидает браузер. Ноль сети, ноль аналитики, открытый код.**

Технически подкрепляем: никаких host permissions, CSP без внешнего `connect-src`.

Верификация подписи:
- **RS/ES/EdDSA по публичному ключу** — безопасный дефолт. Ключ вставляет пользователь (JWK/PEM). ⚠️ Fetch JWKS по URL = сетевой запрос → `optional_host_permissions` + раскрытие. Лучше без него.
- ⚠️ **HS256 требует shared secret.** Если разрешаем — строго in-memory, **без persist в `storage`**, с явной надписью. Иначе вы храните `authenticationInfo`.
- ⚠️ **Никогда** не отправлять токен наружу для верификации.

Библиотека: **`jose` 6.2.3** (MIT, zero-deps, на WebCrypto → работает под MV3 CSP без eval). Для простого декода подпись не нужна: `atob` + base64url ≈ 20 строк.

### 2.4 ⚠️ AJV не работает под MV3 CSP

`ajv.compile()` использует `new Function()`. MV3 запрещает `unsafe-eval` на страницах расширения и в SW. Обходы:
1. Precompile схем в build-time — ❌ **не годится**, пользователь не сможет подставить свою схему.
2. Sandboxed page (`"sandbox"` в манифесте, там свой CSP с `unsafe-eval`) — рабочий паттерн, но ⚠️ **ключ `sandbox` не поддерживается в Firefox**.
3. ✅ **Интерпретирующий валидатор `@cfworker/json-schema`** (MIT, zero-eval, ~15 КБ) — сделан именно для CSP-ограниченных сред. **Берём его.**

### 2.5 Библиотеки и нативные API (2026)

| Задача | Решение | Лицензия | Заметка |
|---|---|---|---|
| JSON5 | `json5` 2.2.3 | MIT | zero-deps |
| JSONC + оффсеты токенов | `jsonc-parser` 3.3.1 | MIT | от VS Code, error-tolerant, даёт позиции |
| YAML | `yaml` (eemeli) 2.9.0 | **ISC**, zero-deps | эталон 2026; **не** js-yaml |
| CSV | `papaparse` 5.5.4 | MIT | |
| JWT | `jose` 6.2.3 | MIT | WebCrypto |
| JSON Schema | `@cfworker/json-schema` | MIT | zero-eval, см. §2.4 |
| **XML ↔ JSON** | ⚠️ **нативный `DOMParser` + `XMLSerializer`** | — | **0 КБ.** `fast-xml-parser` v5 притащил 6 транзитивных зависимостей — не стоит того |

**Нативное вместо библиотек:**
- ✅ **`JSON.parse` source access (ES2026)**: reviver получает 3-й аргумент `context.source` + `JSON.rawJSON()`. **Решает проблему BigInt/точности** — можно показать исходное `12345678901234567890`, а не `12345678901234567000`. Реальная киллер-фича для JSON-viewer'а. ⚠️ Оффсетов токенов не даёт — для подсветки ошибок всё равно нужен `jsonc-parser`.
- ✅ **CSS Custom Highlight API** (Baseline newly, июнь 2025): держим **один плоский `<pre>`** и красим `Range`-объектами через `::highlight()`. Никаких десятков тысяч `<span>`, никакого Prism/highlight.js на 200 КБ. Токенизатор JSON пишется сам. ⚠️ Ограничение: доступны только `color`, `background-color`, `text-decoration`, `text-shadow` — **`font-weight` менять нельзя**. Для JSON достаточно.
- ✅ `content-visibility` (Baseline newly, 2025-09-15), `<dialog>` (widely), Popover API (newly, 2025-01), `:has()` (widely).
- ⚠️ **CSS Anchor Positioning — Baseline `limited`, только Chromium.** Не полагаться.
- ⚠️ `field-sizing` — newly с 2026-06-16, месяц от роду. Только как прогрессивное улучшение.

**Рендер 50 МБ JSON без фриза:** парсинг в **Web Worker** (в extension page воркеры разрешены) + виртуализация (flatten дерева в плоский массив видимых строк, рендер окна ~100 строк) + `content-visibility: auto` + подсветка Highlight API **только по видимому окну**. Библиотека не обязательна; при желании `@tanstack/virtual` (MIT, ~10 КБ).

---

## 3. Расширение 7 — Page Content Exporter (`extensions/export`)

**Запрошено (безопасная часть идеи №3):** выделенный текст → `.txt`/`.md`, HTML-таблица → `.csv`/`.xlsx`, картинки → скачать / скопировать URL / открыть прямой URL в новой вкладке.

**Вердикт: ноль policy-риска, почти ноль install-предупреждений. Это основной безопасный продукт из идеи №3.**

### 3.1 ⚠️ Разрешение `downloads` — НЕ нужно

Content script может сам: `new Blob([text])` → `URL.createObjectURL` → `<a download="x.txt">` → `.click()`. Это чистый веб-API, расширение здесь ничем не привилегировано. Работает одинаково в Chrome и Firefox. Жёсткий CSP страницы на это не влияет (`<a download>` — не загрузка ресурса, а навигация на download).

Минимальный манифест: `contextMenus` + `activeTab` (+ опц. `scripting`). **Ни один из них не даёт install-предупреждения** ([permissions-list](https://developer.chrome.com/docs/extensions/reference/permissions-list)) — расширение ставится вообще без страшилок.

`downloads` (предупреждение «Manage your downloads») берём **только** если нужен `saveAs`-диалог, контроль имени файла и отслеживание статуса. Тогда ⚠️ помним:
- **SW не имеет DOM и `URL.createObjectURL`.** Для blob-URL из фона нужен offscreen-документ с reason **`BLOBS`** (он ровно для этого и существует). В Firefox event page имеет DOM — offscreen не нужен и его нет.
- **Ревокать `objectURL` после завершения**, слушая `downloads.onChanged` — иначе течёт память ([MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/download)).

### 3.2 XLSX — ⚠️ SheetJS брать нельзя

| Библиотека | Лицензия | Статус | Вердикт |
|---|---|---|---|
| **`write-excel-file`** | **MIT** | активна, свежие релизы, браузерная сборка отдаёт Blob, единственная зависимость `fflate` (MIT) | ✅ **Берём** |
| SheetJS (`xlsx`) CE | Apache-2.0 | ⚠️ **Ушли с npm.** Актуальные версии только со своего CDN `cdn.sheetjs.com`; на npmjs висит протухшая 0.18.5 | ❌ Тянуть тарбол со стороннего CDN мимо lock-файла — лишнее трение на ревью (Code Readability Requirements) |
| `exceljs` | MIT | последний релиз **окт 2023**, фактически заброшена | ❌ И тяжёлая |

CSV — вообще без библиотеки: Blob + экранирование кавычек + **BOM `﻿`** (иначе Excel ломает кириллицу).

### 3.3 Картинки и «открыть прямой URL»

- Скачивание картинок — практически безрисково, дублирует нативное «Save image as…».
- **«Открыть прямой URL в новой вкладке» — нулевой риск**: это `tabs.create({url})`, навигация на URL, который браузер и так открывает. ⚠️ Но **не подавать это в описании как способ скачать видео** — ревью CWS ловит намерение по метаданным, а не только по коду.
- Копирование в буфер — `clipboardWrite`, предупреждения нет.

---

## 4. Расширение 8 — Asset Inspector (`extensions/assets`)

**Было:** Media Downloader — «скачать медиафайлы», публикуемый только на AMO, с 🔴-риском в Chrome.
**Стало (решение 2026-07-14):** **Asset Inspector** — «показать, откуда взялся любой элемент страницы».

Цель одной фразой: **«Найти источник любого элемента на странице и запросы, которые его загрузили».** Инспектор, а не загрузчик. Ничего не скачивает, ничего не собирает из сегментов, не хранит.

**Вердикт: возвращается в Chrome Web Store, риск ревью — минимальный, и ему не нужны ни `webRequest`, ни `<all_urls>`.**

### 4.1 Почему смена назначения снимает риск

Запрещена не техника, а **цель**. Политика бьёт по «facilitate ... download ... of copyrighted content or media» (§4.5). Инспектор не facilitates download: он показывает, **что это за ресурс и откуда он взялся**, и умеет открыть URL в новой вкладке — то есть выполнить обычную навигацию, которую браузер и так выполняет по любой ссылке. Никакого `fetch` медиа, никакого сохранения, никакого стичинга сегментов, никакого разрешения `downloads`.

⚠️ **Но граница тонкая, и держится она на формулировках и на отсутствии кнопки.** Практические инварианты, которые нельзя нарушать:
- **Нет кнопки «Скачать».** Нет разрешения `downloads`. Нет `fetch()` медиа-ресурса кодом расширения.
- **Нет парсинга `.m3u8`/`.mpd` и склейки сегментов.** Манифест можно **показать как ресурс** («этот плеер тянет HLS отсюда»), но не разбирать и не собирать.
- **Нет обхода `controlsList="nodownload"`**, нет подстановки cookie/заголовков к gated-ресурсам.
- **В листинге ни разу не звучит «download», «downloader», «save video», «ripper»**, нет логотипов стриминговых сервисов на скриншотах. Ревью CWS ловит намерение по метаданным не хуже, чем по коду.
- Позиционирование — **инструмент разработчика/QA/верстальщика**, а не «качалка».

### 4.2 🆕 Архитектура: ноль install-предупреждений

Это главная находка пересмотра. Всё, что нужно инспектору, достаётся **без `webRequest` и без broad host permissions**:

| Что нужно | Откуда берём | Разрешение |
|---|---|---|
| Element picker («укажи на элемент») | Инъекция picker-скрипта по клику на иконку | `activeTab` + `scripting` — **предупреждения нет** |
| Финальный URL элемента | `img.currentSrc`, `video.currentSrc`, `source.src`, `getComputedStyle().backgroundImage`, `poster` | — |
| Список всех запросов страницы | `performance.getEntriesByType('resource')` — URL, `initiatorType`, тайминги, размер | — (обычный веб-API) |
| Кто инициатор запроса (стек/тег) | ⚠️ DevTools-панель: `chrome.devtools.network.onRequestFinished` → HAR `_initiator` | `devtools_page` — **предупреждения нет** |
| Цепочка редиректов | HAR (`redirectURL`) в DevTools-панели; вне DevTools — только финальный URL | — |

Итоговый манифест: **`activeTab`, `scripting`, `storage`, `contextMenus`, `devtools_page`.** Ни одно из них не даёт install-предупреждения ([permissions-list](https://developer.chrome.com/docs/extensions/reference/permissions-list)). Это класс `seo` — самое безобидное расширение в портфеле.

⚠️ **Честные ограничения этой архитектуры, которые надо показать в UI, а не замалчивать:**
- `PerformanceResourceTiming.transferSize` = **0 для cross-origin без `Timing-Allow-Origin`** (это уже разобрано в `PLAN.md` §8 — переиспользовать вывод). Вес третьесторонних ресурсов честно помечать как «не измерен», а не показывать ноль.
- **Инициатор запроса вне DevTools недоступен.** Без открытой панели показываем `initiatorType` (`img`/`css`/`script`/`fetch`/`xmlhttprequest`) — это грубо, но честно. Полная цепочка «какой скрипт на какой строке вызвал этот запрос» — только в DevTools-панели.
- Буфер resource timing по умолчанию ограничен (~250 записей). ⚠️ **Исправление (дизайн assets, 2026-07-14):** при переполнении браузер **отбрасывает НОВЫЕ** записи, а не вытесняет ранние (спека Resource Timing: событие `resourcetimingbufferfull`, дальнейшие записи не буферизуются). То есть запросы **до** открытия инспектора как раз видны, а теряются **поздние**. Ставить `performance.setResourceTimingBufferSize()` повыше при инъекции и предупреждать про потерю поздних запросов на очень тяжёлых страницах.
- ⚠️ `chrome.debugger` **брать нельзя**: он занят расширением `perf` (`PLAN.md` §0), даёт неубираемый жёлтый баннер и мгновенно превращает «инспектор картинок» в подозрительный продукт.

### 4.3 ⚠️ Разграничение с `perf` — обязательное

Опасность: «инспектор ресурсов и запросов» звучит близко к сетевой панели `perf`. Граница проводится так и должна соблюдаться в коде и в листингах:

| | `perf` | `assets` |
|---|---|---|
| Вопрос | «Насколько быстро и тяжело грузится **страница**» | «Что это за **элемент** и откуда он взялся» |
| Точка входа | Страница целиком, waterfall, CWV | Указанный элемент |
| Метрика | Время, байты, LCP/INP/CLS | URL, тип, формат, кодек, редиректы, инициатор |
| `debugger` | да (opt-in) | 🔴 никогда |

Если `assets` начнёт показывать waterfall и считать вес страницы — это уже `perf`, и продукты надо сливать, а не плодить.

### 4.4 Что делать с MSE / DRM — показывать правду, а не скрывать

Это, парадоксально, **становится фичей**. Пользователь тыкает в плеер YouTube и видит честную карточку:

> **Источник: MediaSource (MSE)**
> Прямого URL у этого видео не существует — плеер собирает его из сегментов в памяти. Загрузившие его запросы: `…googlevideo.com/videoplayback?…` (312 запросов, media)
> **DRM:** активен (EME) — контент зашифрован в CDM

Это ровно то, что инженеру и нужно знать, и это **не даунлоадер**: мы объясняем, почему прямого файла нет, а не пытаемся его собрать.

⚠️ **Исправление (дизайн assets, 2026-07-14):** назвать конкретную key-system («Widevine») **нельзя** без перехвата `requestMediaKeySystemAccess` до старта плеера, а это `<all_urls>` + `document_start` MAIN-world скрипт, которого у `assets` нет по определению. Карточка честно показывает «EME активен» и объясняет, почему имя системы недоступно — не выдумывает «Widevine».

### 4.5 Исходное исследование — почему загрузчик был бы 🔴 (сохранено)

Раздел **Prohibited Products** страницы [Malicious and Prohibited Products](https://developer.chrome.com/docs/webstore/program-policies/malicious-and-prohibited), дословно:

Раздел **Prohibited Products** страницы [Malicious and Prohibited Products](https://developer.chrome.com/docs/webstore/program-policies/malicious-and-prohibited), дословно:

> «Do not facilitate unauthorized access to content on websites, such as circumventing paywalls or login restrictions.»
>
> «Do not encourage, facilitate, or enable the unauthorized access, **download**, or streaming of copyrighted content or **media**.»

Правило написано **широко и намеренно** — «любой copyrighted content or media», без упоминания конкретных сайтов. Ревьюеру не нужно доказывать нарушение чьего-то ToS. Коды отклонения — **Blue Zinc / Blue Copper / Blue Lithium / Blue Magnesium** ([troubleshooting](https://developer.chrome.com/docs/webstore/troubleshooting)).

**Carve-out «пользователь имеет права» в тексте политики отсутствует.** Слово-предохранитель — «unauthorized», но generic-расширение по определению не может утверждать, что скачивание authorized.

**Что реально приводит к сносу:** YouTube и другие платформы Google (безусловный бан); обход paywall/login; стичинг HLS/DASH-сегментов; и — половина случаев — **метаданные листинга**: «YouTube downloader», «download any video», логотипы стримингов в скриншотах.

**Прецедент, который всё объясняет:** Video DownloadHelper жив в CWS — **но без YouTube**; на AMO — с YouTube. Мейнтейнеры прямо пишут: «the Chrome Web Store does not allow extensions for downloading YouTube videos so we could not include this feature in the Chrome version» ([discussion #1016](https://github.com/aclap-dev/video-downloadhelper/discussions/1016)).

**AMO — запрета нет.** Add-on Policies ссылаются на Acceptable Use Policy («не нарушать copyright/IP»), плюс DMCA-режим по жалобе. Модель «полная версия для Firefox, урезанная или отсутствующая для Chrome» — стандартная и рабочая.

### 4.6 ⚠️ Технический потолок: половину видео в интернете скачать нельзя в принципе

*(Осталось релевантным: именно это инспектор и объясняет пользователю — см. §4.4.)*

- **MSE / `blob:` — тупик.** Плееры на Media Source Extensions (YouTube, Vimeo, Twitch, почти все стриминги) **не имеют скачиваемого URL**: `video.currentSrc` вернёт `blob:https://…`, а это не файл, а хэндл на in-memory буферы ([MDN MSE](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API)). Ни `fetch`, ни `downloads.download` с ним осмысленно не работают.
- Чтобы получить файл, нужно: перехватить манифест (`.m3u8`/`.mpd`) → распарсить → скачать все сегменты → сшить/ремуксить. **Это ровно та функциональность, за которую сносят в CWS.** Техническая сложность и юридический риск совпадают в одной точке.
- **DRM / EME (Widevine) — невозможно.** Расшифровка живёт в CDM, бинарном модуле вне досягаемости JS; расшифрованные кадры в JS/DOM не попадают никогда ([MDN EME](https://developer.mozilla.org/en-US/docs/Web/API/Encrypted_Media_Extensions_API)). Netflix/Disney+/Prime — технически вне игры независимо от политики.
- Что **работает**: прогрессивный `<video src="...mp4">` / `<source>` через DOM, плюс пассивное наблюдение `webRequest.onBeforeRequest` (в MV3 `webRequest` **остался**, ушёл только `webRequestBlocking`) — но `webRequest` + `<all_urls>` и есть главный триггер ручного ревью.

### 4.7 Если когда-нибудь захочется вернуть загрузчик

Не возвращать его в `assets`. Это был бы **отдельный продукт для AMO** (в CWS — не подавать; прецедент Video DownloadHelper: жив в CWS без YouTube, на AMO — с ним). ⚠️ И **никогда** не смешивать ни с `assets`, ни с `export`: рецидив ведёт к бану аккаунта разработчика (Repeat Abuse), и безопасные продукты уедут вместе с рискованным.

---

## 5. Расширение 9 — Connection & Device Info (`extensions/whoami`)

**Запрошено:** полная информация об user agent, IP, браузере, стране, провайдере.

**Вердикт: делается. Вся «device»-часть — с НУЛЁМ разрешений и НУЛЁМ сети. IP/страна/провайдер — обязательно внешний запрос, и это единственное место, где появляется сбор данных.**

### 5.1 Локально, `"permissions": []`, ноль сети

`navigator.userAgent`, `navigator.languages`, `Intl.DateTimeFormat().resolvedOptions()` (timezone, locale, calendar), `screen.*` + `devicePixelRatio` + `screen.orientation`, `navigator.hardwareConcurrency`, `navigator.maxTouchPoints`, `navigator.storage.estimate()`, `navigator.cookieEnabled`, `navigator.globalPrivacyControl`, `matchMedia('(prefers-color-scheme: dark)')` / `prefers-reduced-motion` / `forced-colors`.

⚠️ **Chromium-only — обязательна graceful degradation, а не пустые поля:**
- **`navigator.userAgentData` / `getHighEntropyValues()`** (архитектура, разрядность, модель, полная версия ОС) — **Firefox и Safari не реализовали и не планируют**. MDN: «Limited availability». Это половина «полного UA», и её на Firefox не будет.
- `navigator.deviceMemory` — Baseline **limited**, Chromium-only, значения квантованы (0.25/0.5/1/2/4/8).
- `navigator.connection` (NetworkInformation) — Baseline **limited**. В Chrome **desktop** только `effectiveType`, `downlink`, `rtt`, `saveData`; `type` (wifi/cellular) — только на Android.
- `navigator.gpu` / WebGPU — Baseline **limited** (Safari 26 с сент. 2025). ⚠️ В Chrome `adapter.info.device`/`.description` часто **пустые строки** по privacy-соображениям.
- ⚠️ **`WEBGL_debug_renderer_info` не deprecated, но ненадёжен**: в Firefox **отключается при `privacy.resistFingerprinting`**. Использовать с фолбэком на `navigator.gpu` и честным «Unavailable» в UI.

### 5.2 ⚠️ IP: локального источника не существует

- Ни один WebExtension API не возвращает IP клиента. `webRequest.onResponseStarted.details.ip` — это IP **сервера**, а не пользователя.
- ⚠️ **WebRTC local-IP leak закрыт.** Chrome/Firefox/Safari обфусцируют host-кандидатов через **mDNS**: вместо `192.168.1.105` приходит `a1b2c3d4-….local`, меняющийся от сессии к сессии ([Chromium issue 40591226](https://issues.chromium.org/issues/40591226)). LAN-IP получить нельзя. STUN-хак даёт публичный IP, но это тот же внешний запрос, только подозрительнее на ревью.
- Country/ISP без третьей стороны — **невозможно**. Встроить GeoLite2 (~6 МБ, ⚠️ EULA MaxMind) бессмысленно: своего IP всё равно нет.

**Провайдеры (проверено живыми запросами 2026-07-14):**

| Сервис | Ключ | HTTPS | CORS | Отдаёт | Вердикт |
|---|---|---|---|---|---|
| **Cloudflare `one.one.one.one/cdn-cgi/trace`** | нет | ✅ | ✅ `ACAO: *` | `ip`, `loc` (ISO-код страны), `colo`, `tls`, `warp`. ⚠️ **Ни ISP, ни ASN, ни города** | ✅ Дефолт. Формат `key=value`, парсится в 3 строки. Брать `one.one.one.one`, а не `www.cloudflare.com` (тот ставит cookie). ⚠️ Публичного SLA/ToS у эндпоинта нет — он диагностический, может измениться |
| **ipinfo.io** (Lite) | ✅ обязателен | ✅ | ✅ | ip, asn, as_name, as_domain, country, continent; без лимитов на Lite | ✅ Для обогащения ASN/ISP. ⚠️ Токен в расширении = токен публичен |
| **ipapi.co** | нет для базового | ✅ | ✅ | + city, region, postal, org/asn | ~1000 req/day без ключа; для коммерции нужен план |
| **ip-api.com** | — | ❌ | — | — | 🔴 **ИСКЛЮЧИТЬ.** Два блокера: на free **нет HTTPS** (`SSL unavailable for this endpoint`) → под MV3 CSP физически не заработает; и прямой запрет: «The use of the API is strictly limited for a non-commercial purpose» ([legal](https://ip-api.com/docs/legal)) |

**Архитектура:** Cloudflare trace (IP, страна, TLS, PoP) как дефолт + **обогащение ASN/ISP через ipinfo.io строго по явному клику**, с `optional_host_permissions` на **конкретный домен API** (`https://ipinfo.io/*`), а не `<all_urls>`.

⚠️ **`<all_urls>` в этой категории — почти гарантированный отказ.** Просить доступ ко всем сайтам ради показа собственного IP невозможно оправдать. Прецеденты в сторе просят host permission на конкретный API-домен, и предупреждение выглядит как «Read and change your data on ipinfo.io».

### 5.3 ⚠️ Раскрытие данных и «фингерпринтинг»

Отправка IP третьей стороне — **это сбор данных**. Обязательно:
- Privacy policy с указанием ipinfo.io как получателя.
- **Prominent disclosure внутри UI расширения** до первого запроса — не в описании стора: «disclosures in the Chrome Web Store description ... do not satisfy this requirement».
- Limited Use: данные только для заявленной цели, никакой передачи брокерам.
- ⚠️ **С 1 августа 2026** ([policy update](https://developer.chrome.com/blog/cws-policy-updates-2026)) сбор должен быть *strictly necessary* для single purpose, **любой** сбор — prominently disclosed. Делаем lookup **opt-in по кнопке** — это снимает почти весь риск.
- Firefox: `data_collection_permissions` → при opt-in-схеме `required: ["none"]`, а `locationInfo` запрашивать optional-флоу. Тогда установка проходит вообще без data-warning.

**Про фингерпринтинг:** слова «fingerprinting» в Program Policies **нет** (проверено), запрета показывать эти данные **самому пользователю** тоже нет. Риск не политический, а ревьюерский: категория «what's my IP» кишит спамом → повышенный шанс ручной проверки.
⚠️ **Красная линия: не вычислять, не хранить и не передавать стабильный fingerprint-хеш.** Это уже идентификатор → PII → сбор, не «strictly necessary» для «показать инфо пользователю». Дизайн-правило: **всё считается в рантайме, ничего не персистится, ноль аналитики.**

### 5.4 ⚠️ UA-switcher — отдельный продукт, не сюда

Технически работает: DNR `modifyHeaders` (`user-agent`, operation `set`) + content script в `world: MAIN` на `document_start`, переопределяющий `navigator.userAgent` через `defineProperty`.

Но:
- ⚠️ Это **гонка** — скрипты страницы могут прочитать UA раньше. Надёжного способа нет.
- ⚠️ **`Sec-CH-UA` (UA-CH) продолжат выдавать настоящий бренд**, если их не подменять отдельно → рассинхрон детектится тривиально.
- ⚠️ Требует `declarativeNetRequest` («Block content on any page») + `<all_urls>` («Read and change all your data on all websites») — это **уничтожает zero-permission позиционирование** расширения 9.
- 🔴 **Политически: «показать мою информацию» (read-only, локально) и «подменять User-Agent на всех сайтах» (write, перехват трафика) — ровно тот случай, который single-purpose требует разнести.** Плюс с 1 августа 2026 обработка должна быть strictly necessary к цели — модификация трафика не является necessary для «display connection info».

**Вывод: UA-switcher — потенциальное расширение №10, отдельным продуктом. В бэклоге, не в этой волне.**

---

## 6. Расширение 10 — Markdown Workbench (`extensions/compose`)

**Запрошено:** редактор текста с regexp, подсчётом символов, транслитерацией кириллицы в латиницу, и главное — помощник по составлению хорошего `.md`, который можно вставить в GitLab, в баг-репорт и куда угодно: эмодзи, чекбоксы, раскрывающиеся списки, жирный шрифт.

**Вердикт: делается, ноль сети, ноль install-предупреждений. Но single purpose держится на формулировке, а не на функциях — см. §6.1.**

### 6.1 ⚠️ Single purpose: это одно расширение только если regex и транслит — ЧАСТИ редактора

Опасность очевидна: «regex-тестер + счётчик символов + транслитератор + markdown-редактор» читается как **швейцарский нож**, а это и есть определение bundle'а («Don't create an extension that requires users to accept bundles of unrelated functionality»).

Спасает то, что каждая из этих функций — **операция над текстом, который ты пишешь прямо здесь**:

| Функция | Как позиционируется | Как **нельзя** позиционировать |
|---|---|---|
| Regex | **Find & Replace по regex внутри черновика** | Standalone regex playground |
| Транслитерация | **Преобразование выделенного фрагмента** (и slug для веток/якорей) | Отдельный конвертер |
| Счётчик | **Статистика черновика** + лимиты целевых площадок | Отдельный счётчик символов |
| Markdown | Ядро | — |

Формулировка цели: **«Написать и отформатировать текст перед вставкой»**. Всё служит ей. Правило в коде: **ни одна функция не имеет собственной точки входа** — только табы/панели одного редактора. Если regex получит свою иконку/попап — расширение превращается в bundle.

⚠️ Отсюда же следует, что regex-тестер **не идёт в `devdata`** (там он был бы уже посторонним), а транслит **не идёт в `export`**. Каждая живёт ровно в одном продукте.

### 6.2 Ядро: Markdown под целевую площадку 🆕

Ключевая мысль, которой нет у конкурентов: **«вставить куда угодно» — это ложь, площадки несовместимы.** Один и тот же текст в GitHub, GitLab, Jira и Slack выглядит по-разному, и половина боли пользователя именно в этом.

| Площадка | Синтаксис | Чекбоксы | Раскрывающийся блок | Эмодзи |
|---|---|---|---|---|
| **GitHub** | GFM | `- [ ]` / `- [x]` | `<details><summary>` (HTML) | Unicode + шорткоды `:tada:` |
| **GitLab** | GLFM (надмножество GFM) | `- [ ]` | `<details>` **и** собственный синтаксис | Unicode + шорткоды |
| **Jira** | ⚠️ **свой wiki-markup**, не Markdown | `(x)` / чек-листы плагином | `{expand}` | ⚠️ иные коды |
| **Slack** | ⚠️ **mrkdwn**, не Markdown | нет | нет | `:tada:` |
| **Telegram** | MarkdownV2 (⚠️ экранирование почти всего) | нет | нет | Unicode |

**Фича:** переключатель целевой площадки + **конвертация на выходе**, а не только preview. Копируешь — получаешь синтаксис ровно той площадки, куда вставляешь. Плюс режим **«скопировать как HTML»** (`ClipboardItem` с `text/html` **и** `text/plain` одновременно) — тогда вставка в Google Docs / Confluence / письмо сохраняет форматирование, а в текстовое поле упадёт чистый Markdown.

⚠️ **Честность превью**: наш рендер ≠ рендер GitHub байт-в-байт (у них свои санитайзер и расширения). Превью — «близко», а не «идентично». Написать это в UI, а не делать вид.

### 6.3 🔴 XSS в превью — это не «баг вёрстки», это захват расширения

Превью Markdown = вставка сгенерированного HTML в **страницу расширения**, у которой есть доступ к `chrome.*` API и к `storage`. XSS здесь — не дефейс, а компрометация расширения. Текст при этом приходит откуда угодно: из буфера, со страницы, из чужого баг-репорта.

- Парсер: `markdown-it` (MIT) или `marked` (MIT). Оба **не санитайзят по умолчанию** — и `<details>` нам нужен, значит `html: true`, значит сырой HTML проходит.
- 🔴 **Обязателен санитайзер.** `DOMPurify` (dual MPL-2.0 / Apache-2.0) с явным allow-list: `details`, `summary`, `img`, `a`, таблицы, `code`, `kbd`. Запрет `script`, `on*`, `javascript:`, `srcdoc`.
- ⚠️ Проверить, дозрел ли нативный **`Element.setHTML()` / Sanitizer API** до Baseline — если да, он предпочтительнее внешней зависимости. Пока не подтверждено первоисточником → **открытый вопрос §11**, дефолт — DOMPurify.
- MV3 CSP `script-src 'self'` — вторая линия обороны, но **не первая**: она не спасает от `<img onerror>`… впрочем, инлайн-обработчики CSP как раз блокирует. Тем не менее полагаться только на CSP нельзя — санитайзер обязателен.

### 6.4 ⚠️ Счётчик символов: `str.length` даёт неверный ответ

Это место, где ошибаются почти все существующие счётчики.

- `"👍".length === 2`, `"🇺🇦".length === 4`, `"é"` (e + combining acute) `.length === 2`. Для человека это **один символ**.
- ✅ Правильно: **`Intl.Segmenter`** (Baseline, все браузеры) с `granularity: 'grapheme'` — считает то, что пользователь называет символом. Он же даёт корректные слова (`granularity: 'word'`), в том числе для кириллицы.
- Показывать **несколько чисел, а не одно**: графемы (символы), UTF-16 code units (то, что считает большинство API и лимитов), **байты в UTF-8** (`new TextEncoder().encode(s).length` — вот что важно для БД-лимитов и HTTP), слова, строки, время чтения.
- Лимиты целевых площадок как пресеты: X/Twitter 280, meta description ~160, тема письма, GitLab branch name, commit summary 50/72.

### 6.5 ⚠️ Regex: пользовательский паттерн может повесить расширение (ReDoS)

`new RegExp(userInput)` + катастрофический бэктрекинг (`(a+)+$`) → **бесконечный цикл в главном потоке**. Страница расширения виснет намертво, пользователь думает, что оно сломалось.

- ✅ Матчинг — **только в Web Worker**, с таймаутом (например 500 мс) и `worker.terminate()` по его истечении. Это единственный надёжный способ прервать regex в JS.
- Подсветка совпадений — **CSS Custom Highlight API** (тот же приём, что в `devdata` §2.5): плоский `<pre>` + `Range`, никаких тысяч `<span>`.
- Флаг `v` (unicodeSets) — Baseline, поддержать. Именованные группы, объяснение групп, шпаргалка.
- Find & Replace с `$1`, предпросмотр замен до применения.

### 6.6 ⚠️ Транслитерация: «кириллица → латиница» — это не одна функция, а пять

Наивный translit даст неверный результат, и пользователь это заметит на своей фамилии. Стандарты дают **разное**:

| Стандарт | «Щербаков, Юлия» → |
|---|---|
| **ICAO / загранпаспорт РФ** | Shcherbakov, Iuliia |
| **BGN/PCGN** (англ. традиция) | Shcherbakov, Yuliya |
| **ISO 9 / ГОСТ 7.79-А** (обратимая, с диакритикой) | Ŝerbakov, Ûliâ |
| **ГОСТ 7.79-Б** (обратимая, ASCII) | Shcherbakov, Yuliya |
| **slug** (для веток/якорей/файлов) | shcherbakov-yuliya |

- ✅ **Выбор стандарта обязателен**, с дефолтом «паспортный (ICAO)» и отдельной кнопкой «slug». Написать, чем они отличаются — прямо в UI.
- **Slug-режим** — самый практичный: имя ветки в GitLab, якорь заголовка, имя файла. Плюс обратная сторона: **латиница → кириллица** и **раскладка** (`ghbdtn` → `привет`) — частая боль.
- Поддержать хотя бы украинский/белорусский набор, а не только русский: у них другие правила (`і`, `ї`, `ґ`, `ў`).

### 6.7 Разрешения и UI

- **`storage`, `contextMenus`, `clipboardWrite`, `activeTab`.** ⚠️ Ни одно не даёт install-предупреждения. Сети нет вообще.
- **Side panel** (Chrome 114+) — идеальная точка входа: пишешь баг-репорт, **не теряя из виду страницу**, на которую смотришь. ⚠️ В Firefox это `sidebar_action` — другой ключ манифеста; проверить, как WXT разводит их из одного entrypoint (**открытый вопрос §11**).
- Контекстное меню «Добавить выделенное в черновик» → `activeTab`.
- ⚠️ Черновики — в **`storage.local`, не `sync`**: квота sync — 8 192 байта на элемент, длинный баг-репорт её порвёт с тихой потерей данных. Это уже наступали в `blur` (`PLAN.md` §18a).
- Автосохранение + история черновиков.

### 6.8 Что сюда НЕ класть

- 🔴 **AI-помощник «улучшить текст»** — сеть + отправка пользовательского текста наружу + сбор данных + другая цель. Убивает и zero-permission позиционирование, и single purpose разом.
- 🔴 **Синхронизация черновиков через облако** — то же самое.
- 🔴 Конвертация **страницы** в Markdown — это `export` (§3). Здесь принимаем только вставленный/выделенный текст.
- ⚠️ Эмодзи-пикер: полный набор данных Unicode + шорткоды весит ощутимо. Грузить **лениво** (`await import()`), не в основной бандл. Отдавать и Unicode-символ, и шорткод `:tada:` — GitHub/GitLab понимают оба, Jira и Telegram — нет.

### 6.9 Мобильные и синергия

- ✅ Отличный мобильный кандидат (Firefox Android): чистый UI, ничего не просит у платформы. Наравне с `devdata`.
- Переиспользуем: подсветку через Custom Highlight API и паттерн «тяжёлое — в Worker» из `devdata`; дизайн-токены из `packages/ui`.
- ⚠️ `packages/formats` не подходит — это текст, а не структурированные данные. Общего кода с `devdata` мало, кроме UI-приёмов. Не выдумывать искусственный общий пакет.

---

## 7. Что меняется в монорепо

```
packages/core/          типы, дефолты, DomRuleEngine        (существует)
packages/ui/            🆕 дизайн-токены, общие компоненты  ← долг из PLAN.md §18, теперь окупается
packages/media/         🆕 WebCodecs + mediabunny пайплайн: decode → transform → encode → mux
packages/formats/       🆕 чистые конвертеры: JSON/YAML/XML/CSV/JWT (без браузерных API)
extensions/capture/     🆕 №5
extensions/devdata/     🆕 №6
extensions/export/      🆕 №7
extensions/assets/      🆕 №8
extensions/whoami/      🆕 №9
extensions/compose/     🆕 №10
```

- **`packages/ui` перестал быть опциональным.** Десять расширений с копипастой токенов — это уже не техдолг, а блокер. Дедупликацию, отложенную в `PLAN.md` §18, делаем **до** старта новой волны, а не после.
- **`packages/formats`** — чистый, без браузерных API (как `@blur/core`): используется и из popup, и из воркера, и из DevTools-панели.
- **`packages/media`** — единственное место, где живёт WebCodecs. Расширения 5 и (потенциально) 8 — его потребители.

**Стек — без изменений:** WXT (пинить версию, всё ещё 0.20.x), TypeScript, React, `@webext-core/messaging`, `wxt/utils/storage` с миграциями. Никаких новых фреймворков.

---

## 8. Мобильные браузеры — суровая сводка

| Расширение | Firefox Android | Safari iOS | Chrome Android |
|---|---|---|---|
| 5 Capture Studio | 🔴 **невозможно** (нет getDisplayMedia, нет tabCapture, нет WebCodecs) | 🔴 | 🔴 нет расширений |
| 6 Data Format Toolkit | ✅ **полностью** (чистый UI, ноль платформенных API) | ✅ | 🔴 |
| 7 Page Content Exporter | ✅ (⚠️ `<a download>` на Android работает, но UX сохранения иной) | ⚠️ | 🔴 |
| 8 Asset Inspector | ✅ (⚠️ без DevTools-панели → без инициаторов и редиректов) | ⚠️ | 🔴 |
| 9 Connection & Device Info | ✅ (⚠️ без UA-CH, без deviceMemory) | ⚠️ | 🔴 |
| 10 Markdown Workbench | ✅ **полностью** | ✅ | 🔴 |

**Расширения 6 и 10 — лучшие мобильные кандидаты из всей волны:** им нечего терять на мобильном, потому что они ничего от платформы не просят.

---

## 9. Что изменилось в политиках с момента PLAN.md (важно для ВСЕХ десяти)

- ⚠️ **С 3 ноября 2025** все новые расширения на AMO обязаны объявлять `browser_specific_settings.gecko.data_collection_permissions` ([firefox-builtin-data-consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)). Значения: `none`, `locationInfo`, `authenticationInfo`, `websiteContent`, `websiteActivity`, `technicalAndInteraction` и др. ⚠️ `technicalAndInteraction` **не может быть в `required`**.
- ⚠️ **С 1 августа 2026** (через 2.5 недели!) CWS ужесточает: сбор данных должен быть *strictly necessary* для single purpose; **любой** сбор — prominently disclosed **в UI расширения**; об изменении практик надо уведомлять проактивно ([cws-policy-updates-2026](https://developer.chrome.com/blog/cws-policy-updates-2026)).
- **Privacy policy обязателен даже при полностью локальной обработке** — это не новость, но в `STORE.md` стоит перепроверить формулировки по всем четырём существующим.

**Это ретроактивно касается `perf`** (он шлёт URL в PageSpeed Insights): раскрытие должно быть **в UI расширения**, а не только в `PRIVACY.md` и листинге. → пункт в `TODO.md`.

---

## 10. Пофичевая раскладка по каждому расширению

Легенда: **✅ v1** — входит в первый релиз · **🔜 v2+** — расширение полезности, потом · **⚠️** — можно, но с оговоркой · **🔴** — нельзя, с причиной.

### 10.1 Расширение 6 — Data Format Toolkit (`devdata`)

Цель одной фразой: **«Смотреть и конвертировать структурированные данные»**. Всё, что укладывается в «данные → распарсить → показать → преобразовать», ей служит. Всё сетевое — нет.

| Фича | Статус | Комментарий |
|---|---|---|
| JSON: parse / beautify / minify / дерево с collapse | ✅ v1 | Ядро продукта |
| JSON5 и JSONC (с комментариями) | ✅ v1 | `json5` + `jsonc-parser`, оба MIT, zero-deps |
| Подсветка синтаксиса | ✅ v1 | ⚠️ Через **CSS Custom Highlight API** — плоский `<pre>` + `Range`. Никакого Prism/highlight.js на 200 КБ. ⚠️ `font-weight` в `::highlight()` не меняется |
| Точные большие числа (BigInt) | ✅ v1 | ⚠️ **`JSON.parse` source access (ES2026)** — показываем исходное `12345678901234567890`, а не потерявшее точность. Конкуренты этого не делают — это дифференциатор |
| Файлы до 50 МБ без фриза | ✅ v1 | Парсинг в Web Worker + виртуализация окна + `content-visibility: auto` |
| JWT: декод header / payload / signature, expiry, claims | ✅ v1 | ⚠️ Рамка «100% offline, токен не покидает браузер» — прямо в UI |
| JWT: верификация подписи RS/ES/EdDSA | ✅ v1 | По **публичному** ключу, вставленному пользователем. `jose` (MIT, WebCrypto) |
| JWT: верификация HS256 | ⚠️ v1 | Требует shared secret. Строго in-memory, **без persist в `storage`** — иначе вы храните `authenticationInfo` |
| XML ↔ JSON | ✅ v1 | ⚠️ Нативный `DOMParser` + `XMLSerializer` = **0 КБ**. `fast-xml-parser` v5 тащит 6 транзитивных зависимостей |
| YAML ↔ JSON, CSV ↔ JSON | ✅ v1 | `yaml` (ISC, zero-deps), `papaparse` (MIT) |
| JSON Schema: валидация | ✅ v1 | ⚠️ **`@cfworker/json-schema`** (zero-eval). **AJV не работает под MV3 CSP** (`new Function()`) |
| Авто-формат JSON-страниц при навигации | ⚠️ v1, opt-in | Невозможно без `<all_urls>`: `activeTab` даётся только по жесту, `declarativeContent.RequestContentScript` — экспериментальный и WONTFIX в Firefox. → `optional_host_permissions` + тумблер. ⚠️ На Firefox мешает **встроенный JSON viewer**, отключить его программно нельзя — сказать честно в UI |
| **Diff двух JSON/YAML** (структурный, не текстовый) | 🔜 v2 | Самая частая просьба в этой категории после beautify. Служит той же цели |
| **Query по JSONPath / jq-подобный** | 🔜 v2 | «Найти в 50 МБ» — ровно то, ради чего инструмент и открывают |
| **JSON → TypeScript / Zod / Go struct / JSON Schema** | 🔜 v2 | Генерация типов из образца. Очень липкая фича, целиком локальная |
| Base64 / URL-encode / hex / Unicode-escape декодер | 🔜 v2 | «Декодирование значений внутри данных» — в цель попадает |
| Unix-timestamp ↔ дата, UUID/ULID-инспектор | 🔜 v2 | То же: расшифровка полей, которые лежат в JSON |
| `.har`-вьюер | 🔜 v3 | HAR — это JSON. Естественное расширение, но UI отдельный |
| Импорт/экспорт, история буферов, шаринг по ссылке | 🔴 **нельзя** | ⚠️ Шаринг = сеть. **Именно на этом ломается single purpose** и появляется сбор данных. Локальная история — можно; отправка наружу — нет |
| Аналитика, телеметрия, Sentry | 🔴 **нельзя** | Токены и пейлоады пользователя = `authenticationInfo`. С 1 авг. 2026 любой сбор — prominent disclosure в UI |
| Regex-тестер, транслитерация, счётчик символов | 🔴 не сюда | Это операции над **текстом**, а не над структурированными данными → расширение **10** (`compose`). Здесь они прочитались бы как bundle |
| cURL→fetch, цветовые конвертеры | 🔴 не сюда | «Швейцарский нож разработчика» ≠ «инспектор данных» |

### 10.2 Расширение 7 — Page Content Exporter (`export`)

Цель: **«Сохранить контент страницы в файл»**. Ноль install-предупреждений — главный актив, беречь его.

| Фича | Статус | Комментарий |
|---|---|---|
| Выделенный текст → `.txt` / `.md` | ✅ v1 | Через контекстное меню |
| HTML-таблица → `.csv` | ✅ v1 | Без библиотеки. ⚠️ Обязателен **BOM `﻿`**, иначе Excel ломает кириллицу |
| HTML-таблица → `.xlsx` | ✅ v1 | ⚠️ **`write-excel-file`** (MIT). **Не SheetJS** (ушёл с npm), **не exceljs** (заброшен с окт. 2023) |
| Картинка → скачать / скопировать URL / открыть прямой URL | ✅ v1 | `tabs.create({url})` — нулевой риск |
| Без разрешения `downloads` | ✅ v1 | Blob + `<a download>` из content script. ⚠️ Если позже понадобится `saveAs` — только тогда `downloads` (предупреждение «Manage your downloads») |
| **Таблица → Markdown в буфер** | 🔜 v2 | Дешевле всего и просят чаще всего |
| **Вся страница → Markdown** (Readability-подобное) | 🔜 v2 | Очистка от навигации/рекламы, экспорт статьи. Сильно повышает ценность, цель та же |
| **Все картинки страницы → ZIP** | 🔜 v2 | `fflate` (MIT) уже придёт с `write-excel-file`. ⚠️ Не позиционировать как «граббер» |
| Экспорт всех ссылок / JSON-LD со страницы | 🔜 v2 | Разметку страница отдаёт сама |
| Выбор нескольких таблиц разом, настройка разделителя/кодировки | 🔜 v2 | Скучно, но именно это отличает инструмент от игрушки |
| Страница → PDF | ⚠️ v3 | Через `window.print()` — да. Своим рендерером — нет, это отдельный вес и отдельная цель |
| Скачивание видео | 🔴 **нельзя** | Prohibited Products в CWS. Максимум — «открыть прямой URL в новой вкладке», и ⚠️ **не называть это загрузкой в листинге**: ревью ловит намерение по метаданным |
| «Сохранить в Notion / Obsidian / Google Drive» | 🔴 не в этой волне | Сеть + OAuth + сбор данных. Убивает zero-permission позиционирование. Отдельный продукт |

### 10.3 Расширение 9 — Connection & Device Info (`whoami`)

Цель: **«Показать мои соединение и устройство»**. Device-часть работает с `"permissions": []` — это главный аргумент в сторе, беречь.

| Фича | Статус | Комментарий |
|---|---|---|
| UA, языки, timezone/locale, экран + DPR, CPU, память, storage-квота | ✅ v1 | Ноль разрешений, ноль сети |
| High-entropy UA (архитектура, разрядность, версия ОС) | ⚠️ v1 | `userAgentData.getHighEntropyValues()` — **Chromium-only**, Firefox и Safari не реализовали и не планируют. Нужна честная деградация, а не пустые поля |
| GPU | ⚠️ v1 | `WEBGL_debug_renderer_info` + фолбэк на `navigator.gpu`. ⚠️ В Firefox отключается при `privacy.resistFingerprinting`; в Chrome `adapter.info.device` часто пустой |
| Публичный IP + страна + TLS-версия + PoP | ✅ v1 | **Cloudflare `one.one.one.one/cdn-cgi/trace`** — без ключа, HTTPS, `ACAO: *`. ⚠️ Ни ISP, ни ASN, ни города не даёт |
| ISP / ASN / город | ⚠️ v1, opt-in | **ipinfo.io**, строго по клику, `optional_host_permissions` на конкретный домен. ⚠️ **`<all_urls>` в этой категории — почти гарантированный отказ** |
| Prominent disclosure до первого сетевого запроса | ✅ v1 | ⚠️ **Внутри UI расширения**, не в описании стора. С 1 авг. 2026 это обязательно |
| **Детект VPN/прокси по рассинхрону** | 🔜 v2 | Timezone из `Intl` vs страна из trace vs язык — расхождение показывает, что вы за VPN. ⚠️ Считать в рантайме, ничего не хранить. Cloudflare trace вдобавок отдаёт `warp=on/off` |
| **WebRTC-leak чек** | 🔜 v2 | Показать, что локальный IP **защищён** mDNS-обфускацией. Полезно и честно — в отличие от «мы нашли ваш LAN IP», которого больше не бывает |
| **Оценка уникальности отпечатка** («насколько вы выделяетесь») | ⚠️ v2 | Можно — но 🔴 **красная линия: не вычислять, не хранить и не передавать стабильный хеш**. Только рантайм-оценка энтропии на лету |
| Заголовки безопасности текущей страницы (CSP, HSTS) | 🔜 v3 | ⚠️ Требует `webRequest` + host-доступ → ломает zero-permission. Взвесить: это уже цель `seo`/dev-инструмента, а не «мои данные» |
| IPv4 vs IPv6, DNS-резолвер | 🔜 v3 | Cloudflare trace частично отдаёт |
| Speed-test | 🔴 не сюда | Другая цель + сеть + нагрузка. Отдельный продукт |
| **Подмена User-Agent** | 🔴 **нельзя сюда** | Требует DNR + `<all_urls>` → уничтожает zero-permission и ломает single purpose («показать» ≠ «подменить»). ⚠️ Плюс `Sec-CH-UA` продолжат выдавать настоящий бренд → подмена детектится тривиально. Только отдельным расширением №10 |
| Хранение истории IP / логи | 🔴 **нельзя** | Персистенция IP = сбор PII, не «strictly necessary» для «показать инфо» |

### 10.4 Расширение 5 — Capture Studio (`capture`)

Цель: **«Записать вкладку и экспортировать медиа»**. Самое дорогое из пяти.

| Фича | Статус | Комментарий |
|---|---|---|
| Запись вкладки (Chrome) | ✅ v1 | `tabCapture.getMediaStreamId()` → `offscreen` (reason `USER_MEDIA`) → `MediaRecorder`. ⚠️ streamId протухает за секунды |
| Запись вкладки (Firefox) | ⚠️ v1 | `tabCapture` и `offscreen` **не существуют**. Только `getDisplayMedia` со **страницы расширения** (не popup — закроется и убьёт поток) |
| **Звук вкладки в Firefox** | 🔴 **невозможно** | `getDisplayMedia` в Firefox `audio: false`. Не обходится. Только микрофон. Честно объявить в листинге |
| Скриншот видимой области | ✅ v1 | `tabs.captureVisibleTab`. ⚠️ Лимит **2 захвата/сек**, ⚠️ DPR-скейлинг (`PLAN.md` §6.2 — уже разобрано) |
| Запись в MP4 | ✅ Chrome / ⚠️ Firefox | Chrome 126+ пишет MP4 **прямо из MediaRecorder** — транскодирование не нужно. ⚠️ Firefox MP4 не пишет → там конвертация обязательна |
| Конвертация / ресайз | ✅ v1 | **WebCodecs + mediabunny** (MPL-2.0, активна). ⚠️ `mp4-muxer`/`webm-muxer` — **DEPRECATED** автором |
| **Сжатие до целевого размера файла** | ✅ v1 | ⚠️ Готовой опции нет **ни у кого** — итеративный «ручной 2-pass». ⚠️ `MediaRecorder.videoBitsPerSecond` — только пожелание → таргетировать на пост-конверсии. **Это и есть киллер-фича**: пресеты «влезть в Discord 10 МБ», «в Slack», «в письмо» |
| Watermark / текст на картинке и видео | ✅ v1 | `OffscreenCanvas` + `fillText`. ⚠️ Логотип грузить из пакета (`runtime.getURL`) — внешний URL без CORS сделает канвас tainted. ⚠️ Каждый `VideoFrame` обязан быть `close()`-нут |
| Live-оверлей во время записи | ⚠️ v1 | `MediaStreamTrackProcessor` **в Firefox отсутствует** → кросс-браузерно только `canvas.captureStream()` (дороже по CPU) или оверлей пост-фактум |
| **Замазать чувствительное перед экспортом** | 🔜 v2 | ⚠️⚠️ **Только сплошная заливка, НЕ блюр и НЕ пикселизация** — они обратимы (Unredacter, Depix). Это уже исследовано в `PLAN.md` §6.4, переиспользовать вывод |
| **Скриншот всей страницы (scroll + stitch)** | 🔜 v2 | ⚠️ Лимит 2 захвата/сек, проблемы со sticky-хедерами и lazy-load. Первоклассного API нет ни в Chrome, ни в Firefox (`PLAN.md` §6.1) |
| Выделение региона, обрезка, аннотации (стрелки, текст) | 🔜 v2 | Ровно то, чем живут Awesome Screenshot и Screenity |
| Экспорт в GIF, обрезка видео по таймлайну | 🔜 v2 | GIF из WebCodecs-кадров — дешево, спрашивают постоянно |
| Камера-PiP, микрофон, обратный отсчёт | 🔜 v2 | Стандарт жанра для скринкастов |
| ffmpeg.wasm | ⚠️ только фолбэк | ⚠️ Дефолтный `load()` тянет ядро с CDN = **remote code = мгновенный reject**. Бандлить локально + CSP `'wasm-unsafe-eval'`. ⚠️ Лимит входа 2 ГБ. ⚠️ AMO потребует исходники WASM. ⚠️ Проверить лицензию ядра (LGPL vs GPL с x264) |
| Загрузка записей в облако / шаринг по ссылке | 🔴 не в этой волне | Это Loom. Сеть, аккаунты, хранение пользовательского видео → другой продукт и другой уровень юридической ответственности |
| Мобильные | 🔴 **невозможно** | Ни `getDisplayMedia`, ни `tabCapture`, ни WebCodecs на Firefox Android. Не обещать |

### 10.5 Расширение 8 — Asset Inspector (`assets`)

Цель: **«Найти источник любого элемента на странице и запросы, которые его загрузили»**. Инспектор, не загрузчик. Разрешения: `activeTab`, `scripting`, `storage`, `contextMenus`, `devtools_page` — **ноль install-предупреждений**.

| Фича | Статус | Комментарий |
|---|---|---|
| **Element picker → карточка ресурса** | ✅ v1 | Ядро продукта. Инъекция picker'а по клику на иконку → `activeTab` + `scripting`, предупреждения нет. Picker уже написан в `adblock` — переиспользовать |
| Финальный URL: полный, копируемый, открывается в новой вкладке | ✅ v1 | `img.currentSrc` / `video.currentSrc` / `source.src` / `poster` / `background-image`. ⚠️ Кнопки «Скачать» нет и не будет — на этом держится вся конструкция |
| **Какой кандидат `srcset` реально выбрал браузер и почему** | ✅ v1 | `currentSrc` vs весь `srcset` + `sizes` + DPR. **Узнать это иначе практически невозможно** — сильная фича для верстальщиков, и её ни у кого нет |
| Тип, MIME, формат/кодек, натуральный размер vs отображаемый | ✅ v1 | `naturalWidth/Height`, `videoWidth/Height`, `getVideoPlaybackQuality()` |
| **Перевес: картинка 2000px показана в 100px** | ✅ v1 | Дешёвый расчёт, мгновенная польза, попадает точно в цель |
| Запросы, породившие ресурс | ✅ v1 | `performance.getEntriesByType('resource')` — URL, `initiatorType`, тайминги. ⚠️ Вне DevTools **инициатор недоступен**, только его тип — показать честно |
| **Полная цепочка редиректов + инициатор (какой скрипт вызвал)** | ✅ v1, DevTools | `chrome.devtools.network.onRequestFinished` → HAR `_initiator`, `redirectURL`. `devtools_page` — предупреждения нет |
| Вес ресурса | ⚠️ v1 | ⚠️ `transferSize` = **0 для cross-origin без TAO** (`PLAN.md` §8). Помечать «не измерен», **не показывать ноль** |
| **Честная карточка для MSE/DRM** | ✅ v1 | «Прямого URL не существует — плеер собирает видео из сегментов; вот 312 запросов, которые его тянут; DRM: Widevine». Это **объяснение**, а не обход. Превращает главное ограничение в фичу |
| Диагностика «почему не загрузилось» | 🔜 v2 | 404 / CORS / mixed content / CSP-блок / decode error. То, за чем в DevTools лезут каждый день |
| **Какой файл шрифта реально применился к элементу** | 🔜 v2 | Резолвинг `@font-face` → конкретный `.woff2`. Редкая и очень ценная вещь; в DevTools её добывать мучительно |
| Lazy-load аудит: `loading`, `decoding`, `fetchpriority`, `preload` | 🔜 v2 | Что применено к элементу и что это дало |
| Дубли: один ресурс загружен N раз | 🔜 v2 | Классический баг SPA |
| Все ресурсы страницы таблицей + фильтр по типу + поиск | 🔜 v2 | Список, а не только точечный тык |
| Экспорт карточки/списка (JSON, Markdown, CSV) | 🔜 v2 | ⚠️ Экспорт **метаданных**, не медиа. Границу держать |
| Копировать как `<img srcset>` / `fetch()` / Markdown `![]()` | 🔜 v2 | Нейтрально, полезно верстальщику |
| Кнопка «Скачать», разрешение `downloads`, `fetch()` медиа | 🔴 **никогда** | ⚠️ **Именно это и есть граница между инспектором и загрузчиком.** Одна кнопка — и продукт меняет категорию |
| Парсинг `.m3u8`/`.mpd`, склейка сегментов | 🔴 **никогда** | Манифест можно **показать** как ресурс, разбирать — нет |
| `webRequest` + `<all_urls>` | 🔴 не нужен | Всё достаётся из Resource Timing + DevTools HAR. ⚠️ Взять их — значит добровольно получить предупреждение «читать все данные на всех сайтах» и ручное ревью **ни за что** |
| `chrome.debugger` | 🔴 **никогда** | Занят расширением `perf` (`PLAN.md` §0). Жёлтый баннер «отладка браузера» в инспекторе картинок = мгновенный красный флаг |
| Waterfall, вес страницы, CWV | 🔴 не сюда | Это `perf`. Если `assets` начнёт это делать — продукты надо сливать, а не плодить (§4.3) |
| Слово «download» в листинге, логотипы стримингов на скриншотах | 🔴 **категорически** | Ревью CWS ловит намерение по метаданным не хуже, чем по коду |

### 10.6 Расширение 10 — Markdown Workbench (`compose`)

Цель: **«Написать и отформатировать текст перед вставкой»**. Разрешения: `storage`, `contextMenus`, `clipboardWrite`, `activeTab` — **ноль install-предупреждений, ноль сети**.

| Фича | Статус | Комментарий |
|---|---|---|
| Markdown-редактор + живое превью | ✅ v1 | Ядро. 🔴 **Обязателен `DOMPurify`** — превью вставляет HTML в страницу расширения с доступом к `chrome.*`; XSS здесь = компрометация расширения, а не дефейс |
| Панель вставки: **жирный, чекбоксы `- [ ]`, `<details>`, таблицы, код, ссылки** | ✅ v1 | Ровно то, что просили. `<details><summary>` — это HTML, работает и в GitHub, и в GitLab |
| Эмодзи-пикер | ✅ v1 | Отдавать **и** Unicode-символ, **и** шорткод `:tada:`. ⚠️ Данные Unicode весят — грузить лениво (`await import()`), не в основной бандл |
| **Переключатель целевой площадки + конвертация на выходе** | ✅ v1 | 🆕 **Главный дифференциатор.** «Вставить куда угодно» — ложь: GitHub/GitLab ≠ Jira (свой wiki-markup) ≠ Slack (mrkdwn) ≠ Telegram (MarkdownV2 с экранированием). Копируешь — получаешь синтаксис **той** площадки |
| **Копировать как HTML** (`text/html` + `text/plain` разом) | ✅ v1 | Вставка в Google Docs / Confluence / письмо сохраняет форматирование, а в текстовое поле падает чистый Markdown |
| Шаблоны баг-репорта (шаги, ожидалось/получилось, окружение) | ✅ v1 | Кнопка «вставить окружение» — браузер/ОС/экран из `navigator`. ⚠️ Это **не** `whoami`: там цель «показать инфо», здесь — «вставить в отчёт» |
| **Счётчик: графемы / UTF-16 / байты UTF-8 / слова / строки** | ✅ v1 | ⚠️ **`str.length` даёт неверный ответ**: `"👍".length === 2`, `"🇺🇦".length === 4`. Считать через **`Intl.Segmenter`** (`granularity: 'grapheme'`). Показывать **несколько чисел**, а не одно. Плюс пресеты лимитов: X 280, meta description 160, commit summary 50/72 |
| **Regex: find & replace по черновику** | ✅ v1 | ⚠️ **Только в Web Worker с таймаутом + `terminate()`.** `new RegExp(userInput)` с катастрофическим бэктрекингом (`(a+)+$`) вешает главный поток намертво. Подсветка совпадений — Custom Highlight API, как в `devdata` |
| **Транслитерация кириллица → латиница** | ✅ v1 | ⚠️ Это **не одна функция, а пять стандартов** с разным результатом: ICAO/паспорт (`Iuliia`), BGN/PCGN (`Yuliya`), ISO 9 (`Ûliâ`), ГОСТ 7.79-Б, **slug** (`yuliya`). Выбор обязателен, дефолт — паспортный. Slug — самый практичный (ветки GitLab, якоря, имена файлов) |
| Обратно: латиница → кириллица, исправление раскладки (`ghbdtn` → `привет`) | 🔜 v2 | Частая боль, дёшево |
| Украинский / белорусский наборы транслита | 🔜 v2 | У них другие правила (`і`, `ї`, `ґ`, `ў`) — русский набор даст мусор |
| Черновики + автосохранение + история | ✅ v1 | ⚠️ **`storage.local`, не `sync`**: квота sync — 8 192 байта на элемент, длинный баг-репорт порвёт её с тихой потерей. Уже наступали в `blur` (`PLAN.md` §18a) |
| Side panel (писать, не теряя страницу из виду) | ✅ v1 | Chrome 114+. ⚠️ В Firefox это `sidebar_action` — другой ключ манифеста, проверить WXT (§11) |
| «Добавить выделенное со страницы в черновик» | ✅ v1 | Контекстное меню + `activeTab` |
| Оглавление, сортировка/выравнивание таблиц, `<details>` в один клик | 🔜 v2 | Мелкая механика, ради которой такие редакторы и держат |
| Диаграммы Mermaid | 🔜 v2 | GitLab и GitHub их рендерят. ⚠️ Библиотека тяжёлая — только ленивой загрузкой |
| Проверка орфографии | ⚠️ v2 | Нативная (`spellcheck`) — бесплатно. Своя — тяжёлые словари. Внешний сервис — 🔴 |
| **AI «улучшить текст»** | 🔴 **нельзя** | Сеть + отправка текста пользователя наружу + сбор данных + другая цель. Убивает zero-permission и single purpose разом |
| Синхронизация черновиков через облако | 🔴 | То же самое |
| Конвертация **страницы** в Markdown | 🔴 не сюда | Это `export` (§3). Здесь принимаем только вставленный/выделенный текст |
| Собственная точка входа у regex / транслита / счётчика | 🔴 **категорически** | ⚠️ **Единственное, на чём держится single purpose.** Как только regex получает свою иконку — расширение становится «швейцарским ножом», то есть bundle'ом. Только табы одного редактора |

### 10.7 Сквозные запреты — действуют для всех десяти

| Что | Почему |
|---|---|
| 🔴 Удалённый код (JS **и WASM**) с CDN | CWS дословно относит WASM к коду. Забандленный локально — разрешён |
| 🔴 Аналитика, телеметрия, Sentry «просто чтобы видеть ошибки» | С 1 авг. 2026 **любой** сбор — prominent disclosure **в UI расширения**, и он должен быть *strictly necessary* для single purpose |
| 🔴 Хранение стабильных идентификаторов пользователя / fingerprint-хешей | Это PII. Не «strictly necessary» ни для одной из наших целей |
| 🔴 Смешивание целей ради «одного мощного аддона» | Тест ревьюера — «помещается ли цель в одну фразу». Коды отказа Red-семейства |
| ⚠️ `<all_urls>` без прямой необходимости | Каждое расширение должно уметь объяснить свой host-доступ одной строкой. Где можно — `optional_host_permissions` + `permissions.request()` по жесту |

---

## 11. Открытые вопросы (проверить перед соответствующей фазой)

- ⚠️ **H.264-энкод в Firefox `VideoEncoder`** — рантайм-проб `isConfigSupported({codec: 'avc1.42001f'})` на живом Firefox 130+. От ответа зависит, придётся ли тащить ffmpeg.wasm ради Firefox (и проходить AMO-ревью WASM-исходников).
- Лицензия сборки `@ffmpeg/core` (LGPL vs GPL с x264) — если ffmpeg.wasm вообще понадобится.
- Edge Add-ons: политика по медиа-даунлоадерам мягче CWS? (Video DownloadHelper там есть.)
- ToS ipinfo.io для коммерческого использования + практика публикации токена в клиенте.
- Стабильность `one.one.one.one/cdn-cgi/trace` как продуктовой зависимости (публичного SLA нет).
- `field-sizing` и `content-visibility` — поведение в Firefox на реальных больших JSON.
- Поведение `::highlight()` при 50 МБ текста и частом пересоздании `Range` — профилировать.
- **Дозрел ли нативный `Element.setHTML()` / Sanitizer API до Baseline?** Если да — он предпочтительнее `DOMPurify` в §6.3. Пока не подтверждено первоисточником.
- **Как WXT разводит `side_panel` (Chrome) и `sidebar_action` (Firefox)** из одного entrypoint — проверить на живой сборке до старта расширения 10.
- Насколько точно GitLab GLFM расходится с GFM в `<details>` и чекбоксах — проверить вживую, превью обещать «близко», а не «идентично».

---

# ЧАСТЬ III — Волна 3: convert, linksafe, vision, sessions, proof (отложен)

> 🟢 **РЕАЛИЗОВАНО (v0) 2026-07-20** — №11–14 построены и зелёные (typecheck/guards/build Chrome+Firefox); №15 (proof) отложен. Статус и долги — в [`TODO.md`](./TODO.md) «🌱 Волна 3». Ниже — слой дизайна (почему/как).
>
> Пять новых расширений (№11–15), собираемых тем же monorepo. Слой «почему/как», как и Части I–II. Основано на раунде deep-research с адверсариальной верификацией по первоисточникам (developer.chrome.com, MDN, extensionworkshop.com, TC39/W3C, caniuse, репозитории библиотек + их LICENSE, ToS API-провайдеров) на **2026-07-20**. ⚠️ — факты, опровергшие «очевидную» архитектуру.
>
> **Ров тот же и он структурный:** single-purpose, минимум разрешений (никаких install-time broad-host варнингов, кроме честно неизбежных), **ничего не уходит из браузера** (а если уходит — раскрыто и минимизировано), честный UI (оценка ≠ точность), кросс-браузер через WXT, fail-safe, свежая платформа 2026 (Temporal, Intl-календари, Machado-матрицы, Baseline) вместо библиотек, **no-remote-code** (MV3). Выигрываем не фичами, а **тем, чего не делаем**: не просим страшных прав и не отправляем данные.

## 🔴 0. Главное решение: пять расширений, одно отложено

Каждое проходит тест ревьюера «цель одной фразой», и каждая фича/разрешение ей служат.

| # | Расширение | Цель одной фразой | Базовые разрешения | Install-варнинг | Риск ревью |
|---|---|---|---|---|---|
| 11 | **Universal Converter**<br/>`extensions/convert` | «Конвертировать юниты, валюты, время и даты прямо при просмотре» | `storage`, `activeTab`, `contextMenus`, `scripting`, ключ `omnibox` | **нет** | низкий |
| 12 | **Link Inspector**<br/>`extensions/linksafe` | «Показать, куда реально ведёт ссылка, до клика» | `storage`, `activeTab`, `contextMenus` | **нет** | низкий |
| 13 | **Vision Simulator**<br/>`extensions/vision` | «Увидеть страницу глазами людей с нарушениями зрения» | `activeTab`, `scripting`, `storage` | **нет** | минимальный |
| 14 | **Session Saver**<br/>`extensions/sessions` | «Сохранять и восстанавливать наборы вкладок — только на этом устройстве» | `tabs`, `storage`, `alarms` | **«Read your browsing history»** (неизбежен) | средний |
| 15 | **On-device Writing Checker**<br/>`extensions/proof` — **ОТЛОЖЕН** | «Проверять орфографию и стиль в полях ввода — целиком на устройстве» | `activeTab` + opt-in per-site | нет (при opt-in) | — (не строим сейчас) |

**Ключевые следствия ров-дизайна волны 3:**
- **№11–13 инсталлятся с пустым списком варнингов.** Сеть у конвертера (курсы) идёт на CORS-эндпоинты без `host_permissions`; доступ к странице у linksafe/vision — программной инъекцией по `activeTab`-клику, а не декларативным `<all_urls>` контент-скриптом. ⚠️ Помнить [[wxt-all-urls-manifest-hoist]]: runtime-`matches` контент-скрипта WXT хойстит в `host_permissions` собранного манифеста → варнинг. Поэтому **не** объявлять статический контент-скрипт там, где хватает `scripting.executeScript`; аудировать **собранный** манифест.
- **№14 честно принимает один варнинг.** Прочитать URL всех вкладок нельзя без `tabs` (или broad-host), а `activeTab` даёт только активную. Значит «Read your browsing history» неизбежен — его **владеют честно** (микрокопия в popup: «мы читаем заголовки/URL вкладок, чтобы их сохранить; ничего не уходит»), а все прочие права (`tabGroups`, `sessions`, `cookies`, `unlimitedStorage`) держат **optional** и запрашивают по жесту. Так же проходят OneTab/Session Buddy/Toby.
- **№15 отложен осознанно** — драйверы отсрочки ниже (§15). Не блокер волны 3.

## Стек-дополнения волны 3 (что нового используем)

| Слой | Выбор | Обоснование |
|---|---|---|
| **Дата/время/календари** | нативные `Temporal` + `Intl.DateTimeFormat` | Temporal в проде: **Chrome 144 (13.01.2026), Firefox 139, ES2026 Stage 4**. ⚠️ Нет в Safari/iOS → бандлить `@js-temporal/polyfill` (MIT). Таймзоны и календари всё равно через `Intl` |
| **Мульти-календарь** | `Intl` `calendar`-опция | buddhist/chinese/dangi/hebrew/indian/islamic-umalqura/japanese/persian/roc — **из платформы, без библиотек и файлов данных** |
| **CVD-симуляция** | SVG `feColorMatrix`, матрицы **Machado 2009** | Gold standard; ровно то, что использует Blink. ⚠️ linearRGB + Brettel-tritan — см. §13 |
| **Punycode/IDN** | `punycode.js` (MIT) + `unicode-confusables` (UTS #39) + `tldts` (MIT, PSL MPL-2.0) | Нативного декода `xn--`→Unicode в браузере нет |
| **Курсы валют** | Frankfurter (ECB, no-key, коммерция OK) | Отдаёт **всю таблицу** одним запросом → сумма считается локально и не уходит |
| **Вкладки/группы** | `tabs`, `tabGroups`, `sessions`, `windows` | ⚠️ Расхождения Chrome/Firefox по discarded-восстановлению и версиям tabGroups — см. §14 |

---

# РАСШИРЕНИЕ 11 — Universal Converter (`extensions/convert`)

## 11.1 Разрешения — ноль install-варнингов
`storage` (префы, кэш курсов, избранное), `activeTab` (инлайн-конвертация выделения по клику), `contextMenus` («Convert selection»), `scripting`, и **ключ манифеста `omnibox`** (не разрешение, варнинга не даёт; Firefox тоже поддерживает — WXT эмитит обоим). ⚠️ **Сеть без host-варнинга:** курс/крипта-эндпоинты шлют пермиссивный CORS (`Access-Control-Allow-Origin: *`), поэтому SW делает `fetch()` **без** `host_permissions`. **Проверить живые CORS-заголовки** перед релизом; если провайдер снимет CORS — увести за `optional_host_permissions` по жесту. Opt-in авто-аннотация страницы — только `activeTab`/`optional_host_permissions`, **никогда** статический `<all_urls>`.

## 11.2 ⚠️ Юниты — честность там, где конкуренты врут
Санкционированный список `Intl.NumberFormat` `style:"unit"` — только ~50 юнитов (`mile-per-hour`, `celsius`, `byte`…); произвольные (furlong, pica, hex) он **не форматит** → для них ручной формат. Сами факторы — **руками, аудируемой таблицей** для честных категорий, где `convert-units`/`js-quantities` (оба MIT) молча схлопывают неоднозначность:
- **SI-decimal vs IEC-binary:** MB (10⁶) ≠ MiB (2²⁰). Показывать обе, лейбл явный.
- **US vs Imperial:** gallon/ton/fluid-ounce различаются — селектор «US / Imperial», не молчаливый дефолт.
- **mpg-US / mpg-UK / L·100km**, **bin/oct/dec/hex**, **px/pt/em/rem/pica** (dev-аудитория).
- **Cooking cups↔grams** — нужна per-ingredient таблица плотностей (руками), лейбл «≈, зависит от ингредиента».

## 11.3 Валюта/крипта — приватный дизайн (тянем таблицу, не сумму)
**Валюта: Frankfurter (frankfurter.dev)** — no-key, без дневных капов, ECB + ~84 ЦБ, коммерция «yes, absolutely», self-hostable. **`GET /v2/rates?base=USD` отдаёт ВСЮ таблицу** → сумма пользователя умножается **локально и наружу не уходит**. Кэш + disclosure «as of \<date\>, source ECB via Frankfurter». Фолбэк: **open.er-api.com** (no-key, но ⚠️ обязательная атрибуция + запрет редистрибуции). ⚠️ **exchangerate.host в 2026 уже требует ключ** — выбыл. ⚠️ Проверить, что таблица Frankfurter надёжно покрывает RUB (ECB дропал пары) — иначе RUB через фолбэк.

**Крипта: CoinGecko keyless** `/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,eur,rub` — no-key, IP-rate-limit. ⚠️ **Коммерция требует видимой атрибуции «Data provided by CoinGecko» + ссылки**; keyless shared-IP лимиты волатильны → дать опцию вставить свой free Demo-ключ. Фолбэк: Coinbase/Kraken public ticker.

## 11.4 Мульти-календарь + ⚠️ caveats (фишка расширения)
`Intl.DateTimeFormat` `calendar` покрывает **все** целевые: gregory/islamic-umalqura/chinese/hebrew/persian(jalali)/japanese/indian(saka)/buddhist/dangi/coptic/ethiopic/roc — из платформы. Китайский зодиак: `formatToParts()` даёт `yearName` (стебель-ветвь, напр. 甲子) + `relatedYear`; 12 животных — из земной ветви (крошечная таблица имён).
- ⚠️ **Firefox версионно-зависим:** до ICU4X-миграции 2026 ([Bugzilla 1954138](https://bugzilla.mozilla.org/show_bug.cgi?id=1954138)) не имел chinese/dangi/persian/islamic-umalqura. **Feature-detect** `Intl.supportedValuesOf('calendar')` в рантайме, деградировать мягко. Проверить против целевого Firefox ESR.
- ⚠️ **Hijri честность:** `islamic-umalqura` — предвычисленная **табличная** система, не наблюдение луны; для Рамадана/Шавваля/Зуль-хиджа официальная дата может отличаться **±1 день**. Лейбл «Umm al-Qura (tabular) — religious dates may vary ±1 day by local sighting», **никогда** не подавать как авторитетную дату Ид.

## 11.5 Temporal vs Intl
Использовать нативный `Temporal` где есть (чистые `PlainDate`/`ZonedDateTime`/календарная арифметика), **feature-detect**, бандлить `@js-temporal/polyfill` (MIT) для Safari/iOS и старого Firefox (бандл-полифилл под MV3 легален). Таймзоны/формат календаря — всегда через `Intl`.

## 11.6 UX/UI (детально)
Продукт-оунер просил проработать особо. Четыре поверхности, все клавиатуро-first, offline-first (юнит/дата/тз/календарь работают без сети; сеть — только курсы, из кэша):
1. **Инлайн-конвертация выделения** (киллер-UX): выделил «5 miles» / «20°C» / «$50» / «3pm EST» на любой странице → парсер распознаёт величину и юнит → ненавязчивый dismissable-бейдж с результатом; на hover — источник+таймстемп. По `activeTab`, без постоянного присутствия.
2. **Popup «один вход → много выходов»**: одно умное поле, живой список целей (1 BTC → USD+EUR+RUB одновременно), `Tab`/`↑↓` навигация, `Enter`/`⌘C` копирование, swap. **Неоднозначность surface, не прячем**: при «gallon»/«MB» всплывает селектор «US/Imperial», «MB decimal/MiB binary».
3. **Omnibox quick-convert**: ключевое слово → «5mi to km» → результат. Ноль доступа к странице.
4. **Context-menu «Convert selection»** + **opt-in per-page авто-аннотация** распознанных величин (за `optional_host_permissions`).

Плюс: избранное/пиннед пары, мульти-календарная дата-панель (с Hijri-caveat), hex/bin/oct-панель для девов, контроль точности/округления, locale-формат через `Intl.NumberFormat`, тема + i18n (EN/RU/ET). **Fail-safe:** если курсы устарели/недоступны — показать последний кэш с возрастом, **никогда** выдуманное число.

## 11.7 Мобильные
**Firefox Android** — основная мобильная цель (omnibox, contextMenus, Temporal 139+, ICU4X-календари). **Safari iOS** — popup-first: ⚠️ нет Temporal (полифилл), проверить покрытие календарей в WebKit-ICU, ограниченный паритет omnibox/contextMenus.

---

# РАСШИРЕНИЕ 12 — Link Inspector (`extensions/linksafe`)

## 12.1 Разрешения — warning-free инсталл
`contextMenus` + `storage` + `activeTab` как стоячий набор — ни один не даёт host-варнинга. ⚠️ **Не** объявлять `<all_urls>` контент-скрипт (в отличие от seo, который принимает broad-host ради чтения каждой страницы): hover/scan-UI инжектится `scripting.executeScript` по клику. Сетевой резолв и hop-by-hop — за `optional_host_permissions` (`<all_urls>`), запрос по жесту. Firefox: `optional_host_permissions` c FF128 (bug 1766026); MV2 кладёт паттерны в `optional_permissions`.

## 12.2 ⚠️ Финальный URL дёшев, цепочка — нет
`fetch` `redirect:"follow"` отдаёт **только первый и последний** URL (`response.url`); промежуточных хопов нет. `redirect:"manual"` → **opaqueredirect** (status 0, `Location` **не читается**). Следствие: **«финальный адрес» = один fetch** (MVP). **Hop-by-hop со статусами требует `webRequest.onBeforeRedirect`** (observational webRequest в Chrome MV3 ещё разрешён, в Firefox нативен) + host-грант → отдельный advanced opt-in (webRequest добавляет ревью-вес). ⚠️ **HEAD ≠ GET** (шортенеры отдают 405 или другой Location; meta-refresh/JS-редиректы fetch не видит вовсе) → резолвнутый URL = «следующий хоп по мнению сервера для нашего неаутентифицированного запроса», не гарантия. Честный UI это говорит. ⚠️ `mode:"no-cors"` → opaque (бесполезен) → резолв **действительно** требует host-гранта, permission-free шортката нет.

## 12.3 Локально vs сеть — приватный дизайн
**Дефолт = 100% локально, ноль сети.** ⚠️ **Резолв ссылки её ОТПРАВЛЯЕТ.** Шортенер/трекинг-URL часто несут one-time токены (unsubscribe, reset, per-recipient id); фетч **сжигает токен и деанонимизирует** — ровно тот вред, от которого защищаем. Поэтому сеть — opt-in, по-действию, за host-грантом, с plain-language warning («это обратится к `bit.ly` и раскроет, что вы кликнули; любой трекинг-код уйдёт»). Per-domain allowlist «always resolve» для доверенных.

## 12.4 Локальные эвристики (ноль сети) + лицензии
- **Punycode→Unicode:** `new URL(href).hostname` даёт `xn--`-форму, нативного декода нет → бандлить **punycode.js** (MIT).
- **Confusable/mixed-script (UTS #39):** флажить смешанные скрипты (кириллическая «аpple.com») через **`unicode-confusables`** (MIT). ⚠️ Не over-flag легитимные не-латинские домены: «looks like apple.com but uses Cyrillic letters», не «phishing».
- **Cross-registrable-domain** (anchor-текст `paypal.com` vs href eTLD+1 `evil.com`): eTLD+1 через **`tldts`** (MIT); сам PSL — MPL-2.0, периодический рефреш в бандле.
- Плюс: insecure `http://`, опасные схемы `data:`/`javascript:`/`blob:`, список известных шортенеров, strip трекинг-параметров (utm_*, fbclid, gclid…) + copy-clean.

## 12.5 ⚠️ Safe Browsing — НЕ встраиваем
⚠️ **Safe Browsing API — только non-commercial**; коммерции нужен платный **Web Risk**. Значит в бандл **не встраиваем**. MVP: локальные эвристики + опционально bundled периодически-обновляемый open-блоклист (напр. URLhaus), проверяемый локально. Либо BYO-key Web Risk как opt-in с disclosure. **Конкуренты (Unshorten.it/CheckShortURL/WhereGoes)** — серверные резолверы: вы отдаёте им ссылку с токенами, они видят ваш браузинг — ровно то, чего мы избегаем.

## 12.6 Мобильные
**Firefox Android**: нет hover на тач → long-press context-menu + tap-to-inspect в scan-списке. **Safari/iOS**: только локальный reveal/context-menu, сетевой резолв — drop.

---

# РАСШИРЕНИЕ 13 — Vision Simulator (`extensions/vision`)

## 13.1 Разрешения — сильнейший фит ров
Нет privacy/FOUC-императива (симуляция может примениться через сотни мс) → **не нужен** `<all_urls>`/`document_start`. `activeTab` + `scripting` (`insertCSS`/`executeScript` по клику), `storage`. **Ноль broad-host варнинга.** ⚠️ Не декларировать статический контент-скрипт (manifest-hoist). ⚠️ Нельзя на `chrome://`/веб-сторе/AMO → fail-safe «can't simulate this page».

## 13.2 CVD-матрицы — авторитетный источник
**Machado, Oliveira & Fernandes (2009), IEEE TVCG** — то, что использует Blink; опубликованная Chrome deuteranopia `0.367…` совпадает с Machado severity-1.0 (провенанс подтверждён). Хранить **11 матриц на тип** (severity 0.0–1.0 шаг 0.1) → нативно питает слайдер аномальной трихромазии (protanomaly/deuteranomaly/tritanomaly). Achromatopsia = luma-grayscale (Rec.709 `0.2126/0.7152/0.0722`).
- ⚠️ **Не использовать наивные Wikipedia/hail2u-матрицы** (channel-copy `0.625 0.375 0`) — не физиологичны, пере-насыщают.
- ⚠️ **Фильтры обязаны считаться в linearRGB** (`color-interpolation-filters="linearRGB"`) иначе результат неверный.
- ⚠️ **Тританопия не выражается одной матрицей корректно** — точный режим требует **Brettel 1997** (две полуплоскости + `feBlend`); матрица Machado-tritan = аппроксимация. Ship Machado (protan/deutan/anomalous) по умолчанию, Brettel-tritan — opt-in «accurate», лейблы честные.

## 13.3 Техника на условие + ⚠️ containing-block
| Условие | Техника |
|---|---|
| CVD (все) | `feColorMatrix` |
| Achromatopsia/grayscale | `saturate(0)` luma |
| Cataract | `feGaussianBlur` + жёлтый tint + падение контраста |
| Refractive blur (миопия) | `feGaussianBlur stdDeviation` слайдером (реюз blur-компетенции) |
| Low contrast | `feComponentTransfer` slope<1 |
| Glaucoma/AMD/retinopathy/hemianopia | **radial/linear-gradient маски**, fixed full-viewport `pointer-events:none` overlay |

`filter` на `documentElement`. ⚠️ **Ключевая ловушка:** `filter` на предке делает его containing-block для `position:fixed` потомков → sticky-хедеры скроллятся с контентом (для whole-page симуляции визуально приемлемо, но помнить). ✅ **Cross-origin iframes покрываются бесплатно**: ancestor-`filter` применяется к композитным пикселям iframe → **одна** инъекция в топ-фрейм (в отличие от blur, которому нужен allFrames). Overlay-маски — отдельным top-layer элементом (не filtered-потомком), трекают вьюпорт.

## 13.4 ⚠️ Производительность
`feColorMatrix` дёшев per-pixel, но full-page `filter` промоутит композит-слой и рерастеризует на скролле; `feGaussianBlur` (катаракта/миопия) заметно дороже (свёртка) + выбивает видео с hardware-overlay. ⚠️ **Firefox: SVG-фильтры были CPU-bound до FF132** (WebRender-ускорение, окт-2024). На 2026-baseline ок, но на старом ESR full-page фильтры лагают → **fail-safe: режим «статичный скриншот-симуляция»**. Gate `feGaussianBlur` за явный тоггл с cost-warning.

## 13.5 Live-инструменты (всё локально)
Всё в single-purpose «прочувствовать нарушения»: (1) **WCAG-контраст на hover** (4.5:1/3:1, формула WCAG 2.2, локально; ⚠️ на тач — tap-fallback через `CAN_HOVER`-паттерн blur); (2) **text-spacing стресс-тест** (WCAG 1.4.12: line 1.5/letter 0.12em/word 0.16em/para 2em → клиппинг?); (3) **reflow-тест** (1.4.10, 320px/400%); (4) **prefers-reduced-motion превью**; (5) grayscale (reliance-on-color). ⚠️ **Photosensitivity (2.3.1)** — настоящий three-flash анализ тяжёл (PEAT-уровня) → только грубая «rapid-flash» эвристика с лейблом «non-authoritative» или опустить.

## 13.6 Конкуренты
**NoCoffee** — снят из CWS, только Firefox, заброшен, автор признаёт «не медицински-аудирован». **Funkify** — freemium, провенанс матриц не раскрыт. **DevTools Rendering→Emulate vision deficiencies** — только 4 CVD + blur + reduced contrast, **без слайдера**, без глаукомы/AMD/hemianopia, Chrome-only, закопан. Бьём широтой + слайдером + one-click popup + кросс-браузер. Скриншот симуляции — делегировать sibling `capture` (фильтр — реальные пиксели, `captureVisibleTab` их включает).

---

# РАСШИРЕНИЕ 14 — Session Saver (`extensions/sessions`)

## 14.1 ⚠️ `tabs`-варнинг неизбежен — владеем честно
Чтение `Tab.url`/`title` через `tabs.query()` требует `tabs` (или broad-host); `activeTab` даёт только активную вкладку по жесту → бесполезно для «сохрани все вкладки окна». Значит **«Read your browsing history» неизбежен**. Владеем честно: описание в house-стиле («Reads your open tabs only to save them; stored on your device, never sent»), Firefox `data_collection_permissions:{required:['none']}` (как `export`), и микрокопия в popup под `?`. Под **CWS Limited Use (энфорс 01.08.2026)** local-only = «collect nothing». Все прочие права — **optional, по жесту**.

## 14.2 Разрешения
| Право | Варнинг | Зачем |
|---|---|---|
| `tabs` | «Read your browsing history» | ядро: URL/title. Неизбежно |
| `storage` | тихо | локальное хранение |
| `alarms` | тихо | авто-сейв под MV3 |
| `tabGroups` (Chrome, **optional**) | ⚠️ **«View and manage your tab groups»** (реальный варнинг!) | восстановить имя/цвет группы, по жесту |
| `sessions` (**optional**) | сворачивается в `tabs`-варнинг | «восстановить недавно закрытые» |
| `cookies` (Firefox, **optional**) | тихо | `tabs.create({cookieStoreId})` в контейнер |
| `unlimitedStorage` (**optional**) | **тихо** | выйти за 10 MB для power-users |

Ни host-permissions, ни контент-скриптов, ни `downloads`.

## 14.3 ⚠️ Разъезды Chrome/Firefox
- **tabGroups:** Chrome стабилен 137+; ⚠️ **Firefox — `tabs.group()` c FF138, полный `tabGroups.update()` (title/color/collapsed) только c FF139**. Feature-detect `browser.tabGroups`.
- **Восстановление без спайка:** ⚠️ **Chrome `tabs.create` не имеет `discarded`** (у Firefox есть). Chrome-воркэраунд: `active:false` → `tabs.discard(id)`, но нельзя дискардить до коммита/активную → надёжный паттерн: bundled **suspended-placeholder** (`sessions.html#<realURL>`), грузящий реальный URL только на активацию (ноль сети до клика). ⚠️ **Троттлить создание (напр. по 5)** — массовое восстановление discarded-вкладок ловило дедлоки UI-треда Chromium.
- **Контейнеры (`cookieStoreId`)** — только Firefox; на Chrome молча дропать.

## 14.4 Модель данных + отказоустойчивость
`storage.local` cap **10 MB** (URL+title ~150 B/tab → ~60k вкладок), `unlimitedStorage` снимает (тихо → запрашивать при подходе к квоте). Модель: один `idx` + по ключу на сессию (`sess:<uuid>`), чтобы не переписывать все сессии на каждый сейв. **Resilience:** пишем `sess:<uuid>` первым, `idx`-указатель флипаем **последним** (atomic-ish commit); rolling `sess:autosave`; на чтении валидируем shape и **карантиним** битые ключи, не падаем; храним last-good — прямой ответ на **потерю данных Session Buddy v4**.

## 14.5 Авто-сейв под MV3
SW умирает через ~30с → **не** держать состояние в памяти SW. Событийная персистентность: слушатели `tabs.onCreated/onUpdated/onRemoved/onMoved` + `windows` пишут debounced-снапшот прямо в `storage.local`; `chrome.alarms` (мин 30с) переpersist'ит «живую» сессию. Каждый листенер будит SW, делает одну запись, отпускает. **Crash recovery:** на старте предложить восстановить `sess:autosave`. **Export/import** — downloads-free (Blob + `<a download>` со страницы расширения, как `export`), ноль `downloads`.

## 14.6 Конкуренты (privacy-грехи) + мобильные
**Toby** — облако + аккаунт, лимит 60 вкладок, воркспейс на их серверах. **OneTab** — локально, но «share as web page» аплоад + переустановка **убивает данные**. **Session Buddy** — локально, но v4-миграция 2025 **потеряла годы сессий**. **Workona/Partizion** — полное облако. Хук доверия: прецедент **EditThisCookie «продали мутному покупателю»** — что звонит домой/держит аккаунт, можно продать и вооружить; **local-only = нечего продать, синкать, взломать, subpoena.** ⚠️ **Firefox Android**: `tabs` есть, но одно окно, нет `sessions` API → урезанный билд. Safari — best-effort save/restore. Chrome Android — расширений нет.

---

# РАСШИРЕНИЕ 15 — On-device Writing Checker (`extensions/proof`) — ОТЛОЖЕН

> Анти-Grammarly: текст **никогда не уходит** из браузера. Самое сложное в постройке из всех — исследовано, чтобы отсрочка была обоснована, а будущий билд имел карту мин. Ниже — почему откладываем.

## 15.1 ⚠️ Editor-integration — главный драйвер отсрочки
По собственному инжинирингу Grammarly: они **отказались** от in-DOM подчёркиваний (портят содержимое поля, ломают сайты) в пользу overlay через `Range.getClientRects()` **вне** поля — но трекинг позиции `getBoundingClientRect()` «легко съедает >90% CPU»; ProseMirror/Quill/Draft.js **активно блокируют** мутацию DOM расширением; IME/композиция превращает поддержку подчёркиваний «из Hard в Nightmare». Плюс sticky-хедеры, попапы, clipped-контейнеры. Надёжное read/underline/replace через `<input>`/`<textarea>`/contenteditable **и** Slate/ProseMirror/Lexical/CodeMirror без поломки страниц — мульти-квартальная работа и **настоящий ров Grammarly**.

## 15.2 ⚠️ Реальная грамматика — неподъёмна в 2026
`retext`+`nlcst` (все MIT: retext-spell/-passive/-simplify/-repeated-words…) — чистый JS, мгновенно, оффлайн, но это **правила/эвристики**, не грамматика (нет согласования, времён, артиклей). **On-device модель** (transformers.js+WebGPU): реальна, но **400 MB–2 GB** загрузки, **2–5 с/сложное предложение**, WebGPU-gated → враждебно «лёгкому single-purpose». ⚠️ **Вердикт: нейро-грамматика как ядро не жизнеспособна в 2026** — retext-правила = реалистичный оффлайн-слой.

## 15.3 ⚠️ Лицензии словарей + нативная угроза
Матрица `wooorm/dictionaries` (файлы держат upstream-лицензию): EN-семья/**ru**/nl — **permissive ✅**; fr/pt/**et**/es — LGPL/MPL/GPL-фрикции ⚠️; **de — GPL, жёсткий блокер ❌** (permissive Hunspell-словаря немецкого нет). «Любой язык» не обещать. MV3: словари **бандлить**/`web_accessible_resources`, не фетчить. EN-пара ~1 MB → мульти-локаль раздувает пакет. ⚠️ **Экзистенциальная угроза:** Chrome уже ships **on-device Proofreader API (Gemini Nano)** — та же ценность «on-device, ничего не уходит», но Chrome-only + требует 22 GB диска/>4 GB VRAM. **Наш дифференциатор:** (a) кросс-браузер вкл. Firefox; (b) стиль/ясность; (c) мульти-локаль UI; (d) работает на слабом железе. Без (a)+(b)+(c) продукт избыточен нативу.

## 15.4 MVP-если-когда
nspell (Hunspell-совместимый, чистый JS) + EN/RU/NL permissive словари, **только `<textarea>`/`<input>`** (без rich-editors), opt-in per-site (`activeTab`), 2–3 retext-стиль-правила как «больше чем натив». Без нейро-модели, без немецкого.

## Открытые вопросы волны 3 (проверить перед соответствующей фазой)
- **convert:** живые CORS-заголовки Frankfurter+CoinGecko (решает host-free fetch); `supportedValuesOf('calendar')` целевого Firefox ESR; коммерческий ToS keyless-CoinGecko + размещение атрибуции; покрытие календарей в iOS-WebKit-ICU + бюджет Temporal-полифилла; покрывает ли таблица Frankfurter RUB.
- **linksafe:** каденс/хостинг рефреша bundled PSL+confusables+shortener-данных (всё в бандле, MV3); оправдан ли ревью-вес `webRequest` ради hop-by-hop vs финальный-URL для MVP (склон: финальный-URL); бюджет размера confusables-таблицы; предлагать ли BYO-key Web Risk при ров-правиле «ничего не уходит».
- **vision:** ⚠️ спайк `backdrop-filter: url(#cvd)` на `pointer-events:none` overlay — фильтрует фон **без** containing-block-поломки, но поддержка SVG-`url()` на `backdrop-filter` неровная (особ. Firefox) — может быть чище всего для whole-page; дефолт Machado-tritan vs Brettel; Firefox-ESR SVG-filter перф.
- **sessions:** точный Chrome-билд, где `tabs.discard` надёжно берёт свежесозданную `active:false` (иначе placeholder-подход); актуален ли `tabGroups`-варнинг в текущем стабильном Chrome UI; дефолтная каденс авто-сейва vs батарея на мобиле; паритет контейнеров в Safari.
- **proof:** может ли нативный `spellcheck` Firefox + свой suggestion-слой обойти overlay-CPU на плоских полях; честна ли область «только `<textarea>`/`<input>`»; приемлема ли грациозная дивергенция (Chrome Proofreader API + retext на Firefox); немецкий без permissive-словаря — опустить.
