import type { LinkStats, SeoDomData, SocialPreviewEx } from './checks';

/**
 * Count links off the DOM: internal vs external (navigational http(s) anchors
 * only) and the SEO `rel` tokens (nofollow / sponsored / ugc, which may overlap).
 * `mailto:`, `tel:`, `javascript:` and bare `#` fragments are not navigational
 * links, so they are excluded from the internal/external totals.
 */
function extractLinks(): LinkStats {
  const stats: LinkStats = {
    internal: 0,
    external: 0,
    nofollow: 0,
    sponsored: 0,
    ugc: 0,
  };
  const host = location.hostname;
  document.querySelectorAll('a[href]').forEach((node) => {
    if (!(node instanceof HTMLAnchorElement)) return;

    const rel = (node.getAttribute('rel') ?? '').toLowerCase();
    if (/\bnofollow\b/.test(rel)) stats.nofollow += 1;
    if (/\bsponsored\b/.test(rel)) stats.sponsored += 1;
    if (/\bugc\b/.test(rel)) stats.ugc += 1;

    // A bare same-page fragment (`#`, `#section`) is in-page navigation, not a
    // link to another document, so it is neither internal nor external. The
    // resolved `.protocol`/`.hostname` would otherwise report the page's own
    // origin and wrongly inflate the internal count, so exclude it by raw href.
    const rawHref = (node.getAttribute('href') ?? '').trim();
    if (rawHref.startsWith('#')) return;

    // `a.protocol`/`a.hostname` resolve relative hrefs against the current URL,
    // so a relative link reports the page's own host (→ internal).
    if (node.protocol !== 'http:' && node.protocol !== 'https:') return;
    if (node.hostname === host) stats.internal += 1;
    else stats.external += 1;
  });
  return stats;
}

// Google's recommended minimum tap-target box is 48 CSS px; the WCAG 2.5.8
// floor is 24 px. Count visible interactive elements whose rendered box is below
// the 24 px floor in either dimension — a mobile-friendliness hint, not a hard
// rule (spacing exceptions exist), so the UI surfaces it as a warning.
const TAP_TARGET_MIN_PX = 24;

function countSmallTapTargets(): number {
  let count = 0;
  document
    .querySelectorAll('a[href], button, input, select, textarea, [role="button"]')
    .forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const rect = node.getBoundingClientRect();
      // Skip elements that are not rendered at all (display:none → 0×0).
      if (rect.width === 0 && rect.height === 0) return;
      if (rect.width < TAP_TARGET_MIN_PX || rect.height < TAP_TARGET_MIN_PX) {
        count += 1;
      }
    });
  return count;
}

/** Visible word count from the rendered text. Empty/hidden pages yield 0. */
function countWords(): number {
  const text = document.body?.innerText ?? '';
  const words = text.trim().split(/\s+/);
  return words.length === 1 && words[0] === '' ? 0 : words.length;
}

