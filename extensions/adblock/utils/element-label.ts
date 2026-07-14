/**
 * Human-readable descriptions of a picked element.
 *
 * WHY THIS EXISTS. A cosmetic filter is a CSS selector — `div.sc-a1b2c3 >
 * .promo-box:nth-child(3)`. Nobody can look at that a week later and know what
 * it was, which is exactly why the only undo path (find the selector in Options
 * and delete it) never got used. So the ONE thing that makes deferred undo
 * possible is captured at pick time, while the element is still on screen and
 * still has layout: what it looked like.
 *
 * Split in two on purpose:
 *   - `describeElement` reads the DOM (content script only),
 *   - `labelFor` is PURE — a descriptor in, a string out — so the label format is
 *     unit-testable in Node with no browser (see e2e/adblock/logic.test.mjs).
 */

/** What we snapshot about an element at the moment it is blocked. */
export interface ElementDescriptor {
  /** Lower-case tag name, e.g. `div`, `img`. */
  tag: string;
  /** Visible text content, whitespace-collapsed (may be ''). */
  text: string;
  /** Rendered size in CSS pixels, rounded (0 when it had no box). */
  width: number;
  height: number;
  /** `alt`/`title`/filename fallback for elements with no text (images, iframes). */
  alt: string;
}

/** Friendly names for the tags a user actually picks. */
const TAG_NAMES: Record<string, string> = {
  img: 'Image',
  picture: 'Image',
  svg: 'Graphic',
  video: 'Video',
  audio: 'Audio',
  iframe: 'Embedded frame',
  embed: 'Embedded frame',
  object: 'Embedded frame',
  canvas: 'Canvas',
  a: 'Link',
  button: 'Button',
  form: 'Form',
  input: 'Input',
  table: 'Table',
  ul: 'List',
  ol: 'List',
  li: 'List item',
  nav: 'Navigation',
  aside: 'Sidebar',
  header: 'Header',
  footer: 'Footer',
  section: 'Section',
  article: 'Article',
  figure: 'Figure',
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
  p: 'Paragraph',
  div: 'Block',
  span: 'Text',
};

/** Longer than this and the label stops being scannable in a 320px popup. */
const MAX_TEXT = 44;

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Render a descriptor as the one line a person recognises, e.g.
 *   `Image · 300×250`
 *   `Block “Subscribe to our newsletter” · 728×90`
 *   `Embedded frame · 300×600`
 * Never empty: with nothing to say it still names the element type.
 */
export function labelFor(d: ElementDescriptor): string {
  const tag = (d.tag || '').toLowerCase();
  const name = TAG_NAMES[tag] ?? (tag ? `<${tag}>` : 'Element');
  const parts = [name];

  const text = truncate(collapse(d.text || d.alt || ''), MAX_TEXT);
  if (text) parts[0] = `${name} “${text}”`;

  const w = Math.round(d.width);
  const h = Math.round(d.height);
  if (w > 0 && h > 0) parts.push(`${w}×${h}`);

  return parts.join(' · ');
}

/**
 * Snapshot a live element. MUST be called BEFORE the hide rule is applied — once
 * the element is `display:none` it has no box and the size would read 0×0.
 */
export function describeElement(el: Element): ElementDescriptor {
  const r = el.getBoundingClientRect();
  // `alt`, then `title`, then an image's file name: the things that describe an
  // element that carries no text of its own.
  let alt =
    el.getAttribute('alt') ??
    el.getAttribute('aria-label') ??
    el.getAttribute('title') ??
    '';
  if (!alt) {
    const src = el.getAttribute('src');
    if (src) {
      try {
        alt = new URL(src, 'https://x.invalid').pathname.split('/').pop() ?? '';
      } catch {
        alt = '';
      }
    }
  }
  return {
    tag: el.tagName.toLowerCase(),
    text: collapse(el.textContent ?? ''),
    width: r.width,
    height: r.height,
    alt: collapse(alt),
  };
}
