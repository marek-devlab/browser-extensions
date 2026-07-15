// Shared domain types for the Asset Inspector. Pure data — no browser/DOM APIs —
// so the popup, options, DevTools panel and the injected inspector overlay all
// speak the same shapes. The card is described declaratively (a `ResourceCardModel`)
// and every surface renders it with textContent only (design §9.1 — zero innerHTML).

/** How the element gets its bytes. `none` = drawn by CSS, no loaded resource. */
export type ResourceKind = 'image' | 'video' | 'audio' | 'iframe' | 'css-background' | 'none';

/**
 * Which card layout to render. Each maps to a design section:
 *   image                -> §2.2 (srcset card)
 *   mse                  -> §2.3 (MSE/DRM honest card)
 *   progressive-video    -> §4.2
 *   iframe-cross-origin  -> §4.8 (the "honest failure" screen)
 *   no-resource          -> §5.2
 *   blob / data          -> §5.8 / §5.9
 *   failed               -> §5.10 (404/CORS, cause unknown cross-origin)
 */
export type CardVariant =
  | 'image'
  | 'mse'
  | 'progressive-video'
  | 'iframe-cross-origin'
  | 'iframe-same-origin'
  | 'no-resource'
  | 'blob'
  | 'data'
  | 'failed';

/** One srcset candidate parsed from the attribute (`hero-960.avif 960w`). */
export interface SrcsetCandidate {
  url: string;
  /** The raw descriptor as written: `960w` or `2x`. */
  descriptor: string;
  descriptorType: 'w' | 'x';
  /** Numeric part of the descriptor: 960 or 2. */
  value: number;
}

/** A candidate row after the winner recomputation (§6). */
export interface SrcsetVerdict {
  candidate: SrcsetCandidate;
  /** value/slotWidth for `w`; the descriptor itself for `x`. null if unknown. */
  effectiveDensity: number | null;
  /** FACT: currentSrc resolves to this candidate. The one source of truth (§6.2). */
  chosen: boolean;
  /** Our reconstruction of the spec algorithm picked this one (may disagree). */
  modelWinner: boolean;
  /** Human-readable "why" for this row. */
  reason: string;
}

/** One `<source>` inside a `<picture>` — stage 1 of the selection (§6.1). */
export interface PictureSource {
  media: string | null;
  type: string | null;
  srcset: string;
  /** matchMedia() result — computed, and exact. */
  mediaMatches: boolean;
  /** FACT: currentSrc is one of this source's candidates → this source won. */
  won: boolean;
}

export interface SrcsetAnalysis {
  /** Resolved slot width in CSS px (from `sizes`), or null if not computable. */
  slotWidthCss: number | null;
  dpr: number;
  sizesAttr: string | null;
  /** No `sizes` with w-descriptors → the browser assumes 100vw. The single most
   *  common cause of overweight, and it ties the two headline features together. */
  sizesMissing: boolean;
  currentSrc: string;
  candidates: SrcsetVerdict[];
  /** `<picture>` stage — empty when the img is not inside a <picture>. */
  sources: PictureSource[];
  /** Our model chose a different winner than the browser did (§6.2). Show LOUDLY. */
  modelDisagrees: boolean;
}

/**
 * Weight is never faked. Cross-origin without Timing-Allow-Origin is UNKNOWABLE
 * and stays that way — never "0 KB" (design §7 №1; resolveTransferSize already
 * returns null, we carry the null all the way to the DOM).
 */
export type WeightState =
  | { kind: 'measured'; bytes: number }
  | { kind: 'cache'; bytes: 0 }
  | { kind: 'unmeasured'; reason: string }
  | { kind: 'not-in-buffer' };

/** A group of requests, collapsed by host BEFORE render (design §10.3). */
export interface RequestGroup {
  host: string;
  /** initiatorType (`img`/`css`/`fetch`/`media`…). */
  kind: string;
  count: number;
  sampleUrl: string;
  crossOrigin: boolean;
}

export interface RedirectStep {
  status: number;
  url: string;
  note?: string;
}

/** Four genuinely different facts about redirects (design §5.7, §7 №3). */
export type RedirectState =
  | { kind: 'chain'; steps: RedirectStep[] } // DevTools panel only
  | { kind: 'occurred' } // same-origin/TAO, panel closed: a redirect happened
  | { kind: 'none' } // TAO-exposed and no redirect timings: genuinely none
  | { kind: 'unknown' }; // cross-origin without TAO: can't even tell

