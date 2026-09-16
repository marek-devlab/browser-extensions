// Firefox spike 2 for netblock (docs/design/netblock.md §5.4/§12.2, Research §9.5):
// what does the page see when a blocking `onHeadersReceived` listener answers a
// real HTTP 500 with redirectUrl (data: / moz-extension) or cancel, same-origin
// and cross-origin (CORS), for fetch and XHR; and does an async (delayed)
// blocking listener work as a `delay` action.
//
// Method: `web-ext run` installs ./ext-firefox as a temporary add-on into a
// fresh profile of the installed Firefox and opens the fixture page. The
// extension runs the cases inside the tab and POSTs them to /result on the
// fixture server. No Playwright (it cannot load Firefox extensions).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, existsSync } from 'node:fs';
import { startServers } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = join(HERE, 'ext-firefox');
const FIREFOX = process.env.SPIKE_FIREFOX || 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';
if (!existsSync(FIREFOX)) throw new Error('Firefox not found at ' + FIREFOX);

const srv = await startServers();
const startUrl = `${srv.pageOrigin}/page.html?api=${encodeURIComponent(srv.apiOrigin)}`;

// On Windows npx is a .cmd shim, which needs a shell; quote every argument
// ourselves because `shell: true` only concatenates them.
const q = (a) => (process.platform === 'win32' ? '"' + a.replace(/"/g, '\\"') + '"' : a);
const args = ['--yes', 'web-ext@8', 'run', '--source-dir', EXT_PATH, '--firefox', FIREFOX, '--start-url', startUrl, '--no-input', '--no-reload'];
const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  process.platform === 'win32' ? args.map(q) : args,
  { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
);
child.stdout.on('data', (d) => process.stdout.write('[web-ext] ' + d));
child.stderr.on('data', (d) => process.stderr.write('[web-ext] ' + d));

const deadline = Date.now() + 120_000;
while (srv.results.length === 0 && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
}
const out = { when: new Date().toISOString(), firefox: FIREFOX, result: srv.results[0] ?? { error: 'timeout: no result posted' }, journal: srv.journal.filter((j) => j.path.includes('/api/x')) };
const file = join(HERE, 'results-firefox.json');
writeFileSync(file, JSON.stringify(out, null, 2));
console.log('[spike] wrote', file);
if (out.result.cases) {
  for (const c of out.result.cases) console.log(JSON.stringify(c));
  console.log('listenerSaw:', JSON.stringify(out.result.listenerSaw));
} else {
  console.log(JSON.stringify(out.result));
}
// web-ext keeps Firefox open until it is killed.
if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
else child.kill('SIGTERM');
await srv.close();
process.exit(0);
