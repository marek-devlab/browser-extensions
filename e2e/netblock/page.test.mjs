// Node tests for the page engine's decision layer (extensions/netblock/utils/
// page-core.ts) and the background half (utils/engines/page.ts) — the REAL
// .ts sources, loaded the same way as logic.test.mjs. No browser: `fetch` is a
// fake, XHR is covered by page.live.mjs. Run:  npm run e2e:netblock-page
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
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const U = (p) => pathToFileURL(resolve(repoRoot, 'extensions/netblock/utils', p)).href;
const {
  PageMirror,
  decideRequest,
  describeFetch,
  interceptFetch,
  matchesStatic,
  matchesResponse,
  mergeSnapshot,
  syntheticHeaders,
  isNullBodyStatus,
  sanitizePageEvents,
  PAGE_EVENT_LIMITS,
} = await import(U('page-core.ts'));
const { createPageEngine } = await import(U('engines/page.ts'));
const { injectableOrigins, reconcileRegistration } = await import(U('page-registration.ts'));
const { defaultRule } = await import(U('rule-types.ts'));
const { CHROME_DEFAULT_CAPS, compileRules } = await import(U('engine-select.ts'));
const { emptySnapshot } = await import(U('state.ts'));

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

function rule(over = {}) {
  const r = defaultRule(over.id ?? 'r1', 1000);
  r.name = 'test';
  r.condition = { url: { op: 'contains', value: '/api/checkout' }, methods: ['POST'], resourceTypes: ['xhr'] };
  return Object.assign(r, over);
}

/** A mirror that has received `page:rules` for tab 7. */
function mirrorWith(rules, { paused = false, state = emptySnapshot(), topLevel = false, activeTabId } = {}) {
  const m = new PageMirror('shop.example.com');
  m.command({ type: 'page:rules', rules, paused, state, tabId: 7, activeTabId }, 1_000, topLevel);
  return m;
}

const fakeFetch = (status = 200, headers = {}) => {
  const calls = [];
  const fn = async (input, init) => {
    calls.push({ input, init });
    return new Response('real-body', { status, headers });
  };
  fn.calls = calls;
  return fn;
};
const deps = (origFetch, extra = {}) => {
  const emitted = [];
  return {
    origFetch,
    now: () => 5_000,
    emit: (evs) => emitted.push(...evs),
    baseUrl: () => 'https://shop.example.com/cart/',
    sleep: extra.sleep ?? (async () => undefined),
    emitted,
  };
};

console.log('page-core: request description');

await check('relative URL resolves against the document base', () => {
  const r = describeFetch('/api/checkout?x=1', undefined, 'https://shop.example.com/cart/');
  assert.equal(r.url, 'https://shop.example.com/api/checkout?x=1');
  assert.equal(r.method, 'GET');
  const r2 = describeFetch('../api/checkout', { method: 'post' }, 'https://shop.example.com/cart/');
  assert.equal(r2.url, 'https://shop.example.com/api/checkout');
  assert.equal(r2.method, 'POST');
});

await check('Request object input: url + method taken from it, init.method wins', () => {
  const req = new Request('https://shop.example.com/api/checkout', { method: 'POST' });
  assert.deepEqual(describeFetch(req, undefined, 'https://x/'), { url: 'https://shop.example.com/api/checkout', method: 'POST' });
  assert.equal(describeFetch(req, { method: 'PUT' }, 'https://x/').method, 'PUT');
  assert.equal(describeFetch(new URL('https://a.b/c'), undefined, 'https://x/').url, 'https://a.b/c');
});

await check('unparsable input never throws (fail-open → null)', () => {
  assert.equal(describeFetch('http://[bad', undefined, 'https://x/'), null);
});

console.log('page-core: matching');

await check('static match: url/method/type/pageDomain/activeTab scope', () => {
  const ctx = { url: 'https://shop.example.com/api/checkout', method: 'POST', pageHost: 'shop.example.com', tabId: 7 };
  assert.equal(matchesStatic(rule(), ctx), true);
  assert.equal(matchesStatic(rule(), { ...ctx, method: 'GET' }), false);
  assert.equal(matchesStatic(rule({ condition: { resourceTypes: ['image'] } }), ctx), false, 'non-xhr types never match in the page');
  assert.equal(matchesStatic(rule({ condition: { pageDomains: ['example.com'] } }), ctx), true, 'suffix match on page host');
  assert.equal(matchesStatic(rule({ condition: { pageDomains: ['other.com'] } }), ctx), false);
  assert.equal(matchesStatic(rule({ scope: 'activeTab' }), ctx), false, 'unknown active tab → idle');
  assert.equal(matchesStatic(rule({ scope: 'activeTab' }), { ...ctx, activeTabId: 7 }), true);
  assert.equal(matchesStatic(rule({ scope: 'activeTab' }), { ...ctx, activeTabId: 8 }), false);
});

