// Logic-level tests (Node, no browser) for extensions/netblock/utils. They
// import the REAL source modules via Node's TS type stripping — shipping code,
// not a copy. Run:  npm run e2e:netblock-logic
//
// Two resolver hooks make the real modules loadable without a bundler:
//   - `@blur/netcore` → packages/netcore/src/index.ts (workspace package whose
//     `exports` points at a .ts file; resolved by path so realpath/node_modules
//     type-stripping rules never enter the picture);
//   - extensionless relative imports (`./url-match`) get `.ts` appended — the
//     package sources are written for the bundler, which allows that.
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

const { parseStatusPattern, statusMatches } = await import(pathToFileURL(U('status-match.ts')).href);
const { validateRule, validateRulesDocument, parseRulesImport, utf8Length } = await import(
  pathToFileURL(U('rule-schema.ts')).href
);
const { LIMITS, FAILURE_REASONS, BODY_CONTENT_TYPES, RESOURCE_KINDS, defaultRule } = await import(
  pathToFileURL(U('rule-types.ts')).href
);
const { toDnrTypes, toFirefoxTypes, toCdpTypes, fromDnrType, fromFirefoxType, fromCdpType, kindMatches } =
  await import(pathToFileURL(U('resource-types.ts')).href);
const { selectEngine, compileRules, CHROME_DEFAULT_CAPS, FIREFOX_CAPS } = await import(
  pathToFileURL(U('engine-select.ts')).href
);
const {
  decide,
  countKeyOf,
  emptySnapshot,
  openWindow,
  markMatched,
  resetCounters,
  resetForNavigation,
  forgetTab,
  mulberry32,
  fnv1a,
} = await import(pathToFileURL(U('state.ts')).href);
const { createLog, pushLog, maskHeaders, stripQuery, toHar, resizeLog, logSince, MAX_LOG_BYTES, MASK } =
  await import(pathToFileURL(U('log.ts')).href);
const { createEngines } = await import(pathToFileURL(U('engines/index.ts')).href);
const { recordHit } = await import(pathToFileURL(U('state.ts')).href);
const { OWN_REASON } = await import(pathToFileURL(U('log.ts')).href);
const { ruleFromLogEntry } = await import(pathToFileURL(U('rule-presets.ts')).href);
const { planRulesCommit, dependantsOf, deleteBlockedError } = await import(pathToFileURL(U('rules-commit.ts')).href);
const { isPrivilegedSender, isRelaySender } = await import(pathToFileURL(U('protocol.ts')).href);
const { readFileSync } = await import('node:fs');

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

/** A valid baseline rule to mutate in tests. */
function rule(over = {}) {
  const r = defaultRule('r1', 1000);
  r.name = 'test';
  r.condition = { url: { op: 'contains', value: '/api/' }, resourceTypes: ['xhr'] };
  return { ...r, ...over };
}

/* ------------------------------ status-match ------------------------------ */
console.log('status-match');
check('single code, class, range, union', () => {
  assert.equal(statusMatches('503', 503), true);
  assert.equal(statusMatches('503', 502), false);
  assert.equal(statusMatches('5xx', 500), true);
  assert.equal(statusMatches('5xx', 599), true);
  assert.equal(statusMatches('5xx', 499), false);
  assert.equal(statusMatches('429,500-599', 429), true);
  assert.equal(statusMatches('429,500-599', 550), true);
  assert.equal(statusMatches('429, 500 - 599', 430), false);
  const p = parseStatusPattern('4XX');
  assert.equal(p.ok, true);
  assert.deepEqual(p.ranges, [{ from: 400, to: 499 }]);
});
check('invalid patterns are refused with a reason and never match', () => {
  for (const bad of ['', '   ', '6xx', '99', '600', '500-400', '5xx,', 'abc', '50x', '1234']) {
    const p = parseStatusPattern(bad);
    assert.equal(p.ok, false, `expected ${JSON.stringify(bad)} to fail`);
    assert.equal(typeof p.error, 'string');
    assert.equal(statusMatches(bad, 500), false);
  }
  assert.equal(parseStatusPattern('x'.repeat(65)).ok, false);
  assert.equal(statusMatches('5xx', NaN), false);
  assert.equal(statusMatches('5xx', 500.5), false);
});

