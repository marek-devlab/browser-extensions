# Markdown Workbench — implementation notes

Extension #10 (`@blur/compose`). **The domain logic is real — the scaffold's mocks
are gone.** Design source: [`docs/design/compose.md`](../../docs/design/compose.md).

Every `todoLogic()` stub, every `<MockBadge>` and `utils/mock.ts` itself have been
deleted. `grep -rn "todoLogic\|MockBadge\|TODO_LOGIC" components entrypoints utils`
returns nothing.

---

## ✅ Resolved: the `side_panel` vs `sidebar_action` open question

The #1 build-time risk (design §12, PLAN.md (Часть II) §11) is **answered on real builds**:

- WXT does **not** auto-generate either key from `entrypoints/sidepanel/`. The
  manual declarations in `wxt.config.ts` are what produce them, and they do not
  conflict or double-declare.
- `npx wxt build` → `side_panel: { default_path: "sidepanel.html" }` + `sidePanel`
  in `permissions`; **no** `sidebar_action`.
- `npx wxt build -b firefox` → `sidebar_action: { default_panel: "sidepanel.html" }`;
  **no** `side_panel`, **no** `sidePanel` permission leak.

### ⚠️ …and the mobile consequence, which is load-bearing

**Firefox for Android has no sidebar** (and Chrome for Android has no extensions
at all). `sidebar_action` is simply not honoured there. So the full-page
**`entrypoints/workbench/` (`workbench.html`) is not a nicety — on mobile it is
the only editor surface that exists**, and both builds emit it.

`utils/surface.ts` picks the surface by **feature detection, never UA sniffing**:

```
openEditor():  sidePanel.open()      → Chrome desktop
               sidebarAction.open()  → Firefox desktop
               tabs.create(workbench.html) → Firefox Android / anything else
```

The toolbar action routes through it (`browser.action ?? browser.browserAction`,
house convention), and the panel has an explicit "⛶ open in tab" button.

## Surface map

| # | Surface | Path | Status |
|---|---------|------|--------|
| **S1** | Side panel / sidebar (primary, desktop) | `entrypoints/sidepanel/` → `components/Workbench` | real |
| **S2** | Full-page Workbench (wide desktop **+ the only mobile surface**) | `entrypoints/workbench/` → same `Workbench` | real |
| **S3** | Options | `entrypoints/options/` | real, incl. export / import / clear |
| **S4** | Context menu | `entrypoints/background.ts` | real — ONE item + "…as quote" |
| **S5** | Toolbar action | `entrypoints/background.ts` | real — opens S1, falls back to S2 |

S1 and S2 are **one** component (`components/Workbench.tsx`); a `ResizeObserver`
picks tabs (<560 px) vs split, mirroring the `@container` CSS (design §1.2, §5.8).

## What is real

- **Preview**: `markdown-it` (`html:true`, `linkify:false`, `typographer:false`)
  → **DOMPurify** allow-list with `RETURN_DOM_FRAGMENT` → `replaceChildren` into a
  **closed Shadow DOM**. GFM task lists are added by a ~30-line core rule (no extra
  dependency). Debounced + `requestIdleCallback`; a slow render (>50 ms) or a huge
  draft (>200 k chars) flips the pane to honest manual-refresh mode.
- **Conversion on output** for 7 targets from the one markdown-it token stream:
  GitHub / GitLab (identity), **Jira** wiki markup, **Slack** mrkdwn, **Telegram**
  MarkdownV2 (full special-character escaping), **HTML**, **Plain**. Nothing is ever
  dropped silently: tables degrade to aligned code blocks, `<details>` expands under
  a bold heading, checkboxes become `(x)` / `• ☑` — and every degradation is listed
  in the `<dialog>` **before** the copy happens. The stored Markdown is never
  rewritten, so switching target back and forth is lossless.
- **Copy as HTML**: one `ClipboardItem` carrying **both** `text/html` and
  `text/plain` (formatted into Google Docs, clean Markdown into a textarea), with a
  `writeText` → `execCommand` → manual-copy-dialog fallback chain.
