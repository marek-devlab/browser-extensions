# TODO — живой статус и бэклог

> Актуально на **2026-07-20**. **Единственный документ со статусом**: сюда смотрят, когда спрашивают «что сделано, что нет, какие проблемы, что дальше».
>
> - [`PLAN.md`](./PLAN.md) — архитектура и обоснования всех десяти расширений (слой «почему/как», Часть I — волна 1, Часть II — волна 2). Обоснования живут там, статус — здесь. Не дублировать.
> - [`STORE.md`](./STORE.md) — чеклист публикации и тексты листингов.
> - [`docs/design/`](./docs/design/) — UX/UI-макеты шести новых расширений.
> - [`docs/audit/`](./docs/audit/) — аудит всех десяти от 2026-07-14.

---

## 📦 Общий статус

**Десять расширений, все реализованы.** Монорепо WXT, две волны, общие `@blur/core` + `@blur/ui`.

- **Волна 1 (v1.0.0):** blur, adblock, perf, seo. Код готов; **все блокеры аудита §0 закрыты** (см. ниже).
- **Волна 2:** capture, devdata, export, assets, whoami, compose. Реальная логика + store-хардненинг закоммичены; privacy policy покрывает все десять.

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