await check('response match: status pattern + header ops (case-insensitive)', () => {
  const view = (status, headers) => ({ status, header: (n) => headers[n.toLowerCase()] ?? null });
  assert.equal(matchesResponse(rule({ condition: { responseStatus: '5xx' } }), view(503, {})), true);
  assert.equal(matchesResponse(rule({ condition: { responseStatus: '5xx' } }), view(200, {})), false);
  assert.equal(matchesResponse(rule({ condition: { responseStatus: 'bogus' } }), view(500, {})), false, 'unparsable pattern never matches');
  const h = (op, value) => rule({ condition: { responseHeaders: [{ name: 'X-Spike', op, value }] } });
  assert.equal(matchesResponse(h('exists'), view(200, { 'x-spike': 'A' })), true);
  assert.equal(matchesResponse(h('equals', 'a'), view(200, { 'x-spike': 'A' })), true);
  assert.equal(matchesResponse(h('contains', 'b'), view(200, { 'x-spike': 'A' })), false);
  assert.equal(matchesResponse(h('exists'), view(200, {})), false);
});

console.log('page-core: decision walk');

await check('nth:3 — 1st/2nd pass (seen counted), 3rd applies; mirror consistent', () => {
  const m = mirrorWith([rule({ state: { kind: 'nth', n: 3 }, action: { type: 'status', code: 503, body: 'down' } })]);
  const req = { url: 'https://shop.example.com/api/checkout', method: 'POST' };
  const o1 = m.decide(req, 1);
  const o2 = m.decide(req, 2);
  const o3 = m.decide(req, 3);
  assert.equal(o1.kind, 'pass');
  assert.equal(o2.kind, 'pass');
  assert.equal(o3.kind, 'apply');
  assert.equal(o3.action.code, 503);
  assert.deepEqual([o1.events[0].counter.seen, o2.events[0].counter.seen, o3.events[0].counter.seen], [1, 2, 3]);
  assert.deepEqual([o1.events[0].applied, o3.events[0].applied], [false, true]);
  assert.equal(o3.key, 'r1|t7', 'rule+tab key uses the tab from page:rules');
  assert.equal(m.snap.counters['r1|t7'].hits, 1);
  assert.equal(m.decide(req, 4).kind, 'pass', '4th passes again (not `every`)');
});

await check('once — applies exactly once, then passes', () => {
  const m = mirrorWith([rule({ state: { kind: 'once' } })]);
  const req = { url: 'https://shop.example.com/api/checkout', method: 'POST' };
  assert.equal(m.decide(req, 1).kind, 'apply');
  assert.equal(m.decide(req, 2).kind, 'pass');
  assert.equal(m.snap.counters['r1|t7'].seen, 2);
});

await check('first-match: a non-applying rule lets a later rule apply', () => {
  const m = mirrorWith([
    rule({ id: 'a', state: { kind: 'nth', n: 2 }, action: { type: 'block' } }),
    rule({ id: 'b', action: { type: 'delay', ms: 100 } }),
  ]);
  const req = { url: 'https://shop.example.com/api/checkout', method: 'POST' };
  const o = m.decide(req, 1);
  assert.equal(o.kind, 'apply');
  assert.equal(o.rule.id, 'b');
  assert.equal(o.events.length, 2, 'both matches counted');
  assert.equal(m.decide(req, 2).rule.id, 'a', '2nd request: `a` is nth:2 and wins by priority');
});

