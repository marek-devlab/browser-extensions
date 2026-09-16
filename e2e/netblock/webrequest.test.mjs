// Logic-level tests (Node, no browser) for the Firefox `webrequest` engine of
// extensions/netblock: the pure matching/decision pipeline
// (utils/webrequest-eval.ts), the in-memory state mirror with write-through
// (utils/webrequest-state.ts) and the engine glue (utils/engines/webrequest.ts)
// against a fake `browser` global. Same loader as logic.test.mjs — the REAL
// .ts sources are imported. Run:  npm run e2e:netblock-webrequest
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
const { compileRules, FIREFOX_CAPS } = await load('engine-select.ts');
const { emptySnapshot, countKeyOf } = await load('state.ts');
const {
  evaluateRequest,
  isPageTraffic,
  typesFilterFor,
  stageOf,
  hasResponseStage,
  needsResponseHeaders,
  responseFor,
  mergeDeltas,
} = await load('webrequest-eval.ts');
const { StateCache } = await load('webrequest-state.ts');
const { createWebRequestEngine, STATE_COLD_TIMEOUT_MS } = await load('engines/webrequest.ts');

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

/* --------------------------------- fixtures -------------------------------- */

let seq = 0;
function rule(over = {}) {
  const r = defaultRule(over.id ?? `r${++seq}`, 1000 + seq);
  r.name = over.id ?? r.id;
  r.condition = { url: { op: 'contains', value: '/api/' }, resourceTypes: ['xhr'] };
  return { ...r, ...over, condition: { ...r.condition, ...(over.condition ?? {}) } };
}
/** Compile for Firefox and return the webrequest slice (priority order). */
function compiled(...rules) {
  return compileRules(rules, [], 'firefox', FIREFOX_CAPS, 0).byEngine.webrequest;
}
let reqSeq = 0;
function req(over = {}) {
  return {
    requestId: String(++reqSeq),
    url: 'https://shop.example.com/api/checkout?x=1',
    method: 'GET',
    type: 'xmlhttprequest',
    tabId: 7,
    frameId: 0,
    originUrl: 'https://shop.example.com/cart',
    documentUrl: 'https://shop.example.com/cart',
    ...over,
  };
}
const ctx = (over = {}) => ({ now: 5000, pausedTabs: new Set(), activeTabs: new Set([7]), ...over });
const evalReq = (details, rules, snap = emptySnapshot(), stage = 'request', c = ctx()) =>
  evaluateRequest(details, stage, rules, snap, c);

/* ------------------------------ page traffic ------------------------------- */

await check('isPageTraffic: http(s)/ws only, extension/browser initiators skipped, tabId -1 only for web initiators', () => {
  assert.equal(isPageTraffic(req()), true);
  assert.equal(isPageTraffic(req({ url: 'wss://shop.example.com/socket' })), true);
  assert.equal(isPageTraffic(req({ url: 'data:text/plain,x' })), false);
  assert.equal(isPageTraffic(req({ url: 'about:blank' })), false);
  assert.equal(isPageTraffic(req({ originUrl: 'moz-extension://abc/tool.html', documentUrl: undefined })), false);
  assert.equal(isPageTraffic(req({ originUrl: undefined, documentUrl: undefined })), true, 'top-level navigation');
  // Service worker fetch: tab-less but initiated by web content → page traffic.
  assert.equal(isPageTraffic(req({ tabId: -1, originUrl: 'https://shop.example.com/sw.js', documentUrl: undefined })), true);
  // Browser plumbing: tab-less and no web initiator → not ours.
  assert.equal(isPageTraffic(req({ tabId: -1, originUrl: undefined, documentUrl: undefined })), false);
});

/* -------------------------------- filters --------------------------------- */

