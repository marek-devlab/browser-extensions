import type { VitalRating, WebVital } from './types';

/**
 * Core Web Vitals thresholds, p75 of real users over a 28-day CrUX window.
 * INP replaced FID on 2024-03-12; the set has been LCP/INP/CLS since.
 * FCP and TTFB are supplementary, not Core.
 */
export const VITAL_THRESHOLDS: Record<
  WebVital['name'],
  { good: number; poor: number }
> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

export function rateVital(name: WebVital['name'], value: number): VitalRating {
  const t = VITAL_THRESHOLDS[name];
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'needs-improvement';
  return 'poor';
}

export function formatVital(vital: WebVital): string {
  if (vital.unit === 'score') return vital.value.toFixed(3);
  if (vital.value >= 1000) return `${(vital.value / 1000).toFixed(2)} s`;
  return `${Math.round(vital.value)} ms`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
