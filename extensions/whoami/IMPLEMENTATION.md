# `@blur/whoami` — Connection & Device Info · scaffold

UI-complete scaffold of extension #9 (PLAN.md §15, "Фаза 0"). Surfaces, navigation
and settings persistence are **real**; the two network fetches are **mocked**.
Design source of truth: [`docs/design/whoami.md`](../../docs/design/whoami.md);
constraints from [`PLAN-2.md`](../../PLAN-2.md) §5, §9, §10.3.

Goal, non-negotiable: **«Показать мои соединение и устройство»**. The whole device
half runs with `permissions: ["storage"]`, `host_permissions: []` and ZERO network.

## Surface map

| Surface | File | Role |
|---|---|---|
| **Popup** (primary, 380px) | `entrypoints/popup/{index.html,main.tsx,App.tsx,style.css}` | Device-first, 6 collapsible tiles, 🔴 zero network on open. Device+Browser · CPU/Memory · Screen · Locale/Time · **Connection** (IP flow) · Privacy. Buttons to report + options. |
| **Full report** (own tab) | `entrypoints/report/{index.html,main.tsx,App.tsx,style.css}` | All fields grouped, filter, "show unavailable" toggle, nav with per-group counts + "N unavailable" counter, copy/download `.md`/`.json`, Connection section. |
| **Options** | `entrypoints/options/{index.html,main.tsx,App.tsx,style.css}` | Theme/units/copy-format, network opt-ins + **revocation**, ISP provider + token, "what this never does", 2-step reset. |
| ~~Background SW~~ | **absent — deliberately** | See "No background SW" below. |

Shared logic in `utils/`:
- `storage.ts` — `WhoamiSettings` (prefs + consent flags ONLY) + `SETTINGS_KEYS`.
- `settings.tsx` — `useSettings()` hook + theme wiring over `@blur/ui`.
- `field.tsx` — 🔴 the discriminated-union field model + `<FieldRow>` renderer + reason catalog.
- `device.ts` — T0 real device collection (sync + async augmentation).
- `network.ts` — 🔴 mocked T1/T2 fetches + real permission helpers.
- `connection.tsx` — shared Connection section: 3 IP states, disclosure `<dialog>`, opt-in flow.
- `export.ts` — report → Markdown/JSON + client-side download.

## Real vs mocked

**Real now**
- All three surfaces, navigation, theme (`@blur/ui` `seedTheme('blur-whoami:theme')`), settings persistence.
- Tile collapse (`aria-expanded`/`aria-controls`), report filter + show-unavailable.
- 🔴 Device half (T0): `navigator.userAgent`, `Intl` timezone/locale, `screen`, `hardwareConcurrency`, `matchMedia`, languages, cookies, DNT — all real. Chromium-only APIs (userAgentData high-entropy, `deviceMemory`, `navigator.connection`, `navigator.gpu`, `WEBGL_debug_renderer_info`) are **really probed** and render via the field model with the "unavailable, and here's why" chip when absent.
- The 3 IP states (not-requested / granted+loaded / failed), the disclosure `<dialog>` with the ACTUAL RU+EN copy, the permission opt-in (`permissions.request` / `.contains` / `.remove`) wired for real, the "unavailable & why" chips, copy-to-clipboard per field, offline/denied/rate-limited/timeout/field-unavailable states.

**Mocked** (each carries `<MockBadge/>`)
- The two fetches only. IP/country/ISP values are fabricated constants returned via `mockAsync`.

## TODO_LOGIC inventory (`grep -r TODO_LOGIC`)

| Marker | File | What lands here |
|---|---|---|
| `whoami: cloudflare trace` | `utils/network.ts` → `fetchTrace()` | `fetch('https://one.one.one.one/cdn-cgi/trace', { signal: AbortSignal.timeout(8000), cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer' })`, whitelist-parse `key=value` (ip, loc, colo, tls, http, warp, uag), clamp to 256 chars. |
| `whoami: ipinfo lookup` | `utils/network.ts` → `fetchIsp()` | Fetch ipinfo.io (with token) or keyless ipapi.co, same security options, whitelist JSON fields (isp, asn, domain, continent). |

Also stubbed but not `TODO_LOGIC`-thrown: report **network export** (device export is real; the IP/ISP block + "hide IP" redaction is marked with a `MockBadge` and a Callout in `report/App.tsx`); the entropy/uniqueness tile and WebRTC-leak panel (design §8) are **not yet built** — noted as open (see below).

