// Chrome spikes for netblock (docs/design/netblock.md §12, Research §9):
//   S1  chrome.debugger.attach vs an OPEN DevTools window on the same tab
//   S3  latency of webRequest.onCompleted → updateSessionRules → next request
//   S4  does CDP Fetch see the WebSocket handshake? (and does DNR block it?)
//   S5  DNR `responseHeaders` + block: what the page and webRequest observe
//
// Method: the throwaway MV3 extension in ./ext-chrome is loaded into a headed
// persistent Chromium; the harness drives its service worker via sw.evaluate()
// and the fixture page via page.evaluate(). Everything is offline (server.mjs).
//
// CAVEAT recorded in the report: Playwright itself is a CDP client of this
// browser, so "another debugger is present" is true in every scenario here.
// The extension API still attaches fine under Playwright (perf e2e relies on
// that), and DevTools is opened as a REAL DevTools window, not a CDP session.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { startServers } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = join(HERE, 'ext-chrome');
const CHANNEL = process.env.SPIKE_CHANNEL || 'chromium'; // 'chrome' for the installed Google Chrome
// SPIKE_EXECUTABLE lets the spike run on any Chromium build (e.g. a newer
// Playwright cache dir than the installed @playwright/test expects). NOTE:
// branded Google Chrome >= 137 ignores --load-extension, so `channel: 'chrome'`
// cannot load the spike extension — use Chromium / Chrome for Testing.
const EXECUTABLE = process.env.SPIKE_EXECUTABLE || undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch({ devtools }) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'netblock-spike-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(EXECUTABLE ? { executablePath: EXECUTABLE } : { channel: CHANNEL }),
    headless: false,
    // Playwright's `devtools` option is deprecated and was observed NOT to open
    // DevTools on this build — pass the Chromium flag explicitly instead.
    args: [
      ...(devtools ? ['--auto-open-devtools-for-tabs'] : []),
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=DialMediaRouteProvider',
    ],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  await sleep(500);
  const version = context.browser()?.version?.() ?? '(persistent context: version via page)';
  return {
    context,
    sw,
    version,
    close: async () => {
      await context.close().catch(() => {});
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

// Proof that a REAL DevTools frontend is open: Target.getTargets over
// Playwright's CDP session lists devtools:// pages (chrome.debugger.getTargets
// hides them from extensions).
async function devtoolsFrontends(context, page) {
  const cdp = await context.newCDPSession(page);
  const t = await cdp.send('Target.getTargets');
  await cdp.detach().catch(() => {});
  return t.targetInfos.filter((x) => String(x.url).startsWith('devtools://')).length;
}

async function tabIdOf(sw, url) {
  return sw.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find((x) => x.url && x.url.startsWith(u));
    return t ? t.id : null;
  }, url);
}

const out = { channel: CHANNEL, when: new Date().toISOString(), spikes: {} };

