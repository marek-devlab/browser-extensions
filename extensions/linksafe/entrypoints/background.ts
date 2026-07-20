import { defineBackground, browser } from '#imports';
import { localeItem } from '../utils/storage';
import { tAt } from '../utils/i18n';
import { stripTrackingParams } from '../utils/analyze';
import type { OverlayMessage } from '../utils/overlay-msg';

// Background (SW on Chrome MV3 / event page on Firefox MV2). 🔴 HOLDS NO STATE and
// makes NO network request. Its only jobs:
//   (a) register the two context-menu items ("Where does this link go?" / "Copy
//       clean link") and re-title them when the UI language changes;
//   (b) inject the local hover/scan overlay (inspector.content.ts) into the active
//       tab in response to a user gesture (context-menu click / popup button).
//
// There is NO persistent content script and NO install-time host permission: the
// overlay is injected via `scripting.executeScript` (Chrome MV3) or the legacy
// `tabs.executeScript` (Firefox MV2) under the `activeTab` grant the gesture issues.
// The network resolve lives entirely in the popup (utils/resolve.ts), behind the
// optional host permission — the background never fetches anything.

// Built path of the runtime-registered overlay content script. WXT emits
// entrypoints/inspector.content.ts here; because it is `registration: 'runtime'` it
// is NOT in the manifest's content_scripts, so it never runs ambiently and adds no
// install warning — but the asset exists for on-gesture injection.
const OVERLAY_FILE = '/content-scripts/inspector.js';

/** Inject the overlay into a tab, using MV3 `scripting` when present and falling
 *  back to MV2 `tabs.executeScript` (Firefox). Idempotent: the overlay guards on a
 *  window flag, so a second injection just re-focuses it. Never throws. */
async function injectOverlay(tabId: number): Promise<boolean> {
  try {
    const scripting = (browser as { scripting?: typeof browser.scripting }).scripting;
    if (scripting?.executeScript) {
      await scripting.executeScript({ target: { tabId }, files: [OVERLAY_FILE] });
    } else {
      const legacy = browser.tabs as unknown as {
        executeScript?: (id: number, details: { file: string }) => Promise<unknown>;
      };
      if (!legacy.executeScript) return false;
      await legacy.executeScript(tabId, { file: OVERLAY_FILE });
    }
    return true;
  } catch {
    // chrome:// / the web store / a PDF viewer etc. cannot be scripted.
    return false;
  }
}

/** Inject (if needed) then hand the overlay a message. */
async function sendToOverlay(tabId: number, message: OverlayMessage): Promise<boolean> {
  const injected = await injectOverlay(tabId);
  if (!injected) return false;
  try {
    await browser.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false;
  }
}

const CTX_WHERE = 'linksafe-where';
const CTX_CLEAN = 'linksafe-clean';

export default defineBackground({
  main() {
    async function setupContextMenus(): Promise<void> {
      if (!browser.contextMenus) return;
      const locale = await localeItem.getValue().catch(() => 'en' as const);
      type Contexts = NonNullable<Parameters<typeof browser.contextMenus.create>[0]['contexts']>;
      const contexts = ['link'] as unknown as Contexts;
      browser.contextMenus.removeAll(() => {
        browser.contextMenus.create({ id: CTX_WHERE, title: tAt(locale, 'ctxWhereGoes'), contexts });
        browser.contextMenus.create({ id: CTX_CLEAN, title: tAt(locale, 'ctxCopyClean'), contexts });
      });
    }
    void setupContextMenus();
    browser.runtime.onInstalled.addListener(() => void setupContextMenus());
    // Re-title live when the language changes on the popup.
    localeItem.watch(() => void setupContextMenus());

    browser.contextMenus?.onClicked.addListener((info, tab) => {
      const tabId = tab?.id;
      const linkUrl = info.linkUrl;
      if (typeof tabId !== 'number' || !linkUrl) return;
      // The click on the menu item is the gesture that grants activeTab.
      if (info.menuItemId === CTX_WHERE) {
        void sendToOverlay(tabId, { type: 'linksafe:inspect', url: linkUrl });
      } else if (info.menuItemId === CTX_CLEAN) {
        const { cleanUrl } = stripTrackingParams(linkUrl);
        void sendToOverlay(tabId, { type: 'linksafe:copy', text: cleanUrl });
      }
    });

    // From the popup's "Scan this page" button (popup is shown from the toolbar
    // gesture, so activeTab is live for the target tab). The popup sends the tabId;
    // we inject the overlay and start a full scan.
    browser.runtime.onMessage.addListener(
      (message: { type?: string; tabId?: number }, _sender, sendResponse: (ok: boolean) => void) => {
        if (message.type === 'linksafe:startScan' && typeof message.tabId === 'number') {
          void sendToOverlay(message.tabId, { type: 'linksafe:scan' }).then(sendResponse);
          return true; // async responder — keep the channel open.
        }
        return undefined;
      },
    );
  },
});
