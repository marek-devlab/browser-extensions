// LIVE test of the Firefox `webrequest` engine: the REAL built extension
// (extensions/netblock/.output/firefox-mv2) in the installed Firefox, against
// the offline fixture server of the spikes. Not in the default `e2e` chain —
// needs Firefox (SPIKE_FIREFOX) and a fresh `npm run build:firefox
// --workspace @blur/netblock`. Run:  npm run e2e:netblock-webrequest-live
//
// How the harness talks to the extension (plan 02-webrequest.md §2): Firefox
// is launched through `web-ext-run` (WXT's dependency) with `--marionette`;
// the add-on's internal UUID is read from `WebExtensionPolicy` in Marionette's
// chrome context (pinning it through the `extensions.webextensions.uuids`
// pref does not survive web-ext's temporary install). WebDriver's own navigate command
// (BiDi and classic alike, Firefox ≥ 153) refuses privileged URLs
// ("Navigation to moz-extension://… is not allowed in this context"), so the
// tab is opened the way a user would open it — `gBrowser.addTab` from
// Marionette's chrome context — and then driven from the content context.
// That tab shows the extension's own tool page (moz-extension://<uuid>/tool.html) where
// `browser.runtime.sendMessage` reaches the background's protocol router:
// rules are seeded with `importRules`, tabs paused with `pauseTab`, and the
// request log read back with `getLogPage` — the same paths the UI uses, no
// test hooks in the product. The fixture page runs the fetches; the server
// journal tells what reached the network.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';
import { startServers } from '../netblock-spikes/server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const EXT_DIR = join(ROOT, 'extensions/netblock/.output/firefox-mv2');
const FIREFOX = process.env.SPIKE_FIREFOX || 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';
const ADDON_ID = 'netblock@marek-devlab.github.io';
const MARIONETTE_PORT = Number(process.env.NETBLOCK_MARIONETTE_PORT || 2829);

if (!existsSync(FIREFOX)) throw new Error(`Firefox not found at ${FIREFOX} (set SPIKE_FIREFOX)`);
if (!existsSync(join(EXT_DIR, 'manifest.json'))) {
  throw new Error(`${EXT_DIR} is missing — run: npm run build:firefox --workspace @blur/netblock`);
}
const manifest = JSON.parse(readFileSync(join(EXT_DIR, 'manifest.json'), 'utf8'));
if (manifest.browser_specific_settings?.gecko?.id !== ADDON_ID) throw new Error('unexpected add-on id in the built manifest');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------- tiny Marionette ---------------------------- */

