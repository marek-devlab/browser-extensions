// Popup → page. The toolbar click is a GESTURE, so it grants `activeTab` — which
// is exactly what lets the popup inject `engine.js` without a standing content
// script or any host permission (design §0).
//
// ⚠️ This is also the MOBILE story. Firefox for Android has no `contextMenus` and
// no right-click at all (and Chrome for Android has no extensions), so on mobile
// the popup is the ONLY surface. Everything the context menu can do must be
// reachable from here — see entrypoints/popup/App.tsx.

import { browser } from 'wxt/browser';
import type { EngineCommand, EngineResponse } from './messages';

export class NoPageAccess extends Error {}

/**
 * Inject one of our bundled scripts into a tab (or one same-origin frame of it)
 * under the `activeTab` grant.
 *
 * ⚠️ The Firefox build is MV2, where `browser.scripting` exists but is not the
 * historical API. Fall back to `tabs.executeScript` rather than assume — an
 * extension whose only injection path is missing is an extension that does nothing,
 * and this costs six lines.
 */
/** The only two files we ever inject. A literal union, so a typo cannot compile. */
export type InjectableFile = '/engine.js' | '/xlsx.js';

export async function injectFile(
  tabId: number,
  frameId: number | undefined,
  file: InjectableFile,
): Promise<void> {
  const scripting = (browser as { scripting?: typeof browser.scripting }).scripting;
  if (scripting?.executeScript) {
    await scripting.executeScript({
      target: typeof frameId === 'number' && frameId > 0 ? { tabId, frameIds: [frameId] } : { tabId },
      files: [file],
    });
    return;
  }
  const legacy = browser.tabs as unknown as {
    executeScript?: (id: number, details: { file: string; frameId?: number }) => Promise<unknown>;
  };
  if (legacy.executeScript) {
    await legacy.executeScript(tabId, { file, ...(frameId ? { frameId } : {}) });
    return;
  }
  throw new NoPageAccess('Браузер не даёт внедрить скрипт на эту страницу.');
}

export async function runOnActiveTab(cmd: EngineCommand): Promise<EngineResponse> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id !== 'number') throw new NoPageAccess('Нет активной вкладки');

  try {
    await injectFile(tab.id, undefined, '/engine.js');
  } catch {
    // chrome://, addons.mozilla.org, the Web Store, a PDF viewer, a local file
    // without permission — the browser forbids injection there, for everyone.
    // 🔴 Say so; do not show an empty inventory and let the user think the page has
    // nothing on it (design §7 — never lie about a limitation).
    throw new NoPageAccess(
      'На этой странице расширения работать не могут (служебная страница браузера, магазин дополнений или PDF).',
    );
  }

  const res = (await browser.tabs.sendMessage(tab.id, cmd)) as EngineResponse | undefined;
  if (!res) throw new NoPageAccess('Страница не ответила. Перезагрузите её и попробуйте снова.');
  return res;
}
