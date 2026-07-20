import { defineConfig } from 'wxt';

// Extension 13 — "Vision Simulator" (PLAN.md Часть III §13).
//
// SINGLE PURPOSE: "See any web page the way people with colour-blindness and low
// vision see it." A read-only, on-demand visual simulator — it applies SVG/CSS
// filters to the active tab and removes them again; it persists nothing on the
// page and reads no page data.
//
// PERMISSION HONESTY — the strongest possible fit for the minimal-permission moat:
// unlike Content Blur there is NO privacy/FOUC imperative (a simulation applying a
// few hundred ms after load is fine), so there is NO justification for an
// <all_urls> document_start content script. Everything runs by PROGRAMMATIC
// injection from the popup on a toolbar click under `activeTab` — so the install
// shows ZERO broad-host warning. Do NOT add a declared content script: WXT would
// hoist its runtime `matches` into install-time host_permissions (see the repo's
// wxt-all-urls-manifest-hoist landmine) and reintroduce the warning. Audit the
// BUILT manifest.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  zip: {
    name: 'vision-simulator',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Vision Simulator',
      description:
        'See any page as people with colour-blindness and low vision do — accurate colour-vision-deficiency, cataract, low-contrast and blur simulation. Nothing is sent anywhere.',

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

      // `activeTab` grants access to the current tab ONLY on the toolbar click,
      // with no install-time warning; `scripting` injects the filter stylesheet +
      // SVG <defs> and removes them. `storage` holds UI prefs (theme, locale, last
      // condition set) only. No host_permissions, no debugger, no network — the
      // simulation is pure local rendering.
      permissions: ['activeTab', 'scripting', 'storage'],

      ...(isFirefox
        ? {
            browser_specific_settings: {
              gecko: {
                // Permanent AMO id on the publisher's real domain. Stable forever.
                id: 'vision@blockaly.com',
                // Mandatory since 2025-11-03 (Firefox data-consent panel). The
                // simulator reads nothing and transmits nothing — it only renders
                // filters over the page — so the honest declaration is `none`.
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
