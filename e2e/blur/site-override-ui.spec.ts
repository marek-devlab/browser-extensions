import { test, expect } from './harness';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';
import type { Page } from '@playwright/test';
import type { Blur } from './harness';

/**
 * The UI half of `mask-override.spec.ts`.
 *
 * That test pins the PRECEDENCE: a per-site `maskStyle` override beats the global
 * setting. Correct — and, until now, completely invisible. The user sat on the
 * popup's "Global" tab, saw "Solid" highlighted, flipped switches, and the page
 * kept obeying an override they had made weeks ago ("I switch to Solid and nothing
 * changes"). Precedence is not the defect; its silence was.
 *
 * So this asserts the surfacing, and asserts it against the REAL page — not
 * component state. Clearing the override from the popup must both empty
 * `siteConfigs` and make the live tab pick up the global mask with no reload.
 */

const GLOBAL_SOLID = {
  ...DEFAULT_BLUR_SETTINGS,
  blur: {
    ...DEFAULT_BLUR_SETTINGS.blur,
    images: true,
    reveal: 'never' as const,
    maskStyle: 'solid' as const,
    maskColor: '#3355ff',
    maskOpacity: 1,
  },
};

const filterOf = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.querySelector('#red-img')!).filter);

const storedSiteConfigs = (blur: Blur): Promise<Record<string, unknown>> =>
  blur.worker.evaluate(async () => {
    const r = await chrome.storage.local.get('siteConfigs');
    return (r['siteConfigs'] ?? {}) as Record<string, unknown>;
  });

/**
 * Open the real popup document as a tab.
 *
 * The popup asks `tabs.query({active, currentWindow})` which page it was opened
 * over. Opened as a tab by a test it would answer "itself", so that ONE call is
 * stubbed with the fixture tab — precisely what the browser returns for a popup
 * opened above that page. Everything else is real: the built React bundle, real
 * `chrome.storage`, and the real content script watching it.
 */
