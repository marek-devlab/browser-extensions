import type { Template } from './types';

// Bug-report templates (design §2.9). Built-in bodies are plain Markdown — they
// are inserted into the draft and from then on they are just text the user owns.
//
// ⚠️ No screenshot placeholder that pretends we can attach an image: Markdown
// only REFERENCES images, the platform uploads them (design §4.1 step 5). The
// template says so out loud instead of quietly implying otherwise.

const BUG_REPORT = `## Что произошло

## Шаги воспроизведения
1.
2.
3.

## Ожидалось

## Получилось

- [ ] Воспроизводится стабильно
- [ ] Есть логи

<!-- Скриншот: перетащите его в поле площадки после вставки — Markdown только ссылается на картинки -->

<details>
<summary>Окружение</summary>

<!-- Кнопка «⧉ Окружение» на панели вставит сюда таблицу -->

</details>
`;

const BUG_SHORT = `## Что произошло

## Ожидалось

## Получилось
`;

const FEATURE = `## Проблема

## Предложение

## Альтернативы
`;

const MERGE_REQUEST = `## Summary

## Changes

-

## Checklist
- [ ] Тесты
- [ ] Документация
`;

const POSTMORTEM = `## Impact

## Timeline

## Root cause

## Action items
- [ ]
`;

export const BUILTIN_TEMPLATES: Template[] = [
  { id: 'bug', name: 'Баг-репорт (шаги / ожидалось / получилось)', body: BUG_REPORT, builtin: true },
  { id: 'bug-short', name: 'Баг-репорт краткий', body: BUG_SHORT, builtin: true },
  { id: 'feature', name: 'Feature request', body: FEATURE, builtin: true },
  { id: 'mr', name: 'Merge request description', body: MERGE_REQUEST, builtin: true },
  { id: 'postmortem', name: 'Post-mortem', body: POSTMORTEM, builtin: true },
];
