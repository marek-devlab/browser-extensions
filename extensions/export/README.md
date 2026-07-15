# Page Content Exporter

Save page content to a file — selected text as **.md/.txt**, an HTML **table** as
**.csv/.xlsx**, and copy or open **image** URLs. Everything is built locally in
your browser; **nothing is ever sent anywhere.**

> **Status: implemented.** Table extraction, CSV/xlsx/Markdown writing, the
> cross-origin download ladder and the CSV-injection guard are all real. No mock
> data anywhere. See [`IMPLEMENTATION.md`](./IMPLEMENTATION.md).

## Single purpose

One phrase: **"Save page content to a file."** (`docs/design/export.md`, PLAN.md (Часть II) §3.)

## Permissions — the honest version

```
permissions:          ['contextMenus', 'activeTab', 'scripting', 'storage', 'clipboardWrite']
optional_permissions: ['downloads']            // requested only if you opt in
host_permissions:     []                        // none
content_scripts:      []                        // none — nothing runs until you ask
web_accessible_res.:  []                        // none — nothing to fingerprint
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
handling at all (PLAN.md (Часть II) §10.2, §4.1). We "save" and "open".

## Run it

From the repo root:

```bash
npm run dev:export            # Chrome
npm run dev:export:firefox    # Firefox
npm run build:export          # production build (add the script if missing)
```

## Surfaces

- **Context menu** — 🥇 the primary surface on desktop. Selection → .md/.txt /
  copy-as-MD; image → copy URL / open in a new tab / save; page → export table(s).
- **Popup** — the page **inventory**: "3 tables, 48 images, 1 240-char selection",
  scanned fresh on open (no badge — that would need a content script). It is also
  the **complete mobile UI** (see below).
- **Picker overlay** — injected on a gesture into a **closed shadow root**. Every
  table (or image) is ringed and numbered at once — the candidate set is finite and
  known, so there is no hunt-with-the-mouse. Tab / 1–9 / ↑↓ / Enter / Esc, roving
  tabindex, `aria-live`, double contrast ring, zero innerHTML.
- **Export dialog** — the core screen, mounted **on the page** (that is where the
  bytes are born): format, filename, CSV delimiter/encoding/EOL, header toggle,
  column include/type, the **raw-bytes tab** and the **formula-guard** count.
  *The preview is the specification*: what it shows is byte-for-byte what is written.
- **`save.html`** — the escape hatch when a site's CSP forbids downloads: the bytes
  are rebuilt into a Blob on **our** origin, under **our** CSP.
- **Options** — persisted defaults, plus the revocable `downloads` opt-in.

## Two things worth knowing

**`<a download>` is ignored for cross-origin URLs** — the browser *navigates* there
instead of saving. So saving a remote image walks a ladder: same-origin → anchor;
`downloads` permission (if you opted in) → downloads API; CORS-enabled → fetch → blob
→ anchor; otherwise an **honest refusal** that names the domain and offers to open the
image or enable the permission. We never navigate your page away by accident.

**A CSV cell starting with `= + - @` executes as a formula in Excel** — and the data
comes from an arbitrary web page. By default we prefix it with `'`, **except for valid
numbers** (`-5` stays `-5`). `.xlsx` has no such hole at all — a formula there is a
separate element of the file, and a text cell can never become one. That is why
**.xlsx is the default format**, and the UI says exactly that.

## Mobile

Firefox for Android has **no `contextMenus` and no right-click** (Chrome for Android
has no extensions at all). Everything the menu can do is therefore also in the popup —
including picking an image on the page for the three image actions. Feature-detected,
never UA-sniffed. Touch targets ≥44 px, responsive to 360 px, no hover-only affordance.

## Structure

```
entrypoints/
  background.ts      # context-menu tree + routing + injection + privileged services
  engine.ts          # injected on gesture: scan, selection, picker, dialog, toasts
  xlsx.ts            # second injection, ONLY for .xlsx: write-excel-file → Blob
  popup/             # page inventory + the complete mobile UI
  options/           # persisted defaults, downloads opt-in
  save/              # save.html — the CSP-blocked fallback route
utils/
  types.ts           # shared data types + the named size limits
  storage.ts         # sync:prefs (versioned, migrated)
  theme.ts           # wires @blur/ui theme controller to prefs
  csv-guard.ts       # 🔴 formula guard + RFC-4180 + BOM
  filename.ts        # 🔴 filename sanitizer (bidi/RTL, traversal, CON/PRN, clamp)
  file-writer.ts     # 🔴 Blob + <a download> ladder + blob-URL lifecycle + clipboard
  table-extract.ts   # scan, data-vs-layout scoring, colspan/rowspan grid matrix
  selection-md.ts    # DocumentFragment → Markdown/TXT (zero innerHTML, no turndown)
  overlay.ts         # closed shadow root, toast, rings, focus trap, styles
  picker.ts          # the generic on-page picker (tables and images)
  export-dialog.ts   # the core screen
  xlsx-bridge.ts     # engine.js ⇄ xlsx.js contract + Excel sheet-name rules
  inject.ts          # popup/background → page injection (with an MV2 fallback)
  messages.ts        # menu IDs + the engine/background protocols
```

Uses `@blur/ui` (tokens, theme, primitives) and `@blur/core` (`deepQuerySelectorAll`
for open shadow roots, `yieldToMain` for chunked extraction). Icons are TODO
(`public/icon/.gitkeep`).