await check('typesFilterFor: union of Firefox types (xhr→xmlhttprequest+json, image→image+imageset), any untyped rule → all', () => {
  const both = compiled(rule({ condition: { resourceTypes: ['xhr'] } }), rule({ condition: { resourceTypes: ['image'] } }));
  assert.deepEqual(typesFilterFor(both), ['image', 'imageset', 'json', 'xmlhttprequest']);
  assert.equal(typesFilterFor(compiled(rule({ condition: { resourceTypes: [] } }))), undefined);
  assert.equal(typesFilterFor(compiled(rule(), rule({ condition: { resourceTypes: undefined } }))), undefined);
  assert.deepEqual(typesFilterFor([]), []);
});

await check('stages: response conditions move a rule to onHeadersReceived; headers extraInfoSpec only when needed', () => {
  const plain = rule();
  const status = rule({ condition: { responseStatus: '5xx' } });
  const header = rule({ condition: { responseHeaders: [{ name: 'x-a', op: 'exists' }] } });
  assert.equal(stageOf(plain), 'request');
  assert.equal(stageOf(status), 'response');
  assert.equal(stageOf(header), 'response');
  assert.equal(hasResponseStage(compiled(plain)), false);
  assert.equal(hasResponseStage(compiled(plain, status)), true);
  assert.equal(needsResponseHeaders(compiled(plain, status)), false);
  assert.equal(needsResponseHeaders(compiled(header)), true);
});

/* ------------------------------- matching --------------------------------- */

await check('first-match by priority: the earlier rule wins, later rules are not even counted', () => {
  const a = rule({ id: 'a', priority: 1, action: { type: 'delay', ms: 100 } });
  const b = rule({ id: 'b', priority: 0, action: { type: 'block' } });
  const res = evalReq(req(), compiled(a, b));
  assert.equal(res.kind, 'apply');
  assert.equal(res.rule.rule.id, 'b', 'lower priority number runs first');
  assert.deepEqual(res.response, { cancel: true });
  assert.deepEqual(res.deltas.map((d) => d.ruleId), ['b']);
  assert.equal(res.next.counters[countKeyOf(a, { tabId: 7, url: '' })], undefined);
});

await check('a matched-but-not-applied rule is transparent: nth:2 lets the next rule act on the 1st request, fires on the 2nd', () => {
  const a = rule({ id: 'a', priority: 0, state: { kind: 'nth', n: 2 }, action: { type: 'fail', reason: 'TimedOut' } });
  const b = rule({ id: 'b', priority: 1, action: { type: 'delay', ms: 50 } });
  const rules = compiled(a, b);
  const r1 = evalReq(req(), rules);
  assert.equal(r1.kind, 'apply');
  assert.equal(r1.rule.rule.id, 'b');
  assert.equal(r1.delayMs, 50);
  assert.deepEqual(r1.deltas.map((d) => [d.ruleId, d.counter.seen, d.counter.hits]), [['a', 1, 0], ['b', 1, 1]]);
  const r2 = evalReq(req(), rules, r1.next);
  assert.equal(r2.rule.rule.id, 'a');
  assert.deepEqual(r2.response, { cancel: true });
  assert.equal(r2.degraded, 'ffFailCancel');
  assert.equal(r2.counter.seen, 2);
  assert.equal(r2.counter.hits, 1);
  const r3 = evalReq(req(), rules, r2.next);
  assert.equal(r3.rule.rule.id, 'b', 'nth:2 without every fires only once');
});

await check('type mapping: xmlhttprequest/json → xhr, imageset → image, beacon → other', () => {
  const xhr = compiled(rule({ condition: { resourceTypes: ['xhr'] } }));
  assert.equal(evalReq(req({ type: 'xmlhttprequest' }), xhr).kind, 'apply');
  assert.equal(evalReq(req({ type: 'json' }), xhr).kind, 'apply');
  assert.equal(evalReq(req({ type: 'image' }), xhr).kind, 'pass');
  const image = compiled(rule({ condition: { resourceTypes: ['image'] } }));
  assert.equal(evalReq(req({ type: 'imageset' }), image).kind, 'apply');
  const other = compiled(rule({ condition: { resourceTypes: ['other'] } }));
  assert.equal(evalReq(req({ type: 'beacon' }), other).kind, 'apply');
  assert.equal(evalReq(req({ type: 'speculative' }), other).kind, 'apply');
  assert.equal(evalReq(req({ type: 'xmlhttprequest' }), other).kind, 'pass');
  const any = compiled(rule({ condition: { resourceTypes: [] } }));
  assert.equal(evalReq(req({ type: 'font' }), any).kind, 'apply', 'no types = every type');
});

