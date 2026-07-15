# Data Format Toolkit

View, validate and convert structured data — **JSON, JSON5, JSONC, YAML, XML,
CSV, JWT and JSON Schema** — in one full-page tool. Everything runs locally in
your browser; there is **no network at all** — no fetch, no JWKS lookup, no
analytics, no telemetry.

> **Status: implemented.** Parsing, the tree, syntax highlighting, conversion,
> JWT decode/verify, JSON Schema validation and the in-page formatter are all
> real. No mock data, no `TODO_LOGIC` stubs. See `IMPLEMENTATION.md` for the
> per-area map, the security decisions and what is deliberately deferred.

## Single purpose

Its purpose is exactly one phrase: **"View and convert structured data."**

There is deliberately **one** entry point — a single tool page with tabs (Данные
· JWT · Схема · Настройки). JWT, the converter and the schema validator are
**tabs, not separate products**: the moment one gets its own popup, the extension
becomes a bundle and fails the single-purpose policy (design §1.1).

## Surfaces

| Surface | File | Role |
|---|---|---|
| **Tool page** (main) | `entrypoints/tool/` → `tool.html` | Editor + tree + inspector; opens in a full tab so it survives focus loss and fits a 3-column layout |
| **Popup launcher** | `entrypoints/popup/` | 320px, three actions: paste & open, open tool, format-this-tab + theme |
| **Options** | `options_ui = tool.html#/settings` | The browser's "Options" item lands on the Settings **tab** — not a second page |
| **Context menu** | `entrypoints/background.ts` | "Open selection in Data Toolkit" (`contexts: ['selection']`, reads `selectionText`, no injection) |

## Permissions — the honest version

```
# Chrome MV3
permissions:               ['storage', 'contextMenus', 'activeTab']   # zero install warnings
optional_permissions:      ['scripting']        # "Format JSON on THIS tab", requested on click
optional_host_permissions: ['<all_urls>']       # opt-in auto-formatter, behind a consent dialog

# Firefox MV2 (no optional_host_permissions key; `scripting` is not an MV2 permission)
permissions:               ['storage', 'contextMenus', 'activeTab']
optional_permissions:      ['<all_urls>']
```

⚠️ `wxt.config.ts` strips the `host_permissions` that WXT would otherwise hoist out
of the runtime-registered content script's `matches`. If that hook is removed, the
install-time permission set silently grows to `<all_urls>`. **Review the built
manifest, not the source.**

- **No install-time host access.** The baseline manifest triggers no scary
  prompt.
- `scripting` is requested **permission-only** (no host) on the toolbar click, so
  Chrome shows no "read data on all sites" warning — `activeTab` already granted
  the host for the current tab (design §4.3). On Firefox MV2 `scripting` is
  unnecessary and the button is active immediately.
- `<all_urls>` is requested **only behind an explicit consent `<dialog>`** for the
  opt-in auto-formatter, and the UI always shows the permission **fact**
  (`permissions.contains`), never a stored flag.

## Security posture

- **Zero network.** No fetch/XHR/WebSocket/sendBeacon; CSP carries no
  `connect-src`. No JWKS-by-URL, no external `$ref`, no "share link".
- **JWTs are credentials.** The token, HS256 secret and public key live **only in
  RAM** — no storage item exists for them; they are never persisted and never
  reach `local:document` (design §7.2).
- **No `innerHTML`** anywhere — nor `eval`, `new Function`, or
  `dangerouslySetInnerHTML`. Untrusted text renders as React children or via
  `textContent`; syntax colouring uses the CSS Custom Highlight API over `Range`s
  on a flat `<pre>`, so user text is never turned into markup at all.
- **Untrusted input is parsed in a Worker** with a timeout and a real
  `terminate()`: a 200 MB CSV, a deeply-nested document or a ReDoS `pattern` in a
  JSON Schema can hang a thread, and the thread they hang is never the UI's.
- **XML** is parsed as `application/xml` (never `text/html`) and a DTD declaring
  `<!ENTITY>` is refused (billion-laughs). YAML anchors are capped.

## Run it

From the repo root (script aliases follow the existing four extensions):

```bash
npm run dev:devdata            # Chrome
npm run dev:devdata:firefox    # Firefox
npm run build --workspace @blur/devdata   # production build
npm run zip   --workspace @blur/devdata   # store zip (data-format-toolkit-…)
```

## Structure

```
entrypoints/
  background.ts        # context menu + open-tool; almost-empty MV3 SW
  popup/               # 320px launcher
  tool/                # the full-page tool (index.html → tool.html)
    App.tsx            #   shell: tablist + hash router + theme
    tabs/DataTab.tsx   #   editor + tree + inspector + conversion + all states
    tabs/JwtTab.tsx    #   decode + verify + credential framing
    tabs/SchemaTab.tsx #   JSON Schema validation
    tabs/SettingsTab.tsx  # real prefs persistence + consent dialog
  formatter.content.ts # in-page JSON viewer; registration: 'runtime' (NOT in the manifest)
utils/
  core/                # PURE logic — no browser APIs, runs in the Worker
    detect.ts          #   format autodetect + base64url
    parse.ts           #   json/jsonc/json5/yaml/csv (lazy imports)
    tree.ts            #   flat pre-order tree; every walker is iterative
    serialize.ts       #   JSON/XML/CSV emit + the mandatory loss warnings
    tokenize.ts        #   token RANGES for the Highlight API (never markup)
    xml.ts             #   DOMParser injected; XXE/entity refusal
  worker/
    data.worker.ts     # parse / convert / validate — all the expensive work
    client.ts          #   one disposable worker per job; timeout -> terminate()
    protocol.ts        #   wire types
  format.ts            # document API (worker orchestration + main-thread XML)
  document.ts          # the document state machine (empty/loading/ready/failed/fatal)
  jwt.ts               # decode (own) + verify (jose/WebCrypto, lazy)
  schema.ts            # JSON Schema validation via the worker
  highlight.ts         # CSS Custom Highlight API
  format-page.ts       # one-shot + opt-in auto page formatting
  permissions.ts       # scripting / <all_urls> FACTS (live)
  storage.ts prefs.ts handoff.ts router.ts examples.ts types.ts
```

See `IMPLEMENTATION.md` for the real-vs-mocked map and the wiring backlog.
