import { test, expect } from './harness';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';

/**
 * "Reveal all" must be REVERSIBLE.
 *
 * It shipped as a one-way door: once you revealed a page, the only way to hide it
 * again was a full reload. For an extension whose entire job is keeping content
 * off the screen, that is backwards — the moment you most need to re-hide (someone
 * walked up behind you) is exactly the moment reloading the page is the slowest
 * possible option.
 *
 * Worse, the old reveal-all called clearManualBlur(), which STRIPPED the marks off
 * every element the user had hand-blurred via the context menu and tore down their
 * stylesheet. Those blurs were destroyed permanently — not even a reload brought
 * them back, because they live only in the page, not in storage. The second test
 * below is the regression guard for that.
 */

const SETTINGS = {
  ...DEFAULT_BLUR_SETTINGS,
  blur: {
    ...DEFAULT_BLUR_SETTINGS.blur,
    images: true,
    video: true,
    posters: true,
    text: true,
    textPatterns: ['spoiler'],
    reveal: 'never' as const,
  },
};

test('hideAll puts everything back after a revealAll — no reload needed', async ({
  blur,
}) => {
  await blur.setSettings(SETTINGS);
  const page = await blur.ctx.newPage();
  await page.goto(blur.origin);

  const filterOf = () =>
    page.evaluate(() => getComputedStyle(document.querySelector('#static-img')!).filter);

  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#static-img')!).filter !== 'none',
    undefined,
    { timeout: 8000 },
  );
  expect(await filterOf()).not.toBe('none');

  await blur.sendToActiveTab({ type: 'revealAll' });
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#static-img')!).filter === 'none',
    undefined,
    { timeout: 8000 },
  );
  expect(await filterOf(), 'revealAll should clear the mask').toBe('none');

  // The inverse — this is the whole point.
  await blur.sendToActiveTab({ type: 'hideAll' });
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#static-img')!).filter !== 'none',
    undefined,
    { timeout: 8000 },
  );
  expect(await filterOf(), 'hideAll should restore the mask').not.toBe('none');

  await page.close();
});

test('REGRESSION: revealAll no longer destroys hand-picked manual blurs', async ({
  blur,
}) => {
  // Turn the category engine OFF entirely, so the only thing masking #txt is the
  // manual, context-menu blur. If reveal-all destroys it, hideAll cannot bring it
  // back and this test fails.
  await blur.setSettings({
    ...DEFAULT_BLUR_SETTINGS,
    blur: {
      ...DEFAULT_BLUR_SETTINGS.blur,
      images: false,
      video: false,
      posters: false,
      text: false,
    },
  });

  const page = await blur.ctx.newPage();
  await page.goto(blur.origin);
  await page.waitForTimeout(500);

  // A real right-click opens the OS context menu and blocks the browser, so
  // dispatch the event synthetically — the content script's capture-phase
  // listener takes the same path. The background's contextMenus.onClicked (which
  // Playwright cannot trigger) then sends exactly the message we send here.
  await page.$eval('#txt', (el) =>
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })),
  );
  await blur.sendToActiveTab({ type: 'blurElement' });

  await page.waitForFunction(
    () => document.querySelector('#txt')!.hasAttribute('data-bx-manual'),
    undefined,
    { timeout: 8000 },
  );
  const manualFilter = await page.evaluate(
    () => getComputedStyle(document.querySelector('#txt')!).filter,
  );
  expect(manualFilter, 'the manual blur should be applied').toContain('blur(');

  await blur.sendToActiveTab({ type: 'revealAll' });
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#txt')!).filter === 'none',
    undefined,
    { timeout: 8000 },
  );

  // The element must still CARRY its manual mark — reveal is a flag on the root,
  // not the destruction of the user's work.
  expect(
    await page.evaluate(() =>
      document.querySelector('#txt')!.hasAttribute('data-bx-manual'),
    ),
    'revealAll must not strip the manual-blur mark',
  ).toBe(true);

  await blur.sendToActiveTab({ type: 'hideAll' });
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#txt')!).filter !== 'none',
    undefined,
    { timeout: 8000 },
  );
  const restored = await page.evaluate(
    () => getComputedStyle(document.querySelector('#txt')!).filter,
  );
  expect(restored, 'the hand-picked blur must come back').toContain('blur(');

  await page.close();
});
