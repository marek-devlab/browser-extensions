import { test, expect } from 'playwright/test';
import type { Page } from 'playwright/test';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { startServers } from '../netblock-spikes/server.mjs';
import { Popup, loadExtension, openTool, query, rule, sleep, stopServiceWorker, tabIdOf, watch, type Extension } from './helpers';

// ---------------------------------------------------------------------------
// End-to-end scenarios of design §4 (flows) and §8 (resilience), each driven
// through the REAL surfaces — tool page DOM, the real popup, the fixture
// page — and checked against the fixture server's request journal, so "the
// app saw a 503" and "the server got the request" are separate facts.
// Plan + scenario matrix: docs/plans/netblock/03-integration.md §2.
//
// Site access: the test copy of the manifest grants `http://127.0.0.1/*`
// (both fixture ports); `http://localhost:<port>` is the SAME server without
// access — that is the "tab without site access" of §4.2 / §6.9.
// ---------------------------------------------------------------------------

type Servers = Awaited<ReturnType<typeof startServers>>;
type FetchResult = { ok: boolean; status?: number; text?: string; error?: string; message?: string };

declare global {
  interface Window {
    __fetchStatus(url: string, init?: RequestInit): Promise<FetchResult>;
  }
}

let srv: Servers;
let ext: Extension;
let fixture: Page;
let fixtureTab: number;
let checkoutRuleId = '';
let cdnRuleId = '';

const reached = (path: string) => srv.journal.filter((j) => j.path.startsWith(path)).length;
const fetchStatus = (page: Page, url: string, init?: RequestInit) => page.evaluate(([u, i]) => window.__fetchStatus(u, i), [url, init] as const);
const loadImage = (page: Page, src: string) =>
  page.evaluate(
    (s) =>
      new Promise<string>((r) => {
        const i = new Image();
        i.onload = () => r('load');
        i.onerror = () => r('error');
        i.src = s;
      }),
    src,
  );

test.beforeAll(async () => {
  srv = await startServers();
  ext = await loadExtension({ grantOrigins: ['http://127.0.0.1/*'], tag: 'netblock-int' });
  await sleep(800); // background init: first apply, script registration
  fixture = await ext.context.newPage();
  watch(fixture, ext.errors, { fixture: true });
  await fixture.goto(`${srv.pageOrigin}/page.html`);
  await sleep(500); // relay:ready round trip
  fixtureTab = await tabIdOf(ext, srv.pageOrigin);
});

test.afterAll(async () => {
  await ext?.close();
  await srv?.close();
});

