// Logic-level tests (Node, no browser) for the Chrome `debugger` engine of
// extensions/netblock: the pure pattern derivation / stage selection / action
// → CDP mapping / watchdog / error-counter pipeline (utils/debugger-eval.ts)
// and the engine glue (utils/engines/debugger.ts) against a FAKE
// `chrome.debugger` (the `DebuggerApi` shape `@blur/netcore` `attachCdp`
// expects). Same loader as logic.test.mjs — the REAL .ts sources are imported.
// Run:  npm run e2e:netblock-debugger
import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const netcoreIndex = pathToFileURL(resolve(repoRoot, 'packages/netcore/src/index.ts')).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@blur/netcore') return { url: netcoreIndex, shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
        return next(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

const U = (p) => resolve(repoRoot, 'extensions/netblock/utils', p);
const load = (p) => import(pathToFileURL(U(p)).href);

const { defaultRule } = await load('rule-types.ts');
const { compileRules, CHROME_DEFAULT_CAPS } = await load('engine-select.ts');
const { emptySnapshot } = await load('state.ts');
const {
  fetchPatternsFor,
  urlPatternFor,
  stageOfRule,
  stageOfEvent,
  patternsCover,
  cdpGlobMatches,
  ruleMatches,
  commandFor,
  fulfillHeaders,
  toBase64,
  evaluatePaused,
  stalled,
  nextErrorCount,
  WATCHDOG_STALL_MS,
  MAX_CONSECUTIVE_ERRORS,
  FETCH_FILTER_TYPES,
} = await load('debugger-eval.ts');
const { createDebuggerEngine, asDebuggerEngine, HANDLER_ERRORS_REASON } = await load('engines/debugger.ts');
const { createEngines } = await load('engines/index.ts');

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}\n       ${e.stack ?? e.message}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------- fixtures -------------------------------- */

const NL = { ...CHROME_DEFAULT_CAPS, dnrResponseHeaders: true, debugger: true };
let seq = 0;
function rule(over = {}) {
  const r = defaultRule(over.id ?? `r${++seq}`, 1000 + seq);
  r.name = over.id ?? r.id;
  r.condition = { url: { op: 'contains', value: '/api/' }, resourceTypes: ['image'] };
  r.action = { type: 'fail', reason: 'TimedOut' };
  return { ...r, ...over, condition: { ...r.condition, ...(over.condition ?? {}) } };
}
/** Compile for Chrome with the shipped caps and return the debugger slice. */
function compiled(...rules) {
  return compileRules(rules, [], 'chrome', NL, 0).byEngine.debugger;
}
let reqSeq = 0;
function paused(over = {}) {
  return {
    requestId: `interception-job-${++reqSeq}`,
    request: { url: 'https://shop.example.com/api/checkout?x=1', method: 'GET', headers: { Origin: 'https://shop.example.com' } },
    frameId: 'F1',
    resourceType: 'Image',
    ...over,
  };
}
const ctx = (over = {}) => ({ now: 1_000, tabId: 7, tabHost: 'shop.example.com', paused: false, isActiveTab: true, ...over });

/**
 * Fake `chrome.debugger`: records commands, lets a test emit CDP events and
 * browser-side detaches, and can reject commands on demand.
 */
function fakeDebugger() {
  const eventListeners = new Set();
  const detachListeners = new Set();
  const api = {
    commands: [],
    attached: new Set(),
    attachError: null,
    rejectNext: null,
    async attach({ tabId }) {
      if (api.attachError) throw { message: api.attachError };
      api.attached.add(tabId);
    },
    async detach({ tabId }) {
      api.attached.delete(tabId);
    },
    async sendCommand({ tabId }, method, params) {
      api.commands.push({ tabId, method, params });
      if (api.rejectNext && api.rejectNext(method, params)) throw { message: `rejected ${method}` };
      return {};
    },
    onEvent: { addListener: (cb) => eventListeners.add(cb), removeListener: (cb) => eventListeners.delete(cb) },
    onDetach: { addListener: (cb) => detachListeners.add(cb), removeListener: (cb) => detachListeners.delete(cb) },
    emit(tabId, method, params) {
      for (const cb of [...eventListeners]) cb({ tabId }, method, params);
    },
    browserDetach(tabId, reason) {
      api.attached.delete(tabId);
      for (const cb of [...detachListeners]) cb({ tabId }, reason);
    },
    of(method) {
      return api.commands.filter((c) => c.method === method);
    },
  };
  return api;
}

