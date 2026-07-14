import { defineUnlistedScript } from '#imports';

// `xlsx.js` — injected as a SECOND file, and ONLY when the user picks .xlsx
// (design §0). Why a second injection instead of a dynamic `import()` inside
// engine.js: a dynamic import inside a content script resolves against the PAGE
// and its CSP, so on strict-CSP sites it fails. A separate file injection under
// the still-active `activeTab` grant does not (design §0). This is also why
// write-excel-file + fflate never load on a plain CSV export.
//
// SCAFFOLD STATUS: fully STUBBED. The real module imports `write-excel-file`,
// receives the built grid from engine.js, produces a Blob of typed cells
// (formula-immune — a string cell can never become a formula, design §8.3), and
// hands it back for `<a download>`. Refuses > 200k cells / > 1,048,576 rows
// (design §9.1). No import here yet so the scaffold stays light.

export default defineUnlistedScript(() => {
  // TODO_LOGIC: import('write-excel-file') → writeXlsxFile(rows, {schema}) → Blob
  // → <a download> (via utils/file-writer saveXlsxFile). Wire the grid handoff
  // from engine.js and the size guards here.
  // (Intentionally a no-op in the scaffold — see IMPLEMENTATION.md.)
});
