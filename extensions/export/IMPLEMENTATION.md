# Page Content Exporter — implementation notes (scaffold phase)

UI-complete scaffold of extension #7 (`docs/design/export.md`, PLAN-2 §3 / §10.2).
Surfaces, navigation, and settings persistence are real; domain logic is stubbed on
realistic mock data. This file is the map: surfaces, real-vs-mocked, every
`TODO_LOGIC`, the wiring tasks, and the design-section mapping.

## Surface map

| Surface | File | Real? | Notes |
|---|---|---|---|
| Context-menu tree | `entrypoints/background.ts` | **REAL** | Exact tree from design §2.1 (one root + per-context children). Registered on install/startup. |
| Menu → routing | `entrypoints/background.ts` `handleMenuClick` | **REAL wiring** | "Open image in new tab" (`tabs.create`) and "Settings" (`openOptionsPage`) fully work; the rest calls `injectEngine` (stub payload). |
| Injected picker overlay | `entrypoints/engine.ts` | **REAL UI, stub logic** | Closed shadow root, keyboard-operable, aria-live, focus-visible, zero innerHTML. Renders mock candidates; scan + confirm are `TODO_LOGIC`. |
| Second-stage xlsx | `entrypoints/xlsx.ts` | **STUB** | No-op; documents the second-injection rationale. |
| Popup inventory | `entrypoints/popup/` | **REAL layout, mock data** | Selection / tables / images / iframe + shadow warnings / empty state (demo toggle). |
| Preview dialog | `utils/preview-dialog.tsx` + `entrypoints/preview/` | **REAL UI on mock table** | Format, filename (live sanitizer), CSV knobs, headers, column include/type, raw-bytes tab, formula-guard highlight, merged-cell notice. |
| Options | `entrypoints/options/` | **REAL persistence** | Every control writes `prefsItem`. Tabs: Таблицы / Текст / Имена файлов / О расширении. `downloads` opt-in via `permissions.request`. |
| Theme | `utils/theme.ts` + `@blur/ui` | **REAL** | `useThemeController` + `seedTheme('blur-export:theme')`, flash-free. |
| Storage | `utils/storage.ts` | **REAL** | `sync:prefs`, version 1. |

## Real logic implemented (not stubs)

- **`utils/csv-guard.ts`** — CSV-injection guard (design §8.3): a cell whose
  trimmed first char is `= + - @` / TAB / CR is prefixed with `'`, **except** valid
  numbers (`-5`, `+3.14`, `-1 234,56`) which are never escaped. Plus RFC-4180
  quoting, `sep=` line, EOL, and the mandatory **BOM** (PLAN-2 §3.2). The preview's
  "raw bytes" tab shows the actual output of this module.
- **`utils/filename.ts`** — sanitizer (design §8.2): strips bidi/RTL-override and
  control chars, replaces path separators, collapses `..` traversal, NFC-normalizes,
  optional Cyrillic translit, neutralizes reserved Windows names (incl. `CON.csv`),
  trims trailing dots/spaces, clamps to 80, `export` fallback. Extension is added
  from the FORMAT, never from user input. Demonstrated live in the options
  "Имена файлов" tab and the preview filename.

## Every TODO_LOGIC (the backlog — `grep -r TODO_LOGIC`)

| Location | What it must do | Design |
|---|---|---|
| `utils/table-extract.ts` `scanPageInventory` | Real scan: `deepQuerySelectorAll('table')` (@blur/core) + data-vs-layout scoring + `Intl.Segmenter` selection count | §4.2 / §1.2 |
| `utils/table-extract.ts` `extractTable` | Build the grid **matrix** honouring colspan/rowspan (anchor+shadow, clamp runaway), headers/caption/links/`<br>`/checkboxes, conservative number parse | §6.1–6.7 |
| `utils/table-extract.ts` `extractSelection` | `getSelection().getRangeAt(0).cloneContents()` → `DocumentFragment` → `TreeWalker` → Markdown. 🔴 zero innerHTML; handle truncated nodes | §4.1 / §8.1 |
| `utils/file-writer.ts` `saveTextFile` | Blob + `<a download>` + the cross-origin ladder + revoke (60 s & `pagehide`) | §5.9 / §9.4 |
| `utils/file-writer.ts` `saveXlsxFile` | `write-excel-file` → typed-cell Blob; refuse >200k cells / >1,048,576 rows | §9.1 |
| `utils/file-writer.ts` `copyImageUrl` | `clipboard.writeText` with `execCommand` fallback; `currentSrc` for `srcset` | §4.3 / §5.6 |
| `entrypoints/engine.ts` (candidates) | Replace mock candidate list with the real scan | §4.2 |
| `entrypoints/engine.ts` `confirmPick` | Extract chosen table + mount the preview dialog **on the page** in a closed shadow root | §2.3 |
| `entrypoints/xlsx.ts` | `import('write-excel-file')`, receive grid, produce Blob, size guards | §0 / §9.1 |
| `entrypoints/background.ts` `injectEngine` | Deliver the `EngineCommand` to the injected engine and route its result (toast / preview / picker) | §4 |
| `entrypoints/background.ts` onInstalled | Dedicated one-screen onboarding page (currently opens options) | §1.2 |

