// Parse a free-text quantity a user selected or typed — "5 miles", "20°C", "$50",
// "3 GiB", "cv 10 kg to lb" (PLAN.md §11.6). PURE: no browser, no i18n.
//
// The lexicon maps a lowercased token to a (category, unitId) pair from utils/units
// (or a currency code). It is intentionally conservative: an unrecognised token
// returns null, so the caller shows nothing rather than guessing wrong. Ambiguous
// bare tokens ("gallon", "ton", "mpg", "cup") resolve to the US reading by
// convention but the popup still surfaces the US/Imperial selector — the parse is a
// starting point, never the last word.

import type { CategoryId } from './units';

export interface ParsedUnit {
  kind: 'unit';
  category: CategoryId;
  unitId: string;
  value: number;
}

export interface ParsedCurrency {
  kind: 'currency';
  /** ISO 4217 code (technical token, never translated). */
  code: string;
  value: number;
}

export type Parsed = ParsedUnit | ParsedCurrency;

interface UnitToken {
  category: CategoryId;
  unitId: string;
}

// token → unit. Lowercased keys. Symbols with non-ASCII (°c, µm) included.
const UNIT_LEXICON: Record<string, UnitToken> = {
  // length
  nm: { category: 'length', unitId: 'nm' },
  µm: { category: 'length', unitId: 'um' },
  um: { category: 'length', unitId: 'um' },
  mm: { category: 'length', unitId: 'mm' },
  cm: { category: 'length', unitId: 'cm' },
  m: { category: 'length', unitId: 'm' },
  meter: { category: 'length', unitId: 'm' },
  meters: { category: 'length', unitId: 'm' },
  metre: { category: 'length', unitId: 'm' },
  metres: { category: 'length', unitId: 'm' },
  km: { category: 'length', unitId: 'km' },
  kilometer: { category: 'length', unitId: 'km' },
  kilometers: { category: 'length', unitId: 'km' },
  kilometre: { category: 'length', unitId: 'km' },
  kilometres: { category: 'length', unitId: 'km' },
  in: { category: 'length', unitId: 'in' },
  inch: { category: 'length', unitId: 'in' },
  inches: { category: 'length', unitId: 'in' },
  '"': { category: 'length', unitId: 'in' },
  ft: { category: 'length', unitId: 'ft' },
  foot: { category: 'length', unitId: 'ft' },
  feet: { category: 'length', unitId: 'ft' },
  yd: { category: 'length', unitId: 'yd' },
  yard: { category: 'length', unitId: 'yd' },
  yards: { category: 'length', unitId: 'yd' },
  mi: { category: 'length', unitId: 'mi' },
  mile: { category: 'length', unitId: 'mi' },
  miles: { category: 'length', unitId: 'mi' },
  nmi: { category: 'length', unitId: 'nmi' },
  // mass
  mg: { category: 'mass', unitId: 'mg' },
  g: { category: 'mass', unitId: 'g' },
  gram: { category: 'mass', unitId: 'g' },
  grams: { category: 'mass', unitId: 'g' },
  kg: { category: 'mass', unitId: 'kg' },
  kilo: { category: 'mass', unitId: 'kg' },
  kilos: { category: 'mass', unitId: 'kg' },
  kilogram: { category: 'mass', unitId: 'kg' },
  kilograms: { category: 'mass', unitId: 'kg' },
  t: { category: 'mass', unitId: 't' },
  tonne: { category: 'mass', unitId: 't' },
  tonnes: { category: 'mass', unitId: 't' },
  oz: { category: 'mass', unitId: 'oz' },
  ounce: { category: 'mass', unitId: 'oz' },
  ounces: { category: 'mass', unitId: 'oz' },
  lb: { category: 'mass', unitId: 'lb' },
  lbs: { category: 'mass', unitId: 'lb' },
  pound: { category: 'mass', unitId: 'lb' },
  pounds: { category: 'mass', unitId: 'lb' },
  st: { category: 'mass', unitId: 'st' },
  stone: { category: 'mass', unitId: 'st' },
  ton: { category: 'mass', unitId: 'ton_us' },
  // temperature
  '°c': { category: 'temperature', unitId: 'C' },
  c: { category: 'temperature', unitId: 'C' },
  celsius: { category: 'temperature', unitId: 'C' },
  centigrade: { category: 'temperature', unitId: 'C' },
  '°f': { category: 'temperature', unitId: 'F' },
  f: { category: 'temperature', unitId: 'F' },
  fahrenheit: { category: 'temperature', unitId: 'F' },
  k: { category: 'temperature', unitId: 'K' },
  kelvin: { category: 'temperature', unitId: 'K' },
  // volume
  ml: { category: 'volume', unitId: 'mL' },
  l: { category: 'volume', unitId: 'L' },
  liter: { category: 'volume', unitId: 'L' },
  liters: { category: 'volume', unitId: 'L' },
  litre: { category: 'volume', unitId: 'L' },
  litres: { category: 'volume', unitId: 'L' },
  gal: { category: 'volume', unitId: 'us_gal' },
  gallon: { category: 'volume', unitId: 'us_gal' },
  gallons: { category: 'volume', unitId: 'us_gal' },
  cup: { category: 'volume', unitId: 'us_cup' },
  cups: { category: 'volume', unitId: 'us_cup' },
  pint: { category: 'volume', unitId: 'us_pt' },
  pints: { category: 'volume', unitId: 'us_pt' },
  quart: { category: 'volume', unitId: 'us_qt' },
  // speed
  mph: { category: 'speed', unitId: 'mph' },
  'km/h': { category: 'speed', unitId: 'kmh' },
  kmh: { category: 'speed', unitId: 'kmh' },
  kph: { category: 'speed', unitId: 'kmh' },
  'm/s': { category: 'speed', unitId: 'mps' },
  kn: { category: 'speed', unitId: 'kn' },
  knot: { category: 'speed', unitId: 'kn' },
  knots: { category: 'speed', unitId: 'kn' },
  // data
  bit: { category: 'data', unitId: 'bit' },
  b: { category: 'data', unitId: 'B' },
  byte: { category: 'data', unitId: 'B' },
  bytes: { category: 'data', unitId: 'B' },
  kb: { category: 'data', unitId: 'kB' },
  mb: { category: 'data', unitId: 'MB' },
  gb: { category: 'data', unitId: 'GB' },
  tb: { category: 'data', unitId: 'TB' },
  kib: { category: 'data', unitId: 'KiB' },
  mib: { category: 'data', unitId: 'MiB' },
  gib: { category: 'data', unitId: 'GiB' },
  tib: { category: 'data', unitId: 'TiB' },
  // time
  ms: { category: 'time', unitId: 'ms' },
  sec: { category: 'time', unitId: 's' },
  secs: { category: 'time', unitId: 's' },
  second: { category: 'time', unitId: 's' },
  seconds: { category: 'time', unitId: 's' },
  min: { category: 'time', unitId: 'min' },
  mins: { category: 'time', unitId: 'min' },
  minute: { category: 'time', unitId: 'min' },
  minutes: { category: 'time', unitId: 'min' },
  h: { category: 'time', unitId: 'h' },
  hr: { category: 'time', unitId: 'h' },
  hrs: { category: 'time', unitId: 'h' },
  hour: { category: 'time', unitId: 'h' },
  hours: { category: 'time', unitId: 'h' },
  day: { category: 'time', unitId: 'd' },
  days: { category: 'time', unitId: 'd' },
  // typography
  px: { category: 'typography', unitId: 'px' },
  pt: { category: 'typography', unitId: 'pt' },
  em: { category: 'typography', unitId: 'em' },
  rem: { category: 'typography', unitId: 'rem' },
  // angle
  deg: { category: 'angle', unitId: 'deg' },
  '°': { category: 'angle', unitId: 'deg' },
  rad: { category: 'angle', unitId: 'rad' },
};

