import { clampMaskOpacity, safeMaskColor } from './settings';
import type { DomRule, RuleAction } from './dom-rule-engine';
import type { MaskStyle, RevealMode } from './types';

/**
 * Build the CSS `filter` value that paints an exact, opaque rectangle over an
 * element — including replaced elements (`<img>`, `<video>`), where none of the
 * obvious techniques work.
 *
 * WHY AN SVG FILTER, AND WHY A SELF-CONTAINED data: URI — all four alternatives
 * were measured in real Chromium AND real Firefox (Firefox for Android is the
 * only true mobile extension target), sampling actual painted pixels:
 *
 *   - `::after` overlay          — does not render on replaced elements at all.
 *   - `background-color`         — paints BEHIND the raster; the image wins.
 *   - `content: url(<svg rect>)` — works on <img>, but Firefox still paints the
 *                                  video: it LEAKS on <video>.
 *   - `filter: brightness(0)`    — black only, and unreliable on <img>.
 *   - `filter: url(#id)`, with the <filter> injected into the page document —
 *     works in the light DOM and **LEAKS THE IMAGE inside a shadow root**: a
 *     fragment reference resolves against the tree the element lives in, and
 *     this engine deliberately reaches into shadow roots. Measured: the source
 *     image rendered unmasked. That is a privacy failure, not a cosmetic bug.
 *
 * A `data:` URI carries its own filter definition, so it is immune to shadow-DOM
 * scoping, needs nothing injected into the page, and survives a strict CSP
 * (verified against `default-src 'self'`). `feFlood` alone DISCARDS the source
 * graphic — the media is never rasterized — which is what makes a sub-1 opacity
 * safe: you see the page background through the mask, never the content.
 *
 * The filter region is pinned to the border box (0%/0%/100%/100%); the SVG
 * default is -10%/+10%, which would bleed the fill outside the element.
 */
export function solidMaskFilter(color: string, opacity: number): string {
  // `color` is user input interpolated into an SVG document. safeMaskColor only
  // ever returns `#rrggbb`, so no quote or angle bracket can reach the markup.
  const hex = safeMaskColor(color);
  const op = clampMaskOpacity(opacity);
  // Inside a CSS url(), a literal `%` starts an escape sequence and `#` starts
  // the fragment — both must be percent-encoded, or the filter silently fails
  // to parse and NOTHING is masked.
  const enc = (s: string): string => s.replace(/%/g, '%25').replace(/#/g, '%23');
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg'>` +
    `<filter id='m' x='0%' y='0%' width='100%' height='100%' color-interpolation-filters='sRGB'>` +
    `<feFlood flood-color='${hex}' flood-opacity='${op}'/>` +
    `</filter></svg>`;
  return `url("data:image/svg+xml;utf8,${enc(svg)}#m")`;
}

/**
 * Attribute stamped on an element the user has explicitly revealed. Also used
 * as the CSS escape hatch, so revealing never requires touching inline styles.
 */
export const REVEAL_ATTR = 'data-bx-revealed';

/** Marks an element the engine has already accounted for, so counts don't double. */
export const SEEN_ATTR = 'data-bx-seen';

export interface StylesheetOptions {
  blurRadius: number;
  reveal: RevealMode;
  /** Only rules scoped to this hostname (or unscoped) are emitted. */
  hostname: string;
  /** `blur` (default) or an opaque `solid` fill. */
  maskStyle?: MaskStyle;
  /** Fill colour for `solid`. Sanitized to `#rrggbb` before it reaches the SVG. */
  maskColor?: string;
  maskOpacity?: number;
}

/**
 * Downgrade `hover` to `click` where the primary pointer cannot hover.
 *
 * `reveal: 'hover'` is the default, and on a touch device it is a dead end: the
 * content is masked and there is no gesture that unmasks it. Rather than leave
 * mobile users stuck, a touch device gets tap-to-reveal. `canHover` is injected
 * (not read from `window` here) so core stays DOM-free and the rule is testable.
 */
export function resolveRevealMode(reveal: RevealMode, canHover: boolean): RevealMode {
  if (reveal === 'hover' && !canHover) return 'click';
  return reveal;
}

export function ruleAppliesTo(rule: DomRule, hostname: string): boolean {
  if (!rule.hostnames || rule.hostnames.length === 0) return true;
  return rule.hostnames.some(
    (h) => hostname === h || hostname.endsWith(`.${h}`),
  );
}

/**
 * Split a selector list into its individual selectors. A CSS attribute or
 * pseudo-class suffix binds only to the LAST selector in a comma list, so a
 * compound selector like `'video[poster], [style*="bg"]'` must be split before
 * a suffix is appended — otherwise the first selector gets the bare form and,
 * for the reveal rule, is un-blurred unconditionally.
 *
 * The split is bracket/paren/quote aware: user-supplied cosmetic selectors from
 * the adblock extension routinely contain commas inside `:is()`, `:has()`,
 * `[attr="a,b"]` etc., and a naive `split(',')` would corrupt the stylesheet.
 */
export function splitSelectorList(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) {
      if (ch === quote && selector[i - 1] !== '\\') quote = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) out.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) out.push(trimmed);
  return out;
}

