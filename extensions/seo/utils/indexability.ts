import type { SeoCheck } from '@blur/core';

// Same-origin indexability probes. These run in the content script, where a
// same-origin `fetch` needs NO host permission beyond the page the script is
// already injected into. Every probe is defensive: many sites legitimately 404
// their robots.txt or sitemap.xml, so a failed/absent fetch is surfaced as a
// warning (or skipped), never thrown.

interface FetchResult {
  ok: boolean;
  status: number;
  body: string;
}

/** A same-origin GET that resolves to the body text, or null on a network error. */
async function fetchText(url: string): Promise<FetchResult | null> {
  try {
    const res = await fetch(url, { credentials: 'omit', redirect: 'follow' });
    if (!res.ok) return { ok: false, status: res.status, body: '' };
    return { ok: true, status: res.status, body: await res.text() };
  } catch {
    return null;
  }
}

/**
 * Does the `User-agent: *` group contain a `Disallow: /`? A robots.txt file has
 * per-agent groups, so a `Disallow: /` under a *specific* bot (e.g. a
 * `User-agent: AhrefsBot` group) blocks only that bot — reporting it as "blocks
 * the whole site" is wrong. Only the `*` group applies to search crawlers
 * generally. Consecutive `User-agent` lines share the following rules.
 */
function starGroupBlocksAll(body: string): boolean {
  let starActive = false;
  // True while reading a run of consecutive `User-agent` lines (one group's
  // agents); the first rule line ends the run and freezes the group's agents.
  let collectingAgents = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      // A `User-agent` after a rule line starts a fresh group.
      if (!collectingAgents) starActive = false;
      collectingAgents = true;
      if (value === '*') starActive = true;
    } else {
      collectingAgents = false;
      if (starActive && field === 'disallow' && value === '/') return true;
    }
  }
  return false;
}

/** The first `Sitemap:` directive URL declared in robots.txt, if any. */
function sitemapFromRobots(body: string): string | null {
  const match = /^\s*sitemap:\s*(\S+)/im.exec(body);
  return match?.[1] ?? null;
}

function robotsCheckFrom(result: FetchResult | null): SeoCheck {
  if (result === null) {
    return {
      id: 'robots-txt',
      label: 'robots.txt',
      severity: 'warning',
      detail: 'Could not fetch /robots.txt (network error or blocked).',
    };
  }
  if (!result.ok || result.body.trim().length === 0) {
    return {
      id: 'robots-txt',
      label: 'robots.txt',
      severity: 'warning',
      detail: 'No robots.txt found; crawlers get no crawl directives or sitemap hint.',
    };
  }
  const disallowAll = starGroupBlocksAll(result.body);
  const hasSitemap = sitemapFromRobots(result.body) !== null;
  return {
    id: 'robots-txt',
    label: 'robots.txt',
    severity: disallowAll ? 'error' : 'ok',
    detail: disallowAll
      ? 'robots.txt blocks all crawlers from the whole site ("User-agent: *" + "Disallow: /").'
      : `robots.txt found${hasSitemap ? ' and it references a Sitemap.' : ' (no Sitemap directive).'}`,
  };
}

/**
 * Check the sitemap. Prefers the URL the site declares in robots.txt
 * (`Sitemap:`), which is where a sitemap that does not live at the default path
 * is actually found; falls back to `/sitemap.xml`.
 */