// ---------------------------------------------------------------- S1
async function spikeDevTools(srv) {
  const res = {};
  // A) DevTools already open (auto-open for tabs), then attach.
  {
    const b = await launch({ devtools: true });
    const page = await b.context.newPage();
    await page.goto(`${srv.pageOrigin}/page.html`);
    await sleep(2500); // let the auto-opened DevTools settle
    const tabId = await tabIdOf(b.sw, srv.pageOrigin);
    await b.sw.evaluate(() => spikeReset());
    const attach = await b.sw.evaluate((id) => spikeAttach(id), tabId);
    let enable = null, fetched = null, state = null;
    if (attach.ok) {
      enable = await b.sw.evaluate((id) => spikeSend(id, 'Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }), tabId);
      fetched = await page.evaluate(() => window.__fetchStatus('/api/a?status=200'));
      await sleep(800);
      state = await b.sw.evaluate(() => spikeState());
      await b.sw.evaluate((id) => spikeDetach(id), tabId);
    }
    res.devtoolsOpenThenAttach = {
      devtoolsFrontendsOpen: await devtoolsFrontends(b.context, page),
      attach,
      fetchEnable: enable,
      pageFetch: fetched,
      pausedSeen: state ? state.paused.filter((p) => p.url.includes('/api/a')).length : null,
      detachEvents: state ? state.detach : null,
      userAgent: await page.evaluate(() => navigator.userAgent),
    };
    await b.close();
  }
  // B) Attach first, then try to open DevTools with the keyboard (F12 / Ctrl+Shift+I).
  {
    const b = await launch({ devtools: false });
    const page = await b.context.newPage();
    await page.goto(`${srv.pageOrigin}/page.html`);
    const tabId = await tabIdOf(b.sw, srv.pageOrigin);
    await b.sw.evaluate(() => spikeReset());
    const attach = await b.sw.evaluate((id) => spikeAttach(id), tabId);
    const enable = await b.sw.evaluate((id) => spikeSend(id, 'Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }), tabId);
    const before = await page.evaluate(() => window.__fetchStatus('/api/a?status=200'));
    await sleep(500);
    const pausedBefore = (await b.sw.evaluate(() => spikeState())).paused.length;
    await page.bringToFront();
    await page.keyboard.press('F12');
    await sleep(1500);
    await page.keyboard.press('Control+Shift+I');
    await sleep(2500);
    const after = await page.evaluate(() => window.__fetchStatus('/api/a?status=200&second=1'));
    await sleep(800);
    const state = await b.sw.evaluate(() => spikeState());
    const targets = await b.sw.evaluate(() => spikeTargets());
    const stillAttached = targets.find((t) => t.tabId === tabId)?.attached ?? null;
    const evalAfter = await b.sw.evaluate((id) => spikeSend(id, 'Runtime.evaluate', { expression: '1+1' }), tabId);
    await b.sw.evaluate((id) => spikeDetach(id), tabId);
    res.attachThenKeyboardDevTools = {
      attach, fetchEnable: enable, pageFetchBefore: before, pausedBefore,
      pageFetchAfter: after, pausedAfter: state.paused.length,
      detachEvents: state.detach, stillAttachedPerGetTargets: stillAttached, sendCommandAfter: evalAfter,
      note: 'Keyboard-opened DevTools is best-effort: Playwright key events go to the renderer; whether the browser UI honours F12 is part of the finding.',
    };
    await b.close();
  }
  return res;
}

// ---------------------------------------------------------------- S4
async function spikeWebSocket(srv) {
  const b = await launch({ devtools: false });
  const page = await b.context.newPage();
  await page.goto(`${srv.pageOrigin}/page.html`);
  const tabId = await tabIdOf(b.sw, srv.pageOrigin);
  await b.sw.evaluate(() => spikeReset());
  const attach = await b.sw.evaluate((id) => spikeAttach(id), tabId);
  const enable = await b.sw.evaluate((id) => spikeSend(id, 'Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }, { urlPattern: '*', requestStage: 'Response' }] }), tabId);
  const jBefore = srv.journal.length;
  const ws = await page.evaluate((u) => window.__ws(u), srv.wsUrl);
  await sleep(800);
  const state = await b.sw.evaluate(() => spikeState());
  const wsPaused = state.paused.filter((p) => p.url.includes('/ws'));
  const upgradeSeen = srv.journal.slice(jBefore).some((j) => j.method === 'UPGRADE');
  await b.sw.evaluate((id) => spikeDetach(id), tabId);
  // DNR: block resourceType websocket.
  await b.sw.evaluate(() => spikeClearRules());
  await b.sw.evaluate(async (id) => {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{ id: 901, priority: 1, action: { type: 'block' }, condition: { urlFilter: '/ws', resourceTypes: ['websocket'], tabIds: [id] } }],
    });
  }, tabId);
  const jBefore2 = srv.journal.length;
  const wsDnr = await page.evaluate((u) => window.__ws(u), srv.wsUrl);
  await sleep(500);
  const upgradeSeen2 = srv.journal.slice(jBefore2).some((j) => j.method === 'UPGRADE');
  const errs = (await b.sw.evaluate(() => spikeState())).errors;
  await b.close();
  return {
    attach, fetchEnable: enable,
    cdpFetch: { pageResult: ws, requestPausedForWs: wsPaused, handshakeReachedServer: upgradeSeen },
    dnrBlockWebsocket: { pageResult: wsDnr, handshakeReachedServer: upgradeSeen2, webRequestErrors: errs.filter((e) => e.where === 'onErrorOccurred') },
  };
}

// ---------------------------------------------------------------- S3
async function spikeLatency(srv) {
  const b = await launch({ devtools: false });
  const page = await b.context.newPage();
  await page.goto(`${srv.pageOrigin}/page.html`);
  const tabId = await tabIdOf(b.sw, srv.pageOrigin);
  const delays = [0, 1, 5, 10, 20, 50, 100, 200];
  const TRIALS = 5;
  const trials = [];
  let n = 0;
  for (const d of delays) {
    for (let i = 0; i < TRIALS; i++) {
      n++;
      await b.sw.evaluate(() => spikeClearRules());
      await b.sw.evaluate(() => spikeReset());
      await b.sw.evaluate((args) => spikeArm(args.tabId, 1000 + args.n, args.n), { tabId, n });
      const jBefore = srv.journal.length;
      const r = await page.evaluate(async (dd) => {
        const a = await window.__fetchStatus('/api/a?status=200&t=' + Date.now());
        const tA = performance.now();
        if (dd > 0) await new Promise((res) => setTimeout(res, dd));
        const tB0 = performance.now();
        const bres = await window.__fetchStatus('/api/b?t=' + Date.now());
        return { a: a.status, b: bres, gapMs: tB0 - tA };
      }, d);
      await sleep(300);
      const st = await b.sw.evaluate(() => spikeState());
      const lat = st.latency[0] ? st.latency[0].tApplied - st.latency[0].tEvent : null;
      const bReachedServer = srv.journal.slice(jBefore).some((j) => j.path.startsWith('/api/b'));
      trials.push({
        delayMs: d,
        blocked: r.b.ok === false,
        bReachedServer,
        pageGapMs: Number(r.gapMs.toFixed(2)),
        swUpdateSessionRulesMs: lat === null ? null : Number(lat.toFixed(2)),
        onCompletedSeen: st.completed.length,
        error: r.b.ok === false ? r.b.error + ': ' + r.b.message : null,
      });
    }
  }
  await b.close();
  const summary = delays.map((d) => {
    const ts = trials.filter((t) => t.delayMs === d);
    return {
      delayMs: d,
      blocked: `${ts.filter((t) => t.blocked).length}/${ts.length}`,
      updateSessionRulesMs: ts.map((t) => t.swUpdateSessionRulesMs).filter((x) => x !== null),
    };
  });
  return { trials, summary };
}

// ---------------------------------------------------------------- S5
async function spikeResponseHeadersBlock(srv) {
  const b = await launch({ devtools: false });
  const page = await b.context.newPage();
  await page.goto(`${srv.pageOrigin}/page.html`);
  const tabId = await tabIdOf(b.sw, srv.pageOrigin);
  await b.sw.evaluate(() => spikeClearRules());
  await b.sw.evaluate(() => spikeReset());
  const keys = await b.sw.evaluate(() => chrome.declarativeNetRequest.RuleConditionKeys ?? null);
  const add = await b.sw.evaluate(async (id) => {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [{ id: 950, priority: 1, action: { type: 'block' }, condition: { urlFilter: '/api/c', responseHeaders: [{ header: 'x-spike-server' }], tabIds: [id] } }],
      });
      return { ok: true };
    } catch (e) { return { ok: false, message: String(e?.message ?? e) }; }
  }, tabId);
  const jBefore = srv.journal.length;
  const fetched = await page.evaluate(() => window.__fetchStatus('/api/c?status=200'));
  const xhr = await page.evaluate(() => window.__xhrStatus('/api/c?status=200&x=1'));
  await sleep(500);
  const reached = srv.journal.slice(jBefore).filter((j) => j.path.startsWith('/api/c')).length;
  const st = await b.sw.evaluate(() => spikeState());
  await b.close();
  return { ruleConditionKeys: keys, addRule: add, pageFetch: fetched, pageXhr: xhr, requestsReachedServer: reached, webRequestErrors: st.errors };
}


