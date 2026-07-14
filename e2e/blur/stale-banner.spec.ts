import { test, expect } from './harness';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';

/**
 * The popup must TELL the user when the page it is pointing at is stale.
 *
 * Without this the failure is silent and looks exactly like a broken feature: the
 * page keeps the stylesheet its (now orphaned) content script injected, so it still
 * looks masked, while every switch in the popup does nothing. The user has no way
 * to know a reload would fix it.
 *
 * The banner must NOT cry wolf on a healthy page — a false alarm here would train
 * people to ignore it, which is worse than not having it.
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

/** Open the real popup, pretending the given tab is the active one. */
async function openPopup(blur: { ctx: import('@playwright/test').BrowserContext; extensionId: string }, tabId: number) {
  const popup = await blur.ctx.newPage();
  await popup.addInitScript((id: number) => {
    const q = chrome.tabs.query.bind(chrome.tabs);
    // The popup resolves "the active tab". Under Playwright the extension page is
    // itself a tab, so pin the answer to the fixture tab we care about.
    chrome.tabs.query = ((info: chrome.tabs.QueryInfo) =>
      info.active
        ? q({}).then((tabs) => tabs.filter((t) => t.id === id))
        : q(info)) as typeof chrome.tabs.query;
  }, tabId);
  await popup.goto(`chrome-extension://${blur.extensionId}/popup.html`);
  await popup.waitForSelector('.popup');
  return popup;
}

test('a healthy page shows NO stale banner', async ({ blur }) => {
  await blur.setSettings(SOLID);
  const page = await blur.ctx.newPage();
  await page.goto(blur.origin);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#red-img')!).filter.includes('url('),
    undefined,
    { timeout: 8000 },
  );
  await page.bringToFront();
  const tabId = await blur.worker.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t!.id!;
  });

  const popup = await openPopup(blur, tabId);
  await popup.waitForTimeout(700); // let the whatIsApplied round-trip settle
  expect(
    await popup.locator('.stale').count(),
    'a live, correctly-masking page must not be accused of being stale',
  ).toBe(0);

  await popup.close();
  await page.close();
});

test('a page with no live content script shows the reload banner', async ({ blur }) => {
  await blur.setSettings(SOLID);
  const blurOrigin = blur.origin;

  // A tab whose content script never ran. From the popup's side this is
  // indistinguishable from an orphaned script: `tabs.sendMessage` rejects either
  // way — which is precisely the signal being tested.
  const page = await blur.ctx.newPage();
  await page.goto(blur.origin);
  await page.bringToFront();
  const tabId = await blur.worker.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t!.id!;
  });

  const popup = await blur.ctx.newPage();
  await popup.addInitScript(
    ({ id, url }: { id: number; url: string }) => {
      const q = chrome.tabs.query.bind(chrome.tabs);
      // HARNESS ARTIFACT, not a product gap: a popup opened as an ordinary tab is
      // never granted `activeTab`, so `Tab.url` comes back undefined and the popup
      // resolves no hostname — and the banner is deliberately silent when there is
      // no site to mask. The REAL toolbar popup does get the URL. So hand back the
      // one field Chrome withholds here; everything else is the real code path.
      chrome.tabs.query = ((info: chrome.tabs.QueryInfo) =>
        info.active
          ? q({}).then((tabs) =>
              tabs.filter((t) => t.id === id).map((t) => ({ ...t, url })),
            )
          : q(info)) as typeof chrome.tabs.query;
      // Simulate the orphaned script: the message to the page finds no listener.
      chrome.tabs.sendMessage = (() =>
        Promise.reject(
          new Error('Could not establish connection. Receiving end does not exist.'),
        )) as typeof chrome.tabs.sendMessage;
    },
    { id: tabId, url: blurOrigin },
  );
  await popup.goto(`chrome-extension://${blur.extensionId}/popup.html`);
  await popup.waitForSelector('.popup');

  const banner = popup.locator('.stale');
  await banner.waitFor({ timeout: 5000 });
  await expect(banner).toContainText('out of date');
  await expect(banner).toContainText('Reload');
  expect(await popup.locator('.stale-btn').count()).toBe(1);

  await popup.close();
  await page.close();
});