- **Regex find & replace**: compile *and* match **only inside a Web Worker**, with a
  main-thread timeout → `terminate()` → respawn. Highlighting via the **CSS Custom
  Highlight API** on a mirror `<pre>` behind the textarea. Replacement templates
  (`$1`, `$&`, `$<name>`) are expanded in the worker; "Replace all" is a splice on
  the main thread (no regex) landing as **one** undo step.
- **Transliteration**: five hand-written tables (ICAO/passport, BGN/PCGN, ISO 9,
  GOST 7.79-B, slug) with the contextual rules that off-the-shelf packages get
  wrong (`е`→`ye` after a vowel, `ц`→`c`/`cz`, terminal `й`, `ь`/`ъ`), plus a slug
  post-processor. The per-standard example in the UI is **computed from the real
  tables on the user's own text** — it cannot drift from what the button does.
- **Counter**: `Intl.Segmenter` graphemes/words, `TextEncoder` bytes, UTF-16, code
  points, lines, paragraphs + limit presets (commit 50/72, branch 63, X 280,
  meta 160), each labelled **with its unit**.
- **Emoji picker**: `emojibase-data` loaded **lazily** (`await import()` → its own
  541 kB chunk, never the main bundle), returns **both** the character and the
  `:shortcode:`; the shortcode radio is disabled (with a reason) for Jira/Telegram,
  and the converter swaps leftover shortcodes for characters on copy.