await check('response-status condition: walk stops at needResponse, resumes with the real status', () => {
  const rules = [rule({ condition: { url: { op: 'contains', value: '/api/' }, responseStatus: '5xx' }, action: { type: 'fail', reason: 'InternetDisconnected' } })];
  const m = mirrorWith(rules);
  const req = { url: 'https://shop.example.com/api/x', method: 'GET' };
  const o = m.decide(req, 1);
  assert.equal(o.kind, 'needResponse');
  assert.equal(o.index, 0);
  assert.equal(o.events.length, 0, 'no decide() before the response');
  const ok = m.decide(req, 2, 0, { status: 200, header: () => null });
  assert.equal(ok.kind, 'pass');
  assert.equal(Object.keys(m.snap.counters).length, 0, 'a 200 is not a match');
  const bad = m.decide(req, 3, 0, { status: 500, header: () => null });
  assert.equal(bad.kind, 'apply');
  assert.equal(bad.action.reason, 'InternetDisconnected');
});

await check('probability with seed: same order → same sequence (per rule+key)', () => {
  const r = rule({ state: { kind: 'probability', percent: 50, seed: 42 } });
  const run = () => {
    const m = mirrorWith([r]);
    const req = { url: 'https://shop.example.com/api/checkout', method: 'POST' };
    return Array.from({ length: 12 }, (_, i) => m.decide(req, i).kind === 'apply');
  };
  const a = run();
  const b = run();
  assert.deepEqual(a, b);
  assert.ok(a.includes(true) && a.includes(false), `should mix: ${a.join(',')}`);
});

await check('paused mirror and missing rules → null (original request)', () => {
  const m = mirrorWith([rule()], { paused: true });
  assert.equal(m.decide({ url: 'https://shop.example.com/api/checkout', method: 'POST' }, 1), null);
  m.command({ type: 'page:pause', paused: false }, 2);
  assert.equal(m.decide({ url: 'https://shop.example.com/api/checkout', method: 'POST' }, 1).kind, 'apply');
  const fresh = new PageMirror('x');
  assert.equal(fresh.decide({ url: 'https://x/api/checkout', method: 'POST' }, 1), null, 'no rules yet → idle');
});

await check('resetOn: navigation — top-level page:rules drops per-tab counters; page:reset too', () => {
  const state = { counters: { 'r1|t7': { seen: 2, hits: 0 }, 'r2|t7': { seen: 5, hits: 5 } }, matched: { r1: 1 } };
  const rules = [rule({ id: 'r1', resetOn: 'navigation' }), rule({ id: 'r2', resetOn: 'session' })];
  const m = mirrorWith(rules, { state, topLevel: true });
  assert.equal(m.snap.counters['r1|t7'], undefined, 'navigation-reset rule cleared');
  assert.deepEqual(m.snap.counters['r2|t7'], { seen: 5, hits: 5 }, 'session rule kept');
  const sub = mirrorWith(rules, { state, topLevel: false });
  assert.deepEqual(sub.snap.counters['r1|t7'], { seen: 2, hits: 0 }, 'a sub-frame does not reset');
  sub.command({ type: 'page:reset', ruleId: 'r2' }, 3);
  assert.equal(sub.snap.counters['r2|t7'], undefined);
  assert.deepEqual(sub.snap.counters['r1|t7'], { seen: 2, hits: 0 });
  sub.command({ type: 'page:reset' }, 4);
  assert.deepEqual(sub.snap, { counters: {}, matched: {} });
});

await check('window(navigation) opens locally on a top-level load; click opens window(click)', () => {
  const nav = rule({ id: 'w1', state: { kind: 'window', trigger: 'navigation', seconds: 10 } });
  const clk = rule({ id: 'w2', state: { kind: 'window', trigger: 'click', seconds: 10 } });
  const m = mirrorWith([nav, clk], { topLevel: true });
  const req = { url: 'https://shop.example.com/api/checkout', method: 'POST' };
  assert.equal(m.decide(req, 2_000).rule.id, 'w1', 'inside the navigation window');
  assert.equal(m.decide(req, 20_000).kind, 'pass', 'both windows closed');
  const evs = m.click(20_000, 'https://shop.example.com/');
  assert.equal(evs.length, 1);
  assert.equal(evs[0].kind, 'window');
  assert.equal(evs[0].ruleId, 'w2');
  assert.equal(m.decide(req, 21_000).rule.id, 'w2');
});

