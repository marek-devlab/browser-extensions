// Live test of the netblock DNR engine in a real Chromium (Playwright, offline).
// Run:  npm run build:netblock && node e2e/netblock/dnr.live.mjs
//
// METHOD (modelled on e2e/netblock-spikes/chrome.spike.mjs):
//  - The REAL built extension (extensions/netblock/.output/chrome-mv3) is copied
//    to a temp dir and its manifest gets `host_permissions` for the fixture
//    origin. That stands in for the user pressing "Enable on this site" in the
//    popup (`permissions.request` needs a user gesture + a native prompt that
//    automation cannot answer). Everything else is the shipped code.
//  - Rules are fed through the extension's own protocol: a tab on the tool page
//    calls `chrome.runtime.sendMessage({type:'importRules'…})`, exactly what
//    the UI does; the background validates, compiles and applies.
//  - "Blocked" = the page sees a fetch TypeError / img error AND the fixture
//    server's journal never saw the request. "Passed" = journal has it.
//  - Branded Google Chrome ≥ 137 ignores --load-extension: this uses
//    Playwright's Chromium (SPIKE_EXECUTABLE overrides the binary).
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { startServers } from '../netblock-spikes/server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILT = join(HERE, '..', '..', 'extensions', 'netblock', '.output', 'chrome-mv3');
const EXECUTABLE = process.env.SPIKE_EXECUTABLE || undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id} ${name} — ${detail}`);
}

if (!existsSync(join(BUILT, 'manifest.json'))) {
  console.error('Build first: npm run build:netblock');
  process.exit(2);
}

const srv = await startServers();
const pageOrigin = srv.pageOrigin;

// Copy + grant host access to the fixture origin (see METHOD).
const extDir = mkdtempSync(join(tmpdir(), 'netblock-dnr-ext-'));
cpSync(BUILT, extDir, { recursive: true });
const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = [`${pageOrigin}/*`];
writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const userDataDir = mkdtempSync(join(tmpdir(), 'netblock-dnr-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : { channel: 'chromium' }),
  headless: false,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=DialMediaRouteProvider',
  ],
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  await sleep(500);
  const extId = new URL(sw.url()).host;

  // The tool page is our messaging seat (extension page → chrome.runtime).
  const tool = await context.newPage();
  await tool.goto(`chrome-extension://${extId}/tool.html`);
  await sleep(300);
  const send = (msg) => tool.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  const sessionRules = () => sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules());

  /** Tab id of a newly created page: the id that was not there before. */
  async function newTab(url) {
    const before = new Set(await sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id)));
    const page = await context.newPage();
    await page.goto(url);
    const after = await sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id));
    const tabId = after.find((id) => !before.has(id));
    return { page, tabId };
  }

  let ruleSeq = 0;
  function rule(over) {
    ruleSeq++;
    return {
      id: over.id ?? `r${ruleSeq}`,
      name: over.id ?? `r${ruleSeq}`,
      enabled: true,
      priority: ruleSeq,
      createdAt: 1000 + ruleSeq,
      scope: 'all',
      condition: { url: { op: 'contains', value: '/api/never/' }, resourceTypes: ['xhr'] },
      state: { kind: 'every' },
      countKey: 'rule+tab',
      resetOn: 'session',
      action: { type: 'block' },
      engine: 'auto',
      ...over,
    };
  }
  async function importRules(rules) {
    const r = await send({ type: 'importRules', text: JSON.stringify({ version: 1, rules, groups: [] }), mode: 'replace' });
    await sleep(250); // apply() is awaited inside importRules; a little slack for events
    return r;
  }
  const fetchFrom = (page, path) => page.evaluate((u) => window.__fetchStatus(u), path);
  const imgFrom = (page, path) =>
    page.evaluate(
      (u) =>
        new Promise((resolve) => {
          const i = new Image();
          i.onload = () => resolve('load');
          i.onerror = () => resolve('error');
          i.src = u;
        }),
      path,
    );
  const reached = (from, pathPrefix) => srv.journal.slice(from).filter((j) => j.path.startsWith(pathPrefix)).length;

  const t1 = await newTab(`${pageOrigin}/page.html`);
  const t2 = await newTab(`${pageOrigin}/page.html?two=1`);
  await t1.page.bringToFront();
  await sleep(200);

  /* ------------------------------------------------------------- (a) */
  {
    await importRules([
      rule({ id: 'img', condition: { url: { op: 'wildcard', value: '*/img/*' }, resourceTypes: ['image'] } }),
    ]);
    const j0 = srv.journal.length;
    const blocked = await imgFrom(t1.page, '/img/one.png?a');
    const control = await imgFrom(t1.page, '/pic/one.png?a');
    await sleep(200);
    const hitImg = reached(j0, '/img/');
    const hitPic = reached(j0, '/pic/');
    record('a', 'wildcard image block', blocked === 'error' && hitImg === 0 && hitPic === 1, `img=${blocked}, journal /img/=${hitImg}, control /pic/=${hitPic}`);
    const rules = await sessionRules();
    record('a2', 'exactly one session rule installed for one stateless rule', rules.length === 1 && rules[0].condition.urlFilter === '|*/img/*|', JSON.stringify(rules.map((r) => [r.id, r.condition.urlFilter])));
    // Idempotency: importing the same document again leaves the same rules.
    await importRules([rule({ id: 'img', condition: { url: { op: 'wildcard', value: '*/img/*' }, resourceTypes: ['image'] } })]);
    const again = await sessionRules();
    record('a3', 're-apply of the same rules is a no-op (same ids, same count)', again.length === 1 && again[0].id === rules[0].id, `ids ${rules.map((r) => r.id)} → ${again.map((r) => r.id)}`);
  }

  /* ------------------------------------------------------------- (b) */
  {
    await importRules([
      rule({ id: 'scoped', scope: 'activeTab', condition: { url: { op: 'contains', value: '/api/scoped' }, resourceTypes: ['xhr'] } }),
    ]);
    const j0 = srv.journal.length;
    const inActive = await fetchFrom(t1.page, '/api/scoped?x=1');
    const inBackground = await fetchFrom(t2.page, '/api/scoped?x=2');
    await sleep(100);
    const okA = inActive.ok === false && reached(j0, '/api/scoped?x=1') === 0;
    const okB = inBackground.ok === true && reached(j0, '/api/scoped?x=2') === 1;
    record('b', 'activeTab scope blocks only in the active tab', okA && okB, `active tab: ${inActive.ok === false ? 'blocked' : 'passed'}; background tab: ${inBackground.ok ? 'passed' : 'blocked'}`);
    await t2.page.bringToFront();
    await sleep(300);
    const j1 = srv.journal.length;
    const nowActive = await fetchFrom(t2.page, '/api/scoped?x=3');
    const nowBackground = await fetchFrom(t1.page, '/api/scoped?x=4');
    await sleep(100);
    record('b2', 'rule follows tab activation', nowActive.ok === false && reached(j1, '/api/scoped?x=3') === 0 && nowBackground.ok === true, `after bringToFront(tab2): tab2 ${nowActive.ok === false ? 'blocked' : 'passed'}, tab1 ${nowBackground.ok ? 'passed' : 'blocked'}`);
    const sr = await sessionRules();
    record('b3', 'session rule carries tabIds = [active tab]', sr.length === 1 && Array.isArray(sr[0].condition.tabIds) && sr[0].condition.tabIds.length === 1 && sr[0].condition.tabIds[0] === t2.tabId, JSON.stringify(sr.map((r) => r.condition.tabIds)));
    await t1.page.bringToFront();
    await sleep(200);
  }

  /* ------------------------------------------------------------- (c) */
  {
    await importRules([
      rule({ id: 'A', condition: { url: { op: 'contains', value: '/api/a' }, resourceTypes: ['xhr'] } }),
      rule({ id: 'B', state: { kind: 'afterRule', ruleId: 'A' }, condition: { url: { op: 'contains', value: '/api/b' }, resourceTypes: ['xhr'] } }),
    ]);
    const before = await sessionRules();
    const j0 = srv.journal.length;
    const bBefore = await fetchFrom(t1.page, '/api/b?before=1');
    record('c1', 'B not installed before A matched; B passes', before.length === 1 && bBefore.ok === true && reached(j0, '/api/b?before') === 1, `session rules=${before.length}, /api/b ${bBefore.ok ? 'passed' : 'blocked'}`);
    // A is itself BLOCKED, so the page's rejection and our onErrorOccurred hop
    // start at the same instant: at gap 0 the next request is effectively
    // "parallel" (spike S3: 0/5). Characterise across gaps; the honesty note
    // reactiveParallelSlip covers the small-gap tail.
    const GAPS = [0, 10, 30, 100];
    const TRIALS = 3;
    const perGap = {};
    for (const gap of GAPS) {
      perGap[gap] = 0;
      for (let i = 0; i < TRIALS; i++) {
        await send({ type: 'resetCounters', ruleId: 'B' });
        await sleep(100);
        const tag = `g${gap}i${i}`;
        const jt = srv.journal.length;
        const r = await t1.page.evaluate(async ({ tag, gap }) => {
          const a = await window.__fetchStatus(`/api/a?${tag}`);
          if (gap > 0) await new Promise((res) => setTimeout(res, gap));
          const b = await window.__fetchStatus(`/api/b?${tag}`);
          return { a, b };
        }, { tag, gap });
        await sleep(150);
        if (r.a.ok === false && r.b.ok === false && reached(jt, `/api/b?${tag}`) === 0) perGap[gap]++;
      }
    }
    const summary = GAPS.map((g) => `${g}ms:${perGap[g]}/${TRIALS}`).join(' ');
    record('c', 'afterRule: B-after-A blocked once A was observed (gap ≥ 30 ms: all)', perGap[30] === TRIALS && perGap[100] === TRIALS, summary);
    const after = await sessionRules();
    const inst = after.find((r) => r.condition.urlFilter === '/api/b');
    record('c2', 'armed B is a per-tab session rule (countKey rule+tab)', !!inst && Array.isArray(inst.condition.tabIds) && inst.condition.tabIds[0] === t1.tabId, JSON.stringify(after.map((r) => [r.id, r.condition.urlFilter, r.condition.tabIds])));
    const jo = srv.journal.length;
    const other = await fetchFrom(t2.page, '/api/b?othertab=1');
    record('c3', 'B stays open in the other tab (per-tab instance)', other.ok === true && reached(jo, '/api/b?othertab') === 1, `tab2 /api/b ${other.ok ? 'passed' : 'blocked'}`);
  }

  /* ------------------------------------------------------------- (d) */
  {
    await importRules([rule({ id: 'A', condition: { url: { op: 'contains', value: '/api/a' }, resourceTypes: ['xhr'] } })]);
    await send({ type: 'pauseTab', tabId: t1.tabId, paused: true });
    await sleep(150);
    const j0 = srv.journal.length;
    const paused = await fetchFrom(t1.page, '/api/a?paused=1');
    const otherTab = await fetchFrom(t2.page, '/api/a?paused=2');
    const sr = await sessionRules();
    const allow = sr.find((r) => r.action.type === 'allow');
    record('d', 'pause on tab lets the request through (allow rule with tabIds), other tab still blocked', paused.ok === true && reached(j0, '/api/a?paused=1') === 1 && otherTab.ok === false && !!allow && allow.condition.tabIds[0] === t1.tabId, `paused tab ${paused.ok ? 'passed' : 'blocked'}, other ${otherTab.ok ? 'passed' : 'blocked'}, allow.priority=${allow?.priority}`);
    await send({ type: 'pauseTab', tabId: t1.tabId, paused: false });
    await sleep(150);
    const resumed = await fetchFrom(t1.page, '/api/a?resumed=1');
    record('d2', 'resume blocks again; allow rule removed', resumed.ok === false && !(await sessionRules()).some((r) => r.action.type === 'allow'), `after resume ${resumed.ok ? 'passed' : 'blocked'}`);
  }

  /* ------------------------------------------------------------- (e) */
  {
    // `e` is valid JS (our schema accepts it) but RE2 has no \u escapes →
    // Chrome answers `syntaxError`. The other rule must still land.
    await importRules([
      rule({ id: 'bad', condition: { url: { op: 'regex', value: '/api/\\u0065xotic' }, resourceTypes: ['xhr'] } }),
      rule({ id: 'good', condition: { url: { op: 'contains', value: '/api/good' }, resourceTypes: ['xhr'] } }),
    ]);
    const listed = await send({ type: 'listRules' });
    const errs = listed.applied.errors;
    const bad = errs.find((e) => e.ruleId === 'bad');
    const j0 = srv.journal.length;
    const good = await fetchFrom(t1.page, '/api/good?x=1');
    const sr = await sessionRules();
    record('e', 'unsupported regex → error with the browser reason, other rule active', !!bad && /syntaxError/i.test(bad.message) && bad.hint === 'regexInvalid' && good.ok === false && reached(j0, '/api/good') === 0 && sr.length === 1, `errors=${JSON.stringify(errs)}; /api/good ${good.ok ? 'passed' : 'blocked'}; session rules=${sr.length}`);
  }

  /* ---------------------------------------------------- tab close cleanup */
  {
    await importRules([rule({ id: 'scoped', scope: 'activeTab', condition: { url: { op: 'contains', value: '/api/scoped' }, resourceTypes: ['xhr'] } })]);
    await t2.page.bringToFront();
    await sleep(200);
    const withTab = (await sessionRules()).filter((r) => r.condition.tabIds?.includes(t2.tabId)).length;
    await t2.page.close();
    await sleep(400);
    const afterClose = (await sessionRules()).filter((r) => r.condition.tabIds?.includes(t2.tabId)).length;
    record('f', 'tabs.onRemoved drops that tab’s tabIds session rules', withTab === 1 && afterClose === 0, `before close ${withTab}, after ${afterClose}`);
  }

  /* ------------------------------------------------------------ cleanup */
  await importRules([]);
  record('g', 'empty document removes every session rule', (await sessionRules()).length === 0, 'getSessionRules() empty');
} finally {
  await context.close().catch(() => {});
  await srv.close();
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(extDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} live checks passed`);
process.exit(failed ? 1 : 0);
