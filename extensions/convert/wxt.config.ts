import { defineConfig } from 'wxt';

// Extension 11 — "Universal Converter" (PLAN.md Часть III §11).
//
// SINGLE PURPOSE: "Convert the units, currencies, times and dates you see while
// browsing." Units/dates/time-zones/calendars are pure local math; currency and
// crypto are a rate-TABLE fetch so the user's amount is converted LOCALLY and
// never transmitted.
//
// PERMISSION HONESTY: zero broad-host install warning. `omnibox` is a manifest
// KEY, not a permission (no warning; Firefox supports it too). Inline
// selection-conversion injects on the `activeTab` click; the context menu uses
// `contextMenus`. Currency/crypto endpoints send permissive CORS, so the fetch
// needs NO host_permissions — ⚠️ verify live CORS headers before release; if a
// provider drops CORS, move it behind `optional_host_permissions` requested on a
// gesture. Opt-in whole-page auto-annotation is `optional_host_permissions` only,
// never a static <all_urls> content script (WXT manifest-hoist landmine).
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  zip: {
    name: 'universal-converter',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Universal Converter',
      description:
        'Convert units, currencies, crypto, time zones and calendars as you browse. Amounts are converted on your device; only currency rate tables are fetched.',

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

      // `storage` (prefs, cached rate tables, favourites), `activeTab` +
      // `scripting` (inline selection badge on click), `contextMenus`
      // ("Convert selection"). None warns at install.
      permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],

      // Omnibox quick-convert ("cv 5mi to km"). A manifest key, not a permission —
      // no warning; Firefox supports it, so WXT ships it to both.
      omnibox: { keyword: 'cv' },

      // Opt-in whole-page auto-annotation of recognised quantities is requested at
      // runtime; the currency/crypto hosts are listed too in case a provider drops
      // CORS and the fetch must fall back to a granted origin.
      optional_host_permissions: ['https://api.frankfurter.dev/*', 'https://api.coingecko.com/*'],

      ...(isFirefox
        ? {
            browser_specific_settings: {
              gecko: {
                id: 'convert@blockaly.com',
                // Reads nothing about the user; currency rate TABLES are fetched
                // (not the user's amount). Honest declaration is `none`.
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
