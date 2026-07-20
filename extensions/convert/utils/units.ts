// Pure, offline unit converters — the honesty moat of this extension (PLAN.md
// §11.2). Every factor is HAND-ROLLED and auditable here, in ONE table, rather
// than pulled from `convert-units` / `js-quantities`, which silently collapse the
// ambiguities this product exists to surface:
//
//   - SI-decimal vs IEC-binary: MB (10⁶ B) ≠ MiB (2²⁰ B). Both are offered as
//     distinct units, each tagged, never one silently standing in for the other.
//   - US vs Imperial: gallon / fluid ounce / ton differ. Both appear, tagged.
//   - Metric ton vs US short ton vs UK long ton — three distinct units.
//
// 🔴 This module is PURE: no `#imports`, no browser, no React, no i18n. It knows
// units by a stable `id` and a display `symbol` (a technical token — NEVER
// translated); the popup maps `CategoryId`/`UnitTag` to translated copy. That keeps
// it unit-testable and free of any import cycle with utils/i18n.ts.

export type CategoryId =
  | 'length'
  | 'area'
  | 'volume'
  | 'mass'
  | 'temperature'
  | 'speed'
  | 'pressure'
  | 'energy'
  | 'power'
  | 'data'
  | 'dataRate'
  | 'time'
  | 'angle'
  | 'fuelEconomy'
  | 'typography';

/** An ambiguity/provenance tag the UI renders (translated) next to a unit so the
 *  choice is never silent. 'ref16' = "assumes a 16px root font". */
export type UnitTag = 'us' | 'imperial' | 'metric' | 'short' | 'long' | 'decimal' | 'binary' | 'ref16';

export interface UnitDef {
  /** Stable identifier used in storage, favourites and the omnibox. */
  id: string;
  /** Display symbol — a technical token, shown verbatim, never translated. */
  symbol: string;
  /** Multiplier to the category base unit (linear categories only). */
  factor: number;
  /** Optional honesty tag (US/Imperial/decimal/binary…). */
  tag?: UnitTag;
}

export interface Category {
  id: CategoryId;
  /** id of the base unit, for reference/debugging. */
  base: string;
  units: UnitDef[];
  /** Returns the converted value, or null if either unit id is unknown. */
  convert: (value: number, fromId: string, toId: string) => number | null;
}

/* -------------------------------------------------------------------------- */
/* Linear categories: value * from.factor / to.factor.                         */
/* -------------------------------------------------------------------------- */

function linear(id: CategoryId, base: string, units: UnitDef[]): Category {
  const byId = new Map(units.map((u) => [u.id, u]));
  return {
    id,
    base,
    units,
    convert(value, fromId, toId) {
      const from = byId.get(fromId);
      const to = byId.get(toId);
      if (!from || !to) return null;
      return (value * from.factor) / to.factor;
    },
  };
}

const length = linear('length', 'm', [
  { id: 'nm', symbol: 'nm', factor: 1e-9 },
  { id: 'um', symbol: 'µm', factor: 1e-6 },
  { id: 'mm', symbol: 'mm', factor: 1e-3 },
  { id: 'cm', symbol: 'cm', factor: 1e-2 },
  { id: 'm', symbol: 'm', factor: 1 },
  { id: 'km', symbol: 'km', factor: 1000 },
  { id: 'in', symbol: 'in', factor: 0.0254 },
  { id: 'ft', symbol: 'ft', factor: 0.3048 },
  { id: 'yd', symbol: 'yd', factor: 0.9144 },
  { id: 'mi', symbol: 'mi', factor: 1609.344 },
  { id: 'nmi', symbol: 'nmi', factor: 1852 },
  { id: 'furlong', symbol: 'fur', factor: 201.168 },
  { id: 'au', symbol: 'AU', factor: 1.495978707e11 },
  { id: 'ly', symbol: 'ly', factor: 9.4607304725808e15 },
  { id: 'pc', symbol: 'pc', factor: 3.0856775814913673e16 },
]);

