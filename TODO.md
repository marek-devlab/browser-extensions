# TODO — живой статус и бэклог

> Актуально на **2026-09-15** (вечер: №16 построен). **Единственный документ со статусом**: сюда смотрят, когда спрашивают «что сделано, что нет, какие проблемы, что дальше».
>
> - [`PLAN.md`](./PLAN.md) — архитектура и обоснования (слой «почему/как»): Часть I — волна 1, Часть II — волна 2, **Часть III — волна 3**, **Часть IV — №16 (построен 2026-09-15)**. Обоснования живут там, статус — здесь. Не дублировать.
> - [`STORE.md`](./STORE.md) — чеклист публикации и тексты листингов.
> - [`docs/design/`](./docs/design/) — UX/UI-макеты шести расширений волны 2 + [`netblock.md`](./docs/design/netblock.md) (№16).
> - [`docs/research/`](./docs/research/) — deep-research по новым расширениям (пока: [`2026-09-15-netblock.md`](./docs/research/2026-09-15-netblock.md)).
> - [`docs/plans/netblock/`](./docs/plans/netblock/) — планы фаз №16 с проверенными источниками (в т.ч. [`03-compliance.md`](./docs/plans/netblock/03-compliance.md) — матрица политик стора).
> - [`docs/audit/`](./docs/audit/) — аудит всех десяти от 2026-07-14 + пре-сабмит аудит №16 ([`2026-09-15-netblock.md`](./docs/audit/2026-09-15-netblock.md)).

---

## 📦 Общий статус

**Пятнадцать расширений реализованы** (десять волн 1–2 + четыре волны 3 + **№16 netblock — построен 2026-09-15**; №15 proof отложен, см. «🧪 №16» ниже). Монорепо WXT, общие `@blur/core` + `@blur/ui` + `@blur/netcore`.

- **Волна 1 (v1.0.0):** blur, adblock, perf, seo. Код готов; **все блокеры аудита §0 закрыты** (см. ниже).
- **Волна 2:** capture, devdata, export, assets, whoami, compose. Реальная логика + store-хардненинг закоммичены; privacy policy покрывает все десять.
- **Волна 3 — РЕАЛИЗОВАНА (v0), зелёная сборка:** convert, linksafe, vision, sessions (+ proof отложен). Typecheck/guards/build Chrome+Firefox зелёные. Долги (иконки, тесты, headed-смоук, live-CORS) — в разделе «🌱 Волна 3» ниже.

**Зелёная верификация (2026-07-15):** `typecheck` 11/11 воркспейсов · `wxt build` Chrome+Firefox по всем · `npm run guards` чисто на 20 манифестах · `npm run e2e` — blur 53 / perf 14 / seo 20 / adblock logic 36.

---

## 🟢 Закрыто в цикле 2026-07-15

### Блокеры аудита §0 существующих четырёх — исправлены (commit `93b8ea7`)

- **blur:** удалён неиспользуемый `scripting` (+ ложные обоснования в wxt.config/README/STORE/PRIVACY); убрано ложное `optional_host_permissions: <all_urls>` из README; тумблер сайта стал subdomain-aware; импорт бэкапа валидируется (ReDoS-паттерны + `\n`-fail-open отсекаются, гвард и на build-time селектора); RMW-гонка `siteConfigs`/prefs сериализована через Web Lock; «Counts are EXACT» смягчено (min-size gate).
- **adblock:** 🔴 CSS-инъекция через косметические селекторы закрыта на sink (`packages/core`) + трёх входных путях (отсев `{}@<` + `querySelector`); 🔴 счётчик больше не завышает (block/non-block разведены по id-диапазонам, `allow`-исключения не считаются блокировками); + inert `modifyHeaders` убраны, сериализация DNR-реконсиляции, `tabId<0` игнор, честное логирование truncation.
- **perf:** 🔴 URL для PSI стал редактируемым + кнопка «только домен/путь» + предупреждение про секреты в query; 🔴 раскрытие PSI дополнено (что/куда шлётся, ссылка на политику Google, revoke-согласия). ⚠️ **Это же закрывает пункт §A** «раскрытие PSI перенести в UI» под политику CWS 2026-08-01.
- **seo:** таймаут `AbortSignal` + потоковый байт-кап на fetch robots/sitemap/HEAD; `helpUrl` из axe через scheme-allowlist перед `<a href>`; nonce теперь `crypto.getRandomValues`.

