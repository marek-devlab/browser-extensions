// Mechanical guards. Run with:  npm run guards
//
// Three classes of defect have already been caught by hand in this repo, and
// every one of them is invisible in review until it ships:
//
//   1. XSS sinks. Untrusted page content and untrusted user documents both end
//      up inside privileged extension pages that hold chrome.* . An innerHTML
//      there is extension compromise, not a defacement. `docs/design/compose.md`
//      asks for an ESLint rule; typescript-eslint does not support TypeScript 7
//      (peer range stops at <6.1.0), so the ban is enforced here instead.
//
//   2. Remote code. A CDN URL in the bundle is an instant Chrome Web Store
//      reject. It only ever arrives through a library's default loader.
//
//   3. <all_urls> smuggled into the BUILT manifest. WXT hoists a content
//      script's `matches` into install-time host_permissions even when
//      `registration: 'runtime'` keeps it out of `content_scripts`. The config
//      looks clean; the manifest asks to "read and change all your data on all
//      websites". Two extensions strip it in a build:manifestGenerated hook --
//      this check fails the build if such a hook is ever dropped.
//
//   4. Three more built-manifest checks added with netblock (design §7.5):
//      `declarativeNetRequestFeedback` anywhere (ignored for CWS installs,
//      adds a "read your browsing history" warning -- pure downside);
//      `debugger` in install-time `permissions` (full CDP access + the
//      permanent "debugging this browser" surface -- only ever opt-in, and
//      only with an explicit allowlist entry here); and a `connect-src` in any
//      CSP that allows a host (the zero-network extensions carry no
//      `connect-src` or `connect-src 'none'`; the one extension whose purpose
//      IS network is allowlisted with its hosts).
//
// Exit code is nonzero on any violation, so this belongs in CI.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const violations = [];

// ---------------------------------------------------------------------------
// 1 + 2. Source scan.
// ---------------------------------------------------------------------------