## Wiring task — the cross-origin `<a download>` ladder (design §5.9)

`saveTextFile` / image save must try, in order:

1. **same-origin** resource → `<a download>` works → done.
2. **CORS-enabled** resource → `fetch(url)` returns a body with
   `Access-Control-Allow-Origin` → `Blob` → `<a download>` → done.
3. **otherwise** → 🔴 honest refusal. `<a download>` ignores the `download`
   attribute for cross-origin URLs (the browser navigates instead of saving), so
   show: "the browser won't save an image from `cdn…` without the Downloads
   permission — [Open image] or [Enable permission]".

Plus the Blob-URL lifecycle: collect every created URL in a `Set`; revoke via
`setTimeout(60_000)` **and** on `pagehide`; 🔴 never revoke immediately after
`.click()` (Firefox race). If `downloads` is later granted, revoke on
`downloads.onChanged` (`complete`/`interrupted`) instead of the timer.

The CSP-blocked fallback (§5.5) reuses the `preview.html` extension page: stash the
bytes in `storage.session`, open our own page (our origin, our CSP), build the Blob
there. The preview surface already renders on our origin, so it doubles as this
route.

## Libraries to wire

| Package | Why | When it loads |
|---|---|---|
| `write-excel-file` (MIT) | `.xlsx` — typed cells are formula-immune (§8.3) | injected as `xlsx.js`, **only** when `.xlsx` chosen (§0) |
| `fflate` (MIT) | transitive dep of write-excel-file; reused for v2 ZIP | with `write-excel-file` |
| — (no lib) | CSV: hand-rolled RFC-4180 + BOM (`csv-guard.ts`) — **done** | n/a |
| — (no lib) | Markdown: own converter (turndown does `innerHTML` → AMO flag, §8.1) | `TODO_LOGIC` |
| 🔴 SheetJS / exceljs | rejected (left npm / abandoned) — PLAN-2 §3.2 | never |

## Storage & the design §3 discrepancy

`utils/storage.ts` puts the small scalar prefs in **`sync`** (per the build brief:
delimiter, encoding, formula-guard, filename template, default format, theme — all
well under the 8 KB per-item cap) and reserves `local` for anything growable.
Design §3 argues for `local`-only ("sync never") because of growable lists; this
scaffold has **no** growable list and keeps that door explicitly closed in a
comment. Revisit before release if any pref becomes a list (filename history,
per-site defaults).

## House-convention compliance

- 🔴 **Zero `innerHTML`** anywhere: the on-page overlay uses `createElement` +
  `textContent` + `append`; React auto-escapes; page data reaches the UI only as
  text.
- No persistent content script, no host permissions, `downloads` optional (§0).
- `@blur/ui` for tokens/theme/primitives/mock helpers; `<MockBadge/>` on the popup
  and preview; `todoLogic('export: …')` in every stub; `mockAsync` for loading.
- `#imports` / `wxt/browser`; Firefox gecko id `export@blockaly.com` +
  `data_collection_permissions: { required: ['none'] }` + `gecko_android: {}`.
- Icons: `public/icon/.gitkeep` + TODO (no PNGs generated).

## Build order (when logic lands)

1. `types.ts` (done) → 2. `csv-guard.ts` + `filename.ts` (done, real) →
3. `table-extract.ts` scan+matrix → 4. `engine.ts` overlay→preview mount →
5. `file-writer.ts` ladder → 6. `xlsx.ts` writer → 7. background payload delivery →
8. `compile` + `build` (+ firefox), verify write-excel-file is absent from
`engine.js`/popup/background chunks (only in `xlsx.js`).

## Not honored in a scaffold (called out honestly)

- The preview dialog is rendered as an **extension page** (`preview.html`) for
  viewability; production mounts the same component **on the page** in a closed
  shadow root (§2.3). Component is shared, so this is a mounting-point swap.
- The picker overlay renders a **mock** candidate list; live table detection,
  nested-table "вложена в ①" relationships, and cross-origin-frame greying (§2.2/
  §5.7) are `TODO_LOGIC`.
- Menu items beyond "open image"/"settings" wire to a stubbed injection — no file
  is actually produced yet.
- Firefox `menus.getTargetElement` precise targeting (§13 open question) is not
  attempted.
