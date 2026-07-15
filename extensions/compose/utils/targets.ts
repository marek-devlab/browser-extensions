import type { Target } from './types';

// Target-platform metadata (design §6). The label + copy-button verb are REAL
// UI; the per-target feature matrix here drives the compatibility warnings and
// the counter's platform-specific limits. The actual CONVERSION that reads this
// lives in utils/convert.ts (seven real targets).

export interface TargetInfo {
  id: Target;
  label: string;
  /** "Copy for GitLab", "Copy as HTML", etc. */
  copyVerb: string;
  /** Human note surfaced in the CounterStrip / compatibility dialog. */
  note: string;
}

export const TARGETS: TargetInfo[] = [
  { id: 'github', label: 'GitHub', copyVerb: 'Copy for GitHub', note: 'GFM — our native format.' },
  { id: 'gitlab', label: 'GitLab', copyVerb: 'Copy for GitLab', note: 'GLFM — near-identical to GitHub.' },
  { id: 'jira', label: 'Jira', copyVerb: 'Copy for Jira', note: 'Wiki markup — full syntax rewrite.' },
  { id: 'slack', label: 'Slack', copyVerb: 'Copy for Slack', note: 'mrkdwn — no headings/tables/details.' },
  { id: 'telegram', label: 'Telegram', copyVerb: 'Copy for Telegram', note: 'MarkdownV2 — heavy escaping.' },
  { id: 'html', label: 'HTML', copyVerb: 'Copy as HTML', note: 'Sanitized text/html + text/plain.' },
  { id: 'plain', label: 'Plain text', copyVerb: 'Copy as plain text', note: 'Markup stripped, structure kept.' },
];

export function targetInfo(id: Target): TargetInfo {
  return TARGETS.find((t) => t.id === id) ?? TARGETS[0];
}

/** Character/byte limits shown as progress bars in the Stats tab (design §2.7).
 *  `unit` is surfaced next to every number — showing "312/280" without a unit
 *  would be lying in the UI (design §2.7). */
export interface LimitDef {
  id: string;
  label: string;
  max: number;
  unit: 'graphemes' | 'utf16' | 'bytes' | 'codepoints';
}

export const LIMITS: LimitDef[] = [
  { id: 'commitTitle', label: 'Commit title', max: 50, unit: 'graphemes' },
  { id: 'commitBody', label: 'Commit body (per line)', max: 72, unit: 'graphemes' },
  { id: 'branch', label: 'GitLab branch name', max: 63, unit: 'bytes' },
  { id: 'x', label: 'X / Twitter', max: 280, unit: 'codepoints' },
  { id: 'meta', label: 'meta description', max: 160, unit: 'graphemes' },
];
