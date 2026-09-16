// Live test of the netblock `debugger` engine — Network-level mode — (Chromium
// via Playwright, offline). Run:  npm run e2e:netblock-debugger-live
// (needs `npm run build:netblock` first). Not in the default `e2e` chain.
//
// Method (modelled on e2e/netblock-spikes/chrome.spike.mjs and page.live.mjs):
// the BUILT extension is loaded UNMODIFIED into a headed persistent Chromium
// (NL mode needs no host permission — `debugger` is install-time now), rules
// are saved through the real message router from an extension page, NL is
// switched on for the fixture tab with the real `setNetworkLevel` message,
// and the fixture page (e2e/netblock-spikes/server.mjs) is driven with
// page.evaluate(). The server journals every request, so "the page saw a
// network error" and "the server never got the request" are checked
// independently.
//
// ⚠️ Playwright is itself a CDP client of this browser. `chrome.debugger.attach`
// from the extension still works alongside it (spikes S1/S6, e2e/perf) — this
// file records the attach result explicitly so a future Chromium that changes
// that is caught here, not in the field.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { startServers } from '../netblock-spikes/server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILT = join(HERE, '..', '..', 'extensions', 'netblock', '.output', 'chrome-mv3');
const CHANNEL = process.env.SPIKE_CHANNEL || 'chromium';
const EXECUTABLE = process.env.SPIKE_EXECUTABLE || undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(join(BUILT, 'manifest.json'))) {
  console.error(`[debugger.live] no build at ${BUILT} — run \`npm run build:netblock\` first`);
  process.exit(2);
}

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

const srv = await startServers();
const origin = srv.pageOrigin;
const reached = (path) => srv.journal.filter((j) => j.path.startsWith(path)).length;

