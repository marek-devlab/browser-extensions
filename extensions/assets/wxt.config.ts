import { defineConfig } from 'wxt';

// Extension #8 — "Asset Inspector" (assets).
//
// SINGLE PURPOSE (PLAN-2.md §4): "Find the source of any element on the page and
// the requests that loaded it." An INSPECTOR, not a downloader. The whole product
// hangs on ONE red line — the difference between "minimal-risk review" and a
// store ban is a single Download button, and it is never added back (design §0,
// PLAN-2.md §4.5). Everything below defends that boundary.
//
// 🔴 FORBIDDEN, and DELIBERATELY ABSENT (do not re-add — each one re-categorises
//    the product as a media downloader / grabber, PLAN-2.md §4, §10.5, design §13):
//   - `downloads`            : there is no save-to-disk path anywhere, mocked or
//                              real. Export of the CARD is clipboard-only ("Copy
//                              as JSON"), never a file.
//   - `webRequest`           : request data comes from Resource Timing (in page)
//                              and DevTools HAR (panel) — never from intercepting
//                              traffic. `webRequest` would drag in "read all your
//                              data on all sites".
//   - `<all_urls>` / host_permissions : none. The inspector is injected on a
//                              gesture under `activeTab`; it never runs ambiently.
//   - `chrome.debugger`      : owned by the `perf` extension; a debugging banner
//                              on an image inspector is an instant red flag.
//   - persistent content_scripts : none (`content_scripts: []`). A permanent
//                              script on every page is the same install warning we
//                              refuse to pay; the context menu works by matching
//                              `info.srcUrl` after an on-gesture injection instead.
//   - No `fetch()` of any media URL, no m3u8/mpd parsing — not in this file, not
//     anywhere. The card preview is `canvas.drawImage(existingElement)` (zero
//     network); we never request a URL we display (design §0, invariant И1).
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // Store artifact naming. Without this, `{{name}}` is derived from the package
  // name (`@blur/assets` -> `blurassets`). `zip.name` overrides that one template
  // variable, and BOTH artifactTemplate and sourcesTemplate interpolate it, so the
  // Firefox `-sources.zip` stays consistent for free.
  zip: {
    name: 'asset-inspector',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Asset Inspector',
      // "inspector" language only. The listing must NOT contain download / save /
      // grabber / ripper, nor the perf words (speed, Core Web Vitals, waterfall,
      // page weight) — that keeps the review category correct and the boundary
      // against `perf` visible (design §8, §13).
      description:
        'Inspect any element on a page: its real source URL, which srcset candidate the browser picked and why, and the requests that loaded it. 100% offline, zero network.',

      // Publisher identity. `author` is a plain STRING: Chrome MV3 rejects the
      // legacy `{ email }` object form and Firefox MV2 also accepts a string, so
      // one value is valid for both targets this function emits.
      author: 'Blockaly',
      homepage_url: 'https://blockaly.com',

      // Toolbar/store icons. WXT auto-discovers the top-level `icons` map from
      // public/icon/{16,32,48,128}.png; `action.default_icon` is NOT derived from
      // those files, so it is wired explicitly here. (Scaffold ships no PNGs yet —
      // see public/icon/.gitkeep.)
      action: {
        default_icon: {
          16: 'icon/16.png',
          32: 'icon/32.png',
          48: 'icon/48.png',
          128: 'icon/128.png',
        },
      },

      // The WHOLE install-time permission set. Every one is narrow; NONE triggers
      // an install warning (design §9.4) — that no-warning property is the main
      // asset and must be protected on every change.
      //   - activeTab    : the inspector runs ONLY on a user gesture (toolbar
      //                    click / hotkey / context menu) and ONLY on the current
      //                    tab. This is what replaces host permissions.
      //   - scripting    : inject the picker + resource-card overlay at that
      //                    moment (design §4.1). No persistent content script.
      //   - storage      : UI preferences + the card's dragged position. NOTHING
      //                    about visited pages or inspected resources is stored
      //                    (design §9.3, §10 №10).
      //   - contextMenus : the second entry point — right-click an image / video /
      //                    audio → "What is this element?" (design §4.9). Static
      //                    items, no documentUrlPatterns, so no URL harvesting.
      permissions: ['activeTab', 'scripting', 'storage', 'contextMenus'],

      // Keyboard shortcut. The `commands` key shows NO permission warning and no
      // host access — the command only injects the picker on the active tab under
      // the same activeTab gesture model. Rebind/clear at
      // chrome://extensions/shortcuts (we deliberately ship no in-app rebind form,
      // design §13 №16).
      commands: {
        'open-picker': {
          suggested_key: { default: 'Alt+Shift+A' },
          description: 'Point to an element on this page and inspect its source',
        },
      },

      ...(isFirefox
        ? {
            browser_specific_settings: {
              // Permanent AMO add-on ID on the publisher's real domain. This is an
              // identity, not a URL — it is never fetched — but it must stay STABLE
              // forever: changing it after release makes AMO treat the upload as a
              // brand-new add-on and orphans every existing install.
              gecko: {
                id: 'assets@blockaly.com',
                // MANDATORY for new AMO submissions since 2025-11-03 (Firefox
                // built-in data-consent panel). This extension has NO network path
                // of any kind (no fetch/analytics/update-check, PLAN-2 §10.7) and
                // stores nothing about pages — so it collects nothing: `none`.
                data_collection_permissions: {
                  required: ['none'],
                },
              },
              // Firefox for Android is a real DevTools target; without
              // gecko_android AMO will not mark the add-on Android-compatible.
              gecko_android: {},
            },
          }
        : {}),
    };
  },
});