const area = linear('area', 'm2', [
  { id: 'mm2', symbol: 'mm²', factor: 1e-6 },
  { id: 'cm2', symbol: 'cm²', factor: 1e-4 },
  { id: 'm2', symbol: 'm²', factor: 1 },
  { id: 'ha', symbol: 'ha', factor: 1e4 },
  { id: 'km2', symbol: 'km²', factor: 1e6 },
  { id: 'in2', symbol: 'in²', factor: 0.00064516 },
  { id: 'ft2', symbol: 'ft²', factor: 0.09290304 },
  { id: 'yd2', symbol: 'yd²', factor: 0.83612736 },
  { id: 'acre', symbol: 'acre', factor: 4046.8564224 },
  { id: 'mi2', symbol: 'mi²', factor: 2.589988110336e6 },
]);

const volume = linear('volume', 'L', [
  { id: 'mL', symbol: 'mL', factor: 1e-3 },
  { id: 'L', symbol: 'L', factor: 1 },
  { id: 'cm3', symbol: 'cm³', factor: 1e-3 },
  { id: 'm3', symbol: 'm³', factor: 1000 },
  // US liquid measure — tagged, never a silent default.
  { id: 'us_tsp', symbol: 'tsp', factor: 0.00492892159375, tag: 'us' },
  { id: 'us_tbsp', symbol: 'tbsp', factor: 0.01478676478125, tag: 'us' },
  { id: 'us_floz', symbol: 'fl oz', factor: 0.0295735295625, tag: 'us' },
  { id: 'us_cup', symbol: 'cup', factor: 0.2365882365, tag: 'us' },
  { id: 'us_pt', symbol: 'pt', factor: 0.473176473, tag: 'us' },
  { id: 'us_qt', symbol: 'qt', factor: 0.946352946, tag: 'us' },
  { id: 'us_gal', symbol: 'gal', factor: 3.785411784, tag: 'us' },
  // Imperial measure — distinct volumes, tagged.
  { id: 'imp_floz', symbol: 'fl oz', factor: 0.0284130625, tag: 'imperial' },
  { id: 'imp_pt', symbol: 'pt', factor: 0.56826125, tag: 'imperial' },
  { id: 'imp_qt', symbol: 'qt', factor: 1.1365225, tag: 'imperial' },
  { id: 'imp_gal', symbol: 'gal', factor: 4.54609, tag: 'imperial' },
]);

const mass = linear('mass', 'kg', [
  { id: 'mg', symbol: 'mg', factor: 1e-6 },
  { id: 'g', symbol: 'g', factor: 1e-3 },
  { id: 'kg', symbol: 'kg', factor: 1 },
  { id: 't', symbol: 't', factor: 1000, tag: 'metric' },
  { id: 'oz', symbol: 'oz', factor: 0.028349523125 },
  { id: 'lb', symbol: 'lb', factor: 0.45359237 },
  { id: 'st', symbol: 'st', factor: 6.35029318 },
  { id: 'ton_us', symbol: 'ton', factor: 907.18474, tag: 'short' },
  { id: 'ton_uk', symbol: 'ton', factor: 1016.0469088, tag: 'long' },
]);

const speed = linear('speed', 'm/s', [
  { id: 'mps', symbol: 'm/s', factor: 1 },
  { id: 'kmh', symbol: 'km/h', factor: 0.2777777777777778 },
  { id: 'mph', symbol: 'mph', factor: 0.44704 },
  { id: 'fps', symbol: 'ft/s', factor: 0.3048 },
  { id: 'kn', symbol: 'kn', factor: 0.5144444444444445 },
]);