await check('mergeSnapshot: larger seen wins, never rolls back', () => {
  const local = { counters: { k: { seen: 3, hits: 1 } }, matched: { r: 10 } };
  const merged = mergeSnapshot(local, { k: { seen: 2, hits: 2 }, j: { seen: 1, hits: 0 } }, { r: 5, q: 7 });
  assert.deepEqual(merged.counters.k, { seen: 3, hits: 1 });
  assert.deepEqual(merged.counters.j, { seen: 1, hits: 0 });
  assert.deepEqual(merged.matched, { r: 10, q: 7 });
  const m = mirrorWith([rule()]);
  m.command({ type: 'page:state', counters: { 'r1|t7': { seen: 9, hits: 9 } }, matched: {} }, 1);
  assert.equal(m.snap.counters['r1|t7'].seen, 9);
});

console.log('page-core: fetch path');

await check('block → TypeError("Failed to fetch"), nothing sent, log row blocked', async () => {
  const f = fakeFetch();
  const d = deps(f);
  const m = mirrorWith([rule({ action: { type: 'block' } })]);
  await assert.rejects(interceptFetch(m, d, '/api/checkout', { method: 'POST' }), (e) => e instanceof TypeError && e.message === 'Failed to fetch');
  assert.equal(f.calls.length, 0);
  const log = d.emitted.find((e) => e.kind === 'log');
  assert.equal(log.outcome, 'blocked');
  assert.equal(log.url, 'https://shop.example.com/api/checkout');
});

await check('fail(reason) on the page = imitated TypeError, log carries the reason (page↓)', async () => {
  const r = rule({ action: { type: 'fail', reason: 'ConnectionReset' } });
  const set = compileRules([r], [], 'chrome', CHROME_DEFAULT_CAPS, 0);
  assert.equal(set.byEngine.page[0].degraded, 'failReasonImitated', 'engine-select marks the degradation');
  const f = fakeFetch();
  const d = deps(f);
  const m = mirrorWith([r]);
  await assert.rejects(interceptFetch(m, d, 'https://shop.example.com/api/checkout', { method: 'POST' }), TypeError);
  const log = d.emitted.find((e) => e.kind === 'log');
  assert.equal(log.outcome, 'failed');
  assert.equal(log.error, 'ConnectionReset');
  assert.equal(f.calls.length, 0);
});

await check('status → real request goes out, app gets synthetic Response with nosniff + url', async () => {
  const f = fakeFetch(200);
  const d = deps(f);
  const m = mirrorWith([rule({ action: { type: 'status', code: 503, body: '{"e":1}', contentType: 'application/json' } })]);
  const res = await interceptFetch(m, d, '/api/checkout', { method: 'POST', body: 'x' });
  assert.equal(res.status, 503);
  assert.equal(await res.text(), '{"e":1}');
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.url, 'https://shop.example.com/api/checkout');
  assert.equal(f.calls.length, 1, 'honest: the server saw the request');
  assert.equal(d.emitted.find((e) => e.kind === 'log').status, 503);
});

await check('status 204 drops the body; 1xx is not constructible → fail-open to the real response', async () => {
  const d = deps(fakeFetch(200));
  const m = mirrorWith([rule({ action: { type: 'status', code: 204, body: 'ignored' } })]);
  const res = await interceptFetch(m, d, '/api/checkout', { method: 'POST' });
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');
  assert.equal(isNullBodyStatus(304), true);
  const d2 = deps(fakeFetch(200));
  const m2 = mirrorWith([rule({ action: { type: 'status', code: 101 } })]);
  const real = await interceptFetch(m2, d2, '/api/checkout', { method: 'POST' });
  assert.equal(real.status, 200);
  assert.equal(await real.text(), 'real-body');
  assert.match(d2.emitted.find((e) => e.kind === 'log').error, /not constructible/);
  assert.equal(syntheticHeaders({ type: 'status', code: 500 })['content-type'], 'text/plain; charset=utf-8');
});

await check('delay → sleep(ms, signal) then the real request; abort during the delay rejects with the reason', async () => {
  const slept = [];
  const f = fakeFetch(200);
  const d = deps(f, { sleep: async (ms, signal) => void slept.push([ms, signal]) });
  const m = mirrorWith([rule({ action: { type: 'delay', ms: 1500 } })]);
  const ctrl = new AbortController();
  const res = await interceptFetch(m, d, '/api/checkout', { method: 'POST', signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.deepEqual(slept[0], [1500, ctrl.signal]);
  assert.equal(d.emitted.find((e) => e.kind === 'log').delayMs, 1500);
  // Abort while sleeping.
  const ctrl2 = new AbortController();
  const d2 = deps(fakeFetch(200), { sleep: (ms, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason))) });
  const p = interceptFetch(mirrorWith([rule({ action: { type: 'delay', ms: 1500 } })]), d2, '/api/checkout', { method: 'POST', signal: ctrl2.signal });
  ctrl2.abort(new Error('user-abort'));
  await assert.rejects(p, /user-abort/);
});

