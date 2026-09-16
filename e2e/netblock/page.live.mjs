// Live test of the netblock page engine (Chromium via Playwright, offline).
// Run:  npm run e2e:netblock-page-live   (needs `npm run build:netblock` first)
//
// Method (modelled on e2e/netblock-spikes/chrome.spike.mjs): the BUILT
// extension is copied to a temp dir, loaded into a headed persistent Chromium,
// rules are saved through the real message router from an extension page, and
// the fixture page (e2e/netblock-spikes/server.mjs) is driven with
// page.evaluate(). The server journals every request, so "the page saw a 503"
// and "the server got the request" are checked independently — the page engine
// is NOT the network (design §6.2) and the test says so.
//
// ⚠️ GRANTING THE ORIGIN. The real flow is `permissions.request({origins})`
// from the popup under a user gesture, which opens a NATIVE browser prompt —
// verified here to hang under Playwright (the click is a gesture, the prompt
// cannot be pressed), and chrome://extensions' `developerPrivate.
// addHostPermission` is a no-op for optional hosts. So the TEST COPY of the
// manifest lists the fixture origin under `host_permissions`. From there on
// the code path is the production one: `permissions.getAll().origins` →
// `reconcileRegistration` → `registerContentScripts`. The shipped manifest is
// untouched (npm run guards checks it).
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { startServers } from '../netblock-spikes/server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILT = join(HERE, '..', '..', 'extensions', 'netblock', '.output', 'chrome-mv3');
const CHANNEL = process.env.SPIKE_CHANNEL || 'chromium';
const EXECUTABLE = process.env.SPIKE_EXECUTABLE || undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(join(BUILT, 'manifest.json'))) {
  console.error(`[page.live] no build at ${BUILT} — run \`npm run build:netblock\` first`);
  process.exit(2);
}

let pass = 0;
let fail = 0;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

const srv = await startServers();
const origin = srv.pageOrigin;

// Test copy with the fixture origin granted (see header).
const extDir = mkdtempSync(join(tmpdir(), 'netblock-live-ext-'));
cpSync(BUILT, extDir, { recursive: true });
const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = [`${origin}/*`];
writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest));

