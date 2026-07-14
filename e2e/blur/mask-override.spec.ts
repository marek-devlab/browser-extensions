import { test, expect } from './harness';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';

/**
 * A per-site override SHADOWS the global mask style — and the popup's "Global"
 * tab happily shows Solid selected while the page keeps using the site's blur.
 *
 * `resolveBlurSettings` merges `site.blur` OVER the global `blur`. So if this
 * host has any stored override for `maskStyle` — which a user creates simply by
 * flipping the switch once while the "This site" tab is active — then changing
 * the GLOBAL mask style afterwards does nothing visible on that host, with no
 * indication anywhere that the global control they are looking at is being
 * ignored.
 *
 * This test pins the behaviour so the UI can be held to it.
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

test('a per-site maskStyle override beats the global setting', async ({ blur }) => {
  await blur.setSettings(GLOBAL_SOLID);

  const host = new URL(blur.origin).hostname;
  // The user flipped the switch once with "This site" selected, some time ago.
  await blur.setSiteConfigs({
    [host]: { hostname: host, blur: { maskStyle: 'blur' } },
  });

  const page = await blur.ctx.newPage();
  await page.goto(blur.origin);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#red-img')!).filter !== 'none',
    undefined,
    { timeout: 8000 },
  );

  const filter = await page.evaluate(
    () => getComputedStyle(document.querySelector('#red-img')!).filter,
  );

  // Global says solid. The page uses blur. This is the trap: it is CORRECT
  // precedence, and it is invisible to the user.
  expect(filter, 'the site override should win over the global mask style').toContain(
    'blur(',
  );

  // And once the override is cleared, the global choice takes effect with no
  // further action — proving the global write itself was never the problem.
  await blur.setSiteConfigs({});
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#red-img')!).filter.includes('url('),
    undefined,
    { timeout: 8000 },
  );
  const after = await page.evaluate(
    () => getComputedStyle(document.querySelector('#red-img')!).filter,
  );
  expect(after).toContain('url(');
  await page.close();
});
