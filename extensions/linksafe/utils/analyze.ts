import punycode from 'punycode';
import { parse as parseHost } from 'tldts';

// The heart of Link Inspector — PURE, browser-free, ZERO network, unit-testable
// (PLAN.md Часть III §12.4). Every heuristic here runs locally on a string; nothing
// in this file fetches, stores, or touches the DOM. The injected overlay
// (inspector.content.ts), the popup and the background all call `analyzeLink` and
// render the structured result; the SIGNAL CODES are translated to plain language
// at the UI edge via i18n (`tAt`/`useT`), so this module never emits prose and the
// wording stays honest and localizable.
//
// 🔴 Honesty rule baked into the data: a look-alike domain is reported as
// "looks like X but uses Cyrillic letters", never "phishing" — see `analyzeHost`.
// We deliberately UNDER-flag legitimate non-Latin domains (single-script names that
// do not reduce to an ASCII skeleton are left alone).

export type Severity = 'ok' | 'info' | 'warn' | 'poor';

/** A stable, enum-like reason code. The i18n catalog carries `sig_<code>` (a short
 *  plain-language line) for each; `vars` are interpolated there. No prose here. */
export type SignalCode =
  | 'dangerousScheme'
  | 'credentials'
  | 'confusable'
  | 'mixedScript'
  | 'mismatch'
  | 'punycode'
  | 'ipHost'
  | 'insecure'
  | 'shortener'
  | 'tracking';

export interface Signal {
  code: SignalCode;
  severity: Severity;
  vars?: Record<string, string | number>;
}

export interface LinkAnalysis {
  /** The href exactly as it appeared. */
  raw: string;
  /** Did it parse as an absolute URL at all? */
  valid: boolean;
  /** e.g. `https:`, `javascript:`, `mailto:` — '' when unparseable. */
  scheme: string;
  /** Decoded (Unicode) hostname shown to a human — `apple.com`, `аррӏе.com`. */
  displayHost: string;
  /** ASCII/punycode hostname the browser actually resolves — `xn--80ak6aa92e.com`. */
  asciiHost: string;
  /** eTLD+1 (registrable domain) via tldts, or null (IP, unknown, non-web scheme). */
  registrableDomain: string | null;
  isPunycode: boolean;
  isShortener: boolean;
  /** `raw` with tracking parameters removed (unchanged for non-http schemes). */
  cleanUrl: string;
  /** Names of the tracking parameters that were stripped, in the order found. */
  strippedParams: string[];
  /** Highest severity across `signals` — the badge colour (poor=red, warn=amber). */
  risk: Severity;
  signals: Signal[];
}

const SEVERITY_RANK: Record<Severity, number> = { ok: 0, info: 1, warn: 2, poor: 3 };

/* -------------------------------------------------------------------------- */
/* Tracking parameters (utm_*, click ids, email ids…). Exact names + families. */
/* -------------------------------------------------------------------------- */

/** Whole-name tracking keys. Case-insensitive match. */
const TRACKING_EXACT = new Set(
  [
    // Google / Urchin
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'utm_id', 'utm_name', 'utm_cid', 'utm_reader', 'utm_referrer', 'utm_social',
    'utm_brand', 'utm_pubreferrer', 'utm_swu', 'utm_source_platform',
    'utm_creative_format', 'utm_marketing_tactic',
    'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'gad_source', 'gad',
    'gclid_source', '_ga', '_gl',
    // Social / ad networks
    'fbclid', 'igshid', 'igsh', 'msclkid', 'twclid', 'yclid', 'ttclid',
    'li_fat_id', 'epik', 'rdt_cid', 'sccid',
    // Email / marketing platforms
    'mc_eid', 'mc_cid', 'mkt_tok', 'ml_subscriber', 'ml_subscriber_hash',
    'vero_id', 'vero_conv', '_hsenc', '_hsmi', 'oly_anon_id', 'oly_enc_id',
    'wickedid', 'ck_subscriber_id', 's_cid', 'sc_campaign', 'sc_channel',
    // Misc analytics
    '_openstat', 'yandex_source',
  ].map((s) => s.trim().toLowerCase()).filter(Boolean),
);

/** Prefix families (Matomo/Piwik `mtm_`/`pk_`/`piwik_`, HubSpot ads `hsa_`,
 *  Omeda `oly_`). A parameter whose name starts with any of these is tracking. */
const TRACKING_PREFIXES = ['utm_', 'mtm_', 'pk_', 'piwik_', 'hsa_', 'oly_', 'matomo_'];

function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase();
  if (TRACKING_EXACT.has(n)) return true;
  return TRACKING_PREFIXES.some((p) => n.startsWith(p));
}

