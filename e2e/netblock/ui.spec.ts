import { test, expect } from 'playwright/test';
import type { Page } from 'playwright/test';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { loadExtension, openTool as openToolPage, query, watch, type Extension } from './helpers';

// ---------------------------------------------------------------------------
// Real-browser UI harness for the Request Blocker tool page + popup. The
// built Chrome extension (`npm run build:netblock`) is loaded unpacked into a
// persistent Chromium (helpers.ts); pages are opened directly by
// chrome-extension://<id>/… and driven like a user would (clicks, typing,
// keyboard). Console errors and page errors are collected across every page
// and asserted to be zero at the end (design §5, house rule: nothing may
// error silently in the UI). The end-to-end flows live in integration.spec.ts.
// ---------------------------------------------------------------------------

let ext: Extension;
let userDataDir: string;
let extId: string;

const openTool = (hash = '#/rules'): Promise<Page> => openToolPage(ext, hash);

async function ruleCount(page: Page): Promise<number> {
  const r = await query<{ rules: unknown[] }>(page, { type: 'listRules' });
  return r.rules.length;
}

async function resetRules(page: Page): Promise<void> {
  await query(page, { type: 'deleteAllRules' });
}

test.beforeAll(async () => {
  ext = await loadExtension({ tag: 'netblock-ui' });
  userDataDir = ext.userDataDir;
  extId = ext.extId;
});

test.afterAll(async () => {
  await ext?.close();
});

