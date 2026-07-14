// Message protocol between the background service worker and the on-demand
// injected `engine.js`. In the scaffold the background REGISTERS the context-menu
// tree for real and ROUTES clicks; the actual injection payloads are stubbed.
//
// The menu item IDs are the exact tree from design §2.1 — one root with children,
// so Chrome (which auto-groups >1 item) and Firefox (which does not) render an
// identical menu.

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

/** What the background asks engine.js to do once injected (design §4). */
export type EngineCommand =
  | { type: 'exportSelection'; format: 'md' | 'txt'; frameId?: number }
  | { type: 'copySelectionMarkdown'; frameId?: number }
  | { type: 'pickTable'; multi: boolean }
  | { type: 'exportAllTables' }
  | { type: 'copyImageUrl'; srcUrl: string };
