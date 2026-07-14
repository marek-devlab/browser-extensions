import { defineConfig } from 'wxt';

// Extension #6 — "Data Format Toolkit" (devdata).
//
// SINGLE PURPOSE: "View and convert structured data" (JSON/JSON5/JSONC/YAML/XML/
// CSV/JWT/JSON Schema). Store listing copy is fixed to one line — "Developer data
// inspector: view, validate and convert structured data" — and every function
// (JWT, converter, schema) lives inside ONE tool page behind tabs. There is
// deliberately no second entry point: the moment JWT gets its own popup this
// stops being an inspector and becomes a bundle (design §1.1).
//
// PERMISSION HONESTY: the install-time manifest asks for exactly `storage`,
// `contextMenus` and `activeTab` — ZERO scary warnings. The two page-touching
// features are OPTIONAL and requested only on a click:
//   - `scripting`     (optional_permissions): "Format JSON on THIS tab". It is a
//                      permission-only request — no host is asked for, because
//                      `activeTab` already granted the host for the current tab
//                      on the toolbar click, so Chrome shows no "read data on all
//                      sites" prompt (design §2.11, §4.3).
//   - `<all_urls>`    (optional_host_permissions): only for the opt-in AUTO
//                      formatter that rewrites application/json pages on
//                      navigation. Gated behind an explicit consent <dialog>.
// NETWORK: none, ever. No fetch/JWKS/analytics. The CSP carries no connect-src.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // Store artifact naming. Without this, `{{name}}` is derived from the
  // package.json name (`@blur/devdata` -> `blurdevdata`). `zip.name` overrides
  // that one template variable, and BOTH `artifactTemplate` and
  // `sourcesTemplate` interpolate it, so the Firefox `-sources.zip` stays
  // consistent for free.
  zip: {
    name: 'data-format-toolkit',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Data Format Toolkit',
      // The listing copy is deliberately "inspector" language. Words like
      // "downloader/grabber/scraper" put us in the wrong review category (design
      // §11) — this description is the single approved phrasing.
      description:
        'Developer data inspector: view, validate and convert structured data — JSON, JSON5/JSONC, YAML, XML, CSV, JWT and JSON Schema. 100% offline, zero network.',

      // Publisher identity. `author` is a plain STRING: Chrome MV3 rejects the
      // legacy `{ email }` object form, and Firefox MV2 also accepts a string,
      // so one value is valid for both targets this function emits.
      author: 'Blockaly',
      homepage_url: 'https://blockaly.com',

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
      // which would be a second entry point and drift toward a bundle (§1.2).
      // `open_in_tab: true` is required, else Firefox renders it in the narrow
      // about:addons frame where the three-column tool cannot fit.
      options_ui: {
        page: 'tool.html#/settings',
        open_in_tab: true,
      },

      // Baseline, install-time permissions — the whole set:
      //   - storage      : UI prefs (sync) + optional cached document (local).
      //   - contextMenus : "Open selection in Data Toolkit" (selection context;
      //                     reads info.selectionText, NO script injection).
      //   - activeTab    : the toolbar click grants the current tab so the popup
      //                     can offer "Format JSON on this tab" without a host
      //                     permission.
      permissions: ['storage', 'contextMenus', 'activeTab'],

      // Requested ONLY on a click, never at install:
      //   - scripting     : lets us run the one-shot in-page formatter on the
      //                     activeTab-granted tab. Permission-only (no host) so
      //                     Chrome shows no broad-access warning (design §4.3).
      //                     NOTE: on Firefox MV2 `scripting` is unnecessary
      //                     (`tabs.executeScript` works from activeTab) — the
      //                     popup button is active immediately there. Declaring
      //                     it as optional is harmless on Firefox.
      optional_permissions: ['scripting'],

      // Requested ONLY behind the explicit consent <dialog> (§2.11), and only
      // for the opt-in auto-formatter. This is the "read and change all your
      // data on all websites" grant — surfaced honestly, never at install.
      optional_host_permissions: ['<all_urls>'],

      ...(isFirefox
        ? {
            browser_specific_settings: {
              // Permanent AMO add-on ID on the publisher's real domain. This is
              // an identity, not a URL — it is never fetched — but it must stay
              // STABLE forever: changing it after release makes AMO treat the
              // upload as a brand-new add-on and orphans every existing install.
              gecko: {
                id: 'devdata@blockaly.com',
                // MANDATORY for new AMO submissions since 2025-11-03 (Firefox
                // built-in data-consent panel). This extension parses data
                // entirely in the tab and transmits NOTHING — no network exists
                // — so the declaration is `none`. (Even JWTs/secrets live only
                // in RAM and are never persisted; see design §7.2.)
                data_collection_permissions: {
                  required: ['none'],
                },
              },
              // Firefox for Android is a target platform (design/PLAN-2 §8:
              // devdata is the best mobile candidate). Without gecko_android AMO
              // will not mark the add-on Android-compatible.
              gecko_android: {},
            },
          }
        : {}),
    };
  },
});
