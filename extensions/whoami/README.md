# Connection & Device Info (`@blur/whoami`)

See your IP, country, browser, device and screen. **The device half works
completely offline, with zero network requests and zero host permissions** — open
the popup and you have a working product before the extension has contacted
anybody at all.

No fingerprint hash. No IP history. No analytics. No account.

## Single purpose

One phrase: **"Show my connection and device."** Read-only, and nothing else. It
does not modify pages, does not spoof your User-Agent (see below) and does not
run a speed test.

## The three tiers

| Tier | What | Network | Permission | Consent |
|---|---|---|---|---|
| **T0 · Device** | UA, engine, screen + DPR, CPU cores, memory, storage quota, GPU, locale, timezone, languages, cookies, GPC, `prefers-*`, pointer/hover, forced-colors | **none** | **none** | not needed — runs on open |
| **T1 · My IP** | IP, country (ISO), Cloudflare PoP, TLS, HTTP version, WARP, the UA the server saw | `one.one.one.one/cdn-cgi/trace` | none needed (`ACAO: *`) | explicit click, under an on-screen disclosure |
| **T2 · ISP / ASN** | ISP name, ASN, reverse DNS, approximate city/region | `ipinfo.io` (your own free token) | `optional_host_permissions: https://ipinfo.io/*` | modal disclosure **+** the browser's own permission prompt |

⚠️ **Cloudflare's trace gives no ISP, no ASN and no city.** That is why T2 exists
as a separate, separately-consented step — and why we never pretend T1 answers it.

⚠️ **Your local network address (192.168.x.x) cannot be obtained** in a modern
browser: WebRTC obfuscates host candidates behind mDNS. We do not attempt it and
do not promise it.

## Permissions — the honest version

```jsonc
"permissions": ["storage"],                                 // UI prefs + consent flags. That is all.
"host_permissions": [],                                     // ← the main asset
"optional_host_permissions": ["https://ipinfo.io/*"],       // requested at runtime, only if you ask for your ISP
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' https://one.one.one.one https://ipinfo.io;"
}
```

- **`storage` only.** Not even `activeTab`: this extension never touches a page.
- **The CSP `connect-src` is the exhaustive list of hosts this extension is even
  *capable* of contacting.** MV3 does not restrict `connect-src` by default; we
  restrict it ourselves. Any attempt to send data anywhere else fails at the
  platform level — including from a compromised dependency.
- The ipinfo host permission is a deliberate over-ask: `fetch` would pass CORS
  without it. We request it because the browser's own prompt is a second,
  un-fakeable disclosure, and because it gives you a **native revoke path** that
  the extension re-checks on every open.

## Privacy: why "we don't store your IP" is architecture, not a promise

1. **There is no background service worker.** None. The fetch runs in the popup (or
   report) document, the value lives in React state, and it dies with the document.
   No SW → no cache → no "IP history" → nothing to exfiltrate.
2. **The settings schema has no slot for it.** `WhoamiSettings` holds theme, units,
   copy format, a provider choice, your ipinfo token and three consent flags —
   never data about you. A **compile-time assertion** in `utils/storage.ts` fails
   the build if anyone adds `lastIp`, `installId`, `fingerprintHash` or similar.
3. **Nothing is hashed.** No fingerprint identifier is computed, stored or sent.
4. **Zero analytics, zero telemetry**, and no server of ours to send them to.

Close the popup and the IP is gone. That is not a policy — it is the only thing
that can happen.

## Disclosure & consent

- **Before any request**, the popup shows an in-UI disclosure directly *above* the
  only button that can start one: what will be sent, who receives it, why, and that
  nothing is retained. (A store-listing disclosure does **not** satisfy the CWS
  policy effective 2026-08-01; this one does.)
- **Before the first ipinfo request**, a modal `<dialog>` names the recipient
  (ipinfo.io, USA), the exact data (your public IP), the purpose and the retention
  (none). `Esc`, the backdrop and Cancel all mean **refusal**; the confirm button
  is the verb — "Send my IP", never "OK".
- **Consent is revocable for real:** Options → *Revoke* calls `permissions.remove()`
  and resets the flag, so the full disclosure appears again next time. Revoking in
  `chrome://extensions` works too — the extension notices via
  `permissions.contains()` on every open and rolls its own flag back.

## Firefox

`data_collection_permissions: { required: ["none"], optional: ["locationInfo"] }`
— installation shows **no data-collection warning**, because nothing is collected
until you press a button. That is a direct consequence of "fetch my IP on open"
being **off by default**; it is not cosmetic.

Works on **Firefox for Android** (`gecko_android`). The popup is responsive to
360px, all touch targets are ≥ 44px, and there are no hover-only affordances.
Android's device APIs differ (no high-entropy UA data, different storage quota) —
each missing field explains itself instead of showing a blank.

## Never a "—"

Every fact is a `{ value } | { unavailable, reason }` union, and the one renderer
that turns a field into pixels **cannot print an empty cell**. `deviceMemory` on
Firefox, WebGL renderer under `resistFingerprinting`, `HighEntropyValues` anywhere
outside Chromium, an ISP before you asked for one — each shows a chip with a
plain-language explanation of *why*, and that it is not a bug.

## What it will never do

- Spoof your User-Agent (that needs access to every site — a different product).
- Compute or store a fingerprint hash.
- Keep a history of your IP addresses.
- Run analytics, or contact any host outside the two in the CSP.
- Use `ip-api.com` (no HTTPS on the free tier — physically impossible under our
  CSP — plus a commercial-use ban).

## Development

```bash
npm run dev:whoami            # Chrome
npm run dev:whoami:firefox    # Firefox
npm run compile -w @blur/whoami
```

See [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) for what is real, what is deferred
and the open questions; the design source of truth is
[`docs/design/whoami.md`](../../docs/design/whoami.md).