async function sitemapCheck(
  origin: string,
  declaredUrl: string | null,
): Promise<SeoCheck> {
  const url = declaredUrl ?? `${origin}/sitemap.xml`;
  const fromRobots = declaredUrl !== null;

  // A sitemap declared on ANOTHER origin is cross-origin: the content script has
  // no host permission there, so fetching it would fail and misleadingly read as
  // "your sitemap is broken / blocked". Don't fetch — report a neutral note that
  // it lives off-origin and was not verified here. (This is legitimate: a site
  // may host its sitemap on a CDN or a sitemap-index host.)
  if (fromRobots) {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(url).origin === origin;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) {
      return {
        id: 'sitemap',
        label: 'sitemap.xml',
        severity: 'ok',
        detail: `robots.txt declares a Sitemap at ${url} (off-origin; not verified here).`,
      };
    }
  }

  const result = await fetchText(url);
  if (result === null) {
    return {
      id: 'sitemap',
      label: 'sitemap.xml',
      severity: 'warning',
      detail: `Could not fetch ${url} (network error or blocked).`,
    };
  }
  const looksLikeSitemap =
    result.ok && /<(urlset|sitemapindex)\b/i.test(result.body);
  return {
    id: 'sitemap',
    label: 'sitemap.xml',
    severity: looksLikeSitemap ? 'ok' : 'warning',
    detail: looksLikeSitemap
      ? `A sitemap is served at ${url}${fromRobots ? ' (declared in robots.txt).' : '.'}`
      : fromRobots
        ? `robots.txt declares a Sitemap at ${url}, but it did not return a valid sitemap.`
        : 'No valid /sitemap.xml at the default location, and robots.txt declares none (it may live elsewhere).',
  };
}

/**
 * Favicon check. A `<link rel="icon">` in the markup is the explicit signal, but
 * a site relying on the conventional `/favicon.ico` is perfectly fine — browsers
 * and crawlers fall back to it. So when no icon link is declared, probe
 * `/favicon.ico` (same-origin HEAD, no host permission needed) and only warn if
 * it is genuinely missing (a 404). A HEAD that is blocked / inconclusive says
 * nothing, so it is not surfaced as a warning.
 */
async function faviconCheck(
  origin: string,
  hasIconLink: boolean,
): Promise<SeoCheck> {
  if (hasIconLink) {
    return {
      id: 'favicon',
      label: 'Favicon',
      severity: 'ok',
      detail: 'A favicon is declared via <link rel="icon">.',
    };
  }
  let status: 'found' | 'missing' | 'unknown';
  try {
    const res = await fetch(`${origin}/favicon.ico`, {
      method: 'HEAD',
      credentials: 'omit',
    });
    status = res.ok ? 'found' : res.status === 404 ? 'missing' : 'unknown';
  } catch {
    status = 'unknown';
  }
  if (status === 'missing') {
    return {
      id: 'favicon',
      label: 'Favicon',
      severity: 'warning',
      detail:
        'No <link rel="icon"> and no /favicon.ico; browsers and search results fall back to a generic icon.',
    };
  }
  return {
    id: 'favicon',
    label: 'Favicon',
    severity: 'ok',
    detail:
      status === 'found'
        ? 'No <link rel="icon">, but a favicon is served at /favicon.ico.'
        : 'No <link rel="icon"> declared (relying on a conventional /favicon.ico, not verified here).',
  };
}

// X-Robots-Tag directive keywords, so a `key: value` directive (e.g.
// `unavailable_after: <date>`) is not mistaken for a bot-scoped rule.
const XROBOTS_DIRECTIVES = new Set([
  'noindex', 'nofollow', 'none', 'noarchive', 'nosnippet', 'notranslate',
  'noimageindex', 'unavailable_after', 'max-snippet', 'max-image-preview',
  'max-video-preview', 'indexifembedded', 'all',
]);

interface XRobotsParse {
  /** An unscoped `noindex`/`none` — applies to every crawler. */
  unscopedNoindex: boolean;
  /** A `noindex`/`none` scoped to a named bot (e.g. `googlebot: noindex`). */
  scopedNoindex: boolean;
}

