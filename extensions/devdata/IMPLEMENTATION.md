# Data Format Toolkit — implementation notes

The domain logic is **real**. There is no mock data, no `MOCK` import, no
`<MockBadge>` and no `TODO_LOGIC` left in this extension
(`grep -rn "TODO_LOGIC\|MockBadge\|from '@blur/ui'.*MOCK" extensions/devdata` → nothing).

Design reference: [`docs/design/devdata.md`](../../docs/design/devdata.md).

## What is real

| Area | Implementation |
|---|---|
| **Format autodetect** | `utils/core/detect.ts` — a **cheap main-thread sniff** (audit B1): BOM → JWT (only the tiny header segment is decoded; located with `indexOf`, never `split`) → `<` → braces (JSONC by a **bounded** comment scan, else strict JSON — **no full `JSON.parse`**) → `---`/`key:` → delimiter sniff. The JSON-vs-JSON5 decision is deferred to the Worker: an autodetected `json` that fails strict parse retries JSONC then JSON5 **off-thread** (`parseText(..., {autodetected})`), and the resolved format flows back in `ParseSuccess.format`. Result: detecting a 55 MB document is ~30 ms with zero full parses (was ~333 ms + a ~1 GB throwaway graph). Valid JSON stays `json`, so exact numbers are preserved. The UI shows "авто" + a one-click override |
| **Parse** | `utils/core/parse.ts`, **in a Worker**. JSON/JSONC via `jsonc-parser` `parseTree` (error-tolerant, token offsets); JSON5 via `json5`; YAML via `yaml` (`maxAliasCount: 100` — billion-laughs guard); CSV via `papaparse` (delimiter autodetect + field-mismatch rows reported) |
| **Exact big numbers** | `12345678901234567890` is shown **as written**. For JSON/JSONC every scalar's `raw` is sliced straight out of the source using `jsonc-parser` offsets, so beautify/minify/inspect all preserve it. For YAML/CSV/JSON5 the parsers return values and the source spelling is *gone* — the inspector says exactly that instead of showing the rounded number as if it were the document (`ParsedDoc.exact`) |
| **`JSON.parse` source access (ES2026)** | Feature-detected in `SettingsTab.hasSourceAccess()` and reported honestly. It is a *second* route to the same truth, not the only one — see "Deviation" below |
| **Tree** | `utils/core/tree.ts` — flat, pre-order, `subtree`-sized array. Every walker is an **explicit-stack loop**; nothing recurses (a 50 MB document nests deeply and a recursive walker is a `RangeError`). Caps: `MAX_NODES` 400 000, `MAX_DEPTH` 512, both surfaced as "дерево построено частично". Cycle guard on the ancestor chain (recursive YAML anchors) |
| **Virtualisation** | Tree and text pane render a ~200-row window (`ROW_H`/`LINE_H` + overscan) over `Int32Array` line offsets, plus `content-visibility: auto`. The document text is never split into a per-line array |
| **Syntax highlighting** | `utils/highlight.ts` + `utils/core/tokenize.ts` — **CSS Custom Highlight API** over ONE flat `<pre>` text node. Only the visible window is tokenised. Zero `<span>`s, zero generated markup, no highlight.js/Prism. Feature-detected; the fallback is *plain text* + a UI note, never a `<span>` fallback. `::highlight()` styles colour only (`font-weight` is not permitted there) |
| **Beautify / minify / sort keys** | `emitJson` in the Worker, emitted **from the tree** so exact numbers survive. Sort-keys affects output only — the tree always shows source order |
| **Convert** | Worker. JSON/JSON5/YAML/XML/CSV, each with a **mandatory** loss report (`ConversionWarning[]`): renamed XML tags (`2fa` → `_2fa`), `null` → empty element, types lost, array-of-one ambiguity, YAML 1.1 `yes`/`no` strings, dropped JSONC comments, nested cells stringified into CSV |
| **CSV refusal** | JSON→CSV on a non-tabular document does **not** emit an empty CSV. It refuses, explains, and offers real JSONPaths of arrays-of-objects found in *this* document, each convertible with one click (`convertSubtree`) |
| **XML** | Native `DOMParser`/`XMLSerializer`, zero KB. Parsed as `application/xml` (never `text/html`), on the **main thread** (Workers have no DOM), capped at 20 MB. A DTD declaring `<!ENTITY>` is **refused** outright (billion-laughs) |
| **JWT** | `utils/jwt.ts` — hand-rolled base64url + `JSON.parse`, synchronous. Partial success is shown partially (valid header + non-JSON payload). `alg: none` → red block. Claims decoded with expiry/nbf/iat status and the "your clock" caveat. Verification: lazy `jose` + WebCrypto, `compactVerify` (signature only, so an expired token still verifies). Private-key paste is detected and rejected with an explanation |
| **JSON Schema** | `@cfworker/json-schema` in the Worker, 5 s budget → `terminate()`. Drafts 2020-12/2019-09/7/4. External `$ref` → **explicit error** ("no network"), never a silent skip. `format:` off ⇒ the keyword is *stripped from the schema* before validating (filtering the errors would still let `format` steer an `anyOf` branch) |
| **Search** | Literal text search over the whole document (`indexOf`, no user regex ever reaches an engine) + JSONPath navigation (`$.users[1].id`). Disabled above 20 MB, and the UI says so, along with "browser Ctrl+F only sees the rendered window" |
| **Page formatting** | `entrypoints/formatter.content.ts` (`registration: 'runtime'` — **not in the manifest**). One-shot via `scripting.executeScript` (Chrome) / `tabs.executeScript` (Firefox MV2) on the activeTab-granted tab; opt-in auto via `registerContentScripts` / `contentScripts.register` at `document_start`. Viewer is built with `createElement` + `textContent`, announces itself, and ✕ restores the *original* text held in a variable |
| **Permissions** | Facts only (`permissions.contains`), re-read on `onAdded`/`onRemoved`. The background keeps the content-script registration in step with permission **and** intent; an external revoke unregisters immediately |
| **Storage** | `sync:prefs` (single writer, serialised behind `navigator.locks` + a tail-chained queue, 4 KB guard); `local:document` ≤1 MB (over that we say so, we don't silently drop); `local:schema` ≤256 KB; quota failures surface as a banner. `session:handoff` for context-menu/clipboard text (memory-only, cleared on read) |
| **Failure handling** | Every parse/convert/validate is a cancellable Worker job. Timeout → `terminate()` + the likely cause. Worker death (OOM) → its own state with a retry. Parse failure → line/column (code points, not UTF-16 units), the failing lines, fix suggestions, and the **partial tree** parsed up to the error |

## Security decisions

- **Zero network.** No `fetch`/XHR/WebSocket/`sendBeacon` anywhere
  (`grep -rn "fetch(\|XMLHttpRequest\|WebSocket\|sendBeacon" entrypoints utils` → nothing).
  No JWKS-by-URL, no external `$ref`, no analytics, no error reporting.
- **Zero `innerHTML`.** No `innerHTML`/`outerHTML`/`insertAdjacentHTML`/
  `document.write`/`eval`/`new Function`/`setTimeout(string)` in our source. Untrusted
  documents render as React children or via `textContent`. Colouring uses `Range`
  objects, so user text is *never* turned into markup — the injection surface does
  not exist by construction, rather than being escaped away.
- **JWT credentials never persist.** The token, the HS256 secret and the public key
  live only in `JwtTab` component state. There is no storage item that could hold
  them; `JwtTab` is unmounted when you leave the tab; a JWT-looking paste on the
  Data tab is *offered* to the JWT tab and never written to `local:document`.
  The secret field is `type=password`, `autocomplete=off`, `spellcheck=false`,
  `data-1p-ignore`, and the reveal button is held, not toggled.
- **XXE / billion-laughs.** XML is parsed as `application/xml` (browsers do not
  resolve external entities), and any DTD that **declares** entities is refused.
  The refusal (`declaresEntities`, audit V1) is a proper DOCTYPE scan that honours
  quoted literals — the previous `<!DOCTYPE[^>]*` regex was bypassable with a `>`
  inside a `SYSTEM "a>b"` literal; the scan now catches that (verified). YAML uses
  `maxAliasCount`. The tree builder guards cycles on the ancestor chain.
- **JWTs never touch storage (audit V2).** The context-menu / clipboard handoff
  runs through `storage.session`, which is extension storage, not tab RAM — so
  `putHandoff` detects a JWT and **refuses to store it**, returning `jwt-skipped`;
  the caller opens the JWT tab and the user pastes it there, where it lives only
  in component state. Only non-credential document text ever transits the handoff.
- **ReDoS / pathological input.** A schema `pattern` is attacker-controlled. It runs
  in a Worker with a 5 s budget and is killed with `terminate()` — the only way to
  stop a spinning regex. Nothing user-supplied is compiled into a regex on the main
  thread.
- **Permissions actually used.** `storage`, `contextMenus`, `activeTab` — all three are
  exercised. `scripting` is optional and only requested when the user clicks "format
  this tab" (permission-only, no host ⇒ no broad-access warning). `<all_urls>` is
  optional-host and only requested behind the consent dialog.
  ⚠️ **`wxt.config.ts` carries a `build:manifestGenerated` hook that strips the
  `host_permissions` WXT hoists out of the content script's `matches`.** Without it
  the built manifest silently asks for `<all_urls>` at install. Review the *built*
  manifest, not the source.

## Deviation from the design, and why

**§5.6 "Точные большие числа" is specified as a toggle that goes disabled when the
browser lacks `JSON.parse` source access.** We feature-detect it and report the
result — but we do not disable anything, because for JSON/JSONC we do not need it:
`jsonc-parser` gives us the token offsets, so the exact source spelling of every
scalar is available in *every* browser. Disabling the feature on a browser where it
demonstrably works would be pessimism dressed up as honesty. What we *do* say, in
the inspector, is the truth we cannot escape: YAML/CSV/JSON5 parsers return values,
so for those formats the original spelling is unrecoverable and the number shown is
the rounded one.

**§12.6 CSV as a table.** CSV is rendered as an array-of-objects tree, not a
dedicated virtualised table. The delimiter, column count and row-length mismatches
are all reported. A real table view is deferred.

## Deferred (not v1)

- Diff tab (design §1.3 — a v2 tab, deliberately absent rather than disabled).
- Side panel (`side_panel` vs `sidebar_action` unresolved, PLAN.md (Часть II) §11).
- Dedicated CSV table view.
- Progress-by-bytes during parse: the Worker parses from a string, so there is no
  honest byte-progress to report and we show none rather than inventing a
  percentage (design §5.1 forbids fabricated progress). Streaming a `File` through
  the Worker to get real byte counts is the v2 way in.
- In-page viewer is a `<details>` tree + raw text; it does not carry the Highlight
  API colouring of the full tool.

## Bundle shape

The tool page's initial chunk carries only React + the UI. The parsers
(`jsonc-parser`/`json5`/`yaml`/`papaparse`/`@cfworker`) live in the **Worker**
bundle, fetched on first parse; `jose` is its own lazy chunk fetched only when
"Проверить подпись" is clicked. Rolldown does not code-split inside a worker, so
the worker is one ~220 KB file rather than five lazy chunks — it is still loaded
only when a document is actually parsed.

## Verified

- `npm run compile -w @blur/devdata` — clean.
- `npx wxt build` and `npx wxt build -b firefox` — both build.
- Built manifests (checked, not assumed):
  - Chrome MV3: `permissions: [storage, contextMenus, activeTab]`,
    `optional_permissions: [scripting]`, `optional_host_permissions: [<all_urls>]`,
    **no** `host_permissions`, **no** `content_scripts`.
  - Firefox MV2: `permissions: [storage, contextMenus, activeTab]`,
    `optional_permissions: [<all_urls>]` (MV2 has no `optional_host_permissions`
    key and no `scripting` permission — `tabs.executeScript` runs from `activeTab`,
    and `utils/permissions.ts` reports `scripting` as held there).
