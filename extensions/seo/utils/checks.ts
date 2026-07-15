import type {
  A11yImpact,
  SeoCheck,
  SeoReport,
  SeoSeverity,
  SocialPreview,
} from '@blur/core';
import type { TFn } from './i18n';

// Pure, browser-free helpers so they stay trivially unit-testable. All guard
// against `noUncheckedIndexedAccess` (on in the base tsconfig): array indexing
// yields `T | undefined`, so every lookup is null-checked before use.

/** The 30–60 character target for a <title>, per common SEO guidance. */
const TITLE_MIN = 30;
const TITLE_MAX = 60;

/** The ~120–160 character target for a meta description, per common SEO guidance. */
const DESC_MIN = 120;
const DESC_MAX = 160;

export type TitleLengthStatus = 'ok' | 'short' | 'long' | 'missing';

export function titleLengthStatus(title: string | null): TitleLengthStatus {
  if (title === null || title.length === 0) return 'missing';
  if (title.length < TITLE_MIN) return 'short';
  if (title.length > TITLE_MAX) return 'long';
  return 'ok';
}

export type DescriptionLengthStatus = 'ok' | 'short' | 'long' | 'missing';

/** Mirror of `titleLengthStatus` for the meta description's 120–160 target. */
export function descriptionLengthStatus(
  description: string | null,
): DescriptionLengthStatus {
  if (description === null || description.length === 0) return 'missing';
  if (description.length < DESC_MIN) return 'short';
  if (description.length > DESC_MAX) return 'long';
  return 'ok';
}

/**
 * Indices of headings whose level jumps by more than one from the previous
 * heading (e.g. h2 → h4 skips h3). The returned set holds the index of the
 * offending heading, so the UI can flag that specific row.
 */
export function findSkippedHeadingLevels(
  headings: SeoReport['headings'],
): Set<number> {
  const skipped = new Set<number>();
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1];
    const cur = headings[i];
    if (prev && cur && cur.level - prev.level > 1) skipped.add(i);
  }
  return skipped;
}

/** Sort weight for SEO severity: errors first, then warnings, then ok. */
export function severityRank(severity: SeoSeverity): number {
  switch (severity) {
    case 'error':
      return 0;
    case 'warning':
      return 1;
    case 'ok':
      return 2;
  }
}

/** Sort weight for a11y impact: critical first, down to minor. */
export function impactRank(impact: A11yImpact): number {
  switch (impact) {
    case 'critical':
      return 0;
    case 'serious':
      return 1;
    case 'moderate':
      return 2;
    case 'minor':
      return 3;
  }
}

/**
 * Raw SEO signals read straight off the DOM by `extractSeoDom` — everything a
 * `SeoReport` needs *except* the derived `checks`, plus the few extra facts the
 * checks need (`currentUrl`, `noindex`, `jsonLdErrors`). `checks` are computed
 * from this by `buildSeoChecks` in the extension context, which is why the
 * page-injected extractor can stay dependency-free.
 */
export interface SeoDomData {
  title: string | null;
  description: string | null;
  canonical: string | null;
  /** Number of `<link rel="canonical">` elements found (>1 is a conflict). */
  canonicalCount: number;
  /** `<html lang>` attribute value, or null when absent. */
  htmlLang: string | null;
  /** Resolved href of `<link rel~="icon">`, or null when none is declared. */
  favicon: string | null;
  robots: string | null;
  noindex: boolean;
  hreflang: { lang: string; href: string }[];
  headings: { level: number; text: string }[];
  imagesWithoutAlt: number;
  structuredDataBlocks: number;
  /** JSON-LD blocks whose contents failed `JSON.parse`. */
  jsonLdErrors: number;
  /** Parsed payloads of the valid JSON-LD blocks, for @type + required-prop validation. */
  jsonLd: unknown[];
  social: SocialPreviewEx;
  /** Raw `<meta name="viewport">` content, or null when absent. */
  viewport: string | null;
  /** Visible interactive elements rendered below the 24px tap-target floor. */
  smallTapTargets: number;
  /** `location.href` of the audited document, for the canonical comparison. */
  currentUrl: string;
  links: LinkStats;
  /** Visible word count from `document.body.innerText`. */
  wordCount: number;
}

