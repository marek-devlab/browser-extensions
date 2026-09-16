// Logic-level tests (Node, no browser) for @blur/netcore. They import the REAL
// source modules via Node's TS type stripping — shipping code, not a copy.
import assert from 'node:assert/strict';
import {
  hostOf,
  matchesSuffix,
  urlFilterToRegExp,
  matchesUrlFilter,
  wildcardToRegExp,
  matchesUrlCondition,
  checkRegexSafety,
  starHeight,
} from '../../packages/netcore/src/url-match.ts';
import { attachCdp, errorMessage } from '../../packages/netcore/src/cdp-session.ts';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

console.log('url-match: hosts');
check('hostOf parses and tolerates junk', () => {
  assert.equal(hostOf('https://a.example.com/x?y'), 'a.example.com');
  assert.equal(hostOf('not a url'), undefined);
  assert.equal(hostOf(undefined), undefined);
});
check('matchesSuffix: exact and subdomain, not partial label', () => {
  const set = new Set(['example.com']);
  assert.equal(matchesSuffix('example.com', set), true);
  assert.equal(matchesSuffix('a.b.example.com', set), true);
  assert.equal(matchesSuffix('notexample.com', set), false);
  assert.equal(matchesSuffix('example.com', ['example.com']), true);
});

console.log('url-match: DNR urlFilter semantics');
check('|| anchors to a domain boundary incl. subdomains, not to a suffix of a label', () => {
  assert.equal(matchesUrlFilter('||example.com^', 'https://example.com/'), true);
  assert.equal(matchesUrlFilter('||example.com^', 'https://cdn.example.com/a.js'), true);
  assert.equal(matchesUrlFilter('||example.com^', 'https://notexample.com/'), false);
  assert.equal(matchesUrlFilter('||example.com^', 'https://example.com.evil/'), false);
});
check('^ is a separator or end of URL', () => {
  assert.equal(matchesUrlFilter('/api/x^', 'https://h/api/x?y=1'), true);
  assert.equal(matchesUrlFilter('/api/x^', 'https://h/api/x'), true);
  assert.equal(matchesUrlFilter('/api/x^', 'https://h/api/xy'), false);
  assert.equal(matchesUrlFilter('/api/x^', 'https://h/api/x_1'), false); // _ is not a separator
});
check('* wildcard and | anchors', () => {
  assert.equal(matchesUrlFilter('*/img/*.webp', 'https://h/static/img/hero.webp'), true);
  assert.equal(matchesUrlFilter('|https://h/', 'https://h/x'), true);
  assert.equal(matchesUrlFilter('|https://h/', 'http://h/x'), false);
  assert.equal(matchesUrlFilter('.js|', 'https://h/a.js'), true);
  assert.equal(matchesUrlFilter('.js|', 'https://h/a.js?v=1'), false);
});
check('case-insensitive by default (Chrome 118+ default), opt-in sensitive', () => {
  assert.equal(matchesUrlFilter('/API/', 'https://h/api/x'), true);
  assert.equal(matchesUrlFilter('/API/', 'https://h/api/x', true), false);
});
check('non-ASCII and empty filters are rejected, never "match"', () => {
  assert.equal(urlFilterToRegExp(''), null);
  assert.equal(urlFilterToRegExp('||пример.рф'), null);
  assert.equal(matchesUrlFilter('||пример.рф', 'https://xn--e1afmkfd.xn--p1ai/'), false);
});

console.log('url-match: editor operators');
check('wildcard is whole-string anchored; ? is one char', () => {
  assert.equal(wildcardToRegExp('*/api/*').test('https://h/api/x'), true);
  assert.equal(wildcardToRegExp('/api/*').test('https://h/api/x'), false);
  assert.equal(wildcardToRegExp('a?c').test('abc'), true);
  assert.equal(wildcardToRegExp('a?c').test('abbc'), false);
  assert.equal(wildcardToRegExp('a.c').test('abc'), false); // dot is literal
});
check('contains / equals / regex over url, host, path', () => {
  const url = 'https://Shop.Example.com/api/Checkout?x=1';
  assert.equal(matchesUrlCondition({ key: 'url', op: 'contains', value: '/api/checkout' }, url), true);
  assert.equal(
    matchesUrlCondition({ key: 'url', op: 'contains', value: '/api/checkout', caseSensitive: true }, url),
    false,
  );
  assert.equal(matchesUrlCondition({ key: 'host', op: 'equals', value: 'shop.example.com' }, url), true);
  assert.equal(matchesUrlCondition({ key: 'path', op: 'equals', value: '/api/checkout?x=1' }, url), true);
  assert.equal(matchesUrlCondition({ key: 'path', op: 'regex', value: '^/api/check' }, url), true);
  assert.equal(matchesUrlCondition({ key: 'url', op: 'contains', value: '' }, url), false); // empty never matches
  assert.equal(matchesUrlCondition({ key: 'host', op: 'equals', value: 'x' }, 'garbage'), false);
});
check('unsafe or invalid regex never matches (fails closed in the matcher)', () => {
  assert.equal(matchesUrlCondition({ key: 'url', op: 'regex', value: '(a+)+$' }, 'https://h/aaaa'), false);
  assert.equal(matchesUrlCondition({ key: 'url', op: 'regex', value: '(' }, 'https://h/'), false);
});

