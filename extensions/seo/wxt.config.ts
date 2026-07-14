import { defineConfig } from 'wxt';

// Extension D — "SEO & Accessibility Auditor".
//
// SINGLE PURPOSE: "Audit page markup and accessibility." This ships as its OWN
// extension, split away from the performance toolkit, precisely so its manifest
// stays trivially reviewable. A meta-tag inspector that asked for `debugger`
// (full CDP access) would be the textbook permission/purpose mismatch that gets
// rejected: "why does an SEO tool need to debug my browser?".
//
// PERMISSION HONESTY: this extension DOES have standing access to every site —
// not via a `host_permissions` entry, but via the declared `<all_urls>` content
// script below (WXT emits it from `entrypoints/content.ts`). That is a
// deliberate design choice: reading markup and running the audit both go through
// that already-injected content script (`browser.tabs.sendMessage`), which is
// why neither needs `activeTab` or `scripting`. So the API `permissions` list is
// just `storage`; the broad-host install warning comes from the content-script
// match pattern, and the copy everywhere states that plainly. Nothing the
// extension reads ever leaves the browser.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // Store artifact naming. Without this, `{{name}}` is derived from the
  // package.json name (`@blur/seo` -> `blurseo`), producing
  // `blurseo-1.0.0-chrome.zip`. `zip.name` overrides that one template
  // variable, and BOTH `artifactTemplate` and `sourcesTemplate` interpolate it,
  // so the Firefox `-sources.zip` stays consistent for free.
  zip: {
    name: 'seo-accessibility-auditor',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'SEO & Accessibility Auditor',
      description:
        'Inspect meta tags, headings, structured data and accessibility issues. Reads page content on all sites to analyze markup; nothing is sent anywhere.',

      // Publisher identity. `author` is a plain STRING: Chrome MV3 rejects the
      // legacy `{ email }` object form, and Firefox MV2 also takes a string, so
      // one value is valid for both targets emitted by this manifest function.
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

      // Only `storage` (cached last report + UI prefs). No `debugger`, no
      // `webRequest`, no `host_permissions`, no `activeTab`, no `scripting`. Page
      // access comes solely from the declared `<all_urls>` content script, which
      // the panel/popup reach by messaging — see the note above.
      permissions: ['storage'],

      // The on-demand axe-core runner (entrypoints/axe-run.ts) is injected into
      // the page by the content script only when an audit runs, so it must be
      // web-accessible. Declared in MV3 object form; WXT converts it to the MV2
      // shape for the Firefox build automatically.
      web_accessible_resources: [
        { resources: ['axe-run.js'], matches: ['<all_urls>'] },
      ],

      // WXT emits the DevTools page from entrypoints/devtools.html; it registers
      // the "SEO & A11y" panel at runtime (see entrypoints/devtools/main.ts).

      ...(isFirefox
        ? {
            browser_specific_settings: {
              // Permanent AMO add-on ID, on the publisher's real domain
              // (blockaly.com). This is an identity, not a URL — it is never
              // fetched — but it must stay STABLE forever: changing it after
              // release makes AMO treat the upload as a brand-new add-on and
              // orphans every existing install.
              gecko: {
                id: 'seo@blockaly.com',
                // MANDATORY for new AMO submissions since 2025-11-03 (Firefox
                // built-in data-consent panel). The auditor READS page markup on
                // every site, but it never transmits it: the report is rendered
                // in the panel and cached in local storage. Reading is not
                // collecting, so the declaration is `none`. The broad-access
                // install warning still comes from the <all_urls> content
                // script — that is a separate, and separately disclosed, thing.
                data_collection_permissions: {
                  required: ['none'],
                },
              },
              // Firefox for Android ships DevTools too; without gecko_android
              // AMO will not mark the add-on Android-compatible.
              gecko_android: {},
            },
          }
        : {}),
    };
  },
});
