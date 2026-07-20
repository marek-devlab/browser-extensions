import { storage } from '#imports';

// Currency + crypto — the PRIVATE design (PLAN.md §11.3):
//
// 🔴 We fetch the WHOLE rate TABLE (base=USD) and convert the user's amount
// LOCALLY. The amount is never in any request — only "give me today's table" is.
// Tables are cached in `storage.local` with a timestamp; on a stale/unreachable
// network the UI shows the LAST cached table WITH ITS AGE and never a fabricated
// number (fail-safe).
//
// Sources, disclosed in the UI:
//   - Fiat: Frankfurter (api.frankfurter.dev) — no key, ECB data. "as of <date> ·
//     ECB via Frankfurter".
//   - Crypto: CoinGecko (api.coingecko.com) — no key. Requires a visible
//     "Data provided by CoinGecko" attribution, which the popup renders.
//
// ⚠️ CORS: both endpoints send permissive CORS (Access-Control-Allow-Origin: *),
// so the fetch needs NO host_permissions. This MUST be re-verified against live
// headers before release; if a provider drops CORS, the fetch is gated behind the
// `optional_host_permissions` already declared in wxt.config.ts and requested on a
// gesture. See fetchTable()'s error handling — a CORS failure surfaces as a normal
// "unreachable", so the cached table still shows.

export const FIAT_ENDPOINT = 'https://api.frankfurter.dev/v1/latest?base=USD';
export const CRYPTO_ENDPOINT = 'https://api.coingecko.com/api/v3/simple/price';

/** CoinGecko ids for the crypto we price, keyed by the ticker the UI shows. */
export const CRYPTO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
};

/** Fiat vs-currencies we ask CoinGecko to price crypto against. Lowercase per its
 *  API; these are technical tokens, never translated. */
const CRYPTO_VS = ['usd', 'eur', 'rub', 'gbp'];

export interface FiatTable {
  /** Base currency of the table (USD). */
  base: string;
  /** ECB reference date, e.g. "2026-07-17" — what the disclosure shows. */
  date: string;
  /** code → units of that code per 1 base (USD). Includes the base itself (=1). */
  rates: Record<string, number>;
  /** Local wall-clock at fetch, for the age label. */
  fetchedAt: number;
}

export interface CryptoTable {
  /** coingecko id → { vsCurrency(lower) → price }. */
  prices: Record<string, Record<string, number>>;
  fetchedAt: number;
}

export const fiatTableItem = storage.defineItem<FiatTable | null>('local:fiatTable', {
  fallback: null,
});
export const cryptoTableItem = storage.defineItem<CryptoTable | null>('local:cryptoTable', {
  fallback: null,
});

/** How long a cached table is considered fresh (12 h). Older is still SHOWN — with
 *  its age — but a background refresh is attempted. */
export const FRESH_MS = 12 * 60 * 60 * 1000;

function isFresh(t: { fetchedAt: number } | null): boolean {
  return t != null && Date.now() - t.fetchedAt < FRESH_MS;
}

/* -------------------------------------------------------------------------- */
/* Fetching — CALLED FROM THE BACKGROUND SW. Never sends the user's amount.     */
/* -------------------------------------------------------------------------- */

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFiatTable(): Promise<FiatTable> {
  const data = (await fetchJson(FIAT_ENDPOINT)) as {
    base?: string;
    date?: string;
    rates?: Record<string, number>;
  };
  if (!data || typeof data.rates !== 'object' || data.rates === null) {
    throw new Error('Malformed rate table');
  }
  const base = typeof data.base === 'string' ? data.base : 'USD';
  const rates: Record<string, number> = { [base]: 1 };
  for (const [code, value] of Object.entries(data.rates)) {
    if (typeof value === 'number' && Number.isFinite(value)) rates[code] = value;
  }
  return {
    base,
    date: typeof data.date === 'string' ? data.date : '',
    rates,
    fetchedAt: Date.now(),
  };
}

export async function fetchCryptoTable(): Promise<CryptoTable> {
  const ids = Object.values(CRYPTO_IDS).join(',');
  const url = `${CRYPTO_ENDPOINT}?ids=${encodeURIComponent(ids)}&vs_currencies=${CRYPTO_VS.join(',')}`;
  const data = (await fetchJson(url)) as Record<string, Record<string, number>>;
  if (!data || typeof data !== 'object') throw new Error('Malformed crypto table');
  const prices: Record<string, Record<string, number>> = {};
  for (const [id, row] of Object.entries(data)) {
    if (row && typeof row === 'object') {
      const clean: Record<string, number> = {};
      for (const [vs, price] of Object.entries(row)) {
        if (typeof price === 'number' && Number.isFinite(price)) clean[vs] = price;
      }
      prices[id] = clean;
    }
  }
  return { prices, fetchedAt: Date.now() };
}

