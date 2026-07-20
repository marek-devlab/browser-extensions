import { defineConfig } from 'wxt';

// Extension 12 — "Link Inspector" (PLAN.md Часть III §12).
//
// SINGLE PURPOSE: "Reveal where a link really goes before you click." Local
// heuristics (punycode/homograph, anchor-vs-href mismatch, cross-domain, unsafe
// schemes, tracking-param strip) run with ZERO network; resolving a shortener's
// final destination is NETWORK and strictly opt-in per action (it would burn any
// one-time token in the link — see §12.3).
//
// PERMISSION HONESTY: warning-free install. The hover/scan UI injects on the
// `activeTab` toolbar click via `scripting`, NOT a declared <all_urls> content
// script (WXT manifest-hoist landmine). Network resolve needs cross-origin reach,
// so <all_urls> lives under `optional_host_permissions`, requested at runtime
// inside a click handler with an explicit "this contacts the server and reveals
// you clicked" warning.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // 🔴 AUDIT BLOCKER GUARD (the memory landmine: "WXT all_urls manifest hoist").
  //
  // `entrypoints/inspector.content.ts` must declare `matches: ['<all_urls>']` because
  // WXT's content-script type demands a `matches` — but it is `registration: 'runtime'`,
  // so the script is NOT listed in `content_scripts` and never runs ambiently. WXT
  // nonetheless HOISTS that `matches` into install-time `host_permissions` (MV3) /
  // `permissions` (Firefox MV2), which is exactly the "read and change all your data
  // on all websites" warning this extension's whole permission model exists to avoid.
  //
  // We do not need it: `activeTab`, granted by the toolbar click / context-menu click,
  // authorises `scripting.executeScript` on the current tab. The hoisted host pattern
  // is stripped from BOTH built manifests here — the permission model (contextMenus +
  // activeTab + scripting + storage, warning-free) is preserved exactly, and network
  // reach stays under the runtime-requested `optional_host_permissions`. If a future
  // change reintroduces a baseline host permission it dies here (and in
  // scripts/check-guards.mjs) rather than in store review.
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      delete manifest.host_permissions;
      if (Array.isArray(manifest.permissions)) {
        manifest.permissions = manifest.permissions.filter((p) => !String(p).includes('://'));
      }
    },
  },

  zip: {
    name: 'link-inspector',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Link Inspector',
      description:
        'Reveal a link’s real destination and flag phishing tricks (homograph domains, mismatched text, trackers) — locally by default; network resolve only on request.',

      author: 'Blockaly',
      homepage_url: 'https://blockaly.com',

      action: {
        default_icon: {
          16: 'icon/16.png',
          32: 'icon/32.png',
          48: 'icon/48.png',
          128: 'icon/128.png',
        },
      },

      // `contextMenus` ("Where does this link go?" / "Copy clean link"),
      // `activeTab` + `scripting` (scan/hover overlay on click), `storage`
      // (trusted-domain allowlist, prefs). None warns at install.
      permissions: ['contextMenus', 'activeTab', 'scripting', 'storage'],

      // Cross-origin reach for opt-in network resolve of a shortener's final URL.
      // Requested on a gesture with a disclosure; never granted at install (an
      // OPTIONAL permission shows no install-time warning). Chrome MV3 splits optional
      // origins into `optional_host_permissions`; Firefox MV2 declares them under
      // `optional_permissions` (§12.1 "MV2 кладёт паттерны в optional_permissions").
      // Same warning-free model, but this way `permissions.request()` actually has a
      // pattern to grant on BOTH targets (mirrors the whoami house pattern) rather than
      // silently failing on Firefox.
      ...(isFirefox
        ? { optional_permissions: ['<all_urls>'] }
        : { optional_host_permissions: ['<all_urls>'] }),

      ...(isFirefox
        ? {
            browser_specific_settings: {
              gecko: {
                id: 'linksafe@blockaly.com',
                // Local mode reads/transmits nothing. Network resolve is user-
                // initiated per action and disclosed in-UI, not a standing
                // collection — honest baseline declaration is `none`.
                data_collection_permissions: {
                  required: ['none'],
                },
              },
              gecko_android: {},
            },
          }
        : {}),
    };
  },
});