function parseXRobots(header: string): XRobotsParse {
  let unscopedNoindex = false;
  let scopedNoindex = false;
  for (const part of header.split(',')) {
    let seg = part.trim();
    if (seg === '') continue;
    let scoped = false;
    const colon = seg.indexOf(':');
    if (colon !== -1) {
      const left = seg.slice(0, colon).trim().toLowerCase();
      // A left token that is NOT a known directive keyword is a bot name, so the
      // rule is scoped to that crawler (`googlebot: noindex`).
      if (!XROBOTS_DIRECTIVES.has(left)) {
        scoped = true;
        seg = seg.slice(colon + 1).trim();
      }
    }
    // The directive NAME is the token before any `:`. Only an exact
    // `noindex`/`none` deindexes; `none` as the VALUE of a `max-*-preview` key
    // (e.g. `max-image-preview:none`) is valid and indexable, so it must NOT be
    // read as noindex.
    const nameColon = seg.indexOf(':');
    const name = (nameColon === -1 ? seg : seg.slice(0, nameColon)).trim().toLowerCase();
    if (name === 'noindex' || name === 'none') {
      if (scoped) scopedNoindex = true;
      else unscopedNoindex = true;
    }
  }
  return { unscopedNoindex, scopedNoindex };
}

/**
 * Best-effort X-Robots-Tag probe. This is a SEPARATE `HEAD` request, so it can
 * legitimately disagree with the real navigation: some servers only set the
 * header on `GET`, answer `HEAD` with `405`, or (with `credentials: 'omit'`)
 * return a different response than the logged-in page. So this is treated as a
 * hint, never authoritative: any non-200 / failed HEAD says nothing, and a
 * confident "excluded from search" is reported ONLY for an unscoped noindex — a
 * bot-scoped `X-Robots-Tag: googlebot: noindex` is surfaced as a note, since it
 * does not necessarily apply to the page as navigated.
 */
async function xRobotsCheck(pageUrl: string): Promise<SeoCheck | null> {
  let res: Response;
  try {
    res = await fetch(pageUrl, { method: 'HEAD', credentials: 'omit' });
  } catch {
    return null; // Network/CORS failure — inconclusive, say nothing.
  }
  if (!res.ok) return null; // 405/redirect/error page — HEAD is unreliable here.
  const header = res.headers.get('x-robots-tag');
  if (header === null) return null; // No header is the norm — say nothing.

  const { unscopedNoindex, scopedNoindex } = parseXRobots(header);
  if (unscopedNoindex) {
    return {
      id: 'x-robots-tag',
      label: 'X-Robots-Tag header',
      severity: 'error',
      detail: `Response header "X-Robots-Tag: ${header}" contains noindex — this page is excluded from search.`,
    };
  }
  if (scopedNoindex) {
    return {
      id: 'x-robots-tag',
      label: 'X-Robots-Tag header',
      severity: 'warning',
      detail: `Response header "X-Robots-Tag: ${header}" carries a bot-scoped noindex; it may exclude some crawlers (best-effort — read from a separate HEAD request).`,
    };
  }
  return {
    id: 'x-robots-tag',
    label: 'X-Robots-Tag header',
    severity: 'ok',
    detail: `Response header present: "X-Robots-Tag: ${header}" (no noindex).`,
  };
}

/**
 * Gather the same-origin indexability checks. robots.txt is fetched first so its
 * `Sitemap:` directive can point the sitemap probe at the real URL; the sitemap
 * and X-Robots-Tag probes then run in parallel. Returns a `SeoCheck[]` to merge
 * into the report's existing check list (no core type change needed).
 */
export async function indexabilityChecks(
  pageUrl: string,
  hasIconLink: boolean,
): Promise<SeoCheck[]> {
  const origin = new URL(pageUrl).origin;
  const robotsResult = await fetchText(`${origin}/robots.txt`);
  const declaredSitemap =
    robotsResult?.ok ? sitemapFromRobots(robotsResult.body) : null;
  const [sitemap, xRobots, favicon] = await Promise.all([
    sitemapCheck(origin, declaredSitemap),
    xRobotsCheck(pageUrl),
    faviconCheck(origin, hasIconLink),
  ]);
  const robots = robotsCheckFrom(robotsResult);
  const checks = [robots, sitemap, favicon];
  return xRobots === null ? checks : [...checks, xRobots];
}