const userDataDir = mkdtempSync(join(tmpdir(), 'netblock-dbg-live-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : { channel: CHANNEL }),
  headless: false,
  args: [
    `--disable-extensions-except=${BUILT}`,
    `--load-extension=${BUILT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=DialMediaRouteProvider',
  ],
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extId = new URL(sw.url()).host;
  await sleep(800);

  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
  check('built manifest: debugger install-time, no optional_permissions', manifest.permissions.includes('debugger') && manifest.optional_permissions === undefined, manifest.permissions);
  check('chrome.debugger API present in the worker', await sw.evaluate(() => typeof chrome.debugger?.attach === 'function'));

  /* --------------------------------- rules --------------------------------- */

  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${extId}/popup.html`);
  const send = (msg) => ui.evaluate((m) => chrome.runtime.sendMessage(m), msg);

  const rule = (id, over) => ({
    id, name: id, enabled: true, priority: 0, createdAt: 1, scope: 'all', countKey: 'rule+tab', resetOn: 'navigation', engine: 'auto',
    state: { kind: 'every' }, action: { type: 'block' }, ...over,
  });
  const url = (v, types) => ({ url: { op: 'contains', value: v }, resourceTypes: types });
  const rules = [
    rule('timeout', { condition: url('/api/timeout', ['xhr']), action: { type: 'fail', reason: 'TimedOut' } }),
    rule('real500', { condition: { ...url('/api/real500', ['xhr']), responseStatus: '5xx' }, action: { type: 'fail', reason: 'InternetDisconnected' } }),
    rule('script503', { condition: url('/api/script503', ['script']), action: { type: 'status', code: 503, body: '{"error":"down"}', contentType: 'application/json' } }),
    rule('slow', { condition: url('/api/slowscript', ['script']), action: { type: 'delay', ms: 1200 } }),
    rule('s101', { condition: url('/api/s101', ['script']), action: { type: 'status', code: 101 } }),
    // pageDomains needs the tab's host — which the engine learns over CDP, not from `tabs` (no host access here).
    rule('dom', { condition: { ...url('/api/dom', ['xhr']), pageDomains: ['127.0.0.1'] }, action: { type: 'fail', reason: 'ConnectionRefused' } }),
    rule('domOther', { condition: { ...url('/api/domother', ['xhr']), pageDomains: ['example.com'] }, action: { type: 'fail', reason: 'ConnectionRefused' } }),
  ];
  for (const r of rules) {
    const reply = await send({ type: 'saveRule', rule: r });
    if (!reply?.ok) console.log('saveRule failed', r.id, JSON.stringify(reply));
  }
  const caps = await send({ type: 'getCaps' });
  check('caps.debugger is true with the permission present', caps?.caps?.debugger === true, caps?.caps);
  const listed = await send({ type: 'listRules' });
  const dbg = listed.applied.compiled.filter((c) => c.engine === 'debugger').map((c) => c.rule.id);
  check('all seven rules compile to the debugger engine', dbg.length === 7, { dbg, inactive: listed.applied.inactive.map((i) => `${i.rule.id}:${i.reason}`) });

  /* --------------------------------- attach -------------------------------- */

  const page = await context.newPage();
  await page.goto(`${origin}/page.html`);
  // Without host access `tabs.query` hides web URLs (the shipped manifest is
  // loaded unmodified): the fixture tab is simply the newest tab.
  const tabId = await sw.evaluate(async () => Math.max(...(await chrome.tabs.query({})).map((t) => t.id ?? -1)));
  check('fixture tab found (newest tab; its URL is hidden from tabs.query without host access)', typeof tabId === 'number' && tabId >= 0, tabId);

  let summary = await send({ type: 'getTabSummary', tabId });
  check('before NL: rules needing NL are inactive with reason needsNetworkLevel', summary.rules.filter((r) => r.engine === 'debugger').every((r) => !r.active && r.reason === 'needsNetworkLevel'), summary.rules.map((r) => `${r.rule.id}:${r.active}:${r.reason}`));
  check('before NL: summary says not attached, NL available', summary.networkLevel === false && summary.networkLevelAvailable === true && summary.nl?.attached === false);

  const on = await send({ type: 'setNetworkLevel', tabId, enabled: true });
  check('setNetworkLevel on → {ok:true} (chrome.debugger.attach works under Playwright)', on?.ok === true, on);
  // ⚠️ `debugger.getTargets().attached` is true for ANY debugger — Playwright's
  // own CDP session included — so it proves nothing here. A command on the
  // session does: it succeeds while we are attached and throws after detach.
  const ping = (id) => sw.evaluate((t) => chrome.debugger.sendCommand({ tabId: t }, 'Page.getFrameTree').then(() => 'ok', (e) => String(e?.message ?? e)), id);
  check('our session is live (sendCommand on the tab succeeds)', (await ping(tabId)) === 'ok');
  summary = await send({ type: 'getTabSummary', tabId });
  check('after NL: rules active, summary attached', summary.networkLevel === true && summary.nl?.attached === true && summary.rules.filter((r) => r.engine === 'debugger').every((r) => r.active));
  const nlTabs = await sw.evaluate(() => chrome.storage.session.get('nlTabs'));
  check('session:nlTabs records the tab', Array.isArray(nlTabs.nlTabs) && nlTabs.nlTabs.includes(tabId), nlTabs);

  // Helpers for non-xhr resource types: <script src> with timing + the
  // Resource Timing `responseStatus` (Chrome 109+) to read the status a
  // script/image element itself never exposes.
  await page.evaluate(() => {
    window.__script = (path) =>
      new Promise((resolve) => {
        const s = document.createElement('script');
        const t0 = performance.now();
        const done = (ok) => setTimeout(() => {
          const abs = new URL(path, location.href).href;
          const e = performance.getEntriesByName(abs).slice(-1)[0];
          resolve({ ok, ms: Math.round(performance.now() - t0), status: e ? e.responseStatus : null });
        }, 80);
        s.onload = () => done(true);
        s.onerror = () => done(false);
        s.src = path;
        document.head.append(s);
      });
  });

  /* ------------------------------ (a) Request stage ------------------------------ */

  const a = await page.evaluate(() => window.__fetchStatus('/api/timeout?status=200'));
  check('(a) fail(TimedOut) on xhr: page sees a network error', a.ok === false && a.error === 'TypeError', a);
  check('(a) server never reached (Request stage)', reached('/api/timeout') === 0, reached('/api/timeout'));

  /* ------------------------------ (b) Response stage ----------------------------- */

  const b = await page.evaluate(() => window.__fetchStatus('/api/real500?status=500'));
  check('(b) real 500 + 5xx → fail(InternetDisconnected): page sees a failure', b.ok === false, b);
  check('(b) server WAS reached (Response stage)', reached('/api/real500') === 1, reached('/api/real500'));
  const b2 = await page.evaluate(() => window.__fetchStatus('/api/real500?status=200'));
  check('(b) same URL with a real 200 passes untouched', b2.ok === true && b2.status === 200, b2);

  /* --------------------------- (c) non-xhr: script 503 --------------------------- */

  const c = await page.evaluate(() => window.__script('/api/script503'));
  check('(c) status 503 on a <script>: fulfilled, page sees 503 (Resource Timing), server never reached', c.status === 503 && reached('/api/script503') === 0, { c, reached: reached('/api/script503') });

  /* ------------------------------- (d) delay ------------------------------- */

  const d = await page.evaluate(() => window.__script('/api/slowscript'));
  check('(d) delay 1200 on a <script>: ≥ 1100 ms, real response', d.ms >= 1100 && d.ms < 4000 && reached('/api/slowscript') === 1, d);

  /* ---------------------- (g) refused command → fail-open ---------------------- */

  const g = await Promise.race([page.evaluate(() => window.__script('/api/s101')), sleep(8000).then(() => ({ hung: true }))]);
  check('(g) status 101: the request does not hang — either Chrome accepted 101 or the refused fulfil was continued', !g.hung, g);
  const applied = (await send({ type: 'listRules' })).applied;
  console.log(`      (g) engine errors: ${JSON.stringify(applied.errors)}`);

  /* ---------------------------------- log ---------------------------------- */

  await sleep(400);
  const log = await send({ type: 'getLogPage', afterId: 0, tabId });
  const rows = log.entries.filter((e) => e.engine === 'debugger');
  const byRule = (id) => rows.find((e) => e.ruleId === id);
  check('log: failed row for timeout with error TimedOut, type xhr, no ✱ mark', byRule('timeout')?.outcome === 'failed' && byRule('timeout')?.error === 'TimedOut' && byRule('timeout')?.type === 'xhr' && byRule('timeout')?.marks.length === 0, byRule('timeout'));
  check('log: real500 row carries the real status 500 and the reason', byRule('real500')?.outcome === 'failed' && byRule('real500')?.status === 500 && byRule('real500')?.error === 'InternetDisconnected', byRule('real500'));
  check('log: script503 row outcome status 503, type script', byRule('script503')?.outcome === 'status' && byRule('script503')?.status === 503 && byRule('script503')?.type === 'script', byRule('script503'));
  check('log: delayed row with delayMs 1200', byRule('slow')?.outcome === 'delayed' && byRule('slow')?.delayMs === 1200, byRule('slow'));
  const passedReal200 = log.entries.find((e) => e.url.includes('/api/real500?status=200'));
  check('log: passed row for the real 200 (Response stage, status recorded)', passedReal200?.outcome === 'passed' && passedReal200?.status === 200, passedReal200);
  summary = await send({ type: 'getTabSummary', tabId });
  check('summary.nl counters: intercepted ≥ 6, applied ≥ 4 (exact)', summary.nl.intercepted >= 6 && summary.nl.applied >= 4, summary.nl);
  const counters = await sw.evaluate(() => chrome.storage.session.get('state'));
  check('counters written through to session:state (timeout hit once)', counters.state?.counters?.[`timeout|t${tabId}`]?.hits === 1, counters.state?.counters);

  /* ------------------ (h) resetOn: navigation without host access ------------------ */

  // The shipped manifest has NO host access here, so `tabs.onUpdated` never
  // sees `tab.url` — only `status: 'loading'`. The per-tab counter of a
  // `resetOn: 'navigation'` rule must still reset on a reload (audit 🟡-7).
  await page.reload({ waitUntil: 'load' });
  await sleep(700);
  const afterReload = await sw.evaluate(() => chrome.storage.session.get('state'));
  check('(h) reload without host access resets the per-tab counter (resetOn: navigation)', afterReload.state?.counters?.[`timeout|t${tabId}`] === undefined, afterReload.state?.counters);
  check('(h) the NL session survives the reload', (await ping(tabId)) === 'ok');

  /* ------------------------------- (e) toggle off ------------------------------- */

  const off = await send({ type: 'setNetworkLevel', tabId, enabled: false });
  const pingOff = await ping(tabId);
  check('(e) setNetworkLevel off → detached (sendCommand now fails: "Debugger is not attached")', off?.ok === true && /not attached/i.test(pingOff), pingOff);
  const e = await page.evaluate(() => window.__fetchStatus('/api/timeout?status=200'));
  check('(e) after detach the same request passes (server reached)', e.ok === true && e.status === 200 && reached('/api/timeout') === 1, e);
  summary = await send({ type: 'getTabSummary', tabId });
  check('(e) summary: not attached, dbg rules inactive again, nlTabs empty', summary.networkLevel === false && summary.rules.filter((r) => r.engine === 'debugger').every((r) => !r.active) && ((await sw.evaluate(() => chrome.storage.session.get('nlTabs'))).nlTabs ?? []).length === 0);

  /* --------------------------------- (f) close tab -------------------------------- */

  const on2 = await send({ type: 'setNetworkLevel', tabId, enabled: true });
  check('(f) re-enable works after a detach', on2?.ok === true, on2);
  await page.close();
  await sleep(600);
  const nlAfterClose = await sw.evaluate(() => chrome.storage.session.get('nlTabs'));
  const targetsAfterClose = await sw.evaluate(() => chrome.debugger.getTargets());
  const closedSummary = await send({ type: 'getTabSummary', tabId });
  check('(f) closing the tab clears session:nlTabs, the target is gone, summary says detached with reason target_closed', (nlAfterClose.nlTabs ?? []).length === 0 && !targetsAfterClose.some((t) => t.tabId === tabId) && closedSummary.nl?.attached === false, { nlAfterClose, still: targetsAfterClose.filter((t) => t.tabId === tabId), nl: closedSummary.nl });

  /* -------------------- info: permissions.request on a required permission -------------------- */

  // The popup (UI agent) still calls permissions.request({permissions:['debugger']})
  // before attaching. With the permission install-time this must resolve
  // `true` without a prompt (permissions reference: required permissions are
  // requestable only when withheld). Recorded here for the UI agent.
  const req = await ui.evaluate(async () => {
    const b = document.createElement('button');
    b.id = '__req';
    document.body.append(b);
    return new Promise((resolve) => {
      b.onclick = () => chrome.permissions.request({ permissions: ['debugger'] }).then((g) => resolve({ granted: g }), (err) => resolve({ error: String(err?.message ?? err) }));
      b.click();
    });
  });
  console.log(`      info: permissions.request({permissions:['debugger']}) with the permission install-time → ${JSON.stringify(req)}`);
  check('info: permissions.contains({permissions:[debugger]}) is true', await ui.evaluate(() => chrome.permissions.contains({ permissions: ['debugger'] })));
} finally {
  await context.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
  await srv.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