/**
 * Strip tracking parameters from a URL. Pure string→string; preserves the order
 * and every non-tracking parameter. For non-http(s) schemes (or unparseable
 * input) the URL is returned unchanged and nothing is reported as removed.
 */
export function stripTrackingParams(raw: string): { cleanUrl: string; removed: string[] } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { cleanUrl: raw, removed: [] };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { cleanUrl: raw, removed: [] };
  }
  const removed: string[] = [];
  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (isTrackingParam(key)) removed.push(key);
    else kept.push([key, value]);
  }
  if (removed.length === 0) return { cleanUrl: raw, removed: [] };

  const params = new URLSearchParams();
  for (const [k, v] of kept) params.append(k, v);
  url.search = params.toString();
  return { cleanUrl: url.toString(), removed };
}

/* -------------------------------------------------------------------------- */
/* Known URL shorteners (bundled — MV3-friendly, no network). Matched on eTLD+1. */
/* -------------------------------------------------------------------------- */

const SHORTENERS = new Set([
  'bit.ly', 'bit.do', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'buff.ly',
  'is.gd', 'v.gd', 'cutt.ly', 'rebrand.ly', 'bl.ink', 'shorturl.at', 'rb.gy',
  't.ly', 'tiny.cc', 'tiny.one', 'lnkd.in', 'trib.al', 'dlvr.it', 'fb.me',
  'youtu.be', 'amzn.to', 'wp.me', 'po.st', 'mcaf.ee', 's.id', 'x.co', 'soo.gd',
  'clck.ru', 'vk.cc', 'qr.ae', 'adf.ly', 'mzl.la', 'git.io', 'g.co', 'spoti.fi',
  'apple.co', 'chl.li', 'href.li', 'shorte.st', 'cutt.us', 'short.io', 'kutt.it',
  'urlz.fr', 'u.to', 'clk.im', 'l.ead.me', 'flip.it', 'ift.tt', 'hyperurl.co',
  'snip.ly', 'db.tt', 'zpr.io', 'j.mp', 'shorturl.com',
].map((s) => s.trim()).filter(Boolean));

export function isShortenerDomain(registrableDomain: string | null): boolean {
  return registrableDomain !== null && SHORTENERS.has(registrableDomain);
}

/* -------------------------------------------------------------------------- */
/* Hand-rolled UTS-39-style confusable / mixed-script check (no dependency).    */
/* -------------------------------------------------------------------------- */

/** The most common single-script homoglyphs of ASCII letters, mapped to their
 *  Latin "skeleton". Curated (not exhaustive): Cyrillic, Greek and a few
 *  full-width forms cover the domains actually used in homograph attacks. */
const CONFUSABLES: Record<string, string> = {
  // Cyrillic → Latin
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
  'у': 'y', 'х': 'x', 'ѕ': 's', 'і': 'i', 'ј': 'j',
  'ӏ': 'l', 'ԛ': 'q', 'ԝ': 'w', 'ԁ': 'd', 'н': 'h',
  'к': 'k', 'м': 'm', 'т': 't', 'в': 'b', 'г': 'r',
  'А': 'A', 'Е': 'E', 'О': 'O', 'Р': 'P', 'С': 'C',
  'Х': 'X', 'К': 'K', 'М': 'M', 'Н': 'H', 'В': 'B',
  'Т': 'T',
  // Greek → Latin
  'ο': 'o', 'α': 'a', 'ρ': 'p', 'ε': 'e', 'ν': 'v',
  'ι': 'i', 'κ': 'k', 'υ': 'u', 'χ': 'x', 'η': 'n',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H',
  'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O',
  'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  // Full-width ASCII → ASCII
  'ａ': 'a', 'ｅ': 'e', 'ｏ': 'o', 'ｐ': 'p', 'ｃ': 'c',
  'ｉ': 'i', 'ｌ': 'l',
};

/** Coarse script classification — enough to detect single-label script MIXING
 *  (the UTS-39 "single-script" confusable signal). Returns a display-ready name. */
function scriptOf(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  if (!/\p{L}/u.test(ch)) return 'Common'; // digits, hyphen, etc. — ignored for mixing
  if (
    (cp >= 0x0041 && cp <= 0x005a) || (cp >= 0x0061 && cp <= 0x007a) ||
    (cp >= 0x00c0 && cp <= 0x024f) || (cp >= 0x1e00 && cp <= 0x1eff)
  ) return 'Latin';
  if ((cp >= 0x0370 && cp <= 0x03ff) || (cp >= 0x1f00 && cp <= 0x1fff)) return 'Greek';
  if ((cp >= 0x0400 && cp <= 0x04ff) || (cp >= 0x0500 && cp <= 0x052f)) return 'Cyrillic';
  if (cp >= 0x0530 && cp <= 0x058f) return 'Armenian';
  if (cp >= 0x0590 && cp <= 0x05ff) return 'Hebrew';
  if ((cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f)) return 'Arabic';
  if (cp >= 0x0e00 && cp <= 0x0e7f) return 'Thai';
  if (cp >= 0x0900 && cp <= 0x097f) return 'Devanagari';
  if (cp >= 0x3040 && cp <= 0x309f) return 'Hiragana';
  if (cp >= 0x30a0 && cp <= 0x30ff) return 'Katakana';
  if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) return 'Han';
  if ((cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff)) return 'Hangul';
  return 'Other';
}

