import type { DomRule, RuleAction } from './dom-rule-engine';
import type { RevealMode } from './types';

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
  const { blurRadius, reveal, hostname } = options;
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
    // `filter` promotes each match to its own compositing layer, so the radius
    // is deliberately fixed rather than scaled to element size.
    out.push(
      `${sel} {\n  filter: blur(${radius}px) !important;\n  transition: filter 120ms ease-out;\n}`,
    );

    const revealSel = blurred.map((s) => `${s}[${REVEAL_ATTR}]`).join(',\n');
    out.push(`${revealSel} { filter: none !important; }`);

    if (reveal === 'hover') {
      const hoverSel = blurred.map((s) => `${s}:hover`).join(',\n');
      out.push(`${hoverSel} { filter: none !important; }`);
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
