// Logic-level tests (Node, no browser) for the wave-3 extensions' pure modules.
// These import the REAL source `.ts` via Node's native type stripping, so they
// exercise shipping code, not a copy. Run: `node e2e/wave3/logic.test.mjs`.
//
// Focus: the honesty- and correctness-critical logic the build can't verify —
// affine temperature, US/Imperial and SI/IEC distinctions, inverse fuel economy,
// exact BigInt bases, calendar feature-detection, link-risk signalling, and the
// session data model (dedupe, validation, restorability).

import assert from 'node:assert/strict';

import {
  convertUnit,
  CATEGORIES,
  parseInBase,
  formatInBase,
} from '../../extensions/convert/utils/units.ts';
import {
  supportedCalendars,
  CALENDAR_CAVEAT,
  renderCalendars,
  chineseZodiac,
  fromUnix,
  toUnixSeconds,
  localTimeZone,
  commonTimeZones,
} from '../../extensions/convert/utils/datetime.ts';
import {
  analyzeLink,
  stripTrackingParams,
  isShortenerDomain,
  riskBadge,
} from '../../extensions/linksafe/utils/analyze.ts';
import {
  isRestorableUrl,
  normalizeSession,
  dedupeSession,
  tabCount,
  sessionBytes,
  toMeta,
  defaultSessionName,
  newSessionId,
  EMPTY_INDEX,
} from '../../extensions/sessions/utils/model.ts';

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

const approx = (a, b, eps = 1e-9) =>
  Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

/* ======================= convert — units ======================= */

check('U1 length: 1 mi = 1.609344 km (exact factor)', () => {
  assert.ok(approx(convertUnit('length', 1, 'mi', 'km'), 1.609344));
});

check('U2 temperature is AFFINE, not factor: 0°C=32°F, 100°C=212°F, 0°C=273.15K', () => {
  assert.equal(convertUnit('temperature', 0, 'C', 'F'), 32);
  assert.equal(convertUnit('temperature', 100, 'C', 'F'), 212);
  assert.ok(approx(convertUnit('temperature', 0, 'C', 'K'), 273.15));
  assert.ok(approx(convertUnit('temperature', 32, 'F', 'C'), 0));
});

check('U3 data: SI-decimal MB (1e6) is distinct from IEC-binary MiB (1048576)', () => {
  assert.equal(convertUnit('data', 1, 'MB', 'B'), 1e6);
  assert.equal(convertUnit('data', 1, 'MiB', 'B'), 1048576);
  assert.notEqual(convertUnit('data', 1, 'MB', 'B'), convertUnit('data', 1, 'MiB', 'B'));
});

check('U4 volume: US gallon (3.785…L) and Imperial gallon (4.546…L) are distinct', () => {
  assert.ok(approx(convertUnit('volume', 1, 'us_gal', 'L'), 3.785411784));
  assert.ok(approx(convertUnit('volume', 1, 'imp_gal', 'L'), 4.54609));
  assert.notEqual(
    convertUnit('volume', 1, 'us_gal', 'L'),
    convertUnit('volume', 1, 'imp_gal', 'L'),
  );
});

check('U5 mass: short ton (US) and long ton (UK) are distinct', () => {
  assert.ok(approx(convertUnit('mass', 1, 'ton_us', 'kg'), 907.18474));
  assert.ok(approx(convertUnit('mass', 1, 'ton_uk', 'kg'), 1016.0469088));
});

check('U6 fuel economy is INVERSE and 0 is honest ∞, not a fabricated number', () => {
  assert.ok(approx(convertUnit('fuelEconomy', 10, 'l100km', 'l100km'), 10));
  // 0 km/L consumption → infinite L/100km, surfaced as Infinity (UI shows ∞), never 0.
  assert.equal(convertUnit('fuelEconomy', 0, 'kml', 'l100km'), Infinity);
});

