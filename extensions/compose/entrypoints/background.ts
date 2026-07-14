import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';
import { activeDraftIdItem, draftsItem, withDraftsLock } from '../utils/storage';
import { MOCK_DRAFTS } from '../utils/mock';
import type { Draft } from '../utils/types';

// Background service worker (design §S4, §S5, §8.4). Deliberately almost empty:
//   - opens the SIDE PANEL when the toolbar action is clicked (S5, NOT a popup);
//   - registers ONE context-menu item "Add selection to draft" (+ "…as quote"),
//     which is the only page-facing entry point (design §1.1, §S4).
//
// 🔴 NO in-memory state (design §8.4): the draft is read/written straight from
// storage under the shared Web Lock, so SW death loses nothing. Context menus are
// (re)created only in onInstalled/onStartup to avoid duplicate-id errors.

const MENU_ADD = 'cw-add-selection';
const MENU_ADD_QUOTE = 'cw-add-selection-quote';

export default defineBackground({
  main() {
    // S5 — clicking the toolbar action opens the side panel (Chrome). This is
    // the whole reason `sidePanel` permission + side_panel manifest key exist.
    // Firefox opens the sidebar from the toolbar automatically via
    // `sidebar_action`, so no equivalent call is needed there.
    const sidePanel = (browser as unknown as { sidePanel?: {
      setPanelBehavior?: (o: { openPanelOnActionClick: boolean }) => Promise<void>;
      open?: (o: { windowId?: number; tabId?: number }) => Promise<void>;
    } }).sidePanel;
    void sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

    /* ── Context menu (design §S4, §4.2) ─────────────────────────────────── */
    function createMenus(): void {
      browser.contextMenus?.removeAll(() => {
        browser.contextMenus?.create({
          id: MENU_ADD,
          title: 'Добавить выделенное в черновик',
          contexts: ['selection'],
        });
        browser.contextMenus?.create({
          id: MENU_ADD_QUOTE,
          title: '…как цитату',
          contexts: ['selection'],
        });
      });
    }
    browser.runtime.onInstalled.addListener(createMenus);
    browser.runtime.onStartup?.addListener(createMenus);

    browser.contextMenus?.onClicked.addListener((info, tab) => {
      void (async () => {
        if (info.menuItemId !== MENU_ADD && info.menuItemId !== MENU_ADD_QUOTE) return;
        const asQuote = info.menuItemId === MENU_ADD_QUOTE;

        // ⚠️ activeTab is READ-only here (design §1.1): we read the selection, we
        // never write to the page. The context-menu click is the user gesture
        // that grants activeTab.
        //
        // Chrome/Firefox both put the selected text on `info.selectionText`, so
        // the scaffold uses that directly. The richer read described in design
        // §4.2 (scripting.executeScript → window.getSelection() to preserve
        // formatting, plus the "— [Title](URL)" source line) is TODO_LOGIC.
        const selection = info.selectionText ?? '';
        const source = tab?.title && tab.url ? `\n\n— [${tab.title}](${tab.url})` : '';
        const addition = (asQuote ? quote(selection) : selection) + source;

        // 🔴 Write FIRST, then open the panel (design §8.4) — otherwise the panel
        // renders the pre-append text. RMW under the shared lock so a panel that
        // is already open can't clobber this write.
        await withDraftsLock(async () => {
          const [stored, activeId] = await Promise.all([
            draftsItem.getValue(),
            activeDraftIdItem.getValue(),
          ]);
          const list = stored.length > 0 ? stored : MOCK_DRAFTS;
          const targetId = activeId ?? list[0]?.id ?? null;

          let next: Draft[];
          if (targetId && list.some((d) => d.id === targetId)) {
            next = list.map((d) =>
              d.id === targetId
                ? { ...d, body: joinBody(d.body, addition), updatedAt: Date.now() }
                : d,
            );
          } else {
            // No draft yet → create "Из выделения — <host>" (design §4.2).
            const host = safeHost(tab?.url);
            const created: Draft = {
              id: `d-${Date.now()}`,
              title: `Из выделения — ${host}`,
              body: addition.trimStart(),
              target: 'github',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            next = [created, ...list];
            await activeDraftIdItem.setValue(created.id);
          }
          await draftsItem.setValue(next);
        });

        // Then open the panel (the click is a valid user gesture).
        if (sidePanel?.open) {
          await sidePanel.open({ windowId: tab?.windowId }).catch(() => {});
        } else {
          const sidebar = (browser as unknown as {
            sidebarAction?: { open?: () => Promise<void> };
          }).sidebarAction;
          await sidebar?.open?.().catch(() => {});
        }
      })();
    });
  },
});

function quote(text: string): string {
  return text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
}

function joinBody(body: string, addition: string): string {
  const sep = body.trim() === '' ? '' : body.endsWith('\n') ? '\n' : '\n\n';
  return body + sep + addition.trimStart();
}

function safeHost(url?: string): string {
  if (!url) return 'страница';
  try {
    return new URL(url).hostname;
  } catch {
    return 'страница';
  }
}
