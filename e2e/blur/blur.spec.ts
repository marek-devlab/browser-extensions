import { test, expect } from './harness';
import type { Page } from '@playwright/test';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';

/** Wait until a light-DOM element's computed `filter` contains `blur(`. */
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

/** Wait until a light-DOM element's computed `filter` is `none`. */
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

test.describe('Content Blur — live DOM behavior', () => {
  test('1. <img> gets filter: blur(...) by default', async ({ blur }) => {
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await expectBlurred(page, '#static-img');
    const filter = await page.$eval('#static-img', (el) => getComputedStyle(el).filter);
    expect(filter).toMatch(/blur\(\d/);
  });

  test('2. video[poster] and background-image thumbnail blur when Posters on', async ({
    blur,
  }) => {
    // Posters default to true, but set explicitly so the assertion is unambiguous.
    await blur.setSettings({
      ...DEFAULT_BLUR_SETTINGS,
      blur: { ...DEFAULT_BLUR_SETTINGS.blur, posters: true, images: false },
    });
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await expectBlurred(page, 'video#poster-video');
    await expectBlurred(page, '#bg-thumb');
  });

  test('3. Cyrillic + English keywords blur matching text; other text stays', async ({
    blur,
  }) => {
    await blur.setSettings({
      ...DEFAULT_BLUR_SETTINGS,
      blur: {
        ...DEFAULT_BLUR_SETTINGS.blur,
        text: true,
        textPatterns: ['спойлер', 'spoiler'],
      },
    });
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);

    // Chromium supports the CSS Custom Highlight API, so text blur uses ranges,
    // not spans. Assert the registered highlight covers the matched words only.
    const result = await page.waitForFunction(() => {
      const reg = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights;
      const hl = reg?.get('bx-text');
      if (hl) {
        const texts = [...hl].map((r) => r.toString());
        return { mode: 'highlight', texts };
      }
      // Fallback: span-wrapping strategy.
      const spans = [...document.querySelectorAll('.bx-text-blur')].map(
        (s) => s.textContent ?? '',
      );
      return spans.length > 0 ? { mode: 'span', texts: spans } : null;
    }, { timeout: 8000 });

    const { texts } = (await result.jsonValue()) as { mode: string; texts: string[] };
    expect(texts).toContain('спойлер');
    expect(texts).toContain('spoiler');
    expect(texts).not.toContain('safeword');

    // Prove the styling really is transparent-text + shadow (the "blur" look).
    const styleText = await page.evaluate(() => {
      for (const sheet of document.adoptedStyleSheets) {
        for (const rule of sheet.cssRules) {
          const t = rule.cssText;
          if (t.includes('bx-text')) return t;
        }
      }
      return '';
    });
    expect(styleText).toContain('transparent');
    expect(styleText).toContain('text-shadow');
  });

  test('4a. hover-to-reveal removes the blur on hover', async ({ blur }) => {
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await expectBlurred(page, '#static-img');
    await page.hover('#static-img');
    await expectNotBlurred(page, '#static-img');
  });

  test('4b. click-to-reveal works with a capture-phase click', async ({ blur }) => {
    await blur.setSettings({
      ...DEFAULT_BLUR_SETTINGS,
      blur: { ...DEFAULT_BLUR_SETTINGS.blur, reveal: 'click' },
    });
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await expectBlurred(page, '#static-img');

    // The reveal click must be swallowed (capture phase) so the page's own
    // handler does not fire on it.
    await page.evaluate(() => {
      (window as unknown as { __pageClicked: boolean }).__pageClicked = false;
      document.getElementById('static-img')?.addEventListener('click', () => {
        (window as unknown as { __pageClicked: boolean }).__pageClicked = true;
      });
    });

    await page.click('#static-img');
    await expectNotBlurred(page, '#static-img');
    const pageClicked = await page.evaluate(
      () => (window as unknown as { __pageClicked: boolean }).__pageClicked,
    );
    expect(pageClicked).toBe(false);

    // A second click now passes through to the page (element already revealed).
    await page.click('#static-img');
    const clickedAfter = await page.evaluate(
      () => (window as unknown as { __pageClicked: boolean }).__pageClicked,
    );
    expect(clickedAfter).toBe(true);
  });

  test('5. Allowlisting the fixture host disables blur on it', async ({ blur }) => {
    await blur.setSettings({ ...DEFAULT_BLUR_SETTINGS, allowlist: ['127.0.0.1'] });
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await expectNotBlurred(page, '#static-img');
  });

  test('6. Dynamically inserted <img> gets blurred (MutationObserver)', async ({
    blur,
  }) => {
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await page.waitForSelector('#dynamic-img');
    await expectBlurred(page, '#dynamic-img');
  });

  test('7. <img> inside an open shadow root gets blurred (shadow traversal)', async ({
    blur,
  }) => {
    const page = await blur.ctx.newPage();
    await page.goto(blur.origin);
    await page.waitForFunction(
      () => {
        const host = document.getElementById('host');
        const img = host?.shadowRoot?.getElementById('shadow-img');
        return !!img && getComputedStyle(img).filter.includes('blur(');
      },
      { timeout: 8000 },
    );
  });
});
