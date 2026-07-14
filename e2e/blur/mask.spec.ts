import { test, expect } from './harness';
import type { Page } from '@playwright/test';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';

/**
 * Masking tests that read REAL PAINTED PIXELS.
 *
 * Every other blur test asserts on `getComputedStyle(el).filter`, which proves a
 * declaration was applied — not that anything is actually hidden. For an
 * extension whose entire promise is "this content is not on screen", that is the
 * wrong assertion: a filter can be declared and still fail to paint (an SVG
 * filter reference that does not resolve is dropped silently, and the element
 * renders in full). So these tests screenshot the page and sample the pixels the
 * user would actually see.
 *
 * The shadow-DOM case is the reason this file exists. A `filter: url(#id)`
 * pointing at a <filter> injected into the page document resolves fine in the
 * light DOM and SILENTLY FAILS inside a shadow root — fragment references are
 * scoped to the element's own tree — so the image renders unmasked. Measured, in
 * Chromium, before the fix. Sites that matter (YouTube, Reddit) put their media
 * inside web components, so that bug would have leaked exactly the content people
 * install this to hide. The shipped implementation uses a self-contained
 * `data:` URI filter, which carries its own definition and is immune to scoping.
 */

const MASK = '#3355ff';
const SOLID_SETTINGS = {
  ...DEFAULT_BLUR_SETTINGS,
  blur: {
    ...DEFAULT_BLUR_SETTINGS.blur,
    images: true,
    video: true,
    posters: true,
    reveal: 'never' as const,
    maskStyle: 'solid' as const,
    maskColor: MASK,
    maskOpacity: 1,
  },
};

/** Sample the centre pixel of `selector` from a real screenshot of the page. */
async function centrePixel(page: Page, selector: string, inShadow?: string): Promise<string> {
  // A screenshot only captures the VIEWPORT. The mask targets sit far down the
  // fixture, so without this the sampler reads page background and every
  // assertion is meaningless (it would "prove" the content is hidden simply
  // because the element is off-screen).
  await page.evaluate(
    ({ sel, host }) => {
      const el = host
        ? document.querySelector(host)!.shadowRoot!.querySelector(sel)
        : document.querySelector(sel);
      el?.scrollIntoView({ block: 'center' });
    },
    { sel: selector, host: inShadow ?? null },
  );
  await page.waitForTimeout(250);

  const shot = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ png, sel, host }) => {
      const im = new Image();
      im.src = 'data:image/png;base64,' + png;
      await im.decode();
      const cv = document.createElement('canvas');
      cv.width = im.width;
      cv.height = im.height;
      const cx = cv.getContext('2d')!;
      cx.drawImage(im, 0, 0);
      const dpr = im.width / window.innerWidth;

      const el = host
        ? (document.querySelector(host)!.shadowRoot!.querySelector(sel) as Element)
        : (document.querySelector(sel) as Element);
      if (!el) throw new Error('element not found: ' + sel);
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) throw new Error('element has no box: ' + sel);
      const d = cx.getImageData(
        Math.round((r.left + r.width / 2) * dpr),
        Math.round((r.top + r.height / 2) * dpr),
        1,
        1,
      ).data;
      return (
        '#' +
        [d[0], d[1], d[2]].map((v) => (v as number).toString(16).padStart(2, '0')).join('')
      );
    },
    { png: shot, sel: selector, host: inShadow ?? null },
  );
}

/** Red is the fixture's source content. Seeing it means the mask failed. */
function expectNotLeaking(hex: string, what: string): void {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const looksRed = (r as number) > 120 && (g as number) < 90 && (b as number) < 90;
  expect(looksRed, `${what} LEAKED the source content (painted ${hex})`).toBe(false);
}

test.describe('Content Blur — solid mask paints real, opaque pixels', () => {
  test('1. solid mask covers <img>, <video> and a background thumbnail', async ({ blur }) => {
    await blur.setSettings(SOLID_SETTINGS);
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    // Let the video stream paint and the engine settle.
    await page.waitForTimeout(1200);

    for (const sel of ['#red-img', '#red-video', '#bg-thumb']) {
      const hex = await centrePixel(page, sel);
      expectNotLeaking(hex, sel);
      expect(hex, `${sel} should be painted with the mask colour`).toBe(MASK);
    }
    await page.close();
  });

  test('2. REGRESSION: the mask still covers an <img> inside a shadow root', async ({
    blur,
  }) => {
    await blur.setSettings(SOLID_SETTINGS);
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await page.waitForTimeout(1200);

    const hex = await centrePixel(page, '#shadow-red-img', '#red-host');
    // This is the assertion that a document-scoped `filter: url(#id)` fails.
    expectNotLeaking(hex, 'shadow-root <img>');
    expect(hex, 'shadow-root <img> must be masked, not merely styled').toBe(MASK);
    await page.close();
  });

  test('3. revealing an element clears the mask and shows the real content', async ({
    blur,
  }) => {
    await blur.setSettings({
      ...SOLID_SETTINGS,
      blur: { ...SOLID_SETTINGS.blur, reveal: 'click' },
    });
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await page.waitForTimeout(800);

    expect(await centrePixel(page, '#red-img')).toBe(MASK);

    await page.click('#red-img');
    await page.waitForTimeout(300);

    // The masked content must come BACK on reveal — a mask that cannot be undone
    // is just a broken image.
    const revealed = await centrePixel(page, '#red-img');
    expect(revealed, 'reveal should restore the real pixels').not.toBe(MASK);
    await page.close();
  });

  test('4. blur mode still blurs (the solid path did not replace it)', async ({ blur }) => {
    await blur.setSettings({
      ...SOLID_SETTINGS,
      blur: { ...SOLID_SETTINGS.blur, maskStyle: 'blur' },
    });
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await page.waitForFunction(
      () => {
        const el = document.querySelector('#red-img');
        return !!el && getComputedStyle(el).filter.includes('blur(');
      },
      undefined,
      { timeout: 8000 },
    );

    // A blurred solid-red image is still red — blur hides detail, not colour. The
    // point of this test is only that choosing 'blur' does not silently produce a
    // solid fill, so assert on the declaration, not the pixels.
    const filter = await page.evaluate(
      () => getComputedStyle(document.querySelector('#red-img')!).filter,
    );
    expect(filter).toContain('blur(');
    expect(filter).not.toContain('url(');
    await page.close();
  });
});
