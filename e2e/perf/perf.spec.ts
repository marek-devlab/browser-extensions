import { test, expect, type Page } from '@playwright/test';
import { startFixtures, type Fixtures } from './fixture-server';
import {
  launch,
  tabIdsNow,
  getWebVitals,
  getPageInsight,
  getNetworkEntries,
  getLongFrames,
  waitFor,
  type Harness,
} from './harness';
import { resolveTransferSize } from '../../extensions/perf/utils/resource-timing';
import { isVitalBridgeMessage, isLongFrameBridgeMessage } from '../../extensions/perf/utils/protocol';
import { isAuditableUrl } from '../../extensions/perf/utils/psi';
import { entriesToCsv, toJson } from '../../extensions/perf/utils/export';
import type { TimedNetworkEntry } from '../../extensions/perf/utils/perf-types';

// Live E2E harness for the Page Performance & Network extension. Fixtures are
// served over 127.0.0.1 (content scripts don't run on about:blank/data:), on two
// ports so the cross-origin transferSize honesty rule can be exercised for real.

let fx: Fixtures;
let h: Harness;

test.beforeAll(async () => {
  fx = await startFixtures();
  h = await launch();
});

test.afterAll(async () => {
  await h?.close();
  await fx?.close();
});

/** Open a fixture page, force LCP to finalise (hide it), return its tabId. */
async function openFixture(path: string): Promise<{ page: Page; tabId: number }> {
  const before = await tabIdsNow(h.extPage);
  const page = await h.context.newPage();
  await page.goto(`${fx.pageOrigin}${path}`, { waitUntil: 'load' });
  // Identify this page's tabId as the one that appeared since `before`.
  const after = await tabIdsNow(h.extPage);
  const fresh = after.filter((id) => !before.includes(id));
  const tabId = fresh[0];
  if (tabId === undefined) throw new Error('Could not resolve the fixture tabId');
  // Ensure the image has painted (LCP needs a real contentful paint).
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>('#hero');
    return !img || img.complete;
  }).catch(() => undefined);
  // HEADLESS ARTIFACT, not a product bug. Chromium only *delivers* buffered
  // `largest-contentful-paint` entries when a subsequent frame is presented. A
  // completely static fixture never produces another frame, so headless delivers
  // ZERO LCP entries — verified directly with a raw PerformanceObserver in the
  // page: 0 entries on a static page, and the moment any DOM mutation forces a
  // frame, the entries flush carrying their ORIGINAL startTime. A real headed
  // browser presents frames continuously and never hits this.
  //
  // So: nudge exactly one frame. Mutating `opacity` to a near-identity value
  // forces presentation without painting any new element, so the page's own LCP
  // candidate (the <h1>/<img>) is preserved — we are flushing the measurement,
  // not manufacturing it.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        document.body.style.opacity = '0.999';
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  // web-vitals finalises LCP on the first genuine interaction OR when the page is
  // actually hidden. Do both for reliability: a real click, then hide the fixture
  // by bringing the extension page to the front (a true visibilitychange→hidden).
  await page.mouse.click(300, 200).catch(() => undefined);
  await h.extPage.bringToFront();
  return { page, tabId };
}

// ---------------------------------------------------------------------------
// #1 Resource Timing collection produces an insight with requests + measured bytes
// ---------------------------------------------------------------------------
test('collects a PageInsight with request count > 0 and measuredBytes sum', async () => {
  const { tabId } = await openFixture('/mixed');
  const insight = await waitFor(
    () => getPageInsight(h.extPage, tabId),
    (i) => !!i && i.requestCount > 0 && i.measuredBytes > 0,
  );
  expect(insight, 'insight should exist').toBeTruthy();
  expect(insight!.requestCount).toBeGreaterThan(0);
  expect(insight!.measuredBytes).toBeGreaterThan(0);
  expect(insight!.byteSource).toBe('resource-timing');
});

