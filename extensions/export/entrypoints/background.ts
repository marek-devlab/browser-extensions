import { defineBackground } from '#imports';
import {
  MENU_ROOT,
  MENU_SEL_MD,
  MENU_SEL_TXT,
  MENU_SEL_COPY_MD,
  MENU_SEL_TABLE,
  MENU_IMG_COPY_URL,
  MENU_IMG_OPEN_TAB,
  MENU_IMG_SAVE,
  MENU_TABLE,
  MENU_TABLE_ALL,
  MENU_SETTINGS,
  type EngineCommand,
} from '../utils/messages';

// Background = the only place context menus, routing, tabs.create and
// scripting.executeScript can live (design §0). It holds NO export state: it
// routes a menu click, injects `engine.js` on the granted `activeTab`, and dies.
// 🔴 Nothing heavy here — the SW has no URL.createObjectURL and is killed after
// ~30s (design §9.2). All bytes are born in the injected content script.
//
// SCAFFOLD STATUS: the menu TREE and routing are REAL; the injection payloads are
// stubbed with a marked TODO. "Open image in new tab" and "Settings" are real
// (they need no injection).

export default defineBackground({
  main() {
    /* ---- Context-menu tree (REAL — exactly design §2.1) --------------- */
    // One root with children so Chrome (auto-groups >1 item) and Firefox (does
    // not) render an identical submenu. Each child declares its own `contexts`, so
    // the browser shows only the relevant leaves per right-click target.
    function createMenus(): void {
      const menus = browser.contextMenus;
      if (!menus) return;
      menus.removeAll(() => {
        menus.create({
          id: MENU_ROOT,
          title: '💾 Сохранить контент страницы',
          // The root must appear for every target its children cover.
          contexts: ['selection', 'image', 'page', 'frame'],
        });

        // -- Selection (contexts: ['selection']) ------------------------
        menus.create({
          id: MENU_SEL_MD,
          parentId: MENU_ROOT,
          title: 'Сохранить выделение как .md',
          contexts: ['selection'],
        });
        menus.create({
          id: MENU_SEL_TXT,
          parentId: MENU_ROOT,
          title: 'Сохранить выделение как .txt',
          contexts: ['selection'],
        });
        menus.create({
          id: 'ex-sep-sel-1',
          parentId: MENU_ROOT,
          type: 'separator',
          contexts: ['selection'],
        });
        menus.create({
          id: MENU_SEL_COPY_MD,
          parentId: MENU_ROOT,
          title: 'Копировать как Markdown',
          contexts: ['selection'],
        });
        menus.create({
          id: 'ex-sep-sel-2',
          parentId: MENU_ROOT,
          type: 'separator',
          contexts: ['selection'],
        });
        // If the selection is INSIDE a table, the scanner accounts for it (§4.2).
        menus.create({
          id: MENU_SEL_TABLE,
          parentId: MENU_ROOT,
          title: 'Экспортировать таблицу…',
          contexts: ['selection'],
        });

        // -- Image (contexts: ['image']) 🔴 never "download", never video ---
        menus.create({
          id: MENU_IMG_COPY_URL,
          parentId: MENU_ROOT,
          title: 'Копировать URL картинки', // no ellipsis: instant action
          contexts: ['image'],
        });
        menus.create({
          id: MENU_IMG_OPEN_TAB,
          parentId: MENU_ROOT,
          title: 'Открыть картинку в новой вкладке',
          contexts: ['image'],
        });
        menus.create({
          id: MENU_IMG_SAVE,
          parentId: MENU_ROOT,
          title: 'Сохранить картинку…', // honest refusal on cross-origin (§5.9)
          contexts: ['image'],
        });

        // -- Page / frame (contexts: ['page', 'frame']) -----------------
        // ⚠️ "Экспортировать таблицу…" is ALWAYS visible even with no tables on the
        // page — hiding it dynamically needs a persistent content script (§0). The
        // honest answer to a click on a table-less page is a toast (§5.2).
        menus.create({
          id: MENU_TABLE,
          parentId: MENU_ROOT,
          title: 'Экспортировать таблицу…',
          contexts: ['page', 'frame'],
        });
        menus.create({
          id: MENU_TABLE_ALL,
          parentId: MENU_ROOT,
          title: 'Экспортировать все таблицы…',
          contexts: ['page', 'frame'],
        });

        // -- Settings (every context) -----------------------------------
        menus.create({
          id: 'ex-sep-settings',
          parentId: MENU_ROOT,
          type: 'separator',
          contexts: ['selection', 'image', 'page', 'frame'],
        });
        menus.create({
          id: MENU_SETTINGS,
          parentId: MENU_ROOT,
          title: 'Настройки экспорта…',
          contexts: ['selection', 'image', 'page', 'frame'],
        });
      });
    }

    // Onboarding once on install (design §1.2): a single "select text → right
    // click" card. No "rate us". Opens the options page as the closest scaffold
    // stand-in for a dedicated onboarding page (TODO: real onboarding surface).
    browser.runtime.onInstalled.addListener((details) => {
      createMenus();
      if (details.reason === 'install') {
        // TODO(onboarding): dedicated one-screen page (design §1.2). For now the
        // options page carries the "how it works" copy.
        void browser.runtime.openOptionsPage?.();
      }
    });
    browser.runtime.onStartup?.addListener(createMenus);
    createMenus();

    /* ---- Routing (REAL wiring; injection stubbed) -------------------- */
    browser.contextMenus?.onClicked.addListener((info, tab) => {
      void handleMenuClick(info, tab);
    });

    browser.commands?.onCommand.addListener((command) => {
      if (command === 'pick-table') {
        void (async () => {
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (typeof tab?.id === 'number') {
            await injectEngine(tab.id, { type: 'pickTable', multi: false });
          }
        })();
      }
    });

    // Structural types (a subset of the polyfill's OnClickData / Tab) so this
    // file never depends on the exact `Browser.*` namespace path.
    type MenuClickInfo = {
      menuItemId: string | number;
      srcUrl?: string;
      frameId?: number;
    };
    type ClickedTab = { id?: number } | undefined;

    async function handleMenuClick(info: MenuClickInfo, tab: ClickedTab): Promise<void> {
      const tabId = tab?.id;

      // Settings — REAL, needs no page access.
      if (info.menuItemId === MENU_SETTINGS) {
        await browser.runtime.openOptionsPage?.();
        return;
      }

      // Open image in a new tab — REAL, zero permissions (design §4.3). 🔴 Only
      // http(s)/data: URLs; never javascript:/file: from page content (§8.4).
      if (info.menuItemId === MENU_IMG_OPEN_TAB && info.srcUrl) {
        if (/^(https?:|data:image\/)/.test(info.srcUrl)) {
          await browser.tabs.create({ url: info.srcUrl, active: false });
        }
        return;
      }

      if (typeof tabId !== 'number') return;

      // Everything else needs `engine.js` injected on the activeTab grant.
      switch (info.menuItemId) {
        case MENU_SEL_MD:
          await injectEngine(tabId, {
            type: 'exportSelection',
            format: 'md',
            frameId: info.frameId,
          });
          return;
        case MENU_SEL_TXT:
          await injectEngine(tabId, {
            type: 'exportSelection',
            format: 'txt',
            frameId: info.frameId,
          });
          return;
        case MENU_SEL_COPY_MD:
          await injectEngine(tabId, { type: 'copySelectionMarkdown', frameId: info.frameId });
          return;
        case MENU_SEL_TABLE:
        case MENU_TABLE:
          await injectEngine(tabId, { type: 'pickTable', multi: false });
          return;
        case MENU_TABLE_ALL:
          await injectEngine(tabId, { type: 'exportAllTables' });
          return;
        case MENU_IMG_COPY_URL:
        case MENU_IMG_SAVE:
          await injectEngine(tabId, {
            type: 'copyImageUrl',
            srcUrl: info.srcUrl ?? '',
          });
          return;
      }
    }

    /**
     * Inject `engine.js` on demand under the activeTab grant, then hand it the
     * command. SCAFFOLD: the executeScript call is wired but the engine's payload
     * handling is stubbed (see entrypoints/engine.ts). ⚠️ `frameIds:[info.frameId]`
     * matters for a selection inside a same-origin iframe (design §4.1); cross-
     * origin frames are unreachable without host permissions and are NOT attempted
     * (design §5.7).
     */
    async function injectEngine(tabId: number, command: EngineCommand): Promise<void> {
      // TODO_LOGIC(wiring): pass `command` to engine.js (e.g. via a follow-up
      // tabs.sendMessage, or scripting.executeScript `args`) and handle results.
      try {
        await browser.scripting.executeScript({
          target: { tabId },
          files: ['/engine.js'],
        });
        // TODO_LOGIC: deliver `command` to the freshly injected engine and route
        // its outcome (toast / preview / picker). Stubbed for the scaffold.
        void command;
      } catch {
        // Injection can fail on restricted pages (chrome://, the store). The real
        // build shows a toast; the scaffold swallows it.
      }
    }
  },
});