/** Collapse the CJK scripts into one "writing system" so a legitimate Japanese or
 *  Korean domain that mixes Kanji + Kana (or Han + Hangul) is not flagged as mixed.
 *  Every other script is its own group. */
function scriptGroup(script: string): string {
  if (script === 'Han' || script === 'Hiragana' || script === 'Katakana' || script === 'Hangul') {
    return 'CJK';
  }
  return script;
}

function mapConfusables(s: string): string {
  let out = '';
  for (const ch of s) out += CONFUSABLES[ch] ?? ch;
  return out;
}

interface HostVerdict {
  confusable?: { lookalike: string; script: string };
  mixedScript?: boolean;
}

/**
 * Inspect the DECODED hostname for look-alike / mixed-script tricks. Analysis is
 * done on the labels BEFORE the public suffix, so a Latin TLD (`.com`) on a
 * Cyrillic label is not itself treated as "mixed" — a Cyrillic `аррӏе.com` is
 * flagged as a look-alike of `apple.com`, while a legitimate single-script
 * `россия.рф` (no ASCII skeleton) is left alone.
 */
export function analyzeHost(displayHost: string, publicSuffix: string | null): HostVerdict {
  let head = displayHost;
  if (publicSuffix) {
    if (displayHost === publicSuffix) head = '';
    else if (displayHost.endsWith('.' + publicSuffix)) {
      head = displayHost.slice(0, displayHost.length - publicSuffix.length - 1);
    }
  }
  const letters = [...head].filter((c) => /\p{L}/u.test(c));
  if (letters.length === 0) return {};

  const scripts = new Set(letters.map(scriptOf));
  const nonLatin = [...scripts].filter((s) => s !== 'Latin');

  const skeletonHead = mapConfusables(head);
  const hasNonAscii = /[^\x00-\x7f]/.test(head);
  const skeletonIsAscii = /^[a-z0-9.-]+$/i.test(skeletonHead);

  if (
    hasNonAscii &&
    skeletonIsAscii &&
    nonLatin.length > 0 &&
    skeletonHead.toLowerCase() !== head.toLowerCase()
  ) {
    return {
      confusable: {
        lookalike: mapConfusables(displayHost),
        script: nonLatin[0],
      },
    };
  }

  // Two or more INCOMPATIBLE writing systems in one label, with no clean ASCII
  // skeleton — suspicious but not a confirmed look-alike (honest: "mixes alphabets",
  // not "phishing"). CJK scripts (Han/Hiragana/Katakana/Hangul) are grouped so a
  // legitimate Japanese/Korean domain mixing Kanji + Kana is NOT over-flagged.
  const groups = new Set([...scripts].map(scriptGroup));
  if (groups.size > 1) return { mixedScript: true };
  return {};
}

/* -------------------------------------------------------------------------- */
/* Anchor-text vs href domain mismatch.                                        */
/* -------------------------------------------------------------------------- */

const DOMAIN_IN_TEXT = /(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})/i;

/** If the visible link text itself names a domain whose eTLD+1 differs from where
 *  the href actually goes, that is the classic phishing tell. Returns the two
 *  registrable domains, or null when the text names no domain (the common case). */
export function anchorMismatch(
  anchorText: string | undefined,
  hrefRegistrable: string | null,
): { textDomain: string; hrefDomain: string } | null {
  if (!anchorText || !hrefRegistrable) return null;
  const m = anchorText.match(DOMAIN_IN_TEXT);
  if (!m) return null;
  const textReg = parseHost(m[1]).domain;
  if (!textReg || textReg === hrefRegistrable) return null;
  return { textDomain: textReg, hrefDomain: hrefRegistrable };
}

/* -------------------------------------------------------------------------- */
/* Top-level analysis.                                                          */
/* -------------------------------------------------------------------------- */

const DANGEROUS_SCHEMES = new Set(['javascript:', 'data:', 'blob:', 'vbscript:']);

function highestSeverity(signals: Signal[]): Severity {
  let worst: Severity = 'ok';
  for (const s of signals) {
    if (SEVERITY_RANK[s.severity] > SEVERITY_RANK[worst]) worst = s.severity;
  }
  return worst;
}

