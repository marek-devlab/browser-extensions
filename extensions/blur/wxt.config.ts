import { defineConfig } from 'wxt';

// Content Blur.
//
// SINGLE PURPOSE (PLAN.md §0): Chrome Web Store rejects any extension that
// bundles "unrelated functionality". Every feature and every permission below
// must serve one phrase a reviewer can write down: "hide unwanted content on
// web pages". This extension deliberately ships NO network blocking and no
// element-hiding rule lists — blur is the only thing it does. That capability
// lives in a SEPARATE companion extension so each add-on has one narrow purpose.
//
// The `manifest` FUNCTION form is kept even though the two targets are now
// nearly identical: Firefox still needs `browser_specific_settings`, which
// Chrome must not receive.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // Store artifact naming. Without this, `{{name}}` is derived from the
  // package.json name (`@blur/blur` -> `blurblur`), producing
  // `blurblur-1.0.0-chrome.zip`. `zip.name` overrides that one template
  // variable, and BOTH `artifactTemplate` and `sourcesTemplate` interpolate it,
  // so the Firefox `-sources.zip` stays consistent for free.
  zip: {
    name: 'content-blur',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Content Blur',
      // Single, narrow purpose — reviewers match this against the feature list.
      description: 'Blur images, video, thumbnails and matched text on any page.',

      // Publisher identity. `author` is a plain STRING: Chrome MV3 rejects the
      // legacy `{ email }` object form, and Firefox MV2 also takes a string, so
      // one value is valid for both targets emitted by this manifest function.
      author: 'Blockaly',
      homepage_url: 'https://blockaly.com',

      // Toolbar/store icons. WXT auto-discovers the top-level `icons` map from
      // `public/icon/{16,32,48,128}.png`; `action.default_icon` is NOT derived
      // from those files, so it is wired explicitly here (paths resolve to the
      // built extension root, where public/ is copied verbatim).
      action: {
        default_icon: {
          16: 'icon/16.png',
          32: 'icon/32.png',
          48: 'icon/48.png',
          128: 'icon/128.png',
        },
      },

      // `activeTab` + `storage` cover the popup/options round-trip. `contextMenus`
      // powers the right-click "Blur this / Always blur images here" actions — it
      // adds NO host-access warning and no network capability, so it stays within
      // the single purpose. No `scripting`: the block-first stylesheet is injected
      // by the declared `<all_urls>` content script itself (via `applyStylesheet`),
      // never through `scripting.executeScript`, so the permission would be dead
      // weight and an unjustified entry a reviewer must ask about. No
      // network-blocking permission appears here — that belongs to the separate
      // ad-block add-on.
      permissions: ['storage', 'activeTab', 'contextMenus'],

      // Keyboard shortcuts. The `commands` key shows NO permission warning and no
      // host access; every command only toggles this extension's own state or
      // messages the active tab. Users can rebind or clear any of these at
      // chrome://extensions/shortcuts.
      commands: {
        'toggle-global': {
          suggested_key: { default: 'Alt+Shift+B' },
          description: 'Turn Content Blur on or off everywhere',
        },
        'reveal-all': {
          suggested_key: { default: 'Alt+Shift+R' },
          // A TOGGLE. Reveal-all used to be one-way — the only way to re-hide a
          // page was to reload it, which is the slowest possible option at the
          // exact moment you need content off the screen. Press once to look,
          // press again to put it all back.
          description: 'Reveal all blurred content on this page (press again to re-hide)',
        },
        'panic-blur': {
          suggested_key: { default: 'Alt+Shift+P' },
          description: 'Panic: blur all media instantly (toggle)',
        },
      },

      // NO `optional_host_permissions` here — DELIBERATELY REMOVED, do not
      // re-add it. It used to declare `<all_urls>` "for permission
      // minimization", but it was dead weight on two counts:
      //
      //   1. Nothing in this extension ever calls `browser.permissions.request()`
      //      (verified by grep across the repo — only perf and adblock do). An
      //      optional permission that is never requested can never be granted,
      //      so the key changed no runtime behaviour whatsoever.
      //   2. This extension ALREADY has standing access to every site via its
      //      declared `<all_urls>` content script, so even if it were granted it
      //      would add no capability the extension does not already have.
      //
      // What it DID add was review surface: an unjustified all-sites permission
      // entry a store reviewer must ask about ("why does a blur tool want to
      // request every site?"). Pure cost, zero benefit — hence gone.
      //
      // NOTE this reasoning is specific to THIS extension. The adblock package
      // keeps its `optional_host_permissions` because it genuinely needs it:
      // Chrome DNR "unsafe" actions (redirect / modifyHeaders) require GRANTED
      // host_permissions, and a content-script `matches` pattern does NOT
      // satisfy that check.

      // NEVER add `debugger` here. It shows an unremovable "extension is debugging
      // this browser" banner and is a hard review red flag (PLAN.md §0/§14).

      ...(isFirefox
        ? {
            browser_specific_settings: {
              // Permanent AMO add-on ID, on the publisher's real domain
              // (blockaly.com). This is an identity, not a URL — it is never
              // fetched — but it must stay STABLE forever: changing it after
              // release makes AMO treat the upload as a brand-new add-on and
              // orphans every existing install.
              gecko: {
                id: 'blur@blockaly.com',
                // MANDATORY for new AMO submissions since 2025-11-03: Firefox
                // now shows a built-in data-consent panel at install, driven by
                // this key. Omitting it fails review. Content Blur collects
                // nothing — everything it blurs is computed and stored locally —
                // so the honest declaration is the `none` sentinel, which tells
                // Firefox to render "does not collect data".
                data_collection_permissions: {
                  required: ['none'],
                },
              },
              // Firefox for Android is the only real mobile target (PLAN.md §12).
              // Without gecko_android AMO will not mark the add-on Android-compatible.
              gecko_android: {},
            },
          }
        : {}),
    };
  },
});