// currency symbol → ISO code. Bare "kr", "$" etc. resolve to the most common code.
const CURRENCY_SYMBOL: Record<string, string> = {
  $: 'USD',
  us$: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₽': 'RUB',
  '¥': 'JPY',
  '₹': 'INR',
  '₴': 'UAH',
  '₩': 'KRW',
  '₺': 'TRY',
};

const CURRENCY_CODES = new Set([
  'USD',
  'EUR',
  'GBP',
  'RUB',
  'JPY',
  'INR',
  'CNY',
  'CHF',
  'CAD',
  'AUD',
  'UAH',
  'PLN',
  'SEK',
  'NOK',
  'DKK',
  'TRY',
  'BRL',
  'ZAR',
  'KRW',
  'MXN',
]);

const CRYPTO_TOKENS: Record<string, string> = {
  btc: 'BTC',
  bitcoin: 'BTC',
  eth: 'ETH',
  ethereum: 'ETH',
};

export interface UnitMatch {
  kind: 'unit';
  category: CategoryId;
  unitId: string;
}

/** Resolve a bare unit token ("miles", "km", "°c") to a category+unit, or null. */
export function lookupUnitToken(token: string): UnitMatch | null {
  const t = token.trim().toLowerCase();
  const hit = UNIT_LEXICON[t] ?? UNIT_LEXICON[t.split(/\s+/)[0] ?? t];
  return hit ? { kind: 'unit', category: hit.category, unitId: hit.unitId } : null;
}