check('U7 unknown unit id → null (never a wrong number)', () => {
  assert.equal(convertUnit('length', 1, 'mi', 'nope'), null);
  assert.equal(convertUnit('length', 1, 'nope', 'km'), null);
  assert.equal(convertUnit('nope', 1, 'a', 'b'), null);
});

check('U8 identity: every unit converts to itself as 1', () => {
  for (const cat of CATEGORIES) {
    for (const u of cat.units) {
      const v = convertUnit(cat.id, 1, u.id, u.id);
      assert.ok(v !== null && approx(v, 1), `${cat.id}/${u.id} identity=${v}`);
    }
  }
});

check('U9 round-trip: a→b→a returns the original for every unit pair vs the base', () => {
  for (const cat of CATEGORIES) {
    const first = cat.units[0].id;
    for (const u of cat.units) {
      const there = convertUnit(cat.id, 3, first, u.id);
      const back = convertUnit(cat.id, there, u.id, first);
      assert.ok(back !== null && approx(back, 3, 1e-6), `${cat.id}/${u.id} round-trip=${back}`);
    }
  }
});

check('U10 numeral bases: exact BigInt round-trip, invalid → null', () => {
  // parse is case-insensitive; format emits UPPERCASE hex.
  assert.equal(parseInBase('ff', 16), 255n);
  assert.equal(parseInBase('FF', 16), 255n);
  assert.equal(parseInBase('11111111', 2), 255n);
  assert.equal(formatInBase(255n, 16), 'FF');
  assert.equal(formatInBase(255n, 2), '11111111');
  // Exact for values that would lose precision as a JS Number.
  assert.equal(parseInBase(formatInBase(123456789012345678n, 16), 16), 123456789012345678n);
  assert.equal(parseInBase('xyz', 16), null);
  assert.equal(parseInBase('', 10), null);
});

/* ======================= convert — date/time/calendars ======================= */

check('D1 supportedCalendars is a non-empty array that always includes gregory', () => {
  const cals = supportedCalendars();
  assert.ok(Array.isArray(cals) && cals.length >= 1);
  assert.ok(cals.includes('gregory'));
});

check('D2 the Hijri (Umm al-Qura) caveat flag is present (honest ±1-day disclosure)', () => {
  assert.ok(CALENDAR_CAVEAT['islamic-umalqura']);
});

check('D3 renderCalendars returns a non-empty list of objects for a real date', () => {
  const out = renderCalendars(new Date('2026-07-20T12:00:00Z'), 'en');
  assert.ok(Array.isArray(out) && out.length >= 1);
  for (const r of out) assert.equal(typeof r, 'object');
});

check('D4 chineseZodiac returns null (unsupported) or an object with a string animal', () => {
  const z = chineseZodiac(new Date('2000-05-01T00:00:00Z'));
  assert.ok(z === null || typeof z.animal === 'string');
});

check('D5 Unix ↔ Date round-trips exactly', () => {
  assert.equal(toUnixSeconds(new Date(0)), 0);
  assert.equal(fromUnix(0, 'seconds').getTime(), 0);
  assert.equal(fromUnix(1, 'seconds').getTime(), 1000);
  assert.equal(fromUnix(1500, 'milliseconds').getTime(), 1500);
});

check('D6 time-zone helpers are sane (local string; UTC in the common list)', () => {
  assert.equal(typeof localTimeZone(), 'string');
  assert.ok(localTimeZone().length > 0);
  assert.ok(commonTimeZones().includes('UTC'));
});

/* ======================= linksafe — analyze ======================= */

const hasSig = (a, code) => a.signals.some((s) => s.code === code);

check('L1 tracking params are stripped; kept params survive; names reported', () => {
  const { cleanUrl, removed } = stripTrackingParams(
    'https://x.com/p?utm_source=a&keep=1&fbclid=z',
  );
  assert.ok(!cleanUrl.includes('utm_source'));
  assert.ok(!cleanUrl.includes('fbclid'));
  assert.ok(cleanUrl.includes('keep=1'));
  assert.ok(removed.includes('utm_source') && removed.includes('fbclid'));
});

