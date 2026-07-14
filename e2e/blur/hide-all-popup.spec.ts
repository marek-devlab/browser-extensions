import { test, expect } from './harness';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';

/**
 * "Hide all again" THROUGH THE BACKGROUND — the path the popup actually uses.
 *
 * hide-all.spec.ts sends `{type:'hideAll'}` straight to the tab with
 * `tabs.sendMessage`. That skips the background entirely, so it proves the
 * CONTENT SCRIPT handles the message — and proves nothing at all about the route
 * the popup takes: popup -> `runtime.sendMessage` -> background -> tab. A broken
 * background case would sail through that test, which is exactly the gap a user
 * fell into ("Hide all again doesn't work, I have to refresh").
 *
 * So this drives the real chain: an extension page (same context type as the
 * popup) calls `runtime.sendMessage`, and we assert the PAGE re-masks.
 */

const SETTINGS = {
  ...DEFAULT_BLUR_SETTINGS,
  blur: {
    ...DEFAULT_BLUR_SETTINGS.blur,
    images: true,
    posters: true,
    reveal: 'click' as const,
  },
};

test('the popup message path: revealAll then hideAll re-masks the page', async ({
  blur,
}) => {
  await blur.setSettings(SETTINGS);

  const page = await blur.ctx.newPage();
  await page.goto(blur.origin);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#static-img')!).filter !== 'none',
    undefined,
    { timeout: 8000 },
  );

  // Resolve this tab's id exactly as the popup does: the ACTIVE tab. We cannot
  // match on `tab.url` — this extension has no `tabs` permission (by design), so
  // `url` is undefined for every tab the query returns. The popup gets the URL
  // only for the active tab, via `activeTab`, when the user opens it.
  await page.bringToFront();
  const tabId = await blur.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  });
  expect(typeof tabId, 'should resolve the fixture tab id').toBe('number');

  // A real extension page — the popup document itself — sending through runtime.
  const popup = await blur.ctx.newPage();
  await popup.goto(`chrome-extension://${blur.extensionId}/popup.html`);

  await popup.evaluate(
    (id) => chrome.runtime.sendMessage({ type: 'revealAll', tabId: id }),
    tabId,
  );
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#static-img')!).filter === 'none',
    undefined,
    { timeout: 8000 },
  );

  await popup.evaluate(
    (id) => chrome.runtime.sendMessage({ type: 'hideAll', tabId: id }),
    tabId,
  );
  await page
    .waitForFunction(
      () => getComputedStyle(document.querySelector('#static-img')!).filter !== 'none',
      undefined,
      { timeout: 8000 },
    )
    .catch(() => undefined);

  const filter = await page.evaluate(
    () => getComputedStyle(document.querySelector('#static-img')!).filter,
  );
  expect(
    filter,
    'hideAll sent through the background must re-mask the page — no reload',
  ).not.toBe('none');

  await popup.close();
  await page.close();
});