function fakeTabs() {
  const activated = new Set();
  const updated = new Set();
  return {
    urls: { 7: 'https://shop.example.com/cart', 8: 'https://other.test/' },
    async get(tabId) {
      return { url: this.urls[tabId], active: true, windowId: 1 };
    },
    async query() {
      return [{ id: 7, windowId: 1 }];
    },
    onActivated: { addListener: (cb) => activated.add(cb) },
    onUpdated: { addListener: (cb) => updated.add(cb) },
    fireUpdated(tabId, info) {
      for (const cb of updated) cb(tabId, info);
    },
  };
}

function harness({ sticky = false, storeDelay = 0 } = {}) {
  const api = fakeDebugger();
  const tabs = fakeTabs();
  let snap = emptySnapshot();
  let nl = [];
  const events = [];
  const engine = createDebuggerEngine(NL, true);
  engine.onEvent((e) => events.push(e));
  engine.configure({
    api,
    tabs,
    state: {
      read: async () => {
        if (storeDelay) await sleep(storeDelay);
        return snap;
      },
      write: async (mutate) => (snap = mutate(snap)),
    },
    nlTabs: { get: async () => nl, set: async (ids) => void (nl = ids) },
    prefs: async () => ({ nlSticky: sticky }),
    isPaused: () => false,
  });
  return {
    api,
    tabs,
    engine,
    events,
    get nl() {
      return nl;
    },
    get snap() {
      return snap;
    },
    logs: () => events.filter((e) => e.type === 'log').map((e) => e.entry),
    settle: () => sleep(20),
  };
}

/* ------------------------------ pure: patterns ------------------------------ */
console.log('debugger-eval: patterns');

await check('urlPatternFor: narrow only when case-sensitive or letter-free; regex/none → *', () => {
  assert.equal(urlPatternFor(undefined), '*');
  assert.equal(urlPatternFor({ op: 'regex', value: 'a.c' }), '*');
  assert.equal(urlPatternFor({ op: 'contains', value: '/api/' }), '*', 'case-insensitive letters → *');
  assert.equal(urlPatternFor({ op: 'contains', value: '/api/', caseSensitive: true }), '*/api/*');
  assert.equal(urlPatternFor({ op: 'contains', value: '/123?' }), '*/123\\?*', 'letter-free: narrowed, ? escaped');
  assert.equal(urlPatternFor({ op: 'equals', value: 'https://a.b/x*y', caseSensitive: true }), 'https://a.b/x\\*y');
  assert.equal(urlPatternFor({ op: 'wildcard', value: '*.png', caseSensitive: true }), '*.png');
  assert.equal(urlPatternFor({ op: 'wildcard', value: 'C:\\x*', caseSensitive: true }), 'C:\\\\x*');
});

await check('fetchPatternsFor: one per type × stage, deduplicated; xhr fans out to XHR/Fetch/EventSource (Preflight is not a filter type)', () => {
  const p = fetchPatternsFor(compiled(
    rule({ condition: { resourceTypes: ['image'] } }),
    rule({ condition: { resourceTypes: ['image'] }, action: { type: 'delay', ms: 5 } }), // dup
    rule({ condition: { resourceTypes: ['xhr'] }, action: { type: 'fail', reason: 'Failed' } }),
    rule({ condition: { resourceTypes: ['script'], responseStatus: '5xx' } }),
  ));
  assert.deepEqual(p.filter((x) => x.requestStage === 'Request').map((x) => x.resourceType).sort(), ['EventSource', 'Fetch', 'Image', 'XHR']);
  assert.deepEqual(p.filter((x) => x.requestStage === 'Response'), [{ urlPattern: '*', resourceType: 'Script', requestStage: 'Response' }]);
  assert.equal(p.length, 5);
  // Types the filter refuses (live probe) never reach Fetch.enable; a kind that maps only to them yields no pattern.
  const media = fetchPatternsFor(compiled(rule({ condition: { resourceTypes: ['media', 'websocket'] } })));
  assert.deepEqual(media.map((x) => x.resourceType), ['Media']);
  for (const t of ['TextTrack', 'Prefetch', 'WebSocket', 'Manifest', 'SignedExchange', 'Preflight', 'FedCM']) assert.equal(FETCH_FILTER_TYPES.has(t), false, t);
  // No type restriction → no resourceType key at all (CDP: any type).
  const any = fetchPatternsFor(compiled(rule({ condition: { url: { op: 'contains', value: 'x' }, resourceTypes: [] }, action: { type: 'fail', reason: 'Failed' } })));
  assert.deepEqual(any, [{ urlPattern: '*', requestStage: 'Request' }]);
  assert.deepEqual(fetchPatternsFor([]), []);
});