/* ------------------------------ rule-schema ------------------------------- */
console.log('rule-schema');
check('a well-formed rule validates and round-trips exactly', () => {
  const r = rule({
    groupId: 'g1',
    state: { kind: 'nth', n: 3, every: true },
    action: { type: 'status', code: 503, body: '{"error":"chaos"}', contentType: 'application/json' },
    condition: {
      url: { op: 'wildcard', value: '*cdn.example.com/*' },
      methods: ['POST', 'GET'],
      resourceTypes: ['xhr', 'image'],
      pageDomains: ['Shop.Example.com'],
      responseStatus: '5xx',
      responseHeaders: [{ name: 'Content-Type', op: 'contains', value: 'json' }],
    },
  });
  const v = validateRule(r, 0);
  assert.deepEqual(v.errors, []);
  assert.equal(v.rule.condition.pageDomains[0], 'shop.example.com');
  assert.equal(v.rule.condition.responseHeaders[0].name, 'content-type');
  assert.equal(v.rule.groupId, 'g1');
});
check('every action and state kind validates', () => {
  for (const reason of FAILURE_REASONS) assert.deepEqual(validateRule(rule({ action: { type: 'fail', reason } })).errors, []);
  for (const ct of BODY_CONTENT_TYPES) {
    const v = validateRule(rule({ action: { type: 'status', code: 500, body: 'x', contentType: ct } }));
    assert.deepEqual(v.errors, [], ct);
  }
  const states = [
    { kind: 'every' },
    { kind: 'once' },
    { kind: 'times', n: 2 },
    { kind: 'nth', n: 3 },
    { kind: 'skipFirst', skip: 5 },
    { kind: 'skipFirst', skip: 5, times: 2 },
    { kind: 'probability', percent: 30, seed: 42 },
    { kind: 'window', trigger: 'click', seconds: 30 },
  ];
  for (const state of states) assert.deepEqual(validateRule(rule({ state })).errors, [], state.kind);
  assert.deepEqual(validateRule(rule({ action: { type: 'delay', ms: 60000 } })).errors, []);
});
check('unknown fields are errors, not ignored (additionalProperties: false)', () => {
  const v = validateRule({ ...rule(), extra: 1 }, 3);
  assert.equal(v.rule, undefined);
  assert.deepEqual(v.errors, [{ index: 3, where: 'rules', path: 'extra', message: 'unknown field' }]);
  const v2 = validateRule(rule({ condition: { url: { op: 'contains', value: 'a', evil: true } } }));
  assert.equal(v2.errors[0].path, 'condition.url.evil');
  const v3 = validateRule(rule({ action: { type: 'block', reason: 'TimedOut' } }));
  assert.equal(v3.errors[0].path, 'action.reason');
});
check('__proto__ / constructor / prototype keys are refused everywhere', () => {
  const withProto = JSON.parse('{"__proto__": {"polluted": true}}');
  const v = validateRule({ ...rule(), ...withProto }, 0);
  // Spread does not copy __proto__ as own; build the object via JSON instead.
  const raw = JSON.parse(JSON.stringify(rule()).replace(/^\{/, '{"__proto__":{"x":1},'));
  const v1 = validateRule(raw, 0);
  assert.ok(v1.errors.some((e) => e.path === '__proto__' && e.message === 'forbidden key'));
  const raw2 = JSON.parse(JSON.stringify(rule()).replace('"condition":{', '"condition":{"constructor":{},'));
  const v2 = validateRule(raw2, 0);
  assert.ok(v2.errors.some((e) => e.path === 'condition.constructor'));
  const doc = JSON.parse('{"version":1,"rules":[],"groups":[],"prototype":1}');
  assert.equal(validateRulesDocument(doc).ok, false);
  assert.equal({}.polluted, undefined);
  void v;
});
check('size limits: body 64 KB, delay 60 s, url 2048, name 120, rules hard cap, import 2 MB', () => {
  const big = 'x'.repeat(LIMITS.bodyBytes + 1);
  assert.equal(validateRule(rule({ action: { type: 'status', code: 500, body: big } })).errors[0].path, 'action.body');
  assert.deepEqual(validateRule(rule({ action: { type: 'status', code: 500, body: 'é'.repeat(LIMITS.bodyBytes / 2) } })).errors, []);
  assert.equal(validateRule(rule({ action: { type: 'status', code: 500, body: 'é'.repeat(LIMITS.bodyBytes / 2 + 1) } })).errors.length, 1);
  assert.equal(validateRule(rule({ action: { type: 'delay', ms: 60001 } })).errors[0].path, 'action.ms');
  assert.equal(validateRule(rule({ condition: { url: { op: 'contains', value: 'x'.repeat(2049) } } })).errors[0].path, 'condition.url.value');
  assert.equal(validateRule(rule({ name: 'n'.repeat(121) })).errors[0].path, 'name');
  const many = { version: 1, groups: [], rules: Array.from({ length: LIMITS.rulesHard + 1 }, (_, i) => rule({ id: `r${i}` })) };
  const v = validateRulesDocument(many);
  assert.equal(v.ok, false);
  assert.match(v.errors[0].message, /more than 2000/);
  const imp = parseRulesImport('x'.repeat(LIMITS.importBytes + 1));
  assert.match(imp.errors[0].message, /larger than/);
  assert.equal(parseRulesImport('{not json').errors[0].message, 'not valid JSON');
  assert.equal(utf8Length('aé€😀'), 1 + 2 + 3 + 4);
});
check('regex conditions go through the ReDoS gate; text/html body needs status >= 400', () => {
  assert.equal(validateRule(rule({ condition: { url: { op: 'regex', value: '(a+)+$' } } })).errors[0].path, 'condition.url.value');
  assert.deepEqual(validateRule(rule({ condition: { url: { op: 'regex', value: '^https://[^/]+/api/' } } })).errors, []);
  const html2xx = validateRule(rule({ action: { type: 'status', code: 200, body: '<b>', contentType: 'text/html' } }));
  assert.equal(html2xx.errors[0].path, 'action.contentType');
  assert.deepEqual(validateRule(rule({ action: { type: 'status', code: 503, body: '<b>', contentType: 'text/html' } })).errors, []);
});
check('document: duplicate ids, unknown group, afterRule target, regex count, per-rule indices', () => {
  const doc = {
    version: 1,
    groups: [{ id: 'g1', name: 'G', enabled: true, order: 0 }],
    rules: [
      rule({ id: 'a' }),
      rule({ id: 'a' }),
      rule({ id: 'b', groupId: 'nope' }),
      rule({ id: 'c', state: { kind: 'afterRule', ruleId: 'zzz' } }),
      rule({ id: 'd', state: { kind: 'afterRule', ruleId: 'a' } }),
      { id: 'e' },
    ],
  };
  const v = validateRulesDocument(doc);
  assert.equal(v.ok, false);
  assert.deepEqual(v.doc.rules.map((r) => r.id), ['a', 'd']);
  assert.deepEqual(
    v.errors.map((e) => [e.index, e.path]),
    [
      [1, 'id'],
      [5, 'name'],
      [5, 'enabled'],
      [5, 'priority'],
      [5, 'createdAt'],
      [5, 'scope'],
      [5, 'condition'],
      [5, 'state'],
      [5, 'countKey'],
      [5, 'resetOn'],
      [5, 'action'],
      [2, 'groupId'],
      [3, 'state.ruleId'],
    ],
  );
  const regexDoc = {
    version: 1,
    groups: [],
    rules: Array.from({ length: LIMITS.regexRules + 1 }, (_, i) =>
      rule({ id: `r${i}`, condition: { url: { op: 'regex', value: `^https://h/${i}$` } } }),
    ),
  };
  const rv = validateRulesDocument(regexDoc);
  assert.equal(rv.doc.rules.length, LIMITS.regexRules);
  assert.match(rv.errors[0].message, /regex rules/);
  assert.equal(validateRulesDocument({ version: 2, rules: [], groups: [] }).ok, false);
  assert.equal(validateRulesDocument({ version: 1, rules: [] }).ok, true);
});

/* ----------------------------- resource-types ----------------------------- */
console.log('resource-types');
check('our names → browser types → our names round-trips for all three vocabularies', () => {
  for (const kind of RESOURCE_KINDS) {
    for (const t of toDnrTypes([kind])) assert.equal(fromDnrType(t), kind, `dnr ${t}`);
    for (const t of toFirefoxTypes([kind])) assert.equal(fromFirefoxType(t), kind, `ff ${t}`);
    for (const t of toCdpTypes([kind])) assert.equal(fromCdpType(t), kind, `cdp ${t}`);
  }
  assert.deepEqual(toDnrTypes(['xhr']), ['xmlhttprequest']);
  assert.deepEqual(toDnrTypes(['document']), ['main_frame', 'sub_frame']);
  assert.ok(toFirefoxTypes(['image']).includes('imageset'));
  assert.ok(toFirefoxTypes(['other']).includes('beacon'));
  assert.deepEqual(toCdpTypes(['xhr']).slice(0, 2), ['XHR', 'Fetch']);
  assert.equal(fromDnrType('ping'), 'other');
  assert.equal(fromFirefoxType('beacon'), 'other');
  assert.equal(fromDnrType('made-up'), 'other');
  assert.deepEqual(toDnrTypes(['xhr', 'xhr']), ['xmlhttprequest']);
});
check('kindMatches: absent/empty list = any type', () => {
  assert.equal(kindMatches(undefined, 'image'), true);
  assert.equal(kindMatches([], 'image'), true);
  assert.equal(kindMatches(['xhr'], 'image'), false);
  assert.equal(kindMatches(['xhr', 'image'], 'image'), true);
});

/* ------------------------------ engine-select ----------------------------- */
console.log('engine-select');
const C = { ...CHROME_DEFAULT_CAPS, dnrResponseHeaders: true };
const sel = (over, platform = 'chrome', caps = C) => selectEngine(rule(over), platform, caps);
check('1. stateless block on xhr → dnr with ≈ note', () => {
  const d = sel({});
  assert.equal(d.engine, 'dnr');
  assert.deepEqual(d.reasons, ['dnrCountApprox']);
  assert.equal(d.degraded, undefined);
});
check('2. block on all types (no resourceTypes) → dnr, websocket partially noted', () => {
  const d = sel({ condition: { url: { op: 'contains', value: 'x' } } });
  assert.equal(d.engine, 'dnr');
  assert.ok(d.reasons.includes('wsOnlyBlock'));
});
check('3. response status → never dnr; xhr → page (✱ note)', () => {
  const d = sel({ condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['xhr'], responseStatus: '5xx' } });
  assert.equal(d.engine, 'page');
  assert.ok(d.reasons.includes('pageNotNetwork'));
});
check('4. response headers + block → dnr half-block when RuleConditionKeys has it, page otherwise', () => {
  const cond = { url: { op: 'contains', value: 'x' }, resourceTypes: ['xhr'], responseHeaders: [{ name: 'x-err', op: 'exists' }] };
  const d = sel({ condition: cond });
  assert.equal(d.engine, 'dnr');
  assert.ok(d.reasons.includes('dnrHeadersHalfBlock'));
  const d2 = sel({ condition: cond }, 'chrome', { ...C, dnrResponseHeaders: false });
  assert.equal(d2.engine, 'page');
  assert.ok(d2.reasons.includes('dnrHeadersUnsupported'));
});
check('5. exact states (once/times/nth/probability) → page for xhr', () => {
  for (const state of [{ kind: 'once' }, { kind: 'times', n: 2 }, { kind: 'nth', n: 3 }, { kind: 'probability', percent: 30, seed: 1 }]) {
    assert.equal(sel({ state }).engine, 'page', state.kind);
  }
  assert.ok(sel({ state: { kind: 'probability', percent: 30, seed: 1 } }).reasons.includes('seedSameOrder'));
});
check('6. reactive states (afterRule/window/skipFirst) + block → dnr with parallel-slip note', () => {
  for (const state of [{ kind: 'afterRule', ruleId: 'r0' }, { kind: 'window', trigger: 'click', seconds: 5 }, { kind: 'skipFirst', skip: 3 }]) {
    const d = sel({ state });
    assert.equal(d.engine, 'dnr', state.kind);
    assert.ok(d.reasons.includes('reactiveParallelSlip'));
  }
});
check('7. delay / status on xhr → page; status 2xx adds the mock note', () => {
  assert.equal(sel({ action: { type: 'delay', ms: 100 } }).engine, 'page');
  const s = sel({ action: { type: 'status', code: 503 } });
  assert.equal(s.engine, 'page');
  assert.ok(!s.reasons.includes('status2xxIsMock'));
  assert.ok(sel({ action: { type: 'status', code: 200 } }).reasons.includes('status2xxIsMock'));
});
check('8. fail(reason) on xhr: debugger when available, else page degraded (reason imitated)', () => {
  const a = sel({ action: { type: 'fail', reason: 'TimedOut' } }, 'chrome', { ...C, debugger: true });
  assert.equal(a.engine, 'debugger');
  const b = sel({ action: { type: 'fail', reason: 'TimedOut' } });
  assert.equal(b.engine, 'page');
  assert.equal(b.degraded, 'failReasonImitated');
});
check('9. non-xhr types with non-block action → debugger; unsupported in the v1 build', () => {
  const d = sel({ condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['image'] }, action: { type: 'delay', ms: 10 } });
  assert.equal(d.engine, 'debugger');
  assert.equal(d.unsupported, 'nlUnavailableBuild');
  assert.ok(d.reasons.includes('nlBanner') && d.reasons.includes('needsNetworkLevel'));
  const live = sel(
    { condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['image'] }, action: { type: 'delay', ms: 10 } },
    'chrome',
    { ...C, debugger: true },
  );
  assert.equal(live.engine, 'debugger');
  assert.equal(live.unsupported, undefined);
});
check('10. response status on non-xhr (document) → debugger, never page', () => {
  const d = sel({ condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['document'] }, action: { type: 'block' }, state: { kind: 'every' } });
  assert.equal(d.engine, 'dnr');
  const d2 = sel({ condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['document'], responseStatus: '5xx' } });
  assert.equal(d2.engine, 'debugger');
});
check('11. websocket: block → dnr; fail/delay/status → unsupported (spike S4)', () => {
  const ws = { url: { op: 'contains', value: 'x' }, resourceTypes: ['websocket'] };
  assert.equal(sel({ condition: ws }).engine, 'dnr');
  for (const action of [{ type: 'fail', reason: 'Failed' }, { type: 'delay', ms: 1 }, { type: 'status', code: 503 }]) {
    const d = sel({ condition: ws, action }, 'chrome', { ...C, debugger: true });
    assert.equal(d.engine, null, action.type);
    assert.equal(d.unsupported, 'wsOnlyBlock');
  }
  assert.equal(sel({ condition: ws, state: { kind: 'once' } }).unsupported, 'wsOnlyBlock');
});
check('12. page engine disabled by pref → xhr delay needs debugger → unsupported', () => {
  const d = sel({ action: { type: 'delay', ms: 1 } }, 'chrome', { ...C, page: false });
  assert.equal(d.engine, 'debugger');
  assert.equal(d.unsupported, 'nlUnavailableBuild');
});
check('12b. shipped Chrome caps (debugger permission install-time) → debugger runs, never `nlUnavailableBuild`', () => {
  const NL = { ...C, debugger: true };
  const cases = [
    ['image + fail', { condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['image'] }, action: { type: 'fail', reason: 'TimedOut' } }],
    ['script + delay', { condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['script'] }, action: { type: 'delay', ms: 5 } }],
    ['font + status', { condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['font'] }, action: { type: 'status', code: 503 } }],
    ['xhr + fail(reason)', { action: { type: 'fail', reason: 'ConnectionReset' } }],
    ['all types + fail(reason)', { condition: { url: { op: 'contains', value: 'x' } }, action: { type: 'fail', reason: 'Failed' } }],
    ['image + response status', { condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['image'], responseStatus: '5xx' }, action: { type: 'fail', reason: 'InternetDisconnected' } }],
    ['document + delay (navigation)', { condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['document'] }, action: { type: 'delay', ms: 100 } }],
    ['page engine off + xhr delay', { action: { type: 'delay', ms: 1 } }, { ...NL, page: false }],
  ];
  for (const [name, over, caps] of cases) {
    const d = sel(over, 'chrome', caps ?? NL);
    assert.equal(d.engine, 'debugger', name);
    assert.equal(d.unsupported, undefined, name);
    assert.equal(d.degraded, undefined, name);
    assert.ok(d.reasons.includes('needsNetworkLevel') && d.reasons.includes('nlBanner') && d.reasons.includes('nlSlowsTab'), name);
  }
  // Cheap engines still win where they can: dnr for stateless block, page for xhr status/delay/exact counters.
  assert.equal(sel({}, 'chrome', NL).engine, 'dnr');
  assert.equal(sel({ action: { type: 'status', code: 503 } }, 'chrome', NL).engine, 'page');
  assert.equal(sel({ state: { kind: 'nth', n: 3 } }, 'chrome', NL).engine, 'page');
  // A mixed rule that includes websocket: honoured on the other types, noted for ws (spike S4).
  const mixed = sel({ condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['websocket', 'image'] }, action: { type: 'delay', ms: 1 } }, 'chrome', NL);
  assert.equal(mixed.engine, 'debugger');
  assert.ok(mixed.reasons.includes('wsOnlyBlock'));
  // compileRules with the shipped caps puts them on the debugger slice.
  const set = compileRules([rule({ id: 'nl', condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['image'] }, action: { type: 'fail', reason: 'TimedOut' } })], [], 'chrome', NL, 0);
  assert.equal(set.byEngine.debugger.length, 1);
  assert.equal(set.inactive.length, 0);
  const engines = createEngines('chrome', NL, { declarativeNetRequest: true, scripting: true, debugger: true, webRequestBlocking: false });
  assert.deepEqual(engines.map((e) => [e.id, e.available]), [['dnr', true], ['page', true], ['debugger', true]]);
  assert.equal(engines[2].supports(set.byEngine.debugger[0].rule), true);
});
check('13. Firefox: everything → webrequest; fail and status degrade (wr↓), delay/block do not', () => {
  assert.deepEqual(sel({}, 'firefox', FIREFOX_CAPS), { engine: 'webrequest', reasons: [] });
  assert.equal(sel({ action: { type: 'fail', reason: 'TimedOut' } }, 'firefox', FIREFOX_CAPS).degraded, 'ffFailCancel');
  assert.equal(sel({ action: { type: 'status', code: 503 } }, 'firefox', FIREFOX_CAPS).degraded, 'ffStatusCancel');
  assert.equal(sel({ action: { type: 'delay', ms: 5 } }, 'firefox', FIREFOX_CAPS).degraded, undefined);
  const st = sel({ condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['image'], responseStatus: '5xx' }, state: { kind: 'nth', n: 3 } }, 'firefox', FIREFOX_CAPS);
  assert.equal(st.engine, 'webrequest');
  assert.equal(st.unsupported, undefined);
  const ws = sel({ condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['websocket'] }, action: { type: 'delay', ms: 5 } }, 'firefox', FIREFOX_CAPS);
  assert.equal(ws.engine, 'webrequest');
});
check('14. pinned engine: honoured when possible, otherwise auto + preferenceIgnored', () => {
  assert.equal(sel({ engine: 'page' }).engine, 'page');
  const d = sel({ engine: 'dnr', state: { kind: 'once' } });
  assert.equal(d.engine, 'page');
  assert.ok(d.reasons.includes('preferenceIgnored'));
  assert.equal(sel({ engine: 'webrequest' }).engine, 'dnr');
});
check('compileRules: priority order, disabled rules/groups and unsupported rules go to inactive', () => {
  const rules = [
    rule({ id: 'b', priority: 2, createdAt: 1 }),
    rule({ id: 'a', priority: 1, createdAt: 2 }),
    rule({ id: 'off', enabled: false }),
    rule({ id: 'grp', groupId: 'g' }),
    rule({ id: 'ws', condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['websocket'] }, action: { type: 'delay', ms: 1 } }),
    rule({ id: 'img', condition: { url: { op: 'contains', value: 'x' }, resourceTypes: ['image'] }, action: { type: 'delay', ms: 1 } }),
    rule({ id: 'p', action: { type: 'delay', ms: 1 } }),
  ];
  const set = compileRules(rules, [{ id: 'g', name: '', enabled: false, order: 0 }], 'chrome', C, 5);
  assert.deepEqual(set.byEngine.dnr.map((c) => c.rule.id), ['a', 'b']);
  assert.deepEqual(set.byEngine.page.map((c) => c.rule.id), ['p']);
  assert.deepEqual(set.byEngine.debugger, []);
  assert.deepEqual(
    set.inactive.map((i) => [i.rule.id, i.reason]),
    [['off', 'disabled'], ['grp', 'groupDisabled'], ['ws', 'wsOnlyBlock'], ['img', 'nlUnavailableBuild']],
  );
  assert.equal(set.compiledAt, 5);
});

