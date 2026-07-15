import { defineConfig } from 'wxt';

// Extension #10 — "Markdown Workbench".
//
// SINGLE PURPOSE (PLAN.md (Часть II) §6, §10.6): "Write and format text before pasting."
// One phrase a reviewer can write down. Everything the extension does is an
// operation on the ONE markdown draft that is open right now: the regex
// find&replace, the transliterator and the character counter are TABS of the
// editor, not products — they have no icon, no popup, no command and no context
// menu of their own. The moment any of them gets its own entry point the
// manifest stops matching the single phrase and review fails (design §1.1).
//
// PERMISSION HONESTY: the permission list is deliberately tiny and every entry
// is justified below. There is NO `host_permissions`, NO `<all_urls>` content
// script, NO `scripting` broad inject, NO `downloads`, NO `tabs`, NO
// `unlimitedStorage`, NO `clipboardRead`. That keeps install warnings at ZERO.
// The page-extension CSP (`connect-src 'none'`) makes network access technically
// impossible — emoji data, transliteration tables and the markdown parser all
// ship in the bundle (design §7.4).
//
// The `manifest` FUNCTION form is required because the side-panel surface is
// declared with DIFFERENT keys per target: Chrome MV3 `side_panel` (+ the
// `sidePanel` permission), Firefox MV2 `sidebar_action`. Both point at the SAME
// built HTML shell (entrypoints/sidepanel/) — one React app, two manifest keys.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // Store artifact naming. Without this, `{{name}}` is derived from the
  // package.json name (`@blur/compose` -> `blurcompose`). `zip.name` overrides
  // that one template variable, and BOTH artifactTemplate and sourcesTemplate
  // interpolate it, so the Firefox `-sources.zip` stays consistent for free.
  zip: {
    name: 'markdown-workbench',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Markdown Workbench',
      // Single, narrow purpose — reviewers match this against the feature list.
      // Regex / transliteration / counter are listed as "inside the editor",
      // never as standalone tools (design §1.1).
      description:
        'Write and format Markdown for bug reports, GitLab and GitHub — emoji, checkboxes, <details>, tables, plus in-editor find & replace, transliteration and a character counter. 100% local, no network.',

      // Publisher identity. `author` is a plain STRING: Chrome MV3 rejects the
      // legacy `{ email }` object form, and Firefox MV2 also takes a string, so
      // one value is valid for both targets emitted by this manifest function.
      author: 'Blockaly',
      homepage_url: 'https://blockaly.com',

      // Toolbar/store icons. WXT auto-discovers the top-level `icons` map from
      // public/icon/{16,32,48,128}.png; action.default_icon is NOT derived from
      // those files, so it is wired explicitly here. (The PNGs ship in
      // public/icon/.) The action opens the SIDE PANEL, it is
      // NOT a popup: there is no `default_popup` key. On Chrome, clicking the
      // action opens the side panel via the background's
      // `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
      action: {
        default_icon: {
          16: 'icon/16.png',
          32: 'icon/32.png',
          48: 'icon/48.png',
          128: 'icon/128.png',
        },
        default_title: 'Markdown Workbench — open draft',
      },

      // Permission budget (design §0 header):
      //   storage       — drafts + history and prefs (all local:).
      //   contextMenus  — the ONE "Add selection to draft" item (design §S4).
      //   clipboardWrite— "Copy for <platform>" / "Copy as HTML" (design §4.1).
      //   activeTab     — read-only: window.getSelection() + active-tab URL, by
      //                   a user gesture (context menu / "Insert environment").
      //                   Never used to WRITE to the page (design §1.1).
      //   sidePanel     — Chrome only; lets the action open the panel. Injected
      //                   into the array below only for the Chrome build.
      // Chrome needs `sidePanel` to declare/open the side panel; Firefox has no
      // such permission (the sidebar is declared by `sidebar_action`). Two
      // separate literal arrays (not a spread) keep the permission strings
      // narrowly typed for WXT's manifest checker.
      permissions: isFirefox
        ? ['storage', 'contextMenus', 'clipboardWrite', 'activeTab']
        : ['storage', 'contextMenus', 'clipboardWrite', 'activeTab', 'sidePanel'],

      // ── SIDE PANEL / SIDEBAR (design §1.2, S1 — the PRIMARY surface) ────────
      // ✅ VERIFIED on a real build (design §12 / PLAN.md (Часть II) §11 open question): WXT
      // does NOT auto-generate either key from `entrypoints/sidepanel/`. These
      // manual declarations are what produce them, they do not double-declare,
      // and the built manifests come out exactly right:
      //   chrome-mv3  → "side_panel": { "default_path": "sidepanel.html" }
      //                 + "sidePanel" in permissions
      //   firefox-mv2 → "sidebar_action": { "default_panel": "sidepanel.html" }
      //                 and NO side_panel / sidePanel leakage.
      //
      // Chrome MV3: side_panel.default_path. Firefox MV2: sidebar_action.
      // Both reference the same built shell (sidepanel.html). The panel is
      // GLOBAL, not per-tab (no sidePanel.setOptions({tabId})) — one draft shared
      // across all tabs, which is also the correct product behaviour and the only
      // model Firefox can match (design §1.2).
      ...(isFirefox
        ? {
            sidebar_action: {
              default_title: 'Markdown Workbench',
              default_panel: 'sidepanel.html',
              default_icon: {
                16: 'icon/16.png',
                32: 'icon/32.png',
              },
            },
          }
        : {
            side_panel: {
              default_path: 'sidepanel.html',
            },
          }),

      ...(isFirefox
        ? {
            browser_specific_settings: {
              // Permanent AMO add-on ID, on the publisher's real domain
              // (blockaly.com). This is an identity, not a URL — never fetched —
              // but it must stay STABLE forever: changing it after release makes
              // AMO treat the upload as a brand-new add-on and orphans every
              // existing install.
              gecko: {
                id: 'compose@blockaly.com',
                // MANDATORY for new AMO submissions since 2025-11-03 (Firefox
                // built-in data-consent panel). Markdown Workbench transmits
                // nothing: the draft is composed, previewed and stored entirely
                // in local storage; there is not a single network request. The
                // honest declaration is therefore the `none` sentinel, which
                // tells Firefox to render "does not collect data".
                data_collection_permissions: {
                  required: ['none'],
                },
              },
              // ⚠️ Firefox for Android has NO SIDEBAR — `sidebar_action` is
              // ignored there, and Chrome for Android has no extensions at all.
              // That is why `entrypoints/workbench/` (a full extension PAGE)
              // exists and why the toolbar action feature-detects and opens it
              // in a tab when no panel/sidebar API is present
              // (utils/surface.ts). Without gecko_android AMO will not mark the
              // add-on Android-compatible.
              gecko_android: {},
            },
          }
        : {}),

      // 🔴 ZERO NETWORK, MECHANICALLY (design §7.4). `connect-src 'none'` makes
      // fetch/XHR/WebSocket impossible from every extension page — it is not a
      // promise in a README, it is enforced by the browser. The parser, the
      // sanitizer, the transliteration tables and the emoji data all ship inside
      // the bundle; there is no CDN and no remote code (which would also be an
      // instant store rejection).
      //
      // `img-src 'self' data:` is the OTHER half of "no network": `connect-src`
      // does not govern `<img>`, so without this a preview of `![](http://x/p.gif)`
      // would silently fetch a remote pixel from a privileged page — a tracking
      // egress that contradicts the "100% local" claim. Local and data-URI images
      // still render; a remote image shows as broken rather than phoning home.
      ...(isFirefox
        ? {
            content_security_policy:
              "script-src 'self'; object-src 'self'; img-src 'self' data:; connect-src 'none'",
          }
        : {
            content_security_policy: {
              extension_pages:
                "script-src 'self'; object-src 'self'; img-src 'self' data:; connect-src 'none'",
            },
          }),
    };
  },
});
