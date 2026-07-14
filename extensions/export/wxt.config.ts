import { defineConfig } from 'wxt';

// Extension #7 — "Page Content Exporter".
//
// SINGLE PURPOSE: "Save page content to a file." Selected text → .txt/.md; an
// HTML <table> → .csv/.xlsx; images → copy URL / open in a new tab / save.
//
// 🥇 THE PRODUCT ASSET IS ZERO INSTALL WARNINGS (docs/design/export.md §0). Every
// manifest decision below is checked against one question: "does this add the
// 'Read and change all your data on all websites' line?" If yes, it is rejected.
// That is why there is NO persistent content script and NO host_permissions:
//   - No `content_scripts`, no `matches`, no `<all_urls>`.
//   - The page is only ever touched on a user GESTURE, by injecting `engine.js`
//     with `scripting.executeScript` under an `activeTab` grant.
// The consequence (we cannot know which element was right-clicked, so table
// export is a "pick a table" mode) is designed for, not fought — see the design
// doc §0 / §1.2.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // Store artifact naming. Without this `{{name}}` derives from the package name
  // (`@blur/export` -> `blurexport`). `zip.name` overrides that one template
  // variable; both artifactTemplate and sourcesTemplate interpolate it, so the
  // Firefox `-sources.zip` stays consistent for free.
  zip: {
    name: 'page-content-exporter',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Page Content Exporter',
      // 🔴 The listing copy NEVER says "download" / "downloader" / "save video"
      // (PLAN-2 §10.2, §4.1): CWS review reads intent from metadata, not just
      // code. We "save" and "open"; we never "download". No video handling at all.
      description:
        'Save selected text as .md/.txt, an HTML table as .csv/.xlsx, and copy or open image URLs. Everything is built locally in your browser; nothing is sent anywhere.',

      // Publisher identity. Plain STRING (Chrome MV3 rejects the legacy {email}
      // object form; Firefox MV2 also takes a string).
      author: 'Blockaly',
      homepage_url: 'https://blockaly.com',

      // Toolbar/store icons. WXT auto-discovers the top-level `icons` map from
      // public/icon/{16,32,48,128}.png; `action.default_icon` is NOT derived from
      // those, so it is wired explicitly. (Icons are TODO — see public/icon/.gitkeep.)
      action: {
        default_icon: {
          16: 'icon/16.png',
          32: 'icon/32.png',
          48: 'icon/48.png',
          128: 'icon/128.png',
        },
      },

      // BASELINE PERMISSIONS — none of these produces an install warning
      // (https://developer.chrome.com/docs/extensions/reference/permissions-list):
      //   - contextMenus : the PRIMARY surface. The whole product lives in the
      //                    right-click menu (design §1.1).
      //   - activeTab    : grants one-shot access to the current tab ON A GESTURE
      //                    (menu click / toolbar click). This is what lets us read
      //                    the selection/table WITHOUT a standing content script.
      //   - scripting    : used to INJECT `engine.js` on demand under that
      //                    activeTab grant — the picker overlay and the table/
      //                    selection reader. It is NOT a persistent content script;
      //                    nothing runs on a page until the user asks. Injecting on
      //                    gesture (vs. declaring a content script) is the entire
      //                    reason there is no broad-host warning (design §0).
      //   - storage      : CSV/xlsx/filename/theme preferences only.
      //   - clipboardWrite: "Copy image URL" / "Copy as Markdown" — no warning.
      permissions: [
        'contextMenus',
        'activeTab',
        'scripting',
        'storage',
        'clipboardWrite',
      ],

      // OPTIONAL, requested only from the options page when the user opts in to
      // saving cross-origin images (design §5.9 / §7.3). `<a download>` ignores the
      // download attribute for cross-origin URLs, so without this the only honest
      // options are "open the image" or a CORS fetch. Kept OPTIONAL so the baseline
      // install stays warning-free; `permissions.request(['downloads'])` adds the
      // "Manage your downloads" line only for users who ask for it.
      optional_permissions: ['downloads'],

      // 🔴 host_permissions: [] and content_scripts: [] — deliberately absent. Do
      // not add either; they would trade the product's core asset (design §0).

      // `engine.js` (scanner + keyboard picker overlay + preview mount) and
      // `xlsx.js` (the second-stage write-excel-file writer, injected ONLY when
      // .xlsx is chosen — design §0) are injected by `scripting.executeScript`, so
      // they must be web-accessible. Declared in MV3 object form; WXT rewrites it
      // to the MV2 shape for the Firefox build.
      web_accessible_resources: [
        { resources: ['engine.js', 'xlsx.js'], matches: ['<all_urls>'] },
      ],

      // Optional keyboard shortcut → "pick a table" mode (design §1.1). A command,
      // not a content script, so it costs no warning.
      commands: {
        'pick-table': {
          suggested_key: { default: 'Alt+Shift+E' },
          description: 'Export a table on this page (enter table-pick mode)',
        },
      },

      ...(isFirefox
        ? {
            browser_specific_settings: {
              // Permanent AMO add-on ID on the publisher's real domain. Identity,
              // not a URL — never fetched — but must stay STABLE forever: changing
              // it after release makes AMO treat the upload as a brand-new add-on
              // and orphans every existing install.
              gecko: {
                id: 'export@blockaly.com',
                // MANDATORY for new AMO submissions since 2025-11-03 (data-consent
                // panel). This extension READS the selection/table only on a
                // gesture and builds the file locally; it never transmits anything.
                // Reading is not collecting, so the declaration is `none`. There is
                // also no broad-host warning here at all (no content script).
                data_collection_permissions: {
                  required: ['none'],
                },
              },
              // Firefox for Android compatibility flag.
              gecko_android: {},
            },
          }
        : {}),
    };
  },
});
