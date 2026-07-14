# План второй волны: пять новых расширений

> **Версия 1** (2026-07-14). Основано на трёх research-агентах с проверкой по первоисточникам (developer.chrome.com, MDN/BCD, webstatus.dev, extensionworkshop.com, npm/GitHub, живые curl-пробы API). Все факты сверены на **2026-07-14**.
>
> ⚠️ — факты, которые ломают «очевидную» архитектуру. Читать внимательно.
>
> Продолжение [`PLAN.md`](./PLAN.md) (первые четыре расширения). Правила игры оттуда — single purpose, no remote code, минимизация разрешений, monorepo + WXT — остаются в силе и здесь. Актуальный бэклог с чекбоксами — [`TODO.md`](./TODO.md).

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
