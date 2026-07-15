// Syntax colouring via the CSS Custom Highlight API (design §7.3, §10.1).
//
// This is the whole rendering strategy in one sentence: the text pane is ONE
// flat `<pre>` holding ONE text node, and colour is applied by registering
// `Range`s against it. Consequences that matter:
//
//   - ZERO HTML injection surface. User text is never turned into elements, so
//     there is nothing for a crafted document to inject INTO. Compare the usual
//     approach (build `<span class=...>` strings and assign innerHTML), which is
//     both an XSS sink and — at 40 000 spans — a frame-rate disaster.
//   - No highlight.js / Prism (200 KB, thousands of nodes) — explicitly refused.
//   - Only the ~200 visible lines are ever tokenised, so document size does not
//     enter into it.
//
// ⚠️ `::highlight()` may only change colour-ish properties. `font-weight` is NOT
// among them, so keys are distinguished by colour + the quotes and colon they
// already carry — never by bold (design §9.1).
//
// Fallback when the API is missing: PLAIN TEXT, and the UI says colouring is
// unavailable. Not a `<span>` fallback.

import { tokenize, type TokenizeFormat, type TokenType } from './core/tokenize';

const NAMES: Record<TokenType, string> = {
  key: 'dd-key',
  string: 'dd-string',
  number: 'dd-number',
  bool: 'dd-bool',
  null: 'dd-null',
  punct: 'dd-punct',
  comment: 'dd-comment',
  tag: 'dd-tag',
  attr: 'dd-attr',
};

const SEARCH = 'dd-search';
const CURRENT = 'dd-current';
const ALL = [...Object.values(NAMES), SEARCH, CURRENT];

interface HighlightRegistry {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
}

type HighlightCtor = new (...ranges: Range[]) => unknown;

function registry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights ?? null;
}

/** Runtime feature detection — Baseline "newly available", so never assumed. */
export function highlightSupported(): boolean {
  return (
    registry() !== null &&
    typeof (globalThis as { Highlight?: HighlightCtor }).Highlight === 'function'
  );
}

/** Drop every highlight this extension owns (on unmount / format change). */
export function clearHighlights(): void {
  const reg = registry();
  if (!reg) return;
  for (const name of ALL) reg.delete(name);
}

export interface HighlightRequest {
  /** The single text node holding the rendered window. */
  node: Text;
  /** The window's text (identical to `node.data`). */
  text: string;
  format: TokenizeFormat;
  /** Offsets INTO `text` of search hits inside the window. */
  hits?: { start: number; end: number }[];
  /** The currently focused hit, coloured differently. */
  current?: { start: number; end: number } | null;
}

/**
 * Recompute the highlights for the currently rendered window. Cheap by
 * construction: it only ever sees the ~200 lines that are on screen.
 */
export function applyHighlights(request: HighlightRequest): void {
  const reg = registry();
  const Ctor = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  if (!reg || typeof Ctor !== 'function') return;

  const { node, text, format } = request;
  const buckets = new Map<string, Range[]>();

  const push = (name: string, start: number, end: number) => {
    if (start >= end || end > text.length) return;
    const range = new Range();
    range.setStart(node, start);
    range.setEnd(node, end);
    const list = buckets.get(name);
    if (list) list.push(range);
    else buckets.set(name, [range]);
  };

  for (const token of tokenize(text, format)) {
    push(NAMES[token.type], token.start, token.end);
  }
  for (const hit of request.hits ?? []) push(SEARCH, hit.start, hit.end);
  if (request.current) push(CURRENT, request.current.start, request.current.end);

  for (const name of ALL) {
    const ranges = buckets.get(name);
    if (!ranges || ranges.length === 0) {
      reg.delete(name);
      continue;
    }
    try {
      reg.set(name, new Ctor(...ranges));
    } catch {
      // A Range can be invalidated by a concurrent re-render; drop that bucket
      // rather than take the pane down with it.
      reg.delete(name);
    }
  }
}

/** JWT segment colouring: header / payload / signature over the token textarea's
 *  mirrored `<pre>` (design §2.6). Same mechanism, three ranges. */
export function applyJwtSegments(
  node: Text,
  segments: { header: [number, number]; payload: [number, number]; signature: [number, number] },
): void {
  const reg = registry();
  const Ctor = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  if (!reg || typeof Ctor !== 'function') return;
  const len = node.data.length;
  const make = (span: [number, number]): Range[] => {
    if (span[0] >= span[1] || span[1] > len) return [];
    const r = new Range();
    r.setStart(node, span[0]);
    r.setEnd(node, span[1]);
    return [r];
  };
  try {
    reg.set('dd-jwt-header', new Ctor(...make(segments.header)));
    reg.set('dd-jwt-payload', new Ctor(...make(segments.payload)));
    reg.set('dd-jwt-signature', new Ctor(...make(segments.signature)));
  } catch {
    clearJwtSegments();
  }
}

export function clearJwtSegments(): void {
  const reg = registry();
  if (!reg) return;
  reg.delete('dd-jwt-header');
  reg.delete('dd-jwt-payload');
  reg.delete('dd-jwt-signature');
}