### Прочее

- **blur: блюр внутри cross-origin iframe** (commit `089d740`) — `allFrames: true` + `matchAboutBlank: true`, top-only оркестрация через `isTopFrame`. Закрывает ⚠️-находку «iframes не блюрятся». Разрешений не добавляет.
- **Волна 2: store-хардненинг** (commit `df15847`) — по всем шести закрыты находки отказоустойчивости/честности/политики: devdata (`__proto__` silent-loss, FailureView split, JWT-guard, iterative `stripKeyword`), export (img scheme-guard, `sync→local`, escaping, column-drop), assets (`requestScope`, `overflowed`, MV2-fallback, `<picture>` dedup), whoami (`copyFormat` + copy-all, UA-clamp), capture (честный комментарий вместо несуществующего disk-streaming, abort-оценка, badge, Firefox host-label), compose (GLFM-warning, attr-name валидация, кап snapshot'ов).
- **Privacy/legal:** `PRIVACY.md` переписан на десять расширений; whoami называет получателей (Cloudflare, ipinfo.io/USA), capture раскрывает локальную запись экрана/микрофона; mediabunny (MPL-2.0) атрибутирован (root + `capture/public/THIRD-PARTY-NOTICES.md`).

---

## 🟢 Закрыто в цикле 2026-07-20

Три осознанно-отложенных вопроса закрыты. Верификация: `typecheck` все воркспейсы · `wxt build` Chrome+Firefox (blur/seo/perf) · `npm run guards` чисто на 20 манифестах · e2e blur 53 / perf 14 / seo 20.

- **blur B1 — page-`localStorage` пре-блюр теперь FAIL-SAFE** (`content.ts` `effectivePreblurProfile`). Изолированный мир контент-скрипта делит DOM-storage со страницей, аутентифицируемого синхронного канала на `document_start` нет (статичный секрет извлекаем из публичного пакета, `crypto.subtle` асинхронен), а `scripting`/background-CSS осознанно не возвращаем (это преимущество для ревью). Поэтому кэш трактуется как **недоверенный вход и может только УСИЛИТЬ пре-блюр, никогда не пропустить/ослабить**: сшитый лист = дефолт ∪ кэш (union категорий, max радиус, solid>blur, выше opacity, строже reveal). Реальная дыра («сайт пишет `{active:false}` → вспышка скрытого контента до реблюра») закрыта — худшее, что теперь может страница, это заставить нас блюрить БОЛЬШЕ её же контента (self-heals в reconcile). Цена: allowlisted/disabled origin даёт кратк. вспышку блюра — но всегда в **безопасную** сторону (никогда не показывает скрытое). Инвариант закреплён в коде; регрессий в 53 e2e нет.
- **seo — nonce больше не утекает по фикс-URL** (`wxt.config.ts` `use_dynamic_url:true` + `content.ts` `keepInDom:false`). MAIN-world граница в page-контролируемом окне **фундаментально** не аутентифицируема (любой window/DOM-канал подделываем страницей), а единственная полная альтернатива — гонять axe в изолированном мире — в WXT инлайнит 550 kB axe в always-on `content.js` (замерено 68→651 kB на каждой странице): это хуже для юзера, чем low-severity подделка **собственных** цифр аудита без эскалации. Поэтому: `use_dynamic_url` убирает фикс-URL фингерпринт-пробу (`chrome-extension://<id>/axe-run.js`) и предсказуемую цель; `keepInDom:false` схлопывает окно чтения nonce до синхронного (async MutationObserver уже не успевает). Остаточный вектор (страница с синхронным хуком вставки DOM подделывает свой же результат) честно задокументирован в коде. Firefox: UUID расширения рандомизирован per-install, фикс-URL пробы нет и без `use_dynamic_url`.
- **perf — headed-прогон переклассифицирован в человеческий шаг** (см. ниже и [`docs/perf-headed-smoke.md`](./docs/perf-headed-smoke.md)). Кода чинить нечего: PSI-панель (редактируемый URL, strip-query, disclosure+revoke, рантайм-запрос хоста) и CDP-путь (arm-before-reload, ignoreCache, detach в finally, честный отказ на пустой захват/Firefox) отревьюены статически и корректны; манифест `optional_permissions`/`optional_host_permissions` подкрепляет каждый рантайм-запрос; headless e2e 14/14. Живой CDP/`chrome.debugger` **невозможно** автоматизировать здесь (Playwright сам CDP-клиент → attach конфликтует; devtools-панель не обычная вкладка) — поэтому это ручной пред-сабмит смоук, в одном ряду со скриншотами листингов.

## 🔴 Отложено осознанно (код, с обоснованием)

- **blur — полный уход пре-блюр-состояния из page-storage на background-registered CSS** — необязательная будущая доработка поверх fail-safe (выше). Убрала бы и остаточный фингерпринт-читаемых-настроек, и кратк. вспышку на allowlisted/disabled origin, но возвращает `scripting`, браузеро-зависима (Chrome `registerContentScripts` — только CSS-файлы; Firefox MV2 `contentScripts.register` — inline) и трогает ядровой инвариант block-first → отдельный дизайн + живой headed-тест. Не блокер: security-дыра уже закрыта fail-safe'ом.
- **seo — полная невозможность подделки результата аудита** — потребовала бы изолированного мира (стоит +0.6 MB axe на каждой странице) или `scripting`-инжекта (лишнее разрешение у намеренно-минимального аудитора). Оба хуже, чем текущий остаток (подделка собственных цифр без эскалации). Не блокер.

---

## 🧍 Публикация — только человеческое (не автоматизируется)

По всем десяти, если не указано иное:

- [ ] **Скриншоты листингов** в реальном браузере. Chrome требует ≥1 (1280×800 или 640×400), рекомендует 5. Нужен человек с браузером.
- [ ] **Живой просмотр сгенерированных иконок** глазами (их нарисовал `scripts/gen-icons.mjs`).
- [ ] **perf — headed-смоук PSI-панели и CDP/`debugger`-пути** в реальном браузере по чеклисту [`docs/perf-headed-smoke.md`](./docs/perf-headed-smoke.md). Единственный шаг, который не автоматизируется (Playwright сам CDP-клиент; devtools-панель не обычная вкладка). Код и headless e2e 14/14 зелёные.
- [ ] **Реальные gecko-id домены** вместо placeholder `@blur.example` в Firefox-манифестах **волны 1** (волна 2 уже на `<name>@marek-devlab.github.io`). Бизнес-решение.
- [ ] **Аккаунты разработчика:** Chrome Web Store (разовый взнос), AMO, Edge Add-ons, Opera.
- [ ] **Публикация privacy policy** по ссылке `https://github.com/marek-devlab/browser-extensions/blob/main/PRIVACY.md` (текст готов в `PRIVACY.md`).
- [ ] ⚠️ Перепроверить `data_collection_permissions` во **всех** Firefox-манифестах против [актуальной таксономии](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/) (обязателен с 2025-11-03; значения проставлены).
- [ ] Промо-тайл 1400×560 (опц., Chrome), промо-видео (опц.).
- [ ] По волне 2: `wxt zip` + sources ZIP для AMO/Opera, обоснование каждого разрешения в дашборде, сверка с политикой CWS от 2026-08-01.

---

## 🟡 Технический долг

- [ ] **Миграция волны 1 на `@blur/ui`.** Пакет создан, шесть новых на нём; blur+adblock и perf+seo пока с двумя расходящимися копиями токенов — мигрировать и удалить копии. — `PLAN.md` Часть II §7
- [ ] **`packages/formats`** — вынести чистые конвертеры JSON/YAML/XML/CSV/JWT (сейчас devdata стабит у себя). **`@blur/picker`** — вынести element-picker, скопированный в `adblock`/`assets`/`export`.
- [ ] **Тесты волны 2 — сквозной пробел.** Нет тест-раннера для расширений (у волны 1 только Playwright-e2e). Приоритетные регрессии зафиксировать: capture (offscreen-kill → recovery; needsRemux ≠ stream-copy), devdata (detect без полного парса; SYSTEM-литерал не обходит entity-guard; JWT не в session:handoff), whoami (hand-edited `autoFetchIp:true`+`cfConsent:unset` не звонит домой), export (rung 3 без навигации; CSV-guard TAB/CR).
- [ ] **Safari — отдельная фаза** (нужен macOS + Xcode + Apple Developer $99/год; непроизводимо на Windows).
- [ ] **DevTools-панели (`perf`, `seo`) headed-e2e** на машине с headed-Chromium.
- [ ] **blur: keyword-blur внутри Shadow DOM** — осознанно отложен (затрагивает reveal/reblur-семантику в обеих стратегиях).
- [ ] **blur: точность счётчиков** для min-size gate и link-hiding марджинально «щедрая» (у core-движка нет per-matched-element хука). Визуал корректен, цифра слегка завышена — уже честно помечено в UI.

---

## 🌱 Волна 3 — РЕАЛИЗОВАНА (v0, зелёная сборка) · proof отложен

Четыре расширения (№11–14) реализованы 2026-07-20; №15 (proof) осознанно отложен. Дизайн/обоснования — [`PLAN.md`](./PLAN.md) Часть III. Тот же ров: single-purpose, минимум прав, ничего не уходит из браузера, честный UI, кросс-браузер, fail-safe, свежая платформа 2026, no-remote-code.

**Зелёная верификация волны 3 (2026-07-20):** `typecheck` все воркспейсы · `wxt build` Chrome MV3 + Firefox MV2 по всем четырём · `npm run guards` чисто на **28** собранных манифестах. Манифесты подтверждены: **convert/linksafe/vision инсталлятся с ПУСТЫМ списком варнингов** (ноль host_permissions), **sessions** — один честный `tabs` («Read your browsing history») + optional остальное.

| # | Расширение | Статус | Манифест (Chrome) |
|---|---|---|---|
| 11 | **convert** | ✅ MVP зелёный | `storage,activeTab,scripting,contextMenus` + `omnibox` + opt-host на 2 rate-API; **ноль варнингов** |
| 12 | **linksafe** | ✅ MVP зелёный | `contextMenus,activeTab,scripting,storage` + opt `<all_urls>`; **ноль варнингов** (hoist снят `manifestGenerated`-хуком) |
| 13 | **vision** | ✅ MVP зелёный (я, референс) | `activeTab,scripting,storage`; **ноль варнингов** |
| 14 | **sessions** | ✅ MVP зелёный | `tabs,storage,alarms` + optional `tabGroups/sessions/unlimitedStorage`; один честный `tabs`-варнинг |
| 15 | **proof** | ⏸️ отложен осознанно | — (детали PLAN §15; строить после волны 3) |

**Реализовано (кратко):** vision — матрицы Machado 2009 (severity сверены с Blink) + linearRGB + инъекция через `scripting` (DOMParser, guard-safe), полный EN/RU/ET. convert — 15 категорий юнитов руками (US/Imperial, SI/IEC honesty), мульти-календарь из `Intl` (feature-detect, Hijri ±1 лейбл), таблица Frankfurter → сумма локальна, omnibox+context-menu. linksafe — punycode/UTS-39/tldts локально, honest-формулировки (CJK не флагается), сеть opt-in. sessions — atomic `idx`+`sess:<uuid>` + карантин, Chrome placeholder / Firefox discarded lazy-restore + троттлинг, MV3 auto-save + crash-recovery.

### 🔶 Долги/незакрытое волны 3 (перед стором)

- [x] **Тесты волны 3 — ✅ закрыто (2026-07-20).** `npm run e2e:wave3` (вшит в общий `e2e`) — **29/29** node-логик-тестов на реальных `.ts`-модулях: convert `units.ts` (аффинная температура, US/Imperial, SI/IEC, инверсная топливная, BigInt-базы, identity+round-trip по всем юнитам) + `datetime.ts` (календари/зодиак/Unix), linksafe `analyze.ts` (схемы/креды/IP/mismatch/трекинг/шортенеры/badge), sessions `model.ts` (restorable/normalize/dedupe/meta). Тест поймал верхний регистр hex у `formatInBase` — выровнено.
- [x] **convert live-CORS + Firefox fallback — ✅ (2026-07-20).** `api.frankfurter.dev` и `api.coingecko.com` оба отдают `access-control-allow-origin: *` → host-permission-free fetch валиден. Firefox MV2 optional-origins разведены под `optional_permissions` (Chrome — `optional_host_permissions`), проверено в собранных манифестах — CORS-fallback работает на обоих. Осталось: Temporal-полифилл для Safari (отдельная фаза, iOS).
- [x] **PRIVACY.md — ✅ обновлён (2026-07-20)** на 14 расширений: 4 новых потока данных (perf/whoami/convert/linksafe), 4 новые пер-расширение секции, лицензии tldts/punycode. STORE.md — ещё нет (см. ниже).
- [x] **Реальные иконки — ✅ закрыто (2026-07-20).** 4 бренда + 4 глифа в `scripts/lib/draw.mjs` (convert — ⇄ swap на lime; linksafe — ↳ redirect на slate; vision — очки на fuchsia; sessions — окно с вкладками на rose), `npm run icons` → 56 PNG. Визуально сверены. (Финальный глаз человека — как и у первых десяти, в общем «человеческом» списке.)
- [x] **STORE.md — ✅ дополнен (2026-07-20).** Таблица расширений (+4), обновлён claim про off-device потоки (2→4: +convert rate-table, +linksafe opt-in resolve), 4 чеклист-записи Privacy-practices с получателями (convert REVIEW-SENSITIVE/network, linksafe REVIEW-SENSITIVE/opt-in, sessions REVIEW-SENSITIVE/`tabs`-варнинг, vision zero-network).
- [ ] **Живой headed-смоук** каждого (инъекция vision/linksafe, omnibox/badge convert, реальный save/restore sessions) — как у perf, единственный человеческий гейт.
- [ ] Кандидаты на вынос в пакеты: `@blur/picker` (linksafe/assets/export scan), SVG-filter общее ядро (vision/blur). Техдолг, не блокер.

## 🧪 №16 Request Blocker (`extensions/netblock`) — ПОСТРОЕН (2026-09-15), до стора — ручной смоук + ассеты + сабмит

Цель одной фразой: «Блокировать и фейлить сетевые запросы по правилам — для тестирования отказоустойчивости фронтенда». Листинг — ровно одна фраза (дизайн §11): **«Request Blocker: block, fail and delay network requests for frontend resilience testing»**.

- Research: [`docs/research/2026-09-15-netblock.md`](./docs/research/2026-09-15-netblock.md) · дизайн v1.1: [`docs/design/netblock.md`](./docs/design/netblock.md) · спайки: [`e2e/netblock-spikes/REPORT.md`](./e2e/netblock-spikes/REPORT.md) · планы фаз (с источниками 2024+): [`docs/plans/netblock/`](./docs/plans/netblock/) · **что построено и чем отклонились от спеки:** [`extensions/netblock/IMPLEMENTATION.md`](./extensions/netblock/IMPLEMENTATION.md) · пре-сабмит аудит по политикам: [`docs/audit/2026-09-15-netblock.md`](./docs/audit/2026-09-15-netblock.md) · тексты для дашбордов CWS/AMO: [`STORE.md`](./STORE.md) «Request Blocker» · политика: [`PRIVACY.md`](./PRIVACY.md) «Request Blocker».

### ✅ Реализовано (фазы 1–2, все зелёные на 2026-09-15)

- **Фундамент** (`utils/*`, чистый TS): модель правила + строгий валидатор импорта (`__proto__`/`constructor` — отказ, лимиты §5.8/§7.1, ReDoS-гейт из `@blur/netcore`), таблица выбора движка с ключами честности §6, счётчики `decide()` (once/times/nth/skipFirst/probability+seed/window/afterRule), кольцевой лог (`session` + RAM, маска `Authorization`/`Cookie`/… всегда, HAR без тел), протокол UI↔background, `defineItem`-хранилища + Web Lock RMW.
- **Движки**: `dnr` (Chrome; только session-правила, позиционные id, атомарный reconcile, реактивные `afterRule`/`window`/`skipFirst`, пауза = `allow` priority 1 000 000, ≈-счётчики через наблюдающий `webRequest`), `page` (Chrome; MAIN-world патч fetch/XHR — статический файл, nonce-релей, регистрация **только** на выданных origin'ах), `debugger` (Chrome; CDP `Fetch` — `enable/disable/continueRequest/failRequest/fulfillRequest` + `Page.getFrameTree/enable`, `getResponseBody` не вызывается, watchdog 30 с, detach в `finally`, 3 ошибки подряд → detach), `webrequest` (Firefox desktop + Android; blocking `onBeforeRequest`/`onHeadersReceived`, `status`/`fail` → cancel + `wr↓`, кэш состояния с overlay).
- **UI**: popup (Enable on host → `permissions.request` синхронно в клике; NL-тумблер + `<dialog>` согласия §2.7; пауза; счётчики `2/3 ↻`/`≈`/`—`), tool page (`#/rules` split view с редактором и live-бейджем, `#/log` grid с «правило из запроса»/HAR, `#/settings`), EN/RU/ET (эстонский — настоящий перевод), все 12 пунктов честности §6 на экране.
- **Манифесты** (собраны, `npm run guards` чисто): Chrome `storage, activeTab, alarms, scripting, webRequest, declarativeNetRequest, debugger` + `optional_host_permissions: <all_urls>` (hoist `<all_urls>` вырезан хуком), CSP `connect-src 'none'`; Firefox `storage, activeTab, alarms, webRequest, webRequestBlocking, <all_urls>`, `gecko.id netblock@marek-devlab.github.io`, `strict_min_version 140.0`, `data_collection_permissions.required: ['none']`, `gecko_android: {}`.
- ⚠️ **Отклонение от дизайна §0/§11 — решение владельца 2026-09-15:** `debugger` **install-time** в Chrome. Причина — проверенный факт: Chromium помечает `debugger` `kFlagCannotBeOptional`, `optional_permissions: ['debugger']` вырезается с install-warning, `permissions.request` отклоняется. Network-level mode остаётся **opt-in на вкладку** (ничего не attach'ится без диалога согласия в popup; detach при выключении/закрытии вкладки/Cancel в баннере/политике/3 ошибках). Цена: предупреждения «Read and change all your data on all websites» + «Access the page debugger backend» при установке.
- **Тесты** (после фазы 4, 2026-09-15): Node на реальных `.ts` — logic **46**, dnr **24**, page **27**, debugger **25**, webrequest **20**, netcore **17** (все в цепочке `npm run e2e`); Playwright UI + integration **21**; live офлайн — dnr **15**, page **28**, debugger **34** (Chromium), webrequest **20** (установленный Firefox через `web-ext` + Marionette). Итого 277 проверок.
- **Store-ассеты (скрипт):** иконки 16/32/48/128 (`npm run icons`, бренд `BRAND.netblock` — графит, «разорванная линия»), промо-тайл 440×280 — `store-assets/netblock/promo-tile-440x280.png` (сгенерирован 2026-09-15, `npm run store-assets`).
- **Документы стора:** PRIVACY.md (секция + «fifteen»), STORE.md (полная секция REVIEW-SENSITIVE с текстами обоснований для каждого разрешения, Q&A ревьюера, AMO-заметки), аудит `docs/audit/2026-09-15-netblock.md`, план `docs/plans/netblock/03-compliance.md`.

### 🔶 Осталось до сабмита (по порядку)

- [x] **Дефекты из аудита — закрыты фазой 4** (2026-09-15, [`docs/plans/netblock/04-audit.md`](./docs/plans/netblock/04-audit.md), «Post-fix status» в [`docs/audit/2026-09-15-netblock.md`](./docs/audit/2026-09-15-netblock.md)): три 🟡 копии/UI пре-сабмит аудита + восемь находок adversarial-прохода: единый валидируемый путь записи правил (`utils/rules-commit.ts` — правила больше не «исчезают» после рестарта SW при удалённой цели `afterRule`/лишних regex; `saveGroup` валидируется; отказ удаления с зависимыми), санитизация отчётов страницы (`sanitizePageEvents`), проверка отправителя привилегированных сообщений, `Content-Security-Policy: sandbox` на подменённых ответах NL, сброс `resetOn: navigation` без host-доступа, `.catch` на всех fire-and-forget путях, честная копия (workers/Revoke/«не просим при установке»/«fall back»/«every resource type») в EN/RU/ET, STORE/PRIVACY («idle install», `homepage_url`).
- **Остаток фазы 4 (🟢, не блокеры):** (1) Firefox `browser_action` без `default_icon` — WXT не переносит `action.default_icon` в MV2 (так у всех расширений монорепо; Firefox подставляет `icons`, `ext-browserAction.js`) — проверить глазами в тулбаре, при желании добавить `browser_action.default_icon` в конфиг; (2) `matchesUrlCondition` компилирует `RegExp` + гоняет `checkRegexSafety` на каждый запрос в blocking-листенере Firefox — кэш скомпилированных regex в `@blur/netcore` (перф, не корректность); (3) `relay:click`/MAIN-`click` без `isTrusted` — программный клик страницы открывает её `window(click)`-окна (осознанно: автотесты кликают программно; остаток документирован в `04-audit.md`); (4) мёртвый Chrome-код в Firefox-пакете и persistent background на Firefox — как раньше (v2).
- [ ] **Ручной headed-смоук** по [`docs/netblock-headed-smoke.md`](./docs/netblock-headed-smoke.md) (единственное, что не автоматизируется: реальный промпт `permissions.request({origins})`, реальный жёлтый баннер `debugger` и его Cancel, DevTools «Request conditions» ∥ наш `Fetch.enable`, Firefox for Android на устройстве).
- [ ] **Скриншоты листинга** (1280×800 или 640×400; список состояний — STORE.md «Request Blocker → Screenshots»), человеческий взгляд на иконку в тулбаре и промо-тайл.
- [ ] **Сабмит CWS** по чеклисту STORE.md: Privacy practices (single purpose, обоснования всех 8 полей — тексты готовы, remote code = No, data usage = none, privacy policy URL), category Developer Tools. ⚠️ Главный риск ревью — `debugger` в baseline (оценка и митигации — аудит §b, план `03-compliance.md`); апелляция одна на нарушение — тексты обоснований не сокращать.
- [ ] **Сабмит AMO**: `wxt zip -b firefox` + sources ZIP (README с окружением ревьюера Ubuntu 24.04.4 ARM64 / Node 24.14.0 / npm 11.9.0 и командами воспроизведения), notes to reviewers из STORE.md (`webRequestBlocking` + `<all_urls>`, React `innerHTML`, неиспользуемые Chrome-only файлы в бандле).
- [ ] **Edge Add-ons / Opera** — тот же Chrome-zip; в Edge «Notes for certification» — демо-страница с реальными 500/задержками.

### 🔜 v2 (из дизайна, не блокеры v1)

- DevTools-панель как третья проекция того же React-приложения (§1.2; после ручного прогона с «Request conditions»), side panel.
- Воркеры и WebSocket в NL-режиме (`Target.setAutoAttach`; спайк S4 — `Fetch` хендшейк не видит).
- `scenario` (state machine WireMock-стиля), `mockBody`/условие по телу ответа (с отдельным согласием — `getResponseBody`), `throttle` как действие только в NL, breakpoint.
- Контекстное меню «Заблокировать этот ресурс» (desktop-only), текстовый импорт `~c 500 & ~u /api`.
- Батчинг `log:append` (на Android строка лога = один RMW `session:log`); event page вместо persistent background на Firefox (рекомендация Mozilla для Android).

### ⚠️ Побочные находки для других расширений (из этой работы)

- [ ] **`perf`: `optional_permissions: ['debugger']` — Chrome молча вырезает** (`kFlagCannotBeOptional`, `permissions_parser.cc`: «Permission 'debugger' cannot be listed as optional. This permission will be omitted.»). Следствие: `permissions.request({permissions:['debugger']})` в popup `perf` **отклоняется**, exact-bytes-путь не может работать вообще; headed-смоук B из [`docs/perf-headed-smoke.md`](./docs/perf-headed-smoke.md) не пройден именно поэтому. Нужно решение владельца: `debugger` install-time (как в `netblock`, с opt-in по кнопке) или убрать фичу и ключ; в любом случае поправить STORE.md/PRIVACY.md `perf` («optional, opt-in» — сейчас неправда о собранном манифесте `extensions/perf/.output/chrome-mv3/manifest.json`).
- [ ] **`adblock`: `ALLOWLIST_PRIORITY = 2_000_000_000`** (`extensions/adblock/utils/backends/dnr.ts:46`) сидит в зоне, где DNR-приоритеты ведут себя немонотонно: замер `testMatchOutcome` на Chromium 153 (`e2e/netblock/dnr.live.mjs` (d), `extensions/netblock/utils/engines/dnr-translate.ts:34-41`) — `allow` с priority `2^29` и `2^30` **проигрывает** `block` с priority 1, тогда как `2^20` и `2·10⁹` выигрывают (индексированный priority пакуется с битами действия). Значение `2·10⁹` в одном замере сработало, но гарантии на границе int32 нет и поведение необъяснимо; `1_000_000` (как `PAUSE_PRIORITY` в netblock) проверено. Перевести allowlist на «скромный» priority и добавить живую проверку.

## ❓ Открытые вопросы (проверить перед соответствующей фазой)

- [ ] Точная версия Chrome для `topDomains`/`excludedTopDomains` (референс говорит 145+, на What's New не подтвердилось). Research netblock 2026-09-15: в `declarative_net_request.webidl` (main) ключ есть вместе с enum `RuleConditionKeys` (WECG #762) — дата стабильного релиза по-прежнему не подтверждена; feature-detect через `RuleConditionKeys`.
- [x] Численные лимиты DNR в Firefox — **закрыто 2026-09-15** (Research netblock §2.6, `ExtensionDNRLimits.sys.mjs` tip): dynamic 5 000 · session 5 000 · regex 1 000 · guaranteed static 30 000 · rulesets 100 / enabled **20** · disabled static 5 000. Переопределяемы префами `extensions.dnr.*`; `responseHeaders`-условия в Firefox нет (bug 1877486 NEW).
- [ ] **Лицензия Peter Lowe's list для коммерческого использования** — запросить разрешение или исключить (блокер, если попадёт в бандл).
- [ ] Поведение `text-shadow` в `::highlight()` в Firefox — тестировать вживую.
- [ ] `captureVisibleTab` на Firefox Android при DPR > 1 — [Bugzilla 1751961](https://bugzilla.mozilla.org/show_bug.cgi?id=1751961).
- [ ] ToS `ipinfo.io` Lite / `ipapi.co` для коммерческого использования (whoami ISP-фича) — подтвердить перед релизом. — `PLAN.md` Часть II §5.2

---

## Развилки — решены

- **Расширение 8:** вместо Media Downloader — **Asset Inspector** (`extensions/assets`): показывает источник элемента, не скачивает. Возврат в CWS, `webRequest`/`<all_urls>` не нужны. — `PLAN.md` Часть II §4
- **UA-switcher (потенциальное №11)** — отдельный продукт, не внутрь whoami (ломает single purpose и zero-permission). — `PLAN.md` Часть II §5.4