await check('response-status path: real 500 → substituted failure; real 200 → real response untouched', async () => {
  const r = rule({ condition: { url: { op: 'contains', value: '/api/' }, responseStatus: '5xx' }, action: { type: 'block' } });
  const f500 = fakeFetch(500);
  await assert.rejects(interceptFetch(mirrorWith([r]), deps(f500), '/api/a', {}), TypeError);
  assert.equal(f500.calls.length, 1, 'exactly one real request');
  const f200 = fakeFetch(200, { 'x-spike-server': 'A' });
  const res = await interceptFetch(mirrorWith([r]), deps(f200), '/api/a', {});
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'real-body');
  assert.equal(f200.calls.length, 1);
});

await check('response-header condition + status action: one real request, then substitution', async () => {
  const r = rule({
    condition: { url: { op: 'contains', value: '/api/' }, responseHeaders: [{ name: 'x-spike-server', op: 'equals', value: 'A' }] },
    action: { type: 'status', code: 429, body: 'slow down' },
  });
  const f = fakeFetch(200, { 'x-spike-server': 'A' });
  const res = await interceptFetch(mirrorWith([r]), deps(f), '/api/a', {});
  assert.equal(res.status, 429);
  assert.equal(await res.text(), 'slow down');
  assert.equal(f.calls.length, 1);
});

await check('fail-open: a throwing origFetch on an idle mirror propagates; an unparsable URL goes to the original', async () => {
  const boom = async () => {
    throw new Error('network down');
  };
  await assert.rejects(interceptFetch(mirrorWith([rule()]), deps(boom), 'http://[bad', {}), /network down/);
});

console.log('engine: background half');

await check('page engine: relay:ready → page:rules with snapshot/tabId/paused; events → log ✱ + merged counters', async () => {
  const eng = createPageEngine(CHROME_DEFAULT_CAPS, false);
  const merges = [];
  eng.configure({
    getSnapshot: async () => ({ counters: { 'r1|t7': { seen: 1, hits: 0 } }, matched: {} }),
    mergeState: async (c, m) => void merges.push([c, m]),
    isPaused: (id) => id === 9,
  });
  const set = compileRules([rule({ state: { kind: 'nth', n: 3 }, action: { type: 'status', code: 503 } })], [], 'chrome', CHROME_DEFAULT_CAPS, 0);
  await eng.apply(set);
  const reply = await eng.handleRelay({ type: 'relay:ready', url: 'https://shop.example.com/' }, { tab: { id: 7 } });
  assert.equal(reply.type, 'page:rules');
  assert.equal(reply.rules.length, 1);
  assert.equal(reply.tabId, 7);
  assert.equal(reply.paused, false);
  assert.equal(reply.state.counters['r1|t7'].seen, 1);
  assert.equal((await eng.handleRelay({ type: 'relay:ready', url: 'x' }, { tab: { id: 9 } })).paused, true);
  assert.equal(await eng.handleRelay({ type: 'relay:ready', url: 'x' }, {}), undefined, 'no tab → no reply');

  const got = [];
  eng.onEvent((e) => got.push(e));
  await eng.handleRelay(
    {
      type: 'relay:event',
      events: [
        { kind: 'hit', ruleId: 'r1', url: 'https://shop.example.com/api/checkout', key: 'r1|t7', counter: { seen: 3, hits: 1 }, applied: true },
        { kind: 'log', method: 'POST', url: 'https://shop.example.com/api/checkout', status: 503, outcome: 'status', ruleId: 'r1' },
      ],
    },
    { tab: { id: 7 } },
  );
  assert.equal(merges.length, 1);
  assert.deepEqual(merges[0][0], { 'r1|t7': { seen: 3, hits: 1 } });
  assert.ok(merges[0][1].r1 > 0, 'matched mark for afterRule');
  const log = got.find((e) => e.type === 'log');
  assert.deepEqual(log.entry.marks, ['clientSide']);
  assert.equal(log.entry.engine, 'page');
  assert.equal(log.entry.type, 'xhr');
  assert.equal(log.entry.tabId, 7);
  assert.equal(log.entry.status, 503);
  assert.ok(got.some((e) => e.type === 'hit' && e.approx === false));
});