// Reads the raw SEO signals off the live DOM. Runs inside the content script (see
// content.ts), so it has direct DOM access. It reads only — never mutates the
// page — and returns raw signals; the `checks` are derived from these by
// `buildSeoChecks`. Kept free of module-scope state so it stays easy to reason
// about and reuse.
export function extractSeoDom(): SeoDomData {
  const collapse = (raw: string | null | undefined): string =>
    (raw ?? '').replace(/\s+/g, ' ').trim();

  const textOrNull = (raw: string | null | undefined): string | null => {
    const value = collapse(raw);
    return value.length > 0 ? value : null;
  };

  const metaContent = (selector: string): string | null => {
    const el = document.querySelector(selector);
    return el instanceof HTMLMetaElement ? textOrNull(el.content) : null;
  };

  // Resolve a possibly-relative URL against the page so consumers (the social
  // card, links) get an absolute URL. A relative og:image would otherwise
  // resolve against the panel/popup origin and render a broken preview.
  const resolveUrl = (raw: string | null): string | null => {
    if (raw === null) return null;
    try {
      return new URL(raw, location.href).href;
    } catch {
      return raw;
    }
  };

  const title = textOrNull(document.title);

  const description = metaContent('meta[name="description"]');

  // Count every declared canonical so a page with more than one conflicting
  // <link rel="canonical"> can be flagged (a common, high-impact misconfig that
  // makes engines ignore all of them). The first is used for the value/preview.
  const canonicalEls = document.querySelectorAll('link[rel="canonical"]');
  const canonicalCount = canonicalEls.length;
  const canonicalEl = canonicalEls[0] ?? null;
  const canonical =
    canonicalEl instanceof HTMLLinkElement && canonicalEl.getAttribute('href')
      ? canonicalEl.href
      : null;

  const htmlLang = textOrNull(document.documentElement.getAttribute('lang'));

  const faviconEl = document.querySelector('link[rel~="icon"]');
  const favicon =
    faviconEl instanceof HTMLLinkElement && faviconEl.getAttribute('href')
      ? faviconEl.href
      : null;

  // A "noindex" directive can arrive as `content="noindex"`, the shorthand
  // `content="none"` (== noindex,nofollow), or via `name="googlebot"` in place
  // of `name="robots"`. Tokenize on `,` and inspect each directive's NAME (the
  // part before any `:`): only an exact `noindex`/`none` deindexes. Crucially,
  // `none` as the VALUE of a `max-*-preview` key (e.g. `max-image-preview:none`)
  // is a valid, indexable directive and must NOT be treated as noindex.
  const robots = metaContent('meta[name="robots"]');
  const googlebot = metaContent('meta[name="googlebot"]');
  const excludesIndex = (value: string | null): boolean =>
    value !== null &&
    value.split(',').some((directive) => {
      const name = (directive.split(':')[0] ?? '').trim().toLowerCase();
      return name === 'noindex' || name === 'none';
    });
  const noindex = excludesIndex(robots) || excludesIndex(googlebot);

  const hreflang: { lang: string; href: string }[] = [];
  document
    .querySelectorAll('link[rel="alternate"][hreflang]')
    .forEach((node) => {
      if (!(node instanceof HTMLLinkElement)) return;
      const lang = collapse(node.getAttribute('hreflang'));
      if (lang.length === 0) return;
      hreflang.push({ lang, href: node.href });
    });

  const headings: { level: number; text: string }[] = [];
  document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((node) => {
    const level = Number(node.tagName.charAt(1));
    if (!Number.isFinite(level)) return;
    headings.push({ level, text: collapse(node.textContent) });
  });

  // alt="" is valid for decorative images — the attribute is present, so
  // `img:not([alt])` (a wholly absent attribute) already excludes it. Also skip
  // images that carry an accessible name from ARIA (aria-label/aria-labelledby)
  // or are explicitly decorative (role="presentation"/"none"): those are not the
  // missing-alt problem this flags, so counting them is a false positive.
  let imagesWithoutAlt = 0;
  document.querySelectorAll('img:not([alt])').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.hasAttribute('aria-label') || node.hasAttribute('aria-labelledby')) {
      return;
    }
    const role = (node.getAttribute('role') ?? '').toLowerCase();
    if (role === 'presentation' || role === 'none') return;
    imagesWithoutAlt += 1;
  });

  let structuredDataBlocks = 0;
  let jsonLdErrors = 0;
  // Parsed JSON-LD payloads, kept so the extension side can validate each block's
  // @type and required properties. They are plain JSON, so they serialise across
  // the messaging boundary unchanged.
  const jsonLd: unknown[] = [];
  document
    .querySelectorAll('script[type="application/ld+json"]')
    .forEach((node) => {
      const source = node.textContent ?? '';
      if (source.trim().length === 0) return;
      try {
        jsonLd.push(JSON.parse(source));
        structuredDataBlocks += 1;
      } catch {
        jsonLdErrors += 1;
      }
    });

  // Microdata: count only top-level itemscope roots, not nested ones.
  document.querySelectorAll('[itemscope]').forEach((node) => {
    const parent = node.parentElement;
    if (parent === null || parent.closest('[itemscope]') === null) {
      structuredDataBlocks += 1;
    }
  });

  // Social card, resolved the way crawlers actually build it: og:image (and
  // og:url / twitter:image) become absolute URLs, and the crawler-style
  // fallbacks are applied so the preview matches what platforms show —
  // og:title → <title>, og:description → meta description, twitter:* → og:*.
  const ogTitleRaw = metaContent('meta[property="og:title"]');
  const ogDescriptionRaw = metaContent('meta[property="og:description"]');
  const ogImage = resolveUrl(metaContent('meta[property="og:image"]'));
  const twitterImageRaw = resolveUrl(metaContent('meta[name="twitter:image"]'));
  const social: SocialPreviewEx = {
    ogTitle: ogTitleRaw ?? title,
    ogDescription: ogDescriptionRaw ?? description,
    ogImage,
    ogUrl: resolveUrl(metaContent('meta[property="og:url"]')),
    ogType: metaContent('meta[property="og:type"]'),
    twitterCard: metaContent('meta[name="twitter:card"]'),
    twitterTitle: metaContent('meta[name="twitter:title"]') ?? ogTitleRaw ?? title,
    twitterImage: twitterImageRaw ?? ogImage,
  };

  const viewport = metaContent('meta[name="viewport"]');

  return {
    title,
    description,
    canonical,
    canonicalCount,
    htmlLang,
    favicon,
    robots,
    noindex,
    hreflang,
    headings,
    imagesWithoutAlt,
    structuredDataBlocks,
    jsonLdErrors,
    jsonLd,
    social,
    viewport,
    smallTapTargets: countSmallTapTargets(),
    currentUrl: location.href,
    links: extractLinks(),
    wordCount: countWords(),
  };
}
