import { defineConfig } from 'wxt';

// Extension #16 — "Request Blocker" (netblock).
//
// SINGLE PURPOSE (design §0, §1.1): "Block, fail and delay network requests
// for frontend resilience testing." Every feature answers ONE question — what
// does the frontend see when the network breaks? Blocked, failed with an error,
// slow, or a 503. There is deliberately NO redirect, NO header rewriting, NO
// "map local" mocking of successful responses (that is a different product —
// Requestly/ModHeader class — and a different purpose), NO filter lists (that is
// `adblock`), and NO user-supplied JavaScript in rules (rules are data, never
// remote code; CWS MV3 requirements). The audience is developers and QA.
//
// PERMISSION HONESTY — every install-time permission, and why (design §0, §10):
//   - storage               : rules (local), prefs (sync), counters + request
//                             log (session — never written to disk, §7.2).
//   - activeTab             : the toolbar click tells the popup which host it
//                             is on, so "Enable on <host>" can name the origin
//                             it will request (design §1.2). No warning. The
//                             design's §0 table omits it, but without it the
//                             popup cannot learn the host at all (`tabs` is
//                             deliberately NOT requested, §10.2).
//   - alarms                : the watchdog that releases requests a broken
//                             handler could leave hanging (§5.5, §8) — the tool
//                             must fail OPEN.
//   - scripting             : registers the in-page fetch/XHR interceptor
//                             ("page" engine) — only on origins the user
//                             explicitly enabled, never at install.
//   - webRequest            : OBSERVATION ONLY (non-blocking): response status
//                             for the log and for reactive rules, and
//                             `ERR_BLOCKED_BY_CLIENT` for the (approximate)
//                             hit counter of DNR rules. It only fires on
//                             origins the user granted.
//   - declarativeNetRequest : the stateless block engine. It is the one path
//                             that blocks WITHOUT host access, which is why it
//                             is install-time; it produces Chrome's "Block
//                             content on any page you visit" warning and that
//                             warning is unavoidable for a request blocker.
//                             `declarativeNetRequestFeedback` is NOT requested
//                             (ignored for CWS installs, adds a "read browsing
//                             history" warning — guarded in check-guards.mjs).
//   - debugger (Chrome only) : the "Network-level mode" engine (design §2.7,
//                             §4.3). SINGLE PURPOSE: fail a request with its
//                             REAL server status or a REAL network error type
//                             (`net::ERR_TIMED_OUT`, `ERR_INTERNET_DISCONNECTED`
//                             …) so the frontend under test sees exactly what
//                             it would see in the field. No other extension API
//                             can do that: `declarativeNetRequest` can only
//                             block/redirect/upgrade — it cannot match on a
//                             response status, cannot return a chosen status
//                             code or a chosen error type, and its response-
//                             header condition cannot stop the server from
//                             processing the request; blocking `webRequest` is
//                             policy-installed only in MV3; an in-page fetch/XHR
//                             patch cannot see images, scripts, fonts, frames
//                             or workers and cannot fake an error type. CDP
//                             `Fetch` (`failRequest` with a `Network.ErrorReason`,
//                             `fulfillRequest` with a status) is the only path.
//                             Why install-time: Chromium marks `debugger`
//                             kFlagCannotBeOptional (chrome_api_permissions.cc;
//                             permissions reference 2026-09-11 lists it under
//                             "cannot be specified as optional"), so an optional
//                             declaration is silently dropped and
//                             `permissions.request` rejects. How it is used:
//                             OPT-IN PER TAB — nothing attaches at install or on
//                             its own; the user turns Network-level mode on for
//                             ONE tab from the popup after a consent dialog that
//                             names the browser's own warning; Chrome's
//                             "Request Blocker started debugging this browser"
//                             banner is shown for the whole session; the session
//                             ends on toggle-off, tab close, the banner's Cancel,
//                             enterprise policy, or three handler errors. The
//                             engine issues only Fetch.enable/disable,
//                             continueRequest, failRequest and fulfillRequest;
//                             it never reads response bodies
//                             (`Fetch.getResponseBody` does not appear in the
//                             code — design §7.2) and sends nothing anywhere
//                             (CSP `connect-src 'none'`). Install warning this
//                             adds: "Access the page debugger backend" + "Read
//                             and change all your data on all websites"
//                             (permissions-list 2026-09-09) — accepted by the
//                             product owner as the price of a real network-
//                             level failure test. Guard allowlist:
//                             scripts/check-guards.mjs BASELINE_DEBUGGER_ALLOWED.
//   - optional_host_permissions <all_urls> : "Enable on this site" in the popup
//                             (user gesture → permissions.request). Needed for
//                             the page engine and the per-tab request log; a
//                             plain block rule works without it.
//
// Firefox has no `chrome.debugger` (bugzilla 1323098): the Firefox manifest
// never lists it and the Firefox bundle carries no `.debugger.` reference (the
// engine module receives the API by injection under `!import.meta.env.FIREFOX`).
//
// NETWORK: none, ever. The extension-pages CSP carries `connect-src 'none'` so
// fetch/XHR/WebSocket from any of our pages is impossible by construction. No
// rule lists "from a server", no delay servers, no telemetry (ModHeader lesson,
// Research §3).
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // ⚠️ AUDIT-CRITICAL. `entrypoints/relay.content.ts` and `page.content.ts`
  // declare `matches: ['<all_urls>']` so they CAN be registered at runtime
  // (`scripting.registerContentScripts` with the origins the user granted).
  // WXT, seeing those matches, hoists `<all_urls>` into install-time
  // `host_permissions` (MV3) / `permissions` (MV2) even though the scripts are
  // `registration: 'runtime'` and absent from `content_scripts`. That is the
  // "read and change all your data on all websites" warning this extension is
  // built to avoid at install. Strip it back out; `npm run guards` fails the
  // build if this hook is ever dropped. Firefox keeps its explicit `<all_urls>`
  // (declared below, in `permissions`) because that build genuinely needs it.
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      const m = manifest as Record<string, unknown>;
      const isFirefox = wxt.config.browser === 'firefox';
      if (!isFirefox) {
        delete m.host_permissions;
        if (Array.isArray(m.permissions)) {
          m.permissions = (m.permissions as string[]).filter(
            (p) => !p.includes('://') && p !== '<all_urls>',
          );
        }
      }
      if (Array.isArray(m.content_scripts) && m.content_scripts.length === 0) {
        delete m.content_scripts;
      }
    },
  },

  // Store artifact naming. Without this, `{{name}}` is derived from the
  // package.json name (`@blur/netblock` -> `blurnetblock`). `zip.name` overrides
  // that one template variable, and BOTH `artifactTemplate` and
  // `sourcesTemplate` interpolate it, so the Firefox `-sources.zip` stays
  // consistent for free.
  zip: {
    name: 'request-blocker',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Request Blocker',
      // The single approved listing phrase (design §11). No "adblock", "privacy"
      // or "tracker" — those words put us in the wrong review category.
      description: 'Block, fail and delay network requests for frontend resilience testing.',

      // Publisher identity. `author` is a plain STRING: Chrome MV3 rejects the
      // legacy `{ email }` object form, and Firefox MV2 also takes a string, so
      // one value is valid for both targets emitted by this manifest function.
      author: 'marek-devlab',
      homepage_url: 'https://github.com/marek-devlab/browser-extensions',

      // Toolbar/store icons. WXT auto-discovers the top-level `icons` map from
      // `public/icon/{16,32,48,128}.png`; `action.default_icon` is NOT derived
      // from those files, so it is wired explicitly here.
      action: {
        default_icon: {
          16: 'icon/16.png',
          32: 'icon/32.png',
          48: 'icon/48.png',
          128: 'icon/128.png',
        },
      },

      // Options entry (browser's "Extension options" menu item) points AT THE
      // SAME tool page on the `#/settings` route — not a separate options page,
      // which would be a second entry point and drift toward a bundle (design
      // §1.2). `open_in_tab: true` is required, else Firefox renders it in the
      // narrow about:addons frame where the split-view editor cannot fit.
      options_ui: {
        page: 'tool.html#/settings',
        open_in_tab: true,
      },

      // Baseline permissions — see the header comment for the per-permission
      // rationale. Firefox: no DNR at all (it cannot be optional there and the
      // single blocking-webRequest engine covers every condition, Research
      // §2.6); `webRequestBlocking` + `<all_urls>` are the only way to cancel a
      // request in Firefox (same shape as `adblock`), and they are
      // OptionalPermissionNoPrompt except `<all_urls>` which is the one warning.
      // Chrome: `debugger` is install-time because Chromium refuses it as
      // optional (header comment) — it is still opt-in per tab at runtime.
      permissions: isFirefox
        ? ['storage', 'activeTab', 'alarms', 'webRequest', 'webRequestBlocking', '<all_urls>']
        : ['storage', 'activeTab', 'alarms', 'scripting', 'webRequest', 'declarativeNetRequest', 'debugger'],

      // Chrome only: host access is requested per site from the popup ("Enable
      // on this site"), never at install. Firefox MV2 has no optional-host key
      // and already holds `<all_urls>` above.
      ...(isFirefox ? {} : { optional_host_permissions: ['<all_urls>'] }),

      // ZERO NETWORK, MECHANICALLY. `connect-src 'none'` makes fetch/XHR/
      // WebSocket impossible from every extension page and the background. MV2
      // takes a bare string, MV3 the `extension_pages` object.
      ...(isFirefox
        ? {
            content_security_policy:
              "script-src 'self'; object-src 'self'; connect-src 'none'",
          }
        : {
            content_security_policy: {
              extension_pages: "script-src 'self'; object-src 'self'; connect-src 'none'",
            },
          }),

      ...(isFirefox
        ? {
            browser_specific_settings: {
              // Permanent AMO add-on ID on the publisher's real domain. This is
              // an identity, not a URL — it is never fetched — but it must stay
              // STABLE forever: changing it after release makes AMO treat the
              // upload as a brand-new add-on and orphans every existing install.
              gecko: {
                id: 'netblock@marek-devlab.github.io',
                // Floor for the built-in data-consent panel (140 desktop; the
                // key is ignored below that and AMO requires it).
                strict_min_version: '140.0',
                // MANDATORY for new AMO submissions since 2025-11-03. This
                // extension transmits NOTHING: rules live in storage.local, the
                // request log lives in storage.session (RAM, never on disk),
                // and the CSP forbids connections. Hence `none`.
                data_collection_permissions: {
                  required: ['none'],
                },
              },
              // Firefox for Android is a real target: blocking webRequest works
              // there, so the whole engine does (Research §2.6). Without
              // gecko_android AMO will not mark the add-on Android-compatible.
              gecko_android: {},
            },
          }
        : {}),
    };
  },
});
