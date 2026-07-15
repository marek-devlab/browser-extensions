import { defineConfig } from 'wxt';

// Extension #5 — "Capture Studio" (capture).
//
// SINGLE PURPOSE (design capture.md §0, PLAN-2 §1): "Record a tab and export
// media." Everything the extension does is an operation on ONE captured clip or
// screenshot: recording, trim, redaction, watermark, format/resolution/target-
// SIZE conversion. No feature has its own entry point (design §1.1) — it is all
// the popup remote, the recorder window, or the Studio tab.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE TWO-PIPELINE DIVERGENCE — the reason this `manifest` function branches
// hard on `browser`, and the single most important thing to understand here
// (design §1.1, §1.2, §12.3):
//
//   CHROME  (MV3): tabCapture.getMediaStreamId({targetTabId}) in the background
//                  → an OFFSCREEN document (reason USER_MEDIA) owns getUserMedia
//                  + MediaRecorder + writes chunks to IndexedDB. The offscreen
//                  document has NO duration limit and SURVIVES service-worker
//                  eviction (design §5.12, §10.1). Needs `tabCapture` + `offscreen`.
//
//   FIREFOX (MV2): neither `tabCapture` NOR `chrome.offscreen` exist. The
//                  recorder.html WINDOW itself calls getDisplayMedia() (which
//                  requires transient activation → an extra user click + the
//                  browser's own source picker, design §1.5) and owns the stream.
//                  So Firefox declares NEITHER tabCapture nor offscreen — they
//                  would be dead, unjustifiable permission entries.
//
// Which ENTRYPOINTS apply per browser:
//   - entrypoints/offscreen/  → Chrome ONLY (invisible MediaRecorder host).
//   - entrypoints/recorder/   → BOTH, but on Firefox it additionally OWNS the
//                               MediaStream/MediaRecorder; on Chrome it is a
//                               thin remote (timer/pause/stop) over the offscreen.
//   - entrypoints/popup,editor,options, background.ts → both.
//
// NETWORK: none, ever. The extension-pages CSP carries `connect-src 'none'` —
// no analytics, no Sentry, no "check the Discord limit online", no remote fonts
// (design §9.1). A privacy policy is STILL mandatory (design §9.1, PLAN-2 §1.4):
// see IMPLEMENTATION.md.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // Store artifact naming. Without this, `{{name}}` derives from the package.json
  // name (`@blur/capture` -> `blurcapture`). `zip.name` overrides that one
  // template variable, and BOTH artifactTemplate and sourcesTemplate interpolate
  // it, so the Firefox `-sources.zip` stays consistent for free.
  zip: {
    name: 'capture-studio',
  },

  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Capture Studio',
      // "Record" / "capture" / "export" language only — never "downloader" or
      // "grabber", which land the review in the wrong category (design §4.3, §8).
      // The mobile-impossibility line is deliberately in the description
      // (design §8, PLAN-2 §1.5): screen recording does not exist in mobile
      // browsers, and hiding that would be dishonest.
      description:
        'Record a browser tab, take screenshots, then trim, redact, watermark and compress to a target format, resolution or FILE SIZE — 100% local, zero network. (Recording is not possible in mobile browsers.)',

      // Publisher identity. `author` is a plain STRING: Chrome MV3 rejects the
      // legacy `{ email }` object form, and Firefox MV2 also takes a string, so
      // one value is valid for both targets emitted by this manifest function.
      author: 'Blockaly',
      homepage_url: 'https://blockaly.com',

      // Toolbar/store icons. WXT auto-discovers the top-level `icons` map from
      // public/icon/{16,32,48,128}.png; action.default_icon is NOT derived from
      // those files, so it is wired explicitly here. (The 16/32/48/128 png live in
      // public/icon/.) The action opens the popup REMOTE (WXT wires
      // default_popup from entrypoints/popup) — the single gesture that yields
      // `activeTab` and permits `tabCapture` (design §1.1).
      action: {
        default_icon: {
          16: 'icon/16.png',
          32: 'icon/32.png',
          48: 'icon/48.png',
          128: 'icon/128.png',
        },
        default_title: 'Capture Studio',
      },

      // ── GLOBAL SHORTCUTS (design §1.3 channel ②, §11.1) ────────────────────
      // `commands` is a MANIFEST KEY, not a permission — it shows NO install
      // warning and grants NO host access; each command only messages this
      // extension's own background/offscreen. This is the PRIMARY Stop: it works
      // when focus is in the recorded tab, in a fullscreen video, or in another
      // app entirely — everywhere an on-page overlay could not reach (and an
      // overlay is impossible anyway: tabCapture records the composite, so a
      // Stop button would bake into the video — design §1.4). Chrome allows 4
      // suggested bindings; we use exactly 4. Rebind at chrome://extensions/shortcuts.
      commands: {
        'start-recording': {
          suggested_key: { default: 'Alt+Shift+R' },
          description: 'Start recording the current tab',
        },
        'stop-recording': {
          suggested_key: { default: 'Alt+Shift+S' },
          description: 'Stop recording (primary Stop — works from anywhere)',
        },
        'toggle-pause': {
          suggested_key: { default: 'Alt+Shift+P' },
          description: 'Pause / resume the recording',
        },
        screenshot: {
          suggested_key: { default: 'Alt+Shift+A' },
          description: 'Capture a screenshot of the current tab',
        },
      },

      // ── INSTALL-TIME PERMISSIONS ───────────────────────────────────────────
      // All narrow, all serving the one purpose. `commands` is NOT here (it is a
      // key above). The tabCapture/offscreen pair is Chrome-only by physics.
      //   storage          — UI prefs (sync:) + settings (local:). Recording
      //                       chunks do NOT go here; they stream to IndexedDB
      //                       (design §0, §9.6, utils/db.ts).
      //   unlimitedStorage — hours of video as IndexedDB chunks would blow the
      //                       default quota; this lifts it (design §0, §10.3).
      //   downloads        — save the exported file (design §4.1). On Firefox
      //                       this is the ONLY save path (no File System Access,
      //                       design §10.3) so it must revoke object URLs.
      //   activeTab        — the toolbar-click grant that lets tabCapture attach
      //                       to the current tab WITHOUT <all_urls> (design §1.1).
      //   tabCapture       — CHROME ONLY. getMediaStreamId for the active tab.
      //   offscreen        — CHROME ONLY. The invisible document that owns
      //                       MediaRecorder (no DOM in a service worker — §9.5).
      permissions: [
        'storage',
        'unlimitedStorage',
        'downloads',
        'activeTab',
        // Chrome-only capture pipeline. Firefox has neither API (getDisplayMedia
        // from the recorder window replaces both) so declaring them there would
        // be dead, review-flagging permission entries.
        ...(isFirefox ? [] : ['tabCapture', 'offscreen']),
      ],

      // ── OPTIONAL PERMISSIONS (requested from a user gesture, NEVER install) ──
      //   desktopCapture — Chrome only, and ONLY when the user clicks "Record the
      //                    whole screen or a window". Never the default (design
      //                    §0, §3.1). Putting whole-screen capture in REQUIRED
      //                    permissions would trigger a scary install prompt and a
      //                    manual review for a feature most users never touch.
      //                    Firefox has no `desktopCapture` permission — its
      //                    getDisplayMedia picker covers screen/window selection.
      ...(isFirefox ? {} : { optional_permissions: ['desktopCapture'] }),

      // ── EXTENSION-PAGES CSP — the "zero network" guarantee, made structural ──
      // `connect-src 'none'` makes fetch/XHR/WebSocket impossible from any of our
      // pages (design §9.1). `object-src 'self'`. No remote script, style or font.
      // MV3 (Chrome) takes an object keyed by `extension_pages`; MV2 (Firefox)
      // takes a bare string.
      ...(isFirefox
        ? {
            content_security_policy:
              "script-src 'self'; object-src 'self'; connect-src 'none'",
          }
        : {
            content_security_policy: {
              extension_pages:
                "script-src 'self'; object-src 'self'; connect-src 'none'",
            },
          }),

      ...(isFirefox
        ? {
            browser_specific_settings: {
              // Permanent AMO add-on ID on the publisher's real domain. This is
              // an identity, not a URL — it is never fetched — but it must stay
              // STABLE forever: changing it after release makes AMO treat the
              // upload as a brand-new add-on and orphans every existing install.
              gecko: {
                id: 'capture@blockaly.com',
                // MANDATORY for new AMO submissions since 2025-11-03 (Firefox
                // built-in data-consent panel). Capture Studio transmits NOTHING:
                // video/audio is recorded and stored entirely in IndexedDB in the
                // browser profile, and there is not one network request (CSP
                // `connect-src 'none'` above). Honest declaration = `none`.
                data_collection_permissions: {
                  required: ['none'],
                },
              },
              // NO `gecko_android`. Unlike every other add-on in the suite, this
              // one is PHYSICALLY non-functional on mobile: Firefox for Android
              // has neither getDisplayMedia/tab capture nor WebCodecs (design §8,
              // §12.1, PLAN-2 §1.5). Declaring gecko_android would tell AMO the
              // add-on is Android-compatible when it cannot record a single
              // frame there — that is exactly the "don't lie in the manifest"
              // rule (design §8). So it is omitted on purpose.
            },
          }
        : {}),
    };
  },
});