await check('stage: rule stage from response conditions; event stage from responseStatusCode/responseErrorReason', () => {
  assert.equal(stageOfRule(rule()), 'Request');
  assert.equal(stageOfRule(rule({ condition: { responseStatus: '503' } })), 'Response');
  assert.equal(stageOfRule(rule({ condition: { responseHeaders: [{ name: 'x', op: 'exists' }] } })), 'Response');
  assert.equal(stageOfEvent(paused()), 'Request');
  assert.equal(stageOfEvent(paused({ responseStatusCode: 200 })), 'Response');
  assert.equal(stageOfEvent(paused({ responseErrorReason: 'Failed' })), 'Response');
});

await check('cdpGlobMatches / patternsCover: CDP glob semantics with escapes, case-sensitive', () => {
  assert.equal(cdpGlobMatches('*/api/*', 'https://a/api/x'), true);
  assert.equal(cdpGlobMatches('*/API/*', 'https://a/api/x'), false);
  assert.equal(cdpGlobMatches('*/123\\?*', 'https://a/123?y'), true);
  assert.equal(cdpGlobMatches('*/123\\?*', 'https://a/123x'), false);
  assert.equal(cdpGlobMatches('https://a/?', 'https://a/b'), true);
  const pats = [{ urlPattern: '*', resourceType: 'Script', requestStage: 'Response' }];
  assert.equal(patternsCover(pats, paused({ resourceType: 'Script' }), 'Response'), true);
  assert.equal(patternsCover(pats, paused({ resourceType: 'Image' }), 'Response'), false);
  assert.equal(patternsCover(pats, paused({ resourceType: 'Script' }), 'Request'), false);
});

/* ------------------------------ pure: matching ------------------------------ */
console.log('debugger-eval: matching + actions');

await check('ruleMatches: url/method/type/pageDomains/activeTab at Request; status + headers at Response', () => {
  const r = rule({ scope: 'activeTab', condition: { methods: ['GET'], pageDomains: ['example.com'] } });
  assert.equal(ruleMatches(r, paused(), 'Request', ctx()), true);
  assert.equal(ruleMatches(r, paused({ request: { url: 'https://x/other', method: 'GET' } }), 'Request', ctx()), false, 'url');
  assert.equal(ruleMatches(r, paused({ request: { url: 'https://x/api/', method: 'POST' } }), 'Request', ctx()), false, 'method');
  assert.equal(ruleMatches(r, paused({ resourceType: 'Script' }), 'Request', ctx()), false, 'type');
  assert.equal(ruleMatches(r, paused(), 'Request', ctx({ tabHost: 'evil.test' })), false, 'pageDomains');
  assert.equal(ruleMatches(r, paused(), 'Request', ctx({ tabHost: '' })), false, 'unknown host never matches a domain condition');
  assert.equal(ruleMatches(r, paused(), 'Request', ctx({ isActiveTab: false })), false, 'activeTab scope');
  const rs = rule({ condition: { responseStatus: '5xx', responseHeaders: [{ name: 'X-Err', op: 'contains', value: 'DOWN' }] } });
  assert.equal(ruleMatches(rs, paused(), 'Request', ctx()), false, 'response rule is silent at Request stage');
  const ev = paused({ responseStatusCode: 503, responseHeaders: [{ name: 'x-err', value: 'service down' }] });
  assert.equal(ruleMatches(rs, ev, 'Response', ctx()), true);
  assert.equal(ruleMatches(rs, paused({ responseStatusCode: 200, responseHeaders: ev.responseHeaders }), 'Response', ctx()), false, 'status');
  assert.equal(ruleMatches(rs, paused({ responseStatusCode: 503 }), 'Response', ctx()), false, 'header missing');
});

