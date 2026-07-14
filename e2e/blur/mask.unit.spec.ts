import { test, expect } from '@playwright/test';
import {
  buildStylesheet,
  clampMaskOpacity,
  isSafeMaskColor,
  resolveRevealMode,
  safeMaskColor,
  solidMaskFilter,
} from '@blur/core';
import {
  formatDuration,
  formatFromUrl,
  labelFor,
  urlFromCssBackground,
} from '../../extensions/blur/utils/media-info';

const RULES = [{ selector: 'img', action: 'blur' as const }];

test.describe('mask — logic only', () => {
  test('solid mask emits a self-contained data: URI filter, not a document reference', () => {
    const css = buildStylesheet(RULES, {
      blurRadius: 16,
      reveal: 'never',
      hostname: 'example.com',
      maskStyle: 'solid',
      maskColor: '#3355ff',
      maskOpacity: 1,
    });
    expect(css).toContain('data:image/svg+xml');
    expect(css).toContain('feFlood');
    // The whole point: a bare `url(#id)` would resolve against the element's own
    // tree and silently fail inside a shadow root, rendering the content in full.
    expect(css).not.toMatch(/filter:\s*url\(#/);
    expect(css).not.toContain('blur(');
  });

  test('blur mask still emits blur() and no filter reference', () => {
    const css = buildStylesheet(RULES, {
      blurRadius: 12,
      reveal: 'never',
      hostname: 'example.com',
      maskStyle: 'blur',
    });
    expect(css).toContain('blur(12px)');
    expect(css).not.toContain('feFlood');
  });

  test('the % and # in the SVG are percent-encoded, or the filter never parses', () => {
    const f = solidMaskFilter('#3355ff', 1);
    // Inside url(), a raw % starts an escape and a raw # starts the fragment.
    // Both must be encoded — except the trailing #m, which IS the fragment.
    expect(f).toContain('%23'); // the colour's #
    expect(f).toContain('%25'); // the 100% filter-region values
    expect(f.endsWith('#m")')).toBe(true);
  });

  test('SECURITY: a hostile mask colour cannot break out into the SVG markup', () => {
    // maskColor reaches an SVG document. A value that closed the attribute could
    // inject arbitrary markup into the filter, so the sanitizer is a strict
    // #rrggbb allowlist rather than an escaping routine.
    const hostile = `#000' /><script>alert(1)</script><rect fill='#fff`;
    expect(isSafeMaskColor(hostile)).toBe(false);
    expect(safeMaskColor(hostile)).toBe('#1f2430'); // falls back to the default

    const css = buildStylesheet(RULES, {
      blurRadius: 16,
      reveal: 'never',
      hostname: 'example.com',
      maskStyle: 'solid',
      maskColor: hostile,
    });
    expect(css).not.toContain('<script>');
    expect(css).not.toContain('alert');
  });

  test('mask opacity is clamped so the mask can never become see-through', () => {
    expect(clampMaskOpacity(0)).toBe(0.5);
    expect(clampMaskOpacity(-5)).toBe(0.5);
    expect(clampMaskOpacity(2)).toBe(1);
    expect(clampMaskOpacity(Number.NaN)).toBe(1);
    expect(clampMaskOpacity(0.8)).toBe(0.8);
  });

  test('MOBILE: hover reveal degrades to click where the pointer cannot hover', () => {
    // 'hover' is the DEFAULT reveal mode. On a touch device nothing can hover, so
    // without this the content would be permanently unrevealable on Firefox for
    // Android — the suite's only real mobile target.
    expect(resolveRevealMode('hover', false)).toBe('click');
    expect(resolveRevealMode('hover', true)).toBe('hover');
    // The explicit modes are the user's choice and are never rewritten.
    expect(resolveRevealMode('click', false)).toBe('click');
    expect(resolveRevealMode('never', false)).toBe('never');
  });

  test('the hover reveal rule is gated behind a hover media query', () => {
    const css = buildStylesheet(RULES, {
      blurRadius: 16,
      reveal: 'hover',
      hostname: 'example.com',
    });
    expect(css).toContain('@media (hover: hover) and (pointer: fine)');
  });
});

test.describe('media-info — what is under the mask', () => {
  test('formats are read from the URL, including query strings and CDN paths', () => {
    expect(formatFromUrl('https://x.test/a/b/photo.JPG?w=800&s=abc')).toBe('JPEG');
    expect(formatFromUrl('https://cdn.test/v1.2/img/hero.webp')).toBe('WEBP');
    expect(formatFromUrl('https://x.test/clip.mp4#t=10')).toBe('MP4');
    expect(formatFromUrl('https://x.test/stream.m3u8')).toBe('HLS');
  });

  test('data: URIs report their MIME subtype', () => {
    expect(formatFromUrl('data:image/png;base64,iVBOR')).toBe('PNG');
    expect(formatFromUrl('data:image/svg+xml;utf8,<svg/>')).toBe('SVG');
  });

  test('an opaque source reports NO format rather than inventing one', () => {
    // blob:/MSE streams carry no container information. Guessing "MP4" here would
    // be a confident lie shown to the user; null lets the caller fall back to the
    // element kind ("VIDEO").
    expect(formatFromUrl('blob:https://x.test/9a8b-cd')).toBeNull();
    expect(formatFromUrl('https://x.test/no-extension')).toBeNull();
    expect(formatFromUrl('')).toBeNull();
    expect(formatFromUrl(null)).toBeNull();
  });

  test('CSS background urls are unwrapped', () => {
    expect(urlFromCssBackground('url("https://x.test/a.png")')).toBe('https://x.test/a.png');
    expect(urlFromCssBackground("url('a.gif')")).toBe('a.gif');
    expect(urlFromCssBackground('none')).toBeNull();
  });

  test('durations format as m:ss, and nonsense is dropped', () => {
    expect(formatDuration(137)).toBe('2:17');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBeNull(); // live stream
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(null)).toBeNull();
  });

  test('the chip text joins only the parts that are actually known', () => {
    expect(
      labelFor({ kind: 'image', format: 'JPEG', width: 1200, height: 800, durationSec: null }),
    ).toBe('JPEG · 1200×800');
    expect(
      labelFor({ kind: 'video', format: 'MP4', width: null, height: null, durationSec: 42 }),
    ).toBe('MP4 · 0:42');
    // A streamed video with nothing knowable still says something honest.
    expect(
      labelFor({ kind: 'video', format: 'VIDEO', width: null, height: null, durationSec: null }),
    ).toBe('VIDEO');
  });
});