export interface RefreshResult {
  fiat: boolean;
  crypto: boolean;
}

/**
 * Refresh whatever is stale and persist it. Each source is independent: a crypto
 * outage never blocks a fiat refresh. Returns which sources updated. NEVER throws —
 * a total failure just leaves the cached tables in place (fail-safe).
 */
export async function refreshRates(force = false): Promise<RefreshResult> {
  const [fiat, crypto] = await Promise.all([fiatTableItem.getValue(), cryptoTableItem.getValue()]);
  const result: RefreshResult = { fiat: false, crypto: false };

  if (force || !isFresh(fiat)) {
    try {
      await fiatTableItem.setValue(await fetchFiatTable());
      result.fiat = true;
    } catch {
      // Keep the last good table; the UI shows its age.
    }
  }
  if (force || !isFresh(crypto)) {
    try {
      await cryptoTableItem.setValue(await fetchCryptoTable());
      result.crypto = true;
    } catch {
      // Keep the last good table.
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Local conversion — everything expressed in USD, so crypto↔fiat is one path.  */
/* -------------------------------------------------------------------------- */

/** The currencies the popup offers (fiat + crypto), in display order. Codes are
 *  technical tokens, never translated. */
export const CURRENCY_CODES = [
  'USD',
  'EUR',
  'GBP',
  'RUB',
  'JPY',
  'CNY',
  'CHF',
  'CAD',
  'AUD',
  'INR',
  'UAH',
  'PLN',
  'SEK',
  'BRL',
  'BTC',
  'ETH',
];

export const CRYPTO_SET = new Set(Object.keys(CRYPTO_IDS));

export interface MoneySnapshot {
  /** code → its value in USD (USD = 1). Only codes we can price appear. */
  usdPer: Record<string, number>;
  /** ECB date of the fiat table, for disclosure. */
  fiatDate: string;
  /** Oldest fetch time among the tables used, for the age label. */
  fetchedAt: number | null;
  /** True if a crypto price was included (drives the CoinGecko attribution). */
  hasCrypto: boolean;
}

/** Build a combined USD-denominated snapshot from the cached tables. Missing tables
 *  are tolerated: whatever can be priced is priced; the rest is simply absent. */
export function buildSnapshot(fiat: FiatTable | null, crypto: CryptoTable | null): MoneySnapshot {
  const usdPer: Record<string, number> = {};
  let fetchedAt: number | null = null;

  if (fiat) {
    for (const [code, perUsd] of Object.entries(fiat.rates)) {
      if (perUsd > 0) usdPer[code] = 1 / perUsd; // USD value of one unit of `code`
    }
    fetchedAt = fiat.fetchedAt;
  }

  let hasCrypto = false;
  if (crypto) {
    for (const [ticker, id] of Object.entries(CRYPTO_IDS)) {
      const usd = crypto.prices[id]?.usd;
      if (typeof usd === 'number' && usd > 0) {
        usdPer[ticker] = usd;
        hasCrypto = true;
      }
    }
    fetchedAt = fetchedAt === null ? crypto.fetchedAt : Math.min(fetchedAt, crypto.fetchedAt);
  }

  return { usdPer, fiatDate: fiat?.date ?? '', fetchedAt, hasCrypto };
}

/** Convert `amount` from → to using the snapshot. Returns null if either code is
 *  not priced — 🔴 never a fabricated number. */
export function convertMoney(
  snapshot: MoneySnapshot,
  amount: number,
  from: string,
  to: string,
): number | null {
  if (!Number.isFinite(amount)) return null;
  const fromUsd = snapshot.usdPer[from];
  const toUsd = snapshot.usdPer[to];
  if (!fromUsd || !toUsd) return null;
  return (amount * fromUsd) / toUsd;
}

/** Read both cached tables and assemble a snapshot (no network). */
export async function readSnapshot(): Promise<MoneySnapshot> {
  const [fiat, crypto] = await Promise.all([fiatTableItem.getValue(), cryptoTableItem.getValue()]);
  return buildSnapshot(fiat, crypto);
}
