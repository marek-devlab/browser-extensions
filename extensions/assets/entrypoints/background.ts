import { defineBackground, browser } from '#imports';

// Background (SW / event page). 🔴 HOLDS NO STATE AT ALL (design §1.4, §10.1): its
// only jobs are (a) register the context-menu items and (b) inject the inspector
// overlay into the active tab in response to a USER GESTURE. The card lives in the
// page, the HAR log lives in the DevTools panel — both are places that outlive the
// ~30s service-worker eviction, so there is nothing here to lose or mirror.
//
// The inspector is injected via `scripting.executeScript` under `activeTab`, which
// is granted by the toolbar click / hotkey / context-menu click for that one tab.
// There is NO persistent content script and NO host permission (design §13 №7).

// Built path of the runtime-registered inspector content script. WXT emits
// entrypoints/inspector.content.ts to /content-scripts/inspector.js; because it is
// `registration: 'runtime'` it is NOT in the manifest's content_scripts (so it
// never runs ambiently and adds no install warning), but the asset exists for
// on-gesture injection here.
const INSPECTOR_FILE = '/content-scripts/inspector.js';

// Idempotent: a second injection just restarts the picker (the overlay guards on a
// window flag — design §10.6), so we never plant two overlays.
async function injectInspector(tabId: number, srcUrl?: string): Promise<void> {
  try {
    // ⚠️ Firefox <109 (MV2) has no `browser.scripting`, so an extension whose only
    // injection path is `scripting.executeScript` silently does nothing there. Fall
    // back to the historical `tabs.executeScript` — the sibling `export` extension
    // uses the same guard (utils/inject.ts).
    const scripting = (browser as { scripting?: typeof browser.scripting }).scripting;
    if (scripting?.executeScript) {
      await scripting.executeScript({ target: { tabId }, files: [INSPECTOR_FILE] });
    } else {
      const legacy = browser.tabs as unknown as {
        executeScript?: (id: number, details: { file: string }) => Promise<unknown>;
      };
      if (!legacy.executeScript) throw new Error('no injection API available');
      await legacy.executeScript(tabId, { file: INSPECTOR_FILE });
    }
    // Hand the (optional) right-clicked src to the overlay so the context-menu
    // path can pre-match the element (design §4.9). This is the ONLY thing that
    // travels to the page, and only on an explicit user action.
    await browser.tabs.sendMessage(tabId, { type: 'assets:start', srcUrl }).catch(() => {
      // Overlay may not have finished booting; it also self-starts on inject.
    });
  } catch {
    // chrome:// / addons pages / PDF viewer etc. cannot be scripted — nothing to do.
  }
}

export default defineBackground({
  main() {
    // Context menu (design §4.9): "What is this element?" on media + page contexts.
    // 🔴 No `download`/`save` wording anywhere. removeAll-before-create keeps it
    // idempotent across SW restarts. contextMenus is not a host permission.
    function setupContextMenus(): void {
      if (!browser.contextMenus) return;
      type Contexts = NonNullable<Parameters<typeof browser.contextMenus.create>[0]['contexts']>;
      const contexts = ['image', 'video', 'audio', 'page'] as unknown as Contexts;
      browser.contextMenus.removeAll(() => {
        browser.contextMenus.create({
          id: 'inspect-element',
          title: 'What is this element?',
          contexts,
        });
      });
    }
    setupContextMenus();
    browser.runtime.onInstalled.addListener(setupContextMenus);

    browser.contextMenus?.onClicked.addListener((info, tab) => {
      if (info.menuItemId !== 'inspect-element' || !tab?.id) return;
      // The click on the menu item is the gesture that grants activeTab.
      void injectInspector(tab.id, info.srcUrl);
    });

    // Hotkey (Alt+Shift+A). Same gesture model — inject into the active tab.
    browser.commands?.onCommand.addListener((command) => {
      if (command !== 'open-picker') return;
      void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.id) void injectInspector(tab.id);
      });
    });

    // From the popup's "Point to an element" button. The popup is shown from the
    // toolbar-click gesture, so activeTab is live for the target tab; the popup
    // sends the tabId and closes itself so the user can click the page (design §4.1).
    browser.runtime.onMessage.addListener(
      (message: { type?: string; tabId?: number }, _sender, sendResponse) => {
        if (message.type === 'assets:openPicker' && typeof message.tabId === 'number') {
          void injectInspector(message.tabId).then(() => sendResponse(true));
          return true; // async responder — keep the channel open.
        }
        return undefined;
      },
    );
  },
});
