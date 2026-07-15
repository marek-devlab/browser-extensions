import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';
import { activeDraftIdItem, draftsItem, settingsItem, withDraftsLock } from '../utils/storage';
import { MSG_ACTIVE_TAB, openEditor, sidePanelApi, type ActiveTabInfo } from '../utils/surface';
import type { Draft } from '../utils/types';

// Background (design §S4, §S5, §8.4). Deliberately almost empty:
//   - opens the editor when the toolbar action is clicked (S5 — a panel, NOT a
//     popup, and a TAB where no panel API exists — see below);
//   - registers ONE context-menu item, "Add selection to draft" (+ "…as quote"),
//     the only page-facing entry point (design §1.1, §S4);
//   - answers one message: the active tab's URL for "Insert environment".
//
// 🔴 NO IN-MEMORY STATE (design §8.4): drafts are read and written straight from
// storage under the shared Web Lock, so a service-worker death loses nothing.
// Context menus are (re)created only in onInstalled/onStartup — recreating them
// on every SW wake produces duplicate-id errors.
//
// 🔴 activeTab IS READ-ONLY HERE. We read the selection the user made and the
// tab's URL. We never inject into, modify, or script the page — that would be a
// different product (design §1.1). And we do NOT take the `scripting` permission:
// `info.selectionText` already carries the selection for a selection-context menu
// click, so the richer read in design §4.2 is not worth a permanent extra
// permission (see IMPLEMENTATION.md).

const MENU_ADD = 'cw-add-selection';
const MENU_ADD_QUOTE = 'cw-add-selection-quote';

export default defineBackground({
  main() {
    /* ── S5: clicking the action opens the editor ────────────────────────*/
    // Chrome: the side panel opens itself on the action click.
    void sidePanelApi()
      ?.setPanelBehavior?.({ openPanelOnActionClick: true })
      .catch(() => {});

    // Firefox desktop: the action click fires onClicked → open the sidebar.
    // ⚠️ Firefox for ANDROID has no sidebar at all — `openEditor` feature-detects
    // and falls back to the full-page Workbench in a tab, which is the only
    // editor surface that exists on mobile. No user-agent sniffing.
    // `browser.action` is MV3; Firefox MV2 exposes `browserAction` (house
    // convention: blur/adblock/capture do the same).
    const action = browser.action ?? browser.browserAction;
    action?.onClicked?.addListener((tab) => {
      void openEditor(tab?.windowId);
    });

    /* ── S4: the ONE context menu (design §1.1, §4.2) ────────────────────*/
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

        const settings = await settingsItem.getValue();
        const asQuote = info.menuItemId === MENU_ADD_QUOTE || settings.contextMenuMode === 'quote';

        const selection = info.selectionText ?? '';
        if (selection.trim() === '') return;

        const source = tab?.title && tab.url ? `\n\n— [${tab.title}](${tab.url})` : '';
        const addition = (asQuote ? quote(selection) : selection) + source;

        // 🔴 WRITE FIRST, THEN OPEN (design §8.4) — a panel opened first would
        // render the pre-append text. The RMW runs under the shared lock so an
        // already-open panel cannot clobber this write.
        await withDraftsLock(async () => {
          const [stored, activeId] = await Promise.all([
            draftsItem.getValue(),
            activeDraftIdItem.getValue(),
          ]);
          const targetId = activeId ?? stored[0]?.id ?? null;

          if (targetId && stored.some((d) => d.id === targetId)) {
            await draftsItem.setValue(
              stored.map((d) =>
                d.id === targetId
                  ? { ...d, body: joinBody(d.body, addition), updatedAt: Date.now() }
                  : d,
              ),
            );
            return;
          }

          // No draft yet → create "Из выделения — <host>" (design §4.2).
          const created: Draft = {
            id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title: `Из выделения — ${safeHost(tab?.url)}`,
            body: addition.trimStart(),
            target: settings.defaultTarget,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await draftsItem.setValue([created, ...stored]);
          await activeDraftIdItem.setValue(created.id);
        }).catch(() => {
          // Storage full: do not silently swallow — but there is no UI here, and
          // the panel shows the quota banner as soon as it opens.
        });

        // The context-menu click IS the gesture, so the panel may open.
        await openEditor(tab?.windowId);
      })();
    });

    /* ── "Insert environment" asks for the active tab's URL (design §2.9) ─*/
    // ⚠️ sendResponse + `return true`, NOT a returned Promise: Chrome's
    // `onMessage` ignores a promise return value (Firefox honours both). House
    // convention — see blur/seo backgrounds.
    browser.runtime.onMessage.addListener(
      (message: unknown, _sender, sendResponse: (r: ActiveTabInfo) => void) => {
        if (
          typeof message !== 'object' ||
          message === null ||
          (message as { type?: string }).type !== MSG_ACTIVE_TAB
        ) {
          return false;
        }
        // `tab.url` is only populated when activeTab has been granted for that
        // tab (the action click / the context menu). Otherwise it is undefined
        // and the UI says so rather than inventing a URL.
        void browser.tabs
          .query({ active: true, currentWindow: true })
          .then(([tab]) => sendResponse({ url: tab?.url, title: tab?.title }))
          .catch(() => sendResponse({}));
        return true; // keep the message channel open for the async reply
      },
    );
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