test.describe.serial('design §4 flows', () => {
  test('§4.1 checkout: 503 on the 3rd call, created from a log row, counted in the popup', async () => {
    const tool = await openTool(ext, '#/settings');
    await query(tool, { type: 'deleteAllRules' });
    await query(tool, { type: 'clearLog' });

    // Step 2: the user clicks checkout; the log shows `POST /api/checkout 200`
    // (Chrome observation on a granted origin — design §2.5 source of rows).
    const first = await fetchStatus(fixture, '/api/checkout?attempt=0', { method: 'POST', body: '{}' });
    expect(first.status).toBe(200);
    await tool.goto(`chrome-extension://${ext.extId}/tool.html#/log?tab=${fixtureTab}`);
    await tool.getByPlaceholder('url…').fill('checkout');
    const row = tool.locator('[role="grid"] [role="row"][data-log-id]').filter({ hasText: '/api/checkout' }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText('POST');
    await expect(row).toContainText('200');

    // Step 3: ⋯ → "Create rule from request" → URL (equals, no query), POST, xhr, page domain.
    await row.getByRole('button', { name: 'Row actions' }).click();
    await tool.getByRole('menuitem', { name: 'Create rule from request' }).click();
    await expect(tool).toHaveURL(/#\/rules\/new/);
    await expect(tool.getByTestId('url-value')).toHaveValue(`${srv.pageOrigin}/api/checkout`);
    await expect(tool.getByRole('button', { name: 'POST', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(tool.getByTestId('type-xhr')).toHaveAttribute('aria-pressed', 'true');
    await expect(tool.getByPlaceholder('shop.example.com', { exact: true })).toHaveValue('127.0.0.1');

    // Steps 4–5: nth 3 → badge flips to `page`; status 503; save.
    await tool.getByLabel('Rule name').fill('Checkout 503');
    await tool.getByTestId('state-nth').check();
    await tool.getByTestId('nth-n').fill('3');
    await tool.getByTestId('action-status').check();
    await tool.getByTestId('status-code').fill('503');
    await expect(tool.getByTestId('engine-line').locator('.ebadge')).toHaveAttribute('data-engine', 'page');
    await expect(tool.locator('[data-honesty="pageNotNetwork"]')).toBeVisible();
    await tool.getByTestId('save-rule').click();
    await expect(tool.getByTestId('live')).toHaveText('Rule applied.');
    const listed = await query<{ rules: { id: string; name: string }[] }>(tool, { type: 'listRules' });
    checkoutRuleId = listed.rules.find((r) => r.name === 'Checkout 503')!.id;
    await sleep(400); // page:rules push reaches the mirror

    // Step 6: 1st, 2nd → 200; popup `2/3 ↻`; 3rd → 503; popup `3/3`.
    const before = reached('/api/checkout');
    const s1 = await fetchStatus(fixture, '/api/checkout', { method: 'POST', body: '{}' });
    const s2 = await fetchStatus(fixture, '/api/checkout', { method: 'POST', body: '{}' });
    expect([s1.status, s2.status]).toEqual([200, 200]);
    const popup = await Popup.open(ext, fixture);
    await popup.waitFor(`document.querySelector('[data-rule-id="${checkoutRuleId}"] .prow__count')?.textContent?.startsWith('2/3')`);
    expect(await popup.counter(checkoutRuleId)).toBe('2/3');
    expect(await popup.exists(`[data-rule-id="${checkoutRuleId}"] .prow__reset`)).toBe(true);
    const s3 = await fetchStatus(fixture, '/api/checkout', { method: 'POST', body: '{}' });
    expect(s3.status).toBe(503);
    await popup.waitFor(`document.querySelector('[data-rule-id="${checkoutRuleId}"] .prow__count')?.textContent?.startsWith('3/3')`);
    await popup.close();
    // Honest: the page engine is not the network — all three reached the server.
    expect(reached('/api/checkout') - before).toBe(3);

    // Log: `503 ✱` (what the app saw) next to the real `200` (what the network saw).
    await tool.goto(`chrome-extension://${ext.extId}/tool.html#/log?tab=${fixtureTab}`);
    await tool.getByPlaceholder('url…').fill('checkout');
    const rows = tool.locator('[role="grid"] [role="row"][data-log-id]');
    const substituted = rows.filter({ hasText: '503' }).filter({ hasText: '✱' });
    await expect(substituted.first()).toBeVisible({ timeout: 10_000 });
    await expect(substituted.first()).toContainText('Checkout 503');
    const real = rows.filter({ hasText: '/api/checkout' }).filter({ hasNotText: '✱' }).filter({ has: tool.locator('[role="gridcell"]', { hasText: /^200$/ }) });
    expect(await real.count()).toBeGreaterThanOrEqual(3);
    await tool.close();
  });

  test('§4.2 CDN images blocked by dnr: server never sees them, popup ≈1, "—" without site access', async () => {
    const tool = await openTool(ext, '#/rules/new');
    await tool.getByLabel('Rule name').fill('CDN images');
    await tool.locator('select[aria-label="URL"]').selectOption('wildcard');
    await tool.getByTestId('url-value').fill('*/api/cdn*');
    await tool.getByTestId('type-xhr').click(); // off
    await tool.getByTestId('type-image').click(); // on
    await expect(tool.getByTestId('engine-line').locator('.ebadge')).toHaveAttribute('data-engine', 'dnr');
    await expect(tool.locator('[data-honesty="dnrCountApprox"]')).toBeVisible();
    await tool.getByTestId('save-rule').click();
    await expect(tool.getByTestId('live')).toHaveText('Rule applied.');
    const listed = await query<{ rules: { id: string; name: string }[] }>(tool, { type: 'listRules' });
    cdnRuleId = listed.rules.find((r) => r.name === 'CDN images')!.id;
    await sleep(300);

    const before = reached('/api/cdn');
    expect(await loadImage(fixture, `${srv.apiOrigin}/api/cdn?i=1`)).toBe('error');
    expect(await loadImage(fixture, `${srv.apiOrigin}/api/img-control?i=1`)).toBe('error'); // JSON body → decode error, but it REACHES the server
    expect(reached('/api/cdn?')).toBe(before);
    expect(reached('/api/img-control')).toBe(1);

    const popup = await Popup.open(ext, fixture);
    await popup.waitFor(`document.querySelector('[data-rule-id="${cdnRuleId}"] .prow__count')?.textContent?.startsWith('≈1')`);
    expect(await popup.counter(cdnRuleId)).toBe('≈1');
    await popup.close();

    // Same server, different host, no grant. The popup would show "Enable on
    // localhost" and `—` for the counter (§6.9) — but ONLY on a real toolbar
    // click: `activeTab` is granted by the user's invocation, never by
    // `chrome.action.openPopup()`, so under automation the tab URL is hidden
    // and the popup reads as "restricted". That branch is a manual check
    // (docs/netblock-headed-smoke.md); here the block is asserted on the
    // background's truth — the URL is unknown, so nothing pretends a count.
    const noAccess = await ext.context.newPage();
    watch(noAccess, ext.errors, { fixture: true });
    await noAccess.goto(`${srv.pageOrigin.replace('127.0.0.1', 'localhost')}/page.html`);
    const beforeNoAccess = reached('/api/cdn?noaccess');
    expect(await loadImage(noAccess, `${srv.apiOrigin}/api/cdn?noaccess=1`)).toBe('error');
    expect(reached('/api/cdn?noaccess')).toBe(beforeNoAccess); // dnr blocks without site access (§2.1 "works without access")
    // No host access → the tab URL is invisible to the extension; the new tab is the active one.
    await noAccess.bringToFront();
    const noAccessTab = await (await ext.worker()).evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]!.id!);
    const summary = await query<{ restricted: boolean; siteEnabled: boolean; rules: { rule: { id: string }; active: boolean }[] }>(tool, { type: 'getTabSummary', tabId: noAccessTab });
    expect(summary.siteEnabled).toBe(false);
    expect(summary.rules.find((r) => r.rule.id === cdnRuleId)?.active).toBe(true);
    await noAccess.close();
    await tool.close();
  });

  test('§4.3 real 500 → fail(InternetDisconnected) needs Network-level mode: consent dialog, attach, detach, tab close', async () => {
    const tool = await openTool(ext, '#/rules/new');
    await tool.getByLabel('Rule name').fill('Real 500 offline');
    await tool.getByTestId('url-value').fill('/api/real500');
    await tool.locator('details.response summary').click();
    await tool.getByTestId('response-status').fill('5xx');
    await tool.getByTestId('action-fail').check();
    await tool.locator('select[aria-label="Network error"]').selectOption('InternetDisconnected');
    await expect(tool.getByTestId('engine-line').locator('.ebadge')).toHaveAttribute('data-engine', 'debugger');
    // §2.8: the editor says the rule needs NL on the tab.
    await expect(tool.locator('[data-honesty="needsNetworkLevel"]')).toBeVisible();
    await tool.getByTestId('save-rule').click();
    await expect(tool.getByTestId('live')).toHaveText('Rule applied.');
    const listed = await query<{ rules: { id: string; name: string }[] }>(tool, { type: 'listRules' });
    const nlRuleId = listed.rules.find((r) => r.name === 'Real 500 offline')!.id;
    await tool.close();

    // A second fixture tab so closing it at the end does not take the main one.
    const tab2 = await ext.context.newPage();
    watch(tab2, ext.errors, { fixture: true });
    await tab2.goto(`${srv.pageOrigin}/page.html?nl=1`);
    const tab2Id = await tabIdOf(ext, `${srv.pageOrigin}/page.html?nl`);

    const popup = await Popup.open(ext, tab2);
    await popup.waitFor(`document.querySelector('[data-rule-id="${nlRuleId}"]')?.dataset.active === 'false'`);
    expect(await popup.text(`[data-rule-id="${nlRuleId}"] .prow__why`)).toBe('needs Network-level mode');
    expect(await popup.exists('[data-testid="nl-block"]')).toBe(true);

    // Toggle → consent dialog (§2.7) — copy mentions the banner — → Turn on.
    await popup.click('[data-testid="nl-block"] input[role="switch"]');
    await popup.waitFor(`document.querySelector('[data-testid="nl-consent"]')?.open === true`);
    const dialogText = (await popup.text('[data-testid="nl-consent"]')) ?? '';
    expect(dialogText).toContain('Turn on Network-level mode?');
    expect(dialogText).toContain('banner');
    expect(dialogText).toContain('This tab only.');
    await popup.click('[data-testid="nl-consent"] .ui-btn--primary');
    await popup.waitFor(`document.querySelector('[data-rule-id="${nlRuleId}"]')?.dataset.active === 'true'`, 10_000);
    expect(await popup.eval<boolean>(`document.querySelector('[data-testid="nl-block"] input[role="switch"]').checked`)).toBe(true);

    // The page sees a network failure for a real 500, and the real 200 for a 200.
    const r500 = await fetchStatus(tab2, '/api/real500?status=500');
    const r200 = await fetchStatus(tab2, '/api/real500?status=200');
    expect(r500.ok).toBe(false);
    expect(r500.error).toBe('TypeError');
    expect(r200.status).toBe(200);
    expect(reached('/api/real500?status=500')).toBe(1);
    await popup.waitFor(`/rules applied: 1\\b/.test(document.querySelector('[data-testid="nl-stats"]')?.textContent ?? '')`, 10_000);
    expect(await popup.text('[data-testid="nl-stats"]')).toMatch(/Intercepted: [1-9]\d* · rules applied: 1/);

    // Off → the real 500 passes through.
    await popup.click('[data-testid="nl-block"] input[role="switch"]');
    await popup.waitFor(`document.querySelector('[data-rule-id="${nlRuleId}"]')?.dataset.active === 'false'`, 10_000);
    const again = await fetchStatus(tab2, '/api/real500?status=500&off=1');
    expect(again.status).toBe(500);

    // On again, then close the tab → session ends, nlTabs is empty.
    await popup.click('[data-testid="nl-block"] input[role="switch"]');
    await popup.waitFor(`document.querySelector('[data-testid="nl-consent"]')?.open === true`);
    await popup.click('[data-testid="nl-consent"] .ui-btn--primary');
    await popup.waitFor(`document.querySelector('[data-rule-id="${nlRuleId}"]')?.dataset.active === 'true'`, 10_000);
    const w = await ext.worker();
    expect(await w.evaluate(() => chrome.storage.session.get('nlTabs').then((v) => v.nlTabs as number[]))).toEqual([tab2Id]);
    await popup.close();
    await tab2.close();
    await expect
      .poll(() => w.evaluate(() => chrome.storage.session.get('nlTabs').then((v) => v.nlTabs as number[])), { timeout: 5000 })
      .toEqual([]);
  });

  test('§4.4 flaky: probability 30 % with seed 42 gives the same sequence across reloads (page engine)', async () => {
    const tool = await openTool(ext, '#/rules/new');
    await tool.getByLabel('Rule name').fill('Flaky API');
    await tool.getByTestId('url-value').fill('/api/flaky');
    await tool.getByTestId('state-probability').check();
    const prob = tool.locator('.state label').filter({ hasText: 'Probability' });
    await prob.locator('input[type="number"]').first().fill('30');
    await tool.locator('input.seed').fill('42');
    await expect(tool.locator('[data-honesty="seedSameOrder"]')).toBeVisible();
    await tool.getByTestId('action-delay').check();
    await tool.locator('.action label').filter({ hasText: 'Delay' }).locator('input[type="number"]').fill('300');
    await expect(tool.getByTestId('engine-line').locator('.ebadge')).toHaveAttribute('data-engine', 'page');
    await tool.getByTestId('save-rule').click();
    await expect(tool.getByTestId('live')).toHaveText('Rule applied.');
    const row = tool.locator('[role="option"]').filter({ hasText: 'Flaky API' });
    await expect(row).toHaveAttribute('data-engine', 'page');
    await tool.close();
    await sleep(300);

    const run = () =>
      fixture.evaluate(async () => {
        const out: string[] = [];
        for (let i = 0; i < 12; i++) {
          const t0 = performance.now();
          await window.__fetchStatus('/api/flaky?i=' + i);
          out.push(performance.now() - t0 >= 250 ? 'D' : '.');
        }
        return out.join('');
      });
    const a = await run();
    await fixture.reload();
    await sleep(600);
    const b = await run();
    await fixture.reload();
    await sleep(600);
    const c = await run();
    expect(a).toContain('D');
    expect(a).toContain('.');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  test('§4.5 import preview: 3 valid + 2 invalid (unknown key, __proto__) → indices shown, only valid imported; export round-trips', async () => {
    const tool = await openTool(ext, '#/settings');
    const valid = (n: number) => JSON.stringify(rule(`imp-${n}`, { name: `Imported ${n}`, priority: 100 + n }));
    // `__proto__` cannot be produced by JSON.stringify of an object — written as text.
    const doc =
      `{"version":1,"groups":[],"rules":[${valid(1)},${valid(2)},${valid(3)},` +
      `${JSON.stringify(rule('bad-unknown', { name: 'Unknown key' })).replace(/}$/, ',"evil":1}')},` +
      `${JSON.stringify(rule('bad-proto', { name: 'Proto' })).replace(/}$/, ',"__proto__":{"x":1}}')}]}`;
    const file = join(ext.userDataDir, 'import-mixed.json');
    await writeFile(file, doc);
    const countBefore = (await query<{ rules: unknown[] }>(tool, { type: 'listRules' })).rules.length;
    await tool.getByTestId('import-file').setInputFiles(file);
    await expect(tool.getByTestId('import-preview')).toBeVisible();
    await expect(tool.getByTestId('import-summary')).toHaveText('3 rules valid, 2 with errors');
    const errorRows = tool.getByTestId('import-errors').locator('tbody tr');
    expect(await errorRows.count()).toBe(2);
    await expect(errorRows.nth(0)).toContainText('rules 4');
    await expect(errorRows.nth(0)).toContainText('unknown field');
    await expect(errorRows.nth(1)).toContainText('rules 5');
    await expect(errorRows.nth(1)).toContainText('__proto__');
    await expect(tool.getByTestId('import-valid')).toHaveText('Import valid (3)');
    await tool.getByTestId('import-valid').click();
    await expect(tool.getByTestId('settings-live')).toHaveText('Imported 3 rules.');
    await expect.poll(async () => (await query<{ rules: unknown[] }>(tool, { type: 'listRules' })).rules.length).toBe(countBefore + 3);

    // Export → a JSON file that the strict parser accepts unchanged.
    const download = tool.waitForEvent('download');
    await tool.getByRole('button', { name: 'Export rules (JSON)' }).click();
    const path = await (await download).path();
    const text = await readFile(path!, 'utf8');
    const parsed = JSON.parse(text) as { version: number; rules: unknown[] };
    expect(parsed.version).toBe(1);
    expect(parsed.rules.length).toBe(countBefore + 3);
    const re = await query<{ ok: boolean; imported: number; errors: unknown[] }>(tool, { type: 'importRules', mode: 'merge', text });
    expect(re).toEqual({ ok: true, imported: countBefore + 3, errors: [] });
    await tool.close();
  });
});

test.describe.serial('reactive, pause, resilience', () => {
  test('afterRule: B blocks only after A matched (dnr, sequential), honesty note in the editor', async () => {
    const tool = await openTool(ext, '#/rules');
    const A = rule('a', { name: 'A', priority: 1 });
    const B = rule('b', { name: 'B after A', priority: 2, state: { kind: 'afterRule', ruleId: 'a' } });
    for (const r of [A, B]) expect((await query<{ ok: boolean }>(tool, { type: 'saveRule', rule: r })).ok).toBe(true);
    // The rules were saved behind this page's back (protocol, not the editor): reload its store.
    await tool.goto(`chrome-extension://${ext.extId}/tool.html#/rules/b`);
    await tool.reload();
    await expect(tool.getByLabel('Rule name')).toHaveValue('B after A');
    await expect(tool.getByTestId('engine-line').locator('.ebadge')).toHaveAttribute('data-engine', 'dnr');
    await expect(tool.locator('[data-honesty="reactiveParallelSlip"]')).toBeVisible();
    await expect(tool.locator('[data-honesty="reactiveParallelSlip"]')).toContainText('parallel');
    await sleep(300);

    const b0 = await fetchStatus(fixture, `${srv.pageOrigin}/api/b?n=0`);
    expect(b0.ok).toBe(true);
    const a1 = await fetchStatus(fixture, `${srv.pageOrigin}/api/a?n=1`);
    expect(a1.ok).toBe(false);
    await sleep(150); // sequential, not parallel (spike S3)
    const b1 = await fetchStatus(fixture, `${srv.pageOrigin}/api/b?n=1`);
    expect(b1.ok).toBe(false);
    expect(reached('/api/b?n=0')).toBe(1);
    expect(reached('/api/b?n=1')).toBe(0);
    await tool.close();
  });

  test('window(trigger: click) on dnr: the relay forwards the page click, the block opens for the window', async () => {
    const tool = await openTool(ext, '#/rules');
    const W = rule('w', { name: 'After click', priority: 3, state: { kind: 'window', trigger: 'click', seconds: 5 } });
    expect((await query<{ ok: boolean }>(tool, { type: 'saveRule', rule: W })).ok).toBe(true);
    await sleep(400); // page:rules (wantsClicks) reaches the relay
    const idle = await fetchStatus(fixture, `${srv.pageOrigin}/api/w?phase=idle`);
    expect(idle.ok).toBe(true);
    await fixture.click('h1'); // a real click → relay:click → dnr `click` trigger
    await sleep(400); // relay → background → updateSessionRules
    const open = await fetchStatus(fixture, `${srv.pageOrigin}/api/w?phase=open`);
    expect(open.ok).toBe(false);
    expect(reached('/api/w?phase=open')).toBe(0);
    await query(tool, { type: 'deleteRule', ruleId: 'w' });
    await tool.close();
  });

  test('Settings "allow the page engine" is honoured by the background: the badge and the compiled engine agree', async () => {
    const tool = await openTool(ext, '#/settings');
    await tool.getByTestId('page-engine').uncheck();
    // Recompiled: the xhr/status rule has no page engine now → debugger (needs NL).
    await expect
      .poll(async () => (await query<{ applied: { compiled: { rule: { id: string }; engine: string }[] } }>(tool, { type: 'listRules' })).applied.compiled.find((c) => c.rule.id === checkoutRuleId)?.engine, { timeout: 5000 })
      .toBe('debugger');
    expect((await query<{ caps: { page: boolean } }>(tool, { type: 'getCaps' })).caps.page).toBe(false);
    // The editor's live badge reads the same caps (no local AND any more)…
    const editor = await openTool(ext, `#/rules/${checkoutRuleId}`);
    await expect(editor.getByTestId('engine-line').locator('.ebadge')).toHaveAttribute('data-engine', 'debugger');
    // …and follows the `rules:applied` push when the pref flips back, without a reload.
    await tool.getByTestId('page-engine').check();
    await expect
      .poll(async () => (await query<{ applied: { compiled: { rule: { id: string }; engine: string }[] } }>(tool, { type: 'listRules' })).applied.compiled.find((c) => c.rule.id === checkoutRuleId)?.engine, { timeout: 5000 })
      .toBe('page');
    await expect(editor.getByTestId('engine-line').locator('.ebadge')).toHaveAttribute('data-engine', 'page');
    await editor.close();
    await tool.close();
    await sleep(400);
  });

  test('pause on the tab from the popup: every engine lets requests through; resume blocks again', async () => {
    const popup = await Popup.open(ext, fixture);
    await popup.waitFor(`!!document.querySelector('[data-rule-id="${cdnRuleId}"]')`);
    await popup.clickText('button', 'Pause on this tab');
    await popup.waitFor(`document.querySelector('[data-rule-id="${cdnRuleId}"]')?.dataset.active === 'false'`);
    await sleep(300);
    // dnr (A block, CDN image) and page (checkout nth — already at 3/3, so a
    // 4th passes anyway; use A) both pass while paused.
    const pausedA = await fetchStatus(fixture, `${srv.pageOrigin}/api/a?paused=1`);
    expect(pausedA.ok).toBe(true);
    const before = reached('/api/cdn?paused');
    await loadImage(fixture, `${srv.apiOrigin}/api/cdn?paused=1`);
    expect(reached('/api/cdn?paused')).toBe(before + 1);
    await popup.clickText('button', 'Resume on this tab');
    await popup.waitFor(`document.querySelector('[data-rule-id="${cdnRuleId}"]')?.dataset.active === 'true'`);
    await sleep(300);
    const resumedA = await fetchStatus(fixture, `${srv.pageOrigin}/api/a?paused=0`);
    expect(resumedA.ok).toBe(false);
    await popup.close();
  });

  test('§8 service worker stopped mid-sequence: counters survive, dnr rules keep blocking, pause survives', async () => {
    const tool = await openTool(ext, '#/rules');
    // A paused tab = an `allow` session rule with tabIds; stateful counters = session:state.
    const scratch = await ext.context.newPage();
    watch(scratch, ext.errors, { fixture: true });
    await scratch.goto(`${srv.pageOrigin}/page.html?scratch=1`);
    const scratchTab = await tabIdOf(ext, `${srv.pageOrigin}/page.html?scratch`);
    await query(tool, { type: 'pauseTab', tabId: scratchTab, paused: true });
    const w1 = await ext.worker();
    const rulesBefore = await w1.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    expect(rulesBefore.some((r) => r.action.type === 'allow' && r.condition.tabIds?.includes(scratchTab))).toBe(true);
    // Mid-sequence: two checkouts done (the §4.4 reloads reset the tab's counters), the 3rd is due.
    expect((await fetchStatus(fixture, '/api/checkout', { method: 'POST', body: '{}' })).status).toBe(200);
    expect((await fetchStatus(fixture, '/api/checkout', { method: 'POST', body: '{}' })).status).toBe(200);
    await expect
      .poll(async () => (await query<{ rules: { rule: { id: string }; counter?: { seen: number } }[] }>(tool, { type: 'getTabSummary', tabId: fixtureTab })).rules.find((r) => r.rule.id === checkoutRuleId)?.counter?.seen)
      .toBe(2);
    await w1.evaluate(() => {
      (globalThis as unknown as { __nbMarker: string }).__nbMarker = 'alive';
    });

    await stopServiceWorker(ext, tool);
    await sleep(500);
    // Wake it through the product's own protocol (an extension message).
    const summaryAfter = await query<{ rules: { rule: { id: string }; counter?: { seen: number } }[] }>(tool, { type: 'getTabSummary', tabId: fixtureTab });
    const w2 = await ext.worker();
    const marker = await w2.evaluate(() => (globalThis as unknown as { __nbMarker?: string }).__nbMarker ?? 'gone');
    expect(marker).toBe('gone'); // a fresh worker instance — in-memory state was lost, storage was not
    expect(summaryAfter.rules.find((r) => r.rule.id === checkoutRuleId)?.counter?.seen).toBe(2);
    // …and the sequence continues where it stopped: the 3rd call is the 503.
    expect((await fetchStatus(fixture, '/api/checkout', { method: 'POST', body: '{}' })).status).toBe(503);

    const rulesAfter = await w2.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    expect(rulesAfter.length).toBe(rulesBefore.length);
    expect(rulesAfter.some((r) => r.action.type === 'allow' && r.condition.tabIds?.includes(scratchTab))).toBe(true);
    const a = await fetchStatus(fixture, `${srv.pageOrigin}/api/a?after=restart`);
    expect(a.ok).toBe(false);
    const pausedStill = await fetchStatus(scratch, `${srv.pageOrigin}/api/a?after=restart&paused=1`);
    expect(pausedStill.ok).toBe(true);
    // Resume through the recovered engine state, then close the tab: no orphan `tabIds` rule stays behind.
    await query(tool, { type: 'pauseTab', tabId: scratchTab, paused: false });
    await scratch.close();
    await expect
      .poll(async () => (await w2.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).some((r) => r.condition.tabIds?.includes(scratchTab)), { timeout: 5000 })
      .toBe(false);
    await tool.close();
  });
});

test('zero console errors across popup, tool page and fixture pages', () => {
  expect(ext.errors).toEqual([]);
});