console.log('url-match: regex safety');
check('accepts ordinary URL patterns', () => {
  for (const p of [
    '^https://[^/]+/api/',
    '\\.(js|css)$',
    '/users/\\d+',
    'a{2,3}b',
    '(?:foo|bar)baz',
    '[a-z]+\\.example\\.com',
  ]) {
    assert.deepEqual(checkRegexSafety(p), { ok: true }, p);
  }
});
check('rejects catastrophic and RE2-incompatible shapes', () => {
  assert.equal(checkRegexSafety('(a+)+').ok, false);
  assert.equal(checkRegexSafety('(a*)*b').ok, false);
  assert.equal(checkRegexSafety('(a|aa)+').ok, false);
  assert.equal(checkRegexSafety('(\\d+)\\1').ok, false);
  assert.equal(checkRegexSafety('(?=x)y').ok, false);
  assert.equal(checkRegexSafety('(?<=x)y').ok, false);
  assert.equal(checkRegexSafety('(').ok, false);
  assert.equal(checkRegexSafety('').ok, false);
  assert.equal(checkRegexSafety('a'.repeat(2000)).ok, false);
});
check('starHeight tokenizer: escapes and classes are opaque', () => {
  assert.equal(starHeight('a+'), 1);
  assert.equal(starHeight('(a+)+'), 2);
  assert.equal(starHeight('\\(+'), 1);
  assert.equal(starHeight('[(+]+'), 1);
  assert.equal(starHeight('(ab)+'), 1);
  assert.equal(starHeight('(?:a+)'), 1);
});

console.log('cdp-session');
function fakeApi(opts = {}) {
  const ev = new Set();
  const det = new Set();
  const calls = [];
  return {
    calls,
    fireEvent: (src, m, p) => ev.forEach((cb) => cb(src, m, p)),
    fireDetach: (src, r) => det.forEach((cb) => cb(src, r)),
    api: {
      attach: async (t) => {
        calls.push(['attach', t.tabId]);
        if (opts.attachError) throw opts.attachError;
      },
      detach: async (t) => {
        calls.push(['detach', t.tabId]);
        if (opts.detachError) throw opts.detachError;
      },
      sendCommand: async (t, m, p) => {
        calls.push(['send', t.tabId, m]);
        return { echo: m, p };
      },
      onEvent: { addListener: (cb) => ev.add(cb), removeListener: (cb) => ev.delete(cb) },
      onDetach: { addListener: (cb) => det.add(cb), removeListener: (cb) => det.delete(cb) },
    },
    listenerCount: () => ev.size + det.size,
  };
}
await checkAsync('attach failure returns the browser message verbatim', async () => {
  const f = fakeApi({ attachError: { message: 'Cannot access a chrome:// URL' } });
  const r = await attachCdp(f.api, 7);
  assert.deepEqual(r, { ok: false, error: 'Cannot access a chrome:// URL' });
  assert.equal(f.listenerCount(), 0);
});
await checkAsync('events are routed per tab; detach() is idempotent and removes listeners', async () => {
  const f = fakeApi();
  const seen = [];
  const r = await attachCdp(f.api, 7, { onEvent: (m, p) => seen.push([m, p]) });
  assert.equal(r.ok, true);
  f.fireEvent({ tabId: 8 }, 'Fetch.requestPaused', { requestId: 'other' });
  f.fireEvent({ tabId: 7 }, 'Fetch.requestPaused', { requestId: 'mine' });
  f.fireEvent({ tabId: 7 }, 'Network.x', undefined);
  assert.deepEqual(seen, [
    ['Fetch.requestPaused', { requestId: 'mine' }],
    ['Network.x', {}],
  ]);
  const res = await r.session.send('Fetch.enable', { patterns: [] });
  assert.equal(res.echo, 'Fetch.enable');
  await r.session.detach();
  await r.session.detach();
  assert.equal(r.session.attached, false);
  assert.equal(f.listenerCount(), 0);
  assert.equal(f.calls.filter((c) => c[0] === 'detach').length, 1);
  await assert.rejects(() => r.session.send('Runtime.evaluate'), /no longer attached/);
});
await checkAsync('browser-initiated detach surfaces the reason and later detach() is a no-op', async () => {
  const f = fakeApi();
  let reason = null;
  const r = await attachCdp(f.api, 7, { onDetach: (why) => (reason = why) });
  f.fireDetach({ tabId: 9 }, 'target_closed'); // other tab: ignored
  assert.equal(reason, null);
  f.fireDetach({ tabId: 7 }, 'canceled_by_user');
  assert.equal(reason, 'canceled_by_user');
  assert.equal(r.session.attached, false);
  assert.equal(f.listenerCount(), 0);
  await r.session.detach();
  assert.equal(f.calls.filter((c) => c[0] === 'detach').length, 0);
});
check('errorMessage normalises Error / string / object / junk', () => {
  assert.equal(errorMessage(new Error('e')), 'e');
  assert.equal(errorMessage('s'), 's');
  assert.equal(errorMessage({ message: 'o' }), 'o');
  assert.equal(errorMessage(42), '');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
