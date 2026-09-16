Где лежит

  - Локально: C:\Users\Marek\Desktop\Temp\Experements\blurAddon
  - Remote: https://github.com/marek-devlab/browser-extensions.git, ветка main, локальная копия синхронна с origin (4efb9c7, всего 13 коммитов)

  Скачать

  git clone https://github.com/marek-devlab/browser-extensions.git
  cd browser-extensions && npm install

  git ls-remote проходит без интерактивной аутентификации из этой среды — но приватность репо так не проверишь; если у стороннего человека клон не пойдёт, значит репо приватный
  и нужен доступ/токен.

  Что внутри

  Монорепо на npm workspaces, сборка через WXT (https://wxt.dev). Издатель — marek-devlab.

  - packages/core — типы, дефолты настроек, DomRuleEngine (без браузерных API); packages/ui — токены, тема, примитивы
  - extensions/* — 14 независимых расширений, каждое со своим манифестом (Chrome MV3 + Firefox), все на версии 1.0.0:
    - волна 1: blur, adblock, perf, seo — код готов, проверены вживую
    - волна 2: devdata, export, assets, whoami, capture, compose — реальная логика + store-хардненинг
    - волна 3 (v0, зелёная сборка): convert, linksafe, vision, sessions
  - e2e/ + playwright.config.ts, scripts/ (guards — проверка собранных манифестов, gen-icons, gen-store-assets), store-assets/

  Документы (README указывает порядок чтения): TODO.md — единственный источник статуса; PLAN.md — архитектура/обоснования по трём волнам; STORE.md — чеклист публикации;
  PRIVACY.md; docs/design/, docs/audit/.

  Статус на 2026-07-20 (по TODO.md): typecheck 11/11 воркспейсов, wxt build Chrome+Firefox по всем, guards чисто на 20 манифестах, e2e blur 53 / perf 14 / seo 20 / adblock 36.
  Не сделано: скриншоты для листингов сторов (нужен человек с браузером) и долги волны 3 — иконки, тесты, headed-смоук, live-CORS. Расширение №15 (proof) отложено.

  Ключевое архитектурное решение — десять/четырнадцать отдельных продуктов вместо одного: Chrome Web Store требует «single purpose» и запрещает бандлы несвязанной
  функциональности. Волна 2 и 3 сознательно спроектированы без install-time <all_urls>; у волны 1 он есть у всех четырёх и это честно описано в README.