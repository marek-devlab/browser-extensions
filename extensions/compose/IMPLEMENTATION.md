# Markdown Workbench — implementation notes

Extension #10 (`@blur/compose`), scaffold phase (PLAN.md §15 "Фаза 0 — фундамент").
UI-complete: every surface, navigation and settings persistence is real; domain
logic runs on mocks. Design source: [`docs/design/compose.md`](../../docs/design/compose.md).

---

## 🔴 #1 THING TO VERIFY ON FIRST BUILD — `side_panel` vs `sidebar_action`

**Open question (design §12, PLAN-2 §11): does WXT emit BOTH manifest keys from
the single `entrypoints/sidepanel/` entry, or does it generate one itself and
CONFLICT with the manual keys in `wxt.config.ts`?**

- WXT has first-class "sidepanel" support and may already auto-generate
  `side_panel` (Chrome) / `sidebar_action` (Firefox) from the `sidepanel`
  entrypoint directory. `wxt.config.ts` ALSO declares them manually
  (`manifest.side_panel` / `manifest.sidebar_action` → `sidepanel.html`).
- On first `wxt build` and `wxt build -b firefox`, **inspect the generated
  `.output/*/manifest.json`**:
  - Chrome: exactly one `side_panel.default_path: "sidepanel.html"`, and
    `sidePanel` in `permissions`.
  - Firefox: exactly one `sidebar_action.default_panel: "sidepanel.html"`, and
    NO `side_panel` / `sidePanel` leaking in.
- If WXT double-declares or errors, **remove the manual keys** from
  `wxt.config.ts` and rely on WXT's generation (or vice-versa). Do this BEFORE
  building any more UI (design §12).
- If WXT does NOT bridge the two at all, fall back to two thin HTML shells over
  the one React app (`WorkbenchApp surface="panel"`).

Related unknowns to check while you're there: clipboard `write()` with `text/html`
in the Firefox sidebar (design §12); `sidePanel.open()` / `sidebarAction.open()`
from the context-menu gesture.

---

## Surface map

| # | Surface | Path | Real | Mocked |
|---|---------|------|------|--------|
| **S1** | Side panel (primary) | `entrypoints/sidepanel/` → `components/Workbench` | layout, tabs↔split, toolbar insert, draft persist, theme, counter | preview render, conversion, regex, translit |
| **S2** | Full-page Workbench | `entrypoints/workbench/` → same `Workbench` | same component, wide split view | same |
| **S3** | Options | `entrypoints/options/` | all prefs persist to `sync:settings` | export/import/clear buttons |
| **S4** | Context menu | `entrypoints/background.ts` | one item + "…as quote"; appends to active draft under lock; opens panel | rich selection read (uses `info.selectionText`) |
| **S5** | Toolbar action | `entrypoints/background.ts` | opens side panel (Chrome `setPanelBehavior`), NOT a popup | — |

S1 and S2 are **one** component (`components/Workbench.tsx`); a `ResizeObserver`
picks tabs (<560px) vs split, mirroring the `@container` CSS (design §1.2, §5.8).

## Real vs mocked

**Real now**
- All three layouts; header (draft select, target switch, save status, theme).
- Toolbar buttons + keyboard shortcuts → `utils/editor-actions.ts` (pure string
  insertion into the draft: bold/italic/code/list/task/`<details>`/table/link/emoji).
- Tab navigation for the regex / translit / stats drawer (roving tabindex, arrows).
- Target-platform switcher UI.
- Draft persistence to `local:drafts` (debounced, Web-Lock-serialized) + honest
  save status (`saving`→`saved` only after `setValue` resolves).
- Prefs persistence to `sync:settings`; theme via `@blur/ui`.
- **The character counter** (`utils/counter.ts`) — `Intl.Segmenter` graphemes +
  words, `TextEncoder` bytes, UTF-16, lines, paragraphs. **Not mocked** (design
  §10.1); it is small and correct, so it ships real. Falls back to code-point
  counting flagged `approximate` if `Intl.Segmenter` is absent.
- States: empty draft, regex ok/invalid/timeout (toggle in the drawer),
  sanitizer-stripped banner (PreviewPane), narrow vs wide.
- Security shape: `PreviewPane` attaches a fragment via `replaceChildren` only;
  no `innerHTML`/`dangerouslySetInnerHTML` anywhere in the tree.

**Mocked / stubbed** (each throws `todoLogic('compose: …')` from `@blur/ui`, or
returns a `mockAsync`/static value behind a `<MockBadge>`)
- Markdown → HTML render (`utils/markdown.ts` `renderPreview`).
- The DOMPurify sanitizer pipeline (`utils/sanitize.ts` `sanitizeToFragment`) —
  the scaffold renders a static safe fragment (`mockPreviewFragment`).
