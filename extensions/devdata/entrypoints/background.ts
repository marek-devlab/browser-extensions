import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';
import { putHandoff } from '../utils/handoff';
import { localeItem, prefsItem } from '../utils/storage';
import { tAt } from '../utils/i18n';
import { registerAutoFormat, unregisterAutoFormat } from '../utils/format-page';

// The service worker stays almost empty by design (§8). Its whole job:
//   - the context-menu item,
//   - opening the tool page,
//   - keeping the opt-in auto-format registration in step with the PERMISSION,
//   - answering the content script's "am I allowed to render?" question.
//
// 🔴 No parsing here, ever. The SW has no DOM, no Highlight API, and MV3 recycles
// it after ~30 s idle — it would be killed mid-document.
//
// MV3 survival rules baked in:
//   - every listener is registered at the TOP LEVEL of the entrypoint, not
//     inside an async callback: after the SW is recycled the listeners are what
//     wake it, and a listener added later never fires (the classic MV3 footgun).
//   - the menu item is created on install AND on every SW startup.
//   - no state is held in SW memory.

const MENU_ID = 'devdata-open-selection';
const TOOL_URL = '/tool.html';

type Route = 'data' | 'jwt' | 'schema' | 'settings';

async function openTool(route: Route = 'data'): Promise<void> {
  try {
    await browser.tabs.create({ url: browser.runtime.getURL(`${TOOL_URL}#/${route}`) });
  } catch {
    // No window to open into (rare, e.g. all windows closing). Failing to open a
    // tab must not surface as an unhandled rejection in the service worker.
  }
}

async function createMenu(): Promise<void> {
  // Title is localised from the persisted locale (default 'en'). The menu is a
  // non-React surface, so it reads storage directly rather than via a hook.
  const locale = await localeItem.getValue().catch(() => 'en' as const);
  // `contexts: ['selection']` — we read `info.selectionText` directly. No script
  // is injected and no host permission is needed for this path (design §1.2).
  browser.contextMenus.create(
    {
      id: MENU_ID,
      title: tAt(locale, 'bg.menuTitle'),
      contexts: ['selection'],
    },
    () => {
      // Reading lastError silences the benign "duplicate id" from the second
      // create() (install + startup both call it).
      void browser.runtime.lastError;
    },
  );
}

/** Keep the menu title in the current language when the user switches it. */
function refreshMenuTitle(): void {
  void localeItem.getValue().then((locale) => {
    browser.contextMenus.update(MENU_ID, { title: tAt(locale, 'bg.menuTitle') }, () => {
      void browser.runtime.lastError;
    });
  });
}

/** Is the auto-formatter both WANTED (pref) and ALLOWED (permission)? */
async function autoFormatActive(): Promise<boolean> {
  try {
    const [prefs, granted] = await Promise.all([
      prefsItem.getValue(),
      browser.permissions.contains({ origins: ['<all_urls>'] }),
    ]);
    return prefs.autoFormat && granted;
  } catch {
    return false;
  }
}

/** Bring the content-script registration in line with the facts. */
async function syncAutoFormat(): Promise<void> {
  try {
    if (await autoFormatActive()) await registerAutoFormat();
    else await unregisterAutoFormat();
  } catch {
    // A failed registration must not take the SW down. The Settings tab shows
    // the permission FACT regardless, so the UI cannot claim the feature works.
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void createMenu();
    void syncAutoFormat();
  });
  // ...and on every SW startup, so a recycled worker restores both.
  void createMenu();
  void syncAutoFormat();

  // Re-title the menu when the user switches language in the tool's Settings.
  localeItem.watch(() => refreshMenuTitle());

  browser.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== MENU_ID) return;
    void (async () => {
      // Non-credential text travels through `storage.session` (one-shot, cleared
      // on read, never on disk) rather than a URL — a URL would be capped in
      // length, logged in history, and visible in the omnibox.
      //
      // 🔴 A selected JWT is REFUSED by `putHandoff` (it would otherwise sit in
      // extension storage — not the RAM the token invariant promises). When that
      // happens we open the JWT tab so the user pastes it there instead.
      const outcome = info.selectionText
        ? await putHandoff(info.selectionText, 'selection')
        : 'empty';
      await openTool(outcome === 'jwt-skipped' ? 'jwt' : 'data');
    })();
  });

  // Revoked from chrome://extensions? Unregister immediately — otherwise the
  // script would stay registered while the UI says "off" (design §8).
  browser.permissions.onRemoved.addListener(() => {
    void syncAutoFormat();
  });
  browser.permissions.onAdded.addListener(() => {
    void syncAutoFormat();
  });

  browser.runtime.onMessage.addListener((message: unknown) => {
    const type = (message as { type?: string } | null)?.type;

    // The content script asks before rendering unprompted, so a ONE-SHOT
    // injection never surprises the user with a viewer they did not ask for.
    if (type === 'devdata:auto?') {
      return autoFormatActive().then((auto) => ({ auto }));
    }

    if (type === 'openTool') {
      const route = (message as { route?: Route }).route;
      void openTool(route ?? 'data');
      return undefined;
    }

    if (type === 'devdata:sync-autoformat') {
      return syncAutoFormat().then(() => ({ ok: true }));
    }

    return undefined;
  });
});
