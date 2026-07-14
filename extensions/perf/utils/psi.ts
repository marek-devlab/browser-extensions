import type { WebVital } from '@blur/core';
import { rateVital } from '@blur/core';
import type { CruxField, CruxFieldMetric } from './perf-types';

// PageSpeed Insights integration (PLAN.md §9). Lighthouse itself CANNOT be
// bundled — it is a Node application and MV3 bans remote code. PSI is a plain
// REST *data* fetch, which is allowed.
//
// Constraints honoured here:
//   - Rate limits: ~25,000 queries/day, 400 per 100 seconds. An API key is
//     strongly recommended and is passed when present.
//   - Public URLs only: localhost and pages behind auth are unreachable by
//     Google's crawler — `isAuditableUrl` refuses those before spending a call.
//   - Privacy: this sends the inspected URL to Google. The caller MUST disclose
//     that before the first call. The API key lives in storage.local (never
//     sync) — see utils/storage.ts.

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/** PSI lab strategy. PSI runs Lighthouse under an emulated device profile. */
export type PsiStrategy = 'mobile' | 'desktop';

export interface PsiAuditResult {
  url: string;
  /** Which emulated device the lab run used. */
  strategy: PsiStrategy;
  /**
   * Lighthouse performance category score, 0–100, or null when the response
   * carried no score. Rendered as "—", never 0 (0 reads as the worst possible
   * score, which is a different claim from "unavailable") — bug 1h.
   */
  performanceScore: number | null;
  /** Lab Core Web Vitals + supplementary metrics (from Lighthouse). */
  vitals: WebVital[];
  /** CrUX real-user field data (p75), page-level and origin-level. */
  field: CruxField;
  fetchedAt: string;
}

/** How long to wait for a PSI response before giving up (bug 1i). PSI lab runs
 * can be slow, so this is generous; without it a hung request leaves the audit
 * button stuck on "Auditing…" forever. */
const PSI_TIMEOUT_MS = 60_000;

export interface UrlVerdict {
  ok: boolean;
  reason?: string;
}

/** Refuse non-public URLs before spending a PSI request. */
export function isAuditableUrl(rawUrl: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Not a valid URL.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'Only http(s) pages can be audited.' };
  }
  const host = url.hostname.toLowerCase();
  // URL hostnames for IPv6 literals are bracketed (e.g. `[::1]`); strip them so
  // the IPv6 checks below see the bare address.
  const bare = host.replace(/^\[/, '').replace(/\]$/, '');
  const isIpv6 = host.startsWith('[') || bare.includes(':');
  const isLocal =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    // IPv4 loopback (127.0.0.0/8), private (RFC 1918) and link-local (169.254/16).
    /^127\./.test(bare) ||
    /^10\./.test(bare) ||
    /^192\.168\./.test(bare) ||
    /^169\.254\./.test(bare) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(bare) ||
    bare === '0.0.0.0' ||
    // IPv6 loopback / unspecified / link-local.
    (isIpv6 && (bare === '::1' || bare === '::' || bare.startsWith('fe80:')));
  if (isLocal) {
    return {
      ok: false,
      reason: 'PSI cannot reach localhost or private-network addresses.',
    };
  }
  return { ok: true };
}

interface PsiMetricValue {
  percentile?: number;
  category?: string;
}

interface PsiLoadingExperience {
  metrics?: Record<string, PsiMetricValue | undefined>;
}

interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: {
      'largest-contentful-paint'?: { numericValue?: number };
      'cumulative-layout-shift'?: { numericValue?: number };
      'first-contentful-paint'?: { numericValue?: number };
      'server-response-time'?: { numericValue?: number };
      'total-blocking-time'?: { numericValue?: number };
    };
  };
  /** Page-level CrUX field data. */
  loadingExperience?: PsiLoadingExperience;
  /** Origin-level CrUX field data. */
  originLoadingExperience?: PsiLoadingExperience;
}

function vital(name: WebVital['name'], value: number, unit: WebVital['unit']): WebVital {
  return { name, value, unit, rating: rateVital(name, value) };
}

// CrUX metric key → our vital name + unit. CLS percentiles come multiplied by 100
// (e.g. 10 → 0.10), so they need scaling; the timing metrics are already in ms.
const CRUX_METRICS: Record<
  string,
  { name: CruxFieldMetric['name']; unit: CruxFieldMetric['unit']; scale: number }