## The disclosure copy — where it lives (design §6.1)

- **Place A** (always-on inline, above the "Show my IP" button): `utils/connection.tsx`, the `<Callout tone="info">` in the not-requested branch.
- **Place B** (modal `<dialog>` before the first ipinfo call, RU + EN final copy): `utils/connection.tsx` → `IpConsentDialog`. 🔴 Confirm button = "Отправить IP / Send my IP", default focus on Cancel, Esc = refusal.
- **Place C** (source + timestamp + "не сохранено" per value): `utils/connection.tsx` → `IpBlock` / `IspBlock` `.ipblock__source`.

## "No IP persistence" — how it is architecturally true

1. **No background service worker entrypoint exists** (`entrypoints/` has none). WXT emits no background because none is defined. There is therefore no long-lived context to cache anything in.
2. **The fetches run in the popup/report document.** The result lives in React `useState` and dies when the document is torn down (popup close / tab close). Closing the popup aborts an in-flight `fetch` for free — nothing to clean up.
3. **The settings schema physically has no slot for an IP.** `WhoamiSettings` (utils/storage.ts) holds theme/units/copyFormat/allowCloudflare/cfConsent/autoFetchIp/ispProvider/ipinfoToken/ispConsent/showUnavailable — consent flags and prefs, never data. `SETTINGS_KEYS` is the closed key list; a `settings.spec.ts` (TODO) asserts `Object.keys` equals it and FAILS if anyone adds `lastIp`.
4. **CSP `connect-src` is pinned** (wxt.config.ts) to `'self' one.one.one.one ipinfo.io ipapi.co` — the extension is physically incapable of sending data elsewhere, so there is no exfiltration path even for a compromised dependency.

## "No background SW" decision

Deliberate (design §0, §1.1). No `contextMenus`, no `webRequest`, no alarms are needed; the only network calls are user-gated and belong in the document that shows them. Absence of the SW is what makes points 1–2 above true rather than promised, and it sidesteps the entire SW-death bug class that cost `perf` a round of fixes (PLAN.md §18a).

## Permissions / manifest mapping (wxt.config.ts)

- `permissions: ["storage"]` only. `host_permissions: []`.
- `optional_host_permissions: ["https://ipinfo.io/*"]` (Chrome) / `optional_permissions` (Firefox). ⚠️ Deliberate over-ask: Cloudflare + ipinfo both send `ACAO:*`, so `fetch` works WITHOUT the permission — the optional perm exists purely for the native browser prompt (a second, un-fakeable disclosure) and the native revoke path we reconcile via `permissions.contains()`.
- CSP with restricted `connect-src` (default MV3 does not restrict it) — commented in the config.
- Firefox: `gecko.id = whoami@blockaly.com`, `data_collection_permissions: { required: ['none'], optional: ['locationInfo'] }`, `gecko_android: {}`. `required:['none']` is a consequence of `autoFetchIp` defaulting to `false`.

## Open questions (carried from design §14)

1. **ipapi.co ToS.** Free tier may be non-commercial only. If it forbids a free extension, ipapi is not a valid keyless fallback and the ISP feature may ship ipinfo-only (or be dropped — T0+T1 is already a complete product). Options surfaces this as a warning; unresolved until ToS is checked.
2. `permissions.request()` holding user-activation after `<dialog>` close on Firefox MV2 — verify live (design §4.3). If it does not, the dialog must become an inline panel whose submit button is the gesture.
3. Entropy/uniqueness table licensing (design §8.3) and the WebRTC-leak panel (§8.2) are **not built in this scaffold** — pending the frequency-table license decision; 🔴 no invented numbers.
4. Stability of `one.one.one.one/cdn-cgi/trace` as a product dependency (no SLA) — the real parser must degrade per-field.

## Design-section mapping

§0 architecture → wxt.config.ts + storage.ts + "no SW". §1/§2 surfaces → the three
entrypoints. §2.4/§6.1 disclosure → `connection.tsx`. §2.8/§5/§7 field model + reason
catalog → `field.tsx`. §3 options inventory → `storage.ts` + `options/App.tsx`. §4
flows → `connection.tsx`. §6.3 manifest → `wxt.config.ts`. §9 security (no innerHTML,
untrusted-input whitelist, no persistence) → across `field.tsx`/`network.ts`/`export.ts`.
