// Spike 2 (Firefox): can blocking `onHeadersReceived` turn a real 500 into
// something the page sees as a different response? Options under test:
//   mode=data   → { redirectUrl: 'data:application/json,...' }
//   mode=ext    → { redirectUrl: browser.runtime.getURL('mock.json') }  (web_accessible_resources)
//   mode=cancel → { cancel: true }
//   mode=delay  → async blocking listener that resolves after 300 ms (delay action)
// Each is exercised same-origin and cross-origin (CORS) for fetch and XHR.
// The listener also records details.statusCode as seen at onHeadersReceived.

const seen = [];
const DATA_URL = 'data:application/json,' + encodeURIComponent('{"mock":true,"from":"data-url"}');

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!details.url.includes('/api/x')) return;
    const mode = new URL(details.url).searchParams.get('mode');
    seen.push({ url: details.url, statusCode: details.statusCode, type: details.type, mode });
    if (mode === 'data') return { redirectUrl: DATA_URL };
    if (mode === 'ext') return { redirectUrl: browser.runtime.getURL('mock.json') };
    if (mode === 'cancel') return { cancel: true };
    if (mode === 'delay') return new Promise((r) => setTimeout(() => r({}), 300));
    if (mode === 'delaycancel') return new Promise((r) => setTimeout(() => r({ cancel: true }), 300));
    return {};
  },
  { urls: ['<all_urls>'] },
  ['blocking', 'responseHeaders'],
);

const PAGE_SCRIPT = `
(async () => {
  const api = new URL(location.href).searchParams.get('api');
  const same = location.origin;
  const cases = [];
  const run = async (label, fn) => { try { cases.push({ label, ...(await fn()) }); } catch (e) { cases.push({ label, threw: String(e) }); } };
  const F = async (url) => { const t0 = performance.now(); try { const r = await fetch(url); const text = await r.text(); return { via: 'fetch', ok: true, status: r.status, type: r.type, url: r.url, text: text.slice(0, 120), ms: Math.round(performance.now() - t0) }; } catch (e) { return { via: 'fetch', ok: false, error: e.name, message: e.message, ms: Math.round(performance.now() - t0) }; } };
  const X = (url) => new Promise((resolve) => { const t0 = performance.now(); const x = new XMLHttpRequest(); x.open('GET', url); x.onload = () => resolve({ via: 'xhr', ok: true, status: x.status, text: String(x.responseText).slice(0, 120), responseURL: x.responseURL, ms: Math.round(performance.now() - t0) }); x.onerror = () => resolve({ via: 'xhr', ok: false, status: x.status, ms: Math.round(performance.now() - t0) }); x.send(); });
  for (const mode of ['data', 'ext', 'cancel', 'delay', 'delaycancel', 'none']) {
    await run('same fetch ' + mode, () => F(same + '/api/x?status=500&mode=' + mode));
    await run('cross fetch ' + mode, () => F(api + '/api/x?status=500&mode=' + mode));
    await run('same xhr ' + mode, () => X(same + '/api/x?status=500&mode=' + mode));
    await run('cross xhr ' + mode, () => X(api + '/api/x?status=500&mode=' + mode));
  }
  window.__spikeCases = cases;
  return cases;
})();
`;

const done = new Set();
async function runInTab(tabId, tab) {
  if (!tab.url || !tab.url.includes('page.html') || tab.url.includes('done=1') || done.has(tabId)) return;
  done.add(tabId);
  const origin = new URL(tab.url).origin;
  let cases;
  try {
    const [res] = await browser.tabs.executeScript(tabId, { code: PAGE_SCRIPT });
    cases = await res;
  } catch (e) {
    cases = [{ label: 'executeScript', threw: String(e) }];
  }
  await fetch(origin + '/result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ browser: navigator.userAgent, cases, listenerSaw: seen }),
  });
  browser.tabs.update(tabId, { url: tab.url + '&done=1' });
}

browser.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') runInTab(tabId, tab);
});
// web-ext opens --start-url BEFORE the temporary add-on is installed, so the
// page is usually already complete when this script starts: scan existing tabs.
setTimeout(async () => {
  for (const t of await browser.tabs.query({})) if (t.status === 'complete') runInTab(t.id, t);
}, 1000);
