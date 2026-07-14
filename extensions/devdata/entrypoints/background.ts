import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';

// The service worker is almost empty by design (§8): its ONLY jobs are the
// context-menu item and opening the tool page. No parsing ever happens here — the
// SW has no DOM and no Highlight API, and MV3 kills it after ~30s idle, so any
// heavy work would be truncated mid-document. All parsing lives in a Worker on
// the tool page instead.
//
// MV3 survival rules baked in (design §8):
//   - `contextMenus.onClicked` is registered at the TOP LEVEL, not inside an
//     async callback — otherwise, after the SW is recycled, the menu would
//     silently stop working (the classic MV3 footgun).
//   - The menu item is (re)created in BOTH `runtime.onInstalled` AND on SW
//     startup, so a recycled worker restores it.
//   - No state is held in SW memory.

const MENU_ID = 'devdata-open-selection';

const TOOL_URL = '/tool.html';

/** Open the tool page in a new tab. `route` targets a tab via the hash router. */
async function openTool(route: 'data' | 'jwt' | 'schema' | 'settings' = 'data'): Promise<void> {
  await browser.tabs.create({ url: browser.runtime.getURL(`${TOOL_URL}#/${route}`) });
}

function createMenu(): void {
  // `contexts: ['selection']` — the item appears only when text is selected. We
  // read `info.selectionText` directly; we do NOT inject a script to grab the
  // selection (design §1.2 — no host access needed for this path).
  browser.contextMenus.create(
    {
      id: MENU_ID,
      title: 'Открыть выделенное в Data Toolkit',
      contexts: ['selection'],
    },
    () => {
      // Swallow the "duplicate id" error when the item already exists (created on
      // both install and startup). `runtime.lastError` must be read to silence it.
      void browser.runtime.lastError;
    },
  );
}

export default defineBackground(() => {
  // Recreate on install/update.
  browser.runtime.onInstalled.addListener(() => {
    createMenu();
  });
  // ...and on every SW startup, so a recycled worker restores the menu.
  createMenu();

  // TOP-LEVEL click handler — see the MV3 note above.
  browser.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== MENU_ID) return;
    // TODO_LOGIC: devdata — hand `info.selectionText` to the tool page (via a
    // one-shot `storage.session` handoff or a query the tool reads on load) so
    // the selected text opens pre-filled. For the scaffold we just open the tool.
    void openTool('data');
  });

  // The popup also opens the tool directly; this message path lets any surface
  // ask the SW to open it (e.g. a future keyboard command).
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === 'openTool'
    ) {
      const route = (message as { route?: 'data' | 'jwt' | 'schema' | 'settings' }).route;
      void openTool(route ?? 'data');
    }
    return undefined;
  });
});