const pressure = linear('pressure', 'Pa', [
  { id: 'Pa', symbol: 'Pa', factor: 1 },
  { id: 'hPa', symbol: 'hPa', factor: 100 },
  { id: 'kPa', symbol: 'kPa', factor: 1000 },
  { id: 'bar', symbol: 'bar', factor: 1e5 },
  { id: 'atm', symbol: 'atm', factor: 101325 },
  { id: 'psi', symbol: 'psi', factor: 6894.757293168 },
  { id: 'mmHg', symbol: 'mmHg', factor: 133.322387415 },
  { id: 'inHg', symbol: 'inHg', factor: 3386.389 },
]);

const energy = linear('energy', 'J', [
  { id: 'J', symbol: 'J', factor: 1 },
  { id: 'kJ', symbol: 'kJ', factor: 1000 },
  { id: 'cal', symbol: 'cal', factor: 4.184 },
  { id: 'kcal', symbol: 'kcal', factor: 4184 },
  { id: 'Wh', symbol: 'Wh', factor: 3600 },
  { id: 'kWh', symbol: 'kWh', factor: 3.6e6 },
  { id: 'BTU', symbol: 'BTU', factor: 1055.05585262 },
  { id: 'ftlb', symbol: 'ft·lb', factor: 1.3558179483314004 },
  { id: 'eV', symbol: 'eV', factor: 1.602176634e-19 },
]);

const power = linear('power', 'W', [
  { id: 'W', symbol: 'W', factor: 1 },
  { id: 'kW', symbol: 'kW', factor: 1000 },
  { id: 'MW', symbol: 'MW', factor: 1e6 },
  { id: 'hp', symbol: 'hp', factor: 745.6998715822702 },
  { id: 'ps', symbol: 'PS', factor: 735.49875 },
  { id: 'btuh', symbol: 'BTU/h', factor: 0.29307107017 },
]);

// Data — base is the BYTE. SI-decimal and IEC-binary units are BOTH present and
// tagged so the popup can show, e.g., 1 GB and 1 GiB side by side, honestly.
const data = linear('data', 'B', [
  { id: 'bit', symbol: 'bit', factor: 0.125 },
  { id: 'B', symbol: 'B', factor: 1 },
  { id: 'kB', symbol: 'kB', factor: 1e3, tag: 'decimal' },
  { id: 'MB', symbol: 'MB', factor: 1e6, tag: 'decimal' },
  { id: 'GB', symbol: 'GB', factor: 1e9, tag: 'decimal' },
  { id: 'TB', symbol: 'TB', factor: 1e12, tag: 'decimal' },
  { id: 'PB', symbol: 'PB', factor: 1e15, tag: 'decimal' },
  { id: 'KiB', symbol: 'KiB', factor: 1024, tag: 'binary' },
  { id: 'MiB', symbol: 'MiB', factor: 1048576, tag: 'binary' },
  { id: 'GiB', symbol: 'GiB', factor: 1073741824, tag: 'binary' },
  { id: 'TiB', symbol: 'TiB', factor: 1099511627776, tag: 'binary' },
  { id: 'PiB', symbol: 'PiB', factor: 1125899906842624, tag: 'binary' },
]);

// Data rate — base is the BIT PER SECOND. Networking uses decimal bits; storage
// throughput uses bytes. Both, tagged.
const dataRate = linear('dataRate', 'bit/s', [
  { id: 'bps', symbol: 'bit/s', factor: 1 },
  { id: 'kbps', symbol: 'kbit/s', factor: 1e3, tag: 'decimal' },
  { id: 'Mbps', symbol: 'Mbit/s', factor: 1e6, tag: 'decimal' },
  { id: 'Gbps', symbol: 'Gbit/s', factor: 1e9, tag: 'decimal' },
  { id: 'Bps', symbol: 'B/s', factor: 8 },
  { id: 'kBps', symbol: 'kB/s', factor: 8e3, tag: 'decimal' },
  { id: 'MBps', symbol: 'MB/s', factor: 8e6, tag: 'decimal' },
  { id: 'MiBps', symbol: 'MiB/s', factor: 8 * 1048576, tag: 'binary' },
  { id: 'GiBps', symbol: 'GiB/s', factor: 8 * 1073741824, tag: 'binary' },
]);

