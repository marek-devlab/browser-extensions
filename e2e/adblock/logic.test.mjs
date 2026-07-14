// Logic-level tests (Node, no browser) for behaviors that the DOM/network E2E
// harness can't drive reliably:
//   - Assertion 4 (honesty): the popup's count formatting shows "~" ONLY for
//     approximate figures, "—" for unmeasurable, bare N for exact.
//   - Assertion 6 (Firefox over-block fix): the WebRequestBackend decision core
//     never cancels main_frame and honors @@ exceptions.
//   - Custom-filter parsing (Phase 3 §6).
//
// These import the REAL source modules (pure, browser-free) via Node's TS type
// stripping, so they exercise shipping code — not a copy.
import assert from 'node:assert/strict';
import { formatCount } from '../../extensions/adblock/utils/format-count.ts';
import {
  decideRequest,
  parseRule,
  matchesSuffix,
} from '../../extensions/adblock/utils/backends/webrequest-match.ts';
import {
  parseCosmeticFilters,
  customRulesForHost,
  addFilter,
  removeFilter,
} from '../../extensions/adblock/utils/custom-filters.ts';
import { parseBackup } from '../../extensions/adblock/utils/backup-parse.ts';
import {
  planRulesets,
  degradedNotice,
  ruleCountFor,
  GUARANTEED_MINIMUM_STATIC_RULES,
} from '../../extensions/adblock/utils/backends/rule-budget.ts';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    fail += 1;
    console.log(`[FAIL] ${name} — ${err.message}`);
  }
}

/* ---- Assertion 4: count formatting honesty ---- */
check('L1 formatCount: exact cosmetic has no ~', () => {
  assert.equal(formatCount(3, false), '3');
});
check('L2 formatCount: approximate network shows ~', () => {
  assert.equal(formatCount(3, true), '~3');
});
check('L3 formatCount: unmeasurable shows — not 0', () => {
  assert.equal(formatCount(null, true), '—');
  assert.equal(formatCount(null, false), '—');
});

/* ---- Assertion 6: Firefox WebRequest over-block fix ---- */
const sets = {
  exceptions: new Set(['good.example']),
  trackers: new Set(['tracker.example']),
  ads: new Set(['ads.example']),
  isAllowlisted: (h) => h === 'paused.example',
};

check('L4 main_frame navigation is NEVER cancelled', () => {
  const d = decideRequest(
    { type: 'main_frame', url: 'https://ads.example/', initiator: undefined, tabId: 1 },
    sets,
  );
  assert.equal(d.cancel, false);
});
check('L5 sub-resource to an ad host is cancelled (network)', () => {
  const d = decideRequest(
    { type: 'image', url: 'https://ads.example/x.gif', initiator: 'https://site.example', tabId: 1 },
    sets,
  );
  assert.deepEqual(d, { cancel: true, kind: 'network' });
});
check('L6 tracker host cancelled and counted as tracker', () => {
  const d = decideRequest(
    { type: 'script', url: 'https://sub.tracker.example/t.js', initiator: 'https://site.example', tabId: 1 },
    sets,
  );
  assert.deepEqual(d, { cancel: true, kind: 'trackers' });
});
check('L7 @@ exception host wins over a block', () => {
  const s2 = { ...sets, ads: new Set(['good.example']) };
  const d = decideRequest(
    { type: 'image', url: 'https://good.example/a.gif', initiator: 'https://site.example', tabId: 1 },
    s2,
  );
  assert.equal(d.cancel, false);
});
check('L8 allowlisted page host blocks nothing', () => {
  const d = decideRequest(
    { type: 'image', url: 'https://ads.example/x.gif', initiator: 'https://paused.example', tabId: 1 },
    sets,
  );
  assert.equal(d.cancel, false);
});
check('L9 tabId < 0 (non-tab request) never cancelled', () => {
  const d = decideRequest(
    { type: 'image', url: 'https://ads.example/x.gif', initiator: undefined, tabId: -1 },
    sets,
  );
  assert.equal(d.cancel, false);
});

