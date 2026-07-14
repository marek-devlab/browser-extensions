import { test, expect, chromium } from 'playwright/test';
import type { BrowserContext, Worker } from 'playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
// @ts-expect-error - .mjs helper, no type declarations needed for the harness.
import { startServer } from './server.mjs';

// ---------------------------------------------------------------------------
// Real-browser harness. The extension is loaded unpacked via a persistent
// context; both extension operations (extractSeo / runA11y) are driven through
// the SAME path the UI uses — the background service worker calling
// `chrome.tabs.sendMessage` into the declared <all_urls> content script. This is
// exactly the path that was a dead feature (DevTools clicks never grant
// activeTab), so proving it live is the point of the harness.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = join(HERE, '..', '..', 'extensions', 'seo', '.output', 'chrome-mv3');

interface ServerHandle {
  port: number;
  origin: string;
  close: () => Promise<void>;
}

interface LinkStats {
  internal: number;
  external: number;
  nofollow: number;
  sponsored: number;
  ugc: number;
}
interface SeoCheck {
  id: string;
  label: string;
  severity: 'ok' | 'warning' | 'error';
  detail: string;
}
interface SeoReportEx {
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  hreflang: { lang: string; href: string }[];
  headings: { level: number; text: string }[];
  imagesWithoutAlt: number;
  structuredDataBlocks: number;
  social: {
    ogTitle: string | null;
    ogDescription: string | null;
    ogImage: string | null;
    twitterCard: string | null;
  };
  checks: SeoCheck[];
  links: LinkStats;
  wordCount: number;
  url: string;
  viewport: string | null;
  structuredData: { types: string[]; missingRequired: string[] }[];
}
interface A11yViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical';
  help: string;
  helpUrl: string;
  nodes: string[];
}
interface A11yReport {
  violations: A11yViolation[];
  passes: number;
  incomplete: number;
}

let full: ServerHandle;
let bare: ServerHandle;
let context: BrowserContext;
let userDataDir: string;

async function getWorker(ctx: BrowserContext): Promise<Worker> {
  const existing = ctx.serviceWorkers();
  if (existing[0]) return existing[0];
  return ctx.waitForEvent('serviceworker', { timeout: 30_000 });
}

// Ask the background SW to message the content script in the ACTIVE tab. The
// extension holds no `tabs` permission, so `tab.url` is never populated in the
// SW — exactly as in production, where the popup uses `tabs.query({active})`
// and the panel uses `inspectedWindow.tabId`. We mirror the popup's path.
type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

async function messageActiveTab<T>(type: string): Promise<T> {
  const worker = await getWorker(context);
  const outcome = await worker.evaluate(
    async ({ type }): Promise<Outcome<T> | undefined> => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      const [tab] = await c.tabs.query({ active: true, currentWindow: true });
      if (!tab || tab.id == null) throw new Error('No active tab.');
      return (await c.tabs.sendMessage(tab.id, { type })) as Outcome<T> | undefined;
    },
    { type },
  );
  if (outcome == null) throw new Error('Content script returned no response.');
  if (!outcome.ok) throw new Error(`Content script error: ${outcome.error}`);
  return outcome.data;
}

async function openAndReport(url: string): Promise<SeoReportEx> {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.bringToFront();
  const report = await messageActiveTab<SeoReportEx>('extractSeo');
  await page.close();
  return report;
}

test.beforeAll(async () => {
  full = await startServer({ bare: false });
  bare = await startServer({ bare: true });

  userDataDir = await mkdtemp(join(tmpdir(), 'seo-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
    ],
  });
  // Ensure the SW is up before the tests run.
  await getWorker(context);
});