/* ---------------------------------- state --------------------------------- */
console.log('state');
const ctx = (tabId = 1, url = 'https://h/api/x?q=1', now = 1000) => ({ tabId, url, now });
function run(r, n, snap = emptySnapshot(), mk = () => ctx()) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = decide(r, snap, mk(i));
    out.push(d.apply);
    snap = d.next;
  }
  return { out, snap };
}
check('countKeyOf: rule / rule+tab / url (query stripped)', () => {
  assert.equal(countKeyOf({ id: 'r', countKey: 'rule' }, ctx()), 'r');
  assert.equal(countKeyOf({ id: 'r', countKey: 'rule+tab' }, ctx(7)), 'r|t7');
  assert.equal(countKeyOf({ id: 'r', countKey: 'rule+tab' }, { url: '' }), 'r|t-1');
  assert.equal(countKeyOf({ id: 'r', countKey: 'url' }, ctx(1, 'https://h/a?b=1#c')), 'r|uhttps://h/a');
});
check('every / once / times / nth / nth-every / skipFirst / skipFirst+times', () => {
  assert.deepEqual(run(rule({ state: { kind: 'every' } }), 3).out, [true, true, true]);
  assert.deepEqual(run(rule({ state: { kind: 'once' } }), 3).out, [true, false, false]);
  assert.deepEqual(run(rule({ state: { kind: 'times', n: 2 } }), 4).out, [true, true, false, false]);
  assert.deepEqual(run(rule({ state: { kind: 'nth', n: 3 } }), 7).out, [false, false, true, false, false, false, false]);
  assert.deepEqual(run(rule({ state: { kind: 'nth', n: 3, every: true } }), 7).out, [false, false, true, false, false, true, false]);
  assert.deepEqual(run(rule({ state: { kind: 'skipFirst', skip: 2 } }), 5).out, [false, false, true, true, true]);
  assert.deepEqual(run(rule({ state: { kind: 'skipFirst', skip: 2, times: 2 } }), 6).out, [false, false, true, true, false, false]);
  const { snap } = run(rule({ state: { kind: 'times', n: 2 } }), 4);
  assert.deepEqual(snap.counters['r1|t1'], { seen: 4, hits: 2, lastAt: 1000 });
});
check('counters are per key: tabs do not share, url key separates paths', () => {
  const r = rule({ state: { kind: 'once' } });
  let snap = emptySnapshot();
  const a = decide(r, snap, ctx(1));
  const b = decide(r, a.next, ctx(2));
  assert.deepEqual([a.apply, b.apply], [true, true]);
  const shared = rule({ state: { kind: 'once' }, countKey: 'rule' });
  const c = decide(shared, snap, ctx(1));
  const d = decide(shared, c.next, ctx(2));
  assert.deepEqual([c.apply, d.apply], [true, false]);
});
check('probability: deterministic for seed + order, ≈ percent over many draws, different per key', () => {
  const r = rule({ state: { kind: 'probability', percent: 30, seed: 42 } });
  const a = run(r, 200).out;
  const b = run(r, 200).out;
  assert.deepEqual(a, b);
  const hits = a.filter(Boolean).length;
  assert.ok(hits > 40 && hits < 80, `hits=${hits}`);
  const other = run(rule({ state: { kind: 'probability', percent: 30, seed: 43 } }), 200).out;
  assert.notDeepEqual(a, other);
  const tab2 = run(r, 200, emptySnapshot(), () => ctx(2)).out;
  assert.notDeepEqual(a, tab2);
  assert.deepEqual(run(rule({ state: { kind: 'probability', percent: 0, seed: 1 } }), 50).out.filter(Boolean), []);
  assert.equal(run(rule({ state: { kind: 'probability', percent: 100, seed: 1 } }), 50).out.every(Boolean), true);
  // PRNG primitives are stable (mulberry32 reference sequence).
  const s1 = mulberry32(1);
  const s2 = mulberry32(s1.next);
  assert.equal(s1.value, mulberry32(1).value);
  assert.ok(s1.value >= 0 && s1.value < 1 && s2.value >= 0 && s2.value < 1);
  assert.equal(fnv1a('a'), 0xe40c292c);
});
check('window: closed until opened, open for N seconds, then closed', () => {
  const r = rule({ state: { kind: 'window', trigger: 'click', seconds: 10 } });
  let snap = emptySnapshot();
  assert.equal(decide(r, snap, ctx(1, 'u', 1000)).apply, false);
  snap = openWindow(r, snap, ctx(1, 'u', 1000));
  assert.equal(decide(r, snap, ctx(1, 'u', 5000)).apply, true);
  assert.equal(decide(r, snap, ctx(1, 'u', 10999)).apply, true);
  assert.equal(decide(r, snap, ctx(1, 'u', 11000)).apply, false);
  assert.equal(decide(r, snap, ctx(2, 'u', 5000)).apply, false); // other tab's key
  assert.equal(openWindow(rule(), snap, ctx()), snap); // non-window rule: untouched
});
check('afterRule: fires only once the other rule has matched', () => {
  const a = rule({ id: 'a' });
  const b = rule({ id: 'b', state: { kind: 'afterRule', ruleId: 'a' } });
  let snap = emptySnapshot();
  assert.equal(decide(b, snap, ctx()).apply, false);
  snap = decide(a, snap, ctx()).next; // a matched (any decision counts as a match)
  assert.equal(decide(b, snap, ctx()).apply, true);
  const viaMark = markMatched(emptySnapshot(), 'a', 1);
  assert.equal(decide(b, viaMark, ctx()).apply, true);
});
check('resets: manual per rule / all, navigation per tab, forgetTab', () => {
  const r1 = rule({ id: 'r1', state: { kind: 'once' } });
  const r2 = rule({ id: 'r2', state: { kind: 'once' }, countKey: 'rule', resetOn: 'session' });
  let snap = emptySnapshot();
  snap = decide(r1, snap, ctx(1)).next;
  snap = decide(r1, snap, ctx(2)).next;
  snap = decide(r2, snap, ctx(1)).next;
  assert.deepEqual(Object.keys(snap.counters).sort(), ['r1|t1', 'r1|t2', 'r2']);
  const nav = resetForNavigation(snap, [r1, r2], 1);
  assert.deepEqual(Object.keys(nav.counters).sort(), ['r1|t2', 'r2']);
  assert.equal(nav.matched.r1, 1000); // rule+tab keys keep the match mark
  const one = resetCounters(snap, 'r1');
  assert.deepEqual(Object.keys(one.counters), ['r2']);
  assert.equal(one.matched.r1, undefined);
  assert.deepEqual(resetCounters(snap), emptySnapshot());
  assert.deepEqual(Object.keys(forgetTab(snap, 2).counters).sort(), ['r1|t1', 'r2']);
  assert.equal(decide(r1, nav, ctx(1)).apply, true);
});

