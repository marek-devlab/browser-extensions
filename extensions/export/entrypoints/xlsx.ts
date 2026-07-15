import { defineUnlistedScript } from '#imports';
import writeXlsxFile from 'write-excel-file';
import { setXlsxWriter, type XlsxSheet } from '../utils/xlsx-bridge';

// `xlsx.js` — injected as a SECOND file, and ONLY when the user picks .xlsx
// (design §0). Why a second injection instead of a dynamic `import()` inside
// engine.js: a dynamic import inside a content script resolves against the PAGE
// and its CSP, so on strict-CSP sites it fails. A separate file injected under the
// still-active `activeTab` grant does not. Consequence: a plain CSV export never
// loads write-excel-file into the page at all.
//
// It registers ONE function on the shared isolated-world global and exits. All the
// orchestration (size guards, filename, the <a download>) stays in engine.js.

export default defineUnlistedScript(() => {
  setXlsxWriter({
    async write(sheets: XlsxSheet[]): Promise<Blob> {
      // write-excel-file's "no schema" form: rows of typed cells.
      // 🔴 `type: String` → an inline string in the XML. A formula would have to be
      // an <f> element, which this library only emits for `type: 'Formula'` — a
      // value we never pass. That is the structural immunity (design §8.3).
      const data = sheets.map((sheet) =>
        sheet.rows.map((row) =>
          row.map((cell) =>
            cell.type === 'number' && typeof cell.value === 'number'
              ? { value: cell.value, type: Number }
              : { value: cell.value === null ? '' : String(cell.value), type: String },
          ),
        ),
      );

      // Multi-sheet form when >1 table was picked (design §4.4); single otherwise.
      if (data.length > 1) {
        return (await writeXlsxFile(data as never, {
          sheets: sheets.map((s) => s.name),
        })) as Blob;
      }
      return (await writeXlsxFile(data[0] as never, {
        sheet: sheets[0]?.name ?? 'Таблица',
      })) as Blob;
    },
  });
});