await check('page domain via originUrl (suffix match), documentUrl as fallback, unknown page → no match', () => {
  const rules = compiled(rule({ condition: { pageDomains: ['shop.example.com'] } }));
  assert.equal(evalReq(req({ originUrl: 'https://a.b.shop.example.com/x' }), rules).kind, 'apply');
  assert.equal(evalReq(req({ originUrl: 'https://notshop.example.com/x' }), rules).kind, 'pass');
  assert.equal(evalReq(req({ originUrl: 'https://evil.com/?shop.example.com' }), rules).kind, 'pass');
  assert.equal(evalReq(req({ originUrl: undefined, documentUrl: 'https://shop.example.com/doc' }), rules).kind, 'apply');
  assert.equal(evalReq(req({ originUrl: undefined, documentUrl: undefined }), rules).kind, 'pass');
});

await check('method and url conditions: POST-only rule ignores GET; url ops via @blur/netcore', () => {
  const post = compiled(rule({ condition: { methods: ['POST'] } }));
  assert.equal(evalReq(req({ method: 'GET' }), post).kind, 'pass');
  assert.equal(evalReq(req({ method: 'post' }), post).kind, 'apply', 'method compared case-insensitively');
  const rx = compiled(rule({ condition: { url: { op: 'regex', value: '/api/(cart|checkout)$' } } }));
  assert.equal(evalReq(req({ url: 'https://h/api/cart' }), rx).kind, 'apply');
  assert.equal(evalReq(req({ url: 'https://h/api/cartx' }), rx).kind, 'pass');
  const wc = compiled(rule({ condition: { url: { op: 'wildcard', value: 'https://h/api/*' } } }));
  assert.equal(evalReq(req({ url: 'https://h/api/anything?x' }), wc).kind, 'apply');
  const eq = compiled(rule({ condition: { url: { op: 'equals', value: 'https://h/api/x' } } }));
  assert.equal(evalReq(req({ url: 'https://h/api/x' }), eq).kind, 'apply');
  assert.equal(evalReq(req({ url: 'https://h/api/x?y' }), eq).kind, 'pass');
});

await check('response status in the headers stage: never at request stage; 5xx on 500 → cancel with wr↓ for `status`', () => {
  const rules = compiled(rule({ condition: { responseStatus: '5xx' }, action: { type: 'status', code: 503 } }));
  assert.equal(evalReq(req(), rules, emptySnapshot(), 'request').kind, 'pass');
  const r200 = evalReq(req({ statusCode: 200 }), rules, emptySnapshot(), 'response');
  assert.equal(r200.kind, 'pass');
  assert.equal(r200.deltas.length, 0, 'a non-matching response does not count');
  const r500 = evalReq(req({ statusCode: 500 }), rules, emptySnapshot(), 'response');
  assert.equal(r500.kind, 'apply');
  assert.deepEqual(r500.response, { cancel: true });
  assert.equal(r500.degraded, 'ffStatusCancel');
  // A plain block on a real 5xx is exact — no degradation flag.
  const blk = compiled(rule({ condition: { responseStatus: '500-599' }, action: { type: 'block' } }));
  const rb = evalReq(req({ statusCode: 503 }), blk, emptySnapshot(), 'response');
  assert.equal(rb.kind, 'apply');
  assert.equal(rb.degraded, undefined);
  // Missing statusCode (should not happen at this stage) fails open.
  assert.equal(evalReq(req(), blk, emptySnapshot(), 'response').kind, 'pass');
});

