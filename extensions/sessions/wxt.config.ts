import { defineConfig } from 'wxt';

// Extension 14 — "Session Saver" (PLAN.md Часть III §14).
//
// SINGLE PURPOSE: "Save your open tabs as a named session and restore them later —
// stored only on this device." No cloud, no account, no sync — that is the whole
// differentiator (there is nothing to sell, sync, breach, or subpoena).
//
// PERMISSION HONESTY: the `tabs` permission unavoidably prints "Read your browsing
// history" at install — reading tab URLs/titles to save them REQUIRES it and
// `activeTab` only exposes the active tab. We OWN that warning honestly (in-popup
// microcopy explains it) rather than dodge it, exactly as OneTab/Session Buddy do.
// Every OTHER capability is OPTIONAL and requested on a gesture: `tabGroups` (its
// own "View and manage your tab groups" warning), `sessions`, `unlimitedStorage`
// (silent), and on Firefox `cookies` (container restore). No host_permissions, no
// content scripts, no `downloads` (export uses a Blob + <a download> from an
// extension page).
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  zip: {
    name: 'session-saver',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Session Saver',
      description:
        'Save your open tabs as named sessions and restore them anytime — stored only on this device. No account, no cloud, nothing leaves your browser.',

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

      // `tabs` = core (read URL/title to save & restore) → the one unavoidable
      // "Read your browsing history" warning. `storage` (local sessions),
      // `alarms` (MV3 auto-save heartbeat) are silent.
      permissions: ['tabs', 'storage', 'alarms'],

      // Requested on a gesture only, so the baseline install shows ONE warning,
      // not several. tabGroups (restore group name/colour) carries its own
      // warning; sessions (recently-closed) folds into the tabs warning;
      // unlimitedStorage is silent; cookies (Firefox container restore) is silent.
      optional_permissions: isFirefox
        ? ['sessions', 'cookies', 'unlimitedStorage']
        : ['tabGroups', 'sessions', 'unlimitedStorage'],

      ...(isFirefox
        ? {
            browser_specific_settings: {
              gecko: {
                id: 'sessions@blockaly.com',
                // Sessions are stored locally and never transmitted. Reading tab
                // URLs to save them is not "collection" under the local-only model
                // → honest declaration is `none`.
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