/**
 * One validated JSON-LD block: the `@type`(s) it declares and, for the common
 * types the auditor knows, any Google-recommended required properties it omits.
 */
export interface StructuredDataItem {
  types: string[];
  missingRequired: string[];
}

/**
 * Extension-local social card. Core's `SocialPreview` is READ-ONLY and carries
 * only og:title/og:description/og:image/twitter:card, so the extra crawler
 * fields the card needs (twitter:title/twitter:image + og:url/og:type) are added
 * here. URLs (`ogImage`, `twitterImage`, `ogUrl`) are absolute — resolved in the
 * content script against the page — and the `*Title`/`*Description` fields carry
 * the crawler fallbacks (og:* → <title>/description, twitter:* → og:*).
 */
export interface SocialPreviewEx extends SocialPreview {
  /** twitter:title, falling back to og:title then <title>. */
  twitterTitle: string | null;
  /** Absolute twitter:image, falling back to og:image. */
  twitterImage: string | null;
  /** Absolute og:url, or null when absent. */
  ogUrl: string | null;
  /** og:type (e.g. "article", "website"), or null when absent. */
  ogType: string | null;
}

/**
 * Link inventory read off the DOM. `internal`/`external` count only navigational
 * http(s) anchors (mailto:/tel:/javascript:/# fragments are ignored); the rel
 * counts are independent and may overlap (an anchor can be both nofollow + ugc).
 */
export interface LinkStats {
  internal: number;
  external: number;
  nofollow: number;
  sponsored: number;
  ugc: number;
}

/**
 * Extension-local report. `@blur/core`'s `SeoReport` is READ-ONLY, so the two
 * extra facts this build surfaces (link inventory + visible word count) are
 * carried in a composing type rather than by editing core. Everything else — the
 * indexability signals from robots.txt / sitemap.xml / X-Robots-Tag — rides in
 * the existing `checks: SeoCheck[]`, so no core change is needed for those.
 */
export interface SeoReportEx extends SeoReport {
  links: LinkStats;
  wordCount: number;
  /** Page URL of the audited document (for the SERP snippet preview). */
  url: string;
  /** Raw `<meta name="viewport">` content, or null when absent. */
  viewport: string | null;
  /** Per-block JSON-LD validation (types + missing required props). */
  structuredData: StructuredDataItem[];
  /** Social card with resolved URLs + crawler fallbacks (narrows core's `social`). */
  social: SocialPreviewEx;
}

/**
 * Google-recommended required properties per common schema.org type. Not the
 * full spec — just the high-value ones whose absence commonly disqualifies a
 * page from rich results. Keys are matched case-insensitively against `@type`.
 */
const REQUIRED_PROPS: Record<string, string[]> = {
  article: ['headline'],
  product: ['name'],
  breadcrumblist: ['itemListElement'],
  organization: ['name'],
};

function typeList(raw: unknown): string[] {
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
  return [];
}

/**
 * Validate parsed JSON-LD payloads: pull each block's `@type` and, for the types
 * we know, flag missing required properties. Pure and browser-free so it stays
 * unit-testable. A JSON-LD block may itself be a `@graph` array of nodes; each
 * node is validated independently.
 */