/* ----------------------------------- log ---------------------------------- */
console.log('log');
const entry = (over = {}) => ({
  time: 1_700_000_000_000,
  tabId: 1,
  method: 'GET',
  url: 'https://h/api/x?token=secret#frag',
  type: 'xhr',
  status: 200,
  outcome: 'passed',
  marks: [],
  ...over,
});
check('header masking is unconditional and case-insensitive; query stripping is a toggle', () => {
  const masked = maskHeaders({ Authorization: 'Bearer x', COOKIE: 'a=b', 'Set-Cookie': 'c', 'content-type': 'json', 'X-Api-Key': 'k' });
  assert.deepEqual(masked, { authorization: MASK, cookie: MASK, 'set-cookie': MASK, 'content-type': 'json', 'x-api-key': MASK });
  assert.equal(stripQuery('https://h/a?b=1#c'), 'https://h/a');
  assert.equal(stripQuery('https://h/a#c?d'), 'https://h/a');
  let buf = createLog(10);
  buf = pushLog(buf, entry({ headers: { Cookie: 'x', Server: 's' } }));
  assert.equal(buf.entries[0].url, 'https://h/api/x?token=secret#frag');
  assert.deepEqual(buf.entries[0].headers, { cookie: MASK, server: 's' });
  buf = pushLog(buf, entry(), true);
  assert.equal(buf.entries[1].url, 'https://h/api/x');
  assert.deepEqual(buf.entries.map((e) => e.id), [1, 2]);
});
check('ring buffer: entry cap, evicted counter, byte cap, resize, cursor', () => {
  let buf = createLog(3);
  for (let i = 0; i < 5; i++) buf = pushLog(buf, entry({ tabId: i }));
  assert.deepEqual(buf.entries.map((e) => e.tabId), [2, 3, 4]);
  assert.equal(buf.evicted, 2);
  assert.equal(buf.nextId, 6);
  assert.equal(buf.bytes, buf.entries.reduce((n, e) => n + JSON.stringify(e).length, 0));
  // Byte cap: entries ~1 MB each → at most 4 fit, then the oldest goes.
  let big = createLog(100);
  const fat = 'y'.repeat(1_000_000);
  for (let i = 0; i < 6; i++) big = pushLog(big, entry({ error: fat, tabId: i }));
  assert.ok(big.bytes <= MAX_LOG_BYTES);
  assert.ok(big.entries.length < 6 && big.entries.length >= 1);
  assert.equal(big.entries[big.entries.length - 1].tabId, 5);
  const shrunk = resizeLog(buf, 1);
  assert.deepEqual(shrunk.entries.map((e) => e.tabId), [4]);
  assert.equal(shrunk.evicted, 4);
  assert.deepEqual(logSince(buf, 3).map((e) => e.id), [4, 5]);
  assert.deepEqual(logSince(buf, 0, 1).map((e) => e.id), [5]);
  assert.deepEqual(logSince(buf, 99), []);
});
check('HAR 1.2 shape without bodies; masked headers ride along', () => {
  let buf = createLog(5);
  buf = pushLog(buf, entry({ status: 503, outcome: 'status', ruleId: 'r1', engine: 'page', marks: ['clientSide'], headers: { Authorization: 'x' } }));
  buf = pushLog(buf, entry({ status: undefined, outcome: 'blocked', error: 'net::ERR_BLOCKED_BY_CLIENT', engine: 'dnr', marks: ['approx'] }));
  const har = toHar(buf.entries, '1.0.0');
  assert.equal(har.log.version, '1.2');
  assert.equal(har.log.creator.name, 'Request Blocker');
  assert.equal(har.log.entries.length, 2);
  const [a, b] = har.log.entries;
  assert.equal(a.request.method, 'GET');
  assert.equal(a.response.status, 503);
  assert.deepEqual(a.response.headers, [{ name: 'authorization', value: MASK }]);
  assert.equal(a.response.content.size, -1);
  assert.equal('text' in a.response.content, false);
  assert.deepEqual(a._marks, ['✱']);
  assert.equal(a._ruleId, 'r1');
  assert.equal(b.response.status, 0);
  assert.equal(b.response._error, 'net::ERR_BLOCKED_BY_CLIENT');
  assert.deepEqual(b._marks, ['≈']);
  assert.equal(a.startedDateTime, new Date(entry().time).toISOString());
  JSON.stringify(har); // serialisable
});

