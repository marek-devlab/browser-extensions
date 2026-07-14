# Page Content Exporter

Save page content to a file — selected text as **.md/.txt**, an HTML **table** as
**.csv/.xlsx**, and copy or open **image** URLs. Everything is built locally in
your browser; **nothing is ever sent anywhere.**

> **Status: UI-complete scaffold.** Every surface, navigation path, and the
> settings persistence are real. The domain logic (DOM table extraction, CSV/xlsx
> byte generation, the download ladder) is stubbed on realistic mock data and
> marked with `TODO_LOGIC`. See [`IMPLEMENTATION.md`](./IMPLEMENTATION.md).

## Single purpose

One phrase: **"Save page content to a file."** (`docs/design/export.md`, PLAN-2 §3.)

## Permissions — the honest version

```
permissions:          ['contextMenus', 'activeTab', 'scripting', 'storage', 'clipboardWrite']
optional_permissions: ['downloads']            // requested only if you opt in
host_permissions:     []                        // none
content_scripts:      []                        // none — nothing runs until you ask
```

🥇 **The product's core asset is zero install warnings.** None of the baseline
permissions triggers the "read and change your data on all websites" line:

- There is **no persistent content script** and **no host permission**. The page is
  only ever touched **on a gesture** — a right-click menu item or the toolbar — by
  injecting `engine.js` with `scripting.executeScript` under an `activeTab` grant
  (`docs/design/export.md` §0).
- `scripting` is justified by that on-demand injection (picker overlay + table/
  selection reader), **not** a standing content script.
- A consequence, designed for rather than fought: Chrome cannot tell the extension
  which element you right-clicked, so **"Export table…" is a "pick a table" mode**,
  not "export this exact one" (§0/§1.2).
- `downloads` is **optional** — requested from the options page only if you opt in
  to saving cross-origin images (§5.9/§7.3). Without it the baseline install stays
  warning-free.

🔴 The listing never uses "download"/"downloader"/"save video"; there is no video
handling at all (PLAN-2 §10.2, §4.1). We "save" and "open".

## Run it

From the repo root:

```bash
npm run dev:export            # Chrome
npm run dev:export:firefox    # Firefox
npm run build:export          # production build (add the script if missing)
```

## Surfaces

- **Context menu** — 🥇 the primary surface. Selection → .md/.txt / copy-as-MD;
  image → copy URL / open in a new tab / save; page → export table(s). Registered
  for real in `entrypoints/background.ts` (the exact tree from design §2.1).
- **Popup** — the page **inventory**: "3 tables, 48 images, 1 240-char selection".
  Scanned fresh on open (no badge — that would need a content script). Mock data.
- **Preview dialog** — the core screen (`utils/preview-dialog.tsx`): format,
  filename, CSV delimiter/encoding/EOL, headers, column include/type, the **raw
  bytes** tab, and the **formula-guard** highlight, all on a mock table. Viewable
  at the `preview.html` page; in production engine.js mounts it on the page.
- **Picker overlay** — an injectable, **keyboard-operable** table picker in a
  closed shadow root (`entrypoints/engine.ts`): Tab / 1–9 / ↑↓ / Enter / Esc,
  aria-live, focus-visible double ring, zero innerHTML.
- **Options** — persisted defaults (`entrypoints/options`).

## What is real vs. mocked

**Real now:** the context-menu tree + routing, popup inventory layout, the preview
dialog (all controls, the raw-bytes CSV, the formula-guard highlight), the keyboard
picker overlay, options persistence, theme, all UI states, plus two genuinely
implemented pieces of logic:

- **CSV-injection guard + RFC-4180 escaping + BOM** — `utils/csv-guard.ts`.
- **Filename sanitizer** (bidi/RTL, control chars, path traversal, reserved
  Windows names, clamp, translit) — `utils/filename.ts`.

**Mocked/stubbed:** DOM table extraction, CSV/xlsx byte writing, the cross-origin
download ladder, the real page scan. All throw or return `TODO_LOGIC`.

## Structure

```
entrypoints/
  background.ts      # context-menu tree (REAL) + routing + on-demand injection (stub)
  engine.ts          # injected on gesture: keyboard picker overlay (REAL UI) + scan (stub)
  xlsx.ts            # second injection, only for .xlsx: write-excel-file writer (stub)
  popup/             # page inventory (mock data)
  options/           # persisted defaults (REAL persistence)
  preview/           # the export preview dialog page (core screen, mock table)
utils/
  types.ts           # shared data types
  storage.ts         # sync:prefs (versioned)
  theme.ts           # wires @blur/ui theme controller to prefs
  csv-guard.ts       # 🔴 REAL: formula guard + RFC-4180 + BOM
  filename.ts        # 🔴 REAL: filename sanitizer + template
  table-extract.ts   # STUB: scan + matrix build
  file-writer.ts     # STUB: Blob + <a download> ladder
  mock-data.ts       # fabricated inventory + parsed table
  messages.ts        # menu IDs + engine command protocol
  preview-dialog.tsx # the core preview screen (shared component)
```

Uses `@blur/ui` (tokens, theme, primitives, mock helpers) and `@blur/core`
(`collectOpenShadowRoots` for shadow traversal in the real scan). Icons are TODO
(`public/icon/.gitkeep`).