test.afterAll(async () => {
  await context?.close();
  await full?.close();
  await bare?.close();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

test('getSeoReport extracts correct values from the rich fixture', async () => {
  const r = await openAndReport(`${full.origin}/`);

  // Title + char count.
  expect(r.title).toBe('Fixture Page for SEO and Accessibility Auditor E2E');
  const titleCheck = r.checks.find((c) => c.id === 'title-length');
  expect(titleCheck?.detail).toContain(String(r.title?.length));

  // Description present.
  expect(r.description).not.toBeNull();
  expect(r.description).toContain('deterministic fixture page');

  // Canonical + robots.
  expect(r.canonical).toBe(`${full.origin}/`);
  expect(r.robots).toBe('index,follow');

  // hreflang list.
  expect(r.hreflang.map((h) => h.lang).sort()).toEqual(['de', 'en', 'fr']);

  // Heading outline with the skipped level flagged (h2 -> h4).
  expect(r.headings.map((h) => h.level)).toEqual([1, 2, 4]);
  const headingCheck = r.checks.find((c) => c.id === 'heading-order');
  expect(headingCheck?.severity).toBe('warning');
  expect(headingCheck?.detail).toMatch(/skip/i);

  // Images without alt: 2 (alt="" decorative NOT counted, 1 described NOT counted).
  expect(r.imagesWithoutAlt).toBe(2);

  // Structured data: 1 valid block counted; malformed surfaced as an error check.
  expect(r.structuredDataBlocks).toBe(1);
  const sdParse = r.checks.find((c) => c.id === 'structured-data-parse');
  expect(sdParse?.severity).toBe('error');
  expect(sdParse?.detail).toMatch(/invalid JSON/i);

  // Social tags.
  expect(r.social.ogTitle).toBe('Fixture OG Title');
  expect(r.social.ogImage).toBe(`${full.origin}/og.png`);
  expect(r.social.twitterCard).toBe('summary_large_image');

  // Links + rel flags.
  expect(r.links.internal).toBe(2);
  expect(r.links.external).toBe(3);
  expect(r.links.nofollow).toBe(1);
  expect(r.links.sponsored).toBe(1);
  expect(r.links.ugc).toBe(1);

  // Word count.
  expect(r.wordCount).toBeGreaterThan(30);

  // Page URL is surfaced (for the SERP snippet preview).
  expect(r.url).toBe(`${full.origin}/`);
});

test('structured-data validation flags a known type missing a required prop', async () => {
  const r = await openAndReport(`${full.origin}/`);
  // The fixture's valid JSON-LD is an Article without `headline`.
  expect(r.structuredData.length).toBe(1);
  const article = r.structuredData[0];
  expect(article?.types).toContain('Article');
  expect(article?.missingRequired).toContain('headline');

  const check = r.checks.find((c) => c.id === 'structured-data-required');
  expect(check?.severity).toBe('warning');
  expect(check?.detail).toMatch(/headline/i);
});

test('mobile-friendliness: responsive viewport is detected and passes', async () => {
  const r = await openAndReport(`${full.origin}/`);
  expect(r.viewport).toMatch(/width\s*=\s*device-width/i);
  const check = r.checks.find((c) => c.id === 'viewport');
  expect(check?.severity).toBe('ok');
});

test('mobile-friendliness: missing viewport is reported as an error', async () => {
  const r = await openAndReport(`${full.origin}/nodesc`);
  expect(r.viewport).toBeNull();
  const check = r.checks.find((c) => c.id === 'viewport');
  expect(check?.severity).toBe('error');
  expect(check?.detail).toMatch(/no <meta name="viewport">/i);
});

test('missing meta description reports null, not empty string', async () => {
  const r = await openAndReport(`${full.origin}/nodesc`);
  expect(r.description).toBeNull();
  const descCheck = r.checks.find((c) => c.id === 'meta-description');
  expect(descCheck?.severity).toBe('error');
  expect(descCheck?.detail).toMatch(/missing/i);
});

test('runA11y actually runs axe against the page and returns real violations', async () => {
  const url = `${full.origin}/`;
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.bringToFront();

  const report = await messageActiveTab<A11yReport>('runA11y');
  await page.close();

  // Proof axe executed against the live DOM.
  expect(Array.isArray(report.violations)).toBe(true);
  expect(report.violations.length).toBeGreaterThan(0);
  expect(report.passes).toBeGreaterThan(0);

  const ids = report.violations.map((v) => v.id);
  // The fixture has <img> without alt -> axe image-alt must fire.
  expect(ids).toContain('image-alt');

  // Every violation is serialisable with the mapped shape.
  for (const v of report.violations) {
    expect(typeof v.id).toBe('string');
    expect(['minor', 'moderate', 'serious', 'critical']).toContain(v.impact);
    expect(typeof v.help).toBe('string');
    expect(typeof v.helpUrl).toBe('string');
    expect(Array.isArray(v.nodes)).toBe(true);
  }
});

test('indexability: robots.txt + sitemap.xml present are reflected correctly', async () => {
  const r = await openAndReport(`${full.origin}/`);
  const robots = r.checks.find((c) => c.id === 'robots-txt');
  const sitemap = r.checks.find((c) => c.id === 'sitemap');
  expect(robots?.severity).toBe('ok');
  expect(robots?.detail).toMatch(/Sitemap/i);
  expect(sitemap?.severity).toBe('ok');
});

test('indexability: missing robots.txt / sitemap.xml (404) degrade gracefully', async () => {
  const r = await openAndReport(`${bare.origin}/`);
  const robots = r.checks.find((c) => c.id === 'robots-txt');
  const sitemap = r.checks.find((c) => c.id === 'sitemap');
  expect(robots?.severity).toBe('warning');
  expect(robots?.detail).toMatch(/No robots\.txt/i);
  expect(sitemap?.severity).toBe('warning');
});

test('indexability: X-Robots-Tag: noindex header is detected', async () => {
  const r = await openAndReport(`${full.origin}/xrobots`);
  const xr = r.checks.find((c) => c.id === 'x-robots-tag');
  expect(xr).toBeTruthy();
  expect(xr?.severity).toBe('error');
  expect(xr?.detail).toMatch(/noindex/i);
});