/**
 * Analyse a single link. `anchorText` (the visible text of the `<a>`) is optional
 * and only used for the text-vs-destination mismatch check. Never throws.
 */
export function analyzeLink(href: string, anchorText?: string): LinkAnalysis {
  const raw = String(href ?? '');
  const signals: Signal[] = [];

  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }

  if (!url) {
    return {
      raw,
      valid: false,
      scheme: '',
      displayHost: '',
      asciiHost: '',
      registrableDomain: null,
      isPunycode: false,
      isShortener: false,
      cleanUrl: raw,
      strippedParams: [],
      risk: 'ok',
      signals: [],
    };
  }

  const scheme = url.protocol;

  // Dangerous schemes short-circuit host analysis — there is no host to reason
  // about, and the danger is the scheme itself.
  if (DANGEROUS_SCHEMES.has(scheme)) {
    signals.push({ code: 'dangerousScheme', severity: 'poor', vars: { scheme } });
    return {
      raw,
      valid: true,
      scheme,
      displayHost: '',
      asciiHost: '',
      registrableDomain: null,
      isPunycode: false,
      isShortener: false,
      cleanUrl: raw,
      strippedParams: [],
      risk: 'poor',
      signals,
    };
  }

  const asciiHost = url.hostname;
  const isPunycode = /(^|\.)xn--/i.test(asciiHost);
  let displayHost = asciiHost;
  if (isPunycode) {
    try {
      displayHost = punycode.toUnicode(asciiHost);
    } catch {
      displayHost = asciiHost;
    }
  }

  const parsed = parseHost(raw);
  const registrableDomain = parsed.domain ?? null;
  const publicSuffix = parsed.publicSuffix ?? null;
  const isShortener = isShortenerDomain(registrableDomain);

  // Userinfo obfuscation: https://apple.com@evil.com — the browser ignores the
  // part before "@"; the real site is the host.
  if (url.username) {
    signals.push({
      code: 'credentials',
      severity: 'poor',
      vars: { userinfo: url.username, host: displayHost || asciiHost },
    });
  }

  // Look-alike / mixed script on the decoded host.
  if (asciiHost) {
    const verdict = analyzeHost(displayHost, publicSuffix);
    if (verdict.confusable) {
      signals.push({
        code: 'confusable',
        severity: 'poor',
        vars: { lookalike: verdict.confusable.lookalike, script: verdict.confusable.script },
      });
    } else if (verdict.mixedScript) {
      signals.push({ code: 'mixedScript', severity: 'warn' });
    }
  }

  // Punycode reveal — INFORMATIONAL only (severity 'info', green). A non-ASCII /
  // internationalized domain is not itself suspicious; over-flagging every legitimate
  // non-Latin domain (россия.рф, 日本語.jp) is exactly what §12.4 warns against. Real
  // risk comes from the confusable / mixed-script signals above; this just reveals
  // the decoded name for transparency.
  if (isPunycode) {
    signals.push({ code: 'punycode', severity: 'info', vars: { unicode: displayHost } });
  }

  // Raw IP host instead of a domain name.
  if (parsed.isIp) {
    signals.push({ code: 'ipHost', severity: 'warn', vars: { host: asciiHost } });
  }

  // Anchor-text domain vs destination domain.
  const mismatch = anchorMismatch(anchorText, registrableDomain);
  if (mismatch) {
    signals.push({
      code: 'mismatch',
      severity: 'poor',
      vars: { textDomain: mismatch.textDomain, hrefDomain: mismatch.hrefDomain },
    });
  }

  // Insecure transport.
  if (scheme === 'http:' && asciiHost && asciiHost !== 'localhost') {
    signals.push({ code: 'insecure', severity: 'warn' });
  }

  // Shortener — destination hidden until visited.
  if (isShortener) {
    signals.push({ code: 'shortener', severity: 'info', vars: { host: displayHost || asciiHost } });
  }

  // Tracking parameters.
  const { cleanUrl, removed } = stripTrackingParams(raw);
  if (removed.length > 0) {
    signals.push({ code: 'tracking', severity: 'info', vars: { n: removed.length } });
  }

  return {
    raw,
    valid: true,
    scheme,
    displayHost,
    asciiHost,
    registrableDomain,
    isPunycode,
    isShortener,
    cleanUrl,
    strippedParams: removed,
    risk: highestSeverity(signals),
    signals,
  };
}

/** Map an analysis risk to a green/amber/red badge bucket used by the UIs. */
export function riskBadge(risk: Severity): 'ok' | 'warn' | 'poor' {
  if (risk === 'poor') return 'poor';
  if (risk === 'warn') return 'warn';
  return 'ok';
}