export interface OverweightVerdict {
  ratio: number;
  naturalWidth: number;
  /** cssWidth × DPR. */
  neededWidth: number;
  displayedWidth: number;
  /** ≥ threshold -> 'warn'; ≥ 2×threshold -> 'poor' (design §2.4). */
  severity: 'warn' | 'poor';
}

/** MIME with an explicit certainty — never a guess dressed as fact (design §7 №4). */
export interface MimeInfo {
  value: string;
  certainty: 'exact' | 'guessed-extension' | 'unknown';
}

/** Resource Timing buffer accounting (design §5.11, §10.5). */
export interface BufferState {
  recorded: number;
  limit: number;
  /** `resourcetimingbufferfull` fired: the browser is now DROPPING NEW entries. */
  overflowed: boolean;
  nearFull: boolean;
}

/** Why an element failed to load, as far as the DOM will honestly say (§5.10). */
export interface LoadFailure {
  /** e.g. `MEDIA_ERR_SRC_NOT_SUPPORTED`, or null when the browser won't say. */
  code: string | null;
  message: string;
}

export interface ResourceCardModel {
  kind: ResourceKind;
  variant: CardVariant;
  /** e.g. `<img class="hero">`. */
  elementLabel: string;
  /** The adblock-style CSS selector for the picked node. */
  selector: string;
  /** The FACT: what the browser actually loaded (currentSrc), verbatim (design §2.2). */
  currentSrc: string;
  /** What the markup ASKED for — shown when it differs from currentSrc. */
  markupSrc?: string;
  /** Whether "Open in new tab" is enabled (http/https only; off for blob/data/MSE). */
  urlOpenable: boolean;
  openDisabledReason?: string;

  mime: MimeInfo;
  /** Container/codec ONLY when the author declared it (`<source type=…>`); we never
   *  invent "H.264" (design §7 №5). */
  declaredType?: string;
  naturalSize?: { w: number; h: number };
  displayedSize?: { w: number; h: number; dpr: number };
  overweight?: OverweightVerdict | null;
  srcset?: SrcsetAnalysis | null;
  attributes?: Record<string, string>;
  alt?: string;
  /** The element is inside a CLOSED shadow root's host — we cannot look in (§4.7). */
  closedShadow?: boolean;
  /** The element did not load. Cause is often unknowable cross-origin (§5.10). */
  failure?: LoadFailure;

  weight: WeightState;
  /** scriptKnown is ALWAYS false outside the DevTools panel (design §1.2, §7 №2). */
  initiator: { type: string; scriptKnown: boolean };
  /** null = cross-origin without TAO. 🔴 Never 200 by default (§7 №15). */
  status: number | null;
  requests: RequestGroup[];
  /** Requests matched by type+host, not by fact — say so (design §7 №7). */
  requestsHeuristic: boolean;
  redirects: RedirectState;
  buffer: BufferState;

  // ---- variant-specific payloads ----
  mse?: {
    blobUrl: string;
    mechanism: 'MSE';
    resolution?: { w: number; h: number };
    frames?: { rendered: number; dropped: number };
    /** EME active — NOT the DRM system name, which we cannot know (design §2.3). */
    drmActive: boolean;
  };
  video?: {
    resolution?: { w: number; h: number };
    duration: number | null;
    frames?: { rendered: number; dropped: number };
  };
  iframe?: { src: string; size: { w: number; h: number }; attributes: Record<string, string>; sameOrigin: boolean };
  dataUri?: { prefix: string; length: number; head: string };
  /** For no-resource: the CSS rule painting the element (§5.2). */
  cssRule?: string;
  /** A nested element that DOES have a resource — "the resource is on the <img> inside". */
  nestedHint?: string;
}

/** Message from the background to the injected inspector (kept minimal — the
 *  overlay does NOT leak page data; only the picked URL travels, on user action). */
export interface InspectorStartMessage {
  type: 'assets:start';
  /** From a context-menu invocation: the src the user right-clicked (design §4.9). */
  srcUrl?: string;
}

/** Counts for the popup. COUNTS, never a byte budget — a budget would be `perf`. */
export interface PageCounters {
  requestsRecorded: number;
  images: number;
  media: number;
  bufferLimit: number;
  overflowed: boolean;
}
