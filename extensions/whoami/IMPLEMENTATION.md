# `@blur/whoami` — Connection & Device Info · implementation

Extension #9. **The logic is real.** The scaffold's two mocked fetches (`MOCK`,
`mockAsync`, `todoLogic`, `<MockBadge>`) are gone — `grep -rn "MOCK\|TODO_LOGIC"`
over `entrypoints/` and `utils/` returns nothing.

Design source of truth: [`docs/design/whoami.md`](../../docs/design/whoami.md);
constraints from [`PLAN-2.md`](../../PLAN-2.md) §5, §9, §10.3 and `TODO.md` §H.

Goal, non-negotiable: **«Показать мои соединение и устройство»**. The device half
runs with `permissions: ["storage"]`, `host_permissions: []` and ZERO network.

## Real vs deferred

**Real**

| Area | Where | Notes |
|---|---|---|
| T0 · device (~40 fields) | `utils/device.ts` | `navigator`, `screen`, `Intl`, `matchMedia`, `hardwareConcurrency`, `maxTouchPoints`, `cookieEnabled`, **GPC**, `webdriver`, `prefers-*`, `forced-colors`, `pointer`/`hover`, `screen.isExtended`, `Intl.Locale` week info. Async: `getHighEntropyValues()`, `storage.estimate()`, `navigator.gpu`, `WEBGL_debug_renderer_info` — each probed for real and degrading to an EXPLAINED chip. |
| T1 · Cloudflare trace | `utils/network.ts` → `fetchTrace()` | Real `fetch(one.one.one.one/cdn-cgi/trace)`, whitelist `key=value` parse (`ip, loc, colo, tls, http, warp, uag`), per-field degradation, `AbortSignal.timeout(8000)`, byte cap, `credentials:'omit'`, `referrerPolicy:'no-referrer'`, `cache:'no-store'`, `redirect:'error'`. |
| T2 · ipinfo.io | `utils/network.ts` → `fetchIsp()` | Real `fetch(https://ipinfo.io/json?token=…)` with the **user's own** token. ASN + ISP parsed out of `org`. 401/403 → "token rejected"; 429 → rate-limit with `Retry-After`; timeout/offline/malformed all first-class. |
| Consent flow | `utils/connection.tsx` | Inline disclosure (always on), modal `<dialog>`, `permissions.request()` as the FIRST call in the gesture, denial state, "don't ask again". |
| Revocation | `entrypoints/options/App.tsx` + `network.revokeIspPermission()` | `permissions.remove()` **and** flag reset; Options also displays what the browser actually holds (`permissions.contains()`). |
| Report + export | `entrypoints/report`, `utils/export.ts` | All groups, filter, unavailable counter, `.md`/`.json` copy + download (`Blob` + `<a download>`, no `downloads` permission). **Network block now exports too**, with "include network data" and "hide IP → 203.0.113.x" (design §2.6). |
| VPN/proxy signals (§8.1) | `utils/connection.tsx` → `VpnSignals` | Timezone vs IP country vs WARP. 🔴 A **discrepancy + explanations**, never a "VPN detected" verdict. Zero extra network. |

**Deferred (deliberately, with reasons)**

| Not built | Why |
|---|---|
| `ipapi.co` keyless fallback | ⚠️ Free-tier commercial-use terms unresolved (TODO §H). It is not in the code, **not in the CSP** and not in the `IspProvider` union. 🔴 We do not ship a fallback whose ToS may ban commercial use — and we never switch providers silently on an error. |
| WebRTC local-IP panel (§8.2) | 🔴 The local address is unobtainable (mDNS). Not attempted, not promised. (Showing "your leak is closed ✅" would need an `RTCPeerConnection`; it is honest but non-essential — left out rather than half-done.) |
| Entropy / uniqueness meter (§8.3) | Needs a licensed frequency table (§14.4). 🔴 Inventing numbers is forbidden. |
| `autoFetchIp` UI beyond the checkbox | Works, but stays off by default and is force-disabled on read unless `cfConsent === 'granted'` — that default is what keeps AMO at `required: ['none']`. |

