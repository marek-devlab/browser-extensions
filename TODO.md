# TODO — живой статус и бэклог

> Актуально на **2026-07-20**. **Единственный документ со статусом**: сюда смотрят, когда спрашивают «что сделано, что нет, какие проблемы, что дальше».
>
> - [`PLAN.md`](./PLAN.md) — архитектура и обоснования (слой «почему/как»): Часть I — волна 1, Часть II — волна 2, **Часть III — волна 3 (спроектирована, не построена)**. Обоснования живут там, статус — здесь. Не дублировать.
> - [`STORE.md`](./STORE.md) — чеклист публикации и тексты листингов.
> - [`docs/design/`](./docs/design/) — UX/UI-макеты шести новых расширений.
> - [`docs/audit/`](./docs/audit/) — аудит всех десяти от 2026-07-14.

---

## 📦 Общий статус

**Четырнадцать расширений реализованы** (десять волн 1–2 + четыре волны 3; №15 proof отложен). Монорепо WXT, общие `@blur/core` + `@blur/ui`.

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
- [ ] **Реальные gecko-id домены** вместо placeholder `@blur.example` в Firefox-манифестах **волны 1** (волна 2 уже на `<name>@blockaly.com`). Бизнес-решение.
- [ ] **Аккаунты разработчика:** Chrome Web Store (разовый взнос), AMO, Edge Add-ons, Opera.
- [ ] **Публикация privacy policy** по ссылке `blockaly.com/privacy` (текст готов в `PRIVACY.md`).
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

## ❓ Открытые вопросы (проверить перед соответствующей фазой)

- [ ] Точная версия Chrome для `topDomains`/`excludedTopDomains` (референс говорит 145+, на What's New не подтвердилось).
- [ ] Численные лимиты DNR в Firefox (MDN документирует имена констант, не значения).
- [ ] **Лицензия Peter Lowe's list для коммерческого использования** — запросить разрешение или исключить (блокер, если попадёт в бандл).
- [ ] Поведение `text-shadow` в `::highlight()` в Firefox — тестировать вживую.
- [ ] `captureVisibleTab` на Firefox Android при DPR > 1 — [Bugzilla 1751961](https://bugzilla.mozilla.org/show_bug.cgi?id=1751961).
- [ ] ToS `ipinfo.io` Lite / `ipapi.co` для коммерческого использования (whoami ISP-фича) — подтвердить перед релизом. — `PLAN.md` Часть II §5.2

---

## Развилки — решены

- **Расширение 8:** вместо Media Downloader — **Asset Inspector** (`extensions/assets`): показывает источник элемента, не скачивает. Возврат в CWS, `webRequest`/`<all_urls>` не нужны. — `PLAN.md` Часть II §4
- **UA-switcher (потенциальное №11)** — отдельный продукт, не внутрь whoami (ломает single purpose и zero-permission). — `PLAN.md` Часть II §5.4
