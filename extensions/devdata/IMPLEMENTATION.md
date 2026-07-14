# Data Format Toolkit — implementation notes (scaffold phase)

This extension ships first as a **UI-complete scaffold** (PLAN.md §15 "Фаза 0"):
all surfaces, navigation, routing, settings persistence, theme and every designed
state are **real**; the domain logic is **stubbed on mock data**. This document is
the real-vs-mocked map and the wiring backlog. Design references are to
`docs/design/devdata.md`.

## Surface map — real vs mocked

| Surface / area | Real now | Mocked / stubbed |
|---|---|---|
| **Popup** (`entrypoints/popup`) | theme persistence, activeTab host read, "looks like JSON" URL heuristic, `scripting` permission fact + request, open tool page | in-page formatting result (`formatActiveTab`), clipboard paste (opens tool instead) |
| **Tool shell** (`tool/App.tsx`) | tablist (`role=tablist`, `aria-controls` on active only), hash router, `1/2/3/4` tab keys, default-tab pref, theme | — |
| **Data tab** (`tool/tabs/DataTab.tsx`) | all five states (empty/loading/ok/error/degraded) via a labelled scaffold state-picker, format chip + override, toolbar controls bound to prefs, tree (roving one-tabstop `role=tree`), text pane, inspector, conversion split view + mandatory warnings panel | parse (`parseDocument`), convert (`convert`), inspect (`inspectValue`), beautify (`reformat`) — all return mock data + carry `TODO_LOGIC` |
| **JWT tab** (`tool/tabs/JwtTab.tsx`) | credential/HS256 framing (final copy), token/secret/key held **only in state**, password-field hardening, RS256↔HS256 frame preview, claims table, verify loading/result states | decode (`decodeJwt`), verify (`verifyJwt`) — mock + `TODO_LOGIC` |
| **Schema tab** (`tool/tabs/SchemaTab.tsx`) | draft select (from prefs), schema input, empty/loading/valid/errors states, support-limits callout | validate (`validateSchema`) — mock + `TODO_LOGIC` |
| **Settings tab** (`tool/tabs/SettingsTab.tsx`) | **real persistence** of every pref to `sync:prefs`; controls disabled until storage read (`ready`); source-access feature-detect disables "exact big numbers"; permission **facts** for both page-formatting rows; consent `<dialog>` → real `permissions.request(<all_urls>)` with honest off-fallback; 2-step "erase document" (real `documentItem.removeValue()`) | auto-format content-script registration (`registerAutoFormat`), licenses list |
| **Background** (`entrypoints/background.ts`) | context-menu create (install + startup), top-level `onClicked`, open-tool | handing `selectionText` to the tool (`TODO_LOGIC`) |
| **Permissions** (`utils/permissions.ts`) | **fully real** — `contains`/`request`/`remove` + live `onAdded/onRemoved` re-read | — |
| **Storage** (`utils/storage.ts`) | **fully real** — `sync:prefs`, `local:document`, `local:schema`, versioned | — |
| **Theme** | **fully real** — `@blur/ui` `seedTheme`/`applyTheme`/`cacheTheme` + `<ThemeToggle>` | — |

## TODO_LOGIC inventory (`grep -r TODO_LOGIC extensions/devdata`)

| Location | What must be implemented | Library / API | Design |
|---|---|---|---|
| `utils/format.ts` `detectFormat` | Format autodetect (BOM→braces→`---`/`:`→`<`→delimiters→3 base64url segments) | — | §4.1 |
| `utils/format.ts` `parseDocument` | Parse in a **Worker**; token offsets for error positions; preserve source number text | `jsonc-parser`, `json5`, `yaml`, `papaparse` | §2.4, §5.4, §5.6 |
| `utils/format.ts` `inspectValue` | Resolve node by JSONPath; return **raw** source text + precision note | JSON.parse source access | §2.4 |
| `utils/format.ts` `reformat` | Re-serialise with indent; sort-keys affects **output only** | — | §3 |
| `utils/format.ts` `convert` | Convert in a Worker with **mandatory** lossy-conversion warnings | `yaml`, `papaparse`, native `DOMParser`/`XMLSerializer` | §2.5, §4.6 |
| `utils/jwt.ts` `decodeJwt` | `atob` + JSON.parse; partial success; `alg:none` red block | own (0 KB) | §4.4 |
| `utils/jwt.ts` `verifyJwt` | Local WebCrypto verify; "invalid ≠ forged"; alg/key mismatch | `jose` (lazy) | §2.7, §4.4 |
| `utils/schema.ts` `validateSchema` | Validate in a Worker, 5s timeout → `terminate()`; explicit external-`$ref` error | `@cfworker/json-schema` (**not ajv**) | §2.8, §4.5 |
| `utils/format-page.ts` `formatActiveTab` | `scripting.executeScript` (Chrome) / `tabs.executeScript` (FF MV2); overlay viewer; keep original text for "✕" restore | `scripting` | §2.12, §4.3 |
| `utils/format-page.ts` `registerAutoFormat` | `registerContentScripts` on `<all_urls>` document_start; unregister on revoke | `scripting` | §8 |
| `utils/prefs.ts` `update` | Serialise writes behind `navigator.locks` (RMW race) | `navigator.locks` | §8 |
| `entrypoints/background.ts` `onClicked` | Hand `selectionText` to the tool (session handoff) | `storage.session` | §1.2 |
| `entrypoints/popup/App.tsx` `pasteAndOpen` | `clipboard.readText()` with focused-empty-editor fallback | Clipboard API | §4.1 |