await check('response headers: exists / equals / contains, names and values case-insensitive, all conditions must hold', () => {
  const headers = [
    { name: 'Content-Type', value: 'application/JSON; charset=utf-8' },
    { name: 'X-Cache', value: 'HIT' },
  ];
  const mk = (...conds) => compiled(rule({ condition: { responseHeaders: conds } }));
  const at = (rules, h) => evalReq(req({ statusCode: 200, responseHeaders: h }), rules, emptySnapshot(), 'response').kind;
  assert.equal(at(mk({ name: 'x-cache', op: 'exists' }), headers), 'apply');
  assert.equal(at(mk({ name: 'x-missing', op: 'exists' }), headers), 'pass');
  assert.equal(at(mk({ name: 'x-cache', op: 'equals', value: 'hit' }), headers), 'apply');
  assert.equal(at(mk({ name: 'x-cache', op: 'equals', value: 'hi' }), headers), 'pass');
  assert.equal(at(mk({ name: 'content-type', op: 'contains', value: 'json' }), headers), 'apply');
  assert.equal(at(mk({ name: 'content-type', op: 'contains', value: 'json' }, { name: 'x-cache', op: 'equals', value: 'MISS' }), headers), 'pass');
  assert.equal(at(mk({ name: 'x-cache', op: 'exists' }), undefined), 'pass', 'no headers delivered → no match');
});

await check('degradation table: block → cancel; fail → cancel + ffFailCancel; status → cancel + ffStatusCancel; delay → {} + ms', () => {
  assert.deepEqual(responseFor({ type: 'block' }), { response: { cancel: true } });
  assert.deepEqual(responseFor({ type: 'fail', reason: 'ConnectionReset' }), { response: { cancel: true }, degraded: 'ffFailCancel' });
  assert.deepEqual(responseFor({ type: 'status', code: 503, body: '{}' }), { response: { cancel: true }, degraded: 'ffStatusCancel' });
  assert.deepEqual(responseFor({ type: 'delay', ms: 800 }), { response: {}, delayMs: 800 });
  // The compiled rule carries the same honesty key from engine-select.
  const [c] = compiled(rule({ action: { type: 'fail', reason: 'Failed' } }));
  assert.equal(c.degraded, 'ffFailCancel');
  const r = evalReq(req(), [c]);
  assert.equal(r.degraded, 'ffFailCancel');
});

await check('paused tab: skipped without counting; other tabs and tab-less SW requests unaffected', () => {
  const rules = compiled(rule({ state: { kind: 'once' } }));
  const c = ctx({ pausedTabs: new Set([7]) });
  const r = evaluateRequest(req({ tabId: 7 }), 'request', rules, emptySnapshot(), c);
  assert.deepEqual(r, { kind: 'skip', reason: 'paused' });
  assert.equal(evaluateRequest(req({ tabId: 8 }), 'request', rules, emptySnapshot(), c).kind, 'apply');
  const sw = req({ tabId: -1, originUrl: 'https://shop.example.com/sw.js', documentUrl: undefined });
  assert.equal(evaluateRequest(sw, 'request', rules, emptySnapshot(), c).kind, 'apply');
  assert.deepEqual(evalReq(req({ url: 'about:blank' }), rules), { kind: 'skip', reason: 'notPageTraffic' });
});

await check('tabId -1: counted under |t-1, never matches scope activeTab; activeTab rules follow ctx.activeTabs', () => {
  const all = compiled(rule({ id: 'all', countKey: 'rule+tab' }));
  const sw = req({ tabId: -1, originUrl: 'https://shop.example.com/sw.js', documentUrl: undefined });
  const r = evalReq(sw, all);
  assert.equal(r.kind, 'apply');
  assert.equal(r.deltas[0].key, 'all|t-1');
  const scoped = compiled(rule({ id: 'act', scope: 'activeTab' }));
  assert.equal(evalReq(sw, scoped).kind, 'pass');
  assert.equal(evalReq(req({ tabId: 7 }), scoped, emptySnapshot(), 'request', ctx({ activeTabs: new Set([7]) })).kind, 'apply');
  assert.equal(evalReq(req({ tabId: 7 }), scoped, emptySnapshot(), 'request', ctx({ activeTabs: new Set([9]) })).kind, 'pass');
});