export function validateStructuredData(blocks: unknown[]): StructuredDataItem[] {
  const items: StructuredDataItem[] = [];

  // `topLevel` marks a declared structured-data node — a bare block or a `@graph`
  // member — which is always reported so the block count matches what the author
  // declared. Nested property entities (an Article's author, a Product's Offer)
  // are validated too, but only surfaced when they actually have a problem, so a
  // well-formed nested Person doesn't inflate the block count with noise.
  const visit = (node: unknown, topLevel: boolean): void => {
    if (node === null || typeof node !== 'object') return;

    // A JSON-LD block is commonly a bare top-level ARRAY of nodes (valid), not a
    // single object — visit each element so those blocks are validated, not
    // silently skipped. Array members inherit the caller's top-level-ness.
    if (Array.isArray(node)) {
      for (const el of node) visit(el, topLevel);
      return;
    }

    const obj = node as Record<string, unknown>;

    if (Array.isArray(obj['@graph'])) {
      for (const child of obj['@graph']) visit(child, true);
      // A wrapper that only holds @graph declares no type of its own.
      if (obj['@type'] === undefined) return;
    }

    const types = typeList(obj['@type']);
    if (types.length > 0) {
      const missingRequired: string[] = [];
      for (const type of types) {
        const required = REQUIRED_PROPS[type.toLowerCase()];
        if (!required) continue;
        for (const prop of required) {
          const value = obj[prop];
          const absent =
            value === undefined ||
            value === null ||
            (typeof value === 'string' && value.trim().length === 0);
          if (absent && !missingRequired.includes(prop)) missingRequired.push(prop);
        }
      }
      if (topLevel || missingRequired.length > 0) items.push({ types, missingRequired });
    }

    // Recurse into nested entities (e.g. an Article's author/publisher, or a
    // BreadcrumbList's itemListElement), which carry their own @type + required
    // properties. @graph was already handled above.
    for (const [key, value] of Object.entries(obj)) {
      if (key === '@graph') continue;
      if (value !== null && typeof value === 'object') visit(value, false);
    }
  };

  for (const block of blocks) visit(block, true);
  return items;
}

/**
 * Known tracking / campaign query parameters that never change which document a
 * URL addresses, so they are stripped before the canonical comparison. Anything
 * NOT in this set is meaningful (e.g. `?page=2`, `?id=5`), so it is KEPT — a
 * canonical that points at a different meaningful query is a real mismatch and
 * must not be masked by blanket query-stripping.
 */
const TRACKING_PARAMS = new Set([
  'gclid', 'gclsrc', 'dclid', 'fbclid', 'msclkid', 'yclid', 'twclid',
  'igshid', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 'ref_url',
  '_ga', '_gl', 'oly_anon_id', 'oly_enc_id', 'vero_id', 'vero_conv',
]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  // All `utm_*` are campaign params; the rest are matched exactly.
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

/**
 * URL equality for the "does the canonical point elsewhere?" heuristic. Ignores
 * differences that do not make it a different document: the fragment, a single
 * trailing slash, the scheme (a canonical routinely upgrades http→https), and
 * KNOWN tracking params (utm_*, gclid, fbclid, …). Meaningful query params are
 * preserved, so a canonical pointing at a different `?page=` is still a mismatch.
 */
function sameDocumentUrl(a: string, b: string): boolean {
  const normalize = (raw: string): string => {
    try {
      const u = new URL(raw);
      // Treat http and https as the same document.
      u.protocol = 'https:';
      u.hash = '';
      // Drop ONLY known tracking params; keep meaningful ones so a real query
      // mismatch (e.g. ?page=2) is not falsely read as "matches".
      for (const key of [...u.searchParams.keys()]) {
        if (isTrackingParam(key)) u.searchParams.delete(key);
      }
      // Sort so param order does not create a spurious mismatch.
      u.searchParams.sort();
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
        u.pathname = u.pathname.slice(0, -1);
      }
      return u.href;
    } catch {
      return raw;
    }
  };
  return normalize(a) === normalize(b);
}

/**
 * Derive the SEO check list from raw DOM signals. Pure and browser-free: it only
 * reads `SeoDomData`, so it is unit-testable and can run in the background. Rows
 * come back sorted errors-first via `severityRank`.
 */
