import { REASONS, type Field } from './field';
import type { FieldGroup } from './device';

// Report export (design §2.6). Runs entirely from the extension page: a `Blob` +
// `<a download>` needs no `downloads` permission (house pattern from `export`).
//
// 🔴 Safety (design §9): values are UNTRUSTED text (a UA contains `(`, `;`, `/`).
// Markdown escapes `|` and newlines so a value can't break the table; JSON goes
// through `JSON.stringify`, never string concatenation. The ipinfo token is NEVER
// part of any export (it isn't in these groups to begin with).

export interface ExportOptions {
  /** 🔴 Drop location-ish values (IP, country, PoP, ISP) for bug reports/support
   *  (design §2.6). For the scaffold this only sees device groups; the network
   *  block export is a TODO (see below). */
  hideLocation?: boolean;
  includeUnavailable?: boolean;
}

function renderField(field: Field): string {
  if (field.kind === 'value') return field.value + (field.approx ? ' ~' : '');
  // 🔴 Even in export, an unavailable field is EXPLAINED, never "—".
  return `(недоступно: ${REASONS[field.reason].chip})`;
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function reportToMarkdown(groups: FieldGroup[], opts: ExportOptions = {}): string {
  const lines: string[] = [
    '# Кто я — полный отчёт',
    '',
    `Собран ${new Date().toISOString()} локально в браузере. Ничего не отправлено.`,
    '',
  ];
  for (const g of groups) {
    lines.push(`## ${g.title}`, '', '| Поле | Значение |', '| --- | --- |');
    for (const f of g.fields) {
      if (f.field.kind === 'unavailable' && !opts.includeUnavailable) continue;
      lines.push(`| ${escapeMd(f.label)} | ${escapeMd(renderField(f.field))} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function reportToJson(groups: FieldGroup[], opts: ExportOptions = {}): string {
  const out: Record<string, Record<string, string>> = {};
  for (const g of groups) {
    const section: Record<string, string> = {};
    for (const f of g.fields) {
      if (f.field.kind === 'unavailable' && !opts.includeUnavailable) continue;
      section[f.label] = renderField(f.field);
    }
    out[g.title] = section;
  }
  return JSON.stringify(
    { collectedAt: new Date().toISOString(), note: 'Собрано локально, ничего не отправлено.', sections: out },
    null,
    2,
  );
}

/** Trigger a client-side download without the `downloads` permission. */
export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
