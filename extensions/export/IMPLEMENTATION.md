# Page Content Exporter — implementation notes

Extension #7 (`docs/design/export.md`, PLAN-2 §3 / §10.2, TODO §G).
**Status: the logic is real.** No mock data, no `TODO_LOGIC`, no `<MockBadge>`
anywhere — `grep -r "TODO_LOGIC\|MOCK" utils entrypoints` returns nothing.

## Surface map

| Surface | File | Notes |
|---|---|---|
| Context-menu tree | `entrypoints/background.ts` | Exact tree from design §2.1 (one root + per-context children). ⚠️ Feature-detected: absent on Firefox for Android. |
| Menu → routing | `entrypoints/background.ts` | Injects `engine.js` under the `activeTab` grant, then `tabs.sendMessage`s the command. `frameId` honoured for same-origin iframes (§4.1). |
| Privileged services | `entrypoints/background.ts` `serve()` | The engine has no `tabs`/`downloads`/`permissions`/`scripting` — it asks the background for all four. |
| Injected engine | `entrypoints/engine.ts` | Scan, selection read, picker, dialog, toasts, image actions. Idempotent (§9.5). |
| Second-stage xlsx | `entrypoints/xlsx.ts` | `write-excel-file` → typed-cell `Blob`. Injected **only** when `.xlsx` is chosen. |
| Picker overlay | `utils/picker.ts` | Generic: tables **and** images. Closed shadow root, keyboard-first, zero innerHTML. |
| Export dialog | `utils/export-dialog.ts` | The core screen (§2.3), mounted **on the page** — that is where the bytes are born. |
| Popup inventory | `entrypoints/popup/` | Live scan on open. **Also the complete mobile UI** (see below). |
| `save.html` | `entrypoints/save/` | The §5.5 escape hatch: rebuild the Blob on **our** origin when the site's CSP forbids downloads. |
| Options | `entrypoints/options/` | Every control persists; `downloads` opt-in/opt-out via `permissions.request`/`remove`. |

## 🔴 Blocker 1 — `<a download>` is ignored cross-origin

`utils/file-writer.ts`. `<a download>` **silently drops the `download` attribute for
cross-origin `href`s** and the browser *navigates* there instead of saving. A naive
implementation therefore throws the user's page away and writes no file.

The ladder (`saveImage`), in order:

1. **same-origin** (or `data:`) → `<a download>` is honoured → done.
2. **`downloads` permission already granted** (optional, opt-in) → `downloads.download()`
   from the background — the only API that can save a cross-origin URL outright.
3. **cross-origin with CORS** → `fetch(url, {mode:'cors', credentials:'omit'})` → `Blob`
   → `blob:` URL (which **is** same-origin with the page, so the attribute is honoured
   again) → `<a download>`. **This is the only network request the extension can make**,
   and it fetches exactly the asset the user asked for.
4. **otherwise** → 🔴 **honest refusal.** We do *not* click the anchor. The toast names
   the domain, explains that the attribute is ignored and that clicking would have
   navigated instead of saved, and offers *[Открыть картинку]* / *[Включить разрешение…]*.

Bytes **we** generate (csv/md/txt/xlsx) are always `blob:` URLs of the page's own
origin, so they always take rung 1. Only remote images can reach rung 4.

**Blob-URL lifecycle** (§9.4): every URL goes into a `Set`; revoked at **60 s** *and* on
`pagehide`. 🔴 Never right after `.click()` — Firefox has not started the download yet and
would cancel it silently.

## 🔴 Blocker 2 — CSV injection

`utils/csv-guard.ts`. A cell whose first non-space char is `=` `+` `-` `@` `TAB` `CR` is
executed as a **formula** by Excel/LibreOffice/Sheets — and the source is an arbitrary web
page, i.e. untrusted by definition.

- Default `csvFormulaGuard = 'escape'` → prefix `'`.
- 🔴 **Except valid numbers.** `isPlainNumber` clears `-5`, `+3.14`, `-1 234,56`,
  `−0,22` (U+2212). Escaping those is *the* bug in other implementations: every negative
  rate in an accounting table becomes `'-5`.
- Modes `keep` (data untouched) and `warn` (blocks Save until acknowledged) exist, and the
  dialog shows the exact count plus the **raw-bytes tab** where `'=2+2` is visible.
- ✅ **`.xlsx` is structurally immune** — in OOXML a formula is an `<f>` element and we
  only ever emit typed string/number cells. That, not "richer format", is why `.xlsx` is
  the recommended default, and the dialog and options say so in those words.

## Mobile (Firefox for Android)

⚠️ On Android, `browser.contextMenus` **does not exist** and there is no right-click at
all (and Chrome for Android has no extensions). So:

