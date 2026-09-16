// Logic-level tests (Node, no browser) for the PURE half of the netblock DNR
// engine: extensions/netblock/utils/engines/dnr-translate.ts — translation,
// deterministic ids, the reconcile plan, the reactive reducer, recovery and
// the error mapping. Same loader as logic.test.mjs (real .ts via type
// stripping). Run:  npm run e2e:netblock-dnr
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

const T = await import(pathToFileURL(U('engines/dnr-translate.ts')).href);
const { compileRules, CHROME_DEFAULT_CAPS } = await import(pathToFileURL(U('engine-select.ts')).href);
const { defaultRule } = await import(pathToFileURL(U('rule-types.ts')).href);

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}\n       ${e.stack ?? e.message}`);
  }
}

const CAPS = { ...CHROME_DEFAULT_CAPS, dnrResponseHeaders: true };

/** A dnr-eligible rule (block, every) to mutate. */
function rule(id, over = {}) {
  const r = defaultRule(id, 1000);
  r.name = id;
  r.condition = { url: { op: 'contains', value: `/${id}/` }, resourceTypes: ['xhr'] };
  return { ...r, ...over };
}

/** compile → the dnr slice, priority order. */
function dnr(rules, caps = CAPS) {
  return compileRules(rules, [], 'chrome', caps, 5000).byEngine.dnr;
}

function desired(rules, over = {}) {
  return T.desiredRules({
    rules: dnr(rules),
    headersSupported: true,
    activeTabs: [],
    pausedTabs: [],
    reactive: T.emptyReactiveState(),
    ...over,
  });
}

console.log('dnr-translate: ids');

check('ruleIdFor/decodeRuleId round-trip; pause ids; foreign ids are null', () => {
  assert.deepEqual(T.decodeRuleId(T.ruleIdFor(0, 0)), { kind: 'rule', index: 0, slot: 0 });
  assert.deepEqual(T.decodeRuleId(T.ruleIdFor(7, 5)), { kind: 'rule', index: 7, slot: 5 });
  assert.equal(T.ruleIdFor(1, 0), 1 + T.SLOTS_PER_RULE);
  assert.deepEqual(T.decodeRuleId(T.pauseRuleIdFor(42)), { kind: 'pause', slot: 42 });
  assert.equal(T.decodeRuleId(T.pauseRuleIdFor(T.MAX_PAUSE_SLOTS)), null);
  assert.ok(T.ruleIdFor(T.MAX_RULE_INDEX, 0) < T.PAUSE_ID_BASE && T.pauseRuleIdFor(T.MAX_PAUSE_SLOTS) < 2 ** 31, 'ids fit a 32-bit signed int, ranges disjoint');
  assert.equal(T.decodeRuleId(0), null);
  assert.equal(T.decodeRuleId(-5), null);
  assert.equal(T.decodeRuleId(1.5), null);
  assert.ok(T.PAUSE_PRIORITY > 5000, 'pause priority above any rule priority');
});

console.log('dnr-translate: url translation');

check('contains → plain urlFilter; metacharacters fall back to escaped regexFilter', () => {
  assert.deepEqual(T.translateUrl({ op: 'contains', value: '/api/a' }), { urlFilter: '/api/a' });
  const r = T.translateUrl({ op: 'contains', value: 'a*b|c' });
  assert.equal(r.urlFilter, undefined);
  assert.equal(r.regexFilter, 'a\\*b\\|c');
  assert.ok(new RegExp(r.regexFilter).test('xa*b|cy'));
});

check('equals → |v|; wildcard → |g| (keeps *), ? forces regex; regex passes through; caseSensitive flag', () => {
  assert.deepEqual(T.translateUrl({ op: 'equals', value: 'http://h/x' }), { urlFilter: '|http://h/x|' });
  assert.deepEqual(T.translateUrl({ op: 'wildcard', value: '*cdn.example.com/*' }), { urlFilter: '|*cdn.example.com/*|' });
  const q = T.translateUrl({ op: 'wildcard', value: 'http://h/?.png' });
  assert.equal(q.urlFilter, undefined);
  assert.ok(new RegExp(q.regexFilter).test('http://h/a.png'));
  assert.ok(!new RegExp(q.regexFilter).test('http://h/ab.png'));
  assert.deepEqual(T.translateUrl({ op: 'regex', value: '^https?://h/\\d+$' }), { regexFilter: '^https?://h/\\d+$' });
  assert.deepEqual(T.translateUrl({ op: 'contains', value: 'X', caseSensitive: true }), { urlFilter: 'X', isUrlFilterCaseSensitive: true });
});

check('non-ASCII value is a translation problem, not a browser round-trip', () => {
  assert.deepEqual(T.translateUrl({ op: 'contains', value: 'пример' }), { problem: 'nonAscii' });
});

console.log('dnr-translate: condition translation');

check('methods lower-case, resource kinds mapped, page domains → initiatorDomains (punycode)', () => {
  const r = rule('r', {
    condition: {
      url: { op: 'contains', value: '/x' },
      methods: ['POST', 'GET'],
      resourceTypes: ['document', 'xhr'],
      pageDomains: ['Shop.Example.com', 'пример.рф'],
    },
  });
  const { condition, problem } = T.translateCondition(r, true);
  assert.equal(problem, undefined);
  assert.deepEqual(condition.requestMethods, ['post', 'get']);
  assert.deepEqual(condition.resourceTypes, ['main_frame', 'sub_frame', 'xmlhttprequest']);
  assert.deepEqual(condition.initiatorDomains, ['shop.example.com', 'xn--e1afmkfd.xn--p1ai']);
});

check('responseHeaders: exists/equals/contains → HeaderInfo; dropped when unsupported', () => {
  const r = rule('r', {
    condition: {
      url: { op: 'contains', value: '/x' },
      responseHeaders: [
        { name: 'X-A', op: 'exists' },
        { name: 'Content-Type', op: 'equals', value: 'text/html' },
        { name: 'x-err', op: 'contains', value: 'boom' },
      ],
    },
  });
  assert.deepEqual(T.translateCondition(r, true).condition.responseHeaders, [
    { header: 'x-a' },
    { header: 'content-type', values: ['text/html'] },
    { header: 'x-err', values: ['*boom*'] },
  ]);
  assert.equal(T.translateCondition(r, false).condition.responseHeaders, undefined);
});

check('websocket-only rule drops requestMethods (they would exclude non-HTTP requests)', () => {
  const r = rule('r', { condition: { url: { op: 'contains', value: '/ws' }, methods: ['GET'], resourceTypes: ['websocket'] } });
  assert.equal(T.translateCondition(r, true).condition.requestMethods, undefined);
  assert.deepEqual(T.translateCondition(r, true).condition.resourceTypes, ['websocket']);
});

console.log('dnr-translate: desired set');

check('stateless rules: positional ids, priority = N − index, sorted by id', () => {
  const out = desired([rule('a', { priority: 0 }), rule('b', { priority: 1 }), rule('c', { priority: 2 })]);
  assert.deepEqual(out.problems, []);
  assert.deepEqual(
    out.rules.map((r) => [r.id, r.priority, r.condition.urlFilter]),
    [
      [T.ruleIdFor(0, 0), 3, '/a/'],
      [T.ruleIdFor(1, 0), 2, '/b/'],
      [T.ruleIdFor(2, 0), 1, '/c/'],
    ],
  );
  assert.ok(out.rules.every((r) => r.action.type === 'block' && r.condition.tabIds === undefined));
});

check('scope activeTab → tabIds of the active tabs; no active tab → rule not installed', () => {
  const rules = [rule('a', { scope: 'activeTab' })];
  assert.deepEqual(desired(rules, { activeTabs: [9, 3] }).rules[0].condition.tabIds, [3, 9]);
  assert.equal(desired(rules).rules.length, 0);
});

check('paused tabs → allow rules with tabIds, PAUSE_PRIORITY, slot ids independent of the (huge) tab id', () => {
  const big = 2_034_254_951; // a real Chromium 153 tab id
  const out = desired([rule('a')], { pausedTabs: [big, 11] });
  const pauses = out.rules.filter((r) => r.action.type === 'allow');
  assert.deepEqual(pauses, [
    { id: T.pauseRuleIdFor(0), priority: T.PAUSE_PRIORITY, action: { type: 'allow' }, condition: { tabIds: [11] } },
    { id: T.pauseRuleIdFor(1), priority: T.PAUSE_PRIORITY, action: { type: 'allow' }, condition: { tabIds: [big] } },
  ]);
});

check('refused rule is skipped but keeps the index of the others; problems reported', () => {
  const rules = [rule('a'), rule('b'), rule('c', { condition: { url: { op: 'contains', value: 'юникод' } } })];
  const out = desired(rules, { refused: new Set(['a']) });
  assert.deepEqual(out.rules.map((r) => r.id), [T.ruleIdFor(1, 0)]);
  assert.deepEqual(out.problems, [{ ruleId: 'c', hint: 'nonAscii' }]);
});

check('reactive rule without armed instances installs nothing; armed instance → slot id + tabIds', () => {
  const rules = [rule('a'), rule('b', { state: { kind: 'afterRule', ruleId: 'a' } })];
  assert.equal(desired(rules).rules.length, 1);
  const armed = T.reactiveStep(T.emptyReactiveState(), dnr(rules), { type: 'matched', ruleId: 'a', tabId: 5, url: 'http://h/a/', applied: true }, 1000);
  const out = desired(rules, { reactive: armed }).rules;
  assert.equal(out.length, 2);
  const inst = out.find((r) => r.id === T.ruleIdFor(1, 1));
  assert.deepEqual(inst.condition.tabIds, [5]);
  assert.equal(inst.condition.urlFilter, '/b/');
});

console.log('dnr-translate: reconcile plan');

check('identical desired vs current → empty plan (idempotent apply)', () => {
  const a = desired([rule('a'), rule('b')]).rules;
  const b = desired([rule('a'), rule('b')]).rules;
  assert.deepEqual(T.planSessionUpdate(a, b), { removeRuleIds: [], addRules: [] });
});

check('changed rule → remove+add same id; stale → remove; foreign ids untouched; key order irrelevant', () => {
  const cur = desired([rule('a'), rule('b')]).rules;
  const want = desired([rule('a', { condition: { url: { op: 'contains', value: '/a2/' } } })]).rules;
  const foreign = { id: 999_999_999, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'x' } };
  const reordered = cur.map((r) => ({ condition: { ...r.condition }, action: r.action, priority: r.priority, id: r.id }));
  const plan = T.planSessionUpdate(want, [...reordered, foreign]);
  assert.deepEqual(plan.removeRuleIds, [T.ruleIdFor(0, 0), T.ruleIdFor(1, 0)]);
  assert.deepEqual(plan.addRules.map((r) => r.id), [T.ruleIdFor(0, 0)]);
  const after = T.applyPlan(reordered, plan);
  assert.deepEqual(T.planSessionUpdate(want, after), { removeRuleIds: [], addRules: [] });
});

console.log('dnr-translate: reactive reducer');

check('skipFirst: arms after `skip` observed matches, disarms after `times` hits', () => {
  const rules = dnr([rule('s', { state: { kind: 'skipFirst', skip: 2, times: 1 }, countKey: 'rule' })]);
  let st = T.emptyReactiveState();
  const m = (applied) => ({ type: 'matched', ruleId: 's', tabId: 1, url: 'http://h/s/', applied });
  st = T.reactiveStep(st, rules, m(false), 1);
  assert.equal(Object.keys(st.instances).length, 0, 'seen=1 < skip');
  st = T.reactiveStep(st, rules, m(false), 2);
  assert.equal(Object.keys(st.instances).length, 1, 'seen=2 ≥ skip → armed');
  assert.deepEqual(st.instances.s, { ruleId: 's', key: 's', slot: 1 });
  st = T.reactiveStep(st, rules, m(true), 3);
  assert.equal(Object.keys(st.instances).length, 0, 'hits=1 ≥ times → disarmed');
  st = T.reactiveStep(st, rules, m(false), 4);
  assert.equal(Object.keys(st.instances).length, 0, 'stays exhausted');
});

check('window: navigation trigger opens per-tab instance with expiry; tick after expiry drops it; nextExpiry', () => {
  const rules = dnr([rule('w', { state: { kind: 'window', trigger: 'navigation', seconds: 5 } })]);
  let st = T.reactiveStep(T.emptyReactiveState(), rules, { type: 'navigation', tabId: 4, url: 'http://h/' }, 10_000);
  assert.deepEqual(st.instances['w|t4'], { ruleId: 'w', key: 'w|t4', slot: 1, tabId: 4, until: 15_000 });
  assert.equal(T.nextExpiry(st), 15_000);
  st = T.reactiveStep(st, rules, { type: 'tick' }, 14_999);
  assert.equal(Object.keys(st.instances).length, 1);
  st = T.reactiveStep(st, rules, { type: 'tick' }, 15_000);
  assert.equal(Object.keys(st.instances).length, 0);
  assert.equal(T.nextExpiry(st), undefined);
});

check('afterRule: navigation reset (rule+tab only that tab), reset(A) un-arms B, tabRemoved drops tab keys', () => {
  const rules = dnr([rule('a'), rule('b', { state: { kind: 'afterRule', ruleId: 'a' } })]);
  const hit = (tabId) => ({ type: 'matched', ruleId: 'a', tabId, url: 'http://h/a/', applied: true });
  let st = T.reactiveStep(T.emptyReactiveState(), rules, hit(1), 1);
  st = T.reactiveStep(st, rules, hit(2), 2);
  assert.deepEqual(Object.keys(st.instances).sort(), ['b|t1', 'b|t2']);
  assert.deepEqual([st.instances['b|t1'].slot, st.instances['b|t2'].slot], [1, 2]);
  st = T.reactiveStep(st, rules, { type: 'navigation', tabId: 1, url: 'http://h/' }, 3);
  assert.deepEqual(Object.keys(st.instances), ['b|t2']);
  st = T.reactiveStep(st, rules, { type: 'tabRemoved', tabId: 2 }, 4);
  assert.deepEqual(Object.keys(st.instances), []);
  st = T.reactiveStep(st, rules, hit(3), 5);
  st = T.reactiveStep(st, rules, { type: 'reset', ruleId: 'a' }, 6);
  assert.deepEqual(Object.keys(st.instances), [], 'resetting A un-arms "B after A"');
});

check('url count key → per-URL instance anchored with |prefix (query stripped); metacharacters → global', () => {
  const rules = dnr([rule('s', { state: { kind: 'skipFirst', skip: 1 }, countKey: 'url' })]);
  let st = T.reactiveStep(T.emptyReactiveState(), rules, { type: 'matched', ruleId: 's', tabId: 1, url: 'http://h/s/x?q=1#f', applied: false }, 1);
  assert.equal(st.instances['s|uhttp://h/s/x'].urlPrefix, 'http://h/s/x');
  const out = T.desiredRules({ rules, headersSupported: true, activeTabs: [], pausedTabs: [], reactive: st }).rules;
  assert.equal(out[0].condition.urlFilter, '|http://h/s/x');
  st = T.reactiveStep(T.emptyReactiveState(), rules, { type: 'matched', ruleId: 's', tabId: 1, url: 'http://h/s/a*b', applied: false }, 1);
  assert.deepEqual(Object.keys(st.instances), ['s'], 'global fallback');
});

check('pruneReactive drops instances of rules that left the dnr slice', () => {
  const rules = dnr([rule('a'), rule('b', { state: { kind: 'afterRule', ruleId: 'a' } })]);
  const st = T.reactiveStep(T.emptyReactiveState(), rules, { type: 'matched', ruleId: 'a', tabId: 1, url: 'http://h/a/', applied: true }, 1);
  assert.equal(Object.keys(T.pruneReactive(st, rules)).length, 2);
  assert.deepEqual(T.pruneReactive(st, dnr([rule('a')])).instances, {});
});

console.log('dnr-translate: recovery + observation');

check('recoverReactive: afterRule instance recovered from session rules; dead tab and window dropped; mismatch dropped', () => {
  const rules = dnr([
    rule('a'),
    rule('b', { state: { kind: 'afterRule', ruleId: 'a' } }),
    rule('w', { state: { kind: 'window', trigger: 'navigation', seconds: 5 } }),
  ]);
  let st = T.reactiveStep(T.emptyReactiveState(), rules, { type: 'matched', ruleId: 'a', tabId: 1, url: 'u', applied: true }, 1);
  st = T.reactiveStep(st, rules, { type: 'matched', ruleId: 'a', tabId: 2, url: 'u', applied: true }, 2);
  st = T.reactiveStep(st, rules, { type: 'navigation', tabId: 1, url: 'http://h/' }, 3);
  st = T.reactiveStep(st, rules, { type: 'matched', ruleId: 'a', tabId: 1, url: 'u', applied: true }, 4);
  const session = T.desiredRules({ rules, headersSupported: true, activeTabs: [], pausedTabs: [], reactive: st }).rules;
  assert.equal(session.length, 4, 'a + b@1 + b@2 + w@1');
  const rec = T.recoverReactive(session, rules, true, new Set([1]));
  assert.deepEqual(Object.keys(rec.instances), ['b|t1']);
  assert.equal(rec.instances['b|t1'].slot, st.instances['b|t1'].slot);
  // Content drift (rule b's condition changed while the worker slept) → dropped.
  const changed = dnr([rule('a'), rule('b', { state: { kind: 'afterRule', ruleId: 'a' }, condition: { url: { op: 'contains', value: '/b2/' } } })]);
  assert.deepEqual(T.recoverReactive(session, changed, true, new Set([1])).instances, {});
});

check('recoverReactive: skipFirst instance recovers as armed with seen = skip', () => {
  const rules = dnr([rule('s', { state: { kind: 'skipFirst', skip: 3 }, countKey: 'rule' })]);
  const session = [{ id: T.ruleIdFor(0, 1), priority: 1, action: { type: 'block' }, condition: { urlFilter: '/s/', resourceTypes: ['xmlhttprequest'] } }];
  const rec = T.recoverReactive(session, rules, true, new Set());
  assert.deepEqual(rec.instances.s, { ruleId: 's', key: 's', slot: 1 });
  assert.deepEqual(rec.counters.s, { seen: 3, hits: 0 });
});

check('requestMatchesRule: url/method/type/initiator; coversTab honours tabIds and pause', () => {
  const r = rule('r', { condition: { url: { op: 'contains', value: '/api/' }, methods: ['POST'], resourceTypes: ['xhr'], pageDomains: ['example.com'] } });
  const ok = { url: 'http://h/api/x', method: 'post', kind: 'xhr', initiator: 'https://shop.example.com' };
  assert.equal(T.requestMatchesRule(r, ok), true);
  assert.equal(T.requestMatchesRule(r, { ...ok, method: 'GET' }), false);
  assert.equal(T.requestMatchesRule(r, { ...ok, kind: 'image' }), false);
  assert.equal(T.requestMatchesRule(r, { ...ok, initiator: 'https://other.org' }), false);
  assert.equal(T.requestMatchesRule(r, { ...ok, initiator: undefined }), false);
  const rules = dnr([rule('a', { scope: 'activeTab' }), rule('b')]);
  const installed = T.desiredRules({ rules, headersSupported: true, activeTabs: [7], pausedTabs: [8], reactive: T.emptyReactiveState() }).rules;
  assert.equal(T.coversTab(installed, rules, 'a', 7), true);
  assert.equal(T.coversTab(installed, rules, 'a', 6), false);
  assert.equal(T.coversTab(installed, rules, 'b', 6), true);
  assert.equal(T.coversTab(installed, rules, 'b', 8), false, 'paused tab');
  assert.equal(T.coversTab(installed, rules, 'zz', 6), false);
});

check('error mapping: id parsed from "Rule with id N"; hints per Chrome message', () => {
  assert.equal(T.parseRuleIdFromError('Rule with id 129 specifies an incorrect value for the "regexFilter" key.'), 129);
  assert.equal(T.parseRuleIdFromError('Session rule count exceeded.'), null);
  assert.equal(T.hintForDnrError('Rule with id 1 was skipped as the "regexFilter" value exceeded the 2KB memory limit when compiled.'), 'regexTooComplex');
  assert.equal(T.hintForDnrError('memoryLimitExceeded'), 'regexTooComplex');
  assert.equal(T.hintForDnrError('syntaxError'), 'regexInvalid');
  assert.equal(T.hintForDnrError('Rule with id 3 specifies an incorrect value for the "regexFilter" key.'), 'regexInvalid');
  assert.equal(T.hintForDnrError('Rule with id 2 cannot have non-ascii characters as part of "urlFilter" key.'), 'nonAscii');
  assert.equal(T.hintForDnrError('Session rule count for regex rules exceeded.'), 'tooManyRegexRules');
  assert.equal(T.hintForDnrError('Session rule count exceeded.'), 'tooManyRules');
  assert.equal(T.hintForDnrError('Internal error while updating session rules.'), 'unknown');
});

check('needsObservation: afterRule/skipFirst need webRequest on the site; window/every do not', () => {
  assert.equal(T.needsObservation(rule('a')), false);
  assert.equal(T.needsObservation(rule('a', { state: { kind: 'window', trigger: 'click', seconds: 1 } })), false);
  assert.equal(T.needsObservation(rule('a', { state: { kind: 'afterRule', ruleId: 'x' } })), true);
  assert.equal(T.needsObservation(rule('a', { state: { kind: 'skipFirst', skip: 1 } })), true);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