test.describe.serial('tool page', () => {
  test('empty state shows three presets; a preset opens the editor pre-filled (never saves)', async () => {
    const page = await openTool('#/rules');
    await resetRules(page);
    await page.reload();
    await expect(page.getByTestId('presets')).toBeVisible();
    await expect(page.getByTestId('preset-blockDomain')).toBeVisible();
    await expect(page.getByTestId('preset-nth503')).toBeVisible();
    await expect(page.getByTestId('preset-flaky')).toBeVisible();

    await page.getByTestId('preset-nth503').click();
    await expect(page).toHaveURL(/#\/rules\/new\?preset=nth503/);
    await expect(page.getByTestId('url-value')).toHaveValue('/api/checkout');
    await expect(page.getByTestId('state-nth')).toBeChecked();
    await expect(page.getByTestId('status-code')).toHaveValue('503');
    // nth + status on xhr → page engine, live, before any save.
    await expect(page.getByTestId('engine-line').locator('.ebadge')).toHaveAttribute('data-engine', 'page');
    // Nothing was created silently.
    expect(await ruleCount(page)).toBe(0);
    await page.close();
  });

  test('create block+wildcard+image → dnr; nth+status on xhr → page', async () => {
    const page = await openTool('#/rules');
    await resetRules(page);
    await page.reload();

    // Rule 1: the CDN preset (block, wildcard, image).
    await page.getByTestId('preset-blockDomain').click();
    await page.getByLabel('Rule name').fill('CDN images');
    await expect(page.getByTestId('engine-line').locator('.ebadge')).toHaveAttribute('data-engine', 'dnr');
    await page.getByTestId('save-rule').click();
    await expect(page.getByTestId('live')).toHaveText('Rule applied.');
    const row1 = page.locator('[role="option"]').filter({ hasText: 'CDN images' });
    await expect(row1).toHaveAttribute('data-engine', 'dnr');
    await expect(row1.locator('.ebadge')).toHaveText(/dnr/);

    // Rule 2: nth + status on xhr.
    await page.getByTestId('add-rule').click();
    // The hash router swaps the editor on `hashchange` (async): wait for the
    // blank editor before typing, or the keystrokes land in rule 1's form.
    await expect(page).toHaveURL(/#\/rules\/new$/);
    await expect(page.getByLabel('Rule name')).toHaveValue('');
    await page.getByLabel('Rule name').fill('Checkout 503');
    await page.getByTestId('url-value').fill('/api/checkout');
    await page.getByTestId('state-nth').check();
    await page.getByTestId('action-status').check();
    await expect(page.getByTestId('engine-line').locator('.ebadge')).toHaveAttribute('data-engine', 'page');
    await page.getByTestId('save-rule').click();
    await expect(page.getByTestId('live')).toHaveText('Rule applied.');
    const row2 = page.locator('[role="option"]').filter({ hasText: 'Checkout 503' });
    await expect(row2).toHaveAttribute('data-engine', 'page');
    expect(await ruleCount(page)).toBe(2);
    await page.close();
  });

  test('engine badge changes live when a response status is entered', async () => {
    const page = await openTool('#/rules/new');
    const badge = page.getByTestId('engine-line').locator('.ebadge');
    await expect(badge).toHaveAttribute('data-engine', 'dnr');
    await page.locator('details.response summary').click();
    await page.getByTestId('response-status').fill('5xx');
    await expect(badge).toHaveAttribute('data-engine', 'page');
    // §6.2 honesty line appears with the page engine.
    await expect(page.locator('[data-honesty="pageNotNetwork"]')).toBeVisible();
    await page.getByTestId('response-status').fill('');
    await expect(badge).toHaveAttribute('data-engine', 'dnr');
    // §6.12: a 2xx status shows the mock hint without blocking.
    await page.getByTestId('action-status').check();
    await page.getByTestId('status-code').fill('200');
    await expect(page.getByTestId('hint-2xx')).toBeVisible();
    await page.close();
  });

  test('keyboard reorder: Alt+ArrowDown moves the first rule below the second', async () => {
    const page = await openTool('#/rules');
    const before = await query<{ rules: { name: string; priority: number; createdAt: number }[] }>(page, { type: 'listRules' });
    const ordered = [...before.rules].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt).map((r) => r.name);
    expect(ordered).toEqual(['CDN images', 'Checkout 503']);

    const first = page.locator('[role="option"]').first();
    await expect(first).toContainText('CDN images');
    await first.focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.locator('[role="option"]').first()).toContainText('Checkout 503');

    const after = await query<{ rules: { name: string; priority: number; createdAt: number }[] }>(page, { type: 'listRules' });
    const reordered = [...after.rules].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt).map((r) => r.name);
    expect(reordered).toEqual(['Checkout 503', 'CDN images']);
    await page.close();
  });

  test('import of a bad JSON shows the error table and imports only valid rules', async () => {
    const page = await openTool('#/settings');
    const badFile = join(userDataDir, 'bad-rules.json');
    const doc = {
      version: 1,
      groups: [],
      rules: [
        {
          id: 'good-1',
          name: 'Imported good',
          enabled: true,
          priority: 10,
          createdAt: 1,
          scope: 'all',
          condition: { url: { op: 'contains', value: '/imported/' }, resourceTypes: ['xhr'] },
          state: { kind: 'every' },
          countKey: 'rule+tab',
          resetOn: 'navigation',
          action: { type: 'block' },
        },
        { id: 'bad-1', name: 'Missing fields', enabled: true },
        {
          id: 'bad-2',
          name: 'Unknown field',
          enabled: true,
          priority: 11,
          createdAt: 1,
          scope: 'all',
          condition: { url: { op: 'contains', value: 'x' } },
          state: { kind: 'every' },
          countKey: 'rule',
          resetOn: 'navigation',
          action: { type: 'block' },
          evil: '__proto__',
        },
      ],
    };
    await writeFile(badFile, JSON.stringify(doc));
    const countBefore = await ruleCount(page);
    await page.getByTestId('import-file').setInputFiles(badFile);
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(page.getByTestId('import-summary')).toHaveText('1 rules valid, 2 with errors');
    const errorRows = page.getByTestId('import-errors').locator('tbody tr');
    expect(await errorRows.count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('import-errors')).toContainText('unknown field');
    await page.getByTestId('import-valid').click();
    await expect(page.getByTestId('settings-live')).toHaveText('Imported 1 rules.');
    expect(await ruleCount(page)).toBe(countBefore + 1);
    await page.close();
  });

  test('settings persist across a reload', async () => {
    const page = await openTool('#/settings');
    const box = page.getByTestId('strip-query');
    await expect(box).toBeEnabled();
    await box.check();
    await expect(box).toBeChecked();
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.getByTestId('strip-query')).toBeChecked();
    await page.getByTestId('strip-query').uncheck();
    await page.close();
  });

  test('log renders rows from a seeded session:log with the honesty marks', async () => {
    const worker = await ext.worker();
    await worker.evaluate(async () => {
      const c = (globalThis as unknown as { chrome: typeof chrome }).chrome;
      const now = Date.now();
      const entries = [
        { id: 1, time: now - 3000, tabId: 412, method: 'GET', url: 'https://shop.example.com/', type: 'document', status: 200, outcome: 'passed', marks: [] },
        { id: 2, time: now - 2000, tabId: 412, method: 'GET', url: 'https://cdn.example.com/img/hero.webp', type: 'image', outcome: 'blocked', error: 'net::ERR_BLOCKED_BY_CLIENT', ruleId: 'r1', engine: 'dnr', marks: ['approx'] },
        { id: 3, time: now - 1000, tabId: 412, method: 'POST', url: 'https://shop.example.com/api/checkout?token=secret', type: 'xhr', status: 503, outcome: 'status', ruleId: 'r2', engine: 'page', marks: ['clientSide'] },
      ];
      const bytes = entries.reduce((n, e) => n + JSON.stringify(e).length, 0);
      await c.storage.session.set({ log: { entries, capacity: 2000, bytes, evicted: 7, nextId: 4 } });
    });
    const page = await openTool('#/log?tab=412');
    const rows = page.locator('[role="grid"] [role="row"][data-log-id]');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('/api/checkout');
    await expect(rows.first()).toContainText('503');
    await expect(rows.first()).toContainText('✱');
    await expect(rows.nth(1)).toContainText('blocked');
    await expect(rows.nth(1)).toContainText('≈');
    await expect(page.locator('.log__count')).toContainText('evicted 7');
    await expect(page.getByTestId('log-legend')).toContainText('never written to disk');
    // Row menu via keyboard: Enter opens it; "Create rule from request" seeds the editor.
    await rows.first().focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Create rule from request' }).click();
    await expect(page).toHaveURL(/#\/rules\/new/);
    await expect(page.getByTestId('url-value')).toHaveValue('https://shop.example.com/api/checkout');
    await page.close();
  });

  test('RU and ET switch the visible strings', async () => {
    const page = await openTool('#/settings');
    await page.getByRole('button', { name: 'Русский' }).click();
    await expect(page.getByTestId('nav-rules')).toHaveText('Правила');
    await expect(page.getByTestId('nav-settings')).toHaveText('Настройки');
    await page.getByRole('button', { name: 'Eesti' }).click();
    await expect(page.getByTestId('nav-rules')).toHaveText('Reeglid');
    await expect(page.getByTestId('nav-log')).toHaveText('Logi');
    // The locale persists (sync:prefs) — a fresh page opens in Estonian.
    await page.waitForTimeout(300);
    const again = await openTool('#/rules');
    await expect(again.getByTestId('nav-rules')).toHaveText('Reeglid');
    await again.getByRole('link', { name: 'Seaded' }).click();
    await again.getByRole('button', { name: 'English' }).click();
    await expect(again.getByTestId('nav-rules')).toHaveText('Rules');
    // The pref write is async (Web Lock + storage.sync): wait for it to land
    // before closing the page, or the next surface opens in Estonian.
    await expect
      .poll(() => again.evaluate(() => (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.sync.get('prefs').then((v) => (v.prefs as { locale: string } | undefined)?.locale)))
      .toBe('en');
    await page.close();
    await again.close();
  });
});

test.describe.serial('popup', () => {
  test('renders on a restricted page: footer, no Network-level block (the page cannot be attached to)', async () => {
    const page = await ext.context.newPage();
    watch(page, ext.errors);
    await page.goto(`chrome-extension://${extId}/popup.html`);
    await expect(page.getByTestId('footer')).toHaveText('100% offline · zero network · zero analytics');
    // The popup opened as a tab IS the active tab → an extension page → restricted.
    await expect(page.getByTestId('restricted')).toBeVisible();
    await expect(page.getByTestId('nl-block')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open the tool' })).toBeVisible();
    // Theme control stamps data-theme (house convention).
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Auto' }).click();
    await page.close();
  });
});

test('zero console errors across every page', () => {
  expect(ext.errors).toEqual([]);
});