## 🔴 Red lines — how each is enforced *in code*

1. **No fingerprint hash, nothing persisted, zero analytics.**
   - `grep -rn "crypto\|subtle\|digest\|hash"` over the sources: no hashing exists.
   - `utils/storage.ts` ends with two **type-level assertions** that run in
     `npm run compile`: `SETTINGS_KEYS` must equal `keyof WhoamiSettings` exactly,
     and `Extract<keyof WhoamiSettings, ForbiddenKey>` must be `never` — adding
     `lastIp`, `ip`, `asn`, `installId`, `fingerprintHash`, `analyticsOptIn`… **fails
     the build**. §5.3 is now a CI check, not a code-review hope.
   - There is **no background service worker entrypoint**, so there is no long-lived
     context that could cache anything. Results live in `useState` and die with the
     document.
   - The CSP `connect-src` allows two hosts. No analytics endpoint is reachable even
     in principle.
2. **Prominent in-UI disclosure before the first request.**
   - `ConnectionSection` renders the disclosure `<Callout>` **unconditionally**, and
     the single button that can start a request is its next sibling. There is no code
     path from popup-open to a fetch that does not pass through a click on it.
   - The only auto path (`autoFetchIp`) is unreachable until `cfConsent === 'granted'`
     — enforced twice: in the UI, and in `normalizeSettings()` on every read (so a
     hand-edited `storage.local` cannot make the popup phone home on open).
   - The ipinfo `<dialog>` names the recipient (ipinfo.io, USA), what leaves (the
     public IP), why, and the retention (none). Confirm = **"Отправить IP / Send my
     IP"**; default focus is Cancel; Esc/backdrop/Cancel = refusal.
   - **Revoke is real:** `permissions.remove()` + `ispConsent: 'unset'` → the whole
     disclosure runs again next time. Not a write-once boolean. An external revoke in
     `chrome://extensions` is reconciled via `permissions.contains()` on every mount.
3. **Firefox installs with no data warning.**
   `data_collection_permissions: { required: ["none"], optional: ["locationInfo"] }`
   (verified in the built MV2 manifest). No `technicalAndInteraction` anywhere — there
   is no telemetry.
4. **WebRTC local IP: not attempted, not promised** (`utils/device.ts`, `collectPrivacy`
   carries the comment; nothing in the UI claims it).
5. **`ip-api.com` is never used** — no HTTPS on free (physically impossible under our
   own CSP) plus a commercial-use ban.

## Security posture (audit checklist)

| Rule | Enforcement |
|---|---|
| Every fetch has a timeout | `AbortSignal.timeout(8000)` in `requestInit()` — both call sites use it; there is no `fetch(` anywhere else (2 call sites total, both in `network.ts`). |
| Response = untrusted input | Byte cap (16 KB, stream cancelled on overflow), `Content-Length` pre-check, whitelist keys only, per-value control-char strip + charset regex + 256-char clamp, `JSON.parse` in `try`, schema-check before use. No `Object.assign`/spread of a parsed body into state. |
| No `innerHTML` / `eval` | None in the sources (grep clean). All values are React text nodes. |
| No unhandled rejections | Every network path returns a typed `NetOutcome`; `settingsItem` read/write failures are caught (product runs on in-memory defaults). |
| Every error has a UI state | offline / timeout / rate-limited (+`Retry-After`) / unauthorized / malformed / generic — each with copy that also says *the device data above is unaffected*. |
| Popup renders with everything missing | The field model cannot print an empty cell; the network section degrades to "not requested"; the device half needs no API that can fail fatally. |
| Token hygiene | `storage.local` only (never `sync`), `type=password`, clamped to 128 chars, **never** in any export or clipboard copy (it is not part of any `FieldGroup`). |
| Double-click | The trace/ISP buttons are inert while a request is in flight — two requests would be two disclosures of the IP where the user consented to one. |
| Unmount | One `AbortController` per mount aborts any in-flight request (report tab); the popup's teardown does it for free. |

## Mobile (Firefox for Android)

