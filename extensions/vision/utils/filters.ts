import type { VisionSettings } from './storage';

// SVG-filter builder for the vision simulator (PLAN.md §13). Pure & browser-free:
// it produces an SVG `<defs>` string + a CSS string; the popup ships both to the
// active tab via scripting.executeScript (see inject.ts). No DOM here, so this is
// unit-testable.
//
// 🔴 ACCURACY (moat rule 4 — honest UI):
//   - Colour-vision-deficiency matrices are Machado, Oliveira & Fernandes (2009),
//     IEEE TVCG — the physiologically-derived model Chromium's Blink itself uses.
//     The severity-1.0 (dichromacy) values below are verified against Blink.
//   - ⚠️ Partial severity (the anomalous-trichromacy slider) is a LINEAR
//     interpolation between identity and the dichromacy matrix. That is an
//     APPROXIMATION of Machado's true intermediate matrices — exact only at 1.0.
//     The UI labels it as approximate. (A future refinement ships the full 0.0–1.0
//     Machado tables.)
//   - ⚠️ Tritanopia is not perfectly expressible as one matrix (accurate tritan
//     needs the Brettel 1997 two-half-plane method). The single matrix here is
//     Machado's approximation, labelled as such.
//   - Every filter runs in `linearRGB` (`color-interpolation-filters`) — the
//     wrong space silently yields wrong colours.

export type CvdType = 'protanopia' | 'deuteranopia' | 'tritanopia';

// 3×3 row-major, severity 1.0. Source: Machado et al. 2009 (matches Blink).
const DICHROMACY: Record<CvdType, readonly number[]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
const IDENTITY3: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function lerp(a: readonly number[], b: readonly number[], t: number): number[] {
  return a.map((v, i) => v + ((b[i] ?? 0) - v) * t);
}

/** A 3×3 colour matrix → the 20-value `feColorMatrix type="matrix"` string
 *  (rows R,G,B from the 3×3, alpha row identity, all offsets 0). */
function toFeMatrix(m3: readonly number[]): string {
  const [a, b, c, d, e, f, g, h, i] = m3;
  return `${a} ${b} ${c} 0 0  ${d} ${e} ${f} 0 0  ${g} ${h} ${i} 0 0  0 0 0 1 0`;
}

export function cvdMatrix(type: CvdType, severity: number): string {
  const t = Math.max(0, Math.min(1, severity));
  return toFeMatrix(lerp(IDENTITY3, DICHROMACY[type], t));
}

function round(n: number, dp = 2): string {
  return (Math.round(n * 10 ** dp) / 10 ** dp).toString();
}

interface Primitive {
  id: string;
  body: string;
}

/** Turn validated settings into the ordered list of filter primitives to chain:
 *  colour transform first, then blur, then contrast. */
function primitivesFor(s: VisionSettings): Primitive[] {
  const out: Primitive[] = [];

  if (s.cvd === 'protanopia' || s.cvd === 'deuteranopia' || s.cvd === 'tritanopia') {
    out.push({
      id: s.cvd,
      body: `<feColorMatrix type="matrix" values="${cvdMatrix(s.cvd, s.cvdSeverity)}"/>`,
    });
  } else if (s.cvd === 'achromatopsia') {
    // Luminance-preserving grayscale (Rec. 709 weights) — total colour loss.
    out.push({
      id: 'achromatopsia',
      body:
        '<feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"/>',
    });
  }

  if (s.grayscale) {
    out.push({ id: 'grayscale', body: '<feColorMatrix type="saturate" values="0"/>' });
  }

  if (s.cataract > 0) {
    // Blur + yellowing + a slight blue-channel drop, as in real lens clouding.
    const std = round(0.5 + s.cataract * 5);
    out.push({
      id: 'cataract',
      body:
        `<feGaussianBlur stdDeviation="${std}"/>` +
        `<feColorMatrix type="matrix" values="1 0 0 0 ${round(0.04 * s.cataract, 3)}  0 1 0 0 ${round(0.04 * s.cataract, 3)}  0 0 ${round(1 - 0.2 * s.cataract, 3)} 0 0  0 0 0 1 0"/>`,
    });
  }

  if (s.refractiveBlur > 0) {
    out.push({ id: 'blur', body: `<feGaussianBlur stdDeviation="${round(s.refractiveBlur * 8)}"/>` });
  }

  if (s.lowContrast > 0) {
    const slope = round(1 - s.lowContrast * 0.6, 3);
    const intercept = round((1 - Number(slope)) / 2, 3);
    const f = `type="linear" slope="${slope}" intercept="${intercept}"`;
    out.push({
      id: 'lowContrast',
      body: `<feComponentTransfer><feFuncR ${f}/><feFuncG ${f}/><feFuncB ${f}/></feComponentTransfer>`,
    });
  }

  return out;
}

export interface VisionDefs {
  /** SVG `<svg>` string carrying the `<filter>` defs, or '' when nothing active. */
  svg: string;
  /** CSS to apply on `<html>`, or '' when nothing active. */
  css: string;
}

const NS = 'http://www.w3.org/2000/svg';

export function buildVisionDefs(s: VisionSettings): VisionDefs {
  const prims = primitivesFor(s);
  if (prims.length === 0) return { svg: '', css: '' };

  const filters = prims
    .map(
      (p) =>
        `<filter id="bx-vf-${p.id}" x="-20%" y="-20%" width="140%" height="140%" ` +
        `color-interpolation-filters="linearRGB">${p.body}</filter>`,
    )
    .join('');
  const urls = prims.map((p) => `url(#bx-vf-${p.id})`).join(' ');

  const svg = `<svg xmlns="${NS}" width="0" height="0" aria-hidden="true"><defs>${filters}</defs></svg>`;
  const css = `html{filter:${urls} !important}`;
  return { svg, css };
}
