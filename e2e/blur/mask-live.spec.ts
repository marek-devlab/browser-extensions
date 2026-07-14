import { test, expect } from './harness';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';

/**
 * Switching the mask style on an ALREADY-OPEN page.
 *
 * mask.spec.ts sets the settings and THEN navigates, so it only ever exercises
 * the cold path (engine built once, from final settings). The way a human
 * actually uses this is the opposite: the page is already open, they open the
 * popup and flip Blur -> Solid. That goes through the live reconcile path in
 * content.ts `apply()`, which is a completely different branch — and which the
 * cold-path tests cannot see.
 */

const BASE = {
  ...DEFAULT_BLUR_SETTINGS,
  blur: {
    ...DEFAULT_BLUR_SETTINGS.blur,
    images: true,
    video: true,
    posters: true,
    reveal: 'never' as const,
  },
};

test('switching Blur -> Solid on an already-open page re-masks the content', async ({
  blur,
}) => {
  await blur.setSettings({ ...BASE, blur: { ...BASE.blur, maskStyle: 'blur' } });

  const page = await blur.ctx.newPage();
  await page.goto(blur.origin);

  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#red-img')!).filter.includes('blur('),
    undefined,
    { timeout: 8000 },
  );

  // The user opens the popup and flips the switch. That is a settings write; the
  // content script must notice and rebuild.
  await blur.setSettings({
    ...BASE,
    blur: { ...BASE.blur, maskStyle: 'solid', maskColor: '#3355ff', maskOpacity: 1 },
  });

  await page
    .waitForFunction(
      () => {
        const f = getComputedStyle(document.querySelector('#red-img')!).filter;
        return f.includes('url(') && !f.includes('blur(');
      },
      undefined,
      { timeout: 8000 },
    )
    .catch(() => undefined);

  const filter = await page.evaluate(
    () => getComputedStyle(document.querySelector('#red-img')!).filter,
  );
  expect(filter, 'flipping to Solid must replace blur() with the solid filter').toContain(
    'url(',
  );
  expect(filter, 'the old blur() must be gone').not.toContain('blur(');

  await page.close();
});

test('switching Solid -> Blur on an already-open page goes back to blur()', async ({
  blur,
}) => {
  await blur.setSettings({
    ...BASE,
    blur: { ...BASE.blur, maskStyle: 'solid', maskColor: '#3355ff' },
  });

  const page = await blur.ctx.newPage();
  await page.goto(blur.origin);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#red-img')!).filter.includes('url('),
    undefined,
    { timeout: 8000 },
  );

  await blur.setSettings({ ...BASE, blur: { ...BASE.blur, maskStyle: 'blur' } });

  await page
    .waitForFunction(
      () => getComputedStyle(document.querySelector('#red-img')!).filter.includes('blur('),
      undefined,
      { timeout: 8000 },
    )
    .catch(() => undefined);

  const filter = await page.evaluate(
    () => getComputedStyle(document.querySelector('#red-img')!).filter,
  );
  expect(filter).toContain('blur(');
  await page.close();
});
