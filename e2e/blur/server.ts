import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Content scripts do NOT run on about:blank / data: / setContent(). Everything
// the harness asserts against therefore has to be served over real HTTP.

// 1x1 transparent GIF — a valid image so <img> decodes, but the blur applies to
// the element regardless of whether the bytes ever load.
const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Blur fixture</title>
<style>
  body { font: 16px sans-serif; margin: 40px; }
  #bg-thumb { width: 200px; height: 120px; }
  img, video { width: 200px; height: 120px; display: block; }
  .spacer { height: 60px; }
</style>
</head>
<body>
  <h1>Content Blur fixture page</h1>

  <img id="static-img" src="${PIXEL}" alt="static">

  <video id="poster-video" poster="${PIXEL}" muted></video>

  <div id="bg-thumb" role="img" aria-label="thumb"
       style="background-image:url(${PIXEL})"></div>

  <p id="txt">Contains спойлер here, a spoiler there, but safeword stays clear.</p>

  <div class="spacer"></div>

  <div id="host"></div>
  <script>
    const host = document.getElementById('host');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>img{width:200px;height:120px;display:block}</style>' +
      '<img id="shadow-img" src="${PIXEL}" alt="in shadow">';
  </script>

  <div id="dyn"></div>
  <script>
    // Inserted well after first paint so the MutationObserver path is exercised.
    setTimeout(function () {
      const img = document.createElement('img');
      img.id = 'dynamic-img';
      img.src = '${PIXEL}';
      img.alt = 'dynamic';
      document.getElementById('dyn').appendChild(img);
    }, 400);
  </script>
</body>
</html>`;

export interface Fixture {
  server: Server;
  origin: string;
  close: () => Promise<void>;
}

/** Start the fixture HTTP server on an ephemeral 127.0.0.1 port. */
export async function startFixtureServer(): Promise<Fixture> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    origin,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