// Time — base is the SECOND. Year/month are the average (Julian) definitions;
// the calendar-accurate arithmetic lives in utils/datetime.ts.
const time = linear('time', 's', [
  { id: 'ns', symbol: 'ns', factor: 1e-9 },
  { id: 'us', symbol: 'µs', factor: 1e-6 },
  { id: 'ms', symbol: 'ms', factor: 1e-3 },
  { id: 's', symbol: 's', factor: 1 },
  { id: 'min', symbol: 'min', factor: 60 },
  { id: 'h', symbol: 'h', factor: 3600 },
  { id: 'd', symbol: 'd', factor: 86400 },
  { id: 'wk', symbol: 'wk', factor: 604800 },
  { id: 'mo', symbol: 'mo', factor: 2629800 },
  { id: 'yr', symbol: 'yr', factor: 31557600 },
]);

const angle = linear('angle', 'rad', [
  { id: 'rad', symbol: 'rad', factor: 1 },
  { id: 'deg', symbol: '°', factor: Math.PI / 180 },
  { id: 'grad', symbol: 'grad', factor: Math.PI / 200 },
  { id: 'arcmin', symbol: '′', factor: Math.PI / 10800 },
  { id: 'arcsec', symbol: '″', factor: Math.PI / 648000 },
  { id: 'turn', symbol: 'turn', factor: 2 * Math.PI },
]);

// Typography — base is the CSS px (96 px = 1 in). em/rem are resolved against a
// 16 px root, tagged 'ref16' so the assumption is disclosed, never silent.
const typography = linear('typography', 'px', [
  { id: 'px', symbol: 'px', factor: 1 },
  { id: 'pt', symbol: 'pt', factor: 96 / 72 },
  { id: 'pc', symbol: 'pc', factor: 16 },
  { id: 'em', symbol: 'em', factor: 16, tag: 'ref16' },
  { id: 'rem', symbol: 'rem', factor: 16, tag: 'ref16' },
  { id: 'in', symbol: 'in', factor: 96 },
  { id: 'cm', symbol: 'cm', factor: 96 / 2.54 },
  { id: 'mm', symbol: 'mm', factor: 96 / 25.4 },
]);

/* -------------------------------------------------------------------------- */
/* Non-linear categories.                                                      */
/* -------------------------------------------------------------------------- */

// Temperature — affine, so it needs real conversion functions, not factors. Base
// is Kelvin. 🔴 A factor-only library gets 0 °C → 32 °F wrong; this does not.
const TEMP_UNITS: UnitDef[] = [
  { id: 'C', symbol: '°C', factor: 1 },
  { id: 'F', symbol: '°F', factor: 1 },
  { id: 'K', symbol: 'K', factor: 1 },
];
function toKelvin(value: number, unit: string): number | null {
  switch (unit) {
    case 'C':
      return value + 273.15;
    case 'F':
      return (value - 32) * (5 / 9) + 273.15;
    case 'K':
      return value;
    default:
      return null;
  }
}
function fromKelvin(k: number, unit: string): number | null {
  switch (unit) {
    case 'C':
      return k - 273.15;
    case 'F':
      return (k - 273.15) * (9 / 5) + 32;
    case 'K':
      return k;
    default:
      return null;
  }
}
const temperature: Category = {
  id: 'temperature',
  base: 'K',
  units: TEMP_UNITS,
  convert(value, fromId, toId) {
    const k = toKelvin(value, fromId);
    if (k === null) return null;
    return fromKelvin(k, toId);
  },
};

