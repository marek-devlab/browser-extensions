import { test, expect } from './harness';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';

/**
 * Detecting a STALE content script.
 *
 * When an extension updates, every content script already injected into an open
 * page is orphaned. It keeps the stylesheet it adopted — so the page still LOOKS
 * masked — but it no longer receives storage events or runtime messages. The
 * popup is always freshly loaded, so it shows the new settings while the page
 * silently ignores them. To the user, the feature is simply broken: they select
 * "Solid", nothing happens, and nothing anywhere explains why.
 *
 * Verified directly (a probe in this harness): 8 seconds after `runtime.reload()`
 * the page still computes `blur(16px)` and its adopted sheet is untouched. The
 * browser gives the dead script no way to fix itself — but the POPUP can notice
 * the silence and say so. That is what `whatIsApplied` is for.
 */

const SOLID = {
  ...DEFAULT_BLUR_SETTINGS,
  blur: {
    ...DEFAULT_BLUR_SETTINGS.blur,
    images: true,
    reveal: 'never' as const,
    maskStyle: 'solid' as const,
    maskColor: '#3355ff',
  },
};

test('a LIVE content script reports what it is actually applying', async ({ blur }) => {
  await blur.setSettings(SOLID);
  const page = await blur.ctx.newPage();
  await page.goto(blur.origin);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#red-img')!).filter.includes('url('),
    undefined,
    { timeout: 8000 },
  );
  await page.bringToFront();

  const info = await blur.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab!.id!, { type: 'whatIsApplied' });
  });

  expect(info, 'a live script must answer the ping').toBeTruthy();
  expect((info as { maskStyle: string }).maskStyle).toBe('solid');
  expect((info as { active: boolean }).active).toBe(true);
  await page.close();
});

test('a tab with no live content script rejects the ping — the detection mechanism', async ({
  blur,
}) => {
  // HONEST SCOPE. This exercises the MECHANISM the popup relies on — "no live
  // listener in the tab => tabs.sendMessage rejects" — against a tab that genuinely
  // has no content script. It does NOT drive the true orphaned-script case: doing
  // that needs `chrome.runtime.reload()`, which kills the service worker the test
  // is driving (evaluating against it then hangs, and its extension pages are
  // briefly ERR_BLOCKED_BY_CLIENT), and Playwright does not re-emit a
  // `serviceworker` event for the restarted extension. I could not find a way to
  // drive it in-harness and am not going to pretend otherwise.
  //
  // What IS established, by direct measurement in this harness: 8 seconds after a
  // reload the orphaned page still computes `blur(16px)` with its adopted sheet
  // intact and reacts to nothing. Combined with this test, the popup's logic holds:
  // a live script answers (test above), a listener-less tab rejects (this test).
  await blur.setSettings(SOLID);

  const page = await blur.ctx.newPage();
  // A chrome:// page: content scripts never run here, so there is no listener —
  // structurally identical, from the sender's side, to an orphaned script.
  await page.goto('chrome://version/');
  await page.bringToFront();

  const answered = await blur.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== 'number') return 'no-tab';
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'whatIsApplied' });
      return r ? 'answered' : 'no-response';
    } catch {
      return 'no-listener';
    }
  });

  expect(
    ['no-listener', 'no-response'],
    `a tab with no content script must not answer (got: ${String(answered)})`,
  ).toContain(answered);

  await page.close();
});