await check('mergeDeltas: replaces the delta keys and marks the rule matched, leaves the rest', () => {
  const snap = { counters: { x: { seen: 9, hits: 9 } }, matched: { q: 1 } };
  const out = mergeDeltas(snap, [{ key: 'k', counter: { seen: 1, hits: 1 }, ruleId: 'r', now: 42 }]);
  assert.deepEqual(out, { counters: { x: { seen: 9, hits: 9 }, k: { seen: 1, hits: 1 } }, matched: { q: 1, r: 42 } });
  assert.equal(mergeDeltas(snap, []), snap);
});

/* ------------------------------- state cache ------------------------------ */

/** A fake store: controllable read + serialised writes with a hook to delay acks. */
function fakeStore(initial = emptySnapshot()) {
  let stored = initial;
  const acks = [];
  const s = {
    stored: () => stored,
    readResolve: null,
    read: () =>
      new Promise((resolve) => {
        s.readResolve = () => resolve(stored);
      }),
    write: (mutate) =>
      new Promise((resolve) => {
        stored = mutate(stored);
        acks.push(() => resolve(stored));
      }),
    ack: () => acks.shift()?.(),
    pendingAcks: () => acks.length,
  };
  return s;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

await check('StateCache cold read: warm after the store answers; timeout → empty snapshot, one error, request proceeds', async () => {
  // Warm path.
  const s1 = fakeStore({ counters: { k: { seen: 3, hits: 1 } }, matched: {} });
  const c1 = new StateCache(s1, { timeoutMs: 200 });
  assert.equal(c1.warm, false);
  const p = c1.ready();
  s1.readResolve();
  await p;
  assert.equal(c1.warm, true);
  assert.equal(c1.snapshot().counters.k.seen, 3);
  assert.equal(c1.coldTimedOut, false);

  // Cold path with a hanging read and fake timers.
  const timers = [];
  const errors = [];
  const s2 = fakeStore({ counters: { k: { seen: 3, hits: 1 } }, matched: {} });
  const c2 = new StateCache(s2, {
    timeoutMs: STATE_COLD_TIMEOUT_MS,
    setTimeout: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimeout: () => {},
    onError: (m) => errors.push(m),
  });
  let readyResolved = false;
  const p2 = c2.ready().then(() => (readyResolved = true));
  const p3 = c2.ready();
  assert.equal(p3, c2.ready(), 'concurrent callers share one hydration');
  await tick();
  assert.equal(readyResolved, false, 'not ready before the timeout');
  assert.equal(timers[0].ms, 200);
  timers[0].fn();
  await p2;
  assert.equal(c2.warm, true);
  assert.equal(c2.coldTimedOut, true);
  assert.deepEqual(c2.snapshot(), emptySnapshot());
  assert.equal(errors.length, 1);
  assert.match(errors[0], /timed out after 200 ms/);
  // A decision made meanwhile is kept when the late read lands.
  void c2.commit([{ key: 'k', counter: { seen: 1, hits: 1 }, ruleId: 'r', now: 1 }]);
  s2.readResolve();
  await tick();
  assert.equal(c2.snapshot().counters.k.seen, 1, 'pending overlay beats the late base');
  s2.ack();
  await tick();
  assert.equal(c2.snapshot().counters.k.seen, 1, 'write-through merged onto the stored snapshot');
  assert.equal(s2.stored().counters.k.seen, 1);
});

await check('StateCache overlay: two unacknowledged writes never regress; stale echo ignored; reset adopted', async () => {
  const s = fakeStore();
  const c = new StateCache(s, { timeoutMs: 200 });
  const p = c.ready();
  s.readResolve();
  await p;
  const d = (seen) => [{ key: 'k', counter: { seen, hits: seen }, ruleId: 'r', now: seen }];
  void c.commit(d(1));
  void c.commit(d(2));
  assert.equal(c.snapshot().counters.k.seen, 2);
  assert.equal(s.pendingAcks(), 2);
  s.ack(); // W1 acknowledged → base has seen=1, pending still has d2
  await tick();
  assert.equal(c.snapshot().counters.k.seen, 2, 'overlay keeps the newer decision');
  s.ack();
  await tick();
  assert.equal(c.snapshot().counters.k.seen, 2);
  // A late notification echoing W1 (seen=1) must not roll back.
  c.setBase({ counters: { k: { seen: 1, hits: 1 } }, matched: {} });
  assert.equal(c.snapshot().counters.k.seen, 2, 'stale echo ignored');
  // A background reset removed the key → adopted.
  c.setBase({ counters: {}, matched: {} });
  assert.equal(c.snapshot().counters.k, undefined, 'reset adopted');
  // A failed write keeps memory consistent and reports.
  const errors = [];
  const bad = new StateCache({ read: async () => emptySnapshot(), write: async () => { throw new Error('quota'); } }, { timeoutMs: 200, onError: (m) => errors.push(m) });
  await bad.ready();
  await bad.commit(d(5));
  assert.equal(bad.snapshot().counters.k.seen, 5);
  assert.match(errors[0], /state write failed: quota/);
});

/* ------------------------------- engine glue ------------------------------ */

/** A fake `browser` with just what the engine touches. */
function fakeBrowser() {
  const ev = () => {
    const ls = new Map();
    return {
      ls,
      addListener: (cb, filter, extra) => ls.set(cb, { filter, extra }),
      removeListener: (cb) => ls.delete(cb),
      hasListener: (cb) => ls.has(cb),
      fire: (details) => [...ls.keys()].map((cb) => cb(details)),
    };
  };
  const tabEv = () => {
    const ls = new Set();
    return { addListener: (cb) => ls.add(cb), removeListener: (cb) => ls.delete(cb), fire: (...a) => ls.forEach((cb) => cb(...a)) };
  };
  return {
    runtime: { id: 'fake' },
    webRequest: { onBeforeRequest: ev(), onHeadersReceived: ev(), onCompleted: ev(), onErrorOccurred: ev() },
    tabs: { query: async () => [{ id: 7, windowId: 1 }], onActivated: tabEv(), onRemoved: tabEv() },
  };
}

await check('engine: available only with the flag (Chrome build → false); apply without rules registers no blocking listener', async () => {
  const off = createWebRequestEngine(FIREFOX_CAPS, false);
  assert.equal(off.available, false);
  const on = createWebRequestEngine(FIREFOX_CAPS, true);
  assert.equal(on.available, true, 'no browser global (Node) → trust the flag');
  await on.apply(compileRules([], [], 'firefox', FIREFOX_CAPS, 0));
  await on.dispose();
  globalThis.browser = fakeBrowser();
  try {
    const e = createWebRequestEngine(FIREFOX_CAPS, true);
    assert.equal(e.available, true);
    await e.apply(compileRules([], [], 'firefox', FIREFOX_CAPS, 0));
    assert.equal(globalThis.browser.webRequest.onBeforeRequest.ls.size, 0, 'no rules → no blocking listener');
    assert.equal(globalThis.browser.webRequest.onCompleted.ls.size, 1, 'log observation is on');
    await e.dispose();
    assert.equal(globalThis.browser.webRequest.onCompleted.ls.size, 0);
    await e.dispose();
  } finally {
    delete globalThis.browser;
  }
});

await check('engine: filter narrowed by rule types, headers stage only when needed, re-apply idempotent, dispose removes all', async () => {
  globalThis.browser = fakeBrowser();
  try {
    const wr = globalThis.browser.webRequest;
    const e = createWebRequestEngine(FIREFOX_CAPS, true);
    const set1 = compileRules([rule({ id: 'a', condition: { resourceTypes: ['image'] } })], [], 'firefox', FIREFOX_CAPS, 0);
    await e.apply(set1);
    const [[cb1, reg1]] = [...wr.onBeforeRequest.ls];
    assert.deepEqual(reg1, { filter: { urls: ['<all_urls>'], types: ['image', 'imageset'] }, extra: ['blocking'] });
    assert.equal(wr.onHeadersReceived.ls.size, 0, 'no response-stage rule → no onHeadersReceived');
    await e.apply(set1);
    assert.equal([...wr.onBeforeRequest.ls.keys()][0], cb1, 'same set → listener untouched');
    const set2 = compileRules(
      [rule({ id: 'a', condition: { resourceTypes: ['image'] } }), rule({ id: 'h', condition: { resourceTypes: [], responseHeaders: [{ name: 'x', op: 'exists' }] } })],
      [], 'firefox', FIREFOX_CAPS, 0,
    );
    await e.apply(set2);
    const [[, reg2]] = [...wr.onBeforeRequest.ls];
    assert.deepEqual(reg2.filter, { urls: ['<all_urls>'] }, 'an untyped rule widens the filter to every type');
    const [[, hreg]] = [...wr.onHeadersReceived.ls];
    assert.deepEqual(hreg.extra, ['blocking', 'responseHeaders']);
    await e.dispose();
    assert.equal(wr.onBeforeRequest.ls.size + wr.onHeadersReceived.ls.size + wr.onCompleted.ls.size + wr.onErrorOccurred.ls.size, 0);
  } finally {
    delete globalThis.browser;
  }
});

await check('engine: block answers synchronously with {cancel:true}, emits hit + log(blocked); fail/status carry wr↓; delay returns a Promise resolved after ms', async () => {
  globalThis.browser = fakeBrowser();
  try {
    const wr = globalThis.browser.webRequest;
    const e = createWebRequestEngine(FIREFOX_CAPS, true);
    const events = [];
    e.onEvent((ev) => events.push(ev));
    await e.apply(compileRules([
      rule({ id: 'blk', condition: { url: { op: 'contains', value: '/blk' } } }),
      rule({ id: 'fl', condition: { url: { op: 'contains', value: '/fl' } }, action: { type: 'fail', reason: 'TimedOut' } }),
      rule({ id: 'st', condition: { url: { op: 'contains', value: '/st' } }, action: { type: 'status', code: 503 } }),
      rule({ id: 'dl', condition: { url: { op: 'contains', value: '/dl' } }, action: { type: 'delay', ms: 30 } }),
    ], [], 'firefox', FIREFOX_CAPS, 0));
    // In Node `../storage` cannot load (#imports) → the engine falls back to a
    // stateless mirror and says so once; the first request pays the cold path.
    const first = wr.onBeforeRequest.fire(req({ url: 'https://h/blk' }))[0];
    assert.ok(first instanceof Promise, 'cold mirror → async once');
    assert.deepEqual(await first, { cancel: true });
    assert.ok(events.some((ev) => ev.type === 'error' && /state store unavailable/.test(ev.message)));
    // Warm now: synchronous answers.
    const r2 = wr.onBeforeRequest.fire(req({ url: 'https://h/blk' }))[0];
    assert.deepEqual(r2, { cancel: true });
    const hit = events.filter((ev) => ev.type === 'hit').at(-1);
    assert.equal(hit.ruleId, 'blk');
    assert.equal(hit.approx, false);
    assert.equal(hit.degraded, undefined);
    const log = events.filter((ev) => ev.type === 'log').at(-1).entry;
    assert.equal(log.outcome, 'blocked');
    assert.equal(log.engine, 'webrequest');
    assert.deepEqual(log.marks, []);
    assert.equal(log.type, 'xhr');

    assert.deepEqual(wr.onBeforeRequest.fire(req({ url: 'https://h/fl' }))[0], { cancel: true });
    assert.equal(events.filter((ev) => ev.type === 'hit').at(-1).degraded, 'ffFailCancel');
    assert.equal(events.filter((ev) => ev.type === 'log').at(-1).entry.outcome, 'failed');
    assert.deepEqual(events.filter((ev) => ev.type === 'log').at(-1).entry.marks, ['degraded']);
    const st = req({ url: 'https://h/st' });
    assert.deepEqual(wr.onBeforeRequest.fire(st)[0], { cancel: true });
    assert.equal(events.filter((ev) => ev.type === 'hit').at(-1).degraded, 'ffStatusCancel');
    assert.equal(events.filter((ev) => ev.type === 'log').at(-1).entry.outcome, 'blocked');

    // A cancelled request's later onErrorOccurred must not produce a 2nd row.
    const rows = events.filter((ev) => ev.type === 'log').length;
    wr.onErrorOccurred.fire({ ...st, error: 'NS_ERROR_ABORT' });
    assert.equal(events.filter((ev) => ev.type === 'log').length, rows);

    // Delay: a Promise, resolved with {} after ≥ ms; the log row comes from onCompleted.
    const d = req({ url: 'https://h/dl' });
    const t0 = Date.now();
    const pr = wr.onBeforeRequest.fire(d)[0];
    assert.ok(pr instanceof Promise);
    assert.deepEqual(await pr, {});
    assert.ok(Date.now() - t0 >= 25, `waited ${Date.now() - t0} ms`);
    wr.onCompleted.fire({ ...d, statusCode: 200 });
    const drow = events.filter((ev) => ev.type === 'log').at(-1).entry;
    assert.equal(drow.outcome, 'delayed');
    assert.equal(drow.delayMs, 30);
    assert.equal(drow.status, 200);
    assert.equal(drow.ruleId, 'dl');

    // Plain traffic: one `passed` row with the status; tab-less rows are not logged.
    const plain = req({ url: 'https://h/other' });
    assert.equal(wr.onBeforeRequest.fire(plain)[0], undefined);
    wr.onCompleted.fire({ ...plain, statusCode: 204 });
    const prow = events.filter((ev) => ev.type === 'log').at(-1).entry;
    assert.equal(prow.outcome, 'passed');
    assert.equal(prow.status, 204);
    assert.equal(prow.ruleId, undefined);
    const n = events.filter((ev) => ev.type === 'log').length;
    wr.onCompleted.fire({ ...req({ tabId: -1, originUrl: 'https://h/sw.js', documentUrl: undefined }), statusCode: 200 });
    assert.equal(events.filter((ev) => ev.type === 'log').length, n, 'tabId -1 not logged');

    // Pause bypass and dispose releasing a parked delay (fail-open).
    await e.pauseTab(7);
    assert.equal(wr.onBeforeRequest.fire(req({ url: 'https://h/blk', tabId: 7 }))[0], undefined);
    await e.resumeTab(7);
    const parked = wr.onBeforeRequest.fire(req({ url: 'https://h/dl' }))[0];
    await e.dispose();
    assert.deepEqual(await parked, {}, 'dispose resolves pending delays');
  } finally {
    delete globalThis.browser;
  }
});

await check('engine: scope activeTab follows tabs.onActivated; a removed tab leaves the sets', async () => {
  globalThis.browser = fakeBrowser();
  try {
    const b = globalThis.browser;
    const e = createWebRequestEngine(FIREFOX_CAPS, true);
    await e.apply(compileRules([rule({ id: 's', scope: 'activeTab' })], [], 'firefox', FIREFOX_CAPS, 0));
    await b.webRequest.onBeforeRequest.fire(req({ tabId: 7 }))[0]; // cold path once
    assert.deepEqual(b.webRequest.onBeforeRequest.fire(req({ tabId: 7 }))[0], { cancel: true }, 'tab 7 active from tabs.query');
    assert.equal(b.webRequest.onBeforeRequest.fire(req({ tabId: 8 }))[0], undefined);
    b.tabs.onActivated.fire({ tabId: 8, windowId: 1 });
    assert.deepEqual(b.webRequest.onBeforeRequest.fire(req({ tabId: 8 }))[0], { cancel: true });
    assert.equal(b.webRequest.onBeforeRequest.fire(req({ tabId: 7 }))[0], undefined, 'previous active tab of the window dropped');
    await e.pauseTab(8);
    b.tabs.onRemoved.fire(8);
    assert.equal(b.webRequest.onBeforeRequest.fire(req({ tabId: 8 }))[0], undefined);
    await e.dispose();
  } finally {
    delete globalThis.browser;
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