- `background.ts` **feature-detects** `browser.contextMenus?.create` — never a UA sniff —
  and simply registers no menus when it is absent.
- **Every** context-menu capability is also in the popup: export selection to `.md`/`.txt`,
  copy as Markdown, open a table's dialog, "выбрать на странице", "все таблицы", and
  **"выбрать картинку на странице"** (`pickImage`) → the same three image actions
  (copy URL / open / save) that the image context menu offers. No dead feature.
- Popup width is `min(360px, 100vw)`; every control is ≥44 px; hover is never the only
  affordance (`:focus-visible` carries the same styling); the on-page overlay is
  responsive to 360 px.
- The download ladder degrades identically on Android — rung 4's refusal is the same
  honest toast.

## Table semantics (design §6)

- **Grid matrix** with anchor + shadow cells for `colspan`/`rowspan`; runaway spans clamped
  (`MAX_SPAN`/`MAX_COLS`) so `colspan="9999"` cannot birth 10 000 columns.
- **Headers**: `<thead>` → all-`<th>` first row → `th[scope=col]` → else none (and then the
  dialog's "первая строка — заголовки" toggle defaults to **off**, so a data row is never
  eaten). Multi-level headers join with ` / `; empties become `Колонка N`; dupes get ` (2)`.
- **Nested tables**: flattened to `a / b · c · d` and *flagged* (`⊞`). 🔴 Never expanded
  into extra parent rows.
- **Numbers**: conservative. `1,234` is ambiguous → stays **text**. Percent/currency stay
  text. `parseDates` is off by default because `05.06` is unresolvable.
- **Cells**: `<br>`→`\n`, `<img>`→`alt`, checkbox→`да`/`нет`, `<select>`→ chosen option,
  `<button>`/`<svg>`→ empty, hidden sr-only text skipped. `textContent` + normalization,
  never `innerText` (which forces a reflow per cell).
- **Size guards**: >50 k cells → chunked + warned; >200 k → `.xlsx` refused with CSV
  offered; >1 048 576 rows → refused (Excel's own limit, and we say so).

## Security posture

- 🔴 **Zero `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`eval`** in our source
  (`grep` confirms only comments match). The on-page UI is `createElement` +
  `textContent`; React auto-escapes; the manual-copy dialog uses `textarea.value`.
- 🔴 **No `turndown`** — its `RootNode` does `div.innerHTML = input` and the AMO linter
  flags bytes, not code paths. `utils/selection-md.ts` is our own fragment walker.
- **Filenames** (`utils/filename.ts`): bidi/RTL-override stripped (the `отчет‮exe.xslx`
  vector), control chars, path separators, `..` traversal, reserved Windows names incl.
  `CON.csv`, trailing dots/spaces, 80-char clamp. The **extension always comes from the
  format**, never from user input — enforced again in `file-writer.safeFilename`.
- **URL schemes**: `isSafeAssetUrl` / `isSafeTabUrl` allow only `http(s):` and
  `data:image/`. `javascript:` and `file:` are refused in the engine *and* re-checked in
  the background before `tabs.create`.
- 🔴 **No `web_accessible_resources`.** `executeScript({files})` does not need it, and
  declaring `engine.js` as WAR would let any page fingerprint the user as an installee.
- `storage.session` stash for the §5.5 route is **deleted on read**.
- No analytics, no telemetry, no remote code, no `externally_connectable`.

## Permissions — every one is used

```
permissions:          contextMenus  activeTab  scripting  storage  clipboardWrite
optional_permissions: downloads          (requested from options, revocable)
host_permissions:     —   content_scripts: —   web_accessible_resources: —
```

`contextMenus` = the primary desktop surface. `activeTab` = the gesture grant.
`scripting` = the on-demand injection of `engine.js`/`xlsx.js`. `storage` = prefs + the
§5.5 session stash. `clipboardWrite` = the `execCommand` fallback (a menu click gives the
page **no** transient activation, so `navigator.clipboard.writeText` usually throws).
None produces an install warning.

## Known limits / open questions (unchanged from the design)

- §13.4 — there is **no reliable detector** for "the page's CSP sandbox silently dropped
  the download". We ship **no fake heuristic**: the toast always offers
  "Файл не появился? → Сохранить через вкладку расширения" (`save.html`).
- §13.1 — Firefox's `menus.getTargetElement` precise targeting is **not** attempted; the
  picker is the answer in both browsers.
- §13.5/§13.6 — `write-excel-file` merge support is not promised, and the 200 k-cell xlsx
  threshold is **still unmeasured** (taken with margin). Profile before relying on it.
- `.xlsx` cannot be rebuilt on the `save.html` route (the writer lives in the page); that
  route falls back to `.csv` and **says so**.
- `storage.session` falls back to `storage.local` on engines without it; the key is still
  removed on read.
