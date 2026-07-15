import { browser } from 'wxt/browser';

// Which surface can this build actually show the editor on? (design §1.2 + the
// mobile constraint.)
//
// ⚠️ LOAD-BEARING: the design's primary surface is a side panel, and
// **Firefox for Android has no sidebar at all** — `sidebar_action` is simply not
// honoured there, and Chrome for Android has no extensions whatsoever. So the
// full-page Workbench (`workbench.html`) is not a nicety, it is the ONLY editor
// surface that exists on mobile. Everything routes to it when no panel API is
// present.
//
// 🔴 The choice is made by FEATURE DETECTION, never by sniffing the user agent:
// a UA string is a lie waiting to happen, and a wrong guess here means the user
// clicks the icon and nothing opens at all.

interface SidePanelApi {
  setPanelBehavior?: (o: { openPanelOnActionClick: boolean }) => Promise<void>;
  open?: (o: { windowId?: number; tabId?: number }) => Promise<void>;
}
interface SidebarActionApi {
  open?: () => Promise<void>;
}

export function sidePanelApi(): SidePanelApi | undefined {
  return (browser as unknown as { sidePanel?: SidePanelApi }).sidePanel;
}

export function sidebarActionApi(): SidebarActionApi | undefined {
  return (browser as unknown as { sidebarAction?: SidebarActionApi }).sidebarAction;
}

/** The full-page editor — S2, and the mobile fallback. */
export function workbenchUrl(): string {
  return browser.runtime.getURL('/workbench.html');
}

export async function openWorkbenchTab(): Promise<void> {
  try {
    await browser.tabs.create({ url: workbenchUrl() });
  } catch {
    // Nothing else we can do — but never throw into a click handler.
  }
}

/**
 * Open the editor on the best surface this browser has, from a user gesture:
 *   Chrome desktop  → side panel
 *   Firefox desktop → sidebar
 *   Firefox Android → a tab with the full-page Workbench (no sidebar exists)
 */
export async function openEditor(windowId?: number): Promise<void> {
  const panel = sidePanelApi();
  if (panel?.open) {
    try {
      await panel.open({ windowId });
      return;
    } catch {
      /* fall through to the tab */
    }
  }
  const sidebar = sidebarActionApi();
  if (sidebar?.open) {
    try {
      await sidebar.open();
      return;
    } catch {
      /* fall through to the tab */
    }
  }
  await openWorkbenchTab();
}

/* ── active tab info (design §2.9) ─────────────────────────────────────────*/

export interface ActiveTabInfo {
  url?: string;
  title?: string;
}

export const MSG_ACTIVE_TAB = 'cw:active-tab';

/**
 * Ask the background for the active tab's URL/title, for "Insert environment".
 *
 * ⚠️ `activeTab` is granted by a GESTURE ON THE EXTENSION'S OWN UI (the action
 * click that opened the panel, or the context menu) — not by a click inside the
 * panel. So `tab.url` may legitimately be undefined, and the dialog says so
 * instead of inventing a value. We do NOT add the `tabs` permission to make this
 * always work: a permanent install warning is not worth one table row.
 */
export async function requestActiveTabInfo(): Promise<ActiveTabInfo | null> {
  try {
    const res = (await browser.runtime.sendMessage({ type: MSG_ACTIVE_TAB })) as
      | ActiveTabInfo
      | undefined;
    return res ?? null;
  } catch {
    return null;
  }
}