// Marionette protocol 3: TCP, frames are `<byte length>:<json>`; a command is
// `[0, id, name, params]`, a response `[1, id, error, result]`. The server
// greets with one frame ({applicationType, marionetteProtocol}) on connect.
class Marionette {
  constructor(port) {
    this.port = port;
    this.id = 0;
    this.pending = new Map();
    this.buf = Buffer.alloc(0);
  }
  async connect(timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        await new Promise((res, rej) => {
          const sock = connect({ host: '127.0.0.1', port: this.port });
          sock.once('connect', () => {
            this.sock = sock;
            res();
          });
          sock.once('error', rej);
        });
        break;
      } catch (e) {
        if (Date.now() > deadline) throw new Error(`Marionette not reachable on :${this.port}: ${e.message}`);
        await sleep(500);
      }
    }
    const hello = new Promise((r) => (this.onHello = r));
    this.sock.on('data', (d) => this.onData(d));
    this.sock.on('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('Marionette socket closed'));
    });
    await hello;
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const colon = this.buf.indexOf(':');
      if (colon === -1) return;
      const len = Number(this.buf.subarray(0, colon).toString());
      if (this.buf.length < colon + 1 + len) return;
      const body = JSON.parse(this.buf.subarray(colon + 1, colon + 1 + len).toString('utf8'));
      this.buf = this.buf.subarray(colon + 1 + len);
      if (!Array.isArray(body)) {
        this.onHello?.();
        continue;
      }
      const [, id, error, result] = body;
      const p = this.pending.get(id);
      if (!p) continue;
      this.pending.delete(id);
      if (error) p.reject(new Error(`${error.error}: ${error.message}`));
      else p.resolve(result);
    }
  }
  send(name, params = {}) {
    const id = ++this.id;
    if (process.env.NETBLOCK_LIVE_DEBUG) console.log('[mn]', name, JSON.stringify(params).slice(0, 200));
    const json = JSON.stringify([0, id, name, params]);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock.write(`${Buffer.byteLength(json)}:${json}`);
    });
  }
  async newTab(url) {
    const { handle } = await this.send('WebDriver:NewWindow', { type: 'tab', focus: true });
    await this.send('WebDriver:SwitchToWindow', { handle });
    await this.send('WebDriver:Navigate', { url });
    return handle;
  }
  /** Run a script in the browser window (system principal; needs --remote-allow-system-access). */
  async chromeEval(script, args = []) {
    await this.send('Marionette:SetContext', { value: 'chrome' });
    try {
      return (await this.send('WebDriver:ExecuteScript', { script, args })).value;
    } finally {
      await this.send('Marionette:SetContext', { value: 'content' });
    }
  }
  /** Open a privileged URL (moz-extension://) as the browser UI would; returns the tab's content handle. */
  async openPrivilegedTab(url) {
    const before = new Set(await this.send('WebDriver:GetWindowHandles'));
    await this.chromeEval(
      'const tab = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });' +
        'gBrowser.selectedTab = tab; return true;',
      [url],
    );
    for (let i = 0; i < 40; i++) {
      const now = await this.send('WebDriver:GetWindowHandles');
      const fresh = now.find((h) => !before.has(h));
      if (fresh) {
        await this.send('WebDriver:SwitchToWindow', { handle: fresh });
        // Wait for the page to be usable (the tool page loads its own scripts).
        for (let j = 0; j < 40; j++) {
          const { value } = await this.send('WebDriver:ExecuteScript', { script: 'return document.readyState + ":" + location.href;', args: [] });
          if (process.env.NETBLOCK_LIVE_DEBUG) console.log('[mn] tab state', value);
          if (value.startsWith('complete:' + url)) return fresh;
          await sleep(250);
        }
        return fresh;
      }
      await sleep(250);
    }
    throw new Error('privileged tab did not appear');
  }
  /**
   * Evaluate `expression` (may be a promise) in the given tab; JSON round-trip.
   * Marionette's content sandbox sees the page through Xray wrappers, which
   * hide both the extension's `browser` global and the fixture's helpers, so
   * the script runs in the system sandbox and reaches the page's own realm as
   * `w` (= window.wrappedJSObject): `w.browser…`, `w.eval(...)`.
   */
  async evalJson(handle, expression) {
    await this.send('WebDriver:SwitchToWindow', { handle });
    const script =
      'const done = arguments[arguments.length - 1]; const w = window.wrappedJSObject;\n' +
      `Promise.resolve().then(() => (${expression})).then(` +
      "(v) => done(w.JSON.stringify(v === undefined ? null : v)), (e) => done('\\u0000' + (e && e.name ? e.name + ': ' + e.message + ' ' : '') + String((e && e.stack) || e)));";
    const { value } = await this.send('WebDriver:ExecuteAsyncScript', { script, args: [], newSandbox: false, sandbox: 'system' });
    if (typeof value === 'string' && value.startsWith('\u0000')) throw new Error(`page threw: ${value.slice(1)}`);
    return JSON.parse(value);
  }
  close() {
    try {
      this.sock?.destroy();
    } catch {
      // already gone
    }
  }
}

/* --------------------------------- rules --------------------------------- */

function rule(id, over) {
  return {
    id,
    name: id,
    enabled: true,
    priority: 0,
    createdAt: 1,
    scope: 'all',
    condition: { url: { op: 'contains', value: `/api/${id}` }, resourceTypes: ['xhr'] },
    state: { kind: 'every' },
    countKey: 'rule+tab',
    resetOn: 'manual',
    action: { type: 'block' },
    engine: 'auto',
    ...over,
  };
}
const RULES = {
  version: 1,
  groups: [],
  rules: [
    rule('blockedimg', { condition: { url: { op: 'contains', value: '/api/blockedimg' }, resourceTypes: ['image'] } }),
    rule('slow', { action: { type: 'delay', ms: 800 } }),
    rule('nth', { state: { kind: 'nth', n: 2 } }),
    rule('five', { condition: { url: { op: 'contains', value: '/api/five' }, resourceTypes: ['xhr'], responseStatus: '5xx' }, action: { type: 'status', code: 503 } }),
    rule('pause'),
  ],
};

/* -------------------------------- harness -------------------------------- */

