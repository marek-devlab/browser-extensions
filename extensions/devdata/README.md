# Data Format Toolkit

View, validate and convert structured data — **JSON, JSON5, JSONC, YAML, XML,
CSV, JWT and JSON Schema** — in one full-page tool. Everything runs locally in
your browser; there is **no network at all** — no fetch, no JWKS lookup, no
analytics, no telemetry.

> **Scaffold status.** This is a UI-complete scaffold (PLAN.md §15 "Фаза 0"):
> every surface, tab, route, setting and state is real, but the domain logic
> (parse / convert / validate / JWT-decode) is **stubbed on mock data**. Every
> mock surface renders a dashed "демо-данные" badge, and every stub throws
> `TODO_LOGIC` on its real path (`grep -r TODO_LOGIC extensions/devdata`).

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
permissions:               ['storage', 'contextMenus', 'activeTab']   # zero install warnings
optional_permissions:      ['scripting']        # "Format JSON on THIS tab", requested on click
optional_host_permissions: ['<all_urls>']       # opt-in auto-formatter, behind a consent dialog
```

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
- **No `innerHTML`** anywhere. All page-derived/user text renders as React
  children; syntax colouring will use the CSS Custom Highlight API over a flat
  `<pre>`, never generated `<span>` HTML.

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
utils/
  storage.ts           # sync:prefs + local:document + local:schema (versioned)
  prefs.ts             # single writer for sync:prefs; wires @blur/ui theme
  router.ts            # tiny hash router (#/data #/jwt #/schema #/settings)
  permissions.ts       # scripting / <all_urls> FACTS (real, live)
  format.ts jwt.ts schema.ts format-page.ts   # STUBBED logic (mock + TODO_LOGIC)
  mock-data.ts types.ts                        # fixtures + domain types
```

See `IMPLEMENTATION.md` for the real-vs-mocked map and the wiring backlog.