function selectorsFor(
  rules: readonly DomRule[],
  action: RuleAction,
  hostname: string,
): string[] {
  return rules
    .filter((r) => r.action === action && ruleAppliesTo(r, hostname))
    .map((r) => r.selector);
}

/**
 * Build the stylesheet injected at `document_start`.
 *
 * This is the whole "block-first" strategy: everything matching is blurred (or
 * hidden) before first paint, and JS later *removes* the effect selectively.
 * Scanning the DOM and adding blur afterwards always flashes the unblurred
 * content, because content scripts run after the element has already painted.
 */
export function buildStylesheet(
  rules: readonly DomRule[],
  options: StylesheetOptions,
): string {
  const {
    blurRadius,
    reveal,
    hostname,
    maskStyle = 'blur',
    maskColor = '#1f2430',
    maskOpacity = 1,
  } = options;
  // A NaN/negative radius produces `blur(NaNpx)`, which the CSS parser drops —
  // silently disabling ALL blur. Clamp to a sane, finite range.
  const radius = Number.isFinite(blurRadius)
    ? Math.min(100, Math.max(0, blurRadius))
    : 16;
  // Flatten every rule's selector into individual selectors so suffixes below
  // attach to each one, not just the last in a comma list (see splitSelectorList).
  const blurred = selectorsFor(rules, 'blur', hostname).flatMap(splitSelectorList);
  const hidden = selectorsFor(rules, 'hide', hostname).flatMap(splitSelectorList);
  const out: string[] = [];

  if (hidden.length > 0) {
    out.push(`${hidden.join(',\n')} { display: none !important; }`);
  }

  if (blurred.length > 0) {
    const sel = blurred.join(',\n');
    // The masking primitive. `blur()` leaves shape and colour readable; `solid`
    // floods the box with an opaque rectangle via an SVG feFlood filter (see
    // solidMaskFilter — the only technique that holds on <img>, <video> AND
    // inside shadow roots, in both engines).
    //
    // Either way it is ONE `filter` declaration, so masking stays a pure CSS
    // effect applied before first paint and revealing stays `filter: none`.
    // `filter` promotes each match to its own compositing layer, so the radius
    // is deliberately fixed rather than scaled to element size.
    const maskValue =
      maskStyle === 'solid'
        ? solidMaskFilter(maskColor, maskOpacity)
        : `blur(${radius}px)`;
    out.push(
      `${sel} {\n  filter: ${maskValue} !important;\n  transition: filter 120ms ease-out;\n}`,
    );

    const revealSel = blurred.map((s) => `${s}[${REVEAL_ATTR}]`).join(',\n');
    out.push(`${revealSel} { filter: none !important; }`);

    if (reveal === 'hover') {
      // TOUCH DEVICES HAVE NO HOVER. Firefox for Android is the suite's only
      // real mobile target, and `reveal: 'hover'` is the DEFAULT — so on a phone
      // this rule could never fire and blurred content was unrevealable. The
      // media query keeps the hover affordance on pointer devices, and the
      // caller (see resolveRevealMode) downgrades 'hover' to 'click' where the
      // primary pointer cannot hover, so touch users get tap-to-reveal instead
      // of a dead end.
      const hoverSel = blurred.map((s) => `${s}:hover`).join(',\n');
      out.push(
        `@media (hover: hover) and (pointer: fine) {\n${hoverSel} { filter: none !important; }\n}`,
      );
    }
    if (reveal === 'click') {
      out.push(`${sel} { cursor: pointer; }`);
    }
  }

  return out.join('\n\n');
}

/**
 * Apply a stylesheet to a document or an open shadow root.
 *
 * Constructable stylesheets are preferred because one object can be adopted by
 * many roots without re-parsing the CSS. The `<style>` path exists for Safari
 * versions that predate `adoptedStyleSheets` on ShadowRoot.
 */
export function applyStylesheet(
  root: Document | ShadowRoot,
  css: string,
  marker: string,
): () => void {
  const supportsConstructable =
    typeof CSSStyleSheet !== 'undefined' &&
    'replaceSync' in CSSStyleSheet.prototype &&
    'adoptedStyleSheets' in root;

  if (supportsConstructable) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return () => {
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter(
        (s) => s !== sheet,
      );
    };
  }

  const container = root instanceof Document ? root.head ?? root.documentElement : root;
  const style = document.createElement('style');
  style.dataset['bxMarker'] = marker;
  style.textContent = css;
  container.append(style);
  return () => style.remove();
}
