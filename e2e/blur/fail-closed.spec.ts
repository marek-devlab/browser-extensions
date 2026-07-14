import { test, expect } from './harness';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';

/**
 * FAIL CLOSED when the extension context is invalidated.
 *
 * !! READ THIS BEFORE TRUSTING THIS TEST !!
 * It is a GUARANTEE test, not a regression test. I mutation-checked it: it also
 * passes with the old, revealing `stop()` teardown restored — because Chromium
 * never fires WXT's `onInvalidated` in this scenario at all (measured: 8s after
 * `runtime.reload()` the page still computes blur(16px) and its adopted sheet is
 * untouched). So this test pins the USER-FACING guarantee ("an update must not
 * un-hide open tabs"), which currently holds, and the `freeze()` path it is meant
 * to protect is DEFENSIVE and UNEXERCISED. Do not read a pass here as proof that
 * freeze() works.
 *
 * When an extension is updated (or reloaded during development), every content
 * script already injected into an open page is orphaned. WXT signals this via
 * `ctx.onInvalidated`, and the handler used to run a full teardown: remove the
 * injected stylesheets, strip the engine's attributes, drop the manual blurs.
 *
 * The consequence was that updating the extension REPAINTED, on every open tab,
 * exactly the content the user had it hiding — no click, no warning. For a tool
 * whose entire purpose is keeping content off the screen, revealing it as a side
 * effect of an update is the worst failure available.
 *
 * The masks must survive invalidation. The page may stop responding to the popup
 * until it is reloaded (the content script really is dead — a browser constraint,
 * not something the dead context can fix), but the failure mode must be
 * "settings stop applying", never "your content is now on screen".
 */

test('invalidating the content script leaves the content masked, not revealed', async ({
  blur,
}) => {
  await blur.setSettings({
    ...DEFAULT_BLUR_SETTINGS,
    blur: {
      ...DEFAULT_BLUR_SETTINGS.blur,
      images: true,
      posters: true,
      text: true,
      textPatterns: ['spoiler'],
      reveal: 'never',
    },
  });

  const page = await blur.ctx.newPage();
  await page.goto(blur.origin);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#static-img')!).filter !== 'none',
    undefined,
    { timeout: 8000 },
  );

  const before = await page.evaluate(
    () => getComputedStyle(document.querySelector('#static-img')!).filter,
  );
  expect(before).not.toBe('none');

  // Reload the extension. Every content script already in a page is invalidated —
  // this is exactly what happens to a user's open tabs when an update lands.
  await blur.worker.evaluate(() => chrome.runtime.reload());

  // Give the invalidation handler ample time to run and do its damage, if any.
  await page.waitForTimeout(2500);

  const after = await page.evaluate(
    () => getComputedStyle(document.querySelector('#static-img')!).filter,
  );

  expect(
    after,
    'an extension update must NOT un-hide content on open tabs',
  ).not.toBe('none');

  await page.close();
});