> = {
  LARGEST_CONTENTFUL_PAINT_MS: { name: 'LCP', unit: 'ms', scale: 1 },
  CUMULATIVE_LAYOUT_SHIFT_SCORE: { name: 'CLS', unit: 'score', scale: 1 / 100 },
  FIRST_CONTENTFUL_PAINT_MS: { name: 'FCP', unit: 'ms', scale: 1 },
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: { name: 'TTFB', unit: 'ms', scale: 1 },
  INTERACTION_TO_NEXT_PAINT: { name: 'INP', unit: 'ms', scale: 1 },
};

const CRUX_ORDER: CruxFieldMetric['name'][] = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'];

function cruxRating(category: string | undefined, value: number, name: CruxFieldMetric['name']): CruxFieldMetric['rating'] {
  // Prefer CrUX's own bucket; fall back to our thresholds if it's absent.
  switch (category) {
    case 'FAST':
      return 'good';
    case 'AVERAGE':
      return 'needs-improvement';
    case 'SLOW':
      return 'poor';
    default:
      return rateVital(name, value);
  }
}

function parseCrux(experience: PsiLoadingExperience | undefined): CruxFieldMetric[] {
  const metrics = experience?.metrics;
  if (!metrics) return [];
  const out: CruxFieldMetric[] = [];
  for (const [key, spec] of Object.entries(CRUX_METRICS)) {
    const raw = metrics[key];
    const pct = raw?.percentile;
    if (typeof pct !== 'number') continue;
    const p75 = pct * spec.scale;
    out.push({
      name: spec.name,
      p75,
      unit: spec.unit,
      rating: cruxRating(raw?.category, p75, spec.name),
    });
  }
  out.sort((a, b) => CRUX_ORDER.indexOf(a.name) - CRUX_ORDER.indexOf(b.name));
  return out;
}

function parse(url: string, strategy: PsiStrategy, data: PsiResponse): PsiAuditResult {
  const audits = data.lighthouseResult?.audits ?? {};
  const score = data.lighthouseResult?.categories?.performance?.score;
  const vitals: WebVital[] = [];

  const lcp = audits['largest-contentful-paint']?.numericValue;
  if (typeof lcp === 'number') vitals.push(vital('LCP', lcp, 'ms'));
  const cls = audits['cumulative-layout-shift']?.numericValue;
  if (typeof cls === 'number') vitals.push(vital('CLS', cls, 'score'));
  const fcp = audits['first-contentful-paint']?.numericValue;
  if (typeof fcp === 'number') vitals.push(vital('FCP', fcp, 'ms'));
  const ttfb = audits['server-response-time']?.numericValue;
  if (typeof ttfb === 'number') vitals.push(vital('TTFB', ttfb, 'ms'));

  return {
    url,
    strategy,
    // null when absent — never 0, which would read as the worst possible score.
    performanceScore: typeof score === 'number' ? Math.round(score * 100) : null,
    vitals,
    field: {
      url: parseCrux(data.loadingExperience),
      origin: parseCrux(data.originLoadingExperience),
    },
    fetchedAt: new Date().toISOString(),
  };
}

export async function runPsiAudit(
  url: string,
  apiKey?: string,
  strategy: PsiStrategy = 'mobile',
): Promise<PsiAuditResult> {
  const verdict = isAuditableUrl(url);
  if (!verdict.ok) throw new Error(verdict.reason ?? 'URL cannot be audited.');

  const endpoint = new URL(ENDPOINT);
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('strategy', strategy);
  endpoint.searchParams.set('category', 'performance');
  if (apiKey) endpoint.searchParams.set('key', apiKey);

  // Abort a hung request so the caller's spinner can't stick forever (bug 1i).
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), PSI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(endpoint.toString(), { signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(
        `PageSpeed Insights did not respond within ${Math.round(
          PSI_TIMEOUT_MS / 1000,
        )} s. Try again.`,
      );
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timer);
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const rec =
      typeof body === 'object' && body !== null
        ? (body as { error?: { message?: string } })
        : null;
    throw new Error(
      rec?.error?.message ?? `PageSpeed Insights request failed (${res.status}).`,
    );
  }
  return parse(url, strategy, (await res.json()) as PsiResponse);
}
