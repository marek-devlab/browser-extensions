import { defineConfig } from 'wxt';

// Ad & Tracker Blocker.
//
// SINGLE PURPOSE (PLAN.md §0): the Chrome Web Store rejects "bundles of
// unrelated functionality". Every permission below serves one phrase a reviewer
// can write down: "block ads and trackers". Content blurring and the developer
// toolkit are SEPARATE companion extensions in this suite, each with its own
// narrow purpose — never merged into this package.
//
// THIS IS THE MOST IMPORTANT CROSS-BROWSER FILE IN THE REPO. The two targets do
// not differ by a manifest key or two — they run fundamentally different
// blocking engines, because Mozilla and Google diverged in MV3:
//
//   - Chrome MV3 removed blocking `webRequest`. All request blocking is
//     DECLARATIVE: rules are shipped as JSON and evaluated by the browser
//     itself (declarativeNetRequest). The extension never sees the request, so
//     it can neither block in JS nor count matches reliably (see background.ts).
//   - Firefox MV3 KEPT blocking `webRequest.onBeforeRequest` alongside DNR
//     (PLAN.md §4.2). So Firefox gets a per-request JS engine that both blocks
//     AND counts EXACTLY — the same thing uBlock Origin (not Lite) does.
//
// The `manifest` FUNCTION form is mandatory here: the permission SETS differ,
// not just a settings block.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // Store artifact naming. Without this, `{{name}}` is derived from the
  // package.json name (`@blur/adblock` -> `bluradblock`), producing
  // `bluradblock-1.0.0-chrome.zip`. `zip.name` overrides that one template
  // variable, and BOTH `artifactTemplate` and `sourcesTemplate` interpolate it,
  // so the Firefox `-sources.zip` stays consistent for free.
  zip: {
    name: 'ad-tracker-blocker',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Ad & Tracker Blocker',
      // Single, narrow purpose — reviewers match this against the feature list.
      description: 'Block ads and trackers.',

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

      // Host access is OPTIONAL, requested at the moment a feature needs it —
      // NOT required at install time. Reduces the "Purple Potassium" (excessive
      // permissions) review surface (PLAN.md §14).
      //
      // THIS KEY IS LOAD-BEARING HERE — unlike in the blur extension, where the
      // equivalent key was removed as dead. It stays for two concrete reasons:
      //   - This extension DOES call `browser.permissions.request()` at runtime,
      //     so the optional grant can actually be obtained.
      //   - Chrome's DNR treats `redirect` and `modifyHeaders` as "unsafe"
      //     actions and will only apply them on origins for which the extension
      //     holds GRANTED host_permissions. A content-script `matches` pattern
      //     does NOT satisfy that check, so without this key the dynamic
      //     param-stripping redirect rules silently never fire.
      optional_host_permissions: ['<all_urls>'],

      ...(isFirefox
        ? {
            // FIREFOX: per-request JS engine. `webRequest` + `webRequestBlocking`
            // give WebRequestBackend the ability to cancel requests in
            // `onBeforeRequest` and count every one EXACTLY — for both network
            // blocks and trackers. No declarativeNetRequest keys here: Firefox
            // does not need declarative rulesets when it can block imperatively.
            permissions: [
              'storage',
              'activeTab',
              'scripting',
              'webRequest',
              'webRequestBlocking',
              // REVIEW TRADEOFF (AMO): blocking `webRequest` can only CANCEL a
              // request if the extension has host access to it. Without a host
              // permission the `onBeforeRequest` listener runs but every
              // `{cancel:true}` is a no-op — Firefox would block NOTHING. In MV2
              // this host access is an install-time `permissions` entry;
              // `optional_host_permissions` is an MV3 concept that WXT drops for
              // MV2, so the runtime `permissions.request()` path in
              // `utils/permissions.ts` has nothing to request against on Firefox
              // and `<all_urls>` MUST be granted here. This is expected and defensible for an ad
              // blocker: to block ads on every site it needs to see requests on
              // every site. Chrome does NOT get this — its DNR engine blocks
              // declaratively without a broad host grant.
              '<all_urls>',
              // Batched stats flush on a ≥30s tick — the MV3-style worker can be
              // torn down between events (PLAN.md §2, §5).
              'alarms',
              // Right-click "Block this element" / "Pause on this site" (feature
              // §5). NOT a host permission — adds no broad access.
              'contextMenus',
            ],
            browser_specific_settings: {
              // Permanent AMO add-on ID, on the publisher's real domain
              // (blockaly.com). This is an identity, not a URL — it is never
              // fetched — but it must stay STABLE forever: changing it after
              // release makes AMO treat the upload as a brand-new add-on and
              // orphans every existing install.
              gecko: {
                id: 'adblock@blockaly.com',
                // MANDATORY for new AMO submissions since 2025-11-03 (Firefox
                // built-in data-consent panel). This extension sees every
                // request on every site in order to block ads, but it does not
                // COLLECT any of that: matching and counting happen in-process,
                // only aggregate counters land in local storage, and nothing is
                // ever transmitted. So `none` is the accurate declaration —
                // broad ACCESS is not the same as data COLLECTION.
                data_collection_permissions: {
                  required: ['none'],
                },
              },
              // Firefox for Android keeps blocking webRequest too, so the
              // adblocker there is actually MORE capable than desktop Chrome
              // (PLAN.md §12). Without gecko_android AMO will not mark the
              // add-on Android-compatible.
              gecko_android: {},
            },
          }
        : {
            // CHROME / CHROMIUM: declarative engine. DnrBackend toggles the
            // static rulesets below; the browser evaluates them. There is no
            // blocking webRequest to request.
            //
            // `declarativeNetRequestFeedback` is DELIBERATELY NOT requested. It
            // would only unlock `onRuleMatchedDebug`, which fires in unpacked/
            // dev mode ONLY and can never back a shipped counter — so it buys
            // nothing while widening the permission surface (see background.ts).
            //
            // `debugger` NEVER appears in this extension. It is a hard review
            // red flag ("why does an ad blocker debug my browser?") and belongs
            // only to the separate Web Dev Toolkit.
            permissions: [
              'storage',
              'activeTab',
              'scripting',
              'declarativeNetRequest',
              // Needed for the DYNAMIC rules DnrBackend adds: per-site
              // `allowAllRequests` allowlisting and the `redirect` param-stripping
              // rule act on request URLs, which requires host access. Paired with
              // `optional_host_permissions` below (granted per site at runtime),
              // never a blanket install-time host grant (PLAN.md §14).
              'declarativeNetRequestWithHostAccess',
              // Batched stats flush on a ≥30s alarm; the service worker dies after
              // ~30s idle so counters must never be written per-event (PLAN.md §5).
              'alarms',
              // Right-click "Block this element" / "Pause on this site" (feature
              // §5). NOT a host permission — adds no broad access.
              'contextMenus',
            ],

            // Bundled static rulesets, toggled per strictness level at runtime
            // via updateEnabledRulesets(). `path` resolves relative to the BUILT
            // extension root, so the JSON must ship in `public/` (copied verbatim
            // to the root), NOT be bundled/transformed by the build.
            declarative_net_request: {
              rule_resources: [
                {
                  id: 'easylist',
                  enabled: true,
                  path: 'rules/easylist.json',
                },
                {
                  id: 'easyprivacy',
                  enabled: true,
                  path: 'rules/easyprivacy.json',
                },
                {
                  id: 'annoyances',
                  // Off by default; enabled only at the `aggressive` level.
                  enabled: false,
                  path: 'rules/annoyances.json',
                },
              ],
            },
          }),
    };
  },
});
