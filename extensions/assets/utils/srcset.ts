import type { SrcsetCandidate, SrcsetAnalysis, SrcsetVerdict, PictureSource } from './assets-types';
import { normalizeUrl } from './resource-timing';
import type { TFn } from './i18n';

// The srcset winner recomputation — the signature feature (design §6). Knowing WHY
// the browser picked a file is otherwise near-impossible: DevTools shows you only
// `currentSrc` and leaves the density arithmetic to your head.
//
// 🔴 Honesty invariant (design §6.2): the ONE fact is `currentSrc`. Everything else
// here is a RECONSTRUCTION of the spec algorithm and may legitimately differ from
// what the browser did (a larger candidate already in cache, Data Saver, rounding).
// So:
//   - `chosen`         comes from matching currentSrc — the fact;
//   - `modelWinner`    is what this module computes — the explanation;
//   - `modelDisagrees` is surfaced LOUDLY when they differ, by us, first.

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
    out.push({ url, descriptor, descriptorType: m[2] as 'w' | 'x', value: Number(m[1]) });
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

/** Build the full analysis. `chosen` is the fact; the reasons are computed. */
export function analyzeSrcset(
  candidates: SrcsetCandidate[],
  slotWidthCss: number | null,
  dpr: number,
  currentSrc: string,
  sizesAttr: string | null,
  sources: PictureSource[] = [],
  t?: TFn,
): SrcsetAnalysis {
  const modelWinnerUrl = computeModelWinner(candidates, slotWidthCss, dpr);
  const hasWDescriptor = candidates.some((c) => c.descriptorType === 'w');
  const verdicts: SrcsetVerdict[] = candidates.map((candidate) => {
    const d = effectiveDensity(candidate, slotWidthCss);
    const chosen = sameResource(candidate.url, currentSrc);
    const modelWinner = candidate.url === modelWinnerUrl;
    return { candidate, effectiveDensity: d, chosen, modelWinner, reason: reasonFor(d, dpr, modelWinner, t) };
  });

  const factWinner = verdicts.find((v) => v.chosen);
  const modelDisagrees =
    factWinner !== undefined &&
    modelWinnerUrl !== null &&
    !sameResource(factWinner.candidate.url, modelWinnerUrl);

  return {
    slotWidthCss,
    dpr,
    sizesAttr,
    sizesMissing: hasWDescriptor && (sizesAttr === null || sizesAttr.trim() === ''),
    currentSrc,
    candidates: verdicts,
    sources,
    modelDisagrees,
  };
}

function reasonFor(density: number | null, dpr: number, modelWinner: boolean, t?: TFn): string {
  if (density === null) {
    return t ? t('reasonSlotUnknown') : 'slot width unknown — density not computable';
  }
  if (modelWinner) {
    return t ? t('reasonFirstAboveDpr', { dpr }) : `first density ≥ DPR ${dpr}`;
  }
  if (density < dpr) {
    return t ? t('reasonBelowDpr', { density: density.toFixed(2), dpr }) : `× ${density.toFixed(2)} < DPR ${dpr}`;
  }
  return t ? t('reasonLargerThanNeeded', { density: density.toFixed(2) }) : `× ${density.toFixed(2)} — larger than needed`;
}

/**
 * Compare two resource URLs after normalisation (design §4.1): a relative candidate
 * must match the absolute `currentSrc`, and the hash is not part of a request.
 */
export function sameResource(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return normalizeUrl(a) === normalizeUrl(b);
}

/* ------------------------------------------------------------------------- */
/* DOM-side resolution: what the browser actually used as the slot width       */
/* ------------------------------------------------------------------------- */

/**
 * Resolve `sizes` to the slot width in CSS px — the number the browser divides the
 * w-descriptors by. Two exact ingredients, no guessing:
 *   - which `sizes` entry applies: `matchMedia()` (the same engine the browser uses);
 *   - what its length is in px: a real, hidden measuring element (so vw/em/calc()
 *     are resolved by the layout engine, not by our arithmetic).
 *
 * The measuring node lives in OUR closed shadow root, is `visibility:hidden` and is
 * removed immediately — the page never sees it and no style leaks in either
 * direction. `sizes="auto"` means "use the layout width", which is exactly what the
 * element's own border box already tells us.
 */
export function resolveSlotWidth(
  sizesAttr: string | null,
  el: Element,
  measureIn: ShadowRoot | Element,
): number | null {
  const layoutWidth = el.getBoundingClientRect().width;
  if (sizesAttr === null || sizesAttr.trim() === '') {
    // No `sizes` with w-descriptors → the spec says the slot is 100vw. This is THE
    // most common cause of an overweight image, and the card says so (design §6.3).
    return window.innerWidth;
  }
  const trimmed = sizesAttr.trim();
  if (trimmed === 'auto' || trimmed.startsWith('auto,')) {
    return layoutWidth > 0 ? layoutWidth : null;
  }

  for (const raw of trimmed.split(',')) {
    const entry = raw.trim();
    if (entry === '') continue;
    const close = entry.lastIndexOf(')');
    const condition = close === -1 ? null : entry.slice(0, close + 1).trim();
    const length = (close === -1 ? entry : entry.slice(close + 1)).trim();
    if (length === '') continue;
    if (condition === null) return measureLength(length, el, measureIn);
    try {
      if (window.matchMedia(condition).matches) return measureLength(length, el, measureIn);
    } catch {
      // Unparseable media condition — skip this entry rather than lie about it.
    }
  }
  return null;
}

/** Measure a CSS length (`50vw`, `calc(100vw - 2rem)`, `720px`) in CSS px. */
function measureLength(length: string, el: Element, measureIn: ShadowRoot | Element): number | null {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:-9999px;top:0;height:0;visibility:hidden;contain:strict;';
  // Inherit the element's font metrics so `em`/`rem` resolve the way they did for it.
  try {
    probe.style.fontSize = getComputedStyle(el).fontSize;
  } catch {
    /* element gone — fall back to the default font size */
  }
  probe.style.width = length;
  measureIn.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width > 0 ? width : null;
}

/**
 * Stage 1 of the selection: which `<source>` of a `<picture>` won. The winner is a
 * FACT (currentSrc is one of its candidates); the reasons the others lost are
 * computed with matchMedia (exact). "Format not supported" is not knowable to us —
 * and it turns out not to be needed (design §6.1).
 */
export function analyzePictureSources(img: HTMLImageElement, currentSrc: string): PictureSource[] {
  const picture = img.parentElement;
  if (!(picture instanceof HTMLPictureElement)) return [];
  const out: PictureSource[] = [];
  for (const source of Array.from(picture.querySelectorAll('source'))) {
    const srcset = source.getAttribute('srcset') ?? '';
    const media = source.getAttribute('media');
    let mediaMatches = true;
    if (media) {
      try {
        mediaMatches = window.matchMedia(media).matches;
      } catch {
        mediaMatches = false;
      }
    }
    const won = parseSrcset(srcset).some((c) => sameResource(c.url, currentSrc));
    out.push({ media, type: source.getAttribute('type'), srcset, mediaMatches, won });
  }
  return out;
}
