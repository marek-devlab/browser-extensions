// Message protocol: background ⇄ injected `engine.js` ⇄ popup.
//
// The menu item IDs are the exact tree from design §2.1 — one root with children,
// so Chrome (which auto-groups >1 item) and Firefox (which does not) render an
// identical menu.

import type { TextFormat, PageInventory } from './types';

/** Single root — everything hangs off it (design §2.1). */
export const MENU_ROOT = 'ex-root';

/** Selection context children (design §2.1, contexts: ['selection']). */
export const MENU_SEL_MD = 'ex-sel-md';
export const MENU_SEL_TXT = 'ex-sel-txt';
export const MENU_SEL_COPY_MD = 'ex-sel-copy-md';
export const MENU_SEL_TABLE = 'ex-sel-table';

/** Image context children (design §2.1, contexts: ['image']). 🔴 no "download". */
export const MENU_IMG_COPY_URL = 'ex-img-copy-url';
export const MENU_IMG_OPEN_TAB = 'ex-img-open-tab';
export const MENU_IMG_SAVE = 'ex-img-save';

/** Page/frame context children (design §2.1, contexts: ['page', 'frame']). */
export const MENU_TABLE = 'ex-table';
export const MENU_TABLE_ALL = 'ex-table-all';

/** Shared by every context. */
export const MENU_SETTINGS = 'ex-settings';

/* ---------------------------------------------------------------- *
 * background / popup  →  engine.js
 * ---------------------------------------------------------------- */

export type EngineCommand =
  | { type: 'ping' }
  /** The popup's live page read (design §2.4). No overlay, no side effects. */
  | { type: 'scan' }
  | { type: 'exportSelection'; format: TextFormat }
  | { type: 'copySelectionMarkdown' }
  /** `tableId` omitted → pick mode; provided → straight to the dialog. */
  | { type: 'exportTable'; tableId?: string }
  | { type: 'exportAllTables' }
  | { type: 'copyImageUrl'; srcUrl: string }
  | { type: 'saveImage'; srcUrl: string }
  /**
   * MOBILE PARITY. Firefox for Android has no `contextMenus` and no right-click, so
   * the image actions (copy URL / open / save) must be reachable without one. This
   * enters the on-page picker over the images and offers the same three actions.
   */
  | { type: 'pickImage' };

export type EngineResponse =
  | { ok: true; kind: 'scan'; inventory: PageInventory }
  | { ok: true; kind: 'done' }
  | { ok: false; error: string };

/* ---------------------------------------------------------------- *
 * engine.js  →  background   (the engine has no privileged APIs)
 * ---------------------------------------------------------------- */

export type BgRequest =
  /** Cross-origin image save via the OPTIONAL `downloads` permission (§7.3). */
  | { type: 'hasDownloads' }
  | { type: 'downloadUrl'; url: string; filename: string }
  /** 🔴 Scheme-checked in the background before `tabs.create` (design §8.4). */
  | { type: 'openTab'; url: string }
  | { type: 'openOptions' }
  /** The engine cannot `import()` under the page's CSP — ask for a 2nd injection. */
  | { type: 'injectXlsx' }
  /**
   * §5.5 escape hatch: the page forbids downloads (CSP `sandbox` without
   * `allow-downloads`). Stash the bytes in `storage.session` and finish the save on
   * OUR OWN extension page, where our CSP applies instead of theirs.
   */
  | { type: 'stashAndSave'; filename: string; text: string; mime: string };

export type BgResponse =
  | { ok: true; granted?: boolean }
  | { ok: false; error: string };

/** `storage.session` key prefix for the §5.5 handoff. Cleared immediately after
 *  use — a table's contents are the user's data and must not outlive the save. */
export const SESSION_PREFIX = 'pending:';

export interface PendingSave {
  filename: string;
  text: string;
  mime: string;
}