## Libraries to wire (declared in package.json, all LAZY — design §10.3)

`json5` 2.2.3 · `jsonc-parser` 3.3.1 (offsets, error-tolerant) · `yaml` 2.9.0 (ISC)
· `papaparse` 5.5.4 · `jose` 6.2.3 (WebCrypto, verify only) · `@cfworker/json-schema`
(zero-eval, **not ajv** — MV3 CSP). XML uses native `DOMParser`/`XMLSerializer`
(0 KB); the tree virtualiser and the unsigned JWT decoder are hand-rolled (0 KB).
The initial tool bundle must carry only the JSON path; everything else comes in on
first use via `await import()`.

> These deps are listed but **not imported** anywhere in the scaffold (only
> referenced in `TODO_LOGIC` comments), so the scaffold builds without them
> resolving. Wire each with a lazy `await import()` inside the corresponding stub
> when its logic lands.

## Storage layout (real)

- `sync:prefs` — flat `DevdataPrefs` (~15 boolean/enum fields, ~300 B). Fits the
  8 KB per-item sync cap with huge margin. **One writer** (`utils/prefs.ts`).
- `local:document` — cached parsed document, **≤1 MB** (`MAX_PERSIST_BYTES`);
  larger documents are intentionally not saved and the UI says so.
- `local:schema` — last schema text (≤256 KB), only when "restore" is on.
- **No storage item** for the JWT token / secret / public key — RAM only, by
  design (§7.2). This is an architectural invariant, enforced by the absence of a
  storage item, not a runtime guard.

## Theme wiring — one deviation from the house convention

The convention names `@blur/ui`'s `useThemeController`. We instead fold theme into
the single `usePrefs` hook using `applyTheme` + `cacheTheme` (the exact primitives
`useThemeController` is built from) plus `seedTheme` in each `main.tsx` and the
shared `<ThemeToggle>`. **Why:** `sync:prefs` is one storage item and must have one
writer; a separate theme controller + a settings hook would be two writers racing
read-modify-write on the same item (the RMW hazard the design flags in §8). A
single writer is the honest fix. `useThemeController` remains the right choice for
any surface whose theme lives in its *own* item.

## Icons (deliberately not generated here)

`public/icon/` contains only a `.gitkeep`. Icon PNGs (16/32/48/128) are produced by
`scripts/gen-icons.mjs`, which iterates `Object.keys(BRAND)` in
`scripts/lib/draw.mjs`. **Before the first build, add a `devdata` entry to that
`BRAND` map** and run `npm run icons`; otherwise `action.default_icon` (and the
auto-discovered top-level icons map) will 404. This file cannot cleanly generate
PNGs, and `scripts/` is outside this extension's scope for the scaffold.

## Known scaffold limitations (design decisions a scaffold can't fully honor)

- **Worker parsing / virtualisation / Highlight API** (§2.4, §5.1, §10.1): the
  scaffold renders a fixed mock tree and a flat `<pre>`. The real Worker pipeline,
  50 MB windowed virtualisation and CSS Custom Highlight API colouring are
  `TODO_LOGIC` in `utils/format.ts`. No `<span>`-generated highlighting is used, so
  the "zero innerHTML" invariant is already satisfied.
- **Scaffold state pickers**: the Data tab (state) and JWT tab (algorithm) carry a
  clearly-labelled dashed "демо" switcher so a reviewer can see every designed
  state without real logic. These are scaffold affordances and are removed once
  the real state machine drives them.
- **Popup keyboard command `⌘⇧V`** is shown as a hint only; registering the actual
  `commands` shortcut is deferred with the clipboard wiring.