const checks = [];
function check(name, ok, info) {
  checks.push({ name, ok: !!ok, info });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${info !== undefined ? `  — ${typeof info === 'string' ? info : JSON.stringify(info)}` : ''}`);
}

const srv = await startServers();
const { default: webExt } = await import('web-ext-run');
console.log('[live] launching Firefox with the built extension…');
const runner = await webExt.cmd.run(
  {
    sourceDir: EXT_DIR,
    firefox: FIREFOX,
    startUrl: 'about:blank',
    noInput: true,
    noReload: true,
    // Chrome-context scripts need explicit system access since Firefox 138.
    args: ['--marionette', '--remote-allow-system-access'],
    pref: { 'marionette.port': MARIONETTE_PORT },
  },
  { shouldExitProgram: false },
);

let mn;
try {
  mn = new Marionette(MARIONETTE_PORT);
  await mn.connect();
  await mn.send('WebDriver:NewSession', { capabilities: { alwaysMatch: {} } });
  // The temporary add-on is installed by web-ext over RDP after launch; give
  // the background a moment to register before we knock on its door.
  await sleep(2500);

  let uuid;
  for (let i = 0; i < 40 && !uuid; i++) {
    uuid = await mn.chromeEval('const p = WebExtensionPolicy.getByID(arguments[0]); return p && p.active ? p.mozExtensionHostname : null;', [ADDON_ID]);
    if (!uuid) await sleep(500);
  }
  check('temporary add-on is active (WebExtensionPolicy)', !!uuid, uuid);
  const toolCtx = await mn.openPrivilegedTab(`moz-extension://${uuid}/tool.html`);
  const msg = (m) => mn.evalJson(toolCtx, `w.browser.runtime.sendMessage(w.JSON.parse(${JSON.stringify(JSON.stringify(m))}))`);

  const imported = await msg({ type: 'importRules', text: JSON.stringify(RULES), mode: 'replace' });
  check('rules seeded through importRules', imported.ok && imported.imported === RULES.rules.length, imported);
  const listed = await msg({ type: 'listRules' });
  const applied = listed.applied.compiled.map((c) => [c.rule.id, c.engine, c.degraded ?? null]);
  check('every rule compiled to the webrequest engine', applied.length === 5 && applied.every((a) => a[1] === 'webrequest'), applied);
  check('fail/status rules carry the wr↓ key at compile time', applied.find((a) => a[0] === 'five')?.[2] === 'ffStatusCancel');
  // The tool page's own list (real DOM, not the protocol): the `status` rule wears the wr↓ badge (design §5.4, §6.6).
  // The page was open before importRules and its store only re-reads on its own mutations → reload it first.
  await mn.evalJson(toolCtx, 'w.location.reload()').catch(() => undefined);
  // An object built in the system sandbox stringifies as `{}` through `w.JSON` (Xray) — return a plain string.
  let badge = null;
  for (let i = 0; i < 40 && !badge; i++) {
    badge = await mn.evalJson(toolCtx, "(() => { const el = w.document.querySelector('[role=\"option\"][data-rule-id=\"five\"] .ebadge'); return el ? el.textContent.trim() + '|' + el.dataset.engine + '|' + el.dataset.degraded : null; })()").catch(() => null);
    if (!badge) await sleep(250);
  }
  check('tool page shows the wr↓ badge on the status rule', typeof badge === 'string' && /wr↓\|webrequest\|true$/.test(badge), badge);

  const pageCtx = await mn.newTab(`${srv.pageOrigin}/page.html`);
  const page = (expr) => mn.evalJson(pageCtx, `w.eval(${JSON.stringify(expr)})`);
  const tabs = await mn.evalJson(toolCtx, 'w.browser.tabs.query(w.JSON.parse("{}"))');
  const tabId = tabs.find((t) => String(t.url).startsWith(srv.pageOrigin))?.id;
  check('fixture tab found from the extension side', typeof tabId === 'number', tabs.map((t) => [t.id, t.url]));
  const hits = (p) => srv.journal.filter((j) => j.path.startsWith(p)).length;

  // (a) image block → never reaches the server (a control image does).
  const img = (p) => page(`new Promise((r) => { const i = new Image(); i.onload = () => r('load'); i.onerror = () => r('error'); i.src = ${JSON.stringify(srv.pageOrigin + p)}; })`);
  await img('/api/img-control?status=200');
  await img('/api/blockedimg?status=200');
  await sleep(300);
  check('(a) control image reached the server', hits('/api/img-control') === 1, hits('/api/img-control'));
  check('(a) blocked image never reached the server', hits('/api/blockedimg') === 0, hits('/api/blockedimg'));

  // (b) delay 800 → ≥ 750 ms, response intact.
  const slow = await page(`(async () => { const t0 = performance.now(); const r = await __fetchStatus(${JSON.stringify(srv.pageOrigin + '/api/slow?status=200')}); return { ...r, ms: Math.round(performance.now() - t0) }; })()`);
  check('(b) delay 800 → request took ≥ 750 ms and completed with 200', slow.ok && slow.status === 200 && slow.ms >= 750, slow);

  // (c) nth:2 → 2nd cancelled at the network level; 1st and 3rd reach the server.
  const nth = [];
  for (let i = 0; i < 3; i++) nth.push(await page(`__fetchStatus(${JSON.stringify(srv.pageOrigin + '/api/nth?status=200&i=' + i)})`));
  check('(c) nth:2 → 1st ok, 2nd cancelled, 3rd ok', nth[0].ok && !nth[1].ok && nth[2].ok, nth.map((r) => (r.ok ? r.status : r.error)));
  check('(c) the server saw only the 1st and 3rd', hits('/api/nth') === 2, srv.journal.filter((j) => j.path.startsWith('/api/nth')).map((j) => j.path));

  // (d) response-status 5xx on a real 500 → cancelled (server was reached); 200 passes.
  const fiveOk = await page(`__fetchStatus(${JSON.stringify(srv.pageOrigin + '/api/five?status=200')})`);
  const five = await page(`__fetchStatus(${JSON.stringify(srv.pageOrigin + '/api/five?status=500')})`);
  check('(d) 5xx rule: a 200 passes, a real 500 is cancelled', fiveOk.ok && fiveOk.status === 200 && !five.ok, { fiveOk, five });
  check('(d) the 500 reached the server (response stage)', hits('/api/five?status=500') === 1);

  // (e) pause → passes; resume → blocked again.
  await msg({ type: 'pauseTab', tabId, paused: true });
  const paused = await page(`__fetchStatus(${JSON.stringify(srv.pageOrigin + '/api/pause?status=200')})`);
  await msg({ type: 'pauseTab', tabId, paused: false });
  const resumed = await page(`__fetchStatus(${JSON.stringify(srv.pageOrigin + '/api/pause?status=200&r=1')})`);
  check('(e) paused tab passes, resumed tab is blocked again', paused.ok && paused.status === 200 && !resumed.ok, { paused, resumed });

  // Log rows: one per request, hits attributed, wr↓ mark on the degraded one.
  await sleep(500);
  const log = await msg({ type: 'getLogPage', afterId: 0, limit: 500 });
  const rows = log.entries.filter((e) => e.tabId === tabId);
  const byPath = (p) => rows.filter((e) => e.url.includes(p));
  const five500 = byPath('/api/five?status=500')[0];
  check('log: degraded 5xx hit is blocked with the ↓ mark and its rule id', five500?.outcome === 'blocked' && five500.marks.includes('degraded') && five500.ruleId === 'five' && five500.engine === 'webrequest', five500);
  const slowRow = byPath('/api/slow')[0];
  check('log: delayed row carries delayMs and the real status', slowRow?.outcome === 'delayed' && slowRow.delayMs === 800 && slowRow.status === 200, slowRow);
  const nthRows = byPath('/api/nth').map((e) => e.outcome);
  check('log: nth rows are passed/blocked/passed', JSON.stringify(nthRows) === JSON.stringify(['passed', 'blocked', 'passed']), nthRows);
  const imgRow = byPath('/api/blockedimg')[0];
  check('log: blocked image row typed as image', imgRow?.outcome === 'blocked' && imgRow.type === 'image', imgRow);
  const pausedRow = byPath('/api/pause?status=200')[0];
  check('log: paused request logged as passed without a rule', pausedRow?.outcome === 'passed' && !pausedRow.ruleId, pausedRow);
  const summary = await msg({ type: 'getTabSummary', tabId });
  const nthStatus = summary.rules.find((r) => r.rule.id === 'nth');
  check('counters written through: nth rule shows seen 3 / hits 1 for this tab', nthStatus?.counter?.seen === 3 && nthStatus.counter.hits === 1, nthStatus?.counter);
} catch (e) {
  check('harness ran to the end', false, String(e?.stack ?? e));
} finally {
  mn?.close();
  await runner.exit().catch(() => undefined);
  // Let Firefox release the temporary profile before firefox-profile's exit
  // hook tries to delete it (otherwise a harmless EPERM is printed).
  await sleep(1500);
  await srv.close();
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
