import type { Draft, Snapshot, Template } from './types';

// Fabricated content so every surface renders "alive" during the scaffold phase.
// Anything built from these is paired with <MockBadge> from @blur/ui so a demo
// screen can never be mistaken for a finished one (the "48 907" fake-number bug,
// PLAN.md §18a). Real drafts created by the user replace these on first edit.

export const MOCK_BODY = `## Что произошло

Аватарки не грузятся на /profile.

- [x] Воспроизвёл в Firefox 141
- [ ] Воспроизвёл в Chrome

<details>
<summary>Логи консоли</summary>

\`\`\`
GET /avatars/12.png 404
\`\`\`

</details>
`;

export const MOCK_DRAFTS: Draft[] = [
  {
    id: 'mock-1',
    title: 'Баг: не грузятся аватарки',
    body: MOCK_BODY,
    target: 'gitlab',
    createdAt: Date.now() - 1000 * 60 * 8,
    updatedAt: Date.now() - 1000 * 60 * 2,
  },
  {
    id: 'mock-2',
    title: 'MR: рефакторинг',
    body: '## Summary\n\nExtract the parser into `@blur/core`.\n',
    target: 'github',
    createdAt: Date.now() - 1000 * 60 * 60 * 3,
    updatedAt: Date.now() - 1000 * 60 * 60 * 3,
  },
  {
    id: 'mock-3',
    title: 'Заметки',
    body: 'todo: спросить у Юлии про slug для веток\n',
    target: 'plain',
    createdAt: Date.now() - 1000 * 60 * 60 * 26,
    updatedAt: Date.now() - 1000 * 60 * 60 * 26,
  },
];

export const MOCK_SNAPSHOTS: Snapshot[] = [
  { id: 's0', draftId: 'mock-1', body: MOCK_BODY, createdAt: Date.now(), reason: 'autosave' },
  { id: 's1', draftId: 'mock-1', body: MOCK_BODY.slice(0, 240), createdAt: Date.now() - 1000 * 60 * 12, reason: 'autosave' },
  { id: 's2', draftId: 'mock-1', body: MOCK_BODY.slice(0, 140), createdAt: Date.now() - 1000 * 60 * 27, reason: 'pre-destructive', label: 'до «Заменить всё»' },
  { id: 's3', draftId: 'mock-1', body: '', createdAt: Date.now() - 1000 * 60 * 40, reason: 'created' },
];

const BUG_REPORT_BODY = `## Что произошло

## Шаги воспроизведения
1.
2.
3.

## Ожидалось

## Получилось

- [ ] Воспроизводится стабильно
- [ ] Есть логи

<details>
<summary>Окружение</summary>

| | |
|---|---|
| Браузер | ⧉ вставить |
| ОС | ⧉ вставить |
| Экран | ⧉ вставить |
| URL страницы | ⧉ вставить |

</details>
`;

export const BUILTIN_TEMPLATES: Template[] = [
  { id: 'bug', name: 'Баг-репорт (шаги / ожидалось / получилось)', body: BUG_REPORT_BODY, builtin: true },
  { id: 'bug-short', name: 'Баг-репорт краткий', body: '## Что произошло\n\n## Ожидалось\n\n## Получилось\n', builtin: true },
  { id: 'feature', name: 'Feature request', body: '## Проблема\n\n## Предложение\n\n## Альтернативы\n', builtin: true },
  { id: 'mr', name: 'Merge request description', body: '## Summary\n\n## Changes\n\n- \n\n## Checklist\n- [ ] Тесты\n- [ ] Документация\n', builtin: true },
  { id: 'postmortem', name: 'Post-mortem', body: '## Impact\n\n## Timeline\n\n## Root cause\n\n## Action items\n- [ ] \n', builtin: true },
];

/** Fabricated regex matches for the Find & Replace preview (design §2.5). */
export const MOCK_REGEX_MATCHES = [
  { line: 3, from: '2026-07-14', to: '14.07.2026' },
  { line: 9, from: '2026-06-01', to: '01.06.2026' },
  { line: 12, from: '2025-12-31', to: '31.12.2025' },
  { line: 15, from: '2024-01-01', to: '01.01.2024' },
];

/** Fabricated recent emoji for the picker (design §2.4). */
export const MOCK_RECENT_EMOJI = ['🚀', '🐛', '✅', '⚠️', '🎉', '👍', '🔥', '📌'];
