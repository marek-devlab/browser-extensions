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
    // The popup's disclosures must open by TAP, not hover — this ships to Firefox
    // for Android. `hasTouch` lets the popup tests drive them with real touch
    // events instead of a mouse click.
    hasTouch: true,
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

// ---------------------------------------------------------------------------
// Popup drill-down. The counts alone ("5 SEO WARNINGS", "5 VIOLATIONS") told a
// user nothing about what was actually wrong, even though the report already
// carried every check's detail and every violation's help text + offending
// selectors. These tests open the REAL popup page from the loaded extension and
// feed it a report captured from the live fixture through the real content
// script — so what the popup renders is genuine axe output, not a fabrication.
// Only the two messaging calls are stubbed (the popup cannot address the fixture
// tab from a tab of its own: `tabs.query({active})` would return itself).
// ---------------------------------------------------------------------------

async function captureFixtureReports(): Promise<{
  seo: SeoReportEx;
  a11y: A11yReport;
}> {
  const page = await context.newPage();
  await page.goto(`${full.origin}/`, { waitUntil: 'networkidle' });
  await page.bringToFront();
  const seo = await messageActiveTab<SeoReportEx>('extractSeo');
  const a11y = await messageActiveTab<A11yReport>('runA11y');
  await page.close();
  return { seo, a11y };
}

/**
 * Open the extension's own popup.html, with `browser` shadowed by a stub whose
 * two messaging calls resolve to the captured reports. WXT resolves the API as
 * `globalThis.browser?.runtime?.id ? browser : chrome`, so defining `browser`
 * takes precedence — chrome.storage stays real, so prefs/theme behave normally.
 */
async function openPopupWith(seo: SeoReportEx, a11y: A11yReport) {
  const worker = await getWorker(context);
  const extId = new URL(worker.url()).host;

  const page = await context.newPage();
  await page.addInitScript(
    ({ seo, a11y }) => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      (globalThis as unknown as { browser: unknown }).browser = {
        runtime: {
          id: c.runtime.id,
          getURL: (path: string) => c.runtime.getURL(path),
          onMessage: c.runtime.onMessage,
          sendMessage: async (message: { type: string }) =>
            message.type === 'getSeoReport'
              ? { ok: true, data: seo }
              : { ok: true, data: a11y },
        },
        tabs: { query: async () => [{ id: 1 }] },
        storage: c.storage,
      };
    },
    { seo, a11y },
  );
  await page.goto(`chrome-extension://${extId}/popup.html`);
  await page.waitForSelector('.stat');
  return page;
}

test('popup: SEO warning tiles disclose the individual checks behind the count', async () => {
  const { seo, a11y } = await captureFixtureReports();
  const warnings = seo.checks.filter((c) => c.severity === 'warning');
  expect(warnings.length).toBeGreaterThan(0);
  const first = warnings[0]!;

  const page = await openPopupWith(seo, a11y);
  const tile = page.locator('button.stat', { hasText: 'SEO warnings' });

  // Collapsed by default: the detail is not in the DOM, and the trigger says so.
  await expect(tile).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText(first.detail, { exact: false })).toHaveCount(0);

  // A TAP (not a hover) opens it — this must work on Firefox for Android.
  await tile.tap();
  await expect(tile).toHaveAttribute('aria-expanded', 'true');

  // The region is correctly associated with its trigger.
  const regionId = await tile.getAttribute('aria-controls');
  const region = page.locator(`#${regionId}`);
  await expect(region).toHaveAttribute('aria-labelledby', (await tile.getAttribute('id'))!);

  // Every warning the report carries is now legible: its label AND its detail.
  for (const check of warnings) {
    await expect(region.locator('.check__label', { hasText: check.label })).toBeVisible();
    await expect(region.locator('.check__detail', { hasText: check.detail })).toBeVisible();
  }
  // And the vocabulary is explained, not assumed.
  await expect(
    region.locator('.drill__gloss', { hasText: /below best practice/i }),
  ).toBeVisible();

  await page.close();
});

