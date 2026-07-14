import { browser } from '#imports';

// Registers the "Assets" tab in DevTools. WXT emits the unlisted panel page at
// /panel.html (from entrypoints/panel/). The panel is the 🥉 upgrade surface: it
// shows exactly what a content script cannot — request INITIATORS, redirect chains,
// exact MIME and HTTP status (design §1.2, §2.5). Empty icon is fine for panels.
browser.devtools.panels.create('Assets', '', '/panel.html');
