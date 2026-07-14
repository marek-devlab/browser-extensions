import type { SrcsetCandidate, SrcsetAnalysis, SrcsetVerdict } from './assets-types';

// The srcset winner recomputation — the signature feature (design §6). This is
// REAL logic, deliberately implemented now and scaffolded over (mock) candidates:
// the resource-card fills a mock candidate list and mock slot/DPR, and this pure
// function computes the density verdicts and the model winner honestly.
//
// 🔴 Honesty invariant (design §6.2): the ONE fact is `currentSrc`. Everything
// this function produces is a RECONSTRUCTION of the spec algorithm and may differ
// from what the browser actually loaded (cache, Data Saver, rounding). So:
//   - `chosen` is set from the currentSrc match (the fact), by the caller/mock;
//   - `modelWinner` is what THIS function computes;
//   - `modelDisagrees` is surfaced loudly when they differ.

/** Parse a raw `srcset` attribute into candidates. Pure, no DOM. */
export function parseSrcset(srcset: string): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = [];
  for (const part of srcset.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const [url, rawDescriptor] = splitOnce(trimmed);
    const descriptor = rawDescriptor ?? '1x';
    const m = /^(\d+(?:\.\d+)?)(w|x)$/.exec(descriptor);
    if (!m) {
      // Malformed descriptor -> treat as 1x density so it still shows in the table.
      out.push({ url, descriptor: '1x', descriptorType: 'x', value: 1 });
      continue;
    }
    out.push({
      url,
      descriptor,
      descriptorType: m[2] as 'w' | 'x',
      value: Number(m[1]),
    });
  }
  return out;
}

function splitOnce(s: string): [string, string | undefined] {
  const idx = s.search(/\s/);
  if (idx === -1) return [s, undefined];
  return [s.slice(0, idx), s.slice(idx).trim()];
}

/**
 * Effective density for a candidate: `value / slotWidth` for w-descriptors, or the
 * descriptor value itself for x-descriptors. null when the slot width is unknown.
 */
export function effectiveDensity(
  candidate: SrcsetCandidate,
  slotWidthCss: number | null,
): number | null {
  if (candidate.descriptorType === 'x') return candidate.value;
  if (slotWidthCss === null || slotWidthCss <= 0) return null;
  return candidate.value / slotWidthCss;
}

/**
 * Reconstruct which candidate the spec algorithm would pick: the SMALLEST
 * candidate whose effective density ≥ DPR; if none reaches DPR, the LARGEST.
 * Returns the winning candidate url, or null if there are no candidates.
 */
export function computeModelWinner(
  candidates: SrcsetCandidate[],
  slotWidthCss: number | null,
  dpr: number,
): string | null {
  if (candidates.length === 0) return null;
  const withDensity = candidates
    .map((c) => ({ c, d: effectiveDensity(c, slotWidthCss) }))
    .filter((x): x is { c: SrcsetCandidate; d: number } => x.d !== null)
    .sort((a, b) => a.d - b.d);
  if (withDensity.length === 0) return candidates[0]?.url ?? null;

  const firstAtOrAbove = withDensity.find((x) => x.d >= dpr);
  const winner = firstAtOrAbove ?? withDensity[withDensity.length - 1];
  return winner.c.url;
}

/**
 * Build the full analysis: per-candidate verdicts + whether our model disagrees
 * with the browser's actual choice (`currentSrc`). The `chosen` fact comes from
 * matching currentSrc; the reasons are computed.
 */
export function analyzeSrcset(
  candidates: SrcsetCandidate[],
  slotWidthCss: number | null,
  dpr: number,
  currentSrc: string,
  sizesAttr: string | null,
): SrcsetAnalysis {
  const modelWinnerUrl = computeModelWinner(candidates, slotWidthCss, dpr);
  const verdicts: SrcsetVerdict[] = candidates.map((candidate) => {
    const d = effectiveDensity(candidate, slotWidthCss);
    const chosen = sameResource(candidate.url, currentSrc);
    const modelWinner = candidate.url === modelWinnerUrl;
    return {
      candidate,
      effectiveDensity: d,
      chosen,
      modelWinner,
      reason: reasonFor(d, dpr, modelWinner),
    };
  });

  const factWinner = verdicts.find((v) => v.chosen);
  const modelDisagrees =
    factWinner !== undefined && modelWinnerUrl !== null && !sameResource(factWinner.candidate.url, modelWinnerUrl);

  return { slotWidthCss, dpr, sizesAttr, currentSrc, candidates: verdicts, modelDisagrees };
}

function reasonFor(density: number | null, dpr: number, modelWinner: boolean): string {
  if (density === null) return 'slot width unknown — density not computable';
  if (modelWinner) return `chosen: first density ≥ DPR ${dpr}`;
  if (density < dpr) return `× ${round(density)} < DPR ${dpr}`;
  return `× ${round(density)} — larger than needed`;
}

function round(n: number): string {
  return n.toFixed(2);
}

/**
 * Compare two resource URLs after normalisation. Matches the caller-side rule
 * (design §4.1): normalise both with `new URL(u, base).href` before comparing so a
 * relative candidate matches the absolute currentSrc. Here both are expected
 * pre-resolved; we compare by pathname+search to tolerate protocol-relative forms.
 */
export function sameResource(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const ua = new URL(a, 'https://x.invalid');
    const ub = new URL(b, 'https://x.invalid');
    return ua.pathname === ub.pathname && ua.search === ub.search;
  } catch {
    return false;
  }
}
