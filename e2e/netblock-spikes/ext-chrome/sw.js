import { attachCdp } from './netcore.bundle.js';
// Spike service worker. Everything is exposed on globalThis so the Playwright
// harness can call it with `sw.evaluate(...)`. Listeners are registered
// synchronously at top level (MV3 wake-up rule).

const S = (globalThis.__spike = {
  detach: [],       // chrome.debugger.onDetach events
  paused: [],       // Fetch.requestPaused summaries
  completed: [],    // webRequest.onCompleted for /api/a (latency spike)
  errors: [],       // webRequest.onErrorOccurred
  latency: [],      // per-trial timings
  armed: null,      // {tabId, ruleId} — arm the latency observer
});

chrome.debugger.onDetach.addListener((source, reason) => {
  S.detach.push({ tabId: source.tabId, reason, t: Date.now() });
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== 'Fetch.requestPaused') return;
  const p = params;
  S.paused.push({
    tabId: source.tabId,
    url: p.request.url,
    method: p.request.method,
    resourceType: p.resourceType,
    stage: p.responseStatusCode !== undefined || p.responseErrorReason ? 'Response' : 'Request',
    statusCode: p.responseStatusCode ?? null,
    t: Date.now(),
  });
  // Always let it through — the spike observes, it does not block.
  chrome.debugger.sendCommand(source, 'Fetch.continueRequest', { requestId: p.requestId }).catch((e) => {
    S.errors.push({ where: 'continueRequest', message: String(e?.message ?? e) });
  });
});

// ---- Spike 3: observe /api/a completion → add a session rule blocking /api/b.
chrome.webRequest.onCompleted.addListener(
  (d) => {
    if (!d.url.includes('/api/a')) return;
    const tEvent = performance.now();
    S.completed.push({ url: d.url, statusCode: d.statusCode, timeStamp: d.timeStamp, tEvent });
    const armed = S.armed;
    if (!armed) return;
    S.armed = null;
    const rule = {
      id: armed.ruleId,
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: '/api/b', resourceTypes: ['xmlhttprequest'], tabIds: [armed.tabId] },
    };
    chrome.declarativeNetRequest
      .updateSessionRules({ addRules: [rule], removeRuleIds: [armed.ruleId] })
      .then(() => {
        S.latency.push({ trial: armed.trial, tEvent, tApplied: performance.now(), swWall: Date.now() });
      })
      .catch((e) => S.errors.push({ where: 'updateSessionRules', message: String(e?.message ?? e) }));
  },
  { urls: ['<all_urls>'] },
);

chrome.webRequest.onErrorOccurred.addListener(
  (d) => {
    if (d.url.includes('/api/')) S.errors.push({ where: 'onErrorOccurred', url: d.url, error: d.error, t: Date.now() });
  },
  { urls: ['<all_urls>'] },
);

globalThis.spikeAttach = async (tabId) => {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e?.message ?? e) };
  }
};
globalThis.spikeDetach = async (tabId) => {
  try {
    await chrome.debugger.detach({ tabId });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e?.message ?? e) };
  }
};
globalThis.spikeSend = async (tabId, method, params) => {
  try {
    const r = await chrome.debugger.sendCommand({ tabId }, method, params ?? {});
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, message: String(e?.message ?? e) };
  }
};
globalThis.spikeTargets = () => chrome.debugger.getTargets();
globalThis.spikeArm = (tabId, ruleId, trial) => {
  S.armed = { tabId, ruleId, trial };
  return true;
};
globalThis.spikeClearRules = async () => {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id) });
  return rules.length;
};
globalThis.spikeState = () => JSON.parse(JSON.stringify(S));
globalThis.spikeReset = () => {
  S.detach = []; S.paused = []; S.completed = []; S.errors = []; S.latency = []; S.armed = null;
  return true;
};

// ---- S6: the REAL @blur/netcore attachCdp against the real chrome.debugger.
globalThis.spikeNetcore = async (tabId) => {
  const events = [];
  let detachReason = null;
  const r = await attachCdp(chrome.debugger, tabId, {
    onEvent: (m, p) => { if (m === 'Fetch.requestPaused') { events.push(p.request.url); chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', { requestId: p.requestId }); } },
    onDetach: (reason) => { detachReason = reason; },
  });
  if (!r.ok) return { ok: false, error: r.error };
  await r.session.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  globalThis.__netcoreSession = { session: r.session, events, get detachReason() { return detachReason; } };
  return { ok: true };
};
globalThis.spikeNetcoreState = async () => {
  const s = globalThis.__netcoreSession;
  return { attached: s.session.attached, events: s.events, detachReason: s.detachReason };
};
globalThis.spikeNetcoreDetach = async () => { await globalThis.__netcoreSession.session.detach(); return globalThis.__netcoreSession.session.attached; };
