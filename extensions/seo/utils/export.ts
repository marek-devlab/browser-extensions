import type { A11yReport } from '@blur/core';
import type { SeoReportEx } from './checks';

// Report serialisers for the "Copy report" buttons. Pure string builders — the
// UI owns the clipboard write — so they stay trivially testable.

export function reportToJson(report: SeoReportEx, a11y: A11yReport | null): string {
  return JSON.stringify({ seo: report, accessibility: a11y }, null, 2);
}

export function reportToMarkdown(
  report: SeoReportEx,
  a11y: A11yReport | null,
): string {
  const lines: string[] = [];
  const na = (v: string | null): string => (v === null ? '_missing_' : v);

  lines.push('# SEO & Accessibility report');
  lines.push('');
  lines.push('## Meta');
  lines.push(`- **URL:** ${report.url}`);
  lines.push(`- **Title:** ${na(report.title)}`);
  lines.push(`- **Description:** ${na(report.description)}`);
  lines.push(`- **Canonical:** ${na(report.canonical)}`);
  lines.push(`- **Robots:** ${na(report.robots)}`);
  lines.push(`- **Viewport:** ${na(report.viewport)}`);
  lines.push('');

  lines.push('## Content');
  lines.push(`- **Word count:** ${report.wordCount}`);
  lines.push(
    `- **Links:** ${report.links.internal} internal, ${report.links.external} external ` +
      `(${report.links.nofollow} nofollow, ${report.links.sponsored} sponsored, ${report.links.ugc} ugc [user-generated content])`,
  );
  lines.push(`- **Images without alt:** ${report.imagesWithoutAlt}`);
  lines.push(`- **Structured data blocks:** ${report.structuredDataBlocks}`);
  lines.push('');

  if (report.structuredData.length > 0) {
    lines.push('## Structured data');
    for (const item of report.structuredData) {
      const types = item.types.join(', ') || '(untyped)';
      const status =
        item.missingRequired.length === 0
          ? 'required properties present'
          : `missing: ${item.missingRequired.join(', ')}`;
      lines.push(`- **${types}** — ${status}`);
    }
    lines.push('');
  }

  if (report.headings.length > 0) {
    lines.push('## Heading outline');
    for (const h of report.headings) {
      lines.push(`${'  '.repeat(Math.max(0, h.level - 1))}- H${h.level} ${h.text}`);
    }
    lines.push('');
  }

  lines.push('## Checks');
  for (const c of report.checks) {
    const mark = c.severity === 'ok' ? 'PASS' : c.severity === 'warning' ? 'WARN' : 'FAIL';
    lines.push(`- **[${mark}] ${c.label}** — ${c.detail}`);
  }
  lines.push('');

  if (a11y !== null) {
    lines.push('## Accessibility (axe-core)');
    lines.push(
      `- ${a11y.violations.length} violations, ${a11y.passes} passes, ${a11y.incomplete} incomplete`,
    );
    for (const v of a11y.violations) {
      lines.push(`- **[${v.impact}] ${v.id}** — ${v.help} (${v.nodes.length} node(s))`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** Just the heading outline, for the per-section "Copy headings" button. */
export function headingsToMarkdown(report: SeoReportEx): string {
  const lines: string[] = ['# Heading outline', ''];
  if (report.headings.length === 0) {
    lines.push('_No headings found on this page._');
  } else {
    for (const h of report.headings) {
      lines.push(`${'  '.repeat(Math.max(0, h.level - 1))}- H${h.level} ${h.text}`);
    }
  }
  return lines.join('\n');
}

/** Just the SEO check list, for the per-section "Copy checks" button. */
export function checksToMarkdown(report: SeoReportEx): string {
  const lines: string[] = ['# SEO checks', ''];
  for (const c of report.checks) {
    const mark = c.severity === 'ok' ? 'PASS' : c.severity === 'warning' ? 'WARN' : 'FAIL';
    lines.push(`- **[${mark}] ${c.label}** — ${c.detail}`);
  }
  return lines.join('\n');
}
