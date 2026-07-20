import { normalizeSession, newSessionId, type SavedSession } from './model';
import { readIndex, readSession, saveSession } from './storage';

// Local JSON export/import (PLAN.md §14.5). 🔴 NO `downloads` permission: the file
// is built with a Blob + an <a download> synthesized on an extension page (the same
// house pattern as the `export` extension). Import validates every session through
// `normalizeSession` before it touches storage — a hand-crafted or truncated file
// can add data but can never corrupt the store or inject an unrestorable URL.

const FORMAT = 'blockaly-session-saver';
const FORMAT_VERSION = 1;

interface ExportFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  sessions: SavedSession[];
}

/** Read every manual session referenced by the index (quarantining is handled by
 *  `readSession`, so a corrupt one is skipped, not fatal) and serialize to JSON. */
export async function buildExport(): Promise<string> {
  const index = await readIndex();
  const sessions: SavedSession[] = [];
  for (const meta of index.order) {
    const session = await readSession(meta.id);
    if (session) sessions.push(session);
  }
  const file: ExportFile = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    sessions,
  };
  // JSON.stringify only — never string concatenation, so untrusted titles/URLs
  // can't break the document (house safety rule).
  return JSON.stringify(file, null, 2);
}

/** Trigger a client-side download from an extension page. No `downloads` permission. */
export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportFilename(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `sessions-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

/**
 * Parse and import a previously exported file. Each session is re-issued a fresh id
 * (so importing your own export twice makes copies rather than clobbering) and
 * re-validated. Returns counts; never throws on bad content — a non-JSON or wrong-
 * shape file simply imports 0.
 */
export async function importFromText(text: string): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { imported: 0, skipped: 0 };
  }
  // Accept either our wrapper or a bare array of sessions.
  const rawSessions: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { sessions?: unknown }).sessions)
      ? ((parsed as { sessions: unknown[] }).sessions)
      : [];

  let imported = 0;
  let skipped = 0;
  for (const raw of rawSessions) {
    const session = normalizeSession(raw, newSessionId());
    if (!session) {
      skipped++;
      continue;
    }
    const now = Date.now();
    const fresh: SavedSession = { ...session, id: newSessionId(), kind: 'manual', updatedAt: now };
    try {
      await saveSession(fresh);
      imported++;
    } catch {
      skipped++;
    }
  }
  return { imported, skipped };
}

/** Read a File (from an <input type=file>) as text. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}
