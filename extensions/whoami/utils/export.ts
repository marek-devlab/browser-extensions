import { REASON_KEYS, na, val, type Field } from './field';
import type { FieldGroup } from './device';
import { countryName, type IspResult, type TraceResult } from './network';
import type { CopyFormat } from './storage';
import type { MsgKey, TT } from './i18n';
import type { Locale } from '@blur/ui';

// Report export (design §2.6). Runs entirely from the extension page: a `Blob` +
// `<a download>` needs no `downloads` permission (house pattern from `export`).
//
// 🔴 Safety (design §9): values are UNTRUSTED text (a UA contains `(`, `;`, `/`).
// Markdown escapes `|` and newlines so a value can't break the table; JSON goes
// through `JSON.stringify`, never string concatenation. The ipinfo token is NEVER
// part of any export (it isn't in these groups to begin with).

export interface ExportOptions {
  includeUnavailable?: boolean;
}

/* --------------------------------------------------------------------------- */
/* The network block (design §2.6). It exists in an export ONLY if the user      */
/* actually fetched it in this session — there is nowhere else it could come     */
/* from. 🔴 The ipinfo token is never part of any export: it is not in these      */
/* groups and there is no code path that puts it there.                          */
/* --------------------------------------------------------------------------- */

/** Mask an address for a bug report: `203.0.113.42` → `203.0.113.x`, IPv6 keeps
 *  only its first three groups. The main real use of "copy everything" is sending
 *  it to support — which is exactly when you do not want to hand over your IP. */
export function maskIp(ip: string): string {
  if (ip.includes(':')) {
    const head = ip.split(':').slice(0, 3).join(':');
    return `${head}:x:x:x`;
  }
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.x` : 'x';
}

export function networkGroup(
  trace: TraceResult | null,
  isp: IspResult | null,
  locale: Locale,
  opts: { maskIp?: boolean } = {},
): FieldGroup | null {
  if (!trace && !isp) return null;
  const fields: FieldGroup['fields'] = [];
  const p = (key: MsgKey, v: string | null) =>
    fields.push({ key, field: v ? val(v) : na('provider-omitted') });

  if (trace) {
    fields.push({
      key: opts.maskIp ? 'lbl_myIpMasked' : 'lbl_myIp',
      field: val(opts.maskIp ? maskIp(trace.ip) : trace.ip),
    });
    p('lbl_ipVersionExport', trace.ipVersion);
    p(
      'lbl_countryByIp',
      trace.countryCode
        ? `${countryName(trace.countryCode, locale) ?? ''} (${trace.countryCode})`.trim()
        : null,
    );
    p('lbl_cfNodeExport', trace.colo);
    p('lbl_tls', trace.tls);
    p('lbl_protocol', trace.http);
    p('lbl_warp', trace.warp);
  }
  if (isp) {
    p('lbl_isp', isp.isp);
    p('lbl_asn', isp.asn);
    p('lbl_reverseDns', isp.hostname);
    p('lbl_cityRegionExport', [isp.city, isp.region].filter(Boolean).join(', ') || null);
  }
  return { id: 'network', titleKey: 'grp_networkExport', fields };
}

function renderField(field: Field, t: TT): string {
  if (field.kind === 'value') return field.value + (field.approx ? ' ~' : '');
  // 🔴 Even in export, an unavailable field is EXPLAINED, never "—".
  return t('unavailableExport', { chip: t(REASON_KEYS[field.reason].chip) });
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function reportToMarkdown(groups: FieldGroup[], t: TT, opts: ExportOptions = {}): string {
  const lines: string[] = [
    t('exp_title'),
    '',
    t('exp_collected', { iso: new Date().toISOString() }),
    '',
  ];
  for (const g of groups) {
    lines.push(`## ${t(g.titleKey)}`, '', `| ${t('exp_colField')} | ${t('exp_colValue')} |`, '| --- | --- |');
    for (const f of g.fields) {
      if (f.field.kind === 'unavailable' && !opts.includeUnavailable) continue;
      lines.push(`| ${escapeMd(t(f.key))} | ${escapeMd(renderField(f.field, t))} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function reportToJson(groups: FieldGroup[], t: TT, opts: ExportOptions = {}): string {
  const out: Record<string, Record<string, string>> = {};
  for (const g of groups) {
    const section: Record<string, string> = {};
    for (const f of g.fields) {
      if (f.field.kind === 'unavailable' && !opts.includeUnavailable) continue;
      section[t(f.key)] = renderField(f.field, t);
    }
    out[t(g.titleKey)] = section;
  }
  return JSON.stringify(
    { collectedAt: new Date().toISOString(), note: t('exp_jsonNote'), sections: out },
    null,
    2,
  );
}

/** `key=value`, one field per line, grouped under a `# Title` comment. Same report
 *  model as the md/json serializers; newlines in a value are collapsed to a space so
 *  a value can never spill onto a second `key=value` line (the same untrusted-input
 *  rule as `escapeMd`). 🔴 The ipinfo token is not part of any group, so never here. */
export function reportToKv(groups: FieldGroup[], t: TT, opts: ExportOptions = {}): string {
  const flat = (text: string): string => text.replace(/\r?\n/g, ' ');
  const lines: string[] = [
    t('exp_title'),
    `# ${t('exp_collected', { iso: new Date().toISOString() })}`,
    '',
  ];
  for (const g of groups) {
    lines.push(`# ${flat(t(g.titleKey))}`);
    for (const f of g.fields) {
      if (f.field.kind === 'unavailable' && !opts.includeUnavailable) continue;
      lines.push(`${flat(t(f.key))}=${flat(renderField(f.field, t))}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Serialize the report in the user's chosen `copyFormat` (settings). Keeps the
 *  copy/export path from hardcoding one format. */
export function serializeReport(
  format: CopyFormat,
  groups: FieldGroup[],
  t: TT,
  opts: ExportOptions = {},
): string {
  switch (format) {
    case 'json':
      return reportToJson(groups, t, opts);
    case 'kv':
      return reportToKv(groups, t, opts);
    case 'md':
    default:
      return reportToMarkdown(groups, t, opts);
  }
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