// Fuel economy — mpg is INVERSE to L/100km, so a shared "base" of L/100km with
// reciprocal maps, not a linear factor. km/L is likewise inverse.
const FUEL_UNITS: UnitDef[] = [
  { id: 'l100km', symbol: 'L/100km', factor: 1, tag: 'metric' },
  { id: 'kml', symbol: 'km/L', factor: 1, tag: 'metric' },
  { id: 'mpg_us', symbol: 'mpg', factor: 1, tag: 'us' },
  { id: 'mpg_uk', symbol: 'mpg', factor: 1, tag: 'imperial' },
];
// Consumption in L/100km is the base. A value of 0 is guarded (division).
function toL100km(value: number, unit: string): number | null {
  if (value === 0) return unit === 'l100km' ? 0 : Infinity;
  switch (unit) {
    case 'l100km':
      return value;
    case 'kml':
      return 100 / value;
    case 'mpg_us':
      return 235.2145833 / value;
    case 'mpg_uk':
      return 282.4809363 / value;
    default:
      return null;
  }
}
function fromL100km(base: number, unit: string): number | null {
  if (base === 0) return unit === 'l100km' ? 0 : Infinity;
  switch (unit) {
    case 'l100km':
      return base;
    case 'kml':
      return 100 / base;
    case 'mpg_us':
      return 235.2145833 / base;
    case 'mpg_uk':
      return 282.4809363 / base;
    default:
      return null;
  }
}
const fuelEconomy: Category = {
  id: 'fuelEconomy',
  base: 'l100km',
  units: FUEL_UNITS,
  convert(value, fromId, toId) {
    const base = toL100km(value, fromId);
    if (base === null) return null;
    return fromL100km(base, toId);
  },
};

/* -------------------------------------------------------------------------- */

export const CATEGORIES: Category[] = [
  length,
  mass,
  temperature,
  volume,
  area,
  speed,
  time,
  data,
  dataRate,
  pressure,
  energy,
  power,
  fuelEconomy,
  angle,
  typography,
];

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: CategoryId): Category | undefined {
  return CATEGORY_BY_ID.get(id);
}

/** Look up a unit within a category. */
export function getUnit(categoryId: CategoryId, unitId: string): UnitDef | undefined {
  return CATEGORY_BY_ID.get(categoryId)?.units.find((u) => u.id === unitId);
}

/** Convert within a category. Returns null on unknown units or a non-finite input,
 *  so a caller can render "—" rather than "NaN" or a fabricated number. */
export function convertUnit(
  categoryId: CategoryId,
  value: number,
  fromId: string,
  toId: string,
): number | null {
  if (!Number.isFinite(value)) return null;
  const cat = CATEGORY_BY_ID.get(categoryId);
  if (!cat) return null;
  const out = cat.convert(value, fromId, toId);
  return out === null || !Number.isFinite(out) ? (out === Infinity ? Infinity : null) : out;
}

/* -------------------------------------------------------------------------- */
/* Numeral bases — a distinct mode (parse/format a positional integer), not a     */
/* factor. BigInt keeps arbitrarily large values exact (Number would round).      */
/* -------------------------------------------------------------------------- */

export type NumeralBase = 2 | 8 | 10 | 16;

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Parse an unsigned integer written in `base`. Ignores surrounding whitespace,
 *  underscores and an optional 0x/0b/0o prefix. Returns null on any invalid digit
 *  (never a partial/guessed value). */
export function parseInBase(text: string, base: NumeralBase): bigint | null {
  let s = text.trim().toLowerCase().replace(/_/g, '');
  if (s === '') return null;
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (base === 16 && s.startsWith('0x')) s = s.slice(2);
  else if (base === 2 && s.startsWith('0b')) s = s.slice(2);
  else if (base === 8 && s.startsWith('0o')) s = s.slice(2);
  if (s === '') return null;
  const big = BigInt(base);
  let acc = 0n;
  for (const ch of s) {
    const d = DIGITS.indexOf(ch);
    if (d < 0 || d >= base) return null;
    acc = acc * big + BigInt(d);
  }
  return negative ? -acc : acc;
}

/** Render a BigInt in `base`. Uppercased for hex, matching common convention. */
export function formatInBase(value: bigint, base: NumeralBase): string {
  const s = value.toString(base);
  return base === 16 ? s.toUpperCase() : s;
}