export function buildSeoChecks(
  dom: SeoDomData,
  // Translator (locale-bound) so the check prose is emitted in the user's
  // language at scan time; presentation only — the check ids/severities and all
  // the logic below are unchanged.
  t: TFn,
  // Precomputed JSON-LD validation, threaded in so it is not recomputed by the
  // Ex assembler. Defaults to computing it, so the function stays standalone.
  structuredData: StructuredDataItem[] = validateStructuredData(dom.jsonLd),
): SeoCheck[] {
  const checks: SeoCheck[] = [];

  const titleStatus = titleLengthStatus(dom.title);
  checks.push({
    id: 'title-length',
    label: t('chkTitleLength'),
    severity: titleStatus === 'ok' ? 'ok' : titleStatus === 'missing' ? 'error' : 'warning',
    detail:
      titleStatus === 'missing'
        ? t('dTitleMissing')
        : titleStatus === 'short'
          ? t('dTitleShort', { n: dom.title?.length ?? 0 })
          : titleStatus === 'long'
            ? t('dTitleLong', { n: dom.title?.length ?? 0 })
            : t('dTitleOk', { n: dom.title?.length ?? 0 }),
  });

  const descStatus = descriptionLengthStatus(dom.description);
  const descLen = dom.description?.length ?? 0;
  checks.push({
    id: 'meta-description',
    label: t('chkMetaDescription'),
    severity:
      descStatus === 'missing' ? 'error' : descStatus === 'ok' ? 'ok' : 'warning',
    detail:
      descStatus === 'missing'
        ? t('dDescMissing')
        : descStatus === 'short'
          ? t('dDescShort', { n: descLen })
          : descStatus === 'long'
            ? t('dDescLong', { n: descLen })
            : t('dDescOk', { n: descLen }),
  });

  checks.push({
    id: 'html-lang',
    label: t('chkLanguage'),
    severity: dom.htmlLang === null ? 'warning' : 'ok',
    detail:
      dom.htmlLang === null
        ? t('dLangMissing')
        : t('dLangOk', { lang: dom.htmlLang }),
  });

  // Favicon is checked asynchronously in indexability.ts (it probes
  // /favicon.ico before warning), so it is intentionally NOT emitted here.

  checks.push({
    id: 'canonical',
    label: t('chkCanonicalUrl'),
    severity:
      dom.canonicalCount > 1 ? 'error' : dom.canonical === null ? 'warning' : 'ok',
    detail:
      dom.canonicalCount > 1
        ? t('dCanonicalConflict', { n: dom.canonicalCount })
        : dom.canonical === null
          ? t('dCanonicalMissing')
          : sameDocumentUrl(dom.canonical, dom.currentUrl)
            ? t('dCanonicalMatch')
            : t('dCanonicalElsewhere', { url: dom.canonical }),
  });

  checks.push({
    id: 'indexability',
    label: t('chkIndexability'),
    severity: dom.noindex ? 'error' : 'ok',
    detail: dom.noindex ? t('dIndexNoindex') : t('dIndexOk'),
  });

  const h1Count = dom.headings.filter((h) => h.level === 1).length;
  const skipped = findSkippedHeadingLevels(dom.headings);
  const headingSeverity: SeoSeverity =
    h1Count === 0 || skipped.size > 0 ? 'warning' : h1Count > 1 ? 'warning' : 'ok';
  checks.push({
    id: 'heading-order',
    label: t('chkHeadingHierarchy'),
    severity: headingSeverity,
    detail:
      h1Count === 0
        ? t('dHeadingNoH1')
        : h1Count > 1
          ? t('dHeadingMultiH1', { n: h1Count })
          : skipped.size > 0
            ? t('dHeadingSkipped', { n: skipped.size })
            : t('dHeadingOk'),
  });

  checks.push({
    id: 'img-alt',
    label: t('chkImageAlt'),
    severity: dom.imagesWithoutAlt > 0 ? 'warning' : 'ok',
    detail:
      dom.imagesWithoutAlt > 0
        ? t('dImgAltMissing', { n: dom.imagesWithoutAlt })
        : t('dImgAltOk'),
  });

  if (dom.jsonLdErrors > 0) {
    checks.push({
      id: 'structured-data-parse',
      label: t('chkSdValidity'),
      severity: 'error',
      detail: t('dSdParse', { n: dom.jsonLdErrors }),
    });
  }
  checks.push({
    id: 'structured-data',
    label: t('chkStructuredData'),
    severity: dom.structuredDataBlocks === 0 ? 'warning' : 'ok',
    detail:
      dom.structuredDataBlocks === 0
        ? t('dSdNone')
        : t('dSdBlocks', { n: dom.structuredDataBlocks }),
  });

  checks.push({
    id: 'og-image',
    label: t('chkSocialPreviewImage'),
    severity: dom.social.ogImage === null ? 'warning' : 'ok',
    detail: dom.social.ogImage === null ? t('dOgImageMissing') : t('dOgImageOk'),
  });

  // Structured-data validation: surface any known-type block that omits a
  // required property (rich results are withheld when they do). Reuses the
  // precomputed `structuredData` rather than validating a second time.
  const incomplete = structuredData.filter((i) => i.missingRequired.length > 0);
  if (incomplete.length > 0) {
    const detail = incomplete
      .map((i) =>
        t('dSdMissingItem', {
          types: i.types.join('/'),
          props: i.missingRequired.join(', '),
        }),
      )
      .join('; ');
    checks.push({
      id: 'structured-data-required',
      label: t('chkSdCompleteness'),
      severity: 'warning',
      detail: t('dSdRequired', {
        plural:
          incomplete.length === 1 && incomplete[0]?.missingRequired.length === 1
            ? 'y'
            : 'ies',
        detail,
      }),
    });
  }

  // Mobile-friendliness: a viewport meta is the single strongest mobile signal.
  const viewport = dom.viewport;
  const hasDeviceWidth = viewport !== null && /width\s*=\s*device-width/i.test(viewport);
  const blocksZoom =
    viewport !== null &&
    (/user-scalable\s*=\s*(no|0)/i.test(viewport) || /maximum-scale\s*=\s*1(\.0+)?\b/i.test(viewport));
  checks.push({
    id: 'viewport',
    label: t('chkMobileViewport'),
    severity: viewport === null ? 'error' : !hasDeviceWidth || blocksZoom ? 'warning' : 'ok',
    detail:
      viewport === null
        ? t('dViewportMissing')
        : !hasDeviceWidth
          ? t('dViewportNoDeviceWidth')
          : blocksZoom
            ? t('dViewportBlocksZoom')
            : t('dViewportOk'),
  });

  if (dom.smallTapTargets > 0) {
    checks.push({
      id: 'tap-targets',
      label: t('chkTapTargetSize'),
      severity: 'warning',
      detail: t('dTapTargets', { n: dom.smallTapTargets }),
    });
  }

  return checks.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

/** Assemble the full `SeoReport` from raw DOM data plus its derived checks. */
export function assembleSeoReport(
  dom: SeoDomData,
  t: TFn,
  structuredData: StructuredDataItem[] = validateStructuredData(dom.jsonLd),
): SeoReport {
  return {
    title: dom.title,
    description: dom.description,
    canonical: dom.canonical,
    robots: dom.robots,
    hreflang: dom.hreflang,
    headings: dom.headings,
    imagesWithoutAlt: dom.imagesWithoutAlt,
    structuredDataBlocks: dom.structuredDataBlocks,
    social: dom.social,
    checks: buildSeoChecks(dom, t, structuredData),
  };
}

/**
 * Assemble the extension-local report: the core `SeoReport` plus the link
 * inventory and word count, with any extra (indexability) checks merged into the
 * check list and re-sorted errors-first. `extraChecks` are gathered async by the
 * content script (robots.txt / sitemap.xml / X-Robots-Tag); passing them in keeps
 * this assembler pure and browser-free.
 */
export function assembleSeoReportEx(
  dom: SeoDomData,
  extraChecks: SeoCheck[],
  t: TFn,
): SeoReportEx {
  // Validate JSON-LD ONCE and reuse it for both the derived checks and the
  // report's `structuredData` field (it was previously computed twice).
  const structuredData = validateStructuredData(dom.jsonLd);
  const base = assembleSeoReport(dom, t, structuredData);
  const checks = [...base.checks, ...extraChecks].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );
  return {
    ...base,
    checks,
    // Narrow core's `social` back to the extension-local shape (resolved URLs +
    // crawler fallbacks) that `dom.social` already carries.
    social: dom.social,
    links: dom.links,
    wordCount: dom.wordCount,
    url: dom.currentUrl,
    viewport: dom.viewport,
    structuredData,
  };
}