const userDataDir = mkdtempSync(join(tmpdir(), 'netblock-live-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : { channel: CHANNEL }),
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
  const extId = new URL(sw.url()).host;
  await sleep(800); // background init + first apply (registration)

  /* ------------------------------ registration ------------------------------ */

  const registered = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  const relay = registered.find((s) => s.id === 'netblock-relay');
  const main = registered.find((s) => s.id === 'netblock-page');
  check('both scripts registered on the granted origin only', !!relay && !!main && main.matches.length === 1 && main.matches[0] === `${origin}/*`, registered.map((s) => `${s.id}:${s.world}:${s.runAt}:${s.matches}`));
  check('MAIN script: world MAIN, document_start, allFrames, persistAcrossSessions', main?.world === 'MAIN' && main?.runAt === 'document_start' && main?.allFrames === true && main?.persistAcrossSessions === true);
  check('shipped manifest (test copy aside) has no content_scripts', !('content_scripts' in manifest));

  /* --------------------------------- rules --------------------------------- */

  // An extension page can talk to the background through the real router.
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${extId}/popup.html`);
  const send = (msg) => ui.evaluate((m) => chrome.runtime.sendMessage(m), msg);

  const rule = (id, over) => ({
    id,
    name: id,
    enabled: true,
    priority: 0,
    createdAt: 1,
    scope: 'all',
    countKey: 'rule+tab',
    resetOn: 'navigation',
    engine: 'auto',
    state: { kind: 'every' },
    action: { type: 'block' },
    ...over,
  });
  const url = (v) => ({ url: { op: 'contains', value: v }, resourceTypes: ['xhr'] });
  const rules = [
    rule('checkout', { condition: { ...url('/api/checkout'), methods: ['POST'] }, state: { kind: 'nth', n: 3 }, action: { type: 'status', code: 503, body: '{"error":"down"}', contentType: 'application/json' } }),
    rule('slow', { condition: url('/api/slow'), action: { type: 'delay', ms: 1500 } }),
    // A plain `block` is DNR's job (cheapest engine); pin `page` — the one
    // preference engine-select honours — to exercise the in-page block path.
    rule('blocked', { condition: url('/api/blocked'), action: { type: 'block' }, engine: 'page' }),
    // Response-status condition on the page engine. `block` here: since the
    // shipped build carries the debugger permission, `fail(reason)` on xhr is
    // the debugger engine's job (real error type, design §2.8) and would be
    // inactive on a tab without Network-level mode — see `nlFail` below.
    rule('real500', { condition: { ...url('/api/real500'), responseStatus: '5xx' }, action: { type: 'block' } }),
    rule('nlFail', { condition: url('/api/nlfail'), action: { type: 'fail', reason: 'InternetDisconnected' } }),
    rule('prob', { condition: url('/api/prob'), state: { kind: 'probability', percent: 50, seed: 42 }, action: { type: 'block' } }),
    rule('nav', { condition: url('/api/nav'), state: { kind: 'nth', n: 2 }, action: { type: 'status', code: 503, body: 'nav' } }),
    rule('xhr', { condition: url('/api/xhr'), action: { type: 'status', code: 503, body: '{"via":"xhr"}', contentType: 'application/json' } }),
  ];
  for (const r of rules) {
    const reply = await send({ type: 'saveRule', rule: r });
    if (!reply?.ok) console.log('saveRule failed', r.id, JSON.stringify(reply));
  }
  const listed = await send({ type: 'listRules' });
  const pageRules = listed.applied.compiled.filter((c) => c.engine === 'page').map((c) => c.rule.id);
  check('the seven xhr rules compile to the page engine (block pinned to page)', pageRules.length === 7 && !pageRules.includes('nlFail'), { pageRules, inactive: listed.applied.inactive.map((i) => `${i.rule.id}:${i.reason}`) });
  const nlFail = listed.applied.compiled.find((c) => c.rule.id === 'nlFail');
  check('fail(reason) on xhr goes to the debugger engine in this build (needsNetworkLevel), not page↓', nlFail?.engine === 'debugger' && nlFail?.degraded === undefined && nlFail?.reasons.includes('needsNetworkLevel'), nlFail);

  /* --------------------------------- page ---------------------------------- */

  const page = await context.newPage();
  await page.goto(`${origin}/page.html`);
  await sleep(600); // relay:ready round trip

  const injected = await page.evaluate(() => ({
    nonce: !!document.documentElement.getAttribute('data-blur-netblock-nonce'),
    fetchPatched: !/\[native code\]/.test(String(window.fetch)),
    xhrPatched: !/\[native code\]/.test(String(window.XMLHttpRequest)),
    flag: window.__blurNetblockPageEngine__ === true,
  }));
  check('injected at document_start: nonce attribute, fetch + XHR patched, guard flag', injected.nonce && injected.fetchPatched && injected.xhrPatched && injected.flag, injected);

  // (a) nth:3 on POST /api/checkout → 200, 200, 503 (page); server got all three.
  const jA = srv.journal.length;
  const a = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 3; i++) out.push(await window.__fetchStatus('/api/checkout', { method: 'POST', body: '{}' }));
    return out;
  });
  const serverCheckouts = srv.journal.slice(jA).filter((j) => j.method === 'POST' && j.path.startsWith('/api/checkout')).length;
  check('(a) nth:3 → page sees 200, 200, 503 with our body', a.map((x) => x.status).join(',') === '200,200,503' && a[2].text === '{"error":"down"}', a.map((x) => x.status));
  check('(a) honest: the server received all three (page engine ≠ network)', serverCheckouts === 3, { serverCheckouts });
  check('(a) synthetic response carries url + content-type + nosniff', await page.evaluate(async () => {
    const r = await fetch('/api/checkout', { method: 'POST' }); // 4th → passes (nth, not every)
    return r.status === 200 && r.headers.get('x-spike-server') === 'A';
  }));

  // (b) delay 1500 ms.
  const b = await page.evaluate(async () => {
    const t0 = performance.now();
    const r = await window.__fetchStatus('/api/slow');
    return { ms: performance.now() - t0, status: r.status };
  });
  check('(b) delay 1500 → measured ≥ 1400 ms, then the real 200', b.ms >= 1400 && b.status === 200, { ms: Math.round(b.ms) });

  // (c) block: fetch TypeError; XHR error event; nothing reaches the server.
  const jC = srv.journal.length;
  const c = await page.evaluate(async () => ({
    fetch: await window.__fetchStatus('/api/blocked'),
    xhr: await window.__xhrStatus('/api/blocked?x=1'),
    relative: await window.__fetchStatus(new Request('/api/blocked?req=1')),
  }));
  const serverBlocked = srv.journal.slice(jC).filter((j) => j.path.startsWith('/api/blocked')).length;
  check('(c) block on fetch → TypeError "Failed to fetch"', c.fetch.ok === false && c.fetch.error === 'TypeError' && /Failed to fetch/.test(c.fetch.message), c.fetch);
  check('(c) block on XHR → error event, status 0', c.xhr.ok === false && c.xhr.status === 0, c.xhr);
  check('(c) Request object input is matched too', c.relative.ok === false, c.relative);
  check('(c) blocked requests never reach the server', serverBlocked === 0, { serverBlocked });

  // (d) response-status condition: real 500 → substituted failure; real 200 untouched.
  const jD = srv.journal.length;
  const d = await page.evaluate(async () => ({
    r500: await window.__fetchStatus('/api/real500?status=500'),
    r200: await window.__fetchStatus('/api/real500?status=200'),
    x500: await window.__xhrStatus('/api/real500?status=500&xhr=1'),
    x200: await window.__xhrStatus('/api/real500?status=200&xhr=1'),
  }));
  const serverD = srv.journal.slice(jD).filter((j) => j.path.startsWith('/api/real500')).length;
  check('(d) fetch: real 500 → TypeError (block on a response-status condition)', d.r500.ok === false && d.r500.error === 'TypeError', d.r500);
  check('(d) fetch: real 200 passes with the real body', d.r200.ok === true && d.r200.status === 200 && /"status":200/.test(d.r200.text), d.r200);
  check('(d) XHR: real 500 → error event; real 200 → load', d.x500.ok === false && d.x200.ok === true && d.x200.status === 200, { x500: d.x500, x200: d.x200 });
  check('(d) every request went to the server exactly once', serverD === 4, { serverD });

  // XHR status substitution incl. responseType json.
  const x = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = {};
        const a = new XMLHttpRequest();
        a.open('GET', '/api/xhr');
        a.onreadystatechange = () => {
          if (a.readyState === 4) out.text = { status: a.status, body: a.responseText, ct: a.getResponseHeader('Content-Type'), all: a.getAllResponseHeaders() };
        };
        a.onload = () => {
          const b = new XMLHttpRequest();
          b.open('GET', '/api/xhr?json=1');
          b.responseType = 'json';
          b.onload = () => {
            out.json = { status: b.status, response: b.response };
            try {
              void b.responseText;
              out.json.responseTextThrew = false;
            } catch (e) {
              out.json.responseTextThrew = e.name;
            }
            resolve(out);
          };
          b.onerror = () => resolve({ ...out, jsonError: true });
          b.send();
        };
        a.onerror = () => resolve({ error: true });
        a.send();
      }),
  );
  check('XHR status: 503 + body + headers visible through the substituted getters', x.text?.status === 503 && x.text?.body === '{"via":"xhr"}' && /application\/json/.test(x.text?.ct ?? '') && /nosniff/.test(x.text?.all ?? ''), x.text);
  check('XHR responseType=json: `response` is the parsed object, responseText throws InvalidStateError', x.json?.status === 503 && x.json?.response?.via === 'xhr' && x.json?.responseTextThrew === 'InvalidStateError', x.json);

  // (e) probability with seed → same sequence across two reloads.
  const probRun = () =>
    page.evaluate(async () => {
      const out = [];
      for (let i = 0; i < 12; i++) out.push((await window.__fetchStatus('/api/prob?i=' + i)).ok);
      return out;
    });
  const e1 = await probRun();
  await page.reload();
  await sleep(600);
  const e2 = await probRun();
  check('(e) probability(50%, seed 42): identical sequence after a reload', e1.join('') === e2.join('') && e1.includes(true) && e1.includes(false), { e1: e1.map((v) => (v ? '.' : 'x')).join(''), e2: e2.map((v) => (v ? '.' : 'x')).join('') });

  // (f) resetOn: navigation — nth:2 restarts on reload.
  const navRun = () => page.evaluate(async () => [(await window.__fetchStatus('/api/nav')).status, (await window.__fetchStatus('/api/nav')).status]);
  const f1 = await navRun();
  await page.reload();
  await sleep(600);
  const f2 = await navRun();
  check('(f) resetOn: navigation — 200,503 before and again after reload', f1.join(',') === '200,503' && f2.join(',') === '200,503', { f1, f2 });

  /* ----------------------- background: log + counters ----------------------- */

  await sleep(500); // relay → background delivery
  const log = await send({ type: 'getLogPage', afterId: 0, limit: 500 });
  const pageRows = log.entries.filter((e) => e.engine === 'page');
  const marks = new Set(pageRows.flatMap((e) => e.marks));
  check('background log has ✱ (clientSide) rows from the page engine, type xhr', pageRows.length >= 8 && marks.size === 1 && marks.has('clientSide') && pageRows.every((e) => e.type === 'xhr'), { rows: pageRows.length, outcomes: [...new Set(pageRows.map((e) => e.outcome))] });
  const failedRow = pageRows.find((e) => e.ruleId === 'real500');
  check('log row for the response-status block is a blocked ✱ row', failedRow?.outcome === 'blocked', failedRow);

  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(u))?.id, origin);
  const summary = await send({ type: 'getTabSummary', tabId });
  const navStatus = summary.rules.find((r) => r.rule.id === 'nav');
  check('background counters mirror the page (nav rule: seen 2 / hits 1 for this tab, exact)', navStatus?.counter?.seen === 2 && navStatus?.counter?.hits === 1 && navStatus?.approx === false, navStatus?.counter);

  // Reset from the UI → the page mirror restarts (nth:2 fires on the 2nd again).
  await send({ type: 'resetCounters', ruleId: 'nav' });
  await sleep(300);
  const f3 = await navRun();
  check('resetCounters → page:reset reaches the mirror', f3.join(',') === '200,503', { f3 });

  // Pause → everything passes; resume → rules apply again.
  await send({ type: 'pauseTab', tabId, paused: true });
  await sleep(300);
  const paused = await page.evaluate(() => window.__fetchStatus('/api/blocked?paused=1'));
  await send({ type: 'pauseTab', tabId, paused: false });
  await sleep(300);
  const resumed = await page.evaluate(() => window.__fetchStatus('/api/blocked?paused=0'));
  check('pauseTab → requests pass; resume → blocked again', paused.ok === true && resumed.ok === false, { paused: paused.status, resumed: resumed.error });

  /* --------------------------- revoke → unregister -------------------------- */

  const removed = await sw.evaluate(async (o) => {
    try {
      return await chrome.permissions.remove({ origins: [`${o}/*`] });
    } catch (e) {
      return `err:${e.message}`;
    }
  }, origin);
  await sleep(500);
  const after = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  if (removed === true) check('permissions.remove → onRemoved → both scripts unregistered', after.length === 0, after.map((s) => s.id));
  else check('permissions.remove on a manifest host (test copy) is refused — unregister path covered by page.test.mjs', true, String(removed));
} finally {
  await context.close().catch(() => undefined);
  await srv.close();
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(extDir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
