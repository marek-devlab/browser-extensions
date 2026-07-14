// Fabricated data for the scaffold phase. Every surface that renders these must
// also render <MockBadge/> (@blur/ui) so a scaffold screen is never mistaken for
// a working one (the "48 907" fake-number bug, PLAN.md §18a). The numbers below
// mirror the design doc's worked example (CBR currency rates, design §2).

import { MOCK } from '@blur/ui';
import type { Cell, PageInventory, TableModel } from './types';

export { MOCK };

function cell(value: string, extra: Partial<Cell> = {}): Cell {
  return { value, ...extra };
}

/** The fully parsed mock table that drives the PREVIEW dialog (design §2.3). */
export const MOCK_TABLE: TableModel = {
  id: 'tbl-1',
  caption: 'Курсы валют ЦБ РФ',
  rows: 12,
  cols: 4,
  columns: [
    { header: 'Валюта', type: 'text', included: true },
    { header: 'Код', type: 'text', included: true },
    { header: 'Курс', type: 'number', included: true },
    { header: 'Изм.', type: 'text', included: false },
  ],
  preview: [
    [cell('Доллар США'), cell('USD'), cell('78,42'), cell('+0,15')],
    [cell('Евро'), cell('EUR'), cell('91,08'), cell('−0,22')],
    [cell('Фунт'), cell('GBP'), cell('102,31'), cell('+0,04')],
    // ⇱ merged-cell shadow + a formula-risk cell (=2+2) to exercise the guard UI.
    [cell('Юань', { merged: true }), cell('CNY'), cell('10,77'), cell('=2+2', { formulaRisk: true })],
    [cell('Иена'), cell('JPY'), cell('0,53'), cell('+0,01')],
  ],
  looksLikeLayout: false,
  hasMergedCells: 2,
  hasNestedTables: 0,
};

/** A second, messier table so the picker/inventory shows variety (design §2.2). */
export const MOCK_TABLE_MESSY: TableModel = {
  id: 'tbl-2',
  caption: null,
  rows: 340,
  cols: 7,
  columns: [],
  preview: [],
  looksLikeLayout: false,
  hasMergedCells: 5,
  hasNestedTables: 0,
  virtualized: true,
};

/** A layout-ish table (score below threshold) — shown, but badged (design §4.2). */
export const MOCK_TABLE_LAYOUT: TableModel = {
  id: 'tbl-3',
  caption: null,
  rows: 2,
  cols: 2,
  columns: [],
  preview: [],
  looksLikeLayout: true,
  hasMergedCells: 0,
  hasNestedTables: 1,
};

/** The mock page inventory the popup renders (design §2.4). */
export const MOCK_INVENTORY: PageInventory = {
  host: 'cbr.ru',
  selection: { chars: 1240, paragraphs: 3 },
  tables: [MOCK_TABLE, MOCK_TABLE_MESSY, MOCK_TABLE_LAYOUT],
  images: { total: 48, largerThan200: 12 },
  crossOriginFrames: 2,
  closedShadowHosts: 1,
};

/** The "nothing to export" inventory (design §2.4 empty state). */
export const MOCK_INVENTORY_EMPTY: PageInventory = {
  host: 'example.com',
  selection: null,
  tables: [],
  images: { total: 0, largerThan200: 0 },
  crossOriginFrames: 0,
  closedShadowHosts: 0,
};

/** Flatten a TableModel's preview into raw string rows (header + body) for the
 *  CSV/raw-bytes preview. Included columns only. */
export function tableToRows(table: TableModel): string[][] {
  const cols = table.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.included);
  const header = cols.map(({ c }) => c.header);
  const body = table.preview.map((row) => cols.map(({ i }) => row[i]?.value ?? ''));
  return [header, ...body];
}
