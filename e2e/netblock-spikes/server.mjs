// Fixture server for the netblock pre-design spikes (docs/design/netblock.md §12,
// TODO.md «🧪 №16 — Блокеры старта кода»).
//
// Two plain-HTTP origins on 127.0.0.1 so cross-origin (CORS) behaviour is real:
//   A (pageOrigin) — serves the fixture page, same-origin /api/*, a WebSocket
//                    upgrade at /ws, and the POST /result collector the Firefox
//                    spike extension reports into.
//   B (apiOrigin)  — cross-origin /api/* with `Access-Control-Allow-Origin: *`.
//
// Every request is journaled with a monotonic timestamp so a spike can tell
// "blocked before the network" (never reaches the journal) from "reached the
// server" — the same trick as e2e/adblock/server.mjs.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>netblock spike</title></head>
<body><h1>netblock spike fixture</h1><pre id="out"></pre>
<script>
  // Helpers the harness drives via page.evaluate(). Kept tiny and dependency-free.
  window.__fetchStatus = async (url, init) => {
    try {
      const r = await fetch(url, init);
      const text = await r.text();
      return { ok: true, status: r.status, type: r.type, text: text.slice(0, 200), url: r.url };
    } catch (e) {
      return { ok: false, error: String(e && e.name), message: String(e && e.message) };
    }
  };
  window.__xhrStatus = (url) => new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open('GET', url);
    x.onload = () => resolve({ ok: true, status: x.status, text: String(x.responseText).slice(0, 200) });
    x.onerror = () => resolve({ ok: false, error: 'error', status: x.status });
    x.send();
  });
  window.__ws = (url) => new Promise((resolve) => {
    const t = setTimeout(() => resolve({ result: 'timeout' }), 4000);
    let s;
    try { s = new WebSocket(url); } catch (e) { clearTimeout(t); resolve({ result: 'throw', message: String(e) }); return; }
    s.onopen = () => { clearTimeout(t); s.close(); resolve({ result: 'open' }); };
    s.onerror = () => { clearTimeout(t); resolve({ result: 'error' }); };
  });
</script></body></html>`;

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-spike',
    'access-control-expose-headers': 'x-spike-server',
  };
}

export function startServers() {
  const journal = [];
  const results = [];
  const t0 = performance.timeOrigin;
  const now = () => performance.timeOrigin + performance.now() - t0 + t0; // wall-clock ms

  function handler(role) {
    return (req, res) => {
      const url = new URL(req.url, 'http://x');
      journal.push({ role, method: req.method, path: url.pathname + url.search, t: now() });
      const cors = corsHeaders(req.headers.origin);

      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      if (url.pathname === '/' || url.pathname === '/page.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(PAGE);
        return;
      }
      if (url.pathname === '/result' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            results.push(JSON.parse(body));
          } catch {
            results.push({ raw: body });
          }
          res.writeHead(200, cors);
          res.end('ok');
        });
        return;
      }
      // /api/<name>?status=NNN&delay=MS  — JSON echo with a chosen status.
      if (url.pathname.startsWith('/api/')) {
        const status = Number(url.searchParams.get('status') ?? 200);
        const delay = Number(url.searchParams.get('delay') ?? 0);
        const payload = JSON.stringify({ role, path: url.pathname, status, t: now() });
        setTimeout(() => {
          res.writeHead(status, {
            ...cors,
            'content-type': 'application/json',
            'x-spike-server': role,
            'cache-control': 'no-store',
          });
          res.end(payload);
        }, delay);
        return;
      }
      res.writeHead(404, cors);
      res.end('nf');
    };
  }

  const a = createServer(handler('A'));
  const b = createServer(handler('B'));

  // Minimal RFC 6455 handshake so `new WebSocket(...)` reaches `open`. No frames
  // are ever exchanged — the spike only needs to know whether the HANDSHAKE
  // request is visible to CDP Fetch / DNR.
  const sockets = new Set();
  for (const s of [a, b]) s.on('connection', (c) => { sockets.add(c); c.on('close', () => sockets.delete(c)); });
  a.on('upgrade', (req, socket) => {
    sockets.add(socket);
    journal.push({ role: 'A', method: 'UPGRADE', path: req.url, t: now() });
    const key = req.headers['sec-websocket-key'];
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on('error', () => {});
  });

  return new Promise((resolve) => {
    a.listen(0, '127.0.0.1', () => {
      b.listen(0, '127.0.0.1', () => {
        const pa = a.address().port;
        const pb = b.address().port;
        resolve({
          pageOrigin: `http://127.0.0.1:${pa}`,
          apiOrigin: `http://127.0.0.1:${pb}`,
          wsUrl: `ws://127.0.0.1:${pa}/ws`,
          journal,
          results,
          async close() {
            // Upgraded (WebSocket) sockets and keep-alive connections would keep
            // server.close() pending forever — destroy them first.
            for (const c of sockets) c.destroy();
            a.closeAllConnections?.();
            b.closeAllConnections?.();
            await new Promise((r) => a.close(r));
            await new Promise((r) => b.close(r));
          },
        });
      });
    });
  });
}
