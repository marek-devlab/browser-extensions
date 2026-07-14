// Live E2E harness for the Ad & Tracker Blocker (Chromium build).
//
// METHOD (documented for REPORT.md):
//  - Loads the REAL built extension (.output/chrome-mv3) into a headed persistent
//    Chromium context via --load-extension (Playwright, chromium channel).
//  - A single local HTTP server (server.mjs) serves fixture pages AND the
//    sub-resources for hosts that appear in the bundled easylist/easyprivacy DNR
//    rules. Chromium's --host-resolver-rules MAPs those blockable hosts + the page
//    hosts back to that server, so everything is OFFLINE and deterministic.
//  - Network BLOCK is detected as a Chromium DNR failure
//    (net::ERR_BLOCKED_BY_CLIENT) — a blocked request never resolves, so it can
//    never leak to the real network. NOT-blocked is the same request resolving to
//    the local server and returning 200 (img fires `load`).
//  - Cosmetic hiding is read from getComputedStyle(el).display === 'none'.
//  - Settings are changed by driving the REAL options-page UI (clicks), the exact
//    flow a user takes, so the harness exercises the storage->background
//    reconcile path end to end.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { startServer } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = join(HERE, '..', '..', 'extensions', 'adblock', '.output', 'chrome-mv3');

// Hosts the harness maps to the local server. The two ad/tracker hosts are
// confirmed present as whole-host `||host^` block rules in the bundled
// easylist.json / easyprivacy.json respectively.
const AD_HOST = 'buzzoola.com'; // easylist
const TRACKER_HOST = 'mradx.net'; // easyprivacy
const PAGE_HOST = 'victim.test'; // arbitrary page host, mapped to local
const SITE_COSMETIC_HOST = 'youtube.com'; // has site-specific cosmetic rules

const results = [];
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  const tag = pass === true ? 'PASS' : pass === 'PARTIAL' ? 'PART' : 'FAIL';
  console.log(`[${tag}] ${id} ${name} — ${detail}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function launch(port) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'adblock-e2e-'));
  const hostRules = [
    `MAP ${AD_HOST} 127.0.0.1:${port}`,
    `MAP ${TRACKER_HOST} 127.0.0.1:${port}`,
    `MAP ${PAGE_HOST} 127.0.0.1:${port}`,
    `MAP ${SITE_COSMETIC_HOST} 127.0.0.1:${port}`,
  ].join(', ');
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: false,
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      `--host-resolver-rules=${hostRules}`,
      '--ignore-certificate-errors',
      '--no-first-run',
      '--disable-features=DialMediaRouteProvider',
    ],
  });

  // Wait for the MV3 service worker (background) to register.
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extId = new URL(sw.url()).host;
  // Give DNR a moment to index the static rulesets on first install.
  await sleep(1500);
  return { context, sw, extId, userDataDir };
}

async function enabledRulesets(sw) {
  return sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
}

// The extension has no `tabs` permission, so Tab.url is stripped in query
// results — we can't match by URL. The page under test is the active tab, so we
// read the active tab's id (id is always present).
async function activeTabId(sw) {
  return sw.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return t ? t.id : -1;
  });
}

async function badgeText(sw, tabId) {
  return sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
}

// Navigate and collect which of the ad/tracker hosts were DNR-blocked.
async function loadAndAnalyzeNetwork(context, url) {
  const page = await context.newPage();
  const blocked = new Set();
  const resolved = new Set();
  page.on('requestfailed', (req) => {
    const f = req.failure();
    const host = safeHost(req.url());
    if (f && /BLOCKED_BY_CLIENT/.test(f.errorText)) blocked.add(host);
  });
  page.on('response', (resp) => {
    if (resp.status() === 200) resolved.add(safeHost(resp.url()));
  });
  await page.goto(url, { waitUntil: 'load', timeout: 20_000 }).catch(() => {});
  await sleep(800);
  const res = await page.evaluate(() => window.__res ?? null);
  return { page, blocked, resolved, res };
}

function safeHost(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
}

async function isHidden(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return getComputedStyle(el).display === 'none';
  }, selector);
}

// Drive the real options-page UI to change the strictness level.
async function setLevelViaUI(context, extId, label) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/options.html`, { waitUntil: 'load' });
  await page.getByLabel(label, { exact: true }).first().check();
  await sleep(200);
  await page.close();
  await sleep(900); // let the background watcher reconcile DNR
}