- **Templates + "Insert environment"** (browser / OS / screen / timezone / language,
  optional full UA, and the active tab's URL when `activeTab` has been granted).
- **Drafts**: `local:` only, debounced autosave under a Web Lock, honest save status,
  quota banner, `session:` mirror + recovery banner, snapshot ring buffer with ⚑
  pre-destructive snapshots, history dialog, `.md` / `.json` export, import, clear.

## Deferred (explicitly, not silently)

- Ukrainian / Belarusian transliteration and Latin→Cyrillic layout fixing (design
  says v2; the language `<select>` is disabled with a note).
- Custom user templates (CRUD) — the five built-ins are real and stored in
  `local:templates`; there is no editor for them yet.
- Split-divider drag (`settings.splitRatio` is stored but the divider is fixed 50/50).
- Mermaid, syntax highlighting inside preview code blocks (design §10.2: deliberate).
- Rich page-selection read via `scripting.executeScript` — **see below**.

## Security decisions

1. **One string→DOM point in the codebase**: `utils/sanitize.ts::sanitizeToFragment`.
   `RETURN_DOM_FRAGMENT` + `replaceChildren`. `serializeFragment` walks the
   already-sanitized DOM back to a string for the clipboard — DOM→string, the safe
   direction; it re-checks the allow-list and entity-escapes everything.
2. **Allow-list, not deny-list** (design §7.2), plus `FORBID_TAGS`/`FORBID_ATTR` as
   a second wall. `ALLOWED_URI_REGEXP = /^(?:https?|mailto):/i` — `javascript:`,
   `data:`, `blob:`, `vbscript:` cannot survive. `style` **as an attribute is
   forbidden**: it is the clickjacking primitive (paint a fake "Copy" button over
   the real one). Hooks force `<input>` → disabled checkbox, `<a>` →
   `rel="noopener noreferrer nofollow" target=_blank`, `<img>` → lazy + no-referrer.
3. **Closed Shadow DOM** for the preview: a hostile `class` cannot reach the
   extension's stylesheet, and the preview cannot restyle the panel. Tokens still
   inherit (CSS custom properties cross the boundary), so the theme is free.
4. **`linkify: false`** — auto-linking would turn arbitrary user text into `href`s.
   Links exist only where the user wrote `[t](u)`.
5. **No `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `dangerouslySetInnerHTML`
   / `eval` / `new Function` anywhere.** Verified by grep (zero hits in code; only
   the comments that forbid them). ⚠️ **This repo has no ESLint config at all**, so
   the ban is enforced by construction + review. See "Needs a human" below.
6. **`new RegExp(userInput)` never runs on the main thread** — not even to validate.
   Validation happens in the worker and comes back as a message. The only regexes on
   the main thread are our own literals.
7. **Zero network, mechanically**: `content_security_policy` now ships
   `connect-src 'none'` on both targets. It is not a promise in a README — fetch/XHR/
   WebSocket are impossible from every extension page.
8. **Permissions: `storage`, `contextMenus`, `clipboardWrite`, `activeTab`**
   (+ `sidePanel` on Chrome). Every one is used; nothing else is requested.

### Why the context menu uses `info.selectionText`

Design §4.2 describes a richer selection read via `scripting.executeScript`. That
would require the **`scripting`** permission, which is not in the agreed budget and
carries an install warning. `info.selectionText` already delivers the selection for
a selection-context click, so the extra permission buys a marginally better read at
a permanent cost. **Decision: keep `selectionText`, do not add `scripting`.**

### The clobber race (fixed)

The background appends to the active draft while the panel may hold an unflushed
edit. A plain `setValue(ourList)` would overwrite the appended selection: the Web
Lock serializes the writes but cannot make a stale payload fresh. `useDraft.persist`
now does the read-modify-write **inside** the lock with an append-merge against a
`base` snapshot, so a context-menu append during typing survives.

## Storage (design §1.4)

- `local:` — `settings`, `drafts`, `activeDraftId`, `history`, `templates`,
  `recentEmoji`. ⚠️ **Nothing goes to `sync:`** — the 8 KB per-item cap shreds a long
  bug report and the UI would still say "saved" (the `blur` / PLAN §18a bug).
- `session:` — the `unsaved` buffer (survives SW death and a destroyed panel
  document, not a browser restart).
- All draft RMWs go through `withDraftsLock` (Web Locks), shared with the background.

## Verification performed

- `npm run compile -w @blur/compose` → clean (tsc covers all 39 files).
- `npx wxt build` / `npx wxt build -b firefox` → both clean; manifests verified
  (see above); `workbench.html` emitted in both.
- **XSS suite** (19 payloads through the real pipeline in headless Chromium):
  `<script>`, `onerror`, `onclick`, `javascript:`/`data:` links, `<svg onload>`,
  `<iframe srcdoc>`, `<style>`, `style=` clickjack, `<form>`, `<base>`,
  `<meta refresh>`, bare interactive `<input>` → **0 leaks, `window.__pwned` never
  set**; task lists, `<details>`, tables, `https:`/`mailto:` links survive intact.
- **ReDoS**: `(a+)+$` on 40 `a`s → worker stuck, main-thread timer fired at 530 ms,
  `terminate()` killed it, the page stayed responsive, and the next request ran on a
  fresh worker.
- Converters exercised on a full bug report → GitHub / Jira / Slack / Telegram /
  Plain output inspected by hand; transliteration checked against the five standards
  (`Щербаков, Юлия` → `Shcherbakov, Iuliia` / `Shcherbakov, Yuliya` / `Ŝerbakov, Ûliâ`
  / `Shherbakov, Yuliya` / `shcherbakov-yuliya`).

## Needs a human / cross-cutting

- **ESLint**: the repo has **no** ESLint config (`eslint.config.*` / `.eslintrc*` do
  not exist anywhere). The design mandates a mechanical ban on `innerHTML` &
  friends. Someone should add a root config with
  `no-restricted-properties` / `react/no-danger` / `no-eval` / `no-implied-eval`, so
  the rule survives the next contributor. Until then: enforced by construction.
- **Design doc typo**: §2.6 shows ГОСТ 7.79-Б as `Shcherbakov`; the standard maps
  `щ` → `shh`, i.e. `Shherbakov` (what we now produce, and what the scaffold's own
  table said). Worth correcting in `docs/design/compose.md`.
- `TODO.md` §L can be ticked (every line except the explicit v2 items).
- The design's "manual clipboard" and history overlay copy is Russian-only, like the
  rest of the family. No i18n layer exists yet in any extension.