async function openPopup(blur: Blur): Promise<Page> {
  // The fixture page is the active tab until the popup tab is created, and the id
  // is read from THAT — never from `tab.url`, which this extension (no `tabs`
  // permission, no host permissions) is not always allowed to see.
  const tabId = await blur.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  });
  expect(typeof tabId, 'should resolve the fixture tab id').toBe('number');

  const popup = await blur.ctx.newPage();
  await popup.addInitScript(
    ({ url, id }) => {
      chrome.tabs.query = ((): Promise<chrome.tabs.Tab[]> =>
        Promise.resolve([{ id, url, active: true } as chrome.tabs.Tab])) as typeof chrome.tabs.query;
    },
    { url: blur.origin, id: tabId },
  );
  await popup.goto(`chrome-extension://${blur.extensionId}/popup.html`);
  // React really mounted, and the Global tab is what the user is looking at.
  await expect(popup.getByRole('tab', { name: 'Global' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  return popup;
}

async function openMaskedFixture(blur: Blur): Promise<Page> {
  const page = await blur.ctx.newPage();
  await page.goto(blur.origin);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#red-img')!).filter !== 'none',
    undefined,
    { timeout: 8000 },
  );
  return page;
}

test('the Global tab names the site override, and clearing it applies the global mask live', async ({
  blur,
}) => {
  await blur.setSettings(GLOBAL_SOLID);
  const host = new URL(blur.origin).hostname;
  // The user flipped the mask style once with "This site" selected, weeks ago.
  await blur.setSiteConfigs({ [host]: { hostname: host, blur: { maskStyle: 'blur' } } });

  const page = await openMaskedFixture(blur);
  expect(await filterOf(page), 'the site override wins — that is the trap').toContain('blur(');

  const popup = await openPopup(blur);
  const body = popup.locator('.popup');

  // 1. The control the user is about to waste their time on says so BY NAME, and
  //    with the value this site actually uses.
  await expect(body).toContainText('Mask style is overridden on this site');
  await expect(body).toContainText(`${host} uses Blur`);
  // The global "Solid" segment is still shown as selected — so the marker is
  // carrying the whole burden of explaining the contradiction, as designed.
  await expect(popup.getByRole('button', { name: 'Solid mask' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // 2. The one-click way out, offered only because an override exists.
  const clear = popup.getByRole('button', {
    name: /Clear this site.s overrides and use global settings/i,
  });
  await expect(clear).toBeVisible();
  await clear.click();

  // The whole `siteConfigs` entry is gone — not merely the one field.
  await expect.poll(() => storedSiteConfigs(blur), { timeout: 8000 }).toEqual({});

  // 3. The LIVE page picks up the global solid mask, with no reload.
  await page.waitForFunction(
    () => {
      const f = getComputedStyle(document.querySelector('#red-img')!).filter;
      return f.includes('url(') && !f.includes('blur(');
    },
    undefined,
    { timeout: 8000 },
  );
  const after = await filterOf(page);
  expect(after, 'clearing the override must apply the global solid mask').toContain('url(');
  expect(after, 'the site blur must be gone').not.toContain('blur(');

  // And the popup stops shouting the moment there is nothing left to warn about.
  await expect(popup.locator('.ovr')).toHaveCount(0);
  await expect(
    popup.getByRole('button', { name: /Clear this site.s overrides/i }),
  ).toHaveCount(0);

  await popup.close();
  await page.close();
});

test('a site with no override shows no marker and no clear action', async ({ blur }) => {
  await blur.setSettings(GLOBAL_SOLID);
  await blur.setSiteConfigs({});

  const page = await openMaskedFixture(blur);
  const popup = await openPopup(blur);

  // The common case must stay uncluttered: not one pixel of override UI, in a
  // 320px popup that already scrolls.
  await expect(popup.locator('.ovr')).toHaveCount(0);
  await expect(popup.locator('.chip.flagged')).toHaveCount(0);
  await expect(popup.locator('.popup')).not.toContainText('overridden on this site');
  await expect(
    popup.getByRole('button', { name: /Clear this site.s overrides/i }),
  ).toHaveCount(0);

  await popup.close();
  await page.close();
});

test('the This site tab marks its own fields and can hand one back to global', async ({
  blur,
}) => {
  await blur.setSettings(GLOBAL_SOLID);
  const host = new URL(blur.origin).hostname;
  await blur.setSiteConfigs({
    [host]: { hostname: host, blur: { maskStyle: 'blur', video: true } },
  });

  const page = await openMaskedFixture(blur);
  const popup = await openPopup(blur);
  const body = popup.locator('.popup');

  await popup.getByRole('tab', { name: 'This site' }).click();

  // Overridden fields are marked as this site's own; inherited ones stay silent.
  await expect(body).toContainText('Mask style overrides global');
  await expect(body).toContainText('Video overrides global');
  await expect(body).not.toContainText('Images overrides global');
  await expect(popup.locator('.chip.flagged-own')).toHaveCount(1);

  // Per-field inherit: hand the mask style back, keep the `video` override.
  await popup
    .getByRole('button', { name: `Use the global Mask style setting on ${host}` })
    .click();

  await expect
    .poll(() => storedSiteConfigs(blur), { timeout: 8000 })
    .toEqual({ [host]: { hostname: host, blur: { video: true } } });

  await expect(body).not.toContainText('Mask style overrides global');
  await expect(body).toContainText('Video overrides global');

  // And the live page follows the global solid mask again — the override really
  // went away, it did not merely stop being drawn.
  await page.waitForFunction(
    () => {
      const f = getComputedStyle(document.querySelector('#red-img')!).filter;
      return f.includes('url(') && !f.includes('blur(');
    },
    undefined,
    { timeout: 8000 },
  );

  await popup.close();
  await page.close();
});
