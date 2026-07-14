import { defineConfig } from 'wxt';

// Extension #9 — "Connection & Device Info" (`@blur/whoami`).
//
// SINGLE PURPOSE (PLAN-2 §5): "Show my connection and device." The whole DEVICE
// half runs with `permissions: []`, `host_permissions: []` and ZERO network — that
// is the product's main asset (design §0). The "what's my IP" category is spammy,
// so manual review is near-guaranteed; our fast path through it is that a reviewer
// opening the popup sees a working product BEFORE a single network request fires.
//
// 🔴 There is deliberately NO background service worker entrypoint (design §0):
// the IP/ISP fetches run in the popup or report DOCUMENT, the value lives in React
// state, and it dies with the document. No SW → no cache → no "IP history" → nothing
// to persist or exfiltrate. If WXT ever needs a background for a feature, keep it
// absent — that absence is the architecture, not an oversight.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // Store artifact naming. Without this, `{{name}}` derives from the package.json
  // name (`@blur/whoami` -> `blurwhoami`). Both `artifactTemplate` and
  // `sourcesTemplate` interpolate `zip.name`, so the Firefox `-sources.zip` stays
  // consistent for free.
  zip: {
    name: 'connection-device-info',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    // The complete list of hosts this extension is even CAPABLE of contacting.
    // The default MV3 CSP does NOT restrict `connect-src` — an extension can fetch
    // anywhere by default. We close that ourselves: with this list, any attempt to
    // send data to a host NOT named here fails at the platform level (design §0.2).
    // That is the "architecturally, not by promise" evidence PLAN-2 §5.3 asks for.
    // PRIVACY.md points at this line as the exhaustive host list.
    //   - one.one.one.one : Cloudflare trace (IP + country), no key, ACAO:*
    //   - ipinfo.io       : ISP / ASN lookup (opt-in), needs the user's token
    //   - ipapi.co        : keyless ISP alternative (opt-in), ~1000 req/day
    const connectSrc =
      "script-src 'self'; object-src 'self'; " +
      "connect-src 'self' https://one.one.one.one https://ipinfo.io https://ipapi.co;";

    return {
      name: 'Connection & Device Info',
      description:
        'See your IP, country, browser, device and screen. The device half works offline, with zero permissions.',

      // Publisher identity. `author` is a plain STRING: Chrome MV3 rejects the
      // legacy `{ email }` object form, and Firefox MV2 also takes a string.
      author: 'Blockaly',
      homepage_url: 'https://blockaly.com',

      // Toolbar/store icons. WXT auto-discovers the top-level `icons` map from
      // `public/icon/{16,32,48,128}.png`; `action.default_icon` is NOT derived from
      // those files, so it is wired here. TODO: ship the four PNGs (see
      // public/icon/.gitkeep) — none are committed yet.
      action: {
        default_icon: {
          16: 'icon/16.png',
          32: 'icon/32.png',
          48: 'icon/48.png',
          128: 'icon/128.png',
        },
      },

      // 🔴 Base install-time permissions: `storage` ONLY, for UI prefs (design §6.3).
      // Not even `activeTab`: this extension never touches the page. `host_permissions`
      // is intentionally empty — the main asset.
      permissions: ['storage'],

      // ⚠️ Deliberate over-ask. Both Cloudflare's trace and ipinfo.io send
      // `Access-Control-Allow-Origin: *`, so `fetch` from an extension page passes
      // CORS WITHOUT any host permission — T2 (ISP/ASN) would technically work with
      // no permission at all. We still request `https://ipinfo.io/*` at runtime
      // because the native browser prompt is a SECOND, un-fakeable disclosure and it
      // gives the user a native revoke path (chrome://extensions → uncheck), which
      // our UI reconciles via `permissions.contains()` on every open (design §0.1).
      // `<all_urls>` here would be a near-guaranteed store rejection (PLAN-2 §5.2).
      // Chrome MV3 splits optional origins into `optional_host_permissions`; Firefox
      // MV2 declares them under `optional_permissions`.
      ...(isFirefox
        ? { optional_permissions: ['https://ipinfo.io/*'] }
        : { optional_host_permissions: ['https://ipinfo.io/*'] }),

      // CSP: physical inability to call elsewhere (see `connectSrc` above). Chrome
      // MV3 nests it under `extension_pages`; Firefox MV2 takes a bare string.
      ...(isFirefox
        ? { content_security_policy: connectSrc }
        : { content_security_policy: { extension_pages: connectSrc } }),

      ...(isFirefox
        ? {
            browser_specific_settings: {
              gecko: {
                // Permanent AMO add-on ID on the publisher's real domain. Must stay
                // STABLE forever: changing it after release orphans every install.
                id: 'whoami@blockaly.com',
                // MANDATORY for new AMO submissions (Firefox data-consent panel).
                // ⚠️ `required: ['none']` is a CONSEQUENCE of the opt-in architecture,
                // not cosmetics: nothing is collected at install. If the Cloudflare
                // request fired automatically on open, `required` would need
                // `locationInfo` and Firefox would show a data-warning AT INSTALL —
                // which is exactly why `autoFetchIp` defaults to false (design §6.3).
                // `locationInfo` (IP → country/city) is OPTIONAL: it is gated behind
                // an explicit gesture + `permissions.request()`. No `technicalAndInteraction`
                // anywhere — there is no telemetry (PLAN-2 §9).
                data_collection_permissions: {
                  required: ['none'],
                  optional: ['locationInfo'],
                },
              },
              // Firefox for Android target — without this AMO won't mark the add-on
              // Android-compatible.
              gecko_android: {},
            },
          }
        : {}),
    };
  },
});