/* ---- parseRule: only whole-host rules, never widen a path rule ---- */
check('L10 parseRule accepts ||host^ block', () => {
  assert.deepEqual(parseRule({ action: { type: 'block' }, condition: { urlFilter: '||ads.example^' } }), {
    domain: 'ads.example',
    allow: false,
  });
});
check('L11 parseRule SKIPS a path rule (no over-block)', () => {
  assert.equal(
    parseRule({ action: { type: 'block' }, condition: { urlFilter: '||site.example/ads^' } }),
    undefined,
  );
});
check('L12 parseRule reads @@ allow as exception', () => {
  assert.deepEqual(parseRule({ action: { type: 'allow' }, condition: { urlFilter: '||good.example^' } }), {
    domain: 'good.example',
    allow: true,
  });
});
check('L13 matchesSuffix matches subdomains only by label boundary', () => {
  const s = new Set(['example.com']);
  assert.equal(matchesSuffix('a.example.com', s), true);
  assert.equal(matchesSuffix('example.com', s), true);
  assert.equal(matchesSuffix('notexample.com', s), false);
});

/* ---- Phase 3 §6: pasted cosmetic-filter parsing ---- */
check('L14 parse site-specific and generic cosmetic lines', () => {
  const { filters, skipped } = parseCosmeticFilters(
    ['! comment', 'example.com##.ad-box', '##.global-ad', 'a.com,b.com##.multi'].join('\n'),
  );
  assert.deepEqual(filters, [
    { host: 'example.com', selector: '.ad-box' },
    { host: '*', selector: '.global-ad' },
    { host: 'a.com', selector: '.multi' },
    { host: 'b.com', selector: '.multi' },
  ]);
  assert.equal(skipped.length, 0);
});
check('L15 parse skips network rules and #@# exceptions and extended syntax', () => {
  const { filters, skipped } = parseCosmeticFilters(
    ['||ads.net^', 'example.com#@#.x', 'e.com##.y:has-text(ad)'].join('\n'),
  );
  assert.equal(filters.length, 0);
  assert.equal(skipped.length, 3);
});
check('L16 customRulesForHost scopes site rules and applies generic everywhere', () => {
  const filters = { '*': ['.g'], 'example.com': ['.s'], 'other.com': ['.o'] };
  const rules = customRulesForHost(filters, 'www.example.com');
  const selectors = rules.map((r) => r.selector).sort();
  assert.deepEqual(selectors, ['.g', '.s']);
  const generic = rules.find((r) => r.selector === '.g');
  assert.equal(generic.hostnames, undefined);
});
check('L17 add/remove custom filters immutably + dedupe', () => {
  let f = {};
  f = addFilter(f, 'example.com', '.a');
  f = addFilter(f, 'example.com', '.a'); // dupe ignored
  f = addFilter(f, '', '.g'); // '' -> '*'
  assert.deepEqual(f, { 'example.com': ['.a'], '*': ['.g'] });
  f = removeFilter(f, 'example.com', '.a');
  assert.deepEqual(f, { '*': ['.g'] });
});

/* ---- Phase 3 §4: backup parse/validate (untrusted input) ---- */
check('L18 parseBackup rejects non-JSON', () => {
  assert.throws(() => parseBackup('not json'), /valid JSON/);
});
check('L19 parseBackup normalizes + drops garbage, keeps valid parts', () => {
  const b = parseBackup(
    JSON.stringify({
      settings: { enabled: false, adblock: { level: 'aggressive', blockTrackers: 'nope' } },
      siteConfigs: { 'a.com': { hostname: 'a.com', disableCosmetic: true }, bad: 5 },
      customFilters: { 'a.com': ['.x'], junk: [1, 2], empty: [] },
    }),
  );
  assert.equal(b.settings.enabled, false);
  assert.equal(b.settings.adblock.level, 'aggressive');
  // invalid boolean falls back to default (true)
  assert.equal(b.settings.adblock.blockTrackers, true);
  assert.deepEqual(b.siteConfigs['a.com'], { hostname: 'a.com', disableCosmetic: true });
  assert.equal(b.siteConfigs.bad, undefined);
  assert.deepEqual(b.customFilters, { 'a.com': ['.x'] });
});
check('L20 parseBackup tolerates a fully empty object', () => {
  const b = parseBackup('{}');
  assert.equal(b.settings.adblock.level, 'standard');
  assert.deepEqual(b.customFilters, {});
});

