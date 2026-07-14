# План имплементации: набор из четырёх расширений

> **Версия 4.** Основано на 2 раундах deep-research (211 суб-агентов с адверсариальной верификацией) + 7 целевых research-агентов. Все числа сверены с первоисточниками (developer.chrome.com, MDN, W3C, wxt.dev, GitHub) на 2026-07-10.
>
> ⚠️ — факты, опровергшие ранние предположения. Читать внимательно: там ломается «очевидная» архитектура.

---

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
