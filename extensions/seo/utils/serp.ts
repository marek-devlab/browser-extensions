// SERP snippet preview measurement. Google truncates the title and description
// by PIXEL width, not character count, so the preview measures rendered width
// with an injectable `Measure` function (the UI backs it with a `<canvas>` 2D
// context; tests back it with a deterministic stub). Pure and DOM-free here so
// the truncation logic stays unit-testable without a browser.

/** Approximate pixel widths at which Google truncates each field with an ellipsis. */
export const SERP_TITLE_MAX_PX = 580;
/** Google truncates descriptions in the ~920–990px band; warn at the low end. */
export const SERP_DESC_MAX_PX = 920;

/** Measures the rendered pixel width of a string in the relevant SERP font. */
export type Measure = (text: string) => number;

export interface SerpField {
  /** The full text as authored. */
  full: string;
  /** The text as it would render, truncated with an ellipsis if over budget. */
  display: string;
  /** Rendered pixel width of the full text. */
  pixels: number;
  maxPixels: number;
  truncated: boolean;
}

const ELLIPSIS = '…';

/**
 * Measure `text` and, if it exceeds `maxPixels`, compute the ellipsised string
 * that fits. Binary-search the cut point so we call `measure` O(log n) times.
 */
export function serpField(text: string, measure: Measure, maxPixels: number): SerpField {
  const clean = text.replace(/\s+/g, ' ').trim();
  const pixels = measure(clean);
  if (pixels <= maxPixels) {
    return { full: clean, display: clean, pixels, maxPixels, truncated: false };
  }

  // Largest prefix whose width + ellipsis fits within budget.
  let lo = 0;
  let hi = clean.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = clean.slice(0, mid).trimEnd() + ELLIPSIS;
    if (measure(candidate) <= maxPixels) lo = mid;
    else hi = mid - 1;
  }
  const display = clean.slice(0, lo).trimEnd() + ELLIPSIS;
  return { full: clean, display, pixels, maxPixels, truncated: true };
}

/**
 * Build a Google-style display URL from a page URL: "host › path › segments".
 * Falls back to the raw string if it will not parse.
 */
export function serpDisplayUrl(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter((s) => s.length > 0);
    return [u.hostname, ...segments].join(' › ');
  } catch {
    return url;
  }
}
