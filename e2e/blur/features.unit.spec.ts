import { test, expect } from '@playwright/test';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';
import type { BlurSiteConfig } from '@blur/core';
import {
  setSiteOverride,
  clearSiteOverride,
  hasSiteOverride,
  presetForRadius,
  BLUR_PRESETS,
  panicState,
  togglePanic,
  serializeBackup,
  parseBackup,
  buildImageSelector,
} from '../../extensions/blur/utils/features';

// These are logic-only (no browser): pure functions exercised directly.

test.describe('features — logic only', () => {
  test('setSiteOverride merges, prunes undefined, and removes empty entries', () => {
    let cfg: Record<string, BlurSiteConfig> = {};
    cfg = setSiteOverride(cfg, 'a.com', { blur: { images: true } });
    expect(cfg['a.com']).toEqual({ hostname: 'a.com', blur: { images: true } });

    cfg = setSiteOverride(cfg, 'a.com', { blur: { video: false } });
    expect(cfg['a.com']?.blur).toEqual({ images: true, video: false });

    // Setting a field back to undefined drops it (inherit global again).
    cfg = setSiteOverride(cfg, 'a.com', { blur: { images: undefined } });
    expect(cfg['a.com']?.blur).toEqual({ video: false });

    // Removing the last override with no enabled flag deletes the entry.
    cfg = setSiteOverride(cfg, 'a.com', { blur: { video: undefined } });
    expect(cfg['a.com']).toBeUndefined();
  });

  test('enabled-only override is kept; clearSiteOverride removes it', () => {
    let cfg = setSiteOverride({}, 'b.com', { enabled: false });
    expect(cfg['b.com']).toEqual({ hostname: 'b.com', enabled: false });
    expect(hasSiteOverride(cfg['b.com'])).toBe(true);
    cfg = clearSiteOverride(cfg, 'b.com');
    expect(cfg['b.com']).toBeUndefined();
    expect(hasSiteOverride(undefined)).toBe(false);
  });

  test('presets map radius <-> name', () => {
    expect(presetForRadius(BLUR_PRESETS.light.radius)).toBe('light');
    expect(presetForRadius(BLUR_PRESETS.heavy.radius)).toBe('heavy');
    expect(presetForRadius(17)).toBeNull();
  });

  test('panicState forces media on; togglePanic round-trips via snapshot', () => {
    const base = {
      ...DEFAULT_BLUR_SETTINGS,
      enabled: false,
      blur: { ...DEFAULT_BLUR_SETTINGS.blur, images: false, video: false, posters: false, radius: 10 },
    };
    const panicked = panicState(base);
    expect(panicked.enabled).toBe(true);
    expect(panicked.blur.images && panicked.blur.video && panicked.blur.posters).toBe(true);
    expect(panicked.blur.radius).toBe(BLUR_PRESETS.heavy.radius);

    // First toggle: no snapshot -> enter panic, snapshot = original.
    const first = togglePanic(base, null);
    expect(first.snapshot).toEqual(base);
    expect(first.settings.blur.images).toBe(true);

    // Second toggle: snapshot present -> restore it, clear snapshot.
    const second = togglePanic(first.settings, first.snapshot);
    expect(second.snapshot).toBeNull();
    expect(second.settings).toEqual(base);
  });

  test('serializeBackup / parseBackup round-trip', () => {
    const settings = {
      ...DEFAULT_BLUR_SETTINGS,
      blur: { ...DEFAULT_BLUR_SETTINGS.blur, text: true, textPatterns: ['спойлер', '/foo/i'] },
      allowlist: ['x.com'],
    };
    const siteConfigs = { 'y.com': { hostname: 'y.com', blur: { video: true } } };
    const imageRules = { never: ['cdn.a.com'], always: ['b.com'] };

    const json = serializeBackup(settings, siteConfigs, imageRules);
    const parsed = parseBackup(json);
    expect(parsed.settings).toEqual(settings);
    expect(parsed.siteConfigs).toEqual(siteConfigs);
    expect(parsed.imageSourceRules).toEqual(imageRules);
  });

  test('parseBackup rejects garbage and clamps bad values', () => {
    expect(() => parseBackup('not json')).toThrow();
    expect(() => parseBackup('{"format":"other"}')).toThrow();

    // Out-of-range radius is clamped; unknown reveal falls back to default.
    const parsed = parseBackup(
      JSON.stringify({
        format: 'content-blur-backup',
        version: 1,
        settings: { blur: { radius: 999, reveal: 'wat' } },
      }),
    );
    expect(parsed.settings.blur.radius).toBe(40);
    expect(parsed.settings.blur.reveal).toBe(DEFAULT_BLUR_SETTINGS.blur.reveal);
  });

  test('buildImageSelector encodes never/always rules', () => {
    // Every <img> selector carries the size-gate exclusion :not([data-bx-small]);
    // it is harmless when the gate is off (nothing is ever marked) and lets a
    // gated favicon/tracker un-blur live via CSS.
    expect(buildImageSelector(true, { never: [], always: [] })).toBe(
      'img:not([data-bx-small])',
    );
    expect(buildImageSelector(false, { never: [], always: [] })).toBe('');
    expect(buildImageSelector(true, { never: ['ex.com'], always: [] })).toBe(
      'img:not([data-bx-small]):not([src*="ex.com"])',
    );
    expect(buildImageSelector(false, { never: [], always: ['ad.com'] })).toBe(
      'img:not([data-bx-small])[src*="ad.com"]',
    );
    // Both: base rule excludes never, plus an always rule.
    expect(buildImageSelector(true, { never: ['a'], always: ['b'] })).toBe(
      'img:not([data-bx-small]):not([src*="a"]), img:not([data-bx-small])[src*="b"]',
    );
  });
});