/* --------------------------------- engines -------------------------------- */
console.log('engines');
check('createEngines: ladder per platform, availability from detected APIs, stubs honour the contract', async () => {
  const chrome = createEngines('chrome', C, { declarativeNetRequest: true, scripting: true, debugger: false, webRequestBlocking: false });
  assert.deepEqual(chrome.map((e) => [e.id, e.available]), [['dnr', true], ['page', true], ['debugger', false]]);
  const ff = createEngines('firefox', FIREFOX_CAPS, { declarativeNetRequest: false, scripting: false, debugger: false, webRequestBlocking: true });
  assert.deepEqual(ff.map((e) => [e.id, e.available]), [['webrequest', true]]);
  assert.equal(chrome[0].supports(rule()), true);
  assert.equal(chrome[1].supports(rule()), false);
  assert.equal(chrome[1].supports(rule({ state: { kind: 'once' } })), true);
  assert.equal(ff[0].supports(rule({ action: { type: 'fail', reason: 'Failed' } })), true);
  const set = compileRules([rule()], [], 'chrome', C, 0);
  for (const e of chrome) {
    const off = e.onEvent(() => {});
    off();
    await e.apply(set);
    await e.pauseTab(1);
    await e.resumeTab(1);
    await e.dispose();
    await e.dispose();
  }
});

