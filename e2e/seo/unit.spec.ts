import { test, expect } from 'playwright/test';
import {
  serpField,
  serpDisplayUrl,
  SERP_TITLE_MAX_PX,
} from '../../extensions/seo/utils/serp';
import {
  validateStructuredData,
  findSkippedHeadingLevels,
} from '../../extensions/seo/utils/checks';

// Logic-level (DOM-free) coverage for the pure helpers. These complement — do
// not replace — the real-browser suite in seo.spec.ts; they exercise the
// truncation maths and structured-data validation exhaustively without a page.

// A deterministic stub measure: 10px per character.
const measure = (text: string): number => text.length * 10;

test('serpField reports no truncation when the text fits', () => {
  const f = serpField('short title', measure, SERP_TITLE_MAX_PX);
  expect(f.truncated).toBe(false);
  expect(f.display).toBe('short title');
});

test('serpField truncates with an ellipsis and stays within budget', () => {
  const long = 'x'.repeat(200); // 2000px at 10px/char, over the 580px budget.
  const f = serpField(long, measure, SERP_TITLE_MAX_PX);
  expect(f.truncated).toBe(true);
  expect(f.display.endsWith('…')).toBe(true);
  expect(measure(f.display)).toBeLessThanOrEqual(SERP_TITLE_MAX_PX);
  expect(f.pixels).toBe(2000);
});

test('serpDisplayUrl renders host and path segments Google-style', () => {
  expect(serpDisplayUrl('https://example.com/blog/post-1')).toBe(
    'example.com › blog › post-1',
  );
  expect(serpDisplayUrl('not a url')).toBe('not a url');
});

test('validateStructuredData flags missing required props by type', () => {
  const items = validateStructuredData([
    { '@type': 'Article', author: 'x' }, // missing headline
    { '@type': 'Product', name: 'Widget' }, // complete
    { '@type': 'Organization' }, // missing name
  ]);
  expect(items).toHaveLength(3);
  expect(items[0]?.missingRequired).toEqual(['headline']);
  expect(items[1]?.missingRequired).toEqual([]);
  expect(items[2]?.missingRequired).toEqual(['name']);
});

test('validateStructuredData walks @graph nodes', () => {
  const items = validateStructuredData([
    { '@graph': [{ '@type': 'BreadcrumbList' }, { '@type': 'Article', headline: 'Hi' }] },
  ]);
  expect(items.map((i) => i.types[0])).toEqual(['BreadcrumbList', 'Article']);
  expect(items[0]?.missingRequired).toEqual(['itemListElement']);
  expect(items[1]?.missingRequired).toEqual([]);
});

test('findSkippedHeadingLevels flags an h2 -> h4 jump', () => {
  const skipped = findSkippedHeadingLevels([
    { level: 1, text: 'a' },
    { level: 2, text: 'b' },
    { level: 4, text: 'c' },
  ]);
  expect([...skipped]).toEqual([2]);
});