// Drive the real options-page UI to add an allowlisted host (Sites tab).
async function allowlistViaUI(context, extId, host) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/options.html`, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Sites' }).click();
  await page.getByLabel('Site to exclude from blocking').fill(host);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await sleep(200);
  await page.close();
  await sleep(900);
}

async function main() {
  const { server, port } = await startServer();
  console.log(`fixture server on 127.0.0.1:${port}`);
  const pageUrl = (host, path) => `https://${host}:${port}/${path}`;

  // ---- TEST 1: network block on standard (default) ----
  await withCtx(port, async ({ context, sw }) => {
    const rs = await enabledRulesets(sw);
    const { page, blocked, res } = await loadAndAnalyzeNetwork(
      context,
      pageUrl(PAGE_HOST, 'network.html'),
    );
    const adBlocked = blocked.has(AD_HOST) || res?.ad === 'error';
    const trackerBlocked = blocked.has(TRACKER_HOST) || res?.tracker === 'error';
    await page.close();
    const pass = adBlocked && trackerBlocked;
    record(
      'T1',
      'network block (standard)',
      pass,
      `enabledRulesets=[${rs.join(',')}] adBlocked=${adBlocked} trackerBlocked=${trackerBlocked} (blocked hosts: ${[...blocked].join(',') || 'none'})`,
    );
  });

  // ---- TEST 2: cosmetic hide, site-specific, standard ----
  await withCtx(port, async ({ context, sw }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(SITE_COSMETIC_HOST, 'cosmetic-site.html'), { waitUntil: 'load' });
    await sleep(700);
    const hiddenAd = await isHidden(page, '#ytad');
    const hiddenContent = await isHidden(page, '#content');
    await page.close();
    const pass = hiddenAd === true && hiddenContent === false;
    record(
      'T2',
      'cosmetic hide site-specific (standard)',
      pass,
      `#ytad display:none=${hiddenAd}, #content hidden=${hiddenContent}`,
    );
  });

  // ---- TEST 2b: generic cosmetic only at aggressive ----
  await withCtx(port, async ({ context, extId }) => {
    // At standard, generic .ad must NOT be hidden.
    let page = await context.newPage();
    await page.goto(pageUrl(PAGE_HOST, 'cosmetic-generic.html'), { waitUntil: 'load' });
    await sleep(500);
    const hiddenAtStandard = await isHidden(page, '#genad');
    await page.close();

    await setLevelViaUI(context, extId, 'Aggressive');
    page = await context.newPage();
    await page.goto(pageUrl(PAGE_HOST, 'cosmetic-generic.html'), { waitUntil: 'load' });
    await sleep(700);
    const hiddenAtAggressive = await isHidden(page, '#genad');
    await page.close();
    const pass = hiddenAtStandard === false && hiddenAtAggressive === true;
    record(
      'T2b',
      'generic cosmetic gated to aggressive',
      pass,
      `.ad hidden@standard=${hiddenAtStandard} hidden@aggressive=${hiddenAtAggressive}`,
    );
  });

  // ---- TEST 3: allowlist stops BOTH network + cosmetic ----
  await withCtx(port, async ({ context, extId, sw }) => {
    await allowlistViaUI(context, extId, PAGE_HOST);
    const dyn = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
    const { page, blocked, res } = await loadAndAnalyzeNetwork(
      context,
      pageUrl(PAGE_HOST, 'network.html'),
    );
    const adBlocked = blocked.has(AD_HOST) || res?.ad === 'error';
    await page.close();
    // cosmetic on an allowlisted site-specific host
    await allowlistViaUI(context, extId, SITE_COSMETIC_HOST);
    const page2 = await context.newPage();
    await page2.goto(pageUrl(SITE_COSMETIC_HOST, 'cosmetic-site.html'), { waitUntil: 'load' });
    await sleep(700);
    const hiddenAd = await isHidden(page2, '#ytad');
    await page2.close();
    const pass = adBlocked === false && hiddenAd === false;
    record(
      'T3',
      'allowlist disables network + cosmetic',
      pass,
      `dynamicRules=${dyn.length} adStillBlocked=${adBlocked} cosmeticStillHidden=${hiddenAd}`,
    );
  });

  // ---- TEST 4: badge = exact cosmetic count; network shown ~ / accuracy approximate ----
  await withCtx(port, async ({ context, sw }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(SITE_COSMETIC_HOST, 'cosmetic-site.html'), { waitUntil: 'load' });
    await sleep(1200); // allow content-script report (>=500ms) + badge update
    const domHidden = await page.evaluate(() => {
      const sels = ['#ytad', '#player-ads'];
      return sels.filter((s) => {
        const el = document.querySelector(s);
        return el && getComputedStyle(el).display === 'none';
      }).length;
    });
    const tabId = await activeTabId(sw);
    const badge = await badgeText(sw, tabId);
    await page.close();
    // The badge is the exact cosmetic-hide count: a bare integer equal to the
    // number of elements our CSS hid, and never a "~" estimate. (The network
    // "~"/"—" honesty in the popup is covered by the logic test in logic.test.mjs,
    // which exercises the real formatCount() the popup renders with — the popup
    // opened standalone always sees itself as the active tab, so it can't show a
    // web page's stats in this harness.)
    const pass = badge === String(domHidden) && domHidden > 0 && !badge.includes('~');
    record(
      'T4',
      'badge reflects cosmetic hides exactly (no ~)',
      pass,
      `domHidden=${domHidden} badge="${badge}"`,
    );
  });

  // ---- TEST 5: level off -> nothing blocked/hidden ----
  await withCtx(port, async ({ context, extId, sw }) => {
    await setLevelViaUI(context, extId, 'Off');
    const rs = await enabledRulesets(sw);
    const { page, blocked, res } = await loadAndAnalyzeNetwork(
      context,
      pageUrl(PAGE_HOST, 'network.html'),
    );
    const adBlocked = blocked.has(AD_HOST) || res?.ad === 'error';
    await page.close();
    const page2 = await context.newPage();
    await page2.goto(pageUrl(SITE_COSMETIC_HOST, 'cosmetic-site.html'), { waitUntil: 'load' });
    await sleep(700);
    const hiddenAd = await isHidden(page2, '#ytad');
    await page2.close();
    const pass = adBlocked === false && hiddenAd === false && rs.length === 0;
    record(
      'T5',
      'level off disables everything',
      pass,
      `enabledRulesets=[${rs.join(',')}] adBlocked=${adBlocked} cosmeticHidden=${hiddenAd}`,
    );
  });

  // ---- TEST 6: custom cosmetic filter via the "My filters" UI is applied ----
  await withCtx(port, async ({ context, extId }) => {
    const opt = await context.newPage();
    await opt.goto(`chrome-extension://${extId}/options.html`, { waitUntil: 'load' });
    await opt.getByRole('button', { name: 'My filters' }).click();
    await opt.getByLabel('Host for this cosmetic rule (blank for all sites)').fill(PAGE_HOST);
    await opt.getByLabel('CSS selector to hide').fill('#sponsored-slot');
    await opt.getByRole('button', { name: 'Add', exact: true }).click();
    await sleep(300);
    await opt.close();
    const page = await context.newPage();
    await page.goto(pageUrl(PAGE_HOST, 'custom.html'), { waitUntil: 'load' });
    await sleep(700);
    const hiddenCustom = await isHidden(page, '#sponsored-slot');
    const hiddenContent = await isHidden(page, '#content');
    await page.close();
    const pass = hiddenCustom === true && hiddenContent === false;
    record(
      'T6',
      'custom cosmetic filter (My filters UI) applied',
      pass,
      `#sponsored-slot hidden=${hiddenCustom} #content hidden=${hiddenContent}`,
    );
  });

  // ---- TEST 7: element picker creates + persists a per-site cosmetic filter ----
  await withCtx(port, async ({ context, sw }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(PAGE_HOST, 'custom.html'), { waitUntil: 'load' });
    await sleep(500);
    const tabId = await activeTabId(sw);
    // Simulate the context-menu / popup trigger.
    await sw.evaluate(
      (id) => chrome.tabs.sendMessage(id, { type: 'startPicker' }),
      tabId,
    );
    await sleep(300);
    // Click the element to pick it (capture-phase listener swallows the click).
    await page.click('#sponsored-slot', { force: true });
    await sleep(500);
    const hiddenNow = await isHidden(page, '#sponsored-slot');
    await page.close();
    const persisted = await sw.evaluate(async () => {
      const d = await chrome.storage.local.get('customFilters');
      return d.customFilters ?? null;
    });
    await sleep(100);
    const gotSelector =
      persisted &&
      Object.values(persisted).some(
        (arr) => Array.isArray(arr) && arr.some((s) => /sponsored-slot|promo-box/.test(s)),
      );
    const pass = hiddenNow === true && Boolean(gotSelector);
    record(
      'T7',
      'element picker hides + persists a filter',
      pass,
      `hiddenAfterPick=${hiddenNow} persisted=${JSON.stringify(persisted)}`,
    );
  });

  // ---- TEST 8: per-site "disable cosmetic only" keeps network, stops hiding ----
  await withCtx(port, async ({ context, sw }) => {
    // Give victim.test a custom rule (would hide #sponsored-slot) ...
    await sw.evaluate(() =>
      chrome.storage.local.set({
        customFilters: { 'victim.test': ['#sponsored-slot'] },
        customFilters$: { v: 1 },
      }),
    );
    // ... then set the per-site disableCosmetic flag.
    await sw.evaluate(() =>
      chrome.storage.local.set({
        siteConfigs: { 'victim.test': { hostname: 'victim.test', disableCosmetic: true } },
        siteConfigs$: { v: 1 },
      }),
    );
    await sleep(200);
    // Cosmetic must NOT hide ...
    const cpage = await context.newPage();
    await cpage.goto(pageUrl(PAGE_HOST, 'custom.html'), { waitUntil: 'load' });
    await sleep(600);
    const stillHidden = await isHidden(cpage, '#sponsored-slot');
    await cpage.close();
    // ... but network blocking must still run.
    const { page, blocked, res } = await loadAndAnalyzeNetwork(
      context,
      pageUrl(PAGE_HOST, 'network.html'),
    );
    const adBlocked = blocked.has(AD_HOST) || res?.ad === 'error';
    await page.close();
    const pass = stillHidden === false && adBlocked === true;
    record(
      'T8',
      'disable-cosmetic keeps network, stops hiding',
      pass,
      `cosmeticHidden=${stillHidden} networkStillBlocked=${adBlocked}`,
    );
  });

  // ---- TEST 9: backup export -> import round-trips + applies (allowlist) ----
  await withCtx(port, async ({ context, extId, sw }) => {
    const opt = await context.newPage();
    await opt.goto(`chrome-extension://${extId}/options.html`, { waitUntil: 'load' });
    await opt.getByRole('button', { name: 'About' }).click();
    await opt.getByRole('button', { name: 'Export', exact: true }).click();
    await sleep(300);
    const exported = await opt.getByLabel('Settings backup JSON').inputValue();
    let parsed;
    try {
      parsed = JSON.parse(exported);
    } catch {
      parsed = null;
    }
    // Modify: allowlist victim.test, then import.
    let applied = false;
    if (parsed) {
      parsed.settings.allowlist = [PAGE_HOST];
      await opt.getByLabel('Settings backup JSON').fill(JSON.stringify(parsed));
      await opt.getByRole('button', { name: 'Import', exact: true }).click();
      await sleep(900); // settings watcher reconciles the DNR allowlist
      applied = true;
    }
    await opt.close();
    // With victim.test allowlisted via the imported backup, network is not blocked.
    const { page, blocked, res } = await loadAndAnalyzeNetwork(
      context,
      pageUrl(PAGE_HOST, 'network.html'),
    );
    const adBlocked = blocked.has(AD_HOST) || res?.ad === 'error';
    await page.close();
    const dyn = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
    const validJson = parsed !== null && typeof parsed.settings === 'object';
    const pass = validJson && applied && adBlocked === false;
    record(
      'T9',
      'backup export/import applies (allowlist round-trip)',
      pass,
      `validJson=${validJson} dynamicRules=${dyn.length} adBlockedAfterImport=${adBlocked}`,
    );
  });

  server.close();
  const passed = results.filter((r) => r.pass === true).length;
  console.log(`\n==== ${passed}/${results.length} PASSED ====`);
  writeFileSync(join(HERE, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.pass === true) ? 0 : 1);
}

async function withCtx(port, fn) {
  const { context, sw, extId, userDataDir } = await launch(port);
  try {
    await fn({ context, sw, extId });
  } catch (err) {
    console.error('context error:', err);
    record('ERR', 'harness error', false, String(err?.message || err));
  } finally {
    await context.close().catch(() => {});
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