/* --------------------------- integration (phase 3) --------------------------- */
console.log('integration');
check('recordHit: an approximate (DNR) hit counts seen + hits under the rule key and marks the rule', () => {
  const r = rule({ countKey: 'rule+tab' });
  let snap = emptySnapshot();
  snap = recordHit(r, snap, { tabId: 7, url: 'https://a/x', now: 100 });
  snap = recordHit(r, snap, { tabId: 7, url: 'https://a/y', now: 200 });
  const key = countKeyOf(r, { tabId: 7, url: '' });
  assert.deepEqual(snap.counters[key], { seen: 2, hits: 2, lastAt: 200 });
  assert.equal(snap.matched[r.id], 200);
  assert.equal(snap.counters[countKeyOf(r, { tabId: 8, url: '' })], undefined);
});
check('OWN_REASON strings are the ones the debugger engine emits (UI translation table stays in step)', () => {
  assert.equal(OWN_REASON.handlerErrors, 'handler errors (3 in a row)');
  assert.equal(OWN_REASON.watchdog, 'released hung request (watchdog)');
});
check('log entries keep initiatorHost through pushLog (host only; query stripping never touches it)', () => {
  const buf = pushLog(createLog(10), { time: 1, tabId: 1, method: 'GET', url: 'https://a/x?secret=1', type: 'xhr', outcome: 'passed', marks: [], initiatorHost: 'shop.example.com' }, true);
  assert.equal(buf.entries[0].initiatorHost, 'shop.example.com');
  assert.equal(buf.entries[0].url, 'https://a/x');
});
check('ruleFromLogEntry: page domain pre-filled from initiatorHost (host only), not for "block this URL"', () => {
  const entry = { id: 1, time: 1, tabId: 1, method: 'post', url: 'https://shop.example.com/api/checkout?token=x', type: 'xhr', outcome: 'passed', marks: [], initiatorHost: 'Shop.Example.com' };
  const r = ruleFromLogEntry(entry, 'n1', 5, false);
  assert.deepEqual(r.condition.pageDomains, ['shop.example.com']);
  assert.deepEqual(r.condition.methods, ['POST']);
  assert.equal(r.condition.url.value, 'https://shop.example.com/api/checkout');
  assert.equal(validateRule(r).errors.length, 0);
  const b = ruleFromLogEntry(entry, 'n2', 5, true);
  assert.equal(b.condition.pageDomains, undefined);
  assert.equal(b.condition.methods, undefined);
  const noHost = ruleFromLogEntry({ ...entry, initiatorHost: undefined }, 'n3', 5, false);
  assert.equal(noHost.condition.pageDomains, undefined);
});

