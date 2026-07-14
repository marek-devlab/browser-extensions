import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Content scripts do NOT run on about:blank / data: / setContent(). Everything
// the harness asserts against therefore has to be served over real HTTP.

// 1x1 transparent GIF — a valid image so <img> decodes, but the blur applies to
// the element regardless of whether the bytes ever load.
const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

// A vivid, fully OPAQUE red 2x2 PNG. The transparent PIXEL above is fine for
// asserting "an effect is applied", but it is useless for asserting that content
// is actually HIDDEN: a transparent image looks identical masked or not. The mask
// tests read real painted pixels, so they need a source that screams if it leaks.
const RED =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQIABiIBAV6xgv0AAAAASUVORK5CYII=';

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

  <!-- Opaque, vivid targets for the MASK tests. These read real painted pixels,
       so a mask that fails to cover shows up as red. The shadow-DOM one is the
       important one: a document-scoped SVG filter reference silently fails to
       resolve inside a shadow root and renders the image UNMASKED. -->
  <img id="red-img" src="${RED}" alt="red">
  <video id="red-video" muted autoplay playsinline></video>
  <div id="red-host"></div>
  <script>
    (function () {
      // Give the <video> genuinely painting red frames. An empty <video> renders
      // nothing, so testing a mask against it would prove nothing at all.
      var c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      var g = c.getContext('2d');
      function paint() { g.fillStyle = '#ff0000'; g.fillRect(0, 0, 32, 32); }
      paint();
      // Paint a short burst, then STOP. A forever-running repaint loop is enough
      // CPU, on every page this fixture serves, to starve the other specs when
      // Playwright runs workers in parallel — it made an unrelated shadow-DOM
      // test time out. A handful of frames is all the <video> needs to have real
      // pixels on screen; it holds the last frame after the stream goes idle.
      var frames = 0;
      var t = setInterval(function () {
        paint();
        if (++frames >= 8) clearInterval(t);
      }, 60);
      var v = document.getElementById('red-video');
      v.srcObject = c.captureStream(25);
      v.play().catch(function () {});

      var sr = document.getElementById('red-host').attachShadow({ mode: 'open' });
      sr.innerHTML =
        '<style>img{width:200px;height:120px;display:block}</style>' +
        '<img id="shadow-red-img" src="${RED}" alt="red in shadow">';
    })();
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