// ---------------------------------------------------------------- S1-C / S3-b (extra)
// S1-C: attach FIRST (in tabs.onCreated, before the document commits), then let
// --auto-open-devtools-for-tabs open a real DevTools window for that tab.
async function spikeAttachThenDevTools(srv) {
  const b = await launch({ devtools: true });
  const tabId = await b.sw.evaluate(async (url) => {
    const p = new Promise((resolve) => {
      chrome.tabs.onCreated.addListener(async function once(tab) {
        chrome.tabs.onCreated.removeListener(once);
        const r = await spikeAttach(tab.id);
        resolve({ tabId: tab.id, attach: r });
      });
    });
    await chrome.tabs.create({ url });
    return p;
  }, `${srv.pageOrigin}/page.html?attachfirst=1`);
  await sleep(4000); // page load + DevTools auto-open
  const page = b.context.pages().find((pg) => pg.url().includes('attachfirst=1'));
  const enable = await b.sw.evaluate((id) => spikeSend(id, 'Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }), tabId.tabId);
  const fetched = page ? await page.evaluate(() => window.__fetchStatus('/api/a?status=200&attachfirst=1')) : null;
  await sleep(800);
  const state = await b.sw.evaluate(() => spikeState());
  const targets = await b.sw.evaluate(() => spikeTargets());
  const devtoolsTargets = targets.filter((t) => String(t.url).startsWith('devtools://')).map((t) => ({ type: t.type, url: t.url.slice(0, 60), attached: t.attached }));
  const still = targets.find((t) => t.tabId === tabId.tabId)?.attached ?? null;
  const frontends = page ? await devtoolsFrontends(b.context, page) : null;
  await b.sw.evaluate((id) => spikeDetach(id), tabId.tabId);
  await b.close();
  return { attachInOnCreated: tabId.attach, devtoolsFrontendsOpen: frontends, fetchEnableAfterDevTools: enable, pageFetch: fetched, pausedSeen: state.paused.filter((p) => p.url.includes('attachfirst')).length, detachEvents: state.detach, stillAttachedPerGetTargets: still, devtoolsTargetsSeen: devtoolsTargets };
}

// S3-b: /api/a and /api/b fired CONCURRENTLY — by construction the reactive
// rule cannot catch b; this pins the boundary of the approach.
async function spikeLatencyParallel(srv) {
  const b = await launch({ devtools: false });
  const page = await b.context.newPage();
  await page.goto(`${srv.pageOrigin}/page.html`);
  const tabId = await tabIdOf(b.sw, srv.pageOrigin);
  const trials = [];
  for (let i = 0; i < 5; i++) {
    await b.sw.evaluate(() => spikeClearRules());
    await b.sw.evaluate(() => spikeReset());
    await b.sw.evaluate((args) => spikeArm(args.tabId, 2000 + args.i, args.i), { tabId, i });
    const r = await page.evaluate(async () => {
      const [a, bb] = await Promise.all([window.__fetchStatus('/api/a?status=200&par=1'), window.__fetchStatus('/api/b?par=1')]);
      return { a: a.status, b: bb };
    });
    trials.push({ blocked: r.b.ok === false });
  }
  // Also: /b fired right after /a's HEADERS (not body) — the tightest sequential case.
  const headersTrials = [];
  for (let i = 0; i < 5; i++) {
    await b.sw.evaluate(() => spikeClearRules());
    await b.sw.evaluate(() => spikeReset());
    await b.sw.evaluate((args) => spikeArm(args.tabId, 2100 + args.i, args.i), { tabId, i });
    const r = await page.evaluate(async () => {
      const ra = await fetch('/api/a?status=200&hdr=1'); // resolves at headers
      const bb = await window.__fetchStatus('/api/b?hdr=1');
      await ra.text();
      return { b: bb };
    });
    headersTrials.push({ blocked: r.b.ok === false });
  }
  await b.close();
  return {
    concurrent: `${trials.filter((t) => t.blocked).length}/${trials.length} blocked`,
    bAfterAHeadersOnly: `${headersTrials.filter((t) => t.blocked).length}/${headersTrials.length} blocked`,
  };
}


// ---------------------------------------------------------------- S6
// The shipping @blur/netcore `attachCdp` (bundled by esbuild into the spike
// extension) against the real chrome.debugger: attach, events, detach by the
// browser (tab closed → `target_closed`), idempotent detach().
async function spikeNetcore(srv) {
  const b = await launch({ devtools: false });
  const page = await b.context.newPage();
  await page.goto(`${srv.pageOrigin}/page.html`);
  const tabId = await tabIdOf(b.sw, srv.pageOrigin);
  const attach = await b.sw.evaluate((id) => spikeNetcore(id), tabId);
  await page.evaluate(() => window.__fetchStatus('/api/a?status=200&netcore=1'));
  await sleep(500);
  const mid = await b.sw.evaluate(() => spikeNetcoreState());
  await page.close();
  await sleep(1000);
  const afterClose = await b.sw.evaluate(() => spikeNetcoreState());
  const detachNoop = await b.sw.evaluate(() => spikeNetcoreDetach());
  // Attach again to a fresh tab and detach ourselves.
  const page2 = await b.context.newPage();
  await page2.goto(`${srv.pageOrigin}/page.html?two=1`);
  const tabId2 = await tabIdOf(b.sw, `${srv.pageOrigin}/page.html?two=1`);
  const attach2 = await b.sw.evaluate((id) => spikeNetcore(id), tabId2);
  const attachedAfterOwnDetach = await b.sw.evaluate(() => spikeNetcoreDetach());
  const st2 = await b.sw.evaluate(() => spikeNetcoreState());
  await b.close();
  return { attach, eventsSeen: mid.events.filter((u) => u.includes('netcore=1')).length, attachedMid: mid.attached, afterTabClose: afterClose, detachAfterBrowserDetachIsNoop: detachNoop === false, attach2, attachedAfterOwnDetach, detachReasonAfterOwnDetach: st2.detachReason };
}

const srv = await startServers();
try {
  console.log('[spike] channel', CHANNEL);
  if (process.env.SPIKE_ONLY === 's1') {
    out.spikes.S1_devtools = await spikeDevTools(srv);
    out.spikes.S1c_attachThenDevTools = await spikeAttachThenDevTools(srv);
    console.log('[spike] S1 + S1c done');
    throw Object.assign(new Error('extra-only'), { extraOnly: true });
  }
  if (process.env.SPIKE_ONLY === 'netcore') {
    out.spikes.S6_netcore = await spikeNetcore(srv);
    console.log('[spike] S6 done');
    throw Object.assign(new Error('extra-only'), { extraOnly: true });
  }
  if (process.env.SPIKE_ONLY === 'extra') {
    out.spikes.S1c_attachThenDevTools = await spikeAttachThenDevTools(srv);
    console.log('[spike] S1c done');
    out.spikes.S3b_latencyParallel = await spikeLatencyParallel(srv);
    console.log('[spike] S3b done');
    throw Object.assign(new Error('extra-only'), { extraOnly: true });
  }
  out.spikes.S1_devtools = await spikeDevTools(srv);
  console.log('[spike] S1 done');
  out.spikes.S4_websocket = await spikeWebSocket(srv);
  console.log('[spike] S4 done');
  out.spikes.S5_responseHeadersBlock = await spikeResponseHeadersBlock(srv);
  console.log('[spike] S5 done');
  out.spikes.S3_latency = await spikeLatency(srv);
  console.log('[spike] S3 done');
} catch (e) {
  if (!e.extraOnly) throw e;
} finally {
  // Write BEFORE closing the fixture server: nothing after this may hang.
  const file = join(HERE, `results-chrome-${CHANNEL}${process.env.SPIKE_ONLY ? '-' + process.env.SPIKE_ONLY : ''}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('[spike] wrote', file);
  await srv.close();
}
console.log(JSON.stringify({ ...out, spikes: { ...out.spikes, S3_latency: out.spikes.S3_latency?.summary } }, null, 2));
process.exit(0);
