// Fixture + ad-host server for the adblock e2e harness.
//
// One HTTP server serves BOTH roles, keyed by URL path (Host header ignored):
//   - fixture pages  (requested via 127.0.0.1 or a mapped page host like victim.test)
//   - "ad"/"tracker" sub-resources (requested via hosts in the bundled rules, which
//     Chromium's --host-resolver-rules maps back to this same server)
//
// This keeps the whole test OFFLINE and deterministic: a request to a blockable
// host either dies at DNR (ERR_BLOCKED_BY_CLIENT, never resolved) or, when not
// blocked, resolves here and returns 200. No real ad network is ever contacted.
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// 1x1 transparent GIF.
const GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

const PAGES = {
  // Network-blocking fixture. Served as the page's main document.
  '/network.html': `<!doctype html><html><head><meta charset="utf-8"><title>network</title></head>
<body>
<h1>network fixture</h1>
<img id="ad" src="https://buzzoola.com/ad.gif" alt="ad">
<img id="tracker" src="https://mradx.net/pixel.gif" alt="tracker">
<script>
  window.__res = { ad: null, tracker: null };
  document.getElementById('ad').addEventListener('load', () => (window.__res.ad = 'load'));
  document.getElementById('ad').addEventListener('error', () => (window.__res.ad = 'error'));
  document.getElementById('tracker').addEventListener('load', () => (window.__res.tracker = 'load'));
  document.getElementById('tracker').addEventListener('error', () => (window.__res.tracker = 'error'));
</script>
</body></html>`,

  // Site-specific cosmetic fixture. Meant to be loaded as http://youtube.com/...
  // so the content script sees hostname youtube.com and applies the youtube rules.
  '/cosmetic-site.html': `<!doctype html><html><head><meta charset="utf-8"><title>yt</title></head>
<body>
<div id="content">real content</div>
<ytd-display-ad-renderer id="ytad">sponsored</ytd-display-ad-renderer>
<div id="player-ads">player ad</div>
</body></html>`,

  // Generic cosmetic fixture (aggressive tier). Any host.
  '/cosmetic-generic.html': `<!doctype html><html><head><meta charset="utf-8"><title>generic</title></head>
<body>
<div id="content">real content</div>
<div class="ad" id="genad">generic ad box</div>
<div class="advertisement" id="genad2">another ad</div>
</body></html>`,

  // Custom per-site cosmetic fixture (element picker / custom filters feature).
  '/custom.html': `<!doctype html><html><head><meta charset="utf-8"><title>custom</title></head>
<body>
<div id="content">real content</div>
<div id="sponsored-slot" class="promo-box">custom junk</div>
</body></html>`,
};

export function startServer() {
  const tls = {
    key: readFileSync(join(HERE, 'certs', 'key.pem')),
    cert: readFileSync(join(HERE, 'certs', 'cert.pem')),
  };
  return new Promise((resolve) => {
    const server = createServer(tls, (req, res) => {
      const url = new URL(req.url, 'http://x');
      const path = url.pathname;
      if (PAGES[path]) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(PAGES[path]);
        return;
      }
      if (path.endsWith('.gif') || path.endsWith('.png')) {
        res.writeHead(200, { 'content-type': 'image/gif' });
        res.end(GIF);
        return;
      }
      if (path.endsWith('.js')) {
        res.writeHead(200, { 'content-type': 'application/javascript' });
        res.end('window.__adScriptLoaded = true;');
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}
