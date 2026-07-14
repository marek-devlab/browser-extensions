# Markdown Workbench (`@blur/compose`)

> Write and format text before pasting — a Markdown composer for bug reports,
> GitLab and GitHub. Emoji, checkboxes, `<details>`, tables; in-editor find &
> replace, Cyrillic→Latin transliteration and a character counter. **100% local,
> zero network, zero telemetry.**

Extension #10 of the family (PLAN-2.md §6, §10.6). Built on WXT 0.20 + React 19 +
TypeScript, MV3 (Chrome) / MV2 (Firefox). Shares the design system in
[`@blur/ui`](../../packages/ui). Design doc:
[`docs/design/compose.md`](../../docs/design/compose.md).

## Status: UI-complete scaffold

Every surface, all navigation and settings persistence are real; the domain
**logic** runs on mocks (marked with a loud "demo data" badge and greppable
`todoLogic('compose: …')` stubs). See [`IMPLEMENTATION.md`](./IMPLEMENTATION.md)
for the real-vs-mocked breakdown, the TODO_LOGIC backlog, and the **#1 build-time
risk** (the `side_panel` / `sidebar_action` dual declaration).

## Surfaces

- **Side panel** (primary) — write a bug report while looking at the page.
  Chrome `side_panel`, Firefox `sidebar_action`. Not a popup.
- **Workbench** — the same editor full-page, for long documents and a wide split.
- **Options** — theme, default target platform, transliteration standard, editor
  settings, limits, regex timeout.
- **Context menu** — one item, "Add selection to draft" (+ "…as quote").
- **Toolbar action** — opens the side panel.

The regex find & replace, transliterator and counter are **tabs of the one
editor**, not separate tools — they have no icon, popup, command or menu of their
own (single-purpose rule, design §1.1).

## Develop

```bash
npm run dev            # Chrome (MV3)
npm run dev:firefox    # Firefox (MV2)
npm run compile        # tsc --noEmit
```

## Privacy

No network access is even possible: the extension declares no host permissions
and the page CSP is `connect-src 'none'`. Drafts live in `storage.local`; prefs
in `storage.sync`. Cross-device transfer is Export `.md` / Import — never cloud
sync. No analytics, no AI, no remote code (design §7.4, §11).