/** Resolve a bare currency/crypto token ("usd", "€", "btc") to an ISO/ticker code. */
export function lookupCurrencyToken(token: string): string | null {
  const t = token.trim();
  const upper = t.toUpperCase();
  if (CURRENCY_CODES.has(upper)) return upper;
  const lower = t.toLowerCase();
  if (CRYPTO_TOKENS[lower]) return CRYPTO_TOKENS[lower]!;
  if (CURRENCY_SYMBOL[lower]) return CURRENCY_SYMBOL[lower]!;
  return null;
}

/** Extract the first number from a string. Handles a leading currency symbol,
 *  thousands separators (`1,234.56`) and a bare decimal. Returns null if none. */
function extractNumber(s: string): { value: number; rest: string } | null {
  // Grab digits with optional grouping/decimal. Keep the surrounding text as `rest`.
  const m = s.match(/-?\d[\d,._\s]*\.?\d*/);
  if (!m) return null;
  const raw = m[0].replace(/[\s,_]/g, '');
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return null;
  const rest = (s.slice(0, m.index).trim() + ' ' + s.slice((m.index ?? 0) + m[0].length).trim()).trim();
  return { value, rest };
}

/**
 * Parse a selection/omnibox fragment into a recognised quantity, or null.
 * Only the leading quantity is parsed (e.g. "$50 for lunch" → 50 USD).
 */
export function parseQuantity(input: string): Parsed | null {
  const text = input.trim();
  if (!text || text.length > 120) return null;
  const lower = text.toLowerCase();

  // Currency/crypto symbol glued to a number: "$50", "€1,200".
  const symMatch = lower.match(/^(us\$|[$€£₽¥₹₴₩₺])\s*(-?[\d.,_\s]+)/);
  if (symMatch) {
    const code = CURRENCY_SYMBOL[symMatch[1]!];
    const num = extractNumber(symMatch[2]!);
    if (code && num) return { kind: 'currency', code, value: num.value };
  }

  const num = extractNumber(lower);
  if (!num) return null;

  const token = num.rest.replace(/^of\s+/, '').replace(/[.,;:!?]+$/, '').trim();
  if (!token) return null;

  // Currency code / crypto ticker after the number: "50 usd", "1 btc".
  const upper = token.toUpperCase();
  if (CURRENCY_CODES.has(upper)) return { kind: 'currency', code: upper, value: num.value };
  const firstWord = token.split(/\s+/)[0] ?? token;
  if (CURRENCY_CODES.has(firstWord.toUpperCase())) {
    return { kind: 'currency', code: firstWord.toUpperCase(), value: num.value };
  }
  const crypto = CRYPTO_TOKENS[firstWord];
  if (crypto) return { kind: 'currency', code: crypto, value: num.value };
  const symCode = CURRENCY_SYMBOL[firstWord];
  if (symCode) return { kind: 'currency', code: symCode, value: num.value };

  // Unit token — try the whole tail, then the first word.
  const unit = UNIT_LEXICON[token] ?? UNIT_LEXICON[firstWord];
  if (unit) return { kind: 'unit', category: unit.category, unitId: unit.unitId, value: num.value };

  return null;
}