await check('sanitizePageEvents: a page can only report about its own rules, its own tab and in bounded shapes', () => {
  const rules = [rule({ id: 'r1' }), rule({ id: 'g1', countKey: 'rule' }), rule({ id: 'u1', countKey: 'url' })];
  const ok = { kind: 'hit', ruleId: 'r1', url: 'https://shop.example.com/api/checkout', key: 'r1|t7', counter: { seen: 3, hits: 1 }, applied: true };
  assert.deepEqual(sanitizePageEvents([ok], rules, 7), [ok]);
  // Forged: another tab's key, a foreign rule, a global key for a per-tab rule, a bad counter.
  assert.deepEqual(sanitizePageEvents([{ ...ok, key: 'r1|t999' }], rules, 7), [], 'key of another tab');
  assert.deepEqual(sanitizePageEvents([{ ...ok, ruleId: 'zzz', key: 'zzz|t7' }], rules, 7), [], 'rule the page was never given');
  assert.deepEqual(sanitizePageEvents([{ ...ok, key: 'r1' }], rules, 7), [], 'per-tab rule with a global key');
  assert.deepEqual(sanitizePageEvents([{ ...ok, counter: { seen: 1, hits: 5 } }], rules, 7), [], 'hits > seen');
  assert.deepEqual(sanitizePageEvents([{ ...ok, counter: { seen: '3', hits: 1 } }], rules, 7), [], 'non-numeric counter');
  const rebuilt = sanitizePageEvents([{ ...ok, counter: JSON.parse('{"seen":3,"hits":1,"__proto__":{"x":1},"junk":1}') }], rules, 7);
  assert.equal(rebuilt.length, 1);
  assert.deepEqual(Object.keys(rebuilt[0].counter), ['seen', 'hits'], 'counters are rebuilt field by field');
  // Global and URL keys are accepted only in their rule's shape.
  assert.equal(sanitizePageEvents([{ ...ok, ruleId: 'g1', key: 'g1' }], rules, 7).length, 1);
  assert.equal(sanitizePageEvents([{ ...ok, ruleId: 'g1', key: 'g1|t7' }], rules, 7).length, 0);
  assert.equal(sanitizePageEvents([{ ...ok, ruleId: 'u1', key: 'u1|uhttps://shop.example.com/api/checkout' }], rules, 7).length, 1);
  assert.equal(sanitizePageEvents([{ ...ok, ruleId: 'u1', key: 'u1|u' + 'x'.repeat(PAGE_EVENT_LIMITS.keyLength) }], rules, 7).length, 0, 'oversized key');
  // Log rows: known outcome, bounded strings, only rules the page has.
  const log = { kind: 'log', method: 'POST', url: 'https://shop.example.com/api/checkout', status: 503, outcome: 'status', ruleId: 'r1' };
  assert.deepEqual(sanitizePageEvents([log], rules, 7), [log]);
  assert.deepEqual(sanitizePageEvents([{ ...log, outcome: 'pwned' }], rules, 7), []);
  assert.deepEqual(sanitizePageEvents([{ ...log, ruleId: 'other' }], rules, 7), []);
  assert.deepEqual(sanitizePageEvents([{ ...log, status: 1e9 }], rules, 7), []);
  assert.deepEqual(sanitizePageEvents([{ ...log, delayMs: PAGE_EVENT_LIMITS.delayMs + 1 }], rules, 7), []);
  const long = sanitizePageEvents([{ ...log, url: 'https://a/' + 'x'.repeat(100_000), error: 'e'.repeat(10_000) }], rules, 7)[0];
  assert.equal(long.url.length, PAGE_EVENT_LIMITS.urlLength);
  assert.equal(long.error.length, PAGE_EVENT_LIMITS.errorLength);
  // Floods are cut at the batch cap; garbage shapes are ignored.
  assert.equal(sanitizePageEvents(Array.from({ length: 5000 }, () => ok), rules, 7).length, PAGE_EVENT_LIMITS.batch);
  assert.deepEqual(sanitizePageEvents([null, 1, 'x', { kind: 'nope' }, {}], rules, 7), []);
  assert.deepEqual(sanitizePageEvents('not a list', rules, 7), []);
});