/* ---- Chrome DNR static-rule budget: which rulesets fit (PLAN.md §4.1) ----
   Aggressive wants easylist (20,000) + easyprivacy (9,000) + annoyances (6,000)
   = 35,000, which OVERFLOWS Chrome's 30,000 guarantee into the pool SHARED with
   every other installed extension. When that pool is exhausted the enable call
   REJECTS and nothing is applied, so the backend must predict/degrade instead. */
const ALL = ['easylist', 'easyprivacy', 'annoyances'];
const STANDARD = ['easylist', 'easyprivacy'];

check('L21 ruleCountFor sums the bundled list sizes (35,000 at aggressive)', () => {
  assert.equal(ruleCountFor(STANDARD), 29_000);
  assert.equal(ruleCountFor(ALL), 35_000);
  assert.equal(GUARANTEED_MINIMUM_STATIC_RULES, 30_000);
  // The standard set fits the guarantee; the aggressive set cannot.
  assert.ok(ruleCountFor(STANDARD) <= GUARANTEED_MINIMUM_STATIC_RULES);
  assert.ok(ruleCountFor(ALL) > GUARANTEED_MINIMUM_STATIC_RULES);
});
check('L22 standard set fits the guarantee untouched', () => {
  const p = planRulesets(STANDARD, GUARANTEED_MINIMUM_STATIC_RULES);
  assert.deepEqual(p.enable, STANDARD);
  assert.deepEqual(p.dropped, []);
  assert.equal(p.enabledRules, 29_000);
});
check('L23 aggressive over budget drops ONLY annoyances, keeps ads + trackers', () => {
  const p = planRulesets(ALL, GUARANTEED_MINIMUM_STATIC_RULES);
  assert.deepEqual(p.enable, STANDARD);
  assert.deepEqual(p.dropped, ['annoyances']);
  assert.equal(p.requestedRules, 35_000);
  assert.ok(p.enabledRules <= GUARANTEED_MINIMUM_STATIC_RULES);
});
check('L24 aggressive fits when the shared pool has room (35,000 budget)', () => {
  const p = planRulesets(ALL, 35_000);
  assert.deepEqual(p.enable, ALL);
  assert.deepEqual(p.dropped, []);
});
check('L25 unknown budget (Infinity) never pre-emptively drops anything', () => {
  const p = planRulesets(ALL, Number.POSITIVE_INFINITY);
  assert.deepEqual(p.enable, ALL);
  assert.deepEqual(p.dropped, []);
});
check('L26 degradation is priority-ordered: ads survive the tightest budget', () => {
  assert.deepEqual(planRulesets(ALL, 20_000).enable, ['easylist']);
  assert.deepEqual(planRulesets(ALL, 20_000).dropped, ['easyprivacy', 'annoyances']);
  assert.deepEqual(planRulesets(ALL, 0).enable, []);
  // Plan order never depends on the caller's argument order.
  assert.deepEqual(
    planRulesets(['annoyances', 'easyprivacy', 'easylist'], 29_000).enable,
    STANDARD,
  );
});
check('L27 the ruleset-count cap is honoured independently of the rule cap', () => {
  const p = planRulesets(ALL, Number.POSITIVE_INFINITY, 1);
  assert.deepEqual(p.enable, ['easylist']);
  assert.deepEqual(p.dropped, ['easyprivacy', 'annoyances']);
});
check('L28 degradedNotice: silent when nothing dropped, names the list otherwise', () => {
  assert.equal(degradedNotice([]), '');
  const msg = degradedNotice(['annoyances']);
  assert.match(msg, /Annoyances/);
  assert.match(msg, /shared with your other extensions/);
  // Plain language: no stack traces, no API names leaking into the UI.
  assert.doesNotMatch(msg, /updateEnabledRulesets|Error|declarativeNetRequest/);
});

console.log(`\n==== logic: ${pass}/${pass + fail} PASSED ====`);
process.exit(fail === 0 ? 0 : 1);
