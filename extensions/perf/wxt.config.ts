import { defineConfig } from 'wxt';

// Extension — "Page Performance & Network".
//
// SINGLE PURPOSE (PLAN.md §0): "Measure page performance." This extension exists
// SEPARATELY from the SEO & accessibility auditor for one reason: the `debugger`
// permission. `debugger` grants full CDP access and shows a non-dismissable
// "extension is debugging this browser" banner — it is only defensible in the one
// package whose stated purpose is measuring real transferred bytes over CDP. A
// meta-tag inspector shipping `debugger` invites the reviewer's obvious question,
// so the auditor lives in its own extension and gets by on `activeTab` +
// `scripting`. The two share `packages/core` but ship as separate builds.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // Store artifact naming. Without this, `{{name}}` is derived from the
  // package.json name (`@blur/perf` -> `blurperf`), producing
  // `blurperf-1.0.0-chrome.zip`. `zip.name` overrides that one template
  // variable, and BOTH `artifactTemplate` and `sourcesTemplate` interpolate it,
  // so the Firefox `-sources.zip` stays consistent for free.
  zip: {
    name: 'page-performance-network',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Page Performance & Network',
      description: 'Measure Core Web Vitals and inspect network traffic.',

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

      // Base install-time permissions. All narrow, all serving the one purpose.
      // No `webRequest` on Firefox: its `webRequest.onCompleted` exposes no
      // response-size field (verified against MDN), so there is no accurate byte
      // path to build on it — Firefox falls back to Resource Timing (PLAN.md §8).
      permissions: ['storage', 'activeTab', 'scripting'],

      // Optional permissions, requested at runtime from a user gesture — never at
      // install (PLAN.md §0/§8/§14):
      //   - Chrome: `debugger` grants full CDP access and shows a non-dismissable
      //     "extension is debugging this browser" banner. Requested from the popup
      //     only when the user chooses exact byte measurement. Plus the PSI host,
      //     requested when an audit runs.
      //   - Firefox: no chrome.debugger (bugzilla 1323098, WONTFIX) and no
      //     webRequest size field, so no exact-byte permission is needed — only the
      //     PSI host. MV2 declares optional origins under `optional_permissions`.
      ...(isFirefox
        ? { optional_permissions: ['https://www.googleapis.com/*'] }
        : {
            optional_permissions: ['debugger'],
            optional_host_permissions: ['https://www.googleapis.com/*'],
          }),

      ...(isFirefox
        ? {
            browser_specific_settings: {
              // Permanent AMO add-on ID, on the publisher's real domain
              // (blockaly.com). This is an identity, not a URL — it is never
              // fetched — but it must stay STABLE forever: changing it after
              // release makes AMO treat the upload as a brand-new add-on and
              // orphans every existing install.
              gecko: {
                id: 'perf@blockaly.com',
                // MANDATORY for new AMO submissions since 2025-11-03 (Firefox
                // built-in data-consent panel).
                //
                // This is the ONE extension in the suite that transmits
                // anything. All local measurement (Web Vitals, Resource Timing)
                // collects nothing, hence `required: ['none']` — installing it
                // sends no data anywhere.
                //
                // The opt-in PageSpeed Insights audit sends the URL being
                // audited to Google's PSI API. A page URL the user is acting on
                // is `websiteActivity`, and it is declared OPTIONAL because it
                // is gated behind an explicit user gesture and a runtime
                // `permissions.request()` for the PSI host — exactly the
                // required/optional split this key exists to express. Declaring
                // it here keeps the Firefox consent panel consistent with
                // PRIVACY.md instead of contradicting it.
                data_collection_permissions: {
                  required: ['none'],
                  optional: ['websiteActivity'],
                },
              },
              // Firefox for Android is the only real mobile devtools target
              // (PLAN.md §12). Without gecko_android AMO will not mark the add-on
              // Android-compatible.
              gecko_android: {},
            },
            // Firefox has no chrome.debugger and no CDP, and its webRequest events
            // report no response size, so there is no accurate byte path here — it
            // falls back to Resource Timing (PLAN.md §8). `world: 'MAIN'` content
            // scripts (used for vitals) are valid in Firefox MV2 128+.
          }
        : {}),
    };
  },
});
