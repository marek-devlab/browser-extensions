import { test, expect } from './harness';

/**
 * THE UPGRADE PATH — an existing user, not a fresh install.
 *
 * `storage.defineItem`'s `fallback` applies only when the KEY IS ABSENT. It does
 * not fill in fields that a stored object is missing. So a user who installed the
 * extension before the masking fields existed has a `local:settings` object with
 * no `maskStyle` / `maskColor` / `maskOpacity` / `showLabels` / `rehideOnBlur` —
 * and every one of them reads back as `undefined`, even though the type says they
 * are required.
 *
 * That is exactly what a real user hit: the popup showed a nonsense colour, and
 * flipping the mask style did nothing. This test recreates the pre-upgrade shape
 * on disk and asserts the extension copes.
 */

/** The BlurSettings shape as it shipped BEFORE the masking fields existed. */
const LEGACY_SETTINGS = {
  enabled: true,
  allowlist: [],
  blur: {
    images: true,
    video: true,
    posters: true,
    text: false,
    radius: 40,
    reveal: 'never',
    textPatterns: [],
    // NOTE: no maskStyle, no maskColor, no maskOpacity, no showLabels,
    // no rehideOnBlur. This is the whole point of the test.
  },
};

test('an old settings object (no mask fields) still masks, and can switch to solid', async ({
  blur,
}) => {
  // Write the legacy shape straight into storage, bypassing the typed helper —
  // this is what is actually on a returning user's disk.
  await blur.worker.evaluate(async (legacy) => {
    await chrome.storage.local.set({ settings: legacy });
  }, LEGACY_SETTINGS);

  const page = await blur.ctx.newPage();
  await page.goto(blur.origin);

  // 1. It must still blur. A missing maskStyle must not mean "no mask" — that
  //    would silently un-hide content on upgrade, the worst possible failure.
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('#red-img')!).filter.includes('blur('),
    undefined,
    { timeout: 8000 },
  );

  // 2. Now the user flips to Solid. Their stored object still has no maskColor,
  //    so the mask must fall back to the shipped default colour rather than
  //    emitting a filter with `undefined` in it (which the CSS parser drops,
  //    leaving the content FULLY VISIBLE).
  await blur.worker.evaluate(async () => {
    const cur = (await chrome.storage.local.get('settings')) as {
      settings: { blur: Record<string, unknown> };
    };
    cur.settings.blur['maskStyle'] = 'solid';
    await chrome.storage.local.set({ settings: cur.settings });
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

  expect(filter, 'solid must apply even from a legacy settings object').toContain('url(');
  expect(filter, 'no blur() should remain').not.toContain('blur(');
  // The killer: an undefined colour must never reach the filter markup.
  expect(filter).not.toContain('undefined');
  expect(filter).not.toContain('NaN');

  await page.close();
});