- Popup is `max-width`, not fixed: at ≤ 400px the field rows stack, and nothing
  scrolls horizontally at 360px. The `<dialog>` is capped at `100vw - 24px`.
- `@media (pointer: coarse)` gives every control (tiles, chips, copy buttons, CTA)
  a ≥ 44px target. No hover-only affordance exists — the copy button and the
  unavailability chips are always visible buttons.
- The degradation path is the *normal* path there: no `userAgentData`
  high-entropy (Gecko), no `deviceMemory`, no `navigator.connection` (→ `mobile-only`
  / `chromium-only` chips), a different `storage.estimate()`. `connection.type` is the
  one field that becomes *available* on Android and shows a real value.

## Manifest (built output, both browsers)

```jsonc
// chrome-mv3
"permissions": ["storage"],
"optional_host_permissions": ["https://ipinfo.io/*"],
"content_security_policy": { "extension_pages":
  "script-src 'self'; object-src 'self'; connect-src 'self' https://one.one.one.one https://ipinfo.io;" }

// firefox-mv2
"permissions": ["storage"],
"optional_permissions": ["https://ipinfo.io/*"],
"content_security_policy": "script-src 'self'; object-src 'self'; connect-src 'self' https://one.one.one.one https://ipinfo.io;",
"browser_specific_settings": { "gecko": { "id": "whoami@blockaly.com",
  "data_collection_permissions": { "required": ["none"], "optional": ["locationInfo"] } }, "gecko_android": {} }
```

⚠️ **Two hosts, not three.** `ipapi.co` was removed from the CSP together with the
code that would have called it: a host nothing calls must not sit in the allow-list.

## Open questions for a human

1. 🔴 **ipapi.co ToS (TODO §H).** Unresolved, so it is **not shipped**. If its free
   tier does forbid commercial use (as `ip-api.com`'s does), the answer is simply
   "ipinfo-only", which is what is in the tree today. T0 + T1 is already a complete
   product; nothing is blocked on this.
2. **ipinfo endpoint choice.** We call `https://ipinfo.io/json?token=…`, *not* the
   Lite API at `https://api.ipinfo.io/lite/me` that PLAN-2 §5.2 names — because
   `api.ipinfo.io` is a **different host**, and using it would mean the permission
   warning and the CSP entry say `api.ipinfo.io` while the product says "ipinfo.io".
   The classic endpoint keeps URL = CSP = host permission identical (one host, one
   warning, trivially auditable) and still returns ASN + ISP (in `org`) plus
   country/city. If someone wants the Lite fields (`as_domain`, `continent`) exactly,
   that is a conscious swap of the host in three places.
3. **`permissions.request()` after `<dialog>` close on Firefox MV2** (design §14.2) —
   the code calls it as the first statement of the submit handler, which is correct by
   spec, but it has **not been verified on a live Firefox for Android build**. If the
   activation is lost there, the dialog must become an inline panel whose submit button
   *is* the gesture.
4. **Cloudflare `trace` has no SLA.** The parser degrades per field and shows the honest
   failure state, but if the endpoint dies, T1 dies with it. Do we want a second keyless
   IP-only source (which would mean a third disclosure and a third CSP host)?
5. `PRIVACY.md` and `STORE.md` need a `whoami` section (both are outside this task's
   write scope): recipients = Cloudflare + ipinfo.io, zero retention, no server, and the
   deliberate asymmetry that T1 has **no** host permission while T2 does (design §0.1).

## Design-section mapping

§0 architecture → `wxt.config.ts` + `utils/storage.ts` + "no SW". §1/§2 surfaces → the
three entrypoints. §2.4/§6.1 disclosure → `utils/connection.tsx`. §2.8/§5/§7 field model
+ reason catalog → `utils/field.tsx` (one code added: `provider-omitted` — the third
party answered but had no value for that field; 🔴 still a closed enum, still never a
"—"). §3 options inventory → `utils/storage.ts` + `options/App.tsx`. §4 flows +
§8.1 VPN signals → `utils/connection.tsx`. §6.3 manifest → `wxt.config.ts`. §9/§10
security + resilience → `utils/network.ts`.
