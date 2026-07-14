// Minimal fixture HTTP server for the SEO & Accessibility Auditor E2E harness.
//
// Content scripts do not run on about:blank / data: / setContent, so fixtures
// MUST be served over real HTTP on 127.0.0.1. Two instances are started by the
// test:
//   - a "full" origin that serves robots.txt (200) and sitemap.xml (200), and
//   - a "bare" origin that 404s both, to prove the indexability checks degrade
//     gracefully (never throw) when those files are absent.
//
// A dedicated /xrobots route sets `X-Robots-Tag: noindex` (on GET and HEAD) so
// the header-based indexability probe can be exercised end to end.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

async function fixture(name, port) {
  const raw = await readFile(join(HERE, 'fixtures', name), 'utf8');
  return raw.replaceAll('__PORT__', String(port));
}

/**
 * Start one fixture origin.
 * @param {{ port?: number, bare?: boolean }} opts
 * @returns {Promise<{ port: number, origin: string, close: () => Promise<void> }>}
 */
export function startServer({ port = 0, bare = false } = {}) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      void handle(req, res);
    });

    async function handle(req, res) {
      const actualPort = /** @type {{ port: number }} */ (server.address()).port;
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${actualPort}`);
      const path = url.pathname;
      const isHead = req.method === 'HEAD';

      const send = (status, type, body, extraHeaders = {}) => {
        res.writeHead(status, { 'content-type': type, ...extraHeaders });
        res.end(isHead ? undefined : body);
      };

      try {
        if (path === '/' || path === '/index.html') {
          send(200, 'text/html; charset=utf-8', await fixture('rich.html', actualPort));
          return;
        }
        if (path === '/xrobots') {
          send(
            200,
            'text/html; charset=utf-8',
            await fixture('rich.html', actualPort),
            { 'x-robots-tag': 'noindex' },
          );
          return;
        }
        if (path === '/nodesc') {
          send(200, 'text/html; charset=utf-8', await fixture('nodesc.html', actualPort));
          return;
        }
        if (path === '/robots.txt') {
          if (bare) {
            send(404, 'text/plain; charset=utf-8', 'not found');
            return;
          }
          send(
            200,
            'text/plain; charset=utf-8',
            `User-agent: *\nAllow: /\nSitemap: http://127.0.0.1:${actualPort}/sitemap.xml\n`,
          );
          return;
        }
        if (path === '/sitemap.xml') {
          if (bare) {
            send(404, 'text/plain; charset=utf-8', 'not found');
            return;
          }
          send(
            200,
            'application/xml; charset=utf-8',
            `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://127.0.0.1:${actualPort}/</loc></url></urlset>`,
          );
          return;
        }
        // Any other asset (images, /about, page2.html, /fr…): 200 empty so the
        // browser does not spend time on failed requests during the audit.
        send(200, 'text/plain; charset=utf-8', 'ok');
      } catch (err) {
        send(500, 'text/plain; charset=utf-8', String(err));
      }
    }

    server.listen(port, '127.0.0.1', () => {
      const actualPort = /** @type {{ port: number }} */ (server.address()).port;
      resolve({
        port: actualPort,
        origin: `http://127.0.0.1:${actualPort}`,
        close: () =>
          new Promise((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}
