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
//  - UNDO (T10-T13) is proven by OBSERVING THE PAGE, never by asserting that a
//    function ran: an element is picked, confirmed display:none, the undo is
//    triggered the way a user triggers it (a real mouse click on the in-page
//    toast, whose closed shadow root nothing can select into; or a click on the
//    popup's real Restore button), and the element is then asserted VISIBLE again.
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
    // A picked rule is stored as `{ selector, label, added }` (the label is what
    // makes it recognisable in the popup later); a rule typed in Options or pasted
    // is still a bare selector string. Both shapes are read the same way.
    const selectorOf = (e) => (typeof e === 'string' ? e : e?.selector);
    const gotSelector =
      persisted &&
      Object.values(persisted).some(
        (arr) => Array.isArray(arr) && arr.some((e) => /sponsored-slot|promo-box/.test(selectorOf(e) ?? '')),
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

  // ---- TEST 10: IMMEDIATE UNDO — pick, then click Undo on the in-page toast ----
  //
  // The whole point of the feature: the element must be VISIBLE again after one
  // click, with no settings page involved. The toast lives in a CLOSED shadow
  // root, so Playwright cannot select the button — which is exactly the property
  // we want (the page can't reach it either). We therefore click it the way a
  // user does: a real mouse click at its viewport coordinates. Its geometry is
  // fixed by design in utils/undo-toast.ts (360×56 panel, 20px above the bottom,
  // 8px padding, an 80px Undo button left of a 32px close button with a 4px gap)
  // — those constants are mirrored here.
  await withCtx(port, async ({ context, sw }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(PAGE_HOST, 'custom.html'), { waitUntil: 'load' });
    await sleep(500);
    const tabId = await activeTabId(sw);
    await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'startPicker' }), tabId);
    await sleep(300);
    await page.click('#sponsored-slot', { force: true });
    await sleep(600);

    const hiddenAfterPick = await isHidden(page, '#sponsored-slot');
    // The toast exists in the light DOM but its shadow root is CLOSED: the page
    // (and Playwright) can see the host and nothing else.
    const toast = await page.evaluate(() => {
      const host = document.querySelector('[data-abx-undo]');
      if (!host) return null;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(360, vw - 24);
      const left = (vw - w) / 2;
      return {
        closed: host.shadowRoot === null, // closed root -> null, even from the page
        // Undo button centre: [panel right] - 8 (pad) - 32 (close) - 4 (gap) - 40 (half of 80)
        x: left + w - 84,
        y: vh - 20 - 28, // 20px above the bottom, half of the 56px panel height
      };
    });
    // The label captured at pick time is what makes the entry recognisable later.
    const stored = await sw.evaluate(async () => {
      const d = await chrome.storage.local.get('customFilters');
      return d.customFilters ?? null;
    });
    const entry = stored?.[PAGE_HOST]?.[0];
    const labelled = typeof entry === 'object' && typeof entry.label === 'string';

    let visibleAfterUndo = null;
    let cleared = null;
    if (toast) {
      await page.mouse.click(toast.x, toast.y);
      await sleep(600);
      visibleAfterUndo = (await isHidden(page, '#sponsored-slot')) === false;
      const after = await sw.evaluate(async () => {
        const d = await chrome.storage.local.get('customFilters');
        return d.customFilters ?? {};
      });
      cleared = !JSON.stringify(after).includes('sponsored-slot');
    }
    await page.close();
    const pass =
      hiddenAfterPick === true &&
      toast?.closed === true &&
      labelled &&
      visibleAfterUndo === true &&
      cleared === true;
    record(
      'T10',
      'in-page toast Undo restores the element (one click, no settings)',
      pass,
      `hiddenAfterPick=${hiddenAfterPick} toastShadowClosed=${toast?.closed} label=${JSON.stringify(entry?.label)} visibleAfterUndo=${visibleAfterUndo} filterRemoved=${cleared}`,
    );
  });

  // ---- TEST 11: DEFERRED UNDO — restoring from another context un-hides live ----
  //
  // This is the write the popup's "Restore" button makes (removeFilter -> storage).
  // Driving the popup's own React button is impossible in this harness — a popup
  // opened as a tab is its OWN active tab, so it can never see victim.test's
  // entries (same limitation noted on T4) — so the storage write is issued from
  // the service worker instead. What it proves is the part that could break: the
  // open page un-hides the element with NO reload, off the storage watcher.
  await withCtx(port, async ({ context, sw }) => {
    await sw.evaluate(() =>
      chrome.storage.local.set({
        customFilters: {
          'victim.test': [
            { selector: '#sponsored-slot', label: 'Block “custom junk” · 784×18', added: 1 },
          ],
        },
        customFilters$: { v: 1 },
      }),
    );
    await sleep(200);
    const page = await context.newPage();
    await page.goto(pageUrl(PAGE_HOST, 'custom.html'), { waitUntil: 'load' });
    await sleep(700);
    const hiddenBefore = await isHidden(page, '#sponsored-slot');
    // Restore (exactly what the popup persists: the key drops when it empties).
    await sw.evaluate(() => chrome.storage.local.set({ customFilters: {} }));
    await sleep(700);
    const visibleAfter = (await isHidden(page, '#sponsored-slot')) === false;
    await page.close();
    const pass = hiddenBefore === true && visibleAfter === true;
    record(
      'T11',
      'popup Restore (storage write) un-hides an open page with no reload',
      pass,
      `hiddenBefore=${hiddenBefore} visibleAfterRestore=${visibleAfter}`,
    );
  });

  // ---- TEST 12: "Show" (peek) reveals a hidden element, then re-hides it ----
  await withCtx(port, async ({ context, sw }) => {
    await sw.evaluate(() =>
      chrome.storage.local.set({
        customFilters: { 'victim.test': [{ selector: '#sponsored-slot', label: 'Block', added: 1 }] },
        customFilters$: { v: 1 },
      }),
    );
    await sleep(200);
    const page = await context.newPage();
    await page.goto(pageUrl(PAGE_HOST, 'custom.html'), { waitUntil: 'load' });
    await sleep(700);
    const hiddenBefore = await isHidden(page, '#sponsored-slot');
    const tabId = await activeTabId(sw);
    await sw.evaluate(
      (id) => chrome.tabs.sendMessage(id, { type: 'peekElement', selector: '#sponsored-slot' }),
      tabId,
    );
    await sleep(300);
    const visibleDuringPeek = (await isHidden(page, '#sponsored-slot')) === false;
    // The peek is transient: it must put the page back exactly as it was.
    await sleep(2400);
    const hiddenAfter = await isHidden(page, '#sponsored-slot');
    const noResidue = await page.evaluate(
      () => document.querySelector('#sponsored-slot')?.outerHTML ?? null,
    );
    // "No residue" = the peek left NOTHING on the page's own element (no marker
    // attribute, no inline style) and removed its override stylesheet.
    const sheets = await page.evaluate(
      // Style tags that are NOT the engine's own fallback sheet — i.e. ours.
      () => document.querySelectorAll('style:not([data-bx-marker])').length,
    );
    await page.close();
    const cleanedUp =
      typeof noResidue === 'string' && !/style=|data-abx-peek/.test(noResidue) && sheets === 0;
    const pass =
      hiddenBefore === true && visibleDuringPeek === true && hiddenAfter === true && cleanedUp;
    record(
      'T12',
      'peek shows a hidden element temporarily, leaving no residue',
      pass,
      `hidden=${hiddenBefore} visibleDuringPeek=${visibleDuringPeek} hiddenAgain=${hiddenAfter} leftoverStyleTags=${sheets} html=${JSON.stringify(noResidue)}`,
    );
  });

  // ---- TEST 13: the REAL popup lists hidden elements by LABEL, and its Restore
  //               button un-hides them in a REAL page ----
  //
  // ONE stub, and only one: the extension has no `tabs` permission, so Chrome
  // strips `Tab.url` from `tabs.query()` (verified: it comes back `undefined`).
  // A popup opened as a tab therefore has no hostname and renders its "can't run
  // here" state — a harness artifact, not product behaviour (in the real toolbar
  // popup Chrome supplies the active tab's URL). We hand back exactly that one
  // withheld field, pointing at the victim.test page open in the other tab, and
  // everything else is real: the real React list, the real Restore button, the
  // real storage write, and the real content script un-hiding the real element.
  await withCtx(port, async ({ context, extId, sw }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(PAGE_HOST, 'custom.html'), { waitUntil: 'load' });
    await sleep(400);
    const tabId = await activeTabId(sw);

    await sw.evaluate(() =>
      chrome.storage.local.set({
        customFilters: {
          'victim.test': [
            { selector: '#sponsored-slot', label: 'Block “custom junk” · 728×90', added: 7 },
            // A pre-labels (v1) entry: a bare string. It must still list (degrading
            // to its selector) and still be restorable.
            '#legacy-ad',
          ],
        },
        customFilters$: { v: 1 },
      }),
    );
    await sleep(600);
    const hiddenBefore = await isHidden(page, '#sponsored-slot');

    const popup = await context.newPage();
    await popup.addInitScript(
      ({ id, url }) => {
        const orig = chrome.tabs.query.bind(chrome.tabs);
        chrome.tabs.query = (q) =>
          q?.active ? Promise.resolve([{ id, url }]) : orig(q);
      },
      { id: tabId, url: pageUrl(PAGE_HOST, 'custom.html') },
    );
    await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
    await sleep(700);

    // The list shows the HUMAN label captured at pick time — not a CSS selector.
    const showsLabel = await popup
      .getByText('Block “custom junk” · 728×90')
      .isVisible()
      .catch(() => false);
    // ... and an un-labelled v1 rule degrades to its selector rather than vanishing.
    const showsLegacy = await popup.getByText('#legacy-ad').isVisible().catch(() => false);
    // "Restore all" — the cheap escape hatch — is offered once there are 2+.
    const showsRestoreAll = await popup
      .getByRole('button', { name: /Restore all 2 elements/ })
      .isVisible()
      .catch(() => false);

    await popup
      .getByRole('button', { name: 'Restore Block “custom junk” · 728×90' })
      .click();
    await sleep(700);
    const stored = await sw.evaluate(async () => {
      const d = await chrome.storage.local.get('customFilters');
      return d.customFilters ?? {};
    });
    // Only that one rule went; the other is untouched.
    const removedOne =
      !JSON.stringify(stored).includes('sponsored-slot') &&
      JSON.stringify(stored).includes('legacy-ad');
    // ...and the element is VISIBLE again in the live page, with no reload.
    const visibleAfter = (await isHidden(page, '#sponsored-slot')) === false;

    await popup.close();
    await page.close();
    const pass =
      hiddenBefore === true && showsLabel && showsLegacy && showsRestoreAll && removedOne && visibleAfter;
    record(
      'T13',
      'popup lists hidden elements by label; Restore un-hides the real page',
      pass,
      `hiddenBefore=${hiddenBefore} showsLabel=${showsLabel} legacyFallsBackToSelector=${showsLegacy} restoreAllOffered=${showsRestoreAll} onlyThatRuleRemoved=${removedOne} elementVisibleAfterRestore=${visibleAfter}`,
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
