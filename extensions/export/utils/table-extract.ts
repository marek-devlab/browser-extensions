// STUB — real DOM table extraction is not implemented in the scaffold.
//
// The real version runs inside the injected `engine.js` (page context) and must:
//   - scan with `deepQuerySelectorAll('table')` from @blur/core (open shadow roots
//     already handled — design §4.2);
//   - score data-table vs layout-table (design §4.2), NEVER hiding a table;
//   - build the grid MATRIX honouring colspan/rowspan with anchor+shadow cells,
//     clamping runaway colspan (design §6.1);
//   - resolve headers / <caption> / links / <br> / checkboxes (design §6.2–6.7);
//   - normalize numbers conservatively by page locale (design §6.5);
//   - process in chunks via @blur/core `processInChunks` for large tables
//     (design §9.1) with an AbortController.
//
// Everything here returns MOCK data or throws `todoLogic` so a wired-but-empty
// path fails loudly (`grep TODO_LOGIC` = the backlog).

import { mockAsync, todoLogic } from '@blur/ui';
import type { PageInventory, TableModel } from './types';
import { MOCK_INVENTORY, MOCK_TABLE } from './mock-data';

/**
 * Scan the page for tables/images/selection. REAL: runs in engine.js under
 * activeTab. STUB: returns the mock inventory after a mock delay so the popup's
 * loading state is exercised.
 */
export function scanPageInventory(): Promise<PageInventory> {
  // TODO_LOGIC: real scan (deepQuerySelectorAll + scoring + Intl.Segmenter count).
  return mockAsync(MOCK_INVENTORY, 500);
}

/** Build the full grid matrix for one table id. STUB → mock table. */
export function extractTable(_tableId: string): Promise<TableModel> {
  // TODO_LOGIC: real <table> → Cell[row][col] matrix (design §6.1).
  return mockAsync(MOCK_TABLE, 350);
}

/** Read the current selection as a Markdown/plain fragment. STUB. */
export function extractSelection(_format: 'md' | 'txt'): never {
  // TODO_LOGIC: cloneContents() → DocumentFragment → TreeWalker → Markdown.
  // 🔴 Zero innerHTML; operate on the fragment, never a rebuilt HTML string
  // (design §8.1). cloneContents gives TRUNCATED nodes — handle broken trees.
  throw todoLogic('export: selection → Markdown/TXT from DocumentFragment');
}
