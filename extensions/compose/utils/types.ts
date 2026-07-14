// Shared data model for Markdown Workbench (design §1.4, §3).
//
// The draft body is the SINGLE SOURCE OF TRUTH: it is always plain Markdown
// (an internal GFM superset + <details>). Platform conversion happens ONLY on
// copy (design §4.5, §6.2) — the stored body is never rewritten by a converter.

/** Copy/paste destinations the converter targets (design §6.1). */
export type Target =
  | 'github'
  | 'gitlab'
  | 'jira'
  | 'slack'
  | 'telegram'
  | 'html'
  | 'plain';

/** The five transliteration standards (design §2.6). */
export type TranslitStandard = 'icao' | 'bgn' | 'iso9' | 'gost-b' | 'slug';

export interface Draft {
  id: string;
  title: string;
  /** Plain Markdown. NEVER platform-converted in storage. */
  body: string;
  target: Target;
  createdAt: number;
  updatedAt: number;
}

/** A point-in-time draft body copy for the history ring buffer (design §2.10). */
export interface Snapshot {
  id: string;
  draftId: string;
  body: string;
  createdAt: number;
  /** Named/pinned snapshots taken before destructive ops are never evicted. */
  reason: 'autosave' | 'manual' | 'pre-destructive' | 'created';
  label?: string;
}

/** A bug-report template (design §2.9). */
export interface Template {
  id: string;
  name: string;
  body: string;
  builtin: boolean;
}

/** UI + behaviour preferences. Small — lives in `sync:` (design §3). */
export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  fontSize: number;
  monospace: boolean;
  layout: 'auto' | 'tabs' | 'split';
  splitRatio: number;
  defaultTarget: Target;
  autosave: boolean;
  autosaveDelay: number;
  historyLimit: number;
  softWrap: boolean;
  spellcheck: boolean;
  showPreview: boolean;
  warnOnSanitize: boolean;
  emojiInsertMode: 'unicode' | 'shortcode';
  translitStandard: TranslitStandard;
  translitLang: 'ru' | 'uk' | 'be';
  slugSeparator: '-' | '_';
  slugLowercase: boolean;
  slugMaxLen: number;
  regexTimeoutMs: number;
  regexFlags: string;
  counterFields: Record<string, boolean>;
  counterLimits: Record<string, boolean>;
  limitsFollowTarget: boolean;
  envIncludeFullUA: boolean;
  contextMenuMode: 'plain' | 'quote';
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  fontSize: 14,
  monospace: true,
  layout: 'auto',
  splitRatio: 0.5,
  defaultTarget: 'github',
  autosave: true,
  autosaveDelay: 800,
  historyLimit: 30,
  softWrap: true,
  spellcheck: true,
  showPreview: true,
  warnOnSanitize: true,
  emojiInsertMode: 'unicode',
  translitStandard: 'icao',
  translitLang: 'ru',
  slugSeparator: '-',
  slugLowercase: true,
  slugMaxLen: 63,
  regexTimeoutMs: 500,
  regexFlags: 'gmu',
  counterFields: { graphemes: true, words: true, bytes: true, utf16: false, lines: false, reading: false },
  counterLimits: { commit: true, branch: true, x: false, meta: false },
  limitsFollowTarget: false,
  envIncludeFullUA: false,
  contextMenuMode: 'plain',
};
