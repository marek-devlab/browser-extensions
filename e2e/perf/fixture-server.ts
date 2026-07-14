import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Local HTTP fixtures on 127.0.0.1 (PLAN harness rule: content scripts don't run
// on about:blank/data:/setContent). Two servers on two ports give two *origins*
// (origin includes the port), which is exactly what the transferSize honesty rule
// needs: a resource on the cross-origin server is masked by the browser unless it
// sends `Timing-Allow-Origin`.

export interface Fixtures {
  pageOrigin: string;
  crossOrigin: string;
  close(): Promise<void>;
}

/** A JS body of a known, clearly-non-zero size so byte assertions are meaningful. */
function jsBody(tag: string, padTo: number): string {
  const head = `/* ${tag} */\nwindow.__loaded_${tag} = true;\n`;
  const pad = 'x'.repeat(Math.max(0, padTo - head.length));
  return `${head}// ${pad}\n`;
}

// A minimal but real 1x1 PNG (used as a large-displayed LCP candidate).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function send(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function startPageServer(getCrossOrigin: () => string): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const cross = getCrossOrigin();

    if (url === '/mixed') {
      // Same-origin script + image (real bytes), cross-origin WITH TAO (real bytes),
      // cross-origin WITHOUT TAO (unmeasurable → null → "unmeasured").
      send(
        res,
        200,
        'text/html; charset=utf-8',
        `<!doctype html><html><head><meta charset="utf-8"><title>mixed</title>
<script src="/app.js"></script>
<script src="${cross}/tao.js"></script>
<script src="${cross}/notao.js"></script>
</head><body>
<h1>Mixed fixture</h1>
<img id="hero" src="/logo.png" width="600" height="400" alt="hero">
</body></html>`,
      );
      return;
    }

    if (url === '/same-only') {
      // All same-origin: every resource reports its size → zero unmeasured.
      send(
        res,
        200,
        'text/html; charset=utf-8',
        `<!doctype html><html><head><meta charset="utf-8"><title>same-only</title>
<script src="/app.js"></script>
</head><body>
<h1>Same-origin fixture</h1>
<img id="hero" src="/logo.png" width="600" height="400" alt="hero">
</body></html>`,
      );
      return;
    }

    if (url === '/forge') {
      // A hostile page that posts a forged vital bridge message WITHOUT the relay's
      // per-load nonce. The relay must reject it. Sentinel value 424242 is used so
      // the test can prove it never reached the background.
      send(
        res,
        200,
        'text/html; charset=utf-8',
        `<!doctype html><html><head><meta charset="utf-8"><title>forge</title></head>
<body><h1>Forge fixture</h1>
<img id="hero" src="/logo.png" width="600" height="400" alt="hero">
<script>
  // Repeatedly post a forged vital with the wrong nonce.
  function forge() {
    window.postMessage({
      tag: '__blur_perf_vital__',
      nonce: 'totally-wrong-nonce',
      vital: { name: 'LCP', value: 424242, unit: 'ms', rating: 'poor' }
    }, location.origin);
  }
  for (let i = 0; i < 5; i++) setTimeout(forge, i * 100);
</script>
</body></html>`,
      );
      return;
    }

    if (url === '/blocking') {
      // Deliberately blocks the main thread for ~150ms so a Long Animation Frame /
      // Long Task is guaranteed, with real script attribution.
      send(
        res,
        200,
        'text/html; charset=utf-8',
        `<!doctype html><html><head><meta charset="utf-8"><title>blocking</title></head>
<body><h1>Blocking fixture</h1>
<img id="hero" src="/logo.png" width="600" height="400" alt="hero">
<script>
  function blockMainThread() {
    var end = performance.now() + 150;
    var x = 0;
    while (performance.now() < end) { x += Math.sqrt(x + 1); }
    return x;
  }
  // Run after first paint so it lands in a long animation frame.
  requestAnimationFrame(function () { setTimeout(blockMainThread, 0); });
</script>
</body></html>`,
      );
      return;
    }

    if (url === '/shift') {
      // The classic CLS bug, staged deliberately: an image with NO height that
      // arrives late, so everything under it is shoved down the moment it lands.
      // The point of the fixture is the ATTRIBUTION — the extension must be able to
      // name `#shifter` as the element that moved, which is the difference between
      // "CLS 0.13, needs improvement" and a fix the user can act on.
      send(
        res,
        200,
        'text/html; charset=utf-8',
        `<!doctype html><html><head><meta charset="utf-8"><title>shift</title>
<style>
  body { margin: 0; font: 16px system-ui; }
  /* Width but NO height: the box is 600x0 until the bytes arrive, then 600x600 —
     so everything below it is shoved down most of a viewport. */
  #shifter { display: block; width: 600px; }
  .below { padding: 8px; margin: 0 0 40px; }
</style>
</head><body>
<h1 id="top">Layout shift fixture</h1>
<img id="shifter" src="/slow.png" alt="late image">
<p class="below" id="below">This paragraph gets pushed down when the image finally loads.</p>
<p class="below">More content that moves with it.</p>
<p class="below">And more, so a large fraction of the viewport is affected.</p>
<p class="below">And more still.</p>
<p class="below">The bigger the moved area, the worse the CLS score.</p>
</body></html>`,
      );
      return;
    }

    if (url === '/slow.png') {
      // Deliberately late so the image cannot be laid out with the first paint —
      // that delay is what turns a missing height into a real layout shift.
      setTimeout(() => send(res, 200, 'image/png', PNG_1x1), 600);
      return;
    }

    if (url === '/app.js') {
      send(res, 200, 'application/javascript; charset=utf-8', jsBody('app', 2048));
      return;
    }

    if (url === '/logo.png') {
      send(res, 200, 'image/png', PNG_1x1);
      return;
    }

    send(res, 404, 'text/plain', 'not found');
  });
}

function startCrossServer(): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    if (url === '/tao.js') {
      // Cross-origin WITH Timing-Allow-Origin → real transferSize is exposed.
      send(res, 200, 'application/javascript; charset=utf-8', jsBody('tao', 4096), {
        'Timing-Allow-Origin': '*',
      });
      return;
    }
    if (url === '/notao.js') {
      // Cross-origin WITHOUT TAO → transferSize masked to 0 → we model it as null.
      send(res, 200, 'application/javascript; charset=utf-8', jsBody('notao', 4096));
      return;
    }
    send(res, 404, 'text/plain', 'not found');
  });
}

export async function startFixtures(): Promise<Fixtures> {
  let crossPort = 0;
  const cross = startCrossServer();
  const page = startPageServer(() => `http://127.0.0.1:${crossPort}`);

  await new Promise<void>((resolve) => cross.listen(0, '127.0.0.1', resolve));
  crossPort = (cross.address() as AddressInfo).port;
  await new Promise<void>((resolve) => page.listen(0, '127.0.0.1', resolve));
  const pagePort = (page.address() as AddressInfo).port;

  return {
    pageOrigin: `http://127.0.0.1:${pagePort}`,
    crossOrigin: `http://127.0.0.1:${crossPort}`,
    close: () =>
      Promise.all([
        new Promise<void>((r) => cross.close(() => r())),
        new Promise<void>((r) => page.close(() => r())),
      ]).then(() => undefined),
  };
}