// ---------------------------------------------------------------------------
// #2 THE transferSize honesty rule on real data (most important test)
// ---------------------------------------------------------------------------
test('classifies same-origin, cross-origin+TAO (real bytes) and cross-origin no-TAO (null)', async () => {
  const { tabId } = await openFixture('/mixed');
  const entries = await waitFor(
    () => getNetworkEntries(h.extPage, tabId),
    (e) => e.some((x) => x.url.endsWith('/notao.js')) && e.some((x) => x.url.endsWith('/tao.js')),
  );

  const sameOrigin = entries.find((e) => e.url === `${fx.pageOrigin}/app.js`);
  const taoCross = entries.find((e) => e.url === `${fx.crossOrigin}/tao.js`);
  const noTaoCross = entries.find((e) => e.url === `${fx.crossOrigin}/notao.js`);

  expect(sameOrigin, 'same-origin script entry').toBeTruthy();
  expect(taoCross, 'cross-origin+TAO script entry').toBeTruthy();
  expect(noTaoCross, 'cross-origin no-TAO script entry').toBeTruthy();

  // Same-origin: real bytes.
  expect(typeof sameOrigin!.transferSize).toBe('number');
  expect(sameOrigin!.transferSize as number).toBeGreaterThan(0);

  // Cross-origin WITH Timing-Allow-Origin: real bytes.
  expect(typeof taoCross!.transferSize).toBe('number');
  expect(taoCross!.transferSize as number).toBeGreaterThan(0);

  // Cross-origin WITHOUT TAO: unknowable → null, and NEVER 0.
  expect(noTaoCross!.transferSize).toBeNull();

  const insight = await getPageInsight(h.extPage, tabId);
  expect(insight!.unmeasuredRequests).toBeGreaterThanOrEqual(1);
  // measuredBytes must exclude the null entry, not treat it as 0 in a way that
  // hides it — it is counted in unmeasuredRequests instead.
  expect(insight!.measuredBytes).toBeGreaterThan(0);

  // No entry should ever surface a real cross-origin masked value as 0 bytes.
  for (const e of entries) {
    if (e.transferSize === 0) {
      // 0 is only legitimate for a genuine cache hit; a fresh load with no-store
      // fixtures should not produce any.
      expect(e.url, `unexpected 0-byte entry: ${e.url}`).toBe('__never__');
    }
  }
});

// ---------------------------------------------------------------------------
// #3 Web vitals: FCP/TTFB/LCP collected with correct ratings
// ---------------------------------------------------------------------------
test('collects FCP, TTFB and LCP with valid ratings', async () => {
  const { tabId } = await openFixture('/mixed');
  const vitals = await waitFor(
    () => getWebVitals(h.extPage, tabId),
    (v) => ['FCP', 'TTFB', 'LCP'].every((n) => v.some((x) => x.name === n)),
    { timeout: 15_000 },
  );
  const names = vitals.map((v) => v.name);
  expect(names).toContain('FCP');
  expect(names).toContain('TTFB');
  expect(names).toContain('LCP');
  for (const v of vitals) {
    expect(['good', 'needs-improvement', 'poor']).toContain(v.rating);
    expect(v.value).toBeGreaterThanOrEqual(0);
  }
});

// ---------------------------------------------------------------------------
// #4 Forged-vitals guard: a fake bridge message without the nonce is rejected
// ---------------------------------------------------------------------------
test('rejects a forged vital posted without the correct nonce', async () => {
  const { tabId } = await openFixture('/forge');
  // Give the forgery attempts and any real vitals time to flow.
  const vitals = await waitFor(
    () => getWebVitals(h.extPage, tabId),
    (v) => v.some((x) => x.name === 'FCP' || x.name === 'LCP'),
    { timeout: 12_000 },
  );
  // The sentinel forged value (424242) must NEVER appear.
  expect(vitals.some((v) => v.value === 424242)).toBe(false);
});