/** `defaultRule` has an empty URL (the editor fills it) — a stored rule must have one. */
const savedRule = (id, t) => ({ ...defaultRule(id, t), condition: { url: { op: 'contains', value: '/api' }, resourceTypes: ['xhr'] } });
check('planRulesCommit: cross-rule invariants are enforced at write time, not only at the next load', () => {
  const a = { ...savedRule('a', 1), name: 'A' };
  const b = { ...savedRule('b', 2), name: 'B', state: { kind: 'afterRule', ruleId: 'a' } };
  const raw = { version: 1, rules: [a, b], groups: [] };
  // Deleting A would orphan B: refused, nothing written.
  const del = planRulesCommit(raw, (doc) => ({ ...doc, rules: doc.rules.filter((r) => r.id !== 'a') }));
  assert.equal(del.ok, false);
  assert.ok(del.errors.some((e) => e.message === 'unknown rule' && e.path === 'state.ruleId'));
  assert.deepEqual(dependantsOf(raw, 'a').map((r) => r.id), ['b']);
  assert.match(deleteBlockedError(dependantsOf(raw, 'a')).message, /"B" follows this rule/);
  // A rule pointing at a group that does not exist: refused.
  const grp = planRulesCommit(raw, (doc) => ({ ...doc, rules: [...doc.rules, { ...savedRule('c', 3), groupId: 'nope' }] }));
  assert.equal(grp.ok, false);
  assert.ok(grp.errors.some((e) => e.message === 'unknown group'));
  // A group object that is not a group (what an unvalidated `saveGroup` used to store): refused.
  const badGroup = planRulesCommit(raw, (doc) => ({ ...doc, groups: [{ id: 'g', name: 'x', enabled: true, order: 0, extra: 1 }] }));
  assert.equal(badGroup.ok, false);
  // Regex cap counts across the WHOLE document.
  const many = Array.from({ length: LIMITS.regexRules + 1 }, (_, i) => ({ ...savedRule(`re${i}`, i), condition: { url: { op: 'regex', value: `^https://a/${i}$` } } }));
  const re = planRulesCommit({ version: 1, rules: [], groups: [] }, (doc) => ({ ...doc, rules: many }));
  assert.equal(re.ok, false);
  assert.ok(re.errors.some((e) => /regex rules/.test(e.message)));
  // Byte cap on the serialised document.
  const fat = Array.from({ length: 40 }, (_, i) => ({ ...savedRule(`fat${i}`, i), action: { type: 'status', code: 503, body: 'x'.repeat(60 * 1024) } }));
  const bytes = planRulesCommit({ version: 1, rules: [], groups: [] }, (doc) => ({ ...doc, rules: fat }));
  assert.equal(bytes.ok, false);
  assert.ok(bytes.errors.some((e) => /larger than/.test(e.message)));
  // A valid mutation: ok + changed; a no-op mutation reports changed=false.
  const okPlan = planRulesCommit(raw, (doc) => ({ ...doc, rules: [...doc.rules, savedRule('c', 3)] }));
  assert.equal(okPlan.ok, true);
  assert.equal(okPlan.changed, true);
  assert.equal(okPlan.doc.rules.length, 3);
  const noop = planRulesCommit(JSON.parse(JSON.stringify(raw)), (doc) => doc);
  assert.equal(noop.ok && noop.changed, false);
});
check('planRulesCommit: storage is untrusted — invalid stored entries are reported and dropped, valid ones survive', () => {
  const raw = { version: 1, rules: [savedRule('a', 1), { id: 'zz', junk: true }], groups: [] };
  const plan = planRulesCommit(raw, (doc) => doc);
  assert.equal(plan.ok, true);
  assert.equal(plan.changed, true, 'the cleaned document differs from storage → written back');
  assert.deepEqual(plan.doc.rules.map((r) => r.id), ['a']);
  assert.equal(plan.storageErrors.length > 0, true);
  assert.equal(plan.storageErrors[0].index, 1);
  const broken = planRulesCommit('garbage', (doc) => doc);
  assert.equal(broken.ok, true);
  assert.deepEqual(broken.doc.rules, []);
});
check('sender checks: privileged queries only from the extension’s own pages; relay only from a tab', () => {
  const id = 'abcdefghijklmnop';
  const base = `chrome-extension://${id}/`;
  assert.equal(isPrivilegedSender({ id, url: `${base}tool.html#/rules` }, id, base), true);
  assert.equal(isPrivilegedSender({ id, url: `${base}popup.html`, tab: { id: 3 } }, id, base), true, 'a tool page opened as a tab still counts');
  assert.equal(isPrivilegedSender({ id, url: 'https://evil.example/', tab: { id: 3 } }, id, base), false, 'content script');
  assert.equal(isPrivilegedSender({ id: 'other', url: `${base}tool.html` }, id, base), false, 'another extension');
  assert.equal(isPrivilegedSender({ id }, id, base), false, 'no url');
  assert.equal(isPrivilegedSender({ id, url: `${base}tool.html` }, id, ''), false, 'empty base never matches');
  assert.equal(isRelaySender({ id, tab: { id: 3 }, url: 'https://shop.example.com/' }, id), true);
  assert.equal(isRelaySender({ id, url: `${base}tool.html` }, id), false);
  assert.equal(isRelaySender({ id: 'other', tab: { id: 3 } }, id), false);
});
check('i18n copy: Network-level strings promise nothing the Fetch domain cannot do; no dead "Revoke" control', () => {
  const src = readFileSync(U('i18n.ts'), 'utf8');
  const locales = src.split(/\nconst (?:ru|et): Record<MsgKey, string> = \{/);
  assert.equal(locales.length, 3, 'en / ru / et blocks');
  for (const block of locales) {
    const line = (key) => (block.match(new RegExp(`\\n  ${key}:\\s*\\n?\\s*'([^']*)'`)) ?? [])[1];
    for (const key of ['puNlDescription', 'nlDialogB2']) {
      const v = line(key);
      assert.ok(v, `${key} present`);
      assert.match(v, /not WebSocket or worker|не WebSocket и не запросы воркеров|mitte WebSocket ega workerite/, `${key} states the worker/WebSocket limit as a limit`);
    }
    assert.doesNotMatch(line('puNlUnavailable'), /at install|при установке|paigaldamisel/, 'no stale "does not ask for it at install"');
    assert.doesNotMatch(line('nlDialogBreak'), /regular engines|обычные движки|tavalistele mootoritele/, 'dbg rules go inactive, they are not re-routed');
    assert.ok(line('stNlInstallTime'), 'honest install-time status line');
  }
  assert.doesNotMatch(src, /stRevoke|stNlGranted|stNlNotGranted/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