await check('commandFor: block → BlockedByClient; fail → reason verbatim; delay → continue after ms; status → fulfill with nosniff/CT/CORS + base64 body', () => {
  const p = paused();
  assert.deepEqual(commandFor({ type: 'block' }, p).command, { method: 'Fetch.failRequest', params: { requestId: p.requestId, errorReason: 'BlockedByClient' } });
  assert.deepEqual(commandFor({ type: 'fail', reason: 'InternetDisconnected' }, p).command.params.errorReason, 'InternetDisconnected');
  const d = commandFor({ type: 'delay', ms: 1200 }, p);
  assert.equal(d.delayMs, 1200);
  assert.equal(d.command.method, 'Fetch.continueRequest');
  const s = commandFor({ type: 'status', code: 503, body: '{"error":"down"}', contentType: 'application/json' }, p);
  assert.equal(s.command.method, 'Fetch.fulfillRequest');
  assert.equal(s.command.params.responseCode, 503);
  assert.equal(s.command.params.body, Buffer.from('{"error":"down"}').toString('base64'));
  const h = Object.fromEntries(s.command.params.responseHeaders.map((x) => [x.name, x.value]));
  assert.equal(h['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['Cache-Control'], 'no-store');
  assert.equal(h['Content-Security-Policy'], 'sandbox', 'a fulfilled navigation renders the user body script-less and origin-less (design §7.1)');
  assert.equal(h['Access-Control-Allow-Origin'], 'https://shop.example.com', 'echoes the request Origin so the page sees OUR status, not a CORS error');
  // No Origin header → no CORS headers; no body → no `body` key; text/html gets nosniff too.
  const s2 = commandFor({ type: 'status', code: 500, contentType: 'text/html', body: '<b>x</b>' }, paused({ request: { url: 'https://a/api/', method: 'GET' } }));
  assert.equal(s2.command.params.responseHeaders.some((x) => x.name === 'Access-Control-Allow-Origin'), false);
  assert.ok(s2.command.params.responseHeaders.some((x) => x.name === 'Content-Security-Policy' && x.value === 'sandbox'), 'text/html document bodies are sandboxed');
  assert.equal(fulfillHeaders({ type: 'status', code: 500 }, undefined)[0].value, 'text/plain; charset=utf-8');
  assert.equal('body' in commandFor({ type: 'status', code: 204 }, p).command.params, false);
  assert.equal(toBase64('héllo'), Buffer.from('héllo', 'utf8').toString('base64'));
});

await check('evaluatePaused: priority within a stage; transparent non-applied rules count; paused tab and preflight are skipped', () => {
  const a = rule({ id: 'a', state: { kind: 'nth', n: 2 } });
  const b = rule({ id: 'b', action: { type: 'fail', reason: 'Failed' }, priority: 1 });
  const list = compiled(a, b);
  let snap = emptySnapshot();
  const r1 = evaluatePaused(paused(), list, snap, ctx());
  assert.equal(r1.kind, 'apply');
  assert.equal(r1.rule.rule.id, 'b', 'a matched but did not apply (nth 2) → b wins');
  assert.equal(r1.command.params.errorReason, 'Failed');
  assert.equal(r1.deltas.length, 2);
  snap = r1.next;
  const r2 = evaluatePaused(paused(), list, snap, ctx());
  assert.equal(r2.rule.rule.id, 'a', 'second match: a applies');
  assert.equal(r2.command.params.errorReason, 'TimedOut');
  assert.equal(evaluatePaused(paused(), list, snap, ctx({ paused: true })).kind, 'skip');
  assert.equal(evaluatePaused(paused({ resourceType: 'Preflight' }), compiled(rule({ condition: { resourceTypes: ['xhr'] } })), snap, ctx()).reason, 'preflight');
  const none = evaluatePaused(paused({ resourceType: 'Font' }), list, snap, ctx());
  assert.equal(none.kind, 'pass');
  assert.equal(none.deltas.length, 0);
});

/* --------------------------- pure: watchdog + errors --------------------------- */
console.log('debugger-eval: watchdog + error counter');

await check('stalled: handler > 20 s → release; in-progress delay (until in the future) is not a stall; lost delay timer is', () => {
  const now = 100_000;
  const items = [
    { tabId: 1, requestId: 'fresh', at: now - 1_000 },
    { tabId: 1, requestId: 'stuck', at: now - WATCHDOG_STALL_MS - 1 },
    { tabId: 1, requestId: 'delay-running', at: now - 30_000, until: now + 25_000 },
    { tabId: 1, requestId: 'delay-lost', at: now - 60_000, until: now - WATCHDOG_STALL_MS - 1 },
  ];
  assert.deepEqual(stalled(items, now).map((p) => p.requestId), ['stuck', 'delay-lost']);
});

await check('nextErrorCount: resets on success, detaches at 3 consecutive failures', () => {
  assert.deepEqual(nextErrorCount(0, false), { count: 1, detach: false });
  assert.deepEqual(nextErrorCount(1, false), { count: 2, detach: false });
  assert.deepEqual(nextErrorCount(2, true), { count: 0, detach: false });
  assert.deepEqual(nextErrorCount(2, false), { count: 3, detach: true });
  assert.equal(MAX_CONSECUTIVE_ERRORS, 3);
});

/* ------------------------------- engine glue ------------------------------- */
console.log('engines/debugger.ts (fake CDP)');

await check('createEngines: available follows the detected API; asDebuggerEngine finds it / no-op elsewhere', async () => {
  const on = createEngines('chrome', NL, { declarativeNetRequest: true, scripting: true, debugger: true, webRequestBlocking: false });
  assert.equal(asDebuggerEngine(on).available, true);
  const off = createEngines('chrome', { ...NL, debugger: false }, { declarativeNetRequest: true, scripting: true, debugger: false, webRequestBlocking: false });
  assert.equal(asDebuggerEngine(off).available, false);
  const ff = createEngines('firefox', { ...NL, debugger: false }, { declarativeNetRequest: false, scripting: false, debugger: false, webRequestBlocking: true });
  const noop = asDebuggerEngine(ff);
  assert.equal(noop.isAttached(1), false);
  assert.equal((await noop.enableTab(1)).ok, false);
  await noop.tick();
});

await check('enableTab: attach 1.3 + Fetch.enable with the rule patterns; nlTabs tracks it; idempotent; disableTab → Fetch.disable + detach', async () => {
  const h = harness();
  await h.engine.apply(compileRules([rule()], [], 'chrome', NL, 0));
  assert.deepEqual(await h.engine.enableTab(7), { ok: true });
  assert.deepEqual(await h.engine.enableTab(7), { ok: true }, 'second enable is a no-op');
  assert.ok(h.api.attached.has(7));
  const en = h.api.of('Fetch.enable');
  assert.equal(en.length, 1);
  assert.deepEqual(en[0].params, { patterns: [{ urlPattern: '*', resourceType: 'Image', requestStage: 'Request' }], handleAuthRequests: false });
  assert.deepEqual(h.nl, [7]);
  assert.deepEqual(h.engine.attachedTabs(), [7]);
  assert.equal(h.engine.stats(7).attached, true);
  await h.engine.disableTab(7);
  assert.equal(h.api.of('Fetch.disable').length, 1);
  assert.equal(h.api.attached.has(7), false);
  assert.deepEqual(h.nl, []);
  assert.equal(h.engine.isAttached(7), false);
  assert.equal(h.events.some((e) => e.type === 'detached'), false, 'user-initiated disable is not a `detached` event');
});

await check('enableTab: the browser\'s attach error is returned verbatim; nothing is recorded', async () => {
  const h = harness();
  h.api.attachError = 'Cannot access a chrome:// URL';
  assert.deepEqual(await h.engine.enableTab(9), { ok: false, error: 'Cannot access a chrome:// URL' });
  assert.deepEqual(h.nl, []);
  assert.equal(h.engine.isAttached(9), false);
});

await check('apply: re-enable with new patterns on every attached tab (idempotent); no rules → Fetch.disable, never an empty patterns array', async () => {
  const h = harness();
  await h.engine.apply(compileRules([rule()], [], 'chrome', NL, 0));
  await h.engine.enableTab(7);
  await h.engine.apply(compileRules([rule()], [], 'chrome', NL, 0));
  assert.equal(h.api.of('Fetch.enable').length, 1, 'same patterns → no second enable');
  await h.engine.apply(compileRules([rule(), rule({ condition: { resourceTypes: ['script'] } })], [], 'chrome', NL, 0));
  assert.equal(h.api.of('Fetch.enable').length, 2);
  assert.equal(h.api.of('Fetch.enable')[1].params.patterns.length, 2);
  await h.engine.apply(compileRules([], [], 'chrome', NL, 0));
  assert.equal(h.api.of('Fetch.disable').length, 1);
  assert.equal(h.api.of('Fetch.enable').every((c) => c.params.patterns.length > 0), true);
  assert.equal(h.engine.isAttached(7), true, 'no rules does not mean detach — the user turned NL on');
});

await check('requestPaused: fail at Request stage → failRequest(reason), hit + log row, counters written through', async () => {
  const h = harness();
  await h.engine.apply(compileRules([rule({ id: 'to', state: { kind: 'times', n: 1 } })], [], 'chrome', NL, 0));
  await h.engine.enableTab(7);
  const p = paused();
  h.api.emit(7, 'Fetch.requestPaused', p);
  await h.settle();
  const fails = h.api.of('Fetch.failRequest');
  assert.equal(fails.length, 1);
  assert.deepEqual(fails[0].params, { requestId: p.requestId, errorReason: 'TimedOut' });
  assert.equal(h.api.of('Fetch.continueRequest').length, 0, 'decided → no continue in finally');
  const hit = h.events.find((e) => e.type === 'hit');
  assert.deepEqual(hit, { type: 'hit', ruleId: 'to', tabId: 7, url: p.request.url, approx: false });
  const row = h.logs()[0];
  assert.equal(row.outcome, 'failed');
  assert.equal(row.error, 'TimedOut');
  assert.equal(row.engine, 'debugger');
  assert.equal(row.type, 'image');
  assert.equal(row.marks.length, 0, 'network-level rows carry no ✱');
  assert.equal(h.snap.counters['to|t7'].hits, 1, 'write-through to the injected store');
  // times:1 exhausted → the next one passes, logged as passed, continued.
  h.api.emit(7, 'Fetch.requestPaused', paused());
  await h.settle();
  assert.equal(h.api.of('Fetch.continueRequest').length, 1);
  assert.equal(h.logs()[1].outcome, 'passed');
  assert.deepEqual(h.engine.stats(7), { attached: true, intercepted: 2, applied: 1 });
});

await check('requestPaused: other tabs\' events are ignored; the tab\'s events are routed to its session only', async () => {
  const h = harness();
  await h.engine.apply(compileRules([rule()], [], 'chrome', NL, 0));
  await h.engine.enableTab(7);
  h.api.emit(8, 'Fetch.requestPaused', paused());
  await h.settle();
  assert.equal(h.api.commands.filter((c) => c.method.startsWith('Fetch.') && c.method !== 'Fetch.enable').length, 0);
});

await check('Response stage: real 500 + condition 5xx → failRequest(InternetDisconnected); 200 → passed with status', async () => {
  const h = harness();
  await h.engine.apply(compileRules([rule({ condition: { responseStatus: '5xx' }, action: { type: 'fail', reason: 'InternetDisconnected' } })], [], 'chrome', NL, 0));
  await h.engine.enableTab(7);
  assert.equal(h.api.of('Fetch.enable')[0].params.patterns[0].requestStage, 'Response');
  h.api.emit(7, 'Fetch.requestPaused', paused({ responseStatusCode: 500, responseHeaders: [{ name: 'Set-Cookie', value: 's=1' }] }));
  h.api.emit(7, 'Fetch.requestPaused', paused({ responseStatusCode: 200 }));
  await h.settle();
  assert.equal(h.api.of('Fetch.failRequest')[0].params.errorReason, 'InternetDisconnected');
  assert.equal(h.api.of('Fetch.continueRequest').length, 1);
  const [r1, r2] = h.logs();
  assert.equal(r1.outcome, 'failed');
  assert.equal(r1.status, 500);
  assert.equal(r1.headers, undefined, 'headers are copied only when a rule looks at them');
  assert.equal(r2.outcome, 'passed');
  assert.equal(r2.status, 200);
});

await check('status action: fulfillRequest with body; a rejected fulfil is followed by continueRequest (fail-open)', async () => {
  const h = harness();
  await h.engine.apply(compileRules([rule({ condition: { resourceTypes: ['script'] }, action: { type: 'status', code: 503, body: 'x', contentType: 'text/plain' } })], [], 'chrome', NL, 0));
  await h.engine.enableTab(7);
  h.api.emit(7, 'Fetch.requestPaused', paused({ resourceType: 'Script' }));
  await h.settle();
  const f = h.api.of('Fetch.fulfillRequest');
  assert.equal(f.length, 1);
  assert.equal(f[0].params.responseCode, 503);
  assert.equal(h.logs()[0].outcome, 'status');
  assert.equal(h.logs()[0].status, 503);
  h.api.rejectNext = (m) => m === 'Fetch.fulfillRequest';
  const p = paused({ resourceType: 'Script' });
  h.api.emit(7, 'Fetch.requestPaused', p);
  await h.settle();
  const cont = h.api.of('Fetch.continueRequest');
  assert.equal(cont.length, 1);
  assert.equal(cont[0].params.requestId, p.requestId, 'the refused request was continued');
  assert.ok(h.events.some((e) => e.type === 'error' && /fulfillRequest rejected/.test(e.message)));
});

await check('delay: continueRequest only after ms; disableTab releases a parked delay immediately', async () => {
  const h = harness();
  await h.engine.apply(compileRules([rule({ action: { type: 'delay', ms: 120 } })], [], 'chrome', NL, 0));
  await h.engine.enableTab(7);
  const t0 = Date.now();
  h.api.emit(7, 'Fetch.requestPaused', paused());
  await sleep(40);
  assert.equal(h.api.of('Fetch.continueRequest').length, 0, 'still parked');
  await sleep(140);
  assert.equal(h.api.of('Fetch.continueRequest').length, 1);
  assert.ok(Date.now() - t0 >= 110);
  assert.equal(h.logs()[0].outcome, 'delayed');
  assert.equal(h.logs()[0].delayMs, 120);
  // Parked, then the user switches NL off: released now, not in 120 ms.
  h.api.emit(7, 'Fetch.requestPaused', paused());
  await sleep(10);
  await h.engine.disableTab(7);
  assert.equal(h.api.of('Fetch.continueRequest').length, 2, 'released by disableTab');
  await sleep(150);
  assert.equal(h.api.of('Fetch.continueRequest').length, 2, 'the timer did not continue it a second time');
});

await check('handler exception: finally continues the request; 3 in a row → auto-detach + `detached` event', async () => {
  const h = harness();
  // A rule whose regex is fine for the validator but whose evaluation we sabotage via a broken request object.
  await h.engine.apply(compileRules([rule()], [], 'chrome', NL, 0));
  await h.engine.enableTab(7);
  const broken = () => ({ requestId: `b${++reqSeq}`, request: null, resourceType: 'Image' });
  h.api.emit(7, 'Fetch.requestPaused', broken());
  await h.settle();
  assert.equal(h.api.of('Fetch.continueRequest').length, 1, 'continued from finally');
  assert.ok(h.events.some((e) => e.type === 'error' && /handler failed/.test(e.message)));
  h.api.emit(7, 'Fetch.requestPaused', broken());
  await h.settle();
  assert.equal(h.engine.isAttached(7), true, 'two errors: still attached');
  h.api.emit(7, 'Fetch.requestPaused', broken());
  await h.settle();
  assert.equal(h.engine.isAttached(7), false);
  assert.equal(h.api.attached.has(7), false);
  const det = h.events.find((e) => e.type === 'detached');
  assert.deepEqual(det, { type: 'detached', tabId: 7, reason: HANDLER_ERRORS_REASON });
  assert.deepEqual(h.nl, []);
  assert.equal(h.engine.stats(7).lastDetachReason, HANDLER_ERRORS_REASON);
  // A success in between resets the counter.
  const h2 = harness();
  await h2.engine.apply(compileRules([rule()], [], 'chrome', NL, 0));
  await h2.engine.enableTab(7);
  h2.api.emit(7, 'Fetch.requestPaused', broken());
  h2.api.emit(7, 'Fetch.requestPaused', broken());
  await h2.settle();
  h2.api.emit(7, 'Fetch.requestPaused', paused());
  await h2.settle();
  h2.api.emit(7, 'Fetch.requestPaused', broken());
  h2.api.emit(7, 'Fetch.requestPaused', broken());
  await h2.settle();
  assert.equal(h2.engine.isAttached(7), true);
});

await check('browser detach (Cancel / tab closed): session dropped, nlTabs cleared, `detached` with the browser\'s reason; parked delay woken without commands', async () => {
  const h = harness();
  await h.engine.apply(compileRules([rule({ action: { type: 'delay', ms: 200 } })], [], 'chrome', NL, 0));
  await h.engine.enableTab(7);
  h.api.emit(7, 'Fetch.requestPaused', paused());
  await sleep(10);
  const before = h.api.commands.length;
  h.api.browserDetach(7, 'canceled_by_user');
  await h.settle();
  assert.equal(h.engine.isAttached(7), false);
  assert.deepEqual(h.nl, []);
  assert.deepEqual(h.events.find((e) => e.type === 'detached'), { type: 'detached', tabId: 7, reason: 'canceled_by_user' });
  await sleep(250);
  assert.equal(h.api.commands.length, before, 'no command is sent on a dead session');
  assert.equal(h.engine.stats(7).lastDetachReason, 'canceled_by_user');
});

await check('watchdog tick(): a request whose handler is stuck > 20 s is continued + logged as error; fresh ones untouched', async () => {
  const h = harness({ storeDelay: 10_000 }); // the cold read hangs → the handler waits (bounded by 200 ms, but we tick before)
  await h.engine.apply(compileRules([rule()], [], 'chrome', NL, 0));
  await h.engine.enableTab(7);
  const p = paused();
  h.api.emit(7, 'Fetch.requestPaused', p);
  await sleep(5);
  await h.engine.tick(Date.now() + 1_000);
  assert.equal(h.api.of('Fetch.continueRequest').length, 0, 'not stalled yet');
  await h.engine.tick(Date.now() + WATCHDOG_STALL_MS + 1_000);
  const cont = h.api.of('Fetch.continueRequest');
  assert.equal(cont.length, 1);
  assert.equal(cont[0].params.requestId, p.requestId);
  const row = h.logs().find((e) => e.outcome === 'error');
  assert.equal(row.error, 'released hung request (watchdog)');
  assert.equal(row.url, p.request.url);
  assert.ok(h.events.some((e) => e.type === 'error' && /20 s/.test(e.message)));
  // When the handler finally finishes it must NOT touch the request again.
  await sleep(300);
  assert.equal(h.api.of('Fetch.continueRequest').length + h.api.of('Fetch.failRequest').length, 1, 'released once, decided never');
});

await check('startup reconcile: stale nlTabs ids are cleared (sticky off) or re-attached (sticky on); onUpdated(loading) re-attaches when sticky', async () => {
  // A dead worker leaves ids in `session:nlTabs` and no sessions in memory.
  const h = harness({ sticky: false });
  let stale = [7, 8];
  h.engine.configure({ api: h.api, tabs: h.tabs, state: { read: async () => emptySnapshot(), write: async (m) => m(emptySnapshot()) }, nlTabs: { get: async () => stale, set: async (ids) => void (stale = ids) }, prefs: async () => ({ nlSticky: false }), isPaused: () => false });
  await h.engine.apply(compileRules([rule()], [], 'chrome', NL, 0));
  assert.deepEqual(stale, [], 'stale ids cleared');
  assert.equal(h.api.attached.size, 0);
  const s = harness({ sticky: true });
  let nl = [7];
  s.engine.configure({ api: s.api, tabs: s.tabs, state: { read: async () => emptySnapshot(), write: async (m) => m(emptySnapshot()) }, nlTabs: { get: async () => nl, set: async (ids) => void (nl = ids) }, prefs: async () => ({ nlSticky: true }), isPaused: () => false });
  await s.engine.apply(compileRules([rule()], [], 'chrome', NL, 0));
  assert.equal(s.engine.isAttached(7), true, 'sticky: re-attached');
  assert.deepEqual(nl, [7]);
  // Lose the session the way a worker restart would (browser side), keep nlTabs, then a reload arrives.
  s.api.browserDetach(7, 'target_closed');
  await s.settle();
  nl = [7];
  s.tabs.fireUpdated(7, { status: 'loading', url: 'https://shop.example.com/again' });
  await s.settle();
  assert.equal(s.engine.isAttached(7), true, 'sticky re-attach on loading');
  // ...but never after the user pressed Cancel on the banner.
  s.api.browserDetach(7, 'canceled_by_user');
  await s.settle();
  nl = [7];
  s.tabs.fireUpdated(7, { status: 'loading' });
  await s.settle();
  assert.equal(s.engine.isAttached(7), false);
});

await check('dispose: every session detached, nothing left paused; idempotent', async () => {
  const h = harness();
  await h.engine.apply(compileRules([rule({ action: { type: 'delay', ms: 500 } })], [], 'chrome', NL, 0));
  await h.engine.enableTab(7);
  await h.engine.enableTab(8);
  h.api.emit(7, 'Fetch.requestPaused', paused());
  await sleep(10);
  await h.engine.dispose();
  assert.equal(h.api.attached.size, 0);
  assert.equal(h.api.of('Fetch.continueRequest').length, 1, 'parked delay released');
  assert.deepEqual(h.engine.attachedTabs(), []);
  await h.engine.dispose();
});

await check('pauseTab: intercepted requests pass through untouched and unlogged; resumeTab restores', async () => {
  const h = harness();
  await h.engine.apply(compileRules([rule()], [], 'chrome', NL, 0));
  await h.engine.enableTab(7);
  await h.engine.pauseTab(7);
  h.api.emit(7, 'Fetch.requestPaused', paused());
  await h.settle();
  assert.equal(h.api.of('Fetch.continueRequest').length, 1);
  assert.equal(h.api.of('Fetch.failRequest').length, 0);
  assert.equal(h.logs().length, 0);
  await h.engine.resumeTab(7);
  h.api.emit(7, 'Fetch.requestPaused', paused());
  await h.settle();
  assert.equal(h.api.of('Fetch.failRequest').length, 1);
});

await check('log dedupe across stages: a request the Response patterns will see is not logged twice; delay at Request → one `delayed` row at Response with the real status', async () => {
  const h = harness();
  await h.engine.apply(compileRules([
    rule({ id: 'd', action: { type: 'delay', ms: 20 } }),
    rule({ id: 's', condition: { responseStatus: '5xx' }, action: { type: 'block' } }),
  ], [], 'chrome', NL, 0));
  await h.engine.enableTab(7);
  const p = paused({ networkId: 'N1' });
  h.api.emit(7, 'Fetch.requestPaused', p);
  await sleep(60);
  assert.equal(h.logs().length, 0, 'nothing logged at Request stage (Response stage will come)');
  h.api.emit(7, 'Fetch.requestPaused', { ...p, requestId: 'ij-resp', responseStatusCode: 200 });
  await h.settle();
  const rows = h.logs();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'delayed');
  assert.equal(rows[0].delayMs, 20);
  assert.equal(rows[0].status, 200);
  // A request no Response pattern covers is logged at Request stage right away.
  h.api.emit(7, 'Fetch.requestPaused', paused({ resourceType: 'Font' }));
  await h.settle();
  assert.equal(h.logs()[1].outcome, 'passed');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
