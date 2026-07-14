import type { PageInsight, WebVital } from '@blur/core';
import type { LongFrameSummary, TimedNetworkEntry } from './perf-types';

// Export the collected measurement as JSON or CSV, for copy or download (PLAN §10
// "developer" audience). Byte honesty carries through: an unmeasured request's size
// is `null` in JSON and an empty cell in CSV — never 0.

export interface ExportPayload {
  hostname: string;
  exportedAt: string;
  insight: PageInsight | null;
  vitals: WebVital[];
  longFrames: LongFrameSummary | null;
  entries: TimedNetworkEntry[];
}

export function toJson(payload: ExportPayload): string {
  return JSON.stringify(payload, null, 2);
}

function csvCell(value: string | number | null): string {
  if (value === null) return ''; // unmeasurable → blank, never 0
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The network table as CSV. Rating-free, one row per request. */
export function entriesToCsv(entries: TimedNetworkEntry[]): string {
  const header = ['url', 'kind', 'startTimeMs', 'durationMs', 'transferBytes', 'thirdParty'];
  const rows = entries.map((e) =>
    [
      csvCell(e.url),
      csvCell(e.kind),
      csvCell(Math.round(e.startTime)),
      csvCell(Math.round(e.duration)),
      // null stays blank — the honesty rule, in CSV form.
      csvCell(e.transferSize),
      csvCell(e.thirdParty ? 'yes' : 'no'),
    ].join(','),
  );
  return [header.join(','), ...rows].join('\r\n');
}

/** Vitals as CSV (name, value, unit, rating). */
export function vitalsToCsv(vitals: WebVital[]): string {
  const header = ['name', 'value', 'unit', 'rating'];
  const rows = vitals.map((v) =>
    [csvCell(v.name), csvCell(v.value), csvCell(v.unit), csvCell(v.rating)].join(','),
  );
  return [header.join(','), ...rows].join('\r\n');
}

/** Copy text to the clipboard, resolving false if the API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Trigger a file download of `text` without any host permission. */
export function downloadText(filename: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has started.
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}