test('popup: the violations tile discloses axe help text, element counts and the offending selectors', async () => {
  const { seo, a11y } = await captureFixtureReports();
  expect(a11y.violations.length).toBeGreaterThan(0);
  // The fixture has <img> with no alt, so axe's image-alt must be among them.
  const imageAlt = a11y.violations.find((v) => v.id === 'image-alt');
  expect(imageAlt).toBeTruthy();
  expect(imageAlt!.nodes.length).toBeGreaterThan(0);

  const page = await openPopupWith(seo, a11y);
  await page.getByRole('button', { name: /Run the axe-core/ }).click();

  const tile = page.locator('button.stat', { hasText: 'Violations' });
  await expect(tile).toHaveAttribute('aria-expanded', 'false');
  await tile.tap();
  await expect(tile).toHaveAttribute('aria-expanded', 'true');

  const region = page.locator(`#${await tile.getAttribute('aria-controls')}`);

  // The real axe help sentence — not a count.
  await expect(
    region.locator('.violation__help', { hasText: imageAlt!.help }),
  ).toBeVisible();
  // The real offending selector, straight off the audited DOM.
  await expect(
    region.locator('.violation__nodes li', { hasText: imageAlt!.nodes[0]! }),
  ).toBeVisible();
  // How many elements it hits, and a link to Deque's explanation.
  await expect(
    region.locator('.violation__count', {
      hasText: `${imageAlt!.nodes.length} element`,
    }),
  ).toBeVisible();
  const link = region.getByRole('link', { name: /image-alt — how to fix/ });
  await expect(link).toHaveAttribute('href', imageAlt!.helpUrl);
  await expect(link).toHaveAttribute('target', '_blank');

  await page.close();
});

test('popup: PASSES and INCOMPLETE explain themselves', async () => {
  const { seo, a11y } = await captureFixtureReports();
  const page = await openPopupWith(seo, a11y);
  await page.getByRole('button', { name: /Run the axe-core/ }).click();

  const incomplete = page.locator('button.stat', { hasText: 'Incomplete' });
  await incomplete.tap();
  await expect(
    page.locator('.drill__gloss', {
      hasText: /could not decide automatically and needs a human/i,
    }),
  ).toBeVisible();

  // Single-open accordion: opening Passes closes Incomplete, so the popup
  // cannot balloon.
  const passes = page.locator('button.stat', { hasText: 'Passes' });
  await passes.tap();
  await expect(incomplete).toHaveAttribute('aria-expanded', 'false');
  await expect(
    page.locator('.drill__gloss', { hasText: /counts RULES, not elements/i }),
  ).toBeVisible();

  await page.close();
});

test('popup: a severity row expands to the violations at that impact level', async () => {
  const { seo, a11y } = await captureFixtureReports();
  const page = await openPopupWith(seo, a11y);
  await page.getByRole('button', { name: /Run the axe-core/ }).click();

  // Pick an impact the fixture actually produced, and the violations under it.
  const impacts = ['critical', 'serious', 'moderate', 'minor'] as const;
  const impact = impacts.find((i) => a11y.violations.some((v) => v.impact === i))!;
  const under = a11y.violations.filter((v) => v.impact === impact);

  const row = page.locator('.sev__btn', { hasText: impact });
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await row.tap();
  await expect(row).toHaveAttribute('aria-expanded', 'true');

  const region = page.locator(`#${await row.getAttribute('aria-controls')}`);
  // The impact level is defined in plain language…
  await expect(region.locator('.drill__gloss')).toBeVisible();
  // …and every violation at that level is listed with its help text.
  await expect(region.locator('.violation')).toHaveCount(under.length);
  for (const v of under) {
    await expect(region.locator('.violation__help', { hasText: v.help })).toBeVisible();
  }

  await page.close();
});

test('popup: disclosures are keyboard-operable (Enter on a focused stat button)', async () => {
  const { seo, a11y } = await captureFixtureReports();
  const page = await openPopupWith(seo, a11y);

  const tile = page.locator('button.stat', { hasText: 'SEO errors' });
  await tile.focus();
  await page.keyboard.press('Enter');
  await expect(tile).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  await expect(tile).toHaveAttribute('aria-expanded', 'false');

  await page.close();
});