// Comments are stripped before matching so that prose *about* a sink (the UI
// string that explains MV3 bans eval, the comment explaining why fetch(dataUrl)
// is not used) does not read as a sink.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const SINKS = [
  { re: /\.innerHTML\s*=/, msg: 'assignment to .innerHTML' },
  { re: /\.outerHTML\s*=/, msg: 'assignment to .outerHTML' },
  { re: /insertAdjacentHTML\s*\(/, msg: 'insertAdjacentHTML()' },
  { re: /dangerouslySetInnerHTML/, msg: 'dangerouslySetInnerHTML' },
  { re: /document\.write\s*\(/, msg: 'document.write()' },
  { re: /new\s+Function\s*\(/, msg: 'new Function()' },
  // devtools.inspectedWindow.eval is the sanctioned DevTools API (a panel gets
  // no activeTab, so it is the only way to reach the page) -- not JS eval().
  { re: /(^|[^.\w])eval\s*\(/, msg: 'eval()', allow: /inspectedWindow\s*\.\s*eval/ },
];

const REMOTE = /https?:\/\/(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.|.*\.cdn\.)/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.output' || name === '.wxt' || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

for (const root of ['extensions', 'packages']) {
  const abs = join(repoRoot, root);
  if (!existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const rel = relative(repoRoot, file).replace(/\\/g, '/');
    src.split('\n').forEach((line, i) => {
      for (const sink of SINKS) {
        if (sink.re.test(line) && !(sink.allow && sink.allow.test(line))) {
          violations.push(`${rel}:${i + 1}  XSS sink: ${sink.msg}`);
        }
      }
      if (REMOTE.test(line)) violations.push(`${rel}:${i + 1}  remote code: ${line.trim().slice(0, 80)}`);
    });
  }
}

// ---------------------------------------------------------------------------
// 3. Built-manifest scan. Only extensions that are genuinely allowed to ask for
// every site at install time are listed here, with the reason. adblock is the
// only one: on Firefox MV2 a blocker cannot block without webRequestBlocking +
// <all_urls>, and there is no optional path for it.
// ---------------------------------------------------------------------------

// A string allows both targets; an object allows only the named targets --
// netblock's Chrome build must stay clean (host access is per-site, opt-in)
// while its Firefox build needs `<all_urls>` for the same reason adblock does.
const BASELINE_ALL_URLS_ALLOWED = {
  adblock: 'MV2 webRequestBlocking cannot function without it; Chrome build keeps it optional',
  netblock: {
    'firefox-mv2': 'MV2 webRequestBlocking cannot cancel without it; Chrome build asks per site (optional_host_permissions)',
  },
};

function allUrlsAllowed(name, target) {
  const entry = BASELINE_ALL_URLS_ALLOWED[name];
  if (!entry) return false;
  return typeof entry === 'string' || Boolean(entry[target]);
}

const ALL_URLS = /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*)$/;

// `debugger` at install time. An entry here is a product decision with a
// reason, never a convenience. Chromium marks `debugger` kFlagCannotBeOptional
// (an `optional_permissions` entry is dropped with an install warning), so an
// extension whose purpose needs it can only carry it install-time. netblock:
// owner-approved 2026-09-15 -- its "Network-level mode" fails requests with
// their REAL response status / network error type via CDP Fetch, which no
// other API can do; it is opt-in per tab at runtime (nothing attaches until
// the user toggles it in the popup) -- see extensions/netblock/wxt.config.ts.
// perf still lists it as optional (same latent problem, separate decision).
const BASELINE_DEBUGGER_ALLOWED = {
  netblock: 'CDP Fetch is the only API that can fail a request with a real status/error type; opt-in per tab, never optional in Chromium',
};

// `connect-src` that names a host. whoami's single purpose is "show my
// connection" and it fetches exactly these two endpoints, disclosed in the
// listing and PRIVACY.md. Everything else is zero-network.
const CONNECT_SRC_ALLOWED = {
  whoami: "connect-src 'self' https://one.one.one.one https://ipinfo.io",
};

/** Every CSP string in a manifest, MV2 (bare string) or MV3 (object of strings). */
function cspStrings(m) {
  const csp = m.content_security_policy;
  if (!csp) return [];
  if (typeof csp === 'string') return [csp];
  return Object.values(csp).filter((v) => typeof v === 'string');
}

const extDir = join(repoRoot, 'extensions');
let manifestsChecked = 0;
for (const name of readdirSync(extDir)) {
  for (const target of ['chrome-mv3', 'firefox-mv2']) {
    const p = join(extDir, name, '.output', target, 'manifest.json');
    if (!existsSync(p)) continue;
    manifestsChecked++;
    const m = JSON.parse(readFileSync(p, 'utf8'));
    const where = `extensions/${name}/.output/${target}/manifest.json`;
    // Firefox MV2 mixes host permissions into `permissions`; MV3 separates them.
    const baseline = [...(m.permissions ?? []), ...(m.host_permissions ?? [])];
    const offending = baseline.filter((perm) => ALL_URLS.test(perm));
    if (offending.length && !allUrlsAllowed(name, target)) {
      violations.push(
        `${where}  baseline host permission ${offending.join(', ')} ` +
          `-- WXT hoisted a runtime content script's matches; strip it in build:manifestGenerated`,
      );
    }

    // 4a. declarativeNetRequestFeedback -- never, in any list.
    const everyPerm = [...baseline, ...(m.optional_permissions ?? [])];
    if (everyPerm.includes('declarativeNetRequestFeedback')) {
      violations.push(`${where}  declarativeNetRequestFeedback requested -- ignored for CWS installs, adds a browsing-history warning`);
    }

    // 4b. debugger -- only ever optional (and note: Chromium ignores it there too).
    if ((m.permissions ?? []).includes('debugger') && !BASELINE_DEBUGGER_ALLOWED[name]) {
      violations.push(`${where}  debugger in install-time permissions -- opt-in only; add a reasoned allowlist entry if this is intended`);
    }

    // 4c. connect-src that allows a host.
    for (const csp of cspStrings(m)) {
      const directive = csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => /^connect-src\b/.test(d));
      if (!directive) continue;
      if (directive === "connect-src 'none'") continue;
      if (CONNECT_SRC_ALLOWED[name] === directive) continue;
      violations.push(`${where}  CSP "${directive}" allows network -- zero-network extensions carry no connect-src or 'none'`);
    }
  }
}

// ---------------------------------------------------------------------------

if (violations.length) {
  console.error(`\n${violations.length} violation(s):\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error('');
  process.exit(1);
}
console.log(`Guards clean: no XSS sinks, no remote code, no smuggled <all_urls>, no DNR feedback, no unlisted baseline debugger, no network CSP (${manifestsChecked} built manifests checked).`);
