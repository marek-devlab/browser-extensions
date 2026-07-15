# @blur/ui

Общий пресентационный слой семьи расширений: дизайн-токены, тема, примитивы, mock-хелперы для фазы каркаса.

Появился как погашение долга из [`PLAN.md`](../../PLAN.md) §18 и [`PLAN.md`](../../PLAN.md) (Часть II) §7: первые четыре расширения дублировали два расходящихся набора токенов копипастой. Вторая волна (шесть расширений) импортирует **один** набор отсюда. Существующие четыре мигрируют на него отдельной задачей (`TODO.md` §E) — этот пакет их пока не трогает.

Пакет **чистый**: не импортирует `wxt`/`browser` и не трогает extension storage (по аналогии с `@blur/core`, который не трогает браузерные API). Тему каждое расширение персистит своим `storage.defineItem` и подключает к хелперам отсюда.

## Использование

```ts
// entrypoints/<surface>/main.tsx — токены и стили ДО локального style.css
import '@blur/ui/tokens.css';
import '@blur/ui/components.css';
import './style.css';
import { seedTheme } from '@blur/ui';

seedTheme('blur-devdata:theme');   // синхронный сид темы до createRoot (без FOUC)
```

```tsx
import { useThemeController, ThemeToggle, Spinner, EmptyState, Badge, Button, Callout, MockBadge } from '@blur/ui';
```

## Экспортирует

- `tokens.css` — канонический набор CSS-переменных (`--bg`, `--text`, `--accent`, `--good/warn/poor` + `-fg` варианты, `--badge-fill-text`, радиусы, шрифты), light/dark/`data-theme`, базовый reset, `:focus-visible`, спиннер, `prefers-reduced-motion`, `accent-color` для нативных контролов.
- `components.css` — стили примитивов ниже (только на переменных из tokens.css → тема бесплатно).
- **Тема** (`theme.tsx`): `Theme`, `applyTheme(theme, devtoolsTheme?)`, `seedTheme(key, devtoolsTheme?)`, `cacheTheme`, `useThemeController({key, read, write, devtoolsTheme?})`, `<ThemeToggle>`. `devtoolsTheme` передаётся параметром (`browser.devtools?.panels?.themeName`), чтобы пакет не тянул `wxt`.
- **Примитивы** (`components.tsx`): `<Spinner>`, `<EmptyState>`, `<ErrorState>`, `<Badge severity>`, `<SectionHeading>`, `<Button variant>`, `<CopyButton>`, `<Callout tone>`, `<MockBadge>`. Ни один не использует `innerHTML`; статус — всегда текстом, не только цветом (WCAG 1.4.1).
- **Mock-хелперы** (`mock.ts`): `MOCK`, `todoLogic(what)` (кидать из стабов → `grep TODO_LOGIC` даёт бэклог), `mockAsync(value, ms)`, `MOCK_NOTICE`, и `<MockBadge>` — видимый баннер «демо-данные». Так замокан­ное никогда не путается с рабочим (баг фейковой «48 907» из `PLAN.md` §18a — ровно то, что это предотвращает).