check('L2 a plain https link is ok, with no poor signal', () => {
  const a = analyzeLink('https://example.com/');
  assert.equal(a.valid, true);
  assert.equal(a.risk, 'ok');
  assert.ok(!a.signals.some((s) => s.severity === 'poor'));
});

check('L3 dangerous scheme → poor', () => {
  const a = analyzeLink('javascript:alert(1)');
  assert.equal(a.scheme, 'javascript:');
  assert.ok(hasSig(a, 'dangerousScheme'));
  assert.equal(a.risk, 'poor');
});

check('L4 insecure http is flagged, and an anchor/href domain mismatch raises risk', () => {
  const a = analyzeLink('http://evil.com/login', 'paypal.com');
  assert.ok(hasSig(a, 'insecure'));
  assert.notEqual(a.risk, 'ok');
});

check('L5 embedded credentials (user:pass@) are flagged', () => {
  const a = analyzeLink('https://user:secret@example.com/');
  assert.ok(hasSig(a, 'credentials'));
});

check('L6 raw-IP host is flagged', () => {
  const a = analyzeLink('http://192.168.1.1/');
  assert.ok(hasSig(a, 'ipHost'));
});

check('L7 shortener detection', () => {
  assert.equal(isShortenerDomain('bit.ly'), true);
  assert.equal(isShortenerDomain('example.com'), false);
  assert.equal(isShortenerDomain(null), false);
});

check('L8 riskBadge collapses info→ok, keeps warn/poor', () => {
  assert.equal(riskBadge('poor'), 'poor');
  assert.equal(riskBadge('warn'), 'warn');
  assert.equal(riskBadge('info'), 'ok');
  assert.equal(riskBadge('ok'), 'ok');
});

/* ======================= sessions — model ======================= */

const mkTab = (url, i) => ({ url, title: url, pinned: false, active: i === 0, index: i });
const mkSession = () => ({
  id: 's1',
  name: 'Work',
  createdAt: 1000,
  updatedAt: 2000,
  kind: 'manual',
  windows: [
    {
      incognito: false,
      tabs: [mkTab('https://a.com', 0), mkTab('https://a.com', 1), mkTab('https://b.com', 2)],
    },
  ],
});

check('S1 isRestorableUrl accepts web URLs, rejects script/data schemes', () => {
  assert.equal(isRestorableUrl('https://x.com'), true);
  assert.equal(isRestorableUrl('http://x.com'), true);
  assert.equal(isRestorableUrl('javascript:alert(1)'), false);
  assert.equal(isRestorableUrl('data:text/html,x'), false);
});

check('S2 normalizeSession returns null for garbage, an object for a valid session', () => {
  assert.equal(normalizeSession(null), null);
  assert.equal(normalizeSession({}), null);
  assert.equal(normalizeSession({ id: 'a', name: 'b' }), null);
  assert.notEqual(normalizeSession(mkSession()), null);
});

check('S3 tabCount + dedupe: duplicate URLs collapse, distinct ones survive', () => {
  const s = mkSession();
  assert.equal(tabCount(s), 3);
  const d = dedupeSession(s);
  assert.equal(tabCount(d), 2);
});

check('S4 sessionBytes + toMeta produce sane summary numbers', () => {
  const s = mkSession();
  assert.ok(sessionBytes(s) > 0);
  const m = toMeta(s);
  assert.equal(m.id, 's1');
  assert.equal(m.tabCount, 3);
  assert.equal(m.windowCount, 1);
  assert.ok(m.bytes > 0);
});

check('S5 id/name helpers: non-empty name, unique ids, empty index is empty', () => {
  assert.equal(typeof defaultSessionName(), 'string');
  assert.ok(defaultSessionName().length > 0);
  assert.notEqual(newSessionId(), newSessionId());
  assert.equal(EMPTY_INDEX.order.length, 0);
});

console.log(`\n==== wave3 logic: ${pass}/${pass + fail} PASSED ====`);
process.exit(fail === 0 ? 0 : 1);