// ---------------------------------------------------------------------------
// #5 The "unmeasured" warning condition: all-same-origin → 0; mixed → > 0
// ---------------------------------------------------------------------------
test('unmeasuredRequests is 0 for an all-same-origin page and > 0 with a TAO-less cross-origin resource', async () => {
  const sameOnly = await openFixture('/same-only');
  const sameInsight = await waitFor(
    () => getPageInsight(h.extPage, sameOnly.tabId),
    (i) => !!i && i.requestCount >= 2,
  );
  expect(sameInsight!.unmeasuredRequests).toBe(0);

  const mixed = await openFixture('/mixed');
  const mixedInsight = await waitFor(
    () => getPageInsight(h.extPage, mixed.tabId),
    (i) => !!i && i.unmeasuredRequests > 0,
  );
  expect(mixedInsight!.unmeasuredRequests).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Feature: Long Animation Frames / Long Tasks (live, Chromium)
// ---------------------------------------------------------------------------
test('captures a Long Animation Frame with blocking duration + script attribution', async () => {
  const { tabId } = await openFixture('/blocking');
  const summary = await waitFor(
    () => getLongFrames(h.extPage, tabId),
    (s) => s.frames.length > 0 && s.totalBlockingDuration > 0,
    { timeout: 12_000 },
  );
  expect(summary.loafSupported, 'Chromium should support LoAF').toBe(true);
  expect(summary.frames.length).toBeGreaterThan(0);
  expect(summary.totalBlockingDuration).toBeGreaterThan(0);
  const blocked = summary.frames.filter((f) => f.blockingDuration > 0);
  expect(blocked.length).toBeGreaterThan(0);
  // At least one frame should attribute to a script (our inline blocking script).
  const withScripts = summary.frames.some((f) => f.scripts.length > 0);
  expect(withScripts).toBe(true);
});

// ---------------------------------------------------------------------------
// Feature: waterfall data — entries carry a start offset for the bars
// ---------------------------------------------------------------------------
test('network entries carry startTime for the waterfall', async () => {
  const { tabId } = await openFixture('/mixed');
  const entries = await waitFor(
    () => getNetworkEntries(h.extPage, tabId),
    (e) => e.length > 0,
  );
  for (const e of entries) {
    expect(typeof e.startTime).toBe('number');
    expect(e.startTime).toBeGreaterThanOrEqual(0);
  }
});

// ---------------------------------------------------------------------------
// Feature: export honesty — null size becomes a BLANK cell, never 0
// ---------------------------------------------------------------------------
test('CSV/JSON export shows an unmeasurable size as blank/null, never 0', async () => {
  const { tabId } = await openFixture('/mixed');
  const entries = await waitFor(
    () => getNetworkEntries(h.extPage, tabId),
    (e) => e.some((x) => x.url.endsWith('/notao.js') && x.transferSize === null),
  );
  const csv = entriesToCsv(entries);
  const noTaoRow = csv.split('\r\n').find((r) => r.includes('/notao.js'));
  expect(noTaoRow, 'no-TAO row present in CSV').toBeTruthy();
  // The transferBytes cell for the no-TAO row must be empty (,,), not 0.
  const cols = (noTaoRow as string).split(',');
  // columns: url,kind,startTimeMs,durationMs,transferBytes,thirdParty
  expect(cols[4]).toBe('');

  const json = JSON.parse(
    toJson({
      hostname: 'x',
      exportedAt: new Date().toISOString(),
      insight: null,
      vitals: [],
      longFrames: null,
      entries,
    }),
  ) as { entries: TimedNetworkEntry[] };
  const noTao = json.entries.find((e) => e.url.endsWith('/notao.js'));
  expect(noTao!.transferSize).toBeNull();
});

// ---------------------------------------------------------------------------
// Logic-level guards (marked): paths that are hard/undesirable to drive live.
// ---------------------------------------------------------------------------
test('[logic] resolveTransferSize never conflates cache-hit 0 with unmeasurable null', () => {
  expect(resolveTransferSize({ transferSize: 1200, decodedBodySize: 900 } as PerformanceResourceTiming)).toBe(1200);
  // Cache hit: 0 on the wire but a real decoded body → a true 0, not null.
  expect(resolveTransferSize({ transferSize: 0, decodedBodySize: 5000 } as PerformanceResourceTiming)).toBe(0);
  // Cross-origin without TAO: everything 0 → unknowable → null.
  expect(resolveTransferSize({ transferSize: 0, decodedBodySize: 0 } as PerformanceResourceTiming)).toBeNull();
});

test('[logic] the forged-message guard functions reject non-bridge and missing-nonce payloads', () => {
  expect(isVitalBridgeMessage(null)).toBe(false);
  expect(isVitalBridgeMessage({ tag: 'wrong', nonce: 'x' })).toBe(false);
  expect(isVitalBridgeMessage({ tag: '__blur_perf_vital__' })).toBe(false); // no nonce
  expect(isVitalBridgeMessage({ tag: '__blur_perf_vital__', nonce: 'abc' })).toBe(true);
  // The LoAF bridge shares the same nonce discipline.
  expect(isLongFrameBridgeMessage({ tag: '__blur_perf_loaf__' })).toBe(false); // no nonce
  expect(isLongFrameBridgeMessage({ tag: '__blur_perf_loaf__', nonce: 'abc' })).toBe(true);
  expect(isLongFrameBridgeMessage({ tag: '__blur_perf_vital__', nonce: 'abc' })).toBe(false);
});

test('[logic] PSI refuses localhost/private URLs before spending a call', () => {
  expect(isAuditableUrl('http://localhost/').ok).toBe(false);
  expect(isAuditableUrl('http://127.0.0.1:8080/').ok).toBe(false);
  expect(isAuditableUrl('http://192.168.1.5/').ok).toBe(false);
  expect(isAuditableUrl('https://example.com/').ok).toBe(true);
});

// Note: the CDP byte path (utils/debugger-bytes.ts) imports the WXT `#imports`
// virtual module and `import.meta.env.FIREFOX`, so it cannot be imported into this
// Node test context. Its Firefox refusal guard is verified instead by the built
// Firefox bundle check (no `.debugger.` reference) plus source review — see REPORT.md.