await check('page engine: forged relay events never reach the state store or the log', async () => {
  const eng = createPageEngine(CHROME_DEFAULT_CAPS, false);
  const merges = [];
  eng.configure({ getSnapshot: async () => emptySnapshot(), mergeState: async (c, m) => void merges.push([c, m]), isPaused: () => false });
  await eng.apply(compileRules([rule({ state: { kind: 'nth', n: 3 }, action: { type: 'status', code: 503 } })], [], 'chrome', CHROME_DEFAULT_CAPS, 0));
  const got = [];
  eng.onEvent((e) => got.push(e));
  await eng.handleRelay(
    {
      type: 'relay:event',
      events: [
        { kind: 'hit', ruleId: 'r1', url: 'x', key: 'r1|t42', counter: { seen: 1, hits: 1 }, applied: true },
        { kind: 'hit', ruleId: 'victim', url: 'x', key: 'victim', counter: { seen: 1e9, hits: 1e9 }, applied: true },
        { kind: 'log', method: 'GET', url: 'x', outcome: 'blocked', ruleId: 'victim' },
      ],
      host: 'h'.repeat(10_000),
    },
    { tab: { id: 7 } },
  );
  assert.equal(merges.length, 0, 'nothing merged');
  assert.equal(got.length, 0, 'nothing logged, no hit');
});

await check('registration: only http(s) origins; register → update → unregister, idempotent', async () => {
  assert.deepEqual(injectableOrigins(['https://a.com/*', 'file:///*', 'chrome://x/*', '<all_urls>', 'https://a.com/*']), ['<all_urls>', 'https://a.com/*']);
  let registered = [];
  const calls = [];
  const api = {
    permissions: { getAll: async () => ({ origins: api.origins }) },
    origins: ['https://a.com/*'],
    scripting: {
      getRegisteredContentScripts: async () => registered,
      registerContentScripts: async (s) => {
        calls.push(['register', s.map((x) => x.id)]);
        registered = s;
      },
      updateContentScripts: async (s) => {
        calls.push(['update', s.map((x) => x.matches)]);
        registered = registered.map((r) => ({ ...r, ...s.find((x) => x.id === r.id) }));
      },
      unregisterContentScripts: async (f) => {
        calls.push(['unregister', f.ids]);
        registered = [];
      },
    },
  };
  let r = await reconcileRegistration(api, true);
  assert.equal(r.changed, true);
  assert.deepEqual(calls[0], ['register', ['netblock-relay', 'netblock-page']]);
  assert.equal(registered[0].world, 'ISOLATED');
  assert.equal(registered[1].world, 'MAIN');
  assert.equal(registered[1].runAt, 'document_start');
  assert.equal(registered[1].allFrames, true);
  assert.equal(registered[1].persistAcrossSessions, true);
  assert.deepEqual(registered[1].js, ['content-scripts/netblock-page.js']);
  r = await reconcileRegistration(api, true);
  assert.equal(r.changed, false, 'same origins → no-op');
  api.origins = ['https://a.com/*', 'https://b.com/*'];
  r = await reconcileRegistration(api, true);
  assert.equal(r.changed, true);
  assert.equal(calls.at(-1)[0], 'update');
  api.origins = [];
  r = await reconcileRegistration(api, true);
  assert.equal(calls.at(-1)[0], 'unregister');
  assert.equal(registered.length, 0);
  api.origins = ['https://a.com/*'];
  r = await reconcileRegistration(api, false);
  assert.equal(r.changed, false, 'engine disabled + nothing registered → nothing to do');
  // Firefox-shaped api (no scripting) → no calls, no throw.
  assert.deepEqual(await reconcileRegistration({}, true), { matches: [], changed: false });
});

await check('decideRequest is pure: input snapshot untouched', () => {
  const snap = emptySnapshot();
  const out = decideRequest([rule()], snap, { url: 'https://shop.example.com/api/checkout', method: 'POST', pageHost: 'shop.example.com', tabId: 1, now: 1 });
  assert.equal(out.kind, 'apply');
  assert.deepEqual(snap, { counters: {}, matched: {} });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
