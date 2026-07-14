import { test, expect } from './harness';
import type { Page } from '@playwright/test';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';

async function expectBlurred(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && getComputedStyle(el).filter.includes('blur(');
    },
    selector,
    { timeout: 8000 },
  );
}

async function expectNotBlurred(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && getComputedStyle(el).filter === 'none';
    },
    selector,
    { timeout: 8000 },
  );
}

test.describe('Content Blur — new features (live DOM)', () => {
  test('Feature 1: per-site override turns images on for one host', async ({ blur }) => {
    // Global: images OFF. Site override: images ON for 127.0.0.1.
    await blur.setSettings({
      ...DEFAULT_BLUR_SETTINGS,
      blur: { ...DEFAULT_BLUR_SETTINGS.blur, images: false },
    });
    await blur.setSiteConfigs({
      '127.0.0.1': { hostname: '127.0.0.1', blur: { images: true } },
    });
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await expectBlurred(page, '#static-img');
  });

  test('Feature 1: per-site override can disable images while global is on', async ({
    blur,
  }) => {
    await blur.setSiteConfigs({
      '127.0.0.1': { hostname: '127.0.0.1', blur: { images: false, posters: false } },
    });
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await expectNotBlurred(page, '#static-img');
  });

  test('Feature 6: "never blur" source keeps a matching image sharp', async ({ blur }) => {
    // Fixture images use a data: URI containing "image/gif"; exclude that source.
    await blur.setImageSourceRules({ never: ['image/gif'], always: [] });
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await expectNotBlurred(page, '#static-img');
  });

  test('Feature 6: "always blur" source blurs even when Images is off', async ({ blur }) => {
    await blur.setSettings({
      ...DEFAULT_BLUR_SETTINGS,
      blur: { ...DEFAULT_BLUR_SETTINGS.blur, images: false, posters: false },
    });
    await blur.setImageSourceRules({ never: [], always: ['image/gif'] });
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await expectBlurred(page, '#static-img');
  });

  test('Feature 4: right-click + "Blur this element" message blurs the target', async ({
    blur,
  }) => {
    // Turn the category engine off so the blur we observe is purely the manual,
    // context-menu-driven path.
    await blur.setSettings({
      ...DEFAULT_BLUR_SETTINGS,
      blur: {
        ...DEFAULT_BLUR_SETTINGS.blur,
        images: false,
        video: false,
        posters: false,
      },
    });
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await expectNotBlurred(page, '#static-img');

    // A 'contextmenu' event sets the content script's lastContextTarget (capture
    // phase listener). A real OS right-click menu blocks the headed browser, so
    // dispatch the event synthetically — the code path is identical. The
    // background's contextMenus.onClicked (which cannot be triggered from
    // Playwright) then sends exactly this message, which we send directly.
    await page.$eval('#static-img', (el) =>
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })),
    );
    await blur.sendToActiveTab({ type: 'blurElement' });

    await page.waitForFunction(
      () => {
        const el = document.querySelector('#static-img');
        return !!el && el.hasAttribute('data-bx-manual') &&
          getComputedStyle(el).filter.includes('blur(');
      },
      { timeout: 8000 },
    );

    // revealAll clears the manual blur too.
    await blur.sendToActiveTab({ type: 'revealAll' });
    await expectNotBlurred(page, '#static-img');
  });

  test('Feature 3 (path): revealAll message reveals engine-blurred content', async ({
    blur,
  }) => {
    // The reveal-all keyboard command routes through this same message.
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await expectBlurred(page, '#static-img');
    await blur.sendToActiveTab({ type: 'revealAll' });
    await expectNotBlurred(page, '#static-img');
  });
});