- Platform conversion on copy (`utils/convert.ts` `convert`).
- Regex worker engine (`utils/regex.worker.ts` + `utils/regex-client.ts`).
- Five transliteration tables + slug (`utils/translit.ts` `transliterate`).
- Rich page-selection read in the context menu (uses `info.selectionText`).

## TODO_LOGIC inventory (`grep -rn "todoLogic\|TODO_LOGIC" extensions/compose`)

| Location | What to wire | Library |
|----------|--------------|---------|
| `utils/sanitize.ts` `sanitizeToFragment` | DOMPurify `RETURN_DOM_FRAGMENT` + allow-list + hooks (force `<input disabled>`, `<a rel=noopener>`, collect `removed[]`) | `dompurify` |
| `utils/markdown.ts` `renderPreview` | markdown-it `{ html:true, linkify:false, typographer:false }` → sanitize | `markdown-it` |
| `utils/convert.ts` `convert` | 6 target converters + escaping, from markdown-it tokens | `markdown-it` |
| `utils/translit.ts` `transliterate` | 5 standards + contextual rules + slug post-process | own tables |
| `utils/regex.worker.ts` | compile `RegExp` in worker, validate, match with cap | — |
| `utils/regex-client.ts` `runRegex` | Worker lifecycle: id-gate, timeout, terminate+respawn | — |
| `components/PreviewPane.tsx` | render preview in a **closed Shadow DOM** (clickjacking defence, §7.2) | — |
| `components/EditorPane.tsx` | list-indent on Tab only when caret is in a list; own undo stack | — |
| `entrypoints/background.ts` | rich selection read via `scripting.executeScript` on gesture | — |
| `entrypoints/options/App.tsx` | export `.md`/`.json` via `<a download>`, import, two-step clear | — |
| `utils/counter.ts` | (none — real) | — |

## Libraries to wire (declared as deps, imported only where stubbed)

- `markdown-it` (MIT) — preview render + converter token stream.
- `dompurify` (+ `@types/dompurify`, MPL-2.0/Apache-2.0) — the sanitizer, held
  behind the single `sanitizeToFragment()` so a future native `Element.setHTML()`
  swaps one function (design §7.2).
- `emojibase-data` (MIT / CC-BY-4.0 data) — emoji set, loaded **lazily** in a
  separate chunk, never the main bundle (design §10.2). Add the CC-BY line to
  `THIRD-PARTY-NOTICES.md` when wired.
- Transliteration + slug: **own tables**, no library (design §10.2).

## Storage (design §1.4)

- `local:` — `drafts`, `activeDraftId`, `history`, `templates`. ⚠️ **Drafts are
  `local:`, NEVER `sync:`** — the 8 KB per-item sync cap shreds a long bug report
  (`utils/storage.ts` header; the exact `blur`/PLAN §18a bug).
- `sync:` — `settings` (theme, default target, translit standard, editor prefs).
- `session:` — `unsaved` buffer (survives SW death, not restart).
- All draft RMWs go through `withDraftsLock` (Web Locks), shared by the panel and
  the background context-menu writer.

## Permissions & security

- `permissions`: `storage`, `contextMenus`, `clipboardWrite`, `activeTab`
  (+ `sidePanel` on Chrome only). Zero install warnings, zero host permissions,
  zero network (page-extension CSP `connect-src 'none'`) — design §7.4.
- Preview is the security boundary; the only string→DOM point is
  `sanitizeToFragment` → `replaceChildren`. An ESLint ban on
  `innerHTML`/`dangerouslySetInnerHTML` should be added at the repo level.

## Icons

Not generated (task constraint). `public/icon/.gitkeep` holds a TODO to extend
`scripts/gen-icons.mjs`. `action.default_icon` / top-level `icons` will 404 until
then.

## Design-section map

§1.1 single purpose → `wxt.config.ts`, `background.ts` (one menu item) · §1.2
S1/S2 one component → `Workbench.tsx` + `ResizeObserver` · §1.4 data model →
`utils/types.ts`, `utils/storage.ts` · §2.3 toolbar → `Toolbar.tsx`,
`editor-actions.ts` · §2.4 emoji popover → `EmojiPicker.tsx` · §2.5–2.7 drawer →
`ToolDrawer.tsx` · §2.8 counter strip → `CounterStrip.tsx` · §2.11/§3 options →
`options/App.tsx` · §5.1 empty, §5.3/5.4 regex states, §5.8 narrow/wide →
`Workbench.tsx`/`ToolDrawer.tsx` · §7 security → `sanitize.ts`, `PreviewPane.tsx`
· §8.1 worker → `regex.worker.ts`/`regex-client.ts` · §10.1 counter → `counter.ts`.
