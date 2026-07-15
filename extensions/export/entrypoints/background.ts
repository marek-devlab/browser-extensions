import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';
import { injectFile } from '../utils/inject';
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
  SESSION_PREFIX,
  type BgRequest,
  type BgResponse,
  type EngineCommand,
  type PendingSave,
} from '../utils/messages';
import { localeItem } from '../utils/storage';
import { tAt } from '../utils/i18n';

// Background = the only place context menus, routing, tabs.create, downloads and
// scripting.executeScript can live (design §0). It holds NO export state: it routes
// a click, injects `engine.js` on the granted `activeTab`, and dies.
//
// 🔴 Nothing heavy here — the SW has no `URL.createObjectURL` and is killed after
// ~30 s (design §9.2). Every byte is born and revoked in the injected content
// script. That is also why there are no alarms and no state mirroring.

/** 🔴 The ONLY schemes we ever hand to `tabs.create` (design §8.4). A page controls
 *  `img[src]`; `javascript:` and `file:` are not negotiable. */
function isSafeTabUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:') return true;
    return u.protocol === 'data:' && /^data:image\//i.test(raw);
  } catch {
    return false;
  }
}

export default defineBackground({
  main() {
    /* ================================================================ *
     * Context menus — the PRIMARY surface on desktop (design §2.1)
     * ================================================================ */

    // ⚠️ MOBILE: on Firefox for Android `contextMenus`/`menus` is unavailable (and
    // there is no right-click to begin with). We FEATURE-DETECT — never sniff the
    // user agent — and every capability below is ALSO reachable from the popup, so
    // an Android user is never left with a dead feature.
    async function createMenus(): Promise<void> {
      const menus = browser.contextMenus;
      if (!menus?.create) return;
      // Menu titles follow the runtime UI language (English default). We re-run this
      // whenever the locale pref changes (localeItem.watch below), so a switch on the
      // options page rebuilds the tree without a browser restart.
      const locale = await localeItem.getValue();

      menus.removeAll(() => {
        // One root with children: Chrome auto-groups >1 item under the extension
        // name, Firefox does not. A single root makes the tree identical in both.
        menus.create({
          id: MENU_ROOT,
          title: `💾 ${tAt(locale, 'menuRoot')}`,
          contexts: ['selection', 'image', 'page', 'frame'],
        });

        // -- Selection -------------------------------------------------
        menus.create({ id: MENU_SEL_MD, parentId: MENU_ROOT, title: tAt(locale, 'menuSelMd'), contexts: ['selection'] });
        menus.create({ id: MENU_SEL_TXT, parentId: MENU_ROOT, title: tAt(locale, 'menuSelTxt'), contexts: ['selection'] });
        menus.create({ id: 'ex-sep-sel-1', parentId: MENU_ROOT, type: 'separator', contexts: ['selection'] });
        menus.create({ id: MENU_SEL_COPY_MD, parentId: MENU_ROOT, title: tAt(locale, 'menuSelCopyMd'), contexts: ['selection'] });
        menus.create({ id: 'ex-sep-sel-2', parentId: MENU_ROOT, type: 'separator', contexts: ['selection'] });
        menus.create({ id: MENU_SEL_TABLE, parentId: MENU_ROOT, title: tAt(locale, 'menuTableItem'), contexts: ['selection'] });

        // -- Image. 🔴 No "download" wording. 🔴 No `video` context — it does not
        //    exist in this code at all, which is the cheapest possible insurance
        //    against a reviewer reading this product as a media grabber (§12).
        menus.create({ id: MENU_IMG_COPY_URL, parentId: MENU_ROOT, title: tAt(locale, 'menuImgCopyUrl'), contexts: ['image'] });
        menus.create({ id: MENU_IMG_OPEN_TAB, parentId: MENU_ROOT, title: tAt(locale, 'menuImgOpenTab'), contexts: ['image'] });
        menus.create({ id: MENU_IMG_SAVE, parentId: MENU_ROOT, title: tAt(locale, 'menuImgSave'), contexts: ['image'] });

        // -- Page / frame. ⚠️ "Export table…" is ALWAYS visible even on a
        //    page with no tables: hiding it dynamically would need a standing
        //    content script (§0). The honest answer to a click is a toast (§5.2).
        menus.create({ id: MENU_TABLE, parentId: MENU_ROOT, title: tAt(locale, 'menuTableItem'), contexts: ['page', 'frame'] });
        menus.create({ id: MENU_TABLE_ALL, parentId: MENU_ROOT, title: tAt(locale, 'menuTableAll'), contexts: ['page', 'frame'] });

        menus.create({ id: 'ex-sep-settings', parentId: MENU_ROOT, type: 'separator', contexts: ['selection', 'image', 'page', 'frame'] });
        menus.create({ id: MENU_SETTINGS, parentId: MENU_ROOT, title: tAt(locale, 'menuSettings'), contexts: ['selection', 'image', 'page', 'frame'] });
      });
    }

    browser.runtime.onInstalled.addListener((details) => {
      void createMenus();
      if (details.reason === 'install') {
        // One screen, once. No "rate us" (design §1.2). The options page carries the
        // "how it works" copy under the "About" tab.
        void browser.runtime.openOptionsPage?.();
      }
    });
    browser.runtime.onStartup?.addListener(() => void createMenus());
    void createMenus();

    // Rebuild the menu tree when the user switches the interface language on the
    // options page, so the right-click titles update without a browser restart.
    localeItem.watch(() => void createMenus());

    /* ================================================================ *
     * Menu routing
     * ================================================================ */

    type MenuClickInfo = {
      menuItemId: string | number;
      srcUrl?: string;
      frameId?: number;
    };

    browser.contextMenus?.onClicked.addListener((info, tab) => {
      void handleMenuClick(info as MenuClickInfo, tab?.id);
    });

    browser.commands?.onCommand.addListener((command) => {
      if (command !== 'pick-table') return;
      void (async () => {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (typeof tab?.id === 'number') await run(tab.id, undefined, { type: 'exportTable' });
      })();
    });

    async function handleMenuClick(info: MenuClickInfo, tabId: number | undefined): Promise<void> {
      // Settings — needs no page access at all.
      if (info.menuItemId === MENU_SETTINGS) {
        await browser.runtime.openOptionsPage?.();
        return;
      }

      // Open image in a new tab — zero permissions, zero injection (design §4.3).
      // 🔴 Scheme-checked: never `javascript:`/`file:` from page content (§8.4).
      if (info.menuItemId === MENU_IMG_OPEN_TAB) {
        if (info.srcUrl && isSafeTabUrl(info.srcUrl)) {
          await browser.tabs.create({ url: info.srcUrl, active: false });
        }
        return;
      }

      if (typeof tabId !== 'number') return;

      // ⚠️ `frameId` matters: the selection may live in a SAME-ORIGIN iframe
      // (design §4.1). Cross-origin frames are unreachable without host permissions
      // and are NOT attempted (§5.7) — the injection just fails and we say so.
      const frameId = info.frameId;

      switch (info.menuItemId) {
        case MENU_SEL_MD:
          return run(tabId, frameId, { type: 'exportSelection', format: 'md' });
        case MENU_SEL_TXT:
          return run(tabId, frameId, { type: 'exportSelection', format: 'txt' });
        case MENU_SEL_COPY_MD:
          return run(tabId, frameId, { type: 'copySelectionMarkdown' });
        case MENU_SEL_TABLE:
        case MENU_TABLE:
          return run(tabId, frameId, { type: 'exportTable' });
        case MENU_TABLE_ALL:
          return run(tabId, frameId, { type: 'exportAllTables' });
        case MENU_IMG_COPY_URL:
          return run(tabId, frameId, { type: 'copyImageUrl', srcUrl: info.srcUrl ?? '' });
        case MENU_IMG_SAVE:
          return run(tabId, frameId, { type: 'saveImage', srcUrl: info.srcUrl ?? '' });
      }
    }

    /** Inject `engine.js` under the activeTab grant, then hand it the command. */
    async function run(
      tabId: number,
      frameId: number | undefined,
      command: EngineCommand,
    ): Promise<void> {
      try {
        await injectFile(tabId, frameId, '/engine.js');
        await browser.tabs.sendMessage(tabId, command, frameId ? { frameId } : undefined);
      } catch {
        // Restricted page (chrome://, the store, a PDF viewer, a cross-origin frame)
        // — there is nowhere to inject. Failing silently here is acceptable ONLY
        // because there is no surface to draw on: we cannot toast on a page we
        // cannot touch. The popup, which CAN render, reports this properly.
      }
    }

    /* ================================================================ *
     * Privileged services for the engine (it has none of these APIs)
     * ================================================================ */

    browser.runtime.onMessage.addListener(
      (msg: unknown, sender, sendResponse: (r: BgResponse) => void) => {
        const req = msg as BgRequest;
        if (!req || typeof req.type !== 'string') return false;
        // Only our own extension's contexts can reach here (runtime.onMessage is not
        // exposed to pages without externally_connectable, which we never declare).
        serve(req, sender.tab?.id, sender.frameId)
          .then(sendResponse)
          .catch((e: unknown) =>
            sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
          );
        return true;
      },
    );

    async function serve(
      req: BgRequest,
      tabId: number | undefined,
      frameId: number | undefined,
    ): Promise<BgResponse> {
      const locale = await localeItem.getValue();
      switch (req.type) {
        case 'hasDownloads': {
          const granted = await browser.permissions.contains({ permissions: ['downloads'] });
          return { ok: true, granted };
        }

        case 'downloadUrl': {
          // Only reachable when the user has OPTED IN to `downloads` (design §7.3).
          const granted = await browser.permissions.contains({ permissions: ['downloads'] });
          if (!granted) return { ok: false, error: tAt(locale, 'downloadsNotGranted') };
          if (!isSafeTabUrl(req.url)) return { ok: false, error: tAt(locale, 'unsafeUrl') };
          const downloads = (browser as unknown as { downloads?: typeof browser.downloads }).downloads;
          if (!downloads) return { ok: false, error: tAt(locale, 'downloadsApiUnavailable') };
          await downloads.download({ url: req.url, filename: req.filename, saveAs: false });
          return { ok: true };
        }

        case 'openTab': {
          if (!isSafeTabUrl(req.url)) return { ok: false, error: tAt(locale, 'unsafeUrl') };
          await browser.tabs.create({ url: req.url, active: true });
          return { ok: true };
        }

        case 'openOptions': {
          await browser.runtime.openOptionsPage?.();
          return { ok: true };
        }

        case 'injectXlsx': {
          // The SECOND injection, only now, and only into the frame that asked
          // (design §0). A dynamic import() in the content script would resolve
          // against the page's CSP and die on strict-CSP sites.
          if (typeof tabId !== 'number') return { ok: false, error: tAt(locale, 'noTab') };
          await injectFile(tabId, frameId, '/xlsx.js');
          return { ok: true };
        }

        case 'stashAndSave': {
          // §5.5 escape hatch: rebuild the Blob on OUR OWN page, where OUR CSP
          // applies instead of the site's `sandbox` policy.
          const MAX = 8 * 1024 * 1024;
          if (req.text.length > MAX) {
            return { ok: false, error: tAt(locale, 'fileTooBig') };
          }
          const key = `${SESSION_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
          const payload: PendingSave = { filename: req.filename, text: req.text, mime: req.mime };
          const area = browser.storage.session ?? browser.storage.local;
          await area.set({ [key]: payload });
          await browser.tabs.create({
            url: browser.runtime.getURL(`/save.html?key=${encodeURIComponent(key)}`),
            active: true,
          });
          return { ok: true };
        }
      }
    }
  },
});
